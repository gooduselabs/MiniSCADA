// Merging of read requests and splitting on exception 02/03 (FR-024, FR-025; contract §7, R8).
#include "drivers/sdk/merge_planner.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <set>

using namespace mat::drv;

namespace {

std::vector<PlanItem> consecutive(int n, int width, int first = 0, int gap = 0) {
    std::vector<PlanItem> v;
    int at = first;
    for (int i = 0; i < n; ++i) {
        v.push_back({static_cast<size_t>(i), at, at + width});
        at += width + gap;
    }
    return v;
}

// Tiny deterministic generator (LCG) so the property tests do not depend on the platform.
struct Lcg {
    uint32_t s;
    uint32_t next() {
        s = s * 1664525u + 1013904223u;
        return s >> 8;
    }
    int in(int lo, int hi) {
        return lo + static_cast<int>(next() % static_cast<uint32_t>(hi - lo + 1));
    }
};

// Smallest number of blocks over every way to cut the sorted list into runs that are valid blocks
// (a cut may fall between overlapping spans: the planner reads such a Tag twice when a chain of
// overlaps is longer than maxLen).
size_t bruteForceBlocks(std::vector<PlanItem> items, int maxGap, int maxLen) {
    std::sort(items.begin(), items.end(), [](const PlanItem& a, const PlanItem& b) {
        return a.start != b.start ? a.start < b.start : a.end < b.end;
    });
    const size_t n = items.size();
    size_t best = n + 1;
    for (uint32_t mask = 0; mask < (1u << (n - 1)); ++mask) {  // bit i set: cut after item i
        bool ok = true;
        size_t blocks = 1;
        int reach = items[0].end;
        int start = items[0].start;
        for (size_t i = 0; i + 1 < n && ok; ++i) {
            reach = std::max(reach, items[i].end);
            const int next = items[i + 1].start;
            if (mask & (1u << i)) {
                ++blocks;
                start = next;
                reach = items[i + 1].end;
            } else {
                if (next - reach > maxGap) ok = false;
                if (std::max(reach, items[i + 1].end) - start > maxLen) ok = false;
            }
        }
        if (ok) best = std::min(best, blocks);
    }
    return best;
}

}  // namespace

TEST(MergePlanner, FiftyFloat32InARowAreOneRequestOf100Registers) {  // US1-6
    const auto blocks = planBlocks(consecutive(50, 2), 10, 125);
    ASSERT_EQ(blocks.size(), 1u);
    EXPECT_EQ(blocks[0].start, 0);
    EXPECT_EQ(blocks[0].end, 100);
    EXPECT_EQ(blocks[0].items.size(), 50u);
}

TEST(MergePlanner, ThirtyHundredAndThirtyRegistersAreTwoRequests) {
    const auto blocks = planBlocks(consecutive(65, 2), 10, 125);  // 130 registers
    ASSERT_EQ(blocks.size(), 2u);
    EXPECT_LE(blocks[0].size(), 125);
    EXPECT_LE(blocks[1].size(), 125);
    EXPECT_EQ(blocks[0].end, blocks[1].start);
}

TEST(MergePlanner, BitAreaUpTo2000BitsInOneRequest) {
    EXPECT_EQ(planBlocks(consecutive(2000, 1), 64, 2000).size(), 1u);
    EXPECT_EQ(planBlocks(consecutive(2001, 1), 64, 2000).size(), 2u);
}

TEST(MergePlanner, GapRules) {
    // two Tags 10 registers apart merge with maxGap 10, not with 9; 0 merges only touching Tags
    const std::vector<PlanItem> items = {{0, 0, 2}, {1, 12, 14}};
    EXPECT_EQ(planBlocks(items, 10, 125).size(), 1u);
    EXPECT_EQ(planBlocks(items, 9, 125).size(), 2u);
    const std::vector<PlanItem> touching = {{0, 0, 2}, {1, 2, 4}, {2, 5, 7}};
    const auto b = planBlocks(touching, 0, 125);
    ASSERT_EQ(b.size(), 2u);
    EXPECT_EQ(b[0].items.size(), 2u);
}

