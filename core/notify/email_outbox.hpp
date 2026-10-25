// The durable queue of emails to send (specs/023-alarm-email FR-003): <dir>/<seq>.mail, one JSON
// file per email (temporary file, fsync, rename), removed once sent. Bounded in count and bytes:
// a new email beyond the bounds pushes the oldest out. One write and one unlink per email: the
// eMMC budget of the BL335 (Constitution) is a few writes an hour. Not thread-safe (one owner).
#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace mat::notify {

struct OutboxEntry {
    std::string id;  // file name without ".mail" (16 digits, ascending)
    std::string kind = "alarm";
    std::string from;
    std::vector<std::string> to;
    std::string data;  // the whole MIME message (CRLF)
    int64_t createdEpochMs = 0;
    int items = 0;  // alarm events in it
};

struct OutboxDropped {
    std::string id;
    std::string reason;  // full, damaged
    size_t recipients = 0;
};

class EmailOutbox {
   public:
    // Creates <dir> (0700) when missing; lists what is there, removing damaged and temporary
    // files (reported by takeDropped()).
    bool open(const std::string& dir, size_t maxCount, int64_t maxBytes, std::string& err);
    // Writes `e` (its id is set here). Older entries go when the bounds are passed.
    bool add(OutboxEntry& e, std::string& err);
    std::vector<std::string> ids() const;                    // oldest first
    std::optional<OutboxEntry> load(const std::string& id);  // nullopt: gone or damaged
    void remove(const std::string& id);
    size_t count() const { return files_.size(); }
    int64_t bytes() const;
    std::vector<OutboxDropped> takeDropped();

   private:
    struct File {
        std::string id;
        int64_t bytes = 0;
        size_t recipients = 0;
    };
    std::string path(const std::string& id) const;
    std::string dir_;
    size_t maxCount_ = 100;
    int64_t maxBytes_ = 4 << 20;
    uint64_t nextSeq_ = 1;
    std::vector<File> files_;
    std::vector<OutboxDropped> dropped_;
};

}  // namespace mat::notify
