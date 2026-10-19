// Schedules (contracts/logic-engine.md §7; research R23; packages/logic-engine/src/schedule.ts).
// Local time = UTC + tzOffsetMin (of the block, else of the device); no DST, no tzdata. The civil
// day by days-from-civil (H. Hinnant), weekday 1 Monday ... 7 Sunday. Half-open windows [from, to)
// by minute; from > to crosses midnight: the part after midnight belongs to the start day and
// counts only when that day has no exception. An exception overrides its whole local day. Clock
// not synced: BAD TIME_NOT_SYNCED (the last value kept).
#pragma once
#include <map>
#include <optional>
#include <vector>

#include "core/logic/block.hpp"

namespace mat::logic {

struct CivilDate {
    int64_t y = 0;
    int m = 0, d = 0;
};
CivilDate civilFromDays(int64_t days);
int isoWeekday(int64_t days);
std::string dateKey(int64_t days);

// The value of schedule `s` at `epochMs` (UTC) with offset `tz` minutes.
bool scheduleAt(const nlohmann::json& s, int64_t epochMs, int tz);

// T148: a schedule read once (the exceptions, the windows and their days), the same answer as
// scheduleAt on its document; the exceptions of a day are looked up when the local day changes.
// Throws what reading the document by scheduleAt throws (a malformed window).
class CompiledSchedule {
   public:
    explicit CompiledSchedule(const nlohmann::json& s);
    bool at(int64_t epochMs, int tz);

   private:
    struct Window {
        int from = 0, to = 0;
        uint8_t days = 0;  // bit d: weekday d (1 Monday ... 7 Sunday)
    };
    std::map<std::string, std::string> exc_;
    bool hasWeekly_ = false;
    std::vector<Window> weekly_;
    // the local day of the last call and what its exceptions say
    std::optional<int64_t> day_;
    std::optional<std::string> todayMode_;
    bool prevFree_ = true;
    // the local minute of the last answer (its first ms) and that answer
    std::optional<int64_t> minuteFrom_;
    bool minuteValue_ = false;
    bool atMinute(int64_t day, int64_t minute);
};

class ScheduleBlock : public Block {
   public:
    explicit ScheduleBlock(const nlohmann::json& def);
    const std::string& id() const override { return id_; }
    void bind(const SlotOf& slotOf) override { outSlot_ = slotOf(outTag_); }
    void stepInputs(std::vector<uint32_t>&) const override {}
    bool step(ScanCtx& ctx) override;
    BlockState state(int64_t now) const override;
    void retain(RetainMap&) const override {}
    void init(const SetOut& setOut) override;

   private:
    std::string id_;
    std::string outTag_;
    uint32_t outSlot_ = kNoSlot;
    nlohmann::json def_;  // only when compiled_ is empty (T147)
    std::optional<CompiledSchedule> compiled_;  // none: a document scheduleAt reads at each scan
    std::optional<int> tz_;
    std::optional<bool> value_;
    bool bad_ = true;
};

}  // namespace mat::logic
