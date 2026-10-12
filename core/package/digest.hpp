// Content digest of a .matscada package and of a project
// (specs/005-device-online/contracts/matscada-package.md §4). Same bytes as
// packages/project-schema/src/package-digest.ts and the Studio's Rust code on tests/package-vectors
// and tests/project-vectors.
#pragma once
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace mat {

// One file of a package, as an entry of the manifest's files[]: path, byte count, SHA-256 as 64
// lowercase hex characters.
struct PackageFile {
    std::string path;
    int64_t size = 0;
    std::string sha256;
};

// Order of UTF-8 bytes, which is also code point order: the order of files[] and of the digest
// lines. Negative, zero or positive like memcmp; a prefix sorts first.
int compareUtf8(std::string_view a, std::string_view b);

// The text the digest hashes: one line "<sha256> <size> <path>\n" per file (size in decimal
// without leading zeros), sorted by path bytes. Throws std::invalid_argument on a malformed entry,
// a programming error of the caller (paths have passed the project or package checks): duplicate
// path; empty path, a control character, or not UTF-8; negative size; sha256 not 64 lowercase hex.
std::string digestText(std::vector<PackageFile> files);

// "sha256:" + hex(SHA-256(digestText(files))). Independent of compression, time and tool, so a
// project on disk compares with the one on a device without packing it. The manifest is not part
// of it.
std::string packageDigest(const std::vector<PackageFile>& files);

// The entry of one file from its bytes, taken as they are (a BOM stays, bytes that are not UTF-8
// are hashed too).
PackageFile packageFile(std::string path, std::string_view content);

}  // namespace mat
