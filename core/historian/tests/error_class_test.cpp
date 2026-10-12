// Error classes of the destinations (specs/003-data-logging/contracts/system-info.md).
#include "core/historian/forward/error_class.hpp"

#include <gtest/gtest.h>

using namespace mat;

TEST(ErrorClass, MySql) {
    EXPECT_EQ(classifyMysql(1045), ErrorClass::Auth);
    EXPECT_EQ(classifyMysql(2003), ErrorClass::Connect);
    EXPECT_EQ(classifyMysql(2013), ErrorClass::Connect);
    EXPECT_EQ(classifyMysql(2026), ErrorClass::Tls);
    EXPECT_EQ(classifyMysql(1142), ErrorClass::Permission);
    EXPECT_EQ(classifyMysql(1044), ErrorClass::Permission);
    EXPECT_EQ(classifyMysql(1054), ErrorClass::SchemaMismatch);
    EXPECT_EQ(classifyMysql(1146), ErrorClass::SchemaMismatch);
    EXPECT_EQ(classifyMysql(1366), ErrorClass::SchemaMismatch);
    EXPECT_EQ(classifyMysql(1064), ErrorClass::Sql);
    EXPECT_EQ(classifyMysql(1049), ErrorClass::SchemaMismatch);  // unknown database
    EXPECT_EQ(classifyMysql(1406), ErrorClass::SchemaMismatch);  // data too long for column
}

TEST(ErrorClass, SqlServer) {
    EXPECT_EQ(classifyMssql(18456), ErrorClass::Auth);
    EXPECT_EQ(classifyMssql(20009), ErrorClass::Connect);
    EXPECT_EQ(classifyMssql(20003), ErrorClass::Timeout);
    EXPECT_EQ(classifyMssql(20013), ErrorClass::Connect);  // unknown host (network down)
    EXPECT_EQ(classifyMssql(20047), ErrorClass::Connect);  // connection dead
    EXPECT_EQ(classifyMssql(20014), ErrorClass::Auth);
    EXPECT_EQ(classifyMssql(229), ErrorClass::Permission);
    EXPECT_EQ(classifyMssql(262), ErrorClass::Permission);
    EXPECT_EQ(classifyMssql(4902), ErrorClass::Permission);  // ALTER TABLE without the right
    EXPECT_EQ(classifyMssql(207), ErrorClass::SchemaMismatch);
    EXPECT_EQ(classifyMssql(208), ErrorClass::SchemaMismatch);
    EXPECT_EQ(classifyMssql(245), ErrorClass::SchemaMismatch);
    EXPECT_EQ(classifyMssql(8152), ErrorClass::SchemaMismatch);
    EXPECT_EQ(classifyMssql(102), ErrorClass::Sql);
    EXPECT_EQ(classifyMssql(911), ErrorClass::SchemaMismatch);   // database does not exist
    EXPECT_EQ(classifyMssql(2628), ErrorClass::SchemaMismatch);  // string would be truncated
}

// verify-full is the default: a SQL Server certificate FreeTDS does not trust must read as a TLS
// problem, not as a server that cannot be reached (FreeTDS ends such a login with SYBEFCON).
TEST(ErrorClass, SqlServerLoginEndedAfterTheConnectionWithTlsDemandedIsTls) {
    EXPECT_EQ(classifyMssqlOpen(20002, true), ErrorClass::Tls);
    EXPECT_EQ(classifyMssqlOpen(20002, false), ErrorClass::Connect);  // off / request
    EXPECT_EQ(classifyMssqlOpen(20009, true), ErrorClass::Connect);   // no TCP connection
    EXPECT_EQ(classifyMssqlOpen(20013, true), ErrorClass::Connect);   // unknown host
    EXPECT_EQ(classifyMssqlOpen(20003, true), ErrorClass::Timeout);
    EXPECT_EQ(classifyMssqlOpen(18456, true), ErrorClass::Auth);  // the server answered
}

