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

drv::TagUpdate update(size_t tag, TagScalar v, Quality q, const char* reason, int64_t ts) {
    drv::TagUpdate u;
    u.tag = tag;
    u.value = std::move(v);
    u.quality = q;
    if (reason) u.reason = reason;
    u.sourceTs = ts;
    return u;
}
}  // namespace

LegacyMock::LegacyMock(std::vector<Bound> bound, std::vector<size_t> simTags)
    : sim_(std::move(simTags)) {
    for (const auto& b : bound) {
        Signal sig = Signal::Unknown;
        if (b.signal == "tank.level")
            sig = Signal::TankLevel;
        else if (b.signal == "motor.run")
            sig = Signal::MotorRun;
        else if (b.signal == "motor.speed")
            sig = Signal::MotorSpeed;
        else if (b.signal == "tank.inflow")
            sig = Signal::TankInflow;
        else if (b.signal == "tank.temp")
            sig = Signal::TankTemp;
        bound_.push_back({b.tag, sig});
    }
    simValue_.assign(sim_.size(), 50.0);
}

void LegacyMock::step(int64_t nowMs, std::vector<drv::TagUpdate>& out) {
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
                out.push_back(
                    update(b.tag, std::round(level_ * 100) / 100, Quality::GOOD, nullptr, nowMs));
                break;
            case Signal::MotorRun:
                out.push_back(update(b.tag, running_, Quality::GOOD, nullptr, nowMs));
                break;
            case Signal::MotorSpeed:
                out.push_back(
                    update(b.tag, std::round(speed * 10) / 10, Quality::GOOD, nullptr, nowMs));
                break;
            case Signal::TankInflow:
                out.push_back(
                    update(b.tag, std::round(inflow * 100) / 100, Quality::GOOD, nullptr, nowMs));
                break;
            case Signal::TankTemp:
                // BAD with the computed value, as runtime 0.4 did (the reason is new in 1.2.0).
                out.push_back(update(b.tag, std::round(temp * 10) / 10,
                                     tempBad ? Quality::BAD : Quality::GOOD,
                                     tempBad ? "DISCONNECTED" : nullptr, nowMs));
                break;
            case Signal::Unknown:
                out.push_back(update(b.tag, TagScalar{}, Quality::BAD, "NO_SIGNAL", nowMs));
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
            out.push_back(update(sim_[j], simValue_[j], Quality::GOOD, nullptr, nowMs));
        }
    } else if (!sim_.empty()) {
        for (size_t j = 0; j < sim_.size(); ++j)
            out.push_back(update(sim_[j], simValue_[j], Quality::GOOD, nullptr, nowMs));
    }
}

std::vector<LegacyMock::Bound> legacyBindingsOf(const TagStore& store) {
    std::vector<LegacyMock::Bound> out;
    for (size_t i = 0; i < store.size(); ++i) {
        const std::string& s = store.def(i).signal;
        if (s.empty() || s == "sim.load") continue;
        out.push_back({i, s});
    }
    return out;
}

void MockTagProvider::StoreSink::publish(std::vector<drv::TagUpdate>&& updates) {
    for (auto& u : updates)
        store_.set(u.tag, std::move(u.value), u.quality, std::move(u.reason), u.sourceTs,
                   u.sourceTs);
}

namespace {
// Adds SIM.T0001.. to the store (when simLoad) and returns their indexes.
std::vector<size_t> addSimTags(TagStore& store, bool simLoad) {
    std::vector<size_t> sim;
    if (!simLoad) return sim;
    char id[16];
    for (size_t k = 1; k <= LegacyMock::kSimTagCount; ++k) {
        std::snprintf(id, sizeof id, "SIM.T%04zu", k);
        auto existing = store.indexOf(id);
        sim.push_back(existing ? *existing : store.add({id, TagType::FLOAT32, "sim.load"}));
    }
    return sim;
}
}  // namespace

MockTagProvider::MockTagProvider(TagStore& store, bool simLoad)
    : sink_(store), mock_(legacyBindingsOf(store), addSimTags(store, simLoad)) {}

void MockTagProvider::step(int64_t nowMs) {
    std::vector<drv::TagUpdate> out;
    mock_.step(nowMs, out);
    sink_.publish(std::move(out));
}

}  // namespace mat
