// MQTT payloads <-> Tag values (feature 022, spec "Giá trị").
#include <gtest/gtest.h>

#include "drivers/mqtt/payload.hpp"

using namespace mat;
using namespace mat::mqtt;

namespace {
std::vector<PathStep> steps(const std::string& addr) { return parseAddress(addr).steps; }
template <typename T>
T as(const Decoded& d) {
    EXPECT_TRUE(d.ok);
    return std::get<T>(d.value);
}
}  // namespace

TEST(MqttPayload, RawText) {
    EXPECT_EQ(as<double>(decodeText(" 21.5\n", TagType::FLOAT64)), 21.5);
    EXPECT_EQ(as<int64_t>(decodeText("-32768", TagType::INT16)), -32768);
    EXPECT_FALSE(decodeText("32768", TagType::INT16).ok);
    EXPECT_EQ(as<int64_t>(decodeText("12.0", TagType::INT32)), 12);
    EXPECT_FALSE(decodeText("12.5", TagType::INT32).ok);
    EXPECT_EQ(as<uint64_t>(decodeText("65535", TagType::UINT16)), 65535u);
    EXPECT_FALSE(decodeText("-1", TagType::UINT16).ok);
    EXPECT_EQ(as<uint64_t>(decodeText("18446744073709551615", TagType::UINT64)),
              18446744073709551615ull);
    EXPECT_EQ(as<int64_t>(decodeText("-9223372036854775808", TagType::INT64)), INT64_MIN);
    EXPECT_TRUE(as<bool>(decodeText("ON", TagType::BOOL)));
    EXPECT_FALSE(as<bool>(decodeText("false", TagType::BOOL)));
    EXPECT_TRUE(as<bool>(decodeText("1", TagType::BOOL)));
    EXPECT_FALSE(decodeText("2", TagType::BOOL).ok);
    EXPECT_FALSE(decodeText("abc", TagType::FLOAT32).ok);
    EXPECT_FALSE(decodeText("1e39", TagType::FLOAT32).ok);
    EXPECT_FALSE(decodeText("nan", TagType::FLOAT64).ok);
    EXPECT_FALSE(decodeText("", TagType::FLOAT64).ok);
    EXPECT_EQ(as<std::string>(decodeText(" chạy ", TagType::STRING)), " chạy ");
    // cut on a UTF-8 boundary: "ạ" is 3 bytes
    EXPECT_EQ(as<std::string>(decodeText("chạy", TagType::STRING, 3)), "ch");
}

TEST(MqttPayload, JsonPath) {
    const std::string doc = R"({"data":{"temp":21.5,"on":true,"n":"42","arr":[1,2,{"v":7}]}})";
    EXPECT_EQ(as<double>(decodePayload(doc, true, steps("t|$.data.temp"), TagType::FLOAT32)), 21.5);
    EXPECT_TRUE(as<bool>(decodePayload(doc, true, steps("t|$.data.on"), TagType::BOOL)));
    EXPECT_EQ(as<int64_t>(decodePayload(doc, true, steps("t|$.data.on"), TagType::INT16)), 1);
    EXPECT_EQ(as<int64_t>(decodePayload(doc, true, steps("t|$.data.n"), TagType::INT32)), 42);
    EXPECT_EQ(as<int64_t>(decodePayload(doc, true, steps("t|$.data.arr[2].v"), TagType::INT32)), 7);
    EXPECT_EQ(as<std::string>(decodePayload(doc, true, steps("t|$.data.temp"), TagType::STRING)),
              "21.5");
    EXPECT_FALSE(decodePayload(doc, true, steps("t|$.data.missing"), TagType::FLOAT64).ok);
    EXPECT_FALSE(decodePayload(doc, true, steps("t|$.data"), TagType::FLOAT64).ok);  // object
    EXPECT_FALSE(decodePayload(doc, true, steps("t|$.data.arr[5]"), TagType::FLOAT64).ok);
    EXPECT_FALSE(decodePayload(doc, true, steps("t|$.data[0]"), TagType::FLOAT64).ok);
    EXPECT_FALSE(decodePayload("{bad", true, steps("t|$.x"), TagType::FLOAT64).ok);
    EXPECT_FALSE(decodePayload(R"({"x":null})", true, steps("t|$.x"), TagType::FLOAT64).ok);
    EXPECT_EQ(as<double>(decodePayload("3.25", true, steps("t|$"), TagType::FLOAT64)), 3.25);
    EXPECT_FALSE(decodePayload(R"({"x":2})", true, steps("t|$.x"), TagType::BOOL).ok);
    EXPECT_FALSE(decodePayload(std::string(kMaxPayload + 1, ' '), false, {}, TagType::STRING).ok);
}

