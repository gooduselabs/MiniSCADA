#include "core/auth/login_guard.hpp"

#include <algorithm>
#include <set>
#include <utility>

#include "core/auth/account_store.hpp"

namespace mat {

namespace {

constexpr size_t kWatchKeep = 64;  // failures kept per watched name (at least 50)

bool lockedAt(int64_t lockedUntil, int64_t now) { return lockedUntil > now; }

// The entry `match` finds, moved to the most recently used end; `make` when there is none. A full
// table first drops its least recently used entry that `cheap` names (L5 of the security review of
// 011: a pair that never locked, so a flood cannot erase the history that doubles a repeated lock),
// then the least recently used one that is not locked, so a flood of new pairs or addresses cannot
// lift a lock; when every entry is locked, the one whose lock ends first goes.
template <typename Entry, typename Match, typename Make, typename Cheap>
Entry& use(std::vector<Entry>& t, size_t cap, int64_t now, Match match, Make make, Cheap cheap) {
    auto it = std::find_if(t.begin(), t.end(), match);
    if (it != t.end()) {
        if (it + 1 != t.end()) std::rotate(it, it + 1, t.end());
        return t.back();
    }
    if (t.size() >= cap) {
        auto victim = std::find_if(t.begin(), t.end(), [&](const Entry& e) {
            return !lockedAt(e.lockedUntilMono, now) && cheap(e);
        });
        if (victim == t.end())
            victim = std::find_if(t.begin(), t.end(), [&](const Entry& e) {
                return !lockedAt(e.lockedUntilMono, now);
            });
        if (victim == t.end())
            victim = std::min_element(t.begin(), t.end(), [](const Entry& a, const Entry& b) {
                return a.lockedUntilMono < b.lockedUntilMono;
            });
        t.erase(victim);
    }
    t.push_back(make());
    return t.back();
}

void prune(std::vector<int64_t>& times, int64_t now) {
    const auto keep = std::find_if(times.begin(), times.end(),
                                   [&](int64_t t) { return t > now - kSourceWindowMs; });
    times.erase(times.begin(), keep);
}

uint32_t addressHash(const std::string& ip) {  // FNV-1a: a collision only counts one address less
    uint32_t h = 2166136261u;
    for (const char c : ip) {
        h ^= static_cast<unsigned char>(c);
        h *= 16777619u;
    }
    return h;
}

int64_t pairLockMs(int lockCount) {
    int64_t ms = kPairLockMs;
    for (int i = 1; i < lockCount && ms < kPairLockMaxMs; ++i) ms *= 2;
    return std::min(ms, kPairLockMaxMs);
}

}  // namespace

std::string guardName(std::string_view typed) {
    return validAccountName(typed) ? std::string(typed) : std::string();
}

GuardDecision LoginGuard::check(const std::string& user, const std::string& sourceIp,
                                int64_t nowMono,
                                const std::optional<AccountGeneration>& generation) {
    int64_t ms = 0;
    const auto src = std::find_if(sources_.begin(), sources_.end(),
                                  [&](const SourceEntry& e) { return e.ip == sourceIp; });
    if (src != sources_.end() && lockedAt(src->lockedUntilMono, nowMono))
        ms = src->lockedUntilMono - nowMono;
    if (!user.empty()) {
        const auto it = std::find_if(pairs_.begin(), pairs_.end(), [&](const PairEntry& e) {
            return e.user == user && e.ip == sourceIp;
        });
        if (it != pairs_.end()) {
            if (it->generation != generation) {
                pairs_.erase(it);  // the account changed since: its count starts again
            } else {
                if (lockedAt(it->lockedUntilMono, nowMono))
                    ms = std::max(ms, it->lockedUntilMono - nowMono);
                if (it + 1 != pairs_.end()) std::rotate(it, it + 1, pairs_.end());  // used
            }
        }
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
        PairEntry& e = use(
            pairs_, kPairTableSize, nowMono,
            [&](const PairEntry& p) { return p.user == user && p.ip == sourceIp; },
            [&] {
                PairEntry p;
                p.user = user;
                p.ip = sourceIp;
                p.generation = generation;
                return p;
            },
            [&](const PairEntry& p) {  // no lock whose history still counts (24 h)
                return p.lockCount == 0 || nowMono - p.lastLockMono >= kPairRepeatWindowMs;
            });
        if (e.generation != generation) {
            const std::string u = e.user, ip = e.ip;
            e = PairEntry{};
            e.user = u;
            e.ip = ip;
            e.generation = generation;
        }
        // AuthService checks first, so a locked pair does not count here through it.
        if (!lockedAt(e.lockedUntilMono, nowMono) && ++e.failures >= kPairMaxFailures) {
            e.failures = 0;
            const bool repeat = e.lockCount > 0 && nowMono - e.lastLockMono < kPairRepeatWindowMs;
            e.lockCount = repeat ? e.lockCount + 1 : 1;
            e.lastLockMono = nowMono;
            l.pairLockMs = pairLockMs(e.lockCount);
            e.lockedUntilMono = nowMono + l.pairLockMs;
            l.pair = true;
        }
    }
    SourceEntry& s = use(
        sources_, kSourceTableSize, nowMono, [&](const SourceEntry& e) { return e.ip == sourceIp; },
        [&] {
            SourceEntry e;
            e.ip = sourceIp;
            return e;
        },
        [&](const SourceEntry& e) {  // no failure within the window
            return e.failuresMono.empty() || e.failuresMono.back() <= nowMono - kSourceWindowMs;
        });
    if (!lockedAt(s.lockedUntilMono, nowMono)) {
        if (s.lockedUntilMono != 0) {  // a lock has ended: the count starts again
            s.failuresMono.clear();
            s.lockedUntilMono = 0;
            s.lockedByMono = 0;
        }
        prune(s.failuresMono, nowMono);
        s.failuresMono.push_back(nowMono);
        if (s.failuresMono.size() >= static_cast<size_t>(kSourceMaxFailures)) {
            // The failures stay until the lock ends, so a right password of the attempt that
            // locked takes back only its own.
            s.lockedUntilMono = nowMono + kSourceLockMs;
            s.lockedByMono = nowMono;
            l.source = true;
        }
    }
    return l;
}

void LoginGuard::recordSuccess(const std::string& user, const std::string& sourceIp,
                               int64_t attemptMono) {
    if (!user.empty()) {
        const auto it = std::find_if(pairs_.begin(), pairs_.end(), [&](const PairEntry& e) {
            return e.user == user && e.ip == sourceIp;
        });
        if (it != pairs_.end()) pairs_.erase(it);
    }
    const auto src = std::find_if(sources_.begin(), sources_.end(),
                                  [&](const SourceEntry& e) { return e.ip == sourceIp; });
    if (src == sources_.end()) return;
    if (src->lockedUntilMono != 0) {
        if (src->lockedByMono != attemptMono) return;  // locked by a real failure
        src->lockedUntilMono = 0;  // the lock this attempt set was no failure after all
        src->lockedByMono = 0;
    }
    auto& f = src->failuresMono;
    const auto mine = std::find(f.rbegin(), f.rend(), attemptMono);
    if (mine != f.rend()) f.erase(std::next(mine).base());
}

std::optional<DistributedAttack> LoginGuard::noteFailure(const std::string& user,
                                                         const std::string& sourceIp,
                                                         int64_t nowMono) {
    if (user.empty()) return std::nullopt;
    auto it =
        std::find_if(watch_.begin(), watch_.end(), [&](const Watch& w) { return w.user == user; });
    if (it != watch_.end()) {
        if (it + 1 != watch_.end()) std::rotate(it, it + 1, watch_.end());
    } else {
        if (watch_.size() >= kWatchTableSize) {
            // L5 of the review of 011: first a name whose failures are all older than the window,
            // then the name with the fewest failures (the least recently used among them), so a
            // flood of names tried once cannot push out a name under attack.
            const auto aged = [&](const Watch& x) {
                return x.failures.empty() ||
                       x.failures.back().first <= nowMono - kDistributedWindowMs;
            };
            auto victim = std::find_if(watch_.begin(), watch_.end(), aged);
            if (victim == watch_.end())
                victim = std::min_element(watch_.begin(), watch_.end(),
                                          [](const Watch& a, const Watch& b) {
                                              return a.failures.size() < b.failures.size();
                                          });
            watch_.erase(victim);
        }
        Watch w;
        w.user = user;
        watch_.push_back(std::move(w));
    }
    Watch& w = watch_.back();
    const auto keep = std::find_if(w.failures.begin(), w.failures.end(), [&](const auto& f) {
        return f.first > nowMono - kDistributedWindowMs;
    });
    w.failures.erase(w.failures.begin(), keep);
    if (w.failures.size() >= kWatchKeep) w.failures.erase(w.failures.begin());
    w.failures.emplace_back(nowMono, addressHash(sourceIp));
    if (w.failures.size() < static_cast<size_t>(kDistributedMinFailures)) return std::nullopt;
    if (w.reported && nowMono - w.lastReportMono < kDistributedWindowMs) return std::nullopt;
    std::set<uint32_t> sources;
    for (const auto& f : w.failures) sources.insert(f.second);
    if (sources.size() < kDistributedMinSources) return std::nullopt;
    w.reported = true;
    w.lastReportMono = nowMono;
    DistributedAttack a;
    a.failures = static_cast<int>(w.failures.size());
    a.sources = sources.size();
    return a;
}

void LoginGuard::clearUser(const std::string& user) {
    pairs_.erase(std::remove_if(pairs_.begin(), pairs_.end(),
                                [&](const PairEntry& e) { return e.user == user; }),
                 pairs_.end());
}

int64_t LoginGuard::lockedUntilMono(const std::string& user, int64_t nowMono) const {
    int64_t until = 0;
    for (const PairEntry& p : pairs_)
        if (p.user == user && p.lockedUntilMono > nowMono)
            until = std::max(until, p.lockedUntilMono);
    return until;
}

void LoginGuard::clearAll() {
    pairs_.clear();
    sources_.clear();
}

GuardState LoginGuard::state() const { return {pairs_, sources_}; }

void LoginGuard::restore(GuardState state) {
    // The last entry of each key, up to the table sizes; order kept.
    std::vector<PairEntry> pairs;
    std::set<std::pair<std::string, std::string>> seenPairs;
    for (auto it = state.pairs.rbegin(); it != state.pairs.rend() && pairs.size() < kPairTableSize;
         ++it)
        if (!it->user.empty() && !it->ip.empty() && seenPairs.emplace(it->user, it->ip).second)
            pairs.push_back(std::move(*it));
    std::reverse(pairs.begin(), pairs.end());
    std::vector<SourceEntry> sources;
    std::set<std::string> seen;
    for (auto it = state.sources.rbegin();
         it != state.sources.rend() && sources.size() < kSourceTableSize; ++it)
        if (!it->ip.empty() && seen.insert(it->ip).second) sources.push_back(std::move(*it));
    std::reverse(sources.begin(), sources.end());
    pairs_ = std::move(pairs);
    sources_ = std::move(sources);
}

}  // namespace mat
