// Reconnect wait with backoff and jitter (FR-027, research R9):
//   d_n = max(1 s, min(cap, 2^n s) x (1 - 0.2 u)),  u uniform in [0, 1).
// The first wait (n = 0) is exactly 1 s; from the 5th (n = 4) it lies in 8-10 s with cap 10 s.
// The jitter only subtracts (at most 20 %), so the cap is a real upper bound.
#pragma once
#include <cstdint>
#include <functional>

namespace mat::drv {

class Backoff {
   public:
    // `capS`: 1-60 s. `uniform` returns u in [0, 1): injected in tests, a real source in the
    // driver.
    explicit Backoff(int capS = 10, std::function<double()> uniform = nullptr);

    // Wait (ms) before the next attempt; counts the failure.
    int64_t nextDelayMs();
    // Connected again: the next failure starts over at 1 s.
    void reset() { failures_ = 0; }
    int failures() const { return failures_; }
    void setCapS(int capS);

   private:
    int capS_;
    std::function<double()> uniform_;
    int failures_ = 0;
};

// u in [0, 1) from getrandom(); falls back to a time-seeded generator.
double randomUniform();

}  // namespace mat::drv
