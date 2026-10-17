// alarm.db (contracts/alarm-store.md). Style and corrupt-file handling follow
// core/historian/local_store.cpp.
#include "core/alarm/alarm_store.hpp"

#include <dirent.h>
#include <sqlite3.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstring>

#include "core/historian/write_counter_vfs.hpp"

namespace mat::alarm {

const char* const kSchemaV1 = R"SQL(
CREATE TABLE IF NOT EXISTS alarm_meta(
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS alarm_occurrence(
  id               INTEGER PRIMARY KEY,
  alarm_id         TEXT    NOT NULL,
  fingerprint      TEXT    NOT NULL,
  ts_active_ms     INTEGER NOT NULL,
  clock_ok         INTEGER NOT NULL CHECK(clock_ok IN (0, 1)),
  ts_ack_ms        INTEGER,
  ack_user         TEXT,
  ts_return_ms     INTEGER,
  ts_return_ack_ms INTEGER,
  return_ack_user  TEXT,
  priority         INTEGER NOT NULL CHECK(priority BETWEEN 1 AND 4),
  class            TEXT    NOT NULL,
  area             TEXT,
  text             TEXT    NOT NULL,
  text_fold        TEXT    NOT NULL,
  value_active     REAL,
  quality_active   TEXT    NOT NULL CHECK(quality_active IN ('GOOD', 'UNCERTAIN', 'BAD')),
  reason           TEXT,
  flags            INTEGER NOT NULL DEFAULT 0 CHECK(flags BETWEEN 0 AND 3),
  repeat_count     INTEGER NOT NULL DEFAULT 1 CHECK(repeat_count >= 1),
  closed           INTEGER NOT NULL DEFAULT 0 CHECK(closed IN (0, 1)),
  closed_by        TEXT CHECK(closed_by IS NULL OR
                              closed_by IN ('return', 'config', 'disabled', 'restart-lost')),
  CHECK((closed = 0) = (closed_by IS NULL))
);
CREATE INDEX IF NOT EXISTS alarm_occ_ts       ON alarm_occurrence(ts_active_ms);
CREATE INDEX IF NOT EXISTS alarm_occ_alarm_ts ON alarm_occurrence(alarm_id, ts_active_ms);
CREATE INDEX IF NOT EXISTS alarm_occ_prio_ts  ON alarm_occurrence(priority, ts_active_ms);
CREATE INDEX IF NOT EXISTS alarm_occ_open     ON alarm_occurrence(alarm_id) WHERE closed = 0;
CREATE TABLE IF NOT EXISTS alarm_override(
  alarm_id    TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK(kind IN ('shelve', 'disable')),
  user        TEXT    NOT NULL,
  reason      TEXT    NOT NULL,
  system      INTEGER NOT NULL DEFAULT 0 CHECK(system IN (0, 1)),
  ts_start_ms INTEGER NOT NULL,
  clock_ok    INTEGER NOT NULL CHECK(clock_ok IN (0, 1)),
  ts_end_ms   INTEGER,
  PRIMARY KEY(alarm_id, kind),
  CHECK((kind = 'shelve') = (ts_end_ms IS NOT NULL))
) WITHOUT ROWID;
)SQL";

namespace {

bool execSql(sqlite3* db, const std::string& sql, std::string& err) {
    char* msg = nullptr;
    if (sqlite3_exec(db, sql.c_str(), nullptr, nullptr, &msg) != SQLITE_OK) {
        err = msg ? msg : "sqlite error";
        sqlite3_free(msg);
        return false;
    }
    return true;
}

bool isCorrupt(int rc) {
    const int p = rc & 0xFF;
    return p == SQLITE_CORRUPT || p == SQLITE_NOTADB;
}

std::optional<std::string> queryText(sqlite3* db, const std::string& sql) {
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) return std::nullopt;
    std::optional<std::string> r;
    if (sqlite3_step(st) == SQLITE_ROW && sqlite3_column_type(st, 0) != SQLITE_NULL)
        r = reinterpret_cast<const char*>(sqlite3_column_text(st, 0));
    sqlite3_finalize(st);
    return r;
}

int64_t queryInt(sqlite3* db, const std::string& sql, int64_t dflt = 0) {
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) return dflt;
    int64_t v = dflt;
    if (sqlite3_step(st) == SQLITE_ROW) v = sqlite3_column_int64(st, 0);
    sqlite3_finalize(st);
    return v;
}

