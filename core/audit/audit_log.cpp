#include "core/audit/audit_log.hpp"

#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <deque>
#include <map>
#include <mutex>
#include <tuple>

#include "core/common/json_limits.hpp"
#include "core/common/json_text.hpp"
#include "core/common/utf8.hpp"
#include "core/historian/clock.hpp"
#include "nlohmann/json.hpp"
#include "sqlite3.h"

namespace mat {

namespace {

constexpr int kSchemaVersion = 1;
constexpr int64_t kDayMs = 86400000;
constexpr int kRetentionBatch = 2000;  // rows per retention transaction
constexpr int kMaxPurgeSteps = 50;     // 10 % steps above the size cap in one maintain()
constexpr size_t kMaxDetailInput = 64 * 1024;
constexpr int kMaxDetailDepth = 8;
constexpr size_t kMinCutString = 16;
// Byte limits of the text columns; the sign-in API takes a `user` of at most 64 bytes.
constexpr size_t kMaxUser = 64;
constexpr size_t kMaxRole = 32;
constexpr size_t kMaxSource = 64;
constexpr size_t kMaxTarget = 256;
constexpr size_t kMaxCode = 64;

// Column names as in data-model §7. `action` has no CHECK: later stages add actions without a
// migration; the enum of audit_actions.hpp guards what this code writes.
const char* const kSchema =
    "CREATE TABLE IF NOT EXISTS audit("
    "id INTEGER PRIMARY KEY, "
    "ts_ms INTEGER NOT NULL, "
    "clock_ok INTEGER NOT NULL CHECK(clock_ok IN (0, 1)), "
    "user TEXT, "
    "role TEXT, "
    "source TEXT NOT NULL, "
    "channel TEXT NOT NULL CHECK(channel IN ('https', 'http', 'cli', 'system')), "
    "action TEXT NOT NULL, "
    "target TEXT, "
    "result TEXT NOT NULL CHECK(result IN ('ok', 'failed', 'denied', 'started', 'rolled-back', "
    "'interrupted')), "
    "code TEXT, "
    "detail TEXT, "
    "count INTEGER NOT NULL DEFAULT 1 CHECK(count >= 1));"
    "CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts_ms);"
    "CREATE INDEX IF NOT EXISTS audit_user_ts ON audit(user, ts_ms);"
    "CREATE INDEX IF NOT EXISTS audit_action_ts ON audit(action, ts_ms);";

const char* const kColumns =
    "id, ts_ms, clock_ok, user, role, source, channel, action, target, result, code, detail, "
    "count";

int64_t wallNow() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

int64_t bootNow() {
    timespec ts{};
    ::clock_gettime(CLOCK_BOOTTIME, &ts);
    return static_cast<int64_t>(ts.tv_sec) * 1000 + static_cast<int64_t>(ts.tv_nsec) / 1000000;
}

// For valid UTF-8: the longest prefix of at most maxBytes bytes that does not split a character.
std::string utf8Cut(const std::string& s, size_t maxBytes) {
    if (s.size() <= maxBytes) return s;
    size_t n = maxBytes;
    while (n > 0 && (static_cast<unsigned char>(s[n]) & 0xC0) == 0x80) --n;
    return s.substr(0, n);
}

std::string bounded(const std::string& s, size_t maxBytes) {
    return utf8Cut(sanitizeUtf8(s), maxBytes);
}

std::optional<std::string> bounded(const std::optional<std::string>& s, size_t maxBytes) {
    if (!s) return std::nullopt;
    return bounded(*s, maxBytes);
}

// "10.0.0.5:51234" → "10.0.0.5", "[fe80::1]:8443" → "[fe80::1]"; "cli" and "system" unchanged.
// A coalesced row counts several connections, each from its own port.
std::string sourceAddress(const std::string& s) {
    if (!s.empty() && s[0] == '[') {
        const size_t end = s.find(']');
        return end == std::string::npos ? s : s.substr(0, end + 1);
    }
    const size_t colon = s.find(':');
    return colon != std::string::npos && s.find(':', colon + 1) == std::string::npos
               ? s.substr(0, colon)
               : s;
}

bool secretLikeKey(const std::string& key) {
    std::string k;
    for (char c : key) k += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    static const char* const kWords[] = {
        "password", "passwd", "passphrase", "secret",      "token",  "hash",   "credential",
        "authoriz", "cookie", "privatekey", "private_key", "apikey", "api_key"};
    for (const char* w : kWords)
        if (k.find(w) != std::string::npos) return true;
    return false;
}

std::optional<std::string> findSecretKey(const nlohmann::json& j) {
    if (j.is_object()) {
        for (auto it = j.begin(); it != j.end(); ++it) {
            if (secretLikeKey(it.key())) return it.key();
            if (auto r = findSecretKey(it.value())) return r;
        }
    } else if (j.is_array()) {
        for (const auto& v : j)
            if (auto r = findSecretKey(v)) return r;
    }
    return std::nullopt;
}

void longestString(nlohmann::json& j, nlohmann::json*& best) {
    if (j.is_string()) {
        if (!best ||
            j.get_ref<const std::string&>().size() > best->get_ref<const std::string&>().size())
            best = &j;
    } else if (j.is_object() || j.is_array()) {
        for (auto& v : j) longestString(v, best);
    }
}

// data-model §7: JSON ≤ 1 KiB. Compact form; above the limit the longest strings are cut (keys
// and short values stay) and "truncated": true is added, so the record is never lost to its
// detail.
std::optional<std::string> normalizeDetail(const std::string& text) {
    if (text.empty()) return std::nullopt;
    if (text.size() > kMaxDetailInput ||
        jsonNestingDepth(text.data(), text.size()) > kMaxDetailDepth)
        throw std::invalid_argument("audit detail is too large or too deep");
    nlohmann::json j = nlohmann::json::parse(text, nullptr, false);
    if (j.is_discarded() || !j.is_object())
        throw std::invalid_argument("audit detail must be a JSON object");
    if (auto key = findSecretKey(j))
        throw std::invalid_argument("audit detail must not carry a secret (key \"" + *key + "\")");
    std::string out = jsonText(j);
    if (out.size() <= kAuditMaxDetailBytes) return out;
    j["truncated"] = true;
    for (int i = 0; i < 64; ++i) {
        out = jsonText(j);
        if (out.size() <= kAuditMaxDetailBytes) return out;
        nlohmann::json* s = nullptr;
        longestString(j, s);
        if (!s) break;
        std::string& v = s->get_ref<std::string&>();
        if (v.size() <= kMinCutString) break;
        const size_t excess = out.size() - kAuditMaxDetailBytes + 3;  // + "…"
        v = utf8Cut(v, v.size() > excess + kMinCutString ? v.size() - excess : kMinCutString) +
            "\xE2\x80\xA6";
    }
    return std::string("{\"truncated\":true}");
}

// The files must stay 0600 (contracts/device-config.md §2). SQLite creates them so
// (SQLITE_DEFAULT_FILE_PERMISSIONS=0600; -wal and -shm take the mode of the database); this also
// fixes files made otherwise. Regular files only: a symlink is left alone.
void makePrivate(const std::string& path) {
    for (const char* ext : {"", "-wal", "-shm"}) {
        const std::string p = path + ext;
        struct stat st {};
        if (::lstat(p.c_str(), &st) == 0 && S_ISREG(st.st_mode) && (st.st_mode & 07777) != 0600)
            ::chmod(p.c_str(), 0600);
    }
}

std::optional<std::string> columnText(sqlite3_stmt* st, int i) {
    if (sqlite3_column_type(st, i) == SQLITE_NULL) return std::nullopt;
    const auto* t = reinterpret_cast<const char*>(sqlite3_column_text(st, i));
    return std::string(t ? t : "", static_cast<size_t>(sqlite3_column_bytes(st, i)));
}

void bindText(sqlite3_stmt* st, int i, const std::optional<std::string>& v) {
    if (v)
        sqlite3_bind_text(st, i, v->c_str(), static_cast<int>(v->size()), SQLITE_TRANSIENT);
    else
        sqlite3_bind_null(st, i);
}

// A row as inserted; kept by a coalescing window to write it again if it was purged meanwhile.
struct Row {
    int64_t tsMs = 0;
    bool clockOk = false;
    std::optional<std::string> user;
    std::optional<std::string> role;
    std::string source;
    AuditChannel channel = AuditChannel::System;
    AuditAction action = AuditAction::AuditSuppressed;
    std::optional<std::string> target;
    AuditResult result = AuditResult::Ok;
    std::optional<std::string> code;
    std::optional<std::string> detail;
    int64_t count = 1;
};

// (action, result, code, target, source address, user): R11 coalesces per (action, source,
// account); result, code and target are added so that one row never mixes two refusals.
using WindowKey = std::tuple<AuditAction, AuditResult, std::optional<std::string>,
                             std::optional<std::string>, std::string, std::optional<std::string>>;

struct Window {
    int64_t rowId = 0;
    int64_t openedMono = 0;
    int64_t count = 0;    // events counted in the row
    int64_t written = 0;  // count already in the file
    Row row;
    std::map<std::string, int64_t> byAction;  // audit.suppressed only
};

}  // namespace

bool timesyncSynchronized(const std::string& flagPath, int64_t wallMs) {
    return ::access(flagPath.c_str(), F_OK) == 0 && clockValid(wallMs);
}

AuditClock systemAuditClock() {
    AuditClock c;
    c.wallMs = wallNow;
    c.monoMs = bootNow;
    c.synced = [](int64_t wallMs) { return timesyncSynchronized(kTimesyncFlag, wallMs); };
    return c;
}

struct AuditLog::Impl {
    AuditOptions opt;
    std::string path;
    std::mutex mu;  // guards everything below
    sqlite3* db = nullptr;
    sqlite3_stmt* insert = nullptr;
    sqlite3_stmt* update = nullptr;
    std::map<WindowKey, Window> windows;
    std::optional<Window> suppressed;
    std::deque<int64_t> limitedRows;  // mono time of each limited row of the last 60 s
    int lastCode = 0;
    std::string lastError;

