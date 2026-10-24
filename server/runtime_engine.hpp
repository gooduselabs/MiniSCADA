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
#include <functional>
#include <memory>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <vector>

#include "core/tag-engine/bacnet_factory.hpp"
#include "core/tag-engine/engine.hpp"
#include "core/tag-engine/fins_factory.hpp"
#include "core/tag-engine/mc_factory.hpp"
#include "core/tag-engine/modbus_factory.hpp"
#include "core/tag-engine/opcua_factory.hpp"
#include "core/tag-engine/retain_store.hpp"
#include "core/tag-engine/s7_factory.hpp"
#include "core/tag-engine/sim_factory.hpp"
#include "core/tag-engine/tag_model.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "drivers/simulation/simulation_driver.hpp"
#include "server/logic_glue.hpp"

namespace mat {

struct RuntimeEngineOptions {
    std::string retainDir;  // <dataDir>/retain
    int retainWindowS = 5;
    int writeQueuePerChannel = 16;  // tagWriteQueuePerChannel
    // RTU channels: "" when a channel may open the port, else PORT_CONSOLE or PORT_NOT_ALLOWED
    // (serialPorts of the configuration and the console of the system). Empty: no check.
    std::function<std::string(const std::string& port)> checkPort;
    // Feature 011 (logic v2, T136, T139): logic.json of the project (null: none) and the logic.*
    // keys of runtime.json. Its retained values share the store of the retained Tags (keys
    // logic/<id>/<field>); its round runs inside the engine's, after the calculated Tags. Read
    // only by firstRound(): the caller may free the document after it (T147).
    const nlohmann::json* logic = nullptr;
    LogicOptions logicOptions;
    // Feature 019: what the OPC UA drivers need from the device (client certificate directory,
    // passwords of the secrets file).
    drv::OpcUaEnv opcua;
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
    // Step 6: starts the threads of the channel drivers (one per channel, none for a disabled one)
    // and of the retained store.
    void start();
    // One round of the tick loop, before hub.tick(). `deltaRound` false: a round for the logic scan
    // only (feature 011 T148, server/tick_schedule.hpp): the simulation driver is not stepped.
    void tick(int64_t epochMs, bool deltaRound = true);
    // Before execv and at shutdown, in the order of device-config §7: the retained values that wait
    // are written, then the drivers stop (connections closed, threads joined).
    void stop();

    bool active() const { return engine_ != nullptr; }
    Engine* engine() { return engine_.get(); }
    // null when the project has no retained Tag
    RetainStore* retainStore() { return retain_.get(); }
    RetainDiag retainDiag() const;
    // UTC ms of the last save of the retained store; 0 before the first.
    int64_t retainLastSaveAt() const { return lastRetainSaveAt_.load(); }
    const ProjectModel* model() const { return model_.get(); }
    // The logic of the project (null: no logic.json, or it could not start).
    LogicSubsystem* logic() { return logic_.get(); }

    // The Modbus TCP channel drivers, in the order of the model (a disabled channel has one too: it
    // publishes DISABLED and never connects). Valid until the engine is destroyed.
    const std::vector<drv::ModbusTcpDriver*>& channelDrivers() const { return channelPtrs_; }
    // Every channel's driver, by the channel's index in the model (Modbus, S7, FINS, ...); null for
    // a channel without one. Valid until the engine is destroyed.
    const std::vector<drv::Driver*>& driversByChannel() const { return byChannel_; }
    // The driver of the channel of an external Tag and the number of its field device inside that
    // driver; null for any other Tag.
    drv::Driver* driverOf(size_t tag) const;
    uint32_t deviceOf(size_t tag) const;
    // The driver of the simulation Tags (manual writes).
    drv::Driver* simulationDriver() { return sim_.get(); }

   private:
    void saverLoop();

    std::shared_ptr<const ProjectModel> model_;
    TagStore& store_;
    RuntimeEngineOptions options_;
    std::unique_ptr<Engine> engine_;
    std::unique_ptr<SimulationDriver> sim_;
    std::vector<std::unique_ptr<drv::Driver>> channels_;
    std::vector<drv::ModbusTcpDriver*> channelPtrs_;
    std::vector<drv::Driver*> byChannel_;
    struct Route {
        drv::Driver* driver = nullptr;
        uint32_t device = 0;
    };
    std::unordered_map<size_t, Route> routes_;  // Tag index -> its channel driver

    std::unique_ptr<LogicSubsystem> logic_;
    void pushLogicRetain(bool force);  // retainMu_ held
    std::unique_ptr<PosixRetainIo> retainIo_;
    std::unique_ptr<RetainStore> retain_;
    mutable std::mutex retainMu_;  // guards retain_ (the saver holds it while it writes)
    std::mutex pendingMu_;         // guards pendingSets_: the tick loop never waits for a write
    std::vector<std::pair<size_t, TagScalar>> pendingSets_;
    std::thread saver_;
    std::condition_variable saverCv_;
    std::atomic<bool> saverStop_{false};
    std::atomic<int64_t> lastRetainSaveAt_{0};
    uint64_t savesSeen_ = 0;  // saver thread only
    bool stopped_ = false;
    bool started_ = false;
};

}  // namespace mat
