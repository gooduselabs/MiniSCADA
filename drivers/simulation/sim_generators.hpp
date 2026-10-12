// Simulation generators (contracts/value-tables-simulation.md §2). The same formulas, in the same
// order of operations, as packages/tag-sim; both run tests/sim-vectors bit for bit. Built with
// -ffp-contract=off; no std::sin (sinTurns is the fdlibm kernel on a fixed split of the circle).
#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <variant>

#include "core/tag-engine/tag_store.hpp"  // TagType, TagScalar (types only)
#include "nlohmann/json.hpp"

namespace mat::sim {

enum class SimKind { Const, Ramp, Sine, Random, Square, Manual, Legacy };

using SimScalar = std::variant<std::monostate, double, bool, std::string>;

struct SimConfig {
    SimKind kind = SimKind::Const;
    SimScalar value;                   // const
    double from = 0, to = 0;           // ramp
    double center = 0, amplitude = 0;  // sine
    int64_t periodMs = 0;
    double phase = 0;
    double min = 0, max = 0;  // random
    uint32_t seed = 1;
    double duty = 0.5;
    SimScalar initial;   // manual
    std::string signal;  // legacy
};

std::optional<SimKind> parseSimKind(const std::string& s);

// `sim` object of tags.json; the schema has already checked it. nullopt: unknown kind.
std::optional<SimConfig> simFromJson(const nlohmann::json& j);

double sinTurns(double f);                  // sin(2 pi f), f in [0, 1)
double hashU(uint32_t seed, uint64_t k);    // U(seed, k) in [0, 1)
uint32_t fnv1a32(const std::string& text);  // default seed from the Tag id

// Number/bool/string to the Tag type: integers round (half away from zero) then clamp to the type;
// FLOAT32 rounds to 32 bit; -0 becomes 0. Quality is always GOOD.
TagScalar toTagType(const SimScalar& v, TagType type);

// Value at `t` (UTC ms, integer >= 0, < 2^53). `manual`: `lastWrite` is the last write command
// (absent: `initial`). `legacy` is not handled here (MockTagProvider).
TagScalar simValue(const SimConfig& sim, int64_t t, TagType type,
                   const SimScalar* lastWrite = nullptr);

// Default for an external Tag without `sim` (contract §2.3). min/max absent or min >= max: 0..100.
SimConfig defaultSim(const std::string& id, TagType type, std::optional<double> min,
                     std::optional<double> max);

}  // namespace mat::sim
