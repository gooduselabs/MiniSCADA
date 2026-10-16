#include "core/tag-engine/tag_model.hpp"

#include <cmath>

#include "core/expression/value_table_json.hpp"
#include "core/project-manager/rules_logic.hpp"

namespace mat {

using nlohmann::json;

const char* tagKindName(TagKind k) {
    switch (k) {
        case TagKind::External:
            return "external";
        case TagKind::Internal:
            return "internal";
        case TagKind::Calculated:
            return "calculated";
        default:
            return "simulation";
    }
}

std::optional<size_t> ProjectModel::tagIndex(const std::string& id) const {
    for (size_t i = 0; i < tags.size(); ++i)
        if (tags[i].id == id) return i;
    return std::nullopt;
}

namespace {

double dbl(const json& j, const char* key, double dflt) {
    auto it = j.find(key);
    return it != j.end() && it->is_number() ? it->get<double>() : dflt;
}
int integer(const json& j, const char* key, int dflt) {
    return static_cast<int>(dbl(j, key, dflt));
}
bool boolean(const json& j, const char* key, bool dflt) {
    auto it = j.find(key);
    return it != j.end() && it->is_boolean() ? it->get<bool>() : dflt;
}
std::string str(const json& j, const char* key, const std::string& dflt = std::string()) {
    auto it = j.find(key);
    return it != j.end() && it->is_string() ? it->get<std::string>() : dflt;
}

// A JSON scalar as the TagScalar of a Tag type (integers as int64_t / uint64_t, floats as double).
TagScalar scalarOf(const json& v, TagType type) {
    switch (type) {
        case TagType::BOOL:
            return v.is_boolean() ? v.get<bool>() : false;
        case TagType::STRING:
            return v.is_string() ? v.get<std::string>() : std::string();
        case TagType::FLOAT32:
            return v.is_number() ? static_cast<double>(static_cast<float>(v.get<double>())) : 0.0;
        case TagType::FLOAT64:
            return v.is_number() ? v.get<double>() : 0.0;
        case TagType::UINT16:
        case TagType::UINT32:
        case TagType::UINT64:
            return v.is_number() ? static_cast<uint64_t>(v.get<double>()) : uint64_t{0};
        default:
            return v.is_number() ? static_cast<int64_t>(v.get<double>()) : int64_t{0};
    }
}

TagScalar defaultInitial(TagType type) { return scalarOf(json(), type); }

drv::ScanGroup groupOf(const std::string& s) {
    if (s == "fast") return drv::ScanGroup::Fast;
    if (s == "slow") return drv::ScanGroup::Slow;
    return drv::ScanGroup::Normal;
}

TagType typeOf(const json& v, TagType dflt) {
    if (v.is_string()) {
        if (auto t = parseTagType(v.get<std::string>())) return *t;
    }
    return dflt;
}

}  // namespace

std::optional<ProjectModel> buildProjectModel(const LoadedProject& p, std::string* error) {
    auto fail = [&](const std::string& m) -> std::optional<ProjectModel> {
        if (error) *error = m;
        return std::nullopt;
    };
    ProjectModel m;
    const bool v02 = p.is02();
    m.legacy01 = !v02;

    // ---- value tables ----
    for (const auto& [name, doc] : p.valueTables) m.tables[name] = expr::valueTableFromJson(doc);

    // ---- connections ----
    if (v02 && p.connections.is_object()) {
        const json& c = p.connections;
        if (c.contains("scanGroups")) {
            m.scanGroupMs[0] = integer(c["scanGroups"], "fast", 250);
            m.scanGroupMs[1] = integer(c["scanGroups"], "normal", 1000);
            m.scanGroupMs[2] = integer(c["scanGroups"], "slow", 5000);
        }
        for (const auto& cj : c["channels"]) {
            ChannelModel ch;
            ch.id = cj["id"].get<std::string>();
            ch.name = str(cj, "name");
            ch.rtu = cj["kind"] == "modbus-rtu";
            ch.enabled = boolean(cj, "enabled", true);
            ch.requestGapMs = integer(cj, "requestGapMs", 0);
            if (ch.rtu) {
                const json& s = cj["serial"];
                ch.serialPort = s["port"].get<std::string>();
                ch.baud = integer(s, "baud", 9600);
                ch.dataBits = integer(s, "dataBits", 8);
                ch.parity = str(s, "parity", "even");
                ch.stopBits = integer(s, "stopBits", 1);
                ch.rs485 = boolean(s, "rs485", true);
                ch.dropEcho = boolean(s, "dropEcho", false);
                ch.silenceMs = integer(s, "silenceMs", 0);
            } else {
                const json& t = cj["tcp"];
                ch.host = t["host"].get<std::string>();
                ch.port = integer(t, "port", 502);
                ch.connectTimeoutMs = integer(t, "connectTimeoutMs", 3000);
                ch.reconnectMaxS = integer(t, "reconnectMaxS", 10);
            }
            const size_t ci = m.channels.size();
            for (const auto& dj : cj["devices"]) {
                DeviceModel d;
                d.id = dj["id"].get<std::string>();
                d.name = str(dj, "name");
                d.channel = ci;
                d.unitId = ch.rtu ? integer(dj, "slave", 1) : integer(dj, "unitId", 1);
                d.enabled = boolean(dj, "enabled", true);
                d.addressBase = integer(dj, "addressBase", 0);
                d.maxReadRegisters = integer(dj, "maxReadRegisters", 125);
                d.maxReadBits = integer(dj, "maxReadBits", 2000);
                d.maxGapRegisters = integer(dj, "maxGapRegisters", 10);
                d.maxGapBits = integer(dj, "maxGapBits", 64);
                d.byteOrder = modbus::parseByteOrder(str(dj, "byteOrder", "ABCD"))
                                  .value_or(modbus::ByteOrder::ABCD);
                d.timeoutMs = integer(dj, "timeoutMs", 1000);
                d.retries = integer(dj, "retries", ch.rtu ? 1 : 0);
                d.writeDeadlineMs = integer(dj, "writeDeadlineMs", 5000);
                if (dj.contains("write")) {
                    d.singleRegisterFc16 = str(dj["write"], "singleRegister", "fc06") == "fc16";
                    d.singleCoilFc15 = str(dj["write"], "singleCoil", "fc05") == "fc15";
                    const std::string bw = str(dj["write"], "registerBit", "none");
                    d.bitWrite = bw == "mask" ? drv::BitWrite::Mask
                                              : bw == "rmw" ? drv::BitWrite::ReadModifyWrite
                                                            : drv::BitWrite::None;
                }
                ch.devices.push_back(m.devices.size());
                m.devices.push_back(std::move(d));
            }
            m.channels.push_back(std::move(ch));
        }
    }

    // ---- tags ----
    for (const auto& tj : p.tags["tags"]) {
        TagModel t;
        t.id = tj["id"].get<std::string>();
        t.type = typeOf(tj["type"], TagType::FLOAT64);
        t.description = str(tj, "description");
        t.unit = str(tj, "unit");
        if (tj.contains("min") && tj["min"].is_number()) t.min = tj["min"].get<double>();
        if (tj.contains("max") && tj["max"].is_number()) t.max = tj["max"].get<double>();
        if (!v02) {
            // 0.1: {source: {kind: "mock", signal}} -> a legacy simulation Tag
            t.kind = TagKind::Simulation;
            sim::SimConfig c;
            c.kind = sim::SimKind::Legacy;
            c.signal = tj.contains("source") ? str(tj["source"], "signal") : std::string();
            t.sim = c;
            m.tags.push_back(std::move(t));
            continue;
        }
        const std::string kind = tj["kind"].get<std::string>();
        t.kind = kind == "external"
                     ? TagKind::External
                     : kind == "internal"
                           ? TagKind::Internal
                           : kind == "calculated" ? TagKind::Calculated : TagKind::Simulation;
        t.writable = str(tj, "access", "R") == "RW" && t.kind != TagKind::Calculated;
        if (tj.contains("limits")) {
            const json& l = tj["limits"];
            if (l.contains("min")) t.limits.min = l["min"].get<double>();
            if (l.contains("max")) t.limits.max = l["max"].get<double>();
            if (l.contains("maxLength")) t.limits.maxLength = integer(l, "maxLength", 0);
        }
        t.valueTable = str(tj, "valueTable");
        if (tj.contains("deadband")) t.deadband = tj["deadband"].get<double>();
        switch (t.kind) {
            case TagKind::External: {
                const json& s = tj["source"];
                t.source.device = s["device"].get<std::string>();
                t.source.address = s["address"].get<std::string>();
                t.source.group = groupOf(str(s, "scanGroup", "normal"));
                t.source.rawType = typeOf(s.contains("rawType") ? s["rawType"] : json(), t.type);
                t.source.stringLength = integer(s, "stringLength", 0);
                t.source.stringOrder = modbus::parseStringByteOrder(str(s, "stringByteOrder", "AB"))
                                           .value_or(modbus::StringByteOrder::AB);
                t.source.readback = boolean(s, "readback", true);
                for (size_t di = 0; di < m.devices.size(); ++di)
                    if (m.devices[di].id == t.source.device) {
                        t.device = di;
                        t.channel = m.devices[di].channel;
                        break;
                    }
                if (t.device == static_cast<size_t>(-1))
                    return fail("tag '" + t.id + "': field device '" + t.source.device +
                                "' not found");
                const DeviceModel& d = m.devices[t.device];
                t.source.byteOrder = s.contains("byteOrder")
                                         ? modbus::parseByteOrder(s["byteOrder"].get<std::string>())
                                               .value_or(d.byteOrder)
                                         : d.byteOrder;
                modbus::AddressOptions o;
                o.addressBase = d.addressBase;
                o.rawType = t.source.rawType;
                o.stringLength = t.source.stringLength;
                o.rw = t.writable;
                t.source.addr = modbus::parseAddress(t.source.address, o);
                if (!t.source.addr.ok)
                    return fail("tag '" + t.id + "': address " + t.source.address + ": " +
                                t.source.addr.error);
                t.disabled = !d.enabled || !m.channels[t.channel].enabled;
                if (tj.contains("scaling")) {
                    const json& s2 = tj["scaling"];
                    Scaling sc;
                    sc.rawMin = s2["rawMin"].get<double>();
                    sc.rawMax = s2["rawMax"].get<double>();
                    sc.engMin = s2["engMin"].get<double>();
                    sc.engMax = s2["engMax"].get<double>();
                    sc.clamp = boolean(s2, "clamp", false);
                    t.scaling = sc;
                }
                break;
            }
            case TagKind::Internal:
                t.initial = tj.contains("initial") ? scalarOf(tj["initial"], t.type)
                                                   : defaultInitial(t.type);
                t.retain = boolean(tj, "retain", false);
                break;
            case TagKind::Calculated:
                t.expression = str(tj, "expression");
                break;
            case TagKind::Simulation: {
                auto c = sim::simFromJson(tj["sim"]);
                if (!c) return fail("tag '" + t.id + "': unknown sim kind");
                t.sim = *c;
                break;
            }
        }
        m.tags.push_back(std::move(t));
    }
    // ---- feature 011: the outputs of logic.json, internal read-only Tags only their block sets
    // (contract §1; the same list the 1.0 checker appended to the Tags, rules_logic) ----
    if (p.is10() && p.logic.is_object()) {
        const json defs = logicTagDefs(p.logic, logicTagsFromList(p.tags));
        for (const json& d : defs) {
            TagModel t;
            t.id = d["id"].get<std::string>();
            t.kind = TagKind::Internal;
            t.type = parseTagType(d["type"].get<std::string>()).value_or(TagType::FLOAT64);
            t.writable = false;
            t.logicOwned = true;
            t.initial = defaultInitial(t.type);
            m.tags.push_back(std::move(t));
        }
    }
    return m;
}

}  // namespace mat
