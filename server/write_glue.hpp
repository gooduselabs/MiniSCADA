// The parts that join the tag write coordinator (core/tag-engine/write_coordinator.hpp) to the
// runtime (feature 006 T143, T145, T147): the audit log as the coordinator's audit, the drivers and
// the engine as its backend, and the hook of the live channel.
#pragma once
#include <cstdint>
#include <functional>
#include <string>

#include "core/audit/audit_log.hpp"
#include "core/tag-engine/write_coordinator.hpp"

namespace mat {

class RuntimeEngine;

// The coordinator's audit on audit.db version 2: the record of receipt and the table of request ids
// in one transaction (AuditLog::appendTagWriteStarted), the record of the end in another, the
// refusals as tag.write denied (coalesced by the log). The `detail` of a record is JSON of at most
// 1 KiB with requestId, kind, channel, device, old, new, raw, readback, exception.
class AuditLogWriteAudit : public WriteAudit {
   public:
    explicit AuditLogWriteAudit(AuditLog& log) : log_(log) {}
    bool available() override { return log_.isOpen(); }
    void started(const WriteRecord& record) override;
    void finished(const WriteRecord& record, const WriteOutcome& outcome) override;
    void denied(const WriteCaller& who, const std::string& requestId, const std::string& tag,
                const std::string& valueJson, const std::string& code) override;
    std::optional<StoredWrite> find(const std::string& requestId) override;

   private:
    AuditLog& log_;
};

// The drivers and the engine of a running project as the coordinator's backend.
class RuntimeWriteBackend : public WriteBackend {
   public:
    explicit RuntimeWriteBackend(RuntimeEngine& runtime) : rt_(runtime) {}
    drv::LinkState link(size_t tag) override;
    bool submit(size_t tag, drv::WriteCommand cmd) override;
    std::vector<uint64_t> cancelUnsent() override;
    int64_t maxTimeoutMs() override;

   private:
    RuntimeEngine& rt_;
};

// What the live hub calls for a {"type":"write"} message (live 1.2.0 §4): audit tag.write denied
// LIVE_WRITE_NOT_ALLOWED with the Tag and the value when they could be read.
std::function<void(const std::string& tag, const std::string& valueJson, uint64_t sid)>
liveRejectedWriteHook(WriteCoordinator& coordinator);

}  // namespace mat
