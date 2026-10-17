// Writes from logic (T129; SC-027; FR-078 to FR-083; Constitution 2.0.2 principle V): the logic
// subsystem over the real WriteCoordinator with a fake driver, a fake audit and a fake pulse
// journal that record the order of what happens. Under test: the durable audit record exists BEFORE
// anything is sent, under actor logic:<ruleId> and channel logic with at most 8 inputs of the
// condition; the checks of 006 apply unchanged (link, limits of the Tag, queue); minIntervalMs,
// maxPerHour and logic.maxWritesPerMin refuse with RATE_LIMITED, the rule turns THROTTLED, the
// audit coalesces and the warning shows; logic.writes off sends nothing and audits suppressed; the
// stop of an administrator holds over a restart; a pulse goes through the pulse journal; the edge
// of a command is durable before the command; a damaged retain store warns and audits once.
#include <gtest/gtest.h>
#include <sys/stat.h>
#include <unistd.h>

#include <atomic>
#include <fstream>
#include <future>
#include <sstream>
#include <thread>

#include "core/audit/audit_log.hpp"
#include "core/auth/tests/auth_test_support.hpp"
#include "core/tag-engine/tests/write_fakes.hpp"
#include "server/logic_glue.hpp"
#include "server/tests/logic_fakes.hpp"
#include "server/write_glue.hpp"

using namespace mat;
using namespace mat::testing;
using nlohmann::json;

namespace {

struct FakePulseLog : PulseLog {
    explicit FakePulseLog(Events& e) : ev(e) {}
    bool arm(PulseArm a, std::string&) override {
        std::lock_guard<std::mutex> g(mu);
        ev.add("arm:" + a.rid);
        arms.push_back(a);
        return true;
    }
    bool done(const std::string& rid, std::string&) override {
        ev.add("done:" + rid);
        return true;
    }
    std::mutex mu;
    Events& ev;
    std::vector<PulseArm> arms;
};

const json kWRun = {{"id", "w_run"},
                    {"tag", "RUN"},
                    {"allowed", {{"values", {true, false}}}},
                    {"minIntervalMs", 1000},
                    {"maxPerHour", 100}};
const json kWSp = {{"id", "w_sp"},
                   {"tag", "SP"},
                   {"allowed", {{"min", 0}, {"max", 100}}},
                   {"minIntervalMs", 1000},
                   {"maxPerHour", 100}};

json docWith(json rules, json writes = json::array({kWRun, kWSp})) {
    return {{"schemaVersion", "1.0.0"}, {"writes", std::move(writes)}, {"rules", std::move(rules)}};
}
json lowRule(json onRise = json::array({{{"do", "write"}, {"write", "w_run"}, {"value", true}}}),
             const char* when = "LEVEL_R < 20") {
    return {{"id", "r_low"}, {"when", when}, {"onRise", std::move(onRise)}};
}

struct Rig {
    explicit Rig(json doc, LogicOptions o = {}, const logic::RetainMap& retain = {},
                 bool lost = false, PulseLog* pulse = nullptr)
        : model(logicModel()), backend(ev), audit(ev), round(model) {
        addModelTagsToStore(model, store);
        CoordinatorOptions co;
        co.monoMs = [this] { return mono.load(); };
        co.wallMs = [this] { return wall.load(); };
        co.clockSynced = [](int64_t) { return true; };
        co.log = [](const std::string&) {};
        co.pulseLog = pulse;
        coord = std::make_unique<WriteCoordinator>(model, store, backend, audit, co);
        o.monoMs = [this] { return mono.load(); };
        o.wallMs = [this] { return wall.load(); };
        o.timeSynced = [] { return true; };
        o.warnings = &warnings;
        o.audit = [this](const AuditEvent& e) {
            if (auditDown) throw std::runtime_error("audit down");
            std::lock_guard<std::mutex> g(mu);
            events.push_back(e);
        };
        o.log = [](const std::string&) {};
        o.resultPollMs = 10;
        logic = std::make_unique<LogicSubsystem>(model, doc, o, retain, lost);
        logic->setCoordinator(coord.get());
    }
    ~Rig() {
        logic.reset();
        coord.reset();
    }
    size_t idx(const std::string& id) { return *model.tagIndex(id); }
    // A scan at monotonic time `t` (ms) over the current values.
    void scan(int64_t t) {
        mono = t;
        round.t = t;
        logic->round(round);
        logic->waitIdle();
    }
    size_t count(const char* action) {
        std::lock_guard<std::mutex> g(mu);
        size_t n = 0;
        for (const auto& e : events)
            if (std::string(auditActionName(e.action)) == action) ++n;
        return n;
    }
    bool warned(const std::string& code) {
        for (const auto& w : warnings.list())
            if (w.code == code) return true;
        return false;
    }
    json block(const std::string& id) {
        const json st = logic->status();
        for (const auto& b : st["blocks"])
            if (b["id"] == id) return b;
        return nullptr;
    }

