// Integration test of forwarding with real databases (specs/003-data-logging T052, SC-004):
// MySQL 8.4, SQL Server 2022, PostgreSQL 17 and InfluxDB 2.7 of tests/historian-it/compose.yaml.
// Runs only with the MAT_IT_* environment that tools/historian-it.ps1 sets (random passwords and
// token per run, never written anywhere); without it every test is skipped. Accounts and grants are
// set up here, as the administrator of each server, through the same client code as the runtime.
#include <gtest/gtest.h>
#include <stdlib.h>

#include <algorithm>
#include <chrono>
#include <climits>
#include <cstdlib>
#include <functional>
#include <iostream>
#include <memory>
#include <thread>

#include "core/historian/clock.hpp"
#include "core/historian/forward/forwarder.hpp"
#include "core/historian/forward/sql_destination.hpp"
#include "core/historian/tests/it_support.hpp"

using namespace mat;

namespace {

constexpr int64_t kT0 = 1791594000000;  // 2026-10-10 08:00 at +07:00
constexpr int kRows = 600;

std::string envOf(const char* name) {
    const char* v = std::getenv(name);
    return v ? v : "";
}

struct Env {
    std::string rootPw = envOf("MAT_IT_ROOT_PW");
    std::string userPw = envOf("MAT_IT_USER_PW");
    std::string token = envOf("MAT_IT_INFLUX_TOKEN");
    std::string mysql = envOf("MAT_IT_MYSQL_HOST");
    std::string mssql = envOf("MAT_IT_MSSQL_HOST");
    std::string pg = envOf("MAT_IT_PG_HOST");
    std::string influx = envOf("MAT_IT_INFLUX_URL");
    bool ok() const {
        return !rootPw.empty() && !userPw.empty() && !token.empty() && !mysql.empty() &&
               !mssql.empty() && !pg.empty() && !influx.empty();
    }
};

const Env& env() {
    static const Env e;
    return e;
}

#define REQUIRE_IT() \
    if (!env().ok()) \
    GTEST_SKIP() << "MAT_IT_* not set: run tools/historian-it.ps1 -Scenario forward"

std::string tempDir() {
    char tmpl[] = "/tmp/mat-it-XXXXXX";
    const char* d = mkdtemp(tmpl);
    return d ? d : "";
}

int64_t epochMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}
int64_t monoMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

ConnectionModel connection(DbType t, const std::string& user, TlsMode tls = TlsMode::Prefer) {
    ConnectionModel c;
    c.id = std::string(dbTypeName(t)) + "-it";
    c.type = t;
    c.user = user;
    c.tls = tls;
    c.offsetMin = 420;
    c.database = "scada";
    c.schema = it::schemaOf(t);
    switch (t) {
        case DbType::MySql:
            c.host = env().mysql;
            c.port = 3306;
            break;
        case DbType::MsSql:
            c.host = env().mssql;
            c.port = 1433;
            break;
        case DbType::PostgreSql:
            c.host = env().pg;
            c.port = 5432;
            break;
        case DbType::InfluxDb:
            c.url = env().influx;
            c.org = "mat";
            c.bucket = "scada";
            c.tls = TlsMode::Disable;
            c.offsetMin = 0;
            break;
    }
    return c;
}

std::string adminUser(DbType t) {
    return t == DbType::MySql ? "root" : t == DbType::MsSql ? "sa" : "postgres";
}

// Session as the administrator of the server: setup and checks only.
std::unique_ptr<SqlDestination> adminSession(DbType t, const std::string& database = "scada",
                                             TlsMode tls = TlsMode::Prefer) {
    ConnectionModel c = connection(t, adminUser(t), tls);
    c.database = database;
    auto s = makeSqlDestination(c, "");
    DestError e;
    if (!s->connect(env().rootPw, e)) {
        ADD_FAILURE() << "admin connect " << dbTypeName(t) << ": " << errorClassCode(e.cls) << " "
                      << e.dbCode << " " << e.detail;
        return nullptr;
    }
    return s;
}

void run(SqlDestination& s, const std::string& sql) {
    DestError e;
    EXPECT_TRUE(s.exec(sql, e)) << sql << "\n-> " << errorClassCode(e.cls) << " " << e.dbCode << " "
                                << e.detail;
}

std::vector<std::string> column(SqlDestination& s, const std::string& sql) {
    std::vector<std::string> out;
    DestError e;
    EXPECT_TRUE(s.query(sql, out, e)) << sql << "\n-> " << e.dbCode << " " << e.detail;
    return out;
}

