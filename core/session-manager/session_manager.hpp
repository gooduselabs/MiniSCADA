// Limits concurrent live (WebSocket) sessions. Thread-safe. See Master Plan 10.2.
// Security review of 011 (M1): one source address holds at most its share of the slots
// (setMaxPerSource; the runtime uses runtime.json maxLiveClientsPerSource, by default
// ceil(maxClients / 2)), so one host cannot take every slot of the device.
#pragma once
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace mat {

class SessionManager {
   public:
    static constexpr size_t kHardLimit = 10;
    using Clock = std::function<int64_t()>;  // milliseconds, monotonic

    static size_t clampMax(size_t v) { return std::min(std::max<size_t>(v, 1), kHardLimit); }
    // The share of one source when runtime.json does not set it: half the slots, rounded up.
    static size_t defaultMaxPerSource(size_t maxClients) { return (clampMax(maxClients) + 1) / 2; }
    // runtime.json maxLiveClientsPerSource as it applies: 0 (not set) is the default share, any
    // value is at most maxClients.
    static size_t effectiveMaxPerSource(int configured, size_t maxClients) {
        if (configured <= 0) return defaultMaxPerSource(maxClients);
        return std::min(static_cast<size_t>(configured), clampMax(maxClients));
    }

    struct Acquired {
        std::optional<uint64_t> id;  // nullopt: refused (counted in rejectedTotal)
        bool sourceFull = false;     // refused because the source holds its share, not the device
    };

    SessionManager(size_t maxClients, Clock clock, int64_t heartbeatTimeoutMs = 15000)
        : max_(clampMax(maxClients)), clock_(std::move(clock)), timeoutMs_(heartbeatTimeoutMs) {}

    // At most `n` sessions of one source (0: no share, only the global limit), at most maxClients.
    void setMaxPerSource(size_t n) {
        std::lock_guard<std::mutex> g(mu_);
        perSource_ = n == 0 ? 0 : std::min(n, max_);
    }
    size_t maxPerSource() const {
        std::lock_guard<std::mutex> g(mu_);
        return perSource_;
    }

    // Returns a session id, or nullopt when full (counts a rejection). No source: only the global
    // limit applies.
    std::optional<uint64_t> tryAcquire() { return tryAcquireFrom("").id; }

    // A session of `source` (an IP address): refused when the device is full, or when the source
    // already holds its share.
    Acquired tryAcquireFrom(const std::string& source) {
        std::lock_guard<std::mutex> g(mu_);
        Acquired a;
        if (sessions_.size() >= max_) {
            ++rejected_;
            return a;
        }
        if (perSource_ > 0 && !source.empty()) {
            const auto it = bySource_.find(source);
            if (it != bySource_.end() && it->second >= perSource_) {
                ++rejected_;
                a.sourceFull = true;
                return a;
            }
        }
        uint64_t id = ++nextId_;
        sessions_[id] = clock_();
        if (!source.empty()) {
            sourceOf_[id] = source;
            ++bySource_[source];
        }
        a.id = id;
        return a;
    }

    size_t sourceCount(const std::string& source) const {
        std::lock_guard<std::mutex> g(mu_);
        const auto it = bySource_.find(source);
        return it == bySource_.end() ? 0 : it->second;
    }

    void heartbeat(uint64_t id) {
        std::lock_guard<std::mutex> g(mu_);
        auto it = sessions_.find(id);
        if (it != sessions_.end()) it->second = clock_();
    }

    void release(uint64_t id) {
        std::lock_guard<std::mutex> g(mu_);
        if (sessions_.erase(id) > 0) forgetSource(id);
    }

    // Drops sessions silent for longer than the timeout; returns how many were dropped.
    size_t expire() { return expireIds().size(); }

    // Same as expire() but returns the ids that were dropped (so callers can close them).
    std::vector<uint64_t> expireIds() {
        std::lock_guard<std::mutex> g(mu_);
        std::vector<uint64_t> dropped;
        const int64_t now = clock_();
        for (auto it = sessions_.begin(); it != sessions_.end();) {
            if (now - it->second > timeoutMs_) {
                dropped.push_back(it->first);
                forgetSource(it->first);
                it = sessions_.erase(it);
            } else {
                ++it;
            }
        }
        return dropped;
    }

    size_t active() const {
        std::lock_guard<std::mutex> g(mu_);
        return sessions_.size();
    }
    size_t maxClients() const { return max_; }
    uint64_t rejectedTotal() const {
        std::lock_guard<std::mutex> g(mu_);
        return rejected_;
    }

   private:
    void forgetSource(uint64_t id) {  // under mu_
        const auto s = sourceOf_.find(id);
        if (s == sourceOf_.end()) return;
        const auto n = bySource_.find(s->second);
        if (n != bySource_.end() && --n->second == 0) bySource_.erase(n);
        sourceOf_.erase(s);
    }

    mutable std::mutex mu_;
    size_t max_;
    size_t perSource_ = 0;  // 0: no share
    std::map<uint64_t, std::string> sourceOf_;
    std::map<std::string, size_t> bySource_;
    Clock clock_;
    int64_t timeoutMs_;
    std::map<uint64_t, int64_t> sessions_;  // id -> last heartbeat
    uint64_t nextId_ = 0;
    uint64_t rejected_ = 0;
};

}  // namespace mat
