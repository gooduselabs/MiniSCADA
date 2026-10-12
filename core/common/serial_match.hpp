// Which serial ports the project may use (research R13; contracts/device-config.md §1). One rule
// for the list of ports, the driver, the validator (E_SERIAL_NOT_ALLOWED) and the API.
#pragma once
#include <string>
#include <vector>

namespace mat {

// A `serialPorts` pattern against a port as a project names it: a tty name ("ttyAS2") or a path
// "/dev/serial/by-id/..." or ".../by-path/...". A tty pattern is a name with an optional trailing
// '*' (prefix match); a path pattern matches only the same path.
inline bool serialPatternMatches(const std::string& pattern, const std::string& port) {
    if (pattern.empty() || port.empty()) return false;
    const bool patternPath = pattern.front() == '/';
    const bool portPath = port.front() == '/';
    if (patternPath != portPath) return false;
    if (patternPath) return pattern == port;
    if (pattern.back() == '*')
        return port.compare(0, pattern.size() - 1, pattern, 0, pattern.size() - 1) == 0;
    return pattern == port;
}

inline bool serialPortInList(const std::vector<std::string>& patterns, const std::string& port) {
    for (const auto& p : patterns)
        if (serialPatternMatches(p, port)) return true;
    return false;
}

// A `serial.port` of a project: a tty name (tty, 1-8 letters, 1-3 digits) or a path
// /dev/serial/by-id/ or by-path/ with 1-200 characters of [A-Za-z0-9._:+-] (E_SERIAL_PORT).
inline bool serialPortNameOk(const std::string& s) {
    auto letter = [](char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); };
    auto digit = [](char c) { return c >= '0' && c <= '9'; };
    if (s.compare(0, 3, "tty") == 0) {
        size_t i = 3, letters = 0, digits = 0;
        while (i < s.size() && letter(s[i])) ++i, ++letters;
        while (i < s.size() && digit(s[i])) ++i, ++digits;
        return i == s.size() && letters >= 1 && letters <= 8 && digits >= 1 && digits <= 3;
    }
    for (const char* prefix : {"/dev/serial/by-id/", "/dev/serial/by-path/"}) {
        const std::string p = prefix;
        if (s.compare(0, p.size(), p) != 0) continue;
        const size_t n = s.size() - p.size();
        if (n < 1 || n > 200) return false;
        for (size_t i = p.size(); i < s.size(); ++i) {
            const char c = s[i];
            if (!(letter(c) || digit(c) || c == '.' || c == '_' || c == ':' || c == '+' ||
                  c == '-'))
                return false;
        }
        return true;
    }
    return false;
}

// The tty name of "/dev/ttyAS2" or "ttyAS2"; "" for a /dev/serial path (the name is not in it).
inline std::string serialShortName(const std::string& port) {
    if (port.rfind("/dev/serial/", 0) == 0) return {};
    if (port.rfind("/dev/", 0) == 0) return port.substr(5);
    return port;
}

}  // namespace mat
