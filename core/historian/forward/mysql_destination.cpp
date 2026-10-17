// MySQL / MariaDB through MariaDB Connector/C loaded at run time (specs/003-data-logging research
// R7–R10): utf8mb4, CLIENT_FOUND_ROWS, timeouts 5/30/30 s, rows and cursor in one transaction.
#include <sys/socket.h>

#include <string>
#include <vector>

#include "core/historian/forward/dyn_lib.hpp"
#include "core/historian/forward/mysql_api.hpp"
#include "core/historian/forward/sql_destination.hpp"

namespace mat {

namespace {

using capi::Mysql;
using capi::MysqlApi;

class MysqlDestination final : public SqlDestination {
   public:
    MysqlDestination(ConnectionModel c, std::string libDir, SqlLimits limits)
        : SqlDestination(std::move(c), limits), libDir_(std::move(libDir)) {}
    ~MysqlDestination() override { MysqlDestination::close(); }  // final: no override to call

    bool connect(const std::string& secret, DestError& err) override {
        close();
        newSession();
        std::string e;
        api_ = capi::loadMysqlApi(libDir_, e);
        if (!api_) {
            err.cls = ErrorClass::NoClient;
            err.detail = e;
            return false;
        }
        const bool tls = c_.tls != TlsMode::Disable;
        if (open(secret, tls, err) && utf8mb4(err)) {
            if (tls) tlsSeen_ = true;
            return true;
        }
        // prefer: TLS is enforced first; a server without TLS refuses it (2026): once more in
        // clear, unless a session of this destination already ran on TLS (a man in the middle
        // would get the password: security review of the fixes).
        if (c_.tls == TlsMode::Prefer && !tlsSeen_ &&
            err.dbCode == std::to_string(capi::kCrSslConnectionError)) {
            err = DestError{};
            return open(secret, false, err) && utf8mb4(err);
        }
        return false;
    }

    bool writeBatch(const std::string& sourceId, const DestTable& t,
                    const std::vector<StoredRow>& rows, int64_t prevSeq, int64_t lastSeq,
                    DestError& err) override {
        const SqlGen g = gen();
        if (!exec("START TRANSACTION", err)) return false;
        // A refused statement keeps the session for the other groups: roll back. A connection
        // that is gone is closed by the forwarder, which rolls back on the server.
        auto rollback = [&] {
            DestError ignored;
            if (isStatementError(err.cls)) exec("ROLLBACK", ignored);
            return false;
        };
        // The cursor first, moved only from the value this forwarder read (review of the fixes,
        // Important 2): a batch of an earlier session that committed after its client gave up
        // must not be stored twice. CLIENT_FOUND_ROWS: 1 when the row matched.
        if (!exec(g.updateCursor(c_.schema, sourceId, t.name, prevSeq, lastSeq), err))
            return rollback();
        if (api_->affectedRows(m_) == 0) {
            std::vector<std::string> row;  // locked: no other session adds it meanwhile
            if (!query(g.lockCursor(c_.schema, sourceId, t.name), row, err)) return rollback();
            if (!row.empty()) {
                err.cls = ErrorClass::Sql;
                err.dbCode.clear();
                err.detail = "the cursor at the destination moved";
                return rollback();
            }
            if (!exec(g.insertCursor(c_.schema, sourceId, t.name, lastSeq), err)) return rollback();
        }
        for (const auto& insert : g.insertChunks(sqlTable(t), rows))
            if (!exec(insert, err)) return rollback();
        // A lost connection here leaves the commit unclear: the cursor read after reconnecting
        // decides what is sent again (research R8).
        if (!exec("COMMIT", err)) return rollback();
        counters_.outOfRangeValues += g.outOfRange();
        return true;
    }

    void close() override {
        if (m_ && api_) api_->close(m_);
        m_ = nullptr;
    }

   public:  // SqlDestination session
    bool exec(const std::string& sql, DestError& err) override {
        if (!m_) return notConnected(err);
        if (api_->realQuery(m_, sql.data(), static_cast<unsigned long>(sql.size())) != 0) {
            setError(err);
            return false;
        }
        return true;
    }

