// S7 addresses on the shared vectors (tests/s7-vectors/address.json) with TypeScript
// (packages/tag-codec/src/s7-address.test.ts), feature 016.
#include <gtest/gtest.h>

#include <fstream>
#include <set>

#include "drivers/s7/address.hpp"
#include "nlohmann/json.hpp"

using nlohmann::json;
using namespace mat;

namespace {

json cases() {
    std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/s7-vectors/address.json",
                    std::ios::binary);
    return json::parse(f)["cases"];
}

}  // namespace

TEST(S7Address, SharedVectors) {
    const json all = cases();
    ASSERT_GE(all.size(), 80u);
    std::set<std::string> codes;
    for (const auto& c : all) {
        const std::string name = c["name"];
        s7::AddressOptions o;
        o.rawType = parseTagType(c["rawType"].get<std::string>()).value_or(TagType::INT16);
        o.stringLength = c.value("stringLength", 0);
        o.rw = c.value("access", "R") == "RW";
        const s7::Address r = s7::parseAddress(c["address"].get<std::string>(), o);
        const json& e = c["expect"];
        if (e.contains("error")) {
            codes.insert(e["error"].get<std::string>());
            EXPECT_FALSE(r.ok) << name;
            EXPECT_EQ(r.error, e["error"].get<std::string>()) << name;
            continue;
        }
        ASSERT_TRUE(r.ok) << name << " " << r.error;
        EXPECT_EQ(r.normalized, e["normalized"].get<std::string>()) << name;
        EXPECT_EQ(s7::areaName(r.area), e["area"].get<std::string>()) << name;
        EXPECT_EQ(r.db, e["db"].get<int>()) << name;
        EXPECT_EQ(r.byte, e["byte"].get<int>()) << name;
        EXPECT_EQ(r.bit, e["bit"].is_null() ? -1 : e["bit"].get<int>()) << name;
        EXPECT_EQ(s7::s7TypeName(r.type), e["s7Type"].get<std::string>()) << name;
        EXPECT_EQ(r.size, e["size"].get<int>()) << name;
    }
    EXPECT_EQ(codes, (std::set<std::string>{"E_ADDR_AREA", "E_ADDR_RANGE", "E_ADDR_SYNTAX"}));
}

TEST(S7Address, Sizes) {
    EXPECT_EQ(s7::typeSize(s7::S7Type::STRING, 10), 12);
    EXPECT_EQ(s7::writeSize(s7::S7Type::STRING, 12), 11);
    EXPECT_EQ(s7::writeSize(s7::S7Type::LREAL, 8), 8);
    EXPECT_EQ(s7::areaCode(s7::Area::DB), 0x84);
    EXPECT_EQ(s7::areaCode(s7::Area::M), 0x83);
}
