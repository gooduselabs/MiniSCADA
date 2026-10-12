// x64 only: the in-house client declarations (specs/003-data-logging research R7) against the real
// headers of the toolchain image (libmariadb-dev, freetds-dev, libpq-dev, libcurl4-openssl-dev).
// A wrong constant or signature fails the build here instead of crashing on the device.
#include <gtest/gtest.h>

// sybdb.h defines FAIL and SUCCEED, like gtest: this file uses neither gtest macro.
#undef FAIL
#undef SUCCEED

#include <curl/curl.h>
#include <mariadb/errmsg.h>
#include <mariadb/mysql.h>
#include <postgresql/libpq-fe.h>
#include <sybdb.h>
#include <sybfront.h>

#include <cstddef>
#include <type_traits>

#include "core/historian/forward/curl_api.hpp"
#include "core/historian/forward/dyn_lib.hpp"
#include "core/historian/forward/freetds_api.hpp"
#include "core/historian/forward/libpq_api.hpp"
#include "core/historian/forward/mysql_api.hpp"

using namespace mat::capi;

// ---------------------------------------------------------------- MariaDB Connector/C
static_assert(kMysqlOptConnectTimeout == MYSQL_OPT_CONNECT_TIMEOUT, "");
static_assert(kMysqlSetCharsetName == MYSQL_SET_CHARSET_NAME, "");
static_assert(kMysqlOptLocalInfile == MYSQL_OPT_LOCAL_INFILE, "");
static_assert(kMysqlOptReadTimeout == MYSQL_OPT_READ_TIMEOUT, "");
static_assert(kMysqlOptWriteTimeout == MYSQL_OPT_WRITE_TIMEOUT, "");
static_assert(kMysqlOptSslVerifyServerCert == MYSQL_OPT_SSL_VERIFY_SERVER_CERT, "");
static_assert(kMysqlOptSslCa == MYSQL_OPT_SSL_CA, "");
static_assert(kMysqlOptSslEnforce == MYSQL_OPT_SSL_ENFORCE, "");
static_assert(kMysqlOptMaxAllowedPacket == MYSQL_OPT_MAX_ALLOWED_PACKET, "");
static_assert(kClientFoundRows == CLIENT_FOUND_ROWS, "");
static_assert(kCrSslConnectionError == CR_SSL_CONNECTION_ERROR, "");
static_assert(sizeof(enum mysql_option) == sizeof(int), "enum passed as int");
static_assert(std::is_same<my_ulonglong, unsigned long long>::value, "");

using RealMysql = MysqlSig<MYSQL, MYSQL_RES, enum mysql_option>;
static_assert(std::is_same<RealMysql::ServerInit, decltype(&mysql_server_init)>::value, "");
static_assert(std::is_same<RealMysql::Init, decltype(&mysql_init)>::value, "");
static_assert(std::is_same<RealMysql::Options, decltype(&mysql_options)>::value, "");
static_assert(std::is_same<RealMysql::RealConnect, decltype(&mysql_real_connect)>::value, "");
static_assert(std::is_same<RealMysql::RealQuery, decltype(&mysql_real_query)>::value, "");
static_assert(std::is_same<RealMysql::StoreResult, decltype(&mysql_store_result)>::value, "");
static_assert(std::is_same<RealMysql::FetchRow, decltype(&mysql_fetch_row)>::value, "");
static_assert(std::is_same<RealMysql::FreeResult, decltype(&mysql_free_result)>::value, "");
static_assert(std::is_same<RealMysql::AffectedRows, decltype(&mysql_affected_rows)>::value, "");
static_assert(std::is_same<RealMysql::Errno, decltype(&mysql_errno)>::value, "");
static_assert(std::is_same<RealMysql::Error, decltype(&mysql_error)>::value, "");
static_assert(std::is_same<RealMysql::RealEscapeString, decltype(&mysql_real_escape_string)>::value,
              "");
static_assert(std::is_same<RealMysql::Close, decltype(&mysql_close)>::value, "");
static_assert(std::is_same<RealMysql::UseResult, decltype(&mysql_use_result)>::value, "");
static_assert(std::is_same<RealMysql::FetchLengths, decltype(&mysql_fetch_lengths)>::value, "");
static_assert(std::is_same<RealMysql::SetCharacterSet, decltype(&mysql_set_character_set)>::value,
              "");
static_assert(std::is_same<RealMysql::GetSocket, decltype(&mysql_get_socket)>::value, "");

