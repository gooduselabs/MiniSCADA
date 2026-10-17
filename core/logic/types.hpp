// Types of the logic v2 engine (feature 011, T134; contracts/logic-engine.md; ADR-037), the C++
// twin of packages/logic-engine/src/types.ts. The document (logic.json) stays a JSON value: the
// engine reads a document that already passed the validator (core/project-manager/rules_logic),
// like TS.
#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <string>

#include "core/expression/expression.hpp"
#include "nlohmann/json.hpp"

namespace mat::logic {

// What the rules of logic need of a Tag of tags.json.
struct TagInfo {
    TagType type = TagType::FLOAT64;
    std::string kind = "external";          // external | internal | calculated | simulation
    bool rw = false;                        // access RW
    std::optional<std::string> expression;  // calculated: for E_LOGIC_SELF_TRIGGER
};
using TagInfoMap = std::map<std::string, TagInfo>;

// runtime.json `logic.*` and `tzOffsetMin` the engine needs.
struct Config {
    int scanMs = 100;
    int tzOffsetMin = 420;  // used by a schedule without its own tzOffsetMin
    bool writesOn = true;   // false (`logic.writes` off): write/pulse are SUPPRESSED
    int maxWritesPerMin = 20;
};

// The value of a logic Tag: bool, int64_t (et, counter value, starts), double; monostate: none.
struct Output {
    TagScalar value;
    bool good = true;
    std::string reason;  // when not good (TIME_NOT_SYNCED)
};

// The store of retained values by key logic/<id>/<field>: numbers, booleans, and the counter's
// INT64 as a decimal string (tests/logic-vectors/README.md "Kho retain").
using RetainMap = std::map<std::string, nlohmann::json>;

// The real-time clock of the schedules: UTC ms; nullopt or !synced: TIME_NOT_SYNCED.
struct WallClock {
    std::optional<int64_t> epochMs;
    bool synced = true;
};

// One action the engine produced (contracts §2, README "Quyết định" 7).
struct ActionOut {
    int64_t t = 0;
    std::string rule;
    int64_t edgeId = 0;
    std::string edge;  // rise | fall
    int index = 0;
    std::string doName;  // setTag | toggle | write | pulse
    std::string tag;     // the target (of the `writes` entry for write/pulse)
    std::string write;   // "" for setTag/toggle
    bool hasValue = false;
    TagScalar value;
    int64_t ms = -1;     // pulse only
    std::string result;  // OK QUEUED SUPPRESSED RATE_LIMITED OUT_OF_LIMITS EXPR_ERROR NO_VALUE
};

// GET /logic and the vectors' `state`.
struct BlockState {
    std::string kind;    // rule timer counter totalizer runhours schedule
    std::string state;   // OK SUSPENDED THROTTLED DISABLED
    std::string reason;  // "" none
    // rule only
    bool isRule = false;
    std::optional<bool> stable;
    int64_t edgeId = 0;
    std::optional<std::string> lastError;
    std::optional<int64_t> lastFiredMono;  // monotonic ms of the last firing
    int64_t fired = 0;                     // firings in this run
    // timer
    bool hasDegraded = false;
    bool degraded = false;
    // counter
    bool hasOverflow = false;
    bool overflow = false;
};

// The value of a Tag at the start of a scan.
using ReadTag = std::function<expr::InputValue(const std::string&)>;
// The same by slot (Engine::tags(): the Tag of each slot), what mat-runtime gives (T148).
using ReadAt = std::function<expr::InputValue(size_t slot)>;

// The type of a Tag type name of 006 ("BOOL", ...); nullopt when unknown.
std::optional<TagType> tagTypeOf(const std::string& name);

}  // namespace mat::logic
