// Shared pieces of the timed C++ fuzz targets of feature 011 (T058, T142; FR-029): the time budget
// (MAT_FUZZ_SECONDS, MAT_FUZZ_SEED), a portable generator (splitmix64), mutations of text and of
// JSON documents. Deterministic for one seed; the targets print the case number of a failure so it
// can be replayed (MAT_FUZZ_SEED + the same budget). Header only: each target is its own binary
// (tools/fuzz/cpp/run.sh builds them with ASan + UBSan).
#pragma once
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"

namespace mat::fuzz {

// Seconds of a target: MAT_FUZZ_SECONDS, else `fallback` (the short run of ctest).
inline double budgetSeconds(double fallback) {
    const char* e = std::getenv("MAT_FUZZ_SECONDS");
    return e && *e ? std::atof(e) : fallback;
}
inline uint64_t baseSeed() {
    const char* e = std::getenv("MAT_FUZZ_SEED");
    return e && *e ? std::strtoull(e, nullptr, 10) : 20261017ull;
}

struct Rng {
    uint64_t s;
    uint64_t next() {
        uint64_t z = (s += 0x9e3779b97f4a7c15ull);
        z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ull;
        z = (z ^ (z >> 27)) * 0x94d049bb133111ebull;
        return z ^ (z >> 31);
    }
    size_t below(size_t n) { return n == 0 ? 0 : static_cast<size_t>(next() % n); }
    bool chance(int percent) { return below(100) < static_cast<size_t>(percent); }
    double unit() { return static_cast<double>(next() >> 11) * (1.0 / 9007199254740992.0); }
};

class Deadline {
   public:
    explicit Deadline(double seconds)
        : end_(std::chrono::steady_clock::now() +
               std::chrono::milliseconds(static_cast<int64_t>(seconds * 1000))) {}
    bool passed() const { return std::chrono::steady_clock::now() >= end_; }

