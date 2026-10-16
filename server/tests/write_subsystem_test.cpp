// The tag write coordinator joined to the runtime (specs/006 T146, T147; contracts/device-config.md
// §7): the commands the last run left open are marked interrupted before any command is taken, a
// runtime whose audit log is down still runs and refuses every write, and the stop before the
// execv goes in the order quiesce, retained values, drivers.
#include "server/write_subsystem.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <filesystem>
#include <fstream>
#include <thread>

#include "drivers/modbus/tests/fake_plc.hpp"
#include "server/startup.hpp"

using nlohmann::json;
using namespace mat;
namespace fs = std::filesystem;

namespace {

const std::string kSchemas = std::string(MAT_SOURCE_DIR) + "/schemas";
const std::string kVectors = std::string(MAT_SOURCE_DIR) + "/tests/project-vectors";
constexpr int64_t kT0 = 1791594000000;
const std::string kId1 = "6f1c2a8e-4b7d-4c1e-9a3f-1a2b3c4d5e6f";

std::string idN(int n) {
    char b[64];
    std::snprintf(b, sizeof b, "00000000-0000-4000-8000-%012d", n);
    return b;
}

struct TempDir {
    fs::path path;
    explicit TempDir(const std::string& name)
        : path(fs::temp_directory_path() / ("mat-ws-" + name)) {
        fs::remove_all(path);
        fs::create_directories(path);
    }
    ~TempDir() { fs::remove_all(path); }
};

void writeFile(const fs::path& p, const std::string& text) {
    std::ofstream(p, std::ios::binary | std::ios::trunc) << text;
}

// One channel to a loopback port with a writable Tag, a retained internal Tag, and the simulation
// Tag the screen of the vector binds.
fs::path project(const TempDir& dir, int port) {
    const fs::path p = dir.path / "project";
    fs::copy(kVectors + "/v02-valid-no-connections", p, fs::copy_options::recursive);
    std::ifstream in(p / "project.json");
    json pj = json::parse(in);
    pj["connectionFile"] = "connections.json";
    writeFile(p / "project.json", pj.dump(2));
    writeFile(
        p / "connections.json",
        json{{"schemaVersion", "0.2.0"},
             {"scanGroups", {{"fast", 100}, {"normal", 100}, {"slow", 5000}}},
             {"channels",
              {{{"id", "plc1"},
                {"name", "PLC"},
                {"kind", "modbus-tcp"},
                {"tcp", {{"host", "127.0.0.1"}, {"port", port}}},
                {"devices", {{{"id", "d1"}, {"name", "D1"}, {"unitId", 1}, {"timeoutMs", 300}}}}}}}}
            .dump(2));
    json tags = json::array();
    tags.push_back(json::parse(
        R"({"id":"A.WAVE","kind":"simulation","type":"FLOAT32","sim":{"kind":"ramp","from":0,"to":100,"periodMs":10000}})"));
    tags.push_back(json::parse(
        R"({"id":"P1.SP","kind":"external","type":"INT16","access":"RW","source":{"device":"d1","address":"HR0"}})"));
    tags.push_back(json::parse(  // a command bit for the pulses (feature 011)
        R"({"id":"P1.RUN","kind":"external","type":"BOOL","access":"RW","source":{"device":"d1","address":"C3"}})"));
    tags.push_back(json::parse(
        R"({"id":"K.KEEP","kind":"internal","type":"FLOAT32","access":"RW","initial":1,"retain":true})"));
    writeFile(p / "tags.json", json{{"schemaVersion", "0.2.0"}, {"tags", tags}}.dump(2));
    return p;
}

struct Rig {
    explicit Rig(const std::string& dir, bool auditOpen = true, const std::string& auditDir = "") {
        validation = validateProject(dir, kSchemas);
        active = activateProject(validation, 10, store, std::nullopt, false);
        RuntimeEngineOptions opt;
        opt.retainDir = dir + "/../retain";
        opt.retainWindowS = 1;
        rt = std::make_unique<RuntimeEngine>(active.model, store, opt);
        AuditOptions ao;
        ao.dataDir = auditDir;
        ao.clock.wallMs = [this] { return wall.load(); };
        ao.clock.monoMs = [this] { return mono.load(); };
        ao.clock.synced = [](int64_t) { return true; };
        audit = std::make_unique<AuditLog>(ao);
        std::string err;
        if (auditOpen) EXPECT_TRUE(audit->open(err)) << err;
    }
    void makeSubsystem(PulseOptions pulse = {}) {
        CoordinatorOptions co;
        co.monoMs = [this] { return mono.load(); };
        co.wallMs = [this] { return wall.load(); };
        co.log = [](const std::string&) {};
        co.newRequestId = [] { return idN(777); };
        sub = std::make_unique<WriteSubsystem>(*rt, store, *audit, co, std::move(pulse));
    }
    WriteCaller who(const std::string& user = "vh1") {
        WriteCaller w;
        w.user = user;
        w.role = "operator";
        w.source = "10.0.0.7:51000";
        w.sessionKey = "k-" + user;
        return w;
    }
    TagValue get(const std::string& id) const { return store.get(*store.indexOf(id)); }

