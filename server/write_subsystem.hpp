// The tag write coordinator in the runtime (feature 006 T147; contracts/device-config.md §7):
// owns the audit adapter, the backend over the drivers and the engine, and the coordinator, and
// joins the three moments of the life of the runtime that concern writes.
//   - start-up step 2: recover() marks every command the last run left open as interrupted, before
//     any command is taken (never sent again); an audit log that cannot do it leaves the runtime
//     running and every write refused; then (feature 011) recoverPulses() hands the pulses the
//     journal still holds armed to the coordinator, which releases them as their channels connect;
//   - the tick loop: the results of the drivers (and of internal Tags) reach the coordinator
//     through the engine's write result handler; maintain() cleans the table of request ids every
//     10 minutes, and takes the request of `mat-runtime --pulse-ack` every 5 s (T202: a stat of
//     one path; the rare request costs two audit rows and a `done` line);
//   - before the execv: beforeRestart() quiesces the coordinator (FR-042), then stops the engine
//     as device-config §7 says (the retained Tags are written, the drivers stop).
#pragma once
#include <sys/types.h>

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/tag-engine/pulse_journal.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "core/tag-engine/write_coordinator.hpp"
#include "server/runtime_engine.hpp"
#include "server/system_warnings.hpp"
#include "server/write_glue.hpp"

namespace mat {

// Second review T202 (N-L3): the request of `mat-runtime --pulse-ack <rid|all>` (root): close
// the pulse journal entries reported as PULSE_STUCK once the bits were checked on the PLC by hand.
constexpr const char* kPulseAckFile = "pulse-ack.req";
constexpr int64_t kPulseAckPollMs = 5000;  // how often the runtime looks for it

// Feature 011 (FR-018, FR-019): the journal of pulses and what the start does with it.
struct PulseOptions {
    std::string journalPath;  // <dataDir>/pulse.journal; "" = no journal (the behaviour of 007)
    bool recovery = true;     // pulseRecovery "on"
    SystemWarnings* warnings = nullptr;  // PULSE_STUCK goes here
    // T202 (N-L3): <dataDir>/pulse-ack.req; "" = none. The owner the request must have (root);
    // tests: their own uid.
    std::string ackRequestPath;
    uid_t ackUid = 0;
};

// T202 (N-L3): takes the request of --pulse-ack at `path`, when there is one. A file that is not a
// regular file of `uid` without any group or other permission, or whose line does not read
// ("pulse-ack <rid|all> …"), is deleted and ignored. Otherwise: audit pulse.ack `started` (system)
// first, durably; without it nothing changes and the request stays (tried again); then `close`
// (the rid or "all"; it returns the entries closed and puts in `errors` the ones whose `done` line
// failed); then audit `ok` (or `failed` when a `done` line failed) with what was closed; the file
// is deleted. true when a request was applied. `log`: one line each time.
bool applyPulseAckRequest(const std::string& path, uid_t uid, AuditLog& audit,
                          const std::function<std::vector<PulseArm>(
                              const std::string& rid, std::vector<std::string>& errors)>& close,
                          const std::function<void(const std::string&)>& log);

class WriteSubsystem {
   public:
    // `runtime` must have an engine (a project is active); `store` and `audit` outlive this.
    // The journal is read (and compacted) here; recoverPulses() hands its armed entries over.
    WriteSubsystem(RuntimeEngine& runtime, TagStore& store, AuditLog& audit,
                   CoordinatorOptions options, PulseOptions pulse = {});
    ~WriteSubsystem();
    WriteSubsystem(const WriteSubsystem&) = delete;
    WriteSubsystem& operator=(const WriteSubsystem&) = delete;

    // Step 2 of the start-up. false: the audit log could not do it (down); the runtime goes on.
    bool recover();
    bool recovered() const { return recovered_; }

    WriteCoordinator& coordinator() { return *coordinator_; }

    // After step 2 (the open commands of the last run are interrupted): the pulses the journal
    // still holds armed are released as their channels connect (pulseRecovery on), or reported as
    // PULSE_STUCK (off). Returns how many there were. Never blocks.
    size_t recoverPulses();
    PulseJournal* pulseJournal() { return journal_.get(); }

    // The stop before the execv, in the order of device-config §7: quiesce, retained values,
    // drivers. The steps of feature 005 follow in the caller.
    WriteCoordinator::QuiesceReport beforeRestart();

    // On the tick loop: the table of request ids is cleaned every 10 minutes (monoMs:
    // CLOCK_BOOTTIME).
    void maintain(int64_t monoMs);

    // T202 (N-L3): the request of --pulse-ack (PulseOptions::ackRequestPath), applied to the
    // coordinator (WriteCoordinator::ackStuck). maintain() calls it every kPulseAckPollMs.
    bool applyPulseAck();

   private:
    RuntimeEngine& runtime_;
    AuditLog& audit_;
    AuditLogWriteAudit adapter_;
    RuntimeWriteBackend backend_;
    PulseOptions pulse_;
    std::unique_ptr<PulseJournal> journal_;
    std::vector<PulseArm> armedAtStart_;
    std::unique_ptr<WriteCoordinator> coordinator_;
    bool recovered_ = false;
    int64_t nextMaintainMs_ = 0;
    int64_t nextAckPollMs_ = 0;
};

}  // namespace mat