    Events ev;
    ProjectModel model;
    TagStore store;
    FakeBackend backend;
    FakeAudit audit;
    FakeRound round;
    std::atomic<int64_t> mono{0};
    std::atomic<int64_t> wall{1791600000000LL};
    SystemWarnings warnings{[] { return int64_t{1791600000000LL}; }};
    std::mutex mu;
    std::atomic<bool> auditDown{false};
    std::vector<AuditEvent> events;
    std::unique_ptr<WriteCoordinator> coord;
    std::unique_ptr<LogicSubsystem> logic;
};

LogicOptions on() {
    LogicOptions o;
    o.writes = "on";
    return o;
}

// The rule fires on LEVEL_R falling below 20.
void fall(Rig& r, int64_t at, double from = 50, double to = 10) {
    r.round.good(r.idx("LEVEL_R"), from);
    r.scan(at);
    r.round.good(r.idx("LEVEL_R"), to);
    r.scan(at + 100);
}

}  // namespace

TEST(LogicWrite, TheDurableAuditRecordComesBeforeAnythingIsSent) {
    Rig r(docWith(json::array({lowRule()})), on());
    fall(r, 0);
    ASSERT_EQ(r.backend.count(), 1u);
    ASSERT_EQ(r.audit.startedRecs.size(), 1u);
    const std::string rid = r.audit.startedRecs[0].requestId;
    const int started = r.ev.indexOf("started:" + rid);
    const int sent = r.ev.indexOf("submit:");
    ASSERT_GE(started, 0);
    ASSERT_GE(sent, 0);
    EXPECT_LT(started, sent) << "audit record of receipt before the driver";
    EXPECT_EQ(r.backend.sent[0].first, r.idx("RUN"));
    EXPECT_EQ(std::get<bool>(r.backend.cmd(0).raw), true);
}

TEST(LogicWrite, ActorIsLogicRuleChannelLogicWithAtMost8Inputs) {
    const char* when =
        "LEVEL_R < 20 && CNT < 100 && BIG < 5 && SP < 100 && FLT32 < 1 && DEV2 < 1 && "
        "SCALED < 1 && INT_SET < 50 && SIM_MAN < 1";
    Rig r(docWith(json::array({lowRule(
              json::array({{{"do", "write"}, {"write", "w_run"}, {"value", true}}}), when)})),
          on());
    for (const char* t : {"CNT", "BIG", "SP", "FLT32", "DEV2", "SCALED", "INT_SET", "SIM_MAN"})
        r.round.good(r.idx(t), 0.0);
    fall(r, 0);
    ASSERT_EQ(r.audit.startedRecs.size(), 1u);
    const WriteRecord& rec = r.audit.startedRecs[0];
    EXPECT_EQ(rec.who.user, "logic:r_low");
    EXPECT_EQ(rec.who.channel, "logic");
    EXPECT_EQ(rec.who.role, "logic");
    EXPECT_EQ(rec.origin, "logic");
    const json d = json::parse(rec.logicJson);
    EXPECT_EQ(d["rule"], "r_low");
    EXPECT_EQ(d["write"], "w_run");
    EXPECT_EQ(d["edgeId"], 1);
    ASSERT_TRUE(d["inputs"].is_array());
    EXPECT_EQ(d["inputs"].size(), kLogicMaxInputs) << d.dump();
    EXPECT_EQ(d["inputs"][0], json::array({"LEVEL_R", 10.0}));
    EXPECT_EQ(rec.newJson, "true");
}

