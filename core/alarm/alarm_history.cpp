#include "core/alarm/alarm_history.hpp"

#include <sqlite3.h>

#include <chrono>
#include <thread>

#include "core/alarm/alarm_text.hpp"

namespace mat::alarm {

namespace {

constexpr const char* kSelect =
    "SELECT id, alarm_id, fingerprint, ts_active_ms, clock_ok, ts_ack_ms, ack_user, ts_return_ms, "
    "ts_return_ack_ms, return_ack_user, priority, class, area, text, value_active, quality_active, "
    "reason, flags, repeat_count, closed, closed_by FROM alarm_occurrence WHERE ";

HistoryResult bad(const char* field, const char* message) {
    HistoryResult r;
    r.status = HistoryStatus::BadQuery;
    r.field = field;
    r.message = message;
    return r;
}

std::optional<std::string> textCol(sqlite3_stmt* st, int i) {
    if (sqlite3_column_type(st, i) == SQLITE_NULL) return std::nullopt;
    return std::string(reinterpret_cast<const char*>(sqlite3_column_text(st, i)));
}
std::optional<int64_t> intCol(sqlite3_stmt* st, int i) {
    if (sqlite3_column_type(st, i) == SQLITE_NULL) return std::nullopt;
    return sqlite3_column_int64(st, i);
}

// LIKE text with \, % and _ escaped (ESCAPE '\').
std::string escapeLike(const std::string& s) {
    std::string out;
    for (const char c : s) {
        if (c == '\\' || c == '%' || c == '_') out += '\\';
        out += c;
    }
    return out;
}

bool blank(const std::string& s) {
    for (const char c : s)
        if (c != ' ' && c != '\t' && c != '\n' && c != '\r') return false;
    return true;
}

struct Deadline {
    std::chrono::steady_clock::time_point at;
};
int cancelWhenLate(void* p) {
    return std::chrono::steady_clock::now() > static_cast<Deadline*>(p)->at ? 1 : 0;
}

}  // namespace

HistoryResult validateHistoryQuery(const HistoryQuery& q) {
    if (q.limit < 1 || q.limit > kMaxHistoryLimit) return bad("limit", "limit phải từ 1 đến 500");
    if (!q.unsynced) {
        if (q.fromMs >= q.toMs) return bad("from", "from phải nhỏ hơn to");
        if (q.toMs - q.fromMs > kMaxHistorySpanMs)
            return bad("from", "khoảng from–to tối đa 366 ngày");
    }
    if (q.state != "all" && q.state != "active" && q.state != "acked" && q.state != "closed")
        return bad("state", "state phải là active, acked, closed hoặc all");
    if (q.priority && (*q.priority < 1 || *q.priority > 4))
        return bad("priority", "priority phải là critical, major, minor hoặc advisory");
    if (utf8Length(q.q) > static_cast<size_t>(kMaxHistoryQueryChars))
        return bad("q", "q tối đa 80 ký tự");
    if (q.beforeId && *q.beforeId < 1) return bad("beforeId", "beforeId phải là số nguyên ≥ 1");
    return {};
}

struct AlarmHistoryReader::Conn {
    sqlite3* db = nullptr;
    ~Conn() {
        if (db) sqlite3_close(db);
    }
};

AlarmHistoryReader::AlarmHistoryReader(std::string dbPath, HistoryOptions opt)
    : path_(std::move(dbPath)), opt_(opt) {}

AlarmHistoryReader::~AlarmHistoryReader() = default;

bool AlarmHistoryReader::openConn(Conn& c) {
    if (c.db) {
        sqlite3_close(c.db);
        c.db = nullptr;
    }
    // No SQLITE_OPEN_CREATE: a missing file is "unavailable", never an empty database of ours.
    if (sqlite3_open_v2(path_.c_str(), &c.db, SQLITE_OPEN_READONLY, nullptr) != SQLITE_OK) {
        if (c.db) sqlite3_close(c.db);
        c.db = nullptr;
        return false;
    }
    sqlite3_extended_result_codes(c.db, 1);
    sqlite3_busy_timeout(c.db, 2000);
    sqlite3_exec(c.db, "PRAGMA query_only=ON; PRAGMA cache_size=-1024;", nullptr, nullptr,
                 nullptr);
    return true;
}

std::shared_ptr<AlarmHistoryReader::Conn> AlarmHistoryReader::acquire(int waitMs, bool& busy) {
    std::unique_lock<std::mutex> l(mu_);
    busy = false;
    if (!cv_.wait_for(l, std::chrono::milliseconds(waitMs),
                      [&] { return active_ < opt_.maxConcurrent; })) {
        busy = true;
        ++busy_;
        return nullptr;
    }
    ++active_;
    std::shared_ptr<Conn> c;
    if (!idle_.empty()) {
        c = idle_.back();
        idle_.pop_back();
    } else {
        c = std::make_shared<Conn>();
    }
    return c;
}

void AlarmHistoryReader::release(std::shared_ptr<Conn> c, bool broken) {
    std::lock_guard<std::mutex> l(mu_);
    --active_;
    if (!broken && c && c->db) idle_.push_back(std::move(c));
    cv_.notify_one();
}

HistoryResult AlarmHistoryReader::query(const HistoryQuery& q) {
    HistoryResult r = validateHistoryQuery(q);
    if (r.status != HistoryStatus::Ok) return r;
    bool busy = false;
    std::shared_ptr<Conn> c = acquire(opt_.waitMs, busy);
    if (!c) {
        r.status = HistoryStatus::Busy;
        r.message = "Thiết bị đang chạy truy vấn lịch sử khác. Hãy thử lại sau.";
        return r;
    }
    bool broken = false;
    struct Release {
        AlarmHistoryReader& self;
        std::shared_ptr<Conn>& c;
        bool& broken;
        ~Release() { self.release(c, broken); }
    } release{*this, c, broken};
    ++queries_;

    auto unavailable = [&] {
        broken = true;
        r.page = {};
        r.status = HistoryStatus::Unavailable;
        r.message = "Không mở được lịch sử alarm của thiết bị.";
        return r;
    };
    // The file is opened for every query: the store may have renamed a damaged one away and
    // created a new file under the same name, which an open handle would not follow. A read-only
    // open of a WAL database is cheap next to the query itself.
    if (!openConn(*c)) return unavailable();
    sqlite3* db = c->db;

    std::string sql = kSelect;
    std::vector<std::pair<std::string, std::string>> texts;  // name -> value
    std::vector<std::pair<std::string, int64_t>> ints;
    if (q.unsynced) {
        sql += "clock_ok = 0";
    } else {
        sql += "clock_ok = 1 AND ts_active_ms >= :from AND ts_active_ms < :to";
        ints.emplace_back(":from", q.fromMs);
        ints.emplace_back(":to", q.toMs);
    }
    if (q.alarmId) {
        // An instance id matches itself; a definition id matches itself and "<id>.<limit>".
        sql += " AND (alarm_id = :alarm_id OR alarm_id LIKE :alarm_prefix ESCAPE '\\')";
        texts.emplace_back(":alarm_id", *q.alarmId);
        texts.emplace_back(":alarm_prefix", escapeLike(*q.alarmId + ".") + "%");
    }
    if (q.area) {
        if (q.area->empty()) {
            sql += " AND area IS NULL";
        } else {
            sql += " AND area = :area";
            texts.emplace_back(":area", *q.area);
        }
    }
    if (q.classId) {
        sql += " AND class = :class";
        texts.emplace_back(":class", *q.classId);
    }
    if (q.priority) {
        sql += " AND priority <= :priority";
        ints.emplace_back(":priority", *q.priority);
    }
    if (q.state == "active") sql += " AND closed = 0";
    if (q.state == "acked") sql += " AND ts_ack_ms IS NOT NULL";
    if (q.state == "closed") sql += " AND closed = 1";
    if (!blank(q.q)) {
        const std::string folded = foldText(q.q);
        if (!blank(folded)) {
            sql += " AND text_fold LIKE :q ESCAPE '\\'";
            texts.emplace_back(":q", "%" + escapeLike(folded) + "%");
        }
    }
    if (q.beforeId) {
        // Keyset: the start time of the row `beforeId` is the key; a missing row is a bad query.
        sqlite3_stmt* st = nullptr;
        if (sqlite3_prepare_v2(db, "SELECT ts_active_ms FROM alarm_occurrence WHERE id = ?1", -1,
                               &st, nullptr) != SQLITE_OK)
            return unavailable();
        sqlite3_bind_int64(st, 1, *q.beforeId);
        const int rc = sqlite3_step(st);
        const int64_t beforeTs = rc == SQLITE_ROW ? sqlite3_column_int64(st, 0) : 0;
        sqlite3_finalize(st);
        if (rc != SQLITE_ROW) return bad("beforeId", "beforeId không phải mã lần xảy ra đã có");
        if (q.unsynced) {
            sql += " AND id < :before_id";
        } else {
            sql +=
                " AND (ts_active_ms < :before_ts OR (ts_active_ms = :before_ts AND id < "
                ":before_id))";
            ints.emplace_back(":before_ts", beforeTs);
        }
        ints.emplace_back(":before_id", *q.beforeId);
    }
    sql += q.unsynced ? " ORDER BY id DESC LIMIT :limit"
                      : " ORDER BY ts_active_ms DESC, id DESC LIMIT :limit";
    ints.emplace_back(":limit", q.limit + 1);

    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) return unavailable();
    for (const auto& [name, value] : texts) {
        const int i = sqlite3_bind_parameter_index(st, name.c_str());
        if (i > 0) sqlite3_bind_text(st, i, value.c_str(), -1, SQLITE_TRANSIENT);
    }
    for (const auto& [name, value] : ints) {
        const int i = sqlite3_bind_parameter_index(st, name.c_str());
        if (i > 0) sqlite3_bind_int64(st, i, value);
    }
    // A query that runs too long is cancelled (the handler runs every 1000 VM steps).
    Deadline deadline{std::chrono::steady_clock::now() +
                      std::chrono::milliseconds(opt_.queryTimeoutMs)};
    sqlite3_progress_handler(db, 1000, cancelWhenLate, &deadline);

