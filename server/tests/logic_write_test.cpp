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

#include <atomic>
#include <fstream>
#include <sstream>
#include <thread>

#include "core/audit/audit_log.hpp"
#include "core/auth/tests/auth_test_support.hpp"
#include "core/tag-engine/tests/write_fakes.hpp"
#include "server/logic_glue.hpp"
#include "server/write_glue.hpp"

using namespace mat;
using namespace mat::testing;
using nlohmann::json;

namespace {

// The model of write_fakes (SP FLOAT32 RW 0..90, LEVEL_R, RUN BOOL RW, ...) plus the logic Tags.
ProjectModel logicModel() {
    ProjectModel m = makeModel();
    for (const char* id : {"L.T"}) {
        TagModel t;
        t.id = id;
        t.kind = TagKind::Internal;
        t.type = TagType::BOOL;
        t.writable = false;
        t.logicOwned = true;
        m.tags.push_back(t);
    }
    return m;
}

// One round of the engine: values by model index, what logic publishes and sets.
struct FakeRound : EngineRound {
    explicit FakeRound(const ProjectModel& m) : vals(m.tags.size()) {
        for (auto& v : vals) {
            v.quality = Quality::BAD;
            v.reason = "NO_VALUE";
        }
    }
    expr::InputValue read(size_t tag) const override { return vals.at(tag); }
    void publish(size_t tag, TagScalar value, Quality q, const std::string& reason) override {
        vals.at(tag).value = std::move(value);
        vals.at(tag).quality = q;
        vals.at(tag).reason = reason;
        ++published;
    }
    void setInternal(size_t tag, TagScalar value) override { sets.emplace_back(tag, value); }
    int64_t now() const override { return t; }
    void good(size_t tag, TagScalar v) {
        vals.at(tag).value = std::move(v);
        vals.at(tag).quality = Quality::GOOD;
        vals.at(tag).reason.clear();
    }
    std::vector<expr::InputValue> vals;
    std::vector<std::pair<size_t, TagScalar>> sets;
    int published = 0;
    int64_t t = 0;
};

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
        for (const auto& b : logic->status()["blocks"])
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