TEST(LogicWrite, TheChecksOf006ApplyUnchanged) {
    // the link
    {
        Rig r(docWith(json::array({lowRule()})), on());
        r.backend.state = {drv::ChannelState::Connecting, drv::DeviceState::Active};
        fall(r, 0);
        EXPECT_EQ(r.backend.count(), 0u);
        EXPECT_EQ(r.block("r_low")["lastError"], "REJECTED");
        EXPECT_EQ(r.block("r_low")["lastErrorCode"], "CONNECTION_BAD");
    }
    // the limits of the Tag (SP 0..90; `allowed` of the rule 0..100)
    {
        Rig r(docWith(json::array(
                  {lowRule(json::array({{{"do", "write"}, {"write", "w_sp"}, {"value", 95}}}))})),
              on());
        fall(r, 0);
        EXPECT_EQ(r.backend.count(), 0u);
        EXPECT_EQ(r.block("r_low")["lastErrorCode"], "OUT_OF_LIMITS");
        ASSERT_EQ(r.audit.deniedRecs.size(), 1u);
        EXPECT_EQ(r.audit.deniedRecs[0].user, "logic:r_low");
    }
    // the queue
    {
        Rig r(docWith(json::array({lowRule()})), on());
        r.backend.full = true;
        fall(r, 0);
        EXPECT_EQ(r.backend.count(), 0u);
        EXPECT_EQ(r.block("r_low")["lastError"], "FAILED");
        EXPECT_EQ(r.block("r_low")["lastErrorCode"], "NOT_SENT_QUEUE_FULL");
    }
}

TEST(LogicWrite, MinIntervalRateLimitsThrottlesAuditsCoalescedAndWarns) {
    json w = kWRun;
    w["minIntervalMs"] = 5000;
    Rig r(docWith(json::array({lowRule()}), json::array({w})), on());
    fall(r, 0);
    fall(r, 1000);
    fall(r, 2000);
    EXPECT_EQ(r.backend.count(), 1u);
    EXPECT_EQ(r.block("r_low")["state"], "THROTTLED");
    EXPECT_EQ(r.count("logic.throttled"), 2u) << "one event per refusal; the log coalesces them";
    EXPECT_TRUE(r.warned("LOGIC_THROTTLED"));
    // 60 s after the last refusal: OK and the warning ends
    r.round.good(r.idx("LEVEL_R"), 10.0);
    r.scan(2100 + 60000);
    EXPECT_EQ(r.block("r_low")["state"], "OK");
    EXPECT_FALSE(r.warned("LOGIC_THROTTLED"));
}

TEST(LogicWrite, MaxPerHourAndTheDeviceWideBudget) {
    json w = kWRun;
    w["maxPerHour"] = 2;
    Rig r(docWith(json::array({lowRule()}), json::array({w})), on());
    for (int i = 0; i < 4; ++i) fall(r, i * 2000);
    EXPECT_EQ(r.backend.count(), 2u);
    EXPECT_EQ(r.block("r_low")["lastError"], "RATE_LIMITED");

    LogicOptions o = on();
    o.maxWritesPerMin = 1;
    json rules = json::array(
        {lowRule(),
         {{"id", "r_two"},
          {"when", "LEVEL_R < 20"},
          {"onRise", json::array({{{"do", "write"}, {"write", "w_sp"}, {"value", 5}}})}}});
    Rig b(docWith(rules), o);
    fall(b, 0);
    EXPECT_EQ(b.backend.count(), 1u) << "logic.maxWritesPerMin 1";
    EXPECT_EQ(b.block("r_two")["lastError"], "RATE_LIMITED");
}

TEST(LogicWrite, WritesOffSendsNothingAndAuditsSuppressed) {
    LogicOptions o;
    o.writes = "off";
    Rig r(docWith(json::array({lowRule()})), o);
    fall(r, 0);
    fall(r, 2000);
    EXPECT_EQ(r.backend.count(), 0u);
    EXPECT_TRUE(r.audit.startedRecs.empty());
    EXPECT_EQ(r.count("logic.write.suppressed"), 2u);
    EXPECT_TRUE(r.warned("LOGIC_WRITES_OFF"));
    EXPECT_EQ(r.logic->writesState(), "off");
    EXPECT_EQ(r.logic->status()["writes"]["configured"], "off");
    EXPECT_EQ(r.logic->status()["writes"]["runtimeEnabled"], false);
}

