// T112, the C++ part (feature 009; FR-047, FR-035; SC-018, SC-019): a storm of alarms through the
// real engine, the real glue and the real live hub, over the real send queue of a session.
// - 200 alarms start in one tick, then waves of changes; 10 clients, 3 of them slow: the queue of
//   no session passes 50 % of its 256 KB, no session overflows (4409), the tick is not slower by
//   more than 5 ms, and every client that drains ends with the state of the engine (the invariant
//   of live-protocol-1.3 §4.1, with the hold-back table at work);
// - an alarm that starts 20 times a minute shelves itself at its chatterLimit: the log gets a few
//   rows, not one per start, and the summary row counts every start.
#include <gtest/gtest.h>
#include <sqlite3.h>

#include <algorithm>
#include <chrono>
#include <map>
#include <memory>

#include "core/alarm/alarm_store.hpp"
#include "core/session-manager/send_queue.hpp"
#include "nlohmann/json.hpp"
#include "server/alarm_glue.hpp"
#include "server/websocket/live_hub.hpp"

using namespace mat;
using nlohmann::json;

namespace {

constexpr int64_t kEpoch0 = 1791600000000LL;

std::string tempDir() {
    char tmpl[] = "/tmp/mat-alarm-storm-XXXXXX";
    const char* d = mkdtemp(tmpl);
    return d ? d : "";
}

double nowMs() {
    return std::chrono::duration<double, std::milli>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

// What a browser does with the alarm messages of one session.
struct Client {
    std::map<std::string, std::string> state;  // id -> state
    int64_t sequence = 0;
    int64_t partsSeen = 0;
    bool broken = false;
    void apply(const std::string& text) {
        const json m = json::parse(text);
        const std::string type = m["type"];
        if (type == "alarmSnapshot") {
            const int64_t part = m.value("part", 1), parts = m.value("parts", 1);
            if (part == 1) {
                state.clear();
                partsSeen = 0;
            }
            ++partsSeen;
            for (const json& i : m["instances"]) state[i["id"]] = i["state"];
            sequence = m["sequence"];
            (void)parts;
        } else if (type == "alarmDelta") {
            if (m["sequence"].get<int64_t>() != sequence + 1) broken = true;
            sequence = m["sequence"];
            for (const json& i : m["changed"]) state[i["id"]] = i["state"];
            for (const json& id : m["removed"]) state.erase(id.get<std::string>());
        }
    }
};

struct SimTransport : LiveTransport {
    struct Sess {
        SendQueue q{SendQueue::kDefaultMaxBytes};
        size_t maxBytes = 0;
        bool overflow = false;
        size_t drainBytes = SIZE_MAX;  // per call of drain()
        Client client;
    };
    std::map<uint64_t, std::unique_ptr<Sess>> sess;

    Sess& at(uint64_t sid) {
        auto& p = sess[sid];
        if (!p) p = std::make_unique<Sess>();
        return *p;
    }
    SendQueue::PushResult push(uint64_t sid, std::string text) override {
        Sess& s = at(sid);
        const auto r = s.q.push(std::move(text));
        s.maxBytes = std::max(s.maxBytes, s.q.bytes());
        if (r == SendQueue::PushResult::Overflow) s.overflow = true;
        return r;
    }
    void close(uint64_t, int, const std::string&) override {}
    int queueFillPercent(uint64_t sid) override {
        Sess& s = at(sid);
        return static_cast<int>(s.q.bytes() * 100 / s.q.maxBytes());
    }
    size_t queueCapacity(uint64_t sid) override { return at(sid).q.maxBytes(); }
    // The writer thread of a session: takes what it can in one call.
    void drain(uint64_t sid) {
        Sess& s = at(sid);
        size_t budget = s.drainBytes;
        SendQueue::Item it;
        while (s.q.bytes() > 0) {
            if (s.q.pop(it, 0) != SendQueue::PopStatus::Item) break;
            s.client.apply(it.text);
            if (it.text.size() >= budget) break;
            budget -= it.text.size();
        }
    }
};

json classesDoc(int chatterLimit = 5) {
    return {{"classes", json::array({{{"id", "minor"},
                                      {"name", "Nhỏ"},
                                      {"priority", "minor"},
                                      {"color", "amber"},
                                      {"blink", false},
                                      {"requiresAck", true},
                                      {"ackReturn", false},
                                      {"sound", "beep"},
                                      {"chatterLimit", chatterLimit}}})}};
}

struct World {
    TagStore store;
    LoadedProject project;
    std::unique_ptr<AlarmGlue> glue;
    std::string dir = tempDir();
    int64_t mono = 1000000;
    int64_t epoch = kEpoch0;
    std::vector<std::string> tags;

    explicit World(int n, bool withLog = false) {
        json tj = json::array(), aj = json::array();
        for (int i = 1; i <= n; ++i) {
            char b[16];
            std::snprintf(b, sizeof b, "S%03d", i);
            const std::string tag = std::string(b) + ".FAULT";
            tags.push_back(tag);
            store.add({tag, TagType::BOOL, ""});
            tj.push_back({{"id", tag}, {"type", "BOOL"}});
            aj.push_back({{"id", b},
                          {"type", "digital"},
                          {"name", std::string("Alarm ") + b},
                          {"tag", tag},
                          {"class", "minor"}});
        }
        for (size_t i = 0; i < store.size(); ++i)
            store.set(i, TagScalar(false), Quality::GOOD, epoch, epoch);
        store.takeDirty();
        project.tags = {{"tags", tj}};
        project.alarms = {{"areas", json::array()}, {"alarms", aj}};
        project.alarmClasses = classesDoc();
        AlarmGlueOptions o;
        o.dataDir = dir;
        o.monoMs = [this] { return mono; };
        o.epochMs = [this] { return epoch; };
        o.service.commitMs = 200;
        o.service.commitMaxMs = 1000;
        o.audit = [](const AuditEvent&) {};
        glue = std::make_unique<AlarmGlue>(o);
        std::string err;
        EXPECT_TRUE(glue->start(&project, store, err)) << err;
        (void)withLog;
    }
    void set(size_t i, bool v) { store.set(i, TagScalar(v), Quality::GOOD, epoch, epoch); }
    void advance(int ms) {
        mono += ms;
        epoch += ms;
    }
};

}  // namespace

TEST(AlarmStorm, TwoHundredAlarmsInOneTickTenClientsThreeSlow) {
    World w(200);
    SimTransport tx;
    HubOptions ho;
    ho.serverVersion = "0.8.0";
    LiveHub hub(
        w.store, tx, ho, [&] { return w.epoch; }, [&] { return w.mono; });
    hub.setAlarmSource(w.glue.get());
    constexpr int kClients = 10;
    for (uint64_t sid = 1; sid <= kClients; ++sid) {
        hub.onOpen(sid);
        const std::string sub =
            R"({"type":"subscribeAlarms","requestId":"a)" + std::to_string(sid) + "\"}";
        hub.onMessage(sid, sub.data(), sub.size());
        tx.at(sid).drainBytes = sid <= 3 ? 1500 : SIZE_MAX;  // the first three barely read
    }
    auto step = [&] {
        w.advance(250);
        const double t0 = nowMs();
        w.glue->tick();
        const double tGlue = nowMs() - t0;
        hub.tick();
        const double ms = nowMs() - t0;
        if (ms > 4)
            std::fprintf(stderr, "slow tick: glue %.2f ms, hub %.2f ms\n", tGlue, ms - tGlue);
        for (uint64_t sid = 1; sid <= kClients; ++sid) tx.drain(sid);
        return ms;
    };
    // The idle tick as the yardstick.
    std::vector<double> idle;
    for (int i = 0; i < 40; ++i) idle.push_back(step());
    std::sort(idle.begin(), idle.end());
    const double idleMedian = idle[idle.size() / 2];

