// Checking a .matscada package (specs/005-device-online/contracts/matscada-package.md): one pass
// over the package, first error wins, in the order of §8a. A stage only runs when every earlier
// one passed; inside a stage entries go in central directory order:
//
// 1–3. size, end of central directory, every entry (readZipDirectory, zip_reader.hpp);
// 4. manifest: first entry named matscada.json, stored, ≤ 256 KiB (E_PKG_MANIFEST), then
//    parseManifest (manifest.hpp);
// 5. sizes, ratio, decompression: first the declared sizes of every entry (E_PKG_SIZE per file,
//    then the running total including the manifest, then E_PKG_RATIO), so a bomb is refused
//    before any byte is decompressed; then every entry is read or inflated, counting real bytes
//    (E_PKG_FORMAT). CRC-32, SHA-256, secrets and the identity fields are computed on the way
//    and reported by the later stages;
// 6. checksums: CRC-32 of every entry, then size and SHA-256 against files[] (E_PKG_CHECKSUM);
// 7. file set: an entry the Studio never packs (packageExcludedPath: E_PACKAGE_EXTRA_FILE, feature
//    011), entries missing from files[] (E_PKG_UNLISTED), then files[] without an entry
//    (E_PKG_MISSING);
// 8. digest recomputed from files[] (E_PKG_DIGEST), then against the expected digest
//    (E_PKG_DIGEST); identity: the four project fields equal those of project.json
//    (E_PKG_IDENTITY); MAJOR of formatVersion is 1 (E_PKG_FORMAT_VERSION);
// 9. secrets: the manifest, then every entry (E_PKG_SECRET).
//
// Memory: the central directory records (≤ 1024), the manifest (≤ 256 KiB) and one entry at a
// time (≤ 5 MiB after the checks of stage 5), plus 64 KiB of compressed input.
#pragma once
#include <cstdint>
#include <string>
#include <string_view>

#include "core/package/manifest.hpp"
#include "core/package/package_rules.hpp"
#include "core/package/zip_reader.hpp"

namespace mat {

struct PackageCheckOptions {
    // Digest the package must have: X-Mat-Digest when deploying, the digest asked for when
    // reading back. Empty: not compared.
    std::string expectedDigest;
};

struct PackageCheck {
    bool ok = false;
    PackageError error;        // when !ok
    PackageManifest manifest;  // when ok; manifest.digest is the package digest
    uint64_t packageBytes = 0;
    uint64_t unpackedBytes = 0;  // every entry after decompression, manifest included (when ok)
};

// Receives every project file (every entry but the manifest) while stage 5 decompresses it, in
// central directory order, before the later stages ran: a failed check later on means the
// receiver must discard what it got. A false return stops the check with `error`.
class PackageEntrySink {
   public:
    virtual ~PackageEntrySink() = default;
    virtual bool onFile(const std::string& path, std::string_view bytes, PackageError& error) = 0;
};

PackageCheck checkPackage(PackageSource& src, const PackageSchema& schema,
                          const PackageCheckOptions& options = {},
                          PackageEntrySink* sink = nullptr);

}  // namespace mat
