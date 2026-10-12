// T167 (feature 006, US3; contracts/device-api-1.1.md §1.1, §6; device-config §4): the list of
// serial ports and the connection test of an RTU channel, on the HTTPS listener of mat-runtime in
// process, over the real audit log and sign-in service.
// - GET /api/v1/serial/ports: engineer and above; viewer and operator 403 with an audit row, no
//   session 401, plain HTTP 403 HTTPS_REQUIRED; the JSON of §6; nothing is opened; the idle time
//   of the session is not restarted;
// - ?probe=1: the ports that are allowed and free are asked, with an audit row driver.test (target
//   = the port, code RS485_PROBE);
// - device/identity lists "serial-ports";
// - POST /api/v1/drivers/test with a modbus-rtu channel (T164): the codes of §10 (OK, PORT_CONSOLE,
//   PORT_NOT_ALLOWED, PORT_BUSY, PORT_ERROR, TIMEOUT, EXCEPTION), the issues of a bad request,
//   the audit row with the port name.
#include <gtest/gtest.h>

#include <algorithm>
#include <atomic>

#include "core/auth/roles.hpp"
#include "drivers/sdk/serial_ports.hpp"
#include "server/tests/api_rig.hpp"

using namespace mat;
using namespace mat::test;
using nlohmann::json;

namespace {

constexpr int64_t kMin = 60 * 1000;

std::vector<drv::SerialPortInfo> fakePorts() {
    std::vector<drv::SerialPortInfo> v;
    drv::SerialPortInfo a;
    a.name = "ttyAS0";
    a.path = "/dev/ttyAS0";
    a.kind = "onboard";
    a.driver = "uart";
    a.console = true;
    a.inUseBy = "console";
    a.inUseDetail = "console của hệ điều hành (serial-getty@ttyAS0)";
    v.push_back(a);
    drv::SerialPortInfo b;
    b.name = "ttyAS2";
    b.path = "/dev/ttyAS2";
    b.kind = "onboard";
    b.driver = "uart";
    b.allowed = true;
    b.inUseBy = "channel";
    b.inUseDetail = "rs485-1";
    b.rs485 = "enabled";
    v.push_back(b);
    drv::SerialPortInfo c;
    c.name = "ttyAS3";
    c.path = "/dev/ttyAS3";
    c.kind = "onboard";
    c.driver = "uart";
    c.allowed = true;
    v.push_back(c);
    drv::SerialPortInfo d;
    d.name = "ttyUSB0";
    d.path = "/dev/ttyUSB0";
    d.byId = "/dev/serial/by-id/usb-Quectel_EC25-if02-port0";
    d.kind = "usb";
    d.driver = "option";
    d.hasUsb = true;
    d.vid = "2c7c";
    d.pid = "0125";
    d.product = "EC25";
    v.push_back(d);
    return v;
}

// A source of ports that counts what it was asked and remembers which were probed.
struct Ports {
    std::atomic<int> lists{0};
    std::atomic<int> probes{0};
    json list(bool probe, std::vector<std::string>& probed) {
        ++lists;
        auto ports = fakePorts();
        if (probe) {
            ++probes;
            for (auto& p : ports)
                if (p.allowed && p.inUseBy.empty()) {
                    p.rs485 = "supported";
                    probed.push_back(p.name);
                }
        }
        return drv::serialPortsJson(ports);
    }
};

struct Rig : ApiRig {
    explicit Rig(std::shared_ptr<Ports> p = std::make_shared<Ports>())
        : ApiRig([p](ApiRig& rig) {
              EngineeringApi::SerialBackend s;
              s.list = [p](bool probe, std::vector<std::string>& probed) {
                  return p->list(probe, probed);
              };
              rig.eng->setSerial(s);
          }),
          ports(std::move(p)) {}
    std::shared_ptr<Ports> ports;
};

}  // namespace

TEST(SerialApi, OnlyAnEngineerOrAboveMaySeePortsAndARefusalIsAudited) {
    Rig r;
    for (const char* user : {"xem1", "vh1"}) {
        const HttpResult res = r.getAs(user, "/api/v1/serial/ports");
        EXPECT_EQ(res.status, 403) << user;
        EXPECT_EQ(bodyJson(res)["error"], "FORBIDDEN");
    }
    EXPECT_EQ(r.ports->lists, 0);
    const auto denied = r.records("access.denied");
    ASSERT_GE(denied.size(), 1u);
    EXPECT_EQ(denied[0].target.value_or(""), "/api/v1/serial/ports");
    for (const char* user : {"kysu1", "admin1"})
        EXPECT_EQ(r.getAs(user, "/api/v1/serial/ports").status, 200) << user;
}

