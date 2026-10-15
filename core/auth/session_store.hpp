// Sessions of signed-in clients (specs/005-device-online data-model §5, research R9, ADR-011): in
// memory, keyed by the SHA-256 of the token; the token itself is never kept. Times are
// CLOCK_BOOTTIME ms: neither NTP nor a wrong RTC moves them, and execv keeps them. Not thread-safe:
// AuthService holds its lock.
//
// Feature 007 (ADR-021, contracts/web-session.md §1): a second kind of session, `web`, for the page
// that runs in a browser. Its token starts with "matw_" (Bearer: "mats_"), it carries a CSRF token
// (kept in plain text: the page asks for it again after F5; RAM and auth-state.json only), and
// its idle and lifetime limits are the configuration's. The two kinds share the table (at most 32
// together), the accounts and the lockout; one kind never works in place of the other.
#pragma once
#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "core/crypto/sha256.hpp"

namespace mat {

constexpr int64_t kSessionIdleMs = 30LL * 60 * 1000;      // FR-012: 30 minutes without a request
constexpr int64_t kSessionMaxMs = 12LL * 60 * 60 * 1000;  // FR-012: 12 hours in all
constexpr size_t kMaxSessions = 32;
constexpr const char* kTokenPrefix = "mats_";
constexpr const char* kWebTokenPrefix = "matw_";
constexpr size_t kMaxWebSessionsDefault = 12;
constexpr size_t kTokenRandomBytes = 32;
constexpr size_t kTokenLength = 5 + 43;  // "mats_" + base64url of 32 bytes
constexpr size_t kCsrfLength = 43;       // base64url of 32 bytes

int64_t bootTimeMs();  // CLOCK_BOOTTIME, ms

enum class SessionKind { Bearer, Web };

// "mats_" + base64url without padding of 32 bytes from getrandom.
std::string newSessionToken();
// "matw_" + the same.
std::string newWebSessionToken();
// 32 bytes from getrandom as 43 base64url characters (the CSRF token of a web session).
std::string newCsrfToken();
// Shape only: the prefix, then the one base64url text of 32 bytes (43 characters). Checked without
// decoding, so no copy of the secret is made.
bool isTokenFormat(std::string_view token);     // Bearer: "mats_"
bool isWebTokenFormat(std::string_view token);  // web: "matw_"
// 43 base64url characters whose last two bits are zero: what newCsrfToken makes.
bool isCsrfFormat(std::string_view csrf);

struct Session {
    Sha256Digest tokenHash{};
    std::string user;
    int64_t rev = 0;     // of the account at sign-in
    std::string source;  // IP address at sign-in
    int64_t createdMono = 0;
    int64_t lastMono = 0;  // last request a person made
    SessionKind kind = SessionKind::Bearer;
    std::string csrf;                      // web only
    int64_t idleLimitMs = kSessionIdleMs;  // the limits of this session
    int64_t maxLimitMs = kSessionMaxMs;
};

enum class SessionStatus {
    Ok,
    Expired,  // unknown token, idle or lifetime over: 401 SESSION_EXPIRED
    Invalid,  // another address, account gone or disabled, rev changed: 401 SESSION_INVALID
};

struct SessionCheck {
    SessionStatus status = SessionStatus::Expired;
    std::string user;                // Ok and Invalid
    int64_t idleRemainingS = 0;      // Ok
    int64_t lifetimeRemainingS = 0;  // Ok
    std::string csrf;                // Ok, web sessions
    int64_t idleLimitS = 0;          // Ok
    int64_t maxLimitS = 0;           // Ok
};

struct WebSessionCreated {
    std::string token;  // "matw_…"
    std::string csrf;
    std::optional<std::string> evicted;  // the user of the session that left for this one
};

class SessionStore {
   public:
    // rev of an enabled account; nullopt when the account is gone or disabled.
    using RevOf = std::function<std::optional<int64_t>(const std::string& user)>;
    using TokenFn = std::function<std::string()>;

    // Empty functions: newSessionToken, newWebSessionToken, newCsrfToken.
    explicit SessionStore(TokenFn newToken = {}, TokenFn newWebToken = {}, TokenFn newCsrf = {});

    // A new Bearer session; at kMaxSessions the least recently used one goes. Returns the token.
    std::string create(const std::string& user, int64_t rev, const std::string& sourceIp,
                       int64_t nowMono);
    // A new web session. When `maxWeb` web sessions exist, the idlest of them goes (named in
    // `evicted`); at kMaxSessions of all kinds the least recently used one goes too.
    WebSessionCreated createWeb(const std::string& user, int64_t rev, const std::string& sourceIp,
                                int64_t nowMono, int64_t idleLimitMs, int64_t maxLimitMs,
                                size_t maxWeb);
    // The session of `token` (of that kind) for a request from `sourceIp`. Expired and
    // rev-changed sessions are removed; a request from another address leaves the session to its
    // owner.
    SessionCheck check(std::string_view token, std::string_view sourceIp, int64_t nowMono,
                       const RevOf& revOf, SessionKind kind = SessionKind::Bearer);
    // A request a person made (§1.3) on a session check() accepted: restarts its idle time.
    bool touch(std::string_view token, int64_t nowMono, SessionKind kind = SessionKind::Bearer);
    bool remove(std::string_view token, SessionKind kind = SessionKind::Bearer);  // sign-out
    size_t removeUser(const std::string& user);
    size_t activeCount(int64_t nowMono) const;

    // For auth-state.json across execv: sessions as kept (hashes only) and back.
    std::vector<Session> sessions() const;
    // Drops expired and duplicate sessions, keeps the kMaxSessions used last.
    void restore(std::vector<Session> sessions, int64_t nowMono);

   private:
    TokenFn newToken_, newWebToken_, newCsrf_;
    std::vector<Session> sessions_;
};

}  // namespace mat
