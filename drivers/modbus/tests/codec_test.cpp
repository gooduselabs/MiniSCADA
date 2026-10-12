// Address, numbers, strings and bits on the shared vectors (tests/codec-vectors) with TypeScript.
#include "drivers/modbus/codec.hpp"

#include <gtest/gtest.h>

#include <cmath>
#include <cstring>
#include <fstream>
#include <set>

#include "drivers/modbus/address.hpp"
#include "nlohmann/json.hpp"

using nlohmann::json;
using namespace mat;
using namespace mat::modbus;

namespace {

json load(const char* file) {
    std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/codec-vectors/" + file, std::ios::binary);
    return json::parse(f);
}

std::vector<uint16_t> regsOf(const json& hex) {
    std::vector<uint16_t> r;
    for (const auto& h : hex)
        r.push_back(static_cast<uint16_t>(std::stoul(h.get<std::string>(), nullptr, 16)));
    return r;
}

std::vector<std::string> hexOf(const std::vector<uint16_t>& regs) {
    std::vector<std::string> out;
    for (uint16_t r : regs) {
        char b[8];
        std::snprintf(b, sizeof b, "%04X", r);
        out.push_back(b);
    }
    return out;
}

std::vector<std::string> toStrings(const json& a) {
    std::vector<std::string> v;
    for (const auto& x : a) v.push_back(x.get<std::string>());
    return v;
}

uint64_t bitsOf(double d) {
    uint64_t u;
    std::memcpy(&u, &d, sizeof u);
    return u;
}

}  // namespace

TEST(CodecAddress, Vectors) {
    const json cases = load("address.json")["cases"];
    EXPECT_GE(cases.size(), 100u);
    std::set<std::string> codes;
    for (const auto& c : cases) {
        SCOPED_TRACE(c["name"].get<std::string>());
        AddressOptions o;
        o.addressBase = c["addressBase"].get<int>();
        o.rawType = *parseTagType(c["rawType"].get<std::string>());
        if (c.contains("stringLength")) o.stringLength = c["stringLength"].get<int>();
        o.rw = c.contains("access") && c["access"].get<std::string>() == "RW";
        const AddressResult r = parseAddress(c["address"].get<std::string>(), o);
        const json& ex = c["expect"];
        if (ex.contains("error")) {
            EXPECT_FALSE(r.ok);
            EXPECT_EQ(r.error, ex["error"].get<std::string>());
            codes.insert(r.error);
            continue;
        }
        ASSERT_TRUE(r.ok) << r.error;
        EXPECT_EQ(r.normalized, ex["normalized"].get<std::string>());
        EXPECT_STREQ(areaName(r.area), ex["area"].get<std::string>().c_str());
        EXPECT_EQ(r.fcRead, ex["fcRead"].get<int>());
        EXPECT_EQ(r.fcWrite, ex["fcWrite"].get<std::vector<int>>());
        EXPECT_EQ(r.offset, ex["offset"].get<int>());
        EXPECT_EQ(r.registers, ex["registers"].get<int>());
        EXPECT_EQ(r.bit, ex["bit"].is_null() ? -1 : ex["bit"].get<int>());
        EXPECT_EQ(r.warnings,
                  ex.contains("warnings") ? toStrings(ex["warnings"]) : std::vector<std::string>{});
    }
    EXPECT_EQ(codes, (std::set<std::string>{"E_ADDR_AREA", "E_ADDR_RANGE", "E_ADDR_SYNTAX"}));
}

