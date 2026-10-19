// GET /api/v1/history/{catalog,series,aggregate,rows,export.csv} (specs/010-history-reports
// contracts/history-api.md, ADR-032). The gate (auth_gate) has already checked HTTPS, session and
// role; this file checks the parameters (allowlist, integers, ids looked up in the catalog), takes
// a slot of the limiter, runs the query on a low-priority thread with a read-only connection and
// writes JSON or a chunked CSV. No value of the client reaches SQL text.
#pragma once
#include <atomic>
#include <functional>
#include <memory>
#include <string>

#include "core/audit/audit_log.hpp"
#include "core/historian/query/history_query.hpp"
#include "core/historian/query/query_limiter.hpp"
#include "core/historian/query/reader_pool.hpp"
#include "server/http/auth_gate.hpp"

struct mg_connection;

namespace mat {

class HistoryApi {
   public:
    struct Options {
        HistoryCatalog catalog;
        std::string dbPath;  // history.db
        bool enabled = true;
        int maxConcurrent = 2;
        int timeoutMs = 10000;
        int exportTimeoutMs = 120000;
        int maxScanMiB = 64;
        int cacheKiB = 4096;
        std::function<std::string()> state;            // historian state name for catalog.state
        std::function<void(const AuditEvent&)> audit;  // history.export; may be empty
        std::function<int64_t()> nowUtc;               // empty: the system clock
        // Test hook: runs on the query thread before the query; sees the cancel flag (set when the
        // client left).
        std::function<void(const std::atomic<bool>&)> testHold;
        // Feature 013 (contracts/admin-api.md §6): the Tags of history(P) of the request's person;
        // a Tag outside it is left out, a request with only such Tags is 403 ACCESS_DENIED, the
        // catalog lists only the allowed Tags (and the groups that have some). Empty: every Tag.
        std::function<std::function<bool(const std::string& tag)>(const GateDecision&)> tagFilter;
    };

    explicit HistoryApi(Options opt);

    // `decision` came through the gate on one of the five history paths.
    int handle(mg_connection* c, const GateRequest& request, const GateDecision& decision,
               bool close);

    QueryLimiter& limiter() { return limiter_; }
    const Options& options() const { return opt_; }

   private:
    int catalogJson(mg_connection* c, const GateDecision& d, bool close);
    std::function<bool(const std::string&)> filterOf(const GateDecision& d) const;
    int series(mg_connection* c, const GateRequest& r, const GateDecision& d, bool close);
    int aggregate(mg_connection* c, const GateRequest& r, const GateDecision& d, bool close);
    int rows(mg_connection* c, const GateRequest& r, const GateDecision& d, bool close);
    int exportCsv(mg_connection* c, const GateRequest& r, const GateDecision& d, bool close);

    Options opt_;
    ReaderPool pool_;
    QueryLimiter limiter_;
};

}  // namespace mat