TEST(SerialApi, NoSessionIs401AndHttpIs403HttpsRequiredAndAProbeIsNotAskedForThem) {
    Rig r;
    EXPECT_EQ(bodyJson(r.call(getReq("/api/v1/serial/ports")))["error"], "AUTH_REQUIRED");
    const HttpResult http = r.callHttp(getReq("/api/v1/serial/ports?probe=1"));
    EXPECT_EQ(http.status, 403);
    EXPECT_EQ(bodyJson(http)["error"], "HTTPS_REQUIRED");
    EXPECT_EQ(r.getAs("xem1", "/api/v1/serial/ports?probe=1").status, 403);
    EXPECT_EQ(r.ports->lists, 0);
    EXPECT_EQ(r.ports->probes, 0);
}

TEST(SerialApi, TheListIsTheJsonOfTheContract) {
    Rig r;
    const HttpResult res = r.getAs("kysu1", "/api/v1/serial/ports");
    ASSERT_EQ(res.status, 200) << res.body;
    const json j = bodyJson(res);
    ASSERT_TRUE(j["ports"].is_array());
    ASSERT_EQ(j["ports"].size(), 4u);

    const json& console = j["ports"][0];
    EXPECT_EQ(console["name"], "ttyAS0");
    EXPECT_EQ(console["path"], "/dev/ttyAS0");
    EXPECT_EQ(console["kind"], "onboard");
    EXPECT_EQ(console["driver"], "uart");
    EXPECT_EQ(console["allowed"], false);
    EXPECT_EQ(console["inUse"]["by"], "console");
    EXPECT_NE(console["inUse"]["detail"].get<std::string>().find("serial-getty@ttyAS0"),
              std::string::npos);
    EXPECT_EQ(console["rs485"], "unknown");
    EXPECT_FALSE(console.contains("usb"));
    EXPECT_FALSE(console.contains("byId"));

    const json& channel = j["ports"][1];
    EXPECT_EQ(channel["allowed"], true);
    EXPECT_EQ(channel["inUse"]["by"], "channel");
    EXPECT_EQ(channel["inUse"]["detail"], "rs485-1");
    EXPECT_EQ(channel["rs485"], "enabled");

    const json& free = j["ports"][2];
    EXPECT_TRUE(free["inUse"].is_null());

    const json& usb = j["ports"][3];
    EXPECT_EQ(usb["kind"], "usb");
    EXPECT_EQ(usb["driver"], "option");
    EXPECT_EQ(usb["usb"], (json{{"vid", "2c7c"}, {"pid", "0125"}, {"product", "EC25"}}));
    EXPECT_EQ(usb["byId"], "/dev/serial/by-id/usb-Quectel_EC25-if02-port0");
    EXPECT_EQ(usb["allowed"], false);
    EXPECT_TRUE(usb["inUse"].is_null());
}

TEST(SerialApi, AListDoesNotProbeAndDoesNotRestartTheIdleTimeNorWriteAnAuditRow) {
    Rig r;
    const std::string auth = r.bearer("kysu1");
    const size_t before = r.records("driver.test").size();
    r.mono += 10 * kMin;
    ASSERT_EQ(r.call(getReq("/api/v1/serial/ports", {auth})).status, 200);
    EXPECT_EQ(r.ports->probes, 0);
    EXPECT_EQ(r.records("driver.test").size(), before);
    const json s = bodyJson(r.call(getReq("/api/v1/auth/session", {auth})));
    EXPECT_EQ(s["idleRemainingS"], 1200);  // 30 min - 10 min: the list did not restart it
}

