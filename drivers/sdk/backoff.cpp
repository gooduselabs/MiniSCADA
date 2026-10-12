#include "drivers/sdk/backoff.hpp"

#include <sys/random.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <random>

namespace mat::drv {

double randomUniform() {
    uint32_t v = 0;
    if (getrandom(&v, sizeof v, 0) != static_cast<ssize_t>(sizeof v)) {
        static std::mt19937 fallback(
            static_cast<uint32_t>(std::chrono::steady_clock::now().time_since_epoch().count()));
        v = fallback();
    }
    return static_cast<double>(v) / 4294967296.0;
}

Backoff::Backoff(int capS, std::function<double()> uniform)
    : capS_(std::clamp(capS, 1, 60)), uniform_(uniform ? std::move(uniform) : randomUniform) {}

void Backoff::setCapS(int capS) { capS_ = std::clamp(capS, 1, 60); }

int64_t Backoff::nextDelayMs() {
    const int n = std::min(failures_, 30);
    ++failures_;
    const double raw = std::min(static_cast<double>(capS_), std::ldexp(1.0, n)) * 1000.0;
    const double u = uniform_();
    const double d = std::max(1000.0, raw * (1.0 - 0.2 * u));
    return static_cast<int64_t>(d);
}

}  // namespace mat::drv
