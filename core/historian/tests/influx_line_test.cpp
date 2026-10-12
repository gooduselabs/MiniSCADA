// InfluxDB line protocol for wide rows (specs/003-data-logging/contracts/external-schema.md).
#include "core/historian/forward/influx_line.hpp"

#include <gtest/gtest.h>

using namespace mat;

namespace {
constexpr int64_t kT0 = 1791594000000;

const std::vector<InfluxColumn> kCols{{"MUC BON", TagType::FLOAT32},
                                      {"RUN", TagType::BOOL},
                                      {"COUNT", TagType::UINT64},
                                      {"N", TagType::INT32},
                                      {"NOTE", TagType::STRING}};
}  // namespace

TEST(InfluxLine, EscapesNamesAndValues) {
    EXPECT_EQ(influxEscapeMeasurement("a,b c"), "a\\,b\\ c");
    EXPECT_EQ(influxEscapeKey("k=1,x y"), "k\\=1\\,x\\ y");
    EXPECT_EQ(influxString("say \"hi\" \\ ok"), "\"say \\\"hi\\\" \\\\ ok\"");
}

TEST(InfluxLine, OneWideRowIsOnePoint) {
    StoredRow r{
        7,
        kT0,
        {65.2, int64_t{1}, std::string("18446744073709551615"), int64_t{-3}, std::string("ok")}};
    EXPECT_EQ(influxLine("bao_cao_ca", "src-1", kCols, r),
              "bao_cao_ca,source=src-1 MUC\\ BON=65.2,RUN=true,COUNT=18446744073709551615u,N=-3i,"
              "NOTE=\"ok\" 1791594000000");
}

TEST(InfluxLine, EmptyCellsAreLeftOut) {
    StoredRow r{8, kT0, {Cell{}, int64_t{0}, Cell{}, Cell{}, Cell{}}};
    EXPECT_EQ(influxLine("t", "s", kCols, r), "t,source=s RUN=false 1791594000000");
    StoredRow none{9, kT0, {Cell{}, Cell{}, Cell{}, Cell{}, Cell{}}};
    EXPECT_EQ(influxLine("t", "s", kCols, none), "");  // no field: no point
    StoredRow junk{10, kT0, {Cell{}, Cell{}, std::string("12x"), Cell{}, Cell{}}};
    EXPECT_EQ(influxLine("t", "s", kCols, junk), "");  // not a number: never sent
}

TEST(InfluxLine, BodiesRespectLineAndByteLimits) {
    std::vector<StoredRow> rows;
    for (int i = 0; i < 12; ++i)
        rows.push_back({i + 1, kT0 + i, {1.0 * i, int64_t{1}, Cell{}, Cell{}, Cell{}}});
    rows[5].cells = {Cell{}, Cell{}, Cell{}, Cell{}, Cell{}};  // empty row: skipped, still counted
    auto bodies = influxBodies("t", "s", kCols, rows, /*maxLines=*/5, /*maxBytes=*/1 << 20);
    ASSERT_EQ(bodies.size(), 3u);
    EXPECT_EQ(bodies[0].lines, 5u);
    EXPECT_EQ(bodies[0].lastSeq, 5);
    EXPECT_EQ(bodies[1].lines, 5u);
    EXPECT_EQ(bodies[1].lastSeq, 11);  // seq 6 had no field
    EXPECT_EQ(bodies[2].lines, 1u);
    EXPECT_EQ(bodies[2].lastSeq, 12);
    auto small = influxBodies("t", "s", kCols, rows, 5000, /*maxBytes=*/120);
    EXPECT_GT(small.size(), 3u);
    for (const auto& b : small) EXPECT_LE(b.text.size(), 120u);
}

// Security review M1: broken UTF-8 never reaches the server.
TEST(InfluxLine, StringsAreValidUtf8) { EXPECT_EQ(influxString("OK\xC3"), "\"OK\xEF\xBF\xBD\""); }

