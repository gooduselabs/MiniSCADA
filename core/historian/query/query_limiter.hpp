// Load limits of the history API (specs/010-history-reports contracts/history-api.md §1.2):
// at most N queries at once, one export at once, one request per session; the counters and the p95
// of the last 256 durations go to system/info (device-010.md §1 "query").
#pragma once
#include <cstdint>
#include <functional>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace mat {

class QueryLimiter {
   public:
    enum class Kind { Query, Export };

    // RAII: the slot is given back when the ticket dies, also when an exception unwinds.
    class Ticket {
       public:
        Ticket() = default;
        Ticket(QueryLimiter* l, Kind k, std::string s) : l_(l), kind_(k), session_(std::move(s)) {}
        Ticket(const Ticket&) = delete;
        Ticket& operator=(const Ticket&) = delete;
        Ticket(Ticket&& o) noexcept : l_(o.l_), kind_(o.kind_), session_(std::move(o.session_)) {
            o.l_ = nullptr;
        }
        Ticket& operator=(Ticket&& o) noexcept {
            if (this != &o) {
                release();
                l_ = o.l_;
                kind_ = o.kind_;
                session_ = std::move(o.session_);
                o.l_ = nullptr;
            }
            return *this;
        }
        ~Ticket() { release(); }

       private:
        void release() {
            if (l_) l_->release(kind_, session_);
            l_ = nullptr;
        }
        QueryLimiter* l_ = nullptr;
        Kind kind_ = Kind::Query;
        std::string session_;
    };

    struct Stats {
        int inFlight = 0;
        uint64_t served = 0;
        uint64_t rejectedBusy = 0;
        uint64_t rejectedLimit = 0;  // SCAN_LIMIT + RANGE_TOO_LARGE + EXPORT_TOO_LARGE
        uint64_t timeouts = 0;
        uint64_t errors = 0;
        int64_t p95Ms = 0;
        std::string lastErrorCode;  // empty = none
        int64_t lastErrorAt = 0;
    };

    explicit QueryLimiter(int maxConcurrent = 2) : maxConcurrent_(maxConcurrent) {}

    // nullopt = busy (counted). `session` identifies the requester ("" = no session key).
    std::optional<Ticket> tryAcquire(Kind kind, const std::string& session);

    void recordServed(int64_t elapsedMs);
    void recordRejectedLimit();
    void recordTimeout(int64_t atUtc);
    void recordError(const std::string& code, int64_t atUtc);
    Stats stats() const;

   private:
    void release(Kind kind, const std::string& session);

    int maxConcurrent_;
    mutable std::mutex mu_;
    int queries_ = 0;
    int exports_ = 0;
    std::set<std::string> sessions_;
    Stats s_;
    std::vector<int64_t> durations_;  // ring of the last 256
    size_t next_ = 0;
};

}  // namespace mat
