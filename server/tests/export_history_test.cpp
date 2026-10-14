// `mat-runtime --export-history` (specs/003-data-logging/contracts/device.md).
#include "server/cli/export_history.hpp"

#include <fcntl.h>
#include <gtest/gtest.h>
#include <unistd.h>

#include <sstream>

#include "core/historian/local_store.hpp"
#include "sqlite3.h"

using namespace mat;

namespace {
constexpr int64_t kT0 = 1791594000000;  // 2026-10-10 08:00 at +07:00

std::string makeStore() {
    char tmpl[] = "/tmp/mat-export-XXXXXX";
    std::string dir = mkdtemp(tmpl);
    LocalStore s(dir, [] { return kT0; });
    std::string err;
    EXPECT_TRUE(s.open(err)) << err;
    TableSpec t;
    t.table = "bao_cao_ca";
    t.groupId = "bao-cao-ca";
    t.retentionDays = 365;
    t.columns = {{"MUC_BON", "REAL"}, {"NOTE", "TEXT"}, {"RUN", "INTEGER"}};
    EXPECT_TRUE(s.ensureTables({t}, err)) << err;
    EXPECT_TRUE(s.commit({{0, kT0, {65.2, std::string("a,b"), int64_t{1}}},
                          {0, kT0 + 60000, {Cell{}, std::string("say \"hi\"\nline2"), int64_t{0}}},
                          {0, kT0 + 120000, {66.0, Cell{}, int64_t{1}}}},
                         err))
        << err;
    return dir;
}

struct Run {
    int code;
    std::string out;
    std::string err;
};

Run run(std::vector<std::string> args, int64_t now = kT0 + 3 * 3600000LL, bool terminal = false) {
    args.insert(args.begin(), "mat-runtime");
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(&a[0]);
    std::ostringstream out, err;
    const int code =
        runExportHistoryCli(static_cast<int>(argv.size()), argv.data(), out, err, now, terminal);
    return {code, out.str(), err.str()};
}

Run runCheck(std::vector<std::string> args) {
    args.insert(args.begin(), "mat-runtime");
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(&a[0]);
    std::ostringstream out, err;
    const int code = runCheckHistoryCli(static_cast<int>(argv.size()), argv.data(), out, err);
    return {code, out.str(), err.str()};
}

// Overwrites the root page of a table with junk (the store is closed: its WAL is in the file).
void damageRootPage(const std::string& dir, const std::string& table) {
    sqlite3* db = nullptr;
    ASSERT_EQ(sqlite3_open_v2((dir + "/history.db").c_str(), &db, SQLITE_OPEN_READONLY, nullptr),
              SQLITE_OK);
    sqlite3_stmt* q = nullptr;
    ASSERT_EQ(sqlite3_prepare_v2(db, "SELECT rootpage FROM sqlite_master WHERE name = ?", -1, &q,
                                 nullptr),
              SQLITE_OK);
    sqlite3_bind_text(q, 1, table.c_str(), -1, SQLITE_TRANSIENT);
    ASSERT_EQ(sqlite3_step(q), SQLITE_ROW);
    const int64_t page = sqlite3_column_int64(q, 0);
    sqlite3_finalize(q);
    sqlite3_close(db);
    const int fd = ::open((dir + "/history.db").c_str(), O_WRONLY);
    ASSERT_GE(fd, 0);
    const std::string junk(4096, '\xff');
    ASSERT_EQ(::pwrite(fd, junk.data(), junk.size(), static_cast<off_t>((page - 1) * 4096)), 4096);
    ::close(fd);
}
}  // namespace

// ---- --check-history (T077, SC-008): the file checked on the device, e.g. after a power cut

TEST(CheckHistory, ASoundFileIsOkWithTheRowsOfEveryTable) {
    const std::string dir = makeStore();
    auto r = runCheck({"--check-history", "--data-dir", dir});
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_NE(r.out.find("integrity: ok\n"), std::string::npos) << r.out;
    EXPECT_NE(r.out.find("bao_cao_ca: 3 rows\n"), std::string::npos) << r.out;
}

