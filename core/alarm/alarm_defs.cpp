#include "core/alarm/alarm_defs.hpp"

#include <cstdio>
#include <map>
#include <set>

#include "core/alarm/alarm_text.hpp"

namespace mat::alarm {

using nlohmann::json;

const char* stateName(AlarmState s) {
    switch (s) {
        case AlarmState::Normal:
            return "NORMAL";
        case AlarmState::ActiveUnack:
            return "ACTIVE_UNACK";
        case AlarmState::ActiveAck:
            return "ACTIVE_ACK";
        case AlarmState::RtnUnack:
            return "RTN_UNACK";
    }
    return "NORMAL";
}

std::optional<AlarmState> parseStateName(std::string_view s) {
    if (s == "NORMAL") return AlarmState::Normal;
    if (s == "ACTIVE_UNACK") return AlarmState::ActiveUnack;
    if (s == "ACTIVE_ACK") return AlarmState::ActiveAck;
    if (s == "RTN_UNACK") return AlarmState::RtnUnack;
    return std::nullopt;
}

const char* closedByName(ClosedBy c) {
    switch (c) {
        case ClosedBy::None:
            return "";
        case ClosedBy::Return:
            return "return";
        case ClosedBy::Config:
            return "config";
        case ClosedBy::Disabled:
            return "disabled";
        case ClosedBy::RestartLost:
            return "restart-lost";
    }
    return "";
}

ClosedBy parseClosedBy(std::string_view s) {
    if (s == "return") return ClosedBy::Return;
    if (s == "config") return ClosedBy::Config;
    if (s == "disabled") return ClosedBy::Disabled;
    if (s == "restart-lost") return ClosedBy::RestartLost;
    return ClosedBy::None;
}

const char* priorityName(Priority p) {
    switch (p) {
        case Priority::Critical:
            return "critical";
        case Priority::Major:
            return "major";
        case Priority::Minor:
            return "minor";
        case Priority::Advisory:
            return "advisory";
    }
    return "minor";
}

std::optional<Priority> parsePriority(std::string_view s) {
    if (s == "critical") return Priority::Critical;
    if (s == "major") return Priority::Major;
    if (s == "minor") return Priority::Minor;
    if (s == "advisory") return Priority::Advisory;
    return std::nullopt;
}

const char* kindName(AlarmKind k) {
    switch (k) {
        case AlarmKind::Digital:
            return "digital";
        case AlarmKind::Limit:
            return "limit";
        case AlarmKind::Quality:
            return "quality";
    }
    return "digital";
}

uint64_t fnv1a64(std::string_view bytes) {
    uint64_t h = 14695981039346656037ULL;
    for (unsigned char c : bytes) {
        h ^= c;
        h *= 1099511628211ULL;
    }
    return h;
}

uint64_t fingerprint(const InstanceDef& d) {
    std::string s = kindName(d.kind);
    s += '|';
    s += d.deviceId.empty() ? d.tagId : "device:" + d.deviceId;
    s += '|';
    if (d.kind == AlarmKind::Limit) {
        s += d.limitName;
        s += '|';
        s += shortestDouble(d.threshold);
    } else {
        s += '|';
    }
    s += '|';
    if (d.kind == AlarmKind::Digital) s += d.trigger ? "1" : "0";
    s += '|';
    if (d.kind == AlarmKind::Quality) s += d.on == QualityOn::NotGood ? "notGood" : "bad";
    return fnv1a64(s);
}

std::string fingerprintHex(const InstanceDef& d) {
    char b[17];
    std::snprintf(b, sizeof b, "%016llx", static_cast<unsigned long long>(fingerprint(d)));
    return b;
}

namespace {

int slotOf(AlarmDefs& defs, std::map<std::string, int>& index, const std::string& tag,
           const std::map<std::string, AlarmTagInfo>& info) {
    auto it = index.find(tag);
    if (it != index.end()) return it->second;
    const int slot = static_cast<int>(defs.tagIds.size());
    defs.tagIds.push_back(tag);
    auto ti = info.find(tag);
    defs.tagInfo.push_back(ti == info.end() ? AlarmTagInfo{} : ti->second);
    index[tag] = slot;
    return slot;
}

}  // namespace

CompileResult compileAlarms(const ProjectView& project) {
    CompileResult out;
    AlarmDefs& defs = out.defs;
    auto fail = [&](const std::string& m) { out.errors.push_back(m); };

    std::set<std::string> classIds;
    if (project.classes.is_object() && project.classes.contains("classes")) {
        for (const json& c : project.classes["classes"]) {
            if (!c.is_object()) continue;
            ClassDef d;
            d.id = c.value("id", "");
            d.name = c.value("name", d.id);
            d.priority = parsePriority(c.value("priority", "minor")).value_or(Priority::Minor);
            d.color = c.value("color", "gray");
            d.blink = c.value("blink", false);
            d.requiresAck = c.value("requiresAck", true);
            d.ackReturn = c.value("ackReturn", false);
            d.sound = c.value("sound", "none");
            d.chatterLimit = c.value("chatterLimit", 5);
            if (d.id.empty() || !classIds.insert(d.id).second) {
                fail("E_ALARM_CLASS_DUP: " + d.id);
                continue;
            }
            defs.classes.push_back(d);
        }
    }
    std::set<std::string> areaIds;
    if (project.alarms.is_object() && project.alarms.contains("areas")) {
        for (const json& a : project.alarms["areas"]) {
            if (!a.is_object()) continue;
            AreaDef d;
            d.id = a.value("id", "");
            d.name = a.value("name", d.id);
            if (!areaIds.insert(d.id).second) {
                fail("E_ALARM_AREA_DUP: " + d.id);
                continue;
            }
            defs.areas.push_back(d);
        }
    }
    std::map<std::string, int> tagIndex;
    std::set<std::string> alarmIds;
    size_t count = 0;
    if (project.alarms.is_object() && project.alarms.contains("alarms")) {
        for (const json& a : project.alarms["alarms"]) {
            if (!a.is_object()) continue;
            const std::string id = a.value("id", "");
            if (!alarmIds.insert(id).second) fail("E_ALARM_ID_DUP: " + id);
            if (!a.value("enabled", true)) continue;
            const std::string type = a.value("type", "");
            InstanceDef base;
            base.defId = id;
            base.name = a.value("name", id);
            base.areaId = a.value("area", "");
            base.onDelayMs = a.value("onDelayMs", 0);
            base.offDelayMs = a.value("offDelayMs", 0);
            base.tagId = a.value("tag", "");
            base.deviceId = a.value("device", "");
            auto checkClass = [&](const std::string& c) {
                if (!classIds.count(c)) fail("E_ALARM_CLASS_REF: " + id + " -> " + c);
            };
            if (type == "limit") {
                base.kind = AlarmKind::Limit;
                base.deadband = a.value("deadband", 0.0);
                const json limits = a.value("limits", json::object());
                for (const char* name : {"HH", "H", "L", "LL"}) {
                    if (!limits.contains(name)) continue;
                    const json& l = limits[name];
                    InstanceDef d = base;
                    d.id = id + "." + name;
                    d.limitName = name;
                    d.threshold = l.value("value", 0.0);
                    d.classId = l.value("class", "");
                    d.text = l.contains("text") ? l.value("text", "") : a.value("text", "");
                    checkClass(d.classId);
                    d.tagSlot = slotOf(defs, tagIndex, d.tagId, project.tags);
                    d.fingerprint = fingerprintHex(d);
                    defs.instances.push_back(std::move(d));
                    ++count;
                }
                if (limits.empty()) fail("E_ALARM_LIMIT_NONE: " + id);
            } else {
                InstanceDef d = base;
                d.id = id;
                d.classId = a.value("class", "");
                d.text = a.value("text", "");
                checkClass(d.classId);
                if (type == "digital") {
                    d.kind = AlarmKind::Digital;
                    d.trigger = a.value("trigger", true);
                    d.tagSlot = slotOf(defs, tagIndex, d.tagId, project.tags);
                } else if (type == "quality") {
                    d.kind = AlarmKind::Quality;
                    d.on = a.value("on", "bad") == "notGood" ? QualityOn::NotGood : QualityOn::Bad;
                    if (!d.deviceId.empty()) {
                        auto dv = project.devices.find(d.deviceId);
                        if (dv != project.devices.end()) {
                            for (const auto& t : dv->second)
                                d.deviceSlots.push_back(slotOf(defs, tagIndex, t, project.tags));
                        }
                        defs.deviceTags[d.deviceId] = d.deviceSlots;
                    } else {
                        d.tagSlot = slotOf(defs, tagIndex, d.tagId, project.tags);
                    }
                } else {
                    fail("E_ALARM_TYPE: " + id);
                    continue;
                }
                d.fingerprint = fingerprintHex(d);
                defs.instances.push_back(std::move(d));
                ++count;
            }
        }
    }
    if (count > kMaxInstances) fail("E_ALARM_COUNT: " + std::to_string(count));
    return out;
}

}  // namespace mat::alarm
