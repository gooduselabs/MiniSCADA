// T105 (feature 006, US1; contracts/device-api-1.1.md §1.1, §4, §7): POST /api/v1/drivers/test on
// the HTTPS listener of mat-runtime in process (CivetWeb with TLS), over the real audit log and
// sign-in service, the connection test injected.
// - engineer and above only: viewer and operator 403 with an audit row, no session 401, HTTP 403;
// - body of at most 16 KiB; a bad configuration 400 with `issues` in the codes of the validator;
// - one test at a time (409 TEST_BUSY); at most 10 a minute (429 TEST_RATE_LIMITED, Retry-After);
// - audit driver.test with host:port and the result code; no audit log, no test (503);
// - the answer of §4 for every result, the hard cap of 35 s, a POST restarts the idle time.
#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <thread>

#include "core/auth/roles.hpp"
#include "server/tests/api_rig.hpp"

using namespace mat;
using namespace mat::test;
using nlohmann::json;

namespace {

constexpr int64_t kMin = 60 * 1000;

// A probe that answers what the test says and remembers what it was asked.
struct FakeProbe {
    std::mutex mu;
    std::condition_variable cv;
    bool hold = false;     // block until released
    bool entered = false;  // a call is inside
    drv::TestOutcome outcome;
    drv::TcpProbeRequest last;
    int calls = 0;

    drv::TestOutcome run(const drv::TcpProbeRequest& r) {
        std::unique_lock<std::mutex> l(mu);
        last = r;
        ++calls;
        entered = true;
        cv.notify_all();
        cv.wait(l, [this] { return !hold; });
        return outcome;
    }
    void waitEntered() {
        std::unique_lock<std::mutex> l(mu);
        cv.wait_for(l, std::chrono::seconds(5), [this] { return entered; });
    }
    void release() {
        std::lock_guard<std::mutex> l(mu);
        hold = false;
        cv.notify_all();
    }
};

struct Rig : ApiRig {
    explicit Rig(std::shared_ptr<FakeProbe> p = std::make_shared<FakeProbe>())
        : ApiRig([p](ApiRig& rig) {
              EngineeringApi::DriversBackend d;
              d.probeTcp = [p](const drv::TcpProbeRequest& r) { return p->run(r); };
              d.monoMs = [&rig] { return rig.mono.load(); };
              rig.eng->setDrivers(d);
          }),
          probe(std::move(p)) {
        probe->outcome.code = "OK";
        probe->outcome.connectMs = 4;
    }
    HttpResult test(const std::string& user, const json& body) {
        return postAs(user, "/api/v1/drivers/test", body.dump());
    }
    std::shared_ptr<FakeProbe> probe;
};

json goodBody() {
    return {{"channel",
             {{"kind", "modbus-tcp"},
              {"tcp", {{"host", "192.168.10.5"}, {"port", 502}, {"connectTimeoutMs", 3000}}}}},
            {"device", {{"unitId", 1}, {"timeoutMs", 1000}, {"addressBase", 0}}}};
}

json withRead(const std::string& address, int count) {
    json b = goodBody();
    b["read"] = {{"address", address}, {"count", count}};
    return b;
}

bool hasIssue(const json& res, const std::string& code) {
    for (const json& i : res.value("issues", json::array()))
        if (i.value("code", "") == code) return true;
    return false;
}

}  // namespace

TEST(DriversApi, OnlyAnEngineerOrAboveMayTestAndARefusalIsAudited) {
    Rig r;
    for (const char* user : {"xem1", "vh1"}) {
        const HttpResult res = r.test(user, goodBody());
        EXPECT_EQ(res.status, 403) << user;
        EXPECT_EQ(bodyJson(res)["error"], "FORBIDDEN");
    }
    EXPECT_EQ(r.probe->calls, 0);
    const auto denied = r.records("access.denied");
    ASSERT_GE(denied.size(), 1u);
    EXPECT_EQ(denied[0].target.value_or(""), "/api/v1/drivers/test");
    for (const char* user : {"kysu1", "admin1"})
        EXPECT_EQ(r.test(user, goodBody()).status, 200) << user;
}