// Accounts of every server, once: mat_writer may create tables; mat_limited gets grants per test.
class Accounts : public ::testing::Environment {
   public:
    void SetUp() override {
        if (!env().ok()) return;
        const std::string& pw = env().userPw;
        if (auto s = adminSession(DbType::MySql)) {
            const SqlGen g = s->gen();
            for (const char* u : {"mat_writer", "mat_limited"})
                run(*s, std::string("CREATE USER IF NOT EXISTS '") + u + "'@'%' IDENTIFIED BY " +
                            g.stringLiteral(pw));
            run(*s,
                "GRANT CREATE, ALTER, INDEX, INSERT, UPDATE, SELECT ON scada.* TO "
                "'mat_writer'@'%'");
        }
        if (auto s = adminSession(DbType::MsSql, "master")) {
            const SqlGen g = s->gen();
            run(*s, "IF DB_ID(N'scada') IS NULL CREATE DATABASE scada");
            for (const char* u : {"mat_writer", "mat_limited"})
                run(*s, std::string("IF SUSER_ID(N'") + u + "') IS NULL CREATE LOGIN " + u +
                            " WITH PASSWORD = " + g.stringLiteral(pw) + ", CHECK_POLICY = OFF");
        }
        if (auto s = adminSession(DbType::MsSql)) {
            for (const char* u : {"mat_writer", "mat_limited"})
                run(*s, std::string("IF USER_ID(N'") + u + "') IS NULL CREATE USER " + u +
                            " FOR LOGIN " + u);
            run(*s,
                "ALTER ROLE db_ddladmin ADD MEMBER mat_writer; ALTER ROLE db_datareader ADD "
                "MEMBER mat_writer; ALTER ROLE db_datawriter ADD MEMBER mat_writer");
        }
        if (auto s = adminSession(DbType::PostgreSql)) {
            const SqlGen g = s->gen();
            for (const char* u : {"mat_writer", "mat_limited"})
                run(*s, std::string(
                            "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '") +
                            u + "') THEN CREATE ROLE " + u + " LOGIN PASSWORD " +
                            g.stringLiteral(pw) + "; END IF; END $$");
            run(*s, "GRANT CREATE, USAGE ON SCHEMA public TO mat_writer");
            run(*s, "GRANT USAGE ON SCHEMA public TO mat_limited");
        }
    }
};
[[maybe_unused]] ::testing::Environment* const kAccounts =
    ::testing::AddGlobalTestEnvironment(new Accounts);

// ---------------------------------------------------------------- test data

const std::vector<SqlColumn> kCols = {
    {"B", TagType::BOOL, 255},     {"I16", TagType::INT16, 255},   {"U16", TagType::UINT16, 255},
    {"I32", TagType::INT32, 255},  {"U32", TagType::UINT32, 255},  {"I64", TagType::INT64, 255},
    {"U64", TagType::UINT64, 255}, {"F32", TagType::FLOAT32, 255}, {"F64", TagType::FLOAT64, 255},
    {"S", TagType::STRING, 32}};

int64_t tsOf(int i) { return kT0 + int64_t{i} * 1003; }

// Cell of row i, column k as the sampler stores it; every 7th cell empty after the first rows.
Cell cellOf(int i, size_t k) {
    if (i > 4 && (i + static_cast<int>(k)) % 7 == 0) return Cell{};
    switch (k) {
        case 0:
            return int64_t{i % 2};
        case 1:
            return int64_t{i == 1 ? -32768 : i == 2 ? 32767 : (i * 37) % 30000 - 15000};
        case 2:
            return int64_t{i == 2 ? 65535 : (i * 101) % 65536};
        case 3:
            return int64_t{i == 1 ? INT32_MIN : i == 2 ? INT32_MAX : i * 1000003 - 300000000};
        case 4:
            return int64_t{i == 2 ? 4294967295LL : int64_t{i} * 7000001};
        case 5:
            return static_cast<int64_t>(
                i == 1 ? INT64_MIN : i == 2 ? INT64_MAX : int64_t{i} * int64_t{1000000000007});
        case 6:  // above INT64_MAX: decimal TEXT in SQLite
            return i == 2 ? Cell{std::string("18446744073709551615")}
                          : Cell{static_cast<int64_t>(int64_t{i} * int64_t{123456789012345})};
        case 7:
            return i == 3 ? 65.2 : i * 0.25 - 37.5;
        case 8:
            return i == 1 ? 1.7976931348623157e308 : i == 2 ? 1e-300 : i * 0.1 + 1e-7;
        case 9: {
            static const char* kText[] = {"Bồn số 1 'A'", "back\\slash", "dòng\nmới", "",
                                          "\"quoted\", comma"};
            return std::string(i < 5 ? kText[i] : "s" + std::to_string(i));
        }
        default:  // extra columns added by the tests
            return 1000.0 + i;
    }
}

using CellFn = std::function<Cell(int, size_t)>;

struct Local {
    std::string dir = tempDir();
    std::unique_ptr<LocalStore> store;
    std::string table;

    Local(std::string t, const std::vector<SqlColumn>& cols) : table(std::move(t)) {
        store = std::make_unique<LocalStore>(dir, [] { return kT0; });
        std::string err;
        EXPECT_TRUE(store->open(err)) << err;
        setColumns(cols);
    }
    void setColumns(const std::vector<SqlColumn>& cols) {
        TableSpec s;
        s.table = table;
        s.groupId = table;
        s.retentionDays = 30;
        for (const auto& c : cols) s.columns.push_back({c.name, sqliteAffinity(c.type)});
        std::string err;
        EXPECT_TRUE(store->ensureTables({s}, err)) << err;
    }
    void add(int from, int count, const std::vector<SqlColumn>& cols, const CellFn& cell = cellOf) {
        std::vector<PendingRow> rows;
        for (int i = from; i < from + count; ++i) {
            PendingRow r{0, tsOf(i), {}};
            for (size_t k = 0; k < cols.size(); ++k) r.cells.push_back(cell(i, k));
            rows.push_back(std::move(r));
        }
        std::string err;
        EXPECT_TRUE(store->commit(rows, err)) << err;
    }
    std::string path() const { return dir + "/history.db"; }
    std::string instanceId() const { return store->instanceId(); }
};

struct Sent {
    DestStatus status;
    std::vector<ForwardCursor> cursors;
    double seconds = 0;
};

// Runs one forwarder until it has nothing more to send or fails.
Sent forward(const ConnectionModel& c, const std::string& secret, const Local& l,
             const std::vector<SqlColumn>& cols) {
    ForwarderOptions o;
    o.dbPath = l.path();
    o.secret = [secret](const std::string&) {
        SecretResult r;
        r.ok = true;
        r.secret = secret;
        return r;
    };
    Forwarder f(c, {ForwardGroup{l.table, DestTable{l.table, cols}}}, makeDestination(c, ""), o,
                epochMs, monoMs);
    const auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < 100000 && f.runOnce(); ++i) {
    }
    Sent s;
    s.seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    s.status = f.status();
    s.cursors = f.takeCursorUpdates();
    return s;
}

