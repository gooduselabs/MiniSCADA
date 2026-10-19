#include "core/project-manager/project_validator.hpp"

#include <dirent.h>
#include <sys/stat.h>

#include <algorithm>
#include <cctype>
#include <climits>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <regex>
#include <sstream>

#include "core/common/json_limits.hpp"
#include "core/common/path_segment.hpp"
#include "core/project-manager/alarm_rules.hpp"
#include "core/project-manager/logging_estimate.hpp"
#include "core/project-manager/rules_010.hpp"
#include "core/project-manager/rules_02.hpp"
#include "core/project-manager/rules_03.hpp"
#include "core/project-manager/rules_10.hpp"
#include "core/project-manager/rules_11.hpp"
#include "valijson/adapters/nlohmann_json_adapter.hpp"
#include "valijson/schema.hpp"
#include "valijson/schema_parser.hpp"
#include "valijson/validation_results.hpp"
#include "valijson/validator.hpp"

namespace mat {

using nlohmann::json;

namespace {

constexpr size_t kMaxFileBytes = 1024 * 1024;
const char* const kSupportedTargets[] = {"style.fill",           "style.stroke", "style.opacity",
                                         "style.visibility",     "text.content", "transform.rotate",
                                         "geometry.levelPercent"};

bool isNumericTagType(const std::string& t) { return t != "BOOL" && t != "STRING"; }

enum class ReadStatus { Ok, Missing, TooBig };

// Every part of `rel` must be a directory entry with exactly that name, as on the device (ext4):
// a case-insensitive file system (NTFS through Docker Desktop, macOS) would otherwise open
// `main.svg` for `Main.svg`. Studio and the TS reader check the same (audit FR-032).
// readdir64: the 32-bit readdir fails with EOVERFLOW on 64-bit directory offsets (armhf build
// under qemu-user on an x64 host, deployment/toolchain/smoke-armhf.sh).
bool exactCase(const std::string& root, const std::string& rel) {
    std::string dir = root;
    size_t start = 0;
    while (start <= rel.size()) {
        size_t end = rel.find('/', start);
        if (end == std::string::npos) end = rel.size();
        const std::string part = rel.substr(start, end - start);
        DIR* d = opendir(dir.c_str());
        if (!d) return false;
        bool found = false;
        while (const dirent64* e = readdir64(d))
            if (part == e->d_name) {
                found = true;
                break;
            }
        closedir(d);
        if (!found) return false;
        dir += "/" + part;
        start = end + 1;
    }
    return true;
}

ReadStatus readContained(const std::string& root, const std::string& rel, std::string& out) {
    char rootReal[PATH_MAX];
    char fileReal[PATH_MAX];
    if (!realpath(root.c_str(), rootReal)) return ReadStatus::Missing;
    if (!exactCase(root, rel)) return ReadStatus::Missing;
    const std::string full = root + "/" + rel;
    if (!realpath(full.c_str(), fileReal)) return ReadStatus::Missing;
    const std::string r = rootReal, f = fileReal;
    if (f.compare(0, r.size() + 1, r + "/") != 0) return ReadStatus::Missing;  // symlink escape
    struct stat st {};
    if (stat(fileReal, &st) != 0 || !S_ISREG(st.st_mode)) return ReadStatus::Missing;
    if (static_cast<size_t>(st.st_size) > kMaxFileBytes) return ReadStatus::TooBig;
    std::ifstream in(fileReal, std::ios::binary);
    if (!in) return ReadStatus::Missing;
    std::stringstream ss;
    ss << in.rdbuf();
    out = ss.str();
    return ReadStatus::Ok;
}

// The document as the JSON Schema check sees it. "integer" is a number without a fractional part,
// as in the TS validator: `10.0` and `1e1` are integers (contracts/project-format.md, audit
// FR-008). nlohmann keeps them as floats and valijson's strict types would refuse them, so integral
// numbers become int64 here. Numbers beyond int64 are clamped (valijson reads integers as int64):
// the schemas compare numbers only with small bounds, so the result is the same as with the real
// value. The loaded document keeps the numbers as written.
json schemaView(const json& v) {
    constexpr double kTwo63 = 9223372036854775808.0;
    switch (v.type()) {
        case json::value_t::number_float: {
            const double d = v.get<double>();  // always finite: the parser refuses 1e400
            if (std::trunc(d) != d) return v;
            if (d >= kTwo63) return INT64_MAX;
            if (d < -kTwo63) return INT64_MIN;
            return static_cast<int64_t>(d);
        }
        case json::value_t::number_unsigned:
            return v.get<uint64_t>() > static_cast<uint64_t>(INT64_MAX) ? json(INT64_MAX) : v;
        case json::value_t::array: {
            json out = json::array();
            for (const auto& x : v) out.push_back(schemaView(x));
            return out;
        }
        case json::value_t::object: {
            json out = json::object();
            for (auto it = v.begin(); it != v.end(); ++it) out[it.key()] = schemaView(it.value());
            return out;
        }
        default:
            return v;
    }
}

std::string contextToPointer(const std::vector<std::string>& ctx) {
    std::string p;
    for (const auto& c : ctx) {
        if (c == "<root>") continue;
        std::string s = c;
        if (s.size() >= 2 && s.front() == '[' && s.back() == ']') s = s.substr(1, s.size() - 2);
        if (s.size() >= 2 && s.front() == '"' && s.back() == '"') s = s.substr(1, s.size() - 2);
        p += "/" + s;
    }
    return p;
}

struct Schemas {
    std::map<std::string, std::unique_ptr<valijson::Schema>> byKind;
    std::string error;

    // set 10: the schemas of format 1.0 in `root` (feature 011; frozen copy in `root`/1.0); 6: the
    // frozen 0.6 set in `root`/0.6 (feature 010); 5: the frozen 0.5 set in `root`/0.5 (feature
    // 009); 4: the frozen 0.4 set in `root`/0.4 (feature 008); 3: the frozen 0.3 set in `root`/0.3;
    // 2: the frozen 0.2 set in `root`/0.2; else the frozen 0.1 set in `root`/0.1.
    Schemas(const std::string& root, int set) {
        const bool v02 = set >= 2;
        const std::string dir =
            set == 10 ? root
                      : set == 6 ? root + "/0.6"
                                 : set == 5 ? root + "/0.5"
                                            : set == 4 ? root + "/0.4"
                                                       : set == 3 ? root + "/0.3"
                                                                  : set == 2 ? root + "/0.2"
                                                                             : root + "/0.1";
        std::vector<std::pair<std::string, std::string>> kinds = {{"project", "project"},
                                                                  {"tag", "tag"},
                                                                  {"screen", "screen"},
                                                                  {"binding", "binding"},
                                                                  {"logging", "logging"}};
        if (v02) {
            kinds.push_back({"connections", "connections"});
            kinds.push_back({"valueTable", "value-table"});
            kinds.push_back({"watchTable", "watch-table"});
        }
        if (set >= 6) {
            kinds.push_back({"reports", "reports"});
        }
        if (set == 10) {
            kinds.push_back({"logic", "logic"});
            kinds.push_back({"template", "template"});
        }
        for (const auto& [kind, name] : kinds) {
            std::ifstream f(dir + "/" + name + ".schema.json");
            if (!f) {
                error = std::string("không đọc được schema ") + kind;
                return;
            }
            std::stringstream ss;
            ss << f.rdbuf();
            json doc = json::parse(ss.str(), nullptr, false);
            if (doc.is_discarded()) {
                error = std::string("schema hỏng: ") + kind;
                return;
            }
            auto schema = std::make_unique<valijson::Schema>();
            valijson::SchemaParser parser(valijson::SchemaParser::kDraft7);
            valijson::adapters::NlohmannJsonAdapter adapter(doc);
            try {
                parser.populateSchema(adapter, *schema);
            } catch (const std::exception& e) {
                error = std::string("schema ") + kind + ": " + e.what();
                return;
            }
            byKind[kind] = std::move(schema);
        }
    }
};

// /tags/<n>/expression
bool isExpressionPath(const std::string& p) {
    static const std::string kPre = "/tags/", kPost = "/expression";
    if (p.size() <= kPre.size() + kPost.size() || p.compare(0, kPre.size(), kPre) != 0)
        return false;
    if (p.compare(p.size() - kPost.size(), kPost.size(), kPost) != 0) return false;
    for (size_t i = kPre.size(); i < p.size() - kPost.size(); ++i)
        if (p[i] < '0' || p[i] > '9') return false;
    return true;
}

class Checker {
   public:
    Checker(std::string root, const Schemas& schemas) : root_(std::move(root)), schemas_(schemas) {}

