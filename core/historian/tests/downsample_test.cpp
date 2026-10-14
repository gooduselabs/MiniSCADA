// Point reduction of the history API (specs/010-history-reports contracts/history-api.md §3.2,
// FR-021, SC-008): the shared vectors of tests/downsample-vectors plus properties.
#include "core/historian/query/downsample.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>

#include "nlohmann/json.hpp"

using namespace mat;
using nlohmann::json;

namespace {

bool near(double a, double b) { return std::fabs(a - b) <= 1e-9 * std::max(1.0, std::fabs(b)); }

std::vector<std::string> vectorFiles(const std::string& prefix) {
    std::vector<std::string> out;
    const std::filesystem::path dir = std::string(MAT_SOURCE_DIR) + "/tests/downsample-vectors";
    if (!std::filesystem::exists(dir)) return out;
    for (const auto& e : std::filesystem::directory_iterator(dir)) {
        const std::string name = e.path().filename().string();
        if (name.rfind(prefix, 0) == 0 && e.path().extension() == ".json")
            out.push_back(e.path().string());
    }
    std::sort(out.begin(), out.end());
    return out;
}

std::vector<SeriesPoint> rowsOf(const json& a) {
    std::vector<SeriesPoint> r;
    for (const auto& p : a) {
        SeriesPoint s;
        s.t = p[0].get<int64_t>();
        if (!p[1].is_null()) s.v = p[1].get<double>();
        r.push_back(s);
    }
    return r;
}

void expectPoints(const std::vector<SeriesPoint>& got, const json& expect) {
    const auto& t = expect["t"];
    const auto& v = expect["v"];
    ASSERT_EQ(got.size(), t.size());
    for (size_t i = 0; i < got.size(); ++i) {
        EXPECT_EQ(got[i].t, t[i].get<int64_t>()) << "point " << i;
        if (v[i].is_null()) {
            EXPECT_FALSE(got[i].v.has_value()) << "point " << i;
        } else {
            ASSERT_TRUE(got[i].v.has_value()) << "point " << i;
            EXPECT_TRUE(near(*got[i].v, v[i].get<double>())) << "point " << i;
        }
    }
}

AggBucket bucketOf(const json& j) {
    AggBucket b;
    b.n = j["n"].get<int64_t>();
    b.min = j["min"].get<double>();
    b.max = j["max"].get<double>();
    b.first = j["first"].get<double>();
    b.last = j["last"].get<double>();
    b.sumw = j["sumw"].get<double>();
    b.wms = j["wms"].get<int64_t>();
    return b;
}

}  // namespace

TEST(Downsample, MinMaxVectors) {
    const auto files = vectorFiles("minmax-");
    if (files.empty()) GTEST_SKIP() << "no vectors";
    for (const auto& f : files) {
        std::ifstream in(f);
        const json v = json::parse(in);
        SCOPED_TRACE(f);
        const auto got = reduceMinMax(rowsOf(v["rows"]), v["from"].get<int64_t>(),
                                      v["to"].get<int64_t>(), v["maxPoints"].get<int>());
        expectPoints(got, v["expect"]);
        EXPECT_LE(got.size(), static_cast<size_t>(v["maxPoints"].get<int>()));
    }
}

TEST(Downsample, DecimateVectors) {
    const auto files = vectorFiles("decimate-");
    if (files.empty()) GTEST_SKIP() << "no vectors";
    for (const auto& f : files) {
        std::ifstream in(f);
        const json v = json::parse(in);
        SCOPED_TRACE(f);
        expectPoints(reduceDecimate(rowsOf(v["rows"]), v["from"].get<int64_t>(),
                                    v["to"].get<int64_t>(), v["maxPoints"].get<int>()),
                     v["expect"]);
    }
}

TEST(Downsample, LttbVectors) {
    const auto files = vectorFiles("lttb-");
    if (files.empty()) GTEST_SKIP() << "no vectors";
    for (const auto& f : files) {
        std::ifstream in(f);
        const json v = json::parse(in);
        SCOPED_TRACE(f);
        expectPoints(reduceLttb(rowsOf(v["points"]), v["maxPoints"].get<int>()), v["expect"]);
    }
}

