// Sessions and lockout counters across the execv that activates a project (specs/005-device-online
// research R9, R13, data-model §5, contracts/device-config.md §2): /run/mat-runtime/auth-state.json
// (tmpfs, 0600), written just before execv, read then deleted by the new process. Token hashes
// only, never a token. The CLOCK_BOOTTIME stamps mean something within one boot only, so a file
// from another boot is dropped.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "core/auth/login_guard.hpp"
#include "core/auth/session_store.hpp"

namespace mat {

constexpr const char* kAuthStateFile = "/run/mat-runtime/auth-state.json";
constexpr const char* kBootIdFile = "/proc/sys/kernel/random/boot_id";
// Feature 011: up to 4,096 pairs and 1,024 addresses (login_guard.hpp) besides the sessions.
constexpr size_t kAuthStateMaxBytes = 2 * 1024 * 1024;

// The boot id of the kernel (a UUID), "" when it cannot be read.
std::string readBootId(const std::string& path = kBootIdFile);

struct AuthState {
    std::string bootId;
    std::vector<Session> sessions;
    GuardState guard;
};

std::string authStateJson(const AuthState& s);
// Temporary file 0600 next to `path`, then rename.
bool writeAuthState(const std::string& path, const AuthState& s, std::string& err);
// Reads `path`, then deletes it whatever it held. An empty state (and `why`) when the file is
// missing, not a regular file of mode 0600 or less, too big, not valid, from another boot (or the
// boot id is unknown), or stamped later than `nowMono`.
AuthState readAuthState(const std::string& path, const std::string& bootId, int64_t nowMono,
                        std::string* why = nullptr);

}  // namespace mat
