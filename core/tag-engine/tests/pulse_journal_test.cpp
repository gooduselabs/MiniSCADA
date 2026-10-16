// T036 (feature 011; SC-004; FR-018 to FR-020; research R6, D10): the durable journal of pulses and
// the release of a pulse left pending by a kill -9.
//  - the file: an `arm` is on disk when arm() returns, a `done` closes it, a line cut by a power
//    loss is ignored, the file is compacted, a journal that cannot be written refuses the arm;
//  - the coordinator: the arm is durable BEFORE the first (on) write reaches the driver; a journal
//    that cannot be written ends the pulse FAILED PULSE_JOURNAL_FAILED with nothing sent; `done`
//    only after the release was confirmed; a release that failed stays armed and is tried again;
//  - the start: an armed entry is released when its channel connects (tried every 5 s for 10 min),
//    audited as tag.write with detail.source pulse-recovery durably before the write; after the
//    window the entry is kept and the Tag reported stuck (PULSE_STUCK); pulseRecovery off writes
//    nothing; a later pulse of the same Tag that is released closes a stuck entry.
// The clocks are fakes (the 10 minutes take milliseconds).
#include "core/tag-engine/pulse_journal.hpp"

#include <gtest/gtest.h>
#include <sys/stat.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <functional>
#include <thread>

#include "core/tag-engine/tests/write_fakes.hpp"
#include "core/tag-engine/write_coordinator.hpp"
#include "nlohmann/json.hpp"

using namespace mat;
using namespace mat::testing;
namespace fs = std::filesystem;

namespace {

struct TempDir {
    fs::path path;
    explicit TempDir(const std::string& name)
        : path(fs::temp_directory_path() /
               ("mat-pulse-" + name + "-" + std::to_string(::getpid()))) {
        fs::remove_all(path);
        fs::create_directories(path);
    }
    ~TempDir() { fs::remove_all(path); }
};

std::vector<std::string> readLines(const fs::path& p) {
    std::ifstream in(p);
    std::vector<std::string> out;
    for (std::string l; std::getline(in, l);) out.push_back(l);
    return out;
}

PulseArm entry(const std::string& rid, const std::string& tag = "RUN", bool rel = false) {
    PulseArm a;
    a.rid = rid;
    a.tag = tag;
    a.rel = rel;
    a.dueMono = 1500;
    a.dueWallMs = 1791600000500LL;
    a.src = "web";
    a.by = "vh1";
    return a;
}

// A journal that tells the order of its calls next to the driver's, and fails on demand.
struct FakePulseLog : PulseLog {
    explicit FakePulseLog(Events& e) : ev(e) {}
    bool arm(PulseArm a, std::string& error) override {
        std::lock_guard<std::mutex> g(mu);
        if (failArm) {
            error = "ENOSPC";
            return false;
        }
        ev.add("arm:" + a.rid);
        arms.push_back(a);
        return true;
    }
    bool done(const std::string& rid, std::string& error) override {
        std::lock_guard<std::mutex> g(mu);
        if (failDone) {
            error = "EIO";
            return false;
        }
        ev.add("done:" + rid);
        dones.push_back(rid);
        return true;
    }
    size_t doneCount() {
        std::lock_guard<std::mutex> g(mu);
        return dones.size();
    }
    bool isDone(const std::string& rid) {
        std::lock_guard<std::mutex> g(mu);
        return std::find(dones.begin(), dones.end(), rid) != dones.end();
    }
    std::mutex mu;
    Events& ev;
    bool failArm = false;
    bool failDone = false;
    std::vector<PulseArm> arms;
    std::vector<std::string> dones;
};

struct Rig {
    explicit Rig(PulseLog* log = nullptr, CoordinatorOptions o = {})
        : backend(ev), audit(ev), journal(ev), model(makeModel()) {
        addModelTagsToStore(model, store);
        o.monoMs = [this] { return mono.load(); };
        o.wallMs = [this] { return wall.load(); };
        o.clockSynced = [](int64_t) { return true; };
        o.log = [](const std::string&) {};
        o.pulseLog = log ? log : &journal;
        o.pulseStuck = [this](const std::vector<std::string>& tags) {
            std::lock_guard<std::mutex> g(stuckMu);
            stuckCalls.push_back(tags);
        };
        int n = 0;
        o.newRequestId = [n]() mutable { return idN(9000 + ++n); };
        store.set(RUN, false, Quality::GOOD, 1, 1);
        store.set(NOREAD, false, Quality::GOOD, 1, 1);
        coord = std::make_unique<WriteCoordinator>(model, store, backend, audit, o);
    }
    ~Rig() { coord.reset(); }

