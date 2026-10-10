#include "core/tag-engine/tag_store.hpp"

#include <gtest/gtest.h>

#include <cmath>
#include <limits>

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