std::string describe(const DestStatus& s) {
    return std::string(destStateName(s.state)) + " " + errorClassCode(s.lastError) + " " +
           s.lastErrorDbCode;
}

void dropTable(SqlDestination& admin, DbType t, const std::string& table) {
    const SqlGen g = admin.gen();
    if (t == DbType::MsSql)
        run(admin, "IF OBJECT_ID(N'dbo." + table + "', N'U') IS NOT NULL DROP TABLE dbo." + table);
    else
        run(admin, "DROP TABLE IF EXISTS " + g.qualified(it::schemaOf(t), table));
}

// Every value and the time of rows [from, from + count) as the destination holds them.
void expectRows(DbType t, SqlDestination& admin, const std::string& table,
                const std::vector<SqlColumn>& cols, int from, int count,
                const CellFn& cell = cellOf) {
    const SqlGen g = admin.gen();
    const std::string tail = " FROM " + g.qualified(it::schemaOf(t), table) + " WHERE " +
                             g.ident("time") + " >= " + g.timeLiteral(tsOf(from)) + " ORDER BY " +
                             g.ident("time");
    const auto times = column(admin, "SELECT " + it::timeExpr(t, g) + tail);
    ASSERT_EQ(times.size(), static_cast<size_t>(count)) << dbTypeName(t) << " " << table;
    for (int i = 0; i < count; ++i)
        EXPECT_EQ(times[i].substr(0, 23), formatLocalTime(tsOf(from + i), 420))
            << dbTypeName(t) << " row " << from + i;
    for (size_t k = 0; k < cols.size(); ++k) {
        const auto values = column(admin, "SELECT " + it::valueExpr(t, g, cols[k]) + tail);
        ASSERT_EQ(values.size(), static_cast<size_t>(count)) << cols[k].name;
        for (int i = 0; i < count; ++i) {
            const Cell want = cell(from + i, k);
            EXPECT_TRUE(it::sameValue(values[i], want, cols[k].type))
                << dbTypeName(t) << " " << cols[k].name << " row " << from + i << ": got "
                << values[i] << ", want " << it::expectedText(want);
        }
    }
}

class SqlIt : public ::testing::TestWithParam<DbType> {};

std::string paramName(const ::testing::TestParamInfo<DbType>& p) { return dbTypeName(p.param); }

}  // namespace

// SC-004: every value and every time equal, cursor = last seq; a new Tag adds a column whose old
// rows stay NULL.
TEST_P(SqlIt, RoundTrip600RowsThenANewColumn) {
    REQUIRE_IT();
    const DbType t = GetParam();
    auto admin = adminSession(t);
    ASSERT_TRUE(admin);
    dropTable(*admin, t, "it_rt");
    Local l("it_rt", kCols);
    l.add(0, kRows, kCols);
    const auto sent = forward(connection(t, "mat_writer"), env().userPw, l, kCols);
    ASSERT_EQ(sent.status.state, DestState::Ok) << describe(sent.status);
    EXPECT_EQ(sent.status.sentRows, static_cast<uint64_t>(kRows));
    EXPECT_EQ(sent.status.pendingRows, 0);
    EXPECT_LT(sent.seconds, 10.0);
    std::cout << "[it] " << dbTypeName(t) << ": " << kRows << " rows in " << sent.seconds << " s\n";
    RecordProperty("seconds", std::to_string(sent.seconds));
    expectRows(t, *admin, "it_rt", kCols, 0, kRows);
    int64_t cursor = -1;
    DestError e;
    ASSERT_TRUE(admin->readCursor(l.instanceId(), "it_rt", cursor, e)) << e.detail;
    EXPECT_EQ(cursor, kRows);

    auto cols2 = kCols;
    cols2.push_back({"EXTRA", TagType::FLOAT64, 255});
    l.setColumns(cols2);
    l.add(kRows, 10, cols2);
    const auto more = forward(connection(t, "mat_writer"), env().userPw, l, cols2);
    ASSERT_EQ(more.status.state, DestState::Ok) << describe(more.status);
    EXPECT_EQ(more.status.sentRows, 10u);
    expectRows(t, *admin, "it_rt", cols2, kRows, 10);
    const SqlGen g = admin->gen();  // rows sent before the column existed stay NULL
    const auto nulls =
        column(*admin, "SELECT COUNT(*) FROM " + g.qualified(it::schemaOf(t), "it_rt") + " WHERE " +
                           g.ident("EXTRA") + " IS NULL AND " + g.ident("time") + " < " +
                           g.timeLiteral(tsOf(kRows)));
    ASSERT_EQ(nulls.size(), 1u);
    EXPECT_EQ(nulls[0], std::to_string(kRows));
}

TEST_P(SqlIt, WrongPasswordIsAuthAndTheRightOneWorks) {
    REQUIRE_IT();
    const DbType t = GetParam();
    auto admin = adminSession(t);
    ASSERT_TRUE(admin);
    dropTable(*admin, t, "it_pw");
    Local l("it_pw", kCols);
    l.add(0, 5, kCols);
    const auto bad = forward(connection(t, "mat_writer"), "wrong-" + env().userPw, l, kCols);
    EXPECT_EQ(bad.status.state, DestState::Error);
    EXPECT_EQ(bad.status.lastError, ErrorClass::Auth) << describe(bad.status);
    EXPECT_EQ(bad.status.sentRows, 0u);
    const auto good = forward(connection(t, "mat_writer"), env().userPw, l, kCols);
    EXPECT_EQ(good.status.state, DestState::Ok) << describe(good.status);
    EXPECT_EQ(good.status.sentRows, 5u);
}

