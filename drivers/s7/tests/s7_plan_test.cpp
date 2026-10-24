// Read plan of the S7 driver (feature 016 T011, contracts/s7-driver.md §4): merging per (area, DB),
// packing into requests that fit the PDU, splitting an item.
#include <gtest/gtest.h>

#include <random>
#include <set>

#include "drivers/s7/plan.hpp"

using namespace mat::s7;

namespace {

PlanTag tag(size_t key, Area area, int db, int byte, int size) {
    PlanTag t;
    t.key = key;
    t.area = area;
    t.db = db;
    t.byte = byte;
    t.size = size;
    return t;
}

}  // namespace

TEST(S7Plan, MergesWithinGapPerAreaAndDb) {
    const std::vector<PlanTag> tags = {
        tag(0, Area::DB, 1, 0, 2),  tag(1, Area::DB, 1, 2, 4), tag(2, Area::DB, 1, 20, 4),
        tag(3, Area::DB, 1, 60, 1), tag(4, Area::DB, 2, 0, 2), tag(5, Area::M, 0, 10, 2),
        tag(6, Area::M, 0, 10, 1),  tag(7, Area::I, 0, 0, 1),
    };
    const auto items = mergeItems(tags, 16, 222);
    // DB1: [0,24) (gap 14), [60,61); DB2 [0,2); M [10,12); I [0,1)
    ASSERT_EQ(items.size(), 5u);
    std::set<std::tuple<int, int, int, int>> got;
    for (const auto& it : items)
        got.insert({static_cast<int>(it.item.area), it.item.db, it.item.byte, it.item.size});
    EXPECT_TRUE(got.count({static_cast<int>(Area::DB), 1, 0, 24}));
    EXPECT_TRUE(got.count({static_cast<int>(Area::DB), 1, 60, 1}));
    EXPECT_TRUE(got.count({static_cast<int>(Area::DB), 2, 0, 2}));
    EXPECT_TRUE(got.count({static_cast<int>(Area::M), 0, 10, 2}));
    EXPECT_TRUE(got.count({static_cast<int>(Area::I), 0, 0, 1}));
    for (const auto& it : items) EXPECT_EQ(it.item.bit, -1);
}

TEST(S7Plan, GapZeroOnlyTouching) {
    const std::vector<PlanTag> tags = {tag(0, Area::DB, 1, 0, 2), tag(1, Area::DB, 1, 2, 2),
                                       tag(2, Area::DB, 1, 5, 2)};
    EXPECT_EQ(mergeItems(tags, 0, 222).size(), 2u);
    EXPECT_EQ(mergeItems(tags, 1, 222).size(), 1u);
}

TEST(S7Plan, MaxLenCutsItems) {
    std::vector<PlanTag> tags;
    for (int i = 0; i < 100; ++i)
        tags.push_back(tag(static_cast<size_t>(i), Area::DB, 1, i * 4, 4));
    const auto items = mergeItems(tags, 16, 222);  // 400 bytes in items of <= 222
    ASSERT_EQ(items.size(), 2u);
    EXPECT_LE(items[0].item.size, 222);
    EXPECT_EQ(items[0].item.size + items[1].item.size, 400);
}

TEST(S7Plan, PacksAtMost20Items) {
    std::vector<ReadItem> items(25);
    for (size_t i = 0; i < items.size(); ++i) {
        items[i].item.byte = static_cast<int>(i) * 100;
        items[i].item.size = 2;
        items[i].keys = {i};
    }
    const auto reqs = packRequests(items, 960);
    ASSERT_EQ(reqs.size(), 2u);
    EXPECT_EQ(reqs[0].items.size(), 20u);
    EXPECT_EQ(reqs[1].items.size(), 5u);
}

TEST(S7Plan, PacksWithinPdu240) {
    std::vector<ReadItem> items(5);
    for (auto& it : items) it.item.size = 100;
    const auto reqs = packRequests(items, 240);
    ASSERT_EQ(reqs.size(), 3u);  // 14 + 2 * 104 = 222; a third item would make 326
    for (const auto& r : reqs) {
        EXPECT_LE(answerBytes(r), 240);
        EXPECT_LE(requestBytes(r), 240);
    }
}

TEST(S7Plan, OddItemsCountTheirFillByte) {
    // 14 + 4+111+1 + 4+107 = 241 > 240: the fill byte of the first item counts
    std::vector<ReadItem> items(2);
    items[0].item.size = 111;
    items[1].item.size = 107;
    EXPECT_EQ(packRequests(items, 240).size(), 2u);
    items[1].item.size = 106;  // 14 + 116 + 110 = 240
    const auto reqs = packRequests(items, 240);
    ASSERT_EQ(reqs.size(), 1u);
    EXPECT_EQ(answerBytes(reqs[0]), 240);
}

TEST(S7Plan, RandomPlansFitThePdu) {
    std::mt19937 rng(20261023);
    for (int round = 0; round < 200; ++round) {
        const int pdu = 240 + static_cast<int>(rng() % 721);
        std::vector<PlanTag> tags;
        const int n = 1 + static_cast<int>(rng() % 300);
        for (int i = 0; i < n; ++i) {
            const Area a = static_cast<Area>(rng() % 4);
            const int size = static_cast<int>(1 + rng() % 30);
            tags.push_back(tag(static_cast<size_t>(i), a,
                               a == Area::DB ? 1 + static_cast<int>(rng() % 3) : 0,
                               static_cast<int>(rng() % 2000), size));
        }
        const auto items = mergeItems(tags, static_cast<int>(rng() % 40), maxItemBytes(pdu));
        std::set<size_t> seen;
        for (const auto& it : items) {
            EXPECT_LE(it.item.size, maxItemBytes(pdu));
            for (size_t k : it.keys) {
                EXPECT_TRUE(seen.insert(k).second);
                const PlanTag& t = tags[k];
                EXPECT_EQ(t.area, it.item.area);
                EXPECT_EQ(t.db, it.item.db);
                EXPECT_GE(t.byte, it.item.byte);
                EXPECT_LE(t.byte + t.size, it.item.byte + it.item.size);
            }
        }
        EXPECT_EQ(seen.size(), tags.size());
        for (const auto& r : packRequests(items, pdu)) {
            EXPECT_LE(static_cast<int>(r.items.size()), kMaxItems);
            EXPECT_LE(requestBytes(r), pdu);
            EXPECT_LE(answerBytes(r), pdu);
        }
    }
}

TEST(S7Plan, SplitItem) {
    const std::vector<PlanTag> tags = {tag(0, Area::DB, 1, 0, 2), tag(1, Area::DB, 1, 2, 2),
                                       tag(2, Area::DB, 1, 12, 4)};
    const auto items = mergeItems(tags, 16, 222);
    ASSERT_EQ(items.size(), 1u);
    ReadItem a, b;
    ASSERT_TRUE(splitItem(items[0], tags, a, b));
    EXPECT_EQ(a.item.byte, 0);
    EXPECT_EQ(a.item.size, 4);
    EXPECT_EQ(b.item.byte, 12);
    EXPECT_EQ(b.item.size, 4);
    EXPECT_EQ(a.keys.size() + b.keys.size(), 3u);
    ReadItem one;
    one.keys = {0};
    EXPECT_FALSE(splitItem(one, tags, a, b));
}
