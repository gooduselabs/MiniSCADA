// Scaling on the shared vectors (tests/codec-vectors/scaling.json) with TypeScript.
#include "core/tag-engine/scaling.hpp"

#include <gtest/gtest.h>

#include <cmath>
#include <cstring>
#include <fstream>

#include "nlohmann/json.hpp"

using nlohmann::json;
using namespace mat;

namespace {

uint64_t bitsOf(double d) {
    uint64_t u;
    std::memcpy(&u, &d, sizeof u);
    return u;
}

Scaling scalingOf(const json& s) {
    Scaling sc;
    sc.rawMin = s["rawMin"].get<double>();
    sc.rawMax = s["rawMax"].get<double>();
    sc.engMin = s["engMin"].get<double>();
    sc.engMax = s["engMax"].get<double>();
    sc.clamp = s.contains("clamp") && s["clamp"].get<bool>();
    return sc;
}

double numberOf(const json& v) {
    if (v.is_string()) {
        const std::string s = v.get<std::string>();
        if (s == "NaN") return std::nan("");
        if (s == "Infinity") return INFINITY;
        if (s == "-Infinity") return -INFINITY;
        return std::strtod(s.c_str(), nullptr);
    }
    return v.get<double>();
}

}  // namespace

TEST(ScalingVectors, Read) {
    std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/codec-vectors/scaling.json",
                    std::ios::binary);
    const json j = json::parse(f);
    size_t n = 0;
    for (const auto& c : j["read"]) {
        SCOPED_TRACE(c["name"].get<std::string>());
        ++n;
        const ScaleReadResult r = scaleRead(numberOf(c["raw"]), scalingOf(c["scaling"]),
                                            *parseTagType(c["tagType"].get<std::string>()));
        EXPECT_STREQ(qualityName(r.quality), c["expect"]["quality"].get<std::string>().c_str());
        EXPECT_EQ(r.reason,
                  c["expect"].contains("reason") ? c["expect"]["reason"].get<std::string>() : "");
        EXPECT_EQ(bitsOf(r.value), bitsOf(c["expect"]["value"].get<double>()));
    }
    EXPECT_GE(n, 20u);
}

TEST(ScalingVectors, Write) {
    std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/codec-vectors/scaling.json",
                    std::ios::binary);
    const json j = json::parse(f);
    size_t n = 0;
    for (const auto& c : j["write"]) {
        SCOPED_TRACE(c["name"].get<std::string>());
        ++n;
        const TagType t = *parseTagType(c["rawType"].get<std::string>());
        const ScaleWriteResult r = scaleWrite(numberOf(c["eng"]), scalingOf(c["scaling"]), t);
        if (c["expect"].contains("error")) {
            EXPECT_FALSE(r.ok);
            EXPECT_EQ(r.error, c["expect"]["error"].get<std::string>());
            continue;
        }
        ASSERT_TRUE(r.ok) << r.error;
        const json& raw = c["expect"]["raw"];
        if (t == TagType::INT64)
            EXPECT_EQ(std::get<int64_t>(r.raw), std::stoll(raw.get<std::string>()));
        else if (t == TagType::UINT64)
            EXPECT_EQ(std::get<uint64_t>(r.raw), std::stoull(raw.get<std::string>()));
        else if (t == TagType::FLOAT32 || t == TagType::FLOAT64)
            EXPECT_EQ(bitsOf(std::get<double>(r.raw)), bitsOf(raw.get<double>()));
        else if (t == TagType::INT16 || t == TagType::INT32)
            EXPECT_EQ(std::get<int64_t>(r.raw), raw.get<int64_t>());
        else
            EXPECT_EQ(std::get<uint64_t>(r.raw), raw.get<uint64_t>());
    }
    EXPECT_GE(n, 20u);
}