TEST(SerialApi, AProbeAsksThePortsThatAreAllowedAndFreeAndIsAudited) {
    Rig r;
    const HttpResult res = r.getAs("kysu1", "/api/v1/serial/ports?probe=1");
    ASSERT_EQ(res.status, 200) << res.body;
    EXPECT_EQ(r.ports->probes, 1);
    const json j = bodyJson(res);
    EXPECT_EQ(j["ports"][2]["rs485"], "supported");
    EXPECT_EQ(j["ports"][1]["rs485"], "enabled");  // a channel holds it: not asked
    const auto rows = r.records("driver.test");
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].user.value_or(""), "kysu1");
    EXPECT_EQ(rows[0].target.value_or(""), "ttyAS3");
    EXPECT_EQ(rows[0].code.value_or(""), "RS485_PROBE");
    EXPECT_EQ(rows[0].result, "ok");
}

TEST(SerialApi, ABadProbeValueIs400) {
    Rig r;
    EXPECT_EQ(r.getAs("kysu1", "/api/v1/serial/ports?probe=2").status, 400);
    EXPECT_EQ(r.getAs("kysu1", "/api/v1/serial/ports?probe=yes").status, 400);
    EXPECT_EQ(r.getAs("kysu1", "/api/v1/serial/ports?probe=0").status, 200);
    EXPECT_EQ(r.ports->probes, 0);
}

TEST(SerialApi, WithoutABackendTheRouteAnswers501AfterTheGate) {
    ApiRig r;
    EXPECT_EQ(r.getAs("kysu1", "/api/v1/serial/ports").status, 501);
    EXPECT_EQ(r.getAs("xem1", "/api/v1/serial/ports").status, 403);
}

TEST(SerialApi, TheIdentityListsSerialPorts) {
    Rig r;
    const json f = bodyJson(r.call(getReq("/api/v1/device/identity")))["features"];
    EXPECT_NE(std::find(f.begin(), f.end(), json("serial-ports")), f.end());
    ApiRig none;
    const json g = bodyJson(none.call(getReq("/api/v1/device/identity")))["features"];
    EXPECT_EQ(std::find(g.begin(), g.end(), json("serial-ports")), g.end());
}

TEST(SerialApi, TheEndpointIsInTheTableOfRoles) {
    const EndpointRule* rule = findEndpointRule("GET", "/api/v1/serial/ports");
    ASSERT_NE(rule, nullptr);
    EXPECT_TRUE(rule->needsSession);
    EXPECT_EQ(rule->minRole, Role::Engineer);
    EXPECT_FALSE(rule->refreshesSession);
    EXPECT_FALSE(rule->changesDevice);
}

// ---------- the connection test of an RTU channel ----------

namespace {

struct RtuProbe {
    std::mutex mu;
    int calls = 0;
    std::string lastPort;
    drv::RtuProbeRequest lastReq;
    drv::TestOutcome outcome;
    std::string refusal;  // PORT_CONSOLE, PORT_NOT_ALLOWED: the check before the port is opened
    drv::TestOutcome run(const std::string& port, const drv::RtuProbeRequest& r) {
        std::lock_guard<std::mutex> g(mu);
        ++calls;
        lastPort = port;
        lastReq = r;
        if (!refusal.empty()) {
            drv::TestOutcome o;
            o.code = refusal;
            return o;
        }
        return outcome;
    }
};

struct TestRig : ApiRig {
    explicit TestRig(std::shared_ptr<RtuProbe> p = std::make_shared<RtuProbe>())
        : ApiRig([p](ApiRig& rig) {
              EngineeringApi::DriversBackend d;
              d.probeTcp = [](const drv::TcpProbeRequest&) {
                  drv::TestOutcome o;
                  o.code = "OK";
                  return o;
              };
              d.probeRtu = [p](const std::string& port, const drv::RtuProbeRequest& r) {
                  return p->run(port, r);
              };
              d.monoMs = [&rig] { return rig.mono.load(); };
              rig.eng->setDrivers(d);
          }),
          probe(std::move(p)) {
        probe->outcome.code = "OK";
        probe->outcome.connectMs = 3;
    }
    HttpResult test(const std::string& user, const json& body) {
        return postAs(user, "/api/v1/drivers/test", body.dump());
    }
    std::shared_ptr<RtuProbe> probe;
};

json rtuBody() {
    return {{"channel",
             {{"kind", "modbus-rtu"},
              {"serial",
               {{"port", "ttyAS2"},
                {"baud", 19200},
                {"dataBits", 8},
                {"parity", "none"},
                {"stopBits", 2},
                {"rs485", true},
                {"dropEcho", true},
                {"silenceMs", 6}}}}},
            {"device", {{"slave", 7}, {"timeoutMs", 500}, {"addressBase", 1}}}};
}

}  // namespace

