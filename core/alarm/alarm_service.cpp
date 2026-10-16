// The service around alarm.db (contracts/alarm-store.md §5, §6, §8).
#include "core/alarm/alarm_service.hpp"
#include "core/common/thread_name.hpp"

#include <sys/statvfs.h>

#include <algorithm>
#include <chrono>

#include "nlohmann/json.hpp"

namespace mat::alarm {

namespace {
int64_t steadyMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}
int64_t systemMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}
}  // namespace

const char* logStateName(LogState s) {
    switch (s) {
        case LogState::Running:
            return "running";
        case LogState::Paused:
            return "paused";
        case LogState::Error:
            return "error";
    }
    return "error";
}

EventChanges changesOf(const AlarmEvent& e) {
    using nlohmann::json;
    EventChanges c;
    if (e.row) c.rows.push_back(*e.row);
    auto shelveRow = [&](const char* kind) {
        OverrideChange o;
        o.row.alarmId = e.instance;
        o.row.kind = kind;
        return o;
    };
    switch (e.kind) {
        case AlarmEvent::Kind::Shelve: {
            OverrideChange o = shelveRow("shelve");
            o.row.user = e.user;
            o.row.reason = e.reason;
            o.row.system = e.system;
            o.row.tsStartMs = e.tEpoch;
            o.row.clockOk = e.clockOk;
            o.row.tsEndMs = e.untilEpochMs;
            c.overrides.push_back(o);
            if (e.system) {
                json d = {{"reason", e.reason},
                          {"durationS", (e.untilEpochMs - e.tEpoch) / 1000},
                          {"count", e.count}};
                c.audit = SystemAudit{"alarm.shelve", e.instance, d.dump(), ""};
            }
            break;
        }
        case AlarmEvent::Kind::Unshelve: {
            OverrideChange o = shelveRow("shelve");
            o.remove = true;
            c.overrides.push_back(o);
            if (e.system) {
                json d = {{"reason", e.reason}};
                if (e.count > 0) d["count"] = e.count;
                c.audit = SystemAudit{"alarm.unshelve", e.instance, d.dump(), ""};
            }
            break;
        }
        case AlarmEvent::Kind::Disable: {
            OverrideChange o = shelveRow("disable");
            o.row.user = e.user;
            o.row.reason = e.reason;
            o.row.tsStartMs = e.tEpoch;
            o.row.clockOk = e.clockOk;
            c.overrides.push_back(o);
            break;
        }
        case AlarmEvent::Kind::Enable: {
            OverrideChange o = shelveRow("disable");
            o.remove = true;
            c.overrides.push_back(o);
            break;
        }
        case AlarmEvent::Kind::Removed: {
            OverrideChange o = shelveRow("shelve");
            o.remove = true;
            c.overrides.push_back(o);
            break;
        }
        default:
            break;
    }
    return c;
}

AlarmService::AlarmService(ServiceOptions opt)
    : opt_(std::move(opt)), store_(opt_.dir, opt_.nowEpochMs ? opt_.nowEpochMs : systemMs) {
    if (!opt_.nowEpochMs) opt_.nowEpochMs = systemMs;
    window_ = opt_.commitMs;
    failInject_ = opt_.testFailCommits;
}

AlarmService::~AlarmService() { stop(); }

int64_t AlarmService::freeBytes() const {
    if (opt_.freeBytes) return opt_.freeBytes();
    struct statvfs sv {};
    if (::statvfs(opt_.dir.c_str(), &sv) != 0) return int64_t(1) << 60;
    return static_cast<int64_t>(sv.f_bavail) * static_cast<int64_t>(sv.f_frsize);
}

size_t AlarmService::queued() const {
    std::lock_guard<std::mutex> l(mu_);
    return queue_.count();
}

bool AlarmService::start(std::string& err) {
    {
        std::lock_guard<std::mutex> l(mu_);  // R4: started_ is read under mu_ elsewhere
        if (started_) return true;
    }
    if (!store_.open(err)) {
        logState_ = LogState::Error;
        return false;
    }
    if (store_.recovered()) {
        recovered_ = true;
        auto files = store_.corruptFiles();
        std::string renamed = files.empty() ? "" : files.back();
        nlohmann::json d = {{"reason", "corrupt"}, {"renamedTo", renamed}};
        if (opt_.audit) opt_.audit(SystemAudit{"alarm.purged", "alarm.db", d.dump(), "DB_CORRUPT"});
    }
    {
        std::lock_guard<std::mutex> l(mu_);
        started_ = true;
        stop_ = false;
    }
    lastPurgeSteadyMs_ = steadyMs();
    dbBytes_ = store_.usedBytes();
    writer_ = std::thread([this] {
        setThreadName("mat-alarm-wr");
        writerLoop();
    });
    return true;
}

