// Mitsubishi MC addresses on the shared vectors (tests/mc-vectors/address.json) with TypeScript
// (packages/tag-codec/src/mc-address.ts). Feature 017.
#include "drivers/mc/mc_address.hpp"

#include <gtest/gtest.h>

#include <fstream>
#include <set>

#include "nlohmann/json.hpp"

using nlohmann::json;
using namespace mat;
using namespace mat::mc;

namespace {

TagType typeOf(const std::string& s) {
    static const std::pair<const char*, TagType> kTypes[] = {
        {"BOOL", TagType::BOOL},     {"INT16", TagType::INT16},     {"UINT16", TagType::UINT16},
        {"INT32", TagType::INT32},   {"UINT32", TagType::UINT32},   {"INT64", TagType::INT64},
        {"UINT64", TagType::UINT64}, {"FLOAT32", TagType::FLOAT32}, {"FLOAT64", TagType::FLOAT64},
        {"STRING", TagType::STRING}};
    for (const auto& [n, t] : kTypes)
        if (s == n) return t;
    ADD_FAILURE() << "type " << s;
    return TagType::INT16;
}

}  // namespace

TEST(McAddress, Vectors) {
    std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/mc-vectors/address.json",
                    std::ios::binary);
    const json cases = json::parse(f)["cases"];
    ASSERT_GE(cases.size(), 50u);
    std::set<std::string> devices;
    for (const auto& c : cases) {
        SCOPED_TRACE(c["name"].get<std::string>());
        McAddressOptions o;
        o.rawType = typeOf(c["rawType"].get<std::string>());
        o.stringLength = c.value("stringLength", 0);
        o.rw = c.value("access", std::string("R")) == "RW";
        o.xyOctal = c.value("xyNotation", std::string("hex")) == "octal";
        const McAddress r = parseMcAddress(c["address"].get<std::string>(), o);
        const json& e = c["expect"];
        if (e.contains("error")) {
            EXPECT_FALSE(r.ok);
            EXPECT_EQ(r.error, e["error"].get<std::string>());
            continue;
        }
        ASSERT_TRUE(r.ok) << r.error;
        EXPECT_EQ(r.normalized, e["normalized"].get<std::string>());
        EXPECT_EQ(deviceName(r.device), e["device"].get<std::string>());
        EXPECT_EQ(r.code, e["code"].get<int>());
        EXPECT_EQ(r.bitDevice, e["bitDevice"].get<bool>());
        EXPECT_EQ(r.number, e["number"].get<uint32_t>());
        EXPECT_EQ(r.words, e["words"].get<int>());
        EXPECT_EQ(r.bit, e["bit"].is_null() ? -1 : e["bit"].get<int>());
        devices.insert(deviceName(r.device));
    }
    EXPECT_EQ(devices.size(), 13u);
}

TEST(McAddress, DeviceTable) {
    const McDeviceInfo* d = deviceByName("ZR");
    ASSERT_NE(d, nullptr);
    EXPECT_EQ(d->code, 0xB0);
    EXPECT_FALSE(d->bit);
    EXPECT_EQ(deviceByCode(0x9C)->device, Device::X);
    EXPECT_EQ(deviceByName("Q"), nullptr);
    EXPECT_EQ(deviceByCode(0x01), nullptr);
}
