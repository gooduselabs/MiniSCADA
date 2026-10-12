#include "drivers/simulation/simulation_driver.hpp"

namespace mat {

namespace {
sim::SimScalar fromRaw(const TagScalar& v) {
    if (const bool* b = std::get_if<bool>(&v)) return *b;
    if (const double* d = std::get_if<double>(&v)) return *d;
    if (const int64_t* i = std::get_if<int64_t>(&v)) return static_cast<double>(*i);
    if (const uint64_t* u = std::get_if<uint64_t>(&v)) return static_cast<double>(*u);
    if (const std::string* s = std::get_if<std::string>(&v)) return *s;
    return sim::SimScalar{};
}
}  // namespace

SimulationDriver::SimulationDriver(std::vector<Item> items, std::vector<LegacyMock::Bound> legacy,
                                   std::vector<size_t> simLoadTags)
    : items_(std::move(items)),
      legacy_(legacy, simLoadTags),
      hasLegacy_(!legacy.empty() || !simLoadTags.empty()) {
    for (size_t i = 0; i < items_.size(); ++i)
        if (items_[i].config.kind == sim::SimKind::Manual) manualIndex_[items_[i].tag] = i;
}

void SimulationDriver::start(drv::EngineSink& sink) {
    std::lock_guard<std::mutex> g(mu_);
    sink_ = &sink;
}

void SimulationDriver::stop() {
    std::lock_guard<std::mutex> g(mu_);
    sink_ = nullptr;
    pending_.clear();
}

bool SimulationDriver::enqueueWrite(drv::WriteCommand cmd) {
    std::lock_guard<std::mutex> g(mu_);
    if (!sink_ || !manualIndex_.count(cmd.tag)) return false;
    pending_.push_back(std::move(cmd));
    return true;
}

void SimulationDriver::step(int64_t nowMs) {
    drv::EngineSink* sink;
    std::vector<drv::WriteCommand> writes;
    {
        std::lock_guard<std::mutex> g(mu_);
        sink = sink_;
        writes.swap(pending_);
        for (const auto& w : writes) lastWrite_[w.tag] = fromRaw(w.raw);
    }
    if (!sink) return;
    std::vector<drv::TagUpdate> out;
    out.reserve(items_.size());
    for (const Item& it : items_) {
        const sim::SimScalar* last = nullptr;
        sim::SimScalar lastCopy;
        if (it.config.kind == sim::SimKind::Manual) {
            std::lock_guard<std::mutex> g(mu_);
            auto f = lastWrite_.find(it.tag);
            if (f != lastWrite_.end()) {
                lastCopy = f->second;
                last = &lastCopy;
            }
        }
        drv::TagUpdate u;
        u.tag = it.tag;
        u.value = sim::simValue(it.config, nowMs, it.type, last);
        u.quality = Quality::GOOD;
        u.sourceTs = nowMs;
        out.push_back(std::move(u));
    }
    if (hasLegacy_) legacy_.step(nowMs, out);
    if (!out.empty()) sink->publish(std::move(out));
    for (const auto& w : writes) {
        drv::WriteResult r;
        r.id = w.id;
        r.status = drv::WriteStatus::Confirmed;
        r.code = "APPLIED";
        sink->writeDone(std::move(r));
    }
}

drv::LinkState SimulationDriver::linkState(uint32_t) const {
    return {drv::ChannelState::Connected, drv::DeviceState::Active};
}

void SimulationDriver::diagnostics(drv::DriverDiag& out, int64_t) const {
    out = drv::DriverDiag{};
    out.channel.id = "simulation";
    out.channel.state = "connected";
}

drv::TestOutcome SimulationDriver::test(const drv::TestRequest&) {
    drv::TestOutcome o;
    o.code = "OK";
    return o;
}

}  // namespace mat
