#include "server/write_subsystem.hpp"

#include <cstdio>

namespace mat {

namespace {
constexpr int64_t kMaintainEveryMs = 10 * 60 * 1000;
}

WriteSubsystem::WriteSubsystem(RuntimeEngine& runtime, TagStore& store, AuditLog& audit,
                               CoordinatorOptions options, PulseOptions pulse)
    : runtime_(runtime),
      audit_(audit),
      adapter_(audit),
      backend_(runtime),
      pulse_(std::move(pulse)) {
    // Feature 011 (FR-018): the journal of pulses, read before any command is taken.
    if (!pulse_.journalPath.empty()) {
        journal_ = std::make_unique<PulseJournal>(pulse_.journalPath);
        std::string error;
        armedAtStart_ = journal_->load(&error);
        if (!error.empty())
            std::fprintf(stderr, "pulse journal: cannot compact %s: %s\n",
                         pulse_.journalPath.c_str(), error.c_str());
        if (journal_->badLines() > 0)
            std::fprintf(stderr, "pulse journal: %zu unreadable line(s) skipped\n",
                         journal_->badLines());
        options.pulseLog = journal_.get();
    }
    if (pulse_.warnings != nullptr && !options.pulseStuck) {
        SystemWarnings* w = pulse_.warnings;
        const std::string mode = pulse_.recovery ? "on" : "off";
        options.pulseStuck = [w, mode](const std::vector<std::string>& tags) {
            if (tags.empty())
                w->clear("PULSE_STUCK");
            else
                w->set("PULSE_STUCK", {{"tags", tags}, {"pulseRecovery", mode}});
        };
    }
    coordinator_ = std::make_unique<WriteCoordinator>(*runtime.model(), store, backend_, adapter_,
                                                      std::move(options));
    // the results of the drivers and of the internal Tags come back through the engine's round
    if (runtime.engine()) {
        WriteCoordinator* c = coordinator_.get();
        runtime.engine()->setWriteResultHandler(
            [c](const drv::WriteResult& r) { c->onDriverResult(r); });
    }
}

WriteSubsystem::~WriteSubsystem() {
    if (runtime_.engine()) runtime_.engine()->setWriteResultHandler(nullptr);
}

bool WriteSubsystem::recover() {
    try {
        const size_t n = audit_.recoverTagWrites();
        if (n > 0)
            std::printf(
                "tag writes: %zu command(s) of the last run have no known result (interrupted)\n",
                n);
        recovered_ = true;
    } catch (const std::exception& e) {
        std::fprintf(stderr,
                     "tag writes: cannot recover the open commands: %s; every write is refused\n",
                     e.what());
        recovered_ = false;
    }
    return recovered_;
}

size_t WriteSubsystem::recoverPulses() {
    const size_t n = armedAtStart_.size();
    if (n == 0) return 0;
    std::printf("pulse journal: %zu pulse(s) of the last run were not released: %s\n", n,
                pulse_.recovery ? "the release values are written as the channels connect"
                                : "pulseRecovery is off, nothing is written (PULSE_STUCK)");
    coordinator_->recoverPulses(armedAtStart_, pulse_.recovery);
    armedAtStart_.clear();
    return n;
}

WriteCoordinator::QuiesceReport WriteSubsystem::beforeRestart() {
    const WriteCoordinator::QuiesceReport rep =
        coordinator_->quiesce();  // 1. no new command, the ones in flight end
    runtime_.stop();              // 2. retained values, 3. drivers
    return rep;
}

void WriteSubsystem::maintain(int64_t monoMs) {
    if (monoMs < nextMaintainMs_) return;
    nextMaintainMs_ = monoMs + kMaintainEveryMs;
    try {
        audit_.pruneTagWrites();
    } catch (const std::exception&) {
    }
}

}  // namespace mat
