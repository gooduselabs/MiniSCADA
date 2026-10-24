// Feature 018: the Omron FINS side of POST /api/v1/drivers/test (the request of kind fins, its
// checks and the answer) and of GET /api/v1/drivers/diagnostics (kind fins, the end codes by their
// four hex digits), as pure functions of drivers_api.
#include <gtest/gtest.h>

#include "core/tag-engine/fins_factory.hpp"
#include "drivers/fins/tests/fake_fins_plc.hpp"
#include "server/http/drivers_api.hpp"

using nlohmann::json;
using namespace mat;

namespace {

bool parse(const json& body, ProbeSpec& spec, std::vector<ProbeIssue>& issues) {
    return parseProbeRequest(body, spec, issues);
}

struct NullSink : drv::EngineSink {
    void publish(std::vector<drv::TagUpdate>&&) override {}
    void writeDone(drv::WriteResult&&) override {}
};

std::string codes(const std::vector<ProbeIssue>& issues) {
    std::string s;
    for (const auto& i : issues) s += i.code + "@" + i.path + " ";
    return s;
}

}  // namespace

TEST(DriversFinsApi, AFinsRequestIsReadWithItsDefaults) {
    ProbeSpec spec;
    std::vector<ProbeIssue> issues;
    ASSERT_TRUE(parse(json::parse(R"({"channel":{"kind":"fins","fins":{"host":"192.168.250.1"}}})"),
                      spec, issues))
        << codes(issues);
    EXPECT_TRUE(spec.fins);
    EXPECT_EQ(spec.finsReq.host, "192.168.250.1");
    EXPECT_EQ(spec.finsReq.port, 9600);
    EXPECT_FALSE(spec.finsReq.tcp);
    EXPECT_FALSE(spec.finsReq.read);
    EXPECT_EQ(spec.target, "192.168.250.1:9600");

    ASSERT_TRUE(parse(json::parse(R"({"channel":{"kind":"fins","fins":{"host":"plc","port":9601,
        "transport":"tcp","sourceNetwork":1,"sourceNode":5,"localPort":9600,"connectTimeoutMs":800}},
        "device":{"network":2,"node":20,"unit":16,"timeoutMs":300},
        "read":{"address":"d100","count":2}})"),
                      spec, issues))
        << codes(issues);
    EXPECT_TRUE(spec.finsReq.tcp);
    EXPECT_EQ(spec.finsReq.src.network, 1);
    EXPECT_EQ(spec.finsReq.src.node, 5);
    EXPECT_EQ(spec.finsReq.localPort, 9600);
    EXPECT_EQ(spec.finsReq.dst.network, 2);
    EXPECT_EQ(spec.finsReq.dst.node, 20);
    EXPECT_EQ(spec.finsReq.dst.unit, 16);
    EXPECT_EQ(spec.finsReq.timeoutMs, 300);
    ASSERT_TRUE(spec.finsReq.read);
    EXPECT_EQ(spec.finsReq.addr.normalized, "D100");
    EXPECT_EQ(spec.finsReq.count, 2);

    // a bit or a flag is read as such
    ASSERT_TRUE(parse(json::parse(R"({"channel":{"kind":"fins","fins":{"host":"h"}},
        "read":{"address":"T5"}})"),
                      spec, issues));
    EXPECT_TRUE(spec.finsReq.addr.flag == false);  // a timer read as its present value first
    ASSERT_TRUE(parse(json::parse(R"({"channel":{"kind":"fins","fins":{"host":"h"}},
        "read":{"address":"CIO10.03"}})"),
                      spec, issues));
    EXPECT_EQ(spec.finsReq.addr.bit, 3);
}

TEST(DriversFinsApi, AWrongFinsRequestNamesEveryField) {
    ProbeSpec spec;
    std::vector<ProbeIssue> issues;
    EXPECT_FALSE(parse(json::parse(R"({"channel":{"kind":"fins","fins":{"transport":"serial",
        "sourceNode":255}},"device":{"node":-1,"unit":256}})"),
                       spec, issues));
    const std::string c = codes(issues);
    EXPECT_NE(c.find("E_FIELD_MISSING@channel.fins.host"), std::string::npos) << c;
    EXPECT_NE(c.find("E_FIELD_VALUE@channel.fins.transport"), std::string::npos) << c;
    EXPECT_NE(c.find("E_FIELD_VALUE@channel.fins.sourceNode"), std::string::npos) << c;
    EXPECT_NE(c.find("E_FIELD_VALUE@device.node"), std::string::npos) << c;
    EXPECT_NE(c.find("E_FIELD_VALUE@device.unit"), std::string::npos) << c;

    EXPECT_FALSE(parse(json::parse(R"({"channel":{"kind":"fins","fins":{"host":"h"}},
        "read":{"address":"HR100"}})"),
                       spec, issues));
    EXPECT_EQ(issues.at(0).code, "E_ADDR_SYNTAX");
    EXPECT_FALSE(parse(json::parse(R"({"channel":{"kind":"fins","fins":{"host":"h"}},
        "read":{"address":"D100","count":5}})"),
                       spec, issues));
    EXPECT_EQ(issues.at(0).code, "E_PROBE_COUNT");
    EXPECT_FALSE(parse(json::parse(R"({"channel":{"kind":"fins","fins":{"host":"h"}},
        "read":{"address":"D32767","count":2}})"),
                       spec, issues));
    EXPECT_EQ(issues.at(0).code, "E_ADDR_RANGE");
    EXPECT_FALSE(parse(json::parse(R"({"channel":{"kind":"s7"}})"), spec, issues));
    EXPECT_EQ(issues.at(0).path, "channel.kind");
}

