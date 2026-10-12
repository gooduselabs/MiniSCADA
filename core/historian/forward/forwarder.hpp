// Forwarding of one connection (specs/003-data-logging research R8, R12; data-model §3
// Destination): its own thread and its own read-only connection to history.db; sends the rows of
// every group that points to the connection, in seq order, after the destination cursor. A slow or
// broken destination never slows the historian or the other destinations, and a group whose rows
// the server refuses never holds back the other groups of the connection.
#pragma once
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "core/historian/forward/destination.hpp"
#include "core/historian/local_store.hpp"
#include "core/historian/logging_config.hpp"
#include "core/historian/secrets.hpp"

namespace mat {

struct ForwardGroup {
    std::string groupId;
    DestTable table;
    // Review C1 mark kept in history.db (mat_forward_mark): the highest seq of the table when
    // the runtime opened the file and no forwarder of this connection has checked its destination
    // since. The group sends nothing past it until the historian removed the mark for good
    // (takeCheckedMarks / marksCleared). -1 = no kept mark: the forwarder reads the file when it
    // opens it and goes on at once (tools, tests, non-transactional destinations).
    // kMarkPending = the historian could not store the mark yet (disk full, I/O error): the group
    // sends nothing and touches no cursor until provideMarks() brings it (review of the fixes).
    int64_t seqAtOpen = -1;
    static constexpr int64_t kMarkPending = -2;
};

enum class DestState { Connecting, Ok, Error, NoClient, NoSecret };
const char* destStateName(DestState s);

// contracts/system-info.md `destinations[]`: no host, user, database or URL here.
struct DestStatus {
    std::string id;
    std::string type;  // mysql, mssql, postgresql, influxdb
    DestState state = DestState::Connecting;
    int64_t pendingRows = 0;        // rows on the device not yet at the destination (every group)
    int64_t lagS = 0;               // age of the oldest unsent row; 0 when nothing waits
    uint64_t sentRows = 0;          // since start
    uint64_t lostRows = 0;          // deleted on the device before they could be sent (US4)
    uint64_t outOfRangeValues = 0;  // sent as NULL or cut to fit the destination column
    uint64_t rejectedRows = 0;      // dropped by the server in a partial write (InfluxDB)
    int64_t lastOkAt = 0;           // UTC ms of the last successful batch; 0 = never
    ErrorClass lastError = ErrorClass::None;  // why the destination is not ok; None when ok
    std::string lastErrorDbCode;
    int64_t lastErrorAt = 0;
};

struct ForwarderOptions {
    std::string dbPath;  // history.db
    // Secret of a connection, read again at every connection attempt.
    std::function<SecretResult(const std::string&)> secret;
    int64_t idleMs = 5000;  // wakes up at least this often; a commit of the historian wakes it now
    int64_t backoffMinMs = 1000;  // connection errors and a group's own errors: 1, 2, 4 … 60 s
    int64_t backoffMaxMs = 60000;
    int64_t authBackoffMinMs = 60000;  // wrong password: 1, 2, 4, 5 min, not to lock the account
    int64_t authBackoffMaxMs = 300000;
    int64_t noClientRetryMs = 300000;  // missing client library: look again after 5 minutes
    int64_t pauseMs = 20;              // between two batches while catching up, …
    int64_t maxRowsPerSecond = 5000;   // … at most this rate, and resting as long as a batch took
    bool lowerPriority = true;         // the sending thread runs at nice +10
};

// Key of the device cursors of a connection in mat_forward. InfluxDB keeps its cursor on the device
// only: it belongs to the server, organization and bucket it was reached on (a new bucket starts
// from the oldest row on the device).
std::string forwardCursorKey(const ConnectionModel& c);

class Forwarder {
   public:
    Forwarder(ConnectionModel conn, std::vector<ForwardGroup> groups,
              std::unique_ptr<Destination> dest, ForwarderOptions opt,
              std::function<int64_t()> nowUtc, std::function<int64_t()> nowMono);
    ~Forwarder();
    Forwarder(const Forwarder&) = delete;
    Forwarder& operator=(const Forwarder&) = delete;

    // One step with the injected clocks: connect when due, else send at most one batch.
    // true = more work right now.
    bool runOnce();
    // Rest of the thread after a batch of `rows` that took `workMs`:
    // max(pauseMs, rows / maxRowsPerSecond, workMs).
    static int64_t pauseAfter(size_t rows, int64_t workMs, const ForwarderOptions& o);
    bool start(std::string& err);
    void requestStop();  // the thread ends after its current call (bounded by client timeouts)
    void stop();         // requestStop(), then wait for the thread
    void notify();       // the historian committed rows
    // history.db was replaced (corruption recovery): reopen it and reconnect; cursors of the old
    // file are no longer handed over.
    void reopen();