    std::vector<ProjectIssue> errors;
    std::vector<ProjectIssue> warnings;
    // Size in bytes of each file read (alarms.json has its own cap of 512 KiB).
    std::map<std::string, size_t> bytes;

    void add(const char* code, const std::string& file, const std::string& path,
             const std::string& message) {
        errors.push_back({code, file, path, message});
    }
    void warn(const char* code, const std::string& file, const std::string& path,
              const std::string& message) {
        warnings.push_back({code, file, path, message});
    }

    // Read + parse + schema. Returns true and fills `out` when the document is schema-valid.
    // `expressionExempt`: the `expression` strings of tags.json 0.2 have their own limit
    // (E_EXPR_LIMIT).
    bool loadJson(const std::string& file, const char* kind, json& out,
                  bool expressionExempt = false) {
        std::string text;
        switch (readContained(root_, file, text)) {
            case ReadStatus::Missing:
                add("E_FILE_MISSING", file, "", "Không tìm thấy file '" + file + "'");
                return false;
            case ReadStatus::TooBig:
                add("E_JSON", file, "", "File lớn hơn 1 MB");
                return false;
            case ReadStatus::Ok:
                break;
        }
        bytes[file] = text.size();
        // Depth is counted on the text BEFORE parsing (nlohmann recurses per level).
        if (jsonNestingDepth(text.data(), text.size()) > kMaxProjectJsonDepth) {
            add("E_JSON", file, "", "JSON lồng quá sâu");
            return false;
        }
        out = json::parse(text, nullptr, false);
        if (out.is_discarded()) {
            add("E_JSON", file, "", "JSON không hợp lệ");
            return false;
        }
        // Long strings are refused before valijson runs std::regex on them (recursive).
        if (auto p = findLongString(out, "", kMaxProjectStringBytes,
                                    expressionExempt ? isExpressionPath : nullptr)) {
            add("E_SCHEMA", file, *p, "Chuỗi quá dài");
            return false;
        }
        // logging.json: a key that looks like a secret is refused BEFORE the schema, with its own
        // code (contracts/logging-config.md step 3).
        if (std::string(kind) == "logging") {
            auto p = findSecretKey(out);
            if (!p) p = findUrlCredentials(out);
            if (p) {
                add("E_LOG_SECRET", file, *p,
                    "Không để mật khẩu/token trong project: nhập trên thiết bị bằng "
                    "mat-runtime --set-secret");
                return false;
            }
        }
        // alarms.json, alarm-classes.json (format 0.5): no JSON Schema, the rules of
        // alarm_rules.cpp check the structure with the codes of the contract
        if (!schemas_.byKind.count(kind)) return true;
        valijson::Validator validator;
        valijson::ValidationResults results;
        const json view = schemaView(out);
        valijson::adapters::NlohmannJsonAdapter target(view);
        if (!validator.validate(*schemas_.byKind.at(kind), target, &results)) {
            valijson::ValidationResults::Error e;
            std::set<std::string> seen;
            while (results.popError(e)) {
                std::string path = contextToPointer(e.context);
                if (seen.insert(path).second) add("E_SCHEMA", file, path, e.description);
            }
            return false;
        }
        return true;
    }

    bool exists(const std::string& rel) {
        std::string dummy;
        return readContained(root_, rel, dummy) != ReadStatus::Missing;
    }