TEST(DriversApi, NoSessionIs401AndHttpIs403HttpsRequired) {
    Rig r;
    EXPECT_EQ(bodyJson(r.call(postReq("/api/v1/drivers/test", goodBody().dump())))["error"],
              "AUTH_REQUIRED");
    const HttpResult http = r.callHttp(postReq("/api/v1/drivers/test", goodBody().dump()));
    EXPECT_EQ(http.status, 403);
    EXPECT_EQ(bodyJson(http)["error"], "HTTPS_REQUIRED");
    EXPECT_EQ(r.probe->calls, 0);
}

TEST(DriversApi, TheBodyIsAtMost16KiB) {
    Rig r;
    json b = goodBody();
    b["pad"] = std::string(17 * 1024, 'x');
    const HttpResult res = r.test("kysu1", b);
    EXPECT_EQ(res.status, 413);
    EXPECT_EQ(bodyJson(res)["error"], "BODY_TOO_LARGE");
}

TEST(DriversApi, ABadConfigurationIs400WithIssuesInTheCodesOfTheValidator) {
    Rig r;
    auto issues = [&](json body) {
        const HttpResult res = r.test("kysu1", body);
        EXPECT_EQ(res.status, 400) << body.dump() << res.body;
        const json j = bodyJson(res);
        EXPECT_EQ(j["error"], "BAD_REQUEST");
        EXPECT_TRUE(j["issues"].is_array());
        return j;
    };
    EXPECT_TRUE(hasIssue(issues(withRead("HR1x", 1)), "E_ADDR_SYNTAX"));
    EXPECT_TRUE(hasIssue(issues(withRead("DI5.3", 1)), "E_ADDR_AREA"));
    EXPECT_TRUE(hasIssue(issues(withRead("HR70000", 1)), "E_ADDR_RANGE"));
    EXPECT_TRUE(hasIssue(issues(withRead("HR1", 5)), "E_PROBE_COUNT"));
    EXPECT_TRUE(hasIssue(issues(withRead("C1", 17)), "E_PROBE_COUNT"));
    EXPECT_TRUE(hasIssue(issues(withRead("HR1", 0)), "E_PROBE_COUNT"));
    json noHost = goodBody();
    noHost["channel"]["tcp"].erase("host");
    EXPECT_TRUE(hasIssue(issues(noHost), "E_FIELD_MISSING"));
    json badPort = goodBody();
    badPort["channel"]["tcp"]["port"] = 70000;
    EXPECT_TRUE(hasIssue(issues(badPort), "E_FIELD_VALUE"));
    json badUnit = goodBody();
    badUnit["device"]["unitId"] = 300;
    EXPECT_TRUE(hasIssue(issues(badUnit), "E_FIELD_VALUE"));
    json badKind = goodBody();
    badKind["channel"]["kind"] = "profibus";
    EXPECT_TRUE(hasIssue(issues(badKind), "E_FIELD_VALUE"));
    EXPECT_EQ(r.test("kysu1", json("text")).status, 400);
    EXPECT_EQ(r.probe->calls, 0) << "nothing is tried with a bad configuration";
    // every issue says where
    const json j = issues(withRead("HR1x", 1));
    for (const json& i : j["issues"]) {
        EXPECT_TRUE(i.contains("path"));
        EXPECT_TRUE(i.contains("message"));
    }
}

TEST(DriversApi, AnythingThatIsNotJsonIs400) {
    Rig r;
    EXPECT_EQ(r.postAs("kysu1", "/api/v1/drivers/test", "{not json").status, 400);
    EXPECT_EQ(r.postAs("kysu1", "/api/v1/drivers/test", "").status, 400);
}