TEST(LogicWrite, TheStopOfAnAdministratorHoldsOverARestart) {
    mat::test::TempDir dir;
    LogicOptions o = on();
    o.statePath = dir.file(kLogicStateFile);
    WriteCaller admin;
    admin.user = "quanly";
    admin.role = "administrator";
    admin.source = "10.0.0.9:50000";
    {
        Rig r(docWith(json::array({lowRule()})), o);
        EXPECT_EQ(r.logic->writesState(), "on");
        std::string code;
        ASSERT_TRUE(r.logic->stopWrites(admin, code)) << code;
        EXPECT_EQ(r.logic->writesState(), "stopped");
        EXPECT_EQ(r.count("logic.writes.disabled"), 1u);
        EXPECT_TRUE(r.warned("LOGIC_WRITES_OFF"));
        fall(r, 0);
        EXPECT_EQ(r.backend.count(), 0u);
    }
    std::ifstream f(o.statePath);
    std::stringstream ss;
    ss << f.rdbuf();
    const json st = json::parse(ss.str());
    EXPECT_EQ(st["writesStopped"], true);
    EXPECT_EQ(st["stoppedBy"], "quanly");
    {
        Rig r(docWith(json::array({lowRule()})), o);  // the runtime again
        EXPECT_EQ(r.logic->writesState(), "stopped");
        fall(r, 0);
        EXPECT_EQ(r.backend.count(), 0u);
        EXPECT_EQ(r.count("logic.write.suppressed"), 1u);
    }
}

// Follow-up of T137 (device-api-011 §7): root clears the stop with `mat-runtime
// --logic-writes-reset`, which leaves <dataDir>/logic-writes-reset.req. The runtime takes it at
// start, or within 5 s while it runs (applyWritesReset() is what the dispatcher calls):
// writesStopped false in logic-state.json (the edges kept), the request deleted, audit
// logic.writes.enabled, LOGIC_WRITES_OFF cleared when logic.writes is "on". A symbolic link in its
// place is deleted, never followed.
TEST(LogicWrite, RootClearsTheStopWithARequestFile) {
    const auto pathExists = [](const std::string& p) {
        struct stat st {};
        return ::lstat(p.c_str(), &st) == 0;
    };
    EXPECT_STREQ(kLogicWritesResetFile, "logic-writes-reset.req")
        << "the file of the CLI (users.cpp)";
    mat::test::TempDir dir;
    LogicOptions o = on();
    o.statePath = dir.file(kLogicStateFile);
    o.writesResetRequestPath = dir.file(kLogicWritesResetFile);
    o.writesResetUid = ::getuid();  // root on the device
    WriteCaller admin;
    admin.user = "quanly";
    admin.role = "administrator";
    {
        Rig r(docWith(json::array({lowRule()})), o);
        std::string code;
        ASSERT_TRUE(r.logic->stopWrites(admin, code)) << code;
        fall(r, 0);
        EXPECT_EQ(r.backend.count(), 0u);
        EXPECT_FALSE(r.logic->applyWritesReset()) << "no request: nothing changes";
        EXPECT_EQ(r.logic->writesState(), "stopped");
        // A link in place of the request is removed, not followed.
        mat::test::writeFile(dir.file("elsewhere"), "x", 0600);
        ASSERT_EQ(::symlink(dir.file("elsewhere").c_str(), o.writesResetRequestPath.c_str()), 0);
        EXPECT_FALSE(r.logic->applyWritesReset());
        EXPECT_EQ(r.logic->writesState(), "stopped");
        EXPECT_FALSE(pathExists(o.writesResetRequestPath));
        EXPECT_TRUE(pathExists(dir.file("elsewhere")));
        // The request while running.
        mat::test::writeFile(o.writesResetRequestPath, "logic-writes-reset\n", 0600);
        EXPECT_TRUE(r.logic->applyWritesReset());
        EXPECT_EQ(r.logic->writesState(), "on");
        EXPECT_FALSE(pathExists(o.writesResetRequestPath));
        EXPECT_EQ(r.count("logic.writes.enabled"), 1u);
        EXPECT_FALSE(r.warned("LOGIC_WRITES_OFF"));
        fall(r, 10000);
        EXPECT_EQ(r.backend.count(), 1u) << "the rule writes again";
    }
    std::ifstream f(o.statePath);
    std::stringstream ss;
    ss << f.rdbuf();
    const json st = json::parse(ss.str());
    EXPECT_EQ(st["writesStopped"], false);
    EXPECT_GE(st["edges"]["r_low"].get<int64_t>(), 1) << "the edges are kept";
    // At start: a request left while the runtime was down is taken before the first scan.
    {
        Rig r(docWith(json::array({lowRule()})), o);
        std::string code;
        ASSERT_TRUE(r.logic->stopWrites(admin, code)) << code;
    }
    mat::test::writeFile(o.writesResetRequestPath, "logic-writes-reset\n", 0600);
    Rig r(docWith(json::array({lowRule()})), o);
    EXPECT_EQ(r.logic->writesState(), "on");
    EXPECT_FALSE(pathExists(o.writesResetRequestPath));
    EXPECT_EQ(r.count("logic.writes.enabled"), 1u);
}

