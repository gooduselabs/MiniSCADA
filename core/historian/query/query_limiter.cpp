#include "core/historian/query/query_limiter.hpp"

#include <algorithm>

namespace mat {

namespace {
constexpr size_t kRing = 256;
}

std::optional<QueryLimiter::Ticket> QueryLimiter::tryAcquire(Kind kind,
                                                             const std::string& session) {
    std::lock_guard<std::mutex> g(mu_);
    const bool sessionBusy = !session.empty() && sessions_.count(session) > 0;
    const bool full = kind == Kind::Query ? queries_ >= maxConcurrent_ : exports_ >= 1;
    if (sessionBusy || full) {
        ++s_.rejectedBusy;
        return std::nullopt;
    }
    (kind == Kind::Query ? queries_ : exports_) += 1;
    if (!session.empty()) sessions_.insert(session);
    return Ticket(this, kind, session);
}

void QueryLimiter::release(Kind kind, const std::string& session) {
    std::lock_guard<std::mutex> g(mu_);
    (kind == Kind::Query ? queries_ : exports_) -= 1;
    if (!session.empty()) sessions_.erase(session);
}

void QueryLimiter::recordServed(int64_t elapsedMs) {
    std::lock_guard<std::mutex> g(mu_);
    ++s_.served;
    if (durations_.size() < kRing) {
        durations_.push_back(elapsedMs);
    } else {
        durations_[next_] = elapsedMs;
        next_ = (next_ + 1) % kRing;
    }
}

void QueryLimiter::recordRejectedLimit() {
    std::lock_guard<std::mutex> g(mu_);
    ++s_.rejectedLimit;
}

void QueryLimiter::recordTimeout(int64_t atUtc) {
    std::lock_guard<std::mutex> g(mu_);
    ++s_.timeouts;
    s_.lastErrorCode = "QUERY_TIMEOUT";
    s_.lastErrorAt = atUtc;
}

void QueryLimiter::recordError(const std::string& code, int64_t atUtc) {
    std::lock_guard<std::mutex> g(mu_);
    ++s_.errors;
    s_.lastErrorCode = code;
    s_.lastErrorAt = atUtc;
}

QueryLimiter::Stats QueryLimiter::stats() const {
    std::lock_guard<std::mutex> g(mu_);
    Stats s = s_;
    s.inFlight = queries_ + exports_;
    if (!durations_.empty()) {
        std::vector<int64_t> d = durations_;
        std::sort(d.begin(), d.end());
        s.p95Ms =
            d[std::min(d.size() - 1, static_cast<size_t>(0.95 * static_cast<double>(d.size())))];
    }
    return s;
}

}  // namespace mat