// Review I3 and its review: points the server drops in a partial write (older than the bucket
// keeps, a field of another type) are counted, the rest of the batch was written. Only the
// "message" of the JSON answer counts (InfluxDB 3 repeats the line, Tag text included), and never
// more points than the body had.
TEST(InfluxLine, PartialWriteIsRecognized) {
    const auto retention = influxPartialWrite(
        422,
        R"({"code":"unprocessable entity","message":"failure writing points to database: )"
        R"(partial write: dropped 3 points outside retention policy of duration 1h0m0s - oldest )"
        R"(point it_short,source=x at 2026-10-08T15:16:45.354Z dropped because it violates a )"
        R"(Retention Policy Lower Bound dropped=3"})",
        6);
    ASSERT_TRUE(retention);
    EXPECT_EQ(retention->dropped, 3u);
    EXPECT_TRUE(retention->retentionOnly);
    const auto conflict = influxPartialWrite(
        400,
        R"({"code":"invalid","message":"partial write: field type conflict: input field )"
        R"(\"V\" on measurement \"g\" is type integer, already exists as type float dropped=1"})",
        5);
    ASSERT_TRUE(conflict);
    EXPECT_EQ(conflict->dropped, 1u);
    EXPECT_FALSE(conflict->retentionOnly);
    EXPECT_EQ(influxPartialWrite(
                  422, R"({"message":"partial write: dropped 7 points outside retention"})", 10)
                  ->dropped,
              7u);
    EXPECT_EQ(influxPartialWrite(422, R"({"message":"partial write"})", 10)->dropped, 0u);
    // the count comes from the message only, and never above the lines sent
    EXPECT_EQ(influxPartialWrite(422,
                                 R"({"message":"partial write: dropped=2","original_line":)"
                                 R"("t,source=x S=\"dropped=999\""})",
                                 10)
                  ->dropped,
              2u);
    EXPECT_EQ(influxPartialWrite(422, R"({"message":"partial write: dropped=999"})", 4)->dropped,
              4u);
    EXPECT_FALSE(influxPartialWrite(422, "partial write dropped=1", 4));  // not JSON
    EXPECT_FALSE(
        influxPartialWrite(404, R"({"code":"not found","message":"bucket \"b\" not found"})", 4));
    EXPECT_FALSE(influxPartialWrite(503, R"({"message":"partial write dropped=1"})", 4));
    EXPECT_FALSE(influxPartialWrite(204, "", 4));
    // only a message that starts with it: a refused line quoted in the message holds Tag text
    EXPECT_FALSE(influxPartialWrite(
        400, R"({"code":"invalid","message":"unable to parse 't S=\"partial write: dropped=1\"'"})",
        4));
}

// Review of the fixes (Important 4), replies of a real InfluxDB 3 Core 3.12. Its own write API
// reports a partial write as {"error": …, "data": [one entry per refused line]}; through the v2
// API that the runtime uses, a line of another type refuses the whole batch ("invalid", nothing
// stored): not a partial write, the rows stay on the device and the destination shows the error.
TEST(InfluxLine, InfluxDb3Replies) {
    const auto partial = influxPartialWrite(
        400,
        R"({"error":"partial write of line protocol occurred","data":[{"error_message":"invalid )"
        R"(column type for column 'V', expected iox::column_type::field::float, got )"
        R"(iox::column_type::field::string","line_number":2,"original_line":"t,source=a V=again )"
        R"(1"}]})",
        3);
    ASSERT_TRUE(partial);
    EXPECT_EQ(partial->dropped, 1u);  // one entry per refused line
    EXPECT_FALSE(partial->retentionOnly);
    // a reply cut at 4096 bytes is not JSON any more: still a partial write, count unknown
    const auto cut = influxPartialWrite(
        400, R"({"error":"partial write of line protocol occurred","data":[{"error_mess)", 3);
    ASSERT_TRUE(cut);
    EXPECT_EQ(cut->dropped, 0u);
    EXPECT_FALSE(cut->retentionOnly);
    EXPECT_FALSE(influxPartialWrite(
        400,
        R"({"code":"invalid","message":"write buffer error: line protocol parse failed: invalid )"
        R"(column type for column 'V', expected iox::column_type::field::float, got )"
        R"(iox::column_type::field::string"})",
        3));
}

// A UINT64 Tag read as a double above 2^63 keeps its value.
TEST(InfluxLine, LargeUnsignedFromADouble) {
    const std::vector<InfluxColumn> cols{{"C", TagType::UINT64}};
    EXPECT_EQ(influxLine("t", "src", cols, StoredRow{1, kT0, {1.8e19}}),
              "t,source=src C=18000000000000000000u " + std::to_string(kT0));
}

// NUL never reaches the server (as in SQL text).
TEST(InfluxLine, StringsHaveNoNul) { EXPECT_EQ(influxString(std::string("a\0b", 3)), "\"ab\""); }
