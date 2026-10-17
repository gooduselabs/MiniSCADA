// Schedules (contracts/logic-engine.md §7; research R23; packages/logic-engine/src/schedule.ts).
// Local time = UTC + tzOffsetMin (of the block, else of the device); no DST, no tzdata. The civil
// day by days-from-civil (H. Hinnant), weekday 1 Monday ... 7 Sunday. Half-open windows [from, to)
// by minute; from > to crosses midnight: the part after midnight belongs to the start day and
// counts only when that day has no exception. An exception overrides its whole local day. Clock
// not synced: BAD TIME_NOT_SYNCED (the last value kept).
#pragma once
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

class ScheduleBlock : public Block {
   public:
    explicit ScheduleBlock(const nlohmann::json& def);
    const std::string& id() const override { return id_; }
    void step(ScanCtx& ctx) override;
    BlockState state(int64_t now) const override;
    void retain(RetainMap&) const override {}
    void init(const SetOut& setOut) override;

   private:
    std::string id_;
    std::string outTag_;
    nlohmann::json def_;
    std::optional<int> tz_;
    std::optional<bool> value_;
    bool bad_ = true;
};

}  // namespace mat::logic
