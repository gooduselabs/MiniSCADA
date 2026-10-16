#include "core/diagnostics/emmc_life.hpp"

#include <dirent.h>

#include <algorithm>
#include <cstdlib>
#include <fstream>
#include <sstream>

namespace mat {

namespace {

std::string_view trim(std::string_view s) {
    while (!s.empty() &&
           (s.front() == ' ' || s.front() == '\t' || s.front() == '\n' || s.front() == '\r'))
        s.remove_prefix(1);
    while (!s.empty() &&
           (s.back() == ' ' || s.back() == '\t' || s.back() == '\n' || s.back() == '\r'))
        s.remove_suffix(1);
    return s;
}

int hexDigit(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

// "mmcblk" followed by digits only (no "boot0", no "rpmb", no partition "p1"); the number.
std::optional<int> mmcIndex(const std::string& name) {
    constexpr std::string_view kPrefix = "mmcblk";
    if (name.size() <= kPrefix.size() || name.compare(0, kPrefix.size(), kPrefix) != 0)
        return std::nullopt;
    int n = 0;
    for (size_t i = kPrefix.size(); i < name.size(); ++i) {
        if (name[i] < '0' || name[i] > '9' || n > 9999) return std::nullopt;
        n = n * 10 + (name[i] - '0');
    }
    return n;
}

}  // namespace

std::optional<int> parseSysfsHexByte(std::string_view text) {
    const std::string_view t = trim(text);
    if (t.size() < 3 || t.size() > 4 || t[0] != '0' || (t[1] != 'x' && t[1] != 'X'))
        return std::nullopt;
    int v = 0;
    for (size_t i = 2; i < t.size(); ++i) {
        const int d = hexDigit(t[i]);
        if (d < 0) return std::nullopt;
        v = v * 16 + d;
    }
    return v;
}

SysfsReader systemSysfsReader() {
    SysfsReader r;
    r.readFile = [](const std::string& path) -> std::optional<std::string> {
        std::ifstream in(path, std::ios::binary);
        if (!in) return std::nullopt;
        std::ostringstream s;
        s << in.rdbuf();
        if (in.bad()) return std::nullopt;
        return s.str().substr(0, 256);  // a sysfs attribute is small
    };
    r.listDir = [](const std::string& dir) {
        std::vector<std::string> out;
        if (DIR* d = ::opendir(dir.c_str())) {
            while (const dirent* e = ::readdir(d)) {
                const std::string n = e->d_name;
                if (n != "." && n != "..") out.push_back(n);
            }
            ::closedir(d);
        }
        return out;
    };
    return r;
}

EmmcLife readEmmcLife(const SysfsReader& fs, const std::string& sysBlock) {
    EmmcLife e;
    e.reason = "no-emmc";
    if (!fs.listDir || !fs.readFile) return e;
    std::vector<std::pair<int, std::string>> mmc;
    for (const std::string& n : fs.listDir(sysBlock))
        if (const auto i = mmcIndex(n)) mmc.emplace_back(*i, n);
    std::sort(mmc.begin(), mmc.end());
    for (const auto& [index, name] : mmc) {
        (void)index;
        const std::string dev = sysBlock + "/" + name + "/device/";
        const auto type = fs.readFile(dev + "type");
        if (!type || trim(*type) != "MMC") continue;  // an SD card, or not readable
        e.device = name;
        const auto life = fs.readFile(dev + "life_time");
        const auto eol = fs.readFile(dev + "pre_eol_info");
        if (!life || !eol) {
            e.reason = "not-supported";
            return e;
        }
        const std::string_view l = trim(*life);
        const size_t space = l.find_first_of(" \t");
        const auto a =
            space == std::string_view::npos ? std::nullopt : parseSysfsHexByte(l.substr(0, space));
        const auto b =
            space == std::string_view::npos ? std::nullopt : parseSysfsHexByte(l.substr(space + 1));
        const auto p = parseSysfsHexByte(*eol);
        if (!a || !b || !p) {
            e.reason = "unreadable";
            return e;
        }
        e.available = true;
        e.typeA = *a;
        e.typeB = *b;
        e.preEol = *p;
        e.source = "sysfs";
        e.reason.clear();
        return e;
    }
    return e;
}

}  // namespace mat