TEST(MergePlanner, SameAddressOverlapGoesToOneBlockReadOnce) {
    const std::vector<PlanItem> items = {{0, 100, 102}, {1, 100, 102}, {2, 101, 103}};
    const auto blocks = planBlocks(items, 0, 125);
    ASSERT_EQ(blocks.size(), 1u);
    EXPECT_EQ(blocks[0].start, 100);
    EXPECT_EQ(blocks[0].end, 103);
    EXPECT_EQ(blocks[0].items.size(), 3u);
}

TEST(MergePlanner, PropertyEveryTagInExactlyOneBlockWithinLimits) {
    Lcg rng{12345};
    for (int round = 0; round < 400; ++round) {
        const int n = rng.in(1, 40);
        const int maxGap = rng.in(0, 12);
        const int maxLen = rng.in(8, 30);
        std::vector<PlanItem> items;
        for (int i = 0; i < n; ++i) {
            const int s = rng.in(0, 200);
            items.push_back({static_cast<size_t>(i), s, s + rng.in(1, 4)});
        }
        const auto blocks = planBlocks(items, maxGap, maxLen);
        std::multiset<size_t> seen;
        for (const auto& b : blocks) {
            EXPECT_LE(b.size(), maxLen);
            for (size_t k : b.items) {
                seen.insert(k);
                EXPECT_GE(items[k].start, b.start);
                EXPECT_LE(items[k].end, b.end);
            }
            // gaps inside a block never exceed maxGap
            std::vector<PlanItem> mine;
            for (size_t k : b.items) mine.push_back(items[k]);
            std::sort(mine.begin(), mine.end(),
                      [](const PlanItem& a, const PlanItem& c) { return a.start < c.start; });
            int reach = mine[0].end;
            for (size_t i = 1; i < mine.size(); ++i) {
                EXPECT_LE(mine[i].start - reach, maxGap);
                reach = std::max(reach, mine[i].end);
            }
        }
        EXPECT_EQ(seen.size(), static_cast<size_t>(n));
        EXPECT_EQ(std::set<size_t>(seen.begin(), seen.end()).size(), static_cast<size_t>(n));
    }
}

TEST(MergePlanner, PropertyMatchesExhaustiveSearchUpToEightTags) {
    Lcg rng{777};
    for (int round = 0; round < 300; ++round) {
        const int n = rng.in(1, 8);
        const int maxGap = rng.in(0, 8);
        const int maxLen = rng.in(6, 20);
        std::vector<PlanItem> items;
        for (int i = 0; i < n; ++i) {
            const int s = rng.in(0, 40);
            items.push_back({static_cast<size_t>(i), s, s + rng.in(1, 4)});
        }
        EXPECT_EQ(planBlocks(items, maxGap, maxLen).size(), bruteForceBlocks(items, maxGap, maxLen))
            << round;
    }
}

TEST(MergePlanner, SplitAtTheLargestGap) {
    // gaps: 2 after item 0, 9 after item 1, 2 after item 2
    const std::vector<PlanItem> items = {{0, 0, 2}, {1, 4, 6}, {2, 15, 17}, {3, 19, 21}};
    const auto blocks = planBlocks(items, 10, 125);
    ASSERT_EQ(blocks.size(), 1u);
    Block a, b;
    ASSERT_TRUE(splitBlock(items, blocks[0], a, b));
    EXPECT_EQ(a.items.size(), 2u);
    EXPECT_EQ(b.items.size(), 2u);
    EXPECT_EQ(a.start, 0);
    EXPECT_EQ(a.end, 6);
    EXPECT_EQ(b.start, 15);
    EXPECT_EQ(b.end, 21);
}

TEST(MergePlanner, SplitTieGoesToTheGapNearestTheMiddle) {
    // four Tags, equal gaps of 3: the middle cut is after the second
    const auto items = consecutive(4, 2, 0, 3);
    const auto blocks = planBlocks(items, 10, 125);
    Block a, b;
    ASSERT_TRUE(splitBlock(items, blocks[0], a, b));
    EXPECT_EQ(a.items.size(), 2u);
    EXPECT_EQ(b.items.size(), 2u);
}

