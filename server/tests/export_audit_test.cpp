// T145 (feature 005, US4-3; contracts/device-config.md §4, research R11): `mat-runtime
// --export-audit
// [--from …] [--to …] [--tz ±HH:MM] [--format csv|jsonl]`, run as the service user (`runuser -u
// matscada`).
// - the whole log to stdout, oldest first so the newest row is last, page by page (more than 200
// rows);
// - the failed sign-ins and the refused accesses are in the export (US4-3);
// - CSV follows the rules of --export-history against CSV injection (a user name typed at a failed
// sign-in
//   is attacker text); JSONL is one JSON object per line;
// - the export writes its own audit.export row first (no data without its record) and holds it as
// the last row;
// - nothing secret: no password, token or hash exists in a row, and none appears;
// - exit codes: 0, 2 bad arguments, 4 no audit.db, 5 the output failed.
#include "server/cli/export_audit.hpp"

#include <gtest/gtest.h>
#include <sys/stat.h>
#include <unistd.h>

#include <atomic>
#include <filesystem>
#include <memory>
#include <sstream>
#include <streambuf>
#include <string>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "nlohmann/json.hpp"
#include "sqlite3.h"

using namespace mat;
using nlohmann::json;

namespace {

constexpr int64_t kT0 = 1791594000000;  // 2026-10-10T01:00:00Z = 08:00 at +07:00
constexpr int64_t kMinute = 60000;

struct Dir {
    Dir() {
        char tmpl[] = "/tmp/mat-export-audit-XXXXXX";
        path = ::mkdtemp(tmpl) ? tmpl : "";
    }
    ~Dir() {
        std::error_code ec;
        if (!path.empty()) std::filesystem::remove_all(path, ec);
    }
    std::string path;
};

// An audit log with a fake clock; the CLI takes the same clock through DeviceCliEnv.
struct Rig {
    Rig() {
        clock.wallMs = [this] { return wall.load(); };
        clock.monoMs = [this] { return wall.load(); };
        clock.synced = [](int64_t) { return true; };
        AuditOptions o;
        o.dataDir = dir.path;
        o.clock = clock;
        log = std::make_unique<AuditLog>(o);
        std::string err;
        EXPECT_TRUE(log->open(err)) << err;
        env.auditClock = clock;
        env.hostname = [] { return std::string("bl335-thu"); };
    }
    void advance(int64_t ms) { wall += ms; }
    int64_t add(AuditAction a, AuditResult r, const char* user, const char* role,
                const char* source = "192.168.1.30:40000", const char* code = nullptr,
                const char* target = nullptr, const char* detail = nullptr) {
        AuditEvent e(a, r, AuditChannel::Https, source);
        if (user) e.user = user;
        if (role) e.role = role;
        if (code) e.code = code;
        if (target) e.target = target;
        if (detail) e.detail = detail;
        const int64_t id = log->append(e);
        advance(kMinute);
        return id;
    }
    void closeLog() { log->close(); }

    Dir dir;
    std::atomic<int64_t> wall{kT0};
    AuditClock clock;
    std::unique_ptr<AuditLog> log;
    DeviceCliEnv env;
};

struct CliOut {
    int code;
    std::string out;
    std::string err;
};

CliOut runCli(Rig& r, std::vector<std::string> args, bool terminal = false) {
    args.insert(args.begin(), {"mat-runtime", "--export-audit"});
    args.insert(args.end(), {"--data-dir", r.dir.path});
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(&a[0]);
    std::ostringstream out, err;
    const int code =
        runExportAuditCli(static_cast<int>(argv.size()), argv.data(), r.env, out, err, terminal);
    return {code, out.str(), err.str()};
}

std::vector<std::string> lines(const std::string& s) {
    std::vector<std::string> out;
    std::istringstream in(s);
    std::string l;
    while (std::getline(in, l)) out.push_back(l);
    return out;
}

// A stream buffer that accepts `room` bytes and then fails (a full disk, a closed pipe).
class FailingBuf : public std::streambuf {
   public:
    explicit FailingBuf(size_t room) : room_(room) {}

   protected:
    int_type overflow(int_type c) override {
        if (room_ == 0) return traits_type::eof();
        --room_;
        return traits_type::not_eof(c);
    }
    std::streamsize xsputn(const char*, std::streamsize n) override {
        if (static_cast<size_t>(n) > room_) {
            room_ = 0;
            return 0;
        }
        room_ -= static_cast<size_t>(n);
        return n;
    }

   private:
    size_t room_;
};

}  // namespace