void AlarmService::stop() {
    {
        std::lock_guard<std::mutex> l(mu_);
        if (!started_) return;
        stop_ = true;
    }
    cv_.notify_all();
    if (writer_.joinable()) writer_.join();
    std::lock_guard<std::mutex> l(mu_);
    started_ = false;
}

LoadContext AlarmService::loadContext(int64_t nowMonoMs, int64_t nowEpochMs, bool clockOk,
                                      bool processStart) {
    LoadContext ctx;
    ctx.nowMonoMs = nowMonoMs;
    ctx.nowEpochMs = nowEpochMs;
    ctx.clockOk = clockOk;
    ctx.processStart = processStart;
    if (store_.isOpen()) {
        std::string err;
        ctx.open = store_.loadOpen(err);
        ctx.overrides = store_.loadOverrides(err);
        ctx.nextOccurrence = store_.nextOccurrence();
    }
    return ctx;
}

void AlarmService::applyLoadReport(const LoadReport& report) {
    if (report.staleOverrides.empty()) return;
    std::lock_guard<std::mutex> l(mu_);
    for (const auto& kv : report.staleOverrides) {
        OverrideChange o;
        o.remove = true;
        o.row.alarmId = kv.first;
        o.row.kind = kv.second;
        queue_.overrides.push_back(o);
    }
    if (firstPendingMs_ < 0) firstPendingMs_ = steadyMs();
    cv_.notify_all();
}

void AlarmService::trimBufferLocked() {
    while (queue_.count() > opt_.bufferMax) {
        auto it = std::find_if(queue_.rows.begin(), queue_.rows.end(),
                               [](const auto& kv) { return kv.second.closed; });
        if (it == queue_.rows.end()) break;  // only open rows left: they stay
        queue_.rows.erase(it);
        ++dropped_;
    }
}

void AlarmService::push(const std::vector<AlarmEvent>& events) {
    if (events.empty()) return;
    std::lock_guard<std::mutex> l(mu_);
    if (!started_) return;
    const int64_t now = steadyMs();
    size_t changes = 0;
    for (const AlarmEvent& e : events) {
        EventChanges ch = changesOf(e);
        for (auto& r : ch.rows) {
            maxOccurrence_ = std::max(maxOccurrence_, r.id);
            if (r.closed)
                liveOpen_.erase(r.id);
            else
                liveOpen_[r.id] = r;
            queue_.rows[r.id] = std::move(r);
            ++changes;
        }
        for (auto& o : ch.overrides) {
            queue_.overrides.push_back(std::move(o));
            ++changes;
        }
        if (ch.audit) queue_.audits.push_back(std::move(*ch.audit));
    }
    if (changes == 0) return;
    for (size_t k = 0; k < changes; ++k) stamps_.push_back(now);
    while (!stamps_.empty() && stamps_.front() < now - opt_.stormWindowMs) stamps_.pop_front();
    const bool storm = static_cast<int64_t>(stamps_.size()) * 1000 >
                       static_cast<int64_t>(opt_.stormChangesPerS) * opt_.stormWindowMs;
    window_ = storm ? opt_.commitMaxMs : opt_.commitMs;
    if (firstPendingMs_ < 0) firstPendingMs_ = now;
    trimBufferLocked();
    if (queue_.count() >= static_cast<size_t>(opt_.commitRows))
        cv_.notify_all();
    else if (queue_.count() == changes)
        cv_.notify_all();  // the writer re-computes its deadline
}

void AlarmService::resyncOpen() {
    std::lock_guard<std::mutex> l(mu_);
    for (const auto& kv : liveOpen_) queue_.rows[kv.first] = kv.second;
    if (!queue_.rows.empty() && firstPendingMs_ < 0) firstPendingMs_ = steadyMs();
}

bool AlarmService::flush(int timeoutMs) {
    std::unique_lock<std::mutex> l(mu_);
    flushRequested_ = true;
    cv_.notify_all();
    const bool ok = cv_.wait_for(l, std::chrono::milliseconds(timeoutMs), [&] {
        return (queue_.count() == 0 && queue_.audits.empty() && !inFlight_) || !started_;
    });
    flushRequested_ = false;
    return ok;
}