TEST(MergePlanner, SplitWithoutGapAtTheTagBoundaryNearestTheMiddle) {
    const auto items =
        consecutive(5, 2);  // 0-2 2-4 4-6 6-8 8-10: middle is 5, nearest boundary 4 or 6
    const auto blocks = planBlocks(items, 0, 125);
    Block a, b;
    ASSERT_TRUE(splitBlock(items, blocks[0], a, b));
    EXPECT_EQ(a.items.size() + b.items.size(), 5u);
    EXPECT_TRUE(a.items.size() == 2 || a.items.size() == 3);
    EXPECT_EQ(a.end, b.start);
}

TEST(MergePlanner, ASingleTagCannotBeSplit) {
    const std::vector<PlanItem> items = {{0, 10, 12}};
    const auto blocks = planBlocks(items, 10, 125);
    Block a, b;
    EXPECT_FALSE(splitBlock(items, blocks[0], a, b));
}

TEST(MergePlanner, OverlappingTagsAreOneUnitThatCannotBeCut) {
    const std::vector<PlanItem> items = {{0, 100, 104}, {1, 102, 106}};
    const auto blocks = planBlocks(items, 0, 125);
    ASSERT_EQ(blocks.size(), 1u);
    Block a, b;
    EXPECT_FALSE(splitBlock(items, blocks[0], a, b));
}

namespace {

// Rounds until every bad Tag is isolated. A block fails when it covers a bad Tag's span; a failing
// block of several Tags is split, of one Tag marks that Tag bad. Returns the number of rounds in
// which something was split, and the set of Tags marked bad.
struct Convergence {
    int splitRounds = 0;
    std::set<size_t> bad;
    size_t okBlocksAtEnd = 0;
};

Convergence converge(const std::vector<PlanItem>& items, const std::set<size_t>& badTags,
                     const std::vector<std::pair<int, int>>& holes = {}) {
    Convergence out;
    std::vector<Block> blocks = planBlocks(items, 1000, 100000);
    for (int guard = 0; guard < 64; ++guard) {
        std::vector<Block> next;
        bool split = false;
        for (const Block& b : blocks) {
            bool fails = false;
            for (size_t k : b.items)
                if (badTags.count(items[k].tag)) fails = true;
            for (const auto& h : holes)
                if (h.first < b.end && b.start < h.second) fails = true;
            if (!fails) {
                next.push_back(b);
                ++out.okBlocksAtEnd;
                continue;
            }
            Block x, y;
            if (splitBlock(items, b, x, y)) {
                next.push_back(x);
                next.push_back(y);
                split = true;
            } else {
                for (size_t k : b.items) out.bad.insert(items[k].tag);
                next.push_back(b);
            }
        }
        out.okBlocksAtEnd = 0;
        blocks = next;
        if (!split) break;
        ++out.splitRounds;
    }
    return out;
}

int ceilLog2(size_t n) {
    int k = 0;
    while ((size_t{1} << k) < n) ++k;
    return k;
}

}  // namespace

TEST(MergePlanner, SplitConvergesToTheBadTagInCeilLog2Rounds) {
    for (int n : {2, 3, 7, 16, 50, 125}) {
        const auto items = consecutive(n, 1);
        for (int bad : {0, n / 2, n - 1}) {
            const Convergence c = converge(items, {static_cast<size_t>(bad)});
            EXPECT_LE(c.splitRounds, ceilLog2(static_cast<size_t>(n)))
                << "n=" << n << " bad=" << bad;
            EXPECT_EQ(c.bad, (std::set<size_t>{static_cast<size_t>(bad)}))
                << "n=" << n << " bad=" << bad;
        }
    }
}

TEST(MergePlanner, SeveralBadTagsAreAllFound) {
    const auto items = consecutive(64, 2);
    const Convergence c = converge(items, {3, 4, 40, 63});
    EXPECT_EQ(c.bad, (std::set<size_t>{3, 4, 40, 63}));
    EXPECT_LE(c.splitRounds, 6);
}

TEST(MergePlanner, AHoleInTheGapBetweenTwoGoodTagsIsFoundInOneRound) {
    // 3 Tags, then a gap with a hole at 50, then 3 Tags
    std::vector<PlanItem> items = {{0, 0, 2},     {1, 2, 4},     {2, 4, 6},
                                   {3, 100, 102}, {4, 102, 104}, {5, 104, 106}};
    const Convergence c = converge(items, {}, {{50, 51}});
    EXPECT_EQ(c.splitRounds, 1);
    EXPECT_TRUE(c.bad.empty());
}