TEST(MqttPayload, Encode) {
    EXPECT_EQ(encodePayload(TagScalar{21.5}, TagType::FLOAT64, false, {}), "21.5");
    EXPECT_EQ(encodePayload(TagScalar{int64_t{-7}}, TagType::INT16, false, {}), "-7");
    EXPECT_EQ(encodePayload(TagScalar{true}, TagType::BOOL, false, {}), "1");
    EXPECT_EQ(encodePayload(TagScalar{std::string("chạy")}, TagType::STRING, false, {}), "chạy");
    EXPECT_EQ(encodePayload(TagScalar{21.5}, TagType::FLOAT64, true, steps("t|$.data.sp")),
              R"({"data":{"sp":21.5}})");
    EXPECT_EQ(encodePayload(TagScalar{false}, TagType::BOOL, true, steps("t|$.on")),
              R"({"on":false})");
    EXPECT_EQ(encodePayload(TagScalar{uint64_t{3}}, TagType::UINT16, true, steps("t|$.a[1]")),
              R"({"a":[null,3]})");
    EXPECT_EQ(encodePayload(TagScalar{int64_t{5}}, TagType::INT32, true, steps("t|$")), "5");
}

TEST(MqttPayload, RoundTrip) {
    const auto st = steps("t|$.v.w");
    for (double v : {0.0, -1.5, 1e-7, 123456.789, 3.4e38}) {
        const std::string p = encodePayload(TagScalar{v}, TagType::FLOAT64, true, st);
        EXPECT_EQ(as<double>(decodePayload(p, true, st, TagType::FLOAT64)), v) << p;
        const std::string q = encodePayload(TagScalar{v}, TagType::FLOAT64, false, {});
        EXPECT_EQ(as<double>(decodePayload(q, false, {}, TagType::FLOAT64)), v) << q;
    }
}

TEST(MqttPayload, Group) {
    std::vector<GroupEntry> e(3);
    e[0].id = "Tank.Level";
    e[0].value.value = 12.5;
    e[0].value.quality = Quality::GOOD;
    e[1].id = "Pump.Run";
    e[1].value.value = true;
    e[1].value.quality = Quality::UNCERTAIN;
    e[2].id = "Old";
    e[2].value.quality = Quality::BAD;
    EXPECT_EQ(encodeGroup(1730000000000, e),
              R"({"quality":{"Old":"BAD","Pump.Run":"UNCERTAIN","Tank.Level":"GOOD"},)"
              R"("ts":1730000000000,"values":{"Old":null,"Pump.Run":true,"Tank.Level":12.5}})");
    // feature 025: the time each value was read, null for a value never read
    e[0].value.sourceTs = 1729999999500;
    e[1].value.sourceTs = 1729999999000;
    EXPECT_EQ(encodeGroup(1730000000000, e, true),
              R"({"quality":{"Old":"BAD","Pump.Run":"UNCERTAIN","Tank.Level":"GOOD"},)"
              R"("sourceTs":{"Old":null,"Pump.Run":1729999999000,"Tank.Level":1729999999500},)"
              R"("ts":1730000000000,"values":{"Old":null,"Pump.Run":true,"Tank.Level":12.5}})");
}
