// Sign-in, sessions and permissions of the device API (specs/005-device-online research R7–R10,
// contracts/device-api.md §1.3, §3, data-model §4–5, ADR-011). Thread-safe: CivetWeb workers call
// it at once. The Argon2id hash runs on the PasswordHasher thread and the audit writes on the
// calling thread, never under the service's lock.
#pragma once
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "core/audit/audit_log.hpp"
#include "core/auth/account_store.hpp"
#include "core/auth/auth_log.hpp"
#include "core/auth/password_hash.hpp"
#include "core/auth/roles.hpp"

namespace mat {

// Commits one audit record before it returns; throws AuditUnavailable when it cannot. The runtime
// passes AuditLog::append; tests make it fail.
using AuditFn = std::function<void(const AuditEvent& event)>;

constexpr size_t kLoginMaxUserBytes = 64;  // device-api §3; kPasswordMaxBytes for the password
constexpr int64_t kIdleTimeoutS = 1800;    // login response: idleTimeoutS
constexpr int64_t kMaxLifetimeS = 43200;   // login response: maxLifetimeS

struct ClientAddress {
    std::string ip;
    int port = 0;
    std::string text() const;  // audit source: "IP:port", "[IPv6]:port"
};

enum class LoginStatus {
    Ok,                // 200 with the token
    Failed,            // 401 AUTH_FAILED: wrong name or password, disabled, no account at all
    Locked,            // 429 AUTH_LOCKED, retryAfterS
    Busy,              // 429 AUTH_BUSY (Retry-After: 2): kHashMaxWaiting already wait
    AuditUnavailable,  // 503 AUDIT_UNAVAILABLE: no token without its audit record
    Error,             // 500 INTERNAL_ERROR: the hash could not run (logged)
};
const char* loginErrorCode(LoginStatus s);  // "AUTH_FAILED" …; "" for Ok

struct LoginResult {
    LoginStatus status = LoginStatus::Failed;
    std::string token;         // Ok: "mats_…", for the response body only
    std::string user;          // Ok
    Role role = Role::Viewer;  // Ok
    int64_t retryAfterS = 0;   // Locked
};

enum class AccessStatus {
    Ok,
    SessionExpired,  // 401: unknown token, idle or lifetime over
    SessionInvalid,  // 401: another address, account disabled or gone, rev changed
    Forbidden,       // 403: role below the endpoint's
};
const char* accessErrorCode(AccessStatus s);  // "SESSION_EXPIRED" …; "" for Ok

struct Access {
    AccessStatus status = AccessStatus::SessionExpired;
    std::string user;            // known: Ok, SessionInvalid, Forbidden
    std::optional<Role> role;    // Ok, Forbidden
    int64_t idleRemainingS = 0;  // Ok
    int64_t lifetimeRemainingS = 0;
};

struct AuthOptions {
    std::string usersFile = kUsersFileDefault;
    AuditFn audit;                          // empty: sign-ins end with AUDIT_UNAVAILABLE
    AuthLogFn log;                          // empty: stderr
    std::function<int64_t()> monoMs;        // empty: bootTimeMs (CLOCK_BOOTTIME)
    PasswordHasher::HashFn hash;            // empty: argon2idHash
    std::function<std::string()> newToken;  // empty: newSessionToken
    std::function<std::string()> bootId;    // empty: readBootId()
    size_t hashMaxWaiting = kHashMaxWaiting;
};

class AuthService {
   public:
    explicit AuthService(AuthOptions options);
    ~AuthService();
    AuthService(const AuthService&) = delete;
    AuthService& operator=(const AuthService&) = delete;

    // POST /api/v1/auth/login. `password` is wiped before return, whatever the outcome. Blocks the
    // calling thread while its hash waits and runs (≤ 1 s on the BL335). Every outcome but Busy is
    // in the audit before return: auth.login ok/failed, auth.lockout, auth.locked. A name longer
    // than kLoginMaxUserBytes or a password longer than kPasswordMaxBytes is Failed at once (the
    // HTTP layer answers these 400 first).
    LoginResult login(std::string_view user, std::string& password, const ClientAddress& from);
    // A request with a token (§1.3 steps 2–3): a valid session for this address and account, then
    // a role of at least `minRole`. `refresh`: the endpoint is one a person uses (roles table);
    // the idle time restarts only when access is granted.
    Access authorize(std::string_view token, const ClientAddress& from, Role minRole, bool refresh);
    // POST /api/v1/auth/logout: ends a valid session of this address; audit auth.logout, best
    // effort (the session ends even when the audit cannot be written; that is logged).
    AccessStatus logout(std::string_view token, const ClientAddress& from);

    bool setupRequired();  // users.json missing or without account (device identity)
    UsersStatus accountsStatus();
    size_t activeSessions();
    size_t hashesWaiting() const;

    // Across execv (research R9): write just before it; load at start (the file is deleted).
    bool saveState(const std::string& path, std::string& err);
    void loadState(const std::string& path);

   private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace mat
