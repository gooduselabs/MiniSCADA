#include "core/tag-engine/tag_store.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <cmath>
#include <limits>
#include <thread>

using namespace mat;

namespace {
std::string json(const TagStore& s, size_t i) {
    std::string out;
    s.appendValueJson(out, i);
    return out;
}
}  // namespace

TEST(TagStore, IndexesAreStableAndLookupWorks) {
    TagStore s;
    EXPECT_EQ(s.add({"A.B", TagType::FLOAT32, "x"}), 0u);
    EXPECT_EQ(s.add({"C", TagType::BOOL, ""}), 1u);
    EXPECT_EQ(s.size(), 2u);
    EXPECT_EQ(*s.indexOf("C"), 1u);
    EXPECT_FALSE(s.indexOf("nope").has_value());
    EXPECT_EQ(s.def(0).id, "A.B");
    EXPECT_THROW(s.add({"C", TagType::BOOL, ""}), std::invalid_argument);
}

TEST(TagStore, NewTagHasNullValueAndBadQuality) {
    TagStore s;
    s.add({"T", TagType::FLOAT64, ""});
    EXPECT_EQ(json(s, 0), "null");
    EXPECT_EQ(s.get(0).quality, Quality::BAD);
    EXPECT_EQ(s.get(0).revision, 0u);
}

TEST(TagStore, RevisionIncreasesOnlyOnChange) {
    TagStore s;
    s.add({"T", TagType::FLOAT32, ""});
    EXPECT_TRUE(s.set(0, 1.5, Quality::GOOD, 10, 11));
    EXPECT_EQ(s.get(0).revision, 1u);
    EXPECT_FALSE(s.set(0, 1.5, Quality::GOOD, 20, 21));  // same value + quality
    EXPECT_EQ(s.get(0).revision, 1u);
    EXPECT_TRUE(s.set(0, 1.5, Quality::BAD, 30, 31));  // quality changed
    EXPECT_EQ(s.get(0).revision, 2u);
    EXPECT_EQ(s.get(0).sourceTs, 30);
    EXPECT_EQ(s.get(0).serverTs, 31);
}

TEST(TagStore, TakeDirtyReturnsChangedIndexesOnce) {
    TagStore s;
    for (int i = 0; i < 4; ++i) s.add({"T" + std::to_string(i), TagType::INT32, ""});
    s.set(2, int64_t{5}, Quality::GOOD, 0, 0);
    s.set(0, int64_t{1}, Quality::GOOD, 0, 0);
    s.set(2, int64_t{6}, Quality::GOOD, 0, 0);  // dirty twice -> reported once
    auto d = s.takeDirty();
    ASSERT_EQ(d.size(), 2u);
    EXPECT_EQ(d[0], 0u);
    EXPECT_EQ(d[1], 2u);
    EXPECT_TRUE(s.takeDirty().empty());
    s.set(0, int64_t{1}, Quality::GOOD, 0, 0);  // no change -> not dirty
    EXPECT_TRUE(s.takeDirty().empty());
}

TEST(TagStore, ValueJsonFollowsContract) {
    TagStore s;
    s.add({"B", TagType::BOOL, ""});
    s.add({"F", TagType::FLOAT32, ""});
    s.add({"I", TagType::INT16, ""});
    s.add({"L", TagType::INT64, ""});
    s.add({"U", TagType::UINT64, ""});
    s.add({"S", TagType::STRING, ""});
    s.add({"N", TagType::FLOAT64, ""});
    s.set(0, true, Quality::GOOD, 0, 0);
    s.set(1, 65.2, Quality::GOOD, 0, 0);
    s.set(2, int64_t{-12}, Quality::GOOD, 0, 0);
    s.set(3, int64_t{9007199254740993LL}, Quality::GOOD, 0, 0);
    s.set(4, uint64_t{18446744073709551615ULL}, Quality::GOOD, 0, 0);
    s.set(5, std::string("a\"b\\c\n"), Quality::GOOD, 0, 0);
    s.set(6, std::numeric_limits<double>::quiet_NaN(), Quality::GOOD, 0, 0);
    EXPECT_EQ(json(s, 0), "true");
    EXPECT_EQ(json(s, 1), "65.2");
    EXPECT_EQ(json(s, 2), "-12");
    EXPECT_EQ(json(s, 3), "\"9007199254740993\"");
    EXPECT_EQ(json(s, 4), "\"18446744073709551615\"");
    EXPECT_EQ(json(s, 5), "\"a\\\"b\\\\c\\n\"");
    EXPECT_EQ(json(s, 6), "null");
}