TEST(DriversFinsApi, TheAnswerCarriesTheModelTheWordsAndTheEndCode) {
    drv::FinsProbeRequest req;
    drv::FinsProbeOutcome o;
    o.base.code = "OK";
    o.base.connectMs = 3;
    o.model = "CJ2M-CPU31";
    o.clientNode = 33;
    o.serverNode = 10;
    json j = finsProbeAnswerJson(o, req);
    EXPECT_EQ(j["ok"], true);
    EXPECT_EQ(j["model"], "CJ2M-CPU31");
    EXPECT_EQ(j["nodes"]["client"], 33);
    EXPECT_FALSE(j.contains("read"));

    fins::AddressOptions ao;
    req.read = true;
    req.addr = fins::parseAddress("D100", ao);
    req.count = 2;
    o = {};
    o.base.code = "OK";
    o.base.registers = {0xE979, 0x42F6};
    o.base.responseFrame = {1};
    o.base.responseMs = 4;
    j = finsProbeAnswerJson(o, req);
    EXPECT_EQ(j["read"]["address"], "D100");
    EXPECT_EQ(j["read"]["words"], json::array({"E979", "42F6"}));
    EXPECT_EQ(j["responseMs"], 4);

    o = {};
    o.base.code = "END_CODE";
    o.endCode = 0x1103;
    j = finsProbeAnswerJson(o, req);
    EXPECT_EQ(j["ok"], false);
    EXPECT_EQ(j["endCode"]["code"], "1103");
    EXPECT_EQ(j["endCode"]["reason"], "FINS_ADDRESS");
    EXPECT_FALSE(j["message"].get<std::string>().empty());
}

TEST(DriversFinsApi, DiagnosticsNameTheKindAndCountEndCodesByFourDigits) {
    LoadedProject p;
    p.project = {{"schemaVersion", "1.1.0"}, {"tagFile", "tags.json"}, {"screens", json::array()}};
    p.tags = json::parse(R"({"schemaVersion":"1.1.0","tags":[
      {"id":"A","kind":"external","type":"UINT16","source":{"device":"cj2","address":"D0"}},
      {"id":"B","kind":"external","type":"UINT16","source":{"device":"cj2","address":"D9000"}}]})");
    p.connections = json::parse(R"({"schemaVersion":"1.1.0","channels":[
      {"id":"omron1","name":"Omron","kind":"fins","fins":{"host":"10.0.0.20","sourceNode":5},
       "devices":[{"id":"cj2","name":"CJ2M","node":10,"multiRead":false}]}]})");
    std::string err;
    const auto model = buildProjectModel(p, &err);
    ASSERT_TRUE(model) << err;

    mat::testing::FinsClock clock;
    mat::testing::FakeFinsPlc plc;
    plc.limit[0x82] = 5000;
    drv::FinsEnv env;
    env.manual = true;
    env.clock = &clock;
    env.uniform = [] { return 0.0; };
    env.sleep = [&clock](int64_t t) { clock.set(t); };
    env.makeTransport = [&] {
        return std::unique_ptr<drv::Transport>(
            new mat::testing::FakeFinsTransport(plc, clock, false));
    };
    drv::FinsDriver driver(finsConfigOf(*model, 0), env);
    NullSink sink;
    driver.start(sink);
    driver.pump(clock.monoMs() + 3000);

    DriversDiagInput in;
    in.model = &*model;
    in.channels = {&driver};
    const json j = driversDiagnosticsJson(in);
    const json& ch = j["channels"][0];
    EXPECT_EQ(ch["kind"], "fins");
    EXPECT_EQ(ch["state"], "connected");
    EXPECT_GE(ch["devices"][0]["exceptions"]["1103"].get<int>(), 1) << ch.dump();
    driver.stop();
}
