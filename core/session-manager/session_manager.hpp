// Limits concurrent live (WebSocket) sessions. Thread-safe. See Master Plan 10.2.
#pragma once
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <mutex>
#include <optional>
#include <vector>

namespace mat {

class SessionManager {
   public:
    static constexpr size_t kHardLimit = 10;
    using Clock = std::function<int64_t()>;  // milliseconds, monotonic

    static size_t clampMax(size_t v) { return std::min(std::max<size_t>(v, 1), kHardLimit); }

    SessionManager(size_t maxClients, Clock clock, int64_t heartbeatTimeoutMs = 15000)
        : max_(clampMax(maxClients)), clock_(std::move(clock)), timeoutMs_(heartbeatTimeoutMs) {}

    // Returns a session id, or nullopt when full (counts a rejection).
    std::optional<uint64_t> tryAcquire() {
        std::lock_guard<std::mutex> g(mu_);
        if (sessions_.size() >= max_) {
            ++rejected_;
            return std::nullopt;
        }
        uint64_t id = ++nextId_;
        sessions_[id] = clock_();
        return id;
    }

    void heartbeat(uint64_t id) {
        std::lock_guard<std::mutex> g(mu_);
        auto it = sessions_.find(id);
        if (it != sessions_.end()) it->second = clock_();
    }

    void release(uint64_t id) {
        std::lock_guard<std::mutex> g(mu_);
        sessions_.erase(id);
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
    mutable std::mutex mu_;
    size_t max_;
    Clock clock_;
    int64_t timeoutMs_;
    std::map<uint64_t, int64_t> sessions_;  // id -> last heartbeat
    uint64_t nextId_ = 0;
    uint64_t rejected_ = 0;
};

}  // namespace mat