TEST(ErrorClass, PostgreSql) {
    EXPECT_EQ(classifyPg("28P01"), ErrorClass::Auth);
    EXPECT_EQ(classifyPg("28000"), ErrorClass::Auth);
    EXPECT_EQ(classifyPg("08006"), ErrorClass::Connect);
    EXPECT_EQ(classifyPg("42501"), ErrorClass::Permission);
    EXPECT_EQ(classifyPg("42703"), ErrorClass::SchemaMismatch);
    EXPECT_EQ(classifyPg("42P01"), ErrorClass::SchemaMismatch);
    EXPECT_EQ(classifyPg("22003"), ErrorClass::SchemaMismatch);
    EXPECT_EQ(classifyPg("42601"), ErrorClass::Sql);
    EXPECT_EQ(classifyPg("08001"), ErrorClass::Connect);
    EXPECT_EQ(classifyPg("22001"), ErrorClass::SchemaMismatch);  // string data right truncation
    EXPECT_EQ(classifyPg("3F000"), ErrorClass::SchemaMismatch);  // schema does not exist
    EXPECT_EQ(classifyPg("57014"), ErrorClass::Timeout);         // statement_timeout
    EXPECT_EQ(classifyPg(""), ErrorClass::Sql);
}

// libpq gives no SQLSTATE when the connection itself fails: the message decides.
TEST(ErrorClass, PostgreSqlConnectionFailures) {
    EXPECT_EQ(classifyPgConnect("FATAL:  password authentication failed for user \"scada\""),
              ErrorClass::Auth);
    EXPECT_EQ(classifyPgConnect("FATAL:  no pg_hba.conf entry for host \"10.0.0.5\""),
              ErrorClass::Auth);
    EXPECT_EQ(classifyPgConnect("server does not support SSL, but SSL was required"),
              ErrorClass::Tls);
    EXPECT_EQ(classifyPgConnect("SSL error: certificate verify failed"), ErrorClass::Tls);
    EXPECT_EQ(classifyPgConnect("timeout expired"), ErrorClass::Timeout);
    EXPECT_EQ(classifyPgConnect("FATAL:  database \"scada\" does not exist"),
              ErrorClass::SchemaMismatch);
    EXPECT_EQ(classifyPgConnect("FATAL:  permission denied for database \"scada\""),
              ErrorClass::Permission);
    EXPECT_EQ(classifyPgConnect("could not connect to server: Connection refused"),
              ErrorClass::Connect);
}

TEST(ErrorClass, HttpAndCurl) {
    EXPECT_EQ(classifyHttp(401), ErrorClass::Auth);
    EXPECT_EQ(classifyHttp(403), ErrorClass::Auth);
    EXPECT_EQ(classifyHttp(400), ErrorClass::SchemaMismatch);
    EXPECT_EQ(classifyHttp(404), ErrorClass::SchemaMismatch);
    EXPECT_EQ(classifyHttp(503), ErrorClass::Http);
    EXPECT_EQ(classifyHttp(413), ErrorClass::Http);
    EXPECT_EQ(classifyCurl(7), ErrorClass::Connect);   // CURLE_COULDNT_CONNECT
    EXPECT_EQ(classifyCurl(6), ErrorClass::Connect);   // CURLE_COULDNT_RESOLVE_HOST
    EXPECT_EQ(classifyCurl(28), ErrorClass::Timeout);  // CURLE_OPERATION_TIMEDOUT
    EXPECT_EQ(classifyCurl(35), ErrorClass::Tls);      // CURLE_SSL_CONNECT_ERROR
    EXPECT_EQ(classifyCurl(60), ErrorClass::Tls);      // CURLE_PEER_FAILED_VERIFICATION
}