void bindText(sqlite3_stmt* st, int i, const std::optional<std::string>& v) {
    if (v)
        sqlite3_bind_text(st, i, v->c_str(), static_cast<int>(v->size()), SQLITE_TRANSIENT);
    else
        sqlite3_bind_null(st, i);
}
void bindInt(sqlite3_stmt* st, int i, const std::optional<int64_t>& v) {
    if (v)
        sqlite3_bind_int64(st, i, *v);
    else
        sqlite3_bind_null(st, i);
}
std::optional<std::string> colText(sqlite3_stmt* st, int i) {
    if (sqlite3_column_type(st, i) == SQLITE_NULL) return std::nullopt;
    const auto* t = reinterpret_cast<const char*>(sqlite3_column_text(st, i));
    return std::string(t ? t : "", static_cast<size_t>(sqlite3_column_bytes(st, i)));
}
std::optional<int64_t> colInt(sqlite3_stmt* st, int i) {
    if (sqlite3_column_type(st, i) == SQLITE_NULL) return std::nullopt;
    return sqlite3_column_int64(st, i);
}

const char* kUpsert =
    "INSERT INTO alarm_occurrence(id, alarm_id, fingerprint, ts_active_ms, clock_ok, ts_ack_ms, "
    "ack_user,"
    " ts_return_ms, ts_return_ack_ms, return_ack_user, priority, class, area, text, text_fold,"
    " value_active, quality_active, reason, flags, repeat_count, closed, closed_by)"
    " VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)"
    " ON CONFLICT(id) DO UPDATE SET"
    " ts_ack_ms = excluded.ts_ack_ms, ack_user = excluded.ack_user,"
    " ts_return_ms = excluded.ts_return_ms, ts_return_ack_ms = excluded.ts_return_ack_ms,"
    " return_ack_user = excluded.return_ack_user, repeat_count = excluded.repeat_count,"
    " closed = excluded.closed, closed_by = excluded.closed_by";

const char* kOverrideUpsert =
    "INSERT INTO alarm_override(alarm_id, kind, user, reason, system, ts_start_ms, clock_ok, "
    "ts_end_ms)"
    " VALUES(?1,?2,?3,?4,?5,?6,?7,?8)"
    " ON CONFLICT(alarm_id, kind) DO UPDATE SET user = excluded.user, reason = excluded.reason,"
    " system = excluded.system, ts_start_ms = excluded.ts_start_ms, clock_ok = excluded.clock_ok,"
    " ts_end_ms = excluded.ts_end_ms";

const char* kHighWater =
    "INSERT INTO alarm_meta(key, value) VALUES('high_water', CAST((SELECT IFNULL(MAX(id), 0) FROM "
    "alarm_occurrence) AS TEXT)) ON CONFLICT(key) DO UPDATE SET value = CASE WHEN "
    "CAST(excluded.value AS INTEGER) > CAST(value AS INTEGER) THEN excluded.value ELSE value END";

}  // namespace

AlarmStore::AlarmStore(std::string dir, std::function<int64_t()> nowEpochMs)
    : dir_(std::move(dir)), path_(dir_ + "/alarm.db"), nowMs_(std::move(nowEpochMs)) {}

AlarmStore::~AlarmStore() { close(false); }

bool AlarmStore::run(const char* sql, std::string& err) {
    if (!db_) {
        err = "store not open";
        return false;
    }
    if (!execSql(db_, sql, err)) {
        lastRc_ = sqlite3_extended_errcode(db_);
        return false;
    }
    return true;
}

void AlarmStore::makePrivate() {
    for (const char* ext : {"", "-wal", "-shm"}) {
        const std::string p = path_ + ext;
        struct stat st {};
        if (::lstat(p.c_str(), &st) == 0 && S_ISREG(st.st_mode) && (st.st_mode & 07777) != 0600)
            ::chmod(p.c_str(), 0600);
    }
}