   private:
    std::string root_;
    const Schemas& schemas_;
};

struct ScreenInput {
    std::string id;
    std::string file;
    json screen;
    bool hasBindings = false;
    json bindings;
};

bool scalarMatches(const std::string& tagType, const json& v) {
    if (tagType == "BOOL") return v.is_boolean();
    if (tagType == "STRING") return v.is_string();
    return v.is_number();
}

bool directAccepts(const json& b, const std::string& t) {
    const std::string target = b["target"];
    const bool numeric = isNumericTagType(t);
    if (target == "geometry.levelPercent" || target == "style.opacity") return numeric;
    if (target == "transform.rotate")
        return b.value("animation", "") == "spin" ? numeric || t == "BOOL" : numeric;
    if (target == "style.visibility") return t == "BOOL" || t == "STRING";
    if (target == "style.fill" || target == "style.stroke") return t == "STRING";
    return true;  // text.content
}

std::string lowerAscii(std::string s) {
    for (char& ch : s) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    return s;
}

bool cyclicModeOk(const json& g) {
    // Mode trigger (feature 010): every wrong field of the group is E_LOG_TRIGGER, never
    // E_LOG_MODE.
    if (g["mode"] == "trigger") return true;
    if (g["mode"] == "cyclic")
        return g.contains("periodMs") && !g.contains("minIntervalMs") &&
               !g.contains("maxIntervalMs");
    if (g.contains("periodMs")) return false;
    return !g.contains("maxIntervalMs") ||
           g.value("minIntervalMs", 1000.0) <= g["maxIntervalMs"].get<double>();
}

// E_LOG_* rules of logging.json (contracts/logging-config.md step 6), same as
// packages/project-schema/src/logging.ts. tagType is null when tags.json failed. Returns the number
// of errors added.
size_t loggingRules(Checker& c, const json& logging, const std::string& file,
                    const std::map<std::string, std::string>* tagType) {
    static const std::regex kTable(R"(^[a-z][a-z0-9_]{0,47}$)");
    static const std::regex kColumn(R"(^[A-Za-z_][A-Za-z0-9_]{0,62}$)");
    // Reserved column names (lower case): the runtime's own; SQLite rowid hides the real rowid
    // (review C2); PostgreSQL system columns (review I5); the InfluxDB tag source and names
    // starting with _ (contracts/logging-config.md).
    static const std::set<std::string> kReserved{"id",   "time",    "seq",      "ts",    "rowid",
                                                 "oid",  "_rowid_", "xmin",     "xmax",  "cmin",
                                                 "cmax", "ctid",    "tableoid", "source"};
    const size_t before = c.errors.size();
    const json empty = json::array();
    const json& conns = logging.contains("connections") ? logging["connections"] : empty;
    std::set<std::string> connIds;
    for (const auto& k : conns) connIds.insert(k["id"].get<std::string>());

    std::set<std::string> groupIds, tables;
    const json& groups = logging["groups"];
    for (size_t i = 0; i < groups.size(); ++i) {
        const json& g = groups[i];
        const std::string p = "/groups/" + std::to_string(i);
        const std::string id = g["id"];
        if (!groupIds.insert(id).second)
            c.add("E_LOG_DUP_ID", file, p + "/id", "id nhóm '" + id + "' bị trùng");
        std::string table = g.value("table", id);
        if (!g.contains("table")) {  // same default as the runtime: "3pha" → "t_3pha"
            std::replace(table.begin(), table.end(), '-', '_');
            if (!table.empty() && table[0] >= '0' && table[0] <= '9') table = "t_" + table;
        }
        if (!std::regex_match(table, kTable) || table.rfind("mat_", 0) == 0)
            c.add("E_LOG_TABLE", file, p, "Tên bảng '" + table + "' không hợp lệ");
        else if (tables.count(table))
            c.add("E_LOG_TABLE", file, p, "Bảng '" + table + "' trùng với nhóm khác");
        tables.insert(table);
        if (!cyclicModeOk(g))
            c.add("E_LOG_MODE", file, p, "periodMs/minIntervalMs/maxIntervalMs không hợp với mode");
        {
            const auto addRule = [&](const char* code, const std::string& path,
                                     const std::string& msg) { c.add(code, file, path, msg); };
            loggingTriggerRules(g, p, tagType, addRule);
            loggingAggregateRules(g, p, tagType, addRule);
        }
        if (g.contains("destinations")) {
            const json& d = g["destinations"];
            for (size_t k = 0; k < d.size(); ++k)
                if (!connIds.count(d[k].get<std::string>()))
                    c.add("E_LOG_REF_DEST", file, p + "/destinations/" + std::to_string(k),
                          "Không có kết nối '" + d[k].get<std::string>() + "'");
        }
        std::set<std::string> seenTags, columns;
        int strings = 0;
        const json& tags = g["tags"];
        for (size_t j = 0; j < tags.size(); ++j) {
            const json& t = tags[j];
            const std::string tp = p + "/tags/" + std::to_string(j);
            const std::string tagId = t["tagId"];
            // A repeated entry is not checked for E_LOG_COLUMN.
            if (!seenTags.insert(tagId).second) {
                c.add("E_LOG_DUP_TAG", file, tp + "/tagId", "Tag '" + tagId + "' lặp trong nhóm");
                continue;
            }
            if (tagType) {
                const auto it = tagType->find(tagId);
                if (it == tagType->end()) {
                    c.add("E_LOG_REF_TAG", file, tp + "/tagId",
                          "Tag '" + tagId + "' không có trong tags.json");
                } else {
                    if (t.contains("deadband") && !isNumericTagType(it->second))
                        c.add("E_LOG_DEADBAND", file, tp + "/deadband",
                              "deadband chỉ dùng cho Tag số");
                    if (t.contains("maxLength") && it->second != "STRING")
                        c.add("E_LOG_MAXLEN", file, tp + "/maxLength",
                              "maxLength chỉ dùng cho Tag STRING");
                    if (it->second == "STRING") ++strings;
                }
            }
            std::string col = t.value("column", tagId);
            if (!t.contains("column")) std::replace(col.begin(), col.end(), '.', '_');
            const std::string key = lowerAscii(col);
            if (!std::regex_match(col, kColumn) || kReserved.count(key) || key[0] == '_')
                c.add("E_LOG_COLUMN", file, tp,
                      "Tên cột '" + col + "' không hợp lệ hoặc dành riêng");
            else if (columns.count(key))
                c.add("E_LOG_COLUMN", file, tp, "Cột '" + col + "' trùng trong nhóm");
            columns.insert(key);
        }
        if (strings > 64) c.add("E_LOG_LIMIT", file, p + "/tags", "Nhóm có hơn 64 Tag STRING");
    }

    static const char* const kSql[] = {"host", "port", "database", "schema", "user", "timeZone"};
    static const char* const kInflux[] = {"url", "org", "bucket"};
    std::set<std::string> seenConn;
    for (size_t i = 0; i < conns.size(); ++i) {
        const json& k = conns[i];
        const std::string p = "/connections/" + std::to_string(i);
        const std::string id = k["id"], type = k["type"];
        if (!seenConn.insert(id).second)
            c.add("E_LOG_DUP_ID", file, p + "/id", "id kết nối '" + id + "' bị trùng");
        bool ok = true;
        if (type == "influxdb") {
            for (const char* f : kInflux) ok = ok && k.contains(f);
            for (const char* f : kSql) ok = ok && !k.contains(f);
        } else {
            for (const char* f : {"host", "database", "user"}) ok = ok && k.contains(f);
            for (const char* f : kInflux) ok = ok && !k.contains(f);
            if (type == "mysql") ok = ok && !k.contains("schema");
        }
        if (!ok) c.add("E_LOG_CONN", file, p, "Thiếu trường bắt buộc hoặc có trường của loại khác");
        if (k.contains("tls")) {
            const std::string tls = k["tls"], url = k.value("url", "");
            const bool bad =
                (type == "influxdb" && url.rfind("http://", 0) == 0 && tls != "disable") ||
                (type == "influxdb" && url.rfind("https://", 0) == 0 &&
                 (tls == "disable" || tls == "prefer"));
            if (bad)
                c.add("E_LOG_TLS", file, p + "/tls", "tls '" + tls + "' không dùng được ở đây");
        }
    }
    return c.errors.size() - before;
}

// logging.json (feature 003): E_LOG_* rules, then the estimate when the file has none. Shared by
// the 0.1 and 0.2 rules; `tagType` is null when tags.json failed.
void runLoggingChecks(Checker& c, const json& project, const json* logging, bool v06,
                      const std::map<std::string, std::string>* tagType) {
    if (!logging) return;
    const std::string file = project["loggingFile"];
    const size_t logErrors = loggingRules(c, *logging, file, tagType);
    if (logErrors == 0)
        for (size_t i : unverifiedConnections(*logging))
            c.warn("W_LOG_TLS_UNVERIFIED", file, "/connections/" + std::to_string(i),
                   "Kết nối '" + (*logging)["connections"][i]["id"].get<std::string>() +
                       "' không xác thực máy chủ: nên dùng tls verify-full hoặc https (vẫn "
                       "chạy được)");
    if (logErrors == 0 && tagType) {
        const LoggingEstimate e = estimateLogging(*logging, *tagType, v06);
        for (const auto& w : e.warnings)
            c.warn(w.c_str(), file, "",
                   w == "W_LOG_WRITE_BUDGET"
                       ? "Ước tính ghi vượt ngân sách 2 GiB/ngày của eMMC (vẫn chạy được)"
                       : w == "W_LOG_WRITE_EXTREME" ? "Ước tính ghi vượt 8 GiB/ngày, gấp bốn lần "
                                                      "ngân sách eMMC (vẫn chạy được)"
                                                    : "Dung lượng cần để giữ đủ thời hạn lưu vượt "
                                                      "trần 2 GiB (vẫn chạy được)");
    }
}

void runRules(Checker& c, const json& project, const json* tags,
              const std::vector<ScreenInput>& screens, const json* logging,
              const std::string& runtimeVersion) {
    static const std::regex kSupported(R"(^0\.1\.\d+$)");  // no pre-release (audit FR-007)
    const std::string tagFile = project["tagFile"];

    std::vector<std::pair<std::string, std::string>> versions{
        {"project.json", project["schemaVersion"]}};
    if (tags) versions.emplace_back(tagFile, (*tags)["schemaVersion"]);
    if (logging) versions.emplace_back(project["loggingFile"], (*logging)["schemaVersion"]);
    for (const auto& s : screens) {
        versions.emplace_back(s.file, s.screen["schemaVersion"]);
        if (s.hasBindings)
            versions.emplace_back(s.screen["bindingFile"], s.bindings["schemaVersion"]);
    }
    for (const auto& v : versions)
        if (!std::regex_match(v.second, kSupported))
            c.add("E_SCHEMA_VERSION", v.first, "/schemaVersion",
                  "schemaVersion " + v.second + " không hỗ trợ (cần 0.1.x)");
    if (compareSemver(project["minRuntimeVersion"], runtimeVersion) > 0)
        c.add("E_RUNTIME_TOO_OLD", "project.json", "/minRuntimeVersion",
              "Project cần runtime mới hơn " + runtimeVersion);
    // Read as double: an int conversion of 2^32+1 would wrap to 1 (security review M2).
    const double maxClients = project["maxClients"].get<double>();
    if (maxClients < 1 || maxClients > 10)
        c.add("E_MAX_CLIENTS", "project.json", "/maxClients", "maxClients phải trong 1–10");
    bool entryFound = false;
    for (auto& s : project["screens"])
        if (s == project["entryScreen"]) entryFound = true;
    if (!entryFound)
        c.add("E_SCREEN_ID", "project.json", "/entryScreen", "entryScreen không có trong screens");

    std::map<std::string, std::string> tagType;
    if (tags) {
        const json& list = (*tags)["tags"];
        for (size_t i = 0; i < list.size(); ++i) {
            const json& t = list[i];
            const std::string p = "/tags/" + std::to_string(i);
            const std::string id = t["id"], type = t["type"];
            if (tagType.count(id))
                c.add("E_DUP_TAG", tagFile, p + "/id", "Tag '" + id + "' bị trùng");
            else
                tagType[id] = type;
            const bool hasMin = t.contains("min"), hasMax = t.contains("max");
            if ((hasMin || hasMax) && !isNumericTagType(type))
                c.add("E_TAG_RANGE", tagFile, p, "min/max chỉ dùng cho Tag số ('" + id + "')");
            else if (hasMin && hasMax && t["min"].get<double>() >= t["max"].get<double>())
                c.add("E_TAG_RANGE", tagFile, p, "min phải nhỏ hơn max ('" + id + "')");
        }
    }

    runLoggingChecks(c, project, logging, false, tags ? &tagType : nullptr);

    for (const auto& s : screens) {
        const json& screen = s.screen;
        if (screen["id"] != s.id)
            c.add("E_SCREEN_ID", s.file, "/id", "id khác tên file '" + s.id + "'");
        std::set<std::string> uids;
        const json& els = screen["elements"];
        for (size_t i = 0; i < els.size(); ++i) {
            const std::string uid = els[i]["elementUid"];
            if (!uids.insert(uid).second)
                c.add("E_DUP_UID", s.file, "/elements/" + std::to_string(i) + "/elementUid",
                      "elementUid '" + uid + "' bị trùng");
        }
        if (!s.hasBindings) continue;
        const std::string bfile = screen["bindingFile"];
        const json& bs = s.bindings;
        if (bs["screenId"] != screen["id"])
            c.add("E_SCREEN_ID", bfile, "/screenId", "screenId khác screen");
        std::set<std::string> boundUids, bindingIds, boundTags;
        const json& bels = bs["elements"];
        for (const auto& eb : bels)
            for (const auto& b : eb["bindings"])
                boundTags.insert(b["source"]["tagId"].get<std::string>());
        if (boundTags.size() > kMaxLiveSubscribeTags)
            c.add("E_SCREEN_TAGS", bfile, "/elements",
                  "Màn hình '" + s.id + "' gắn " + std::to_string(boundTags.size()) +
                      " Tag khác nhau, tối đa " + std::to_string(kMaxLiveSubscribeTags) +
                      " (một subscribe của giao thức live)");
        for (size_t i = 0; i < bels.size(); ++i) {
            const std::string ep = "/elements/" + std::to_string(i);
            const std::string uid = bels[i]["elementUid"];
            if (!boundUids.insert(uid).second)
                c.add("E_DUP_UID", bfile, ep + "/elementUid", "elementUid lặp trong bindings");
            if (!uids.count(uid))
                c.add("E_REF_UID", bfile, ep + "/elementUid",
                      "elementUid '" + uid + "' không có trong screen");
            const json& list = bels[i]["bindings"];
            for (size_t j = 0; j < list.size(); ++j) {
                const json& b = list[j];
                const std::string bp = ep + "/bindings/" + std::to_string(j);
                const std::string id = b["id"];
                if (!bindingIds.insert(id).second)
                    c.add("E_DUP_BINDING", bfile, bp + "/id", "binding id '" + id + "' bị trùng");
                const std::string target = b["target"];
                bool supported = false;
                for (const char* t : kSupportedTargets)
                    if (target == t) supported = true;
                if (!supported) {
                    c.add("E_TARGET_UNSUPPORTED", bfile, bp + "/target",
                          "Đích '" + target + "' chưa hỗ trợ ở v0");
                    continue;
                }
                const json& tr = b["transform"];
                const std::string kind = tr["kind"];
                if (kind != "direct" && kind != "discreteMap" && kind != "linearScale") {
                    c.add("E_TRANSFORM_UNSUPPORTED", bfile, bp + "/transform/kind",
                          "Transform '" + kind + "' chưa hỗ trợ ở v0");
                    continue;
                }
                if (!tags) continue;
                const std::string tagId = b["source"]["tagId"];
                auto it = tagType.find(tagId);
                if (it == tagType.end()) {
                    c.add("E_REF_TAG", bfile, bp + "/source/tagId",
                          "Tag '" + tagId + "' không tồn tại");
                    continue;
                }
                const std::string& t = it->second;
                if (kind == "linearScale") {
                    if (!isNumericTagType(t))
                        c.add("E_TYPE_MISMATCH", bfile, bp + "/transform",
                              "linearScale cần Tag số");
                    if (tr["inMin"].get<double>() == tr["inMax"].get<double>())
                        c.add("E_SCALE_RANGE", bfile, bp + "/transform", "inMin phải khác inMax");
                } else if (kind == "discreteMap") {
                    bool bad = false;
                    for (auto& cs : tr["cases"])
                        if (!scalarMatches(t, cs["equals"])) bad = true;
                    if (bad)
                        c.add("E_TYPE_MISMATCH", bfile, bp + "/transform/cases",
                              "equals phải cùng kiểu với Tag " + t);
                } else if (!directAccepts(b, t)) {
                    c.add("E_TYPE_MISMATCH", bfile, bp + "/source/tagId",
                          "Tag " + t + " không dùng trực tiếp được cho '" + target + "'");
                }
            }
        }
    }
}

}  // namespace

bool isSafeRelPath(const std::string& p) {
    if (p.empty() || p.size() > 128 || p[0] == '/') return false;
    for (unsigned char ch : p)
        if (ch == '\\' || ch == ':' || ch < 0x20 || ch == 0x7f) return false;
    size_t start = 0;
    while (start <= p.size()) {
        size_t end = p.find('/', start);
        if (end == std::string::npos) end = p.size();
        const std::string seg = p.substr(start, end - start);
        if (seg.empty() || seg == "." || seg == ".." || isWindowsUnsafeSegment(seg)) return false;
        start = end + 1;
    }
    return true;
}

int compareSemver(const std::string& a, const std::string& b) {
    // Major, minor, patch as decimal numbers of any length (the schema allows 64 characters, more
    // than an int holds: SAST T055). The digits of each, without leading zeros ("" is 0). Reading
    // stops at the first character that is not a digit or a dot, as sscanf("%d.%d.%d") did: a
    // missing component is 0 and a pre-release tag is not compared.
    auto parts = [](const std::string& s) {
        std::vector<std::string> v(3);
        size_t i = 0;
        for (std::string& part : v) {
            size_t j = i;
            while (j < s.size() && s[j] >= '0' && s[j] <= '9') ++j;
            const size_t first = s.find_first_not_of('0', i);
            if (first != std::string::npos && first < j) part = s.substr(first, j - first);
            if (j == i || j >= s.size() || s[j] != '.') break;
            i = j + 1;
        }
        return v;
    };
    const auto pa = parts(a), pb = parts(b);
    for (int i = 0; i < 3; ++i) {
        if (pa[i].size() != pb[i].size()) return pa[i].size() < pb[i].size() ? -1 : 1;
        if (pa[i] != pb[i]) return pa[i] < pb[i] ? -1 : 1;
    }
    return 0;
}

namespace {

// The screens of project.json: screen file, binding file, SVG presence (same for 0.1 and 0.2).
void loadScreens(Checker& c, const json& project, std::vector<ScreenInput>& screens) {
    for (auto& idj : project["screens"]) {
        const std::string id = idj;
        ScreenInput s;
        s.id = id;
        s.file = "screens/" + id + ".screen.json";
        if (!c.loadJson(s.file, "screen", s.screen)) continue;
        const std::string bfile = s.screen["bindingFile"];
        if (!isSafeRelPath(bfile))
            c.add("E_PATH", s.file, "/bindingFile", "Đường dẫn không an toàn: '" + bfile + "'");
        else
            s.hasBindings = c.loadJson(bfile, "binding", s.bindings);
        const std::string svg = s.screen["svgFile"];
        if (!isSafeRelPath(svg))
            c.add("E_PATH", s.file, "/svgFile", "Đường dẫn không an toàn: '" + svg + "'");
        else if (!c.exists(svg))
            c.add("E_FILE_MISSING", s.file, "/svgFile", "Không tìm thấy '" + svg + "'");
        screens.push_back(std::move(s));
    }
}

// Which schema set the project asks for: 1.0.x and 1.1.x in project.json -> 10 (the 1.x family
// shares the schemas at the root, feature 012), 0.6.x -> 6, 0.5.x -> 5, 0.4.x -> 4, 0.3.x -> 3,
// 0.2.x -> 2; anything else (including a file that does not parse, 1.2 and later) -> the frozen 0.1
// set, 1.
int schemaSetOf(const std::string& projectDir) {
    std::string text;
    if (readContained(projectDir, "project.json", text) != ReadStatus::Ok) return 1;
    if (text.size() >= 3 && static_cast<unsigned char>(text[0]) == 0xEF &&
        static_cast<unsigned char>(text[1]) == 0xBB && static_cast<unsigned char>(text[2]) == 0xBF)
        text.erase(0, 3);
    if (jsonNestingDepth(text.data(), text.size()) > kMaxProjectJsonDepth) return 1;
    const json j = json::parse(text, nullptr, false);
    if (j.is_discarded() || !j.is_object() || !j.contains("schemaVersion") ||
        !j["schemaVersion"].is_string())
        return 1;
    const std::string v = j["schemaVersion"];
    for (const int set : {11, 10, 6, 5, 4, 3, 2}) {
        const std::string prefix =
            set >= 10 ? "1." + std::to_string(set - 10) + "." : "0." + std::to_string(set) + ".";
        if (v.size() <= prefix.size() || v.compare(0, prefix.size(), prefix) != 0) continue;
        bool digits = true;
        for (size_t i = prefix.size(); i < v.size(); ++i)
            if (v[i] < '0' || v[i] > '9') digits = false;
        if (digits) return set == 11 ? 10 : set;
    }
    return 1;
}

// The catalog of widgets, read once per schemas directory and kept (feature 007).
std::shared_ptr<const WidgetCatalog> catalogOf(const std::string& schemasDir, std::string& error) {
    static std::mutex mu;
    static std::map<std::string, std::shared_ptr<const WidgetCatalog>> cache;
    std::lock_guard<std::mutex> l(mu);
    const auto it = cache.find(schemasDir);
    if (it != cache.end()) return it->second;
    std::unique_ptr<WidgetCatalog> c = WidgetCatalog::loadFromDir(schemasDir, error);
    if (!c) return nullptr;
    std::shared_ptr<const WidgetCatalog> shared(std::move(c));
    cache[schemasDir] = shared;
    return shared;
}

ProjectValidation validate01(const std::string& projectDir, const std::string& schemasDir,
                             const std::string& runtimeVersion) {
    ProjectValidation r;
    Schemas schemas(schemasDir, 1);
    if (!schemas.error.empty()) {
        r.errors.push_back({"E_SCHEMA", "", "", "Không nạp được schema: " + schemas.error});
        return r;
    }
    Checker c(projectDir, schemas);
    json project;
    const bool projectOk = c.loadJson("project.json", "project", project);

    json tags;
    bool tagsOk = false;
    json logging;
    bool loggingOk = false;
    std::vector<ScreenInput> screens;
    if (projectOk) {
        const std::string tagFile = project["tagFile"];
        if (!isSafeRelPath(tagFile))
            c.add("E_PATH", "project.json", "/tagFile",
                  "Đường dẫn không an toàn: '" + tagFile + "'");
        else
            tagsOk = c.loadJson(tagFile, "tag", tags);

        if (project.contains("loggingFile")) {  // feature 003, same order as the TS validator
            const std::string loggingFile = project["loggingFile"];
            if (!isSafeRelPath(loggingFile))
                c.add("E_PATH", "project.json", "/loggingFile",
                      "Đường dẫn không an toàn: '" + loggingFile + "'");
            else
                loggingOk = c.loadJson(loggingFile, "logging", logging);
        }

        loadScreens(c, project, screens);
        runRules(c, project, tagsOk ? &tags : nullptr, screens, loggingOk ? &logging : nullptr,
                 runtimeVersion);
    }

    r.errors = std::move(c.errors);
    r.warnings = std::move(c.warnings);
    r.valid = r.errors.empty();
    if (r.valid) {
        LoadedProject lp;
        lp.project = std::move(project);
        lp.tags = std::move(tags);
        if (loggingOk) lp.logging = std::move(logging);
        for (auto& s : screens)
            lp.screens.push_back({s.id, std::move(s.screen), std::move(s.bindings)});
        r.project = std::move(lp);
    }
    return r;
}

// Format 0.2 (contracts/project-format-0.2.md): the 0.2 schemas, then the rules of rules_02.cpp.
ProjectValidation validate02(const std::string& projectDir, const std::string& schemasDir,
                             const std::string& runtimeVersion, const SerialPolicy* serial) {
    ProjectValidation r;
    Schemas schemas(schemasDir, 2);
    if (!schemas.error.empty()) {
        r.errors.push_back({"E_SCHEMA", "", "", "Không nạp được schema: " + schemas.error});
        return r;
    }
    Checker c(projectDir, schemas);
    json project;
    const bool projectOk = c.loadJson("project.json", "project", project);

    json tags, connections, logging;
    bool tagsOk = false, connectionsOk = false, loggingOk = false;
    Rules02Input in;
    std::vector<ScreenInput> screens;
    if (projectOk) {
        auto unsafe = [&](const std::string& file, const std::string& ptr, const std::string& p) {
            c.add("E_PATH", file, ptr, "Đường dẫn không an toàn: '" + p + "'");
        };
        const std::string tagFile = project["tagFile"];
        if (!isSafeRelPath(tagFile))
            unsafe("project.json", "/tagFile", tagFile);
        else
            tagsOk = c.loadJson(tagFile, "tag", tags, true);
        if (project.contains("connectionFile")) {
            const std::string f = project["connectionFile"];
            if (!isSafeRelPath(f))
                unsafe("project.json", "/connectionFile", f);
            else
                connectionsOk = c.loadJson(f, "connections", connections);
        }
        if (project.contains("loggingFile")) {
            const std::string f = project["loggingFile"];
            if (!isSafeRelPath(f))
                unsafe("project.json", "/loggingFile", f);
            else
                loggingOk = c.loadJson(f, "logging", logging);
        }
        // A name repeated (ignoring case) is loaded once: the rule E_DUP_ID reports the repeat.
        std::set<std::string> seenTables;
        if (project.contains("valueTables"))
            for (const auto& nj : project["valueTables"]) {
                const std::string name = nj;
                if (!seenTables.insert(lowerAscii(name)).second) continue;
                const std::string file = "value-tables/" + name + ".json";
                json doc;
                if (c.loadJson(file, "valueTable", doc))
                    in.valueTables[name] = {file, std::move(doc)};
            }
        std::set<std::string> seenWatch;
        if (project.contains("watchTables"))
            for (const auto& nj : project["watchTables"]) {
                const std::string id = nj;
                if (!seenWatch.insert(id).second) continue;
                const std::string file = "watch-tables/" + id + ".json";
                json doc;
                if (c.loadJson(file, "watchTable", doc))
                    in.watchTables[id] = {file, std::move(doc)};
            }
        loadScreens(c, project, screens);

        in.project = &project;
        in.tags = tagsOk ? &tags : nullptr;
        in.connections = connectionsOk ? &connections : nullptr;
        in.loggingDoc = loggingOk ? &logging : nullptr;
        for (auto& s : screens)
            in.screens.push_back({s.id, s.file, s.screen, s.hasBindings, s.bindings});
        in.runtimeVersion = runtimeVersion;
        in.serial = serial;
        if (loggingOk)
            in.logging = [&](const std::map<std::string, std::string>* types) {
                runLoggingChecks(c, project, &logging, false, types);
            };
        std::vector<ProjectIssue> errs, warns;
        runRules02(in, errs, warns);
        for (auto& e : errs) c.errors.push_back(std::move(e));
        for (auto& w : warns) c.warnings.push_back(std::move(w));
    }

    r.errors = std::move(c.errors);
    r.warnings = std::move(c.warnings);
    r.valid = r.errors.empty();
    if (r.valid) {
        LoadedProject lp;
        lp.project = std::move(project);
        lp.tags = std::move(tags);
        if (connectionsOk) lp.connections = std::move(connections);
        if (loggingOk) lp.logging = std::move(logging);
        for (auto& [name, d] : in.valueTables) lp.valueTables[name] = std::move(d.doc);
        for (auto& [id, d] : in.watchTables) lp.watchTables[id] = std::move(d.doc);
        for (auto& s : screens)
            lp.screens.push_back({s.id, std::move(s.screen), std::move(s.bindings)});
        r.project = std::move(lp);
    }
    return r;
}

// Formats 0.3 to 0.6 and 1.0 (`set` 3, 4, 5, 6, 10; contracts/project-format-0.3.md, 0.5.md, 010,
// 011 project-format-1.0.md): the schemas of the set, then the rules of rules_02.cpp (Tags,
// connections, tables, logging) and rules_03.cpp (screens, widgets, navigation); 0.5 and later add
// alarm_rules.cpp (alarms.json, alarm-classes.json); 0.6 adds reports.json; 1.0 adds logic.json
// (schema only, the E_LOGIC_* rules are T135) and templates, instances, faceplates (rules_10.cpp).
ProjectValidation validate03(const std::string& projectDir, const std::string& schemasDir,
                             const std::string& runtimeVersion, const SerialPolicy* serial,
                             int set) {
    const bool v06 = set >= 6;  // 1.0 keeps everything of 0.6
    const bool v10 = set == 10;
    ProjectValidation r;
    Schemas schemas(schemasDir, set);
    if (!schemas.error.empty()) {
        r.errors.push_back({"E_SCHEMA", "", "", "Không nạp được schema: " + schemas.error});
        return r;
    }
    std::string catalogError;
    const std::shared_ptr<const WidgetCatalog> catalog = catalogOf(schemasDir, catalogError);
    if (!catalog) {
        r.errors.push_back({"E_SCHEMA", "", "", "Không nạp được danh mục widget: " + catalogError});
        return r;
    }
    Checker c(projectDir, schemas);
    json project;
    const bool projectOk = c.loadJson("project.json", "project", project);

    json tags, connections, logging, reports, alarmsDoc, alarmClassesDoc;
    bool tagsOk = false, connectionsOk = false, loggingOk = false, reportsOk = false;
    bool alarmsOk = false, alarmClassesOk = false;
    json logicDoc;
    bool logicOk = false;
    std::vector<std::pair<std::string, json>> templateDocs;  // file, doc (null: failed)
    std::vector<bool> templateOk;
    Rules03Input in;
    if (projectOk) {
        auto unsafe = [&](const std::string& file, const std::string& ptr, const std::string& p) {
            c.add("E_PATH", file, ptr, "Đường dẫn không an toàn: '" + p + "'");
        };
        const std::string tagFile = project["tagFile"];
        if (!isSafeRelPath(tagFile))
            unsafe("project.json", "/tagFile", tagFile);
        else
            tagsOk = c.loadJson(tagFile, "tag", tags, true);
        if (project.contains("connectionFile")) {
            const std::string f = project["connectionFile"];
            if (!isSafeRelPath(f))
                unsafe("project.json", "/connectionFile", f);
            else
                connectionsOk = c.loadJson(f, "connections", connections);
        }
        if (project.contains("loggingFile")) {
            const std::string f = project["loggingFile"];
            if (!isSafeRelPath(f))
                unsafe("project.json", "/loggingFile", f);
            else
                loggingOk = c.loadJson(f, "logging", logging);
        }
        // Format 0.5 and later: the two alarm files (only read here; the rules are alarm_rules.cpp)
        if (set >= 5) {
            if (project.contains("alarmFile")) {
                const std::string f = project["alarmFile"];
                if (!isSafeRelPath(f))
                    unsafe("project.json", "/alarmFile", f);
                else
                    alarmsOk = c.loadJson(f, "alarms", alarmsDoc);
            }
            if (project.contains("alarmClassFile")) {
                const std::string f = project["alarmClassFile"];
                if (!isSafeRelPath(f))
                    unsafe("project.json", "/alarmClassFile", f);
                else
                    alarmClassesOk = c.loadJson(f, "alarmClasses", alarmClassesDoc);
            }
        }
        if (v06 && project.contains("reportsFile")) {  // feature 010, after logging like TS
            const std::string f = project["reportsFile"];
            if (!isSafeRelPath(f))
                unsafe("project.json", "/reportsFile", f);
            else
                reportsOk = c.loadJson(f, "reports", reports);
        }
        // Format 1.0 (feature 011): logic.json (schema only) and the template files, like TS
        if (v10) {
            if (project.contains("logic")) {
                const std::string f = project["logic"];
                if (!isSafeRelPath(f))
                    unsafe("project.json", "/logic", f);
                else
                    logicOk = c.loadJson(f, "logic", logicDoc);
            }
            if (project.contains("templates"))
                for (size_t i = 0; i < project["templates"].size(); ++i) {
                    const std::string f = project["templates"][i];
                    if (!isSafeRelPath(f)) {
                        unsafe("project.json", "/templates/" + std::to_string(i), f);
                        continue;
                    }
                    json doc;
                    const bool ok = c.loadJson(f, "template", doc);
                    templateDocs.emplace_back(f, ok ? std::move(doc) : json());
                    templateOk.push_back(ok);
                }
        }
        std::set<std::string> seenTables;
        if (project.contains("valueTables"))
            for (const auto& nj : project["valueTables"]) {
                const std::string name = nj;
                if (!seenTables.insert(lowerAscii(name)).second) continue;
                const std::string file = "value-tables/" + name + ".json";
                json doc;
                if (c.loadJson(file, "valueTable", doc))
                    in.valueTables[name] = {file, std::move(doc)};
            }
        std::set<std::string> seenWatch;
        if (project.contains("watchTables"))
            for (const auto& nj : project["watchTables"]) {
                const std::string id = nj;
                if (!seenWatch.insert(id).second) continue;
                const std::string file = "watch-tables/" + id + ".json";
                json doc;
                if (c.loadJson(file, "watchTable", doc))
                    in.watchTables[id] = {file, std::move(doc)};
            }
        // The screens: each file once; every binding file once (two items sharing one is a rule's
        // error, not read again).
        std::map<std::string, std::pair<bool, json>> bindingCache;
        std::set<std::string> loaded;
        for (const auto& idj : project["screens"]) {
            const std::string id = idj;
            if (!loaded.insert(id).second) continue;
            Rules03Input::ScreenDoc sd;
            sd.id = id;
            sd.file = "screens/" + id + ".screen.json";
            if (!c.loadJson(sd.file, "screen", sd.screen)) continue;
            const json& items = sd.screen["items"];
            for (size_t i = 0; i < items.size(); ++i) {
                const json& item = items[i];
                if (item["type"] != "svg") continue;
                Rules03Input::SvgData data;
                const std::string bfile = item["bindingFile"];
                const std::string ip = "/items/" + std::to_string(i);
                if (!isSafeRelPath(bfile)) {
                    unsafe(sd.file, ip + "/bindingFile", bfile);
                } else if (auto bc = bindingCache.find(bfile); bc != bindingCache.end()) {
                    data.hasBindings = bc->second.first;
                    data.bindings = bc->second.second;
                } else {
                    json b;
                    const bool ok = c.loadJson(bfile, "binding", b);
                    bindingCache[bfile] = {ok, b};
                    data.hasBindings = ok;
                    data.bindings = std::move(b);
                }
                const std::string svg = item["svgFile"];
                if (!isSafeRelPath(svg))
                    unsafe(sd.file, ip + "/svgFile", svg);
                else if (!c.exists(svg))
                    c.add("E_FILE_MISSING", sd.file, ip + "/svgFile",
                          "Không tìm thấy '" + svg + "'");
                sd.svg[i] = std::move(data);
            }
            in.screens.push_back(std::move(sd));
        }

        in.project = &project;
        in.tags = tagsOk ? &tags : nullptr;
        in.connections = connectionsOk ? &connections : nullptr;
        in.loggingDoc = loggingOk ? &logging : nullptr;
        in.runtimeVersion = runtimeVersion;
        in.serial = serial;
        in.catalog = catalog.get();
        in.schema = v10 ? "1.0" : "0." + std::to_string(set);
        in.reports = reportsOk ? &reports : nullptr;
        if (loggingOk)
            in.logging = [&](const std::map<std::string, std::string>* types) {
                runLoggingChecks(c, project, &logging, v06, types);
            };
        std::vector<ProjectIssue> errs, warns;
        std::set<std::string> alarmAreaIds, alarmClassIds;
        if (set >= 5) {
            alarmClassIds = {"critical", "major", "minor", "advisory"};
            const auto collect = [](bool ok, const json& doc, const char* key,
                                    std::set<std::string>& out) {
                if (!ok || !doc.is_object() || !doc.contains(key) || !doc[key].is_array()) return;
                for (const auto& x : doc[key])
                    if (x.is_object() && x.contains("id") && x["id"].is_string())
                        out.insert(x["id"].get<std::string>());
            };
            collect(alarmsOk, alarmsDoc, "areas", alarmAreaIds);
            collect(alarmClassesOk, alarmClassesDoc, "classes", alarmClassIds);
            in.alarmAreas = &alarmAreaIds;
            in.alarmClasses = &alarmClassIds;
        }
        Rules10Input in10;
        in10.project = &project;
        for (size_t i = 0; i < templateDocs.size(); ++i)
            in10.templates.push_back(
                {templateDocs[i].first, templateOk[i] ? &templateDocs[i].second : nullptr});
        if (project.contains("logic")) in10.logicFile = project["logic"].get<std::string>();
        in10.logic = logicOk ? &logicDoc : nullptr;
        if (project.contains("logic")) {
            const auto sz = c.bytes.find(project["logic"].get<std::string>());
            if (sz != c.bytes.end()) in10.logicBytes = sz->second;
        }
        in10.catalog = catalog.get();
        Rules10 rules10(in10, in.screens);
        std::vector<ProjectIssue> errs10;
        if (v10) rules10.before(in, errs10);
        runRules03(in, errs, warns);
        if (set >= 5) {
            AlarmRulesInput ain;
            ain.project = &project;
            ain.alarmsDoc = alarmsOk ? &alarmsDoc : nullptr;
            ain.alarmClassesDoc = alarmClassesOk ? &alarmClassesDoc : nullptr;
            if (project.contains("alarmFile")) {
                const auto sz = c.bytes.find(project["alarmFile"].get<std::string>());
                if (sz != c.bytes.end()) ain.alarmsBytes = sz->second;
            }
            ain.tags =
                tagsOk ? (rules10.tagsWithLogic() ? rules10.tagsWithLogic() : &tags) : nullptr;
            ain.connections = connectionsOk ? &connections : nullptr;
            ain.connectionsFailed = project.contains("connectionFile") && !connectionsOk;
            runAlarmRules(ain, errs, warns);
        }
        if (v10) {
            rules10.after(errs, warns);
            for (auto& e : errs10) errs.push_back(std::move(e));
            // the 1.x family: grid layout, theme (feature 012, rules_11)
            runRules11(project, in.screens, catalog.get(), errs, warns);
        }
        for (auto& e : errs) c.errors.push_back(std::move(e));
        for (auto& w : warns) c.warnings.push_back(std::move(w));
    }

    r.errors = std::move(c.errors);
    r.warnings = std::move(c.warnings);
    r.valid = r.errors.empty();
    if (r.valid) {
        LoadedProject lp;
        lp.project = std::move(project);
        lp.tags = std::move(tags);
        if (connectionsOk) lp.connections = std::move(connections);
        if (loggingOk) lp.logging = std::move(logging);
        if (alarmsOk) lp.alarms = std::move(alarmsDoc);
        if (alarmClassesOk) lp.alarmClasses = std::move(alarmClassesDoc);
        if (reportsOk) lp.reports = std::move(reports);
        if (logicOk) lp.logic = std::move(logicDoc);
        for (auto& [name, d] : in.valueTables) lp.valueTables[name] = std::move(d.doc);
        for (auto& [id, d] : in.watchTables) lp.watchTables[id] = std::move(d.doc);
        for (auto& sd : in.screens) {
            LoadedProject::Screen s;
            s.id = sd.id;
            const json& items = sd.screen["items"];
            for (auto& [i, data] : sd.svg)
                if (data.hasBindings)
                    s.itemBindings[items[i]["id"].get<std::string>()] = std::move(data.bindings);
            s.screen = std::move(sd.screen);
            lp.screens.push_back(std::move(s));
        }
        r.project = std::move(lp);
    }
    return r;
}

}  // namespace

ProjectValidation validateProject(const std::string& projectDir, const std::string& schemasDir,
                                  const std::string& runtimeVersion, const SerialPolicy* serial) {
    switch (const int set = schemaSetOf(projectDir)) {
        case 3:
        case 4:
        case 5:
        case 6:
        case 10:
            return validate03(projectDir, schemasDir, runtimeVersion, serial, set);
        case 2:
            return validate02(projectDir, schemasDir, runtimeVersion, serial);
        default:
            return validate01(projectDir, schemasDir, runtimeVersion);
    }
}

namespace {
bool versionIs(const json& project, const char* prefix) {
    if (!project.is_object() || !project.contains("schemaVersion") ||
        !project["schemaVersion"].is_string())
        return false;
    const std::string v = project["schemaVersion"];
    const size_t n = std::string(prefix).size();
    return v.size() > n && v.compare(0, n, prefix) == 0;
}
}  // namespace

bool LoadedProject::is02() const { return versionIs(project, "0.2.") || is03(); }

bool LoadedProject::is03() const {
    return versionIs(project, "0.3.") || versionIs(project, "0.4.") || is05();
}

bool LoadedProject::is05() const { return versionIs(project, "0.5.") || is06(); }

bool LoadedProject::is06() const { return versionIs(project, "0.6.") || is10(); }

// 1.1 (feature 012) keeps everything of 1.0
bool LoadedProject::is10() const {
    return versionIs(project, "1.0.") || versionIs(project, "1.1.");
}

std::set<std::string> LoadedProject::allowlist() const {
    std::set<std::string> out;
    if (is03()) {
        // the screen files (the page loads one at a time), the SVG and the binding files of the svg
        // items
        for (const auto& id : project.at("screens"))
            out.insert("screens/" + id.get<std::string>() + ".screen.json");
        for (const auto& s : screens)
            for (const auto& item : s.screen["items"])
                if (item["type"] == "svg") {
                    out.insert(item["svgFile"].get<std::string>());
                    out.insert(item["bindingFile"].get<std::string>());
                }
        // report templates (feature 010): the report page loads them like the screen files
        if (project.contains("reportsFile"))
            out.insert(project.at("reportsFile").get<std::string>());
        return out;
    }
    for (const auto& s : screens) out.insert(s.screen["svgFile"].get<std::string>());
    return out;
}

// std::set<std::string> orders by unsigned bytes (char_traits<char>), the UTF-8 order of
// compareUtf8 in packages/project-schema.
std::vector<std::string> LoadedProject::files() const {
    std::set<std::string> out{"project.json", project.at("tagFile").get<std::string>()};
    if (project.contains("loggingFile")) out.insert(project.at("loggingFile").get<std::string>());
    // Format 0.6 (feature 010): report templates
    if (project.contains("reportsFile")) out.insert(project.at("reportsFile").get<std::string>());
    // Format 0.2 (contract project-format-0.2 §1)
    if (project.contains("connectionFile"))
        out.insert(project.at("connectionFile").get<std::string>());
    if (project.contains("valueTables"))
        for (const auto& n : project.at("valueTables"))
            out.insert("value-tables/" + n.get<std::string>() + ".json");
    if (project.contains("watchTables"))
        for (const auto& n : project.at("watchTables"))
            out.insert("watch-tables/" + n.get<std::string>() + ".json");
    // Format 0.5 (contract project-format-0.5 §1)
    if (project.contains("alarmFile")) out.insert(project.at("alarmFile").get<std::string>());
    if (project.contains("alarmClassFile"))
        out.insert(project.at("alarmClassFile").get<std::string>());
    // Format 1.0 (contracts/project-format-1.0.md §2, §6): logic.json and the template files
    if (project.contains("logic")) out.insert(project.at("logic").get<std::string>());
    if (project.contains("templates"))
        for (const auto& t : project.at("templates")) out.insert(t.get<std::string>());
    for (const auto& id : project.at("screens"))
        out.insert("screens/" + id.get<std::string>() + ".screen.json");
    if (is03()) {
        for (const auto& s : screens)
            for (const auto& item : s.screen["items"])
                if (item["type"] == "svg") {
                    out.insert(item["bindingFile"].get<std::string>());
                    out.insert(item["svgFile"].get<std::string>());
                }
        return {out.begin(), out.end()};
    }
    for (const auto& s : screens) {
        out.insert(s.screen.at("bindingFile").get<std::string>());
        out.insert(s.screen.at("svgFile").get<std::string>());
    }
    return {out.begin(), out.end()};
}

namespace {

// Format 0.3, GET /api/v1/projects/active (device-api-1.2 §4): the project, the Tags, the value
// tables that Tags, widgets and bindings use, the channels by id, name and kind, the navigation and
// the list of screens; the screens themselves are loaded one at a time from /project/.
std::string activeJson03(const LoadedProject& p) {
    json j = {{"project", p.project}, {"tags", p.tags}};
    std::set<std::string> names;
    for (const auto& t : p.tags["tags"])
        if (t.contains("valueTable")) names.insert(t["valueTable"].get<std::string>());
    std::map<std::string, std::string> tagTable;
    for (const auto& t : p.tags["tags"])
        if (t.contains("valueTable"))
            tagTable[t["id"].get<std::string>()] = t["valueTable"].get<std::string>();
    json screensList = json::array();
    for (const auto& id : p.project["screens"]) {
        for (const auto& s : p.screens) {
            if (s.id != id.get<std::string>()) continue;
            screensList.push_back({{"id", s.id},
                                   {"name", s.screen.value("name", s.id)},
                                   {"kind", s.screen.value("kind", "screen")},
                                   {"file", "screens/" + s.id + ".screen.json"}});
            for (const auto& item : s.screen["items"])
                if (item["type"] == "widget" && item.contains("props") &&
                    item["props"].contains("table") && item["props"]["table"].is_string())
                    names.insert(item["props"]["table"].get<std::string>());
            for (const auto& [itemId, b] : s.itemBindings)
                for (const auto& eb : b["elements"])
                    for (const auto& bd : eb.value("bindings", json::array())) {
                        const json& tr = bd["transform"];
                        if (tr["kind"] != "valueTable") continue;
                        if (tr.contains("table"))
                            names.insert(tr["table"].get<std::string>());
                        else if (auto it = tagTable.find(bd["source"]["tagId"].get<std::string>());
                                 it != tagTable.end())
                            names.insert(it->second);
                    }
        }
    }
    json tables = json::object();
    for (const auto& n : names) {
        const auto vt = p.valueTables.find(n);
        if (vt != p.valueTables.end()) tables[n] = vt->second;
    }
    j["valueTables"] = tables;
    json chans = json::array();
    if (p.connections.is_object())
        for (const auto& ch : p.connections["channels"])
            chans.push_back({{"id", ch["id"]}, {"name", ch["name"]}, {"kind", ch["kind"]}});
    j["connections"] = chans;
    if (p.project.contains("navigation")) j["navigation"] = p.project["navigation"];
    j["screens"] = screensList;
    return j.dump();
}

}  // namespace

std::string LoadedProject::activeJson() const {
    if (is03()) return activeJson03(*this);
    json j = {{"project", project}, {"tags", tags}, {"screens", json::object()}};
    for (const auto& s : screens)
        j["screens"][s.id] = {{"screen", s.screen}, {"bindings", s.bindings}};
    if (is02()) {
        // contract project-format-0.2 §11: only the value tables that bindings use (directly or
        // through the Tag's valueTable); only the ids, names and kinds of the connections.
        std::map<std::string, std::string> tagTable;
        for (const auto& t : tags["tags"])
            if (t.contains("valueTable"))
                tagTable[t["id"].get<std::string>()] = t["valueTable"].get<std::string>();
        json used = json::object();
        for (const auto& s : screens)
            for (const auto& eb : s.bindings["elements"])
                for (const auto& b : eb["bindings"]) {
                    const json& tr = b["transform"];
                    if (tr["kind"] != "valueTable") continue;
                    std::string name;
                    if (tr.contains("table"))
                        name = tr["table"].get<std::string>();
                    else if (auto it = tagTable.find(b["source"]["tagId"].get<std::string>());
                             it != tagTable.end())
                        name = it->second;
                    auto vt = valueTables.find(name);
                    if (vt != valueTables.end()) used[name] = vt->second;
                }
        j["valueTables"] = used;
        if (!connections.is_null()) {
            json chans = json::array();
            for (const auto& ch : connections["channels"]) {
                json devs = json::array();
                for (const auto& d : ch["devices"])
                    devs.push_back({{"id", d["id"]}, {"name", d["name"]}});
                chans.push_back({{"id", ch["id"]},
                                 {"name", ch["name"]},
                                 {"kind", ch["kind"]},
                                 {"devices", devs}});
            }
            j["connections"] = {{"channels", chans}};
        } else {
            j["connections"] = {{"channels", json::array()}};
        }
    }
    return j.dump();
}

std::string LoadedProject::helloJson() const {
    return json{{"projectId", project["projectId"]}, {"projectVersion", project["projectVersion"]}}
        .dump();
}

json issuesJson(const std::vector<ProjectIssue>& issues) {
    json a = json::array();
    for (const auto& e : issues) {
        json item = {{"code", e.code}, {"file", e.file}, {"path", e.path}, {"message", e.message}};
        if (e.spanStart >= 0) item["span"] = json::array({e.spanStart, e.spanEnd});
        a.push_back(std::move(item));
    }
    return a;
}

std::string resultJson(const ProjectValidation& r) {
    return json{
        {"valid", r.valid}, {"errors", issuesJson(r.errors)}, {"warnings", issuesJson(r.warnings)}}
        .dump(2);
}

}  // namespace mat
