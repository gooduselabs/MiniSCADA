// Generators on the shared vectors (tests/sim-vectors, except legacy.json), bit for bit with
// TypeScript; U(seed, k) with k >= 2^32; sinTurns; the defaults of contract §2.3.
#include "drivers/simulation/sim_generators.hpp"

#include <gtest/gtest.h>

#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <set>

using nlohmann::json;
using namespace mat;
using namespace mat::sim;

namespace {

const std::string kDir = std::string(MAT_SOURCE_DIR) + "/tests/sim-vectors";

json load(const std::string& file) {
    std::ifstream f(kDir + "/" + file, std::ios::binary);
    return json::parse(f);
}

uint64_t bitsOf(double d) {
    uint64_t u;
    std::memcpy(&u, &d, sizeof u);
    return u;
}

SimScalar scalarOf(const json& j) {
    if (j.is_boolean()) return j.get<bool>();
    if (j.is_number()) return j.get<double>();
    if (j.is_string()) return j.get<std::string>();
    return SimScalar{};
}

void expectValue(const TagScalar& got, TagType type, const json& want, const std::string& ctx) {
    SCOPED_TRACE(ctx);
    if (type == TagType::INT64) {
        ASSERT_TRUE(std::holds_alternative<int64_t>(got));
        EXPECT_EQ(std::get<int64_t>(got), std::stoll(want.get<std::string>()));
    } else if (type == TagType::UINT64) {
        ASSERT_TRUE(std::holds_alternative<uint64_t>(got));
        EXPECT_EQ(std::get<uint64_t>(got), std::stoull(want.get<std::string>()));
    } else if (type == TagType::INT16 || type == TagType::INT32) {
        ASSERT_TRUE(std::holds_alternative<int64_t>(got));
        EXPECT_EQ(std::get<int64_t>(got), want.get<int64_t>());
    } else if (type == TagType::UINT16 || type == TagType::UINT32) {
        ASSERT_TRUE(std::holds_alternative<uint64_t>(got));
        EXPECT_EQ(std::get<uint64_t>(got), want.get<uint64_t>());
    } else if (type == TagType::FLOAT32 || type == TagType::FLOAT64) {
        ASSERT_TRUE(std::holds_alternative<double>(got));
        EXPECT_EQ(bitsOf(std::get<double>(got)), bitsOf(want.get<double>()));
    } else if (type == TagType::BOOL) {
        ASSERT_TRUE(std::holds_alternative<bool>(got));
        EXPECT_EQ(std::get<bool>(got), want.get<bool>());
    } else {
        ASSERT_TRUE(std::holds_alternative<std::string>(got));
        EXPECT_EQ(std::get<std::string>(got), want.get<std::string>());
    }
}

}  // namespace

TEST(SimVectors, GeneratorSuites) {
    size_t cases = 0;
    std::set<std::string> files;
    for (const auto& de : std::filesystem::directory_iterator(kDir)) {
        const std::string f = de.path().filename().string();
        if (f.size() < 6 || f.substr(f.size() - 5) != ".json") continue;
        if (f == "legacy.json" || f == "sin-turns.json" || f == "hash.json") continue;
        files.insert(f);
        const json doc = load(f);
        for (const auto& s : doc["suites"]) {
            const auto cfg = simFromJson(s["sim"]);
            ASSERT_TRUE(cfg.has_value()) << f << " " << s["name"];
            const TagType type = *parseTagType(s["type"].get<std::string>());
            for (const auto& c : s["cases"]) {
                ++cases;
                SimScalar last;
                const SimScalar* lastPtr = nullptr;
                if (c.contains("writes") && !c["writes"].empty()) {
                    last = scalarOf(c["writes"].back());
                    lastPtr = &last;
                }
                const int64_t t = c["t"].get<int64_t>();
                expectValue(simValue(*cfg, t, type, lastPtr), type, c["value"],
                            f + " " + s["name"].get<std::string>() + " t=" + std::to_string(t));
            }
        }
    }
    EXPECT_EQ(files, (std::set<std::string>{"const.json", "manual.json", "ramp.json", "random.json",
                                            "sine.json", "square.json"}));
    EXPECT_GE(cases, 800u);  // 880 at the time of writing
}