bool AlarmStore::createSchema(std::string& err) {
    if (!execSql(db_, kSchemaV1, err)) return false;
    // migration of the numbered schema: version 1 is the first; later versions add steps here
    auto v = queryText(db_, "SELECT value FROM alarm_meta WHERE key='schema'");
    // NOLINTNEXTLINE(cert-err34-c): written by the runtime (alarm_meta) (SAST T055)
    const int cur = v ? std::atoi(v->c_str()) : 0;
    if (cur > kAlarmSchemaVersion) {
        schemaTooNew_ = true;
        err = "alarm.db has schema " + std::to_string(cur) + ", newer than " +
              std::to_string(kAlarmSchemaVersion);
        return false;
    }
    if (cur < 1) {
        if (!execSql(db_, "INSERT OR REPLACE INTO alarm_meta(key, value) VALUES('schema', '1')",
                     err))
            return false;
    }
    char created[40];
    std::snprintf(created, sizeof created, "%lld", static_cast<long long>(nowMs_()));
    return execSql(
        db_,
        std::string("INSERT OR IGNORE INTO alarm_meta(key, value) VALUES('created_ms', '") +
            created + "')",
        err);
}

bool AlarmStore::openFile(std::string& err) {
    if (sqlite3_open_v2(path_.c_str(), &db_, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
                        countingVfsName()) != SQLITE_OK) {
        err = db_ ? sqlite3_errmsg(db_) : "sqlite3_open_v2 failed";
        return false;
    }
    sqlite3_extended_result_codes(db_, 1);
    sqlite3_busy_timeout(db_, 5000);
    // page_size first: it only has an effect before the first table; no synchronous=FULL, ever
    return execSql(db_,
                   "PRAGMA page_size=4096;"
                   "PRAGMA journal_mode=WAL;"
                   "PRAGMA synchronous=NORMAL;"
                   "PRAGMA cache_size=-2048;"
                   "PRAGMA temp_store=MEMORY;"
                   "PRAGMA journal_size_limit=4194304;"
                   "PRAGMA wal_autocheckpoint=1000;"
                   "PRAGMA foreign_keys=OFF;",
                   err);
}

bool AlarmStore::open(std::string& err) {
    close(false);
    recovered_ = false;
    schemaTooNew_ = false;
    bool renamed = false;
    for (int attempt = 0; attempt < 2; ++attempt) {
        bool ok = openFile(err);
        bool corrupt = false;
        if (ok) {
            ok = createSchema(err);  // a damaged header shows up here
            if (!ok && !schemaTooNew_) corrupt = isCorrupt(sqlite3_extended_errcode(db_));
            if (!ok && schemaTooNew_) {
                sqlite3_close(db_);
                db_ = nullptr;
                return false;
            }
        } else {
            corrupt = db_ && isCorrupt(sqlite3_extended_errcode(db_));
        }
        if (ok) {
            // an unclean stop: look at the file before trusting it
            auto clean = getMeta("clean");
            if (!clean || *clean != "1") {
                if (queryInt(db_, "SELECT COUNT(*) FROM sqlite_master") > 0 &&
                    integrityCheck(10) != "ok") {
                    ok = false;
                    corrupt = true;
                }
            }
        }
        if (ok) break;
        if (db_) {
            sqlite3_close(db_);
            db_ = nullptr;
        }
        if (!corrupt || attempt == 1) return false;
        err.clear();
        if (!renameAndRecreate(err)) return false;  // opens the new file
        renamed = true;
        if (!createSchema(err)) {
            sqlite3_close(db_);
            db_ = nullptr;
            return false;
        }
        break;
    }
    (void)renamed;
    if (!db_) return false;
    if (!execSql(db_, "INSERT OR REPLACE INTO alarm_meta(key, value) VALUES('clean', '0')", err))
        return false;
    makePrivate();
    return true;
}

void AlarmStore::close(bool clean) {
    if (!db_) return;
    std::string err;
    if (clean) {
        execSql(db_, kHighWater, err);
        execSql(db_, "INSERT OR REPLACE INTO alarm_meta(key, value) VALUES('clean', '1')", err);
        execSql(db_, "PRAGMA wal_checkpoint(TRUNCATE)", err);
    }
    sqlite3_close(db_);
    db_ = nullptr;
}

std::vector<std::string> AlarmStore::corruptFiles() const {
    std::vector<std::string> out;
    if (DIR* d = opendir(dir_.c_str())) {
        while (dirent* e = readdir(d)) {
            const std::string n = e->d_name;
            if (n.rfind("alarm.db.corrupt-", 0) == 0) out.push_back(n);
        }
        closedir(d);
    }
    std::sort(out.begin(), out.end());
    return out;
}