TEST(TagStore, ParseTypeAndQualityNames) {
    EXPECT_EQ(*parseTagType("UINT16"), TagType::UINT16);
    EXPECT_FALSE(parseTagType("DOUBLE").has_value());
    EXPECT_STREQ(qualityName(Quality::GOOD), "GOOD");
    EXPECT_STREQ(qualityName(Quality::UNCERTAIN), "UNCERTAIN");
    EXPECT_TRUE(isNumericType(TagType::FLOAT32));
    EXPECT_FALSE(isNumericType(TagType::BOOL));
    EXPECT_FALSE(isNumericType(TagType::STRING));
}

// Feature 003: the historian reads a whole logging group under one lock and must not consume the
// dirty set that belongs to the live hub.
TEST(TagStore, SnapshotReturnsRequestedIndexesWithoutTouchingDirty) {
    TagStore s;
    for (int i = 0; i < 3; ++i) s.add({"T" + std::to_string(i), TagType::FLOAT64, ""});
    s.set(0, 1.0, Quality::GOOD, 1, 1);
    s.set(2, 3.0, Quality::BAD, 2, 2);
    std::vector<TagValue> out{TagValue{}};  // stale content is replaced
    s.snapshot({2, 0, 1}, out);
    ASSERT_EQ(out.size(), 3u);
    EXPECT_EQ(std::get<double>(out[0].value), 3.0);
    EXPECT_EQ(out[0].quality, Quality::BAD);
    EXPECT_EQ(out[0].revision, 1u);
    EXPECT_EQ(std::get<double>(out[1].value), 1.0);
    EXPECT_EQ(out[1].quality, Quality::GOOD);
    EXPECT_TRUE(std::holds_alternative<std::monostate>(out[2].value));
    EXPECT_EQ(out[2].revision, 0u);
    EXPECT_THROW(s.snapshot({5}, out), std::out_of_range);
    EXPECT_EQ(s.takeDirty().size(), 2u);
}

// Review minor-1: INT64/UINT64 are strings on the wire even when a provider stores a double.
TEST(TagStore, Int64StoredAsDoubleIsStillAString) {
    TagStore s;
    s.add({"L", TagType::INT64, ""});
    s.add({"U", TagType::UINT64, ""});
    s.set(0, -42.0, Quality::GOOD, 0, 0);
    s.set(1, 7.6, Quality::GOOD, 0, 0);
    EXPECT_EQ(json(s, 0), "\"-42\"");
    EXPECT_EQ(json(s, 1), "\"8\"");
}

// Text from a device that is not UTF-8 never reaches the live JSON or the historian as is
// (specs/003-data-logging security review M1: browsers close the WebSocket on broken UTF-8).
TEST(TagStore, StringsAreStoredAsValidUtf8) {
    TagStore s;
    s.add({"S", TagType::STRING, ""});
    EXPECT_TRUE(s.set(0, std::string("p\xE9ss"), Quality::GOOD, 1, 1));
    EXPECT_EQ(std::get<std::string>(s.get(0).value), "p\xEF\xBF\xBDss");
    EXPECT_EQ(json(s, 0).find('\xE9'), std::string::npos);
    // the same broken text again is no change
    EXPECT_FALSE(s.set(0, std::string("p\xE9ss"), Quality::GOOD, 2, 2));
}

// ---- specs/006 T042: reason, applyBatch ----

TEST(TagStoreReason, IsStoredWithTheValueAndOnlyForANonGoodQuality) {
    TagStore s;
    s.add({"T", TagType::FLOAT32, ""});
    EXPECT_TRUE(s.set(0, 1.5, Quality::BAD, "TIMEOUT", 1, 1));
    EXPECT_EQ(s.get(0).reason, "TIMEOUT");
    EXPECT_TRUE(s.set(0, 1.5, Quality::GOOD, "STALE", 2, 2));  // a GOOD value has no reason
    EXPECT_EQ(s.get(0).reason, "");
}

