#include "core/logic/schedule.hpp"

#include <algorithm>
#include <cstdio>
#include <map>

namespace mat::logic {

namespace {

constexpr int64_t kDayMs = 86400000;

int64_t floorDiv(int64_t a, int64_t b) {
    int64_t q = a / b;
    if ((a % b != 0) && ((a < 0) != (b < 0))) --q;
    return q;
}

int minutesOf(const std::string& hhmm) {
    if (hhmm.size() < 5) return 0;
    return ((hhmm[0] - '0') * 10 + (hhmm[1] - '0')) * 60 + (hhmm[3] - '0') * 10 + (hhmm[4] - '0');
}

bool hasDay(const nlohmann::json& days, int d) {
    if (!days.is_array()) return false;
    for (const auto& x : days)
        if (x.is_number() && x.get<double>() == d) return true;
    return false;
}

}  // namespace

CivilDate civilFromDays(int64_t days) {
    const int64_t z = days + 719468;
    const int64_t era = floorDiv(z, 146097);
    const int64_t doe = z - era * 146097;
    const int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    const int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const int64_t mp = (5 * doy + 2) / 153;
    const int64_t d = doy - (153 * mp + 2) / 5 + 1;
    const int64_t m = mp < 10 ? mp + 3 : mp - 9;
    CivilDate c;
    c.y = yoe + era * 400 + (m <= 2 ? 1 : 0);
    c.m = static_cast<int>(m);
    c.d = static_cast<int>(d);
    return c;
}

int isoWeekday(int64_t days) { return static_cast<int>((((days + 3) % 7) + 7) % 7) + 1; }

std::string dateKey(int64_t days) {
    const CivilDate c = civilFromDays(days);
    char buf[32];
    std::snprintf(buf, sizeof buf, "%04lld-%02d-%02d", static_cast<long long>(c.y), c.m, c.d);
    return buf;
}

bool scheduleAt(const nlohmann::json& s, int64_t epochMs, int tz) {
    const int64_t local = epochMs + static_cast<int64_t>(tz) * 60000;
    const int64_t day = floorDiv(local, kDayMs);
    const int64_t minute = (local - day * kDayMs) / 60000;
    std::map<std::string, std::string> exc;
    if (const auto it = s.find("exceptions"); it != s.end() && it->is_array())
        for (const auto& x : *it)
            if (x.is_object() && x.contains("date") && x["date"].is_string())
                exc[x["date"].get<std::string>()] =
                    x.contains("mode") && x["mode"].is_string() ? x["mode"].get<std::string>() : "";
    const auto today = exc.find(dateKey(day));
    if (today != exc.end()) return today->second == "on";
    const int dow = isoWeekday(day);
    const int prevDow = isoWeekday(day - 1);
    const bool prevFree = !exc.count(dateKey(day - 1));
    const auto weekly = s.find("weekly");
    if (weekly == s.end() || !weekly->is_array()) return false;
    for (const auto& w : *weekly) {
        if (!w.is_object()) continue;
        const int f = minutesOf(w.value("from", std::string()));
        const int t = minutesOf(w.value("to", std::string()));
        const nlohmann::json days = w.value("days", nlohmann::json::array());
        if (f < t) {
            if (hasDay(days, dow) && minute >= f && minute < t) return true;
        } else {
            if (hasDay(days, dow) && minute >= f) return true;
            if (prevFree && hasDay(days, prevDow) && minute < t) return true;
        }
    }
    return false;
}

CompiledSchedule::CompiledSchedule(const nlohmann::json& s) {
    if (const auto it = s.find("exceptions"); it != s.end() && it->is_array())
        for (const auto& x : *it)
            if (x.is_object() && x.contains("date") && x["date"].is_string())
                exc_[x["date"].get<std::string>()] =
                    x.contains("mode") && x["mode"].is_string() ? x["mode"].get<std::string>() : "";
    const auto weekly = s.find("weekly");
    hasWeekly_ = weekly != s.end() && weekly->is_array();
    if (!hasWeekly_) return;
    for (const auto& w : *weekly) {
        if (!w.is_object()) continue;
        Window win;
        win.from = minutesOf(w.value("from", std::string()));
        win.to = minutesOf(w.value("to", std::string()));
        const nlohmann::json days = w.value("days", nlohmann::json::array());
        for (int d = 1; d <= 7; ++d)
            if (hasDay(days, d)) win.days = static_cast<uint8_t>(win.days | (1u << d));
        weekly_.push_back(win);
    }
}

bool CompiledSchedule::at(int64_t epochMs, int tz) {
    const int64_t local = epochMs + static_cast<int64_t>(tz) * 60000;
    // the answer depends on the local minute only (64-bit divisions are slow on the BL335)
    if (minuteFrom_ && local >= *minuteFrom_ && local - *minuteFrom_ < 60000) return minuteValue_;
    const int64_t day = floorDiv(local, kDayMs);
    const int64_t minute = (local - day * kDayMs) / 60000;
    minuteFrom_ = day * kDayMs + minute * 60000;
    minuteValue_ = atMinute(day, minute);
    return minuteValue_;
}

bool CompiledSchedule::atMinute(int64_t day, int64_t minute) {
    if (day_ != day) {
        day_ = day;
        const auto today = exc_.find(dateKey(day));
        todayMode_.reset();
        if (today != exc_.end()) todayMode_ = today->second;
        prevFree_ = !exc_.count(dateKey(day - 1));
    }
    if (todayMode_) return *todayMode_ == "on";
    if (!hasWeekly_) return false;
    const unsigned dow = 1u << isoWeekday(day);
    const unsigned prevDow = 1u << isoWeekday(day - 1);
    for (const Window& w : weekly_) {
        if (w.from < w.to) {
            if ((w.days & dow) && minute >= w.from && minute < w.to) return true;
        } else {
            if ((w.days & dow) && minute >= w.from) return true;
            if (prevFree_ && (w.days & prevDow) && minute < w.to) return true;
        }
    }
    return false;
}

ScheduleBlock::ScheduleBlock(const nlohmann::json& def)
    : id_(blockId(def)), outTag_(stringOf(def, "out").value_or("")), def_(def) {
    if (const auto tz = numberOf(def, "tzOffsetMin")) tz_ = static_cast<int>(*tz);
    try {
        compiled_.emplace(def_);
        def_ = nlohmann::json();  // T147: read only when it could not be compiled
    } catch (const nlohmann::json::exception&) {
        compiled_.reset();  // read at each scan, as before (it throws there too)
    }
}

void ScheduleBlock::init(const SetOut& setOut) { setOut(outSlot_, TagScalar{}, "TIME_NOT_SYNCED"); }

bool ScheduleBlock::step(ScanCtx& ctx) {
    const WallClock* w = ctx.wall;
    const auto last = [&]() { return value_ ? TagScalar{*value_} : TagScalar{}; };
    if (!w || !w->synced || !w->epochMs) {
        bad_ = true;
        ctx.setOut(outSlot_, last(), "TIME_NOT_SYNCED");
        return true;
    }
    bad_ = false;
    const int tz = tz_ ? *tz_ : ctx.config->tzOffsetMin;
    value_ = compiled_ ? compiled_->at(*w->epochMs, tz) : scheduleAt(def_, *w->epochMs, tz);
    ctx.setOut(outSlot_, TagScalar{*value_});
    return true;  // the real-time clock: at every scan
}

BlockState ScheduleBlock::state(int64_t) const {
    BlockState s;
    s.kind = "schedule";
    s.state = "OK";
    if (bad_) s.reason = "TIME_NOT_SYNCED";
    return s;
}

}  // namespace mat::logic
