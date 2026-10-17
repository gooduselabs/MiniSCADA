// Path segments Windows cannot hold as written (T062, security review S2). A project made on the
// device or in a package must open the same on the Studio's Windows host, so every path check
// refuses them on every platform: isSafeRelPath (project validator), safeRelPath (project store),
// packagePathError (package rules); the same rule as check_rel of the Studio (Rust) and
// isSafeRelPath of @mat/project-schema (TS).
#pragma once
#include <string_view>

namespace mat {

// CON, PRN, AUX, NUL, COM1–COM9, LPT1–LPT9 with or without an extension, any case; spaces before
// the extension are dropped by Windows too ("con .json"). "console.json", "com0", "com10" are not.
inline bool isWindowsDeviceName(std::string_view segment) {
    std::string_view stem = segment.substr(0, segment.find('.'));
    while (!stem.empty() && stem.back() == ' ') stem.remove_suffix(1);
    auto lower = [](char c) { return c >= 'A' && c <= 'Z' ? static_cast<char>(c - 'A' + 'a') : c; };
    auto is = [&](std::string_view name) {
        if (stem.size() < name.size()) return false;
        for (size_t i = 0; i < name.size(); ++i)
            if (lower(stem[i]) != name[i]) return false;
        return true;
    };
    if (stem.size() == 3) return is("con") || is("prn") || is("aux") || is("nul");
    return stem.size() == 4 && (is("com") || is("lpt")) && stem[3] >= '1' && stem[3] <= '9';
}

// A segment Windows would reach under another name or as a device: it ends with '.' or ' '
// (Windows drops them, so "a." and "a" are one file) or is a device name.
inline bool isWindowsUnsafeSegment(std::string_view segment) {
    return (!segment.empty() && (segment.back() == '.' || segment.back() == ' ')) ||
           isWindowsDeviceName(segment);
}

}  // namespace mat
