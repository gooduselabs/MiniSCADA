#include "core/historian/forward/forwarder.hpp"

#include <sys/resource.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <climits>
#include <cstdio>

#include "core/common/thread_name.hpp"
#include "sqlite3.h"

namespace mat {

namespace {

int64_t nextBackoff(int64_t current, int64_t minMs, int64_t maxMs) {
    return current == 0 ? minMs : std::min(current * 2, maxMs);
}

// Linux keeps a nice value per thread: only the sending thread gives way to the runtime.
void lowerThreadPriority() {
    const auto tid = static_cast<id_t>(::syscall(SYS_gettid));
    errno = 0;
    const int current = ::getpriority(PRIO_PROCESS, tid);
    if (errno == 0) ::setpriority(PRIO_PROCESS, tid, std::min(19, current + 10));
}

// Instance id of history.db as written by LocalStore (lower-case UUID): it tags every row sent
// and keys the cursors at the destination.
bool isInstanceId(const std::string& s) {
    if (s.size() != 36) return false;
    for (size_t i = 0; i < s.size(); ++i) {
        const char c = s[i];
        const bool dash = i == 8 || i == 13 || i == 18 || i == 23;
        if (dash ? c != '-' : !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    }
    return true;
}

// CPU time of the calling thread: a batch that waits on the network costs no rest.
int64_t threadCpuMs() {
    timespec ts{};
    if (::clock_gettime(CLOCK_THREAD_CPUTIME_ID, &ts) != 0) return 0;
    return static_cast<int64_t>(ts.tv_sec) * 1000 + ts.tv_nsec / 1000000;
}

}  // namespace

const char* destStateName(DestState s) {
    switch (s) {
        case DestState::Ok:
            return "ok";
        case DestState::Error:
            return "error";
        case DestState::NoClient:
            return "no_client";
        case DestState::NoSecret:
            return "no_secret";
        case DestState::Connecting:
            break;
    }
    return "connecting";
}

std::string forwardCursorKey(const ConnectionModel& c) {
    if (c.type != DbType::InfluxDb) return c.id;
    // org and bucket may hold '|': their lengths keep keys of different buckets apart
    return c.id + "|" + c.url + "|" + std::to_string(c.org.size()) + ":" + c.org + "|" +
           std::to_string(c.bucket.size()) + ":" + c.bucket;
}

Forwarder::Forwarder(ConnectionModel conn, std::vector<ForwardGroup> groups,
                     std::unique_ptr<Destination> dest, ForwarderOptions opt,
                     std::function<int64_t()> nowUtc, std::function<int64_t()> nowMono)
    : conn_(std::move(conn)),
      dest_(std::move(dest)),
      opt_(std::move(opt)),
      nowUtc_(std::move(nowUtc)),
      nowMono_(std::move(nowMono)) {
    cursorKey_ = forwardCursorKey(conn_);
    for (auto& g : groups) {
        Group x;
        for (const auto& c : g.table.columns) x.columns.push_back(c.name);
        x.g = std::move(g);
        groups_.push_back(std::move(x));
    }
    status_.id = conn_.id;
    status_.type = dbTypeName(conn_.type);
}

Forwarder::~Forwarder() {
    stop();
    if (connected_) dest_->close();
}

bool Forwarder::openReader(int64_t nowUtc, int64_t nowMono) {
    std::string err;
    if (!reader_.open(opt_.dbPath, err)) {
        DestError e;
        e.cls = ErrorClass::Sql;
        e.detail = "history.db: " + err;
        connectionFailed(e, nowUtc, nowMono);
        return false;
    }
    sourceId_ = reader_.instanceId();
    if (!isInstanceId(sourceId_)) {  // devices would share their cursors at the destination
        DestError e;
        e.cls = ErrorClass::Sql;
        e.detail = "history.db: no valid instance id";
        connectionFailed(e, nowUtc, nowMono);
        return false;
    }
    readerOpen_ = true;
    // Device copy of the cursors: the real cursor of a non-transactional destination, an estimate
    // for the status of a SQL destination until it answers.
    const auto saved = reader_.forwardCursors(cursorKey_);
    for (auto& g : groups_) {
        const auto it = saved.find(g.g.table.name);
        g.cursor = it == saved.end() ? 0 : it->second;
        if (g.g.seqAtOpen >= 0)
            g.mark = g.g.seqAtOpen;
        else if (g.g.seqAtOpen == ForwardGroup::kMarkPending)
            g.mark = -1;  // comes with provideMarks()
        else
            g.mark = reader_.lastSeqEver(g.g.table.name).value_or(-1);
    }
    return true;
}

void Forwarder::connectionFailed(const DestError& e, int64_t nowUtc, int64_t nowMono) {
    if (connected_) dest_->close();
    connected_ = false;
    for (auto& g : groups_) g.prepared = false;
    // The raw text may hold host and user names: journal only (research R13).
    std::fprintf(stderr, "forwarder %s: %s %s %s\n", conn_.id.c_str(), errorClassCode(e.cls),
                 journalSafe(e.dbCode).c_str(), journalSafe(e.detail).c_str());
    int64_t wait = 0;
    if (e.cls == ErrorClass::NoClient) {
        wait = opt_.noClientRetryMs;
    } else if (e.cls == ErrorClass::Auth) {
        authBackoffMs_ = nextBackoff(authBackoffMs_, opt_.authBackoffMinMs, opt_.authBackoffMaxMs);
        wait = authBackoffMs_;
    } else {
        backoffMs_ = nextBackoff(backoffMs_, opt_.backoffMinMs, opt_.backoffMaxMs);
        wait = backoffMs_;
    }
    retryAtMono_ = nowMono + wait;
    connState_ = e.cls == ErrorClass::NoClient
                     ? DestState::NoClient
                     : e.cls == ErrorClass::NoSecret ? DestState::NoSecret : DestState::Error;
    connError_ = e;
    if (connError_.cls == ErrorClass::None) connError_.cls = ErrorClass::Sql;
    connErrorAt_ = nowUtc;
}

void Forwarder::copyCounters() {
    const DestCounters c = dest_->counters();
    std::lock_guard<std::mutex> lk(mu_);
    status_.outOfRangeValues = c.outOfRangeValues;
    status_.rejectedRows = c.rejectedRows;
}

std::vector<std::string> Forwarder::takeCheckedMarks() {
    std::lock_guard<std::mutex> lk(mu_);
    std::vector<std::string> out(checkedMarks_.begin(), checkedMarks_.end());
    checkedMarks_.clear();
    return out;
}

void Forwarder::marksCleared(const std::vector<std::string>& tables) {
    if (tables.empty()) return;
    {
        std::lock_guard<std::mutex> lk(mu_);
        clearedMarks_.insert(tables.begin(), tables.end());
    }
    notify();
}

void Forwarder::provideMarks(const std::map<std::string, int64_t>& marks) {
    if (marks.empty()) return;
    {
        std::lock_guard<std::mutex> lk(mu_);
        for (const auto& kv : marks) providedMarks_[kv.first] = kv.second;
    }
    notify();
}

std::string Forwarder::takeCorruptFile() {
    std::lock_guard<std::mutex> lk(mu_);
    std::string out;
    out.swap(corruptFile_);
    return out;
}

void Forwarder::groupFailed(Group& g, const DestError& e, int64_t nowUtc, int64_t nowMono) {
    std::fprintf(stderr, "forwarder %s: %s: %s %s %s\n", conn_.id.c_str(), g.g.table.name.c_str(),
                 errorClassCode(e.cls), journalSafe(e.dbCode).c_str(),
                 journalSafe(e.detail).c_str());
    g.prepared = false;  // schema and cursor again before the next attempt
    g.backoffMs = nextBackoff(g.backoffMs, opt_.backoffMinMs, opt_.backoffMaxMs);
    g.retryAtMono = nowMono + g.backoffMs;
    g.error = e;
    g.errorSoft = false;
    g.errorAt = nowUtc;
}

void Forwarder::handleError(Group& g, const DestError& e, int64_t nowUtc, int64_t nowMono) {
    if (isStatementError(e.cls))
        groupFailed(g, e, nowUtc, nowMono);
    else
        connectionFailed(e, nowUtc, nowMono);
}

bool Forwarder::connect(int64_t nowUtc, int64_t nowMono) {
    SecretResult secret = opt_.secret ? opt_.secret(conn_.id) : SecretResult{};
    if (!secret.ok) {
        DestError e;
        e.cls = ErrorClass::NoSecret;
        e.detail = "secret: " + (secret.reason.empty() ? std::string("none") : secret.reason);
        connectionFailed(e, nowUtc, nowMono);
        return false;
    }
    DestError e;
    const bool ok = dest_->connect(secret.secret, e);
    std::fill(secret.secret.begin(), secret.secret.end(), '\0');
    if (!ok) {
        connectionFailed(e, nowUtc, nowMono);
        return false;
    }
    connected_ = true;
    authBackoffMs_ = 0;  // the password is right; other errors back off until rows go through
    // Every group syncs its schema and reads its cursor again on a new connection: a commit whose
    // answer was lost is settled here (research R12).
    for (auto& g : groups_) {
        if (nowMono < g.retryAtMono) continue;  // waiting after an error of its own
        if (!prepare(g, nowUtc, nowMono) && !connected_) return false;
    }
    return true;
}

bool Forwarder::prepare(Group& g, int64_t nowUtc, int64_t nowMono) {
    // No mark stored for this start yet: comparing the cursor with nothing would skip the C1
    // check (a mark of an earlier run may be in the file). The group shows the wait and stays.
    if (g.g.seqAtOpen == ForwardGroup::kMarkPending) {
        if (g.error.cls == ErrorClass::None) {
            g.error.cls = ErrorClass::Sql;
            g.error.detail = "history.db: the mark of this table could not be stored yet";
            g.errorAt = nowUtc;
        }
        return true;  // not an error of the destination; markState stays Unchecked
    }
    DestError e;
    if (!dest_->syncSchema(sourceId_, {g.g.table}, e)) {
        handleError(g, e, nowUtc, nowMono);
        return false;
    }
    if (dest_->transactional()) {
        int64_t seq = 0;
        if (!dest_->readCursor(sourceId_, g.g.table.name, seq, e)) {
            handleError(g, e, nowUtc, nowMono);
            return false;
        }
        g.cursor = seq;
    }
    // The destination holds rows this file no longer has (lost in a power cut before they were on
    // the eMMC, or an older copy of history.db put back): new rows reusing those seq values would
    // be skipped without a trace. Before this forwarder sent anything, a cursor above what the
    // file had at open can only mean that: it goes back to that mark, so the rows written since
    // go too. Afterwards the cursor moves past the mark with the rows sent: never checked again.
    if (g.markState != Group::Mark::Unchecked) {
        g.prepared = true;
        return true;
    }
    if (g.mark >= 0 && g.cursor > g.mark) {
        std::fprintf(stderr,
                     "forwarder %s: %s: cursor %lld is ahead of history.db (%lld), rewound\n",
                     conn_.id.c_str(), g.g.table.name.c_str(), static_cast<long long>(g.cursor),
                     static_cast<long long>(g.mark));
        if (dest_->transactional() &&
            !dest_->writeBatch(sourceId_, g.g.table, {}, g.cursor, g.mark, e)) {
            handleError(g, e, nowUtc, nowMono);
            return false;
        }
        g.cursor = g.mark;
        recordCursor(g);
    }
    // A mark kept in history.db: the rows of the group wait until it is off the device.
    if (g.g.seqAtOpen >= 0) {
        g.markState = Group::Mark::AwaitingClear;
        std::lock_guard<std::mutex> lk(mu_);
        checkedMarks_.insert(g.g.table.name);
    } else {
        g.markState = Group::Mark::Done;
    }
    g.prepared = true;
    return true;
}

void Forwarder::recordCursor(const Group& g) {
    std::lock_guard<std::mutex> lk(mu_);
    updates_[g.g.table.name] = {g.cursor, sourceId_};
}

void Forwarder::refreshStatus(int64_t nowUtc) {
    int64_t pending = 0;
    int64_t oldest = INT64_MAX;
    if (readerOpen_) {
        for (const auto& g : groups_) {
            const auto first = reader_.firstAfter(g.g.table.name, g.cursor);
            if (!first) continue;
            const int64_t last = reader_.maxSeq(g.g.table.name).value_or(first->first);
            pending += last - first->first + 1;
            oldest = std::min(oldest, first->second);
        }
    }
    const Group* failed = nullptr;  // the latest error of a group, while the connection is up
    if (connected_)
        for (const auto& g : groups_)
            if (g.error.cls != ErrorClass::None && (!failed || g.errorAt >= failed->errorAt))
                failed = &g;
    std::lock_guard<std::mutex> lk(mu_);
    status_.pendingRows = pending;
    status_.lagS = pending > 0 ? std::max<int64_t>(0, (nowUtc - oldest) / 1000) : 0;
    if (!connected_) {
        status_.state = connState_;
        status_.lastError = connError_.cls;
        status_.lastErrorDbCode = connError_.dbCode;
        status_.lastErrorAt = connErrorAt_;
    } else if (failed) {
        status_.state = DestState::Error;
        status_.lastError = failed->error.cls;
        status_.lastErrorDbCode = failed->error.dbCode;
        status_.lastErrorAt = failed->errorAt;
    } else {
        status_.state = DestState::Ok;
        status_.lastError = ErrorClass::None;
        status_.lastErrorDbCode.clear();
        status_.lastErrorAt = 0;
    }
}

bool Forwarder::runOnce() {
    const int64_t nowUtc = nowUtc_();
    const int64_t nowMono = nowMono_();
    if (reopen_.exchange(false)) {  // history.db was replaced: new file, new instance id
        if (connected_) dest_->close();
        connected_ = false;
        readerOpen_ = false;
        retryAtMono_ = 0;
        for (auto& g : groups_) {
            g.cursor = 0;
            g.prepared = false;
            g.error = {};
            g.errorAt = 0;
            g.backoffMs = 0;
            g.retryAtMono = 0;
            g.lostThrough = 0;
            g.errorSoft = false;
            g.g.seqAtOpen = -1;  // the mark of the new file is read when it is opened
            g.mark = -1;
            g.markState = Group::Mark::Unchecked;
        }
    }
    {  // marks stored late, then marks the historian removed from history.db for good
        std::lock_guard<std::mutex> lk(mu_);
        for (auto& g : groups_) {
            const auto it = providedMarks_.find(g.g.table.name);
            if (g.g.seqAtOpen != ForwardGroup::kMarkPending || it == providedMarks_.end()) continue;
            g.g.seqAtOpen = it->second;
            g.mark = it->second;
            g.markState = Group::Mark::Unchecked;
            g.prepared = false;
            g.error = {};
            g.errorAt = 0;
        }
        providedMarks_.clear();
        for (auto& g : groups_)
            if (g.markState == Group::Mark::AwaitingClear && clearedMarks_.count(g.g.table.name))
                g.markState = Group::Mark::Done;
        clearedMarks_.clear();
    }
    if (!readerOpen_ && (nowMono < retryAtMono_ || !openReader(nowUtc, nowMono))) {
        refreshStatus(nowUtc);
        return false;
    }
    if (!connected_) {
        if (nowMono < retryAtMono_) {
            refreshStatus(nowUtc);
            return false;
        }
        const bool ok = connect(nowUtc, nowMono);
        refreshStatus(nowUtc);
        return ok;
    }
    // One batch from the next group that has rows (round robin: a big backlog of one group does
    // not hold the others back; a group the server refuses waits on its own).
    lastBatchRows_ = 0;
    const size_t n = groups_.size();
    for (size_t k = 0; k < n; ++k) {
        const size_t idx = (next_ + k) % n;
        Group& g = groups_[idx];
        if (nowMono < g.retryAtMono) continue;
        if (!g.prepared && !prepare(g, nowUtc, nowMono)) {
            next_ = (idx + 1) % n;
            refreshStatus(nowUtc);
            return connected_;
        }
        if (g.markState != Group::Mark::Done) continue;  // its mark is not off the device yet
        std::vector<StoredRow> rows;
        std::string err;
        const size_t limit = std::max<size_t>(1, dest_->batchRows(g.g.table));
        if (!reader_.readAfter(g.g.table.name, g.columns, g.cursor, static_cast<int>(limit), rows,
                               err)) {
            // history.db itself (review I3): the group shows the error and waits like any other;
            // a damaged page is reported to the historian, which replaces the file.
            const int rc = reader_.lastErrorCode() & 0xff;
            DestError e;
            e.cls = ErrorClass::Sql;
            e.dbCode = "sqlite:" + std::to_string(rc);
            e.detail = "history.db " + g.g.table.name + ": " + err;
            groupFailed(g, e, nowUtc, nowMono);
            if (rc == SQLITE_CORRUPT || rc == SQLITE_NOTADB) {
                std::lock_guard<std::mutex> lk(mu_);
                corruptFile_ = sourceId_;
            }
            next_ = (idx + 1) % n;
            refreshStatus(nowUtc);
            return connected_;
        }
        if (rows.empty()) {  // prepared and nothing refused: the group is healthy again
            if (!g.errorSoft) g.error = {};
            g.backoffMs = 0;
            continue;
        }
        // Rows deleted on the device (retention, size cap) before they could be sent: counted
        // once, and this batch moves the cursor past them (research R8, FR-021). A destination
        // that never got a row starts at the oldest row: nothing of it was lost.
        const int64_t gapEnd = rows.front().seq - 1;
        if (g.cursor > 0 && gapEnd > std::max(g.cursor, g.lostThrough)) {
            const int64_t lost = gapEnd - std::max(g.cursor, g.lostThrough);
            g.lostThrough = gapEnd;
            std::fprintf(stderr, "forwarder %s: %lld rows of %s deleted before they were sent\n",
                         conn_.id.c_str(), static_cast<long long>(lost), g.g.table.name.c_str());
            std::lock_guard<std::mutex> lk(mu_);
            status_.lostRows += static_cast<uint64_t>(lost);
        }
        DestError e;
        const int64_t last = rows.back().seq;
        const bool sent = dest_->writeBatch(sourceId_, g.g.table, rows, g.cursor, last, e);
        copyCounters();
        if (!sent) {
            handleError(g, e, nowUtc, nowMono);
            next_ = (idx + 1) % n;
            refreshStatus(nowUtc);
            return connected_;  // a statement error: the other groups go on now
        }
        g.cursor = last;
        // Sent; a part the server refused (e.cls set) shows until a batch goes through whole.
        g.error = e;
        g.errorSoft = e.cls != ErrorClass::None;
        if (g.errorSoft) {
            g.errorAt = nowUtc;
            std::fprintf(stderr, "forwarder %s: %s: %s %s %s\n", conn_.id.c_str(),
                         g.g.table.name.c_str(), errorClassCode(e.cls),
                         journalSafe(e.dbCode).c_str(), journalSafe(e.detail).c_str());
        }
        g.backoffMs = 0;
        backoffMs_ = 0;  // rows went through: the connection is healthy
        next_ = (idx + 1) % n;
        lastBatchRows_ = rows.size();
        {
            std::lock_guard<std::mutex> lk(mu_);
            status_.sentRows += rows.size();
            status_.lastOkAt = nowUtc;
            updates_[g.g.table.name] = {last, sourceId_};
        }
        refreshStatus(nowUtc);
        return true;
    }
    backoffMs_ = 0;  // connected and nothing left to send: healthy
    refreshStatus(nowUtc);
    return false;
}

int64_t Forwarder::pauseAfter(size_t rows, int64_t workMs, const ForwarderOptions& o) {
    const int64_t rate = o.maxRowsPerSecond > 0 ? o.maxRowsPerSecond : 5000;
    return std::max({o.pauseMs, static_cast<int64_t>(rows) * 1000 / rate, workMs});
}

int64_t Forwarder::waitMs(int64_t nowMono) const {
    int64_t due = nowMono + opt_.idleMs;
    if (!readerOpen_ || !connected_) {
        due = std::min(due, retryAtMono_);
    } else {
        for (const auto& g : groups_)
            if (g.retryAtMono > nowMono) due = std::min(due, g.retryAtMono);
    }
    return std::max(opt_.pauseMs, due - nowMono);
}

void Forwarder::loop() {
    if (opt_.lowerPriority) lowerThreadPriority();
    while (running_) {
        const int64_t cpu0 = threadCpuMs();
        const bool more = runOnce();
        const int64_t workMs = threadCpuMs() - cpu0;
        std::unique_lock<std::mutex> lk(wakeMu_);
        if (!running_) break;
        if (more) {  // catching up: paced so that days of backlog do not take the BL335 CPU
            wake_.wait_for(lk, std::chrono::milliseconds(pauseAfter(lastBatchRows_, workMs, opt_)),
                           [&] { return !running_; });
            continue;
        }
        wake_.wait_for(lk, std::chrono::milliseconds(waitMs(nowMono_())),
                       [&] { return notified_ || !running_; });
        notified_ = false;
    }
    if (connected_) {
        dest_->close();
        connected_ = false;
    }
}

bool Forwarder::start(std::string& err) {
    if (thread_.joinable()) {
        err = "already running";
        return false;
    }
    running_ = true;
    thread_ = std::thread([this] {
        setThreadName("mat-forward");
        loop();
    });
    return true;
}

void Forwarder::requestStop() {
    {
        std::lock_guard<std::mutex> lk(wakeMu_);
        running_ = false;
        notified_ = true;
    }
    wake_.notify_all();
}

void Forwarder::stop() {
    requestStop();
    if (thread_.joinable()) thread_.join();
}

void Forwarder::notify() {
    {
        std::lock_guard<std::mutex> lk(wakeMu_);
        notified_ = true;
    }
    wake_.notify_one();
}

void Forwarder::reopen() {
    {
        std::lock_guard<std::mutex> lk(mu_);
        updates_.clear();
        checkedMarks_.clear();  // marks of the old file
        clearedMarks_.clear();
        providedMarks_.clear();
        corruptFile_.clear();
    }
    reopen_ = true;
    notify();
}

DestStatus Forwarder::status() const {
    std::lock_guard<std::mutex> lk(mu_);
    return status_;
}

std::vector<ForwardCursor> Forwarder::takeCursorUpdates() {
    std::lock_guard<std::mutex> lk(mu_);
    std::vector<ForwardCursor> out;
    out.reserve(updates_.size());
    for (const auto& [table, u] : updates_) out.push_back({cursorKey_, table, u.first, u.second});
    updates_.clear();
    return out;
}

}  // namespace mat
