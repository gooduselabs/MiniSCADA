#include "core/auth/login_guard.hpp"

#include <algorithm>
#include <set>
#include <utility>

namespace mat {

namespace {

using Table = std::vector<GuardEntry>;  // least recently used first

Table::iterator findKey(Table& t, const std::string& key) {
    return std::find_if(t.begin(), t.end(), [&](const GuardEntry& e) { return e.key == key; });
}

bool lockedAt(const GuardEntry& e, int64_t now) { return e.lockedUntilMono > now; }

int64_t remainingMs(Table& t, const std::string& key, int64_t now) {
    const auto it = findKey(t, key);
    return it == t.end() || !lockedAt(*it, now) ? 0 : it->lockedUntilMono - now;
}

// The entry of `key`, moved to the most recently used end (made if needed). A full table first
// drops its least recently used entry that is not locked, so a flood of new names or addresses
// cannot lift a lock; when every entry is locked, the one whose lock ends first goes.
GuardEntry& use(Table& t, const std::string& key, int64_t now) {
    auto it = findKey(t, key);
    if (it != t.end()) {
        GuardEntry e = std::move(*it);
        t.erase(it);
        t.push_back(std::move(e));
        return t.back();
    }
    if (t.size() >= kGuardTableSize) {
        auto victim = std::find_if(t.begin(), t.end(),
                                   [&](const GuardEntry& e) { return !lockedAt(e, now); });
        if (victim == t.end())
            victim =
                std::min_element(t.begin(), t.end(), [](const GuardEntry& a, const GuardEntry& b) {
                    return a.lockedUntilMono < b.lockedUntilMono;
                });
        t.erase(victim);
    }
    GuardEntry e;
    e.key = key;
    t.push_back(std::move(e));
    return t.back();
}

// One more failure; true when it locks.
bool countFailure(GuardEntry& e, int64_t now) {
    if (lockedAt(e, now)) return false;  // AuthService checks first: does not happen through it
    if (++e.failures < kLoginMaxFailures) return false;
    e.failures = 0;
    e.lockedUntilMono = now + kLockoutMs;
    return true;
}

// The last entry of each key, at most kGuardTableSize, no empty key; order kept.
Table cleaned(Table t) {
    Table out;
    std::set<std::string> seen;
    for (auto it = t.rbegin(); it != t.rend() && out.size() < kGuardTableSize; ++it)
        if (!it->key.empty() && seen.insert(it->key).second) out.push_back(std::move(*it));
    std::reverse(out.begin(), out.end());
    return out;
}

}  // namespace

GuardDecision LoginGuard::check(const std::string& user, const std::string& sourceIp,
                                int64_t nowMono,
                                const std::optional<AccountGeneration>& generation) {
    int64_t ms = remainingMs(bySource_, sourceIp, nowMono);
    if (!user.empty()) {
        const auto it = findKey(byUser_, user);
        if (it != byUser_.end() && it->generation != generation)
            byUser_.erase(it);  // the account changed since: its count starts again
        ms = std::max(ms, remainingMs(byUser_, user, nowMono));
    }
    GuardDecision d;
    d.locked = ms > 0;
    d.retryAfterS = (ms + 999) / 1000;
    return d;
}

LockoutNow LoginGuard::recordFailure(const std::string& user, const std::string& sourceIp,
                                     int64_t nowMono,
                                     const std::optional<AccountGeneration>& generation) {
    LockoutNow l;
    if (!user.empty()) {
        GuardEntry& e = use(byUser_, user, nowMono);
        if (e.generation != generation) {
            e.failures = 0;
            e.lockedUntilMono = 0;
            e.generation = generation;
        }
        l.user = countFailure(e, nowMono);
    }
    l.source = countFailure(use(bySource_, sourceIp, nowMono), nowMono);
    return l;
}

void LoginGuard::recordSuccess(const std::string& user, const std::string& sourceIp) {
    if (!user.empty()) clearUser(user);
    const auto it = findKey(bySource_, sourceIp);
    if (it != bySource_.end()) bySource_.erase(it);
}

void LoginGuard::clearUser(const std::string& user) {
    const auto it = findKey(byUser_, user);
    if (it != byUser_.end()) byUser_.erase(it);
}

GuardState LoginGuard::state() const { return {byUser_, bySource_}; }

void LoginGuard::restore(GuardState state) {
    byUser_ = cleaned(std::move(state.byUser));
    bySource_ = cleaned(std::move(state.bySource));
}

}  // namespace mat