TEST(RtuTestApi, ARequestWithoutAReadOpensAndClosesThePort) {
    TestRig r;
    const HttpResult res = r.test("kysu1", rtuBody());
    ASSERT_EQ(res.status, 200) << res.body;
    const json j = bodyJson(res);
    EXPECT_EQ(j["ok"], true);
    EXPECT_EQ(j["code"], "OK");
    EXPECT_EQ(r.probe->calls, 1);
    EXPECT_EQ(r.probe->lastPort, "ttyAS2");
    const auto& q = r.probe->lastReq;
    EXPECT_EQ(q.devicePath, "/dev/ttyAS2");
    EXPECT_EQ(q.baud, 19200);
    EXPECT_EQ(q.dataBits, 8);
    EXPECT_EQ(q.parity, 'N');
    EXPECT_EQ(q.stopBits, 2);
    EXPECT_TRUE(q.rs485);
    EXPECT_TRUE(q.dropEcho);
    EXPECT_EQ(q.silenceMs, 6);
    EXPECT_EQ(q.unit, 7);
    EXPECT_EQ(q.timeoutMs, 500);
    EXPECT_FALSE(q.read);
}

TEST(RtuTestApi, ADefaultFrameIs9600_8E1WithRs485AndOneSecond) {
    TestRig r;
    json b = {{"channel", {{"kind", "modbus-rtu"}, {"serial", {{"port", "ttyAS2"}}}}},
              {"device", {{"slave", 1}}}};
    ASSERT_EQ(r.test("kysu1", b).status, 200);
    const auto& q = r.probe->lastReq;
    EXPECT_EQ(q.baud, 9600);
    EXPECT_EQ(q.parity, 'E');
    EXPECT_EQ(q.stopBits, 1);
    EXPECT_EQ(q.dataBits, 8);
    EXPECT_TRUE(q.rs485);
    EXPECT_FALSE(q.dropEcho);
    EXPECT_EQ(q.silenceMs, 0);
    EXPECT_EQ(q.timeoutMs, 1000);
}

TEST(RtuTestApi, AReadReturnsTheRegistersLikeTheTcpTest) {
    TestRig r;
    r.probe->outcome.fc = 3;
    r.probe->outcome.offset = 4;
    r.probe->outcome.count = 2;
    r.probe->outcome.registers = {0x1234, 0xABCD};
    r.probe->outcome.responseMs = 21;
    json b = rtuBody();
    b["read"] = {{"address", "HR5"}, {"count", 2}};  // base 1: offset 4 on the wire
    const HttpResult res = r.test("kysu1", b);
    ASSERT_EQ(res.status, 200) << res.body;
    const json j = bodyJson(res);
    EXPECT_EQ(j["responseMs"], 21);
    EXPECT_EQ(j["read"]["fc"], 3);
    EXPECT_EQ(j["read"]["offset"], 4);
    EXPECT_EQ(j["read"]["registers"], (json{"1234", "ABCD"}));
    EXPECT_TRUE(r.probe->lastReq.read);
    EXPECT_EQ(r.probe->lastReq.offset, 4);
    EXPECT_EQ(r.probe->lastReq.count, 2);
    EXPECT_EQ(r.probe->lastReq.area, modbus::Area::HR);
}

TEST(RtuTestApi, TheCodesOfTheContractAreReturnedAndAudited) {
    for (const char* code :
         {"PORT_CONSOLE", "PORT_NOT_ALLOWED", "PORT_BUSY", "PORT_ERROR", "TIMEOUT", "BAD_FRAME"}) {
        TestRig r;
        r.probe->outcome.code = code;
        const HttpResult res = r.test("kysu1", rtuBody());
        ASSERT_EQ(res.status, 200) << code << res.body;
        const json j = bodyJson(res);
        EXPECT_EQ(j["ok"], false) << code;
        EXPECT_EQ(j["code"], code);
        const std::string codeText = code;
        if (codeText.rfind("PORT_", 0) == 0) EXPECT_TRUE(j.contains("message")) << code;
        const auto rows = r.records("driver.test");
        ASSERT_EQ(rows.size(), 1u) << code;
        EXPECT_EQ(rows[0].target.value_or(""), "ttyAS2");  // the port, not host:port
        EXPECT_EQ(rows[0].code.value_or(""), code);
        EXPECT_EQ(rows[0].result, "failed");
    }
}