TEST(DriversApi, TheAnswerForAnOkConnectionAndForAnOkRead) {
    Rig r;
    json b = bodyJson(r.test("kysu1", goodBody()));
    EXPECT_EQ(b["ok"], true);
    EXPECT_EQ(b["code"], "OK");
    EXPECT_EQ(b["connectMs"], 4);
    EXPECT_FALSE(b.contains("read"));

    r.probe->outcome.responseMs = 12;
    r.probe->outcome.fc = 3;
    r.probe->outcome.offset = 100;
    r.probe->outcome.count = 2;
    r.probe->outcome.registers = {0x42F6, 0xE979};
    b = bodyJson(r.test("kysu1", withRead("HR101", 2)));
    EXPECT_EQ(b["responseMs"], 12);
    EXPECT_EQ(b["read"]["fc"], 3);
    EXPECT_EQ(b["read"]["offset"], 100);
    EXPECT_EQ(b["read"]["count"], 2);
    EXPECT_EQ(b["read"]["registers"], json::array({"42F6", "E979"}));
    EXPECT_EQ(b["ok"], true);

    r.probe->outcome.registers.clear();
    r.probe->outcome.bits = {1, 0, 1};
    r.probe->outcome.fc = 1;
    r.probe->outcome.count = 3;
    b = bodyJson(r.test("kysu1", withRead("C1", 3)));
    EXPECT_EQ(b["read"]["bits"], json::array({true, false, true}));
}

TEST(DriversApi, TheAddressBaseIsTakenOffTheAddress) {
    Rig r;
    json b = withRead("HR101", 2);
    b["device"]["addressBase"] = 1;
    ASSERT_EQ(r.test("kysu1", b).status, 200);
    EXPECT_TRUE(r.probe->last.read);
    EXPECT_EQ(r.probe->last.area, modbus::Area::HR);
    EXPECT_EQ(r.probe->last.offset, 100);
    EXPECT_EQ(r.probe->last.count, 2);
    b = withRead("30013", 1);  // the Modicon form: area 3 = input registers
    ASSERT_EQ(r.test("kysu1", b).status, 200);
    EXPECT_EQ(r.probe->last.area, modbus::Area::IR);
    EXPECT_EQ(r.probe->last.offset, 13) << "addressBase 0: the number is the offset";
    b["device"]["addressBase"] = 1;
    ASSERT_EQ(r.test("kysu1", b).status, 200);
    EXPECT_EQ(r.probe->last.offset, 12);
}

TEST(DriversApi, TheProbeGetsTheHostPortUnitAndTimes) {
    Rig r;
    json b = goodBody();
    b["device"]["unitId"] = 17;
    b["device"]["timeoutMs"] = 700;
    b["channel"]["tcp"]["connectTimeoutMs"] = 1500;
    b["channel"]["tcp"]["port"] = 1502;
    ASSERT_EQ(r.test("kysu1", b).status, 200);
    EXPECT_EQ(r.probe->last.host, "192.168.10.5");
    EXPECT_EQ(r.probe->last.port, 1502);
    EXPECT_EQ(r.probe->last.unit, 17);
    EXPECT_EQ(r.probe->last.timeoutMs, 700);
    EXPECT_EQ(r.probe->last.connectTimeoutMs, 1500);
    EXPECT_FALSE(r.probe->last.read);
    // the defaults
    json minimal = {{"channel", {{"kind", "modbus-tcp"}, {"tcp", {{"host", "plc.local"}}}}}};
    ASSERT_EQ(r.test("kysu1", minimal).status, 200);
    EXPECT_EQ(r.probe->last.port, 502);
    EXPECT_EQ(r.probe->last.unit, 1);
    EXPECT_EQ(r.probe->last.timeoutMs, 1000);
    EXPECT_EQ(r.probe->last.connectTimeoutMs, 3000);
}

