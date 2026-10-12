// Minimal FreeTDS db-lib API (libsybdb.so.5) for SQL Server, declared in-house
// (specs/003-data-logging research R7). client_api_check_test compares it with the real <sybdb.h>
// on x64.
#pragma once
#include <cstdint>
#include <string>

namespace mat::capi {

struct DbProcess;  // DBPROCESS
struct LoginRec;   // LOGINREC

template <class DBPROCESS_, class LOGINREC_>
struct SybdbSig {
    using ErrHandler = int (*)(DBPROCESS_*, int, int, int, char*, char*);  // EHANDLEFUNC
    using MsgHandler = int (*)(DBPROCESS_*, int32_t, int, int, char*, char*, char*,
                               int);  // MHANDLEFUNC
    using Init = int (*)();
    using Login = LOGINREC_* (*)();
    using LoginFree = void (*)(LOGINREC_*);
    using SetLName = int (*)(LOGINREC_*, const char*, int);
    using SetLVersion = int (*)(LOGINREC_*, unsigned char);
    using Open = DBPROCESS_* (*)(LOGINREC_*, const char*, int);  // tdsdbopen; dbopen is a macro
    using Use = int (*)(DBPROCESS_*, const char*);
    using Cmd = int (*)(DBPROCESS_*, const char*);
    using SqlExec = int (*)(DBPROCESS_*);
    using Results = int (*)(DBPROCESS_*);
    using NextRow = int (*)(DBPROCESS_*);
    using Count = int32_t (*)(DBPROCESS_*);
    using Data = unsigned char* (*)(DBPROCESS_*, int);
    using DatLen = int32_t (*)(DBPROCESS_*, int);
    using ColType = int (*)(DBPROCESS_*, int);
    using Convert = int32_t (*)(DBPROCESS_*, int, const unsigned char*, int32_t, int,
                                unsigned char*, int32_t);
    using Cancel = int (*)(DBPROCESS_*);
    using Close = void (*)(DBPROCESS_*);
    using Dead = unsigned char (*)(DBPROCESS_*);  // DBBOOL
    using SetLoginTime = int (*)(int);
    using SetTime = int (*)(int);
    using ErrHandle = ErrHandler (*)(ErrHandler);
    using MsgHandle = MsgHandler (*)(MsgHandler);
};
using SybdbFns = SybdbSig<DbProcess, LoginRec>;

// dbsetlname / dbsetlbool fields
constexpr int kDbSetUser = 2;
constexpr int kDbSetPwd = 3;
constexpr int kDbSetApp = 5;
constexpr int kDbSetCharset = 10;
constexpr int kDbSetDbName = 14;
constexpr unsigned char kDbVersion74 = 8;
// return codes
constexpr int kSucceed = 1;
constexpr int kFail = 0;
constexpr int kNoMoreResults = 2;
constexpr int kNoMoreRows = -2;
constexpr int kRegRow = -1;
constexpr int kIntCancel = 2;
constexpr int kMsDbLib = 1;  // tdsdbopen(..., msdblib): what dbopen() passes with MSDBLIB
// column types (dbcoltype) returned as text without conversion
constexpr int kSybChar = 47;
constexpr int kSybVarChar = 39;
constexpr int kSybText = 35;
constexpr int kSybNText = 99;
constexpr int kSybNVarChar = 103;
// client-side errors (dberr)
constexpr int kSybeFcon = 20002;
constexpr int kSybeTime = 20003;
constexpr int kSybeConn = 20009;

struct SybdbApi {
    SybdbFns::Login login = nullptr;
    SybdbFns::LoginFree loginFree = nullptr;
    SybdbFns::SetLName setLName = nullptr;
    SybdbFns::SetLVersion setLVersion = nullptr;
    SybdbFns::Open open = nullptr;
    SybdbFns::Use use = nullptr;
    SybdbFns::Cmd cmd = nullptr;
    SybdbFns::SqlExec sqlExec = nullptr;
    SybdbFns::Results results = nullptr;
    SybdbFns::NextRow nextRow = nullptr;
    SybdbFns::Count count = nullptr;
    SybdbFns::Data data = nullptr;
    SybdbFns::DatLen datLen = nullptr;
    SybdbFns::ColType colType = nullptr;
    SybdbFns::Convert convert = nullptr;
    SybdbFns::Cancel cancel = nullptr;
    SybdbFns::Close close = nullptr;
    SybdbFns::Dead dead = nullptr;
};

// Loads libsybdb.so.5 once, runs dbinit, installs the process-wide error and message handlers
// (`errHandler`, `msgHandler`) and the login (5 s) and query (30 s) timeouts.
const SybdbApi* loadSybdbApi(const std::string& libDir, SybdbFns::ErrHandler errHandler,
                             SybdbFns::MsgHandler msgHandler, std::string& err);

}  // namespace mat::capi