bool AlarmService::commitQueue(Queue& q) {
    // q is the batch taken from the queue; on failure it goes back (newer rows win)
    bool ok = true;
    std::string err;
    if (opt_.testCommitDelayMs > 0)
        std::this_thread::sleep_for(std::chrono::milliseconds(opt_.testCommitDelayMs));
    std::vector<OccurrenceRow> rows;
    rows.reserve(q.rows.size());
    for (auto& kv : q.rows) rows.push_back(kv.second);
    if (failInject_.load() > 0) {
        --failInject_;
        ok = false;
    } else {
        ok = store_.commit(rows, q.overrides, q.meta, err);
    }
    if (ok) {
        ++commits_;
        failures_ = 0;
        dbBytes_ = store_.usedBytes();
        if (logState_.load() == LogState::Error) logState_ = LogState::Running;
        if (opt_.audit)
            for (const auto& a : q.audits) opt_.audit(a);
        return true;
    }
    const bool corrupt = store_.lastErrorIsCorrupt();
    {
        std::lock_guard<std::mutex> l(mu_);
        for (auto& kv : q.rows)
            queue_.rows.emplace(kv.first, std::move(kv.second));  // a newer one stays
        queue_.overrides.insert(queue_.overrides.begin(), q.overrides.begin(), q.overrides.end());
        queue_.audits.insert(queue_.audits.begin(), q.audits.begin(), q.audits.end());
        for (auto& kv : q.meta) queue_.meta.emplace(kv.first, kv.second);
        trimBufferLocked();
        if (firstPendingMs_ < 0) firstPendingMs_ = steadyMs();
    }
    if (corrupt) {
        std::string e2;
        if (store_.replaceCorrupt(e2)) {
            recovered_ = true;
            auto files = store_.corruptFiles();
            nlohmann::json d = {{"reason", "corrupt"},
                                {"renamedTo", files.empty() ? "" : files.back()}};
            if (opt_.audit)
                opt_.audit(SystemAudit{"alarm.purged", "alarm.db", d.dump(), "DB_CORRUPT"});
            resyncOpen();
            return false;
        }
    }
    if (++failures_ >= opt_.errorAfterFailures) logState_ = LogState::Error;
    retryAtMs_ = steadyMs() + opt_.retryMs;
    return false;
}

void AlarmService::maintain() {
    const int64_t nowEpoch = opt_.nowEpochMs();
    const bool clock = opt_.clockOk ? opt_.clockOk(nowEpoch) : true;
    std::string err;
    int total = 0;
    if (clock) {
        for (int k = 0; k < 100 && !stop_; ++k) {
            const int n =
                store_.purgeExpired(nowEpoch, true, opt_.retentionDays, opt_.purgeBatch, err);
            if (n <= 0) break;
            total += n;
            std::this_thread::sleep_for(std::chrono::milliseconds(opt_.purgePauseMs));
        }
        if (total > 0 && opt_.audit) {
            nlohmann::json d = {
                {"reason", "retention"},
                {"rows", total},
                {"olderThanMs", nowEpoch - static_cast<int64_t>(opt_.retentionDays) * 86400000LL}};
            opt_.audit(SystemAudit{"alarm.purged", "alarm.db", d.dump(), ""});
        }
    }
    int bySize = 0;
    if (store_.usedBytes() > opt_.maxBytes) {
        const int64_t target = opt_.maxBytes / 100 * 95;
        for (int k = 0; k < 1000 && !stop_ && store_.usedBytes() > target; ++k) {
            const int n = store_.purgeOverSize(target, opt_.purgeBatch, err);
            if (n <= 0) break;
            bySize += n;
            std::this_thread::sleep_for(std::chrono::milliseconds(opt_.purgePauseMs));
        }
        if (bySize > 0 && opt_.audit) {
            nlohmann::json d = {{"reason", "size"}, {"rows", bySize}, {"bytes", opt_.maxBytes}};
            opt_.audit(SystemAudit{"alarm.purged", "alarm.db", d.dump(), ""});
        }
    }
    store_.setMeta("last_purge_ms", std::to_string(nowEpoch), err);
    dbBytes_ = store_.usedBytes();
}

