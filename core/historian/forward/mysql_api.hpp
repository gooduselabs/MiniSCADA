// Minimal MariaDB Connector/C API (libmariadb.so.3), declared in-house so that the armhf build
// needs no -dev package (specs/003-data-logging research R7). client_api_check_test compares every
// constant and signature with the real <mariadb/mysql.h> on x64.
#pragma once
#include <string>

namespace mat::capi {

struct Mysql;     // MYSQL
struct MysqlRes;  // MYSQL_RES

// Signatures, parameterized by the handle types so that the check test can instantiate them with
// the real ones.
template <class MYSQL_, class RES_, class OPTION_>
struct MysqlSig {
    using ServerInit = int (*)(int, char**, char**);
    using Init = MYSQL_* (*)(MYSQL_*);
    using Options = int (*)(MYSQL_*, OPTION_, const void*);
    using RealConnect = MYSQL_* (*)(MYSQL_*, const char*, const char*, const char*, const char*,
                                    unsigned int, const char*, unsigned long);
    using RealQuery = int (*)(MYSQL_*, const char*, unsigned long);
    using StoreResult = RES_* (*)(MYSQL_*);
    using FetchRow = char** (*)(RES_*);
    using FreeResult = void (*)(RES_*);
    using AffectedRows = unsigned long long (*)(MYSQL_*);
    using Errno = unsigned int (*)(MYSQL_*);
    using Error = const char* (*)(MYSQL_*);
    using RealEscapeString = unsigned long (*)(MYSQL_*, char*, const char*, unsigned long);
    using Close = void (*)(MYSQL_*);
    // results read row by row (bounded), the character set of the session, its socket
    using UseResult = RES_* (*)(MYSQL_*);
    using FetchLengths = unsigned long* (*)(RES_*);
    using SetCharacterSet = int (*)(MYSQL_*, const char*);
    using GetSocket = int (*)(MYSQL_*);
};
using MysqlFns = MysqlSig<Mysql, MysqlRes, int>;  // enum mysql_option is int-sized

// enum mysql_option
constexpr int kMysqlOptConnectTimeout = 0;
constexpr int kMysqlSetCharsetName = 7;
constexpr int kMysqlOptLocalInfile = 8;
constexpr int kMysqlOptReadTimeout = 11;
constexpr int kMysqlOptWriteTimeout = 12;
constexpr int kMysqlOptSslVerifyServerCert = 21;
constexpr int kMysqlOptSslCa = 27;
constexpr int kMysqlOptSslEnforce = 38;
constexpr int kMysqlOptMaxAllowedPacket = 39;  // takes a size_t
// client flags, error codes (errmsg.h)
constexpr unsigned long kClientFoundRows = 2;
constexpr unsigned int kCrSslConnectionError = 2026;

struct MysqlApi {
    MysqlFns::Init init = nullptr;
    MysqlFns::Options options = nullptr;
    MysqlFns::RealConnect realConnect = nullptr;
    MysqlFns::RealQuery realQuery = nullptr;
    MysqlFns::StoreResult storeResult = nullptr;
    MysqlFns::FetchRow fetchRow = nullptr;
    MysqlFns::FreeResult freeResult = nullptr;
    MysqlFns::AffectedRows affectedRows = nullptr;
    MysqlFns::Errno errNo = nullptr;
    MysqlFns::Error error = nullptr;
    MysqlFns::RealEscapeString realEscapeString = nullptr;
    MysqlFns::Close close = nullptr;
    MysqlFns::UseResult useResult = nullptr;
    MysqlFns::FetchLengths fetchLengths = nullptr;
    MysqlFns::SetCharacterSet setCharacterSet = nullptr;
    MysqlFns::GetSocket getSocket = nullptr;
};

// Loads libmariadb.so.3 once (`libDir` first, then the system loader) and runs mysql_server_init.
// nullptr + err when the library or a function is missing (the destination reports no_client).
const MysqlApi* loadMysqlApi(const std::string& libDir, std::string& err);

}  // namespace mat::capi
