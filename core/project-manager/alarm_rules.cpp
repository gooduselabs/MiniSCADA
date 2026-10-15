#include "core/project-manager/alarm_rules.hpp"

#include <algorithm>
#include <cmath>
#include <map>
#include <optional>
#include <set>
#include <tuple>

namespace mat {

using nlohmann::json;

namespace {

const char* const kThresholds[] = {"LL", "L", "H", "HH"};
const std::set<std::string> kTextTokens = {"name",  "tag",       "value", "unit",
                                           "limit", "limitName", "area",  "reason"};
const std::set<std::string> kCommonKeys = {"id",   "type",    "name",      "area",
                                           "text", "enabled", "onDelayMs", "offDelayMs"};
const std::set<std::string> kClassKeys = {"id",        "name",  "priority",
                                          "color",     "blink", "requiresAck",
                                          "ackReturn", "sound", "chatterLimit"};
const std::set<std::string> kPriorities = {"critical", "major", "minor", "advisory"};
const std::set<std::string> kColors = {"red",    "orange", "amber", "blue",
                                       "purple", "teal",   "gray",  "green"};
const std::set<std::string> kSounds = {"none", "beep", "double", "siren"};
const std::set<std::string> kIntegerTypes = {"INT16",  "UINT16", "INT32",
                                             "UINT32", "INT64",  "UINT64"};

bool isDigit(char c) { return c >= '0' && c <= '9'; }
bool isLower(char c) { return c >= 'a' && c <= 'z'; }
bool isAlpha(char c) { return isLower(c) || (c >= 'A' && c <= 'Z'); }

// ^[A-Za-z][A-Za-z0-9_]{1,47}$
bool alarmIdOk(const std::string& s) {
    if (s.size() < 2 || s.size() > 48 || !isAlpha(s[0])) return false;
    for (size_t i = 1; i < s.size(); ++i)
        if (!isAlpha(s[i]) && !isDigit(s[i]) && s[i] != '_') return false;
    return true;
}
// ^[a-z0-9][a-z0-9-]{0,31}$
bool areaIdOk(const std::string& s) {
    if (s.empty() || s.size() > 32 || !(isLower(s[0]) || isDigit(s[0]))) return false;
    for (size_t i = 1; i < s.size(); ++i)
        if (!isLower(s[i]) && !isDigit(s[i]) && s[i] != '-') return false;
    return true;
}
// ^[a-z][a-z0-9_]{1,31}$
bool classIdOk(const std::string& s) {
    if (s.size() < 2 || s.size() > 32 || !isLower(s[0])) return false;
    for (size_t i = 1; i < s.size(); ++i)
        if (!isLower(s[i]) && !isDigit(s[i]) && s[i] != '_') return false;
    return true;
}

// Unicode code points of a UTF-8 string (the bytes that are not continuation bytes).
size_t cpLen(const std::string& s) {
    size_t n = 0;
    for (const unsigned char c : s)
        if ((c & 0xC0) != 0x80) ++n;
    return n;
}

std::string esc(const std::string& k) {
    std::string out;
    for (const char c : k) {
        if (c == '~')
            out += "~0";
        else if (c == '/')
            out += "~1";
        else
            out += c;
    }
    return out;
}

bool finiteNumber(const json& v) {
    if (!v.is_number()) return false;
    return std::isfinite(v.get<double>());
}

bool isInt(const json& v, double lo, double hi) {
    if (!v.is_number()) return false;
    const double d = v.get<double>();
    return std::isfinite(d) && std::floor(d) == d && d >= lo && d <= hi;
}

class Sink {
   public:
    std::vector<ProjectIssue> errors, warnings;
    void err(const char* code, const std::string& file, const std::string& path,
             const std::string& msg) {
        if (seen_.insert({code, file, path}).second) errors.push_back({code, file, path, msg});
    }
    void warn(const char* code, const std::string& file, const std::string& path,
              const std::string& msg) {
        if (seen_.insert({code, file, path}).second) warnings.push_back({code, file, path, msg});
    }

