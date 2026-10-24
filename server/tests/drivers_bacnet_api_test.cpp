// The BACnet part of the drivers API (feature 020): the body of a connection test of kind bacnet
// (read, whois, objects), its answer, and the keys of the BACnet exception counters.
#include <gtest/gtest.h>

#include "server/http/drivers_api.hpp"

using nlohmann::json;
using namespace mat;

namespace {

bool parse(const json& body, ProbeSpec& spec, std::vector<ProbeIssue>& issues) {
    return parseProbeRequest(body, spec, issues);
}

const json kDevice = {{"deviceInstance", 1001}, {"host", "10.0.0.50"}};

}  // namespace

TEST(DriversBacnetApi, ReadOfTheDeviceNameByDefault) {
    ProbeSpec spec;
    std::vector<ProbeIssue> issues;
    ASSERT_TRUE(parse({{"channel", {{"kind", "bacnet"}}}, {"device", kDevice}}, spec, issues));
    EXPECT_TRUE(spec.bacnet);
    EXPECT_EQ(spec.bacnetReq.action, drv::BacnetProbeRequest::Action::Read);
    EXPECT_EQ(spec.bacnetReq.host, "10.0.0.50");
    EXPECT_EQ(spec.bacnetReq.port, 47808);
    EXPECT_EQ(spec.bacnetReq.localPort, 0);
    EXPECT_FALSE(spec.bacnetReq.hasAddress);
    EXPECT_EQ(spec.target, "10.0.0.50:47808");
}

TEST(DriversBacnetApi, ReadOfAnAddressBehindARouter) {
    ProbeSpec spec;
    std::vector<ProbeIssue> issues;
    json dev = kDevice;
    dev["network"] = 5;
    dev["mac"] = "0A1b";
    ASSERT_TRUE(parse({{"channel", {{"kind", "bacnet"}}},
                       {"device", dev},
                       {"action", "read"},
                       {"read", {{"address", "bo:2@8"}}}},
                      spec, issues));
    EXPECT_TRUE(spec.bacnetReq.hasAddress);
    EXPECT_EQ(spec.bacnetReq.addr.normalized, "BO:2@8");
    EXPECT_EQ(spec.bacnetReq.network, 5);
    EXPECT_EQ(spec.bacnetReq.mac, (bacnet::Bytes{0x0a, 0x1b}));
}

TEST(DriversBacnetApi, WhoIsListensOnTheChannelPort) {
    ProbeSpec spec;
    std::vector<ProbeIssue> issues;
    ASSERT_TRUE(parse(
        {{"channel",
          {{"kind", "bacnet"}, {"bacnet", {{"localPort", 47809}, {"broadcast", "192.168.1.255"}}}}},
         {"action", "whois"},
         {"whois", {{"low", 1000}, {"high", 2000}, {"waitMs", 1500}}}},
        spec, issues));
    EXPECT_EQ(spec.bacnetReq.action, drv::BacnetProbeRequest::Action::WhoIs);
    EXPECT_EQ(spec.bacnetReq.localPort, 47809);
    EXPECT_EQ(spec.bacnetReq.broadcastPort, 47809);
    EXPECT_EQ(spec.bacnetReq.low, 1000);
    EXPECT_EQ(spec.bacnetReq.waitMs, 1500);
    EXPECT_EQ(spec.target, "192.168.1.255");
}

TEST(DriversBacnetApi, WrongFieldsAreNamed) {
    ProbeSpec spec;
    std::vector<ProbeIssue> issues;
    json dev = {{"host", "a b"}, {"deviceInstance", 4194303}, {"mac", "xyz"}};
    EXPECT_FALSE(parse(
        {{"channel", {{"kind", "bacnet"}}}, {"device", dev}, {"read", {{"address", "AI:1@8"}}}},
        spec, issues));
    std::vector<std::string> paths;
    for (const auto& i : issues) paths.push_back(i.path + "=" + i.code);
    EXPECT_EQ(paths, (std::vector<std::string>{
                         "device.host=E_FIELD_VALUE", "device.deviceInstance=E_FIELD_VALUE",
                         "device.mac=E_FIELD_VALUE", "read.address=E_ADDR_AREA"}));
    issues.clear();
    EXPECT_FALSE(
        parse({{"channel", {{"kind", "bacnet"}}}, {"action", "whois"}, {"whois", {{"low", 5}}}},
              spec, issues));
    ASSERT_EQ(issues.size(), 1u);
    EXPECT_EQ(issues[0].path, "whois");
    issues.clear();
    EXPECT_FALSE(parse({{"channel", {{"kind", "bacnet"}}}, {"action", "scan"}, {"device", kDevice}},
                       spec, issues));
    EXPECT_EQ(issues[0].path, "action");
}

TEST(DriversBacnetApi, Answers) {
    drv::BacnetProbeRequest req;
    drv::BacnetProbeOutcome o;
    o.base.code = "OK";
    o.base.responseFrame = {1};
    o.base.responseMs = 12;
    o.valueText = "AHU-1";
    o.valueKind = "string";
    req.deviceInstance = 1001;
    json j = bacnetProbeAnswerJson(o, req);
    EXPECT_EQ(j["read"]["address"], "DEV:1001:object-name");
    EXPECT_EQ(j["read"]["value"], "AHU-1");
    EXPECT_EQ(j["responseMs"], 12);

    req.action = drv::BacnetProbeRequest::Action::Objects;
    o.objects = {{0, 1}, {200, 4}};
    o.objectNames = {"Temp", ""};
    j = bacnetProbeAnswerJson(o, req);
    ASSERT_EQ(j["objects"].size(), 2u);
    EXPECT_EQ(j["objects"][0]["address"], "AI:1");
    EXPECT_EQ(j["objects"][0]["name"], "Temp");
    EXPECT_FALSE(j["objects"][1].contains("address"));

    req.action = drv::BacnetProbeRequest::Action::Read;
    o.base.code = "BACNET_ERROR";
    o.errorClass = 1;
    o.errorCode = 31;
    j = bacnetProbeAnswerJson(o, req);
    EXPECT_FALSE(j["ok"]);
    EXPECT_EQ(j["error"]["reason"], "BACNET_UNKNOWN_OBJECT");
    EXPECT_TRUE(j.contains("message"));
}

TEST(DriversBacnetApi, ExceptionKeys) {
    EXPECT_EQ(bacnetExceptionKey(31), "error:31");
    EXPECT_EQ(bacnetExceptionKey(1009), "reject:9");
    EXPECT_EQ(bacnetExceptionKey(2004), "abort:4");
}
