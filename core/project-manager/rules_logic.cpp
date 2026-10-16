#include "core/project-manager/rules_logic.hpp"

#include <cmath>
#include <cstdio>
#include <map>
#include <regex>
#include <set>

#include "core/logic/order.hpp"

namespace mat {

using logic::LogicEnv;
using logic::LogicOutput;
using logic::TagInfo;
using logic::TagInfoMap;
using nlohmann::json;

namespace {

constexpr size_t kMaxFileBytes = 512 * 1024;
constexpr double kMaxMs = 86400000;
constexpr double kRetainIoLimit = 100.0 * 1024 * 1024;

const std::map<std::string, size_t>& limits() {
    static const std::map<std::string, size_t> k = {
        {"rules", 200},   {"timers", 100},   {"counters", 100}, {"totalizers", 50},
        {"runhours", 50}, {"schedules", 50}, {"writes", 100}};
    return k;
}
constexpr size_t kActionsPerRule = 8, kWindows = 16, kExceptions = 64;

const char* typeName(TagType t) {
    switch (t) {
        case TagType::BOOL:
            return "BOOL";
        case TagType::INT16:
            return "INT16";
        case TagType::UINT16:
            return "UINT16";
        case TagType::INT32:
            return "INT32";
        case TagType::UINT32:
            return "UINT32";
        case TagType::INT64:
            return "INT64";
        case TagType::UINT64:
            return "UINT64";
        case TagType::FLOAT32:
            return "FLOAT32";
        case TagType::FLOAT64:
            return "FLOAT64";
        case TagType::STRING:
            return "STRING";
    }
    return "";
}

bool numericType(TagType t) { return t != TagType::BOOL && t != TagType::STRING; }

// typeof v === 'number' && finite / && Number.isInteger
bool isNum(const json* v) { return v && v->is_number() && std::isfinite(v->get<double>()); }
bool isInt(const json* v) {
    if (!isNum(v)) return false;
    const double d = v->get<double>();
    return std::floor(d) == d;
}
double num(const json* v) { return v->get<double>(); }

const json* mem(const json& o, const char* k) {
    if (!o.is_object()) return nullptr;
    const auto it = o.find(k);
    return it == o.end() ? nullptr : &*it;
}
// `?? fallback`: absent or null
bool nullish(const json* v) { return v == nullptr || v->is_null(); }

std::vector<const json*> arr(const json& o, const char* k) {
    std::vector<const json*> out;
    const json* a = mem(o, k);
    if (!a || !a->is_array()) return out;
    for (const json& x : *a) out.push_back(&x);
    return out;
}
size_t arrLen(const json& o, const char* k) {
    const json* a = mem(o, k);
    return a && a->is_array() ? a->size() : 0;
}

std::string str(const json* v) {
    if (!v) return "undefined";
    if (v->is_string()) return v->get<std::string>();
    return v->dump();
}

bool isExprValue(const json* v) {
    return v && v->is_object() && v->contains("expr") && (*v)["expr"].is_string();
}

// Number.prototype.toString of a finite double (the shortest text that reads back the same).
std::string jsNumber(double d) {
    if (d == 0) return "0";
    if (std::floor(d) == d && std::fabs(d) < 1e21) {
        char buf[32];
        std::snprintf(buf, sizeof buf, "%.0f", d);
        return buf;
    }
    char buf[40];
    for (int p = 1; p <= 17; ++p) {
        std::snprintf(buf, sizeof buf, "%.*g", p, d);
        if (std::strtod(buf, nullptr) == d) break;
    }
    return buf;
}

// JSON.stringify of a constant or {"expr": ...} (W_LOGIC_WRITE_CONFLICT compares these texts).
std::string jsStringify(const json& v) {
    if (v.is_number()) return jsNumber(v.get<double>());
    if (v.is_object()) {
        std::string out = "{";
        bool first = true;
        for (auto it = v.begin(); it != v.end(); ++it) {
            if (!first) out += ",";
            first = false;
            out += json(it.key()).dump() + ":" + jsStringify(it.value());
        }
        return out + "}";
    }
    if (v.is_array()) {
        std::string out = "[";
        for (size_t i = 0; i < v.size(); ++i) out += (i ? "," : "") + jsStringify(v[i]);
        return out + "]";
    }
    return v.dump();
}

// String.prototype.replace(/\s+/g, '') on UTF-8 text.
std::string stripSpaces(const std::string& s) {
    std::string out;
    size_t i = 0;
    while (i < s.size()) {
        const unsigned char c = static_cast<unsigned char>(s[i]);
        size_t n = c < 0x80 ? 1 : (c >> 5) == 6 ? 2 : (c >> 4) == 14 ? 3 : (c >> 3) == 30 ? 4 : 1;
        if (i + n > s.size()) n = 1;
        uint32_t cp = c;
        if (n == 2) cp = ((c & 0x1F) << 6) | (s[i + 1] & 0x3F);
        if (n == 3) cp = ((c & 0x0F) << 12) | ((s[i + 1] & 0x3F) << 6) | (s[i + 2] & 0x3F);
        if (n == 4)
            cp = ((c & 0x07) << 18) | ((s[i + 1] & 0x3F) << 12) | ((s[i + 2] & 0x3F) << 6) |
                 (s[i + 3] & 0x3F);
        const bool space = cp == 0x20 || (cp >= 0x09 && cp <= 0x0D) || cp == 0xA0 || cp == 0x1680 ||
                           (cp >= 0x2000 && cp <= 0x200A) || cp == 0x2028 || cp == 0x2029 ||
                           cp == 0x202F || cp == 0x205F || cp == 0x3000 || cp == 0xFEFF;
        if (!space) out.append(s, i, n);
        i += n;
    }
    return out;
}

bool matchId(const std::string& s) {  // ^[a-z][a-z0-9_]{0,47}$
    if (s.empty() || s.size() > 48 || s[0] < 'a' || s[0] > 'z') return false;
    for (char c : s)
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_')) return false;
    return true;
}

bool matchHhmm(const json* v) {  // ^([01][0-9]|2[0-3]):([0-5][0-9])$
    if (!v || !v->is_string()) return false;
    const std::string s = v->get<std::string>();
    if (s.size() != 5 || s[2] != ':') return false;
    const auto dig = [](char c) { return c >= '0' && c <= '9'; };
    if (!dig(s[0]) || !dig(s[1]) || !dig(s[3]) || !dig(s[4])) return false;
    const int h = (s[0] - '0') * 10 + (s[1] - '0');
    return h <= 23 && s[3] <= '5';
}

bool validDate(const json* v) {
    if (!v || !v->is_string()) return false;
    const std::string s = v->get<std::string>();
    if (s.size() != 10 || s[4] != '-' || s[7] != '-') return false;
    for (size_t i : {0, 1, 2, 3, 5, 6, 8, 9})
        if (s[i] < '0' || s[i] > '9') return false;
    const int y = std::stoi(s.substr(0, 4)), mo = std::stoi(s.substr(5, 2)),
              d = std::stoi(s.substr(8, 2));
    if (mo < 1 || mo > 12 || d < 1) return false;
    const bool leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    static const int kDays[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    return d <= (mo == 2 && leap ? 29 : kDays[mo - 1]);
}

// BOOL <-> boolean, STRING <-> string, an integer inside the range of an integer type, a finite
// number otherwise.
bool constFits(TagType type, const json* v) {
    if (!v) return false;
    if (type == TagType::BOOL) return v->is_boolean();
    if (type == TagType::STRING) return v->is_string();
    if (!isNum(v)) return false;
    const double x = num(v);
    double lo = 0, hi = 0;
    switch (type) {
        case TagType::INT16:
            lo = -32768.0, hi = 32768.0;
            break;
        case TagType::UINT16:
            lo = 0, hi = 65536.0;
            break;
        case TagType::INT32:
            lo = -2147483648.0, hi = 2147483648.0;
            break;
        case TagType::UINT32:
            lo = 0, hi = 4294967296.0;
            break;
        case TagType::INT64:
            lo = -9223372036854775808.0, hi = 9223372036854775808.0;
            break;
        case TagType::UINT64:
            lo = 0, hi = 18446744073709551616.0;
            break;
        default:
            return true;
    }
    return std::floor(x) == x && x >= lo && x < hi;
}

}  // namespace

bool isValidLogicTagId(const std::string& id) {
    // ^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$, at most 64, not true/false
    if (id.empty() || id.size() > 64 || id == "true" || id == "false") return false;
    const auto alpha = [](char c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'); };
    const auto word = [&](char c) { return alpha(c) || (c >= '0' && c <= '9') || c == '_'; };
    if (!alpha(id[0])) return false;
    bool afterDot = false;
    for (size_t i = 1; i < id.size(); ++i) {
        const char c = id[i];
        if (c == '.') {
            if (afterDot) return false;  // empty segment
            afterDot = true;
        } else if (word(c)) {
            afterDot = false;
        } else {
            return false;
        }
    }
    return !afterDot;
}

TagInfoMap logicTagsFromList(const json& tagsDoc) {
    TagInfoMap m;
    const json* list = tagsDoc.is_object() ? mem(tagsDoc, "tags") : nullptr;
    if (!list || !list->is_array()) return m;
    for (const json& t : *list) {
        if (!t.is_object() || !t.contains("id") || !t["id"].is_string()) continue;
        const std::string id = t["id"].get<std::string>();
        if (m.count(id)) continue;
        TagInfo info;
        const auto type = logic::tagTypeOf(t.value("type", std::string()));
        if (!type) continue;
        info.type = *type;
        info.kind = t.value("kind", std::string("external"));
        info.rw = t.value("access", std::string()) == "RW";
        if (t.contains("expression") && t["expression"].is_string())
            info.expression = t["expression"].get<std::string>();
        m[id] = info;
    }
    return m;
}

json logicTagDefs(const json& doc, const TagInfoMap& tags) {
    std::set<std::string> seen;
    json out = json::array();
    for (const LogicOutput& o : logic::logicOutputs(doc)) {
        if (!isValidLogicTagId(o.tag) || tags.count(o.tag) || seen.count(o.tag)) continue;
        seen.insert(o.tag);
        out.push_back(
            {{"id", o.tag}, {"kind", "internal"}, {"type", typeName(o.type)}, {"access", "R"}});
    }
    return out;
}

LogicCheck checkLogic(const json& doc, const LogicCheckOptions& opts) {
    LogicCheck out;
    const std::string file = opts.file;
    const auto err = [&](const char* code, const std::string& path, const std::string& msg) {
        out.errors.push_back({code, file, path, msg});
    };
    const auto warn = [&](const char* code, const std::string& path, const std::string& msg) {
        out.warnings.push_back({code, file, path, msg});
    };
    static const TagInfoMap kNoTags;
    const TagInfoMap& tags = opts.tags ? *opts.tags : kNoTags;
    const int scanMs = opts.scanMs;
    const int flushS = opts.flushS;

    // 0. version
    {
        const json* v = mem(doc, "schemaVersion");
        static const std::regex kVersion("^1\\.0\\.\\d+$");
        if (!v || !v->is_string() || !std::regex_match(v->get<std::string>(), kVersion)) {
            err("E_LOGIC_VERSION", "/schemaVersion", "logic.json " + str(v) + ": chỉ hiểu 1.0.x");
            return out;
        }
    }

    // 1. file size and entries
    if (opts.bytes && *opts.bytes > kMaxFileBytes)
        err("E_LOGIC_LIMIT", "",
            "logic.json " + std::to_string(*opts.bytes) + " byte > " +
                std::to_string(kMaxFileBytes));
    for (const char* k :
         {"writes", "rules", "timers", "counters", "totalizers", "runhours", "schedules"}) {
        const size_t n = arrLen(doc, k);
        if (n > limits().at(k))
            err("E_LOGIC_LIMIT", std::string("/") + k,
                std::to_string(n) + " mục " + k + " > " + std::to_string(limits().at(k)));
    }

    // 2. ids
    std::set<std::string> seenIds;
    const auto idCheck = [&](const json* id, const std::string& path) {
        if (!id || !id->is_string() || !matchId(id->get<std::string>())) {
            err("E_LOGIC_ID", path, "id '" + str(id) + "' sai dạng (^[a-z][a-z0-9_]{0,47}$)");
            return;
        }
        const std::string s = id->get<std::string>();
        if (seenIds.count(s)) err("E_LOGIC_ID", path, "id '" + s + "' bị trùng");
        seenIds.insert(s);
    };
    {
        const auto ws = arr(doc, "writes");
        for (size_t i = 0; i < ws.size(); ++i)
            idCheck(mem(*ws[i], "id"), "/writes/" + std::to_string(i) + "/id");
    }
    for (const char* kind : logic::kBlockKinds) {
        const auto bs = logic::blocksOf(doc, kind);
        for (size_t i = 0; i < bs.size(); ++i)
            idCheck(mem(*bs[i], "id"), std::string("/") + kind + "/" + std::to_string(i) + "/id");
    }

    // 3. outputs
    std::map<std::string, LogicOutput> outputs;
    for (const char* kind : logic::kBlockKinds) {
        const auto& fields = logic::outputFields(kind);
        if (fields.empty()) continue;
        const auto bs = logic::blocksOf(doc, kind);
        for (size_t i = 0; i < bs.size(); ++i)
            for (const auto& [field, type] : fields) {
                const json* t = mem(*bs[i], field.c_str());
                if (!t || !t->is_string()) continue;
                const std::string tag = t->get<std::string>();
                const std::string p =
                    std::string("/") + kind + "/" + std::to_string(i) + "/" + field;
                if (!isValidLogicTagId(tag))
                    err("E_LOGIC_ID", p, "Tag đầu ra '" + tag + "' sai dạng");
                else if (tags.count(tag) || outputs.count(tag))
                    err("E_LOGIC_TAG_COLLISION", p,
                        "Tag đầu ra '" + tag + "' trùng Tag có sẵn hoặc đầu ra khác");
                else
                    outputs[tag] = {tag, type, logic::blockId(*bs[i]), field};
            }
    }
    LogicEnv env;
    env.tagType = [&](const std::string& id) -> std::optional<TagType> {
        const auto t = tags.find(id);
        if (t != tags.end()) return t->second.type;
        const auto o = outputs.find(id);
        if (o != outputs.end()) return o->second.type;
        return std::nullopt;
    };
    env.hasTable = opts.hasTable ? opts.hasTable : [](const std::string&) { return false; };
    const auto compileOk = [&](const std::string& src, TagType target) {
        expr::CompileEnv ce;
        ce.tagType = env.tagType;
        ce.hasTable = env.hasTable;
        ce.target = target;
        return expr::compile(src, ce);
    };
    const auto exprCheck = [&](const std::string& src, TagType target, const std::string& path) {
        const expr::CompileResult r = compileOk(src, target);
        if (r.ok) return true;
        const std::string& code = r.errors[0].code;
        if (code == "E_EXPR_UNKNOWN_TAG")
            err("E_LOGIC_TAG_REF", path, "biểu thức '" + src + "': Tag không có");
        else if (code == "E_EXPR_LIMIT")
            err("E_LOGIC_LIMIT", path, "biểu thức '" + src + "' vượt giới hạn của 006");
        else if (code == "E_EXPR_TYPE" &&
                 (compileOk(src, TagType::BOOL).ok || compileOk(src, TagType::FLOAT64).ok ||
                  compileOk(src, TagType::STRING).ok))
            err("E_LOGIC_TYPE", path,
                "biểu thức '" + src + "' không cho kiểu " +
                    (target == TagType::FLOAT64 ? std::string("số") : typeName(target)));
        else
            err("E_LOGIC_EXPR", path, "biểu thức '" + src + "' không hợp lệ (" + code + ")");
        return false;
    };

    // 4. writes
    struct WriteInfo {
        std::string tag;
        std::optional<TagType> type;
        json allowed;
    };
    std::map<std::string, WriteInfo> writes;
    {
        const auto ws = arr(doc, "writes");
        for (size_t i = 0; i < ws.size(); ++i) {
            const json& w = *ws[i];
            const std::string p = "/writes/" + std::to_string(i);
            const json* tagJ = mem(w, "tag");
            const std::string wtag = tagJ && tagJ->is_string() ? tagJ->get<std::string>() : "";
            const bool hasTag = tagJ && tagJ->is_string();
            const auto t = hasTag ? tags.find(wtag) : tags.end();
            if (t == tags.end()) {
                if (hasTag && outputs.count(wtag))
                    err("E_LOGIC_WRITE_TARGET", p + "/tag",
                        "'" + wtag + "' là Tag logic, không phải Tag thiết bị RW");
                else
                    err("E_LOGIC_TAG_REF", p + "/tag", "Tag '" + str(tagJ) + "' không có");
            } else if (t->second.kind != "external" || !t->second.rw) {
                err("E_LOGIC_WRITE_TARGET", p + "/tag",
                    "'" + wtag + "' không phải Tag thiết bị RW");
            }
            const json* a = mem(w, "allowed");
            if (t != tags.end() && a) {
                const TagType type = t->second.type;
                if (a->is_object() && a->contains("values")) {
                    const auto vals = arr(*a, "values");
                    for (size_t j = 0; j < vals.size(); ++j)
                        if (!constFits(type, vals[j]))
                            err("E_LOGIC_WRITE_VALUE", p + "/allowed/values/" + std::to_string(j),
                                "giá trị " + vals[j]->dump() + " sai kiểu " + typeName(type));
                } else if (!numericType(type)) {
                    err("E_LOGIC_WRITE_VALUE", p + "/allowed",
                        std::string("min/max chỉ cho Tag số ('") + wtag + "' là " + typeName(type) +
                            ")");
                } else {
                    const json* mn = mem(*a, "min");
                    const json* mx = mem(*a, "max");
                    if (mn && mx && mn->is_number() && mx->is_number() && num(mn) > num(mx))
                        err("E_LOGIC_WRITE_VALUE", p + "/allowed",
                            "min " + jsNumber(num(mn)) + " > max " + jsNumber(num(mx)));
                }
            }
            const json* mi = mem(w, "minIntervalMs");
            if (!isInt(mi) || num(mi) < 1000)
                err("E_LOGIC_LIMIT", p + "/minIntervalMs",
                    "minIntervalMs bắt buộc, số nguyên ≥ 1.000");
            const json* mph = mem(w, "maxPerHour");
            if (!isInt(mph) || num(mph) < 1)
                err("E_LOGIC_LIMIT", p + "/maxPerHour", "maxPerHour bắt buộc, số nguyên ≥ 1");
            const json* id = mem(w, "id");
            if (id && id->is_string() && !writes.count(id->get<std::string>())) {
                WriteInfo wi;
                wi.tag = wtag;
                if (t != tags.end()) wi.type = t->second.type;
                wi.allowed = a ? *a : json::object();
                writes[id->get<std::string>()] = std::move(wi);
            }
        }
    }

    // 5. blocks: expressions
    static const std::map<std::string, std::vector<std::tuple<const char*, TagType, bool>>>
        kExprFields = {
            {"rules", {{"when", TagType::BOOL, false}}},
            {"timers", {{"in", TagType::BOOL, false}}},
            {"counters",
             {{"up", TagType::BOOL, false},
              {"down", TagType::BOOL, true},
              {"reset", TagType::BOOL, true}}},
            {"totalizers", {{"source", TagType::FLOAT64, false}, {"reset", TagType::BOOL, true}}},
            {"runhours", {{"run", TagType::BOOL, false}, {"reset", TagType::BOOL, true}}},
        };
    for (const char* kind : logic::kBlockKinds) {
        const auto f = kExprFields.find(kind);
        if (f == kExprFields.end()) continue;
        const auto bs = logic::blocksOf(doc, kind);
        for (size_t i = 0; i < bs.size(); ++i)
            for (const auto& [field, target, nullable] : f->second) {
                const json* v = mem(*bs[i], field);
                if (!v || (v->is_null() && nullable)) continue;
                if (v->is_string())
                    exprCheck(v->get<std::string>(), target,
                              std::string("/") + kind + "/" + std::to_string(i) + "/" + field);
            }
    }

    // rules: parameters and actions
    const auto valueCheck = [&](const json* v, TagType type, const std::string& path,
                                bool isWrite) {
        if (isExprValue(v)) return exprCheck((*v)["expr"].get<std::string>(), type, path + "/expr");
        if (!constFits(type, v)) {
            err(isWrite ? "E_LOGIC_WRITE_VALUE" : "E_LOGIC_TYPE", path,
                "giá trị " + str(v) + " sai kiểu " + typeName(type));
            return false;
        }
        return true;
    };
    const auto actionCheck = [&](const json& a, const std::string& p) {
        static const std::map<std::string, std::vector<std::string>> kKeys = {
            {"setTag", {"do", "tag", "value"}},
            {"toggle", {"do", "tag"}},
            {"write", {"do", "write", "value"}},
            {"pulse", {"do", "write", "value", "ms"}}};
        const json* doJ = mem(a, "do");
        const std::string d = doJ && doJ->is_string() ? doJ->get<std::string>() : "";
        const auto keys = kKeys.find(d);
        if (keys == kKeys.end()) {
            err("E_LOGIC_ACTION", p + "/do",
                "hành động '" + str(doJ) + "' không có (setTag, toggle, write, pulse)");
            return;
        }
        std::string extra, missing;
        if (a.is_object())
            for (auto it = a.begin(); it != a.end(); ++it)
                if (std::find(keys->second.begin(), keys->second.end(), it.key()) ==
                    keys->second.end())
                    extra += (extra.empty() ? "" : ", ") + it.key();
        for (const std::string& k : keys->second)
            if (!a.contains(k)) missing += (missing.empty() ? "" : ", ") + k;
        if (!extra.empty() || !missing.empty()) {
            err("E_LOGIC_ACTION", p, "hành động " + d + ": thiếu " + missing + " thừa " + extra);
            return;
        }
        if (d == "setTag" || d == "toggle") {
            const json* tagJ = mem(a, "tag");
            const std::string tag = str(tagJ);
            const auto t = tagJ && tagJ->is_string() ? tags.find(tag) : tags.end();
            if (t == tags.end()) {
                if (tagJ && tagJ->is_string() && outputs.count(tag))
                    err("E_LOGIC_ACTION", p + "/tag",
                        "'" + tag + "' là Tag logic: chỉ khối của nó đặt");
                else
                    err("E_LOGIC_TAG_REF", p + "/tag", "Tag '" + tag + "' không có");
                return;
            }
            if (t->second.kind != "internal") {
                err("E_LOGIC_ACTION", p + "/tag",
                    d + " chỉ cho Tag nội bộ ('" + tag + "' là " + t->second.kind + ")");
                return;
            }
            if (d == "toggle") {
                if (t->second.type != TagType::BOOL)
                    err("E_LOGIC_TYPE", p + "/tag",
                        std::string("toggle cần Tag BOOL ('") + tag + "' là " +
                            typeName(t->second.type) + ")");
                return;
            }
            valueCheck(mem(a, "value"), t->second.type, p + "/value", false);
            return;
        }
        // write, pulse
        const json* ms = mem(a, "ms");
        if (d == "pulse" && (!isInt(ms) || num(ms) < 100 || num(ms) > 10000))
            err("E_LOGIC_ACTION", p + "/ms", "ms " + str(ms) + ": 100 đến 10.000");
        const json* wJ = mem(a, "write");
        const auto w = wJ && wJ->is_string() ? writes.find(wJ->get<std::string>()) : writes.end();
        if (w == writes.end()) {
            err("E_LOGIC_WRITE_UNDECLARED", p + "/write", "mục writes '" + str(wJ) + "' không có");
            return;
        }
        if (!w->second.type) return;  // the Tag of the writes entry is missing: reported
        const json* v = mem(a, "value");
        if (valueCheck(v, *w->second.type, p + "/value", true) && !isExprValue(v))
            if (!logic::logicAllowed(w->second.allowed, logic::scalarOfJson(*v)))
                err("E_LOGIC_WRITE_VALUE", p + "/value",
                    "giá trị " + v->dump() + " ngoài allowed của '" + w->first + "'");
    };
    {
        const auto rs = arr(doc, "rules");
        for (size_t i = 0; i < rs.size(); ++i) {
            const json& r = *rs[i];
            const std::string p = "/rules/" + std::to_string(i);
            const json* hold = mem(r, "hold");
            if (!nullish(hold) && (!isInt(hold) || num(hold) < 0 || num(hold) > kMaxMs))
                err("E_LOGIC_LIMIT", p + "/hold",
                    "hold " + str(hold) + " ms ngoài 0 đến 86.400.000");
            const json* rep = mem(r, "repeatMs");
            if (!nullish(rep) &&
                (!isInt(rep) || (num(rep) != 0 && (num(rep) < 10000 || num(rep) > kMaxMs))))
                err("E_LOGIC_LIMIT", p + "/repeatMs",
                    "repeatMs " + str(rep) + ": 0 hoặc 10.000 đến 86.400.000");
            const size_t n = arrLen(r, "onRise") + arrLen(r, "onFall");
            if (n > kActionsPerRule)
                err("E_LOGIC_LIMIT", p, std::to_string(n) + " hành động > 8 mỗi luật");
            for (const char* list : {"onRise", "onFall"}) {
                const auto as = arr(r, list);
                for (size_t j = 0; j < as.size(); ++j)
                    actionCheck(*as[j], p + "/" + list + "/" + std::to_string(j));
            }
        }
    }
    {
        const auto ts = arr(doc, "timers");
        for (size_t i = 0; i < ts.size(); ++i) {
            const json& t = *ts[i];
            const std::string p = "/timers/" + std::to_string(i);
            const json* kind = mem(t, "kind");
            const std::string k = kind && kind->is_string() ? kind->get<std::string>() : "";
            if (k != "ton" && k != "tof" && k != "tp")
                err("E_LOGIC_TIMER", p + "/kind", "kind '" + str(kind) + "' lạ (ton, tof, tp)");
            const json* pt = mem(t, "pt");
            if (!isInt(pt) || num(pt) <= 0 || num(pt) > kMaxMs)
                err("E_LOGIC_TIMER", p + "/pt", "pt " + str(pt) + ": 1 đến 86.400.000 ms");
            else if (num(pt) < scanMs)
                warn("W_LOGIC_PT_ROUNDED", p + "/pt",
                     "pt " + str(pt) + " ms nhỏ hơn logic.scanMs " + std::to_string(scanMs) +
                         " ms: làm tròn lên");
        }
    }
    {
        const auto cs = arr(doc, "counters");
        for (size_t i = 0; i < cs.size(); ++i) {
            const json& c = *cs[i];
            const std::string p = "/counters/" + std::to_string(i);
            const json* preset = mem(c, "preset");
            if (!nullish(preset) && (!isInt(preset) || num(preset) < 1))
                err("E_LOGIC_COUNTER", p + "/preset",
                    "preset " + str(preset) + ": số nguyên ≥ 1 hoặc null");
            if (nullish(preset) && mem(c, "reached"))
                err("E_LOGIC_COUNTER", p + "/reached", "reached cần preset");
        }
    }
    {
        const auto zs = arr(doc, "totalizers");
        for (size_t i = 0; i < zs.size(); ++i) {
            const json& z = *zs[i];
            const std::string p = "/totalizers/" + std::to_string(i);
            const json* ru = mem(z, "rateUnit");
            const std::string u = ru && ru->is_string() ? ru->get<std::string>() : "";
            if (u != "s" && u != "min" && u != "h" && u != "d")
                err("E_LOGIC_TOTALIZER", p + "/rateUnit",
                    "rateUnit '" + str(ru) + "' lạ (s, min, h, d)");
            const json* factor = mem(z, "factor");
            if (factor && (!isNum(factor) || num(factor) <= 0))
                err("E_LOGIC_TOTALIZER", p + "/factor", "factor phải > 0 và hữu hạn");
            const json* cutoff = mem(z, "cutoff");
            if (cutoff && (!isNum(cutoff) || num(cutoff) < 0))
                err("E_LOGIC_TOTALIZER", p + "/cutoff", "cutoff phải ≥ 0");
            const json* gap = mem(z, "maxGapMs");
            if (gap && (!isInt(gap) || num(gap) <= 0 || num(gap) > kMaxMs))
                err("E_LOGIC_TOTALIZER", p + "/maxGapMs", "maxGapMs: 1 đến 86.400.000");
            const json* roll = mem(z, "rolloverAt");
            if (roll && (!isNum(roll) || num(roll) <= 0))
                err("E_LOGIC_TOTALIZER", p + "/rolloverAt", "rolloverAt phải > 0");
        }
    }
    {
        const auto hs = arr(doc, "runhours");
        for (size_t i = 0; i < hs.size(); ++i) {
            const json* s = mem(*hs[i], "serviceEveryHours");
            if (!nullish(s) && (!isNum(s) || num(s) <= 0))
                err("E_LOGIC_LIMIT", "/runhours/" + std::to_string(i) + "/serviceEveryHours",
                    "serviceEveryHours phải > 0 hoặc null");
        }
    }
    {
        const auto ss = arr(doc, "schedules");
        for (size_t i = 0; i < ss.size(); ++i) {
            const json& s = *ss[i];
            const std::string p = "/schedules/" + std::to_string(i);
            const json* tz = mem(s, "tzOffsetMin");
            if (!nullish(tz) && (!isInt(tz) || num(tz) < -720 || num(tz) > 840))
                err("E_LOGIC_SCHEDULE", p + "/tzOffsetMin", "tzOffsetMin: -720 đến 840");
            const auto weekly = arr(s, "weekly");
            if (weekly.size() > kWindows)
                err("E_LOGIC_LIMIT", p + "/weekly", std::to_string(weekly.size()) + " khung > 16");
            for (size_t j = 0; j < weekly.size(); ++j) {
                const json& w = *weekly[j];
                const std::string q = p + "/weekly/" + std::to_string(j);
                const auto days = arr(w, "days");
                if (days.empty()) err("E_LOGIC_SCHEDULE", q + "/days", "days rỗng");
                std::set<double> seen;
                for (const json* d : days) {
                    if (!isInt(d) || num(d) < 1 || num(d) > 7 || seen.count(num(d))) {
                        err("E_LOGIC_SCHEDULE", q + "/days",
                            "ngày " + str(d) + " lạ hoặc trùng (1 là thứ Hai … 7 là Chủ nhật)");
                        break;
                    }
                    seen.insert(num(d));
                }
                const json* from = mem(w, "from");
                const json* to = mem(w, "to");
                const bool okFrom = matchHhmm(from), okTo = matchHhmm(to);
                if (!okFrom)
                    err("E_LOGIC_SCHEDULE", q + "/from",
                        "from '" + str(from) + "' không phải HH:MM");
                if (!okTo)
                    err("E_LOGIC_SCHEDULE", q + "/to", "to '" + str(to) + "' không phải HH:MM");
                if (okFrom && okTo && *from == *to) err("E_LOGIC_SCHEDULE", q, "from = to");
            }
            const auto ex = arr(s, "exceptions");
            if (ex.size() > kExceptions)
                err("E_LOGIC_LIMIT", p + "/exceptions",
                    std::to_string(ex.size()) + " ngoại lệ > 64");
            std::set<std::string> dates;
            for (size_t j = 0; j < ex.size(); ++j) {
                const json& x = *ex[j];
                const std::string q = p + "/exceptions/" + std::to_string(j);
                const json* date = mem(x, "date");
                const std::string ds = str(date);
                if (!validDate(date))
                    err("E_LOGIC_SCHEDULE", q + "/date", "ngày '" + ds + "' không hợp lệ");
                else if (dates.count(ds))
                    err("E_LOGIC_SCHEDULE", q + "/date", "ngày '" + ds + "' trùng");
                dates.insert(ds);
                const json* mode = mem(x, "mode");
                const std::string m = mode && mode->is_string() ? mode->get<std::string>() : "";
                if (m != "on" && m != "off")
                    err("E_LOGIC_SCHEDULE", q + "/mode", "mode '" + str(mode) + "' lạ (on, off)");
            }
        }
    }

    // 6. cycles and self trigger
    const logic::LogicGraph graph = logic::logicGraph(doc, env, outputs);
    std::map<std::string, std::string> where;
    std::map<std::string, std::pair<std::string, const json*>> blockById;
    for (const char* kind : logic::kBlockKinds) {
        const auto bs = logic::blocksOf(doc, kind);
        for (size_t i = 0; i < bs.size(); ++i) {
            const std::string id = logic::blockId(*bs[i]);
            if (!where.count(id)) where[id] = std::string("/") + kind + "/" + std::to_string(i);
            if (!blockById.count(id)) blockById[id] = {kind, bs[i]};
        }
    }
    for (const auto& comp : graph.cycles) {
        std::string text;
        for (size_t i = 0; i < comp.size(); ++i) text += (i ? " → " : "") + comp[i];
        const auto w = where.find(comp[0]);
        err("E_LOGIC_CYCLE", w != where.end() ? w->second : "", "vòng phụ thuộc: " + text);
    }
    const auto tagDeps = [&](const std::string& tag) {
        std::vector<std::string> out;
        const auto o = outputs.find(tag);
        if (o != outputs.end()) {
            const auto& [kind, b] = blockById.at(o->second.block);
            for (const logic::ExprField& e : logic::logicExpressions(kind, *b))
                for (const std::string& r : logic::exprRefs(e.src, e.target, env)) out.push_back(r);
            return out;
        }
        const auto t = tags.find(tag);
        if (t != tags.end() && t->second.kind == "calculated" && t->second.expression)
            return logic::exprRefs(*t->second.expression, t->second.type, env);
        return out;
    };
    const auto rules = arr(doc, "rules");
    for (size_t i = 0; i < rules.size(); ++i) {
        const json& r = *rules[i];
        std::set<std::string> sets;
        for (const char* list : {"onRise", "onFall"})
            for (const json* a : arr(r, list)) {
                const json* d = mem(*a, "do");
                const json* t = mem(*a, "tag");
                if (d && d->is_string() && (*d == "setTag" || *d == "toggle") && t &&
                    t->is_string())
                    sets.insert(t->get<std::string>());
            }
        const json* when = mem(r, "when");
        if (sets.empty() || !when || !when->is_string()) continue;
        std::set<std::string> seen;
        std::vector<std::string> todo =
            logic::exprRefs(when->get<std::string>(), TagType::BOOL, env);
        std::optional<std::string> hit;
        while (!todo.empty() && !hit) {
            const std::string tag = todo.back();
            todo.pop_back();
            if (seen.count(tag)) continue;
            seen.insert(tag);
            if (sets.count(tag))
                hit = tag;
            else
                for (const std::string& d : tagDeps(tag)) todo.push_back(d);
        }
        if (hit)
            err("E_LOGIC_SELF_TRIGGER", "/rules/" + std::to_string(i) + "/when",
                "luật '" + logic::blockId(r) + "' đọc '" + *hit +
                    "' do chính hành động của nó đặt");
    }

    // 7. warnings
    std::map<std::string, std::string> conflict;
    for (size_t i = 0; i < rules.size(); ++i) {
        const json& r = *rules[i];
        const std::string p = "/rules/" + std::to_string(i);
        const json* enabled = mem(r, "enabled");
        if (enabled && enabled->is_boolean() && !enabled->get<bool>())
            warn("W_LOGIC_DISABLED", p + "/enabled", "luật '" + logic::blockId(r) + "' đang tắt");
        bool writesPlc = false;
        for (const char* list : {"onRise", "onFall"})
            for (const json* a : arr(r, list)) {
                const json* d = mem(*a, "do");
                if (d && (*d == "write" || *d == "pulse")) writesPlc = true;
            }
        const json* hold = mem(r, "hold");
        const bool hold0 = nullish(hold) || (hold->is_number() && num(hold) == 0);
        const json* when = mem(r, "when");
        if (hold0 && writesPlc && when && when->is_string()) {
            for (const std::string& id :
                 logic::exprRefs(when->get<std::string>(), TagType::BOOL, env)) {
                const auto t = tags.find(id);
                if (t != tags.end() && t->second.kind == "external" &&
                    numericType(t->second.type)) {
                    warn("W_LOGIC_NO_HOLD", p + "/hold",
                         "hold = 0 trên luật ghi PLC từ Tag có thể nhiễu ('" + id + "')");
                    break;
                }
            }
        }
        const std::string whenKey =
            when && when->is_string() ? stripSpaces(when->get<std::string>()) : "";
        for (const char* list : {"onRise", "onFall"}) {
            const auto as = arr(r, list);
            for (size_t j = 0; j < as.size(); ++j) {
                const json& a = *as[j];
                const json* d = mem(a, "do");
                std::optional<std::string> tag;
                if (d && *d == "setTag") {
                    const json* t = mem(a, "tag");
                    if (t) tag = str(t);
                } else if (d && (*d == "write" || *d == "pulse")) {
                    const json* w = mem(a, "write");
                    const auto it =
                        w && w->is_string() ? writes.find(w->get<std::string>()) : writes.end();
                    if (it != writes.end()) tag = it->second.tag;
                }
                const json* v = mem(a, "value");
                if (!tag || !v) continue;
                const std::string key = std::string(list) + '\0' + whenKey + '\0' + *tag;
                const std::string val = jsStringify(*v);
                const auto prev = conflict.find(key);
                if (prev == conflict.end())
                    conflict[key] = val;
                else if (prev->second != val)
                    warn("W_LOGIC_WRITE_CONFLICT", p + "/" + list + "/" + std::to_string(j),
                         "'" + *tag + "' được ghi hai giá trị khác nhau cùng điều kiện");
            }
        }
    }
    size_t retained = arrLen(doc, "rules");
    for (const char* k : {"counters", "totalizers", "runhours"})
        for (const json* b : arr(doc, k)) {
            const json* r = mem(*b, "retain");
            if (!(r && r->is_boolean() && !r->get<bool>())) ++retained;
        }
    const double perDay = std::floor(86400.0 / flushS);
    const double bytesPerDay = (static_cast<double>(retained) * 24 + 512 + 4096) * perDay;
    if (bytesPerDay > kRetainIoLimit) {
        char buf[160];
        std::snprintf(buf, sizeof buf,
                      "ước tính retain %.1f MiB/ngày > 100 MiB (%zu khối, flushS %d)",
                      bytesPerDay / 1048576, retained, flushS);
        warn("W_LOGIC_RETAIN_IO", "", buf);
    }
    if (opts.deviceWrites && *opts.deviceWrites == "off" && arrLen(doc, "writes") > 0)
        warn("W_LOGIC_WRITES_OFF", "/writes",
             "project có ghi PLC từ logic nhưng thiết bị đích đang tắt logic.writes");
    return out;
}

}  // namespace mat