TEST(DriversApi, EveryFailureCodeHasItsAnswer) {
    Rig r;
    struct Case {
        const char* code;
        const char* message;
    };
    for (const Case& c :
         {Case{"REFUSED", "PLC từ chối kết nối (có thể đã đủ số kết nối)"}, Case{"TIMEOUT", ""},
          Case{"UNREACHABLE", ""}, Case{"DNS", ""}, Case{"BAD_FRAME", ""}}) {
        r.probe->outcome = {};
        r.probe->outcome.code = c.code;
        const json b = bodyJson(r.test("kysu1", goodBody()));
        EXPECT_EQ(b["ok"], false) << c.code;
        EXPECT_EQ(b["code"], c.code);
        EXPECT_TRUE(b["message"].is_string() && !b["message"].get<std::string>().empty()) << c.code;
        if (*c.message) {
            EXPECT_EQ(b["message"], c.message);
        }
    }
    r.probe->outcome = {};
    r.probe->outcome.code = "EXCEPTION";
    r.probe->outcome.exception = 2;
    r.probe->outcome.connectMs = 3;
    r.probe->outcome.responseMs = 9;
    const json b = bodyJson(r.test("kysu1", withRead("HR1", 1)));
    EXPECT_EQ(b["ok"], false);
    EXPECT_EQ(b["code"], "EXCEPTION");
    EXPECT_EQ(b["exception"]["code"], "02");
    EXPECT_EQ(b["exception"]["meaning"], "địa chỉ không hợp lệ");
    EXPECT_EQ(b["connectMs"], 3);
    EXPECT_EQ(b["responseMs"], 9);
}

TEST(DriversApi, OneTestAtATimeTheSecondIs409TestBusy) {
    Rig r;
    r.probe->hold = true;
    const std::string a = r.bearer("kysu1");
    const std::string b = r.bearer("admin1");
    std::thread first([&] {
        EXPECT_EQ(r.call(postReq("/api/v1/drivers/test", goodBody().dump(), {a})).status, 200);
    });
    r.probe->waitEntered();
    const HttpResult second = r.call(postReq("/api/v1/drivers/test", goodBody().dump(), {b}));
    EXPECT_EQ(second.status, 409);
    EXPECT_EQ(bodyJson(second)["error"], "TEST_BUSY");
    r.probe->release();
    first.join();
    EXPECT_EQ(r.probe->calls, 1);
    EXPECT_EQ(r.call(postReq("/api/v1/drivers/test", goodBody().dump(), {a})).status, 200)
        << "free again";
}

TEST(DriversApi, AtMostTenAMinuteThen429WithRetryAfter) {
    Rig r;
    const std::string auth = r.bearer("kysu1");
    for (int i = 0; i < 10; ++i) {
        r.mono += 2000;
        ASSERT_EQ(r.call(postReq("/api/v1/drivers/test", goodBody().dump(), {auth})).status, 200)
            << i;
    }
    const HttpResult res = r.call(postReq("/api/v1/drivers/test", goodBody().dump(), {auth}));
    EXPECT_EQ(res.status, 429);
    EXPECT_EQ(bodyJson(res)["error"], "TEST_RATE_LIMITED");
    EXPECT_NE(res.headers.find("Retry-After: "), std::string::npos);
    EXPECT_EQ(r.probe->calls, 10);
    // all but the last call are more than a minute old
    r.mono += 59 * 1000;
    EXPECT_EQ(r.call(postReq("/api/v1/drivers/test", goodBody().dump(), {auth})).status, 200);
}

