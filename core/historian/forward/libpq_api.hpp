// Minimal libpq API (libpq.so.5) for PostgreSQL, declared in-house (specs/003-data-logging research
// R7). client_api_check_test compares it with the real <libpq-fe.h> on x64.
#pragma once
#include <cstddef>
#include <string>

namespace mat::capi {

struct PgConn;    // PGconn
struct PgResult;  // PGresult

template <class CONN_, class RES_, class CONNSTATUS_, class EXECSTATUS_, class POLLSTATUS_>
struct PqSig {
    using ConnectdbParams = CONN_* (*)(const char* const*, const char* const*, int);
    using Status = CONNSTATUS_ (*)(const CONN_*);
    using ErrorMessage = char* (*)(const CONN_*);
    using Finish = void (*)(CONN_*);
    using Exec = RES_* (*)(CONN_*, const char*);
    using ResultStatus = EXECSTATUS_ (*)(const RES_*);
    using ResultErrorField = char* (*)(const RES_*, int);
    using Ntuples = int (*)(const RES_*);
    using GetValue = char* (*)(const RES_*, int, int);
    using GetIsNull = int (*)(const RES_*, int, int);
    using Clear = void (*)(RES_*);
    using EscapeLiteral = char* (*)(CONN_*, const char*, size_t);
    using FreeMem = void (*)(void*);
    using NoticeProcessor = void (*)(void*, const char*);
    using SetNoticeProcessor = NoticeProcessor (*)(CONN_*, NoticeProcessor, void*);
    // asynchronous connection and statements: the client's own deadlines and result bounds
    using ConnectStartParams = CONN_* (*)(const char* const*, const char* const*, int);
    using ConnectPoll = POLLSTATUS_ (*)(CONN_*);
    using Socket = int (*)(const CONN_*);
    using SendQuery = int (*)(CONN_*, const char*);
    using SetSingleRowMode = int (*)(CONN_*);
    using GetResult = RES_* (*)(CONN_*);
    using IsBusy = int (*)(CONN_*);
    using ConsumeInput = int (*)(CONN_*);
    using ParameterStatus = const char* (*)(const CONN_*, const char*);
    using SslInUse = int (*)(CONN_*);
    using GetLength = int (*)(const RES_*, int, int);
    // nonblocking sending, so that the deadline bounds a large statement too
    using SetNonblocking = int (*)(CONN_*, int);
    using Flush = int (*)(CONN_*);
};
// ConnStatusType, ExecStatusType, PostgresPollingStatusType are int-sized
using PqFns = PqSig<PgConn, PgResult, int, int, int>;

constexpr int kConnectionOk = 0;
constexpr int kConnectionBad = 1;
constexpr int kPgresEmptyQuery = 0;
constexpr int kPgresCommandOk = 1;
constexpr int kPgresTuplesOk = 2;
constexpr int kPgresBadResponse = 5;
constexpr int kPgresNonfatalError = 6;
constexpr int kPgresFatalError = 7;
constexpr int kPgresSingleTuple = 9;
constexpr int kPgPollingFailed = 0;
constexpr int kPgPollingReading = 1;
constexpr int kPgPollingWriting = 2;
constexpr int kPgPollingOk = 3;
constexpr int kPgDiagSqlstate = 'C';

struct PqApi {
    PqFns::ConnectdbParams connectdbParams = nullptr;
    PqFns::Status status = nullptr;
    PqFns::ErrorMessage errorMessage = nullptr;
    PqFns::Finish finish = nullptr;
    PqFns::Exec exec = nullptr;
    PqFns::ResultStatus resultStatus = nullptr;
    PqFns::ResultErrorField resultErrorField = nullptr;
    PqFns::Ntuples ntuples = nullptr;
    PqFns::GetValue getValue = nullptr;
    PqFns::GetIsNull getIsNull = nullptr;
    PqFns::Clear clear = nullptr;
    PqFns::EscapeLiteral escapeLiteral = nullptr;
    PqFns::FreeMem freeMem = nullptr;
    PqFns::SetNoticeProcessor setNoticeProcessor = nullptr;
    PqFns::ConnectStartParams connectStartParams = nullptr;
    PqFns::ConnectPoll connectPoll = nullptr;
    PqFns::Socket socket = nullptr;
    PqFns::SendQuery sendQuery = nullptr;
    PqFns::SetSingleRowMode setSingleRowMode = nullptr;
    PqFns::GetResult getResult = nullptr;
    PqFns::IsBusy isBusy = nullptr;
    PqFns::ConsumeInput consumeInput = nullptr;
    PqFns::ParameterStatus parameterStatus = nullptr;
    PqFns::SslInUse sslInUse = nullptr;
    PqFns::GetLength getLength = nullptr;
    PqFns::SetNonblocking setNonblocking = nullptr;
    PqFns::Flush flush = nullptr;
};

// Loads libpq.so.5 once; nullptr + err when it or a function is missing.
const PqApi* loadPqApi(const std::string& libDir, std::string& err);

}  // namespace mat::capi