// ---------------------------------------------------------------- FreeTDS db-lib
static_assert(kDbSetUser == DBSETUSER, "");
static_assert(kDbSetPwd == DBSETPWD, "");
static_assert(kDbSetApp == DBSETAPP, "");
static_assert(kDbSetCharset == DBSETCHARSET, "");
static_assert(kDbSetDbName == DBSETDBNAME, "");
static_assert(kDbVersion74 == DBVERSION_74, "");
static_assert(kSucceed == SUCCEED, "");
static_assert(kFail == FAIL, "");
static_assert(kNoMoreResults == NO_MORE_RESULTS, "");
static_assert(kNoMoreRows == NO_MORE_ROWS, "");
static_assert(kRegRow == REG_ROW, "");
static_assert(kIntCancel == INT_CANCEL, "");
static_assert(kSybChar == SYBCHAR && kSybVarChar == SYBVARCHAR && kSybText == SYBTEXT &&
                  kSybNText == SYBNTEXT && kSybNVarChar == SYBNVARCHAR,
              "");
static_assert(kSybeFcon == SYBEFCON, "");
static_assert(kSybeTime == SYBETIME, "");
static_assert(kSybeConn == SYBECONN, "");
static_assert(std::is_same<DBINT, int32_t>::value && std::is_same<RETCODE, int>::value &&
                  std::is_same<STATUS, int>::value && std::is_same<BYTE, unsigned char>::value,
              "");

using RealSybdb = SybdbSig<DBPROCESS, LOGINREC>;
static_assert(std::is_same<RealSybdb::ErrHandler, EHANDLEFUNC>::value, "");
static_assert(std::is_same<RealSybdb::MsgHandler, MHANDLEFUNC>::value, "");
static_assert(std::is_same<RealSybdb::Init, decltype(&dbinit)>::value, "");
static_assert(std::is_same<RealSybdb::Login, decltype(&dblogin)>::value, "");
static_assert(std::is_same<RealSybdb::LoginFree, decltype(&dbloginfree)>::value, "");
static_assert(std::is_same<RealSybdb::SetLName, decltype(&dbsetlname)>::value, "");
static_assert(std::is_same<RealSybdb::SetLVersion, decltype(&dbsetlversion)>::value, "");
static_assert(std::is_same<RealSybdb::Open, decltype(&tdsdbopen)>::value, "");
static_assert(std::is_same<RealSybdb::Use, decltype(&dbuse)>::value, "");
static_assert(std::is_same<RealSybdb::Cmd, decltype(&dbcmd)>::value, "");
static_assert(std::is_same<RealSybdb::SqlExec, decltype(&dbsqlexec)>::value, "");
static_assert(std::is_same<RealSybdb::Results, decltype(&dbresults)>::value, "");
static_assert(std::is_same<RealSybdb::NextRow, decltype(&dbnextrow)>::value, "");
static_assert(std::is_same<RealSybdb::Count, decltype(&dbcount)>::value, "");
static_assert(std::is_same<RealSybdb::Data, decltype(&dbdata)>::value, "");
static_assert(std::is_same<RealSybdb::DatLen, decltype(&dbdatlen)>::value, "");
static_assert(std::is_same<RealSybdb::ColType, decltype(&dbcoltype)>::value, "");
static_assert(std::is_same<RealSybdb::Convert, decltype(&dbconvert)>::value, "");
static_assert(std::is_same<RealSybdb::Cancel, decltype(&dbcancel)>::value, "");
static_assert(std::is_same<RealSybdb::Close, decltype(&dbclose)>::value, "");
static_assert(std::is_same<RealSybdb::Dead, decltype(&dbdead)>::value, "");
static_assert(std::is_same<RealSybdb::SetLoginTime, decltype(&dbsetlogintime)>::value, "");
static_assert(std::is_same<RealSybdb::SetTime, decltype(&dbsettime)>::value, "");
static_assert(std::is_same<RealSybdb::ErrHandle, decltype(&dberrhandle)>::value, "");
static_assert(std::is_same<RealSybdb::MsgHandle, decltype(&dbmsghandle)>::value, "");

