// Sessions of signed-in clients (specs/005-device-online data-model §5, research R9, ADR-011): in
// memory, keyed by the SHA-256 of the token; the token itself is never kept. Times are
// CLOCK_BOOTTIME ms: neither NTP nor a wrong RTC moves them, and execv keeps them. Not thread-safe:
// AuthService holds its lock.
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
constexpr size_t kTokenRandomBytes = 32;
constexpr size_t kTokenLength = 5 + 43;  // "mats_" + base64url of 32 bytes

int64_t bootTimeMs();  // CLOCK_BOOTTIME, ms

// "mats_" + base64url without padding of 32 bytes from getrandom.
std::string newSessionToken();
// Shape only: the prefix, then the one base64url text of 32 bytes (43 characters). Checked without
// decoding, so no copy of the secret is made.
bool isTokenFormat(std::string_view token);

struct Session {
    Sha256Digest tokenHash{};
    std::string user;
    int64_t rev = 0;     // of the account at sign-in
    std::string source;  // IP address at sign-in
    int64_t createdMono = 0;
    int64_t lastMono = 0;  // last request a person made
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
};

class SessionStore {
   public:
    // rev of an enabled account; nullopt when the account is gone or disabled.
    using RevOf = std::function<std::optional<int64_t>(const std::string& user)>;
    using TokenFn = std::function<std::string()>;

    explicit SessionStore(TokenFn newToken = {});  // empty: newSessionToken

    // A new session; at kMaxSessions the least recently used one goes. Returns the token.
    std::string create(const std::string& user, int64_t rev, const std::string& sourceIp,
                       int64_t nowMono);
    // The session of `token` for a request from `sourceIp`. Expired and rev-changed sessions are
    // removed; a request from another address leaves the session to its owner.
    SessionCheck check(std::string_view token, std::string_view sourceIp, int64_t nowMono,
                       const RevOf& revOf);
    // A request a person made (§1.3) on a session check() accepted: restarts its idle time.
    bool touch(std::string_view token, int64_t nowMono);
    bool remove(std::string_view token);  // sign-out
    size_t removeUser(const std::string& user);
    size_t activeCount(int64_t nowMono) const;

    // For auth-state.json across execv: sessions as kept (hashes only) and back.
    std::vector<Session> sessions() const;
    // Drops expired and duplicate sessions, keeps the kMaxSessions used last.
    void restore(std::vector<Session> sessions, int64_t nowMono);

   private:
    TokenFn newToken_;
    std::vector<Session> sessions_;
};

}  // namespace mat