    bool query(const std::string& sql, std::vector<std::string>& column, DestError& err) override {
        if (!exec(sql, err)) return false;
        capi::MysqlRes* res = api_->useResult(m_);  // rows one by one, so that they can be bounded
        if (!res) {
            if (api_->errNo(m_) != 0) {
                setError(err);
                return false;
            }
            return true;  // no result set
        }
        size_t rows = 0;
        size_t bytes = 0;
        while (char** row = api_->fetchRow(res)) {
            const unsigned long* len = api_->fetchLengths(res);
            const size_t n = len ? static_cast<size_t>(len[0]) : 0;
            bytes += n;
            if (++rows > limits_.maxResultRows || bytes > limits_.maxResultBytes) {
                // The rest cannot be skipped without reading it: the session goes.
                ::shutdown(api_->getSocket(m_), SHUT_RDWR);
                api_->freeResult(res);
                close();
                err.cls = ErrorClass::Connect;
                err.dbCode.clear();
                err.detail = "answer larger than the limit";
                return false;
            }
            column.push_back(row[0] ? std::string(row[0], n) : std::string());
        }
        const bool failed = api_->errNo(m_) != 0;  // the rows stopped on an error
        if (failed) setError(err);
        api_->freeResult(res);
        return !failed;
    }

    SqlGen gen() const override {
        return SqlGen(SqlDialect::MySql, c_.offsetMin, [this](const std::string& s) {
            if (!m_) return std::string();
            std::string buf(s.size() * 2 + 1, '\0');
            const unsigned long n =
                api_->realEscapeString(m_, &buf[0], s.data(), static_cast<unsigned long>(s.size()));
            if (n == static_cast<unsigned long>(-1)) return std::string();
            buf.resize(n);
            return "'" + buf + "'";
        });
    }

   private:
    bool open(const std::string& secret, bool tls, DestError& err) {
        m_ = api_->init(nullptr);
        if (!m_) {
            err.cls = ErrorClass::Connect;
            err.detail = "mysql_init failed";
            return false;
        }
        unsigned int connectTimeout = 5, ioTimeout = 30;
        api_->options(m_, capi::kMysqlOptConnectTimeout, &connectTimeout);
        api_->options(m_, capi::kMysqlOptReadTimeout, &ioTimeout);
        api_->options(m_, capi::kMysqlOptWriteTimeout, &ioTimeout);
        api_->options(m_, capi::kMysqlSetCharsetName, "utf8mb4");
        // No packet of the server above 16 MiB (the client takes 1 GiB by default); the largest
        // statement sent is 1 MiB.
        size_t maxPacket = 16u << 20;
        api_->options(m_, capi::kMysqlOptMaxAllowedPacket, &maxPacket);
        // A server (or a man in the middle) could ask for any local file, secrets.json included:
        // LOAD DATA LOCAL is never needed (security review hardening 1).
        unsigned int localInfile = 0;
        api_->options(m_, capi::kMysqlOptLocalInfile, &localInfile);
        if (tls) {
            char on = 1;  // my_bool
            api_->options(m_, capi::kMysqlOptSslEnforce, &on);
            if (c_.tls == TlsMode::VerifyFull) {
                api_->options(m_, capi::kMysqlOptSslVerifyServerCert, &on);
                api_->options(m_, capi::kMysqlOptSslCa, "/etc/ssl/certs/ca-certificates.crt");
            }
        }
        if (!api_->realConnect(m_, c_.host.c_str(), c_.user.c_str(), secret.c_str(),
                               c_.database.c_str(), static_cast<unsigned int>(c_.port), nullptr,
                               capi::kClientFoundRows)) {
            setError(err);
            close();
            return false;
        }
        return true;
    }

    // The escaper works in the character set of the client; the server may have set another one
    // for the session (init_connect): set utf8mb4 again and check it (security review of the
    // fixes: a multibyte set such as gbk would let a quote of a Tag string out).
    bool utf8mb4(DestError& err) {
        std::vector<std::string> cs;
        if (api_->setCharacterSet(m_, "utf8mb4") != 0) {
            setError(err);
        } else if (query("SELECT @@character_set_client", cs, err) && cs.size() == 1 &&
                   cs[0] == "utf8mb4") {
            return true;
        } else if (err.cls == ErrorClass::None) {
            err.cls = ErrorClass::Sql;
            err.detail = "the session is not utf8mb4";
        }
        close();
        return false;
    }

    void setError(DestError& err) const {
        const unsigned int code = api_->errNo(m_);
        err.cls = classifyMysql(code);
        err.dbCode = std::to_string(code);
        err.detail = api_->error(m_);
    }

    static bool notConnected(DestError& err) {
        err.cls = ErrorClass::Connect;
        err.detail = "not connected";
        return false;
    }

    std::string libDir_;
    const MysqlApi* api_ = nullptr;
    Mysql* m_ = nullptr;
    bool tlsSeen_ = false;
};

}  // namespace

std::unique_ptr<SqlDestination> makeMysqlDestination(const ConnectionModel& c,
                                                     const std::string& libDir,
                                                     const SqlLimits& limits) {
    return std::make_unique<MysqlDestination>(c, libDir, limits);
}

}  // namespace mat