    DestStatus status() const;
    // Cursors reached since the last call, for mat_forward (saved by the historian with its next
    // commit). Each carries the instance id of the file it counts in.
    std::vector<ForwardCursor> takeCursorUpdates();
    // Review C1: tables whose kept mark was compared with the destination cursor (and the cursor
    // brought back to it when it was ahead) since the last call. The historian removes those marks
    // from history.db for good, then calls marksCleared(): only then do their rows go.
    std::vector<std::string> takeCheckedMarks();
    void marksCleared(const std::vector<std::string>& tables);
    // Marks (table → mark) the historian stored only after this forwarder was made: the groups
    // that waited for them (ForwardGroup::kMarkPending) go on with the usual check.
    void provideMarks(const std::map<std::string, int64_t>& marks);
    // Review I3: instance id of the history.db in which reading met a damaged page since the last
    // call ("" = none): the historian replaces that file when it is still the current one.
    std::string takeCorruptFile();
    const ConnectionModel& connection() const { return conn_; }

   private:
    struct Group {
        ForwardGroup g;
        std::vector<std::string> columns;  // names to read from history.db
        int64_t cursor = 0;                // last seq at the destination
        bool prepared = false;             // schema synced and cursor read on this connection
        // An error of this group only (the server refused its schema or rows): it waits on its
        // own, the connection and the other groups go on.
        DestError error;
        int64_t errorAt = 0;
        int64_t backoffMs = 0;
        int64_t retryAtMono = 0;
        int64_t lostThrough = 0;  // rows up to this seq are already counted in lostRows
        // An error of a batch the server took in part (sent, not sent again): shown until a batch
        // goes through whole; having nothing to send does not clear it.
        bool errorSoft = false;
        // Review C1: a destination cursor above this mark (what the file had at open) means the
        // device lost rows the destination holds; checked once, before this forwarder sends
        // anything. A mark kept in history.db must be off the device before rows go.
        int64_t mark = -1;
        enum class Mark { Unchecked, AwaitingClear, Done } markState = Mark::Unchecked;
    };
    bool openReader(int64_t nowUtc, int64_t nowMono);
    bool connect(int64_t nowUtc, int64_t nowMono);
    bool prepare(Group& g, int64_t nowUtc, int64_t nowMono);
    // Statement errors stay with the group; others close the connection.
    void handleError(Group& g, const DestError& e, int64_t nowUtc, int64_t nowMono);
    void connectionFailed(const DestError& e, int64_t nowUtc, int64_t nowMono);
    void groupFailed(Group& g, const DestError& e, int64_t nowUtc, int64_t nowMono);
    void recordCursor(const Group& g);
    void copyCounters();
    void refreshStatus(int64_t nowUtc);
    int64_t waitMs(int64_t nowMono) const;
    void loop();

    ConnectionModel conn_;
    std::vector<Group> groups_;
    std::unique_ptr<Destination> dest_;
    ForwarderOptions opt_;
    std::function<int64_t()> nowUtc_;
    std::function<int64_t()> nowMono_;
    std::string cursorKey_;

    HistoryReader reader_;
    bool readerOpen_ = false;
    std::string sourceId_;
    bool connected_ = false;
    int64_t retryAtMono_ = 0;
    int64_t backoffMs_ = 0;
    int64_t authBackoffMs_ = 0;
    DestState connState_ = DestState::Connecting;
    DestError connError_;  // why the connection is down
    int64_t connErrorAt_ = 0;
    size_t next_ = 0;  // round robin over the groups
    size_t lastBatchRows_ = 0;
    std::atomic<bool> reopen_{false};

    mutable std::mutex mu_;  // status_, updates_, the marks, corruptFile_
    DestStatus status_;
    std::map<std::string, std::pair<int64_t, std::string>> updates_;  // table → (seq, file)
    std::set<std::string> checkedMarks_;                              // tables: to the historian
    std::set<std::string> clearedMarks_;                              // tables: from the historian
    std::map<std::string, int64_t> providedMarks_;                    // tables: stored late
    std::string corruptFile_;

    std::mutex wakeMu_;
    std::condition_variable wake_;
    bool notified_ = false;
    std::atomic<bool> running_{false};
    std::thread thread_;
};

}  // namespace mat
