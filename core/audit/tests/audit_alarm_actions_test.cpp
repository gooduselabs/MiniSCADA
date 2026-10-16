// Feature 009 T019 (data-model §8, FR-088, FR-089): the six alarm actions of the audit log,
// 27 -> 33. Names, parse, the limited kinds (every `denied` of the six; alarm.shelve and
// alarm.unshelve by `system`), a detail of up to 1 KiB written and read back, alarm.ack denied
// through the 10 rows per minute limit with the rest counted in audit.suppressed, alarm.shelve by
// `system` accepted, and the schema of audit.db unchanged (a version 3 file of the 27 actions
// still reads). Fake clocks; the file is a real SQLite file in a temporary directory.
#include <gtest/gtest.h>
#include <unistd.h>

#include <cstdio>
#include <string>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "nlohmann/json.hpp"
#include "sqlite3.h"

using namespace mat;
using nlohmann::json;

namespace {

constexpr int64_t kT0 = 1791594000000;

std::string tempDir() {
    char tmpl[] = "/tmp/mat-alarm-audit-XXXXXX";
    const char* d = mkdtemp(tmpl);
    return d ? d : "";
}

struct Fx {
    std::string dir = tempDir();
    int64_t wall = kT0;
    int64_t mono = 5000000;
    std::unique_ptr<AuditLog> log;

    Fx() {
        AuditOptions o;
        o.dataDir = dir;
        o.clock.wallMs = [this] { return wall; };
        o.clock.monoMs = [this] { return mono; };
        o.clock.synced = [](int64_t) { return true; };
        o.bootId = "boot-A";
        log = std::make_unique<AuditLog>(o);
        std::string err;
        EXPECT_TRUE(log->open(err)) << err;
    }
    void advance(int64_t ms) {
        wall += ms;
        mono += ms;
    }
    std::string file() const { return dir + "/audit.db"; }
};

AuditEvent user(AuditAction a, AuditResult r, const std::string& target,
                const std::string& detail = "{}", AuditChannel ch = AuditChannel::Web) {
    AuditEvent e(a, r, ch, "10.0.0.7:51000");
    e.user = "vh1";
    e.role = "operator";
    e.target = target;
    e.detail = detail;
    return e;
}

AuditEvent system(AuditAction a, const std::string& target, const std::string& detail) {
    AuditEvent e(a, AuditResult::Ok, AuditChannel::System, "system");
    e.target = target;
    e.detail = detail;
    return e;
}

std::vector<AuditRecord> rowsOf(AuditLog& log, const std::string& prefix) {
    AuditQuery q;
    q.actionPrefix = prefix;
    q.limit = kAuditQueryMaxLimit;
    return log.query(q).records;
}

}  // namespace

TEST(AlarmAuditActions, SixAlarmActionsThenHistoryExport34) {
    // Feature 011 adds after these (auth.distributed_attack, ...): their places do not move.
    ASSERT_GE(kAuditActions.size(), 35u);
    const std::vector<std::string> tail = {"alarm.ack",     "alarm.shelve", "alarm.unshelve",
                                           "alarm.disable", "alarm.enable", "alarm.purged"};
    std::vector<std::string> names;
    for (size_t i = 27; i < 33; ++i) names.push_back(auditActionName(kAuditActions[i]));
    EXPECT_EQ(names, tail);
    EXPECT_STREQ(auditActionName(AuditAction::AlarmAck), "alarm.ack");
    EXPECT_STREQ(auditActionName(AuditAction::AlarmShelve), "alarm.shelve");
    EXPECT_STREQ(auditActionName(AuditAction::AlarmUnshelve), "alarm.unshelve");
    EXPECT_STREQ(auditActionName(AuditAction::AlarmDisable), "alarm.disable");
    EXPECT_STREQ(auditActionName(AuditAction::AlarmEnable), "alarm.enable");
    EXPECT_STREQ(auditActionName(AuditAction::AlarmPurged), "alarm.purged");
    for (const auto& n : tail) {
        const auto a = parseAuditAction(n);
        ASSERT_TRUE(a.has_value()) << n;
        EXPECT_STREQ(auditActionName(*a), n.c_str());
    }
    // the 27 of before keep their place (the names stored in audit.db do not move)
    EXPECT_STREQ(auditActionName(kAuditActions[0]), "auth.login");
    EXPECT_STREQ(auditActionName(kAuditActions[26]), "tls.import");
    EXPECT_STREQ(auditActionName(kAuditActions[33]), "history.export");           // feature 010
    EXPECT_STREQ(auditActionName(kAuditActions[34]), "auth.distributed_attack");  // feature 011
    EXPECT_EQ(parseAuditAction("auth.distributed_attack"), AuditAction::AuthDistributedAttack);
    EXPECT_FALSE(parseAuditAction("alarm.acked").has_value());
}

