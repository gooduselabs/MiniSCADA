// What the runtime runs at start (specs/005-device-online data-model §9 "Quyết định lúc khởi
// động", research R13, contracts/device-config.md §7 step 3). decideBoot() is the table, a pure
// function; startStore() applies it to the store: what the decision writes is in state.json,
// synced, before startStore() returns, so bootAttempts has grown before the new version runs.
//
// Beyond the table (2026-10-11): the rolling-back phase counts bootAttempts too, so a version
// that cannot even be rolled back to (died twice, or incomplete) ends in the "no valid project"
// mode instead of a restart loop; a version that is not complete is never run.
#pragma once
#include <cstdint>
#include <functional>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "core/project-store/store.hpp"

namespace mat {

constexpr int kBootAttemptsMax = 2;  // the runtime died twice on the version: give up on it

struct BootInput {
    StateStatus status = StateStatus::Missing;
    StoreState state;                    // Ok
    std::string stateError;              // Corrupt
    std::set<int64_t> complete;          // complete versions, after the cleanup
    std::optional<LegacyStatus> legacy;  // status == Missing: the project of projectDir
};

enum class BootAction {
    Adopt,             // no state.json, valid legacy project: take it as v/1, run it
    RunLegacy,         // no state.json, legacy project invalid or empty: run projectDir as 0.3.0
    RunActive,         // run v/<active>
    TryNew,            // pending activating/health, bootAttempts < 2: run v/<to>, health check
    RollBack,          // the new version failed at start: run v/<from>, health check
    ContinueRollBack,  // pending rolling-back: run v/<from>, health check
    NoProject,         // no project in the store (active null)
    NoValidProject,    // rollback failed, version incomplete, state.json damaged: run nothing
};
const char* bootActionName(BootAction a);

struct BootDecision {
    BootAction action = BootAction::NoValidProject;
    std::optional<int64_t> runSeq;    // run v/<runSeq>/project
    bool healthCheck = false;         // the pending operation waits for the health check of runSeq
    std::optional<StoreState> write;  // state.json to write (fsync) before running anything
    std::string healthCode;           // the new version failed here: HEALTH_CRASH, HEALTH_PROJECT
    std::string rollbackCode;         // the rollback failed here: HEALTH_CRASH, HEALTH_PROJECT
    bool opEnded = false;             // the pending operation ends with this decision
    std::string reason;               // for people: log, NO_PROJECT_PACKAGE
};

BootDecision decideBoot(const BootInput& in);

struct BootHooks {
    std::function<LegacyProject()> legacy;  // called only when there is no state.json
    PackFn pack;                            // adoption
    StoreAuditFn audit;                     // project.adopt
    std::function<int64_t()> monoMs;        // empty: systemMonoMs
};

struct StoreStartup {
    StateStatus status = StateStatus::Missing;  // state.json as read, before any recovery
    bool recovered = false;                     // Corrupt: rebuilt from v/ (recoverState)
    std::string corruptFile;                    // recovered: where the damaged file went
    BootDecision decision;  // as applied (an adoption or a write that failed changes it)
    std::optional<PendingOperation> pending;  // pending of state.json as read, before the decision
    std::string runDir;                       // project directory to load; "" = none
    int64_t stateReadMonoMs = 0;  // when state.json was read: start of the 15 s health deadline
    std::vector<std::string> stagingRemoved;
    std::string error;  // open, adoption or write failure (logged)
};

// device-config §7 step 3: open, read state.json, cleanup, decideBoot, write the decision's state
// (synced) or adopt the legacy project, remove what became unreferenced. A write that fails
// never lets a pending version run: the decision becomes NoValidProject. Sets the store's
// noPackageReason.
StoreStartup startStore(ProjectStore& store, const BootHooks& hooks);

}  // namespace mat
