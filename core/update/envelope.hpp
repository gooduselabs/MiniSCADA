// The envelope of a .matupdate (contracts/update-package.md §1): a ustar archive of exactly three
// regular members, update.json (≤ 256 KiB), update.sig (≤ 128 B), payload.tar.gz (≤ the package
// limit), then the end of the archive. Only fixed-size reads: one 512-byte header, then at most the
// member's size (bounded before any allocation). Errors: UPDATE_PACKAGE_INVALID with detail code
// ENVELOPE_HEADER, ENVELOPE_ORDER, ENVELOPE_SIZE, ENVELOPE_EXTRA_MEMBER, ENVELOPE_TRUNCATED.
#pragma once
#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "core/update/update_error.hpp"

namespace mat::update {

constexpr size_t kTarBlock = 512;

// Bytes in order, from a file or memory. read() returns fewer than n only at the end.
class Source {
   public:
    virtual ~Source() = default;
    virtual size_t read(uint8_t* p, size_t n) = 0;
    // Back to byte `offset` (the payload is read twice: hashed, then listed). False: cannot.
    virtual bool seek(uint64_t offset) = 0;
};

class MemorySource : public Source {
   public:
    MemorySource(const uint8_t* data, size_t size) : data_(data), size_(size) {}
    size_t read(uint8_t* p, size_t n) override;
    bool seek(uint64_t offset) override;

   private:
    const uint8_t* data_;
    size_t size_;
    size_t pos_ = 0;
};

// A file opened read-only (O_NOFOLLOW is not used: the caller decides where it reads).
class FileSource : public Source {
   public:
    FileSource() = default;
    ~FileSource() override;
    FileSource(const FileSource&) = delete;
    FileSource& operator=(const FileSource&) = delete;
    bool open(const std::string& path, std::string& err);
    uint64_t size() const { return size_; }
    size_t read(uint8_t* p, size_t n) override;
    bool seek(uint64_t offset) override;

   private:
    int fd_ = -1;
    uint64_t size_ = 0;
};

// A whole regular file of at most `maxBytes` (open/read, no iostream: mat-update-verify stays
// small).
bool readFileLimited(const std::string& path, size_t maxBytes, std::string& out);

// Checks one ustar header block for member `wantName` of at most `maxSize` bytes and gives its
// size.
std::optional<Error> checkMemberHeader(const uint8_t* h, const char* wantName, uint64_t maxSize,
                                       uint64_t& size);

struct EnvelopeHead {
    std::string manifest;      // the bytes of update.json, as signed
    std::vector<uint8_t> sig;  // update.sig (DER)
    uint64_t end = 0;          // bytes of the source consumed by the two members
};

// Members 1 and 2.
std::optional<Error> readHead(Source& in, EnvelopeHead& head);

struct PayloadInfo {
    uint64_t offset = 0;  // of the payload's first byte, for Source::seek
    uint64_t size = 0;
};

// Member 3 and the end of the archive (no fourth member): the payload goes to `sink` in pieces as
// it is read (≤ 64 KiB each), never whole. Call right after readHead() on the same source.
std::optional<Error> readPayload(Source& in, uint64_t maxSize, const EnvelopeHead& head,
                                 PayloadInfo& info,
                                 const std::function<void(const uint8_t*, size_t)>& sink);

}  // namespace mat::update
