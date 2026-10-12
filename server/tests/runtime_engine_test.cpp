// The runtime's Tag Engine without CivetWeb (T059; contracts/device-config.md §7): the startup
// order, the round before hub.tick(), a project 0.1 as `legacy` simulation Tags, an invalid project
// not activated, the retained Tags applied before the first round and written before execv.
#include "server/runtime_engine.hpp"

#include <gtest/gtest.h>
#include <sys/stat.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <thread>

#include "server/startup.hpp"

using nlohmann::json;
using namespace mat;
namespace fs = std::filesystem;

namespace {

const std::string kSchemas = std::string(MAT_SOURCE_DIR) + "/schemas";
const std::string kVectors = std::string(MAT_SOURCE_DIR) + "/tests/project-vectors";
constexpr int64_t kT0 = 1791594000000;

// A temporary directory removed at the end.
struct TempDir {
    fs::path path;
    explicit TempDir(const std::string& name)
        : path(fs::temp_directory_path() / ("mat-rt-" + name)) {
        fs::remove_all(path);
        fs::create_directories(path);
    }
    ~TempDir() { fs::remove_all(path); }
};

void writeFile(const fs::path& p, const std::string& text) {
    std::ofstream(p, std::ios::binary | std::ios::trunc) << text;
}

// The 0.2 vector `v02-valid-no-connections` with the tags of the test.
fs::path projectWithTags(const TempDir& dir, const json& tags) {
    const fs::path p = dir.path / "project";
    fs::copy(kVectors + "/v02-valid-no-connections", p, fs::copy_options::recursive);
    writeFile(p / "tags.json", json{{"schemaVersion", "0.2.0"}, {"tags", tags}}.dump(2));
    return p;
}

struct Rig {
    ProjectValidation validation;
    TagStore store;
    ActiveProject active;
    std::unique_ptr<RuntimeEngine> rt;

    Rig(const std::string& dir, bool simLoad, const RuntimeEngineOptions& opt = {}) {
        validation = validateProject(dir, kSchemas);
        active = activateProject(validation, 10, store, std::nullopt, simLoad);
        rt = std::make_unique<RuntimeEngine>(active.model, store, opt);
    }
    TagValue get(const std::string& id) const { return store.get(*store.indexOf(id)); }
};

}  // namespace

TEST(RuntimeEngine, Project01RunsItsTagsAsLegacySimulationTagsWithTheSimLoad) {
    Rig r(std::string(MAT_SOURCE_DIR) + "/projects/tank-demo", true);
    ASSERT_TRUE(r.active.active);
    ASSERT_TRUE(r.rt->active());
    EXPECT_EQ(r.store.size(), 5u + LegacyMock::kSimTagCount);
    EXPECT_EQ(r.store.def(0).id, "TANK01.LEVEL");  // the order of tags.json first, SIM.* after
    EXPECT_EQ(r.store.def(5).id, "SIM.T0001");
    EXPECT_EQ(r.store.def(0).signal, "tank.level");
    r.rt->firstRound(kT0);
    for (int i = 1; i <= 20; ++i) r.rt->tick(kT0 + i * 250);
    EXPECT_EQ(r.get("TANK01.LEVEL").quality, Quality::GOOD);
    EXPECT_TRUE(std::holds_alternative<double>(r.get("TANK01.LEVEL").value));
    EXPECT_EQ(r.get("SIM.T0001").quality, Quality::GOOD);
    r.rt->stop();
}

TEST(RuntimeEngine, TheFirstRoundGivesTagsTheirFirstState) {
    Rig r(kVectors + "/v02-valid-no-connections", false);
    ASSERT_TRUE(r.active.active);
    r.store.takeDirty();
    EXPECT_EQ(r.get("A.SET").revision, 0u);  // nothing before the first round
    r.rt->firstRound(kT0);
    EXPECT_EQ(std::get<double>(r.get("A.SET").value), 5.0);
    EXPECT_EQ(std::get<double>(r.get("A.DOUBLE").value),
              10.0);  // the calculated Tag, in the same round
    EXPECT_EQ(r.get("A.WAVE").quality, Quality::GOOD);
    EXPECT_EQ(r.store.takeDirty().size(), 3u);  // all of them changed in that one round
    r.rt->stop();
}

