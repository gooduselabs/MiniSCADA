// T029: AlarmService (FR-026, FR-039, FR-043): the writer thread, commit windows, a tick that never
// waits for SQLite, the 5000 change buffer, retries, a full disk, purge, damaged file, audit hook.
#include "core/alarm/alarm_service.hpp"

#include <gtest/gtest.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <fstream>
#include <mutex>
#include <thread>

#include "nlohmann/json.hpp"

using namespace mat::alarm;
using namespace std::chrono;

namespace {
constexpr int64_t kNow = 1791600000000LL;

std::string tempDir() {
    char tmpl[] = "/tmp/mat-alarmsvc-XXXXXX";
    const char* d = mkdtemp(tmpl);
    return d ? d : "";
}

OccurrenceRow row(int64_t id, bool closed = false, const std::string& alarm = "A", int64_t ts = kNow) {
    OccurrenceRow r;
    r.id = id;
    r.alarmId = alarm;
    r.fingerprint = "0123456789abcdef";
    r.tsActiveMs = ts;
    r.priority = 3;
    r.classId = "minor";
    r.text = "t";
    r.textFold = "t";
    r.qualityActive = "GOOD";
    r.closed = closed;
    if (closed) r.closedBy = ClosedBy::Return;
    return r;
}
AlarmEvent stateEvent(const OccurrenceRow& r) {
    AlarmEvent e;
    e.kind = AlarmEvent::Kind::State;
    e.instance = r.alarmId;
    e.occurrence = r.id;
    e.row = r;
    return e;
}

struct Audit {
    std::mutex mu;
    std::vector<SystemAudit> lines;
    void add(const SystemAudit& a) {
        std::lock_guard<std::mutex> l(mu);
        lines.push_back(a);
    }
    std::vector<SystemAudit> get() {
        std::lock_guard<std::mutex> l(mu);
        return lines;
    }
};

ServiceOptions fast(const std::string& dir, Audit* audit = nullptr) {
    ServiceOptions o;
    o.dir = dir;
    o.commitMs = 60;
    o.commitMaxMs = 400;
    o.commitRows = 200;
    o.stormWindowMs = 500;
    o.retryMs = 80;
    o.purgePauseMs = 1;
    o.nowEpochMs = [] { return kNow; };
    o.clockOk = [](int64_t) { return true; };
    o.freeBytes = [] { return int64_t(1) << 40; };
    if (audit) o.audit = [audit](const SystemAudit& a) { audit->add(a); };
    return o;
}

bool waitFor(const std::function<bool()>& f, int ms = 3000) {
    const auto end = steady_clock::now() + milliseconds(ms);
    while (steady_clock::now() < end) {
        if (f()) return true;
        std::this_thread::sleep_for(milliseconds(5));
    }
    return f();
}
}  // namespace

TEST(AlarmService, CommitsAfterTheWindowNotBefore) {
    const std::string dir = tempDir();
    ServiceOptions o = fast(dir);
    o.commitMs = 300;
    AlarmService s(o);
    std::string err;
    ASSERT_TRUE(s.start(err)) << err;
    s.push({stateEvent(row(1))});
    std::this_thread::sleep_for(milliseconds(100));
    EXPECT_EQ(s.commits(), 0u);  // still collecting
    EXPECT_GE(s.queued(), 1u);
    EXPECT_TRUE(waitFor([&] { return s.commits() >= 1; }, 3000));
    EXPECT_EQ(s.queued(), 0u);
    s.stop();
    AlarmStore st(dir, [] { return kNow; });
    ASSERT_TRUE(st.open(err));
    EXPECT_EQ(st.countRows(), 1);
}