    bool exec(const char* sql) {
        char* msg = nullptr;
        if (sqlite3_exec(db, sql, nullptr, nullptr, &msg) == SQLITE_OK) return true;
        noteError(msg);
        sqlite3_free(msg);
        return false;
    }

    void noteError(const char* msg = nullptr) {
        lastCode = sqlite3_extended_errcode(db);
        lastError = msg ? msg : sqlite3_errmsg(db);
    }

    // Ends a failed transaction; the error that made it fail stays the one reported.
    void rollback() {
        const int code = lastCode;
        const std::string error = lastError;
        exec("ROLLBACK");
        lastCode = code;
        lastError = error;
    }

    [[noreturn]] void fail(const std::string& what) {
        throw AuditUnavailable("audit log: " + what + ": " + lastError, lastCode);
    }

    std::optional<int64_t> queryInt(const char* sql, std::optional<int64_t> arg = std::nullopt) {
        sqlite3_stmt* st = nullptr;
        if (sqlite3_prepare_v2(db, sql, -1, &st, nullptr) != SQLITE_OK) {
            noteError();
            return std::nullopt;
        }
        if (arg) sqlite3_bind_int64(st, 1, *arg);
        std::optional<int64_t> out;
        const int rc = sqlite3_step(st);
        if (rc == SQLITE_ROW && sqlite3_column_type(st, 0) != SQLITE_NULL)
            out = sqlite3_column_int64(st, 0);
        else if (rc != SQLITE_ROW && rc != SQLITE_DONE)
            noteError();
        sqlite3_finalize(st);
        return out;
    }