TEST(RuntimeEngine, TheRoundRunsBeforeTheLiveTickSoDeltasCarryTheNewValues) {
    Rig r(kVectors + "/v02-valid-no-connections", false);
    r.rt->firstRound(kT0);
    r.store.takeDirty();
    // a command sets the internal Tag; the calculated Tag follows in the same round
    const size_t set = *r.store.indexOf("A.SET");
    r.rt->engine()->setInternal(set, 7.0);
    r.rt->tick(kT0 + 250);
    const auto dirty = r.store.takeDirty();  // what hub.tick() would take
    EXPECT_NE(std::find(dirty.begin(), dirty.end(), set), dirty.end());
    EXPECT_NE(std::find(dirty.begin(), dirty.end(), *r.store.indexOf("A.DOUBLE")), dirty.end());
    EXPECT_EQ(std::get<double>(r.get("A.DOUBLE").value), 14.0);
    r.rt->stop();
}

TEST(RuntimeEngine, AnInvalidProjectIsNotActivatedAndNoEngineRuns) {
    Rig r(kVectors + "/invalid-ref-tag", false);
    EXPECT_FALSE(r.active.active);
    EXPECT_EQ(r.active.model, nullptr);
    EXPECT_FALSE(r.rt->active());
    EXPECT_EQ(r.store.size(), 0u);
    r.rt->firstRound(kT0);  // does nothing
    r.rt->tick(kT0 + 250);
    r.rt->stop();
}

TEST(RuntimeEngine, TheSimLoadIsServedEvenWithoutAnActiveProject) {
    Rig r("/nonexistent/project", true);
    EXPECT_FALSE(r.active.active);
    EXPECT_EQ(r.store.size(), LegacyMock::kSimTagCount);
    ASSERT_TRUE(r.rt->active());
    r.rt->firstRound(kT0);
    EXPECT_EQ(r.get("SIM.T0500").quality, Quality::GOOD);
    r.rt->stop();
}

TEST(RuntimeEngine, StopMakesTheDriversQuietAndIsRepeatable) {
    Rig r(kVectors + "/v02-valid-no-connections", false);
    r.rt->firstRound(kT0);
    r.rt->stop();
    r.rt->stop();
    const auto before = r.get("A.WAVE").revision;
    r.rt->tick(kT0 + 5000);  // the simulation driver no longer publishes
    EXPECT_EQ(r.get("A.WAVE").revision, before);
}

// ---- retained Tags ----

namespace {
const char* kRetainTags = R"([
  {"id":"A.SET","kind":"internal","type":"FLOAT32","initial":5,"retain":true,"access":"RW"},
  {"id":"A.PLAIN","kind":"internal","type":"FLOAT32","initial":1,"access":"RW"},
  {"id":"A.DOUBLE","kind":"calculated","type":"FLOAT32","expression":"A.SET * 2"},
  {"id":"A.WAVE","kind":"simulation","type":"FLOAT32","sim":{"kind":"ramp","from":0,"to":100,"periodMs":10000}}
])";
}

