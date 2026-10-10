#include "core/project-manager/project_validator.hpp"

#include <sys/stat.h>

#include <climits>
#include <cstdlib>
#include <fstream>
#include <map>
#include <memory>
#include <regex>
#include <sstream>

#include "core/common/json_limits.hpp"
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

ReadStatus readContained(const std::string& root, const std::string& rel, std::string& out) {
    char rootReal[PATH_MAX];
    char fileReal[PATH_MAX];
    if (!realpath(root.c_str(), rootReal)) return ReadStatus::Missing;
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

    explicit Schemas(const std::string& dir) {
        for (const char* kind : {"project", "tag", "screen", "binding"}) {
            std::ifstream f(dir + "/" + kind + ".schema.json");
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

class Checker {
   public:
    Checker(std::string root, const Schemas& schemas) : root_(std::move(root)), schemas_(schemas) {}

    std::vector<ProjectIssue> errors;

    void add(const char* code, const std::string& file, const std::string& path,
             const std::string& message) {
        errors.push_back({code, file, path, message});
    }

    // Read + parse + schema. Returns true and fills `out` when the document is schema-valid.
    bool loadJson(const std::string& file, const char* kind, json& out) {
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
        if (auto p = findLongString(out, "", kMaxProjectStringBytes)) {
            add("E_SCHEMA", file, *p, "Chuỗi quá dài");
            return false;
        }
        valijson::Validator validator;
        valijson::ValidationResults results;
        valijson::adapters::NlohmannJsonAdapter target(out);
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

void runRules(Checker& c, const json& project, const json* tags,
              const std::vector<ScreenInput>& screens) {
    static const std::regex kSupported(R"(^0\.1\.\d+(-[0-9A-Za-z.-]+)?$)");
    const std::string tagFile = project["tagFile"];

    std::vector<std::pair<std::string, std::string>> versions{
        {"project.json", project["schemaVersion"]}};
    if (tags) versions.emplace_back(tagFile, (*tags)["schemaVersion"]);
    for (const auto& s : screens) {
        versions.emplace_back(s.file, s.screen["schemaVersion"]);
        if (s.hasBindings)
            versions.emplace_back(s.screen["bindingFile"], s.bindings["schemaVersion"]);
    }
    for (const auto& v : versions)
        if (!std::regex_match(v.second, kSupported))
            c.add("E_SCHEMA_VERSION", v.first, "/schemaVersion",
                  "schemaVersion " + v.second + " không hỗ trợ (cần 0.1.x)");
    if (compareSemver(project["minRuntimeVersion"], kRuntimeVersion) > 0)
        c.add("E_RUNTIME_TOO_OLD", "project.json", "/minRuntimeVersion",
              "Project cần runtime mới hơn " + std::string(kRuntimeVersion));
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
        std::set<std::string> boundUids, bindingIds;
        const json& bels = bs["elements"];
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
        if (seg.empty() || seg == "." || seg == "..") return false;
        start = end + 1;
    }
    return true;
}

int compareSemver(const std::string& a, const std::string& b) {
    auto parts = [](const std::string& s) {
        int v[3] = {0, 0, 0};
        std::sscanf(s.c_str(), "%d.%d.%d", &v[0], &v[1], &v[2]);
        return std::vector<int>{v[0], v[1], v[2]};
    };
    auto pa = parts(a), pb = parts(b);
    for (int i = 0; i < 3; ++i)
        if (pa[i] != pb[i]) return pa[i] < pb[i] ? -1 : 1;
    return 0;
}

ProjectValidation validateProject(const std::string& projectDir, const std::string& schemasDir) {
    ProjectValidation r;
    Schemas schemas(schemasDir);
    if (!schemas.error.empty()) {
        r.errors.push_back({"E_SCHEMA", "", "", "Không nạp được schema: " + schemas.error});
        return r;
    }
    Checker c(projectDir, schemas);
    json project;
    const bool projectOk = c.loadJson("project.json", "project", project);

    json tags;
    bool tagsOk = false;
    std::vector<ScreenInput> screens;
    if (projectOk) {
        const std::string tagFile = project["tagFile"];
        if (!isSafeRelPath(tagFile))
            c.add("E_PATH", "project.json", "/tagFile",
                  "Đường dẫn không an toàn: '" + tagFile + "'");
        else
            tagsOk = c.loadJson(tagFile, "tag", tags);

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
        runRules(c, project, tagsOk ? &tags : nullptr, screens);
    }

    r.errors = std::move(c.errors);
    r.valid = r.errors.empty();
    if (r.valid) {
        LoadedProject lp;
        lp.project = std::move(project);
        lp.tags = std::move(tags);
        for (auto& s : screens)
            lp.screens.push_back({s.id, std::move(s.screen), std::move(s.bindings)});
        r.project = std::move(lp);
    }
    return r;
}

std::set<std::string> LoadedProject::allowlist() const {
    std::set<std::string> out;
    for (const auto& s : screens) out.insert(s.screen["svgFile"].get<std::string>());
    return out;
}

std::string LoadedProject::activeJson() const {
    json j = {{"project", project}, {"tags", tags}, {"screens", json::object()}};
    for (const auto& s : screens)
        j["screens"][s.id] = {{"screen", s.screen}, {"bindings", s.bindings}};
    return j.dump();
}

std::string LoadedProject::helloJson() const {
    return json{{"projectId", project["projectId"]}, {"projectVersion", project["projectVersion"]}}
        .dump();
}

json issuesJson(const std::vector<ProjectIssue>& issues) {
    json a = json::array();
    for (const auto& e : issues)
        a.push_back({{"code", e.code}, {"file", e.file}, {"path", e.path}, {"message", e.message}});
    return a;
}

std::string resultJson(const ProjectValidation& r) {
    return json{{"valid", r.valid}, {"errors", issuesJson(r.errors)}, {"warnings", json::array()}}
        .dump(2);
}

}  // namespace mat
