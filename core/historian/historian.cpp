#include "core/historian/historian.hpp"

#include <sys/statvfs.h>

#include <algorithm>
#include <chrono>
#include <cstdio>

#include "core/historian/clock.hpp"
#include "sqlite3.h"

namespace mat {

namespace {
constexpr int64_t kJumpMs = 1000;  // same rule as GroupSampler
constexpr int64_t kPassMs = 100;
constexpr int64_t kDayMs = 86400000;
constexpr int64_t kMarkRetryMaxMs = 60000;  // longest wait between two tries on the marks
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
      local_(opt_.dataDir, nowUtc_) {
    for (size_t i = 0; i < model_.groups.size(); ++i) {
        samplers_.emplace_back(model_.groups[i], i, model_.offsetMin);
        std::vector<size_t> idx;
        for (const auto& c : model_.groups[i].columns) idx.push_back(c.tagIndex);
        indices_.push_back(std::move(idx));
    }
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
    std::lock_guard<std::mutex> g(statusMu_);
    status_.dbMaxBytes = opt_.maxDbBytes;
    status_.dbBytes = local_.usedBytes();
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
        const int n = local_.purgeOldest(opt_.batchRows, err);
        if (n < 0 && damagedFile(local_.lastErrorCode())) maintenanceDamage_ = true;
        const int64_t used = local_.usedBytes();
        if (n <= 0 || used < opt_.maxDbBytes / 10 * 9) purging_ = false;
        std::lock_guard<std::mutex> g(statusMu_);
        if (n > 0) status_.capRowsDeleted += static_cast<uint64_t>(n);
        status_.dbBytes = used;
        return;  // one heavy step per pass
    }
    // Retention: at start, then every hour, one batch per pass; never with a wrong clock.
    if (!clockOk) return;
    if (!retentionActive_ && nowMono >= retentionDueMono_) {
        retentionQueue_ = local_.retentionTargets();
        retentionIdx_ = 0;
        retentionRows_ = 0;
        retentionActive_ = true;
    }
    if (!retentionActive_) return;
    if (retentionIdx_ < retentionQueue_.size()) {
        const auto& target = retentionQueue_[retentionIdx_];
        const int n = local_.deleteExpired(target.first, nowUtc - int64_t{target.second} * kDayMs,
                                           opt_.batchRows, err);
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
    for (auto& f : forwarders_) f->reopen();
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
    if (clockOk && opened_ && !paused_) {
        for (size_t i = 0; i < samplers_.size(); ++i) {
            tags_.snapshot(indices_[i], values_);
            if (auto row = samplers_[i].tick(nowUtc, nowMono, values_, samplerStats_))
                buffer_.push_back(PendingRow{row->group, row->tsUtc, std::move(row->cells)});
        }
    }

    const bool due =
        nowMono - lastCommitMono_ >= opt_.commitMs || buffer_.size() >= opt_.commitRows;
    if (opened_ && !buffer_.empty() && due && (!failing_ || nowMono >= retryAtMono_))
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

    std::lock_guard<std::mutex> g(statusMu_);
    if (jumped) ++status_.clockJumps;
    status_.rowsDropped += dropped;
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
    if (local_.commit(rows, err, cursors)) {
        buffer_.clear();
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
    if (opened_ && !buffer_.empty()) tryCommit(nowUtc_(), nowMono_(), true);
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
