// Rules of the .matscada package format shared by the reader and the writer
// (specs/005-device-online/contracts/matscada-package.md §5, §6, §8a): limits, the error type,
// paths, secrets, the identity fields of project.json. The Studio's Rust code follows the same
// rules on tests/package-vectors.
#pragma once
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace mat {

// Limits of contract §2, §3, §6 (bytes unless said otherwise).
constexpr uint64_t kPackageMaxBytes = 52428800;            // 50 MiB, E_PKG_TOO_LARGE
constexpr uint32_t kPackageMaxEntries = 1024;              // manifest included, E_PKG_ENTRIES
constexpr uint64_t kPackageMaxJsonBytes = 1024 * 1024;     // a .json file, E_PKG_SIZE
constexpr uint64_t kPackageMaxSvgBytes = 5 * 1024 * 1024;  // a .svg file, E_PKG_SIZE
// Every entry after decompression, manifest included (§8a), E_PKG_SIZE.
constexpr uint64_t kPackageMaxTotalBytes = 200 * 1024 * 1024;
constexpr uint64_t kPackageMaxManifestBytes = 262144;  // matscada.json, E_PKG_MANIFEST
constexpr uint64_t kPackageRatioMinBytes = 64 * 1024;  // the ratio rule applies above this size
constexpr uint64_t kPackageMaxRatio = 100;             // E_PKG_RATIO
constexpr size_t kPackageMaxPathBytes = 128;
constexpr size_t kPackageMaxPathDepth = 8;
constexpr const char* kPackageManifestName = "matscada.json";

// An error of a package: `code` is E_PKG_* (contract §6), or NO_SPACE / STORE_IO while reading
// or extracting (device-api §5); `path` is the entry the error belongs to, empty for the whole
// package (layout errors, digest, identity…); `message` is for people (Vietnamese).
struct PackageError {
    std::string code;
    std::string path;
    std::string message;
};

// Rules 1–5 of contract §5 for one path (E_PKG_PATH): 1–128 bytes of UTF-8, relative, no '\',
// ':' or control character, no empty, '.' or '..' segment (isSafeRelPath); none of < > " | ? *;
// no segment ending with '.' or ' '; no Windows device name as a segment (CON, PRN, AUX, NUL,
// COM1–COM9, LPT1–LPT9, any case, with or without extension); at most 8 segments.
std::optional<PackageError> packagePathError(std::string_view path);
// Rule 6 (E_PKG_TYPE): the name ends with ".json" or ".svg", lower case. The reader checks it
// after rules 1–5, 7 and 8 (§8a).
std::optional<PackageError> packageTypeError(std::string_view path);
// Key of rule 7: two paths with the same key are duplicates (A–Z lowered, ASCII only).
std::string packagePathKey(std::string_view path);

// Limits of §6 on one entry from its declared sizes: E_PKG_SIZE for a .json file above 1 MiB or
// a .svg file above 5 MiB (`manifest`: the manifest has its own limit, checked elsewhere), then
// E_PKG_RATIO for an entry above 64 KiB that is more than 100 times its compressed size. The
// total (kPackageMaxTotalBytes) is the caller's.
std::optional<PackageError> packageEntryLimitError(std::string_view path, uint64_t size,
                                                   uint64_t compressedSize, bool manifest);

// Secrets of §6 (E_PKG_SECRET) in one file: a PEM private key block ("-----BEGIN … PRIVATE
// KEY-----") in any file; in a .json file that parses as JSON, a key containing password,
// passwd, pwd, secret, token, apikey or api_key (any case: the words of E_LOG_SECRET) at any
// depth, and a connection URL holding an account (connections[i].url of the top-level object,
// "scheme://user[:pass]@host"). The JSON is read as a stream: memory does not grow with the
// document. nullopt when none, else what was found (for the message).
std::optional<std::string> findPackageSecret(std::string_view path, std::string_view content);

// The fields of project.json the manifest repeats (§3, E_PKG_IDENTITY): nullopt when the text is
// not a JSON object; a field that is missing or not a string stays nullopt. A repeated key keeps
// its last value, as a JSON parser does.
struct ProjectIdentity {
    std::optional<std::string> projectId;
    std::optional<std::string> projectName;
    std::optional<std::string> projectVersion;
    std::optional<std::string> minRuntimeVersion;
};
std::optional<ProjectIdentity> readProjectIdentity(std::string_view projectJson);

// An entry name as reports show it: bytes that are not UTF-8 become U+FFFD; above 128 bytes it
// is cut at a character boundary and ends with "…".
std::string packageDisplayName(std::string_view name);

}  // namespace mat
