#include "core/logic/harness.hpp"

namespace mat::logic {

namespace {

expr::InputValue noValue() {
    expr::InputValue v;
    v.quality = Quality::BAD;
    v.reason = "NO_VALUE";
    return v;
}

}  // namespace

Harness::Harness(nlohmann::json doc, EngineOptions options)
    : doc_(std::move(doc)), options_(std::move(options)) {
    if (options_.retain) {
        retainHeld_ = *options_.retain;
        options_.retain = &retainHeld_;
    }
    engine_ = std::make_unique<Engine>(doc_, options_);
}

void Harness::setGood(const std::string& id, TagScalar v) {
    expr::InputValue iv;
    iv.value = std::move(v);
    iv.quality = Quality::GOOD;
    store_[id] = std::move(iv);
}

void Harness::setNoValue(const std::string& id) { store_[id] = noValue(); }

void Harness::setWall(std::optional<int64_t> epochMs, bool synced, int64_t at) {
    wallBase_ = epochMs;
    wallAt_ = at;
    synced_ = synced;
}

expr::InputValue Harness::read(const std::string& id) const {
    const auto it = store_.find(id);
    return it == store_.end() ? noValue() : it->second;
}

std::vector<ActionOut> Harness::scan(int64_t t) {
    WallClock wall;
    if (wallBase_) wall.epochMs = *wallBase_ + (t - wallAt_);
    wall.synced = synced_;
    std::vector<ActionOut> actions = engine_->step(
        t, [this](const std::string& id) { return read(id); }, wall);
    for (const ActionOut& a : actions)
        if ((a.doName == "setTag" || a.doName == "toggle") && a.result == "OK" && a.hasValue)
            setGood(a.tag, a.value);
    lastScan_ = t;
    return actions;
}

std::vector<ActionOut> Harness::runTo(int64_t t) {
    std::vector<ActionOut> out;
    for (int64_t s = nextScan(); s <= t; s += scanMs()) {
        auto got = scan(s);
        out.insert(out.end(), got.begin(), got.end());
    }
    return out;
}

std::vector<ActionOut> Harness::runBefore(int64_t t) {
    std::vector<ActionOut> out;
    for (int64_t s = nextScan(); s < t; s += scanMs()) {
        auto got = scan(s);
        out.insert(out.end(), got.begin(), got.end());
    }
    return out;
}

void Harness::restart(const nlohmann::json* doc, RetainFrom from, const RetainMap* given,
                      std::optional<int64_t> at) {
    if (doc) doc_ = *doc;
    if (at) lastScan_ = *at - scanMs();
    store_.clear();
    EngineOptions o = options_;
    o.retainLost = from == RetainFrom::Lost;
    if (from == RetainFrom::Flushed)
        retainHeld_ = flushed_ ? *flushed_ : RetainMap{};
    else if (from == RetainFrom::Given && given)
        retainHeld_ = *given;
    else
        retainHeld_.clear();
    o.retain = &retainHeld_;
    options_ = o;
    engine_ = std::make_unique<Engine>(doc_, options_);
}

const expr::InputValue* Harness::stored(const std::string& tag) const {
    const auto it = store_.find(tag);
    return it == store_.end() ? nullptr : &it->second;
}

}  // namespace mat::logic