   private:
    std::set<std::tuple<std::string, std::string, std::string>> seen_;
};

void sortIssues(std::vector<ProjectIssue>& v) {
    std::stable_sort(v.begin(), v.end(), [](const ProjectIssue& a, const ProjectIssue& b) {
        return std::tie(a.file, a.path, a.code) < std::tie(b.file, b.path, b.code);
    });
}

void checkVersion(Sink& out, const std::string& file, const json& doc, const std::string& project) {
    if (!doc.contains("schemaVersion") || !doc["schemaVersion"].is_string())
        out.err("E_SCHEMA", file, "/schemaVersion", "schemaVersion is required");
    else if (doc["schemaVersion"].get<std::string>() != project)
        out.err("E_SCHEMA_VERSION", file, "/schemaVersion",
                "schemaVersion " + doc["schemaVersion"].get<std::string>() +
                    " differs from project.json (" + project + "): every file must match");
}

using ClassMap = std::map<std::string, json>;

// The classes by id; nullopt when the file is broken at file level (E_SCHEMA): class references are
// then skipped.
std::optional<ClassMap> checkClasses(Sink& out, const std::string& file, const json& doc,
                                     const std::string& project) {
    if (!doc.is_object()) {
        out.err("E_SCHEMA", file, "", "alarm-classes.json must be an object");
        return std::nullopt;
    }
    checkVersion(out, file, doc, project);
    for (const auto& [k, v] : doc.items())
        if (k != "schemaVersion" && k != "classes")
            out.err("E_ALARM_CLASS_FIELD", file, "/" + esc(k), "unknown key '" + k + "'");
    if (!doc.contains("classes") || !doc["classes"].is_array()) {
        out.err("E_SCHEMA", file, "/classes", "classes must be an array");
        return std::nullopt;
    }
    const json& list = doc["classes"];
    if (list.empty() || list.size() > kAlarmMaxClasses)
        out.err("E_ALARM_CLASS_COUNT", file, "/classes", "classes must have 1 to 16 entries");
    ClassMap map;
    for (size_t i = 0; i < list.size(); ++i) {
        const json& c = list[i];
        const std::string p = "/classes/" + std::to_string(i);
        if (!c.is_object()) {
            out.err("E_ALARM_CLASS_FIELD", file, p, "class must be an object");
            continue;
        }
        for (const auto& [k, v] : c.items())
            if (!kClassKeys.count(k))
                out.err("E_ALARM_CLASS_FIELD", file, p + "/" + esc(k), "unknown key '" + k + "'");
        const bool idString = c.contains("id") && c["id"].is_string();
        if (!idString || !classIdOk(c["id"].get<std::string>()))
            out.err("E_ALARM_CLASS_FIELD", file, p + "/id",
                    "class id must match ^[a-z][a-z0-9_]{1,31}$");
        if (idString) {
            const std::string id = c["id"].get<std::string>();
            if (map.count(id))
                out.err("E_ALARM_CLASS_DUP", file, p + "/id", "class '" + id + "' is duplicated");
            else
                map[id] = c;
        }
        if (!c.contains("name") || !c["name"].is_string() ||
            cpLen(c["name"].get<std::string>()) < 1 || cpLen(c["name"].get<std::string>()) > 40)
            out.err("E_ALARM_CLASS_FIELD", file, p + "/name", "name must have 1 to 40 characters");
        auto oneOf = [&](const char* key, const std::set<std::string>& set, bool required) {
            if (!c.contains(key)) {
                if (required)
                    out.err("E_ALARM_CLASS_FIELD", file, p + "/" + key,
                            std::string(key) + " is not allowed");
                return;
            }
            if (!c[key].is_string() || !set.count(c[key].get<std::string>()))
                out.err("E_ALARM_CLASS_FIELD", file, p + "/" + key,
                        std::string(key) + " is not allowed");
        };
        oneOf("priority", kPriorities, true);
        oneOf("color", kColors, true);
        oneOf("sound", kSounds, false);
        for (const char* key : {"blink", "requiresAck", "ackReturn"})
            if (c.contains(key) && !c[key].is_boolean())
                out.err("E_ALARM_CLASS_FIELD", file, p + "/" + key,
                        std::string(key) + " must be a boolean");
        if (c.contains("chatterLimit") && !isInt(c["chatterLimit"], 0, 100))
            out.err("E_ALARM_FIELD", file, p + "/chatterLimit",
                    "chatterLimit must be an integer 0 to 100");
        if (c.contains("priority") && c["priority"] == "critical" && c.contains("requiresAck") &&
            c["requiresAck"].is_boolean() && !c["requiresAck"].get<bool>())
            out.warn("W_ALARM_NO_ACK_CRITICAL", file, p + "/requiresAck",
                     "a critical class does not require acknowledgement");
    }
    return map;
}

struct Refs {
    const std::map<std::string, json>* tags = nullptr;  // by id (first wins); null: unknown
    const std::set<std::string>* devices = nullptr;     // null: unknown
    const ClassMap* classes = nullptr;                  // null: unknown
    const json* tagList = nullptr;
};

size_t checkAlarms(Sink& out, const std::string& file, const json& doc, const std::string& project,
                   size_t bytes, const Refs& refs) {
    if (!doc.is_object()) {
        out.err("E_SCHEMA", file, "", "alarms.json must be an object");
        return 0;
    }
    checkVersion(out, file, doc, project);
    for (const auto& [k, v] : doc.items())
        if (k != "schemaVersion" && k != "areas" && k != "alarms")
            out.err("E_ALARM_FIELD", file, "/" + esc(k), "unknown key '" + k + "'");

    // areas
    std::set<std::string> areaIds;
    bool areasKnown = true;
    if (doc.contains("areas")) {
        const json& areas = doc["areas"];
        if (!areas.is_array()) {
            out.err("E_ALARM_FIELD", file, "/areas", "areas must be an array");
            areasKnown = false;
        } else {
            if (areas.size() > kAlarmMaxAreas)
                out.err("E_ALARM_AREA_COUNT", file, "/areas", "more than 64 areas");
            for (size_t i = 0; i < areas.size(); ++i) {
                const json& a = areas[i];
                const std::string p = "/areas/" + std::to_string(i);
                if (!a.is_object()) {
                    out.err("E_ALARM_FIELD", file, p, "area must be an object");
                    continue;
                }
                for (const auto& [k, v] : a.items())
                    if (k != "id" && k != "name")
                        out.err("E_ALARM_FIELD", file, p + "/" + esc(k), "unknown key '" + k + "'");
                const bool idString = a.contains("id") && a["id"].is_string();
                if (!idString || !areaIdOk(a["id"].get<std::string>()))
                    out.err("E_ALARM_FIELD", file, p + "/id",
                            "area id must match ^[a-z0-9][a-z0-9-]{0,31}$");
                if (idString) {
                    const std::string id = a["id"].get<std::string>();
                    if (!areaIds.insert(id).second)
                        out.err("E_ALARM_AREA_DUP", file, p + "/id",
                                "area '" + id + "' is duplicated");
                }
                if (!a.contains("name") || !a["name"].is_string() ||
                    cpLen(a["name"].get<std::string>()) < 1 ||
                    cpLen(a["name"].get<std::string>()) > 40)
                    out.err("E_ALARM_FIELD", file, p + "/name",
                            "area name must have 1 to 40 characters");
            }
        }
    }

    if (!doc.contains("alarms") || !doc["alarms"].is_array()) {
        out.err("E_SCHEMA", file, "/alarms", "alarms must be an array");
        return 0;
    }
    const json& list = doc["alarms"];

    auto deviceHasTag = [&](const std::string& id) {
        if (!refs.tagList || !refs.tagList->is_array()) return false;
        for (const auto& t : *refs.tagList)
            if (t.is_object() && t.value("kind", "") == "external" && t.contains("source") &&
                t["source"].is_object() && t["source"].contains("device") &&
                t["source"]["device"].is_string() && t["source"]["device"] == id)
                return true;
        return false;
    };

    auto checkText = [&](const json& v, const std::string& p) {
        if (!v.is_string()) {
            out.err("E_ALARM_FIELD", file, p, "text must be a string");
            return;
        }
        const std::string s = v.get<std::string>();
        if (cpLen(s) > kAlarmMaxTextChars)
            out.err("E_ALARM_TEXT_LEN", file, p, "text is longer than 200 characters");
        if (!alarmTextTokensValid(s))
            out.err("E_ALARM_TEXT_TOKEN", file, p, "text has an unknown or unbalanced token");
    };
    auto checkClassRef = [&](const json* v, const std::string& p) {
        if (!v || !v->is_string() || v->get<std::string>().empty())
            out.err("E_ALARM_CLASS_REF", file, p, "class is required");
        else if (refs.classes && !refs.classes->count(v->get<std::string>()))
            out.err("E_ALARM_CLASS_REF", file, p,
                    "class '" + v->get<std::string>() + "' does not exist");
    };
    // kind: 'd' digital, 'l' limit, 0 any type
    auto checkTagRef = [&](const json* v, const std::string& p, char kind) {
        if (!v) {
            out.err("E_ALARM_TAG_REF", file, p, "tag is required");
            return;
        }
        if (!v->is_string()) {
            out.err("E_ALARM_FIELD", file, p, "tag must be a string");
            return;
        }
        if (!refs.tags) return;
        const std::string id = v->get<std::string>();
        const auto it = refs.tags->find(id);
        if (it == refs.tags->end()) {
            out.err("E_ALARM_TAG_REF", file, p, "tag '" + id + "' does not exist");
            return;
        }
        const std::string type = it->second.value("type", "");
        if (kind == 'd' && !(type == "BOOL" || kIntegerTypes.count(type)))
            out.err("E_ALARM_TAG_TYPE", file, p,
                    "a digital alarm needs a BOOL or integer Tag, '" + id + "' is " + type);
        if (kind == 'l' && (type == "BOOL" || type == "STRING"))
            out.err("E_ALARM_TAG_TYPE", file, p,
                    "a limit alarm needs a numeric Tag, '" + id + "' is " + type);
    };
    auto get = [](const json& o, const char* k) -> const json* {
        const auto it = o.find(k);
        return it == o.end() ? nullptr : &*it;
    };

    std::set<std::string> seenIds;
    size_t instances = 0;
    for (size_t i = 0; i < list.size(); ++i) {
        const json& a = list[i];
        const std::string p = "/alarms/" + std::to_string(i);
        if (!a.is_object()) {
            out.err("E_ALARM_FIELD", file, p, "alarm must be an object");
            continue;
        }
        std::string type;
        if (a.contains("type") && a["type"].is_string()) {
            const std::string t = a["type"].get<std::string>();
            if (t == "digital" || t == "limit" || t == "quality") type = t;
        }
        if (type.empty())
            out.err("E_ALARM_TYPE", file, p + "/type", "type must be digital, limit or quality");
        std::set<std::string> allowed = kCommonKeys;
        const std::set<std::string> digitalKeys = {"tag", "trigger", "class"};
        const std::set<std::string> limitKeys = {"tag", "limits", "deadband"};
        const std::set<std::string> qualityKeys = {"tag", "device", "on", "class"};
        if (type == "digital" || type.empty())
            allowed.insert(digitalKeys.begin(), digitalKeys.end());
        if (type == "limit" || type.empty()) allowed.insert(limitKeys.begin(), limitKeys.end());
        if (type == "quality" || type.empty())
            allowed.insert(qualityKeys.begin(), qualityKeys.end());
        for (const auto& [k, v] : a.items())
            if (!allowed.count(k))
                out.err("E_ALARM_FIELD", file, p + "/" + esc(k), "unknown key '" + k + "'");

        const json* id = get(a, "id");
        if (!id || !id->is_string() || !alarmIdOk(id->get<std::string>()))
            out.err("E_ALARM_ID_FORMAT", file, p + "/id",
                    "id must match ^[A-Za-z][A-Za-z0-9_]{1,47}$");
        else if (!seenIds.insert(id->get<std::string>()).second)
            out.err("E_ALARM_ID_DUP", file, p + "/id",
                    "alarm '" + id->get<std::string>() + "' is duplicated");

        const json* name = get(a, "name");
        if (!name || !name->is_string() || cpLen(name->get<std::string>()) < 1 ||
            cpLen(name->get<std::string>()) > 80)
            out.err("E_ALARM_FIELD", file, p + "/name", "name must have 1 to 80 characters");
        if (const json* area = get(a, "area")) {
            if (!area->is_string())
                out.err("E_ALARM_FIELD", file, p + "/area", "area must be a string");
            else if (areasKnown && !areaIds.count(area->get<std::string>()))
                out.err("E_ALARM_AREA_REF", file, p + "/area",
                        "area '" + area->get<std::string>() + "' does not exist");
        }
        if (const json* en = get(a, "enabled"); en && !en->is_boolean())
            out.err("E_ALARM_FIELD", file, p + "/enabled", "enabled must be a boolean");
        for (const char* k : {"onDelayMs", "offDelayMs"})
            if (const json* d = get(a, k); d && !isInt(*d, 0, 86400000.0))
                out.err("E_ALARM_DELAY_RANGE", file, p + "/" + k,
                        std::string(k) + " must be an integer 0 to 86400000");
        if (const json* t = get(a, "text")) checkText(*t, p + "/text");

        size_t count = 0;
        if (type == "digital") {
            checkTagRef(get(a, "tag"), p + "/tag", 'd');
            const json* tr = get(a, "trigger");
            if (!tr || !tr->is_boolean())
                out.err("E_ALARM_TRIGGER", file, p + "/trigger", "trigger must be a boolean");
            checkClassRef(get(a, "class"), p + "/class");
            count = 1;
        } else if (type == "quality") {
            const json* tag = get(a, "tag");
            const json* device = get(a, "device");
            if ((tag != nullptr) == (device != nullptr))
                out.err("E_ALARM_DEVICE_REF", file, p + "/device",
                        "a quality alarm needs exactly one of tag, device");
            if (tag) checkTagRef(tag, p + "/tag", 0);
            if (device) {
                if (!device->is_string())
                    out.err("E_ALARM_FIELD", file, p + "/device", "device must be a string");
                else if (refs.devices) {
                    const std::string d = device->get<std::string>();
                    if (!refs.devices->count(d))
                        out.err("E_ALARM_DEVICE_REF", file, p + "/device",
                                "device '" + d + "' does not exist");
                    else if (refs.tags && !deviceHasTag(d))
                        out.warn("W_ALARM_DEVICE_EMPTY", file, p + "/device",
                                 "device '" + d + "' has no Tag read from it");
                }
            }
            if (const json* on = get(a, "on"); on && !(*on == "bad" || *on == "notGood"))
                out.err("E_ALARM_ON", file, p + "/on", "on must be bad or notGood");
            checkClassRef(get(a, "class"), p + "/class");
            count = 1;
        } else if (type == "limit") {
            checkTagRef(get(a, "tag"), p + "/tag", 'l');
            const json* lim = get(a, "limits");
            bool limitsBad = !lim || !lim->is_object() || lim->empty();
            if (lim && lim->is_object())
                for (const auto& [k, v] : lim->items())
                    if (k != "LL" && k != "L" && k != "H" && k != "HH") limitsBad = true;
            if (limitsBad)
                out.err("E_ALARM_LIMIT_NONE", file, p + "/limits",
                        "limits needs 1 to 4 of LL, L, H, HH");
            struct Present {
                std::string name;
                bool hasValue = false;
                double value = 0;
            };
            std::vector<Present> present;
            if (lim && lim->is_object())
                for (const char* name : kThresholds) {
                    const json* t = get(*lim, name);
                    if (!t) continue;
                    const std::string lp = p + "/limits/" + name;
                    if (!t->is_object()) {
                        out.err("E_ALARM_FIELD", file, lp, "threshold must be an object");
                        present.push_back({name, false, 0});
                        continue;
                    }
                    for (const auto& [k, v] : t->items())
                        if (k != "value" && k != "class" && k != "text")
                            out.err("E_ALARM_FIELD", file, lp + "/" + esc(k),
                                    "unknown key '" + k + "'");
                    const json* value = get(*t, "value");
                    const bool ok = value && finiteNumber(*value);
                    if (!ok)
                        out.err("E_ALARM_LIMIT_ORDER", file, lp + "/value",
                                "value must be a finite number");
                    present.push_back({name, ok, ok ? value->get<double>() : 0});
                    checkClassRef(get(*t, "class"), lp + "/class");
                    if (const json* tx = get(*t, "text")) checkText(*tx, lp + "/text");
                }
            count = present.size();
            std::vector<Present> valued;
            for (const auto& x : present)
                if (x.hasValue) valued.push_back(x);
            bool orderOk = valued.size() == present.size();
            for (size_t k = 0; k + 1 < valued.size(); ++k)
                if (!(valued[k].value < valued[k + 1].value)) {
                    orderOk = false;
                    out.err("E_ALARM_LIMIT_ORDER", file, p + "/limits/" + valued[k].name + "/value",
                            "thresholds must satisfy LL < L < H < HH");
                }
            if (const json* db = get(a, "deadband")) {
                if (!db->is_number() || !std::isfinite(db->get<double>()) ||
                    db->get<double>() < 0) {
                    out.err("E_ALARM_DEADBAND", file, p + "/deadband",
                            "deadband must be a finite number >= 0");
                } else if (orderOk) {
                    for (size_t k = 0; k + 1 < valued.size(); ++k)
                        if (!(db->get<double>() < valued[k + 1].value - valued[k].value))
                            out.err("E_ALARM_DEADBAND", file, p + "/deadband",
                                    "deadband must be smaller than the gap to the next threshold");
                }
            }
            auto zeroOrAbsent = [&](const char* k) {
                const json* v = get(a, k);
                return !v || (v->is_number() && v->get<double>() == 0);
            };
            if (zeroOrAbsent("deadband") && zeroOrAbsent("onDelayMs") && zeroOrAbsent("offDelayMs"))
                out.warn("W_ALARM_CHATTER_RISK", file, p,
                         "no deadband and no delay: the alarm may chatter");
        }
        const json* en = get(a, "enabled");
        if (!(en && en->is_boolean() && !en->get<bool>())) instances += count;
    }

    if (instances > kAlarmMaxInstances)
        out.err("E_ALARM_COUNT", file, "/alarms", "more than 500 alarm instances");
    if (instances > kAlarmWarnInstances)
        out.warn("W_ALARM_COUNT_HIGH", file, "/alarms", "more than 200 alarm instances");
    if (bytes > kAlarmMaxFileBytes)
        out.err("E_ALARM_COUNT", file, "/alarms", "alarms.json is larger than 512 KiB");
    return instances;
}

}  // namespace

bool alarmTextTokensValid(const std::string& s) {
    size_t i = 0;
    while (i < s.size()) {
        const char c = s[i];
        if (c == '}') return false;
        if (c == '{') {
            const size_t j = s.find('}', i + 1);
            if (j == std::string::npos) return false;
            const std::string inner = s.substr(i + 1, j - i - 1);
            const bool formatted = inner.size() == 7 && inner.compare(0, 6, "value:") == 0 &&
                                   inner[6] >= '0' && inner[6] <= '6';
            if (!kTextTokens.count(inner) && !formatted) return false;
            i = j + 1;
        } else {
            ++i;
        }
    }
    return true;
}

size_t runAlarmRules(const AlarmRulesInput& in, std::vector<ProjectIssue>& errors,
                     std::vector<ProjectIssue>& warnings) {
    Sink out;
    const json& project = *in.project;
    const std::string version = project["schemaVersion"].get<std::string>();
    const bool hasAlarmFile = project.contains("alarmFile") && project["alarmFile"].is_string();
    const bool hasClassFile =
        project.contains("alarmClassFile") && project["alarmClassFile"].is_string();

    // alarm-classes.json
    std::optional<ClassMap> classes;
    if (!hasClassFile)
        classes = ClassMap{};
    else if (in.alarmClassesDoc)
        classes = checkClasses(out, project["alarmClassFile"].get<std::string>(),
                               *in.alarmClassesDoc, version);

    size_t instances = 0;
    if (hasAlarmFile && in.alarmsDoc) {
        std::map<std::string, json> tagInfo;
        if (in.tags && in.tags->contains("tags") && (*in.tags)["tags"].is_array())
            for (const auto& t : (*in.tags)["tags"])
                if (t.is_object() && t.contains("id") && t["id"].is_string())
                    tagInfo.emplace(t["id"].get<std::string>(), t);
        std::set<std::string> devices;
        if (!in.connectionsFailed && in.connections && in.connections->contains("channels"))
            for (const auto& ch : (*in.connections)["channels"])
                if (ch.is_object() && ch.contains("devices"))
                    for (const auto& d : ch["devices"])
                        if (d.is_object() && d.contains("id") && d["id"].is_string())
                            devices.insert(d["id"].get<std::string>());
        Refs refs;
        if (in.tags) refs.tags = &tagInfo;
        if (!in.connectionsFailed) refs.devices = &devices;
        if (classes) refs.classes = &*classes;
        refs.tagList = in.tags && in.tags->contains("tags") ? &(*in.tags)["tags"] : nullptr;
        instances = checkAlarms(out, project["alarmFile"].get<std::string>(), *in.alarmsDoc,
                                version, in.alarmsBytes, refs);
    }
    sortIssues(out.errors);
    sortIssues(out.warnings);
    for (auto& e : out.errors) errors.push_back(std::move(e));
    for (auto& w : out.warnings) warnings.push_back(std::move(w));
    return instances;
}

}  // namespace mat
