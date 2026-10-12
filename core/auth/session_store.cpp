#include "core/auth/session_store.hpp"

#include <time.h>

#include <algorithm>
#include <utility>

#include "core/auth/password_hash.hpp"
#include "core/crypto/base64url.hpp"
#include "core/crypto/ct_compare.hpp"
#include "core/crypto/random.hpp"

namespace mat {

namespace {

bool expiredAt(const Session& s, int64_t now) {
    return now - s.lastMono > kSessionIdleMs || now - s.createdMono > kSessionMaxMs;
}

bool sameHash(const Sha256Digest& a, const Sha256Digest& b) {
    return constantTimeEqual(a.data(), a.size(), b.data(), b.size());
}

}  // namespace

int64_t bootTimeMs() {
    timespec ts{};
    ::clock_gettime(CLOCK_BOOTTIME, &ts);
    return static_cast<int64_t>(ts.tv_sec) * 1000 + static_cast<int64_t>(ts.tv_nsec) / 1000000;
}

std::string newSessionToken() {
    unsigned char raw[kTokenRandomBytes];
    randomBytes(raw, sizeof raw);
    std::string token = kTokenPrefix + base64urlEncode(raw, sizeof raw);
    secureZero(raw, sizeof raw);
    return token;
}

bool isTokenFormat(std::string_view token) {
    if (token.size() != kTokenLength || token.substr(0, 5) != kTokenPrefix) return false;
    int last = 0;
    for (const char c : token.substr(5)) {
        if (c >= 'A' && c <= 'Z')
            last = c - 'A';
        else if (c >= 'a' && c <= 'z')
            last = c - 'a' + 26;
        else if (c >= '0' && c <= '9')
            last = c - '0' + 52;
        else if (c == '-')
            last = 62;
        else if (c == '_')
            last = 63;
        else
            return false;
    }
    // 43 characters carry 258 bits: the last 2 belong to no byte and are 0 in the one valid text.
    return (last & 3) == 0;
}

SessionStore::SessionStore(TokenFn newToken) : newToken_(std::move(newToken)) {}

std::string SessionStore::create(const std::string& user, int64_t rev, const std::string& sourceIp,
                                 int64_t nowMono) {
    sessions_.erase(std::remove_if(sessions_.begin(), sessions_.end(),
                                   [&](const Session& s) { return expiredAt(s, nowMono); }),
                    sessions_.end());
    if (sessions_.size() >= kMaxSessions) {
        const auto lru = std::min_element(
            sessions_.begin(), sessions_.end(),
            [](const Session& a, const Session& b) { return a.lastMono < b.lastMono; });
        sessions_.erase(lru);
    }
    std::string token = newToken_ ? newToken_() : newSessionToken();
    Session s;
    s.tokenHash = sha256(token);
    s.user = user;
    s.rev = rev;
    s.source = sourceIp;
    s.createdMono = nowMono;
    s.lastMono = nowMono;
    sessions_.push_back(std::move(s));
    return token;
}

SessionCheck SessionStore::check(std::string_view token, std::string_view sourceIp, int64_t nowMono,
                                 const RevOf& revOf) {
    SessionCheck c;
    if (!isTokenFormat(token)) return c;
    const Sha256Digest h = sha256(token);
    auto it = std::find_if(sessions_.begin(), sessions_.end(),
                           [&](const Session& s) { return sameHash(s.tokenHash, h); });
    if (it == sessions_.end()) return c;
    if (expiredAt(*it, nowMono)) {
        sessions_.erase(it);
        return c;
    }
    c.user = it->user;
    if (it->source != sourceIp) {
        c.status = SessionStatus::Invalid;
        return c;
    }
    const std::optional<int64_t> rev = revOf ? revOf(it->user) : std::nullopt;
    if (!rev) {
        c.status = SessionStatus::Invalid;
        return c;
    }
    if (*rev != it->rev) {
        sessions_.erase(it);
        c.status = SessionStatus::Invalid;
        return c;
    }
    c.status = SessionStatus::Ok;
    const int64_t idle = std::max<int64_t>(0, nowMono - it->lastMono);
    const int64_t age = std::max<int64_t>(0, nowMono - it->createdMono);
    c.idleRemainingS = (kSessionIdleMs - idle) / 1000;
    c.lifetimeRemainingS = (kSessionMaxMs - age) / 1000;
    return c;
}

bool SessionStore::touch(std::string_view token, int64_t nowMono) {
    if (!isTokenFormat(token)) return false;
    const Sha256Digest h = sha256(token);
    for (auto& s : sessions_) {
        if (!sameHash(s.tokenHash, h)) continue;
        if (expiredAt(s, nowMono)) return false;
        s.lastMono = std::max(s.lastMono, nowMono);
        return true;
    }
    return false;
}

bool SessionStore::remove(std::string_view token) {
    if (!isTokenFormat(token)) return false;
    const Sha256Digest h = sha256(token);
    const auto it = std::find_if(sessions_.begin(), sessions_.end(),
                                 [&](const Session& s) { return sameHash(s.tokenHash, h); });
    if (it == sessions_.end()) return false;
    sessions_.erase(it);
    return true;
}

size_t SessionStore::removeUser(const std::string& user) {
    const size_t before = sessions_.size();
    sessions_.erase(std::remove_if(sessions_.begin(), sessions_.end(),
                                   [&](const Session& s) { return s.user == user; }),
                    sessions_.end());
    return before - sessions_.size();
}

size_t SessionStore::activeCount(int64_t nowMono) const {
    return static_cast<size_t>(
        std::count_if(sessions_.begin(), sessions_.end(),
                      [&](const Session& s) { return !expiredAt(s, nowMono); }));
}

std::vector<Session> SessionStore::sessions() const { return sessions_; }

void SessionStore::restore(std::vector<Session> sessions, int64_t nowMono) {
    sessions_.clear();
    for (auto& s : sessions) {
        if (expiredAt(s, nowMono) || s.createdMono > s.lastMono || s.lastMono > nowMono) continue;
        const bool twice = std::any_of(sessions_.begin(), sessions_.end(), [&](const Session& o) {
            return sameHash(o.tokenHash, s.tokenHash);
        });
        if (!twice) sessions_.push_back(std::move(s));
    }
    if (sessions_.size() > kMaxSessions) {
        std::sort(sessions_.begin(), sessions_.end(),
                  [](const Session& a, const Session& b) { return a.lastMono > b.lastMono; });
        sessions_.resize(kMaxSessions);
    }
}

}  // namespace mat
