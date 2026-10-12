// T194 (feature 006, US5; contracts/device-api-1.1.md §1.1, §2, §5; FR-029, FR-051):
// GET /api/v1/drivers/diagnostics. Two parts:
// - the JSON of §5 built from the drivers, the model and the store (driversDiagnosticsJson), on
//   drivers that run on a fake PLC and a fake clock: channels with their state and last error,
//   field devices with the counters of FR-029, the groups with the actual cycle, the Tags that are
//   BAD (newest first, at most 500) with their detail;
// - the route on the HTTPS listener in process: viewer and above, no session 401 with an audit row
//   (access.denied), plain HTTP 403, no refresh of the idle time, 501 without a backend, and the
//   blocks viewer, tags and retain of GET /api/v1/diagnostics (see diagnostics_audit_api_test).
#include <gtest/gtest.h>

#include <memory>

#include "core/auth/roles.hpp"
#include "core/tag-engine/engine.hpp"
#include "core/tag-engine/modbus_factory.hpp"
#include "core/tag-engine/tag_model.hpp"
#include "drivers/modbus/modbus_tcp_driver.hpp"
#include "drivers/modbus/tests/fake_plc.hpp"
#include "server/http/drivers_api.hpp"
#include "server/tests/api_rig.hpp"

using namespace mat;
using namespace mat::test;
using nlohmann::json;
namespace tst = mat::testing;

namespace {

constexpr int64_t kMin = 60 * 1000;

LoadedProject projectOf(const json& tags, const json& connections) {
    LoadedProject p;
    p.project = {{"schemaVersion", "0.2.0"}, {"tagFile", "tags.json"}, {"screens", json::array()}};
    p.tags = {{"schemaVersion", "0.2.0"}, {"tags", tags}};
    p.connections = connections;
    return p;
}

const json kConnections = json::parse(R"({
  "schemaVersion": "0.2.0",
  "scanGroups": { "fast": 250, "normal": 1000, "slow": 5000 },
  "channels": [
    { "id": "plc1", "name": "PLC trạm bơm", "kind": "modbus-tcp", "tcp": { "host": "10.0.0.5" },
      "devices": [ { "id": "plc1", "name": "PLC 1", "unitId": 1 } ] },
    { "id": "rs1", "name": "RS485 đồng hồ", "kind": "modbus-rtu", "enabled": false,
      "serial": { "port": "ttyAS2", "baud": 9600 },
      "devices": [ { "id": "meter1", "name": "Đồng hồ 1", "slave": 3 } ] }
  ]
})");

// A model of two external Tags on the PLC, one on the disabled RTU channel and a calculated one.
std::shared_ptr<ProjectModel> smallModel() {
    const json tags = json::parse(R"([
      {"id":"TANK.LEVEL","kind":"external","type":"UINT16","source":{"device":"plc1","address":"HR0"}},
      {"id":"TANK.TEMP","kind":"external","type":"UINT16","source":{"device":"plc1","address":"HR1"}},
      {"id":"METER.P","kind":"external","type":"UINT16","source":{"device":"meter1","address":"HR0"}},
      {"id":"TANK.VOLUME","kind":"calculated","type":"FLOAT64","expression":"TANK.LEVEL * 2"}
    ])");
    std::string err;
    auto m = buildProjectModel(projectOf(tags, kConnections), &err);
    EXPECT_TRUE(m) << err;
    return std::make_shared<ProjectModel>(std::move(*m));
}

// The Tag Engine and the Modbus TCP driver of channel 0 on a fake PLC (manual mode).
struct Plant {
    explicit Plant(std::shared_ptr<ProjectModel> m = smallModel()) : model(std::move(m)) {
        addModelTagsToStore(*model, store);
        engine = std::make_unique<Engine>(store, *model);
        drv::DriverEnv env;
        env.manual = true;
        env.clock = &clock;
        env.uniform = [] { return 0.0; };
        env.firstTid = [] { return static_cast<uint16_t>(1); };
        env.sleep = [this](int64_t t) { clock.set(t); };
        env.makeTransport = [this] {
            return std::unique_ptr<drv::Transport>(new tst::FakeTransport(plc, clock));
        };
        plcDriver = std::make_unique<drv::ModbusTcpDriver>(modbusTcpConfigOf(*model, 0), env);
        drv::DriverEnv disabledEnv = env;
        rtuDriver =
            std::make_unique<drv::ModbusTcpDriver>(modbusTcpConfigOf(*model, 1), disabledEnv);
        plc.set(1, modbus::Area::HR, 0, 42);
        plc.set(1, modbus::Area::HR, 1, 7);
        plcDriver->start(*engine);
        rtuDriver->start(*engine);
    }
    ~Plant() {
        plcDriver->stop();
        rtuDriver->stop();
    }
    void run(int64_t ms) {
        plcDriver->pump(clock.monoMs() + ms);
        engine->step(tst::FakeClock::kWallBase + clock.monoMs());
    }
    json diag() {
        DriversDiagInput in;
        in.model = model.get();
        in.channels = {plcDriver.get(), rtuDriver.get()};
        in.store = &store;
        in.engine = engine.get();
        in.nowMs = tst::FakeClock::kWallBase + clock.monoMs();
        in.startedAtMs = tst::FakeClock::kWallBase;
        return driversDiagnosticsJson(in);
    }
    std::shared_ptr<ProjectModel> model;
    TagStore store;
    std::unique_ptr<Engine> engine;
    tst::FakeClock clock;
    tst::FakePlc plc;
    std::unique_ptr<drv::ModbusTcpDriver> plcDriver, rtuDriver;
};

