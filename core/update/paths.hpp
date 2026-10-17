// The paths of files[] (contracts/update-package.md §2, §6 cases 8, 9, 23, 26, 28): relative,
// UTF-8, no "." or ".." segment, no "\", no control character, at most 200 bytes, under an allowed
// prefix (bin/, web/, schemas/, README-deploy.txt, build-info.json). updater/ is the one prefix
// that is refused with UPDATER_MANUAL_ONLY (FR-072) rather than PATH_INVALID.
#pragma once
#include <string>
#include <string_view>

namespace mat::update {

// "" when the path may be installed, else the detail code: PATH_ABSOLUTE, PATH_TRAVERSAL,
// PATH_INVALID, or "UPDATER" for a path under updater/ (the caller answers UPDATER_MANUAL_ONLY).
std::string checkPath(std::string_view path);

// A directory entry of the payload ("bin/", "web/sub/"): clean and inside an allowed prefix.
bool allowedDirectory(std::string_view path);

// The key under which two paths collide (ASCII case folded: the duplicate rule of §2).
std::string foldCase(std::string_view path);

}  // namespace mat::update