    int64_t usedBytes() {
        return (queryInt("PRAGMA page_count").value_or(0) -
                queryInt("PRAGMA freelist_count").value_or(0)) *
               queryInt("PRAGMA page_size").value_or(4096);
    }

    void closeLocked() {
        sqlite3_finalize(insert);
        sqlite3_finalize(update);
        insert = update = nullptr;
        if (db) sqlite3_close(db);
        db = nullptr;
        windows.clear();
        suppressed.reset();
        limitedRows.clear();
    }

    Row rowOf(const AuditEvent& e, std::optional<std::string> detail, bool limited) const {
        Row r;
        r.user = bounded(e.user, kMaxUser);
        r.role = bounded(e.role, kMaxRole);
        r.source = bounded(limited ? sourceAddress(e.source) : e.source, kMaxSource);
        r.channel = e.channel;
        r.action = e.action;
        r.target = bounded(e.target, kMaxTarget);
        r.result = e.result;
        r.code = bounded(e.code, kMaxCode);
        r.detail = std::move(detail);
        return r;
    }

    void stamp(Row& r) {
        r.tsMs = opt.clock.wallMs();
        r.clockOk = opt.clock.synced(r.tsMs);
    }

    // The id of the new row, or -1 (lastError set).
    int64_t insertRow(const Row& r) {
        sqlite3_reset(insert);
        sqlite3_clear_bindings(insert);
        sqlite3_bind_int64(insert, 1, r.tsMs);
        sqlite3_bind_int(insert, 2, r.clockOk ? 1 : 0);
        bindText(insert, 3, r.user);
        bindText(insert, 4, r.role);
        sqlite3_bind_text(insert, 5, r.source.c_str(), static_cast<int>(r.source.size()),
                          SQLITE_TRANSIENT);
        sqlite3_bind_text(insert, 6, auditChannelName(r.channel), -1, SQLITE_STATIC);
        sqlite3_bind_text(insert, 7, auditActionName(r.action), -1, SQLITE_STATIC);
        bindText(insert, 8, r.target);
        sqlite3_bind_text(insert, 9, auditResultName(r.result), -1, SQLITE_STATIC);
        bindText(insert, 10, r.code);
        bindText(insert, 11, r.detail);
        sqlite3_bind_int64(insert, 12, r.count);
        const int rc = sqlite3_step(insert);
        if (rc != SQLITE_DONE) noteError();
        sqlite3_reset(insert);
        return rc == SQLITE_DONE ? sqlite3_last_insert_rowid(db) : -1;
    }