TEST(AlarmAuditActions, DeniedRowsAndSystemShelvingAreLimited) {
    for (AuditAction a :
         {AuditAction::AlarmAck, AuditAction::AlarmShelve, AuditAction::AlarmUnshelve,
          AuditAction::AlarmDisable, AuditAction::AlarmEnable}) {
        EXPECT_TRUE(auditLimited(a, AuditResult::Denied)) << auditActionName(a);
        EXPECT_FALSE(auditLimited(a, AuditResult::Ok)) << auditActionName(a);
        EXPECT_FALSE(auditLimited(a, AuditResult::Failed)) << auditActionName(a);
    }
    // alarm.shelve / alarm.unshelve by `system` (chatter, expiry) are limited: the channel decides
    EXPECT_TRUE(auditLimited(AuditAction::AlarmShelve, AuditResult::Ok, AuditChannel::System));
    EXPECT_TRUE(auditLimited(AuditAction::AlarmUnshelve, AuditResult::Ok, AuditChannel::System));
    EXPECT_FALSE(auditLimited(AuditAction::AlarmShelve, AuditResult::Ok, AuditChannel::Web));
    EXPECT_FALSE(auditLimited(AuditAction::AlarmShelve, AuditResult::Ok, AuditChannel::Https));
    // alarm.purged: at most one row per hour by the clean-up, never limited
    EXPECT_FALSE(auditLimited(AuditAction::AlarmPurged, AuditResult::Ok, AuditChannel::System));
    EXPECT_FALSE(auditLimited(AuditAction::AlarmPurged, AuditResult::Denied));
    // the kinds of before are unchanged
    EXPECT_TRUE(auditLimited(AuditAction::AuthLogin, AuditResult::Failed));
    EXPECT_TRUE(auditLimited(AuditAction::TagWrite, AuditResult::Denied));
    EXPECT_FALSE(auditLimited(AuditAction::TagWrite, AuditResult::Ok, AuditChannel::System));
}

TEST(AlarmAuditActions, AckRowWithItsDetailIsWrittenAndReadBack) {
    Fx f;
    const int64_t id = f.log->append(user(AuditAction::AlarmAck, AuditResult::Ok,
                                          "TANK_B1_LEVEL.HH", R"({"occurrence":20311})"));
    EXPECT_GT(id, 0);
    // bulk: one row, ids cut to 10, upToRevision
    json ids = json::array();
    for (int i = 0; i < 10; ++i) ids.push_back("A" + std::to_string(i));
    const json bulk = {{"count", 37}, {"ids", ids}, {"upToRevision", 8412}};
    f.log->append(user(AuditAction::AlarmAck, AuditResult::Ok, "all:area=bon;priority=major",
                       bulk.dump(), AuditChannel::Https));
    const auto rows = rowsOf(*f.log, "alarm.");
    ASSERT_EQ(rows.size(), 2u);
    EXPECT_EQ(rows[1].action, "alarm.ack");
    EXPECT_EQ(rows[1].result, "ok");
    EXPECT_EQ(rows[1].channel, "web");
    EXPECT_EQ(rows[1].user, "vh1");
    EXPECT_EQ(rows[1].role, "operator");
    EXPECT_EQ(rows[1].target, "TANK_B1_LEVEL.HH");
    EXPECT_EQ(json::parse(rows[1].detail.value_or("null")), json({{"occurrence", 20311}}));
    EXPECT_EQ(rows[0].target, "all:area=bon;priority=major");
    EXPECT_EQ(json::parse(rows[0].detail.value_or("null")), bulk);
    EXPECT_EQ(rows[0].count, 1);
}

TEST(AlarmAuditActions, DetailUpTo1KiBIsKeptWholeAndABiggerOneIsCut) {
    Fx f;
    json d = {{"reason", std::string(990, 'x')}, {"durationS", 3600}};
    ASSERT_LE(d.dump().size(), kAuditMaxDetailBytes);
    f.log->append(user(AuditAction::AlarmShelve, AuditResult::Ok, "PUMP1_FAULT", d.dump()));
    json big = {{"reason", std::string(2000, 'y')}, {"durationS", 60}};
    f.log->append(user(AuditAction::AlarmShelve, AuditResult::Ok, "PUMP2_FAULT", big.dump()));
    const auto rows = rowsOf(*f.log, "alarm.shelve");
    ASSERT_EQ(rows.size(), 2u);
    EXPECT_EQ(json::parse(*rows[1].detail), d);
    const json cut = json::parse(*rows[0].detail);
    EXPECT_LE(rows[0].detail->size(), kAuditMaxDetailBytes);
    EXPECT_EQ(cut["durationS"], 60);
    EXPECT_EQ(cut["truncated"], true);
}