void AlarmStore::pruneCorruptFiles() {
    // keep the three newest by epoch (then by suffix); the names sort by epoch (same digit count)
    auto files = corruptFiles();
    std::sort(files.begin(), files.end(), [](const std::string& a, const std::string& b) {
        if (a.size() != b.size()) return a.size() < b.size();
        return a < b;
    });
    while (files.size() > 3) {
        ::unlink((dir_ + "/" + files.front()).c_str());
        files.erase(files.begin());
    }
}

bool AlarmStore::renameAndRecreate(std::string& err) {
    if (db_) {
        sqlite3_close(db_);
        db_ = nullptr;
    }
    std::string suffix = ".corrupt-" + std::to_string(nowMs_() / 1000);
    for (int n = 2; ::access((path_ + suffix).c_str(), F_OK) == 0; ++n)
        suffix = ".corrupt-" + std::to_string(nowMs_() / 1000) + "-" + std::to_string(n);
    // the WAL and shm first: a new file must never meet the WAL of the damaged one
    for (const char* ext : {"-wal", "-shm", ""}) {
        const std::string from = path_ + ext;
        if (::access(from.c_str(), F_OK) != 0) continue;
        if (std::rename(from.c_str(), (path_ + ext + suffix).c_str()) != 0) {
            err = "cannot rename " + from + ": " + std::strerror(errno);
            return false;
        }
    }
    recovered_ = true;
    pruneCorruptFiles();
    if (!openFile(err)) {
        if (db_) {
            sqlite3_close(db_);
            db_ = nullptr;
        }
        return false;
    }
    return true;
}

bool AlarmStore::replaceCorrupt(std::string& err) {
    if (!renameAndRecreate(err)) return false;
    if (!createSchema(err)) return false;
    execSql(db_, "INSERT OR REPLACE INTO alarm_meta(key, value) VALUES('clean', '0')", err);
    makePrivate();
    return true;
}

bool AlarmStore::lastErrorIsCorrupt() const { return isCorrupt(lastRc_); }