    static bool expired(const Window& w, int64_t mono) {
        return mono - w.openedMono >= kAuditWindowMs;
    }

    bool hasPending(bool onlyExpired, int64_t mono) const {
        auto due = [&](const Window& w) {
            return w.count > w.written && (!onlyExpired || expired(w, mono));
        };
        for (const auto& kv : windows)
            if (due(kv.second)) return true;
        return suppressed && due(*suppressed);
    }

    // Windows that are over and fully written are done with.
    void prune(int64_t mono) {
        for (auto it = windows.begin(); it != windows.end();)
            it = expired(it->second, mono) && it->second.count == it->second.written
                     ? windows.erase(it)
                     : std::next(it);
        if (suppressed && expired(*suppressed, mono) && suppressed->count == suppressed->written)
            suppressed.reset();
        while (!limitedRows.empty() && mono - limitedRows.front() >= kAuditWindowMs)
            limitedRows.pop_front();
    }

    // One synced transaction: the counts still in memory (every window, or only those whose
    // 60 s are over), then `row` if given. Memory changes only once COMMIT has returned. Returns
    // the id of `row` (0 without one); throws AuditUnavailable.
    int64_t commit(const Row* row, bool onlyExpired, int64_t mono) {
        if (!exec("BEGIN IMMEDIATE")) fail("cannot begin");
        struct Done {
            Window* w;
            int64_t rowId;
        };
        std::vector<Done> done;
        auto flushOne = [&](Window& w, bool isSuppressed) {
            if (w.count <= w.written || (onlyExpired && !expired(w, mono))) return true;
            std::optional<std::string> detail;
            if (isSuppressed) detail = jsonText(nlohmann::json(w.byAction));
            sqlite3_reset(update);
            sqlite3_clear_bindings(update);
            sqlite3_bind_int64(update, 1, w.count);
            bindText(update, 2, detail);
            sqlite3_bind_int64(update, 3, w.rowId);
            sqlite3_bind_int64(update, 4, w.row.tsMs);
            sqlite3_bind_text(update, 5, auditActionName(w.row.action), -1, SQLITE_STATIC);
            sqlite3_bind_text(update, 6, w.row.source.c_str(),
                              static_cast<int>(w.row.source.size()), SQLITE_TRANSIENT);
            const int rc = sqlite3_step(update);
            if (rc != SQLITE_DONE) noteError();
            sqlite3_reset(update);
            if (rc != SQLITE_DONE) return false;
            int64_t id = w.rowId;
            if (sqlite3_changes(db) == 0) {  // purged above the size cap meanwhile: write it again
                Row again = w.row;
                again.count = w.count;
                if (isSuppressed) again.detail = detail;
                id = insertRow(again);
                if (id < 0) return false;
            }
            done.push_back({&w, id});
            return true;
        };
        bool ok = true;
        for (auto& kv : windows) ok = ok && flushOne(kv.second, false);
        if (suppressed) ok = ok && flushOne(*suppressed, true);
        int64_t id = 0;
        if (ok && row) {
            id = insertRow(*row);
            ok = id > 0;
        }
        if (!ok || !exec("COMMIT")) {
            rollback();
            fail("cannot write");
        }
        for (const Done& d : done) {
            d.w->written = d.w->count;
            d.w->rowId = d.rowId;
        }
        prune(mono);
        return id;
    }

