#include "core/tag-engine/token_bucket.hpp"

#include <algorithm>
#include <cmath>

namespace mat {

namespace {
constexpr size_t kMaxSessions = 1024;
}

TokenBucket::TokenBucket(int burst, int perMin)
    : burst_(std::max(1, burst)),
      perMs_(static_cast<double>(std::max(1, perMin)) / 60000.0),
      tokens_(burst_) {}

void TokenBucket::refill(int64_t nowMs) {
    if (!started_) {
        started_ = true;
        last_ = nowMs;
        return;
    }
    if (nowMs > last_) {
        tokens_ = std::min(burst_, tokens_ + static_cast<double>(nowMs - last_) * perMs_);
        last_ = nowMs;
    }
}

int64_t TokenBucket::waitMs(int64_t nowMs) {
    refill(nowMs);
    if (tokens_ >= 1.0 - 1e-9) return 0;
    return static_cast<int64_t>(std::ceil((1.0 - tokens_) / perMs_ - 1e-9));
}

bool TokenBucket::tryTake(int64_t nowMs, int64_t* retryAfterMs) {
    const int64_t wait = waitMs(nowMs);
    if (wait > 0) {
        if (retryAfterMs) *retryAfterMs = wait;
        return false;
    }
    tokens_ = std::max(0.0, tokens_ - 1.0);
    if (retryAfterMs) *retryAfterMs = 0;
    return true;
}

void TokenBucket::refund(int64_t nowMs) {
    refill(nowMs);
    tokens_ = std::min(burst_, tokens_ + 1.0);
}

WriteRateLimiter::WriteRateLimiter(RateConfig config, std::function<int64_t()> monoMs)
    : cfg_(config), mono_(std::move(monoMs)), global_(config.globalBurst, config.globalPerMin) {}

WriteRateLimiter::Entry& WriteRateLimiter::entry(const std::string& key, int64_t now) {
    auto it = sessions_.find(key);
    if (it == sessions_.end()) {
        if (sessions_.size() >= kMaxSessions) {  // the one used longest ago goes
            auto oldest = sessions_.begin();
            for (auto i = sessions_.begin(); i != sessions_.end(); ++i)
                if (i->second.used < oldest->second.used) oldest = i;
            sessions_.erase(oldest);
        }
        it = sessions_.emplace(key, Entry{TokenBucket(cfg_.sessionBurst, cfg_.sessionPerMin), now})
                 .first;
    }
    it->second.used = now;
    return it->second;
}

WriteRateLimiter::Decision WriteRateLimiter::take(const std::string& sessionKey) {
    std::lock_guard<std::mutex> g(mu_);
    const int64_t now = mono_();
    Entry& e = entry(sessionKey, now);
    const int64_t waitSession = e.bucket.waitMs(now);
    const int64_t waitGlobal = global_.waitMs(now);
    Decision d;
    if (waitSession > 0 || waitGlobal > 0) {  // nothing is spent
        d.retryAfterMs = std::max(waitSession, waitGlobal);
        return d;
    }
    e.bucket.tryTake(now);
    global_.tryTake(now);
    d.ok = true;
    return d;
}

void WriteRateLimiter::refund(const std::string& sessionKey) {
    std::lock_guard<std::mutex> g(mu_);
    const int64_t now = mono_();
    const auto it = sessions_.find(sessionKey);
    if (it != sessions_.end()) it->second.bucket.refund(now);
    global_.refund(now);
}

size_t WriteRateLimiter::sessionCount() const {
    std::lock_guard<std::mutex> g(mu_);
    return sessions_.size();
}

}  // namespace mat
