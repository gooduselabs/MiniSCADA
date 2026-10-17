// Schedules (T126, C++ half; FR-089; contracts/logic-engine.md §7), the table of
// packages/logic-engine/src/schedule.test.ts (>= 40 cases): half-open [from, to), a window across
// midnight belongs to its start day, exceptions, tzOffsetMin of the block and of the device,
// timeSynced, leap days, the change of year. 2026-10-19 is a Monday.
#include "core/logic/schedule.hpp"

#include <gtest/gtest.h>

#include "core/logic/tests/test_util.hpp"
#include "core/logic/tests/vector_runner.hpp"

using namespace mat;
using namespace mat::logic;
using namespace mat::logic::test;

namespace {

const json kDay = {{"days", {1, 2, 3, 4, 5}}, {"from", "06:00"}, {"to", "18:00"}};
const json kNight = {{"days", {1}}, {"from", "22:00"}, {"to", "06:00"}};
const json kAll = {1, 2, 3, 4, 5, 6, 7};
json win(json days, const char* f, const char* t) {
    return {{"days", std::move(days)}, {"from", f}, {"to", t}};
}

enum class W { F, T, BAD };

W outAt(json s, const char* wall, bool synced = true, int tz = 420) {
    json b = {{"id", "s"}, {"weekly", json::array({kDay})}, {"out", "L.S"}};
    for (auto it = s.begin(); it != s.end(); ++it) b[it.key()] = it.value();
    EngineOptions o;
    o.config.tzOffsetMin = tz;
    Engine e(json{{"schemaVersion", "1.0.0"}, {"schedules", json::array({b})}}, o);
    WallClock w;
    if (wall) w.epochMs = parseWall(wall);
    w.synced = synced;
    e.step(
        0, [](const std::string&) { return expr::InputValue{}; }, w);
    const Output* out = e.output("L.S");
    if (!out->good) {
        EXPECT_EQ(out->reason, "TIME_NOT_SYNCED");
        return W::BAD;
    }
    return std::get<bool>(out->value) ? W::T : W::F;
}

struct Case {
    const char* name;
    json s;
    const char* wall;
    W want;
    bool synced = true;
    int tz = 420;
};

std::vector<Case> cases() {
    const json night = json::array({kNight});
    const json sun = json::array({win({7}, "23:00", "02:00")});
    const json first = json::array({win(kAll, "00:00", "00:01")});
    const json last = json::array({win({1}, "23:59", "00:00")});
    const json two = json::array({win({1}, "08:00", "11:00"), win({1}, "13:00", "17:00")});
    const json overlap = json::array({win({1}, "08:00", "12:00"), win({1}, "10:00", "14:00")});
    const auto exc = [](const char* d, const char* m) {
        return json::array({{{"date", d}, {"mode", m}}});
    };
    const json e = json::object();
    return {
        {"mon 05:59", e, "2026-10-19T05:59:00+07:00", W::F},
        {"mon 06:00 closed start", e, "2026-10-19T06:00:00+07:00", W::T},
        {"mon 06:00:59", e, "2026-10-19T06:00:59+07:00", W::T},
        {"mon 12:00", e, "2026-10-19T12:00:00+07:00", W::T},
        {"mon 17:59:59", e, "2026-10-19T17:59:59+07:00", W::T},
        {"mon 18:00 open end", e, "2026-10-19T18:00:00+07:00", W::F},
        {"fri 10:00", e, "2026-10-23T10:00:00+07:00", W::T},
        {"sat 10:00", e, "2026-10-24T10:00:00+07:00", W::F},
        {"sun 10:00", e, "2026-10-25T10:00:00+07:00", W::F},
        {"UTC day differs from local day", e, "2026-10-18T23:30:00Z", W::T},
        {"night mon 22:00", {{"weekly", night}}, "2026-10-19T22:00:00+07:00", W::T},
        {"night mon 21:59", {{"weekly", night}}, "2026-10-19T21:59:00+07:00", W::F},
        {"night mon 23:59", {{"weekly", night}}, "2026-10-19T23:59:00+07:00", W::T},
        {"night tue 00:00 tail of mon", {{"weekly", night}}, "2026-10-20T00:00:00+07:00", W::T},
        {"night tue 05:59", {{"weekly", night}}, "2026-10-20T05:59:00+07:00", W::T},
        {"night tue 06:00 open", {{"weekly", night}}, "2026-10-20T06:00:00+07:00", W::F},
        {"night tue 22:00 no window", {{"weekly", night}}, "2026-10-20T22:00:00+07:00", W::F},
        {"night mon 03:00 tail of sun absent",
         {{"weekly", night}},
         "2026-10-19T03:00:00+07:00",
         W::F},
        {"sun to mon 01:00", {{"weekly", sun}}, "2026-10-19T01:00:00+07:00", W::T},
        {"sun to mon 02:00 open", {{"weekly", sun}}, "2026-10-19T02:00:00+07:00", W::F},
        {"00:00-00:01 at 00:00", {{"weekly", first}}, "2026-10-21T00:00:00+07:00", W::T},
        {"00:00-00:01 at 00:00:59", {{"weekly", first}}, "2026-10-21T00:00:59+07:00", W::T},
        {"00:00-00:01 at 00:01", {{"weekly", first}}, "2026-10-21T00:01:00+07:00", W::F},
        {"23:59-00:00 at 23:59", {{"weekly", last}}, "2026-10-19T23:59:30+07:00", W::T},
        {"23:59-00:00 tue 00:00", {{"weekly", last}}, "2026-10-20T00:00:00+07:00", W::F},
        {"two windows: the gap", {{"weekly", two}}, "2026-10-19T12:00:00+07:00", W::F},
        {"two windows: the second", {{"weekly", two}}, "2026-10-19T13:00:00+07:00", W::T},
        {"overlapping windows", {{"weekly", overlap}}, "2026-10-19T13:00:00+07:00", W::T},
        {"no window: always off", {{"weekly", json::array()}}, "2026-10-19T12:00:00+07:00", W::F},
        {"exception off",
         {{"exceptions", exc("2026-12-25", "off")}},
         "2026-12-25T10:00:00+07:00",
         W::F},
        {"exception another day",
         {{"exceptions", exc("2026-12-25", "off")}},
         "2026-12-24T10:00:00+07:00",
         W::T},
        {"exception on sat 00:00",
         {{"exceptions", exc("2026-10-24", "on")}},
         "2026-10-24T00:00:00+07:00",
         W::T},
        {"exception on 23:59",
         {{"exceptions", exc("2026-10-24", "on")}},
         "2026-10-24T23:59:59+07:00",
         W::T},
        {"exception on: day over",
         {{"exceptions", exc("2026-10-24", "on")}},
         "2026-10-25T00:00:00+07:00",
         W::F},
        {"exception by local day",
         {{"exceptions", exc("2026-12-25", "off")}},
         "2026-12-24T23:30:00Z",
         W::F},
        {"exception off of mon cancels its tail",
         {{"weekly", night}, {"exceptions", exc("2026-10-19", "off")}},
         "2026-10-20T02:00:00+07:00",
         W::F},
        {"exception on of tue overrides tue",
         {{"weekly", night}, {"exceptions", exc("2026-10-20", "on")}},
         "2026-10-20T12:00:00+07:00",
         W::T},
        {"block tz 0", {{"tzOffsetMin", 0}}, "2026-10-19T05:30:00Z", W::F},
        {"block tz 0 at 06:00 UTC", {{"tzOffsetMin", 0}}, "2026-10-19T06:00:00Z", W::T},
        {"block tz null: the device's",
         {{"tzOffsetMin", nullptr}},
         "2026-10-19T06:00:00+07:00",
         W::T},
        {"tz -300", {{"tzOffsetMin", -300}}, "2026-10-19T11:00:00Z", W::T},
        {"tz -300 at 10:59 UTC", {{"tzOffsetMin", -300}}, "2026-10-19T10:59:00Z", W::F},
        {"device tz 0", e, "2026-10-19T06:00:00Z", W::T, true, 0},
        {"tz 345", {{"tzOffsetMin", 345}}, "2026-10-19T00:15:00Z", W::T},
        {"tz 345 at 00:14 UTC", {{"tzOffsetMin", 345}}, "2026-10-19T00:14:00Z", W::F},
        {"leap 2028-02-29 tue",
         {{"weekly", json::array({win({2}, "00:00", "23:59")})}},
         "2028-02-29T12:00:00+07:00",
         W::T},
        {"leap day exception",
         {{"exceptions", exc("2028-02-29", "off")}},
         "2028-02-29T12:00:00+07:00",
         W::F},
        {"2027-01-01 fri",
         {{"weekly", json::array({win({5}, "00:00", "01:00")})}},
         "2027-01-01T00:30:00+07:00",
         W::T},
        {"across new year from thu",
         {{"weekly", json::array({win({4}, "23:00", "01:00")})}},
         "2027-01-01T00:30:00+07:00",
         W::T},
        {"2100-03-01 mon (2100 not leap)",
         {{"weekly", json::array({win({1}, "00:00", "23:59")})}},
         "2100-03-01T12:00:00+07:00",
         W::T},
        {"timeSynced false => BAD", e, "2026-10-19T12:00:00+07:00", W::BAD, false},
        {"no real-time clock => BAD", e, nullptr, W::BAD},
    };
}

}  // namespace