void AlarmService::writerLoop() {
    bool paused = false;
    int64_t diskCheckAt = 0;  // steady ms of the next free-space check while paused
    while (true) {
        Queue batch;
        bool doCommit = false;
        {
            std::unique_lock<std::mutex> l(mu_);
            while (!stop_) {
                const int64_t now = steadyMs();
                // paused: the rows stay queued and wait for the disk; only the rest has work
                const bool have = paused ? (!queue_.overrides.empty() || !queue_.meta.empty() ||
                                            !queue_.audits.empty())
                                         : (queue_.count() > 0 || !queue_.audits.empty());
                int64_t wait = 1000;
                if (have) {
                    int64_t due = firstPendingMs_ < 0 ? now : firstPendingMs_ + window_.load();
                    if (queue_.count() >= static_cast<size_t>(opt_.commitRows) || flushRequested_)
                        due = now;
                    due = std::max(due, retryAtMs_);
                    wait = std::max<int64_t>(due - now, 0);
                    if (wait == 0) break;
                }
                if (paused) {
                    if (diskCheckAt <= now) break;
                    wait = std::min(wait, diskCheckAt - now);
                }
                const int64_t purgeIn =
                    lastPurgeSteadyMs_ + static_cast<int64_t>(opt_.purgeIntervalS) * 1000 - now;
                if (purgeIn <= 0) break;
                wait = std::min(wait, purgeIn);
                cv_.wait_for(l, std::chrono::milliseconds(std::max<int64_t>(wait, 1)));
            }
            if (stop_) {
                batch.rows.swap(queue_.rows);
                batch.overrides.swap(queue_.overrides);
                batch.meta.swap(queue_.meta);
                batch.audits.swap(queue_.audits);
                inFlight_ = true;
                if (paused)
                    batch.rows
                        .clear();  // history stays paused; overrides, meta and audits still go
                doCommit = true;
            } else if (queue_.count() > 0 || !queue_.audits.empty()) {
                // disk check: below the minimum the history stops, overrides and meta still go
                const int64_t fb = freeBytes();
                if (!paused && opt_.minFreeBytes > 0 && fb < opt_.minFreeBytes) {
                    paused = true;
                    logState_ = LogState::Paused;
                } else if (paused && fb >= opt_.minFreeBytes + opt_.minFreeBytes / 10) {
                    paused = false;
                    logState_ = LogState::Running;
                    for (const auto& kv : liveOpen_)
                        queue_.rows[kv.first] = kv.second;  // RAM over the old file
                }
                if (paused) diskCheckAt = steadyMs() + 1000;
                if (steadyMs() >= retryAtMs_) {
                    if (paused) {
                        batch.overrides.swap(queue_.overrides);
                        batch.meta.swap(queue_.meta);
                        // audits belong to overrides: send them with their commit
                        batch.audits.swap(queue_.audits);
                    } else {
                        batch.rows.swap(queue_.rows);
                        batch.overrides.swap(queue_.overrides);
                        batch.meta.swap(queue_.meta);
                        batch.audits.swap(queue_.audits);
                    }
                    doCommit = batch.rows.size() + batch.overrides.size() + batch.meta.size() +
                                   batch.audits.size() >
                               0;
                    if (doCommit) {
                        inFlight_ = true;
                        firstPendingMs_ = queue_.count() > 0 ? steadyMs() : -1;
                    }
                }
            } else if (paused) {
                diskCheckAt = steadyMs() + 1000;
                const int64_t fb = freeBytes();
                if (fb >= opt_.minFreeBytes + opt_.minFreeBytes / 10) {
                    paused = false;
                    logState_ = LogState::Running;
                }
            }
        }
        if (doCommit && (!batch.overrides.empty() || !batch.rows.empty() || !batch.meta.empty() ||
                         !batch.audits.empty())) {
            // while paused only overrides and meta are written; rows went back below
            commitQueue(batch);
            {
                std::lock_guard<std::mutex> l(mu_);
                inFlight_ = false;
            }
            cv_.notify_all();
        } else if (doCommit) {
            std::lock_guard<std::mutex> l(mu_);
            inFlight_ = false;
        }
        if (stop_) break;
        if (steadyMs() - lastPurgeSteadyMs_ >= static_cast<int64_t>(opt_.purgeIntervalS) * 1000 &&
            !paused && logState_.load() != LogState::Error) {
            lastPurgeSteadyMs_ = steadyMs();
            maintain();
        } else if (steadyMs() - lastPurgeSteadyMs_ >=
                   static_cast<int64_t>(opt_.purgeIntervalS) * 1000) {
            lastPurgeSteadyMs_ = steadyMs();
        }
        cv_.notify_all();
    }
    {
        std::lock_guard<std::mutex> l(mu_);
        inFlight_ = false;
    }
    store_.close(true);
    cv_.notify_all();
}

}  // namespace mat::alarm
