#include "drivers/simulation/sim_generators.hpp"

#include <cmath>
#include <limits>

#include "core/expression/expression.hpp"

namespace mat::sim {

namespace {

// fdlibm __kernel_sin / __kernel_cos coefficients (Sun Microsystems, free to use).
constexpr double kHalfPi = 1.5707963267948966;
constexpr double S1 = -1.66666666666666324348e-1;
constexpr double S2 = 8.33333333332248946124e-3;
constexpr double S3 = -1.98412698298579493134e-4;
constexpr double S4 = 2.75573137070700676789e-6;
constexpr double S5 = -2.50507602534068634195e-8;
constexpr double S6 = 1.58969099521155010221e-10;
constexpr double C1 = 4.16666666666666019037e-2;
constexpr double C2 = -1.38888888888741095749e-3;
constexpr double C3 = 2.48015872894767294178e-5;
constexpr double C4 = -2.75573143513906633035e-7;
constexpr double C5 = 2.0875723212981748279e-9;
constexpr double C6 = -1.13596475577881948265e-11;

double kernelSin(double x) {
    const double z = x * x;
    return x + x * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}

double kernelCos(double x) {
    const double z = x * x;
    return 1 - (0.5 * z - z * (z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))));
}

uint32_t mix(uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

double numberOf(const SimScalar& v) {
    if (const double* d = std::get_if<double>(&v)) return *d;
    if (const bool* b = std::get_if<bool>(&v)) return *b ? 1.0 : 0.0;
    return 0.0;
}

SimScalar rawValue(const SimConfig& sim, int64_t t, TagType type, const SimScalar* lastWrite) {
    switch (sim.kind) {
        case SimKind::Const:
            return sim.value;
        case SimKind::Manual:
            return lastWrite && !std::holds_alternative<std::monostate>(*lastWrite) ? *lastWrite
                                                                                    : sim.initial;
        case SimKind::Legacy:
            return SimScalar{};
        default:
            break;
    }
    const int64_t T = sim.periodMs;
    const int64_t m = t % T;
    const int64_t k = (t - m) / T;
    switch (sim.kind) {
        case SimKind::Ramp: {
            const double p = static_cast<double>(m) / static_cast<double>(T);
            return sim.from + (sim.to - sim.from) * p;
        }
        case SimKind::Sine: {
            double f = static_cast<double>(m) / static_cast<double>(T) + sim.phase;
            if (f >= 1) f = f - 1;
            return sim.center + sim.amplitude * sinTurns(f);
        }
        case SimKind::Random: {
            const double u = hashU(sim.seed, static_cast<uint64_t>(k));
            if (type == TagType::BOOL) return u >= 0.5;
            return sim.min + (sim.max - sim.min) * u;
        }
        default: {  // Square
            const bool on = static_cast<double>(m) < sim.duty * static_cast<double>(T);
            if (type == TagType::BOOL) return on;
            return on ? 1.0 : 0.0;
        }
    }
}

}  // namespace

std::optional<SimKind> parseSimKind(const std::string& s) {
    if (s == "const") return SimKind::Const;
    if (s == "ramp") return SimKind::Ramp;
    if (s == "sine") return SimKind::Sine;
    if (s == "random") return SimKind::Random;
    if (s == "square") return SimKind::Square;
    if (s == "manual") return SimKind::Manual;
    if (s == "legacy") return SimKind::Legacy;
    return std::nullopt;
}

namespace {
SimScalar scalarFromJson(const nlohmann::json& j, const char* key) {
    auto it = j.find(key);
    if (it == j.end()) return SimScalar{};
    if (it->is_boolean()) return it->get<bool>();
    if (it->is_number()) return it->get<double>();
    if (it->is_string()) return it->get<std::string>();
    return SimScalar{};
}
double dbl(const nlohmann::json& j, const char* key, double dflt) {
    auto it = j.find(key);
    return it != j.end() && it->is_number() ? it->get<double>() : dflt;
}
}  // namespace

