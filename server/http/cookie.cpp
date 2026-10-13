#include "server/http/cookie.hpp"

namespace mat {

namespace {

bool isSpace(char c) { return c == ' ' || c == '\t'; }

std::string_view trimmed(std::string_view s) {
    while (!s.empty() && isSpace(s.front())) s.remove_prefix(1);
    while (!s.empty() && isSpace(s.back())) s.remove_suffix(1);
    return s;
}

bool sameNoCase(std::string_view a, std::string_view b) {
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i) {
        const char x = (a[i] >= 'A' && a[i] <= 'Z') ? static_cast<char>(a[i] - 'A' + 'a') : a[i];
        const char y = (b[i] >= 'A' && b[i] <= 'Z') ? static_cast<char>(b[i] - 'A' + 'a') : b[i];
        if (x != y) return false;
    }
    return true;
}

}  // namespace

std::optional<std::string> cookieValue(std::string_view header, std::string_view name) {
    std::optional<std::string> found;
    size_t at = 0;
    while (at <= header.size()) {
        size_t end = header.find(';', at);
        if (end == std::string_view::npos) end = header.size();
        const std::string_view pair = trimmed(header.substr(at, end - at));
        const size_t eq = pair.find('=');
        if (eq != std::string_view::npos && trimmed(pair.substr(0, eq)) == name) {
            if (found) return std::nullopt;  // twice: a cookie somebody planted next to ours
            found = std::string(trimmed(pair.substr(eq + 1)));
        }
        if (end >= header.size()) break;
        at = end + 1;
    }
    return found;
}

bool originMatchesHost(const std::optional<std::string>& origin,
                       const std::optional<std::string>& host) {
    if (!origin || !host || host->empty()) return false;
    return sameNoCase(*origin, "https://" + *host);
}

std::optional<std::string> sessionCookieToken(const std::optional<std::string>& cookieHeader) {
    if (!cookieHeader) return std::nullopt;
    const std::optional<std::string> v = cookieValue(*cookieHeader, kSessionCookieName);
    if (!v || v->rfind(kWebTokenPrefixText, 0) != 0) return std::nullopt;
    return v;
}

}  // namespace mat