bool AlarmStore::commit(const std::vector<OccurrenceRow>& rows,
                        const std::vector<OverrideChange>& overrides,
                        const std::map<std::string, std::string>& meta, std::string& err) {
    if (!db_) {
        err = "store not open";
        return false;
    }
    if (!run("BEGIN IMMEDIATE", err)) return false;
    bool ok = true;
    sqlite3_stmt* st = nullptr;
    int64_t maxId = 0;
    std::vector<const OccurrenceRow*> sorted;
    for (const auto& r : rows) sorted.push_back(&r);
    std::sort(sorted.begin(), sorted.end(), [](auto* a, auto* b) { return a->id < b->id; });
    if (!sorted.empty()) {
        ok = sqlite3_prepare_v2(db_, kUpsert, -1, &st, nullptr) == SQLITE_OK;
        for (size_t k = 0; ok && k < sorted.size(); ++k) {
            const OccurrenceRow& r = *sorted[k];
            maxId = std::max(maxId, r.id);
            sqlite3_reset(st);
            sqlite3_clear_bindings(st);
            sqlite3_bind_int64(st, 1, r.id);
            sqlite3_bind_text(st, 2, r.alarmId.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 3, r.fingerprint.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_int64(st, 4, r.tsActiveMs);
            sqlite3_bind_int(st, 5, r.clockOk ? 1 : 0);
            bindInt(st, 6, r.tsAckMs);
            bindText(st, 7, r.ackUser);
            bindInt(st, 8, r.tsReturnMs);
            bindInt(st, 9, r.tsReturnAckMs);
            bindText(st, 10, r.returnAckUser);
            sqlite3_bind_int(st, 11, r.priority);
            sqlite3_bind_text(st, 12, r.classId.c_str(), -1, SQLITE_TRANSIENT);
            bindText(st, 13, r.area);
            sqlite3_bind_text(st, 14, r.text.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 15, r.textFold.c_str(), -1, SQLITE_TRANSIENT);
            if (r.valueActive)
                sqlite3_bind_double(st, 16, *r.valueActive);
            else
                sqlite3_bind_null(st, 16);
            sqlite3_bind_text(st, 17, r.qualityActive.c_str(), -1, SQLITE_TRANSIENT);
            bindText(st, 18, r.reason);
            sqlite3_bind_int(st, 19, r.flags);
            sqlite3_bind_int(st, 20, r.repeatCount);
            sqlite3_bind_int(st, 21, r.closed ? 1 : 0);
            if (r.closed)
                sqlite3_bind_text(st, 22, closedByName(r.closedBy), -1, SQLITE_STATIC);
            else
                sqlite3_bind_null(st, 22);
            ok = sqlite3_step(st) == SQLITE_DONE;
        }
        sqlite3_finalize(st);
        st = nullptr;
    }
    for (size_t k = 0; ok && k < overrides.size(); ++k) {
        const OverrideChange& c = overrides[k];
        const char* sql = c.remove ? "DELETE FROM alarm_override WHERE alarm_id = ?1 AND kind = ?2"
                                   : kOverrideUpsert;
        ok = sqlite3_prepare_v2(db_, sql, -1, &st, nullptr) == SQLITE_OK;
        if (!ok) break;
        sqlite3_bind_text(st, 1, c.row.alarmId.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(st, 2, c.row.kind.c_str(), -1, SQLITE_TRANSIENT);
        if (!c.remove) {
            sqlite3_bind_text(st, 3, c.row.user.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 4, c.row.reason.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_int(st, 5, c.row.system ? 1 : 0);
            sqlite3_bind_int64(st, 6, c.row.tsStartMs);
            sqlite3_bind_int(st, 7, c.row.clockOk ? 1 : 0);
            bindInt(st, 8, c.row.tsEndMs);
        }
        ok = sqlite3_step(st) == SQLITE_DONE;
        sqlite3_finalize(st);
        st = nullptr;
    }
    for (auto it = meta.begin(); ok && it != meta.end(); ++it) {
        ok = sqlite3_prepare_v2(db_, "INSERT OR REPLACE INTO alarm_meta(key, value) VALUES(?1, ?2)",
                                -1, &st, nullptr) == SQLITE_OK;
        if (!ok) break;
        sqlite3_bind_text(st, 1, it->first.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(st, 2, it->second.c_str(), -1, SQLITE_TRANSIENT);
        ok = sqlite3_step(st) == SQLITE_DONE;
        sqlite3_finalize(st);
        st = nullptr;
    }
    if (ok && maxId > 0) {
        char buf[32];
        std::snprintf(buf, sizeof buf, "%lld", static_cast<long long>(maxId));
        ok = sqlite3_prepare_v2(
                 db_,
                 "INSERT INTO alarm_meta(key, value) VALUES('high_water', ?1) ON CONFLICT(key) DO "
                 "UPDATE SET value = CASE WHEN CAST(excluded.value AS INTEGER) > CAST(value AS "
                 "INTEGER) THEN excluded.value ELSE value END",
                 -1, &st, nullptr) == SQLITE_OK;
        if (ok) {
            sqlite3_bind_text(st, 1, buf, -1, SQLITE_TRANSIENT);
            ok = sqlite3_step(st) == SQLITE_DONE;
            sqlite3_finalize(st);
        }
    }
    if (!ok) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
        std::string ignored;
        execSql(db_, "ROLLBACK", ignored);
        return false;
    }
    if (!run("COMMIT", err)) {
        std::string ignored;
        execSql(db_, "ROLLBACK", ignored);
        return false;
    }
    return true;
}

std::vector<OccurrenceRow> AlarmStore::loadOpen(std::string& err) {
    std::vector<OccurrenceRow> out;
    if (!db_) {
        err = "store not open";
        return out;
    }
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(
            db_,
            "SELECT id, alarm_id, fingerprint, ts_active_ms, clock_ok, ts_ack_ms, ack_user,"
            " ts_return_ms, ts_return_ack_ms, return_ack_user, priority, class, area, text,"
            " value_active, quality_active, reason, flags, repeat_count, text_fold"
            " FROM alarm_occurrence WHERE closed = 0 ORDER BY id",
            -1, &st, nullptr) != SQLITE_OK) {
        err = sqlite3_errmsg(db_);
        return out;
    }
    while (sqlite3_step(st) == SQLITE_ROW) {
        OccurrenceRow r;
        r.id = sqlite3_column_int64(st, 0);
        r.alarmId = *colText(st, 1);
        r.fingerprint = *colText(st, 2);
        r.tsActiveMs = sqlite3_column_int64(st, 3);
        r.clockOk = sqlite3_column_int(st, 4) != 0;
        r.tsAckMs = colInt(st, 5);
        r.ackUser = colText(st, 6);
        r.tsReturnMs = colInt(st, 7);
        r.tsReturnAckMs = colInt(st, 8);
        r.returnAckUser = colText(st, 9);
        r.priority = sqlite3_column_int(st, 10);
        r.classId = *colText(st, 11);
        r.area = colText(st, 12);
        r.text = *colText(st, 13);
        if (sqlite3_column_type(st, 14) != SQLITE_NULL)
            r.valueActive = sqlite3_column_double(st, 14);
        r.qualityActive = *colText(st, 15);
        r.reason = colText(st, 16);
        r.flags = sqlite3_column_int(st, 17);
        r.repeatCount = sqlite3_column_int(st, 18);
        r.textFold = colText(st, 19).value_or("");
        out.push_back(std::move(r));
    }
    sqlite3_finalize(st);
    return out;
}

std::vector<OverrideRow> AlarmStore::loadOverrides(std::string& err) {
    std::vector<OverrideRow> out;
    if (!db_) {
        err = "store not open";
        return out;
    }
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(
            db_,
            "SELECT alarm_id, kind, user, reason, system, ts_start_ms, clock_ok, ts_end_ms"
            " FROM alarm_override ORDER BY alarm_id, kind",
            -1, &st, nullptr) != SQLITE_OK) {
        err = sqlite3_errmsg(db_);
        return out;
    }
    while (sqlite3_step(st) == SQLITE_ROW) {
        OverrideRow o;
        o.alarmId = *colText(st, 0);
        o.kind = *colText(st, 1);
        o.user = *colText(st, 2);
        o.reason = *colText(st, 3);
        o.system = sqlite3_column_int(st, 4) != 0;
        o.tsStartMs = sqlite3_column_int64(st, 5);
        o.clockOk = sqlite3_column_int(st, 6) != 0;
        o.tsEndMs = colInt(st, 7);
        out.push_back(std::move(o));
    }
    sqlite3_finalize(st);
    return out;
}

int64_t AlarmStore::nextOccurrence() {
    if (!db_) return 1;
    const int64_t maxId = queryInt(db_, "SELECT IFNULL(MAX(id), 0) FROM alarm_occurrence");
    int64_t hw = 0;
    // NOLINTNEXTLINE(cert-err34-c): written by the runtime (alarm_meta) (SAST T055)
    if (auto v = getMeta("high_water")) hw = std::atoll(v->c_str());
    return std::max(maxId, hw) + 1;
}

int AlarmStore::purgeExpired(int64_t nowEpochMs, bool clockOk, int retentionDays, int batch,
                             std::string& err) {
    if (!clockOk) return 0;
    if (!run("BEGIN IMMEDIATE", err)) return -1;
    std::string ignored;
    bool ok = execSql(db_, kHighWater, err);
    int n = 0;
    if (ok) {
        sqlite3_stmt* st = nullptr;
        ok = sqlite3_prepare_v2(
                 db_,
                 "DELETE FROM alarm_occurrence WHERE id IN (SELECT id FROM alarm_occurrence"
                 " WHERE closed = 1 AND clock_ok = 1 AND ts_active_ms < ?1 ORDER BY id LIMIT ?2)",
                 -1, &st, nullptr) == SQLITE_OK;
        if (ok) {
            sqlite3_bind_int64(st, 1,
                               nowEpochMs - static_cast<int64_t>(retentionDays) * 86400000LL);
            sqlite3_bind_int(st, 2, batch);
            ok = sqlite3_step(st) == SQLITE_DONE;
            n = sqlite3_changes(db_);
            sqlite3_finalize(st);
        }
    }
    if (!ok) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
        execSql(db_, "ROLLBACK", ignored);
        return -1;
    }
    if (!run("COMMIT", err)) {
        execSql(db_, "ROLLBACK", ignored);
        return -1;
    }
    return n;
}

