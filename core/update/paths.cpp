#include "core/update/paths.hpp"

#include <array>

#include "core/update/update_error.hpp"

namespace mat::update {

namespace {

constexpr std::array<std::string_view, 3> kPrefixes = {"bin/", "web/", "schemas/"};
constexpr std::array<std::string_view, 2> kFiles = {"README-deploy.txt", "build-info.json"};

// Strict UTF-8 (no overlong form, no surrogate, ≤ U+10FFFF); C0, DEL and C1 controls refused.
bool cleanUtf8(std::string_view s) {
    size_t i = 0;
    while (i < s.size()) {
        const auto c = static_cast<unsigned char>(s[i]);
        if (c < 0x20 || c == 0x7f) return false;
        if (c < 0x80) {
            ++i;
            continue;
        }
        size_t n = 0;
        uint32_t cp = 0;
        if (c >= 0xc2 && c <= 0xdf) {
            n = 1;
            cp = c & 0x1f;
        } else if (c >= 0xe0 && c <= 0xef) {
            n = 2;
            cp = c & 0x0f;
        } else if (c >= 0xf0 && c <= 0xf4) {
            n = 3;
            cp = c & 0x07;
        } else {
            return false;
        }
        for (size_t k = 1; k <= n; ++k) {
            if (i + k >= s.size()) return false;
            const auto d = static_cast<unsigned char>(s[i + k]);
            if ((d & 0xc0) != 0x80) return false;
            cp = (cp << 6) | (d & 0x3f);
        }
        if ((n == 2 && cp < 0x800) || (n == 3 && (cp < 0x10000 || cp > 0x10ffff)) ||
            (cp >= 0xd800 && cp <= 0xdfff) || (cp >= 0x80 && cp <= 0x9f))
            return false;
        i += n + 1;
    }
    return true;
}

bool underPrefix(std::string_view p) {
    for (auto x : kPrefixes)
        if (p.size() > x.size() && p.compare(0, x.size(), x) == 0) return true;
    return false;
}

// Segments separated by '/', none empty, none "." or "..". `trailingSlash`: a directory entry.
std::string segments(std::string_view p, bool trailingSlash) {
    if (trailingSlash) {
        if (p.empty() || p.back() != '/') return "PATH_INVALID";
        p.remove_suffix(1);
    }
    if (p.empty()) return "PATH_INVALID";
    size_t start = 0;
    bool traversal = false, empty = false;
    while (start <= p.size()) {
        size_t end = p.find('/', start);
        if (end == std::string_view::npos) end = p.size();
        const std::string_view seg = p.substr(start, end - start);
        if (seg.empty()) empty = true;
        if (seg == "." || seg == "..") traversal = true;
        start = end + 1;
    }
    if (traversal) return "PATH_TRAVERSAL";
    if (empty) return "PATH_INVALID";
    return "";
}

}  // namespace

std::string checkPath(std::string_view p) {
    if (p.empty()) return "PATH_INVALID";
    if (p.front() == '/') return "PATH_ABSOLUTE";
    if (p.find('\\') != std::string_view::npos) return "PATH_INVALID";
    if (!cleanUtf8(p)) return "PATH_INVALID";
    if (std::string seg = segments(p, false); !seg.empty()) return seg;
    if (p.size() > kPathMaxBytes) return "PATH_INVALID";
    if (p.compare(0, 8, "updater/") == 0 || p == "updater") return "UPDATER";
    for (auto f : kFiles)
        if (p == f) return "";
    return underPrefix(p) ? "" : "PATH_INVALID";
}

bool allowedDirectory(std::string_view p) {
    if (p.empty() || p.front() == '/' || p.size() > kPathMaxBytes) return false;
    if (p.find('\\') != std::string_view::npos || !cleanUtf8(p)) return false;
    if (!segments(p, true).empty()) return false;
    for (auto x : kPrefixes)
        if (p.compare(0, x.size(), x) == 0) return true;  // "bin/" itself or below
    return false;
}

std::string foldCase(std::string_view p) {
    std::string s(p);
    for (char& c : s)
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    return s;
}

}  // namespace mat::update