    // Over 10 limited rows in the last 60 s: the event counts in the audit.suppressed row of the
    // current minute.
    int64_t suppress(AuditAction action, int64_t mono) {
        const std::string name = auditActionName(action);
        if (suppressed && !expired(*suppressed, mono)) {
            ++suppressed->count;
            ++suppressed->byAction[name];
            return suppressed->rowId;
        }
        Window w;
        w.byAction[name] = 1;
        w.row.source = "system";
        w.row.channel = AuditChannel::System;
        w.row.action = AuditAction::AuditSuppressed;
        w.row.result = AuditResult::Ok;
        w.row.detail = jsonText(nlohmann::json(w.byAction));
        stamp(w.row);
        const int64_t id = commit(&w.row, false, mono);  // also the count of the previous minute
        w.rowId = id;
        w.openedMono = mono;
        w.count = w.written = 1;
        suppressed = std::move(w);
        return id;
    }

    int64_t appendLocked(const AuditEvent& e, std::optional<std::string> detail) {
        if (!db) {
            lastCode = 0;
            lastError = "not open";
            fail("cannot append");
        }
        const int64_t mono = opt.clock.monoMs();
        if (!auditLimited(e.action, e.result)) {
            Row r = rowOf(e, std::move(detail), false);
            stamp(r);
            return commit(&r, false, mono);
        }
        Row r = rowOf(e, std::move(detail), true);
        WindowKey key{r.action, r.result, r.code, r.target, r.source, r.user};
        auto it = windows.find(key);
        if (it != windows.end() && !expired(it->second, mono)) {
            ++it->second.count;
            return it->second.rowId;
        }
        prune(mono);
        if (limitedRows.size() >= static_cast<size_t>(kAuditLimitedRowsPerWindow))
            return suppress(e.action, mono);
        stamp(r);
        const int64_t id = commit(&r, false, mono);  // writes the count of the window that is over
        Window w;
        w.rowId = id;
        w.openedMono = mono;
        w.count = w.written = 1;
        w.row = std::move(r);
        windows[key] = std::move(w);
        limitedRows.push_back(mono);
        return id;
    }

    // Deletes up to `limit` rows with id <= lastId in one transaction; -1 on failure.
    int deleteUpTo(int64_t lastId, int limit) {
        sqlite3_stmt* st = nullptr;
        if (sqlite3_prepare_v2(db,
                               "DELETE FROM audit WHERE id IN (SELECT id FROM audit WHERE id <= ? "
                               "ORDER BY id LIMIT ?)",
                               -1, &st, nullptr) != SQLITE_OK) {
            noteError();
            return -1;
        }
        sqlite3_bind_int64(st, 1, lastId);
        sqlite3_bind_int(st, 2, limit);
        const int rc = sqlite3_step(st);
        if (rc != SQLITE_DONE) noteError();
        sqlite3_finalize(st);
        return rc == SQLITE_DONE ? sqlite3_changes(db) : -1;
    }