TEST(SimVectors, HashAndSinTurns) {
    size_t n = 0;
    const json hash = load("hash.json");
    for (const auto& c : hash["cases"]) {
        ++n;
        EXPECT_EQ(bitsOf(hashU(c["seed"].get<uint32_t>(), c["k"].get<uint64_t>())),
                  bitsOf(c["u"].get<double>()))
            << "seed " << c["seed"] << " k " << c["k"];
    }
    const json sin = load("sin-turns.json");
    for (const auto& c : sin["cases"]) {
        ++n;
        EXPECT_EQ(bitsOf(sinTurns(c["f"].get<double>())), bitsOf(c["value"].get<double>()))
            << "f " << c["f"];
    }
    EXPECT_GE(n, 100u);
}

TEST(SimDefaults, ContractValues) {
    SimConfig sine;
    sine.kind = SimKind::Sine;
    sine.center = 50;
    sine.amplitude = 25;
    sine.periodMs = 20000;
    sine.phase = 0.25;
    EXPECT_EQ(std::get<double>(simValue(sine, 0, TagType::FLOAT32)), 75.0);
    EXPECT_EQ(std::get<double>(simValue(sine, 1791601205123, TagType::FLOAT32)), 49.03419876098633);
}

TEST(SimDefaults, ExternalTagWithoutSim) {
    const SimConfig b = defaultSim("X", TagType::BOOL, std::nullopt, std::nullopt);
    EXPECT_EQ(b.kind, SimKind::Square);
    EXPECT_EQ(b.periodMs, 10000);
    EXPECT_EQ(b.duty, 0.5);
    const SimConfig s = defaultSim("X", TagType::STRING, std::nullopt, std::nullopt);
    EXPECT_EQ(s.kind, SimKind::Const);
    EXPECT_EQ(std::get<std::string>(s.value), "");
    const SimConfig n = defaultSim("TANK01.LEVEL", TagType::FLOAT32, std::nullopt, std::nullopt);
    EXPECT_EQ(n.kind, SimKind::Random);
    EXPECT_EQ(n.min, 0);
    EXPECT_EQ(n.max, 100);
    EXPECT_EQ(n.periodMs, 2000);
    EXPECT_EQ(n.seed, fnv1a32("TANK01.LEVEL"));
    const SimConfig r = defaultSim("Y", TagType::INT16, 10.0, 20.0);
    EXPECT_EQ(r.min, 10);
    EXPECT_EQ(r.max, 20);
    const SimConfig bad = defaultSim("Y", TagType::INT16, 20.0, 20.0);  // min >= max: 0..100
    EXPECT_EQ(bad.max, 100);
    EXPECT_EQ(fnv1a32(""), 0x811c9dc5u);
    EXPECT_EQ(fnv1a32("a"), 0xe40c292cu);
}

TEST(SimDefaults, TypeConversionRoundsAndClamps) {
    EXPECT_EQ(std::get<int64_t>(toTagType(2.5, TagType::INT16)), 3);
    EXPECT_EQ(std::get<int64_t>(toTagType(-2.5, TagType::INT16)), -3);
    EXPECT_EQ(std::get<int64_t>(toTagType(1e9, TagType::INT16)), 32767);
    EXPECT_EQ(std::get<uint64_t>(toTagType(-5.0, TagType::UINT16)), 0u);
    EXPECT_EQ(std::get<uint64_t>(toTagType(1e30, TagType::UINT64)), UINT64_MAX);
    EXPECT_EQ(std::get<int64_t>(toTagType(-1e30, TagType::INT64)), INT64_MIN);
    EXPECT_EQ(bitsOf(std::get<double>(toTagType(-0.0, TagType::FLOAT64))), bitsOf(0.0));
}
