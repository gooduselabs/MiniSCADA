// SQL Server through FreeTDS db-lib loaded at run time (specs/003-data-logging research R7–R10):
// TDS 7.4, UTF-8, rows and cursor in one T-SQL batch with SET XACT_ABORT ON. db-lib reports errors
// through process-wide handlers: they record into thread-local slots read by the calling thread.
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <mutex>
#include <string>
#include <vector>

#include "core/historian/forward/dyn_lib.hpp"
#include "core/historian/forward/freetds_api.hpp"
#include "core/historian/forward/sql_destination.hpp"

namespace mat {

namespace {

const char* encryptionOf(TlsMode t) {
    switch (t) {
        case TlsMode::Disable:
            return "off";
        case TlsMode::Prefer:
            return "request";
        case TlsMode::Require:
        case TlsMode::VerifyFull:  // plus "ca file": FreeTDS then checks certificate and host name
            break;
    }
    return "require";
}

// Private directory of the generated freetds.conf, made once by mkdtemp: mode 0700 and a name
// nobody can guess or create first (security review L1).
const std::string& tdsConfDir() {
    static const std::string dir = [] {
        const char* tmp = std::getenv("TMPDIR");
        std::string tmpl = std::string(tmp && *tmp ? tmp : "/tmp") + "/mat-freetds-XXXXXX";
        return ::mkdtemp(&tmpl[0]) ? tmpl : std::string();
    }();
    return dir;
}

bool writeNewFile(const std::string& path, const std::string& text) {
    ::unlink(path.c_str());
    const int fd = ::open(path.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
    if (fd < 0) return false;
    size_t done = 0;
    while (done < text.size()) {
        const ssize_t n = ::write(fd, text.data() + done, text.size() - done);
        if (n <= 0) break;
        done += static_cast<size_t>(n);
    }
    return ::close(fd) == 0 && done == text.size();
}

// FreeTDS 1.1 cannot set the encryption of one login (dbsetlbool(DBSETENCRYPT) is "UNIMPLEMENTED"):
// every SQL Server connection gets a section of one generated freetds.conf that FREETDSCONF names,
// and dbopen() opens the section by name (research R7). Called from the constructor, i.e. before
// the forwarder threads start: setenv runs once, before any FreeTDS call reads the variable.
// "" when the file cannot be written: never connect then, FreeTDS would take the section name for
// a host name and send the login there.
std::string registerTdsServer(const ConnectionModel& c) {
    static std::mutex mu;
    static std::map<std::string, std::string> sections;
    std::lock_guard<std::mutex> g(mu);
    const std::string& dir = tdsConfDir();
    if (dir.empty()) {
        std::fprintf(stderr, "forwarder %s: no directory for freetds.conf\n", c.id.c_str());
        return "";
    }
    auto clean = [](const std::string& s) {  // host: the validator already allows only these
        std::string out;
        for (char ch : s)
            if (std::isalnum(static_cast<unsigned char>(ch)) || ch == '.' || ch == '-' ||
                ch == '_' || ch == ':')
                out += ch;
        return out;
    };
    const std::string level = encryptionOf(c.tls);
    const std::string name = "mat-" + clean(c.id) + "-" + level;
    std::string section = "[" + name + "]\n\thost = " + clean(c.host) +
                          "\n\tport = " + std::to_string(c.port) +
                          "\n\ttds version = 7.4\n\tencryption = " + level + "\n";
    // verify-full: the server certificate must chain to the system CAs (a factory CA goes there
    // through update-ca-certificates) and name the host (security review M2).
    if (c.tls == TlsMode::VerifyFull) section += "\tca file = /etc/ssl/certs/ca-certificates.crt\n";
    sections[name] = section;
    const std::string path = dir + "/freetds.conf";
    std::string text = "# mat-runtime: one section per SQL Server connection (generated)\n";
    for (const auto& s : sections) text += s.second;
    const std::string part = path + ".tmp";
    if (!writeNewFile(part, text) || std::rename(part.c_str(), path.c_str()) != 0) {
        std::fprintf(stderr, "forwarder %s: cannot write %s\n", c.id.c_str(), path.c_str());
        sections.erase(name);
        return "";
    }
    static bool envSet = false;
    if (!envSet) {
        ::setenv("FREETDSCONF", path.c_str(), 1);
        envSet = true;
    }
    return name;
}

using capi::DbProcess;
using capi::LoginRec;
using capi::SybdbApi;

struct TdsEvent {
    bool set = false;
    int number = 0;
    std::string text;
};
thread_local TdsEvent tlsServerMsg;  // last server message with severity > 10
thread_local TdsEvent tlsLibErr;     // last db-lib error

int onError(DbProcess*, int, int dberr, int, char* dberrstr, char* oserrstr) {
    tlsLibErr.set = true;
    tlsLibErr.number = dberr;
    tlsLibErr.text = dberrstr ? dberrstr : "";
    if (oserrstr && *oserrstr) tlsLibErr.text += std::string(" (") + oserrstr + ")";
    return capi::kIntCancel;  // fail the call, never exit the process
}

int onMessage(DbProcess*, int32_t msgno, int, int severity, char* msgtext, char*, char*, int) {
    if (severity > 10) {  // ≤ 10: information such as "Changed database context"
        tlsServerMsg.set = true;
        tlsServerMsg.number = msgno;
        tlsServerMsg.text = msgtext ? msgtext : "";
    }
    return 0;
}

void clearEvents() {
    tlsServerMsg = TdsEvent{};
    tlsLibErr = TdsEvent{};
}

// The generated freetds.conf must still be ours: without it FreeTDS reads ~/.freetds.conf and
// /etc/freetds, then takes the section name for a host name (security review of the fixes).
bool tdsConfIntact() {
    struct stat st {};
    const std::string path = tdsConfDir() + "/freetds.conf";
    return ::stat(path.c_str(), &st) == 0 && S_ISREG(st.st_mode) && st.st_uid == ::geteuid() &&
           (st.st_mode & 077) == 0;
}

class MssqlDestination : public SqlDestination {
   public:
    MssqlDestination(ConnectionModel c, std::string libDir, SqlLimits limits)
        : SqlDestination(std::move(c), limits),
          libDir_(std::move(libDir)),
          server_(registerTdsServer(c_)) {}
    ~MssqlDestination() override { close(); }

    bool connect(const std::string& secret, DestError& err) override {
        close();
        newSession();
        if (server_.empty() || !tdsConfIntact()) {  // fail closed: see registerTdsServer
            err.cls = ErrorClass::Connect;
            err.detail = "freetds.conf missing or not the runtime's";
            return false;
        }
        std::string e;
        api_ = capi::loadSybdbApi(libDir_, &onError, &onMessage, e);
        if (!api_) {
            err.cls = ErrorClass::NoClient;
            err.detail = e;
            return false;
        }
        clearEvents();
        LoginRec* login = api_->login();
        if (!login) {
            err.cls = ErrorClass::Connect;
            err.detail = "dblogin failed";
            return false;
        }
        api_->setLName(login, c_.user.c_str(), capi::kDbSetUser);
        api_->setLName(login, secret.c_str(), capi::kDbSetPwd);
        api_->setLName(login, "mat-runtime", capi::kDbSetApp);
        api_->setLName(login, "UTF-8", capi::kDbSetCharset);
        api_->setLVersion(login, capi::kDbVersion74);
        // host, port and encryption (off / request / require) come from the generated section
        p_ = api_->open(login, server_.c_str(), capi::kMsDbLib);
        api_->loginFree(login);
        if (!p_) {
            setError(err);
            if (!tlsServerMsg.set && tlsLibErr.set)  // a refused certificate reads as TLS
                err.cls = classifyMssqlOpen(
                    tlsLibErr.number, c_.tls == TlsMode::Require || c_.tls == TlsMode::VerifyFull);
            return false;
        }
        clearEvents();
        if (api_->use(p_, c_.database.c_str()) == capi::kFail) {
            setError(err);
            close();
            return false;
        }
        if (!exec("SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON", err)) {
            close();
            return false;
        }
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
        // XACT_ABORT rolls back on run-time errors; a statement the server refused to compile
        // can leave the transaction open while the session goes on with the other groups.
        if (isStatementError(err.cls)) {
            DestError ignored;
            exec("IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION", ignored);
        }
        return false;
    }

    void close() override {
        if (p_ && api_) api_->close(p_);
        p_ = nullptr;
    }

   public:  // SqlDestination session
    bool exec(const std::string& sql, DestError& err) override { return run(sql, nullptr, err); }

    bool query(const std::string& sql, std::vector<std::string>& column, DestError& err) override {
        return run(sql, &column, err);
    }

    SqlGen gen() const override { return SqlGen(SqlDialect::MsSql, c_.offsetMin, nullptr); }

   private:
    // Sends one batch and reads every result. Any server error of severity > 10 fails the call,
    // even when db-lib goes on with the next result.
    bool run(const std::string& sql, std::vector<std::string>* column, DestError& err) {
        if (!p_) {
            err.cls = ErrorClass::Connect;
            err.detail = "not connected";
            return false;
        }
        clearEvents();
        // On failure: keep the error, then flush what the server still sends so that the
        // connection can run the next statement (a tolerated DDL failure in syncSchema).
        auto fail = [&] {
            setError(err);
            api_->cancel(p_);
            return false;
        };
        if (api_->cmd(p_, sql.c_str()) == capi::kFail || api_->sqlExec(p_) == capi::kFail)
            return fail();
        int rc;
        size_t rows = 0;
        size_t bytes = 0;
        while ((rc = api_->results(p_)) == capi::kSucceed) {
            int row;
            while ((row = api_->nextRow(p_)) != capi::kNoMoreRows) {
                if (row == capi::kFail) return fail();
                bytes += static_cast<size_t>(std::max<int32_t>(0, api_->datLen(p_, 1)));
                if (++rows > limits_.maxResultRows || bytes > limits_.maxResultBytes) {
                    close();  // the rest is never read: the session goes
                    err.cls = ErrorClass::Connect;
                    err.dbCode.clear();
                    err.detail = "answer larger than the limit";
                    return false;
                }
                if (row == capi::kRegRow && column) column->push_back(firstCellText());
            }
        }
        if (rc == capi::kFail || tlsServerMsg.set) return fail();
        return true;
    }

    // db-lib gives character data as is (UTF-8, the login charset) and other types in binary:
    // those go through dbconvert to text.
    std::string firstCellText() {
        const unsigned char* d = api_->data(p_, 1);
        const int32_t n = api_->datLen(p_, 1);
        if (!d || n <= 0) return std::string();
        const int type = api_->colType(p_, 1);
        if (type == capi::kSybChar || type == capi::kSybVarChar || type == capi::kSybText ||
            type == capi::kSybNText || type == capi::kSybNVarChar)
            return std::string(reinterpret_cast<const char*>(d), static_cast<size_t>(n));
        unsigned char buf[128];
        const int32_t m = api_->convert(p_, type, d, n, capi::kSybChar, buf, sizeof buf);
        if (m <= 0) return std::string();
        std::string out(reinterpret_cast<const char*>(buf),
                        static_cast<size_t>(std::min<int32_t>(m, sizeof buf)));
        while (!out.empty() && (out.back() == ' ' || out.back() == '\0'))
            out.pop_back();  // padding
        return out;
    }

    void setError(DestError& err) const {
        const TdsEvent& ev = tlsServerMsg.set ? tlsServerMsg : tlsLibErr;
        // A dead session is a connection error whatever the server said last (review of the
        // fixes S5): it must be closed, not kept for the other groups.
        const bool dead = p_ && api_->dead(p_);
        if (!ev.set) {
            err.cls = dead ? ErrorClass::Connect : ErrorClass::Sql;
            err.detail = "db-lib call failed";
            return;
        }
        err.cls = dead ? ErrorClass::Connect : classifyMssql(ev.number);
        err.dbCode = std::to_string(ev.number);
        err.detail = ev.text;
    }

    std::string libDir_;
    std::string server_;  // section of the generated freetds.conf
    const SybdbApi* api_ = nullptr;
    DbProcess* p_ = nullptr;
};

}  // namespace

std::unique_ptr<SqlDestination> makeMssqlDestination(const ConnectionModel& c,
                                                     const std::string& libDir,
                                                     const SqlLimits& limits) {
    return std::make_unique<MssqlDestination>(c, libDir, limits);
}

}  // namespace mat
