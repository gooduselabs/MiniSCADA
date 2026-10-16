// Held-signal accumulator of the 1-minute and 1-hour tables (specs/010-history-reports
// contracts/history-db.md §3, §8): hand-computed cases plus the shared vectors of
// tests/agg-vectors (the same files run in packages/history-math).
#include "core/historian/aggregator.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <map>

#include "nlohmann/json.hpp"

using namespace mat;
using nlohmann::json;

namespace {

using Values = std::vector<std::optional<double>>;

struct Agg {
    GroupAggregator g;
    std::vector<AggOut> out;
    explicit Agg(size_t cols) : g(cols) {}
    void row(int64_t t, Values v) {
        g.row(t, v);
        g.drain(out);
    }
    void advance(int64_t t) {
        g.advance(t);
        g.drain(out);
    }
    void brk(int64_t t) {
        g.breakAll(t);
        g.drain(out);
    }
    std::vector<AggOut> of(size_t col, int64_t res) const {
        std::vector<AggOut> r;
        for (const auto& o : out)
            if (o.col == col && o.res == res) r.push_back(o);
        return r;
    }
};

void expectBucket(const AggOut& o, int64_t bucket, int64_t n, double mn, double mx, double first,
                  double last, double sumw, int64_t wms) {
    EXPECT_EQ(o.bucket, bucket);
    EXPECT_EQ(o.agg.n, n);
    EXPECT_DOUBLE_EQ(o.agg.min, mn);
    EXPECT_DOUBLE_EQ(o.agg.max, mx);
    EXPECT_DOUBLE_EQ(o.agg.first, first);
    EXPECT_DOUBLE_EQ(o.agg.last, last);
    EXPECT_DOUBLE_EQ(o.agg.sumw, sumw);
    EXPECT_EQ(o.agg.wms, wms);
}

bool near(double a, double b) {
    return std::fabs(a - b) <= 1e-9 * std::max({1.0, std::fabs(a), std::fabs(b)});
}

}  // namespace

TEST(Aggregator, HoldAcrossBucket) {
    Agg r(1);
    r.brk(0);
    r.row(1000, {10.0});
    r.row(70000, {20.0});
    r.advance(130000);
    const auto m = r.of(0, kAggMinuteMs);
    ASSERT_EQ(m.size(), 2u);
    expectBucket(m[0], 0, 1, 10, 10, 10, 10, 590000, 59000);
    // 10 s of the carried 10, then 50 s of 20; `first` is the carried value
    expectBucket(m[1], 60000, 1, 10, 20, 10, 20, 100000 + 1000000, 60000);
}

TEST(Aggregator, NullGapsBreakTheSignalInsideAWindow) {
    Agg r(1);
    r.row(0, {10.0});
    r.row(30000, {std::nullopt});
    r.row(45000, {20.0});
    r.advance(120000);
    const auto m = r.of(0, kAggMinuteMs);
    ASSERT_EQ(m.size(), 2u);
    expectBucket(m[0], 0, 2, 10, 20, 10, 20, 300000 + 300000, 45000);
    expectBucket(m[1], 60000, 0, 20, 20, 20, 20, 20.0 * 60000, 60000);  // only carried signal
}

TEST(Aggregator, WindowWithNoSignalAtAllIsNotWritten) {
    Agg r(1);
    r.row(0, {std::nullopt});
    r.advance(600000);
    EXPECT_TRUE(r.out.empty());
}

TEST(Aggregator, BreakClosesTheOpenWindowAndDropsTheSignal) {
    Agg r(1);
    r.row(10000, {5.0});
    r.brk(40000);  // runtime stops / clock jump
    ASSERT_EQ(r.of(0, kAggMinuteMs).size(), 1u);
    expectBucket(r.of(0, kAggMinuteMs)[0], 0, 1, 5, 5, 5, 5, 5.0 * 30000, 30000);
    r.advance(200000);  // nothing is carried across the break
    EXPECT_EQ(r.of(0, kAggMinuteMs).size(), 1u);
    r.row(210000, {7.0});  // the first row of the next run is `first`
    r.advance(300000);
    const auto m = r.of(0, kAggMinuteMs);
    ASSERT_EQ(m.size(), 3u);
    expectBucket(m[1], 180000, 1, 7, 7, 7, 7, 7.0 * 30000, 30000);
    expectBucket(m[2], 240000, 0, 7, 7, 7, 7, 7.0 * 60000, 60000);  // carried signal only
}

TEST(Aggregator, HourIsMergedFromTheMinutesWhenTheLastMinuteCloses) {
    Agg r(1);
    r.row(0, {1.0});
    r.advance(kAggHourMs - 1);
    EXPECT_TRUE(r.of(0, kAggHourMs).empty());
    r.advance(kAggHourMs);
    const auto h = r.of(0, kAggHourMs);
    ASSERT_EQ(h.size(), 1u);
    expectBucket(h[0], 0, 1, 1, 1, 1, 1, 3600000.0, 3600000);
    EXPECT_EQ(r.of(0, kAggMinuteMs).size(), 60u);
}

