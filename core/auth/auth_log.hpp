// Journal lines of the auth module (stderr, collected by journald). A line never holds a password,
// a password hash or a session token (spec FR-010, SC-005); tests inject their own sink and search
// it for the passwords they used.
#pragma once
#include <cstdio>
#include <functional>
#include <string>
#include <utility>

namespace mat {

using AuthLogFn = std::function<void(const std::string& line)>;

// `log` itself, or "auth: <line>" on stderr when it is empty.
inline AuthLogFn authLogOrStderr(AuthLogFn log) {
    if (log) return log;
    return [](const std::string& line) { std::fprintf(stderr, "auth: %s\n", line.c_str()); };
}

}  // namespace mat