TEST(DriversApi, AuditDriverTestWithTargetAndCode) {
    Rig r;
    ASSERT_EQ(r.test("kysu1", goodBody()).status, 200);
    r.probe->outcome.code = "REFUSED";
    ASSERT_EQ(r.test("kysu1", goodBody()).status, 200);
    r.probe->outcome.code = "TIMEOUT";
    ASSERT_EQ(r.test("admin1", withRead("HR1", 1)).status, 200);
    const auto rows = r.records("driver.test");
    ASSERT_EQ(rows.size(), 3u);  // newest first
    EXPECT_EQ(rows[0].target.value_or(""), "192.168.10.5:502");
    EXPECT_EQ(rows[0].code.value_or(""), "TIMEOUT");
    EXPECT_EQ(rows[0].result, "failed");
    EXPECT_EQ(rows[0].user.value_or(""), "admin1");
    EXPECT_EQ(rows[0].channel, "https");
    EXPECT_EQ(rows[1].code.value_or(""), "REFUSED");
    EXPECT_EQ(rows[1].result, "failed");
    EXPECT_EQ(rows[2].code.value_or(""), "OK");
    EXPECT_EQ(rows[2].result, "ok");
    // nothing secret, nothing but the target and the code
    for (const auto& row : rows)
        EXPECT_EQ(row.role.value_or(""), row.user == "admin1" ? "administrator" : "engineer");
}

TEST(DriversApi, WithoutTheAuditLogThereIsNoTest) {
    Rig r;
    const std::string auth = r.bearer("kysu1");
    r.audit->close();
    const HttpResult res = r.call(postReq("/api/v1/drivers/test", goodBody().dump(), {auth}));
    EXPECT_EQ(res.status, 503);
    EXPECT_EQ(bodyJson(res)["error"], "AUDIT_UNAVAILABLE");
    EXPECT_EQ(r.probe->calls, 0);
}

TEST(DriversApi, TheHardCapIs35SecondsInAll) {
    Rig r;
    json b = goodBody();
    b["channel"]["tcp"]["connectTimeoutMs"] = 30000;
    b["device"]["timeoutMs"] = 10000;
    ASSERT_EQ(r.test("kysu1", b).status, 200);
    EXPECT_LE(r.probe->last.connectTimeoutMs + r.probe->last.timeoutMs + 2000, 35000);
    EXPECT_GE(r.probe->last.timeoutMs, 100);
    EXPECT_EQ(r.probe->last.connectTimeoutMs, 30000)
        << "the connect wait keeps what the user chose";
}

TEST(DriversApi, APostRestartsTheIdleTimeOfTheSession) {
    Rig r;
    const std::string auth = r.bearer("kysu1");
    r.mono += 10 * kMin;
    ASSERT_EQ(r.call(postReq("/api/v1/drivers/test", goodBody().dump(), {auth})).status, 200);
    const json s = bodyJson(r.call(getReq("/api/v1/auth/session", {auth})));
    EXPECT_EQ(s["idleRemainingS"], 1800);
}

TEST(DriversApi, RtuIsNotServedYetAndTheIdentityListsDrivers) {
    Rig r;
    json b = {{"channel", {{"kind", "modbus-rtu"}, {"serial", {{"port", "ttyAS2"}}}}},
              {"device", {{"slave", 1}}}};
    const HttpResult res = r.test("kysu1", b);
    EXPECT_EQ(res.status, 501);
    EXPECT_EQ(bodyJson(res)["error"], "NOT_IMPLEMENTED");
    const json f = bodyJson(r.call(getReq("/api/v1/device/identity")))["features"];
    EXPECT_NE(std::find(f.begin(), f.end(), json("drivers")), f.end());
    EXPECT_STREQ(kDeviceApiVersion, "1.5.0");  // 011: logic, diagnostics, acceptedHosts
}

TEST(DriversApi, WithoutABackendTheRouteAnswers501AfterTheGate) {
    ApiRig r;
    EXPECT_EQ(r.postAs("kysu1", "/api/v1/drivers/test", goodBody().dump()).status, 501);
    EXPECT_EQ(r.postAs("xem1", "/api/v1/drivers/test", goodBody().dump()).status, 403);
}

TEST(DriversApi, TheRoleTableHasTheRow) {
    const EndpointRule* rule = findEndpointRule("POST", "/api/v1/drivers/test");
    ASSERT_NE(rule, nullptr);
    EXPECT_TRUE(rule->needsSession);
    EXPECT_EQ(rule->minRole, Role::Engineer);
    EXPECT_TRUE(rule->refreshesSession);
    EXPECT_TRUE(rule->changesDevice);
}