int64_t AlarmStore::usedBytes() {
    if (!db_) return 0;
    return (queryInt(db_, "PRAGMA page_count") - queryInt(db_, "PRAGMA freelist_count")) *
           queryInt(db_, "PRAGMA page_size");
}

int AlarmStore::purgeOverSize(int64_t maxBytes, int batch, std::string& err) {
    if (usedBytes() <= maxBytes) return 0;
    std::string ignored;
    if (!run("BEGIN IMMEDIATE", err)) return -1;
    bool ok = execSql(db_, kHighWater, err);
    int n = 0;
    if (ok) {
        sqlite3_stmt* st = nullptr;
        ok = sqlite3_prepare_v2(
                 db_,
                 "DELETE FROM alarm_occurrence WHERE id IN (SELECT id FROM alarm_occurrence"
                 " WHERE closed = 1 ORDER BY id LIMIT ?1)",
                 -1, &st, nullptr) == SQLITE_OK;
        if (ok) {
            sqlite3_bind_int(st, 1, batch);
            ok = sqlite3_step(st) == SQLITE_DONE;
            n = sqlite3_changes(db_);
            sqlite3_finalize(st);
        }
    }
    if (!ok) {
        lastRc_ = sqlite3_extended_errcode(db_);
        err = sqlite3_errmsg(db_);
        execSql(db_, "ROLLBACK", ignored);
        return -1;
    }
    if (!run("COMMIT", err)) {
        execSql(db_, "ROLLBACK", ignored);
        return -1;
    }
    return n;
}

