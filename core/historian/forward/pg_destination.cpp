// PostgreSQL through libpq loaded at run time (specs/003-data-logging research R7–R10): column
// names in lower case, rows and cursor in one query string (BEGIN … INSERT … ON CONFLICT … COMMIT).
// The connection and every statement run asynchronously under the client's own deadlines: libpq
// alone waits for TCP keepalive (about two hours) when a server stops answering after it
// acknowledged a statement (review of the fixes I2). Answers are read row by row and bounded;
// notices of the server never reach stderr; the database must use UTF8 (or SQL_ASCII).
#include <poll.h>
#include <time.h>

#include <algorithm>
#include <cerrno>
#include <string>
#include <vector>

#include "core/historian/forward/dyn_lib.hpp"
#include "core/historian/forward/libpq_api.hpp"
#include "core/historian/forward/sql_destination.hpp"

namespace mat {

namespace {

using capi::PgConn;
using capi::PgResult;
using capi::PqApi;

constexpr int64_t kConnectTimeoutMs = 10000;  // TCP, TLS and login together

const char* sslMode(TlsMode t) {
    switch (t) {
        case TlsMode::Disable:
            return "disable";
        case TlsMode::Require:
            return "require";
        case TlsMode::VerifyFull:
            return "verify-full";
        case TlsMode::Prefer:
            break;
    }
    return "prefer";
}

// The default processor of libpq prints every NOTICE of the server to stderr as is: a hostile
// server could forge journal lines (security review L3), and IF NOT EXISTS would add one line per
// group and connection. Notices are only information: dropped.
void dropNotice(void*, const char*) {}

int64_t monoMs() {
    timespec ts{};
    ::clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<int64_t>(ts.tv_sec) * 1000 + ts.tv_nsec / 1000000;
}

// Waits until the socket is ready for `events` (POLLIN, POLLOUT or both) before the deadline;
// false on timeout. The events that came are in `ready`. An error of the socket counts as ready:
// libpq reports it.
bool waitSocket(int fd, short events, int64_t deadline, short* ready = nullptr) {
    pollfd p{fd, events, 0};
    for (;;) {
        const int64_t left = deadline - monoMs();
        if (left <= 0) return false;
        const int rc = ::poll(&p, 1, static_cast<int>(std::min<int64_t>(left, 60000)));
        if (rc > 0 || (rc < 0 && errno != EINTR)) {
            if (ready) *ready = rc > 0 ? p.revents : events;
            return true;
        }
    }
}

class PgDestination final : public SqlDestination {
   public:
    PgDestination(ConnectionModel c, std::string libDir, SqlLimits limits)
        : SqlDestination(std::move(c), limits), libDir_(std::move(libDir)) {}
    ~PgDestination() override { PgDestination::close(); }  // final: no override to call