// An account with INSERT/SELECT/UPDATE only, on tables the administrator prepared with every
// column: rows go. A Tag the table does not have: permission (ALTER refused).
TEST_P(SqlIt, LimitedAccountUsesPreparedTables) {
    REQUIRE_IT();
    const DbType t = GetParam();
    auto admin = adminSession(t);
    ASSERT_TRUE(admin);
    dropTable(*admin, t, "it_lim");
    const SqlGen g = admin->gen();
    const std::string schema = it::schemaOf(t);
    for (const auto& s : g.createStateTable(schema)) run(*admin, s);
    for (const auto& s : g.createTable(SqlTable{schema, "it_lim", kCols})) run(*admin, s);
    const std::string user = t == DbType::MySql ? "'mat_limited'@'%'" : "mat_limited";
    const std::string data = t == DbType::MySql ? "scada.it_lim" : g.qualified(schema, "it_lim");
    const std::string state =
        t == DbType::MySql ? "scada.mat_forward_state" : g.qualified(schema, "mat_forward_state");
    run(*admin, "GRANT SELECT, INSERT ON " + data + " TO " + user);
    run(*admin, "GRANT SELECT, INSERT, UPDATE ON " + state + " TO " + user);

    Local l("it_lim", kCols);
    l.add(0, 20, kCols);
    const auto sent = forward(connection(t, "mat_limited"), env().userPw, l, kCols);
    ASSERT_EQ(sent.status.state, DestState::Ok) << describe(sent.status);
    EXPECT_EQ(sent.status.sentRows, 20u);
    expectRows(t, *admin, "it_lim", kCols, 0, 20);

    auto cols2 = kCols;
    cols2.push_back({"EXTRA", TagType::FLOAT64, 255});
    l.setColumns(cols2);
    l.add(20, 3, cols2);
    const auto refused = forward(connection(t, "mat_limited"), env().userPw, l, cols2);
    EXPECT_EQ(refused.status.state, DestState::Error);
    EXPECT_EQ(refused.status.lastError, ErrorClass::Permission) << describe(refused.status);
}

// A column that exists with the wrong type: the INSERT fails with schema_mismatch.
TEST_P(SqlIt, WrongColumnTypeIsSchemaMismatch) {
    REQUIRE_IT();
    const DbType t = GetParam();
    auto admin = adminSession(t);
    ASSERT_TRUE(admin);
    dropTable(*admin, t, "it_bad");
    auto wrong = kCols;
    wrong.back() = {"S", TagType::INT32, 255};  // the Tag is a STRING
    for (const auto& s : admin->gen().createTable(SqlTable{it::schemaOf(t), "it_bad", wrong}))
        run(*admin, s);
    // The administrator prepared the table for the runtime account (MySQL and SQL Server give
    // mat_writer the whole database already).
    if (t == DbType::PostgreSql) run(*admin, "GRANT SELECT, INSERT ON public.it_bad TO mat_writer");
    Local l("it_bad", kCols);
    l.add(0, 3, kCols);
    const auto sent = forward(connection(t, "mat_writer"), env().userPw, l, kCols);
    EXPECT_EQ(sent.status.state, DestState::Error);
    EXPECT_EQ(sent.status.lastError, ErrorClass::SchemaMismatch) << describe(sent.status);
}

// 64 STRING Tags of 255 characters (InnoDB row-size limit: TEXT on MySQL).
TEST_P(SqlIt, SixtyFourLongStringTags) {
    REQUIRE_IT();
    const DbType t = GetParam();
    auto admin = adminSession(t);
    ASSERT_TRUE(admin);
    dropTable(*admin, t, "it_wide");
    std::vector<SqlColumn> cols;
    for (int k = 0; k < 64; ++k) cols.push_back({"S" + std::to_string(k), TagType::STRING, 255});
    const CellFn text = [](int i, size_t k) -> Cell {
        return std::string(255, static_cast<char>('a' + (i + static_cast<int>(k)) % 26));
    };
    Local l("it_wide", cols);
    l.add(0, 5, cols, text);
    const auto sent = forward(connection(t, "mat_writer"), env().userPw, l, cols);
    ASSERT_EQ(sent.status.state, DestState::Ok) << describe(sent.status);
    EXPECT_EQ(sent.status.sentRows, 5u);
    expectRows(t, *admin, "it_wide", cols, 0, 5, text);
}

// Review I2: a value the column cannot hold goes as NULL and is counted; text is cut to what the
// column holds (SQL Server counts UTF-16 units: an emoji takes two). The batch is not refused.
TEST_P(SqlIt, ValuesTheColumnCannotHoldGoAsNull) {
    REQUIRE_IT();
    const DbType t = GetParam();
    auto admin = adminSession(t);
    ASSERT_TRUE(admin);
    dropTable(*admin, t, "it_range");
    const std::vector<SqlColumn> cols = {{"I16", TagType::INT16, 255},
                                         {"U16", TagType::UINT16, 255},
                                         {"F32", TagType::FLOAT32, 255},
                                         {"S", TagType::STRING, 4}};
    const std::string smile = "\xF0\x9F\x98\x80";  // U+1F600
    const CellFn cell = [smile](int i, size_t k) -> Cell {
        if (i == 0) {  // nothing fits its column
            if (k == 0) return int64_t{40000};
            if (k == 1) return int64_t{-1};
            if (k == 2) return 1e39;
            return smile + smile + smile;
        }
        if (k == 0) return int64_t{-32768};
        if (k == 1) return int64_t{65535};
        if (k == 2) return 1.5;
        return std::string("abcd");
    };
    Local l("it_range", cols);
    l.add(0, 2, cols, cell);
    const auto sent = forward(connection(t, "mat_writer"), env().userPw, l, cols);
    ASSERT_EQ(sent.status.state, DestState::Ok) << describe(sent.status);
    EXPECT_EQ(sent.status.sentRows, 2u);
    const bool cut = t == DbType::MsSql;  // three emoji are six units of NVARCHAR(4)
    EXPECT_EQ(sent.status.outOfRangeValues, cut ? 4u : 3u);
    const CellFn want = [&](int i, size_t k) -> Cell {
        if (i == 0) return k < 3 ? Cell{} : Cell{cut ? smile + smile : smile + smile + smile};
        return cell(i, k);
    };
    expectRows(t, *admin, "it_range", cols, 0, 2, want);
}

