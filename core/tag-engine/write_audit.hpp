// What the write coordinator needs from the audit log (feature 006 T139; data-model §9). An
// interface, so that the coordinator is tested with a fake and the runtime plugs in AuditLog
// (audit.db version 2: the `tag_write_request` table and the actions tag.write / driver.test).
#pragma once
#include <cstdint>
#include <optional>
#include <string>

namespace mat {

// The account behind a request, as the session says (FR-039). A command that was accepted is
// carried through and audited under this identity even when the session ends or loses rights.
struct WriteCaller {
    std::string user;
    std::string role;        // "operator", ...
    std::string source;      // "IP:port"
    std::string sessionKey;  // the hash of the token: the key of the per-session rate limit
    bool administrator = false;
    std::string channel = "https";  // "https" | "http" | "live" (where the request came in)
};

// The facts of one command (FR-039): who, where from, which Tag and field device, the old value at
// receipt, the new one, the raw one after scaling.
struct WriteRecord {
    std::string requestId;
    WriteCaller who;
    std::string tag;
    std::string kind;     // external | internal | simulation
    std::string channel;  // id of the channel; "" for a Tag without one
    std::string device;   // id of the field device
    std::string oldJson;  // {"value": ..., "quality": "GOOD"} at receipt
    std::string newJson;  // the value to write, as JSON
    std::string rawJson;  // the raw value after inverse scaling; "" without scaling
    int64_t receivedWallMs = 0;
    // Feature 007 (device-api-1.2 §6): {"screen":"..","widget":".."} or ""; the pulse length, 0 for
    // none; the value the person expected (-1 none, 0 false, 1 true).
    std::string contextJson;
    int64_t pulseMs = 0;
    int expect = -1;
    // Feature 011 (FR-019): "" for a command of a person; "pulse-recovery" for the release of a
    // pulse the runtime owed (after a restart, or after a release that failed), with the request id
    // of that pulse in `pulseOf`. The audit puts them in `detail.source` and `detail.pulseOf`.
    std::string origin;
    std::string pulseOf;
    // Feature 011 (logic v2, FR-080): a command of a rule (origin "logic"): {"rule", "write",
    // "edgeId", "inputs": [[tag, value] ... at most 8]} as JSON; "" for any other command.
    std::string logicJson;
};

// The end of a command.
struct WriteOutcome {
    std::string result;  // ok | failed | interrupted (the `result` column of the audit row)
    std::string code;    // CONFIRMED, NO_READBACK, APPLIED, WRITE_TIMEOUT, ... UNKNOWN_OUTCOME
    std::string readbackJson;  // "" when none
    int exception = -1;        // Modbus exception code, -1 when none
    // Feature 007: the end of a pulse as JSON ({"valueMs":500,"released":true}); "" without one.
    std::string pulseJson;
};

// A command found in the table of accepted ones (after a restart the memory of the coordinator is
// empty, but the table keeps the request id for 15 minutes of running time).
struct StoredWrite {
    std::string requestId;
    std::string user;
    std::string tag;
    std::string newJson;
    bool finished = false;
    WriteOutcome outcome;
    int64_t receivedWallMs = 0;
    int64_t finishedWallMs = 0;
    bool clockOk = false;
};

class WriteAudit {
   public:
    virtual ~WriteAudit() = default;
    // The audit log can take records now.
    virtual bool available() = 0;
    // Transaction 1: the record of receipt and the request id, durable when it returns. Throws when
    // that cannot be done: the command is then refused (AUDIT_UNAVAILABLE) and nothing is sent.
    virtual void started(const WriteRecord& record) = 0;
    // Transaction 2: the record of the end, called from the coordinator's audit thread. Throws when
    // it cannot be written (the coordinator logs it).
    virtual void finished(const WriteRecord& record, const WriteOutcome& outcome) = 0;
    // A refused request or write (coalesced over 60 s by the log): `tag` and `valueJson` when they
    // could be read from the request.
    virtual void denied(const WriteCaller& who, const std::string& requestId,
                        const std::string& tag, const std::string& valueJson,
                        const std::string& code) = 0;
    virtual std::optional<StoredWrite> find(const std::string& requestId) = 0;
};

}  // namespace mat