// ---------------------------------------------------------------- libpq
static_assert(kConnectionOk == CONNECTION_OK, "");
static_assert(kConnectionBad == CONNECTION_BAD, "");
static_assert(kPgresEmptyQuery == PGRES_EMPTY_QUERY, "");
static_assert(kPgresCommandOk == PGRES_COMMAND_OK, "");
static_assert(kPgresTuplesOk == PGRES_TUPLES_OK, "");
static_assert(kPgresSingleTuple == PGRES_SINGLE_TUPLE, "");
static_assert(kPgresBadResponse == PGRES_BAD_RESPONSE, "");
static_assert(kPgresNonfatalError == PGRES_NONFATAL_ERROR, "");
static_assert(kPgresFatalError == PGRES_FATAL_ERROR, "");
static_assert(kPgPollingFailed == PGRES_POLLING_FAILED &&
                  kPgPollingReading == PGRES_POLLING_READING &&
                  kPgPollingWriting == PGRES_POLLING_WRITING && kPgPollingOk == PGRES_POLLING_OK,
              "");
static_assert(sizeof(PostgresPollingStatusType) == sizeof(int), "");
static_assert(kPgDiagSqlstate == PG_DIAG_SQLSTATE, "");
static_assert(sizeof(ConnStatusType) == sizeof(int) && sizeof(ExecStatusType) == sizeof(int), "");

using RealPq = PqSig<PGconn, PGresult, ConnStatusType, ExecStatusType, PostgresPollingStatusType>;
static_assert(std::is_same<RealPq::ConnectdbParams, decltype(&PQconnectdbParams)>::value, "");
static_assert(std::is_same<RealPq::Status, decltype(&PQstatus)>::value, "");
static_assert(std::is_same<RealPq::ErrorMessage, decltype(&PQerrorMessage)>::value, "");
static_assert(std::is_same<RealPq::Finish, decltype(&PQfinish)>::value, "");
static_assert(std::is_same<RealPq::Exec, decltype(&PQexec)>::value, "");
static_assert(std::is_same<RealPq::ResultStatus, decltype(&PQresultStatus)>::value, "");
static_assert(std::is_same<RealPq::ResultErrorField, decltype(&PQresultErrorField)>::value, "");
static_assert(std::is_same<RealPq::Ntuples, decltype(&PQntuples)>::value, "");
static_assert(std::is_same<RealPq::GetValue, decltype(&PQgetvalue)>::value, "");
static_assert(std::is_same<RealPq::GetIsNull, decltype(&PQgetisnull)>::value, "");
static_assert(std::is_same<RealPq::Clear, decltype(&PQclear)>::value, "");
static_assert(std::is_same<RealPq::EscapeLiteral, decltype(&PQescapeLiteral)>::value, "");
static_assert(std::is_same<RealPq::FreeMem, decltype(&PQfreemem)>::value, "");
static_assert(std::is_same<RealPq::SetNoticeProcessor, decltype(&PQsetNoticeProcessor)>::value, "");
static_assert(std::is_same<RealPq::ConnectStartParams, decltype(&PQconnectStartParams)>::value, "");
static_assert(std::is_same<RealPq::ConnectPoll, decltype(&PQconnectPoll)>::value, "");
static_assert(std::is_same<RealPq::Socket, decltype(&PQsocket)>::value, "");
static_assert(std::is_same<RealPq::SendQuery, decltype(&PQsendQuery)>::value, "");
static_assert(std::is_same<RealPq::SetSingleRowMode, decltype(&PQsetSingleRowMode)>::value, "");
static_assert(std::is_same<RealPq::GetResult, decltype(&PQgetResult)>::value, "");
static_assert(std::is_same<RealPq::IsBusy, decltype(&PQisBusy)>::value, "");
static_assert(std::is_same<RealPq::ConsumeInput, decltype(&PQconsumeInput)>::value, "");
static_assert(std::is_same<RealPq::ParameterStatus, decltype(&PQparameterStatus)>::value, "");
static_assert(std::is_same<RealPq::SslInUse, decltype(&PQsslInUse)>::value, "");
static_assert(std::is_same<RealPq::GetLength, decltype(&PQgetlength)>::value, "");
static_assert(std::is_same<RealPq::SetNonblocking, decltype(&PQsetnonblocking)>::value, "");
static_assert(std::is_same<RealPq::Flush, decltype(&PQflush)>::value, "");

