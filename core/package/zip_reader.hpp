// The ZIP subset of .matscada packages (specs/005-device-online/contracts/matscada-package.md §2,
// §8a): random-access sources, the walk of the central directory with the rules of every entry,
// and decompression that counts the real bytes. No number of the package is trusted before it is
// checked: buffers are bounded by the limits of §6, the package is read in pieces (pread), never
// whole.
#pragma once
#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "core/package/package_rules.hpp"

namespace mat {

// Random-access bytes of a package.
class PackageSource {
   public:
    virtual ~PackageSource() = default;
    virtual uint64_t size() const = 0;
    // Exactly `n` bytes at `offset` into `out`; false on an I/O error or past the end.
    virtual bool readAt(uint64_t offset, void* out, size_t n) = 0;
};

// Bytes already in memory (tests, small bodies). The bytes must outlive the source.
class MemorySource final : public PackageSource {
   public:
    explicit MemorySource(std::string_view bytes) : bytes_(bytes) {}
    uint64_t size() const override { return bytes_.size(); }
    bool readAt(uint64_t offset, void* out, size_t n) override;

   private:
    std::string_view bytes_;
};

// A regular file, opened read-only and read with pread: memory does not grow with its size.
class FileSource final : public PackageSource {
   public:
    // nullptr and `error` set when the file cannot be opened or is not a regular file.
    static std::unique_ptr<FileSource> open(const std::string& path, std::string& error);
    ~FileSource() override;
    FileSource(const FileSource&) = delete;
    FileSource& operator=(const FileSource&) = delete;

    uint64_t size() const override { return size_; }
    bool readAt(uint64_t offset, void* out, size_t n) override;

   private:
    FileSource(int fd, uint64_t size) : fd_(fd), size_(size) {}
    int fd_;
    uint64_t size_;
};

// One entry of the central directory that passed the rules of stage 3.
struct ZipEntry {
    std::string name;     // 1–128 bytes of UTF-8, rules 1–8 of §5 passed
    uint16_t method = 0;  // 0 stored, 8 deflate
    uint32_t crc32 = 0;   // as declared, the same in both headers
    uint32_t compressedSize = 0;
    uint32_t size = 0;        // declared size after decompression
    uint64_t dataOffset = 0;  // first byte of the (compressed) data
};

// Stages 1–3 of the check order (§8a), first error wins:
// 1. the package size (E_PKG_TOO_LARGE), before reading anything;
// 2. the end of central directory record: exactly the last 22 bytes, no comment, one disk
//    (E_PKG_FORMAT), 1–1024 entries (E_PKG_ENTRIES), central directory right before it
//    (E_PKG_FORMAT);
// 3. every entry in central directory order: the record and its bounds (E_PKG_FORMAT, no path);
//    name 1–128 bytes of UTF-8 (E_PKG_PATH); version needed ≤ 20, method 0 or 8, flags (bit 11,
//    bits 1–2 with deflate), no extra field, comment or other disk (E_PKG_FORMAT); host 0 or 3
//    and file type (symlink, directory: E_PKG_PATH; other non-regular type: E_PKG_FORMAT); path
//    rules 1–5, 8, 7 (E_PKG_PATH), then 6 (E_PKG_TYPE); layout: the local header at the end of
//    the previous entry, the first at 0 (E_PKG_FORMAT, no path); the local header equal to the
//    central one (E_PKG_FORMAT); stored data as long as declared (E_PKG_FORMAT). After the last
//    entry: nothing left between it and the central directory, nor after the last record.
// I/O errors of the source: STORE_IO. On success `entries` holds every entry in central
// directory order (the first one is not checked to be the manifest here).
std::optional<PackageError> readZipDirectory(PackageSource& src, std::vector<ZipEntry>& entries);

// The bytes of one entry into `out` (resized to entry.size): stored data as it is, deflate data
// through tinfl into a buffer of exactly the declared size. E_PKG_FORMAT with the entry name when
// the deflate data is corrupt, gives more or fewer bytes than declared (it stops as soon as the
// buffer is full), or ends before the end of the compressed data; STORE_IO on an I/O error. The
// caller checks entry.size against the limits of §6 first: the buffer follows that size.
std::optional<PackageError> readZipEntry(PackageSource& src, const ZipEntry& entry,
                                         std::string& out);

}  // namespace mat