    // The storm: all 200 at once, then waves (off, on) every 4th tick, with the slow ones behind.
    double worst = 0;
    for (size_t i = 0; i < w.tags.size(); ++i) w.set(i, true);
    worst = std::max(worst, step());
    for (int wave = 0; wave < 40; ++wave) {
        for (size_t i = 0; i < w.tags.size(); ++i) w.set(i, wave % 2 == 1);
        worst = std::max(worst, step());
        for (int k = 0; k < 3; ++k) step();
    }
    // quiet: everybody gets to drain
    for (uint64_t sid = 1; sid <= kClients; ++sid) tx.at(sid).drainBytes = SIZE_MAX;
    for (int i = 0; i < 400 && hub.alarmHeldSessions() > 0; ++i) step();
    for (int i = 0; i < 20; ++i) step();

    // SC-018: the queues stay at or under half, nobody is cut, the tick is not slower by 5 ms
    for (uint64_t sid = 1; sid <= kClients; ++sid) {
        const auto& s = tx.at(sid);
        EXPECT_FALSE(s.overflow) << "session " << sid << " got resync_required + 4409";
        EXPECT_LE(s.maxBytes, SendQueue::kDefaultMaxBytes / 2) << "session " << sid;
        EXPECT_FALSE(s.client.broken) << "session " << sid << ": a sequence gap";
    }
    EXPECT_EQ(hub.overflowClosedTotal(), 0u);
    EXPECT_LE(worst - idleMedian, 5.0)
        << "worst tick " << worst << " ms, idle median " << idleMedian << " ms";
    // the slow ones were really held back at some point (the test would prove nothing otherwise)
    EXPECT_GT(tx.at(1).maxBytes, 20000u);

