// T038 (feature 009; FR-041, D46): `mat-runtime --alarm-db-check` is a read-only look at alarm.db:
// the integrity check, the number of rows, the open occurrences, and the acknowledgements that
// audit.db does not know (SC-008). It opens no port and changes nothing (a damaged file is not
// renamed: that is the runtime's job at start-up). Exit codes: 0 sound (or no alarm.db yet),
// 1 integrity_check failed, 2 bad arguments or configuration, 3 an acknowledgement without audit.
#include <gtest/gtest.h>
#include <sys/stat.h>

#include <filesystem>
#include <fstream>
#include <sstream>

#include "core/alarm/alarm_store.hpp"
#include "core/audit/audit_log.hpp"
#include "nlohmann/json.hpp"
#include "server/cli/alarm_db_check.hpp"

namespace fs = std::filesystem;
using namespace mat;
using nlohmann::json;

namespace {

constexpr int64_t kNow = 1791600000000LL;

struct Dir {
    fs::path root;
    Dir() {
        char tmpl[] = "/tmp/mat-alarmcheck-XXXXXX";
        root = ::mkdtemp(tmpl);
    }
    ~Dir() {
        std::error_code ec;
        fs::remove_all(root, ec);
    }
    std::string str() const { return root.string(); }
    std::string db() const { return (root / "alarm.db").string(); }
    std::string content(const std::string& path) const {
        std::ifstream f(path, std::ios::binary);
        return std::string((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    }
};

alarm::OccurrenceRow row(int64_t id, const std::string& alarm, bool acked, bool closed = false) {
    alarm::OccurrenceRow r;
    r.id = id;
    r.alarmId = alarm;
    r.fingerprint = "0123456789abcdef";
    r.tsActiveMs = kNow + id;
    r.priority = 2;
    r.classId = "major";
    r.text = "x";
    r.textFold = "x";
    if (acked) {
        r.tsAckMs = kNow + id + 1000;
        r.ackUser = "vanhanh1";
    }
    r.closed = closed;
    if (closed) r.closedBy = alarm::ClosedBy::Return;
    return r;
}

void makeDb(const Dir& d, std::vector<alarm::OccurrenceRow> rows) {
    alarm::AlarmStore s(d.str(), [] { return kNow; });
    std::string err;
    ASSERT_TRUE(s.open(err)) << err;
    ASSERT_TRUE(s.commit(rows, {}, {}, err)) << err;
    s.close(true);
}

void auditAck(const Dir& d, const std::string& alarmId, int64_t occurrence) {
    AuditOptions o;
    o.dataDir = d.str();
    o.clock.wallMs = [] { return kNow; };
    o.clock.monoMs = [] { return int64_t{5000000}; };
    o.clock.synced = [](int64_t) { return true; };
    AuditLog log(o);
    std::string err;
    ASSERT_TRUE(log.open(err)) << err;
    AuditEvent e(AuditAction::AlarmAck, AuditResult::Ok, AuditChannel::Web, "10.0.0.5:5000");
    e.user = "vanhanh1";
    e.role = "operator";
    e.target = alarmId;
    e.detail = json{{"occurrence", occurrence}, {"from", "ACTIVE_UNACK"}}.dump();
    log.append(e);
    log.close();
}

struct CliRun {
    int code;
    std::string out, err;
};

CliRun runCli(std::vector<std::string> args) {
    args.insert(args.begin(), "mat-runtime");
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(&a[0]);
    std::ostringstream out, err;
    const int code = runAlarmDbCheckCli(static_cast<int>(argv.size()), argv.data(),
                                        DeviceCliEnv{}, out, err);
    return {code, out.str(), err.str()};
}

}  // namespace

TEST(AlarmDbCheck, RecognisesItsFlag) {
    std::vector<std::string> a = {"mat-runtime", "--alarm-db-check"};
    std::vector<char*> argv;
    for (auto& s : a) argv.push_back(&s[0]);
    EXPECT_TRUE(isAlarmDbCheckCommand(static_cast<int>(argv.size()), argv.data()));
    a = {"mat-runtime", "--retain-dump"};
    argv.clear();
    for (auto& s : a) argv.push_back(&s[0]);
    EXPECT_FALSE(isAlarmDbCheckCommand(static_cast<int>(argv.size()), argv.data()));
}

TEST(AlarmDbCheck, NoDatabaseYetIsNotAnError) {
    Dir d;
    const CliRun r = runCli({"--alarm-db-check", "--data-dir", d.str()});
    EXPECT_EQ(r.code, 0) << r.err;
    const json j = json::parse(r.out, nullptr, false);
    ASSERT_TRUE(j.is_object()) << r.out;
    EXPECT_EQ(j["state"], "missing");
    EXPECT_FALSE(fs::exists(d.db())) << "the command makes no file";
}

TEST(AlarmDbCheck, ASoundDatabaseWithItsAcknowledgementsInTheAudit) {
    Dir d;
    makeDb(d, {row(1, "TANK.HH", true, true), row(2, "PUMP1", false), row(3, "PUMP2", true)});
    auditAck(d, "TANK.HH", 1);
    auditAck(d, "PUMP2", 3);
    const std::string before = d.content(d.db());
    const CliRun r = runCli({"--alarm-db-check", "--data-dir", d.str()});
    ASSERT_EQ(r.code, 0) << r.err << r.out;
    const json j = json::parse(r.out, nullptr, false);
    ASSERT_TRUE(j.is_object()) << r.out;
    EXPECT_EQ(j["state"], "ok");
    EXPECT_EQ(j["integrity"], "ok");
    EXPECT_EQ(j["rows"], 3);
    EXPECT_EQ(j["open"], 2);
    EXPECT_EQ(j["acked"], 2);
    EXPECT_TRUE(j["ackWithoutAudit"].empty());
    EXPECT_EQ(d.content(d.db()), before) << "read only: not a byte of alarm.db changes";
}

TEST(AlarmDbCheck, AnAcknowledgementWithoutAnAuditRecordIsReportedWithExit3) {
    Dir d;
    makeDb(d, {row(1, "A", true), row(2, "B", true)});
    auditAck(d, "A", 1);  // B's acknowledgement has no record
    const CliRun r = runCli({"--alarm-db-check", "--data-dir", d.str()});
    EXPECT_EQ(r.code, 3) << r.out;
    const json j = json::parse(r.out, nullptr, false);
    ASSERT_TRUE(j.is_object());
    ASSERT_EQ(j["ackWithoutAudit"].size(), 1u);
    EXPECT_EQ(j["ackWithoutAudit"][0]["id"], 2);
    EXPECT_EQ(j["ackWithoutAudit"][0]["alarmId"], "B");
}

TEST(AlarmDbCheck, WithoutAnAuditLogEveryAcknowledgementIsWithoutAudit) {
    Dir d;
    makeDb(d, {row(1, "A", true)});
    const CliRun r = runCli({"--alarm-db-check", "--data-dir", d.str()});
    EXPECT_EQ(r.code, 3);
    EXPECT_FALSE(fs::exists(d.root / "audit.db")) << "the command makes no audit.db";
}

TEST(AlarmDbCheck, ADamagedFileIsReportedWithExit1AndNeverRenamed) {
    Dir d;
    makeDb(d, {row(1, "A", false)});
    {  // break every page after the first (the schema page stays: the file still opens)
        const std::string whole = d.content(d.db());
        ASSERT_GT(whole.size(), 4096u + 20u);
        std::fstream f(d.db(), std::ios::in | std::ios::out | std::ios::binary);
        f.seekp(4096 + 20);
        const std::string junk(whole.size() - (4096 + 20), '\x5A');
        f.write(junk.data(), static_cast<std::streamsize>(junk.size()));
    }
    const std::string before = d.content(d.db());
    const CliRun r = runCli({"--alarm-db-check", "--data-dir", d.str()});
    EXPECT_EQ(r.code, 1) << r.out;
    const json j = json::parse(r.out, nullptr, false);
    ASSERT_TRUE(j.is_object()) << r.out;
    EXPECT_NE(j["integrity"], "ok");
    EXPECT_EQ(d.content(d.db()), before);
    for (const auto& e : fs::directory_iterator(d.root))
        EXPECT_EQ(e.path().filename().string().find("corrupt"), std::string::npos);
}

TEST(AlarmDbCheck, NotADatabaseIsExit1) {
    Dir d;
    {
        std::ofstream f(d.db(), std::ios::binary);
        f << std::string(5000, 'x');
    }
    const CliRun r = runCli({"--alarm-db-check", "--data-dir", d.str()});
    EXPECT_EQ(r.code, 1) << r.out;
    EXPECT_TRUE(fs::exists(d.db()));
}

TEST(AlarmDbCheck, BadArgumentsAreExit2) {
    EXPECT_EQ(runCli({"--alarm-db-check", "--bogus"}).code, 2);
    EXPECT_EQ(runCli({"--alarm-db-check", "--data-dir"}).code, 2);
    EXPECT_EQ(runCli({"--alarm-db-check", "--config", "/nonexistent/x.json"}).code, 2);
}