TEST(AlarmAuditActions, AckDeniedGoesThroughTheTenRowsPerMinuteLimit) {
    Fx f;
    for (int i = 0; i < 25; ++i) {
        AuditEvent e = user(AuditAction::AlarmAck, AuditResult::Denied,
                            "ALARM_" + std::to_string(i), R"({"reason":"role"})");
        e.role = "viewer";
        f.log->append(e);
        f.advance(1000);
    }
    int64_t denied = 0, total = 0;
    std::vector<AuditRecord> suppressed;
    for (const auto& r : f.log->query({}).records) {
        total += r.count;
        if (r.action == "alarm.ack") {
            ++denied;
            EXPECT_EQ(r.result, "denied");
        }
        if (r.action == "audit.suppressed") suppressed.push_back(r);
    }
    EXPECT_EQ(denied, kAuditLimitedRowsPerWindow);
    ASSERT_EQ(suppressed.size(), 1u);
    EXPECT_EQ(suppressed[0].count, 15);
    EXPECT_EQ(total, 25);
    // feature 011 (L-06 of 005): the suppressed row keeps the sources too
    EXPECT_EQ(json::parse(*suppressed[0].detail),
              json::parse(R"({"alarm.ack":15,"sources":{"10.0.0.7":15}})"));
    // a successful ack right after is never limited
    const int64_t id = f.log->append(
        user(AuditAction::AlarmAck, AuditResult::Ok, "ALARM_0", R"({"occurrence":1})"));
    EXPECT_GT(id, 0);
    EXPECT_EQ(rowsOf(*f.log, "alarm.ack").size(), 11u);
}

TEST(AlarmAuditActions, ShelveBySystemIsValidAndCoalescedPerTarget) {
    Fx f;
    // the same alarm quarantined for chatter repeatedly in one minute: one row, count grows
    for (int i = 0; i < 3; ++i)
        f.log->append(system(AuditAction::AlarmShelve, "TANK_B1_LEVEL.H",
                             R"({"reason":"chatter","durationS":600,"count":5,"windowS":60})"));
    f.log->append(system(AuditAction::AlarmUnshelve, "TANK_B1_LEVEL.H", R"({"reason":"expired"})"));
    f.log->append(system(AuditAction::AlarmPurged, "alarm.db",
                         R"({"reason":"retention","rows":1000,"olderThanMs":1776000000000})"));
    f.log->close();
    AuditOptions o;
    o.dataDir = f.dir;
    AuditLog again(o);
    std::string err;
    ASSERT_TRUE(again.open(err)) << err;
    const auto rows = rowsOf(again, "alarm.");
    ASSERT_EQ(rows.size(), 3u);  // newest first
    EXPECT_EQ(rows[0].action, "alarm.purged");
    EXPECT_EQ(rows[0].channel, "system");
    EXPECT_EQ(rows[0].source, "system");
    EXPECT_EQ(rows[0].target, "alarm.db");
    EXPECT_EQ(rows[1].action, "alarm.unshelve");
    EXPECT_EQ(rows[2].action, "alarm.shelve");
    EXPECT_EQ(rows[2].count, 3);
    EXPECT_FALSE(rows[2].user.has_value());
}

TEST(AlarmAuditActions, SchemaUnchangedAVersion3FileStillReadsAndTakesTheNewNames) {
    Fx f;
    f.log->append(user(AuditAction::TagWrite, AuditResult::Ok, "TANK01.SP",
                       R"({"requestId":"x","readback":75})", AuditChannel::Https));
    f.log->close();
    sqlite3* db = nullptr;
    ASSERT_EQ(sqlite3_open_v2(f.file().c_str(), &db, SQLITE_OPEN_READWRITE, nullptr), SQLITE_OK);
    sqlite3_stmt* st = nullptr;
    ASSERT_EQ(sqlite3_prepare_v2(db, "PRAGMA user_version", -1, &st, nullptr), SQLITE_OK);
    ASSERT_EQ(sqlite3_step(st), SQLITE_ROW);
    const int version = sqlite3_column_int(st, 0);
    sqlite3_finalize(st);
    // the action column is free text: an older runtime (27 actions) can store and read the new
    // names, and this runtime reads the rows it wrote
    EXPECT_EQ(sqlite3_exec(db,
                           ("INSERT INTO audit(ts_ms, clock_ok, source, channel, action, target, "
                            "result, detail) VALUES(" +
                            std::to_string(kT0 + 5) +
                            ", 1, '10.0.0.7:1', 'web', 'alarm.disable', 'PUMP1_FAULT', 'ok', "
                            "'{\"reason\":\"sensor\"}')")
                               .c_str(),
                           nullptr, nullptr, nullptr),
              SQLITE_OK);
    sqlite3_close(db);
    AuditOptions o;
    o.dataDir = f.dir;
    AuditLog again(o);
    std::string err;
    ASSERT_TRUE(again.open(err)) << err;
    EXPECT_EQ(again.pragmaInt("user_version"), version) << "no migration for feature 009";
    const auto rows = again.query({}).records;
    ASSERT_EQ(rows.size(), 2u);
    EXPECT_EQ(rows[0].action, "alarm.disable");
    EXPECT_EQ(rows[1].action, "tag.write");
    EXPECT_GT(again.append(user(AuditAction::AlarmEnable, AuditResult::Ok, "PUMP1_FAULT", "{}",
                                AuditChannel::Https)),
              0);
}