TEST(ErrorClass, CodesAndFixedMessages) {
    EXPECT_STREQ(errorClassCode(ErrorClass::NoClient), "no_client");
    EXPECT_STREQ(errorClassCode(ErrorClass::NoSecret), "no_secret");
    EXPECT_STREQ(errorClassCode(ErrorClass::SchemaMismatch), "schema_mismatch");
    EXPECT_STREQ(errorClassMessage(ErrorClass::Auth), "Sai tài khoản hoặc mật khẩu");
    EXPECT_STREQ(errorClassMessage(ErrorClass::Connect), "Không kết nối được máy chủ");
    // every class of the contract has a code and a fixed message
    for (ErrorClass c :
         {ErrorClass::NoClient, ErrorClass::NoSecret, ErrorClass::Connect, ErrorClass::Auth,
          ErrorClass::Tls, ErrorClass::Timeout, ErrorClass::Permission, ErrorClass::SchemaMismatch,
          ErrorClass::Sql, ErrorClass::Http}) {
        EXPECT_GT(std::string(errorClassCode(c)).size(), 2u);
        EXPECT_GT(std::string(errorClassMessage(c)).size(), 10u);
        EXPECT_EQ(std::string(errorClassMessage(c)).find('%'), std::string::npos);
    }
    EXPECT_STREQ(errorClassCode(ErrorClass::Http), "http");
    EXPECT_STREQ(errorClassCode(ErrorClass::None), "");
}

// Security review M4: the SQLSTATE comes from the server as is; only five [0-9A-Z] are a code.
TEST(ErrorClass, SqlStateShape) {
    EXPECT_TRUE(isSqlState("28P01"));
    EXPECT_TRUE(isSqlState("42501"));
    EXPECT_FALSE(isSqlState(nullptr));
    EXPECT_FALSE(isSqlState(""));
    EXPECT_FALSE(isSqlState("28p01"));
    EXPECT_FALSE(isSqlState("\xff"));
    EXPECT_FALSE(isSqlState("123456"));
    EXPECT_FALSE(isSqlState("1234"));
}

// Review I1: an error of one statement keeps the connection; the others close it.
TEST(ErrorClass, StatementErrors) {
    for (auto c : {ErrorClass::Sql, ErrorClass::SchemaMismatch, ErrorClass::Permission})
        EXPECT_TRUE(isStatementError(c)) << errorClassCode(c);
    for (auto c : {ErrorClass::Connect, ErrorClass::Timeout, ErrorClass::Auth, ErrorClass::Tls,
                   ErrorClass::Http, ErrorClass::NoClient, ErrorClass::NoSecret})
        EXPECT_FALSE(isStatementError(c)) << errorClassCode(c);
}

// A client error of MySQL (CR_*, 2000 … 2999) or a connection the server dropped means the
// session is gone: reconnect, never keep it for the other groups.
TEST(ErrorClass, MySqlLostSessionsCloseTheConnection) {
    for (unsigned int c : {2000u, 2006u, 2014u, 2027u, 2048u, 4031u, 1927u})
        EXPECT_EQ(classifyMysql(c), ErrorClass::Connect) << c;
    EXPECT_EQ(classifyMysql(2026), ErrorClass::Tls);
    EXPECT_EQ(classifyMysql(2061), ErrorClass::Tls);
    EXPECT_EQ(classifyMysql(2059), ErrorClass::NoClient);
    EXPECT_EQ(classifyMysql(1064), ErrorClass::Sql);
}

// Security review of the fixes: line separators and bidirectional controls cannot rearrange how a
// journal line reads either.
TEST(ErrorClass, JournalTextShowsInvisibleControls) {
    EXPECT_EQ(journalSafe("a\u202Eb\u2028c\u2066d\u200Fe"), "a\\u202eb\\u2028c\\u2066d\\u200fe");
    EXPECT_EQ(journalSafe("x\u061Cy"), "x\\u061cy");  // Arabic letter mark (review of the fixes)
    EXPECT_EQ(journalSafe("Bồn số 1 · ok"), "Bồn số 1 · ok");
}