    bool connect(const std::string& secret, DestError& err) override {
        close();
        newSession();
        std::string e;
        api_ = capi::loadPqApi(libDir_, e);
        if (!api_) {
            err.cls = ErrorClass::NoClient;
            err.detail = e;
            return false;
        }
        // Once a session of this destination ran on TLS, prefer no longer accepts a server that
        // offers none (a man in the middle would get the password: security review of the fixes).
        const TlsMode tls = c_.tls == TlsMode::Prefer && tlsSeen_ ? TlsMode::Require : c_.tls;
        const std::string port = std::to_string(c_.port);
        std::vector<const char*> keys{"host",
                                      "port",
                                      "dbname",
                                      "user",
                                      "password",
                                      "sslmode",
                                      "connect_timeout",
                                      "tcp_user_timeout",
                                      "keepalives",
                                      "keepalives_idle",
                                      "keepalives_interval",
                                      "keepalives_count",
                                      "application_name",
                                      "client_encoding",
                                      "options"};
        std::vector<const char*> values{c_.host.c_str(),
                                        port.c_str(),
                                        c_.database.c_str(),
                                        c_.user.c_str(),
                                        secret.c_str(),
                                        sslMode(tls),
                                        "5",
                                        "30000",
                                        "1",
                                        "10",
                                        "5",
                                        "3",
                                        "mat-runtime",
                                        "UTF8",
                                        "-c statement_timeout=30000"};
        if (c_.tls == TlsMode::VerifyFull) {
            keys.push_back("sslrootcert");
            values.push_back("/etc/ssl/certs/ca-certificates.crt");
        }
        keys.push_back(nullptr);
        values.push_back(nullptr);
        conn_ = api_->connectStartParams(keys.data(), values.data(), 0);  // 0: dbname is a name
        if (!conn_) {
            err.cls = ErrorClass::Connect;
            err.detail = "out of memory";
            return false;
        }
        api_->setNoticeProcessor(conn_, &dropNotice, nullptr);  // before the server sends any
        if (!finishConnect(err)) {
            close();
            return false;
        }
        // Statements are sent without blocking, so that the deadline bounds a large batch too
        // (review of the fixes, minor 6).
        if (api_->setNonblocking(conn_, 1) != 0) {
            lost(err);
            close();
            return false;
        }
        // Every row in another encoding would be refused for a character it lacks, forever.
        const char* enc = api_->parameterStatus(conn_, "server_encoding");
        const std::string encoding = enc ? enc : "";
        if (encoding != "UTF8" && encoding != "SQL_ASCII") {
            err.cls = ErrorClass::SchemaMismatch;
            err.dbCode = "22P05";
            err.detail = "server_encoding " + encoding + ": the database must use UTF8";
            close();
            return false;
        }
        if (api_->sslInUse(conn_)) tlsSeen_ = true;
        return true;
    }

    bool writeBatch(const std::string& sourceId, const DestTable& t,
                    const std::vector<StoredRow>& rows, int64_t prevSeq, int64_t lastSeq,
                    DestError& err) override {
        const SqlGen g = gen();
        if (exec(g.oneBatch(sqlTable(t), rows, sourceId, prevSeq, lastSeq), err)) {
            counters_.outOfRangeValues += g.outOfRange();
            return true;
        }
        // A refused statement leaves the transaction aborted while the session goes on with the
        // other groups: roll it back. A lost connection is closed by the forwarder instead.
        if (isStatementError(err.cls) && api_->status(conn_) == capi::kConnectionOk) {
            DestError ignored;
            exec("ROLLBACK", ignored);
        }
        return false;
    }

    void close() override {
        if (conn_ && api_) api_->finish(conn_);
        conn_ = nullptr;
    }

   public:  // SqlDestination session
    bool exec(const std::string& sql, DestError& err) override { return run(sql, nullptr, err); }

    bool query(const std::string& sql, std::vector<std::string>& column, DestError& err) override {
        return run(sql, &column, err);
    }

    SqlGen gen() const override {
        return SqlGen(SqlDialect::PostgreSql, c_.offsetMin, [this](const std::string& s) {
            if (!conn_) return std::string();
            char* e = api_->escapeLiteral(conn_, s.data(), s.size());
            if (!e) return std::string();  // e.g. not valid in the client encoding
            std::string out(e);
            api_->freeMem(e);
            return out;
        });
    }

   private:
    // The connection handshake (TCP, TLS, login) under one deadline.
    bool finishConnect(DestError& err) {
        if (api_->status(conn_) == capi::kConnectionBad) return lost(err);
        const int64_t deadline = monoMs() + kConnectTimeoutMs;
        int ps = capi::kPgPollingWriting;  // as if PQconnectPoll had asked to write
        for (;;) {
            const short events = ps == capi::kPgPollingWriting ? POLLOUT : POLLIN;
            if (!waitSocket(api_->socket(conn_), events, deadline)) {
                err.cls = ErrorClass::Timeout;
                err.detail = "no answer while connecting";
                return false;
            }
            ps = api_->connectPoll(conn_);
            if (ps == capi::kPgPollingOk) return true;
            if (ps == capi::kPgPollingFailed) return lost(err);
        }
    }

    // The connection itself failed: no SQLSTATE, the message decides.
    bool lost(DestError& err) {
        const std::string msg = conn_ ? api_->errorMessage(conn_) : "not connected";
        err.cls = classifyPgConnect(msg);
        err.dbCode.clear();
        err.detail = msg;
        return false;
    }

