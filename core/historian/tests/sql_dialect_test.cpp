// SQL text for the external databases (specs/003-data-logging/contracts/external-schema.md).
// Pure string generation; the escapers of MySQL/PostgreSQL come from the client library and are
// faked here.
#include "core/historian/forward/sql_dialect.hpp"

#include <gtest/gtest.h>

using namespace mat;

namespace {
constexpr int64_t kT0 = 1791594000000;  // 2026-10-10T01:00:00Z = 08:00 at +07:00

// Stands in for mysql_real_escape_string / PQescapeLiteral: quote + double single quotes.
std::string fakeEscape(const std::string& s) {
    std::string q = "'";
    for (char c : s) {
        if (c == '\'') q += '\'';
        q += c;
    }
    return q + "'";
}

SqlTable table(const std::string& schema) {
    SqlTable t;
    t.schema = schema;
    t.name = "bao_cao_ca";
    t.columns = {{"MUC_BON", TagType::FLOAT32, 255}, {"RUN", TagType::BOOL, 255},
                 {"NOTE", TagType::STRING, 64},      {"C", TagType::UINT64, 255},
                 {"I", TagType::INT16, 255},         {"D", TagType::FLOAT64, 255},
                 {"L", TagType::INT64, 255}};
    return t;
}

std::vector<StoredRow> rows() {
    return {{7,
             kT0,
             {65.2, int64_t{1}, std::string("it's"), std::string("18446744073709551615"),
              int64_t{-3}, 0.1, int64_t{9007199254740993}}},
            {8,
             kT0 + 19 * 3600000LL,
             {Cell{}, int64_t{0}, Cell{}, int64_t{42}, Cell{}, Cell{}, Cell{}}}};
}
}  // namespace