TEST(TagStoreReason, ChangingOnlyTheReasonIsAChange) {
    TagStore s;
    s.add({"T", TagType::FLOAT32, ""});
    ASSERT_TRUE(s.set(0, 1.5, Quality::BAD, "TIMEOUT", 1, 1));
    s.takeDirty();
    const uint64_t rev = s.get(0).revision;
    EXPECT_FALSE(s.set(0, 1.5, Quality::BAD, "TIMEOUT", 2, 2));  // same value, quality, reason
    EXPECT_TRUE(s.set(0, 1.5, Quality::BAD, "DISCONNECTED", 3, 3));
    EXPECT_EQ(s.get(0).revision, rev + 1);
    EXPECT_EQ(s.takeDirty(), (std::vector<size_t>{0}));
}

TEST(TagStoreReason, JsonCarriesTheReasonOnlyWhenNotGood) {
    TagStore s;
    s.add({"T", TagType::FLOAT32, ""});
    s.add({"U", TagType::FLOAT32, ""});
    s.set(0, 1.5, Quality::GOOD, 1, 1);
    s.set(1, 2.5, Quality::UNCERTAIN, "CLAMPED", 1, 1);
    std::string a, b, d;
    s.appendSnapshotJson(a, 0);
    s.appendSnapshotJson(b, 1);
    EXPECT_EQ(a.find("reason"), std::string::npos);
    EXPECT_NE(b.find("\"quality\":\"UNCERTAIN\",\"reason\":\"CLAMPED\""), std::string::npos) << b;
    s.appendDeltaEntryJson(d, 3, 0);
    d += ' ';
    s.appendDeltaEntryJson(d, 4, 1);
    EXPECT_EQ(d, "[3,1.5,\"GOOD\"] [4,2.5,\"UNCERTAIN\",\"CLAMPED\"]");
}

TEST(TagStoreBatch, AppliesEverythingAndCountsTheChanges) {
    TagStore s;
    for (const char* id : {"A", "B", "C"}) s.add({id, TagType::FLOAT64, ""});
    s.set(1, 5.0, Quality::GOOD, 1, 1);
    s.takeDirty();
    std::vector<TagStore::Update> u;
    u.push_back({0, 1.0, Quality::GOOD, "", 10, 11});
    u.push_back({1, 5.0, Quality::GOOD, "", 10, 11});  // no change
    u.push_back({2, TagScalar{}, Quality::BAD, "NO_VALUE", 10, 11});
    EXPECT_EQ(s.applyBatch(u), 2u);
    EXPECT_EQ(s.takeDirty(), (std::vector<size_t>{0, 2}));
    EXPECT_EQ(s.get(2).reason, "NO_VALUE");
    EXPECT_EQ(s.get(1).sourceTs, 10);  // timestamps follow even without a change
}

TEST(TagStoreBatch, BadIndexAppliesNothing) {
    TagStore s;
    s.add({"A", TagType::FLOAT64, ""});
    std::vector<TagStore::Update> u;
    u.push_back({0, 1.0, Quality::GOOD, "", 1, 1});
    u.push_back({7, 1.0, Quality::GOOD, "", 1, 1});
    EXPECT_THROW(s.applyBatch(u), std::out_of_range);
    EXPECT_EQ(s.get(0).revision, 0u);
}

// A reader that takes snapshots in a loop never sees a round half applied: in every round A and B
// carry the same number.
TEST(TagStoreBatch, ConcurrentSnapshotNeverSeesAHalfAppliedRound) {
    TagStore s;
    s.add({"A", TagType::FLOAT64, ""});
    s.add({"B", TagType::FLOAT64, ""});
    std::atomic<bool> stop{false};
    std::atomic<uint64_t> torn{0}, reads{0};
    std::thread reader([&] {
        std::vector<TagValue> v;
        while (!stop) {
            s.snapshot({0, 1}, v);
            ++reads;
            const bool a = std::holds_alternative<double>(v[0].value);
            const bool b = std::holds_alternative<double>(v[1].value);
            if (a != b || (a && std::get<double>(v[0].value) != std::get<double>(v[1].value)))
                ++torn;
        }
    });
    for (int i = 1; i <= 20000; ++i) {
        std::vector<TagStore::Update> u;
        u.push_back({0, static_cast<double>(i), Quality::GOOD, "", i, i});
        u.push_back({1, static_cast<double>(i), Quality::GOOD, "", i, i});
        s.applyBatch(u);
    }
    stop = true;
    reader.join();
    EXPECT_EQ(torn.load(), 0u);
    EXPECT_GT(reads.load(), 0u);
}
