#include "core/historian/historian.hpp"

#include <sys/statvfs.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <set>

#include "core/historian/clock.hpp"
#include "sqlite3.h"

namespace mat {

namespace {
constexpr int64_t kJumpMs = 1000;  // same rule as GroupSampler
constexpr int64_t kPassMs = 100;
constexpr int64_t kDayMs = 86400000;
constexpr int64_t kMarkRetryMaxMs = 60000;  // longest wait between two tries on the marks
constexpr size_t kMaxAggBuffered = 100000;  // closed windows kept while the file cannot be written

int64_t floorTo(int64_t t, int64_t res) {
    int64_t r = t % res;
    if (r < 0) r += res;
    return t - r;
}
int64_t hourStartOf(int64_t t) { return floorTo(t, kAggHourMs); }
// A clock this far past the build is wrong too (RTC set to 2099): logging with it, and above all
// running retention with it, would delete real data.
constexpr int64_t kMaxClockAheadMs = 30LL * 365 * kDayMs;

bool damagedFile(int rc) {
    rc &= 0xff;
    return rc == SQLITE_CORRUPT || rc == SQLITE_NOTADB;
}

int64_t statvfsFree(const std::string& dir) {
    struct statvfs s {};
    if (::statvfs(dir.c_str(), &s) != 0) return -1;
    return static_cast<int64_t>(s.f_bavail) * static_cast<int64_t>(s.f_frsize);
}
}  // namespace

const char* historianStateName(HistorianState s) {
    switch (s) {
        case HistorianState::ClockInvalid:
            return "clock_invalid";
        case HistorianState::PausedLowDisk:
            return "paused_low_disk";
        case HistorianState::Error:
            return "error";
        default:
            return "running";
    }
}

Historian::Historian(LoggingModel model, const TagStore& store, HistorianOptions opt,
                     std::function<int64_t()> nowUtc, std::function<int64_t()> nowMono)
    : model_(std::move(model)),
      tags_(store),
      opt_(std::move(opt)),
      nowUtc_(std::move(nowUtc)),
      nowMono_(std::move(nowMono)),
      local_(opt_.dataDir, nowUtc_),
      io_(opt_.ioSource ? IoMeter(opt_.ioSource) : IoMeter()) {
    for (size_t i = 0; i < model_.groups.size(); ++i) {
        samplers_.emplace_back(model_.groups[i], i, model_.offsetMin);
        std::vector<size_t> idx;
        for (const auto& c : model_.groups[i].columns) idx.push_back(c.tagIndex);
        indices_.push_back(std::move(idx));
        if (model_.groups[i].trigger)
            triggerIdx_.push_back(model_.groups[i].trigger->tagIndex);
        else
            triggerIdx_.push_back(std::nullopt);
    }
    counters_.resize(model_.groups.size());
    aggGroups_.resize(model_.groups.size());
}

Historian::~Historian() { stop(); }

std::vector<TableSpec> Historian::tableSpecs() const {
    std::vector<TableSpec> specs;
    for (const auto& g : model_.groups) {
        TableSpec s;
        s.table = g.table;
        s.groupId = g.id;
        s.retentionDays = g.retentionDays;
        for (const auto& c : g.columns) s.columns.push_back({c.column, sqliteAffinity(c.type)});
        if (g.aggregates) {
            s.aggMinuteDays = g.aggregates->minuteRetentionDays;
            s.aggHourDays = g.aggregates->hourRetentionDays;
            for (size_t ci : g.aggregateColumns()) s.aggColumns.push_back(g.columns[ci].column);
        }
        specs.push_back(std::move(s));
    }
    return specs;
}

bool Historian::open(std::string& err) {
    if (!local_.open(err)) return false;
    if (!local_.ensureTables(tableSpecs(), err)) return false;
    fileId_ = local_.instanceId();
    if (local_.recovered())
        setError("corrupt_recovered", "history.db không đọc được: đã đổi tên và tạo file mới",
                 nowUtc_());
    opened_ = true;
    if (forwarders_.empty()) createForwarders();
    lastCommitMono_ = nowMono_();
    checkDueMono_ = lastCommitMono_;  // capacity check and retention right at start
    retentionDueMono_ = lastCommitMono_;
    setupAggregates();
    std::lock_guard<std::mutex> g(statusMu_);
    status_.dbMaxBytes = opt_.maxDbBytes;
    status_.dbBytes = local_.usedBytes();
    status_.schema = local_.schema();
    for (size_t i = 0; i < model_.groups.size(); ++i) {
        HistorianStatus::GroupInfo gi;
        gi.id = model_.groups[i].id;
        gi.mode = model_.groups[i].mode == LogMode::Cyclic    ? "cyclic"
                  : model_.groups[i].mode == LogMode::Trigger ? "trigger"
                                                              : "onChange";
        gi.aggregates = aggGroups_[i].enabled;
        if (model_.groups[i].mode == LogMode::Trigger) gi.triggerState = "unknown";
        status_.groups.push_back(gi);
    }
    return true;
}

void Historian::maintain(int64_t nowUtc, int64_t nowMono, bool clockOk) {
    if (!opened_) return;
    std::string err;
    // Capacity: every checkEveryMs (research R4).
    if (nowMono >= checkDueMono_) {
        checkDueMono_ = nowMono + opt_.checkEveryMs;
        const int64_t used = local_.usedBytes();
        const int64_t free =
            opt_.freeBytes ? opt_.freeBytes(opt_.dataDir) : statvfsFree(opt_.dataDir);
        if (free >= 0) {
            if (free < opt_.minFreeBytes)
                paused_ = true;
            else if (paused_ && free > opt_.minFreeBytes + opt_.resumeExtraBytes)
                paused_ = false;
        }
        bool newPurge = false;
        if (!purging_ && used > opt_.maxDbBytes) purging_ = newPurge = true;
        std::lock_guard<std::mutex> g(statusMu_);
        status_.dbBytes = used;
        status_.freeBytes = free;
        if (newPurge) ++status_.capPurges;
    }
    // Above the cap: one batch of the oldest rows per pass until below 90 %.
    if (purging_) {
        // D25: raw rows first; when there are none left, the oldest minute buckets, then hours.
        int kind = 0;
        int n = local_.purgeOldest(opt_.batchRows, err);
        if (n == 0) {
            kind = 1;
            n = local_.purgeOldestAgg(kAggMinuteMs, opt_.batchRows, err);
        }
        if (n == 0) {
            kind = 2;
            n = local_.purgeOldestAgg(kAggHourMs, opt_.batchRows, err);
        }
        if (n < 0 && damagedFile(local_.lastErrorCode())) maintenanceDamage_ = true;
        const int64_t used = local_.usedBytes();
        if (n <= 0 || used < opt_.maxDbBytes / 10 * 9) purging_ = false;
        std::lock_guard<std::mutex> g(statusMu_);
        if (n > 0) {
            const auto cnt = static_cast<uint64_t>(n);
            (kind == 0 ? status_.capRowsDeleted
                       : kind == 1 ? status_.capRowsDeletedMinute : status_.capRowsDeletedHour) += cnt;
        }
        status_.dbBytes = used;
        return;  // one heavy step per pass
    }
    // Retention: at start, then every hour, one batch per pass; never with a wrong clock.
    if (!clockOk) return;
    if (!retentionActive_ && nowMono >= retentionDueMono_) {
        retentionQueue_.clear();
        for (const auto& t : local_.retentionTargets()) retentionQueue_.push_back({0, t.first, t.second});
        for (const auto& t : local_.aggRetentionTargets()) {
            retentionQueue_.push_back({1, t.table, t.minuteDays});
            retentionQueue_.push_back({2, t.table, t.hourDays});
        }
        retentionIdx_ = 0;
        retentionRows_ = 0;
        retentionActive_ = true;
    }
    if (!retentionActive_) {
        backfillStep(nowUtc);  // idle: build the buckets of data that was logged before (§5)
        return;
    }
    if (retentionIdx_ < retentionQueue_.size()) {
        const auto& target = retentionQueue_[retentionIdx_];
        const int64_t cutoff = nowUtc - int64_t{target.days} * kDayMs;
        const int n = target.kind == 0
                          ? local_.deleteExpired(target.table, cutoff, opt_.batchRows, err)
                          : local_.deleteExpiredAgg(target.table,
                                                    target.kind == 1 ? kAggMinuteMs : kAggHourMs,
                                                    cutoff, opt_.batchRows, err);
        if (n < 0 && damagedFile(local_.lastErrorCode())) maintenanceDamage_ = true;
        if (n > 0) retentionRows_ += static_cast<uint64_t>(n);
        if (n < opt_.batchRows) ++retentionIdx_;  // done with this table (or it failed)
    }
    if (retentionIdx_ >= retentionQueue_.size()) {
        retentionActive_ = false;
        retentionDueMono_ = nowMono + opt_.retentionEveryMs;
        const int64_t used = local_.usedBytes();
        std::lock_guard<std::mutex> g(statusMu_);
        status_.lastRetentionAt = nowUtc;
        status_.lastRetentionRows = retentionRows_;
        status_.dbBytes = used;
    }
}

void Historian::createForwarders() {
    struct Planned {
        ConnectionModel conn;
        std::vector<ForwardGroup> groups;
        std::unique_ptr<Destination> dest;
    };
    std::vector<Planned> planned;
    std::vector<LocalStore::MarkKey> keys;
    for (const auto& c : model_.connections) {
        std::vector<ForwardGroup> groups;
        for (const auto& g : model_.groups) {
            if (std::find(g.destinations.begin(), g.destinations.end(), c.id) ==
                g.destinations.end())
                continue;
            ForwardGroup fg;
            fg.groupId = g.id;
            fg.table.name = g.table;
            for (const auto& col : g.columns)
                fg.table.columns.push_back({col.column, col.type, col.maxLength});
            groups.push_back(std::move(fg));
        }
        if (groups.empty()) continue;  // declared but unused: no thread, no status entry
        auto dest =
            opt_.makeDestination ? opt_.makeDestination(c) : makeDestination(c, opt_.clientLibDir);
        // Review C1: a SQL destination keeps its own cursor. A mark of what history.db had at open,
        // kept until that cursor was compared with it, tells the forwarder whether the
        // destination holds rows the device lost (power cut) whose seq values come again.
        if (dest && dest->transactional())
            for (const auto& g : groups) keys.emplace_back(forwardCursorKey(c), g.table.name);
        planned.push_back({c, std::move(groups), std::move(dest)});
    }
    markKeys_ = keys;
    std::map<LocalStore::MarkKey, int64_t> marks;  // before the first commit
    std::string err;
    if (!storeMarks(marks, err)) {  // the SQL groups wait until a later try stores them
        marksPending_ = true;
        marksBackoffMs_ = opt_.retryMs;
        marksRetryAtMono_ = nowMono_() + marksBackoffMs_;
        setError("io", "mat_forward_mark: " + err, nowUtc_());
    }
    for (auto& p : planned) {
        const std::string key = forwardCursorKey(p.conn);
        for (auto& g : p.groups) {
            const LocalStore::MarkKey k{key, g.table.name};
            const auto it = marks.find(k);
            if (it != marks.end())
                g.seqAtOpen = it->second;
            else if (marksPending_ && std::find(keys.begin(), keys.end(), k) != keys.end())
                g.seqAtOpen = ForwardGroup::kMarkPending;
            else
                g.seqAtOpen = -1;
        }
        ForwarderOptions fo;
        fo.dbPath = local_.path();
        if (opt_.secret) {
            fo.secret = opt_.secret;
        } else {
            const std::string file = opt_.secretsFile;
            fo.secret = [file](const std::string& id) { return readSecret(file, id); };
        }
        forwarders_.push_back(std::make_unique<Forwarder>(
            p.conn, std::move(p.groups), std::move(p.dest), fo, nowUtc_, nowMono_));
        forwarderKeys_.push_back(key);
    }
}

bool Historian::storeMarks(std::map<LocalStore::MarkKey, int64_t>& marks, std::string& err) {
    // The seq of a table when the file was opened, read once: a mark stored only at a later try
    // must still be the one of the start, not what the commits since then brought.
    for (const auto& k : markKeys_)
        if (!markAtOpen_.count(k)) {
            const auto seq = local_.lastSeqEver(k.second);
            if (!seq) {
                err = "sqlite_sequence of " + k.second + " cannot be read";
                return false;
            }
            markAtOpen_[k] = *seq;
        }
    return local_.keepForwardMarks(markAtOpen_, marks, err);
}

void Historian::retryMarks(int64_t nowUtc, int64_t nowMono) {
    if (!marksPending_ || nowMono < marksRetryAtMono_ || !opened_ || !local_.isOpen()) return;
    std::map<LocalStore::MarkKey, int64_t> marks;
    std::string err;
    if (!storeMarks(marks, err)) {
        marksBackoffMs_ = std::min(marksBackoffMs_ * 2, kMarkRetryMaxMs);
        marksRetryAtMono_ = nowMono + marksBackoffMs_;
        setError("io", "mat_forward_mark: " + err, nowUtc);
        return;
    }
    marksPending_ = false;
    for (size_t i = 0; i < forwarders_.size(); ++i) {
        std::map<std::string, int64_t> mine;
        for (const auto& [k, mark] : marks)
            if (k.first == forwarderKeys_[i]) mine[k.second] = mark;
        if (!mine.empty()) forwarders_[i]->provideMarks(mine);
    }
}

void Historian::processMarks(int64_t nowUtc, int64_t nowMono) {
    for (size_t i = 0; i < forwarders_.size(); ++i)
        for (auto& t : forwarders_[i]->takeCheckedMarks()) pendingMarks_[i].insert(t);
    if (pendingMarks_.empty() || !opened_ || !local_.isOpen() || nowMono < clearRetryAtMono_)
        return;
    std::vector<LocalStore::MarkKey> keys;
    for (const auto& [i, tables] : pendingMarks_)
        for (const auto& t : tables) keys.emplace_back(forwarderKeys_[i], t);
    std::string err;
    if (!local_.clearForwardMarks(keys, err)) {  // the groups wait; tried again later and later
        clearBackoffMs_ =
            clearBackoffMs_ == 0 ? opt_.retryMs : std::min(clearBackoffMs_ * 2, kMarkRetryMaxMs);
        clearRetryAtMono_ = nowMono + clearBackoffMs_;
        setError("io", "mat_forward_mark: " + err, nowUtc);
        return;
    }
    clearBackoffMs_ = 0;
    clearRetryAtMono_ = 0;
    for (const auto& [i, tables] : pendingMarks_)
        forwarders_[i]->marksCleared(std::vector<std::string>(tables.begin(), tables.end()));
    pendingMarks_.clear();
}

void Historian::checkDamage(int64_t nowUtc) {
    bool damaged = maintenanceDamage_;
    maintenanceDamage_ = false;
    for (auto& f : forwarders_) {
        const std::string id = f->takeCorruptFile();
        if (!id.empty() && id == fileId_) damaged = true;  // not a file replaced already
    }
    if (damaged && opened_ && local_.isOpen())
        replaceDamagedFile(nowUtc, "damaged page found while reading or cleaning history.db");
}

void Historian::replaceDamagedFile(int64_t nowUtc, const std::string& why) {
    std::string e;
    if (local_.replaceCorrupt(e) && local_.ensureTables(tableSpecs(), e)) {
        setError("corrupt_recovered", why, nowUtc);
        followNewFile();
    } else {
        std::fprintf(stderr, "historian: new history.db: %s\n", e.c_str());
        local_.close();  // made again at the next attempt
    }
}

void Historian::followNewFile() {
    cursors_.clear();       // cursors of the old file
    pendingMarks_.clear();  // marks of the old file: a new file (new instance id) needs none
    clearRetryAtMono_ = 0;
    clearBackoffMs_ = 0;
    markAtOpen_.clear();
    marksPending_ = false;
    retentionActive_ = false;
    purging_ = false;
    fileId_ = local_.instanceId();
    setupAggregates();  // a new file: new aggregate state, a new run
    for (auto& f : forwarders_) f->reopen();
}

// ---------------------------------------------------------------- aggregate tables

namespace {
std::optional<double> cellValue(const Cell& c) {
    if (const auto* d = std::get_if<double>(&c)) return std::isfinite(*d) ? std::optional(*d) : std::nullopt;
    if (const auto* i = std::get_if<int64_t>(&c)) return static_cast<double>(*i);
    if (const auto* u = std::get_if<uint64_t>(&c)) return static_cast<double>(*u);
    if (const auto* b = std::get_if<bool>(&c)) return *b ? 1.0 : 0.0;
    return std::nullopt;  // NULL and text
}
}  // namespace

void Historian::RowCounter::add(int64_t nowUtc) {
    const int64_t h = floorTo(nowUtc, kAggHourMs) / kAggHourMs;
    const size_t k = static_cast<size_t>(((h % 24) + 24) % 24);
    if (hour[k] != h) {
        hour[k] = h;
        count[k] = 0;
    }
    ++count[k];
}

int64_t Historian::RowCounter::last24h(int64_t nowUtc) const {
    const int64_t h = floorTo(nowUtc, kAggHourMs) / kAggHourMs;
    int64_t sum = 0;
    for (size_t k = 0; k < 24; ++k)
        if (hour[k] > h - 24 && hour[k] <= h) sum += count[k];
    return sum;
}

std::vector<std::optional<double>> Historian::aggValues(size_t gi,
                                                        const std::vector<Cell>& cells) const {
    const auto& ag = aggGroups_[gi];
    std::vector<std::optional<double>> v(ag.cols.size());
    for (size_t i = 0; i < ag.cols.size(); ++i)
        if (ag.cols[i] < cells.size()) v[i] = cellValue(cells[ag.cols[i]]);
    return v;
}

void Historian::setupAggregates() {
    aggOn_ = false;
    aggActive_ = false;
    aggBuffer_.clear();
    markBuffer_.clear();
    runStarted_ = false;
    int groups = 0;
    for (size_t gi = 0; gi < model_.groups.size(); ++gi) {
        aggGroups_[gi] = AggGroup{};
        auto& ag = aggGroups_[gi];
        const auto& grp = model_.groups[gi];
        if (!local_.aggregatesAvailable() || !grp.aggregates) continue;
        ag.cols = grp.aggregateColumns();
        if (ag.cols.empty()) continue;
        for (size_t ci : ag.cols) ag.colNames.push_back(grp.columns[ci].column);
        ag.agg = std::make_unique<GroupAggregator>(ag.cols.size());
        ag.enabled = true;
        ++groups;
        aggOn_ = true;
        const auto st = local_.aggState(grp.table);
        if (st && st->builtTo)
            recoverGroup(gi, *st->builtTo);
        else
            ag.initPending = true;  // needs a valid clock (initAggState)
        if (st && st->backTo) {
            ag.backfillActive = true;
            ag.backTo = ag.backFrom = *st->backTo;
        }
    }
    std::lock_guard<std::mutex> g(statusMu_);
    status_.aggEnabled = aggOn_;
    status_.aggGroups = groups;
    status_.schema = local_.schema();
    if (local_.schema() < 2 && !local_.schemaError().empty() && status_.lastErrorCode.empty()) {
        status_.lastErrorCode = "io";
        status_.lastErrorMessage = "history.db schema 2: " + local_.schemaError();
        status_.lastErrorAt = nowUtc_();
    }
}

void Historian::queueHourRebuild(int64_t hourStart) {
    for (size_t gi = 0; gi < aggGroups_.size(); ++gi) {
        if (!aggGroups_[gi].enabled) continue;
        for (size_t c = 0; c < aggGroups_[gi].cols.size(); ++c) {
            AggWrite w;
            w.spec = gi;
            w.col = c;
            w.res = kAggHourMs;
            w.bucket = hourStart;
            w.rebuildHour = true;
            aggBuffer_.push_back(w);
        }
    }
}

// Restart after a stop or a crash (§4): the raw rows from `agg_built_to` on were not aggregated;
// build them with a fresh accumulator (the signal does not carry over a restart) and write the
// minutes with the merging upsert. Streams in chunks and moves the mark as it goes, so that a
// crash during recovery does not count a minute twice.
void Historian::recoverGroup(size_t gi, int64_t builtTo) {
    auto& ag = aggGroups_[gi];
    const auto& grp = model_.groups[gi];
    GroupAggregator ta(ag.cols.size());
    std::vector<AggWrite> out;
    std::set<int64_t> hours;
    std::vector<AggOut> drained;
    std::string err;
    int64_t lastTs = -1;
    int64_t curTs = builtTo - 1;
    int64_t curSeq = -1;
    auto collect = [&] {
        drained.clear();
        ta.drain(drained);
        for (const auto& o : drained) {
            if (o.res != kAggMinuteMs) continue;
            AggWrite w;
            w.spec = gi;
            w.col = o.col;
            w.res = kAggMinuteMs;
            w.bucket = o.bucket;
            w.agg = o.agg;
            out.push_back(w);
            hours.insert(hourStartOf(o.bucket));
        }
    };
    auto flush = [&](bool final) {
        AggMark m;
        m.spec = gi;
        m.setBuiltTo = true;
        m.builtTo = final ? floorTo(lastTs, kAggMinuteMs) + kAggMinuteMs
                          : floorTo(lastTs, kAggMinuteMs);
        for (int64_t h : hours)
            for (size_t c = 0; c < ag.cols.size(); ++c) {
                AggWrite w;
                w.spec = gi;
                w.col = c;
                w.res = kAggHourMs;
                w.bucket = h;
                w.rebuildHour = true;
                out.push_back(w);
            }
        hours.clear();
        const bool ok = local_.commit({}, err, {}, out, {m});
        out.clear();
        return ok;
    };
    constexpr int kChunk = 2000;
    for (;;) {
        std::vector<StoredRow> rows;
        if (!local_.readRowsAfter(grp.table, ag.colNames, curTs, curSeq, INT64_MAX, kChunk, rows,
                                  err)) {
            setError("io", "aggregates recovery: " + err, nowUtc_());
            return;
        }
        for (const auto& r : rows) {
            ta.row(r.ts, aggValues(gi, [&] {  // cells of the aggregated columns only
                std::vector<Cell> wide(grp.columns.size());
                for (size_t i = 0; i < ag.cols.size() && i < r.cells.size(); ++i)
                    wide[ag.cols[i]] = r.cells[i];
                return wide;
            }()));
            lastTs = r.ts;
            curTs = r.ts;
            curSeq = r.seq;
        }
        collect();
        if (lastTs >= 0 && out.size() >= 4000 && !flush(false)) {
            setError("io", "aggregates recovery: " + err, nowUtc_());
            return;
        }
        if (rows.size() < static_cast<size_t>(kChunk)) break;
    }
    if (lastTs < 0) return;  // nothing after the mark
    ta.breakAll(lastTs);
    collect();
    if (!flush(true)) setError("io", "aggregates recovery: " + err, nowUtc_());
}

void Historian::feedAggregators(size_t gi, int64_t ts, const std::vector<Cell>& cells) {
    aggGroups_[gi].agg->row(ts, aggValues(gi, cells));
}

// After the rows of a pass: close the windows the clock has passed and queue them; once a minute
// the commit also moves `agg_built_to` to the start of the open minute (no extra write).
void Historian::collectAggregates(size_t gi, int64_t nowUtc) {
    auto& ag = aggGroups_[gi];
    ag.agg->advance(nowUtc);
    std::vector<AggOut> drained;
    ag.agg->drain(drained);
    for (const auto& o : drained) {
        if (o.res != kAggMinuteMs) continue;  // hours are built from the minutes in the commit
        AggWrite w;
        w.spec = gi;
        w.col = o.col;
        w.res = kAggMinuteMs;
        w.bucket = o.bucket;
        w.agg = o.agg;
        aggBuffer_.push_back(w);
    }
    const int64_t minute = floorTo(nowUtc, kAggMinuteMs);
    if (minute != ag.lastMarkMin) {
        ag.lastMarkMin = minute;
        AggMark m;
        m.spec = gi;
        m.setBuiltTo = true;
        m.builtTo = minute;
        for (auto& e : markBuffer_)
            if (e.spec == gi && e.setBuiltTo) {
                e.builtTo = minute;
                return;
            }
        markBuffer_.push_back(m);
    }
}

void Historian::breakAggregates(int64_t t) {
    for (size_t gi = 0; gi < aggGroups_.size(); ++gi) {
        auto& ag = aggGroups_[gi];
        if (!ag.enabled) continue;
        ag.agg->breakAll(t);
        std::vector<AggOut> drained;
        ag.agg->drain(drained);
        for (const auto& o : drained) {
            if (o.res != kAggMinuteMs) continue;
            AggWrite w;
            w.spec = gi;
            w.col = o.col;
            w.res = kAggMinuteMs;
            w.bucket = o.bucket;
            w.agg = o.agg;
            aggBuffer_.push_back(w);
        }
    }
    queueHourRebuild(hourStartOf(t));
}

void Historian::startRun(int64_t nowUtc) {
    if (runStarted_ || !local_.aggregatesAvailable()) return;
    std::string e;
    runId_ = local_.startRun(nowUtc, e);
    if (runId_ < 0) {
        setError("io", "mat_runs: " + e, nowUtc);
        return;
    }
    runStarted_ = true;
    aliveDueMono_ = nowMono_() + opt_.aliveEveryMs;
}

// §5: groups that already had raw rows get their buckets built backwards, one slice (at most an
// hour of raw rows) at a time, a bounded number of rows per pass.
bool Historian::backfillStep(int64_t nowUtc) {
    if (!aggOn_ || !runStarted_) return false;
    for (size_t gi = 0; gi < aggGroups_.size(); ++gi) {
        auto& ag = aggGroups_[gi];
        if (!ag.enabled || !ag.backfillActive) continue;
        const auto& grp = model_.groups[gi];
        std::string err;
        if (!ag.sliceOpen) {
            const auto minTs = local_.minTs(grp.table);
            const int64_t floorMs = nowUtc - int64_t{grp.aggregates->minuteRetentionDays} * kDayMs;
            if (!minTs || ag.backTo <= *minTs || ag.backTo <= floorMs) {  // nothing older to build
                AggMark m;
                m.spec = gi;
                m.setBuiltTo = false;
                m.setBackTo = true;
                local_.commit({}, err, {}, {}, {m});
                ag.backfillActive = false;
                return true;
            }
            ag.backFloor = std::max(*minTs, floorMs);
            ag.sliceEnd = ag.backTo;
            ag.sliceStart = std::max(floorTo(ag.sliceEnd - 1, kAggHourMs), floorTo(floorMs, kAggMinuteMs));
            ag.sliceAgg = std::make_unique<GroupAggregator>(ag.cols.size());
            // Signal carried into the slice: the last row before it, unless a new run started in
            // between (the runtime was down) or that row is NULL.
            if (const auto prev = local_.lastRowBefore(grp.table, ag.colNames, ag.sliceStart)) {
                if (local_.runStartsBetween(prev->ts + 1, ag.sliceStart + 1).empty())
                    for (size_t i = 0; i < ag.cols.size() && i < prev->cells.size(); ++i)
                        if (const auto v = cellValue(prev->cells[i]))
                            ag.sliceAgg->seed(i, ag.sliceStart, *v);
            }
            ag.curTs = ag.sliceStart - 1;
            ag.curSeq = -1;
            ag.sliceOut.clear();
            ag.sliceReady = false;
            ag.sliceOpen = true;
        }
        if (!ag.sliceReady) {
            std::vector<StoredRow> rows;
            const int limit = std::max(1, opt_.aggBackfillRows);
            if (!local_.readRowsAfter(grp.table, ag.colNames, ag.curTs, ag.curSeq, ag.sliceEnd,
                                      limit, rows, err)) {
                setError("io", "aggregates back-fill: " + err, nowUtc);
                return true;
            }
            for (const auto& r : rows) {
                std::vector<Cell> wide(grp.columns.size());
                for (size_t i = 0; i < ag.cols.size() && i < r.cells.size(); ++i)
                    wide[ag.cols[i]] = r.cells[i];
                ag.sliceAgg->row(r.ts, aggValues(gi, wide));
                ag.curTs = r.ts;
                ag.curSeq = r.seq;
            }
            if (rows.size() < static_cast<size_t>(limit)) {  // the slice is read to its end
                ag.sliceAgg->breakAll(ag.sliceEnd);
                std::vector<AggOut> drained;
                ag.sliceAgg->drain(drained);
                for (const auto& o : drained) {
                    if (o.res != kAggMinuteMs) continue;
                    AggWrite w;
                    w.spec = gi;
                    w.col = o.col;
                    w.res = kAggMinuteMs;
                    w.bucket = o.bucket;
                    w.agg = o.agg;
                    ag.sliceOut.push_back(w);
                }
                for (int64_t h = floorTo(ag.sliceStart, kAggHourMs); h < ag.sliceEnd; h += kAggHourMs)
                    for (size_t c = 0; c < ag.cols.size(); ++c) {
                        AggWrite w;
                        w.spec = gi;
                        w.col = c;
                        w.res = kAggHourMs;
                        w.bucket = h;
                        w.rebuildHour = true;
                        ag.sliceOut.push_back(w);
                    }
                ag.sliceReady = true;
            }
            return true;
        }
        AggMark m;
        m.spec = gi;
        m.setBuiltTo = false;
        m.setBackTo = true;
        m.backTo = ag.sliceStart;
        if (local_.commit({}, err, {}, ag.sliceOut, {m})) {
            ag.backTo = ag.sliceStart;
            ag.sliceOpen = false;
            ag.sliceReady = false;
            ag.sliceOut.clear();
            ag.sliceAgg.reset();
        } else {
            setError("io", "aggregates back-fill: " + err, nowUtc);
        }
        return true;
    }
    return false;
}

// Once a second: the per-group figures and the I/O meter go into the status; every ten minutes the
// bucket rows are counted.
void Historian::refreshStatusExtras(int64_t nowUtc, int64_t nowMono) {
    if (nowMono < extrasDueMono_) return;
    extrasDueMono_ = nowMono + 1000;
    int64_t rowsMin = -2;
    int64_t rowsHour = -2;
    if (aggOn_ && opened_ && local_.isOpen() && nowMono >= aggCountDueMono_) {
        aggCountDueMono_ = nowMono + opt_.aggCountEveryMs;
        rowsMin = local_.aggRows(kAggMinuteMs);
        rowsHour = local_.aggRows(kAggHourMs);
    }
    const IoSnapshot io = io_.snapshot();
    std::lock_guard<std::mutex> g(statusMu_);
    status_.io = io;
    if (rowsMin != -2) {
        status_.aggRowsMinute = rowsMin;
        status_.aggRowsHour = rowsHour;
    }
    bool back = false;
    for (size_t i = 0; i < model_.groups.size() && i < status_.groups.size(); ++i) {
        auto& gs = status_.groups[i];
        gs.rows24h = counters_[i].last24h(nowUtc);
        if (model_.groups[i].mode == LogMode::Trigger) {
            const TriggerState ts = samplers_[i].triggerState();
            gs.triggerState = ts == TriggerState::Active     ? "active"
                              : ts == TriggerState::Inactive ? "inactive"
                                                             : "unknown";
        }
        const auto& ag = aggGroups_[i];
        if (ag.enabled && ag.backfillActive && !back) {
            back = true;
            status_.backfillGroup = model_.groups[i].id;
            const double total = static_cast<double>(std::max<int64_t>(1, ag.backFrom - ag.backFloor));
            status_.backfillProgress = std::min(
                1.0, std::max(0.0, static_cast<double>(ag.backFrom - ag.backTo) / total));
        }
    }
    status_.backfillActive = back;
    if (!back) {
        status_.backfillGroup.clear();
        status_.backfillProgress = -1;
    }
}

// Cursors the forwarders reached, for mat_forward: the InfluxDB cursor (at least once: a crash
// before they are saved resends a few rows, which overwrite themselves) and the copy of the SQL
// cursors. Kept here until a transaction holds them.
void Historian::collectCursors() {
    for (auto& f : forwarders_)
        for (auto& c : f->takeCursorUpdates()) {
            auto key = std::make_pair(c.dest, c.table);
            cursors_[std::move(key)] = std::move(c);
        }
}

void Historian::flushCursors() {
    collectCursors();
    if (cursors_.empty() || !opened_ || !local_.isOpen()) return;
    std::vector<ForwardCursor> all;
    for (const auto& kv : cursors_) all.push_back(kv.second);
    std::string err;
    if (local_.saveCursors(all, err))
        cursors_.clear();
    else
        std::fprintf(stderr, "historian: mat_forward: %s\n", err.c_str());
}

bool Historian::reopenStore(std::string& err) {
    if (!local_.open(err) || !local_.ensureTables(tableSpecs(), err)) {
        local_.close();
        return false;
    }
    if (local_.instanceId() != fileId_) followNewFile();  // the same file: nothing to follow
    return true;
}

void Historian::setError(const std::string& code, const std::string& msg, int64_t nowUtc) {
    std::fprintf(stderr, "historian: %s: %s\n", code.c_str(), msg.c_str());  // journal only
    std::lock_guard<std::mutex> g(statusMu_);
    status_.lastErrorCode = code;
    status_.lastErrorMessage = msg;
    status_.lastErrorAt = nowUtc;
}

void Historian::runOnce() {
    const int64_t nowUtc = nowUtc_();
    const int64_t nowMono = nowMono_();
    bool jumped = false;
    const int64_t prevUtc = lastUtc_;
    if (started_) {
        const int64_t drift = (nowUtc - lastUtc_) - (nowMono - lastMono_);
        jumped = drift > kJumpMs || drift < -kJumpMs;
    }
    started_ = true;
    lastUtc_ = nowUtc;
    lastMono_ = nowMono;

    const int64_t floor = opt_.clockFloorMs > 0 ? opt_.clockFloorMs : clockFloorMs();
    const bool clockOk = nowUtc >= floor && nowUtc < floor + kMaxClockAheadMs;
    maintain(nowUtc, nowMono, clockOk);
    checkDamage(nowUtc);
    const bool sampling = clockOk && opened_ && !paused_;
    // Aggregates (history-db.md §3): the held signal ends (break) when the clock jumps, writing
    // pauses or fails; it starts again with the next good pass.
    const bool aggNow = aggOn_ && sampling && !failing_;
    if (aggOn_ && aggActive_ && (jumped || !aggNow)) {
        breakAggregates(jumped ? prevUtc : lastAggUtc_);
        aggActive_ = false;
    }
    if (aggNow && !aggActive_) {
        startRun(nowUtc);
        for (size_t i = 0; i < aggGroups_.size(); ++i) {
            auto& ag = aggGroups_[i];
            if (!ag.enabled || !ag.initPending) continue;
            AggState st;
            std::string e;
            if (local_.initAggState(model_.groups[i].table, nowUtc, st, e)) {
                ag.initPending = false;
                if (st.backTo) {
                    ag.backfillActive = true;
                    ag.backTo = ag.backFrom = *st.backTo;
                }
            } else {
                setError("io", "aggregates: " + e, nowUtc);
            }
        }
        aggPrevHour_ = hourStartOf(nowUtc) / kAggHourMs;
        aggActive_ = true;
    }
    if (sampling) {
        for (size_t i = 0; i < samplers_.size(); ++i) {
            tags_.snapshot(indices_[i], values_);
            const TagValue* trig = nullptr;
            if (triggerIdx_[i]) {
                tags_.snapshot({*triggerIdx_[i]}, triggerValue_);
                trig = &triggerValue_[0];
            }
            if (auto row = samplers_[i].tick(nowUtc, nowMono, values_, trig, samplerStats_)) {
                counters_[i].add(row->tsUtc);
                if (aggNow && aggGroups_[i].enabled) feedAggregators(i, row->tsUtc, row->cells);
                buffer_.push_back(PendingRow{row->group, row->tsUtc, std::move(row->cells)});
            }
            if (aggNow && aggGroups_[i].enabled) collectAggregates(i, nowUtc);
        }
        if (aggNow) {
            const int64_t hour = hourStartOf(nowUtc) / kAggHourMs;
            if (hour > aggPrevHour_) {  // the hour that just ended: build its row from the minutes
                queueHourRebuild(aggPrevHour_ * kAggHourMs);
                aggPrevHour_ = hour;
            }
            lastAggUtc_ = nowUtc;
        }
    }
    io_.sample(nowMono);
    if (runStarted_ && nowMono >= aliveDueMono_) {
        aliveDueMono_ = nowMono + opt_.aliveEveryMs;
        std::string e;
        local_.touchRun(runId_, nowUtc, e);
    }

    const bool due = nowMono - lastCommitMono_ >= opt_.commitMs ||
                     buffer_.size() >= opt_.commitRows;
    if (opened_ && (!buffer_.empty() || !aggBuffer_.empty()) && due &&
        (!failing_ || nowMono >= retryAtMono_))
        tryCommit(nowUtc, nowMono, false);
    retryMarks(nowUtc, nowMono);
    processMarks(nowUtc, nowMono);
    if (opened_ && !forwarders_.empty() && nowMono >= cursorDueMono_) {
        cursorDueMono_ = nowMono + opt_.cursorSaveMs;
        flushCursors();
    }

    uint64_t dropped = 0;
    while (buffer_.size() > opt_.maxBufferedRows) {
        buffer_.pop_front();
        ++dropped;
    }
    uint64_t aggDropped = 0;
    if (aggBuffer_.size() > kMaxAggBuffered) {  // the file cannot be written for a long time
        aggDropped = aggBuffer_.size() - kMaxAggBuffered;
        aggBuffer_.erase(aggBuffer_.begin(),
                         aggBuffer_.begin() + static_cast<std::ptrdiff_t>(aggDropped));
    }
    refreshStatusExtras(nowUtc, nowMono);

    std::lock_guard<std::mutex> g(statusMu_);
    if (jumped) ++status_.clockJumps;
    status_.rowsDropped += dropped;
    status_.aggDropped += aggDropped;
    status_.clockValid = clockOk;
    status_.stringsTruncated = samplerStats_.stringsTruncated;
    status_.state = !clockOk ? HistorianState::ClockInvalid
                             : paused_ ? HistorianState::PausedLowDisk
                                       : failing_ ? HistorianState::Error : HistorianState::Running;
}

void Historian::tryCommit(int64_t nowUtc, int64_t nowMono, bool force) {
    (void)force;
    std::string err;
    if (!local_.isOpen() && !reopenStore(err)) {  // no new file could be made last time
        failing_ = true;
        retryAtMono_ = nowMono + opt_.retryMs;
        lastCommitMono_ = nowMono;
        setError("io", err, nowUtc);
        return;
    }
    collectCursors();  // they go to the eMMC with the rows, in the same transaction
    std::vector<ForwardCursor> cursors;
    for (const auto& kv : cursors_) cursors.push_back(kv.second);
    std::vector<PendingRow> rows(buffer_.begin(), buffer_.end());
    // The closed windows go in the same transaction as the raw rows they cover (history-db.md §3).
    if (local_.commit(rows, err, cursors, aggBuffer_, markBuffer_)) {
        buffer_.clear();
        aggBuffer_.clear();
        markBuffer_.clear();
        cursors_.clear();
        cursorDueMono_ = nowMono + opt_.cursorSaveMs;
        failing_ = false;
        lastCommitMono_ = nowMono;
        for (auto& f : forwarders_) f->notify();
        std::lock_guard<std::mutex> g(statusMu_);
        status_.rowsWritten += rows.size();
        status_.lastCommitAt = nowUtc;
        return;
    }
    const int rc = local_.lastErrorCode() & 0xff;
    const std::string code = rc == SQLITE_FULL
                                 ? "disk_full"
                                 : (rc == SQLITE_CORRUPT || rc == SQLITE_NOTADB) ? "corrupt" : "io";
    failing_ = true;
    retryAtMono_ = nowMono + opt_.retryMs;
    lastCommitMono_ = nowMono;
    setError(code, err, nowUtc);
    // A damaged page: the file is kept as history.db.corrupt-<epoch> for investigation and a new
    // one, with a new instance id, takes the buffered rows at the next attempt (data-model §3).
    if (code == "corrupt") replaceDamagedFile(nowUtc, err);
}

bool Historian::start(std::string& err) {
    if (!opened_ && !open(err)) return false;
    for (auto& f : forwarders_) {
        std::string e;
        if (!f->start(e))
            std::fprintf(stderr, "forwarder %s: %s\n", f->connection().id.c_str(), e.c_str());
    }
    running_ = true;
    thread_ = std::thread([this] {
        auto next = std::chrono::steady_clock::now();
        while (running_) {
            runOnce();
            next += std::chrono::milliseconds(kPassMs);
            std::this_thread::sleep_until(next);
        }
    });
    return true;
}

void Historian::stop() {
    if (running_.exchange(false) && thread_.joinable()) thread_.join();
    if (aggActive_) {  // a clean stop: the open windows are written, the run ends here
        const int64_t now = nowUtc_();
        breakAggregates(now >= lastAggUtc_ ? now : lastAggUtc_);
        aggActive_ = false;
        if (runStarted_ && local_.isOpen()) {
            std::string e;
            local_.touchRun(runId_, now, e);
        }
    }
    if (opened_ && (!buffer_.empty() || !aggBuffer_.empty())) tryCommit(nowUtc_(), nowMono_(), true);
    // Every forwarder ends its current batch (bounded by the client timeouts) at the same time.
    for (auto& f : forwarders_) f->requestStop();
    for (auto& f : forwarders_) f->stop();
    flushCursors();
}

HistorianStatus Historian::status() const {
    HistorianStatus s;
    {
        std::lock_guard<std::mutex> g(statusMu_);
        s = status_;
    }
    // forwarders_ only changes in open(), before any thread runs
    for (const auto& f : forwarders_) s.destinations.push_back(f->status());
    return s;
}

}  // namespace mat