    ProjectValidation validation;
    TagStore store;
    ActiveProject active;
    std::unique_ptr<RuntimeEngine> rt;
    std::unique_ptr<AuditLog> audit;
    std::unique_ptr<WriteSubsystem> sub;
    std::atomic<int64_t> mono{9000000};
    std::atomic<int64_t> wall{kT0};
};

AuditEvent started(const std::string& tag) {
    AuditEvent e(AuditAction::TagWrite, AuditResult::Started, AuditChannel::Https,
                 "10.0.0.7:51000");
    e.user = "vh1";
    e.role = "operator";
    e.target = tag;
    e.code = "ACCEPTED";
    e.detail = R"({"requestId":"x","new":5})";
    return e;
}

bool waitFor(const std::function<bool()>& cond, int ms = 4000) {
    for (int i = 0; i < ms / 20 && !cond(); ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    return cond();
}

// The tick loop of the runtime on a thread.
struct Ticker {
    explicit Ticker(RuntimeEngine& rt)
        : rt_(rt), th_([this] {
              int64_t now = kT0 + 1000;
              while (!stop_) {
                  rt_.tick(now += 20);
                  std::this_thread::sleep_for(std::chrono::milliseconds(20));
              }
          }) {}
    ~Ticker() {
        stop_ = true;
        th_.join();
    }
    RuntimeEngine& rt_;
    std::atomic<bool> stop_{false};
    std::thread th_;
};

}  // namespace

TEST(WriteSubsystem, TheCommandsTheLastRunLeftOpenAreInterruptedBeforeAnyCommandIsTaken) {
    TempDir dir("recover");
    fs::create_directories(dir.path / "audit");
    Rig r(project(dir, 1502).string(), true, (dir.path / "audit").string());
    // the process of before died with two commands open
    r.audit->appendTagWriteStarted(started("P1.SP"), idN(1));
    r.audit->appendTagWriteStarted(started("K.KEEP"), idN(2));
    r.makeSubsystem();
    EXPECT_FALSE(r.audit->findTagWrite(idN(1))->row.resultId.has_value())
        << "not before recover() is called";
    EXPECT_TRUE(r.sub->recover());
    for (int n : {1, 2}) {
        const auto info = r.audit->findTagWrite(idN(n));
        ASSERT_TRUE(info.has_value());
        ASSERT_TRUE(info->result.has_value()) << n;
        EXPECT_EQ(info->result->result, "interrupted");
        EXPECT_EQ(info->result->code.value_or(""), "UNKNOWN_OUTCOME");
    }
    // a command with such an id is never run again
    r.rt->firstRound(kT0);
    const auto v =
        r.sub->coordinator().submit(r.who(), {{idN(1), "P1.SP", WriteValue::integer(5)}});
    EXPECT_EQ(v[0].status, "TIMEOUT");
    EXPECT_EQ(v[0].code, "UNKNOWN_OUTCOME");
    EXPECT_TRUE(v[0].duplicate);
    // and a new one is taken (an internal Tag: no link to wait for)
    const auto w =
        r.sub->coordinator().submit(r.who(), {{idN(3), "K.KEEP", WriteValue::number(7)}});
    EXPECT_EQ(w[0].status, "ACCEPTED");
    r.rt->stop();
}

TEST(WriteSubsystem, WithoutAnAuditLogTheRuntimeRunsAndEveryWriteIsRefused) {
    TempDir dir("down");
    Rig r(project(dir, 1502).string(), false,
          (dir.path / "audit").string());  // the log is never opened
    r.makeSubsystem();
    EXPECT_FALSE(r.sub->recover()) << "it says so, it does not throw";
    r.rt->firstRound(kT0);
    r.rt->tick(kT0 + 250);
    EXPECT_EQ(r.get("K.KEEP").quality, Quality::GOOD) << "the engine runs";
    for (int i = 1; i <= 2; ++i) {
        const auto v =
            r.sub->coordinator().submit(r.who(), {{idN(i), "K.KEEP", WriteValue::number(7)}});
        EXPECT_EQ(v[0].status, "REJECTED");
        EXPECT_EQ(v[0].code, "AUDIT_UNAVAILABLE");
    }
    EXPECT_EQ(std::get<double>(r.get("K.KEEP").value), 1.0) << "nothing was written";
    r.rt->stop();
}

TEST(WriteSubsystem, AWriteToAnInternalTagIsAppliedInTheNextRoundAndAnswersApplied) {
    TempDir dir("internal");
    fs::create_directories(dir.path / "audit");
    Rig r(project(dir, 1502).string(), true, (dir.path / "audit").string());
    r.makeSubsystem();
    ASSERT_TRUE(r.sub->recover());
    r.rt->firstRound(kT0);
    const auto v = r.sub->coordinator().submit(r.who(), {{kId1, "K.KEEP", WriteValue::number(42)}});
    ASSERT_EQ(v[0].status, "ACCEPTED");
    EXPECT_EQ(std::get<double>(r.get("K.KEEP").value), 1.0) << "not before the round";
    r.rt->tick(kT0 + 250);
    EXPECT_EQ(std::get<double>(r.get("K.KEEP").value), 42.0);
    const WriteView s = r.sub->coordinator().status(r.who(), kId1);
    EXPECT_EQ(s.status, "CONFIRMED");
    EXPECT_EQ(s.code, "APPLIED");
    r.sub->coordinator().waitAuditIdle();
    const auto info = r.audit->findTagWrite(kId1);
    ASSERT_TRUE(info.has_value());
    EXPECT_TRUE(info->row.resultId.has_value());
    r.rt->stop();
}

TEST(WriteSubsystem, AWriteToAPlcReachesItAndIsConfirmedByTheReadback) {
    TempDir dir("plc");
    fs::create_directories(dir.path / "audit");
    mat::testing::FakePlc plc;
    plc.set(1, modbus::Area::HR, 0, 5);
    mat::testing::LoopbackServer server(plc);
    Rig r(project(dir, server.port).string(), true, (dir.path / "audit").string());
    r.makeSubsystem();
    ASSERT_TRUE(r.sub->recover());
    r.rt->firstRound(kT0);
    r.rt->start();
    Ticker ticker(*r.rt);
    ASSERT_TRUE(waitFor([&] { return r.get("P1.SP").quality == Quality::GOOD; }));
    const auto v =
        r.sub->coordinator().submit(r.who(), {{kId1, "P1.SP", WriteValue::integer(123)}});
    ASSERT_EQ(v[0].status, "ACCEPTED") << v[0].code;
    ASSERT_TRUE(
        waitFor([&] { return r.sub->coordinator().status(r.who(), kId1).status != "ACCEPTED"; }));
    const WriteView s = r.sub->coordinator().status(r.who(), kId1);
    EXPECT_EQ(s.status, "CONFIRMED");
    EXPECT_EQ(s.code, "CONFIRMED");
    EXPECT_EQ(plc.get(1, modbus::Area::HR, 0), 123);
    ASSERT_TRUE(waitFor([&] { return std::get<int64_t>(r.get("P1.SP").value) == 123; }))
        << "the Tag carries the value read back";
    EXPECT_EQ(plc.requestCount(6), 1u) << "sent once";
}

TEST(WriteSubsystem, TheStopBeforeTheExecvQuiescesFirstSoACommandInFlightEndsBeforeTheDriversStop) {
    TempDir dir("restart");
    fs::create_directories(dir.path / "audit");
    mat::testing::FakePlc plc;
    plc.set(1, modbus::Area::HR, 0, 5);
    mat::testing::LoopbackServer server(plc);
    Rig r(project(dir, server.port).string(), true, (dir.path / "audit").string());
    r.makeSubsystem();
    ASSERT_TRUE(r.sub->recover());
    r.rt->firstRound(kT0);
    r.rt->start();
    Ticker ticker(*r.rt);
    ASSERT_TRUE(waitFor([&] { return r.get("P1.SP").quality == Quality::GOOD; }));
    mat::testing::PlcFault slow;  // the PLC takes 150 ms to answer the write (the timeout is 300)
    slow.kind = mat::testing::PlcFault::Delay;
    slow.fc = 6;
    slow.delayMs = 150;
    plc.addFault(slow);
    ASSERT_EQ(
        r.sub->coordinator().submit(r.who(), {{kId1, "P1.SP", WriteValue::integer(77)}})[0].status,
        "ACCEPTED");
    ASSERT_TRUE(waitFor([&] { return plc.requestCount(6) == 1; })) << "the command is on the wire";
    const auto rep = r.sub->beforeRestart();  // quiesce, then the retained values, then the drivers
    EXPECT_EQ(rep.unfinished, 0);
    const WriteView s = r.sub->coordinator().status(r.who(), kId1);
    EXPECT_EQ(s.status, "CONFIRMED") << "the command ran to its end: the drivers were still there";
    EXPECT_EQ(plc.get(1, modbus::Area::HR, 0), 77);
    // after it: no new command, and the drivers are down
    EXPECT_EQ(
        r.sub->coordinator().submit(r.who(), {{idN(2), "P1.SP", WriteValue::integer(1)}})[0].code,
        "PROJECT_CHANGING");
    const size_t seen = plc.requestCount();
    std::this_thread::sleep_for(std::chrono::milliseconds(400));
    EXPECT_EQ(plc.requestCount(), seen) << "the drivers stopped";
    r.sub->coordinator().waitAuditIdle();
    const auto info = r.audit->findTagWrite(kId1);
    ASSERT_TRUE(info.has_value());
    EXPECT_TRUE(info->row.resultId.has_value())
        << "the result is in the audit when beforeRestart() returns";
}

TEST(WriteSubsystem, TheTableOfRequestIdsIsCleanedEveryTenMinutes) {
    TempDir dir("maintain");
    fs::create_directories(dir.path / "audit");
    Rig r(project(dir, 1502).string(), true, (dir.path / "audit").string());
    r.makeSubsystem();
    ASSERT_TRUE(r.sub->recover());
    r.rt->firstRound(kT0);
    ASSERT_EQ(
        r.sub->coordinator().submit(r.who(), {{kId1, "K.KEEP", WriteValue::number(2)}})[0].status,
        "ACCEPTED");
    r.rt->tick(kT0 + 250);
    r.sub->coordinator().waitAuditIdle();
    r.sub->maintain(r.mono.load());
    EXPECT_TRUE(r.audit->findTagWrite(kId1).has_value());
    r.mono += 11 * 60 * 1000;
    r.sub->maintain(
        r.mono.load());  // 11 minutes: the first call of the 10-minute rhythm, the row is too young
    EXPECT_TRUE(r.audit->findTagWrite(kId1).has_value());
    r.mono += 10 * 60 * 1000;
    r.sub->maintain(r.mono.load());  // 21 minutes old
    EXPECT_FALSE(r.audit->findTagWrite(kId1).has_value());
    r.rt->stop();
}

// Feature 011 T036/T045 (FR-019; SC-004): a kill -9 between the first write of a pulse and its
// release left the command bit on and an `arm` in the journal. The next start writes the release
// value once the PLC is connected, audits it (tag.write, detail.source pulse-recovery), closes the
// entry; with pulseRecovery off nothing is written and PULSE_STUCK is in the warnings.
namespace {
void armLeftOver(const std::string& path) {
    PulseJournal j(path);
    j.load();
    PulseArm a;
    a.rid = idN(1);
    a.tag = "P1.RUN";
    a.rel = false;
    a.by = "vh1";
    a.src = "web";
    std::string err;
    ASSERT_TRUE(j.arm(a, err)) << err;
}
}  // namespace

TEST(WriteSubsystem, APulseTheLastRunLeftOnIsReleasedWhenThePlcConnects) {
    TempDir dir("pulse");
    fs::create_directories(dir.path / "audit");
    const std::string journalPath = (dir.path / "pulse.journal").string();
    armLeftOver(journalPath);
    mat::testing::FakePlc plc;
    plc.set(1, modbus::Area::C, 3, 1);  // the bit the run of before left on
    mat::testing::LoopbackServer server(plc);
    Rig r(project(dir, server.port).string(), true, (dir.path / "audit").string());
    SystemWarnings warnings([] { return kT0; });
    PulseOptions po;
    po.journalPath = journalPath;
    po.recovery = true;
    po.warnings = &warnings;
    r.makeSubsystem(po);
    ASSERT_TRUE(r.sub->recover());
    EXPECT_EQ(r.sub->recoverPulses(), 1u);
    r.rt->firstRound(kT0);
    r.rt->start();
    Ticker ticker(*r.rt);
    ASSERT_TRUE(waitFor(
        [&] {
            r.mono += 1000;  // the tries every 5 s, on the runtime's clock
            return plc.get(1, modbus::Area::C, 3) == 0;
        },
        8000))
        << "the release value reached the PLC";
    ASSERT_TRUE(waitFor([&] {
        r.sub->coordinator().waitAuditIdle();
        return PulseJournal(journalPath).load().empty();
    })) << "the entry is closed once the release is confirmed";
    const auto info = r.audit->findTagWrite(idN(777));
    ASSERT_TRUE(info.has_value());
    const json d = json::parse(info->started.detail.value_or("{}"));
    EXPECT_EQ(d["source"], "pulse-recovery");
    EXPECT_EQ(d["pulseOf"], idN(1));
    EXPECT_EQ(d["new"], false);
    EXPECT_EQ(info->started.user.value_or(""), "vh1");
    EXPECT_EQ(info->started.channel, "system");
    ASSERT_TRUE(waitFor([&] {
        const auto i = r.audit->findTagWrite(idN(777));
        return i && i->result.has_value();
    }));
    EXPECT_EQ(r.audit->findTagWrite(idN(777))->result->result, "ok");
    EXPECT_TRUE(warnings.list().empty());
    r.rt->stop();
}

TEST(WriteSubsystem, PulseRecoveryOffLeavesTheBitAndRaisesPulseStuck) {
    TempDir dir("pulse-off");
    fs::create_directories(dir.path / "audit");
    const std::string journalPath = (dir.path / "pulse.journal").string();
    armLeftOver(journalPath);
    Rig r(project(dir, 1502).string(), true, (dir.path / "audit").string());
    SystemWarnings warnings([] { return kT0; });
    PulseOptions po;
    po.journalPath = journalPath;
    po.recovery = false;
    po.warnings = &warnings;
    r.makeSubsystem(po);
    ASSERT_TRUE(r.sub->recover());
    EXPECT_EQ(r.sub->recoverPulses(), 1u);
    const auto w = warnings.list();
    ASSERT_EQ(w.size(), 1u);
    EXPECT_EQ(w[0].code, "PULSE_STUCK");
    EXPECT_EQ(w[0].detail["tags"], json::array({"P1.RUN"}));
    EXPECT_EQ(w[0].detail["pulseRecovery"], "off");
    EXPECT_EQ(PulseJournal(journalPath).load().size(), 1u) << "the entry is kept";
    r.rt->stop();
}