const json* channelOf(const json& j, const std::string& id) {
    for (const json& c : j["channels"])
        if (c["id"] == id) return &c;
    return nullptr;
}

const json* badTag(const json& j, const std::string& id) {
    for (const json& t : j["badTags"])
        if (t["id"] == id) return &t;
    return nullptr;
}

}  // namespace

TEST(DriversDiagJson, TheTreeOfChannelsAndFieldDevicesWithTheirStates) {
    Plant p;
    p.run(3000);
    const json j = p.diag();
    EXPECT_EQ(j["at"], tst::FakeClock::kWallBase + p.clock.monoMs());
    EXPECT_EQ(j["runtimeStartedAt"], tst::FakeClock::kWallBase);
    EXPECT_EQ(j["scanGroups"], (json{{"fast", 250}, {"normal", 1000}, {"slow", 5000}}));
    ASSERT_EQ(j["channels"].size(), 2u);

    const json& plc = *channelOf(j, "plc1");
    EXPECT_EQ(plc["name"], "PLC trạm bơm");
    EXPECT_EQ(plc["kind"], "modbus-tcp");
    EXPECT_EQ(plc["state"], "connected");
    EXPECT_TRUE(plc["lastError"].is_null());
    EXPECT_EQ(plc["reconnects"], 0);
    EXPECT_EQ(plc["warnings"], json::array());
    ASSERT_EQ(plc["devices"].size(), 1u);
    const json& dev = plc["devices"][0];
    EXPECT_EQ(dev["id"], "plc1");
    EXPECT_EQ(dev["name"], "PLC 1");
    EXPECT_EQ(dev["state"], "active");
    EXPECT_GE(dev["requestsOk"].get<int>(), 2);
    EXPECT_EQ(dev["timeouts"], 0);
    EXPECT_EQ(dev["exceptions"], json::object());
    EXPECT_EQ(
        dev["badFrames"],
        (json{{"crc", 0}, {"format", 0}, {"tid", 0}, {"unit", 0}, {"length", 0}, {"echo", 0}}));
    EXPECT_TRUE(dev["responseMs"]["avg"].is_number());
    EXPECT_TRUE(dev["responseMs"]["max"].is_number());
    EXPECT_EQ(dev["writes"],
              (json{{"confirmed", 0}, {"failed", 0}, {"timeout", 0}, {"rejected", 0}}));
    ASSERT_GE(dev["groups"].size(), 1u);
    const json& g = dev["groups"][0];
    EXPECT_EQ(g["group"], "normal");
    EXPECT_EQ(g["periodMs"], 1000);
    EXPECT_TRUE(g["actualMs"]["avg"].is_number());
    EXPECT_TRUE(g["actualMs"]["max"].is_number());
    EXPECT_TRUE(g["overruns"].is_number());
    EXPECT_EQ(g["overloaded"], false);

    const json& rs = *channelOf(j, "rs1");
    EXPECT_EQ(rs["kind"], "modbus-rtu");
    EXPECT_EQ(rs["state"], "disabled");
    EXPECT_EQ(rs["devices"][0]["id"], "meter1");
    EXPECT_EQ(rs["devices"][0]["state"], "disabled");
}

