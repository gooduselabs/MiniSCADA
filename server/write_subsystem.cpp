#include "server/write_subsystem.hpp"

#include <cstdio>

namespace mat {

namespace {
constexpr int64_t kMaintainEveryMs = 10 * 60 * 1000;
}

WriteSubsystem::WriteSubsystem(RuntimeEngine& runtime, TagStore& store, AuditLog& audit,
                               CoordinatorOptions options)
    : runtime_(runtime), audit_(audit), adapter_(audit), backend_(runtime) {
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
