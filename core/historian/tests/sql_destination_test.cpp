// Schema sync and cursor read shared by the SQL destinations (specs/003-data-logging
// contracts/external-schema.md "Đồng bộ lược đồ"), on a scripted session.
#include "core/historian/forward/sql_destination.hpp"

#include <gtest/gtest.h>

#include <utility>

using namespace mat;

namespace {

std::string fakeEscape(const std::string& s) {
    std::string q = "'";
    for (char c : s) {
        if (c == '\'') q += '\'';
        q += c;
    }
    return q + "'";
}

// PostgreSQL text; answers by what a statement contains, records every statement.
class ScriptedSql : public SqlDestination {
   public:
    ScriptedSql() : SqlDestination(connection()) {}

    static ConnectionModel connection() {
        ConnectionModel c;
        c.id = "pg";
        c.type = DbType::PostgreSql;
        c.schema = "public";
        return c;
    }
    bool connect(const std::string&, DestError&) override {
        newSession();
        return true;
    }
    bool writeBatch(const std::string&, const DestTable&, const std::vector<StoredRow>&, int64_t,
                    int64_t, DestError&) override {
        return true;
    }
    void close() override {}
    bool exec(const std::string& sql, DestError& err) override {
        log.push_back(sql);
        for (const auto& f : failures)
            if (sql.rfind(f.first, 0) == 0) {
                err = f.second;
                return false;
            }
        return true;
    }
    bool query(const std::string& sql, std::vector<std::string>& column, DestError& err) override {
        if (!exec(sql, err)) return false;
        for (const auto& a : answers)
            if (sql.find(a.first) != std::string::npos) {
                column = a.second;
                break;
            }
        return true;
    }
    SqlGen gen() const override { return SqlGen(SqlDialect::PostgreSql, 0, fakeEscape); }

    size_t count(const std::string& prefix) const {
        size_t n = 0;
        for (const auto& s : log) n += s.rfind(prefix, 0) == 0 ? 1 : 0;
        return n;
    }

    std::vector<std::string> log;
    std::vector<std::pair<std::string, DestError>> failures;  // statement start → error
    std::vector<std::pair<std::string, std::vector<std::string>>> answers;  // text → rows
};

DestTable table(const std::string& name) { return {name, {{"V", TagType::FLOAT64, 255}}}; }

const std::vector<std::string> kStateColumns{"source_id", "table_name", "last_seq", "updated_at"};

DestError error(ErrorClass cls, const std::string& code) {
    DestError e;
    e.cls = cls;
    e.dbCode = code;
    return e;
}

}  // namespace

TEST(SqlDestination, SyncCreatesWhatIsMissingAndLooksForTheIndexFirst) {
    ScriptedSql d;
    DestError err;
    ASSERT_TRUE(d.connect("", err));
    d.answers = {{"'mat_forward_state'", kStateColumns},
                 {"table_name = 'g1'", {"id", "time"}}};  // the table is there, without V
    ASSERT_TRUE(d.syncSchema("src", {table("g1")}, err)) << err.detail;
    EXPECT_EQ(d.count("CREATE TABLE IF NOT EXISTS \"public\".\"mat_forward_state\""), 1u);
    EXPECT_EQ(d.count("CREATE INDEX"), 1u);  // no index yet
    EXPECT_EQ(d.count("ALTER TABLE \"public\".\"g1\" ADD COLUMN IF NOT EXISTS \"v\""), 1u);

    // Review I7: an index that exists is never asked for again (no lock on the table), and the
    // cursor table is synced once per session, not once per group.
    d.answers.insert(d.answers.begin(), {"indexname = 'ix_g1_time'", {"ix_g1_time"}});
    d.log.clear();
    ASSERT_TRUE(d.syncSchema("src", {table("g1")}, err)) << err.detail;
    EXPECT_EQ(d.count("CREATE INDEX"), 0u);
    EXPECT_EQ(d.count("CREATE TABLE IF NOT EXISTS \"public\".\"mat_forward_state\""), 0u);

    ASSERT_TRUE(d.connect("", err));  // a new session checks the cursor table again
    d.log.clear();
    ASSERT_TRUE(d.syncSchema("src", {table("g1")}, err)) << err.detail;
    EXPECT_EQ(d.count("CREATE TABLE IF NOT EXISTS \"public\".\"mat_forward_state\""), 1u);
}

// Review I7: on a connection that is gone or timed out, nothing more is sent (each statement
// would wait for its own timeout).
TEST(SqlDestination, ALostConnectionStopsTheSyncAtOnce) {
    ScriptedSql d;
    DestError err;
    ASSERT_TRUE(d.connect("", err));
    d.failures = {{"CREATE TABLE", error(ErrorClass::Timeout, "57014")}};
    EXPECT_FALSE(d.syncSchema("src", {table("g1"), table("g2")}, err));
    EXPECT_EQ(err.cls, ErrorClass::Timeout);
    EXPECT_EQ(d.log.size(), 1u);
}

// Tables prepared by the database administrator: a DDL the account may not run is fine as long
// as the table has every column.
TEST(SqlDestination, ADdlTheAccountMayNotRunIsFineWhenTheTableIsReady) {
    ScriptedSql d;
    DestError err;
    ASSERT_TRUE(d.connect("", err));
    d.failures = {{"CREATE", error(ErrorClass::Permission, "42501")},
                  {"ALTER", error(ErrorClass::Permission, "42501")}};
    d.answers = {{"'mat_forward_state'", kStateColumns},
                 {"table_name = 'g1'", {"id", "time", "v"}},
                 {"indexname = 'ix_g1_time'", {}}};  // no index, and none can be made: still fine
    EXPECT_TRUE(d.syncSchema("src", {table("g1")}, err)) << err.detail;
    // missing and cannot be created: the DDL error tells why
    EXPECT_FALSE(d.syncSchema("src", {table("g2")}, err));
    EXPECT_EQ(err.cls, ErrorClass::Permission);
    EXPECT_EQ(err.dbCode, "42501");
}

// Security review hardening 2: the cursor comes from the server; only a number the device can use
// is taken.
TEST(SqlDestination, CursorMustBeANumberTheDeviceCanUse) {
    ScriptedSql d;
    DestError err;
    ASSERT_TRUE(d.connect("", err));
    int64_t seq = -1;
    d.answers = {{"mat_forward_state", {"42"}}};
    ASSERT_TRUE(d.readCursor("src", "g1", seq, err)) << err.detail;
    EXPECT_EQ(seq, 42);
    d.answers = {{"mat_forward_state", {}}};
    ASSERT_TRUE(d.readCursor("src", "g1", seq, err)) << err.detail;
    EXPECT_EQ(seq, 0);  // no row yet
    for (const char* bad : {"-5", "abc", "12x", "99999999999999999999", ""}) {
        d.answers = {{"mat_forward_state", {bad}}};
        err = DestError{};
        EXPECT_FALSE(d.readCursor("src", "g1", seq, err)) << bad;
        EXPECT_EQ(err.cls, ErrorClass::SchemaMismatch) << bad;
    }
}