// Review I1: the server refuses the rows of one group (a column of another type); the other group
// of the connection goes on, on the same session: the refused transaction was rolled back.
TEST_P(SqlIt, ARefusedGroupDoesNotBlockTheOtherOnTheSameSession) {
    REQUIRE_IT();
    const DbType t = GetParam();
    auto admin = adminSession(t);
    ASSERT_TRUE(admin);
    dropTable(*admin, t, "it_bad2");
    dropTable(*admin, t, "it_good2");
    auto wrong = kCols;
    wrong.back() = {"S", TagType::INT32, 255};  // the Tag is a STRING
    for (const auto& s : admin->gen().createTable(SqlTable{it::schemaOf(t), "it_bad2", wrong}))
        run(*admin, s);
    if (t == DbType::PostgreSql)
        run(*admin, "GRANT SELECT, INSERT ON public.it_bad2 TO mat_writer");

    const std::string dir = tempDir();
    LocalStore store(dir, [] { return kT0; });
    std::string err;
    ASSERT_TRUE(store.open(err)) << err;
    std::vector<TableSpec> specs;
    for (const char* name : {"it_bad2", "it_good2"}) {
        TableSpec s;
        s.table = name;
        s.groupId = name;
        s.retentionDays = 30;
        for (const auto& c : kCols) s.columns.push_back({c.name, sqliteAffinity(c.type)});
        specs.push_back(s);
    }
    ASSERT_TRUE(store.ensureTables(specs, err)) << err;
    std::vector<PendingRow> rows;
    for (size_t spec = 0; spec < 2; ++spec)
        for (int i = 0; i < 20; ++i) {
            PendingRow r{spec, tsOf(i), {}};
            for (size_t k = 0; k < kCols.size(); ++k) r.cells.push_back(cellOf(i, k));
            rows.push_back(std::move(r));
        }
    ASSERT_TRUE(store.commit(rows, err)) << err;

    ForwarderOptions o;
    o.dbPath = dir + "/history.db";
    o.lowerPriority = false;
    o.secret = [](const std::string&) {
        SecretResult r;
        r.ok = true;
        r.secret = env().userPw;
        return r;
    };
    const ConnectionModel c = connection(t, "mat_writer");
    Forwarder f(c,
                {ForwardGroup{"it_bad2", DestTable{"it_bad2", kCols}},
                 ForwardGroup{"it_good2", DestTable{"it_good2", kCols}}},
                makeDestination(c, ""), o, epochMs, monoMs);
    for (int i = 0; i < 1000 && f.runOnce(); ++i) {
    }
    const DestStatus s = f.status();
    EXPECT_EQ(s.state, DestState::Error);
    EXPECT_EQ(s.lastError, ErrorClass::SchemaMismatch) << describe(s);
    EXPECT_EQ(s.sentRows, 20u) << describe(s);
    expectRows(t, *admin, "it_good2", kCols, 0, 20);
}

// Security review of the fixes: a server (or a man in the middle) must not exhaust the memory of
// the device with a huge answer; the session is closed instead.
TEST_P(SqlIt, AHugeAnswerIsRefused) {
    REQUIRE_IT();
    const DbType t = GetParam();
    SqlLimits lim;
    lim.maxResultRows = 10;
    auto d = makeSqlDestination(connection(t, "mat_writer"), "", lim);
    DestError e;
    ASSERT_TRUE(d->connect(env().userPw, e)) << e.detail;
    const std::string sql = t == DbType::MySql
                                ? "SELECT 1 FROM information_schema.COLUMNS LIMIT 100"
                                : t == DbType::MsSql ? "SELECT TOP 100 1 FROM sys.all_columns"
                                                     : "SELECT 1 FROM generate_series(1, 100)";
    std::vector<std::string> rows;
    EXPECT_FALSE(d->query(sql, rows, e));
    EXPECT_EQ(e.cls, ErrorClass::Connect) << errorClassCode(e.cls) << " " << e.detail;
    EXPECT_LE(rows.size(), 11u);
    d->close();
}

namespace {

// rows [from, to] of a one-column table, seq = i
std::vector<StoredRow> seqRows(int from, int to) {
    std::vector<StoredRow> out;
    for (int i = from; i <= to; ++i) out.push_back(StoredRow{i, tsOf(i), {Cell{1.0 * i}}});
    return out;
}

int64_t rowCount(SqlDestination& admin, DbType t, const std::string& table) {
    const SqlGen g = admin.gen();
    const auto n = column(admin, "SELECT COUNT(*) FROM " + g.qualified(it::schemaOf(t), table));
    return n.size() == 1 ? std::stoll(n[0]) : -1;
}

DestTable oneColumnTable(const std::string& name) { return {name, {{"V", TagType::FLOAT64, 255}}}; }

}  // namespace

