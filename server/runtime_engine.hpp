// The Tag Engine of the runtime (feature 006 T060; contracts/device-config.md §7): the project's
// model, the engine, the simulation driver (and later the channel drivers), and the store of the
// retained Tags, apart from main.cpp and CivetWeb so that it can be tested.
//
// Startup, step 4: the engine is built, the retained store is opened and its values applied, the
// first engine round runs. Step 6: the driver threads start (none yet: the simulation driver has
// no thread). On the tick loop, `tick()` runs right before hub.tick(). Before the execv that
// switches the project and at shutdown, `stop()` writes what the retained store still holds and
// stops the drivers.
#pragma once
#include <atomic>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

#include "core/tag-engine/engine.hpp"
#include "core/tag-engine/retain_store.hpp"
#include "core/tag-engine/sim_factory.hpp"
#include "core/tag-engine/tag_model.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "drivers/simulation/simulation_driver.hpp"

namespace mat {

struct RuntimeEngineOptions {
    std::string retainDir;  // <dataDir>/retain
    int retainWindowS = 5;
};

class RuntimeEngine {
   public:
    // `model`: null when no project is active (the engine then has nothing to run). The store
    // already holds the Tags of the model (activateProject).
    RuntimeEngine(std::shared_ptr<const ProjectModel> model, TagStore& store,
                  const RuntimeEngineOptions& options);
    ~RuntimeEngine();

    // Step 4: opens the retained store, applies its values, runs the first round.
    void firstRound(int64_t epochMs);
    // Step 6: starts the threads of the drivers and of the retained store.
    void start();
    // One round of the tick loop, before hub.tick().
    void tick(int64_t epochMs);
    // Before execv and at shutdown: writes the retained values that wait, stops the drivers.
    void stop();

    bool active() const { return engine_ != nullptr; }
    Engine* engine() { return engine_.get(); }
    // null when the project has no retained Tag
    RetainStore* retainStore() { return retain_.get(); }
    RetainDiag retainDiag() const;
    const ProjectModel* model() const { return model_.get(); }

   private:
    void saverLoop();

    std::shared_ptr<const ProjectModel> model_;
    TagStore& store_;
    RuntimeEngineOptions options_;
    std::unique_ptr<Engine> engine_;
    std::unique_ptr<SimulationDriver> sim_;

    std::unique_ptr<PosixRetainIo> retainIo_;
    std::unique_ptr<RetainStore> retain_;
    mutable std::mutex retainMu_;  // guards retain_ (the saver holds it while it writes)
    std::mutex pendingMu_;         // guards pendingSets_: the tick loop never waits for a write
    std::vector<std::pair<size_t, TagScalar>> pendingSets_;
    std::thread saver_;
    std::condition_variable saverCv_;
    std::atomic<bool> saverStop_{false};
    bool stopped_ = false;
};

}  // namespace mat