TEST(ExportAudit, CommandIsRecognised) {
    std::vector<std::string> a{"mat-runtime", "--export-audit", "--format", "jsonl"};
    std::vector<std::string> b{"mat-runtime", "--export-history", "x"};
    std::vector<char*> av, bv;
    for (auto& s : a) av.push_back(&s[0]);
    for (auto& s : b) bv.push_back(&s[0]);
    EXPECT_TRUE(isExportAuditCommand(static_cast<int>(av.size()), av.data()));
    EXPECT_FALSE(isExportAuditCommand(static_cast<int>(bv.size()), bv.data()));
}

TEST(ExportAudit, CsvHasAHeaderOldestFirstAndEndsWithItsOwnRecord) {
    Rig r;
    r.add(AuditAction::AuthLogin, AuditResult::Ok, "admin1", "administrator");
    r.add(AuditAction::ProjectDeploy, AuditResult::Started, "kysu1", "engineer",
          "192.168.1.30:40001", nullptr, "sha256:ab", "{\"opId\":\"op-1\"}");
    r.add(AuditAction::ProjectDeploy, AuditResult::Ok, "kysu1", "engineer", "192.168.1.30:40001");
    const CliOut x = runCli(r, {});
    ASSERT_EQ(x.code, 0) << x.err;
    const auto l = lines(x.out);
    ASSERT_EQ(l.size(), 1u + 3u + 1u) << x.out;
    EXPECT_EQ(
        l[0],
        "id,time,ts_ms,clock_ok,user,role,source,channel,action,target,result,code,detail,count");
    EXPECT_EQ(l[1], "1,2026-10-10 08:00:00.000," + std::to_string(kT0) +
                        ",1,admin1,administrator,192.168.1.30:40000,https,auth.login,,ok,,,1");
    EXPECT_NE(l[2].find(",project.deploy,sha256:ab,started,,\"{\"\"opId\"\":\"\"op-1\"\"}\",1"),
              std::string::npos)
        << l[2];
    EXPECT_NE(l[3].find(",project.deploy,,ok,,,1"), std::string::npos) << l[3];
    // The export's own row is last, written before any data left the device.
    EXPECT_NE(l[4].find(",cli,cli,audit.export,"), std::string::npos) << l[4];
    EXPECT_NE(l[4].find(",ok,"), std::string::npos);
}

TEST(ExportAudit, HoldsTheFailedSignInsAndTheRefusedAccesses) {
    Rig r;
    r.add(AuditAction::AuthLogin, AuditResult::Failed, "admin1", nullptr, "10.0.0.5:50001",
          "AUTH_FAILED");
    r.add(AuditAction::AuthLocked, AuditResult::Denied, "admin1", nullptr, "10.0.0.5:50002",
          "AUTH_LOCKED");
    r.add(AuditAction::AccessDenied, AuditResult::Denied, "xem1", "viewer", "192.168.1.31:40100",
          "FORBIDDEN", "/api/v1/project/deployments");
    const CliOut x = runCli(r, {});
    ASSERT_EQ(x.code, 0) << x.err;
    EXPECT_NE(x.out.find(",auth.login,,failed,AUTH_FAILED,"), std::string::npos) << x.out;
    EXPECT_NE(x.out.find(",auth.locked,,denied,AUTH_LOCKED,"), std::string::npos);
    EXPECT_NE(x.out.find(",access.denied,/api/v1/project/deployments,denied,FORBIDDEN,"),
              std::string::npos);
}

TEST(ExportAudit, CsvFollowsTheCsvInjectionRulesOfExportHistory) {
    Rig r;
    // The name typed at a failed sign-in is attacker text: a formula, a quote, a comma, a line
    // break.
    r.add(AuditAction::AuthLogin, AuditResult::Failed, "=HYPERLINK(\"http://x\")", nullptr,
          "10.0.0.5:1", "AUTH_FAILED");
    r.add(AuditAction::AuthLogin, AuditResult::Failed, "@SUM(1,2)", nullptr, "10.0.0.5:2",
          "AUTH_FAILED");
    r.add(AuditAction::AuthLogin, AuditResult::Failed, "a,b\nc", nullptr, "10.0.0.5:3",
          "AUTH_FAILED");
    r.add(AuditAction::AuthLogin, AuditResult::Failed, "-1+1", nullptr, "10.0.0.5:4",
          "AUTH_FAILED");
    const CliOut x = runCli(r, {});
    ASSERT_EQ(x.code, 0) << x.err;
    EXPECT_NE(x.out.find(",\"'=HYPERLINK(\"\"http://x\"\")\","), std::string::npos) << x.out;
    EXPECT_NE(x.out.find("\"'@SUM(1,2)\""), std::string::npos) << x.out;
    EXPECT_NE(x.out.find("\"a,b\nc\""), std::string::npos) << x.out;
    EXPECT_NE(x.out.find(",'-1+1,"), std::string::npos) << x.out;
    // Numbers (id, ts_ms, count) are never touched.
    EXPECT_NE(x.out.find("1,2026-10-10 08:00:00.000,"), std::string::npos);
}

