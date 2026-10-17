// The durable journal of pulses (feature 011 T045; FR-018 to FR-020; research R6, D10; data-model
// §1.1): <dataDir>/pulse.journal. Before the first write of a pulse turns a command bit on, an
// `arm` line (request id, Tag, the value that releases it, when it is due) is appended and
// fdatasync'ed; after the device confirmed the release, a `done` line. A `kill -9` or a power cut
// in the middle of a pulse therefore leaves an `armed` entry (an `arm` without its `done`), and the
// next start writes the release value (WriteCoordinator::recoverPulses). An `arm` that cannot be
// made durable stops the pulse before anything is sent (PULSE_JOURNAL_FAILED): a bit is never
// turned on without a record of how to release it.
//
// The file: one JSON object per line, opened O_APPEND, mode 0600. A line cut by a power loss (the
// last one), or a line with a field of the wrong type (a negative seq too), is ignored and counted.
// compact() rewrites the armed entries only (temporary file, fsync, rename, fsync of the
// directory); it runs at start and when the file holds more than 256 lines.
//
// Thread safe: arm() runs on the HTTP workers, done() on the coordinator's threads.
#pragma once
#include <cstdint>
#include <istream>
#include <mutex>
#include <string>
#include <vector>

namespace mat {

// One armed pulse.
struct PulseArm {
    std::string rid;   // the request id of the pulse command
    std::string tag;   // Tag id
    bool rel = false;  // the value that releases it (the rest state)
    int64_t dueMono = 0;
    int64_t dueWallMs = 0;  // written as ISO 8601 (dueWall)
    std::string src;        // api | web | logic
    std::string by;         // the account, or logic:<ruleId>
    uint64_t seq = 0;       // set by the journal
    // T062: the target the bit was turned on at (channel id, field device id, source address; ""
    // for a Tag that is not External). A recovery whose Tag now points elsewhere writes nothing
    // (PULSE_STUCK). false: a line written before (no check).
    bool hasTarget = false;
    std::string channel, device, address;
};

// What the write coordinator needs from the journal: an interface, so that tests observe the order
// of the journal and the driver and inject failures.
class PulseLog {
   public:
    virtual ~PulseLog() = default;
    // Durable when it returns true; false (with `error`): nothing may be sent.
    virtual bool arm(PulseArm entry, std::string& error) = 0;
    // The release was confirmed. false: the entry stays armed (a later start releases it again,
    // which writes the rest state once more and is harmless).
    virtual bool done(const std::string& rid, std::string& error) = 0;
};

class PulseJournal : public PulseLog {
   public:
    static constexpr size_t kCompactLines = 256;

    explicit PulseJournal(std::string path);
    ~PulseJournal() override;
    PulseJournal(const PulseJournal&) = delete;
    PulseJournal& operator=(const PulseJournal&) = delete;

    // Reads the file (a missing one is empty): the armed entries in the order of their `seq`.
    // Unreadable lines are skipped and counted. Then compacts when there is anything to drop.
    std::vector<PulseArm> load(std::string* error = nullptr);

    bool arm(PulseArm entry, std::string& error) override;
    bool done(const std::string& rid, std::string& error) override;
    // Rewrites the file with the armed entries only.
    bool compact(std::string& error);

    std::vector<PulseArm> armed() const;
    size_t lines() const;
    size_t badLines() const;
    const std::string& path() const { return path_; }

    // The JSON line of an entry, and its reading (tests, --check-data).
    static std::string armLine(const PulseArm& e);
    static std::string doneLine(const std::string& rid, uint64_t seq);
    // The lines of a journal read without touching the file (load() then compacts; --check-data
    // does not): the armed entries by seq, the lines, the unreadable ones, the ones a compaction
    // would drop.
    struct Parsed {
        std::vector<PulseArm> armed;
        size_t lines = 0;
        size_t bad = 0;
        size_t dropped = 0;
        uint64_t maxSeq = 0;
    };
    static Parsed parse(std::istream& in);

   private:
    bool appendLocked(const std::string& line, std::string& error);
    bool openLocked(std::string& error);
    bool compactLocked(std::string& error);

    std::string path_;
    mutable std::mutex mu_;
    int fd_ = -1;
    std::vector<PulseArm> armed_;  // by seq
    uint64_t seq_ = 0;
    size_t lines_ = 0;
    size_t bad_ = 0;
};

}  // namespace mat