// ---------------------------------------------------------------- libcurl
static_assert(kCurloptWritedata == CURLOPT_WRITEDATA, "");
static_assert(kCurloptUrl == CURLOPT_URL, "");
static_assert(kCurloptErrorbuffer == CURLOPT_ERRORBUFFER, "");
static_assert(kCurloptPostfields == CURLOPT_POSTFIELDS, "");
static_assert(kCurloptHttpheader == CURLOPT_HTTPHEADER, "");
static_assert(kCurloptWritefunction == CURLOPT_WRITEFUNCTION, "");
static_assert(kCurloptPost == CURLOPT_POST, "");
static_assert(kCurloptPostfieldsize == CURLOPT_POSTFIELDSIZE, "");
static_assert(kCurloptSslVerifypeer == CURLOPT_SSL_VERIFYPEER, "");
static_assert(kCurloptHttpget == CURLOPT_HTTPGET, "");
static_assert(kCurloptSslVerifyhost == CURLOPT_SSL_VERIFYHOST, "");
static_assert(kCurloptNosignal == CURLOPT_NOSIGNAL, "");
static_assert(kCurloptTimeoutMs == CURLOPT_TIMEOUT_MS, "");
static_assert(kCurloptConnecttimeoutMs == CURLOPT_CONNECTTIMEOUT_MS, "");
static_assert(kCurloptProtocols == CURLOPT_PROTOCOLS, "");
static_assert(kCurlprotoHttp == CURLPROTO_HTTP && kCurlprotoHttps == CURLPROTO_HTTPS, "");
static_assert(kCurlinfoResponseCode == CURLINFO_RESPONSE_CODE, "");
static_assert(kCurlGlobalDefault == CURL_GLOBAL_DEFAULT, "");
static_assert(kCurleOk == CURLE_OK, "");
static_assert(kCurlErrorSize == CURL_ERROR_SIZE, "");
static_assert(sizeof(CURLcode) == sizeof(int) && sizeof(CURLoption) == sizeof(int) &&
                  sizeof(CURLINFO) == sizeof(int),
              "");
static_assert(sizeof(CurlSlist) == sizeof(curl_slist) &&
                  offsetof(CurlSlist, data) == offsetof(curl_slist, data) &&
                  offsetof(CurlSlist, next) == offsetof(curl_slist, next),
              "");

using RealCurl = CurlSig<CURL, CURLcode, CURLoption, CURLINFO, curl_slist>;
static_assert(std::is_same<CURL, void>::value, "");
static_assert(std::is_same<RealCurl::GlobalInit, decltype(&curl_global_init)>::value, "");
static_assert(std::is_same<RealCurl::EasyInit, decltype(&curl_easy_init)>::value, "");
static_assert(std::is_same<RealCurl::EasySetopt, decltype(&curl_easy_setopt)>::value, "");
static_assert(std::is_same<RealCurl::EasyPerform, decltype(&curl_easy_perform)>::value, "");
static_assert(std::is_same<RealCurl::EasyGetinfo, decltype(&curl_easy_getinfo)>::value, "");
static_assert(std::is_same<RealCurl::EasyCleanup, decltype(&curl_easy_cleanup)>::value, "");
static_assert(std::is_same<RealCurl::EasyStrerror, decltype(&curl_easy_strerror)>::value, "");
static_assert(std::is_same<RealCurl::SlistAppend, decltype(&curl_slist_append)>::value, "");
static_assert(std::is_same<RealCurl::SlistFreeAll, decltype(&curl_slist_free_all)>::value, "");
static_assert(std::is_same<RealCurl::EasyEscape, decltype(&curl_easy_escape)>::value, "");
static_assert(std::is_same<RealCurl::Free, decltype(&curl_free)>::value, "");
static_assert(std::is_same<RealCurl::WriteCallback, curl_write_callback>::value, "");

// ---------------------------------------------------------------- loading at run time
// The toolchain image has the four runtime libraries (libmariadb3, libsybdb5, libpq5, libcurl4).

TEST(ClientApi, LoadsTheInstalledLibraries) {
    std::string err;
    EXPECT_NE(loadMysqlApi("/nonexistent", err), nullptr) << err;
    EXPECT_NE(loadSybdbApi("/nonexistent", nullptr, nullptr, err), nullptr) << err;
    EXPECT_NE(loadPqApi("/nonexistent", err), nullptr) << err;
    EXPECT_NE(loadCurlApi("/nonexistent", err), nullptr) << err;
    // loaded once: the same table every time
    EXPECT_EQ(loadPqApi("", err), loadPqApi("/other", err));
}

TEST(ClientApi, MissingLibraryIsAnError) {
    std::string err;
    EXPECT_EQ(mat::openClientLib("/nonexistent", "libmat-missing.so.9", err), nullptr);
    EXPECT_NE(err.find("libmat-missing.so.9"), std::string::npos);
}