TEST(ExportAudit, OnATerminalControlCharactersAreShownNotRun) {
    Rig r;
    r.add(AuditAction::AuthLogin, AuditResult::Failed, "x\x1b[31mred", nullptr, "10.0.0.5:1",
          "AUTH_FAILED");
    const CliOut x = runCli(r, {}, true);
    ASSERT_EQ(x.code, 0) << x.err;
    EXPECT_EQ(x.out.find('\x1b'), std::string::npos);
    EXPECT_NE(x.out.find("\\x1b[31mred"), std::string::npos) << x.out;
}

TEST(ExportAudit, JsonlIsOneObjectPerLineWithTheFieldsOfTheApi) {
    Rig r;
    r.add(AuditAction::ProjectDeploy, AuditResult::Started, "kysu1", "engineer",
          "192.168.1.30:40001", nullptr, "sha256:ab", "{\"opId\":\"op-1\"}");
    r.add(AuditAction::AuthLogin, AuditResult::Failed, "=cmd", nullptr, "10.0.0.5:1",
          "AUTH_FAILED");
    const CliOut x = runCli(r, {"--format", "jsonl"});
    ASSERT_EQ(x.code, 0) << x.err;
    const auto l = lines(x.out);
    ASSERT_EQ(l.size(), 3u) << x.out;  // two rows and the export's own
    const json a = json::parse(l[0]);
    EXPECT_EQ(a["id"], 1);
    EXPECT_EQ(a["ts"], kT0);
    EXPECT_EQ(a["clockOk"], true);
    EXPECT_EQ(a["user"], "kysu1");
    EXPECT_EQ(a["role"], "engineer");
    EXPECT_EQ(a["channel"], "https");
    EXPECT_EQ(a["action"], "project.deploy");
    EXPECT_EQ(a["target"], "sha256:ab");
    EXPECT_EQ(a["result"], "started");
    EXPECT_TRUE(a["code"].is_null());
    EXPECT_EQ(a["detail"]["opId"], "op-1");
    EXPECT_EQ(a["count"], 1);
    EXPECT_EQ(json::parse(l[1])["user"], "=cmd");  // JSON is not a spreadsheet: no apostrophe
    EXPECT_EQ(json::parse(l[2])["action"], "audit.export");
}

TEST(ExportAudit, FromAndToBoundTheRangeInTheGivenTimeZone) {
    Rig r;
    for (int i = 0; i < 5; ++i) r.add(AuditAction::AuthLogin, AuditResult::Ok, "kysu1", "engineer");
    // Rows at 08:00 … 08:04 (+07:00); [08:01, 08:03) holds two of them.
    const CliOut x =
        runCli(r, {"--from", "2026-10-10 08:01", "--to", "2026-10-10 08:03", "--format", "jsonl"});
    ASSERT_EQ(x.code, 0) << x.err;
    const auto l = lines(x.out);
    ASSERT_EQ(l.size(), 2u) << x.out;
    EXPECT_EQ(json::parse(l[0])["ts"], kT0 + kMinute);
    EXPECT_EQ(json::parse(l[1])["ts"], kT0 + 2 * kMinute);
    const CliOut z = runCli(r, {"--from", "2026-10-10 01:01", "--to", "2026-10-10 01:03", "--tz",
                                "+00:00", "--format", "jsonl"});
    ASSERT_EQ(z.code, 0) << z.err;
    EXPECT_EQ(lines(z.out).size(), 2u) << z.out;
    // CSV shows local time in the same zone.
    const CliOut c =
        runCli(r, {"--from", "2026-10-10 01:01", "--to", "2026-10-10 01:02", "--tz", "+00:00"});
    EXPECT_NE(c.out.find("2026-10-10 01:01:00.000"), std::string::npos) << c.out;
}

TEST(ExportAudit, WritesItsOwnAuditExportRowWithTheRangeAndFormat) {
    Rig r;
    r.add(AuditAction::AuthLogin, AuditResult::Ok, "kysu1", "engineer");
    const CliOut x = runCli(r, {"--format", "jsonl", "--from", "2026-10-10 08:00"});
    ASSERT_EQ(x.code, 0) << x.err;
    AuditQuery q;
    q.actionPrefix = "audit.export";
    const AuditPage p = r.log->query(q);
    ASSERT_EQ(p.records.size(), 1u);
    const AuditRecord& rec = p.records[0];
    EXPECT_EQ(rec.result, "ok");
    EXPECT_EQ(rec.channel, "cli");
    EXPECT_EQ(rec.source, "cli");
    EXPECT_TRUE(rec.user.has_value());
    const json d = json::parse(rec.detail.value_or("{}"));
    EXPECT_EQ(d["format"], "jsonl");
    EXPECT_EQ(d["from"], "2026-10-10 08:00");
}