    bool timedOut(DestError& err) const {
        err.cls = ErrorClass::Timeout;  // the forwarder closes the connection
        err.dbCode.clear();
        err.detail = "no answer within " + std::to_string(limits_.queryTimeoutMs / 1000) + " s";
        return false;
    }

    // Sends one statement (or a string of them) and reads every result, row by row, before the
    // deadline and within the bounds; the first error is reported.
    bool run(const std::string& sql, std::vector<std::string>* column, DestError& err) {
        if (!conn_) {
            err.cls = ErrorClass::Connect;
            err.detail = "not connected";
            return false;
        }
        const int64_t deadline = monoMs() + limits_.queryTimeoutMs;
        if (!api_->sendQuery(conn_, sql.c_str())) return lost(err);
        api_->setSingleRowMode(conn_);  // rows one by one, so that they can be bounded
        // What libpq could not send yet goes out under the same deadline; an answer that comes
        // meanwhile (an early error) is read so that neither side waits on the other.
        for (;;) {
            const int f = api_->flush(conn_);
            if (f == 0) break;
            if (f < 0) return lost(err);
            short ready = 0;
            if (!waitSocket(api_->socket(conn_), POLLIN | POLLOUT, deadline, &ready))
                return timedOut(err);
            if ((ready & POLLIN) && !api_->consumeInput(conn_)) return lost(err);
        }
        bool failed = false;
        size_t rows = 0;
        size_t bytes = 0;
        for (;;) {
            if (monoMs() >= deadline) return timedOut(err);  // at every result, not only waits
            while (api_->isBusy(conn_)) {
                if (!waitSocket(api_->socket(conn_), POLLIN, deadline)) return timedOut(err);
                if (!api_->consumeInput(conn_)) return lost(err);
            }
            PgResult* r = api_->getResult(conn_);
            if (!r) break;  // every result read
            const int st = api_->resultStatus(r);
            if (st == capi::kPgresSingleTuple || st == capi::kPgresTuplesOk) {
                const int n = api_->ntuples(r);
                for (int i = 0; i < n; ++i) {
                    ++rows;
                    bytes += static_cast<size_t>(std::max(0, api_->getLength(r, i, 0)));
                    if (column && !failed)
                        column->push_back(api_->getIsNull(r, i, 0) ? "" : api_->getValue(r, i, 0));
                }
                if (rows > limits_.maxResultRows || bytes > limits_.maxResultBytes) {
                    api_->clear(r);
                    err.cls = ErrorClass::Connect;  // the rest is never read: the session goes
                    err.dbCode.clear();
                    err.detail = "answer larger than the limit";
                    return false;
                }
            } else if (st == capi::kPgresFatalError || st == capi::kPgresBadResponse ||
                       st == capi::kPgresNonfatalError) {
                if (!failed) {
                    failed = true;
                    const char* state = api_->resultErrorField(r, capi::kPgDiagSqlstate);
                    const std::string msg = api_->errorMessage(conn_);
                    // The code goes to system/info: only the shape of a SQLSTATE (security
                    // review M4).
                    if (isSqlState(state)) {
                        err.cls = classifyPg(state);
                        err.dbCode = state;
                    } else {  // no SQLSTATE: the connection itself failed
                        err.cls = classifyPgConnect(msg);
                        err.dbCode.clear();
                    }
                    err.detail = msg;
                }
            } else if (st != capi::kPgresCommandOk && st != capi::kPgresEmptyQuery) {
                // COPY, or a state this client never asks for: libpq hands out the same result on
                // every call without reading (review of the fixes, Important 1). The session goes.
                api_->clear(r);
                err.cls = ErrorClass::Connect;
                err.dbCode.clear();
                err.detail =
                    "unexpected answer of the server (result status " + std::to_string(st) + ")";
                return false;
            }
            api_->clear(r);
        }
        return !failed;
    }

    std::string libDir_;
    const PqApi* api_ = nullptr;
    PgConn* conn_ = nullptr;
    bool tlsSeen_ = false;
};

}  // namespace

std::unique_ptr<SqlDestination> makePgDestination(const ConnectionModel& c,
                                                  const std::string& libDir,
                                                  const SqlLimits& limits) {
    return std::make_unique<PgDestination>(c, libDir, limits);
}

}  // namespace mat