TEST(SqlDialect, MySqlDdl) {
    SqlGen g(SqlDialect::MySql, 420, fakeEscape);
    const auto t = table("");
    auto ddl = g.createTable(t);
    ASSERT_EQ(ddl.size(), 1u);
    EXPECT_EQ(
        ddl[0],
        "CREATE TABLE IF NOT EXISTS `bao_cao_ca` (`id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY "
        "KEY, `time` DATETIME(3) NOT NULL, `MUC_BON` FLOAT NULL, `RUN` TINYINT(1) NULL, `NOTE` "
        "TEXT NULL, `C` DECIMAL(20,0) NULL, `I` SMALLINT NULL, `D` DOUBLE NULL, `L` BIGINT NULL, "
        "INDEX `ix_bao_cao_ca_time` (`time`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    EXPECT_EQ(g.indexQuery(t), "");  // the index is part of CREATE TABLE
    EXPECT_EQ(g.addColumn(t, t.columns[2]), "ALTER TABLE `bao_cao_ca` ADD COLUMN `NOTE` TEXT NULL");
    EXPECT_EQ(
        g.createStateTable("")[0],
        "CREATE TABLE IF NOT EXISTS `mat_forward_state` (`source_id` VARCHAR(64) NOT NULL, "
        "`table_name` VARCHAR(64) NOT NULL, `last_seq` BIGINT NOT NULL, `updated_at` "
        "DATETIME(3) NOT NULL, PRIMARY KEY (`source_id`, `table_name`)) ENGINE=InnoDB DEFAULT "
        "CHARSET=utf8mb4");
    EXPECT_EQ(g.listColumns(t),
              "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
              "AND TABLE_NAME = 'bao_cao_ca'");
    EXPECT_EQ(g.readCursor("", "src-1", "bao_cao_ca"),
              "SELECT `last_seq` FROM `mat_forward_state` WHERE `source_id` = 'src-1' AND "
              "`table_name` = 'bao_cao_ca'");
}

TEST(SqlDialect, MySqlBatchStatements) {
    SqlGen g(SqlDialect::MySql, 420, fakeEscape);
    const auto t = table("");
    EXPECT_EQ(
        g.insertRows(t, rows()),
        "INSERT INTO `bao_cao_ca` (`time`, `MUC_BON`, `RUN`, `NOTE`, `C`, `I`, `D`, `L`) VALUES "
        "('2026-10-10 08:00:00.000', 65.2, 1, 'it''s', 18446744073709551615, -3, "
        "0.1, 9007199254740993), ('2026-10-11 03:00:00.000', NULL, 0, NULL, 42, "
        "NULL, NULL, NULL)");
    // Review of the fixes (Important 2): the cursor moves only from the value the forwarder read
    EXPECT_EQ(g.updateCursor("", "src-1", "bao_cao_ca", 5, 8),
              "UPDATE `mat_forward_state` SET `last_seq` = 8, `updated_at` = NOW(3) WHERE "
              "`source_id` = 'src-1' AND `table_name` = 'bao_cao_ca' AND `last_seq` = 5");
    EXPECT_EQ(g.lockCursor("", "src-1", "bao_cao_ca"),
              "SELECT `last_seq` FROM `mat_forward_state` WHERE `source_id` = 'src-1' AND "
              "`table_name` = 'bao_cao_ca' FOR UPDATE");
    EXPECT_EQ(
        g.insertCursor("", "src-1", "bao_cao_ca", 8),
        "INSERT INTO `mat_forward_state` (`source_id`, `table_name`, `last_seq`, `updated_at`) "
        "VALUES ('src-1', 'bao_cao_ca', 8, NOW(3))");
}

TEST(SqlDialect, MsSqlDdlAndOneBatch) {
    SqlGen g(SqlDialect::MsSql, 420, nullptr);  // SQL Server literals are built in-house
    const auto t = table("dbo");
    auto ddl = g.createTable(t);
    ASSERT_EQ(ddl.size(), 1u);
    EXPECT_EQ(
        ddl[0],
        "IF OBJECT_ID(N'[dbo].[bao_cao_ca]', N'U') IS NULL CREATE TABLE [dbo].[bao_cao_ca] "
        "([id] BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY, [time] DATETIME2(3) NOT NULL, "
        "[MUC_BON] REAL NULL, [RUN] BIT NULL, [NOTE] NVARCHAR(64) NULL, [C] DECIMAL(20,0) NULL, "
        "[I] SMALLINT NULL, [D] FLOAT(53) NULL, [L] BIGINT NULL)");
    // the index is looked for first, then created when missing
    EXPECT_EQ(g.indexQuery(t),
              "SELECT name FROM sys.indexes WHERE name = N'ix_bao_cao_ca_time' AND object_id = "
              "OBJECT_ID(N'[dbo].[bao_cao_ca]')");
    EXPECT_EQ(g.createIndex(t), "CREATE INDEX [ix_bao_cao_ca_time] ON [dbo].[bao_cao_ca] ([time])");
    EXPECT_EQ(g.addColumn(t, t.columns[0]),
              "ALTER TABLE [dbo].[bao_cao_ca] ADD [MUC_BON] REAL NULL");
    EXPECT_EQ(g.listColumns(t),
              "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[bao_cao_ca]')");
    // Review of the fixes (Important 2): the cursor first, moved only from the value read (a row
    // with another value stops the batch; the range lock keeps a first row from coming twice)
    EXPECT_EQ(
        g.oneBatch(t, rows(), "src-1", 5, 8),
        "SET XACT_ABORT ON; BEGIN TRANSACTION; UPDATE [dbo].[mat_forward_state] SET [last_seq] = "
        "8, [updated_at] = SYSDATETIME() WHERE [source_id] = N'src-1' AND [table_name] = "
        "N'bao_cao_ca' AND [last_seq] = 5; IF @@ROWCOUNT = 0 BEGIN IF EXISTS (SELECT 1 FROM "
        "[dbo].[mat_forward_state] WITH (UPDLOCK, HOLDLOCK) WHERE [source_id] = N'src-1' AND "
        "[table_name] = N'bao_cao_ca') THROW 51000, N'mat-runtime: the cursor at the destination "
        "moved', 1; INSERT INTO [dbo].[mat_forward_state] ([source_id], [table_name], [last_seq], "
        "[updated_at]) VALUES (N'src-1', N'bao_cao_ca', 8, SYSDATETIME()); END; INSERT INTO "
        "[dbo].[bao_cao_ca] ([time], [MUC_BON], [RUN], [NOTE], [C], [I], [D], [L]) VALUES "
        "('2026-10-10T08:00:00.000', 65.2, 1, N'it''s', 18446744073709551615, -3, 0.1, "
        "9007199254740993), ('2026-10-11T03:00:00.000', NULL, 0, NULL, 42, NULL, NULL, NULL); "
        "COMMIT TRANSACTION;");
}

TEST(SqlDialect, PostgreSqlLowercaseAndOneBatch) {
    SqlGen g(SqlDialect::PostgreSql, 420, fakeEscape);
    const auto t = table("public");
    auto ddl = g.createTable(t);
    ASSERT_EQ(ddl.size(), 1u);
    EXPECT_EQ(ddl[0],
              "CREATE TABLE IF NOT EXISTS \"public\".\"bao_cao_ca\" (\"id\" BIGINT GENERATED BY "
              "DEFAULT AS IDENTITY PRIMARY KEY, \"time\" TIMESTAMP(3) NOT NULL, \"muc_bon\" REAL, "
              "\"run\" BOOLEAN, \"note\" VARCHAR(64), \"c\" NUMERIC(20,0), \"i\" SMALLINT, \"d\" "
              "DOUBLE PRECISION, \"l\" BIGINT)");
    // Review I7: CREATE INDEX IF NOT EXISTS takes a SHARE lock on the table even when the index
    // exists (it would wait for, and block, the inserts of other devices): look first.
    EXPECT_EQ(g.indexQuery(t),
              "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = "
              "'ix_bao_cao_ca_time'");
    EXPECT_EQ(g.createIndex(t),
              "CREATE INDEX IF NOT EXISTS \"ix_bao_cao_ca_time\" ON \"public\".\"bao_cao_ca\" "
              "(\"time\")");
    EXPECT_EQ(g.addColumn(t, t.columns[1]),
              "ALTER TABLE \"public\".\"bao_cao_ca\" ADD COLUMN IF NOT EXISTS \"run\" BOOLEAN");
    EXPECT_EQ(
        g.listColumns(t),
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND "
        "table_name = 'bao_cao_ca'");
    // Review of the fixes (Important 2): the cursor first, moved only from the value read; an
    // existing row with another value raises (40001), a first row inserted twice is refused by
    // the primary key
    EXPECT_EQ(
        g.oneBatch(t, rows(), "src-1", 5, 8),
        "BEGIN; DO $mat$BEGIN UPDATE \"public\".\"mat_forward_state\" SET \"last_seq\" = 8, "
        "\"updated_at\" = now() WHERE \"source_id\" = 'src-1' AND \"table_name\" = 'bao_cao_ca' "
        "AND \"last_seq\" = 5; IF NOT FOUND THEN IF EXISTS (SELECT 1 FROM "
        "\"public\".\"mat_forward_state\" WHERE \"source_id\" = 'src-1' AND \"table_name\" = "
        "'bao_cao_ca') THEN RAISE EXCEPTION 'mat-runtime: the cursor at the destination moved' "
        "USING ERRCODE = '40001'; END IF; INSERT INTO \"public\".\"mat_forward_state\" "
        "(\"source_id\", \"table_name\", \"last_seq\", \"updated_at\") VALUES ('src-1', "
        "'bao_cao_ca', 8, now()); END IF; END$mat$; INSERT INTO \"public\".\"bao_cao_ca\" "
        "(\"time\", \"muc_bon\", \"run\", \"note\", \"c\", \"i\", \"d\", \"l\") VALUES "
        "('2026-10-10 08:00:00.000', 65.2, TRUE, 'it''s', 18446744073709551615, -3, 0.1, "
        "9007199254740993), ('2026-10-11 03:00:00.000', NULL, FALSE, NULL, 42, NULL, NULL, "
        "NULL); COMMIT;");
}

// The dollar quote of the PostgreSQL batch can never be closed by a name inside it.
TEST(SqlDialect, PostgreSqlDollarQuoteIsNotInTheBody) {
    SqlGen g(SqlDialect::PostgreSql, 420, fakeEscape);
    const std::string b = g.oneBatch(table("public"), {}, "src-$mat$-1", 0, 3);
    const size_t open = b.find("DO $");
    ASSERT_NE(open, std::string::npos);
    const std::string tag = b.substr(open + 3, b.find('$', open + 4) - open - 2);
    EXPECT_NE(tag, "$mat$");
    EXPECT_EQ(b.find(tag, open + 3 + tag.size()), b.rfind(tag));  // opened once, closed once
}

TEST(SqlDialect, CursorOnlyBatchHasNoInsert) {  // lost rows: move the cursor alone
    SqlGen g(SqlDialect::PostgreSql, 420, fakeEscape);
    const std::string b = g.oneBatch(table("public"), {}, "src-1", 0, 99);
    EXPECT_EQ(b.find("\"bao_cao_ca\" (\"time\""), std::string::npos);
    EXPECT_NE(b.find("99, now()"), std::string::npos);
}

TEST(SqlDialect, TimeUsesTheConnectionOffset) {
    EXPECT_EQ(SqlGen(SqlDialect::MySql, 420, fakeEscape).timeLiteral(kT0 + 5),
              "'2026-10-10 08:00:00.005'");
    EXPECT_EQ(SqlGen(SqlDialect::MsSql, -210, nullptr).timeLiteral(kT0),
              "'2026-10-09T21:30:00.000'");
    EXPECT_EQ(SqlGen(SqlDialect::PostgreSql, 0, fakeEscape).timeLiteral(kT0),
              "'2026-10-10 01:00:00.000'");
}

TEST(SqlDialect, LiteralsAreSafe) {
    SqlGen g(SqlDialect::MsSql, 420, nullptr);
    SqlColumn u{"U", TagType::UINT64, 255};
    EXPECT_EQ(g.literal(std::string("1; DROP TABLE x"), u), "NULL");  // not a number: never pasted
    SqlColumn s{"S", TagType::STRING, 255};
    EXPECT_EQ(g.literal(std::string("a'b"), s), "N'a''b'");
    SqlColumn f{"F", TagType::FLOAT64, 255};
    EXPECT_EQ(g.literal(int64_t{3}, f), "3");  // REAL affinity can come back as integer
    SqlColumn i{"I", TagType::INT32, 255};
    EXPECT_EQ(g.literal(2.6, i), "3");
}

TEST(SqlDialect, BatchSize) {
    EXPECT_EQ(SqlGen::batchRows(1), 500u);
    EXPECT_EQ(SqlGen::batchRows(400), 500u);
    EXPECT_EQ(SqlGen::batchRows(1000), 200u);
    EXPECT_EQ(SqlGen::batchRows(300000), 1u);
}

// Long strings: a batch must stay small in memory (BL335) and in one statement (MySQL
// max_allowed_packet), whatever the number of rows the cell formula allows.
TEST(SqlDialect, LongStringsMakeSmallerBatchesAndStatements) {
    EXPECT_EQ(SqlGen::batchRowsFor(std::vector<SqlColumn>(10, {"N", TagType::FLOAT64, 255})), 500u);
    EXPECT_EQ(SqlGen::batchRowsFor(std::vector<SqlColumn>(1000, {"N", TagType::INT32, 255})), 200u);
    // 200 strings of 4000 characters: about 3.2 MB per row at worst
    EXPECT_EQ(SqlGen::batchRowsFor(std::vector<SqlColumn>(200, {"S", TagType::STRING, 4000})), 1u);
    EXPECT_LT(SqlGen::batchRowsFor(std::vector<SqlColumn>(10, {"S", TagType::STRING, 4000})), 100u);

    SqlGen g(SqlDialect::MySql, 420, fakeEscape);
    SqlTable t{"", "t", {{"S", TagType::STRING, 4000}}};
    std::vector<StoredRow> many;
    for (int i = 0; i < 10; ++i) many.push_back({i + 1, kT0, {std::string(300, 'x')}});
    const auto chunks = g.insertChunks(t, many, 1000);
    EXPECT_GE(chunks.size(), 4u);
    size_t rowsSeen = 0;
    for (const auto& c : chunks) {
        EXPECT_LE(c.size(), 1000u);
        EXPECT_EQ(c.rfind("INSERT INTO `t` (`time`, `S`) VALUES ", 0), 0u);
        for (size_t p = c.find("('2026-"); p != std::string::npos; p = c.find("('2026-", p + 1))
            ++rowsSeen;
    }
    EXPECT_EQ(rowsSeen, 10u);
    // one row longer than the limit still goes, alone
    std::vector<StoredRow> big{{1, kT0, {std::string(5000, 'y')}}};
    EXPECT_EQ(g.insertChunks(t, big, 1000).size(), 1u);
    // small rows: a single statement, the same text as insertRows()
    EXPECT_EQ(g.insertChunks(table(""), rows(), 1 << 20),
              std::vector<std::string>{g.insertRows(table(""), rows())});
}

// Review I2: a value the column cannot hold would make the server refuse the whole batch, again
// and again: it goes as NULL and is counted.
TEST(SqlDialect, ValuesTheColumnCannotHoldAreSentAsNullAndCounted) {
    SqlGen g(SqlDialect::PostgreSql, 0, fakeEscape);
    const SqlColumn i16{"A", TagType::INT16, 255}, u16{"B", TagType::UINT16, 255},
        i32{"C", TagType::INT32, 255}, u32{"D", TagType::UINT32, 255},
        f32{"E", TagType::FLOAT32, 255}, num{"F", TagType::INT64, 255};
    EXPECT_EQ(g.literal(int64_t{-32768}, i16), "-32768");
    EXPECT_EQ(g.literal(int64_t{32767}, i16), "32767");
    EXPECT_EQ(g.literal(int64_t{40000}, i16), "NULL");  // a register read unsigned, declared INT16
    EXPECT_EQ(g.literal(40000.0, i16), "NULL");
    EXPECT_EQ(g.literal(int64_t{65535}, u16), "65535");
    EXPECT_EQ(g.literal(int64_t{-1}, u16), "NULL");
    EXPECT_EQ(g.literal(int64_t{2147483647}, i32), "2147483647");
    EXPECT_EQ(g.literal(int64_t{2147483648LL}, i32), "NULL");
    EXPECT_EQ(g.literal(uint64_t{4294967295ULL}, u32), "4294967295");
    EXPECT_EQ(g.literal(int64_t{4294967296LL}, u32), "NULL");
    EXPECT_NE(g.literal(3.0e38, f32), "NULL");
    EXPECT_EQ(g.literal(1e39, f32), "NULL");               // beyond FLT_MAX
    EXPECT_EQ(g.literal(std::string("12"), num), "NULL");  // text in a number column
    EXPECT_EQ(g.literal(Cell{}, i16), "NULL");             // an empty cell is not counted
    EXPECT_EQ(g.outOfRange(), 7u);
}

// Review I2: SQL Server counts NVARCHAR(n) in UTF-16 units (an emoji takes two), PostgreSQL
// VARCHAR(n) in characters, MySQL TEXT in bytes. Broken UTF-8 never reaches a server (security
// review M1).
TEST(SqlDialect, StringsFitTheColumnAndAreValidUtf8) {
    const SqlColumn s4{"S", TagType::STRING, 4};
    const std::string smile = "\xF0\x9F\x98\x80";  // U+1F600
    SqlGen ms(SqlDialect::MsSql, 0, nullptr);
    EXPECT_EQ(ms.literal(smile + smile + smile, s4), "N'" + smile + smile + "'");
    EXPECT_EQ(ms.literal(std::string("abcd"), s4), "N'abcd'");
    EXPECT_EQ(ms.outOfRange(), 1u);
    EXPECT_EQ(ms.literal(std::string("OK\xC3"), s4), "N'OK\xEF\xBF\xBD'");
    SqlGen pg(SqlDialect::PostgreSql, 0, fakeEscape);
    EXPECT_EQ(pg.literal(std::string("abcdef"), s4), "'abcd'");
    EXPECT_EQ(pg.literal(smile + smile + smile, s4), "'" + smile + smile + smile + "'");
    EXPECT_EQ(pg.outOfRange(), 1u);
    SqlGen my(SqlDialect::MySql, 0, fakeEscape);
    const SqlColumn text{"S", TagType::STRING, 4000};
    EXPECT_EQ(my.literal(std::string(70000, 'x'), text).size(), 65535u + 2);
    EXPECT_EQ(my.literal(std::string("a\xFF"
                                     "b"),
                         text),
              "'a\xEF\xBF\xBD"
              "b'");
}

// SQL Server (and REAL columns elsewhere) refuse subnormal numbers: they go as 0, counted.
TEST(SqlDialect, SubnormalNumbersGoAsZero) {
    SqlGen g(SqlDialect::MsSql, 0, nullptr);
    const SqlColumn f64{"D", TagType::FLOAT64, 255}, f32{"F", TagType::FLOAT32, 255};
    EXPECT_EQ(g.literal(4.9e-324, f64), "0");
    EXPECT_EQ(g.literal(-1e-310, f64), "0");
    EXPECT_EQ(g.literal(1e-40, f32), "0");
    EXPECT_EQ(g.literal(2.2250738585072014e-308, f64), "2.2250738585072014e-308");
    EXPECT_EQ(g.literal(0.0, f64), "0");
    EXPECT_EQ(g.outOfRange(), 3u);
}