int64_t AlarmStore::countRows() {
    return db_ ? queryInt(db_, "SELECT COUNT(*) FROM alarm_occurrence") : 0;
}
int64_t AlarmStore::countOpen() {
    return db_ ? queryInt(db_, "SELECT COUNT(*) FROM alarm_occurrence WHERE closed = 0") : 0;
}

bool AlarmStore::setMeta(const std::string& key, const std::string& value, std::string& err) {
    if (!db_) {
        err = "store not open";
        return false;
    }
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, "INSERT OR REPLACE INTO alarm_meta(key, value) VALUES(?1, ?2)", -1,
                           &st, nullptr) != SQLITE_OK) {
        err = sqlite3_errmsg(db_);
        return false;
    }
    sqlite3_bind_text(st, 1, key.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, value.c_str(), -1, SQLITE_TRANSIENT);
    const bool ok = sqlite3_step(st) == SQLITE_DONE;
    if (!ok) err = sqlite3_errmsg(db_);
    sqlite3_finalize(st);
    return ok;
}

std::optional<std::string> AlarmStore::getMeta(const std::string& key) {
    if (!db_) return std::nullopt;
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, "SELECT value FROM alarm_meta WHERE key = ?1", -1, &st, nullptr) !=
        SQLITE_OK)
        return std::nullopt;
    sqlite3_bind_text(st, 1, key.c_str(), -1, SQLITE_TRANSIENT);
    std::optional<std::string> r;
    if (sqlite3_step(st) == SQLITE_ROW) r = colText(st, 0);
    sqlite3_finalize(st);
    return r;
}

std::string AlarmStore::pragmaText(const char* name) {
    return db_ ? queryText(db_, std::string("PRAGMA ") + name).value_or("") : "";
}
int64_t AlarmStore::pragmaInt(const char* name) {
    return db_ ? queryInt(db_, std::string("PRAGMA ") + name) : 0;
}

std::string AlarmStore::integrityCheck(int maxLines) {
    if (!db_) return "closed";
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_,
                           ("PRAGMA integrity_check(" + std::to_string(maxLines) + ")").c_str(), -1,
                           &st, nullptr) != SQLITE_OK)
        return sqlite3_errmsg(db_);
    std::string out;
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (!out.empty()) out += "; ";
        out += colText(st, 0).value_or("");
    }
    sqlite3_finalize(st);
    return out;
}

bool AlarmStore::hasIndex(const std::string& name) {
    if (!db_) return false;
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db_, "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?1", -1,
                           &st, nullptr) != SQLITE_OK)
        return false;
    sqlite3_bind_text(st, 1, name.c_str(), -1, SQLITE_TRANSIENT);
    const bool r = sqlite3_step(st) == SQLITE_ROW;
    sqlite3_finalize(st);
    return r;
}

}  // namespace mat::alarm
