// Types of the alarm engine (specs/009-alarms contracts/alarm-engine.md §2, §12, data-model §3–§6).
// Plain data, no I/O: shared by the engine, the store and the service. Not for the page/HTTP code.
#pragma once
#include <array>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace mat::alarm {

enum class AlarmKind : uint8_t { Digital, Limit, Quality };
enum class AlarmState : uint8_t { Normal, ActiveUnack, ActiveAck, RtnUnack };
enum class Priority : uint8_t { Critical = 1, Major = 2, Minor = 3, Advisory = 4 };
enum class ClosedBy : uint8_t { None, Return, Config, Disabled, RestartLost };
enum class QualityOn : uint8_t { Bad, NotGood };

const char* stateName(AlarmState s);  // NORMAL, ACTIVE_UNACK, ...
std::optional<AlarmState> parseStateName(std::string_view s);
const char* closedByName(ClosedBy c);  // return, config, disabled, restart-lost; "" for None
ClosedBy parseClosedBy(std::string_view s);
const char* priorityName(Priority p);  // critical, major, minor, advisory
std::optional<Priority> parsePriority(std::string_view s);
const char* kindName(AlarmKind k);  // digital, limit, quality

// One element per watched Tag, in the order of AlarmEngine::watchedTags().
struct TagSample {
    bool known = true;  // false: the Tag never had a value (revision 0)
    double value = 0;
    enum class Quality : uint8_t { Good, Uncertain, Bad } quality = Quality::Good;
    std::string_view reason;  // reason code of a quality other than GOOD; empty when GOOD
};

struct AlarmOptions {
    int chatterWindowS = 60;
    int chatterShelveS = 1800;
    int maxShelved = 50;
    // The device clock is usable from this epoch ms (the historian's build-time floor on the
    // device).
    int64_t clockOkFromMs = 1577836800000;  // 2020-01-01
};

// What the engine needs to know about a Tag (unit, value table, BOOL) for the alarm text.
struct AlarmTagInfo {
    std::string unit;
    std::map<std::string, std::string> labels;  // key "0", "1", "2" ... -> label
    bool isBool = false;
};

struct ClassDef {
    std::string id, name;
    Priority priority = Priority::Minor;
    std::string color = "gray";
    bool blink = false;
    bool requiresAck = true;
    bool ackReturn = false;
    std::string sound = "none";
    int chatterLimit = 5;  // 0 turns the self-shelving off
};

struct AreaDef {
    std::string id, name;
};

// One alarm instance (one per digital/quality alarm, one per threshold of a limit alarm).
struct InstanceDef {
    std::string id;         // "TANK_B1_LEVEL.HH" or the alarm id
    std::string defId;      // id of the alarm definition
    std::string limitName;  // "HH", "H", "L", "LL" or ""
    std::string name;
    std::string text;  // template of the alarm or threshold; "" = default of the kind (D9)
    std::string classId;
    std::string areaId;    // "" = "Chung"
    std::string tagId;     // alarm on a Tag; "" for a device alarm
    std::string deviceId;  // alarm on a device; "" for a Tag alarm
    AlarmKind kind = AlarmKind::Digital;
    bool trigger = true;  // digital: on when the truthiness equals this
    QualityOn on = QualityOn::Bad;
    double threshold = 0;
    double deadband = 0;
    int onDelayMs = 0;
    int offDelayMs = 0;
    int tagSlot = -1;              // index in AlarmDefs::tagIds
    std::vector<int> deviceSlots;  // quality on a device: indexes in AlarmDefs::tagIds
    std::string fingerprint;       // 16 hex characters of the condition
    bool isHigh() const { return limitName == "HH" || limitName == "H"; }
};

struct AlarmDefs {
    std::vector<InstanceDef> instances;  // order: file order; HH, H, L, LL inside a limit alarm
    std::vector<ClassDef> classes;
    std::vector<AreaDef> areas;
    std::vector<std::string> tagIds;    // watched Tags, deduplicated, first appearance
    std::vector<AlarmTagInfo> tagInfo;  // parallel to tagIds
    std::map<std::string, std::vector<int>> deviceTags;  // device id -> indexes in tagIds
};

// Row of alarm_occurrence (data-model §3). Full copy: the write queue keeps the newest per id.
struct OccurrenceRow {
    int64_t id = 0;
    std::string alarmId, fingerprint;
    int64_t tsActiveMs = 0;
    bool clockOk = true;
    std::optional<int64_t> tsAckMs;
    std::optional<std::string> ackUser;
    std::optional<int64_t> tsReturnMs, tsReturnAckMs;
    std::optional<std::string> returnAckUser;
    int priority = 3;  // 1..4
    std::string classId;
    std::optional<std::string> area;
    std::string text;
    std::string textFold;  // foldText(text + ' ' + alarmId + ' ' + area name), filled by the engine
    std::optional<double> valueActive;
    std::string qualityActive = "GOOD";  // GOOD, UNCERTAIN, BAD
    std::optional<std::string> reason;
    int flags = 0;  // bit 0 startup, bit 1 inputBad
    int repeatCount = 1;
    bool closed = false;
    ClosedBy closedBy = ClosedBy::None;
};

struct OverrideRow {
    std::string alarmId;
    std::string kind;  // "shelve" | "disable"
    std::string user, reason;
    bool system = false;
    int64_t tsStartMs = 0;
    bool clockOk = true;
    std::optional<int64_t> tsEndMs;  // shelve only
};