TEST(Aggregator, DeltaAddsAcrossAdjacentWindowsWhenTheSignalIsCarried) {
    Agg r(1);
    r.row(0, {100.0});
    r.row(90000, {130.0});  // counter
    r.row(200000, {150.0});
    r.advance(240000);
    double sum = 0;
    for (const auto& o : r.of(0, kAggMinuteMs)) sum += o.agg.last - o.agg.first;
    EXPECT_DOUBLE_EQ(sum, 150.0 - 100.0);  // last of the 3 closed windows (carried) - first
}

TEST(Aggregator, TwoColumnsAreIndependent) {
    Agg r(2);
    r.row(0, {1.0, std::nullopt});
    r.row(30000, {2.0, 5.0});
    r.advance(60000);
    ASSERT_EQ(r.of(0, kAggMinuteMs).size(), 1u);
    ASSERT_EQ(r.of(1, kAggMinuteMs).size(), 1u);
    expectBucket(r.of(0, kAggMinuteMs)[0], 0, 2, 1, 2, 1, 2, 30000 + 60000, 60000);
    expectBucket(r.of(1, kAggMinuteMs)[0], 0, 1, 5, 5, 5, 5, 5.0 * 30000, 30000);
}

TEST(Aggregator, ATimeThatGoesBackIsIgnored) {
    Agg r(1);
    r.row(100000, {1.0});
    r.advance(50000);
    r.row(40000, {9.0});  // out of order: ignored
    r.advance(130000);
    const auto m = r.of(0, kAggMinuteMs);
    ASSERT_EQ(m.size(), 1u);
    EXPECT_EQ(m[0].agg.n, 1);
}

// ---------------------------------------------------------------------------------------------
// Shared vectors (tests/agg-vectors/agg-*.json, history-db.md §8).

namespace {
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
}  // namespace

TEST(AggregatorVectors, EveryAggVectorGivesTheExpectedBuckets) {
    const auto files = vectorFiles("agg-");
    if (files.empty()) GTEST_SKIP() << "tests/agg-vectors/agg-*.json not present";
    int ran = 0;
    for (const auto& f : files) {
        std::ifstream in(f);
        const json v = json::parse(in);
        SCOPED_TRACE(f);
        std::vector<std::string> cols;
        for (const auto& t : v["tags"]) cols.push_back(t["col"].get<std::string>());
        Agg r(cols.size());
        for (const auto& ev : v["events"]) {
            const int64_t t = ev["t"].get<int64_t>();
            const std::string op = ev["op"].get<std::string>();
            if (op == "row") {
                Values vals(cols.size());
                if (ev.contains("values"))
                    for (size_t i = 0; i < cols.size(); ++i)
                        if (ev["values"].contains(cols[i]) && !ev["values"][cols[i]].is_null())
                            vals[i] = ev["values"][cols[i]].get<double>();
                r.row(t, vals);
            } else if (op == "advance") {
                r.advance(t);
            } else {  // break, jump
                r.brk(t);
            }
        }
        for (size_t i = 0; i < cols.size(); ++i) {
            for (const char* resKey : {"60000", "3600000"}) {
                const int64_t res = std::atoll(resKey);
                std::vector<json> want;
                if (v["expect"].contains(cols[i]) && v["expect"][cols[i]].contains(resKey))
                    want = v["expect"][cols[i]][resKey].get<std::vector<json>>();
                // What the table holds: minutes are upserted (merged), hours replaced.
                std::map<int64_t, AggBucket> table;
                for (const auto& o : r.of(i, res)) {
                    if (res == kAggMinuteMs && table.count(o.bucket))
                        table[o.bucket] = mergeBuckets(table[o.bucket], o.agg);
                    else
                        table[o.bucket] = o.agg;
                }
                ASSERT_EQ(table.size(), want.size()) << cols[i] << " res " << resKey;
                size_t k = 0;
                for (const auto& [bucketStart, agg] : table) {
                    EXPECT_EQ(bucketStart, want[k]["bucket"].get<int64_t>());
                    EXPECT_EQ(agg.n, want[k]["n"].get<int64_t>());
                    EXPECT_EQ(agg.wms, want[k]["wms"].get<int64_t>());
                    EXPECT_TRUE(near(agg.min, want[k]["min"].get<double>()));
                    EXPECT_TRUE(near(agg.max, want[k]["max"].get<double>()));
                    EXPECT_TRUE(near(agg.first, want[k]["first"].get<double>()));
                    EXPECT_TRUE(near(agg.last, want[k]["last"].get<double>()));
                    EXPECT_TRUE(near(agg.sumw, want[k]["sumw"].get<double>()));
                    ++k;
                }
            }
        }
        ++ran;
    }
    EXPECT_GE(ran, 1);
}
