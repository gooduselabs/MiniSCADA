// CSV text of the history export (specs/010-history-reports contracts/history-api.md §6, FR-024).
#include "core/historian/query/csv_writer.hpp"

#include <gtest/gtest.h>

using namespace mat;

TEST(CsvWriter, NumbersAreFifteenSignificantDigitsWithADot) {
    EXPECT_EQ(csvNumber(65.2), "65.2");
    EXPECT_EQ(csvNumber(0.1), "0.1");
    EXPECT_EQ(csvNumber(1.0), "1");
    EXPECT_EQ(csvNumber(-5.5), "-5.5");
    EXPECT_EQ(csvNumber(1e20), "1e+20");
    EXPECT_EQ(csvNumber(123456789012345678.0), "1.23456789012346e+17");
    EXPECT_EQ(csvNumber(std::nan("")), "");
}

TEST(CsvWriter, TextIsQuotedWhenItHoldsASeparatorQuoteOrLineBreak) {
    EXPECT_EQ(csvEscapeText("abc"), "abc");
    EXPECT_EQ(csvEscapeText("a,b"), "\"a,b\"");
    EXPECT_EQ(csvEscapeText("say \"hi\""), "\"say \"\"hi\"\"\"");
    EXPECT_EQ(csvEscapeText("l1\nl2"), "\"l1\nl2\"");
    EXPECT_EQ(csvEscapeText("l1\r\nl2"), "\"l1\r\nl2\"");
    EXPECT_EQ(csvEscapeText("Điện áp, tiếng Việt"), "\"Điện áp, tiếng Việt\"");
}

TEST(CsvWriter, TextThatStartsLikeAFormulaIsMadeHarmless) {
    EXPECT_EQ(csvEscapeText("=1+1"), "'=1+1");
    EXPECT_EQ(csvEscapeText("+cmd"), "'+cmd");
    EXPECT_EQ(csvEscapeText("-2"), "'-2");
    EXPECT_EQ(csvEscapeText("@SUM(A1)"), "'@SUM(A1)");
    EXPECT_EQ(csvEscapeText("\tx"), "'\tx");
    EXPECT_EQ(csvEscapeText("=a,b"), "\"'=a,b\"");  // guard first, then quoting
    EXPECT_EQ(csvEscapeText("a=b"), "a=b");         // only the first character counts
    // numbers are never touched: a negative number cell stays a number
    EXPECT_EQ(csvCell(Cell{-5.5}), "-5.5");
    EXPECT_EQ(csvCell(Cell{int64_t{-3}}), "-3");
    EXPECT_EQ(csvCell(Cell{std::string("-3")}), "'-3");  // but a TEXT cell is text
}

TEST(CsvWriter, CellsOfEveryKind) {
    EXPECT_EQ(csvCell(Cell{}), "");
    EXPECT_EQ(csvCell(Cell{true}), "1");
    EXPECT_EQ(csvCell(Cell{uint64_t{18446744073709551615ULL}}), "18446744073709551615");
    EXPECT_EQ(csvCell(Cell{2.5}), "2.5");
}

TEST(CsvWriter, TimeInTheLocalTimeOfTheGroup) {
    // 2026-10-10T01:00:00Z
    constexpr int64_t kT = 1791594000000;
    EXPECT_EQ(csvTime(kT, 420, 0), "2026-10-10 08:00:00.000");
    EXPECT_EQ(csvTime(kT + 1234, 420, 0), "2026-10-10 08:00:01.234");
    EXPECT_EQ(csvTime(kT, 420, 60000), "2026-10-10 08:00");
    EXPECT_EQ(csvTime(kT + 59000, 420, 3600000), "2026-10-10 08:00");
    EXPECT_EQ(csvTime(kT, 330, 0), "2026-10-10 06:30:00.000");  // +05:30
    // across midnight: 20:00Z is 03:00 the next day at +07:00
    EXPECT_EQ(csvTime(kT + 19 * 3600000, 420, 0), "2026-10-11 03:00:00.000");
    EXPECT_EQ(csvTime(kT + 19 * 3600000, 420, 3600000), "2026-10-11 03:00");
}

TEST(CsvWriter, HeaderAndLinesUseCrLf) {
    EXPECT_EQ(csvHeader({"A", "B.avg"}), "time,A,B.avg\r\n");
    EXPECT_EQ(csvLine("2026-10-10 08:00", {"1", "", "x"}), "2026-10-10 08:00,1,,x\r\n");
    EXPECT_STREQ(csvBom(), "\xEF\xBB\xBF");
}

TEST(CsvWriter, ChunksAreNeverLargerThan64KiB) {
    std::vector<size_t> sizes;
    CsvChunker c([&](const std::string& s) {
        sizes.push_back(s.size());
        return true;
    });
    const std::string line(1000, 'x');
    for (int i = 0; i < 300; ++i) ASSERT_TRUE(c.append(line));
    ASSERT_TRUE(c.flush());
    size_t total = 0;
    for (size_t s : sizes) {
        EXPECT_LE(s, kCsvChunkBytes);
        total += s;
    }
    EXPECT_EQ(total, 300000u);
    EXPECT_GE(sizes.size(), 5u);
}

TEST(CsvWriter, AGoneReaderStopsTheChunker) {
    int calls = 0;
    CsvChunker c([&](const std::string&) { return ++calls < 2; }, 10);
    EXPECT_TRUE(c.append(std::string(10, 'a')));
    EXPECT_FALSE(c.append(std::string(10, 'b')));
    EXPECT_FALSE(c.ok());
    EXPECT_FALSE(c.append("more"));
    EXPECT_EQ(calls, 2);
}
