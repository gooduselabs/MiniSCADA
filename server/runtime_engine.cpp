#include "server/runtime_engine.hpp"

#include <chrono>
#include <cstdio>
#include <map>

namespace mat {

namespace {
int64_t monoNowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}
}  // namespace

RuntimeEngine::RuntimeEngine(std::shared_ptr<const ProjectModel> model, TagStore& store,
                             const RuntimeEngineOptions& options)
    : model_(std::move(model)), store_(store), options_(options) {
    if (!model_) return;
    engine_ = std::make_unique<Engine>(store_, *model_);
    for (const auto& e : engine_->compileErrors())
        std::fprintf(stderr, "calculated tag not compiled: %s\n", e.c_str());
    sim_ = makeSimulationDriver(*model_);
    sim_->start(*engine_);
    engine_->addSteppedDriver(sim_.get());
}

RuntimeEngine::~RuntimeEngine() { stop(); }

void RuntimeEngine::firstRound(int64_t epochMs) {
    if (!engine_) return;
    const auto& retainedTags = engine_->retainedTags();
    if (!retainedTags.empty()) {
        retainIo_ = std::make_unique<PosixRetainIo>(options_.retainDir);
        retain_ = std::make_unique<RetainStore>(
            *retainIo_, static_cast<int64_t>(options_.retainWindowS) * 1000);
        const RetainStatus status = retain_->open();
        std::vector<std::pair<std::string, TagType>> want;
        for (size_t i : retainedTags) want.emplace_back(model_->tags[i].id, model_->tags[i].type);
        retain_->configure(want);  // Tags that are gone or retyped leave the files
        std::map<size_t, TagScalar> values;
        for (size_t i : retainedTags) {
            auto it = retain_->values().find(model_->tags[i].id);
            if (it != retain_->values().end()) values[i] = it->second.value;
        }
        engine_->applyRetained(values, status == RetainStatus::Lost);
        if (status == RetainStatus::Lost || status == RetainStatus::Fallback)
            std::fprintf(stderr, "retained tags: store %s (see the diagnostics)\n",
                         retainStatusName(status));
        // the engine reports the retained Tags that change; the saver thread writes them
        engine_->setRetainObserver([this](size_t tag, const TagScalar& v) {
            std::lock_guard<std::mutex> g(pendingMu_);
            pendingSets_.emplace_back(tag, v);
        });
        // a configure() that dropped an entry is compacted at once
        retain_->flushNow(monoNowMs());
    }
    engine_->step(epochMs);
}

void RuntimeEngine::start() {
    if (!retain_ || saver_.joinable()) return;
    saver_ = std::thread([this] { saverLoop(); });
}

void RuntimeEngine::saverLoop() {
    while (!saverStop_) {
        std::vector<std::pair<size_t, TagScalar>> sets;
        {
            std::unique_lock<std::mutex> l(pendingMu_);
            saverCv_.wait_for(l, std::chrono::milliseconds(250));
            if (saverStop_) break;
            sets.swap(pendingSets_);
        }
        std::lock_guard<std::mutex> g(
            retainMu_);  // held while the fdatasync runs: only the saver and stop() take it
        for (auto& [tag, v] : sets) retain_->set(model_->tags[tag].id, model_->tags[tag].type, v);
        retain_->flushIfDue(monoNowMs());
    }
}

void RuntimeEngine::tick(int64_t epochMs) {
    if (engine_) engine_->step(epochMs);
}

void RuntimeEngine::stop() {
    if (stopped_) return;
    stopped_ = true;
    if (sim_) sim_->stop();
    if (retain_) {
        saverStop_ = true;
        saverCv_.notify_all();
        if (saver_.joinable()) saver_.join();
        // what the tick loop handed over and the saver did not save yet
        std::vector<std::pair<size_t, TagScalar>> sets;
        {
            std::lock_guard<std::mutex> g(pendingMu_);
            sets.swap(pendingSets_);
        }
        std::lock_guard<std::mutex> g(retainMu_);
        for (auto& [tag, v] : sets) retain_->set(model_->tags[tag].id, model_->tags[tag].type, v);
        retain_->flushNow(monoNowMs());
    }
}

RetainDiag RuntimeEngine::retainDiag() const {
    if (!retain_) return {};
    std::lock_guard<std::mutex> g(retainMu_);
    return retain_->diag();
}

}  // namespace mat