    if (opt_.testQueryDelayMs > 0)
        std::this_thread::sleep_for(std::chrono::milliseconds(opt_.testQueryDelayMs));

    HistoryPage& page = r.page;
    int rc;
    while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
        if (static_cast<int>(page.rows.size()) == q.limit) {
            page.hasMore = true;
            break;
        }
        OccurrenceRow row;
        row.id = sqlite3_column_int64(st, 0);
        row.alarmId = textCol(st, 1).value_or("");
        row.fingerprint = textCol(st, 2).value_or("");
        row.tsActiveMs = sqlite3_column_int64(st, 3);
        row.clockOk = sqlite3_column_int(st, 4) != 0;
        row.tsAckMs = intCol(st, 5);
        row.ackUser = textCol(st, 6);
        row.tsReturnMs = intCol(st, 7);
        row.tsReturnAckMs = intCol(st, 8);
        row.returnAckUser = textCol(st, 9);
        row.priority = sqlite3_column_int(st, 10);
        row.classId = textCol(st, 11).value_or("");
        row.area = textCol(st, 12);
        row.text = textCol(st, 13).value_or("");
        if (sqlite3_column_type(st, 14) != SQLITE_NULL)
            row.valueActive = sqlite3_column_double(st, 14);
        row.qualityActive = textCol(st, 15).value_or("GOOD");
        row.reason = textCol(st, 16);
        row.flags = sqlite3_column_int(st, 17);
        row.repeatCount = sqlite3_column_int(st, 18);
        row.closed = sqlite3_column_int(st, 19) != 0;
        row.closedBy = parseClosedBy(textCol(st, 20).value_or(""));
        page.rows.push_back(std::move(row));
    }
    sqlite3_progress_handler(db, 0, nullptr, nullptr);
    sqlite3_finalize(st);
    if (rc != SQLITE_ROW && rc != SQLITE_DONE) return unavailable();
    if (page.hasMore) page.nextBeforeId = page.rows.back().id;
    return r;
}

std::string AlarmHistoryReader::integrityCheck(int maxLines) {
    Conn c;
    if (!openConn(c)) return "unavailable";
    sqlite3_stmt* st = nullptr;
    const std::string sql = "PRAGMA integrity_check(" + std::to_string(maxLines) + ")";
    if (sqlite3_prepare_v2(c.db, sql.c_str(), -1, &st, nullptr) != SQLITE_OK) return "unavailable";
    std::string out;
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (!out.empty()) out += '\n';
        out += reinterpret_cast<const char*>(sqlite3_column_text(st, 0));
    }
    sqlite3_finalize(st);
    return out.empty() ? "unavailable" : out;
}

}  // namespace mat::alarm
