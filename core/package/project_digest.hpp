// Content digest of a project directory (specs/005-device-online contracts/matscada-package.md §4,
// data-model §8): packageDigest() over the project's files as they are on disk, the same value a
// package of these files carries and the Studio computes for its open project. The runtime shows it
// for the project it runs (system/info, projects/active, live hello, discovery) while there is no
// project store yet (US2).
#pragma once
#include <optional>
#include <string>
#include <vector>

namespace mat {

// `files`: paths relative to `dir` (LoadedProject::files()). Each file is read and hashed in
// blocks. nullopt, with `error`, when a file cannot be read (gone since validation, not a regular
// file).
std::optional<std::string> projectDirDigest(const std::string& dir,
                                            const std::vector<std::string>& files,
                                            std::string* error = nullptr);

// Feature 011 (contracts/project-format-1.0.md §6, research R9): what `dir` holds beyond `files`
// (the project's files, LoadedProject::files()): every regular file, symlink or other entry that is
// not one of them, and every empty directory (with a trailing '/'), as paths relative to `dir`
// sorted by UTF-8 bytes. Empty: the directory holds exactly the project (its digest is the
// package digest). nullopt, with `error`, when a directory cannot be read.
std::optional<std::vector<std::string>> projectExtraFiles(const std::string& dir,
                                                          const std::vector<std::string>& files,
                                                          std::string* error = nullptr);

}  // namespace mat
