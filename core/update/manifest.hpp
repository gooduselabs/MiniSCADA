// update.json (contracts/update-package.md §2). Parsed only after its signature was verified.
// parseManifest checks the structure and the format (FORMAT_UNSUPPORTED); checkFileList the rules
// of files[] and of a keyset (paths, modes, duplicates, sizes, compression ratio, keys).
#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "core/update/update_error.hpp"

namespace mat::update {

struct FileEntry {
    std::string path;
    std::string sha256;  // 64 lower-case hex
    uint64_t size = 0;
    int mode = 0644;  // 0644 or 0755
};

struct Manifest {
    std::string format;
    std::string kind;  // "runtime" or "keyset"
    std::string product;
    std::string version;
    int64_t releaseSeq = 0;
    std::string arch;
    std::string minFromVersion;
    std::string projectFormatMax;
    int updaterRequired = 1;
    std::string createdAt;
    std::string payloadSha256;
    uint64_t payloadSize = 0;
    std::vector<FileEntry> files;
    std::string notes;
    std::vector<std::string> keysetAdd;     // PEM
    std::vector<std::string> keysetRemove;  // "sha256:<hex>"
};

// Structure, types and format 1.x.y (else FORMAT_UNSUPPORTED). Detail code MANIFEST otherwise.
std::optional<Error> parseManifest(std::string_view json, Manifest& m);

// files[] (§2): PATH_*, MODE_FORBIDDEN, PATH_DUPLICATE, UPDATER_MANUAL_ONLY, UNPACKED_TOO_LARGE,
// RATIO_TOO_HIGH; a keyset: no files, ≤ 4 keys to add that parse (KEYSET_KEY), no removal of
// `signerKeyId` (KEYSET_SELF_REVOKE).
std::optional<Error> checkFileList(const Manifest& m, const std::string& signerKeyId);

// SemVer comparison of "MAJOR.MINOR.PATCH[-pre]" (pre-release lower than the release, compared as
// text): -1, 0, 1. Unparsable versions compare as 0.0.0.
int compareVersions(std::string_view a, std::string_view b);
bool validVersion(std::string_view v);

}  // namespace mat::update