TEST(CheckHistory, ADamagedPageIsReported) {
    const std::string dir = makeStore();
    damageRootPage(dir, "log_bao_cao_ca");
    auto r = runCheck({"--check-history", "--data-dir", dir});
    EXPECT_EQ(r.code, 6) << r.out << r.err;
    EXPECT_EQ(r.out.find("integrity: ok"), std::string::npos) << r.out;
    EXPECT_NE(r.out.find("integrity:"), std::string::npos) << r.out;
}

TEST(CheckHistory, NoFileIsAnError) {
    char tmpl[] = "/tmp/mat-check-XXXXXX";
    const std::string dir = mkdtemp(tmpl);
    auto r = runCheck({"--check-history", "--data-dir", dir});
    EXPECT_EQ(r.code, 4);
    EXPECT_FALSE(r.err.empty());
}

TEST(ExportHistory, WritesCsvInLocalTime) {
    const std::string dir = makeStore();
    auto r = run({"--export-history", "bao-cao-ca", "--from", "2026-10-10 08:00", "--to",
                  "2026-10-10 08:01:30", "--data-dir", dir});
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_EQ(r.out,
              "time,MUC_BON,NOTE,RUN\n"
              "2026-10-10 08:00:00.000,65.2,\"a,b\",1\n"
              "2026-10-10 08:01:00.000,,\"say \"\"hi\"\"\nline2\",0\n");
}

TEST(ExportHistory, DefaultRangeIsTheLast24Hours) {
    const std::string dir = makeStore();
    auto r = run({"--export-history", "bao-cao-ca", "--data-dir", dir});
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_NE(r.out.find("2026-10-10 08:02:00.000,66,,1\n"), std::string::npos) << r.out;
    auto old = run({"--export-history", "bao-cao-ca", "--data-dir", dir}, kT0 + 25 * 3600000LL);
    ASSERT_EQ(old.code, 0);
    EXPECT_EQ(old.out, "time,MUC_BON,NOTE,RUN\n");  // header only
}

TEST(ExportHistory, OtherTimeZone) {
    const std::string dir = makeStore();
    auto r = run({"--export-history", "bao-cao-ca", "--from", "2026-10-10 01:00", "--to",
                  "2026-10-10 01:00:30", "--tz", "+00:00", "--data-dir", dir});
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_EQ(r.out, "time,MUC_BON,NOTE,RUN\n2026-10-10 01:00:00.000,65.2,\"a,b\",1\n");
}

TEST(ExportHistory, ErrorsHaveExitCodes) {
    const std::string dir = makeStore();
    EXPECT_EQ(run({"--export-history", "nope", "--data-dir", dir}).code, 4);
    EXPECT_EQ(run({"--export-history", "bao-cao-ca", "--data-dir", "/nonexistent"}).code, 4);
    EXPECT_EQ(
        run({"--export-history", "bao-cao-ca", "--from", "yesterday", "--data-dir", dir}).code, 2);
    EXPECT_EQ(run({"--export-history", "bao-cao-ca", "--tz", "7", "--data-dir", dir}).code, 2);
    EXPECT_EQ(run({"--export-history"}).code, 2);
    EXPECT_EQ(run({"--export-history", "bao-cao-ca", "--bogus", "--data-dir", dir}).code, 2);
}

