#include "drivers/simulation/mock_tag_provider.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>

namespace mat {

namespace {
constexpr double kPi = 3.14159265358979323846;
constexpr double kFillRate = 80.0 / 30.0;   // %/s while running: 10 -> 90 % in 30 s
constexpr double kDrainRate = 80.0 / 30.0;  // %/s while stopped: 90 -> 10 % in 30 s
constexpr double kHigh = 90.0, kLow = 10.0;
}  // namespace

MockTagProvider::MockTagProvider(TagStore& store, bool simLoad) : store_(store) {
    for (size_t i = 0; i < store_.size(); ++i) {
        const std::string& s = store_.def(i).signal;
        if (s.empty() || s == "sim.load") continue;
        Signal sig = Signal::Unknown;
        if (s == "tank.level")
            sig = Signal::TankLevel;
        else if (s == "motor.run")
            sig = Signal::MotorRun;
        else if (s == "motor.speed")
            sig = Signal::MotorSpeed;
        else if (s == "tank.inflow")
            sig = Signal::TankInflow;
        else if (s == "tank.temp")
            sig = Signal::TankTemp;
        bound_.push_back({i, sig});
    }
    if (simLoad) {
        char id[16];
        for (size_t k = 1; k <= kSimTagCount; ++k) {
            std::snprintf(id, sizeof id, "SIM.T%04zu", k);
            auto existing = store_.indexOf(id);
            sim_.push_back(existing ? *existing : store_.add({id, TagType::FLOAT32, "sim.load"}));
            simValue_.push_back(50.0);
        }
    }
}

void MockTagProvider::step(int64_t nowMs) {
    if (!started_) {
        started_ = true;
        t0_ = last_ = nowMs;
    }
    const int64_t dtMs = std::min<int64_t>(1000, std::max<int64_t>(0, nowMs - last_));
    const double dt = dtMs / 1000.0;
    last_ = nowMs;
    const double t = (nowMs - t0_) / 1000.0;

    // Hysteresis is decided on the level before integrating, so the level never overshoots
    // more than one step beyond the thresholds.
    if (running_ && level_ >= kHigh)
        running_ = false;
    else if (!running_ && level_ <= kLow)
        running_ = true;
    level_ += (running_ ? kFillRate : -kDrainRate) * dt;
    level_ = std::min(100.0, std::max(0.0, level_));

    const double speed = running_ ? 1450.0 + 8.0 * std::sin(2 * kPi * t / 7.0) : 0.0;
    const double inflow = running_ ? 12.0 + 1.5 * std::sin(2 * kPi * t / 11.0) : 0.0;
    const double temp = 25.0 + 2.0 * std::sin(2 * kPi * t / 60.0);
    const int64_t inWindow = (nowMs - t0_) % 20000;
    const bool tempBad = inWindow >= 15000;

    for (const auto& b : bound_) {
        switch (b.signal) {
            case Signal::TankLevel:
                store_.set(b.index, std::round(level_ * 100) / 100, Quality::GOOD, nowMs, nowMs);
                break;
            case Signal::MotorRun:
                store_.set(b.index, running_, Quality::GOOD, nowMs, nowMs);
                break;
            case Signal::MotorSpeed:
                store_.set(b.index, std::round(speed * 10) / 10, Quality::GOOD, nowMs, nowMs);
                break;
            case Signal::TankInflow:
                store_.set(b.index, std::round(inflow * 100) / 100, Quality::GOOD, nowMs, nowMs);
                break;
            case Signal::TankTemp:
                store_.set(b.index, std::round(temp * 10) / 10,
                           tempBad ? Quality::BAD : Quality::GOOD, nowMs, nowMs);
                break;
            case Signal::Unknown:
                store_.set(b.index, TagScalar{}, Quality::BAD, nowMs, nowMs);
                break;
        }
    }

    // Load tags: each changes once per second whatever the step period (FR-018(b), audit FR-018).
    // The budget grows by size x elapsed time, in tag-milliseconds so it stays exact; the random
    // walk never repeats the previous value.
    if (!sim_.empty() && nowMs != t0_) {
        simBudgetMs_ += static_cast<int64_t>(sim_.size()) * dtMs;
        const size_t n = std::min(sim_.size(), static_cast<size_t>(simBudgetMs_ / 1000));
        simBudgetMs_ -= static_cast<int64_t>(n) * 1000;
        for (size_t k = 0; k < n; ++k) {
            const size_t j = simCursor_;
            simCursor_ = (simCursor_ + 1) % sim_.size();
            rng_ = rng_ * 1664525u + 1013904223u;
            double delta = (static_cast<double>(rng_ >> 8) / 16777216.0 - 0.5) * 4.0;
            if (std::fabs(delta) < 0.01) delta = 0.5;
            double v = simValue_[j] + delta;
            if (v < 0 || v > 100) v = simValue_[j] - delta;
            simValue_[j] = std::round(v * 100) / 100;
            store_.set(sim_[j], simValue_[j], Quality::GOOD, nowMs, nowMs);
        }
    } else if (!sim_.empty()) {
        for (size_t j = 0; j < sim_.size(); ++j)
            store_.set(sim_[j], simValue_[j], Quality::GOOD, nowMs, nowMs);
    }
}

}  // namespace mat