enum class CommandKind : uint8_t { Ack, Shelve, Unshelve, Disable, Enable };

struct Command {
    CommandKind kind = CommandKind::Ack;
    std::string id;
    int64_t occurrence = 0;
    std::string user;
    std::string reason;
    int durationS = 0;
    bool system = false;
};

struct CommandResult {
    std::string id;
    // ACKED, ALREADY_ACKED, NOT_ACTIVE, STALE, SHELVED, NOT_FOUND, OK, NOT_SHELVED,
    // ALREADY_DISABLED, NOT_DISABLED, SHELVE_RANGE
    std::string result;
    int64_t occurrence = 0;
    int64_t revision = 0;
    int64_t untilEpochMs = 0;  // shelve: wall clock end
};

struct AlarmEvent {
    enum class Kind : uint8_t {
        State,
        Shelve,
        Unshelve,
        Disable,
        Enable,
        Chatter,
        Command,
        Removed,
        Resync
    };
    Kind kind = Kind::State;
    int64_t tMono = 0, tEpoch = 0;
    bool clockOk = true;
    std::string instance;
    std::optional<AlarmState> from, to;
    int64_t occurrence = 0;  // 0 = none, or a "ghost" of a self-shelve episode
    ClosedBy closedBy = ClosedBy::None;
    std::string text;
    std::optional<double> value;
    std::string quality;  // GOOD, UNCERTAIN, BAD
    std::string reason;   // quality reason at the start; shelve/disable/unshelve: why
    bool startup = false, inputBad = false;
    std::string result;        // Command
    int count = 0;             // Chatter: number of starts
    std::string user;          // Shelve, Disable, Enable, Unshelve, Command: who
    bool system = false;       // Shelve/Unshelve done by the engine
    int64_t untilEpochMs = 0;  // Shelve
    int64_t revision = 0;
    std::optional<OccurrenceRow> row;  // the row after the event
};

struct Counts {
    int active = 0, unacked = 0, rtnUnack = 0, shelved = 0, disabled = 0;
    std::array<int, 4> unackedByPriority{}, activeByPriority{};  // index = priority - 1
};

struct ShelveInfo {
    std::string user, reason;
    int64_t untilEpochMs = 0;
    int remainingS = 0;
    bool system = false;
};

// AlarmItem of data-model §6.
struct AlarmItem {
    std::string id, defId, limit, name, classId, areaId;
    int priority = 3;
    AlarmState state = AlarmState::Normal;
    std::optional<ShelveInfo> shelve;
    bool disabled = false, inputBad = false;
    int64_t occurrence = 0;
    int64_t rev = 0;
    std::optional<int64_t> tsActiveMs;
    bool clockOk = true;
    std::optional<int64_t> tsAckMs;
    std::string ackUser;
    std::optional<int64_t> tsReturnMs;
    std::optional<double> value;
    std::string quality, reason, text;
    bool startup = false;
    int repeat = 1;
    std::string textFold;  // for the filter of ackAll; not sent
};

struct AlarmView {
    int64_t revision = 0;
    int64_t tsMs = 0;
    bool clockOk = true;
    bool clockJumpWhileOpen = false;
    Counts counts;
    std::vector<AlarmItem> items;  // instances that are not NORMAL, shelved or disabled
    std::unordered_map<std::string, size_t> index;  // id -> position in items
    const AlarmItem* find(const std::string& id) const {
        auto it = index.find(id);
        return it == index.end() ? nullptr : &items[it->second];
    }
};

struct AckFilter {
    std::optional<std::string> area;  // "" = Chung
    std::optional<std::string> classId;
    std::optional<int> priority;       // 1..4: this priority or higher
    std::optional<std::string> state;  // "unack" | "rtn"
    std::optional<std::string> q;
};

struct AckRequest {
    struct Item {
        std::string id;
        int64_t occurrence = 0;
    };
    bool all = false;
    std::vector<Item> items;
    int64_t upToRevision = 0;
    AckFilter filter;
};

struct AckTarget {
    std::string id;
    int64_t occurrence = 0;
    std::string result;  // ACKED, ALREADY_ACKED, NOT_ACTIVE, STALE, SHELVED, NOT_FOUND
};

struct LoadContext {
    std::vector<OccurrenceRow> open;  // closed = 0, by id ascending
    std::vector<OverrideRow> overrides;
    int64_t nowMonoMs = 0, nowEpochMs = 0;
    bool clockOk = true;
    bool processStart = true;  // false when the project is replaced while the process runs
    int64_t nextOccurrence = 1;
};

struct LoadReport {
    int instances = 0;
    std::vector<std::string> closedByReconcile;  // ids of the instances whose open row was closed
    std::vector<std::pair<std::string, std::string>> staleOverrides;  // (alarm id, kind) to delete
};

struct TextContext {
    AlarmKind kind = AlarmKind::Digital;
    std::string name, tag, unit, limitName, area, reason;
    std::optional<double> value;  // none or not finite: "n/a"
    std::optional<double> limit;
    bool isBool = false;
    const std::map<std::string, std::string>* labels = nullptr;
};
using TextTemplate = std::string;  // "" = default of the kind (D9)

}  // namespace mat::alarm