TEST(CodecNumeric, Vectors) {
    const json cases = load("numeric.json")["cases"];
    std::set<std::string> types, orders;
    for (const auto& c : cases) {
        SCOPED_TRACE(c["name"].get<std::string>());
        const TagType t = *parseTagType(c["type"].get<std::string>());
        const ByteOrder bo = *parseByteOrder(c["byteOrder"].get<std::string>());
        types.insert(c["type"].get<std::string>());
        orders.insert(c["byteOrder"].get<std::string>());
        const DecodeResult r = decodeNumber(t, bo, regsOf(c["registers"]));
        const json& ex = c["expect"];
        if (ex.contains("invalid")) {
            EXPECT_FALSE(r.ok);
            EXPECT_EQ(r.reason, ex["invalid"].get<std::string>());
            continue;
        }
        ASSERT_TRUE(r.ok);
        if (t == TagType::INT64) {
            EXPECT_EQ(std::get<int64_t>(r.value), std::stoll(ex["value"].get<std::string>()));
        } else if (t == TagType::UINT64) {
            EXPECT_EQ(std::get<uint64_t>(r.value), std::stoull(ex["value"].get<std::string>()));
        } else if (t == TagType::FLOAT32 || t == TagType::FLOAT64) {
            EXPECT_EQ(bitsOf(std::get<double>(r.value)), bitsOf(ex["value"].get<double>()));
        } else if (t == TagType::INT16 || t == TagType::INT32) {
            EXPECT_EQ(std::get<int64_t>(r.value), ex["value"].get<int64_t>());
        } else {
            EXPECT_EQ(std::get<uint64_t>(r.value), ex["value"].get<uint64_t>());
        }
        if (c["encode"].get<bool>()) {
            EXPECT_EQ(hexOf(encodeNumber(t, bo, r.value)), toStrings(c["registers"]));
        }
    }
    EXPECT_EQ(types.size(), 8u);
    EXPECT_EQ(orders.size(), 4u);
}

TEST(CodecString, Vectors) {
    const json strings = load("string.json");
    for (const auto& c : strings["cases"]) {
        SCOPED_TRACE(c["kind"].get<std::string>() + " " + c["name"].get<std::string>());
        const StringByteOrder bo = *parseStringByteOrder(c["byteOrder"].get<std::string>());
        const int len = c["length"].get<int>();
        if (c["kind"] == "decode") {
            EXPECT_EQ(decodeString(len, bo, regsOf(c["registers"])),
                      c["expect"]["text"].get<std::string>());
            continue;
        }
        const EncodeStringResult r = encodeString(len, bo, c["text"].get<std::string>());
        if (c["expect"].contains("error")) {
            EXPECT_FALSE(r.ok);
            EXPECT_EQ(r.error, c["expect"]["error"].get<std::string>());
        } else {
            ASSERT_TRUE(r.ok);
            EXPECT_EQ(hexOf(r.registers), toStrings(c["expect"]["registers"]));
        }
    }
}

TEST(CodecBits, Vectors) {
    const json j = load("bits.json");
    auto bytesOf = [](const json& hex) {
        std::vector<uint8_t> b;
        for (const auto& h : hex)
            b.push_back(static_cast<uint8_t>(std::stoul(h.get<std::string>(), nullptr, 16)));
        return b;
    };
    for (const auto& c : j["unpack"]) {
        SCOPED_TRACE("unpack " + c["name"].get<std::string>());
        std::vector<uint8_t> want;
        for (const auto& b : c["expect"]["bits"]) want.push_back(b.get<uint8_t>());
        EXPECT_EQ(unpackBits(bytesOf(c["bytes"]), c["count"].get<size_t>()), want);
    }
    for (const auto& c : j["pack"]) {
        SCOPED_TRACE("pack " + c["name"].get<std::string>());
        std::vector<uint8_t> bits;
        for (const auto& b : c["bits"]) bits.push_back(b.get<uint8_t>());
        EXPECT_EQ(packBits(bits), bytesOf(c["expect"]["bytes"]));
    }
    for (const auto& c : j["register"]) {
        SCOPED_TRACE("register " + c["name"].get<std::string>());
        EXPECT_EQ(
            registerBit(static_cast<uint16_t>(std::stoul(c["reg"].get<std::string>(), nullptr, 16)),
                        c["bit"].get<int>()),
            c["expect"]["value"].get<bool>());
    }
    for (const auto& c : j["mask"]) {
        SCOPED_TRACE("mask " + c["name"].get<std::string>());
        const MaskWrite m = maskWrite(c["bit"].get<int>(), c["value"].get<bool>());
        EXPECT_EQ(hexOf({m.andMask, m.orMask}),
                  (std::vector<std::string>{c["expect"]["and"].get<std::string>(),
                                            c["expect"]["or"].get<std::string>()}));
    }
    for (const auto& c : j["rmw"]) {
        SCOPED_TRACE("rmw " + c["name"].get<std::string>());
        const uint16_t reg =
            static_cast<uint16_t>(std::stoul(c["reg"].get<std::string>(), nullptr, 16));
        EXPECT_EQ(hexOf({applyBit(reg, c["bit"].get<int>(), c["value"].get<bool>())}),
                  (std::vector<std::string>{c["expect"]["reg"].get<std::string>()}));
    }
}
