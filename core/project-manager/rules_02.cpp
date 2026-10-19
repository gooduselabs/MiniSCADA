#include "core/project-manager/rules_02.hpp"

#include <algorithm>
#include <cctype>
#include <cfloat>
#include <cmath>
#include <set>

#include "core/common/serial_match.hpp"
#include "core/expression/expression.hpp"
#include "core/expression/value_table_json.hpp"
#include "core/tag-engine/calc_graph.hpp"
#include "drivers/modbus/address.hpp"
#include "drivers/sdk/merge_planner.hpp"

namespace mat {

using nlohmann::json;

namespace {

constexpr size_t kMaxScreenTags = 1000;  // one live subscribe (live-ws.md)

const char* const kSupportedTargets[] = {"style.fill",           "style.stroke", "style.opacity",
                                         "style.visibility",     "text.content", "transform.rotate",
                                         "geometry.levelPercent"};

struct Range {
    double lo, hi;
};

Range typeRange(const std::string& t) {
    if (t == "INT16") return {-32768, 32767};
    if (t == "UINT16") return {0, 65535};
    if (t == "INT32") return {-2147483648.0, 2147483647.0};
    if (t == "UINT32") return {0, 4294967295.0};
    if (t == "INT64") return {-9223372036854775808.0, 9223372036854775808.0};
    if (t == "UINT64") return {0, 18446744073709551616.0};
    if (t == "FLOAT32") return {-3.4028234663852886e38, 3.4028234663852886e38};
    return {-DBL_MAX, DBL_MAX};  // FLOAT64
}

bool isNumericTag(const std::string& t) { return t != "BOOL" && t != "STRING"; }
bool isIntegerType(const std::string& t) {
    return t == "INT16" || t == "UINT16" || t == "INT32" || t == "UINT32" || t == "INT64" ||
           t == "UINT64";
}

bool scalarMatches(const std::string& t, const json& v) {
    if (t == "BOOL") return v.is_boolean();
    if (t == "STRING") return v.is_string();
    return v.is_number();
}

double num(const json& j, const char* key) { return j.at(key).get<double>(); }
bool has(const json& j, const char* key) {
    return j.is_object() && j.contains(key) && !j[key].is_null();
}

std::string lower(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

bool isDigit(char c) { return c >= '0' && c <= '9'; }

// E_SERIAL_PORT: core/common/serial_match.hpp (one rule for the validator and the API)
bool serialPortOk(const std::string& p) { return serialPortNameOk(p); }

bool directAccepts(const json& b, const std::string& t) {
    const std::string target = b["target"];
    const bool numeric = isNumericTag(t);
    if (target == "geometry.levelPercent" || target == "style.opacity") return numeric;
    if (target == "transform.rotate")
        return b.value("animation", "") == "spin" ? numeric || t == "BOOL" : numeric;
    if (target == "style.visibility") return t == "BOOL" || t == "STRING";
    if (target == "style.fill" || target == "style.stroke") return t == "STRING";
    return true;
}

struct DeviceRef {
    const json* device;
    const json* channel;
    size_t ci, di;
};

struct SpanKey {
    int start, end;
};

class Rules {
   public:
    Rules(const Rules02Input& in, std::vector<ProjectIssue>& e, std::vector<ProjectIssue>& w)
        : in_(in), errors_(e), warnings_(w), project_(*in.project) {}

    void run() {
        tagFile_ = project_.at("tagFile").get<std::string>();
        connFile_ = project_.value("connectionFile", std::string("connections.json"));
        if (project_.contains("valueTables"))
            for (const auto& n : project_["valueTables"])
                tableNames_.push_back(n.get<std::string>());
        tableSet_.insert(tableNames_.begin(), tableNames_.end());
        versionsAndProject();
        valueTables();
        connections();
        if (in_.tags) tagRules();
        watchTables();
        if (in_.logging) in_.logging(in_.tags ? &tagTypes_ : nullptr);
        screens();
    }

   private:
    void add(const char* code, const std::string& file, const std::string& path,
             const std::string& msg, int s = -1, int e = -1) {
        ProjectIssue i{code, file, path, msg};
        i.spanStart = s;
        i.spanEnd = e;
        errors_.push_back(std::move(i));
    }
    void warn(const char* code, const std::string& file, const std::string& path,
              const std::string& msg) {
        warnings_.push_back({code, file, path, msg});
    }
    static std::string idx(size_t i) { return std::to_string(i); }

    // ---- versions, runtime, project.json ----
    void versionsAndProject() {
        const std::string pv = project_["schemaVersion"].get<std::string>();
        std::vector<std::pair<std::string, std::string>> versions;
        if (in_.tags)
            versions.emplace_back(tagFile_, (*in_.tags)["schemaVersion"].get<std::string>());
        if (in_.connections && project_.contains("connectionFile"))
            versions.emplace_back(project_["connectionFile"].get<std::string>(),
                                  (*in_.connections)["schemaVersion"].get<std::string>());
        if (in_.loggingDoc && project_.contains("loggingFile"))
            versions.emplace_back(project_["loggingFile"].get<std::string>(),
                                  (*in_.loggingDoc)["schemaVersion"].get<std::string>());
        if (in_.reports && project_.contains("reportsFile"))
            versions.emplace_back(project_["reportsFile"].get<std::string>(),
                                  (*in_.reports)["schemaVersion"].get<std::string>());
        for (const auto& [name, d] : in_.valueTables)
            versions.emplace_back(d.file, d.doc["schemaVersion"].get<std::string>());
        for (const auto& [id, d] : in_.watchTables)
            versions.emplace_back(d.file, d.doc["schemaVersion"].get<std::string>());
        for (const auto& s : in_.screens) {
            versions.emplace_back(s.file, s.screen["schemaVersion"].get<std::string>());
            if (s.hasBindings)
                versions.emplace_back(s.screen["bindingFile"].get<std::string>(),
                                      s.bindings["schemaVersion"].get<std::string>());
        }
        const std::string prefix = in_.schema + ".";  // "0.2." .. "0.6.", "1.0."
        // "1.0": the 1.x family that shares the root schemas, 1.0.x and 1.1.x (feature 012)
        if (!isFormat(pv, prefix.c_str()) && !(in_.schema == "1.0" && isFormat(pv, "1.1.")))
            add("E_SCHEMA_VERSION", "project.json", "/schemaVersion",
                "schemaVersion " + pv + " is not " + in_.schema + ".x");
        for (const auto& [file, v] : versions)
            if (v != pv)
                add("E_SCHEMA_VERSION", file, "/schemaVersion",
                    "schemaVersion " + v + " differs from project.json (" + pv +
                        "): every file must match");
        const std::string minRt = project_["minRuntimeVersion"].get<std::string>();
        const char* minRuntime =
            in_.schema == "1.0"
                ? kMinRuntime10
                : in_.schema == "0.6"
                      ? kMinRuntime06
                      : in_.schema == "0.5"
                            ? kMinRuntime05
                            : in_.schema == "0.4"
                                  ? kMinRuntime04
                                  : in_.schema == "0.3" ? kMinRuntime03 : kMinRuntime02;
        if (compareSemver(minRt, minRuntime) < 0)
            add("E_MIN_RUNTIME", "project.json", "/minRuntimeVersion",
                std::string("minRuntimeVersion must be >= ") + minRuntime);
        if (compareSemver(minRt, in_.runtimeVersion) > 0)
            add("E_RUNTIME_TOO_OLD", "project.json", "/minRuntimeVersion",
                "Project needs runtime >= " + minRt + ", this runtime is " + in_.runtimeVersion);
        const double maxClients = project_["maxClients"].get<double>();
        if (maxClients < 1 || maxClients > 10)
            add("E_MAX_CLIENTS", "project.json", "/maxClients", "maxClients must be 1-10");
        bool entryFound = false;
        for (const auto& s : project_["screens"])
            if (s == project_["entryScreen"]) entryFound = true;
        if (!entryFound)
            add("E_SCREEN_ID", "project.json", "/entryScreen", "entryScreen is not in screens");

        if (tableNames_.size() > kLimitValueTables)
            add("E_LIMIT", "project.json", "/valueTables", "more than 256 value tables");
        std::set<std::string> seen;
        for (size_t i = 0; i < tableNames_.size(); ++i) {
            if (!seen.insert(lower(tableNames_[i])).second)
                add("E_DUP_ID", "project.json", "/valueTables/" + idx(i),
                    "value table '" + tableNames_[i] + "' is duplicated (case-insensitive)");
        }
        std::vector<std::string> watchIds;
        if (project_.contains("watchTables"))
            for (const auto& n : project_["watchTables"]) watchIds.push_back(n.get<std::string>());
        if (watchIds.size() > kLimitWatchTables)
            add("E_LIMIT", "project.json", "/watchTables", "more than 32 watch tables");
        std::set<std::string> seenW;
        for (size_t i = 0; i < watchIds.size(); ++i)
            if (!seenW.insert(watchIds[i]).second)
                add("E_DUP_ID", "project.json", "/watchTables/" + idx(i),
                    "watch table '" + watchIds[i] + "' is duplicated");
    }

    // ^0.[23].d+$ for the prefix "0.2." or "0.3."
    static bool isFormat(const std::string& v, const char* prefix) {
        const size_t n = std::string(prefix).size();
        if (v.size() <= n || v.compare(0, n, prefix) != 0) return false;
        for (size_t i = n; i < v.size(); ++i)
            if (!isDigit(v[i])) return false;
        return true;
    }

    // ---- value tables ----
    void valueTables() {
        for (const auto& [name, d] : in_.valueTables) {
            if (d.doc["name"].get<std::string>() != name)
                add("E_DUP_ID", d.file, "/name",
                    "name '" + d.doc["name"].get<std::string>() + "' differs from the file name '" +
                        name + "'");
            if (d.doc["entries"].size() > kLimitEntries)
                add("E_LIMIT", d.file, "/entries", "more than 256 entries");
            for (const auto& i : expr::validateValueTable(expr::valueTableFromJson(d.doc)))
                add(i.code.c_str(), d.file,
                    i.entry >= 0 ? "/entries/" + idx(static_cast<size_t>(i.entry))
                                 : "/default/text",
                    i.message);
        }
    }

    // ---- connections ----
    void connections() {
        if (!in_.connections) return;
        const json& chans = (*in_.connections)["channels"];
        if (chans.size() > kLimitChannels)
            add("E_LIMIT", connFile_, "/channels", "more than 16 channels");
        std::set<std::string> channelIds;
        std::map<std::string, size_t> ports;
        size_t deviceTotal = 0;
        for (size_t ci = 0; ci < chans.size(); ++ci) {
            const json& ch = chans[ci];
            const std::string cp = "/channels/" + idx(ci);
            const std::string id = ch["id"];
            if (!channelIds.insert(id).second)
                add("E_DUP_ID", connFile_, cp + "/id", "channel id '" + id + "' is duplicated");
            const json& devs = ch["devices"];
            if (devs.size() > kLimitDevicesPerChannel)
                add("E_LIMIT", connFile_, cp + "/devices",
                    "more than 32 field devices in one channel");
            deviceTotal += devs.size();
            for (size_t di = 0; di < devs.size(); ++di) {
                const std::string did = devs[di]["id"];
                if (deviceById_.count(did))
                    add("E_DUP_ID", connFile_, cp + "/devices/" + idx(di) + "/id",
                        "field device id '" + did + "' is duplicated");
                else
                    deviceById_[did] = {&devs[di], &ch, ci, di};
            }
            if (ch["kind"] == "modbus-rtu" && ch.contains("serial")) {
                const std::string port = ch["serial"]["port"];
                if (!serialPortOk(port)) {
                    add("E_SERIAL_PORT", connFile_, cp + "/serial/port",
                        "serial port '" + port + "' is not allowed");
                } else if (in_.serial) {
                    // a rule of the device: the list of the configuration, the console never
                    const bool console = in_.serial->isConsole && in_.serial->isConsole(port);
                    if (console || !serialPortInList(in_.serial->allowPatterns, port))
                        add("E_SERIAL_NOT_ALLOWED", connFile_, cp + "/serial/port",
                            "serial port '" + port + "' " +
                                (console ? "is the console of the system"
                                         : "is not in the serialPorts of this device"));
                }
                auto it = ports.find(port);
                if (it != ports.end())
                    add("E_SERIAL_SHARED", connFile_, cp + "/serial/port",
                        "port '" + port + "' is used by channel " + idx(it->second) + " too");
                else
                    ports[port] = ci;
            }
        }
        if (deviceTotal > kLimitDevices)
            add("E_LIMIT", connFile_, "/channels", "more than 64 field devices");
    }

    // ---- tags ----
    void tagRules() {
        const json& list = (*in_.tags)["tags"];
        if (list.size() > kLimitTags) add("E_LIMIT", tagFile_, "/tags", "more than 2000 tags");
        size_t calcCount = 0, retainCount = 0;
        for (size_t i = 0; i < list.size(); ++i) {
            const json& t = list[i];
            if (t["kind"] == "calculated") ++calcCount;
            if (t.value("retain", false)) ++retainCount;
            const std::string id = t["id"];
            if (!tagTypes_.count(id)) {
                tagTypes_[id] = t["type"].get<std::string>();
                tagIndex_[id] = i;
                if (has(t, "valueTable")) tagTable_[id] = t["valueTable"].get<std::string>();
            }
        }
        if (calcCount > kLimitCalculated)
            add("E_LIMIT", tagFile_, "/tags", "more than 500 calculated tags");
        if (retainCount > kLimitRetain)
            add("E_LIMIT", tagFile_, "/tags", "more than 500 retained tags");

        std::set<std::string> seenIds;
        scanGroups_ = {{"fast", 250}, {"normal", 1000}, {"slow", 5000}};
        if (in_.connections && in_.connections->contains("scanGroups"))
            for (auto it = (*in_.connections)["scanGroups"].begin();
                 it != (*in_.connections)["scanGroups"].end(); ++it)
                scanGroups_[it.key()] = it.value().get<double>();
        for (size_t i = 0; i < list.size(); ++i) {
            const json& t = list[i];
            const std::string p = "/tags/" + idx(i);
            const std::string id = t["id"];
            if (!seenIds.insert(id).second)
                add("E_DUP_TAG", tagFile_, p + "/id", "Tag '" + id + "' is duplicated");
            tagChecks(t, p);
            if (t["kind"] == "external" && t.contains("source")) externalChecks(t, p);
        }
        rtuScanTime();
        expressions(list);
    }

    void tagChecks(const json& t, const std::string& p) {
        const std::string type = t["type"];
        const std::string kind = t["kind"];
        const std::string id = t["id"];
        const bool numeric = isNumericTag(type);
        const bool hasRange = t.contains("min") || t.contains("max");
        if (hasRange && !numeric)
            add("E_TAG_RANGE", tagFile_, p, "min/max only apply to numeric tags ('" + id + "')");
        else if (t.contains("min") && t.contains("max") && num(t, "min") >= num(t, "max"))
            add("E_TAG_RANGE", tagFile_, p, "min must be less than max ('" + id + "')");
        const std::string access = t.value("access", "R");
        const std::string simKind = t.contains("sim") && t["sim"].contains("kind")
                                        ? t["sim"]["kind"].get<std::string>()
                                        : "";
        if (kind == "calculated" && access == "RW")
            add("E_TAG_ACCESS", tagFile_, p + "/access", "a calculated tag is always read-only");
        if (kind == "simulation" && access == "RW" && simKind != "manual")
            add("E_TAG_ACCESS", tagFile_, p + "/access", "only a manual simulation tag can be RW");
        if (t.contains("deadband") && (!numeric || num(t, "deadband") < 0))
            add("E_DEADBAND", tagFile_, p + "/deadband",
                "deadband applies to numeric tags and must be >= 0");
        if (t.contains("limits")) limitChecks(t, p);
        if (has(t, "valueTable") && !tableSet_.count(t["valueTable"].get<std::string>()))
            add("E_REF_TABLE", tagFile_, p + "/valueTable",
                "value table '" + t["valueTable"].get<std::string>() + "' does not exist");
        if (t.value("retain", false) && kind != "internal")
            add("E_RETAIN", tagFile_, p + "/retain", "retain only applies to internal tags");
        if (t.contains("initial")) initialChecks(t, p);
        if (t.contains("scaling")) scalingChecks(t, p);
        if (kind == "calculated" && t.contains("sim"))
            add("E_SIM", tagFile_, p + "/sim", "a calculated tag has no sim");
        else if (t.contains("sim"))
            simChecks(t, t["sim"], p);
        const bool writable =
            access == "RW" && (kind != "simulation" || simKind == "manual") && kind != "calculated";
        if (writable && numeric && !t.contains("limits"))
            warn("W_WRITE_NO_LIMITS", tagFile_, p + "/limits",
                 "numeric RW tag '" + id + "' has no limits");
    }

    void limitChecks(const json& t, const std::string& p) {
        const json& l = t["limits"];
        const std::string type = t["type"];
        const bool numeric = isNumericTag(type);
        if ((l.contains("min") || l.contains("max")) && !numeric)
            add("E_LIMITS", tagFile_, p + "/limits", "limits.min/max only apply to numeric tags");
        if (l.contains("maxLength") && type != "STRING")
            add("E_LIMITS", tagFile_, p + "/limits/maxLength",
                "limits.maxLength only applies to STRING tags");
        if (l.contains("min") && l.contains("max") && num(l, "min") > num(l, "max"))
            add("E_LIMITS", tagFile_, p + "/limits", "limits.min must be <= limits.max");
        if (numeric) {
            const Range r = typeRange(type);
            if ((l.contains("min") && (num(l, "min") < r.lo || num(l, "min") > r.hi)) ||
                (l.contains("max") && (num(l, "max") < r.lo || num(l, "max") > r.hi)))
                add("E_LIMITS", tagFile_, p + "/limits", "limits are outside the range of " + type);
        }
        if (l.contains("maxLength") && type == "STRING" &&
            (num(l, "maxLength") < 1 || num(l, "maxLength") > 1024))
            add("E_LIMITS", tagFile_, p + "/limits/maxLength", "limits.maxLength must be 1-1024");
    }

    void initialChecks(const json& t, const std::string& p) {
        const json& v = t["initial"];
        const std::string type = t["type"];
        const std::string path = p + "/initial";
        if (!scalarMatches(type, v)) {
            add("E_INITIAL", tagFile_, path, "initial has the wrong type for " + type);
            return;
        }
        if (v.is_number()) {
            const double x = v.get<double>();
            const Range r =
                // NOLINTNEXTLINE(bugprone-narrowing-conversions): INFINITY is exact in double
                (type == "BOOL" || type == "STRING") ? Range{-INFINITY, INFINITY} : typeRange(type);
            if (!std::isfinite(x) || x < r.lo || x > r.hi ||
                (isIntegerType(type) && std::floor(x) != x))
                add("E_INITIAL", tagFile_, path, "initial is outside the range of " + type);
        } else if (v.is_string()) {
            const size_t bytes = v.get<std::string>().size();
            if ((t.value("retain", false) && bytes > 256) ||
                (t.contains("limits") && t["limits"].contains("maxLength") &&
                 bytes > num(t["limits"], "maxLength")))
                add("E_INITIAL", tagFile_, path, "initial string is too long");
        }
    }

    void scalingChecks(const json& t, const std::string& p) {
        const json& s = t["scaling"];
        const std::string type = t["type"];
        const std::string path = p + "/scaling";
        if (type != "FLOAT32" && type != "FLOAT64")
            add("E_SCALING", tagFile_, path, "scaling requires type FLOAT32 or FLOAT64");
        const std::string raw = t.contains("source") && has(t["source"], "rawType")
                                    ? t["source"]["rawType"].get<std::string>()
                                    : type;
        if (!isNumericTag(raw))
            add("E_SCALING", tagFile_, path, "scaling requires a numeric rawType");
        if (num(s, "rawMin") == num(s, "rawMax"))
            add("E_SCALING", tagFile_, path, "rawMin must differ from rawMax");
        if (num(s, "engMin") == num(s, "engMax"))
            add("E_SCALING", tagFile_, path, "engMin must differ from engMax");
    }

    void simChecks(const json& t, const json& sim, const std::string& p) {
        const std::string path = p + "/sim";
        const std::string type = t["type"];
        const std::string kind = sim["kind"];
        auto bad = [&](const std::string& m) { add("E_SIM", tagFile_, path, m); };
        const bool numeric = isNumericTag(type);
        auto need = [&](std::initializer_list<const char*> keys) {
            for (const char* k : keys)
                if (!sim.contains(k)) {
                    bad("sim." + kind + " needs " + k);
                    return false;
                }
            return true;
        };
        if (kind == "const") {
            if (need({"value"}) && !scalarMatches(type, sim["value"]))
                bad("const value does not match " + type);
        } else if (kind == "ramp") {
            if (!numeric) bad("ramp needs a numeric tag, not " + type);
            need({"from", "to", "periodMs"});
        } else if (kind == "sine") {
            if (!numeric) bad("sine needs a numeric tag, not " + type);
            need({"center", "amplitude", "periodMs"});
        } else if (kind == "random") {
            if (!numeric && type != "BOOL") bad("random needs a numeric or BOOL tag, not " + type);
            if (need({"periodMs"}) && numeric) {
                if (need({"min", "max"}) && num(sim, "min") >= num(sim, "max"))
                    bad("random needs min < max");
            } else if (sim.contains("min") && sim.contains("max") &&
                       num(sim, "min") >= num(sim, "max")) {
                bad("random needs min < max");
            }
        } else if (kind == "square") {
            if (!numeric && type != "BOOL") bad("square needs a numeric or BOOL tag, not " + type);
            need({"periodMs"});
        } else if (kind == "manual") {
            if (need({"initial"}) && !scalarMatches(type, sim["initial"]))
                bad("manual initial does not match " + type);
        } else if (kind == "legacy") {
            need({"signal"});
        }
    }

    void externalChecks(const json& t, const std::string& p) {
        const json& src = t["source"];
        const std::string devId = src["device"];
        auto found = deviceById_.find(devId);
        if (found == deviceById_.end()) {
            if (in_.connections || !project_.contains("connectionFile"))
                add("E_REF_DEVICE", tagFile_, p + "/source/device",
                    "field device '" + devId + "' does not exist");
            return;
        }
        const json& dev = *found->second.device;
        const json& channel = *found->second.channel;
        const std::string type = t["type"];
        const std::string rawTypeName =
            has(src, "rawType") ? src["rawType"].get<std::string>() : type;
        if (rawTypeName == "STRING" && !src.contains("stringLength"))
            add("E_SCHEMA", tagFile_, p + "/source/stringLength",
                "STRING tag needs source.stringLength");
        if (rawTypeName != "STRING" && src.contains("stringLength"))
            add("E_SCHEMA", tagFile_, p + "/source/stringLength",
                "stringLength only applies to STRING");
        modbus::AddressOptions opts;
        opts.addressBase = static_cast<int>(dev.value("addressBase", 0.0));
        opts.rawType = parseTagType(rawTypeName).value_or(TagType::UINT16);
        opts.stringLength =
            src.contains("stringLength") ? static_cast<int>(num(src, "stringLength")) : 0;
        opts.rw = t.value("access", "R") == "RW";
        const std::string address = src["address"];
        const modbus::AddressResult r = modbus::parseAddress(address, opts);
        if (!r.ok) {
            add(r.error.c_str(), tagFile_, p + "/source/address",
                "address '" + address + "': " + r.error);
            return;
        }
        for (const auto& w : r.warnings)
            warn(w.c_str(), tagFile_, p + "/source/address",
                 "Modicon address on a device with addressBase 0");
        const bool isBit = r.area == modbus::Area::C || r.area == modbus::Area::DI;
        if (!isBit && r.registers > static_cast<int>(dev.value("maxReadRegisters", 125.0)))
            add("E_ADDR_READ_LIMIT", tagFile_, p + "/source",
                "the tag needs " + std::to_string(r.registers) +
                    " registers, more than one read allows");
        if (opts.rw && !isBit && r.registers > 123)
            add("E_ADDR_WRITE_LIMIT", tagFile_, p + "/source",
                "the tag needs " + std::to_string(r.registers) +
                    " registers, more than one write allows (123)");
        if (r.bit >= 0 && opts.rw) {
            const std::string mode =
                dev.contains("write") ? dev["write"].value("registerBit", "none") : "none";
            if (mode == "none")
                add("E_BIT_WRITE", tagFile_, p + "/source/address",
                    "device '" + devId + "' does not allow bit writes (write.registerBit is none)");
            else if (mode == "rmw" && bitRmwSeen_.insert(devId).second)
                warn("W_BIT_RMW", connFile_,
                     "/channels/" + idx(found->second.ci) + "/devices/" + idx(found->second.di),
                     "device '" + devId + "' writes bits by read-modify-write");
        }
        const std::string group = src.value("scanGroup", "normal");
        const double period = scanGroups_[group];
        const bool rtu = channel["kind"] == "modbus-rtu";
        const double retries = dev.value("retries", rtu ? 1.0 : 0.0);
        const double timeout = dev.value("timeoutMs", 1000.0);
        if (!slowSeen_.count(devId) && timeout * (retries + 1) > period) {
            slowSeen_.insert(devId);
            warn("W_DETECT_SLOW", connFile_,
                 "/channels/" + idx(found->second.ci) + "/devices/" + idx(found->second.di),
                 "timeoutMs x (retries + 1) exceeds the " + group + " scan period");
        }
        if (rtu && dev.value("enabled", true) && channel.value("enabled", true)) {
            auto& entry = rtuGroups_[channel["id"].get<std::string>()][group]
                                    [devId + "|" + modbus::areaName(r.area)];
            entry.area = r.area;
            entry.dev = &dev;
            entry.spans.push_back(
                {static_cast<size_t>(entry.spans.size()), r.offset, r.offset + r.registers});
        }
    }

    // ---- W_RTU_SCAN_TIME ----
    void rtuScanTime() {
        if (!in_.connections) return;
        const json& chans = (*in_.connections)["channels"];
        for (size_t ci = 0; ci < chans.size(); ++ci) {
            const json& ch = chans[ci];
            auto byGroup = rtuGroups_.find(ch["id"].get<std::string>());
            if (byGroup == rtuGroups_.end() || ch["kind"] != "modbus-rtu") continue;
            SerialFormat fmt;
            if (ch.contains("serial")) {
                fmt.baud = static_cast<int>(ch["serial"].value("baud", 9600.0));
                fmt.dataBits = static_cast<int>(ch["serial"].value("dataBits", 8.0));
                fmt.parity = ch["serial"].value("parity", "even");
                fmt.stopBits = static_cast<int>(ch["serial"].value("stopBits", 1.0));
            }
            for (const auto& [group, byArea] : byGroup->second) {
                double total = 0;
                for (const auto& [key, e] : byArea) {
                    const bool bits = e.area == modbus::Area::C || e.area == modbus::Area::DI;
                    const json& dev = *e.dev;
                    const int maxLen =
                        bits
                            ? std::min(2000, static_cast<int>(dev.value("maxReadBits", 2000.0)))
                            : std::min(125, static_cast<int>(dev.value("maxReadRegisters", 125.0)));
                    const int maxGap = bits ? static_cast<int>(dev.value("maxGapBits", 64.0))
                                            : static_cast<int>(dev.value("maxGapRegisters", 10.0));
                    for (const auto& b : drv::planBlocks(e.spans, maxGap, maxLen)) {
                        const int size = b.end - b.start;
                        total += rtuRequestTimeMs(fmt, bits ? (size + 7) / 8 : 2 * size);
                    }
                }
                const double period = scanGroups_[group];
                if (total > period)
                    warn("W_RTU_SCAN_TIME", connFile_, "/channels/" + idx(ci),
                         "estimated " +
                             std::to_string(static_cast<long long>(std::llround(total))) +
                             " ms for one " + group + " scan round, longer than the " +
                             std::to_string(static_cast<long long>(period)) + " ms period");
            }
        }
    }

    // ---- expressions ----
    void expressions(const json& list) {
        std::vector<CalcInput> nodes;
        std::set<std::string> done;
        for (size_t i = 0; i < list.size(); ++i) {
            const json& t = list[i];
            if (t["kind"] != "calculated") continue;
            const std::string id = t["id"];
            if (!done.insert(id).second) continue;  // duplicate id: E_DUP_TAG already
            const std::string p = "/tags/" + idx(i) + "/expression";
            expr::CompileEnv env;
            env.target = parseTagType(t["type"].get<std::string>()).value_or(TagType::FLOAT64);
            env.tagType = [&](const std::string& tid) -> std::optional<TagType> {
                auto it = tagTypes_.find(tid);
                if (it == tagTypes_.end()) return std::nullopt;
                return parseTagType(it->second);
            };
            env.hasTable = [&](const std::string& n) { return tableSet_.count(n) > 0; };
            const expr::CompileResult r = expr::compile(t.value("expression", std::string()), env);
            CalcInput node{id, {}};
            if (!r.ok) {
                const auto& e = r.errors[0];
                add(e.code.c_str(), tagFile_, p, e.message, static_cast<int>(e.s),
                    static_cast<int>(e.e));
            } else {
                node.inputs = r.program.inputs;
                for (const auto& w : r.warnings) warn(w.code.c_str(), tagFile_, p, w.message);
            }
            nodes.push_back(std::move(node));
        }
        const CalcGraph g(nodes);
        for (const auto& gi : g.issues())
            add(gi.code.c_str(), tagFile_, "/tags/" + idx(tagIndex_[gi.id]) + "/expression",
                gi.message);
    }

    // ---- watch tables ----
    void watchTables() {
        for (const auto& [id, d] : in_.watchTables) {
            if (d.doc["id"].get<std::string>() != id)
                add("E_DUP_ID", d.file, "/id",
                    "id '" + d.doc["id"].get<std::string>() + "' differs from the file name '" +
                        id + "'");
            const json& rows = d.doc["rows"];
            if (rows.size() > kLimitRows) add("E_LIMIT", d.file, "/rows", "more than 200 rows");
            if (in_.tags)
                for (size_t i = 0; i < rows.size(); ++i)
                    if (!tagTypes_.count(rows[i]["tag"].get<std::string>()))
                        warn("W_WATCH_REF", d.file, "/rows/" + idx(i) + "/tag",
                             "Tag '" + rows[i]["tag"].get<std::string>() + "' does not exist");
        }
    }

    // ---- screens and bindings (0.2; the screens of 0.3 are the business of rules_03) ----
    void screens() {
        for (const auto& s : in_.screens) {
            const json& screen = s.screen;
            if (screen["id"] != s.id)
                add("E_SCREEN_ID", s.file, "/id", "id differs from the file name '" + s.id + "'");
            std::set<std::string> uids;
            const json& els = screen["elements"];
            for (size_t i = 0; i < els.size(); ++i) {
                const std::string uid = els[i]["elementUid"];
                if (!uids.insert(uid).second)
                    add("E_DUP_UID", s.file, "/elements/" + idx(i) + "/elementUid",
                        "elementUid '" + uid + "' is duplicated");
            }
            if (!s.hasBindings) continue;
            const std::string bfile = screen["bindingFile"];
            const json& bs = s.bindings;
            if (bs["screenId"] != screen["id"])
                add("E_SCREEN_ID", bfile, "/screenId", "screenId differs from screen");
            std::set<std::string> boundTags;
            for (const auto& eb : bs["elements"])
                for (const auto& b : eb["bindings"])
                    boundTags.insert(b["source"]["tagId"].get<std::string>());
            if (boundTags.size() > kMaxScreenTags)
                add("E_SCREEN_TAGS", bfile, "/elements",
                    "screen '" + s.id + "' binds " + idx(boundTags.size()) + " tags, at most 1000");
            BindingCtx ctx;
            ctx.hasTags = in_.tags != nullptr;
            ctx.tagType = &tagTypes_;
            ctx.tagTable = &tagTable_;
            ctx.tableSet = &tableSet_;
            bindingRules(bs, bfile, uids, ctx,
                         [this](const char* code, const std::string& file, const std::string& path,
                                const std::string& msg) { add(code, file, path, msg); });
        }
    }

    struct RtuEntry {
        modbus::Area area = modbus::Area::HR;
        const json* dev = nullptr;
        std::vector<drv::PlanItem> spans;
    };

    const Rules02Input& in_;
    std::vector<ProjectIssue>& errors_;
    std::vector<ProjectIssue>& warnings_;
    const json& project_;
    std::string tagFile_, connFile_;
    std::vector<std::string> tableNames_;
    std::set<std::string> tableSet_;
    std::map<std::string, DeviceRef> deviceById_;
    std::map<std::string, std::string> tagTypes_;
    std::map<std::string, size_t> tagIndex_;
    std::map<std::string, std::string> tagTable_;
    std::map<std::string, double> scanGroups_;
    std::set<std::string> bitRmwSeen_, slowSeen_;
    std::map<std::string, std::map<std::string, std::map<std::string, RtuEntry>>> rtuGroups_;
};

}  // namespace

TypeRange typeRangeOf(const std::string& t) {
    const Range r = typeRange(t);
    return {r.lo, r.hi};
}
bool isNumericTagTypeName(const std::string& t) { return isNumericTag(t); }
bool isIntegerTagTypeName(const std::string& t) { return isIntegerType(t); }

namespace {

void bindingChecks(const BindingCtx& ctx, const BindingAdd& add, const std::string& bfile,
                   const std::string& bp, const json& b, std::set<std::string>& bindingIds) {
    const std::string id = b["id"];
    if (!bindingIds.insert(id).second)
        add("E_DUP_BINDING", bfile, bp + "/id", "binding id '" + id + "' is duplicated");
    const std::string target = b["target"];
    bool supported = false;
    for (const char* t : kSupportedTargets)
        if (target == t) supported = true;
    if (!supported) {
        add("E_TARGET_UNSUPPORTED", bfile, bp + "/target",
            "target '" + target + "' is not supported");
        return;
    }
    const json& tr = b["transform"];
    const std::string kind = tr["kind"];
    if (kind != "direct" && kind != "discreteMap" && kind != "linearScale" &&
        kind != "valueTable") {
        add("E_TRANSFORM_UNSUPPORTED", bfile, bp + "/transform/kind",
            "transform '" + kind + "' is not supported");
        return;
    }
    if (!ctx.hasTags) return;
    const std::string tagId = b["source"]["tagId"];
    auto it = ctx.tagType->find(tagId);
    if (it == ctx.tagType->end()) {
        add("E_REF_TAG", bfile, bp + "/source/tagId", "Tag '" + tagId + "' does not exist");
        return;
    }
    const std::string& t = it->second;
    if (kind == "valueTable") {
        std::string name;
        bool haveName = false;
        if (has(tr, "table")) {
            name = tr["table"].get<std::string>();
            haveName = true;
        } else if (auto tt = ctx.tagTable->find(tagId); tt != ctx.tagTable->end()) {
            name = tt->second;
            haveName = true;
        }
        if (!haveName || !ctx.tableSet->count(name))
            add("E_REF_TABLE", bfile, bp + "/transform/table",
                !haveName ? "no value table (neither table nor the Tag valueTable)"
                          : "value table '" + name + "' does not exist");
        if (t == "STRING")
            add("E_TYPE_MISMATCH", bfile, bp + "/transform",
                "valueTable needs a numeric or BOOL tag");
        const std::string output = tr["output"];
        const bool okTarget = output == "text"
                                  ? target == "text.content"
                                  : (target == "style.fill" || target == "style.stroke");
        if (!okTarget)
            add("E_TYPE_MISMATCH", bfile, bp + "/transform/output",
                "output '" + output + "' cannot be applied to '" + target + "'");
    } else if (kind == "linearScale") {
        if (!isNumericTag(t))
            add("E_TYPE_MISMATCH", bfile, bp + "/transform",
                "linearScale needs a numeric tag, '" + tagId + "' is " + t);
        if (num(tr, "inMin") == num(tr, "inMax"))
            add("E_SCALE_RANGE", bfile, bp + "/transform", "inMin must differ from inMax");
    } else if (kind == "discreteMap") {
        bool bad = false;
        for (const auto& cs : tr["cases"])
            if (!scalarMatches(t, cs["equals"])) bad = true;
        if (bad)
            add("E_TYPE_MISMATCH", bfile, bp + "/transform/cases",
                "equals must have the type of tag " + t);
    } else if (!directAccepts(b, t)) {
        add("E_TYPE_MISMATCH", bfile, bp + "/source/tagId",
            "tag " + t + " cannot be used directly for '" + target + "'");
    }
}

}  // namespace

void bindingRules(const json& bindings, const std::string& bfile, const std::set<std::string>& uids,
                  const BindingCtx& ctx, const BindingAdd& add) {
    std::set<std::string> boundUids, bindingIds;
    const json& bels = bindings["elements"];
    for (size_t i = 0; i < bels.size(); ++i) {
        const std::string ep = "/elements/" + std::to_string(i);
        const std::string uid = bels[i]["elementUid"];
        if (!boundUids.insert(uid).second)
            add("E_DUP_UID", bfile, ep + "/elementUid", "elementUid repeats in bindings");
        if (!uids.count(uid))
            add("E_REF_UID", bfile, ep + "/elementUid",
                "elementUid '" + uid + "' is not in the screen");
        const json& list = bels[i]["bindings"];
        for (size_t j = 0; j < list.size(); ++j)
            bindingChecks(ctx, add, bfile, ep + "/bindings/" + std::to_string(j), list[j],
                          bindingIds);
    }
}

double rtuRequestTimeMs(const SerialFormat& f, int dataBytes) {
    const int charBits = 1 + f.dataBits + (f.parity == "none" ? 0 : 1) + f.stopBits;
    const double t35 = f.baud <= 19200 ? (3.5 * charBits * 1000.0) / f.baud : 1.75;
    const double bytes = 8 + (5 + dataBytes);
    return (bytes * charBits * 1000.0) / f.baud + 2 * t35 + 10;
}

void runRules02(const Rules02Input& in, std::vector<ProjectIssue>& errors,
                std::vector<ProjectIssue>& warnings) {
    Rules(in, errors, warnings).run();
}

}  // namespace mat