    // One step of the size cap: the oldest 10 % of the rows and their audit.purged row, in one
    // transaction. Rows deleted, or -1.
    int64_t purgeStep(int64_t usedBefore) {
        const int64_t rows = queryInt("SELECT count(*) FROM audit").value_or(0);
        if (rows <= 0) return 0;
        const int64_t n = std::max<int64_t>(1, rows / 10);
        const int64_t lastId =
            queryInt("SELECT max(id) FROM (SELECT id FROM audit ORDER BY id LIMIT ?)", n)
                .value_or(0);
        if (!exec("BEGIN IMMEDIATE")) return -1;
        const int deleted = deleteUpTo(lastId, static_cast<int>(n));
        Row r;
        r.source = "system";
        r.channel = AuditChannel::System;
        r.action = AuditAction::AuditPurged;
        r.result = AuditResult::Ok;
        r.detail = jsonText({{"rows", deleted},
                             {"lastId", lastId},
                             {"usedBytes", usedBefore},
                             {"limitBytes", opt.maxBytes}});
        stamp(r);
        if (deleted < 0 || insertRow(r) < 0 || !exec("COMMIT")) {
            rollback();
            return -1;
        }
        return deleted;
    }
};

AuditLog::AuditLog(AuditOptions options) : impl_(std::make_unique<Impl>()) {
    if (options.dataDir.empty()) throw std::invalid_argument("audit log: no data directory");
    if (options.retentionDays < 1) throw std::invalid_argument("audit log: retentionDays < 1");
    if (options.maxBytes < 1) throw std::invalid_argument("audit log: maxBytes < 1");
    const AuditClock sys = systemAuditClock();
    if (!options.clock.wallMs) options.clock.wallMs = sys.wallMs;
    if (!options.clock.monoMs) options.clock.monoMs = sys.monoMs;
    if (!options.clock.synced) options.clock.synced = sys.synced;
    impl_->path = options.dataDir + "/" + kAuditFileName;
    impl_->opt = std::move(options);
}

AuditLog::~AuditLog() { close(); }

bool AuditLog::open(std::string& err, AuditMaintenance* maintenance) {
    close();  // an open log first writes its counts
    int64_t now = 0;
    {
        std::lock_guard<std::mutex> lk(impl_->mu);
        Impl& s = *impl_;
        auto failed = [&](const std::string& what) {
            err = "audit log " + s.path + ": " + what + (s.lastError.empty() ? "" : ": ") +
                  s.lastError;
            s.closeLocked();
            return false;
        };
        s.lastError.clear();
        makePrivate(s.path);
        if (sqlite3_open_v2(s.path.c_str(), &s.db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
                            nullptr) != SQLITE_OK) {
            if (s.db) s.noteError();
            return failed("cannot open");
        }
        sqlite3_extended_result_codes(s.db, 1);
        sqlite3_busy_timeout(s.db, 5000);  // the device commands write from another process
        // Constitution 2.0.1 / ADR-011: every write transaction of audit.db is synced (FULL), so a
        // record append() returned survives a power cut. 256 KiB of cache (data-model §7). A row
        // touches four B-tree pages (table and three indexes): 1 KiB pages put about a third of
        // the bytes of 4 KiB pages in the WAL per commit (T025 measure); only a new file takes it.
        if (!s.exec("PRAGMA page_size=1024") || !s.exec("PRAGMA journal_mode=WAL") ||
            !s.exec("PRAGMA synchronous=FULL") || !s.exec("PRAGMA cache_size=-256") ||
            !s.exec("PRAGMA temp_store=MEMORY") || !s.exec("PRAGMA journal_size_limit=4194304"))
            return failed("cannot set up");
        sqlite3_stmt* st = nullptr;
        std::string mode;
        if (sqlite3_prepare_v2(s.db, "PRAGMA journal_mode", -1, &st, nullptr) == SQLITE_OK &&
            sqlite3_step(st) == SQLITE_ROW)
            mode = reinterpret_cast<const char*>(sqlite3_column_text(st, 0));
        sqlite3_finalize(st);
        if (mode != "wal") return failed("WAL is not available (journal_mode " + mode + ")");
        if (!s.exec("BEGIN IMMEDIATE")) return failed("cannot create the table");
        const int64_t version = s.queryInt("PRAGMA user_version").value_or(0);
        if (!s.exec(kSchema) ||
            (version == 0 &&
             !s.exec(("PRAGMA user_version=" + std::to_string(kSchemaVersion)).c_str())) ||
            !s.exec("COMMIT")) {
            s.rollback();
            return failed("cannot create the table");
        }
        const std::string insert = std::string("INSERT INTO audit(") +
                                   "ts_ms, clock_ok, user, role, source, channel, action, target, "
                                   "result, code, detail, count) "
                                   "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        if (sqlite3_prepare_v3(s.db, insert.c_str(), -1, SQLITE_PREPARE_PERSISTENT, &s.insert,
                               nullptr) != SQLITE_OK ||
            // The id alone is not enough: INTEGER PRIMARY KEY gives a deleted newest id again.
            sqlite3_prepare_v3(s.db,
                               "UPDATE audit SET count = ?1, detail = coalesce(?2, detail) "
                               "WHERE id = ?3 AND ts_ms = ?4 AND action = ?5 AND source = ?6",
                               -1, SQLITE_PREPARE_PERSISTENT, &s.update, nullptr) != SQLITE_OK) {
            s.noteError();
            return failed("cannot prepare");
        }
        makePrivate(s.path);
        now = s.opt.clock.wallMs();
    }
    const AuditMaintenance m = maintain(now);  // retention and size cap at start-up (R11)
    if (maintenance) *maintenance = m;
    return true;
}

