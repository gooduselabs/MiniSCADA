// Merge of aggregate buckets and the derived quantities (specs/010-history-reports
// contracts/history-db.md §6). Hand-computed cases plus tests/agg-vectors/{merge,derive}-*.json
// (the same files run in packages/history-math; see tests/agg-vectors/README.md).
#include "core/historian/agg_math.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>

#include "nlohmann/json.hpp"

using namespace mat;
using nlohmann::json;

namespace {
AggBucket b(int64_t n, double mn, double mx, double first, double last, double sumw, int64_t wms) {
    AggBucket x;
    x.n = n;
    x.min = mn;
    x.max = mx;
    x.first = first;
    x.last = last;
    x.sumw = sumw;
    x.wms = wms;
    return x;
}
}  // namespace

TEST(AggMath, EmptyIsTheIdentity) {
    const AggBucket a = b(2, 1, 5, 2, 4, 100, 60000);
    const AggBucket e;
    EXPECT_TRUE(e.empty());
    const AggBucket l = mergeBuckets(e, a);
    const AggBucket r = mergeBuckets(a, e);
    EXPECT_EQ(l.n, 2);
    EXPECT_EQ(r.n, 2);
    EXPECT_EQ(l.first, 2);
    EXPECT_EQ(r.last, 4);
    EXPECT_TRUE(mergeBuckets(e, e).empty());
}

TEST(AggMath, TwoWindows) {
    const AggBucket m = mergeBuckets(b(2, 1, 5, 2, 4, 100, 30000), b(3, 0, 9, 4, 8, 300, 60000));
    EXPECT_EQ(m.n, 5);
    EXPECT_EQ(m.min, 0);
    EXPECT_EQ(m.max, 9);
    EXPECT_EQ(m.first, 2);  // from the earlier
    EXPECT_EQ(m.last, 8);   // from the later
    EXPECT_EQ(m.sumw, 400);
    EXPECT_EQ(m.wms, 90000);
}

TEST(AggMath, ThreeWindowsAreAssociative) {
    const AggBucket x = b(1, 1, 1, 1, 1, 60000, 60000);
    const AggBucket y = b(0, 1, 3, 1, 3, 120000, 60000);
    const AggBucket z = b(2, 3, 4, 3, 4, 210000, 60000);
    const AggBucket l = mergeBuckets(mergeBuckets(x, y), z);
    const AggBucket r = mergeBuckets(x, mergeBuckets(y, z));
    EXPECT_EQ(l.n, r.n);
    EXPECT_EQ(l.first, r.first);
    EXPECT_EQ(l.last, r.last);
    EXPECT_EQ(l.sumw, r.sumw);
    EXPECT_EQ(l.wms, r.wms);
}

TEST(AggMath, Derived) {
    const AggBucket a = b(4, 10, 20, 12, 18, 15.0 * 60000, 60000);
    EXPECT_DOUBLE_EQ(*aggAvg(a), 15.0);
    EXPECT_DOUBLE_EQ(*aggSum(a), 15.0 * 60000 / 3600000.0);
    EXPECT_DOUBLE_EQ(*aggDelta(a), 6.0);
    EXPECT_DOUBLE_EQ(aggCoverage(a, 60000), 1.0);
    EXPECT_DOUBLE_EQ(aggCoverage(a, 120000), 0.5);
    // no millisecond with a value: avg falls back to `last`
    const AggBucket rows = b(2, 1, 9, 1, 9, 0, 0);
    EXPECT_DOUBLE_EQ(*aggAvg(rows), 9.0);
    EXPECT_DOUBLE_EQ(aggCoverage(rows, 60000), 0.0);
    EXPECT_DOUBLE_EQ(aggCoverage(a, 0), 0.0);
    // an empty bucket has no avg, sum or delta, and no coverage
    const AggBucket e;
    EXPECT_FALSE(aggAvg(e).has_value());
    EXPECT_FALSE(aggSum(e).has_value());
    EXPECT_FALSE(aggDelta(e).has_value());
    EXPECT_DOUBLE_EQ(aggCoverage(e, 60000), 0.0);
}

namespace {
AggBucket fromJson(const json& j) {
    if (j.is_null()) return AggBucket{};
    AggBucket x;
    x.n = j.at("n").get<int64_t>();
    x.min = j.at("min").get<double>();
    x.max = j.at("max").get<double>();
    x.first = j.at("first").get<double>();
    x.last = j.at("last").get<double>();
    x.sumw = j.at("sumw").get<double>();
    x.wms = j.at("wms").get<int64_t>();
    return x;
}
bool near(double a, double c) {
    return std::fabs(a - c) <= 1e-9 * std::max(1.0, std::fabs(c));
}
std::vector<std::string> vectorFiles(const std::string& prefix) {
    std::vector<std::string> out;
    const std::filesystem::path dir = std::string(MAT_SOURCE_DIR) + "/tests/agg-vectors";
    if (!std::filesystem::exists(dir)) return out;
    for (const auto& e : std::filesystem::directory_iterator(dir)) {
        const std::string name = e.path().filename().string();
        if (name.rfind(prefix, 0) == 0 && e.path().extension() == ".json")
            out.push_back(e.path().string());
    }
    std::sort(out.begin(), out.end());
    return out;
}
void expectSame(const AggBucket& got, const json& want) {
    if (want.is_null()) {
        EXPECT_TRUE(got.empty());
        return;
    }
    const AggBucket w = fromJson(want);
    EXPECT_EQ(got.n, w.n);
    EXPECT_EQ(got.wms, w.wms);
    EXPECT_TRUE(near(got.min, w.min)) << got.min << " vs " << w.min;
    EXPECT_TRUE(near(got.max, w.max)) << got.max << " vs " << w.max;
    EXPECT_TRUE(near(got.first, w.first)) << got.first << " vs " << w.first;
    EXPECT_TRUE(near(got.last, w.last)) << got.last << " vs " << w.last;
    EXPECT_TRUE(near(got.sumw, w.sumw)) << got.sumw << " vs " << w.sumw;
}
}  // namespace

TEST(AggMathVectors, MergeVectors) {
    const auto files = vectorFiles("merge-");
    if (files.empty()) GTEST_SKIP() << "tests/agg-vectors/merge-*.json not present";
    EXPECT_GE(files.size(), 10u);
    for (const auto& f : files) {
        std::ifstream in(f);
        const json v = json::parse(in);
        SCOPED_TRACE(f);
        AggBucket acc;
        for (const auto& i : v["inputs"]) acc = mergeBuckets(acc, fromJson(i));
        expectSame(acc, v["expect"]);
    }
}

TEST(AggMathVectors, DeriveVectors) {
    const auto files = vectorFiles("derive-");
    if (files.empty()) GTEST_SKIP() << "tests/agg-vectors/derive-*.json not present";
    EXPECT_GE(files.size(), 10u);
    for (const auto& f : files) {
        std::ifstream in(f);
        const json v = json::parse(in);
        SCOPED_TRACE(f);
        const AggBucket x = fromJson(v["bucket"]);
        const std::string fn = v["fn"].get<std::string>();
        std::optional<double> got;
        if (fn == "avg") got = aggAvg(x);
        if (fn == "sum") got = aggSum(x);
        if (fn == "delta") got = aggDelta(x);
        if (fn == "coverage") got = aggCoverage(x, v["windowMs"].get<int64_t>());
        if (v["expect"].is_null()) {
            EXPECT_FALSE(got.has_value());
        } else {
            ASSERT_TRUE(got.has_value());
            EXPECT_TRUE(near(*got, v["expect"].get<double>()));
        }
    }
}
