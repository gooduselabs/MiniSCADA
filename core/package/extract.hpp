// Extracting a .matscada package on the device, step verify-package (specs/005-device-online/
// contracts/matscada-package.md §8, device-api §5, research R13): the package is checked
// (checkPackage) and its project files are written while stage 5 decompresses them.
//
// - destDir is created with 0700 when missing; when it exists it must be a directory, opened
//   without following a symlink. Every subdirectory is made with mkdirat on the file descriptor
//   of its parent (0700) and opened with O_NOFOLLOW; every file with
//   O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW, mode 0600. A symlink or a file already there is never
//   followed nor overwritten: STORE_IO.
// - Before each file the free space of its file system must stay at least minFreeBytes after
//   writing it, else NO_SPACE (also for ENOSPC/EDQUOT while writing).
// - fsync of every file as it is written, then of every directory written into (deepest first,
//   destDir, and its parent when destDir was created here).
// - Any failure, including a later stage of the check: destDir is removed with what it holds,
//   without following symlinks. The manifest is not written: it stays in the package.
#pragma once
#include <cstdint>
#include <functional>
#include <string>

#include "core/package/package_check.hpp"

namespace mat {

struct ExtractOptions {
    std::string expectedDigest;  // as PackageCheckOptions::expectedDigest
    uint64_t minFreeBytes = 0;   // historianMinFreeMB in bytes
    // Free bytes for an unprivileged user on the file system of `dirFd`; false: unknown (the
    // extraction stops with STORE_IO). Default: fstatvfs, f_bavail × f_frsize.
    std::function<bool(int dirFd, uint64_t& freeBytes)> freeBytes;
    // Default ::fsync; tests record the calls.
    std::function<int(int fd)> fsync;
};

PackageCheck extractPackage(PackageSource& src, const PackageSchema& schema,
                            const std::string& destDir, const ExtractOptions& options = {});

}  // namespace mat