TEST(RuntimeEngineRetain, ASavedValueIsAppliedBeforeTheFirstRoundAndWrittenBeforeExecv) {
    TempDir dir("retain");
    const fs::path project = projectWithTags(dir, json::parse(kRetainTags));
    RuntimeEngineOptions opt;
    opt.retainDir = (dir.path / "retain").string();
    opt.retainWindowS = 1;
    {
        Rig r(project.string(), false, opt);
        ASSERT_TRUE(r.active.active) << resultJson(r.validation);
        r.rt->firstRound(kT0);
        EXPECT_EQ(std::get<double>(r.get("A.SET").value), 5.0);  // initial: nothing saved yet
        ASSERT_NE(r.rt->retainStore(), nullptr);
        EXPECT_EQ(r.rt->retainDiag().status, RetainStatus::Fresh);
        r.rt->start();
        r.rt->engine()->setInternal(*r.store.indexOf("A.SET"), 42.0);
        r.rt->engine()->setInternal(*r.store.indexOf("A.PLAIN"), 9.0);
        r.rt->tick(kT0 + 250);
        EXPECT_EQ(std::get<double>(r.get("A.DOUBLE").value), 84.0);
        r.rt->stop();  // before execv: writes what waits
        EXPECT_GE(r.rt->retainDiag().saves, 1u);
    }
    // a new process: the stored value is there from the very first round (not the initial value)
    {
        Rig r(project.string(), false, opt);
        r.rt->firstRound(kT0);
        EXPECT_EQ(std::get<double>(r.get("A.SET").value), 42.0);
        EXPECT_EQ(std::get<double>(r.get("A.DOUBLE").value), 84.0);
        EXPECT_EQ(std::get<double>(r.get("A.PLAIN").value), 1.0);  // not retained: back to initial
        EXPECT_EQ(r.rt->retainDiag().status, RetainStatus::Ok);
        r.rt->stop();
    }
    // permissions: the directory 0700, the files 0600
    struct stat st {};
    ASSERT_EQ(::stat((dir.path / "retain").c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 07777, 0700u);
    ASSERT_EQ(::stat((dir.path / "retain/retain-a.bin").c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 07777, 0600u);
}

TEST(RuntimeEngineRetain, TheSaverThreadWritesWithinTheWindowWithoutStop) {
    TempDir dir("retain-thread");
    const fs::path project = projectWithTags(dir, json::parse(kRetainTags));
    RuntimeEngineOptions opt;
    opt.retainDir = (dir.path / "retain").string();
    opt.retainWindowS = 1;
    Rig r(project.string(), false, opt);
    r.rt->firstRound(kT0);
    r.rt->start();
    r.rt->engine()->setInternal(*r.store.indexOf("A.SET"), 11.0);
    r.rt->tick(kT0 + 250);
    bool saved = false;
    for (int i = 0; i < 40 && !saved;
         ++i) {  // at most 4 s: the window is 1 s, the thread looks every 250 ms
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        saved = r.rt->retainDiag().saves >= 1;
    }
    EXPECT_TRUE(saved);
    r.rt->stop();
}

TEST(RuntimeEngineRetain, ACorruptStoreStartsFromInitialAsUncertain) {
    TempDir dir("retain-lost");
    const fs::path project = projectWithTags(dir, json::parse(kRetainTags));
    RuntimeEngineOptions opt;
    opt.retainDir = (dir.path / "retain").string();
    {
        Rig r(project.string(), false, opt);
        r.rt->firstRound(kT0);
        r.rt->stop();
    }
    for (const char* n : {"retain-a.bin", "retain-b.bin"}) {
        std::fstream f(dir.path / "retain" / n, std::ios::in | std::ios::out | std::ios::binary);
        f.seekp(0);
        f.write("XXXXXXXX", 8);  // the magic
    }
    Rig r(project.string(), false, opt);
    r.rt->firstRound(kT0);
    EXPECT_EQ(std::get<double>(r.get("A.SET").value), 5.0);
    EXPECT_EQ(r.get("A.SET").quality, Quality::UNCERTAIN);
    EXPECT_EQ(r.get("A.SET").reason, "RETAIN_LOST");
    EXPECT_EQ(r.rt->retainDiag().status, RetainStatus::Lost);
    r.rt->stop();
}

TEST(RuntimeEngineRetain, NoRetainedTagNoFilesAreMade) {
    TempDir dir("retain-none");
    RuntimeEngineOptions opt;
    opt.retainDir = (dir.path / "retain").string();
    Rig r(kVectors + "/v02-valid-no-connections", false, opt);
    r.rt->firstRound(kT0);
    r.rt->stop();
    EXPECT_FALSE(fs::exists(dir.path / "retain"));
    EXPECT_EQ(r.rt->retainStore(), nullptr);
}

// ---- Modbus TCP channels (T107; device-config §7 step 6) ----

#include "drivers/modbus/tests/fake_plc.hpp"

namespace {

// Two channels (the second disabled) to loopback ports, three external Tags, and the simulation
// Tag the screen of the vector binds.
fs::path modbusProject(const TempDir& dir, int port1, int port2) {
    const fs::path p = dir.path / "project";
    fs::copy(kVectors + "/v02-valid-no-connections", p, fs::copy_options::recursive);
    std::ifstream in(p / "project.json");
    json project = json::parse(in);
    project["connectionFile"] = "connections.json";
    writeFile(p / "project.json", project.dump(2));
    writeFile(
        p / "connections.json",
        json{{"schemaVersion", "0.2.0"},
             {"scanGroups", {{"fast", 100}, {"normal", 100}, {"slow", 5000}}},
             {"channels",
              {{{"id", "plc1"},
                {"name", "PLC một"},
                {"kind", "modbus-tcp"},
                {"tcp", {{"host", "127.0.0.1"}, {"port", port1}}},
                {"devices", {{{"id", "d1"}, {"name", "D1"}, {"unitId", 1}, {"timeoutMs", 300}}}}},
               {{"id", "plc2"},
                {"name", "PLC hai"},
                {"kind", "modbus-tcp"},
                {"enabled", false},
                {"tcp", {{"host", "127.0.0.1"}, {"port", port2}}},
                {"devices", {{{"id", "d2"}, {"name", "D2"}, {"unitId", 1}}}}}}}}
            .dump(2));
    writeFile(p / "tags.json",
              json{{"schemaVersion", "0.2.0"},
                   {"tags",
                    {{{"id", "A.WAVE"},
                      {"kind", "simulation"},
                      {"type", "FLOAT32"},
                      {"sim", {{"kind", "ramp"}, {"from", 0}, {"to", 100}, {"periodMs", 10000}}}},
                     {{"id", "P1.A"},
                      {"kind", "external"},
                      {"type", "INT16"},
                      {"source", {{"device", "d1"}, {"address", "HR0"}}}},
                     {{"id", "P1.B"},
                      {"kind", "external"},
                      {"type", "BOOL"},
                      {"source", {{"device", "d1"}, {"address", "C3"}}}},
                     {{"id", "P2.A"},
                      {"kind", "external"},
                      {"type", "INT16"},
                      {"source", {{"device", "d2"}, {"address", "HR0"}}}}}}}
                  .dump(2));
    return p;
}

bool waitFor(const std::function<bool()>& cond, int ms = 3000) {
    for (int i = 0; i < ms / 20 && !cond(); ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    return cond();
}

}  // namespace

TEST(RuntimeEngineChannels, TheDriversOfTheChannelsStartAtStepSixAndOnlyTheEnabledOnesConnect) {
    mat::testing::FakePlc plc1, plc2;
    plc1.set(1, modbus::Area::HR, 0, 321);
    plc1.set(1, modbus::Area::C, 3, 1);
    plc2.set(1, modbus::Area::HR, 0, 99);
    mat::testing::LoopbackServer s1(plc1), s2(plc2);
    TempDir dir("channels");
    Rig r(modbusProject(dir, s1.port, s2.port).string(), false);
    ASSERT_TRUE(r.active.active) << resultJson(r.validation);
    r.rt->firstRound(kT0);
    // step 4 is over: the engine has its first round, no channel thread runs yet
    for (int i = 1; i <= 3; ++i) r.rt->tick(kT0 + i * 100);
    std::this_thread::sleep_for(std::chrono::milliseconds(150));
    EXPECT_EQ(plc1.connections, 0) << "the channel threads start at step 6";
    EXPECT_EQ(r.get("P1.A").quality, Quality::BAD);
    EXPECT_EQ(r.get("P1.A").reason, "NO_VALUE");

    r.rt->start();  // step 6
    int64_t now = kT0 + 1000;
    ASSERT_TRUE(waitFor([&] {
        r.rt->tick(now += 100);
        return r.get("P1.A").quality == Quality::GOOD && r.get("P1.B").quality == Quality::GOOD;
    }));
    EXPECT_EQ(std::get<int64_t>(r.get("P1.A").value), 321);
    EXPECT_EQ(std::get<bool>(r.get("P1.B").value), true);
    EXPECT_EQ(plc1.connections, 1);
    EXPECT_EQ(plc2.connections, 0) << "a disabled channel has no connection";
    EXPECT_EQ(r.get("P2.A").quality, Quality::BAD);
    EXPECT_EQ(r.get("P2.A").reason, "DISABLED");
    ASSERT_EQ(r.rt->channelDrivers().size(), 2u);
    EXPECT_EQ(r.rt->channelDrivers()[0]->linkState(0).channel, drv::ChannelState::Connected);
    EXPECT_EQ(r.rt->channelDrivers()[1]->linkState(0).channel, drv::ChannelState::Disabled);
    r.rt->stop();
}

TEST(RuntimeEngineChannels, TheValuesFollowThePlcAndStopEndsTheThreadsBeforeAnythingElse) {
    mat::testing::FakePlc plc;
    plc.set(1, modbus::Area::HR, 0, 1);
    plc.set(1, modbus::Area::C, 3, 0);
    mat::testing::LoopbackServer server(plc);
    TempDir dir("channels-stop");
    Rig r(modbusProject(dir, server.port, 1).string(), false);
    r.rt->firstRound(kT0);
    r.rt->start();
    int64_t now = kT0 + 1000;
    ASSERT_TRUE(waitFor([&] {
        r.rt->tick(now += 100);
        return r.get("P1.A").quality == Quality::GOOD;
    }));
    plc.set(1, modbus::Area::HR, 0, 2);
    ASSERT_TRUE(waitFor([&] {
        r.rt->tick(now += 100);
        return r.get("P1.A").quality == Quality::GOOD &&
               std::get<int64_t>(r.get("P1.A").value) == 2;
    }));
    r.rt->stop();
    const size_t seen = plc.requestCount();
    plc.set(1, modbus::Area::HR, 0, 3);
    std::this_thread::sleep_for(std::chrono::milliseconds(400));
    r.rt->tick(now += 100);
    EXPECT_EQ(plc.requestCount(), seen) << "no request after stop()";
    EXPECT_EQ(std::get<int64_t>(r.get("P1.A").value), 2);
    r.rt->stop();  // repeatable
}

TEST(RuntimeEngineChannels, ThePlcGoingAwayMakesTheTagsBadWithAReasonAndBackGoodAgain) {
    mat::testing::FakePlc plc;
    plc.set(1, modbus::Area::HR, 0, 5);
    plc.set(1, modbus::Area::C, 3, 1);
    mat::testing::LoopbackServer server(plc);
    TempDir dir("channels-bad");
    Rig r(modbusProject(dir, server.port, 1).string(), false);
    r.rt->firstRound(kT0);
    r.rt->start();
    int64_t now = kT0 + 1000;
    ASSERT_TRUE(waitFor([&] {
        r.rt->tick(now += 100);
        return r.get("P1.A").quality == Quality::GOOD;
    }));
    plc.responding = false;
    ASSERT_TRUE(waitFor(
        [&] {
            r.rt->tick(now += 100);
            return r.get("P1.A").quality == Quality::BAD;
        },
        4000));
    EXPECT_FALSE(r.get("P1.A").reason.empty());
    EXPECT_EQ(std::get<int64_t>(r.get("P1.A").value), 5) << "BAD keeps the last value";
    plc.responding = true;
    ASSERT_TRUE(waitFor(
        [&] {
            r.rt->tick(now += 100);
            return r.get("P1.A").quality == Quality::GOOD;
        },
        6000));
    r.rt->stop();
}

TEST(RuntimeEngineChannels, TheDriverGetsTheTagsAndDevicesAsTheModelResolvedThem) {
    mat::testing::FakePlc plc;
    mat::testing::LoopbackServer server(plc);
    TempDir dir("channels-config");
    RuntimeEngineOptions opt;
    opt.writeQueuePerChannel = 5;
    Rig r(modbusProject(dir, server.port, 1).string(), false, opt);
    ASSERT_EQ(r.rt->channelDrivers().size(), 2u);
    const drv::ModbusTcpConfig& c = r.rt->channelDrivers()[0]->config();
    EXPECT_EQ(c.channelId, "plc1");
    EXPECT_EQ(c.host, "127.0.0.1");
    EXPECT_EQ(c.port, server.port);
    EXPECT_TRUE(c.enabled);
    EXPECT_EQ(c.writeQueueCapacity, 5);
    EXPECT_EQ(c.scanMs[0], 100);
    EXPECT_EQ(c.scanMs[2], 5000);
    ASSERT_EQ(c.devices.size(), 1u);
    EXPECT_EQ(c.devices[0].id, "d1");
    EXPECT_EQ(c.devices[0].unit, 1);
    EXPECT_EQ(c.devices[0].timeoutMs, 300);
    ASSERT_EQ(c.tags.size(), 2u);
    EXPECT_EQ(c.tags[0].tag, *r.store.indexOf("P1.A"));
    EXPECT_EQ(c.tags[0].area, modbus::Area::HR);
    EXPECT_EQ(c.tags[0].offset, 0);
    EXPECT_EQ(c.tags[0].count, 1);
    EXPECT_EQ(c.tags[0].rawType, TagType::INT16);
    EXPECT_EQ(c.tags[1].tag, *r.store.indexOf("P1.B"));
    EXPECT_EQ(c.tags[1].area, modbus::Area::C);
    EXPECT_EQ(c.tags[1].offset, 3);
    EXPECT_FALSE(r.rt->channelDrivers()[1]->config().enabled);
    EXPECT_EQ(r.rt->channelDrivers()[1]->config().tags.size(), 1u);
    // a Tag knows its channel: write requests are routed by it
    EXPECT_EQ(r.rt->driverOf(*r.store.indexOf("P1.A")), r.rt->channelDrivers()[0]);
    EXPECT_EQ(r.rt->driverOf(*r.store.indexOf("P2.A")), r.rt->channelDrivers()[1]);
    EXPECT_EQ(r.rt->driverOf(*r.store.indexOf("A.WAVE")), nullptr)
        << "a simulation Tag has no channel driver";
    r.rt->stop();
}

TEST(RuntimeEngineChannels, ProjectsActiveOfA02ProjectNamesTheChannelsButNeverTheirAddresses) {
    TempDir dir("channels-active");
    Rig r(modbusProject(dir, 1502, 1503).string(), false);
    ASSERT_TRUE(r.active.active);
    const json active = json::parse(r.active.activeJson);
    ASSERT_TRUE(active.contains("connections"));
    ASSERT_EQ(active["connections"].size(), 2u);
    EXPECT_EQ(active["connections"][0],
              (json{{"id", "plc1"}, {"name", "PLC một"}, {"kind", "modbus-tcp"}}));
    EXPECT_EQ(active["connections"][1]["id"], "plc2");
    const std::string text = r.active.activeJson;
    for (const char* secret : {"127.0.0.1", "1502", "1503", "host", "serial", "unitId"})
        EXPECT_EQ(text.find(secret), std::string::npos) << secret;
    // a project 0.1 does not get the key
    Rig old(std::string(MAT_SOURCE_DIR) + "/projects/tank-demo", false);
    EXPECT_FALSE(json::parse(old.active.activeJson).contains("connections"));
    r.rt->stop();
    old.rt->stop();
}