TEST(AlarmService, EnoughChangesCommitAtOnce) {
    const std::string dir = tempDir();
    ServiceOptions o = fast(dir);
    o.commitMs = 20000;
    o.commitMaxMs = 20000;
    AlarmService s(o);
    std::string err;
    ASSERT_TRUE(s.start(err));
    std::vector<AlarmEvent> ev;
    for (int i = 1; i <= 199; ++i) ev.push_back(stateEvent(row(i)));
    s.push(ev);
    std::this_thread::sleep_for(milliseconds(150));
    EXPECT_EQ(s.commits(), 0u);
    s.push({stateEvent(row(200))});  // the 200th change
    EXPECT_TRUE(waitFor([&] { return s.commits() >= 1; }, 2000));
    s.stop();
}

TEST(AlarmService, NewerVersionOfARowReplacesTheOlderInTheBuffer) {
    const std::string dir = tempDir();
    ServiceOptions o = fast(dir);
    o.commitMs = 300;
    AlarmService s(o);
    std::string err;
    ASSERT_TRUE(s.start(err));
    OccurrenceRow r = row(1);
    s.push({stateEvent(r)});
    r.tsAckMs = kNow + 5;
    r.ackUser = "op1";
    s.push({stateEvent(r)});
    r.closed = true;
    r.closedBy = ClosedBy::Return;
    s.push({stateEvent(r)});
    EXPECT_EQ(s.queued(), 1u);  // one row, the newest
    ASSERT_TRUE(s.flush(3000));
    s.stop();
    AlarmStore st(dir, [] { return kNow; });
    ASSERT_TRUE(st.open(err));
    EXPECT_EQ(st.countRows(), 1);
    EXPECT_EQ(st.countOpen(), 0);
}

TEST(AlarmService, TheWindowGrowsInAStormAndShrinksBack) {
    const std::string dir = tempDir();
    ServiceOptions o = fast(dir);
    o.commitMs = 50;
    o.commitMaxMs = 400;
    o.stormChangesPerS = 5;
    o.stormWindowMs = 500;  // > 2.5 changes in 500 ms counts as a storm
    AlarmService s(o);
    std::string err;
    ASSERT_TRUE(s.start(err));
    EXPECT_EQ(s.currentWindowMs(), 50);
    int64_t id = 1;
    for (int i = 0; i < 20; ++i) {  // 20 changes within ~200 ms
        s.push({stateEvent(row(id++))});
        std::this_thread::sleep_for(milliseconds(10));
    }
    EXPECT_EQ(s.currentWindowMs(), 400);
    std::this_thread::sleep_for(milliseconds(700));
    s.push({stateEvent(row(id++))});  // the next change finds the rate gone down
    EXPECT_EQ(s.currentWindowMs(), 50);
    s.stop();
}

TEST(AlarmService, TheTickNeverWaitsForSqlite) {
    const std::string dir = tempDir();
    ServiceOptions o = fast(dir);
    o.commitMs = 20;
    o.testCommitDelayMs = 500;  // every commit sleeps half a second
    AlarmService s(o);
    std::string err;
    ASSERT_TRUE(s.start(err));
    s.push({stateEvent(row(1))});
    ASSERT_TRUE(waitFor([&] { return s.queued() == 0 || s.commits() > 0; }, 1000));  // the writer is inside its sleep
    std::this_thread::sleep_for(milliseconds(50));
    int64_t worstUs = 0;
    for (int i = 0; i < 200; ++i) {
        const auto t0 = steady_clock::now();
        s.push({stateEvent(row(10 + i))});
        const int64_t us = duration_cast<microseconds>(steady_clock::now() - t0).count();
        worstUs = std::max(worstUs, us);
        std::this_thread::sleep_for(milliseconds(2));
    }
    EXPECT_LT(worstUs, 5000) << "push took " << worstUs << " us while the writer slept";
    ASSERT_TRUE(s.flush(10000));
    s.stop();
}