TEST(LogicWrite, APulseGoesThroughThePulseJournalBeforeTheBitIsSet) {
    auto doc = docWith(json::array({lowRule(
        json::array({{{"do", "pulse"}, {"write", "w_run"}, {"value", true}, {"ms", 500}}}))}));
    Events journalEv;
    FakePulseLog journal(journalEv);
    Rig r(doc, on(), {}, false, &journal);
    fall(r, 0);
    ASSERT_EQ(journal.arms.size(), 1u);
    EXPECT_EQ(journal.arms[0].src, "logic");
    EXPECT_EQ(journal.arms[0].by, "logic:r_low");
    EXPECT_EQ(journal.arms[0].tag, "RUN");
    ASSERT_GE(r.backend.count(), 1u);
    EXPECT_EQ(r.audit.startedRecs.at(0).pulseMs, 500);
}

TEST(LogicWrite, TheEdgeOfACommandIsDurableBeforeTheCommand) {
    mat::test::TempDir dir;
    LogicOptions o = on();
    o.statePath = dir.file(kLogicStateFile);
    {
        Rig r(docWith(json::array({lowRule()})), o);
        fall(r, 0);
        ASSERT_EQ(r.backend.count(), 1u);
        std::ifstream f(o.statePath);
        std::stringstream ss;
        ss << f.rdbuf();
        EXPECT_EQ(json::parse(ss.str())["edges"]["r_low"], 1);
    }
    // a restart whose retain store never got the edge (kill -9 before the flush): the next edge
    // is 2, never 1 again
    Rig r(docWith(json::array({lowRule()})), o);
    fall(r, 10000);
    ASSERT_EQ(r.audit.startedRecs.size(), 1u);
    EXPECT_EQ(json::parse(r.audit.startedRecs[0].logicJson)["edgeId"], 2);
}

TEST(LogicWrite, ADamagedRetainStoreWarnsAndAuditsOnce) {
    Rig r(docWith(json::array({lowRule()})), on(), {}, true);
    EXPECT_TRUE(r.logic->retainLost());
    EXPECT_TRUE(r.warned("LOGIC_RETAIN_LOST"));
    fall(r, 0);
    fall(r, 2000);
    EXPECT_EQ(r.count("logic.retain.lost"), 1u);
}

// The adapter of the runtime on a real audit.db: the record of a logic write is logic.write on
// the channel logic, under logic:<ruleId>, with the rule, the inputs and detail.source logic.
TEST(LogicWrite, TheAuditRowOfALogicWrite) {
    mat::test::TempDir dir;
    AuditOptions ao;
    ao.dataDir = dir.path();
    ao.bootId = "boot-1";
    AuditLog log(ao);
    std::string err;
    ASSERT_TRUE(log.open(err)) << err;
    AuditLogWriteAudit adapter(log);
    WriteRecord rec;
    rec.requestId = idN(7);
    rec.who.user = "logic:r_low";
    rec.who.role = "logic";
    rec.who.source = "logic";
    rec.who.channel = "logic";
    rec.tag = "RUN";
    rec.kind = "external";
    rec.oldJson = R"({"value":false,"quality":"GOOD"})";
    rec.newJson = "true";
    rec.origin = "logic";
    rec.logicJson = R"({"rule":"r_low","write":"w_run","edgeId":1,"inputs":[["LEVEL_R",10]]})";
    adapter.started(rec);
    WriteOutcome out;
    out.result = "ok";
    out.code = "CONFIRMED";
    adapter.finished(rec, out);
    AuditQuery q;
    const AuditPage page = log.query(q);
    ASSERT_EQ(page.records.size(), 2u);
    for (const AuditRecord& a : page.records) {
        EXPECT_EQ(a.action, "logic.write");
        EXPECT_EQ(a.channel, "logic");
        EXPECT_EQ(a.user.value_or(""), "logic:r_low");
        const json d = json::parse(a.detail.value_or("{}"));
        EXPECT_EQ(d["source"], "logic");
        EXPECT_EQ(d["rule"], "r_low");
        EXPECT_EQ(d["inputs"][0][0], "LEVEL_R");
    }
    ASSERT_TRUE(log.findTagWrite(idN(7)).has_value()) << "the table of request ids keeps it";
}

