// Wear of the eMMC for GET /api/v1/diagnostics (specs/011-pilot-hardening FR-009, FR-045,
// contracts/device-api-011.md §5, test-protocols.md §3; research R13): the JEDEC fields
// DEVICE_LIFE_TIME_EST_TYP_A/B and PRE_EOL_INFO as the kernel shows them in sysfs, read only:
//   /sys/block/mmcblkN/device/type          "MMC" (an SD card says "SD": not counted)
//   /sys/block/mmcblkN/device/life_time     "0x01 0x02"  (type A, type B; 0x01 = 0-10 % used ...)
//   /sys/block/mmcblkN/device/pre_eol_info  "0x01"       (1 normal, 2 warning, 3 urgent)
// The runtime does not run `mmc extcsd read` (root and an ioctl on /dev/mmcblk0; the sampler of the
// soak may, tools/soak). The first mmcblkN (lowest N, no boot or rpmb partition) of type MMC is
// read. Nothing is guessed: when there is no such device or the files are missing or not in the
// expected form, `available` is false and `reason` says why.
#pragma once
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mat {

struct EmmcLife {
    bool available = false;
    int typeA = 0;
    int typeB = 0;
    int preEol = 0;
    std::string source;  // "sysfs" when available
    std::string device;  // "mmcblk0"
    // When not available: "no-emmc" (no eMMC device), "not-supported" (the kernel or the chip
    // gives no life_time, e.g. eMMC 4.5), "unreadable" (a file that cannot be read or parsed).
    std::string reason;
};

struct SysfsReader {
    std::function<std::optional<std::string>(const std::string& path)> readFile;
    std::function<std::vector<std::string>(const std::string& dir)> listDir;  // names only
};
SysfsReader systemSysfsReader();

// "0x0b" or "0x0B" (surrounding white space allowed) -> 11; nullopt otherwise.
std::optional<int> parseSysfsHexByte(std::string_view text);

EmmcLife readEmmcLife(const SysfsReader& fs, const std::string& sysBlock = "/sys/block");

}  // namespace mat
