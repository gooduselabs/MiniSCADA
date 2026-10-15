// compileAlarms: alarms.json + alarm-classes.json (project 0.5) -> AlarmDefs (instances, classes,
// areas, watched Tags). specs/009-alarms contracts/alarm-engine.md §2 and project-format-0.5.md.
// The validator has already rejected bad projects; the checks here are the last line (count, refs).
#pragma once
#include <cstdint>
#include <map>
#include <string>
#include <string_view>
#include <vector>

#include "core/alarm/alarm_types.hpp"
#include "nlohmann/json.hpp"

namespace mat::alarm {

inline constexpr size_t kMaxInstances = 500;

struct ProjectView {
    nlohmann::json alarms;   // contents of alarms.json (object with "areas" and "alarms"), or null
    nlohmann::json classes;  // contents of alarm-classes.json (object with "classes"), or null
    std::map<std::string, AlarmTagInfo> tags;                 // Tag id -> unit, labels, isBool
    std::map<std::string, std::vector<std::string>> devices;  // device id -> Tags read from it
};

struct CompileResult {
    AlarmDefs defs;
    std::vector<std::string> errors;  // empty = ok
    bool ok() const { return errors.empty(); }
};

CompileResult compileAlarms(const ProjectView& project);

// FNV-1a 64 bit (offset 0xcbf29ce484222325, prime 0x100000001b3) over the bytes.
uint64_t fnv1a64(std::string_view bytes);
// FNV-1a 64 over "kind|target|limit|threshold|trigger|on" (UTF-8); 16 lower-case hex characters.
uint64_t fingerprint(const InstanceDef& d);
std::string fingerprintHex(const InstanceDef& d);

}  // namespace mat::alarm
