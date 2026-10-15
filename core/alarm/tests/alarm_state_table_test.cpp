// T023: the ISA-18.2 state table (data-model §5, SC-005): 4 states x 10 events = 40 cells, each
// checked in the table function and by driving the engine; impossible cells are not reachable.
#include <gtest/gtest.h>

#include "core/alarm/alarm_engine.hpp"
#include "core/alarm/tests/alarm_test_support.hpp"

using namespace mat::alarm;
using namespace mat::alarm::test;
using S = AlarmState;
using E = TableEvent;

namespace {
constexpr S N = S::Normal, AU = S::ActiveUnack, AA = S::ActiveAck, RU = S::RtnUnack;
const char* evName(E e) {
    static const char* n[] = {"On", "Off", "Ack", "AckReturn", "Shelve", "Unshelve", "Disable", "Enable",
                              "ConfigRemoved", "RestartReconcile"};
    return n[static_cast<int>(e)];
}

// The table written out once more from data-model §5. nullopt = "not reachable" (KTT).
// `condTrue` only matters for Unshelve of ACTIVE_ACK.
std::optional<S> oracle(S from, E ev, bool R, bool AR, bool condTrue = true) {
    switch (from) {
        case N:
            switch (ev) {
                case E::On: return R ? AU : AA;
                case E::Off: return std::nullopt;
                default: return N;  // Ack/AckReturn: NOT_ACTIVE; flags; removed; reconcile
            }
        case AU:
            switch (ev) {
                case E::On: return std::nullopt;
                case E::Off: return RU;
                case E::Ack: return AA;
                case E::AckReturn: return std::nullopt;
                case E::Shelve: case E::Unshelve: case E::RestartReconcile: return AU;
                case E::Disable: case E::ConfigRemoved: return N;
                case E::Enable: return std::nullopt;
            }
            break;
        case AA:
            switch (ev) {
                case E::On: return std::nullopt;
                case E::Off: return AR ? RU : N;
                case E::Ack: return AA;  // ALREADY_ACKED
                case E::AckReturn: return std::nullopt;
                case E::Shelve: case E::RestartReconcile: return AA;
                case E::Unshelve: return (R && condTrue) ? AU : AA;
                case E::Disable: case E::ConfigRemoved: return N;
                case E::Enable: return std::nullopt;
            }
            break;
        case RU:
            switch (ev) {
                case E::On: return AU;  // a new occurrence
                case E::Off: return std::nullopt;
                case E::Ack: return std::nullopt;
                case E::AckReturn: return N;
                case E::Shelve: case E::Unshelve: case E::RestartReconcile: return RU;
                case E::Disable: case E::ConfigRemoved: return N;
                case E::Enable: return std::nullopt;
            }
            break;
    }
    return std::nullopt;
}

// Brings a one-alarm rig to `from`; returns false when the class cannot reach it.
bool prepare(Rig& r, S from, bool R) {
    switch (from) {
        case N: return true;
        case AU:
            if (!R) return false;
            r.set("T.D", 1);
            r.tick();
            return r.state("D") == AU;
        case AA:
            r.set("T.D", 1);
            r.tick();
            if (R) r.ack("D", r.occurrence("D"));
            return r.state("D") == AA;
        case RU:
            if (!R) return false;
            r.set("T.D", 1);
            r.tick();
            r.set("T.D", 0);
            r.tick();
            return r.state("D") == RU;
    }
    return false;
}
}  // namespace

TEST(AlarmStateTable, TransitionFunctionMatchesTheDocumentForAllFortyCellsAndClassFlags) {
    int cells = 0;
    for (bool R : {false, true})
        for (bool AR : {false, true}) {
            if (AR && !R) continue;  // ackReturn means something only with requiresAck
            for (S from : {N, AU, AA, RU})
                for (int e = 0; e < 10; ++e) {
                    const E ev = static_cast<E>(e);
                    for (bool cond : {true, false}) {
                        auto got = AlarmEngine::transition(from, ev, R, AR, cond);
                        auto want = oracle(from, ev, R, AR, cond);
                        EXPECT_EQ(got.has_value(), want.has_value())
                            << stateName(from) << " " << evName(ev) << " R=" << R << " AR=" << AR;
                        if (got && want)
                            EXPECT_EQ(*got, *want) << stateName(from) << " " << evName(ev) << " R=" << R
                                                   << " AR=" << AR << " cond=" << cond;
                    }
                    if (R && AR) ++cells;
                }
        }
    EXPECT_EQ(cells, 40);
}

TEST(AlarmStateTable, TenImpossibleCells) {
    int impossible = 0;
    for (S from : {N, AU, AA, RU})
        for (int e = 0; e < 10; ++e)
            if (!AlarmEngine::transition(from, static_cast<E>(e), true, false)) ++impossible;
    EXPECT_EQ(impossible, 10);  // N+off, AU+on, AU+ack-return, AU+enable, AA+on, AA+ack-return, AA+enable, RU+off, RU+ack, RU+enable
}