TEST(RtuTestApi, ARefusalOfTheDeviceReachesTheClient) {
    TestRig r;
    r.probe->refusal = "PORT_CONSOLE";
    const json j = bodyJson(r.test("kysu1", rtuBody()));
    EXPECT_EQ(j["code"], "PORT_CONSOLE");
    EXPECT_NE(j["message"].get<std::string>().find("console"), std::string::npos);
}

TEST(RtuTestApi, ABadRequestIs400WithIssuesInTheCodesOfTheValidator) {
    TestRig r;
    auto issues = [&](json body) {
        const HttpResult res = r.test("kysu1", body);
        EXPECT_EQ(res.status, 400) << body.dump() << res.body;
        return bodyJson(res);
    };
    auto has = [](const json& j, const std::string& code) {
        for (const json& i : j.value("issues", json::array()))
            if (i.value("code", "") == code) return true;
        return false;
    };
    json b = rtuBody();
    b["channel"]["serial"]["port"] = "COM3";
    EXPECT_TRUE(has(issues(b), "E_SERIAL_PORT"));
    b = rtuBody();
    b["channel"]["serial"]["port"] = "/etc/passwd";
    EXPECT_TRUE(has(issues(b), "E_SERIAL_PORT"));
    b = rtuBody();
    b["channel"]["serial"].erase("port");
    EXPECT_TRUE(has(issues(b), "E_FIELD_MISSING"));
    b = rtuBody();
    b["channel"]["serial"]["baud"] = 12345;
    EXPECT_TRUE(has(issues(b), "E_FIELD_VALUE"));
    b = rtuBody();
    b["channel"]["serial"]["parity"] = "mark";
    EXPECT_TRUE(has(issues(b), "E_FIELD_VALUE"));
    b = rtuBody();
    b["channel"]["serial"]["dataBits"] = 6;
    EXPECT_TRUE(has(issues(b), "E_FIELD_VALUE"));
    b = rtuBody();
    b["channel"]["serial"]["stopBits"] = 3;
    EXPECT_TRUE(has(issues(b), "E_FIELD_VALUE"));
    b = rtuBody();
    b["device"]["slave"] = 0;  // no broadcast (D31)
    EXPECT_TRUE(has(issues(b), "E_FIELD_VALUE"));
    b = rtuBody();
    b["device"]["slave"] = 248;
    EXPECT_TRUE(has(issues(b), "E_FIELD_VALUE"));
    b = rtuBody();
    b["read"] = {{"address", "HR1"}, {"count", 9}};
    EXPECT_TRUE(has(issues(b), "E_PROBE_COUNT"));
    EXPECT_EQ(r.probe->calls, 0);
}

TEST(RtuTestApi, OnlyAnEngineerMayTestAndTheRateLimitIsTheSameAsTcp) {
    TestRig r;
    EXPECT_EQ(r.test("xem1", rtuBody()).status, 403);
    EXPECT_EQ(r.test("vh1", rtuBody()).status, 403);
    EXPECT_EQ(r.probe->calls, 0);
    for (int i = 0; i < 10; ++i) EXPECT_EQ(r.test("kysu1", rtuBody()).status, 200) << i;
    const HttpResult limited = r.test("kysu1", rtuBody());
    EXPECT_EQ(limited.status, 429);
    EXPECT_EQ(bodyJson(limited)["error"], "TEST_RATE_LIMITED");
}

TEST(RtuTestApi, WithoutAnRtuBackendTheTestIs501AsBefore) {
    ApiRig r([](ApiRig& rig) {
        EngineeringApi::DriversBackend d;
        d.probeTcp = [](const drv::TcpProbeRequest&) {
            drv::TestOutcome o;
            o.code = "OK";
            return o;
        };
        rig.eng->setDrivers(d);
    });
    const HttpResult res = r.postAs("kysu1", "/api/v1/drivers/test", rtuBody().dump());
    EXPECT_EQ(res.status, 501);
    EXPECT_EQ(bodyJson(res)["error"], "NOT_IMPLEMENTED");
}