TEST(Schedule, AtLeast40Cases) { EXPECT_GE(cases().size(), 40u); }

TEST(Schedule, EveryCaseOfTheTable) {
    for (const Case& c : cases())
        EXPECT_EQ(static_cast<int>(outAt(c.s, c.wall, c.synced, c.tz)), static_cast<int>(c.want))
            << c.name;
}

TEST(Schedule, OutputChangesAtTheBoundaryAndBackToGoodWhenSynced) {
    EngineOptions o;
    Engine e(json{{"schemaVersion", "1.0.0"},
                  {"schedules",
                   json::array({{{"id", "s"}, {"weekly", json::array({kDay})}, {"out", "L.S"}}})}},
             o);
    const int64_t base = parseWall("2026-10-19T05:59:59.900+07:00");
    const ReadTag read = [](const std::string&) { return expr::InputValue{}; };
    e.step(0, read, {base, true});
    EXPECT_EQ(std::get<bool>(e.output("L.S")->value), false);
    e.step(100, read, {base + 100, true});
    EXPECT_EQ(std::get<bool>(e.output("L.S")->value), true);
    e.step(200, read, {base + 200, false});
    EXPECT_FALSE(e.output("L.S")->good);
    EXPECT_EQ(std::get<bool>(e.output("L.S")->value), true) << "the last value is kept";
    e.step(300, read, {base + 300, true});
    EXPECT_TRUE(e.output("L.S")->good);
    EXPECT_EQ(std::get<bool>(e.output("L.S")->value), true);
}