// ================= T062: security review of 011 =================

namespace {

WriteCaller adminCaller() {
    WriteCaller admin;
    admin.user = "quanly";
    admin.role = "administrator";
    admin.source = "10.0.0.9:50000";
    return admin;
}

// A scan without waiting for the dispatcher.
void scanNoWait(Rig& r, int64_t t) {
    r.mono = t;
    r.round.t = t;
    r.logic->round(r.round);
}

json spRule() {
    return {{"id", "r_sp"},
            {"when", "LEVEL_R < 20"},
            {"onRise", json::array({{{"do", "write"}, {"write", "w_sp"}, {"value", 50}}})}};
}

bool exists(const std::string& p) {
    struct stat st {};
    return ::lstat(p.c_str(), &st) == 0;
}

}  // namespace

TEST(LogicWrite, TheStopOfAnAdministratorAlsoHoldsTheCommandsAlreadyQueued) {
    // two rules fire in one scan; the first command is in the coordinator (its audit record is
    // being written) when the administrator stops: the second, still queued, is never sent
    Rig r(docWith(json::array({lowRule(), spRule()})), on());
    std::promise<void> entered, release;
    std::shared_future<void> released = release.get_future().share();
    std::atomic<int> calls{0};
    r.audit.onStarted = [&](const WriteRecord&) {
        if (calls++ == 0) {
            entered.set_value();
            released.wait();
        }
    };
    r.round.good(r.idx("LEVEL_R"), 50.0);
    scanNoWait(r, 0);
    r.round.good(r.idx("LEVEL_R"), 10.0);
    scanNoWait(r, 100);
    ASSERT_EQ(entered.get_future().wait_for(std::chrono::seconds(5)), std::future_status::ready);
    std::string code;
    ASSERT_TRUE(r.logic->stopWrites(adminCaller(), code)) << code;
    release.set_value();
    r.logic->waitIdle();
    EXPECT_EQ(r.backend.count(), 1u) << "only the command already in the coordinator";
    EXPECT_EQ(r.audit.startedRecs.size(), 1u);
    EXPECT_GE(r.count("logic.write.suppressed"), 1u);
    EXPECT_EQ(r.logic->writesState(), "stopped");
}

TEST(LogicWrite, WritingTheStateFileNeverHoldsUpTheRound) {
    // the fsync of logic-state.json under the mutex of the engine held up the Tag Engine round
    mat::test::TempDir dir;
    LogicOptions o = on();
    o.statePath = dir.file(kLogicStateFile);
    std::promise<void> entered, release;
    std::shared_future<void> released = release.get_future().share();
    std::atomic<int> calls{0};
    o.writeState = [&](const std::string&, const std::string&, std::string&) {
        if (calls++ == 0) {
            entered.set_value();
            released.wait();  // a slow eMMC
        }
        return true;
    };
    Rig r(docWith(json::array({lowRule()})), o);
    r.round.good(r.idx("LEVEL_R"), 50.0);
    scanNoWait(r, 0);
    r.round.good(r.idx("LEVEL_R"), 10.0);
    scanNoWait(r, 100);  // the edge goes to the dispatcher, which writes the state file
    ASSERT_EQ(entered.get_future().wait_for(std::chrono::seconds(5)), std::future_status::ready);
    auto next = std::async(std::launch::async, [&] {
        for (int64_t t = 200; t <= 1000; t += 100) scanNoWait(r, t);
        (void)r.logic->status();
        (void)r.logic->writesState();
    });
    const auto st = next.wait_for(std::chrono::seconds(3));
    release.set_value();
    EXPECT_EQ(st, std::future_status::ready) << "the rounds waited for the state file";
    next.wait();
    r.logic->waitIdle();
    EXPECT_EQ(r.backend.count(), 1u);
}