// Review of the fixes (Important 2): the cursor moves only from the value the forwarder read. A
// batch of an earlier session that committed after its client gave up (deadline, lost answer)
// moved it: the batch sent again from the old value stores nothing, and the cursor read again
// says where to go on. Both cases: no cursor row yet, and a row with another value.
TEST_P(SqlIt, ABatchFromACursorThatMovedStoresNothing) {
    REQUIRE_IT();
    const DbType t = GetParam();
    auto admin = adminSession(t);
    ASSERT_TRUE(admin);
    dropTable(*admin, t, "it_cas");
    const DestTable table = oneColumnTable("it_cas");
    const std::string src = "it-cas-" + std::to_string(epochMs());
    auto late = makeSqlDestination(connection(t, "mat_writer"), "");
    auto now = makeSqlDestination(connection(t, "mat_writer"), "");
    DestError e;
    ASSERT_TRUE(late->connect(env().userPw, e)) << e.detail;
    ASSERT_TRUE(now->connect(env().userPw, e)) << e.detail;
    ASSERT_TRUE(now->syncSchema(src, {table}, e)) << e.detail;
    ASSERT_TRUE(late->syncSchema(src, {table}, e)) << e.detail;
    // both sessions read "no cursor"; the earlier one commits rows 1 … 5 late
    ASSERT_TRUE(late->writeBatch(src, table, seqRows(1, 5), 0, 5, e)) << e.detail;
    e = DestError{};
    EXPECT_FALSE(now->writeBatch(src, table, seqRows(1, 5), 0, 5, e)) << "stored twice";
    EXPECT_TRUE(isStatementError(e.cls))
        << errorClassCode(e.cls) << " " << e.dbCode << " " << e.detail;
    std::cout << "[it] " << dbTypeName(t) << " cursor moved: " << errorClassCode(e.cls) << " "
              << e.dbCode << "\n";
    int64_t cursor = -1;
    e = DestError{};
    ASSERT_TRUE(now->readCursor(src, "it_cas", cursor, e)) << e.detail;  // the session goes on
    EXPECT_EQ(cursor, 5);
    ASSERT_TRUE(now->writeBatch(src, table, seqRows(6, 10), 5, 10, e)) << e.detail;
    e = DestError{};  // a row with another value: 5 → 10 is refused once the cursor is 10
    EXPECT_FALSE(late->writeBatch(src, table, seqRows(6, 10), 5, 10, e)) << "stored twice";
    EXPECT_EQ(rowCount(*admin, t, "it_cas"), 10);
}

// The same while the transaction of the earlier session still runs on the server (its client
// gave up at the deadline): the new batch waits for its lock, then is refused once it commits.
TEST_P(SqlIt, ABatchWaitingOnALateCommitIsRefusedOnceItCommits) {
    REQUIRE_IT();
    const DbType t = GetParam();
    auto admin = adminSession(t);
    ASSERT_TRUE(admin);
    dropTable(*admin, t, "it_cas2");
    const DestTable table = oneColumnTable("it_cas2");
    const std::string src = "it-cas2-" + std::to_string(epochMs());
    auto now = makeSqlDestination(connection(t, "mat_writer"), "");
    DestError e;
    ASSERT_TRUE(now->connect(env().userPw, e)) << e.detail;
    ASSERT_TRUE(now->syncSchema(src, {table}, e)) << e.detail;
    ASSERT_TRUE(now->writeBatch(src, table, seqRows(1, 5), 0, 5, e)) << e.detail;
    auto late = adminSession(t);  // the earlier session, inside its transaction
    ASSERT_TRUE(late);
    const SqlGen g = late->gen();
    run(*late, t == DbType::MySql ? "START TRANSACTION"
                                  : t == DbType::MsSql ? "BEGIN TRANSACTION" : "BEGIN");
    run(*late, "UPDATE " + g.qualified(it::schemaOf(t), "mat_forward_state") + " SET " +
                   g.ident("last_seq") + " = 10 WHERE " + g.ident("source_id") + " = " +
                   g.stringLiteral(src) + " AND " + g.ident("table_name") + " = " +
                   g.stringLiteral("it_cas2"));
    std::thread commit([&] {
        std::this_thread::sleep_for(std::chrono::milliseconds(1500));
        run(*late, "COMMIT");
    });
    e = DestError{};
    const auto t0 = std::chrono::steady_clock::now();
    const bool sent = now->writeBatch(src, table, seqRows(6, 10), 5, 10, e);
    const double waited =
        std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    commit.join();
    EXPECT_FALSE(sent) << "stored after the late commit";
    EXPECT_GE(waited, 1.0);  // it waited for the lock of the other transaction
    EXPECT_EQ(rowCount(*admin, t, "it_cas2"), 5);
}

INSTANTIATE_TEST_SUITE_P(Databases, SqlIt,
                         ::testing::Values(DbType::MySql, DbType::MsSql, DbType::PostgreSql),
                         paramName);

// tls=require: the session is encrypted (certificate not checked: self-signed test servers).
TEST(SqlTlsIt, RequireEncrypts) {
    REQUIRE_IT();
    if (auto s = adminSession(DbType::MySql, "scada", TlsMode::Require)) {
        const auto v = column(*s,
                              "SELECT VARIABLE_VALUE FROM performance_schema.session_status WHERE "
                              "VARIABLE_NAME = 'Ssl_cipher'");
        ASSERT_EQ(v.size(), 1u);
        EXPECT_FALSE(v[0].empty()) << "MySQL session not encrypted";
    }
    if (auto s = adminSession(DbType::PostgreSql, "scada", TlsMode::Require)) {
        const auto v = column(*s, "SELECT ssl::text FROM pg_stat_ssl WHERE pid = pg_backend_pid()");
        ASSERT_EQ(v.size(), 1u);
        EXPECT_EQ(v[0], "true");
    }
    if (auto s = adminSession(DbType::MsSql, "scada", TlsMode::Require)) {
        const auto v = column(*s,
                              "SELECT CAST(encrypt_option AS VARCHAR(10)) FROM "
                              "sys.dm_exec_connections WHERE session_id = @@SPID");
        ASSERT_EQ(v.size(), 1u);
        EXPECT_EQ(v[0], "TRUE");
    }
}