TEST(ExportAudit, ReadsEveryPageOfALogLargerThanTwoHundredRows) {
    Rig r;
    {
        sqlite3* db = nullptr;
        ASSERT_EQ(sqlite3_open_v2(r.log->path().c_str(), &db, SQLITE_OPEN_READWRITE, nullptr),
                  SQLITE_OK);
        sqlite3_busy_timeout(db, 5000);
        ASSERT_EQ(sqlite3_exec(db, "BEGIN", nullptr, nullptr, nullptr), SQLITE_OK);
        for (int i = 1; i <= 450; ++i) {
            const std::string sql =
                "INSERT INTO audit(id, ts_ms, clock_ok, source, channel, action, result, count) "
                "VALUES(" +
                std::to_string(i) + "," + std::to_string(kT0 + i) +
                ",1,'system','system','project.read','ok',1)";
            ASSERT_EQ(sqlite3_exec(db, sql.c_str(), nullptr, nullptr, nullptr), SQLITE_OK);
        }
        ASSERT_EQ(sqlite3_exec(db, "COMMIT", nullptr, nullptr, nullptr), SQLITE_OK);
        sqlite3_close(db);
    }
    const CliOut x = runCli(r, {"--format", "jsonl"});
    ASSERT_EQ(x.code, 0) << x.err;
    const auto l = lines(x.out);
    ASSERT_EQ(l.size(), 451u);
    for (int i = 0; i < 450; ++i) ASSERT_EQ(json::parse(l[static_cast<size_t>(i)])["id"], i + 1);
    EXPECT_EQ(json::parse(l[450])["action"], "audit.export");
}

TEST(ExportAudit, NoPasswordTokenOrHashInTheOutput) {
    Rig r;
    r.add(AuditAction::AuthLogin, AuditResult::Ok, "kysu1", "engineer");
    r.add(AuditAction::AccountPassword, AuditResult::Ok, "admin1", "administrator", "cli", nullptr,
          "kysu1");
    const CliOut x = runCli(r, {});
    ASSERT_EQ(x.code, 0) << x.err;
    for (const char* s : {"$argon2", "token", "hash", "secret"})
        EXPECT_EQ(x.out.find(s), std::string::npos) << s;
}

TEST(ExportAudit, BadArgumentsExit2WithAMessageAndWriteNothing) {
    Rig r;
    r.add(AuditAction::AuthLogin, AuditResult::Ok, "kysu1", "engineer");
    for (const auto& args : std::vector<std::vector<std::string>>{
             {"--format", "xml"},
             {"--format"},
             {"--from"},
             {"--from", "hôm qua"},
             {"--to", "2026-13-40"},
             {"--tz", "UTC"},
             {"--nope"},
             {"--from", "2026-10-10 08:05", "--to", "2026-10-10 08:00"}}) {
        const CliOut x = runCli(r, args);
        EXPECT_EQ(x.code, 2) << args[0];
        EXPECT_FALSE(x.err.empty()) << args[0];
        EXPECT_TRUE(x.out.empty()) << args[0];
    }
    AuditQuery q;
    q.actionPrefix = "audit.export";
    EXPECT_TRUE(r.log->query(q).records.empty());  // a refused command records nothing
}

TEST(ExportAudit, NoAuditDbExit4AndNoFileIsCreated) {
    Dir empty;
    DeviceCliEnv env;
    std::vector<std::string> args{"mat-runtime", "--export-audit", "--data-dir", empty.path};
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(&a[0]);
    std::ostringstream out, err;
    EXPECT_EQ(runExportAuditCli(static_cast<int>(argv.size()), argv.data(), env, out, err), 4);
    EXPECT_FALSE(err.str().empty());
    struct stat st {};
    EXPECT_NE(::stat((empty.path + "/audit.db").c_str(), &st), 0);
}

TEST(ExportAudit, AFailingOutputExits5) {
    Rig r;
    for (int i = 0; i < 20; ++i)
        r.add(AuditAction::AuthLogin, AuditResult::Ok, "kysu1", "engineer");
    std::vector<std::string> args{"mat-runtime", "--export-audit", "--data-dir", r.dir.path};
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(&a[0]);
    FailingBuf buf(200);
    std::ostream out(&buf);
    std::ostringstream err;
    EXPECT_EQ(runExportAuditCli(static_cast<int>(argv.size()), argv.data(), r.env, out, err), 5);
    EXPECT_FALSE(err.str().empty());
}