TEST(AlarmService, BufferLimitDropsTheOldestClosedRowsAndCountsThem) {
    const std::string dir = tempDir();
    ServiceOptions o = fast(dir);
    o.commitMs = 600000;
    o.commitMaxMs = 600000;
    o.commitRows = 100000;
    o.bufferMax = 100;
    AlarmService s(o);
    std::string err;
    ASSERT_TRUE(s.start(err));
    std::vector<AlarmEvent> ev;
    for (int i = 1; i <= 10; ++i) ev.push_back(stateEvent(row(i, false)));          // 10 open
    for (int i = 11; i <= 160; ++i) ev.push_back(stateEvent(row(i, true)));         // 150 closed
    s.push(ev);
    EXPECT_EQ(s.queued(), 100u);
    EXPECT_EQ(s.droppedChanges(), 60u);  // 160 - 100: the oldest closed rows
    ASSERT_TRUE(s.flush(5000));
    s.stop();
    AlarmStore st(dir, [] { return kNow; });
    ASSERT_TRUE(st.open(err));
    EXPECT_EQ(st.countRows(), 100);
    EXPECT_EQ(st.countOpen(), 10);  // an open row is never dropped
    EXPECT_EQ(st.nextOccurrence(), 161);
}

TEST(AlarmService, OverridesAndMetaAreNeverDroppedByTheBufferLimit) {
    const std::string dir = tempDir();
    ServiceOptions o = fast(dir);
    o.commitMs = 600000;
    o.commitMaxMs = 600000;
    o.commitRows = 100000;
    o.bufferMax = 10;
    AlarmService s(o);
    std::string err;
    ASSERT_TRUE(s.start(err));
    AlarmEvent sh;
    sh.kind = AlarmEvent::Kind::Shelve;
    sh.instance = "A";
    sh.user = "op1";
    sh.reason = "bảo trì";
    sh.tEpoch = kNow;
    sh.untilEpochMs = kNow + 60000;
    std::vector<AlarmEvent> ev{sh};
    for (int i = 1; i <= 30; ++i) ev.push_back(stateEvent(row(i, true)));
    s.push(ev);
    ASSERT_TRUE(s.flush(5000));
    s.stop();
    AlarmStore st(dir, [] { return kNow; });
    ASSERT_TRUE(st.open(err));
    auto ov = st.loadOverrides(err);
    ASSERT_EQ(ov.size(), 1u);
    EXPECT_EQ(ov[0].alarmId, "A");
    EXPECT_EQ(ov[0].kind, "shelve");
    EXPECT_EQ(*ov[0].tsEndMs, kNow + 60000);
}

TEST(AlarmService, TransientFailuresKeepTheQueueAndRetry) {
    const std::string dir = tempDir();
    ServiceOptions o = fast(dir);
    o.testFailCommits = 3;
    o.errorAfterFailures = 3;
    o.retryMs = 60;
    AlarmService s(o);
    std::string err;
    ASSERT_TRUE(s.start(err));
    s.push({stateEvent(row(1)), stateEvent(row(2))});
    ASSERT_TRUE(waitFor([&] { return s.logState() == LogState::Error; }, 3000));  // after 3 in a row
    EXPECT_EQ(s.queued(), 2u);  // nothing lost
    ASSERT_TRUE(waitFor([&] { return s.commits() >= 1; }, 3000));
    EXPECT_EQ(s.logState(), LogState::Running);  // back by itself
    EXPECT_EQ(s.queued(), 0u);
    s.stop();
    AlarmStore st(dir, [] { return kNow; });
    ASSERT_TRUE(st.open(err));
    EXPECT_EQ(st.countRows(), 2);
}

