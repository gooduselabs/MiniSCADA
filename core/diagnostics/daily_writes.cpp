#include "core/diagnostics/daily_writes.hpp"

namespace mat {

namespace {
constexpr int64_t kDayMs = 86400000;

int64_t floorDiv(int64_t a, int64_t b) {
    int64_t q = a / b;
    if ((a % b != 0) && ((a < 0) != (b < 0))) --q;
    return q;
}
}  // namespace

int64_t localDay(int64_t wallMs, int tzOffsetMin) {
    return floorDiv(wallMs + int64_t{tzOffsetMin} * 60000, kDayMs);
}

int64_t localMidnightMs(int64_t wallMs, int tzOffsetMin) {
    return localDay(wallMs, tzOffsetMin) * kDayMs - int64_t{tzOffsetMin} * 60000;
}

DailyWriteMeter::DailyWriteMeter(int tzOffsetMin) : tz_(tzOffsetMin) {}

void DailyWriteMeter::update(int64_t wallMs, const std::map<std::string, int64_t>& cumulative) {
    std::lock_guard<std::mutex> l(mu_);
    const int64_t day = localDay(wallMs, tz_);
    if (!started_) {
        // The first day: what the counters hold was written since the process started.
        started_ = true;
        day_ = day;
        sinceMs_ = wallMs;
        base_.clear();
    } else if (day != day_) {
        day_ = day;
        sinceMs_ = localMidnightMs(wallMs, tz_);
        base_ = cumulative;
    }
    last_ = cumulative;
}

WritesToday DailyWriteMeter::today() const {
    std::lock_guard<std::mutex> l(mu_);
    WritesToday t;
    t.sampled = started_;
    t.sinceMs = sinceMs_;
    for (const auto& [key, value] : last_) {
        auto b = base_.find(key);
        const int64_t d = value - (b == base_.end() ? 0 : b->second);
        t.bytes[key] = d > 0 ? d : 0;  // a counter that went down (restarted) counts nothing
    }
    return t;
}

ComponentWrites componentWrites(const WritesToday& t) {
    ComponentWrites c;
    c.sinceMs = t.sinceMs;
    const auto of = [&t](const char* key) {
        auto it = t.bytes.find(key);
        return it == t.bytes.end() ? int64_t{0} : it->second;
    };
    c.history = of(kWriteHistory);
    c.alarm = of(kWriteAlarm);
    c.audit = of(kWriteAudit);
    c.retain = of(kWriteRetain);
    c.logic = of(kWriteLogic);
    const int64_t sum = c.history + c.alarm + c.audit + c.retain + c.logic;
    auto process = t.bytes.find(kWriteProcess);
    if (process != t.bytes.end()) {
        c.source = "proc-self-io";
        c.total = process->second;
        // The kernel counts what went to the block layer, SQLite what it handed to write(): the
        // two may disagree by the page cache; never a negative rest.
        c.other = c.total > sum ? c.total - sum : 0;
    } else {
        c.source = "counters";
        c.total = sum;
    }
    return c;
}

}  // namespace mat