std::optional<SimConfig> simFromJson(const nlohmann::json& j) {
    if (!j.is_object() || !j.contains("kind") || !j["kind"].is_string()) return std::nullopt;
    const auto kind = parseSimKind(j["kind"].get<std::string>());
    if (!kind) return std::nullopt;
    SimConfig c;
    c.kind = *kind;
    c.value = scalarFromJson(j, "value");
    c.initial = scalarFromJson(j, "initial");
    c.from = dbl(j, "from", 0);
    c.to = dbl(j, "to", 0);
    c.center = dbl(j, "center", 0);
    c.amplitude = dbl(j, "amplitude", 0);
    c.periodMs = static_cast<int64_t>(dbl(j, "periodMs", 0));
    c.phase = dbl(j, "phase", 0);
    c.min = dbl(j, "min", 0);
    c.max = dbl(j, "max", 0);
    c.seed = static_cast<uint32_t>(dbl(j, "seed", 1));
    c.duty = dbl(j, "duty", 0.5);
    if (j.contains("signal") && j["signal"].is_string()) c.signal = j["signal"].get<std::string>();
    return c;
}

double sinTurns(double f) {
    const double f4 = f * 4;  // exact
    const double q = std::floor(f4);
    double r = f4 - q;  // [0, 1), exact
    bool other = false;
    if (r > 0.5) {
        r = 1 - r;  // exact
        other = true;
    }
    const double x = r * kHalfPi;
    const bool useSin = ((static_cast<int>(q) % 2) == 0) != other;
    const double v = useSin ? kernelSin(x) : kernelCos(x);
    return q >= 2 ? -v : v;
}

double hashU(uint32_t seed, uint64_t k) {
    const uint32_t kLo = static_cast<uint32_t>(k & 0xFFFFFFFFu);
    const uint32_t kHi = static_cast<uint32_t>(k >> 32);
    uint32_t h = mix(seed ^ 0x9e3779b9u);
    h = mix(h ^ kLo);
    h = mix(h ^ kHi);
    return static_cast<double>(h >> 8) / 16777216.0;
}

uint32_t fnv1a32(const std::string& text) {
    uint32_t h = 0x811c9dc5u;
    for (unsigned char b : text) {
        h ^= b;
        h *= 0x01000193u;
    }
    return h;
}

TagScalar toTagType(const SimScalar& v, TagType type) {
    if (type == TagType::BOOL) {
        if (const bool* b = std::get_if<bool>(&v)) return *b;
        return numberOf(v) != 0;
    }
    if (type == TagType::STRING) {
        if (const std::string* s = std::get_if<std::string>(&v)) return *s;
        return std::string();
    }
    const double x = numberOf(v);
    if (type == TagType::FLOAT64) return x == 0 ? 0.0 : x;
    if (type == TagType::FLOAT32) {
        const float f = static_cast<float>(x);
        return f == 0 ? 0.0 : static_cast<double>(f);
    }
    double r = expr::roundHalfAway(x);
    constexpr double k2p63 = 9223372036854775808.0;
    constexpr double k2p64 = 18446744073709551616.0;
    switch (type) {
        case TagType::INT16:
            return static_cast<int64_t>(std::fmin(std::fmax(r, -32768.0), 32767.0));
        case TagType::UINT16:
            return static_cast<uint64_t>(std::fmin(std::fmax(r, 0.0), 65535.0));
        case TagType::INT32:
            return static_cast<int64_t>(std::fmin(std::fmax(r, -2147483648.0), 2147483647.0));
        case TagType::UINT32:
            return static_cast<uint64_t>(std::fmin(std::fmax(r, 0.0), 4294967295.0));
        case TagType::INT64:
            if (r < -k2p63) return std::numeric_limits<int64_t>::min();
            if (r >= k2p63) return std::numeric_limits<int64_t>::max();
            return static_cast<int64_t>(r);
        default:  // UINT64
            if (r <= 0) return uint64_t{0};
            if (r >= k2p64) return std::numeric_limits<uint64_t>::max();
            return static_cast<uint64_t>(r);
    }
}

TagScalar simValue(const SimConfig& sim, int64_t t, TagType type, const SimScalar* lastWrite) {
    return toTagType(rawValue(sim, t, type, lastWrite), type);
}

SimConfig defaultSim(const std::string& id, TagType type, std::optional<double> min,
                     std::optional<double> max) {
    SimConfig c;
    if (type == TagType::BOOL) {
        c.kind = SimKind::Square;
        c.periodMs = 10000;
        c.duty = 0.5;
        return c;
    }
    if (type == TagType::STRING) {
        c.kind = SimKind::Const;
        c.value = std::string();
        return c;
    }
    const bool hasRange = min && max && *min < *max;
    c.kind = SimKind::Random;
    c.min = hasRange ? *min : 0;
    c.max = hasRange ? *max : 100;
    c.periodMs = 2000;
    c.seed = fnv1a32(id);
    return c;
}

}  // namespace mat::sim