namespace {
struct Drive {
    S start;
    E ev;
    bool R, AR;
};

// Applies `ev` to an engine in `start`; returns the state afterwards (Normal when the instance is gone).
S drive(Rig& r, S start, E ev) {
    switch (ev) {
        case E::On: r.set("T.D", 1); r.tick(); break;
        case E::Off: r.set("T.D", 0); r.tick(); break;
        case E::Ack:
        case E::AckReturn: r.ack("D", r.occurrence("D")); break;
        case E::Shelve: r.shelve("D"); break;
        case E::Unshelve: r.shelve("D"); r.simple(CommandKind::Unshelve, "D"); break;
        case E::Disable: r.simple(CommandKind::Disable, "D"); break;
        case E::Enable: r.simple(CommandKind::Disable, "D"); r.simple(CommandKind::Enable, "D"); break;
        case E::ConfigRemoved: {
            LoadContext ctx;
            ctx.nowMonoMs = r.mono;
            ctx.nowEpochMs = kEpoch0 + r.mono;
            ctx.processStart = false;
            r.eng.load(makeDefs(nlohmann::json::array(), classesJson()), ctx);
            r.drain();
            break;
        }
        case E::RestartReconcile: break;  // done by the caller
    }
    return r.state("D");
}
}  // namespace

TEST(AlarmStateTable, EngineFollowsTheTableForEveryReachableCell) {
    int driven = 0;
    struct Cls {
        bool R, AR;
    };
    for (Cls c : {Cls{true, false}, Cls{true, true}, Cls{false, false}})
        for (S from : {N, AU, AA, RU})
            for (int e = 0; e < 10; ++e) {
                const E ev = static_cast<E>(e);
                if (ev == E::RestartReconcile) continue;  // below
                Rig r(digitalDefs(c.R, c.AR));
                if (!prepare(r, from, c.R)) continue;
                auto want = oracle(from, ev, c.R, c.AR);
                if (!want) continue;  // not reachable: the engine cannot be driven there
                // Enable of a non-disabled alarm is not a cell of the table (NOT_DISABLED, no change);
                // from N the table says N: drive disable then enable.
                if (ev == E::Enable && from != N) continue;
                const S got = drive(r, from, ev);
                EXPECT_EQ(got, *want) << stateName(from) << " " << evName(ev) << " R=" << c.R << " AR=" << c.AR;
                ++driven;
            }
    EXPECT_GE(driven, 40);
}

TEST(AlarmStateTable, ImpossibleCellsAreNotReachedByTheEngine) {
    // AU + on: the condition is already true, a second start does not exist (one occurrence).
    Rig r(digitalDefs());
    r.set("T.D", 1);
    r.tick();
    r.run(2000);
    int starts = 0;
    for (const auto& e : r.events)
        if (e.kind == AlarmEvent::Kind::State) ++starts;
    EXPECT_EQ(starts, 1);
    // RU + off, N + off: a return is only ever sent for the state that has a start
    Rig q(digitalDefs());
    q.set("T.D", 0);
    q.run(2000);
    EXPECT_TRUE(q.events.empty());
    // AU + ack-return and RU + ack: the one "ack" command picks the cell by the state
    Rig u(digitalDefs());
    u.set("T.D", 1);
    u.tick();
    EXPECT_EQ(u.ack("D", 1).result, "ACKED");
    EXPECT_EQ(u.state("D"), AA);  // ack on AU is not an ack-return
    u.set("T.D", 0);
    u.tick();
    EXPECT_EQ(u.state("D"), N);
}

TEST(AlarmStateTable, RestartReconcileRebuildsTheStateFromTheRow) {
    for (S from : {AU, AA, RU}) {
        Rig r(digitalDefs());
        ASSERT_TRUE(prepare(r, from, true));
        // the last row of the instance as the store would hold it
        OccurrenceRow row;
        for (const auto& e : r.events)
            if (e.row) row = *e.row;
        ASSERT_FALSE(row.closed);
        AlarmEngine e2;
        LoadContext ctx;
        ctx.open = {row};
        ctx.nowMonoMs = 1000;
        ctx.nowEpochMs = kEpoch0 + 1000;
        e2.load(r.defs, ctx);
        auto v = e2.view();
        const AlarmItem* it = v->find("D");
        ASSERT_NE(it, nullptr) << stateName(from);
        EXPECT_EQ(it->state, from);
        EXPECT_EQ(it->occurrence, row.id);
    }
    // N: no open row, no item
    AlarmEngine e3;
    Rig r3(digitalDefs());
    LoadContext ctx;
    e3.load(r3.defs, ctx);
    EXPECT_EQ(e3.view()->find("D"), nullptr);
}

TEST(AlarmStateTable, ShelvedAndDisabledFlagsAreIndependentOfTheState) {
    Rig r(digitalDefs());
    r.shelve("D");
    r.simple(CommandKind::Disable, "D");
    auto v = r.eng.view();
    ASSERT_NE(v->find("D"), nullptr);
    EXPECT_TRUE(v->find("D")->disabled);
    EXPECT_FALSE(v->find("D")->shelve.has_value());  // disabling lifts the shelve (README 5)
    EXPECT_EQ(v->find("D")->state, N);
    // on/off are evaluated while shelved (FR-031): ISA state still moves
    Rig q(digitalDefs());
    q.shelve("D");
    q.set("T.D", 1);
    q.tick();
    EXPECT_EQ(q.state("D"), AU);
    q.set("T.D", 0);
    q.tick();
    EXPECT_EQ(q.state("D"), RU);
}