    WriteCaller who() {
        WriteCaller w;
        w.user = "vh1";
        w.role = "operator";
        w.source = "10.0.0.7:51000";
        w.sessionKey = "sess-1";
        w.channel = "web";
        return w;
    }
    WriteView pulse(int64_t ms, int n = 1, const std::string& tag = "RUN") {
        WriteRequest q;
        q.requestId = idN(n);
        q.tag = tag;
        q.value = WriteValue::boolean(true);
        q.pulseMs = ms;
        return coord->submit(who(), {q}).at(0);
    }
    void result(uint64_t id, drv::WriteStatus st = drv::WriteStatus::Confirmed,
                const char* code = "CONFIRMED") {
        drv::WriteResult r;
        r.id = id;
        r.status = st;
        r.code = code;
        coord->onDriverResult(r);
    }
    bool waitFor(const std::function<bool()>& pred, int ms = 3000) {
        const auto end = std::chrono::steady_clock::now() + std::chrono::milliseconds(ms);
        while (std::chrono::steady_clock::now() < end) {
            if (pred()) return true;
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        }
        return pred();
    }
    // Moves the fake clock in steps, letting the pulse thread look at each (it looks every 50 ms
    // of real time at most).
    void advance(int64_t ms, int64_t step = 1000) {
        for (int64_t done = 0; done < ms; done += step) {
            mono += std::min(step, ms - done);
            wall += std::min(step, ms - done);
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
    }
    void settle() { std::this_thread::sleep_for(std::chrono::milliseconds(150)); }
    std::vector<std::pair<WriteRecord, WriteOutcome>> finished() {
        coord->waitAuditIdle();
        std::lock_guard<std::mutex> g(audit.mu);
        return audit.finishedRecs;
    }
    std::vector<WriteRecord> started() {
        std::lock_guard<std::mutex> g(audit.mu);
        return audit.startedRecs;
    }
    std::vector<std::string> lastStuck() {
        std::lock_guard<std::mutex> g(stuckMu);
        return stuckCalls.empty() ? std::vector<std::string>{} : stuckCalls.back();
    }
    size_t stuckCallCount() {
        std::lock_guard<std::mutex> g(stuckMu);
        return stuckCalls.size();
    }

    Events ev;
    FakeBackend backend;
    FakeAudit audit;
    FakePulseLog journal;
    ProjectModel model;
    TagStore store;
    std::atomic<int64_t> mono{1000000};
    std::atomic<int64_t> wall{1791600000000LL};
    std::mutex stuckMu;
    std::vector<std::vector<std::string>> stuckCalls;
    std::unique_ptr<WriteCoordinator> coord;
};

}  // namespace

// ================= the file =================

TEST(PulseJournalFile, AnArmIsOnDiskWhenItReturnsAndAnotherProcessReadsIt) {
    TempDir dir("arm");
    const std::string path = (dir.path / "pulse.journal").string();
    {
        PulseJournal j(path);
        EXPECT_TRUE(j.load().empty()) << "a missing file is an empty journal";
        std::string err;
        ASSERT_TRUE(j.arm(entry(idN(1)), err)) << err;
        // no close, no flush: what a kill -9 right now would leave
        PulseJournal other(path);
        const auto armed = other.load();
        ASSERT_EQ(armed.size(), 1u);
        EXPECT_EQ(armed[0].rid, idN(1));
        EXPECT_EQ(armed[0].tag, "RUN");
        EXPECT_FALSE(armed[0].rel);
        EXPECT_EQ(armed[0].dueWallMs, 1791600000500LL);
        EXPECT_EQ(armed[0].src, "web");
        EXPECT_EQ(armed[0].by, "vh1");
    }
    struct stat st {};
    ASSERT_EQ(::stat(path.c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 0777, 0600u);
    const auto lines = readLines(path);
    ASSERT_GE(lines.size(), 1u);
    const auto j = nlohmann::json::parse(lines[0]);
    EXPECT_EQ(j["v"], 1);
    EXPECT_EQ(j["op"], "arm");
    EXPECT_EQ(j["rid"], idN(1));
    EXPECT_EQ(j["rel"], false);
    EXPECT_EQ(j["dueWall"], "2026-10-10T02:40:00.500Z") << "ISO 8601, UTC";
    EXPECT_TRUE(j.contains("dueMono"));
    EXPECT_TRUE(j.contains("seq"));
}

TEST(PulseJournalFile, ADoneClosesItsEntryOnly) {
    TempDir dir("done");
    const std::string path = (dir.path / "pulse.journal").string();
    PulseJournal j(path);
    j.load();
    std::string err;
    ASSERT_TRUE(j.arm(entry(idN(1), "RUN"), err));
    ASSERT_TRUE(j.arm(entry(idN(2), "NOREAD", true), err));
    ASSERT_TRUE(j.done(idN(1), err)) << err;
    EXPECT_EQ(j.armed().size(), 1u);
    PulseJournal again(path);
    const auto armed = again.load();
    ASSERT_EQ(armed.size(), 1u);
    EXPECT_EQ(armed[0].rid, idN(2));
    EXPECT_TRUE(armed[0].rel);
}

TEST(PulseJournalFile, ALineCutByAPowerLossIsIgnoredAndTheStartCompacts) {
    TempDir dir("torn");
    const std::string path = (dir.path / "pulse.journal").string();
    {
        PulseJournal j(path);
        j.load();
        std::string err;
        ASSERT_TRUE(j.arm(entry(idN(1)), err));
        ASSERT_TRUE(j.arm(entry(idN(2)), err));
        ASSERT_TRUE(j.done(idN(2), err));
    }
    {
        std::ofstream out(path, std::ios::app | std::ios::binary);
        out << R"({"v":1,"op":"arm","rid":"00000000-0000-4000-8000-0000)";  // no end, no newline
    }
    PulseJournal j(path);
    const auto armed = j.load();
    ASSERT_EQ(armed.size(), 1u);
    EXPECT_EQ(armed[0].rid, idN(1));
    EXPECT_EQ(j.badLines(), 1u);
    // compacted at start: only the armed entry is left, and the file reads clean
    const auto lines = readLines(path);
    ASSERT_EQ(lines.size(), 1u);
    EXPECT_EQ(nlohmann::json::parse(lines[0])["rid"], idN(1));
    std::string err;
    ASSERT_TRUE(j.arm(entry(idN(3)), err)) << "appends after the compaction";
    PulseJournal again(path);
    EXPECT_EQ(again.load().size(), 2u);
    EXPECT_EQ(again.badLines(), 0u);
}

TEST(PulseJournalFile, TheFileNeverHoldsMuchMoreThan256Lines) {
    TempDir dir("compact");
    const std::string path = (dir.path / "pulse.journal").string();
    PulseJournal j(path);
    j.load();
    std::string err;
    ASSERT_TRUE(j.arm(entry(idN(99999), "NOREAD"), err));  // one that stays armed throughout
    for (int i = 1; i <= 400; ++i) {
        ASSERT_TRUE(j.arm(entry(idN(i)), err)) << err;
        ASSERT_TRUE(j.done(idN(i), err)) << err;
        ASSERT_LE(readLines(path).size(), PulseJournal::kCompactLines + 2) << "at " << i;
    }
    PulseJournal again(path);
    const auto armed = again.load();
    ASSERT_EQ(armed.size(), 1u);
    EXPECT_EQ(armed[0].rid, idN(99999));
    ASSERT_TRUE(again.arm(entry(idN(100000)), err));
    EXPECT_GT(again.armed().back().seq, armed[0].seq) << "the sequence goes on after a compaction";
}

TEST(PulseJournalFile, AJournalThatCannotBeWrittenRefusesTheArm) {
    TempDir dir("fail");
    PulseJournal j((dir.path / "missing-dir" / "pulse.journal").string());
    j.load();
    std::string err;
    EXPECT_FALSE(j.arm(entry(idN(1)), err));
    EXPECT_FALSE(err.empty());
    EXPECT_TRUE(j.armed().empty()) << "an arm that is not durable is not armed";
}

// ================= the coordinator =================

TEST(PulseJournalWrite, TheArmIsDurableBeforeTheOnWriteReachesTheDriver) {
    Rig r;
    ASSERT_EQ(r.pulse(500).status, "ACCEPTED");
    const int arm = r.ev.indexOf("arm:" + idN(1));
    const int started = r.ev.indexOf("started:" + idN(1));
    const int submit = r.ev.indexOf("submit:");
    ASSERT_GE(arm, 0);
    ASSERT_GE(submit, 0);
    EXPECT_LT(started, arm) << "the audit record of receipt first (Constitution V)";
    EXPECT_LT(arm, submit) << "the journal before the bit is turned on";
    ASSERT_EQ(r.journal.arms.size(), 1u);
    const PulseArm& a = r.journal.arms[0];
    EXPECT_EQ(a.tag, "RUN");
    EXPECT_FALSE(a.rel) << "the release value: the opposite of the pulse";
    EXPECT_EQ(a.by, "vh1");
    EXPECT_EQ(a.src, "web");
    EXPECT_EQ(a.dueMono, r.mono.load() + 500);
    EXPECT_EQ(a.dueWallMs, r.wall.load() + 500);
}

TEST(PulseJournalWrite, AWriteThatIsNoPulseIsNotJournaled) {
    Rig r;
    WriteRequest q;
    q.requestId = idN(1);
    q.tag = "RUN";
    q.value = WriteValue::boolean(true);
    ASSERT_EQ(r.coord->submit(r.who(), {q}).at(0).status, "ACCEPTED");
    EXPECT_TRUE(r.journal.arms.empty());
}

TEST(PulseJournalWrite, AJournalThatCannotBeWrittenEndsThePulseFailedAndSendsNothing) {
    Rig r;
    r.journal.failArm = true;
    const WriteView v = r.pulse(500);
    EXPECT_EQ(v.status, "FAILED");
    EXPECT_EQ(v.code, "PULSE_JOURNAL_FAILED");
    EXPECT_FALSE(v.message.empty());
    EXPECT_EQ(r.backend.attempts.size(), 0u) << "0 commands to the driver";
    const auto fin = r.finished();
    ASSERT_EQ(fin.size(), 1u) << "accepted, then ended: audited";
    EXPECT_EQ(fin[0].second.result, "failed");
    EXPECT_EQ(fin[0].second.code, "PULSE_JOURNAL_FAILED");
    EXPECT_EQ(r.coord->outstanding(), 0u);
    EXPECT_EQ(r.coord->status(r.who(), idN(1)).code, "PULSE_JOURNAL_FAILED");
    // the place in the queue was given back: the next pulse runs
    r.journal.failArm = false;
    EXPECT_EQ(r.pulse(500, 2).status, "ACCEPTED");
}

TEST(PulseJournalWrite, AJournalFileThatCannotBeWrittenSendsNothingEither) {
    TempDir dir("coord-fail");
    PulseJournal file((dir.path / "missing-dir" / "pulse.journal").string());
    file.load();
    Rig r(&file);
    const WriteView v = r.pulse(500);
    EXPECT_EQ(v.status, "FAILED");
    EXPECT_EQ(v.code, "PULSE_JOURNAL_FAILED");
    EXPECT_EQ(r.backend.attempts.size(), 0u);
}

TEST(PulseJournalWrite, DoneOnlyAfterTheDeviceConfirmedTheRelease) {
    Rig r;
    ASSERT_EQ(r.pulse(300).status, "ACCEPTED");
    r.result(r.backend.cmd(0).id);  // the on write
    EXPECT_EQ(r.journal.doneCount(), 0u) << "the bit is on: still armed";
    r.mono += 300;
    ASSERT_TRUE(r.waitFor([&] { return r.backend.count() == 2; }));
    EXPECT_EQ(r.journal.doneCount(), 0u) << "the release is sent, not confirmed";
    r.result(r.backend.cmd(1).id);
    ASSERT_TRUE(r.waitFor([&] { return r.journal.doneCount() == 1; }));
    EXPECT_TRUE(r.journal.isDone(idN(1)));
    EXPECT_EQ(r.coord->status(r.who(), idN(1)).status, "CONFIRMED");
}

TEST(PulseJournalWrite, AnOnWriteTheDeviceRefusedLeavesNothingToRelease) {
    Rig r;
    ASSERT_EQ(r.pulse(300).status, "ACCEPTED");
    r.result(r.backend.cmd(0).id, drv::WriteStatus::Failed, "DEVICE_EXCEPTION");
    ASSERT_TRUE(r.waitFor([&] { return r.journal.doneCount() == 1; }))
        << "the bit was never turned on: the entry is closed";
}

TEST(PulseJournalWrite, APulseTheProjectChangeCancelledBeforeItsFirstWriteOwesNothing) {
    Rig r;
    ASSERT_EQ(r.pulse(300).status, "ACCEPTED");
    {
        std::lock_guard<std::mutex> g(r.backend.mu);
        r.backend.unsent = {r.backend.sent.at(0).second.id};  // still in the driver's queue
    }
    const auto rep = r.coord->quiesce();
    EXPECT_EQ(rep.cancelled, 1);
    EXPECT_TRUE(r.journal.isDone(idN(1))) << "closed before quiesce() returns (before the execv)";
}

TEST(PulseJournalWrite, AReleaseThatFailedStaysArmedAndIsTriedAgainAsARecovery) {
    Rig r;
    ASSERT_EQ(r.pulse(300).status, "ACCEPTED");
    r.result(r.backend.cmd(0).id);
    r.mono += 300;
    ASSERT_TRUE(r.waitFor([&] { return r.backend.count() == 2; }));
    r.result(r.backend.cmd(1).id, drv::WriteStatus::Timeout, "WRITE_TIMEOUT");
    EXPECT_EQ(r.coord->status(r.who(), idN(1)).code, "PULSE_RELEASE_FAILED") << "as in 007";
    EXPECT_EQ(r.journal.doneCount(), 0u);
    ASSERT_EQ(r.coord->pulseRecovery().pending, std::vector<std::string>{"RUN"});
    r.settle();
    EXPECT_EQ(r.backend.count(), 2u) << "not before the retry time";
    r.advance(5000);
    ASSERT_TRUE(r.waitFor([&] { return r.backend.count() == 3; }));
    const drv::WriteCommand again = r.backend.cmd(2);
    EXPECT_FALSE(std::get<bool>(again.raw));
    EXPECT_TRUE(again.priority);
    r.result(again.id);
    ASSERT_TRUE(r.waitFor([&] { return r.journal.isDone(idN(1)); }));
    const auto fin = r.finished();
    ASSERT_EQ(fin.size(), 2u);
    EXPECT_EQ(fin[1].first.origin, "pulse-recovery");
    EXPECT_EQ(fin[1].first.pulseOf, idN(1));
    EXPECT_EQ(fin[1].second.result, "ok");
    EXPECT_TRUE(r.coord->pulseRecovery().pending.empty());
}

// ================= the start =================

TEST(PulseRecovery, AnArmedEntryIsReleasedWhenTheChannelConnects) {
    Rig r;
    r.backend.state = drv::LinkState{drv::ChannelState::Connecting, drv::DeviceState::Error};
    r.coord->recoverPulses({entry(idN(1), "RUN", false)}, true);
    r.settle();
    EXPECT_EQ(r.backend.attempts.size(), 0u) << "nothing is sent on a channel that is down";
    EXPECT_TRUE(r.started().empty()) << "and nothing is audited as started";
    EXPECT_EQ(r.coord->pulseRecovery().pending, std::vector<std::string>{"RUN"});
    r.advance(5000);
    r.settle();
    EXPECT_EQ(r.backend.attempts.size(), 0u);
    r.backend.state = drv::LinkState{drv::ChannelState::Connected, drv::DeviceState::Active};
    r.advance(5000);
    ASSERT_TRUE(r.waitFor([&] { return r.backend.count() == 1; }))
        << "at the next try after the channel connected (5 s)";
    const drv::WriteCommand cmd = r.backend.cmd(0);
    EXPECT_EQ(cmd.tag, static_cast<size_t>(RUN));
    EXPECT_FALSE(std::get<bool>(cmd.raw)) << "the release value of the journal";
    EXPECT_TRUE(cmd.priority);
    // durable audit before the write (Constitution V), under the account of the pulse
    EXPECT_LT(r.ev.indexOf("started:" + idN(9001)), r.ev.indexOf("submit:"));
    const auto st = r.started();
    ASSERT_EQ(st.size(), 1u);
    EXPECT_EQ(st[0].origin, "pulse-recovery");
    EXPECT_EQ(st[0].pulseOf, idN(1));
    EXPECT_EQ(st[0].requestId, idN(9001)) << "a request id of its own";
    EXPECT_EQ(st[0].tag, "RUN");
    EXPECT_EQ(st[0].who.user, "vh1");
    EXPECT_EQ(st[0].newJson, "false");
    EXPECT_EQ(st[0].channel, "plc1");
    r.result(cmd.id);
    ASSERT_TRUE(r.waitFor([&] { return r.journal.isDone(idN(1)); }));
    const auto fin = r.finished();
    ASSERT_EQ(fin.size(), 1u);
    EXPECT_EQ(fin[0].second.result, "ok");
    EXPECT_EQ(fin[0].second.code, "CONFIRMED");
    EXPECT_EQ(fin[0].first.origin, "pulse-recovery");
    EXPECT_TRUE(r.coord->pulseRecovery().pending.empty());
    EXPECT_TRUE(r.lastStuck().empty());
}

TEST(PulseRecovery, AChannelThatIsUpAtStartIsReleasedAtOnce) {
    Rig r;
    r.coord->recoverPulses({entry(idN(1))}, true);
    ASSERT_TRUE(r.waitFor([&] { return r.backend.count() == 1; }, 1000));
}

TEST(PulseRecovery, AReleaseThatFailsIsTriedAgainEveryFiveSeconds) {
    Rig r;
    r.coord->recoverPulses({entry(idN(1))}, true);
    ASSERT_TRUE(r.waitFor([&] { return r.backend.count() == 1; }));
    r.result(r.backend.cmd(0).id, drv::WriteStatus::Failed, "DEVICE_EXCEPTION");
    r.advance(4000);
    r.settle();
    EXPECT_EQ(r.backend.count(), 1u);
    r.advance(1000);
    ASSERT_TRUE(r.waitFor([&] { return r.backend.count() == 2; }));
    EXPECT_EQ(r.started().size(), 1u) << "one audited command for the whole recovery";
    r.result(r.backend.cmd(1).id);
    ASSERT_TRUE(r.waitFor([&] { return r.journal.isDone(idN(1)); }));
}

TEST(PulseRecovery, AfterTenMinutesTheEntryIsKeptAndTheTagReportedStuck) {
    Rig r;
    r.backend.state = drv::LinkState{drv::ChannelState::Connecting, drv::DeviceState::Error};
    r.coord->recoverPulses({entry(idN(1))}, true);
    r.advance(9 * 60 * 1000 + 50 * 1000, 5000);
    r.settle();
    EXPECT_TRUE(r.lastStuck().empty()) << "not yet";
    r.advance(15 * 1000, 5000);
    ASSERT_TRUE(r.waitFor([&] { return r.lastStuck() == std::vector<std::string>{"RUN"}; }));
    EXPECT_EQ(r.coord->pulseRecovery().stuck, std::vector<std::string>{"RUN"});
    EXPECT_TRUE(r.coord->pulseRecovery().pending.empty());
    EXPECT_EQ(r.journal.doneCount(), 0u) << "the entry is kept";
    EXPECT_EQ(r.backend.attempts.size(), 0u);
    const auto fin = r.finished();
    ASSERT_EQ(fin.size(), 1u) << "the end is audited FAILED";
    EXPECT_EQ(fin[0].second.result, "failed");
    EXPECT_EQ(fin[0].second.code, "PULSE_STUCK");
    EXPECT_EQ(fin[0].first.origin, "pulse-recovery");
    // no more tries afterwards
    r.backend.state = drv::LinkState{drv::ChannelState::Connected, drv::DeviceState::Active};
    r.advance(20000, 5000);
    r.settle();
    EXPECT_EQ(r.backend.attempts.size(), 0u);
}

TEST(PulseRecovery, ALaterPulseOfTheSameTagThatIsReleasedClosesTheStuckEntry) {
    Rig r;
    r.coord->recoverPulses({entry(idN(1))}, false);
    ASSERT_EQ(r.coord->pulseRecovery().stuck, std::vector<std::string>{"RUN"});
    ASSERT_EQ(r.pulse(200, 2).status, "ACCEPTED") << "a stuck Tag still takes a pulse";
    r.result(r.backend.cmd(0).id);
    r.mono += 200;
    ASSERT_TRUE(r.waitFor([&] { return r.backend.count() == 2; }));
    r.result(r.backend.cmd(1).id);
    ASSERT_TRUE(r.waitFor([&] { return r.journal.isDone(idN(1)) && r.journal.isDone(idN(2)); }));
    EXPECT_TRUE(r.coord->pulseRecovery().stuck.empty());
    ASSERT_TRUE(r.waitFor([&] { return r.lastStuck().empty(); }));
}

TEST(PulseRecovery, PulseRecoveryOffWritesNothingKeepsTheEntryAndWarns) {
    Rig r;
    r.coord->recoverPulses({entry(idN(1))}, false);
    ASSERT_TRUE(r.waitFor([&] { return r.lastStuck() == std::vector<std::string>{"RUN"}; }));
    r.advance(11 * 60 * 1000, 10000);
    r.settle();
    EXPECT_EQ(r.backend.attempts.size(), 0u);
    EXPECT_TRUE(r.started().empty());
    EXPECT_EQ(r.journal.doneCount(), 0u);
}

TEST(PulseRecovery, NothingIsWrittenWhileTheAuditCannotRecordIt) {
    Rig r;
    r.audit.up = false;
    r.coord->recoverPulses({entry(idN(1))}, true);
    r.settle();
    r.advance(5000);
    r.settle();
    EXPECT_EQ(r.backend.attempts.size(), 0u) << "Constitution V: no write without a durable audit";
    r.audit.up = true;
    r.advance(5000);
    ASSERT_TRUE(r.waitFor([&] { return r.backend.count() == 1; }));
}

TEST(PulseRecovery, AnEntryOfATagTheProjectNoLongerHasIsStuckAtOnce) {
    Rig r;
    r.coord->recoverPulses({entry(idN(1), "GONE")}, true);
    ASSERT_TRUE(r.waitFor([&] { return r.lastStuck() == std::vector<std::string>{"GONE"}; }));
    EXPECT_EQ(r.backend.attempts.size(), 0u);
}

TEST(PulseRecovery, ANewPulseOfATagBeingRecoveredIsPulseInProgress) {
    Rig r;
    r.backend.state = drv::LinkState{drv::ChannelState::Connected, drv::DeviceState::Active};
    r.backend.fullTags = {RUN};  // the release waits in the recovery
    r.coord->recoverPulses({entry(idN(1))}, true);
    const WriteView v = r.pulse(200, 2);
    EXPECT_EQ(v.status, "REJECTED");
    EXPECT_EQ(v.code, "PULSE_IN_PROGRESS");
    EXPECT_EQ(r.journal.arms.size(), 0u);
    EXPECT_EQ(r.pulse(200, 3, "NOREAD").status, "ACCEPTED") << "another Tag is not concerned";
}