   private:
    std::chrono::steady_clock::time_point end_;
};

// Byte-level mutations of a text: bit flips, interesting bytes, cuts, insertions of JSON
// punctuation or of a dictionary word, duplicated or removed spans.
inline std::string mutateText(std::string t, Rng& r, const std::vector<std::string>& dict) {
    static const char* kTokens[] = {"{",
                                    "}",
                                    "[",
                                    "]",
                                    ",",
                                    ":",
                                    "\"",
                                    "\\",
                                    "null",
                                    "true",
                                    "false",
                                    "-0",
                                    "1e308",
                                    "-1e308",
                                    "1e400",
                                    "0.1",
                                    "9007199254740993",
                                    "\\u0000",
                                    "\\ud800",
                                    "\xc3\xa0",
                                    "\xff",
                                    "\xef\xbb\xbf",
                                    "\"\":",
                                    "[[[[[[[[",
                                    "]]]]]]]]",
                                    "\"__proto__\"",
                                    "\"constructor\""};
    const int ops = 1 + static_cast<int>(r.below(4));
    for (int k = 0; k < ops; ++k) {
        const size_t at = r.below(t.size() + 1);
        switch (r.below(8)) {
            case 0:
                if (!t.empty()) t[r.below(t.size())] ^= static_cast<char>(1u << r.below(8));
                break;
            case 1:
                if (!t.empty()) t[r.below(t.size())] = static_cast<char>(r.next());
                break;
            case 2:
                t.resize(r.below(t.size() + 1));
                break;
            case 3:
                t.insert(at, kTokens[r.below(sizeof kTokens / sizeof kTokens[0])]);
                break;
            case 4:
                if (!dict.empty()) t.insert(at, dict[r.below(dict.size())]);
                break;
            case 5: {
                const size_t n = 1 + r.below(32);
                if (at < t.size()) t.erase(at, n);
                break;
            }
            case 6: {  // duplicate a span
                if (t.empty()) break;
                const size_t from = r.below(t.size());
                const size_t n = 1 + r.below(64);
                t.insert(at, t.substr(from, n));
                break;
            }
            default: {  // replace a digit run
                for (size_t i = at; i < t.size(); ++i)
                    if (t[i] >= '0' && t[i] <= '9') {
                        static const char* kNums[] = {"0",   "-1",  "65535", "4294967296",
                                                      "1e9", "2.5", "-0.0",  "1e-320"};
                        t.replace(i, 1, kNums[r.below(sizeof kNums / sizeof kNums[0])]);
                        break;
                    }
                break;
            }
        }
    }
    return t;
}

// Strings and numbers of a set of documents: the dictionary of the JSON mutations.
struct Dict {
    std::vector<std::string> strings;
    std::vector<std::string> keys;
    std::vector<nlohmann::json> values;
};

inline void collect(const nlohmann::json& j, Dict& d, int depth = 0) {
    if (depth > 40) return;
    if (j.is_object()) {
        for (auto it = j.begin(); it != j.end(); ++it) {
            if (d.keys.size() < 4000) d.keys.push_back(it.key());
            collect(it.value(), d, depth + 1);
        }
    } else if (j.is_array()) {
        for (const auto& x : j) collect(x, d, depth + 1);
    } else {
        if (j.is_string() && d.strings.size() < 4000) d.strings.push_back(j.get<std::string>());
        if (d.values.size() < 4000) d.values.push_back(j);
    }
}

inline nlohmann::json interestingValue(Rng& r, const Dict& d) {
    switch (r.below(12)) {
        case 0:
            return nullptr;
        case 1:
            return r.chance(50);
        case 2:
            return 0;
        case 3:
            return -1;
        case 4:
            return 1e308;
        case 5:
            return -1e308;
        case 6:
            return static_cast<int64_t>(r.next());
        case 7:
            return std::string(r.below(300), static_cast<char>('a' + r.below(26)));
        case 8:
            return nlohmann::json::array();
        case 9:
            return nlohmann::json::object();
        case 10:
            return d.strings.empty() ? nlohmann::json("x")
                                     : nlohmann::json(d.strings[r.below(d.strings.size())]);
        default:
            return d.values.empty() ? nlohmann::json(1) : d.values[r.below(d.values.size())];
    }
}

// One structural mutation somewhere in `j`: replace a value, drop or add a key, duplicate or drop
// an array entry, swap in a value of the dictionary.
inline void mutateJsonOnce(nlohmann::json& j, Rng& r, const Dict& d, int depth = 0) {
    const bool container = (j.is_object() || j.is_array()) && !j.empty();
    if (!container || depth > 30 || r.chance(25)) {
        if (container && r.chance(50)) {
            if (j.is_object()) {
                auto it = j.begin();
                std::advance(it, static_cast<long>(r.below(j.size())));
                if (r.chance(50))
                    j.erase(it);
                else
                    j[d.keys.empty() ? std::string("k") : d.keys[r.below(d.keys.size())]] =
                        interestingValue(r, d);
            } else {
                const size_t i = r.below(j.size());
                if (r.chance(40))
                    j.erase(i);
                else if (r.chance(50))
                    j.push_back(j[i]);
                else
                    j.insert(j.begin() + static_cast<long>(r.below(j.size() + 1)),
                             interestingValue(r, d));
            }
        } else {
            j = interestingValue(r, d);
        }
        return;
    }
    if (j.is_object()) {
        auto it = j.begin();
        std::advance(it, static_cast<long>(r.below(j.size())));
        mutateJsonOnce(it.value(), r, d, depth + 1);
    } else {
        mutateJsonOnce(j[r.below(j.size())], r, d, depth + 1);
    }
}

inline nlohmann::json mutateJson(nlohmann::json j, Rng& r, const Dict& d) {
    const int n = r.chance(70) ? 1 : 2 + static_cast<int>(r.below(3));
    for (int i = 0; i < n; ++i) mutateJsonOnce(j, r, d);
    return j;
}

}  // namespace mat::fuzz