// Security review M2: verify-full checks the certificate against the system CAs and the host
// name; the self-signed certificates of the test servers are refused (SQL Server through the
// "ca file" of the generated freetds.conf). verify-full is the default, so the status must say
// "tls" for every server type: the user has to fix the certificate, not the network.
TEST(SqlTlsIt, VerifyFullRefusesAnUntrustedCertificate) {
    REQUIRE_IT();
    for (DbType t : {DbType::MySql, DbType::MsSql, DbType::PostgreSql}) {
        auto d = makeSqlDestination(connection(t, "mat_writer", TlsMode::VerifyFull), "");
        DestError e;
        EXPECT_FALSE(d->connect(env().userPw, e))
            << dbTypeName(t) << " connected without a trusted certificate";
        EXPECT_EQ(e.cls, ErrorClass::Tls)
            << dbTypeName(t) << ": " << errorClassCode(e.cls) << " " << e.dbCode << " " << e.detail;
        std::cout << "[it] " << dbTypeName(t) << " verify-full: " << errorClassCode(e.cls) << " "
                  << e.dbCode << "\n";
        d->close();
    }
}

// Review of the fixes I2: libpq alone waits for TCP keepalive (about two hours) when the server
// stops answering after it acknowledged a statement; the client's own deadline ends it.
TEST(SqlLimitsIt, AStatementWithoutAnswerEndsOnTheClientDeadline) {
    REQUIRE_IT();
    SqlLimits lim;
    lim.queryTimeoutMs = 2000;
    auto d = makeSqlDestination(connection(DbType::PostgreSql, "mat_writer"), "", lim);
    DestError e;
    ASSERT_TRUE(d->connect(env().userPw, e)) << e.detail;
    const auto t0 = std::chrono::steady_clock::now();
    EXPECT_FALSE(d->exec("SELECT pg_sleep(8)", e));
    const auto ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    EXPECT_EQ(e.cls, ErrorClass::Timeout) << errorClassCode(e.cls) << " " << e.detail;
    EXPECT_GE(ms, 1900);
    EXPECT_LT(ms, 5000);
    d->close();
}

// Security review of the fixes: a PostgreSQL database in another encoding (WIN1252, the default of
// many Windows installs) would refuse every row holding a character it lacks, forever: refused at
// connect with a clear reason instead.
TEST(PgEncodingIt, ADatabaseThatIsNotUtf8IsRefused) {
    REQUIRE_IT();
    auto admin = adminSession(DbType::PostgreSql);
    ASSERT_TRUE(admin);
    DestError e;
    admin->exec("DROP DATABASE IF EXISTS w1252", e);
    run(*admin,
        "CREATE DATABASE w1252 WITH ENCODING 'WIN1252' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE "
        "template0");
    ConnectionModel c = connection(DbType::PostgreSql, "mat_writer");
    c.database = "w1252";
    auto d = makeSqlDestination(c, "");
    e = DestError{};
    EXPECT_FALSE(d->connect(env().userPw, e));
    EXPECT_EQ(e.cls, ErrorClass::SchemaMismatch) << errorClassCode(e.cls) << " " << e.detail;
    EXPECT_EQ(e.dbCode, "22P05");
}

// Security review of the fixes: the MySQL escaper works in the character set of the session; a
// server that sets another one (init_connect) must not get a session the escaper does not match.
TEST(MysqlCharsetIt, TheSessionIsUtf8mb4WhateverTheServerSets) {
    REQUIRE_IT();
    auto admin = adminSession(DbType::MySql);
    ASSERT_TRUE(admin);
    run(*admin, "SET GLOBAL init_connect = 'SET NAMES latin1'");
    struct Restore {
        SqlDestination& s;
        ~Restore() {
            DestError ignored;
            s.exec("SET GLOBAL init_connect = ''", ignored);
        }
    } restore{*admin};
    auto d = makeSqlDestination(connection(DbType::MySql, "mat_writer"), "");
    DestError e;
    ASSERT_TRUE(d->connect(env().userPw, e)) << e.detail;
    EXPECT_EQ(column(*d, "SELECT @@character_set_client"), std::vector<std::string>{"utf8mb4"});
    const std::string text = "Bồn \xE1\xBB\x93' \\ \"x\"";
    EXPECT_EQ(column(*d, "SELECT " + d->gen().stringLiteral(text)), std::vector<std::string>{text});
    d->close();
}

// ---------------------------------------------------------------- InfluxDB

namespace {

ConnectionModel influxConnection(const std::string& bucket = "scada") {
    ConnectionModel c = connection(DbType::InfluxDb, "");
    c.bucket = bucket;
    return c;
}

std::vector<std::pair<std::string, std::string>> influxField(const std::string& measurement,
                                                             const std::string& source,
                                                             const std::string& field) {
    std::string err;
    auto out =
        it::influxField(env().influx, env().token, "mat", "scada", measurement, source, field, err);
    EXPECT_TRUE(err.empty()) << err;
    return out;
}

}  // namespace