TEST(AlarmService, FullDiskPausesHistoryButKeepsTheQueueAndResumesWithOpenRows) {
    const std::string dir = tempDir();
    std::atomic<int64_t> freeB{1000};
    ServiceOptions o = fast(dir);
    o.minFreeBytes = 5000;
    o.freeBytes = [&] { return freeB.load(); };
    AlarmService s(o);
    std::string err;
    ASSERT_TRUE(s.start(err));
    s.push({stateEvent(row(1, false)), stateEvent(row(2, true))});
    ASSERT_TRUE(waitFor([&] { return s.logState() == LogState::Paused; }, 2000));
    std::this_thread::sleep_for(milliseconds(300));
    EXPECT_EQ(s.commits(), 0u);  // no history written
    EXPECT_GE(s.queued(), 2u);   // and nothing thrown away
    freeB = 5200;                // above the minimum but not minimum * 1.1 (5500): still paused
    std::this_thread::sleep_for(milliseconds(300));
    EXPECT_EQ(s.logState(), LogState::Paused);
    freeB = 6000;
    ASSERT_TRUE(waitFor([&] { return s.logState() == LogState::Running && s.commits() >= 1; }, 3000));
    ASSERT_TRUE(s.flush(3000));
    s.stop();
    AlarmStore st(dir, [] { return kNow; });
    ASSERT_TRUE(st.open(err));
    EXPECT_EQ(st.countRows(), 2);
}

TEST(AlarmService, StopFlushesAndMarksTheFileClean) {
    const std::string dir = tempDir();
    ServiceOptions o = fast(dir);
    o.commitMs = 600000;
    o.commitMaxMs = 600000;
    AlarmService s(o);
    std::string err;
    ASSERT_TRUE(s.start(err));
    s.push({stateEvent(row(1)), stateEvent(row(2))});
    s.stop();  // writes what is queued
    AlarmStore st(dir, [] { return kNow; });
    ASSERT_TRUE(st.open(err));
    EXPECT_EQ(st.countRows(), 2);
    EXPECT_EQ(st.getMeta("high_water").value_or(""), "2");
    s.stop();  // a second stop is harmless
}

TEST(AlarmService, LoadContextComesFromTheFile) {
    const std::string dir = tempDir();
    {
        AlarmService s(fast(dir));
        std::string err;
        ASSERT_TRUE(s.start(err));
        AlarmEvent dis;
        dis.kind = AlarmEvent::Kind::Disable;
        dis.instance = "X";
        dis.user = "eng";
        dis.reason = "hỏng";
        dis.tEpoch = kNow;
        s.push({stateEvent(row(5, false)), stateEvent(row(9, true)), dis});
        ASSERT_TRUE(s.flush(3000));
        s.stop();
    }
    AlarmService s2(fast(dir));
    std::string err;
    ASSERT_TRUE(s2.start(err));
    LoadContext ctx = s2.loadContext(111, kNow + 5, true, true);
    EXPECT_EQ(ctx.nowMonoMs, 111);
    EXPECT_EQ(ctx.nowEpochMs, kNow + 5);
    EXPECT_TRUE(ctx.processStart);
    ASSERT_EQ(ctx.open.size(), 1u);
    EXPECT_EQ(ctx.open[0].id, 5);
    ASSERT_EQ(ctx.overrides.size(), 1u);
    EXPECT_EQ(ctx.overrides[0].kind, "disable");
    EXPECT_EQ(ctx.nextOccurrence, 10);
    s2.stop();
}