// Security review M3: text a spreadsheet would run as a formula (= + - @, tab, CR first) gets a
// leading apostrophe; numbers, negative ones too, stay numbers.
TEST(ExportHistory, TextASpreadsheetWouldRunIsNotAFormula) {
    char tmpl[] = "/tmp/mat-export-XXXXXX";
    const std::string dir = mkdtemp(tmpl);
    LocalStore s(dir, [] { return kT0; });
    std::string err;
    ASSERT_TRUE(s.open(err)) << err;
    TableSpec t;
    t.table = "t";
    t.groupId = "g";
    t.retentionDays = 7;
    t.columns = {{"N", "REAL"}, {"S", "TEXT"}};
    ASSERT_TRUE(s.ensureTables({t}, err)) << err;
    ASSERT_TRUE(s.commit({{0, kT0, {-5.5, std::string("=HYPERLINK(\"http://x\")")}},
                          {0, kT0 + 1000, {Cell{}, std::string("+1")}},
                          {0, kT0 + 2000, {Cell{}, std::string("-2")}},
                          {0, kT0 + 3000, {Cell{}, std::string("@SUM(A1)")}},
                          {0, kT0 + 4000, {Cell{}, std::string("\tx")}},
                          {0, kT0 + 5000, {Cell{}, std::string("ok")}}},
                         err))
        << err;
    auto r = run({"--export-history", "g", "--from", "2026-10-10 08:00", "--to", "2026-10-10 08:01",
                  "--data-dir", dir});
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_EQ(r.out,
              "time,N,S\n"
              "2026-10-10 08:00:00.000,-5.5,\"'=HYPERLINK(\"\"http://x\"\")\"\n"
              "2026-10-10 08:00:01.000,,'+1\n"
              "2026-10-10 08:00:02.000,,'-2\n"
              "2026-10-10 08:00:03.000,,'@SUM(A1)\n"
              "2026-10-10 08:00:04.000,,'\tx\n"
              "2026-10-10 08:00:05.000,,ok\n");
}

namespace {
// One text column "S" holding the given strings, rows one second apart from 08:00.
std::string storeOfTexts(const std::vector<std::string>& texts) {
    char tmpl[] = "/tmp/mat-export-XXXXXX";
    const std::string dir = mkdtemp(tmpl);
    LocalStore s(dir, [] { return kT0; });
    std::string err;
    EXPECT_TRUE(s.open(err)) << err;
    TableSpec t;
    t.table = "t";
    t.groupId = "g";
    t.retentionDays = 7;
    t.columns = {{"S", "TEXT"}};
    EXPECT_TRUE(s.ensureTables({t}, err)) << err;
    std::vector<PendingRow> rows;
    for (size_t i = 0; i < texts.size(); ++i)
        rows.push_back({0, kT0 + static_cast<int64_t>(i) * 1000, {texts[i]}});
    EXPECT_TRUE(s.commit(rows, err)) << err;
    return dir;
}
}  // namespace

// Security review of the fixes: Excel splits a CSV on the list separator of Windows (";" in
// vi-VN), so a formula may start after ";" (or a tab, a line break) inside a text cell too.
TEST(ExportHistory, AFormulaAfterASeparatorInsideTheTextIsNotRunEither) {
    const std::string dir = storeOfTexts({"x;=1+1;", "a\t+b", "ok\n@SUM(A1)", "1;2;3"});
    auto r = run({"--export-history", "g", "--from", "2026-10-10 08:00", "--to", "2026-10-10 08:01",
                  "--data-dir", dir});
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_EQ(r.out,
              "time,S\n"
              "2026-10-10 08:00:00.000,x;'=1+1;\n"
              "2026-10-10 08:00:01.000,a\t'+b\n"
              "2026-10-10 08:00:02.000,\"ok\n'@SUM(A1)\"\n"
              "2026-10-10 08:00:03.000,1;2;3\n");
}

// Security review of the fixes: on a terminal, control characters of a Tag string (escape
// sequences, carriage return) are shown as \xNN instead of acting on the terminal.
TEST(ExportHistory, ControlCharactersAreShownOnATerminal) {
    const std::string dir = storeOfTexts({"a\x1b[31mb", "c\rd"});
    auto r = run({"--export-history", "g", "--from", "2026-10-10 08:00", "--to", "2026-10-10 08:01",
                  "--data-dir", dir},
                 kT0 + 3 * 3600000LL, /*terminal=*/true);
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_EQ(r.out,
              "time,S\n"
              "2026-10-10 08:00:00.000,a\\x1b[31mb\n"
              "2026-10-10 08:00:01.000,c\\x0dd\n");
    // into a file (not a terminal) the text stays as stored
    auto f = run({"--export-history", "g", "--from", "2026-10-10 08:00", "--to", "2026-10-10 08:01",
                  "--data-dir", dir});
    EXPECT_NE(f.out.find("a\x1b[31mb"), std::string::npos);
}