TEST(DriversDiagJson, TheCountersMatchTheFaultsThatWereInjected) {
    Plant p;
    p.run(2000);
    // 10 requests that get no answer, then an exception 02 and 03, a frame that is wrong
    tst::PlcFault silent;
    silent.kind = tst::PlcFault::Silent;
    silent.count = 10;
    p.plc.addFault(silent);
    // the reconnect waits grow (1, 2, 4, 8, 10 s...): run until every fault was met
    for (int i = 0; i < 600 && !p.plc.faults.empty(); ++i) p.run(1000);
    ASSERT_TRUE(p.plc.faults.empty());
    json j = p.diag();
    json dev = (*channelOf(j, "plc1"))["devices"][0];
    EXPECT_EQ(dev["timeouts"], 10);

    tst::PlcFault ex;
    ex.kind = tst::PlcFault::Exception;
    ex.code = 2;
    ex.count = 2;
    p.plc.addFault(ex);
    tst::PlcFault ex3 = ex;
    ex3.code = 3;
    ex3.count = 1;
    p.plc.addFault(ex3);
    tst::PlcFault tid;
    tid.kind = tst::PlcFault::BadTid;
    tid.count = 1;
    p.plc.addFault(tid);
    for (int i = 0; i < 600 && !p.plc.faults.empty(); ++i) p.run(1000);
    ASSERT_TRUE(p.plc.faults.empty());
    p.run(5000);
    j = p.diag();
    dev = (*channelOf(j, "plc1"))["devices"][0];
    // an exception is an answer, not a timeout; the frame with a wrong transaction id is dropped
    // and the wait goes on to its deadline, which is one more timeout (contract §5)
    EXPECT_EQ(dev["timeouts"].get<int>(), 10 + 1);
    EXPECT_EQ(dev["exceptions"]["02"], 2);
    EXPECT_EQ(dev["exceptions"]["03"], 1);
    EXPECT_EQ(dev["badFrames"]["tid"], 1);
    // the last error of the channel has a code, a time and the field device
    const json& ch = *channelOf(j, "plc1");
    ASSERT_TRUE(ch["lastError"].is_object());
    EXPECT_FALSE(ch["lastError"]["code"].get<std::string>().empty());
    EXPECT_GT(ch["lastError"]["at"].get<int64_t>(), tst::FakeClock::kWallBase);
    EXPECT_GE(ch["reconnects"].get<int>(), 1);
}

TEST(DriversDiagJson, BadTagsCarryTheirReasonAndTheDetailNewestFirst) {
    Plant p;
    p.run(2000);
    EXPECT_TRUE(p.diag()["badTags"].size() >= 1u);  // the Tag of the disabled channel: DISABLED
    const json before = p.diag();
    const json* disabled = badTag(before, "METER.P");
    ASSERT_NE(disabled, nullptr);
    EXPECT_EQ((*disabled)["quality"], "BAD");
    EXPECT_EQ((*disabled)["reason"], "DISABLED");
    EXPECT_TRUE((*disabled)["detail"].is_null());
    EXPECT_TRUE((*disabled)["updatedAt"].is_number());

    // the PLC stops answering: its Tags go BAD, the calculated one follows with the input as detail
    p.plc.responding = false;
    p.run(8000);
    const json j = p.diag();
    const json* level = badTag(j, "TANK.LEVEL");
    ASSERT_NE(level, nullptr);
    EXPECT_EQ((*level)["quality"], "BAD");
    const std::string reason = (*level)["reason"];
    EXPECT_TRUE(reason == "TIMEOUT" || reason == "DISCONNECTED") << reason;
    const json* volume = badTag(j, "TANK.VOLUME");
    ASSERT_NE(volume, nullptr);
    EXPECT_EQ((*volume)["reason"], "INPUT_BAD");
    EXPECT_EQ((*volume)["detail"], "TANK.LEVEL");
    // newest first: updatedAt never grows along the list
    int64_t last = INT64_MAX;
    for (const json& t : j["badTags"]) {
        EXPECT_LE(t["updatedAt"].get<int64_t>(), last);
        last = t["updatedAt"].get<int64_t>();
    }
    EXPECT_EQ(j["badTagsTruncated"], false);
}

TEST(DriversDiagJson, AnExceptionOfTheDeviceIsTheDetailOfTheTag) {
    Plant p;
    p.run(2000);
    tst::PlcFault ex;
    ex.kind = tst::PlcFault::Exception;
    ex.code = 4;
    ex.count = 200;
    p.plc.addFault(ex);
    p.run(1500);
    const json j = p.diag();
    const json* level = badTag(j, "TANK.LEVEL");
    ASSERT_NE(level, nullptr) << j.dump();
    EXPECT_EQ((*level)["reason"], "EXCEPTION_04");
    EXPECT_EQ((*level)["detail"], "04");
}

TEST(DriversDiagJson, AtMost500BadTagsAreListedAndTheListSaysItWasCut) {
    json tags = json::array();
    for (int i = 0; i < 600; ++i)
        tags.push_back({{"id", "M" + std::to_string(i)},
                        {"kind", "external"},
                        {"type", "UINT16"},
                        {"source", {{"device", "meter1"}, {"address", "HR" + std::to_string(i)}}}});
    std::string err;
    auto m = buildProjectModel(projectOf(tags, kConnections), &err);
    ASSERT_TRUE(m) << err;
    Plant p(std::make_shared<ProjectModel>(std::move(*m)));
    p.run(1500);
    const json j = p.diag();
    EXPECT_EQ(j["badTags"].size(), 500u);  // every Tag is on the disabled channel: DISABLED
    EXPECT_EQ(j["badTagsTruncated"], true);
}