TEST(AlarmService, EventsBecomeOverrideChanges) {
    const std::string dir = tempDir();
    AlarmService s(fast(dir));
    std::string err;
    ASSERT_TRUE(s.start(err));
    auto ev = [](AlarmEvent::Kind k, const std::string& id) {
        AlarmEvent e;
        e.kind = k;
        e.instance = id;
        e.user = "op1";
        e.reason = "r";
        e.tEpoch = kNow;
        e.untilEpochMs = kNow + 60000;
        return e;
    };
    s.push({ev(AlarmEvent::Kind::Shelve, "A"), ev(AlarmEvent::Kind::Disable, "A"), ev(AlarmEvent::Kind::Shelve, "B"),
            ev(AlarmEvent::Kind::Shelve, "C")});
    ASSERT_TRUE(s.flush(3000));
    s.push({ev(AlarmEvent::Kind::Unshelve, "B"), ev(AlarmEvent::Kind::Removed, "C")});
    ASSERT_TRUE(s.flush(3000));
    s.stop();
    AlarmStore st(dir, [] { return kNow; });
    ASSERT_TRUE(st.open(err));
    auto ov = st.loadOverrides(err);
    ASSERT_EQ(ov.size(), 2u);  // (A shelve) and (A disable); B unshelved, C removed
    s.stop();
    AlarmService s2(fast(dir));
    ASSERT_TRUE(s2.start(err));
    AlarmEvent en;
    en.kind = AlarmEvent::Kind::Enable;
    en.instance = "A";
    s2.push({en});
    ASSERT_TRUE(s2.flush(3000));
    s2.stop();
    AlarmStore st2(dir, [] { return kNow; });
    ASSERT_TRUE(st2.open(err));
    ov = st2.loadOverrides(err);
    ASSERT_EQ(ov.size(), 1u);
    EXPECT_EQ(ov[0].kind, "shelve");
}

TEST(AlarmService, SystemShelveAndUnshelveGoToAuditAfterTheCommit) {
    const std::string dir = tempDir();
    Audit audit;
    AlarmService s(fast(dir, &audit));
    std::string err;
    ASSERT_TRUE(s.start(err));
    AlarmEvent sh;
    sh.kind = AlarmEvent::Kind::Shelve;
    sh.instance = "A";
    sh.system = true;
    sh.user = "system";
    sh.reason = "chatter";
    sh.tEpoch = kNow;
    sh.untilEpochMs = kNow + 1800000;
    sh.count = 5;
    AlarmEvent un;
    un.kind = AlarmEvent::Kind::Unshelve;
    un.instance = "A";
    un.system = true;
    un.reason = "chatter-end";
    un.count = 17;
    AlarmEvent userShelve = sh;  // a user's shelve is audited by the API, not here
    userShelve.system = false;
    userShelve.instance = "B";
    s.push({sh, userShelve});
    ASSERT_TRUE(s.flush(3000));
    s.push({un});
    ASSERT_TRUE(s.flush(3000));
    auto lines = audit.get();
    ASSERT_EQ(lines.size(), 2u);
    EXPECT_EQ(lines[0].action, "alarm.shelve");
    EXPECT_EQ(lines[0].target, "A");
    auto d = nlohmann::json::parse(lines[0].detail);
    EXPECT_EQ(d["reason"], "chatter");
    EXPECT_EQ(d["durationS"], 1800);
    EXPECT_EQ(d["count"], 5);
    EXPECT_EQ(lines[1].action, "alarm.unshelve");
    auto d2 = nlohmann::json::parse(lines[1].detail);
    EXPECT_EQ(d2["reason"], "chatter-end");
    EXPECT_EQ(d2["count"], 17);
    s.stop();
}

TEST(AlarmService, PurgeByRetentionRunsInTheWriterAndIsAudited) {
    const std::string dir = tempDir();
    std::string err;
    {
        AlarmStore pre(dir, [] { return kNow; });
        ASSERT_TRUE(pre.open(err));
        std::vector<OccurrenceRow> rows;
        const int64_t old = kNow - 400LL * 86400000;
        for (int i = 1; i <= 30; ++i) rows.push_back(row(i, true, "A", old));
        rows.push_back(row(31, true, "A", kNow));
        ASSERT_TRUE(pre.commit(rows, {}, {}, err));
        pre.close();
    }
    Audit audit;
    ServiceOptions o = fast(dir, &audit);
    o.retentionDays = 180;
    o.purgeIntervalS = 1;
    AlarmService s(o);
    ASSERT_TRUE(s.start(err));
    ASSERT_TRUE(waitFor([&] { return !audit.get().empty(); }, 5000));
    auto lines = audit.get();
    EXPECT_EQ(lines[0].action, "alarm.purged");
    EXPECT_EQ(lines[0].target, "alarm.db");
    auto d = nlohmann::json::parse(lines[0].detail);
    EXPECT_EQ(d["reason"], "retention");
    EXPECT_EQ(d["rows"], 30);
    s.stop();
    AlarmStore st(dir, [] { return kNow; });
    ASSERT_TRUE(st.open(err));
    EXPECT_EQ(st.countRows(), 1);
    EXPECT_EQ(st.nextOccurrence(), 32);
}

