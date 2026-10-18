#include "server/runtime_engine.hpp"

#include <chrono>
#include <cstdio>
#include <map>

#include "core/common/thread_name.hpp"

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

    // The channel drivers (feature 006 T108): built here, their threads start at step 6.
    ModbusFactoryOptions fo;
    fo.writeQueueCapacity = options_.writeQueuePerChannel;
    fo.checkPort = options_.checkPort;
    for (auto& d : makeModbusTcpDrivers(*model_, fo)) {
        const drv::ModbusTcpConfig& cfg = d.driver->config();
        for (const drv::TagBinding& b : cfg.tags) routes_[b.tag] = {d.driver.get(), b.device};
        channelPtrs_.push_back(d.driver.get());
        channels_.push_back(std::move(d.driver));
    }
}

drv::ModbusTcpDriver* RuntimeEngine::driverOf(size_t tag) const {
    const auto it = routes_.find(tag);
    return it == routes_.end() ? nullptr : it->second.driver;
}

uint32_t RuntimeEngine::deviceOf(size_t tag) const {
    const auto it = routes_.find(tag);
    return it == routes_.end() ? 0 : it->second.device;
}

RuntimeEngine::~RuntimeEngine() { stop(); }

void RuntimeEngine::firstRound(int64_t epochMs) {
    if (!engine_) return;
    const auto& retainedTags = engine_->retainedTags();
    // Feature 011: the retained keys of logic share the store (logic/<id>/<field>).
    const std::vector<std::pair<std::string, TagType>> logicKeys =
        options_.logic && options_.logic->is_object()
            ? logicRetainKeys(*options_.logic)
            : std::vector<std::pair<std::string, TagType>>{};
    logic::RetainMap logicRetain;
    bool logicLost = false;
    if (!retainedTags.empty() || !logicKeys.empty()) {
        retainIo_ = std::make_unique<PosixRetainIo>(options_.retainDir);
        retain_ = std::make_unique<RetainStore>(
            *retainIo_, static_cast<int64_t>(options_.retainWindowS) * 1000);
        const RetainStatus status = retain_->open();
        std::vector<std::pair<std::string, TagType>> want;
        for (size_t i : retainedTags) want.emplace_back(model_->tags[i].id, model_->tags[i].type);
        for (const auto& k : logicKeys) want.push_back(k);
        retain_->configure(
            want);  // Tags (and logic blocks) that are gone or retyped leave the files
        logicRetain = logicRetainFromStore(retain_->values());
        logicLost = status == RetainStatus::Lost;
        std::map<size_t, TagScalar> values;
        for (size_t i : retainedTags) {
            auto it = retain_->values().find(model_->tags[i].id);
            if (it != retain_->values().end()) values[i] = it->second.value;
        }
        engine_->applyRetained(values, status == RetainStatus::Lost);
        // the store could not be created (ENOSPC, read-only disk): nothing will be kept over a
        // power cut
        if (const std::string err = retain_->diag().lastError; !err.empty())
            std::fprintf(stderr, "retained tags: the store is not writable (%s)\n", err.c_str());
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
    if (options_.logic && options_.logic->is_object()) {
        try {
            logic_ = std::make_unique<LogicSubsystem>(
                *model_, *options_.logic, options_.logicOptions, logicRetain, logicLost);
            engine_->setRoundHook([this](EngineRound& r) { logic_->round(r); });
        } catch (const std::exception& e) {
            std::fprintf(stderr, "logic not started: %s\n", e.what());
            logic_.reset();
        }
    }
    options_.logic = nullptr;  // not read again: the caller may free the document (T147)
    engine_->step(epochMs);
}

void RuntimeEngine::pushLogicRetain(bool force) {
    if (!logic_ || !retain_) return;
    for (auto& [key, v] : logic_->retainDue(force)) retain_->set(key, v.type, v.value);
}

void RuntimeEngine::start() {
    if (!engine_ || started_) return;
    started_ = true;
    for (auto& d : channels_) d->start(*engine_);  // step 6: the channel threads
    if (retain_ && !saver_.joinable())
        saver_ = std::thread([this] {
            setThreadName("mat-retain");
            saverLoop();
        });
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
        pushLogicRetain(false);  // every logic.flushS, what changed
        retain_->flushIfDue(monoNowMs());
        const uint64_t saves = retain_->diag().saves;
        if (saves != savesSeen_) {
            savesSeen_ = saves;
            lastRetainSaveAt_ = std::chrono::duration_cast<std::chrono::milliseconds>(
                                    std::chrono::system_clock::now().time_since_epoch())
                                    .count();
        }
    }
}

void RuntimeEngine::tick(int64_t epochMs, bool deltaRound) {
    if (engine_) engine_->step(epochMs, deltaRound);
}

void RuntimeEngine::stop() {
    if (stopped_) return;
    stopped_ = true;
    // device-config §7, before the execv: the retained Tags first, then the drivers
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
        pushLogicRetain(true);  // the stop (SIGTERM, execv): the state of logic as it is
        retain_->flushNow(monoNowMs());
    }
    if (logic_) logic_->stop();           // the dispatcher: nothing more goes to the coordinator
    for (auto& d : channels_) d->stop();  // closes the connections, joins the threads
    if (sim_) sim_->stop();
}

RetainDiag RuntimeEngine::retainDiag() const {
    if (!retain_) return {};
    std::lock_guard<std::mutex> g(retainMu_);
    return retain_->diag();
}

}  // namespace mat