TEST(DriversDiagJson, NumbersAreTakenFromTheStartOfTheRuntimeAndNeverReset) {
    Plant p;
    p.run(3000);
    const int first = (*channelOf(p.diag(), "plc1"))["devices"][0]["requestsOk"];
    p.run(3000);
    EXPECT_GT((*channelOf(p.diag(), "plc1"))["devices"][0]["requestsOk"].get<int>(), first);
    // reading the diagnostics changes nothing
    const json a = p.diag();
    const json b = p.diag();
    EXPECT_EQ(a["channels"], b["channels"]);
}

// ---------- the route ----------

namespace {

struct Rig : ApiRig {
    Rig()
        : ApiRig([this](ApiRig& rig) {
              EngineeringApi::DriversBackend d;
              d.probeTcp = [](const drv::TcpProbeRequest&) {
                  drv::TestOutcome o;
                  o.code = "OK";
                  return o;
              };
              d.diagnostics = [this] {
                  ++calls;
                  return json{{"at", 1791601205000LL},
                              {"channels", json::array()},
                              {"badTags", json::array()},
                              {"badTagsTruncated", false}};
              };
              d.monoMs = [&rig] { return rig.mono.load(); };
              rig.eng->setDrivers(d);
          }) {}
    std::atomic<int> calls{0};
};

}  // namespace

TEST(DriversDiagApi, AViewerAndAboveMaySeeItNoSessionIs401WithAnAuditRowAndHttpIs403) {
    Rig r;
    for (const char* user : {"xem1", "vh1", "kysu1", "admin1"}) {
        const HttpResult res = r.getAs(user, "/api/v1/drivers/diagnostics");
        EXPECT_EQ(res.status, 200) << user << res.body;
        EXPECT_EQ(bodyJson(res)["at"], 1791601205000LL);
    }
    const int served = r.calls;
    const HttpResult none = r.call(getReq("/api/v1/drivers/diagnostics"));
    EXPECT_EQ(none.status, 401);
    EXPECT_EQ(bodyJson(none)["error"], "AUTH_REQUIRED");
    const auto denied = r.records("access.denied");
    ASSERT_GE(denied.size(), 1u);
    EXPECT_EQ(denied[0].target.value_or(""), "/api/v1/drivers/diagnostics");
    const HttpResult http = r.callHttp(getReq("/api/v1/drivers/diagnostics"));
    EXPECT_EQ(http.status, 403);
    EXPECT_EQ(bodyJson(http)["error"], "HTTPS_REQUIRED");
    EXPECT_EQ(r.calls, served) << "nothing was built for a refused request";
}

TEST(DriversDiagApi, ItDoesNotRestartTheIdleTimeNorWriteAnAuditRow) {
    Rig r;
    const std::string auth = r.bearer("xem1");
    const size_t rows = r.records("").size();
    r.mono += 10 * kMin;
    ASSERT_EQ(r.call(getReq("/api/v1/drivers/diagnostics", {auth})).status, 200);
    const json s = bodyJson(r.call(getReq("/api/v1/auth/session", {auth})));
    EXPECT_EQ(s["idleRemainingS"], 1200);  // 30 min - 10 min: the poll did not restart it
    EXPECT_EQ(r.records("").size(), rows);
}

TEST(DriversDiagApi, WithoutABackendTheRouteAnswers501AfterTheGate) {
    ApiRig r([](ApiRig& rig) {
        EngineeringApi::DriversBackend d;
        d.probeTcp = [](const drv::TcpProbeRequest&) {
            drv::TestOutcome o;
            o.code = "OK";
            return o;
        };
        rig.eng->setDrivers(d);
    });
    EXPECT_EQ(r.getAs("xem1", "/api/v1/drivers/diagnostics").status, 501);
    EXPECT_EQ(r.call(getReq("/api/v1/drivers/diagnostics")).status, 401);
}

TEST(DriversDiagApi, TheEndpointIsInTheTableOfRoles) {
    const EndpointRule* rule = findEndpointRule("GET", "/api/v1/drivers/diagnostics");
    ASSERT_NE(rule, nullptr);
    EXPECT_TRUE(rule->needsSession);
    EXPECT_EQ(rule->minRole, Role::Viewer);
    EXPECT_FALSE(rule->refreshesSession);
    EXPECT_FALSE(rule->changesDevice);
}
