// The queries of the history API (specs/010-history-reports contracts/history-api.md §2–§6):
// series, aggregate, rows and the CSV export, run on a read-only connection of the ReaderPool.
// No HTTP and no JSON here: server/http/history_api.* checks the parameters and formats the result.
// Every value from the caller is a bound parameter; table and column names come from the catalog
// (built from the validated project) and are always quoted.
#pragma once
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "core/historian/cell.hpp"
#include "core/historian/logging_config.hpp"
#include "core/historian/query/downsample.hpp"
#include "core/historian/query/reader_pool.hpp"
#include "core/historian/query/source_select.hpp"

namespace mat {

struct QueryTag {
    std::string tagId;
    std::string column;
    std::string type;  // FLOAT32 ... as in tags.json
    std::string unit;
    bool aggregated = false;
    bool numeric() const { return type != "STRING"; }
};

struct QueryGroup {
    std::string id;
    std::string name;
    std::string table;  // without "log_"; never leaves the server
    std::string mode;   // cyclic / onChange / trigger
    int offsetMin = 420;
    int64_t periodMs = 0;
    int64_t minIntervalMs = 0;
    int64_t maxIntervalMs = 0;
    bool hasAggregates = false;
    int64_t rowBytes = 0;
    std::vector<QueryTag> tags;
    int indexOfTag(const std::string& tagId) const;  // -1 = not in the group
};

struct HistoryCatalog {
    std::vector<QueryGroup> groups;
    const QueryGroup* find(const std::string& id) const;
};

// `unitOf(tagId)` gives the unit of a Tag (empty when none).
HistoryCatalog buildCatalog(const LoggingModel& model,
                            const std::function<std::string(const std::string&)>& unitOf);

// One row of the log table in bytes, for the scan estimate (the cell sizes of 003's estimate).
int64_t estimateRowBytes(const LoggingGroupModel& g);

enum class QueryStatus {
    Ok,
    NoAggregates,
    ScanLimit,
    RangeTooLarge,
    ExportTooLarge,
    Timeout,
    Cancelled,
    Unavailable,
};

struct Gap {
    int64_t from = 0;
    int64_t to = 0;
};

struct Range {
    int64_t from = 0;
    int64_t to = 0;
};

// ---- series
struct SeriesParams {
    const QueryGroup* group = nullptr;
    std::vector<size_t> tags;  // indexes into group->tags
    int64_t from = 0;
    int64_t to = 0;
    int maxPoints = 1000;
    ResParam res = ResParam::Auto;
    ReduceParam reduce = ReduceParam::MinMax;
    int64_t scanLimitBytes = 64LL << 20;
};

struct SeriesLine {
    size_t tag = 0;
    std::vector<int64_t> t;
    std::vector<std::optional<double>> v;
    std::vector<double> min;  // aggregate source only
    std::vector<double> max;
};

struct SeriesResult {
    QueryStatus status = QueryStatus::Ok;
    SourceRes res = SourceRes::Raw;
    std::string reduce;  // minmax / lttb / decimate / merge
    bool approximate = false;
    std::optional<Range> coverage;
    std::vector<Gap> gaps;
    std::vector<SeriesLine> lines;
    int64_t rowsRead = 0;
    int64_t elapsedMs = 0;
    int64_t scanRowsEstimate = 0;
};

SeriesResult querySeries(ReaderPool::Lease& lease, const SeriesParams& p);

// ---- aggregate
struct AggregateParams {
    const QueryGroup* group = nullptr;
    std::vector<size_t> tags;
    int64_t from = 0;
    int64_t to = 0;
    int64_t bucketMs = 0;  // multiple of 60,000
    int64_t offsetMs = 0;  // multiple of 60,000, < bucketMs
};

struct AggregateResult {
    QueryStatus status = QueryStatus::Ok;
    int64_t start = 0;  // A: start of window 0
    int64_t count = 0;
    std::string source;  // "hour" / "minute"
    std::vector<size_t> tags;
    std::vector<std::vector<AggBucket>> buckets;  // [tag][window]; empty bucket = no data
    int64_t rowsRead = 0;
    int64_t elapsedMs = 0;
};

constexpr int64_t kMaxAggregateWindows = 5000;
constexpr int64_t kMaxAggregateRows = 300000;

AggregateResult queryAggregate(ReaderPool::Lease& lease, const AggregateParams& p);

// ---- rows
struct RowsParams {
    const QueryGroup* group = nullptr;
    std::vector<size_t> tags;
    int64_t from = 0;
    int64_t to = 0;
    int limit = 100;
    bool descending = true;
    std::optional<int64_t> after;  // seq of the last row of the previous page
};

struct RowsResult {
    QueryStatus status = QueryStatus::Ok;
    std::vector<StoredRow> rows;  // cells in the order of `tags`
    std::optional<int64_t> next;  // seq of the last row, null at the end of the range
    int64_t elapsedMs = 0;
};

RowsResult queryRows(ReaderPool::Lease& lease, const RowsParams& p);

// ---- export
struct ExportParams {
    const QueryGroup* group = nullptr;
    std::vector<size_t> tags;
    int64_t from = 0;
    int64_t to = 0;
    ResParam res = ResParam::Raw;  // Raw, Minute or Hour
    std::vector<std::string> fields;  // aggregate fields: min,max,avg,first,last,sum,count
    bool bom = true;
    int64_t maxRows = 500000;
};

struct ExportInfo {
    QueryStatus status = QueryStatus::Ok;
    int64_t rowsEstimate = 0;
};

// Estimate before the first byte (EXPORT_TOO_LARGE / NO_AGGREGATES are decided here).
ExportInfo estimateExport(ReaderPool::Lease& lease, const ExportParams& p);

// Streams the CSV in chunks of at most 64 KiB; `sink` returns false when the client is gone.
// `rowsOut` = data rows written. Ok = complete.
QueryStatus exportCsv(ReaderPool::Lease& lease, const ExportParams& p,
                      const std::function<bool(const std::string&)>& sink, int64_t& rowsOut);

// Gaps of [from, to) in which the runtime was not running (mat_runs); empty without schema 2.
std::vector<Gap> queryGaps(sqlite3* db, int64_t from, int64_t to);

}  // namespace mat