TEST(Schedule, CivilCalendar) {
    EXPECT_EQ(dateKey(0), "1970-01-01");
    EXPECT_EQ(isoWeekday(0), 4);   // Thursday
    EXPECT_EQ(isoWeekday(-1), 3);  // Wednesday
    EXPECT_EQ(dateKey(-1), "1969-12-31");
    EXPECT_EQ(dateKey(20745), "2026-10-19");
    EXPECT_EQ(isoWeekday(20745), 1);
}

// T148: the schedule read once (CompiledSchedule: its exceptions looked up when the local day
// changes, its answer kept for the local minute) answers as scheduleAt on the document every 13 s
// over three weeks, across exceptions, a window over midnight, its start day off, both offsets.
TEST(Schedule, TheCompiledScheduleAnswersAsTheDocumentAcrossDays) {
    const json s = {{"weekly", json::array({kDay, kNight, win({6, 7}, "10:00", "10:30"),
                                            win({3}, "23:00", "01:00")})},
                    {"exceptions", json::array({{{"date", "2026-10-21"}, {"mode", "off"}},
                                                {{"date", "2026-10-25"}, {"mode", "on"}},
                                                {{"date", "2026-10-26"}, {"mode", "off"}},
                                                {{"date", "2026-10-28"}, {"mode", "other"}}})}};
    for (const int tz : {420, -300}) {
        CompiledSchedule c(s);
        const int64_t from = parseWall("2026-10-18T00:00:00Z");
        int diffs = 0, on = 0;
        for (int64_t t = from; t < from + int64_t{21} * 86400000; t += 13000) {
            const bool want = scheduleAt(s, t, tz);
            if (c.at(t, tz) != want) ++diffs;
            if (want) ++on;
        }
        EXPECT_EQ(diffs, 0) << "tz " << tz;
        EXPECT_GT(on, 0);
    }
    // a window that cannot be read is not compiled: the block reads the document at each scan
    EXPECT_THROW(CompiledSchedule(json{{"weekly", json::array({{{"from", 6}}})}}),
                 nlohmann::json::exception);
}