// Review of the fixes (minor 5): output that fails (`| head` closed the pipe, a full disk) ends the
// export with an error at once, instead of reading every row and exiting 0 with a cut file.
TEST(ExportHistory, AFailedOutputStopsWithAnError) {
    const std::string dir = makeStore();
    struct Refuses : std::streambuf {
        int overflow(int) override { return traits_type::eof(); }
    } refuses;
    std::ostream out(&refuses);
    std::ostringstream err;
    std::vector<std::string> args{"mat-runtime", "--export-history", "bao-cao-ca", "--data-dir",
                                  dir};
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(&a[0]);
    const int code = runExportHistoryCli(static_cast<int>(argv.size()), argv.data(), out, err,
                                         kT0 + 3 * 3600000LL, false);
    EXPECT_NE(code, 0);
    EXPECT_FALSE(err.str().empty());
}

// Review of the fixes (minor 8): a Tag string must not reorder what the terminal shows either
// (bidirectional controls, line separators), as journalSafe already does for the journal.
TEST(ExportHistory, TextThatReordersTheLineIsShownOnATerminal) {
    const std::string dir = storeOfTexts({"a‮b", "c d؜e"});
    auto r = run({"--export-history", "g", "--from", "2026-10-10 08:00", "--to", "2026-10-10 08:01",
                  "--data-dir", dir},
                 kT0 + 3 * 3600000LL, /*terminal=*/true);
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_EQ(r.out,
              "time,S\n"
              "2026-10-10 08:00:00.000,a\\u202eb\n"
              "2026-10-10 08:00:01.000,c\\u2028d\\u061ce\n");
    auto f = run({"--export-history", "g", "--from", "2026-10-10 08:00", "--to", "2026-10-10 08:01",
                  "--data-dir", dir});
    EXPECT_NE(f.out.find("a‮b"), std::string::npos);  // a file keeps the text as stored
}

// Feature 010 (FR-061): --res / --fields / --no-bom give the format of GET /history/export.csv.
TEST(ExportHistory010, RawInTheFormatOfExportCsvWithBomAndCrLf) {
    const std::string dir = makeStore();
    const Run r = run({"--export-history", "bao-cao-ca", "--data-dir", dir, "--res", "raw", "--from",
                       "2026-10-10 08:00", "--to", "2026-10-10 09:00"});
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_EQ(r.out.substr(0, 3), "\xEF\xBB\xBF");
    EXPECT_EQ(r.out.substr(3, 24), "time,MUC_BON,NOTE,RUN\r\n2");
    EXPECT_NE(r.out.find("2026-10-10 08:00:00.000,65.2,\"a,b\",1\r\n"), std::string::npos);
    const Run nb = run({"--export-history", "bao-cao-ca", "--data-dir", dir, "--no-bom", "--from",
                        "2026-10-10 08:00", "--to", "2026-10-10 09:00"});
    ASSERT_EQ(nb.code, 0);
    EXPECT_EQ(nb.out.substr(0, 4), "time");
    EXPECT_EQ(nb.out, r.out.substr(3));
}

TEST(ExportHistory010, AGroupWithoutAggregatesRefusesAResolutionAndBadValuesAreArguments) {
    const std::string dir = makeStore();
    EXPECT_EQ(run({"--export-history", "bao-cao-ca", "--data-dir", dir, "--res", "1h"}).code, 4);
    EXPECT_EQ(run({"--export-history", "bao-cao-ca", "--data-dir", dir, "--res", "1d"}).code, 2);
    EXPECT_EQ(run({"--export-history", "bao-cao-ca", "--data-dir", dir, "--fields", "foo"}).code, 2);
}