TEST(Downsample, MergeVectors) {
    const auto files = vectorFiles("merge-");
    if (files.empty()) GTEST_SKIP() << "no vectors";
    for (const auto& f : files) {
        std::ifstream in(f);
        const json v = json::parse(in);
        SCOPED_TRACE(f);
        std::vector<BucketRow> rows;
        for (const auto& b : v["buckets"]) rows.push_back({b["bucket"].get<int64_t>(), bucketOf(b)});
        const auto got = reduceMerge(rows, v["from"].get<int64_t>(), v["to"].get<int64_t>(),
                                     v["res"].get<int64_t>(), v["maxPoints"].get<int>());
        const auto& e = v["expect"];
        ASSERT_EQ(got.size(), e["t"].size());
        for (size_t i = 0; i < got.size(); ++i) {
            EXPECT_EQ(got[i].t, e["t"][i].get<int64_t>());
            EXPECT_TRUE(near(got[i].v, e["v"][i].get<double>()));
            EXPECT_TRUE(near(got[i].min, e["min"][i].get<double>()));
            EXPECT_TRUE(near(got[i].max, e["max"][i].get<double>()));
        }
    }
}

// SC-008: a single-sample spike in 24 h of 1 s data survives the reduction.
TEST(Downsample, MinMaxKeepsASingleSpike) {
    std::vector<SeriesPoint> rows;
    for (int64_t i = 0; i < 86400; ++i) rows.push_back({i * 1000, i == 43210 ? 1000.0 : 1.0});
    const auto out = reduceMinMax(rows, 0, 86400000, 1000);
    ASSERT_LE(out.size(), 1000u);
    bool seen = false;
    for (const auto& p : out)
        if (p.v && *p.v == 1000.0) seen = true;
    EXPECT_TRUE(seen);
}

TEST(Downsample, ResultIsDeterministicSortedAndBounded) {
    std::vector<SeriesPoint> rows;
    for (int64_t i = 0; i < 5000; ++i)
        rows.push_back({i * 100, (i % 97 == 0) ? std::nullopt : std::optional<double>(std::sin(i / 13.0))});
    for (int mp : {10, 11, 37, 500, 1000}) {
        const auto a = reduceMinMax(rows, 0, 500000, mp);
        const auto b = reduceMinMax(rows, 0, 500000, mp);
        ASSERT_LE(a.size(), static_cast<size_t>(mp)) << mp;
        ASSERT_EQ(a.size(), b.size());
        for (size_t i = 0; i < a.size(); ++i) {
            EXPECT_EQ(a[i].t, b[i].t);
            if (i > 0) EXPECT_LT(a[i - 1].t, a[i].t);
        }
        EXPECT_EQ(a.front().t, rows.front().t);
        EXPECT_EQ(a.back().t, rows.back().t);
    }
}

TEST(Downsample, StreamingEqualsTheVectorForm) {
    std::vector<SeriesPoint> rows;
    for (int64_t i = 0; i < 3000; ++i) rows.push_back({i * 10, std::cos(i / 7.0)});
    MinMaxReducer r(0, 30000, 100);
    for (const auto& p : rows) r.add(p.t, p.v);
    const auto a = r.finish();
    const auto b = reduceMinMax(rows, 0, 30000, 100);
    ASSERT_EQ(a.size(), b.size());
    for (size_t i = 0; i < a.size(); ++i) EXPECT_EQ(a[i].t, b[i].t);
}

TEST(Downsample, LttbOverSeriesWithNullsStaysWithinTheThresholdAndKeepsTheNulls) {
    std::vector<SeriesPoint> rows;
    for (int64_t i = 0; i < 600; ++i) {
        const bool gap = i >= 200 && i < 220;
        rows.push_back({i * 1000, gap ? std::nullopt : std::optional<double>(std::sin(i / 20.0))});
    }
    const auto out = reduceLttb(rows, 60);
    EXPECT_LE(out.size(), 62u);
    EXPECT_EQ(out.front().t, 0);
    EXPECT_EQ(out.back().t, 599000);
    int nulls = 0;
    for (const auto& p : out) nulls += p.v ? 0 : 1;
    EXPECT_EQ(nulls, 1);  // one null for the run
}

TEST(Downsample, MergeGroupsAdjacentCells) {
    std::vector<BucketRow> rows;
    for (int64_t i = 0; i < 100; ++i) {
        AggBucket b;
        b.n = 1;
        b.min = b.max = b.first = b.last = static_cast<double>(i);
        b.sumw = i * 60000.0;
        b.wms = 60000;
        rows.push_back({i * 60000, b});
    }
    const auto out = reduceMerge(rows, 0, 6000000, 60000, 10);
    ASSERT_EQ(out.size(), 10u);
    EXPECT_EQ(out[0].t, 0);
    EXPECT_DOUBLE_EQ(out[0].v, 4.5);
    EXPECT_DOUBLE_EQ(out[0].min, 0);
    EXPECT_DOUBLE_EQ(out[0].max, 9);
}