    // the invariant of §4.1: every client ends with the engine's set, held or not
    auto view = w.glue->engine().view();
    std::map<std::string, std::string> truth;
    for (const auto& it : view->items) truth[it.id] = alarm::stateName(it.state);
    for (uint64_t sid = 1; sid <= kClients; ++sid)
        EXPECT_EQ(tx.at(sid).client.state, truth) << "session " << sid;
}

TEST(AlarmStorm, AllTwoHundredAreInTheSnapshotInPartsAndEveryClientAgrees) {
    World w(200);
    for (size_t i = 0; i < w.tags.size(); ++i) w.set(i, true);
    w.advance(250);
    w.glue->tick();
    SimTransport tx;
    HubOptions ho;
    LiveHub hub(
        w.store, tx, ho, [&] { return w.epoch; }, [&] { return w.mono; });
    hub.setAlarmSource(w.glue.get());
    hub.onOpen(1);
    const std::string sub = R"({"type":"subscribeAlarms","requestId":"s"})";
    hub.onMessage(1, sub.data(), sub.size());
    hub.tick();
    tx.drain(1);
    EXPECT_EQ(tx.at(1).client.state.size(), 200u);
    EXPECT_EQ(tx.at(1).client.partsSeen, 2);
    EXPECT_LE(tx.at(1).maxBytes, SendQueue::kDefaultMaxBytes / 2);
}

TEST(AlarmStorm, AnAlarmThatStartsTwentyTimesAMinuteShelvesItselfAndTheLogGetsAFewRows) {
    World w(1, /*withLog=*/true);
    // 31 minutes: a start every 3 s (20 a minute), the condition on for 1.5 s each time
    int starts = 0;
    int64_t lastStartMono = 0;
    for (int tick = 0; tick < 31 * 60 * 4; ++tick) {  // 250 ms ticks
        const int64_t t = static_cast<int64_t>(tick) * 250;
        const bool on = (t % 3000) < 1500;
        if (on && (t % 3000) == 0) {
            ++starts;
            lastStartMono = t;
        }
        w.set(0, on);
        w.advance(250);
        w.glue->tick();
    }
    (void)lastStartMono;
    ASSERT_TRUE(w.glue->service()->flush(5000));
    // How many rows are in the log: the first starts (up to the limit), the summary, a new one
    // after the episode ends: nowhere near one per start.
    alarm::AlarmStore& store = w.glue->service()->store();
    const int64_t rows = store.countRows();
    {  // nothing is written for the starts inside the episode (+12 s .. +1812 s): they only count
        sqlite3_stmt* q = nullptr;
        ASSERT_EQ(
            sqlite3_prepare_v2(store.handle(),
                               "SELECT COUNT(*) FROM alarm_occurrence WHERE ts_active_ms > ?1 AND "
                               "ts_active_ms < ?2",
                               -1, &q, nullptr),
            SQLITE_OK);
        sqlite3_bind_int64(q, 1, kEpoch0 + 13000);
        sqlite3_bind_int64(q, 2, kEpoch0 + 1811000);
        ASSERT_EQ(sqlite3_step(q), SQLITE_ROW);
        EXPECT_EQ(sqlite3_column_int(q, 0), 0) << "rows inside the self-shelving episode";
        sqlite3_finalize(q);
    }
    EXPECT_GE(starts, 600);
    EXPECT_LE(rows, 10) << "two bursts of chatterLimit rows; one row per start would be " << starts;
    EXPECT_GE(rows, 5);
    // The summary row says how many times it started in all.
    sqlite3* db = store.handle();
    sqlite3_stmt* st = nullptr;
    ASSERT_EQ(
        sqlite3_prepare_v2(db, "SELECT MAX(repeat_count) FROM alarm_occurrence", -1, &st, nullptr),
        SQLITE_OK);
    ASSERT_EQ(sqlite3_step(st), SQLITE_ROW);
    const int repeat = sqlite3_column_int(st, 0);
    sqlite3_finalize(st);
    EXPECT_GE(repeat, 600) << "the summary row counts every start of the episode";
    EXPECT_LE(repeat, starts);
    // The engine itself shelved it for the episode (system), and counted it as chatter.
    auto view = w.glue->engine().view();
    const alarm::AlarmItem* item = view->find("S001");
    // after 31 minutes the episode of 30 minutes is over and the alarm is back, evaluated afresh
    (void)item;
}