TEST(AlarmService, NoPurgeWithoutAValidClock) {
    const std::string dir = tempDir();
    std::string err;
    {
        AlarmStore pre(dir, [] { return kNow; });
        ASSERT_TRUE(pre.open(err));
        ASSERT_TRUE(pre.commit({row(1, true, "A", kNow - 400LL * 86400000)}, {}, {}, err));
        pre.close();
    }
    Audit audit;
    ServiceOptions o = fast(dir, &audit);
    o.purgeIntervalS = 1;
    o.clockOk = [](int64_t) { return false; };
    AlarmService s(o);
    ASSERT_TRUE(s.start(err));
    std::this_thread::sleep_for(milliseconds(2500));
    EXPECT_TRUE(audit.get().empty());
    s.stop();
    AlarmStore st(dir, [] { return kNow; });
    ASSERT_TRUE(st.open(err));
    EXPECT_EQ(st.countRows(), 1);
}

TEST(AlarmService, DamagedFileAtStartIsRenamedAuditedAndTheServiceRuns) {
    const std::string dir = tempDir();
    std::ofstream(dir + "/alarm.db") << "garbage garbage garbage garbage garbage garbage garbage";
    Audit audit;
    AlarmService s(fast(dir, &audit));
    std::string err;
    ASSERT_TRUE(s.start(err)) << err;
    EXPECT_TRUE(s.recovered());
    auto lines = audit.get();
    ASSERT_GE(lines.size(), 1u);
    EXPECT_EQ(lines[0].action, "alarm.purged");
    EXPECT_EQ(lines[0].code, "DB_CORRUPT");
    auto d = nlohmann::json::parse(lines[0].detail);
    EXPECT_EQ(d["reason"], "corrupt");
    EXPECT_NE(d["renamedTo"].get<std::string>().find("alarm.db.corrupt-"), std::string::npos);
    s.push({stateEvent(row(1))});
    ASSERT_TRUE(s.flush(3000));
    EXPECT_EQ(s.logState(), LogState::Running);
    s.stop();
}

TEST(AlarmService, NewerSchemaMeansErrorStateAndTheEngineRunsInRam) {
    const std::string dir = tempDir();
    std::string err;
    {
        AlarmStore pre(dir, [] { return kNow; });
        ASSERT_TRUE(pre.open(err));
        ASSERT_TRUE(pre.setMeta("schema", "99", err));
        pre.close();
    }
    AlarmService s(fast(dir));
    EXPECT_FALSE(s.start(err));
    EXPECT_EQ(s.logState(), LogState::Error);
    s.push({stateEvent(row(1))});  // harmless
    LoadContext ctx = s.loadContext(0, kNow, true, true);
    EXPECT_TRUE(ctx.open.empty());
    s.stop();
}

TEST(AlarmService, StopsCleanlyWhileBusy) {
    const std::string dir = tempDir();
    ServiceOptions o = fast(dir);
    o.testCommitDelayMs = 100;
    AlarmService s(o);
    std::string err;
    ASSERT_TRUE(s.start(err));
    for (int i = 1; i <= 50; ++i) s.push({stateEvent(row(i))});
    s.stop();
    AlarmStore st(dir, [] { return kNow; });
    ASSERT_TRUE(st.open(err));
    EXPECT_EQ(st.countRows(), 50);
}