TEST(LogicWrite, AStateFileThatIsThereButUnreadableStartsWithTheWritesStopped) {
    // a damaged logic-state.json was taken as absent: an administrator stop vanished
    for (const char* text : {R"({"writesStopped": tr)", "[1,2]", R"({"writesStopped": "yes"})"}) {
        SCOPED_TRACE(text);
        mat::test::TempDir dir;
        LogicOptions o = on();
        o.statePath = dir.file(kLogicStateFile);
        o.writesResetRequestPath = dir.file(kLogicWritesResetFile);
        o.writesResetUid = ::getuid();
        mat::test::writeFile(o.statePath, text, 0600);
        Rig r(docWith(json::array({lowRule()})), o);
        EXPECT_EQ(r.logic->writesState(), "stopped");
        bool reason = false;
        for (const auto& w : r.warnings.list())
            if (w.code == "LOGIC_WRITES_OFF")
                reason = w.detail.is_object() && w.detail.contains("reason") &&
                         w.detail["reason"] == "STATE_UNREADABLE";
        EXPECT_TRUE(reason) << "LOGIC_WRITES_OFF tells why";
        EXPECT_EQ(r.count("logic.writes.disabled"), 1u);
        fall(r, 0);
        EXPECT_EQ(r.backend.count(), 0u);
        // only root clears it
        mat::test::writeFile(o.writesResetRequestPath, "logic-writes-reset\n", 0600);
        EXPECT_TRUE(r.logic->applyWritesReset());
        EXPECT_EQ(r.logic->writesState(), "on");
        fall(r, 10000);
        EXPECT_EQ(r.backend.count(), 1u);
    }
    // absent: a first start, nothing stopped
    mat::test::TempDir dir;
    LogicOptions o = on();
    o.statePath = dir.file(kLogicStateFile);
    Rig r(docWith(json::array({lowRule()})), o);
    EXPECT_EQ(r.logic->writesState(), "on");
}

TEST(LogicWrite, ARequestOfAnotherOwnerOrThatOthersMayReadIsDeletedAndIgnored) {
    for (const bool otherOwner : {true, false}) {
        SCOPED_TRACE(otherOwner ? "another owner" : "mode 0644");
        mat::test::TempDir dir;
        LogicOptions o = on();
        o.statePath = dir.file(kLogicStateFile);
        o.writesResetRequestPath = dir.file(kLogicWritesResetFile);
        o.writesResetUid = otherOwner ? ::getuid() + 1 : ::getuid();  // root on the device
        Rig r(docWith(json::array({lowRule()})), o);
        std::string code;
        ASSERT_TRUE(r.logic->stopWrites(adminCaller(), code)) << code;
        mat::test::writeFile(o.writesResetRequestPath, "logic-writes-reset\n", 0600);
        if (!otherOwner) ASSERT_EQ(::chmod(o.writesResetRequestPath.c_str(), 0644), 0);
        EXPECT_FALSE(r.logic->applyWritesReset());
        EXPECT_EQ(r.logic->writesState(), "stopped");
        EXPECT_FALSE(exists(o.writesResetRequestPath)) << "deleted";
        EXPECT_EQ(r.count("logic.writes.enabled"), 0u);
    }
}

TEST(LogicWrite, TheResetIsAuditedBeforeItIsAppliedOrNotAtAll) {
    mat::test::TempDir dir;
    LogicOptions o = on();
    o.statePath = dir.file(kLogicStateFile);
    o.writesResetRequestPath = dir.file(kLogicWritesResetFile);
    o.writesResetUid = ::getuid();
    Rig r(docWith(json::array({lowRule()})), o);
    std::string code;
    ASSERT_TRUE(r.logic->stopWrites(adminCaller(), code)) << code;
    mat::test::writeFile(o.writesResetRequestPath, "logic-writes-reset\n", 0600);
    r.auditDown = true;
    EXPECT_FALSE(r.logic->applyWritesReset());
    EXPECT_EQ(r.logic->writesState(), "stopped") << "no audit record: nothing changes";
    EXPECT_TRUE(exists(o.writesResetRequestPath)) << "the request stays, tried again";
    {
        std::ifstream f(o.statePath);
        std::stringstream ss;
        ss << f.rdbuf();
        EXPECT_EQ(json::parse(ss.str())["writesStopped"], true);
    }
    r.auditDown = false;
    EXPECT_TRUE(r.logic->applyWritesReset());
    EXPECT_EQ(r.logic->writesState(), "on");
    EXPECT_EQ(r.count("logic.writes.enabled"), 1u);
}
