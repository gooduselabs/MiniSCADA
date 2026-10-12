// The tag write coordinator in the runtime (feature 006 T147; contracts/device-config.md §7):
// owns the audit adapter, the backend over the drivers and the engine, and the coordinator, and
// joins the three moments of the life of the runtime that concern writes.
//   - start-up step 2: recover() marks every command the last run left open as interrupted, before
//     any command is taken (never sent again); an audit log that cannot do it leaves the runtime
//     running and every write refused;
//   - the tick loop: the results of the drivers (and of internal Tags) reach the coordinator
//     through the engine's write result handler; maintain() cleans the table of request ids every
//     10 minutes;
//   - before the execv: beforeRestart() quiesces the coordinator (FR-042), then stops the engine
//     as device-config §7 says (the retained Tags are written, the drivers stop).
#pragma once
#include <cstdint>
#include <memory>

#include "core/audit/audit_log.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "core/tag-engine/write_coordinator.hpp"
#include "server/runtime_engine.hpp"
#include "server/write_glue.hpp"

namespace mat {

class WriteSubsystem {
   public:
    // `runtime` must have an engine (a project is active); `store` and `audit` outlive this.
    WriteSubsystem(RuntimeEngine& runtime, TagStore& store, AuditLog& audit,
                   CoordinatorOptions options);
    ~WriteSubsystem();
    WriteSubsystem(const WriteSubsystem&) = delete;
    WriteSubsystem& operator=(const WriteSubsystem&) = delete;

    // Step 2 of the start-up. false: the audit log could not do it (down); the runtime goes on.
    bool recover();
    bool recovered() const { return recovered_; }

    WriteCoordinator& coordinator() { return *coordinator_; }

    // The stop before the execv, in the order of device-config §7: quiesce, retained values,
    // drivers. The steps of feature 005 follow in the caller.
    WriteCoordinator::QuiesceReport beforeRestart();

    // On the tick loop: the table of request ids is cleaned every 10 minutes (monoMs:
    // CLOCK_BOOTTIME).
    void maintain(int64_t monoMs);

   private:
    RuntimeEngine& runtime_;
    AuditLog& audit_;
    AuditLogWriteAudit adapter_;
    RuntimeWriteBackend backend_;
    std::unique_ptr<WriteCoordinator> coordinator_;
    bool recovered_ = false;
    int64_t nextMaintainMs_ = 0;
};

}  // namespace mat
