// Simulated tags for the Sprint 0 PoC: SIM.T0001 .. SIM.T0500, random-walk values.
#pragma once
#include <cstddef>
#include <cstdint>
#include <vector>

namespace mat {

class SimTags {
   public:
    explicit SimTags(size_t count = 500) : values_(count, 50.0), state_(0x9E3779B97F4A7C15ull) {
        for (auto& v : values_) v = 20.0 + rnd() * 60.0;
    }
    size_t size() const { return values_.size(); }
    double value(size_t i) const { return values_[i]; }

    // Advances n tags starting at *cursor (wraps) and reports their indexes.
    // Calling with n = size/4 every 250 ms changes every tag once per second.
    void step(size_t* cursor, size_t n, std::vector<size_t>* changed) {
        changed->clear();
        for (size_t k = 0; k < n; ++k) {
            size_t i = (*cursor + k) % values_.size();
            double v = values_[i] + (rnd() - 0.5) * 2.0;
            values_[i] = v < 0 ? 0 : (v > 100 ? 100 : v);
            changed->push_back(i);
        }
        *cursor = (*cursor + n) % values_.size();
    }

   private:
    double rnd() {  // xorshift64*, uniform [0,1)
        state_ ^= state_ >> 12;
        state_ ^= state_ << 25;
        state_ ^= state_ >> 27;
        // NOLINTNEXTLINE(bugprone-narrowing-conversions): a 53-bit value, exact in double
        return ((state_ * 0x2545F4914F6CDD1Dull) >> 11) * (1.0 / 9007199254740992.0);
    }
    std::vector<double> values_;
    uint64_t state_;
};

}  // namespace mat
