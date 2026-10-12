// The rate limit of tag writes (FR-041; research R14): a token bucket on a monotonic clock, and the
// two tiers of it, one bucket per session (the key is the hash of the token) and one for the whole
// device. A command spends one token of each; when a tier is empty the answer says how long to
// wait. Only commands that passed the checks of FR-037 steps 1-5 spend tokens, and a command
// refused after that (project changing, audit down, queue full) gives its token back.
#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <mutex>
#include <string>

namespace mat {

class TokenBucket {
   public:
    // `burst` tokens at once, refilled at `perMin` a minute. Both are raised to at least 1.
    TokenBucket(int burst, int perMin);
    // Takes one token. false: none left; `retryAfterMs` (if given) is when the next one is there.
    bool tryTake(int64_t nowMs, int64_t* retryAfterMs = nullptr);
    // How long until a token is there; 0 when one is.
    int64_t waitMs(int64_t nowMs);
    // Gives one token back (never above the burst).
    void refund(int64_t nowMs);

   private:
    void refill(int64_t nowMs);
    double burst_;
    double perMs_;
    double tokens_;
    int64_t last_ = 0;
    bool started_ = false;
};

struct RateConfig {
    int sessionBurst = 10;
    int sessionPerMin = 20;
    int globalBurst = 20;
    int globalPerMin = 20;  // provisional (research R15), the ceiling of the spec is 30
};

class WriteRateLimiter {
   public:
    WriteRateLimiter(RateConfig config, std::function<int64_t()> monoMs);

    struct Decision {
        bool ok = false;
        int64_t retryAfterMs = 0;  // with !ok: wait this long
    };
    // Spends a token of the session and of the device, or none (and says the longer wait).
    Decision take(const std::string& sessionKey);
    void refund(const std::string& sessionKey);
    size_t sessionCount() const;

   private:
    struct Entry {
        TokenBucket bucket;
        int64_t used = 0;
    };
    Entry& entry(const std::string& key, int64_t now);

    RateConfig cfg_;
    std::function<int64_t()> mono_;
    mutable std::mutex mu_;
    TokenBucket global_;
    std::map<std::string, Entry> sessions_;
};

}  // namespace mat
