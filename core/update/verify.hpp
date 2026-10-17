// The whole check of a .matupdate in the order of FR-061 (contracts/update-package.md §1–§3):
// size, envelope (members 1 and 2), signature by a trusted key, manifest, payload digest (member 3
// hashed as it is read) and end of the archive, files[] rules, the listing of the payload, then
// for a device: product, arch, releaseSeq (no downgrade), minFromVersion, projectFormatMax and the
// updater protocol. The same code runs in the runtime (S2), in mat-update-verify under root (S4,
// TOCTOU), in deploy.sh and release.ps1, and in the fuzz target.
#pragma once
#include <cstdint>
#include <optional>
#include <string>

#include "core/update/envelope.hpp"
#include "core/update/manifest.hpp"
#include "core/update/signature.hpp"

namespace mat::update {

// The device the package is meant for. Fields left empty are not checked (mat-update-verify
// without --installed checks only the package itself).
struct DeviceContext {
    uint64_t maxPackageBytes = 64ULL << 20;  // update.maxPackageMiB
    std::string arch;                        // "armhf", "x64", "arm64"; "" = not checked
    std::string version;                     // running version; "" = not checked
    std::optional<int64_t> releaseSeq;       // running releaseSeq; none = not checked
    std::string projectFormat;               // format of the running project; "" = not checked
    int updaterProtocol = kUpdaterProtocol;
};

struct Verified {
    Manifest manifest;
    std::string signerKeyId;
    std::string signerLabel;
    std::string packageSha256;  // of the whole file, hex
    uint64_t packageSize = 0;
};

// The architecture this binary was built for, in the names of the manifest.
const char* buildArch();

// Checks a package from `in` (`size` bytes; seekable). No key in `keys`: UPDATE_KEYS_MISSING.
std::optional<Error> verifyPackage(Source& in, uint64_t size, const KeySet& keys,
                                   const DeviceContext& device, Verified& out);
std::optional<Error> verifyPackageFile(const std::string& path, const KeySet& keys,
                                       const DeviceContext& device, Verified& out);

// SHA256SUMS (release-signing §5): the signature `sigPath` over the bytes of `sumsPath`, then every
// line "<hex>  <name>" against the file <dir of sumsPath>/<name> (FILE_MISSING, FILE_DIGEST; names
// with "/" or ".." are PATH_INVALID). `signer` gets the keyId.
std::optional<Error> verifySums(const std::string& sumsPath, const std::string& sigPath,
                                const KeySet& keys, std::string& signer);

}  // namespace mat::update