void AuditLog::close() {
    std::lock_guard<std::mutex> lk(impl_->mu);
    Impl& s = *impl_;
    if (s.db) {
        const int64_t mono = s.opt.clock.monoMs();
        try {
            if (s.hasPending(false, mono)) s.commit(nullptr, false, mono);
        } catch (const AuditUnavailable&) {  // nothing more can be done with these counts
        }
    }
    s.closeLocked();
}

bool AuditLog::isOpen() const {
    std::lock_guard<std::mutex> lk(impl_->mu);
    return impl_->db != nullptr;
}

const std::string& AuditLog::path() const { return impl_->path; }

int64_t AuditLog::append(const AuditEvent& event) {
    if (event.source.empty()) throw std::invalid_argument("audit event without a source");
    std::optional<std::string> detail = normalizeDetail(event.detail);
    std::lock_guard<std::mutex> lk(impl_->mu);
    return impl_->appendLocked(event, std::move(detail));
}

void AuditLog::flushExpired() {
    std::lock_guard<std::mutex> lk(impl_->mu);
    Impl& s = *impl_;
    if (!s.db) return;  // close() already wrote what it could
    const int64_t mono = s.opt.clock.monoMs();
    if (s.hasPending(true, mono))
        s.commit(nullptr, true, mono);
    else
        s.prune(mono);
}

AuditMaintenance AuditLog::maintain(int64_t nowMs) {
    AuditMaintenance m;
    Impl& s = *impl_;
    auto note = [&](const std::string& what) {
        if (m.error.empty()) m.error = what + ": " + s.lastError;
    };
    bool synced = false;
    {
        std::lock_guard<std::mutex> lk(s.mu);
        if (!s.db) {
            m.error = "audit log is not open";
            return m;
        }
        const int64_t mono = s.opt.clock.monoMs();
        try {
            if (s.hasPending(false, mono)) s.commit(nullptr, false, mono);
        } catch (const AuditUnavailable& e) {
            m.error = e.what();
        }
        synced = s.opt.clock.synced(nowMs);
    }
    // Retention: only with a synchronised clock. A row written while the clock was wrong
    // (clock_ok = 0) is older than every row after it, so everything up to the newest expired
    // row with clock_ok = 1 goes, whatever its own ts_ms says. Batches, the lock released between
    // them so that sign-ins are not held up.
    if (synced) {
        m.retentionRan = true;
        const int64_t cutoff = nowMs - static_cast<int64_t>(s.opt.retentionDays) * kDayMs;
        std::optional<int64_t> lastId;
        {
            std::lock_guard<std::mutex> lk(s.mu);
            if (s.db)
                lastId = s.queryInt("SELECT max(id) FROM audit WHERE clock_ok = 1 AND ts_ms < ?",
                                    cutoff);
        }
        while (lastId) {
            std::lock_guard<std::mutex> lk(s.mu);
            if (!s.db) break;
            int n = -1;
            if (s.exec("BEGIN IMMEDIATE")) {
                n = s.deleteUpTo(*lastId, kRetentionBatch);
                if (n < 0 || !s.exec("COMMIT")) {
                    s.rollback();
                    n = -1;
                }
            }
            if (n < 0) {
                note("retention");
                break;
            }
            m.expired += n;
            if (n < kRetentionBatch) break;
        }
    }
    // Size cap, whatever the clock: the oldest 10 % per step until the file is under the cap.
    for (int step = 0; step < kMaxPurgeSteps; ++step) {
        std::lock_guard<std::mutex> lk(s.mu);
        if (!s.db) break;
        const int64_t used = s.usedBytes();
        if (used <= s.opt.maxBytes) break;
        const int64_t n = s.purgeStep(used);
        if (n < 0) {
            note("size cap");
            break;
        }
        if (n == 0) break;
        m.purged += n;
    }
    return m;
}

AuditPage AuditLog::query(const AuditQuery& q) { return run(q, 0, false); }

AuditPage AuditLog::queryAscending(const AuditQuery& q, int64_t afterId) {
    return run(q, std::max<int64_t>(afterId, 0), true);
}