TEST(InfluxIt, RoundTrip600Rows) {
    REQUIRE_IT();
    Local l("it_influx", kCols);
    l.add(0, kRows, kCols);
    const auto sent = forward(influxConnection(), env().token, l, kCols);
    ASSERT_EQ(sent.status.state, DestState::Ok) << describe(sent.status);
    EXPECT_EQ(sent.status.sentRows, static_cast<uint64_t>(kRows));
    EXPECT_LT(sent.seconds, 10.0);
    std::cout << "[it] influxdb: " << kRows << " rows in " << sent.seconds << " s\n";
    RecordProperty("seconds", std::to_string(sent.seconds));
    ASSERT_EQ(sent.cursors.size(), 1u);  // device cursor (mat_forward)
    EXPECT_EQ(sent.cursors[0].lastSeq, kRows);
    for (size_t k = 0; k < kCols.size(); ++k) {
        const auto got = influxField("it_influx", l.instanceId(), kCols[k].name);
        std::vector<int> want;
        for (int i = 0; i < kRows; ++i)
            if (!std::holds_alternative<std::monostate>(cellOf(i, k))) want.push_back(i);
        ASSERT_EQ(got.size(), want.size()) << kCols[k].name;
        for (size_t n = 0; n < want.size(); ++n) {
            const int i = want[n];
            const std::string where = kCols[k].name + " row " + std::to_string(i);
            EXPECT_EQ(got[n].first, it::rfc3339(tsOf(i))) << where;
            const Cell c = cellOf(i, k);
            const std::string& v = got[n].second;
            switch (kCols[k].type) {
                case TagType::BOOL:
                    EXPECT_EQ(v, std::get<int64_t>(c) ? "true" : "false") << where;
                    break;
                case TagType::STRING: {
                    std::string s = std::get<std::string>(c);
                    std::replace(s.begin(), s.end(), '\n', ' ');  // line protocol: no line break
                    EXPECT_EQ(v, s) << where;
                    break;
                }
                default:
                    EXPECT_TRUE(it::sameValue("V" + v, c, kCols[k].type))
                        << where << ": got " << v << ", want " << it::expectedText(c);
            }
        }
    }
}

TEST(InfluxIt, WrongTokenIsAuthAndMissingBucketIsSchemaMismatch) {
    REQUIRE_IT();
    Local l("it_influx_err", kCols);
    l.add(0, 3, kCols);
    const auto bad = forward(influxConnection(), "wrong-token", l, kCols);
    EXPECT_EQ(bad.status.state, DestState::Error);
    EXPECT_EQ(bad.status.lastError, ErrorClass::Auth) << describe(bad.status);
    EXPECT_EQ(bad.status.lastErrorDbCode, "401");
    const auto nobucket = forward(influxConnection("no-such-bucket"), env().token, l, kCols);
    EXPECT_EQ(nobucket.status.state, DestState::Error);
    EXPECT_EQ(nobucket.status.lastError, ErrorClass::SchemaMismatch) << describe(nobucket.status);
    EXPECT_EQ(nobucket.status.lastErrorDbCode, "404");
}

TEST(InfluxIt, SixtyFourLongStringTags) {
    REQUIRE_IT();
    std::vector<SqlColumn> cols;
    for (int k = 0; k < 64; ++k) cols.push_back({"S" + std::to_string(k), TagType::STRING, 255});
    Local l("it_influx_wide", cols);
    l.add(0, 5, cols, [](int i, size_t k) -> Cell {
        return std::string(255, static_cast<char>('a' + (i + static_cast<int>(k)) % 26));
    });
    const auto sent = forward(influxConnection(), env().token, l, cols);
    ASSERT_EQ(sent.status.state, DestState::Ok) << describe(sent.status);
    EXPECT_EQ(influxField("it_influx_wide", l.instanceId(), "S63").size(), 5u);
}

// Review I3: points older than what the bucket keeps are dropped by the server; the rest of the
// batch is written, the forwarder counts the dropped ones and goes on (instead of sending the
// same batch forever).
TEST(InfluxIt, PointsOlderThanTheBucketKeepsAreCountedAndTheRestGoes) {
    REQUIRE_IT();
    std::string err;
    ASSERT_TRUE(it::ensureBucket(env().influx, env().token, "mat", "it-short", 3600, err)) << err;
    const std::string dir = tempDir();
    LocalStore store(dir, [] { return kT0; });
    ASSERT_TRUE(store.open(err)) << err;
    TableSpec s;
    s.table = "it_short";
    s.groupId = "it_short";
    s.retentionDays = 30;
    s.columns = {{"V", "REAL"}};
    ASSERT_TRUE(store.ensureTables({s}, err)) << err;
    const int64_t now = epochMs();
    std::vector<PendingRow> rows;
    for (int i = 0; i < 3; ++i) rows.push_back({0, now - 2 * 86400000LL + i, {1.0 + i}});
    for (int i = 0; i < 3; ++i) rows.push_back({0, now - 60000 + i, {10.0 + i}});
    ASSERT_TRUE(store.commit(rows, err)) << err;

    ForwarderOptions o;
    o.dbPath = dir + "/history.db";
    o.lowerPriority = false;
    o.secret = [](const std::string&) {
        SecretResult r;
        r.ok = true;
        r.secret = env().token;
        return r;
    };
    const ConnectionModel c = influxConnection("it-short");
    Forwarder f(c,
                {ForwardGroup{"it_short", DestTable{"it_short", {{"V", TagType::FLOAT64, 255}}}}},
                makeDestination(c, ""), o, epochMs, monoMs);
    for (int i = 0; i < 1000 && f.runOnce(); ++i) {
    }
    const DestStatus st = f.status();
    EXPECT_EQ(st.state, DestState::Ok) << describe(st);
    EXPECT_EQ(st.sentRows, 6u);
    EXPECT_EQ(st.rejectedRows, 3u);
    EXPECT_EQ(st.pendingRows, 0);
    const auto got = it::influxField(env().influx, env().token, "mat", "it-short", "it_short",
                                     store.instanceId(), "V", err);
    EXPECT_TRUE(err.empty()) << err;
    EXPECT_EQ(got.size(), 3u);
}
