// Deterministic writer of stored .matscada packages on the device (specs/005-device-online/
// contracts/matscada-package.md §7, §8a): the runtime packs a project installed the old way once,
// when adopting it into the project store (FR-027, research R13).
//
// Manifest first (stored), then the files sorted by path bytes, all stored. DOS time 0x0000,
// date 0x0021 (1980-01-01), flags bit 11, version needed 20, version made by 20 (MS-DOS),
// internal and external attributes 0, no extra field, comment or data descriptor. The manifest
// is JSON with two-space indent and a final newline, keys in the order of contract §3. Same files
// and options give the same bytes; the digest (§4) depends on the files only.
//
// The inputs are refused when the package would not pass checkPackage: path rules (E_PKG_PATH,
// E_PKG_TYPE), duplicates, sizes (E_PKG_SIZE), count (E_PKG_ENTRIES), package size
// (E_PKG_TOO_LARGE), project.json without the four identity strings (E_PKG_IDENTITY), secrets
// (E_PKG_SECRET), manifest above 256 KiB (E_PKG_MANIFEST). Memory: one file at a time.
#pragma once
#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include "core/package/package_rules.hpp"

namespace mat {

// Where the package bytes go, in order.
class PackageSink {
   public:
    virtual ~PackageSink() = default;
    virtual bool write(const void* data, size_t n) = 0;
};

class StringSink final : public PackageSink {
   public:
    bool write(const void* data, size_t n) override;
    std::string bytes;
};

// A file descriptor opened for writing (the caller opens, syncs and closes it).
class FdSink final : public PackageSink {
   public:
    explicit FdSink(int fd) : fd_(fd) {}
    bool write(const void* data, size_t n) override;
    int error() const { return errno_; }  // errno of the failed write

   private:
    int fd_;
    int errno_ = 0;
};

// One file to pack. `read` gives its bytes and is called twice (hashing, then writing); the
// second call must give the same bytes. false: the file cannot be read (STORE_IO, with `error`).
struct PackageInput {
    std::string path;
    std::function<bool(std::string& bytes, std::string& error)> read;
};
PackageInput memoryInput(std::string path, std::string bytes);
// The regular file `file` (symlinks followed, as the project validator does), read whole but
// never more than 5 MiB + 1 byte: a bigger file is refused by the size rule, not loaded.
PackageInput fileInput(std::string path, std::string file);

struct PackageWriteOptions {
    std::string createdAt;  // ISO 8601 UTC of the packing; the caller's clock
    std::string generatorName = "mat-runtime";
    std::string generatorVersion;  // empty: kRuntimeVersion
};

struct PackageWriteResult {
    bool ok = false;
    PackageError error;  // when !ok; STORE_IO when an input or the sink failed
    std::string digest;
    uint64_t bytes = 0;  // package size
};

PackageWriteResult writeStoredPackage(std::vector<PackageInput> files,
                                      const PackageWriteOptions& options, PackageSink& out);

}  // namespace mat
