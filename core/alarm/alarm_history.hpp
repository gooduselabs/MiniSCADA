// History of alarm occurrences (specs/009-alarms contracts/alarm-store.md §4.4, §9; device-api-1.3
// §2.2): a read-only connection of its own to alarm.db, every parameter bound, keyset paging, a
// gate of two queries at a time. It never touches the writer or the tick: WAL lets it read while
// the service writes.
#pragma once
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "core/alarm/alarm_types.hpp"

struct sqlite3;

namespace mat::alarm {

inline constexpr int64_t kMaxHistorySpanMs = 366LL * 24 * 3600 * 1000;
inline constexpr int kMaxHistoryLimit = 500;
inline constexpr int kMaxHistoryQueryChars = 80;

struct HistoryQuery {
    int64_t fromMs = 0, toMs = 0;        // occurrences that began in [from, to)
    std::optional<std::string> alarmId;  // an instance id, or a definition id (all its limits)
    std::optional<std::string> area;     // "" = Chung (no area)
    std::optional<std::string> classId;
    std::optional<int> priority;  // 1..4: this priority or higher (a smaller number)
    std::string state = "all";    // active | acked | closed | all
    std::string q;                // raw text, folded and escaped here
    int limit = 100;
    std::optional<int64_t> beforeId;
    // D45: only the occurrences of an unsynchronised clock, from, to ignored, newest id first.
    bool unsynced = false;
};

struct HistoryPage {
    std::vector<OccurrenceRow> rows;  // newest first; textFold is not filled
    bool hasMore = false;
    std::optional<int64_t> nextBeforeId;
};

enum class HistoryStatus : uint8_t {
    Ok,
    BadQuery,     // `field` and `message` say which parameter
    Busy,         // two queries are running and none ended within the wait: ALARM_HISTORY_BUSY
    Unavailable,  // alarm.db cannot be opened for reading: ALARM_LOG_UNAVAILABLE
};

struct HistoryResult {
    HistoryStatus status = HistoryStatus::Ok;
    std::string field, message;
    HistoryPage page;
};

struct HistoryOptions {
    int maxConcurrent = 2;      // queries at once on the whole device
    int waitMs = 10000;         // how long a query waits for a slot
    int queryTimeoutMs = 5000;  // a query that runs longer is cancelled (Unavailable)
    int testQueryDelayMs = 0;   // tests: the query sleeps while it holds its slot
};

// Checks the parameters that do not need the database (from < to, span, limit, state, q length).
// BadQuery with the name of the field, or Ok.
HistoryResult validateHistoryQuery(const HistoryQuery& q);

class AlarmHistoryReader {
   public:
    explicit AlarmHistoryReader(std::string dbPath, HistoryOptions opt = {});
    ~AlarmHistoryReader();
    AlarmHistoryReader(const AlarmHistoryReader&) = delete;
    AlarmHistoryReader& operator=(const AlarmHistoryReader&) = delete;

    HistoryResult query(const HistoryQuery& q);
    // PRAGMA integrity_check(n) on a connection of its own; "ok" when sound, otherwise the text or
    // "unavailable".
    std::string integrityCheck(int maxLines = 10);
    // Queries answered, refused for load, cancelled: for the diagnostics and the tests.
    uint64_t queries() const { return queries_.load(); }
    uint64_t busyRefusals() const { return busy_.load(); }

   private:
    struct Conn;
    std::shared_ptr<Conn> acquire(int waitMs, bool& busy);
    void release(std::shared_ptr<Conn> c, bool broken);
    bool openConn(Conn& c);

    std::string path_;
    HistoryOptions opt_;
    std::mutex mu_;
    std::condition_variable cv_;
    int active_ = 0;
    std::vector<std::shared_ptr<Conn>> idle_;
    std::atomic<uint64_t> queries_{0}, busy_{0};
};

}  // namespace mat::alarm