AuditPage AuditLog::run(const AuditQuery& q, int64_t afterId, bool ascending) {
    std::lock_guard<std::mutex> lk(impl_->mu);
    Impl& s = *impl_;
    if (!s.db) {
        s.lastCode = 0;
        s.lastError = "not open";
        s.fail("cannot read");
    }
    const int64_t mono = s.opt.clock.monoMs();
    try {  // the reader sees every event counted so far
        if (s.hasPending(false, mono)) s.commit(nullptr, false, mono);
    } catch (const AuditUnavailable&) {  // the rows still read, with the counts already written
    }
    std::string sql = std::string("SELECT ") + kColumns + " FROM audit WHERE 1";
    if (q.fromMs) sql += " AND ts_ms >= ?";
    if (q.toMs) sql += " AND ts_ms < ?";
    if (q.user) sql += " AND user = ?";
    // A prefix as a range, so that '%' and '_' mean themselves; 0xFF never occurs in UTF-8.
    if (!q.actionPrefix.empty()) sql += " AND action >= ? AND action < ?";
    if (q.beforeId) sql += " AND id < ?";
    if (ascending) sql += " AND id > ?";
    sql += ascending ? " ORDER BY id ASC LIMIT ?" : " ORDER BY id DESC LIMIT ?";
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(s.db, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) {
        s.noteError();
        s.fail("cannot read");
    }
    int i = 0;
    if (q.fromMs) sqlite3_bind_int64(st, ++i, *q.fromMs);
    if (q.toMs) sqlite3_bind_int64(st, ++i, *q.toMs);
    if (q.user) bindText(st, ++i, q.user);
    if (!q.actionPrefix.empty()) {
        bindText(st, ++i, q.actionPrefix);
        bindText(st, ++i, q.actionPrefix + "\xFF");
    }
    if (q.beforeId) sqlite3_bind_int64(st, ++i, *q.beforeId);
    if (ascending) sqlite3_bind_int64(st, ++i, afterId);
    const int limit = std::clamp(q.limit, 1, kAuditQueryMaxLimit);
    sqlite3_bind_int(st, ++i, limit + 1);
    AuditPage page;
    int rc;
    while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
        AuditRecord r;
        r.id = sqlite3_column_int64(st, 0);
        r.tsMs = sqlite3_column_int64(st, 1);
        r.clockOk = sqlite3_column_int(st, 2) != 0;
        r.user = columnText(st, 3);
        r.role = columnText(st, 4);
        r.source = columnText(st, 5).value_or("");
        r.channel = columnText(st, 6).value_or("");
        r.action = columnText(st, 7).value_or("");
        r.target = columnText(st, 8);
        r.result = columnText(st, 9).value_or("");
        r.code = columnText(st, 10);
        r.detail = columnText(st, 11);
        r.count = sqlite3_column_int64(st, 12);
        page.records.push_back(std::move(r));
    }
    if (rc != SQLITE_DONE) s.noteError();
    sqlite3_finalize(st);
    if (rc != SQLITE_DONE) s.fail("cannot read");
    if (page.records.size() > static_cast<size_t>(limit)) {
        page.records.pop_back();
        page.next = page.records.back().id;
    }
    return page;
}

std::string AuditLog::pragmaText(const char* name) {
    std::lock_guard<std::mutex> lk(impl_->mu);
    Impl& s = *impl_;
    if (!s.db) return "";
    sqlite3_stmt* st = nullptr;
    std::string out;
    if (sqlite3_prepare_v2(s.db, (std::string("PRAGMA ") + name).c_str(), -1, &st, nullptr) ==
            SQLITE_OK &&
        sqlite3_step(st) == SQLITE_ROW && sqlite3_column_type(st, 0) != SQLITE_NULL)
        out = reinterpret_cast<const char*>(sqlite3_column_text(st, 0));
    sqlite3_finalize(st);
    return out;
}

int64_t AuditLog::pragmaInt(const char* name) {
    std::lock_guard<std::mutex> lk(impl_->mu);
    Impl& s = *impl_;
    return s.db ? s.queryInt((std::string("PRAGMA ") + name).c_str()).value_or(0) : 0;
}

bool AuditLog::execForTest(const std::string& sql, std::string& err) {
    std::lock_guard<std::mutex> lk(impl_->mu);
    Impl& s = *impl_;
    if (!s.db) {
        err = "not open";
        return false;
    }
    if (s.exec(sql.c_str())) return true;
    err = s.lastError;
    return false;
}

}  // namespace mat
