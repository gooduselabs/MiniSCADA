// Store of the retained internal Tags (FR-018; data-model §10; research R16): two files of 512 KiB
// made in advance in <dataDir>/retain/, written in place as a log of records with a CRC.
//
//   file   = header (64 bytes) + records: the first is a snapshot of every retained value, the rest
//            only the values that changed in a window; the rest of the file is zeros (or stale
//            bytes of an older generation, which the sequence check rejects)
//   save   = pwrite one record right after the last valid one, then fdatasync (the size of the file
//            never changes, so the file system writes no metadata: about one 4 KiB block per save)
//   full   = when less than twice the largest record is left, the whole state goes to the other
//   file:
//            body, fdatasync, header with generation + 1, fdatasync; from then on records go there
//   start  = pick the valid header with the highest generation, replay up to the first bad record
//            (a record cut by a power loss is dropped: only the changes of the last window are
//            lost)
//
// The values do not depend on the clock (a wrong RTC after a power loss does not matter). All file
// access goes through RetainIo, so tests count the calls, inject errors and cut the power at every
// step. Not thread safe: one thread (the runtime's save thread) owns it.
#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <string>
#include <vector>

#include "core/tag-engine/tag_store.hpp"

namespace mat {

class RetainIo {
   public:
    virtual ~RetainIo() = default;
    virtual bool exists(const std::string& name) = 0;
    virtual int64_t size(const std::string& name) = 0;  // -1: missing
    // New file of `size` zero bytes, fsync'ed once (and its directory). false: error (see
    // lastError).
    virtual bool createZeroed(const std::string& name, size_t size) = 0;
    virtual bool pread(const std::string& name, size_t offset, void* buf,
                       size_t n) = 0;  // all n bytes or false
    virtual bool pwrite(const std::string& name, size_t offset, const void* buf, size_t n) = 0;
    virtual bool fdatasync(const std::string& name) = 0;
    virtual bool rename(const std::string& from, const std::string& to) = 0;
    virtual bool remove(const std::string& name) = 0;
    virtual std::vector<std::string> list() = 0;  // names in the directory
    // errno-like text of the last failed call ("ENOSPC", "EIO", ...).
    virtual std::string lastError() const = 0;
};

// Real files in a directory (0700), files 0600.
class PosixRetainIo : public RetainIo {
   public:
    explicit PosixRetainIo(std::string dir);
    ~PosixRetainIo() override;
    bool ensureDir();
    bool exists(const std::string& name) override;
    int64_t size(const std::string& name) override;
    bool createZeroed(const std::string& name, size_t size) override;
    bool pread(const std::string& name, size_t offset, void* buf, size_t n) override;
    bool pwrite(const std::string& name, size_t offset, const void* buf, size_t n) override;
    bool fdatasync(const std::string& name) override;
    bool rename(const std::string& from, const std::string& to) override;
    bool remove(const std::string& name) override;
    std::vector<std::string> list() override;
    std::string lastError() const override { return error_; }
    const std::string& dir() const { return dir_; }

   private:
    int fdOf(const std::string& name);
    void closeFd(const std::string& name);
    bool fail(const char* what);

    std::string dir_;
    std::map<std::string, int> fds_;
    std::string error_;
};

struct RetainValue {
    TagType type = TagType::FLOAT64;
    TagScalar value;
};

enum class RetainStatus { Ok, Fresh, Fallback, Lost };
const char* retainStatusName(RetainStatus s);  // "ok" | "fresh" | "fallback" | "lost"

struct RetainDiag {
    RetainStatus status = RetainStatus::Fresh;
    std::string file;  // file in use
    uint64_t generation = 0;
    std::string lastError;  // ENOSPC, EIO ... of the last failed save
    uint64_t saves = 0;
    uint64_t compactions = 0;
    uint64_t bytesWritten = 0;
    size_t entries = 0;
};

class RetainStore {
   public:
    static constexpr size_t kFileSize = 512 * 1024;
    static constexpr size_t kHeaderSize = 64;
    static constexpr size_t kMaxString = 256;
    static constexpr const char* kFileA = "retain-a.bin";
    static constexpr const char* kFileB = "retain-b.bin";

    // `windowMs`: at most one save per window. `stamp`: text for the name of a damaged file's
    // `.corrupt-<stamp>` (injected in tests).
    RetainStore(RetainIo& io, int64_t windowMs, std::function<std::string()> stamp = nullptr);

    // Reads the files (or makes them). Never fails: a store that cannot be read starts empty
    // (Lost).
    RetainStatus open();

    // Values read at startup / kept now, by Tag id.
    const std::map<std::string, RetainValue>& values() const { return values_; }

    // The retained Tags of the project that starts: an entry of a Tag that is gone, or of another
    // type, is dropped and the files are compacted at the next flush ("drop" case of FR-018).
    void configure(const std::vector<std::pair<std::string, TagType>>& tags);

    // A retained Tag changed. Saved by flushIfDue / flushNow.
    void set(const std::string& id, TagType type, const TagScalar& value);

    // Saves the pending changes when a window has passed since the last save (monotonic ms).
    // Returns true when something was written.
    bool flushIfDue(int64_t monoMs);
    // Saves now, whatever the window (before execv); also the compaction a configure() asked for.
    bool flushNow(int64_t monoMs);
    bool hasPending() const { return !pending_.empty() || compactNeeded_; }

    RetainDiag diag() const;

    // Format helpers (also used by --retain-dump and the tests).
    static std::vector<uint8_t> encodeRecord(
        uint64_t seq, bool snapshot,
        const std::vector<std::pair<std::string, RetainValue>>& entries);

   private:
    struct Header {
        bool valid = false;
        uint64_t generation = 0;
        uint32_t snapshotLen = 0;
    };
    Header readHeader(const std::string& name);
    // Replays the records of a file: false when the snapshot is not valid.
    bool replay(const std::string& name, std::map<std::string, RetainValue>& out, size_t& writePos,
                uint64_t& lastSeq, size_t& maxRecord);
    bool writeSnapshotTo(const std::string& name,
                         uint64_t generation);  // body, fdatasync, header, fdatasync
    bool createFresh();
    void quarantine();
    bool save(int64_t monoMs, bool force);

    RetainIo& io_;
    int64_t windowMs_;
    std::function<std::string()> stamp_;
    std::map<std::string, RetainValue> values_;
    std::map<std::string, RetainValue> pending_;  // changed since the last save
    std::string current_;
    uint64_t generation_ = 0;
    size_t writePos_ = kHeaderSize;
    uint64_t seq_ = 0;
    size_t maxRecord_ = 0;
    int64_t lastSaveMono_ = INT64_MIN / 2;
    bool compactNeeded_ = false;
    bool opened_ = false;
    RetainDiag diag_;
};

}  // namespace mat
