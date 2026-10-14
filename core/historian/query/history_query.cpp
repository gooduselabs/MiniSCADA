#include "core/historian/query/history_query.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <map>
#include <set>

#include "core/historian/query/csv_writer.hpp"

namespace mat {

namespace {

constexpr int64_t kMinuteMs = 60000;
constexpr int64_t kHourMs = 3600000;

int64_t steadyMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

int64_t floorDiv(int64_t a, int64_t b) {
    int64_t q = a / b;
    if ((a % b != 0) && ((a < 0) != (b < 0))) --q;
    return q;
}

const char* typeName(TagType t) {
    switch (t) {
        case TagType::BOOL:
            return "BOOL";
        case TagType::INT16:
            return "INT16";
        case TagType::UINT16:
            return "UINT16";
        case TagType::INT32:
            return "INT32";
        case TagType::UINT32:
            return "UINT32";
        case TagType::INT64:
            return "INT64";
        case TagType::UINT64:
            return "UINT64";
        case TagType::FLOAT32:
            return "FLOAT32";
        case TagType::STRING:
            return "STRING";
        default:
            return "FLOAT64";
    }
}

double cellBytes(TagType t, int maxLength) {
    switch (t) {
        case TagType::BOOL:
            return 2;
        case TagType::INT16:
        case TagType::UINT16:
            return 3;
        case TagType::INT32:
        case TagType::UINT32:
            return 5;
        case TagType::STRING:
            return 2 + std::min(maxLength, 64);
        default:
            return 9;
    }
}

std::string logTable(const QueryGroup& g) { return quoteIdent("log_" + g.table); }

// An interrupted statement: the deadline or the cancel flag of the lease.
QueryStatus interruptStatus(ReaderPool::Lease& lease) {
    if (lease.cancelled()) return QueryStatus::Cancelled;
    if (lease.timedOut()) return QueryStatus::Timeout;
    return QueryStatus::Unavailable;
}

QueryStatus statusOfRc(ReaderPool::Lease& lease, int rc) {
    if (rc == SQLITE_INTERRUPT) return interruptStatus(lease);
    if (lease.cancelled()) return QueryStatus::Cancelled;
    if (lease.timedOut()) return QueryStatus::Timeout;
    return QueryStatus::Unavailable;
}

struct Stmt {
    sqlite3_stmt* st = nullptr;
    ~Stmt() { sqlite3_finalize(st); }
    bool prepare(sqlite3* db, const std::string& sql) {
        return sqlite3_prepare_v2(db, sql.c_str(), -1, &st, nullptr) == SQLITE_OK;
    }
};

std::optional<int64_t> oneInt(sqlite3* db, const std::string& sql,
                              const std::vector<int64_t>& binds, int& rc) {
    Stmt s;
    rc = SQLITE_OK;
    if (!s.prepare(db, sql)) {
        rc = SQLITE_ERROR;
        return std::nullopt;
    }
    for (size_t i = 0; i < binds.size(); ++i)
        sqlite3_bind_int64(s.st, static_cast<int>(i) + 1, binds[i]);
    rc = sqlite3_step(s.st);
    if (rc == SQLITE_ROW) {
        rc = SQLITE_OK;
        if (sqlite3_column_type(s.st, 0) == SQLITE_NULL) return std::nullopt;
        return sqlite3_column_int64(s.st, 0);
    }
    if (rc == SQLITE_DONE) rc = SQLITE_OK;
    return std::nullopt;
}

// The columns the table really has (an orphan Tag of the catalog may have none yet).
std::set<std::string> tableColumns(sqlite3* db, const QueryGroup& g) {
    std::set<std::string> out;
    Stmt s;
    if (!s.prepare(db, "PRAGMA table_info(" + logTable(g) + ")")) return out;
    while (sqlite3_step(s.st) == SQLITE_ROW) {
        const auto* n = reinterpret_cast<const char*>(sqlite3_column_text(s.st, 1));
        if (n) out.insert(n);
    }
    return out;
}

std::string selectCols(sqlite3* db, const QueryGroup& g, const std::vector<size_t>& tags) {
    const auto have = tableColumns(db, g);
    std::string s = "SELECT seq, ts";
    for (size_t t : tags) {
        const std::string& col = g.tags[t].column;
        s += have.count(col) ? ", " + quoteIdent(col) : ", NULL";
    }
    return s + " FROM " + logTable(g);
}

std::optional<double> numberOf(sqlite3_stmt* st, int i) {
    switch (sqlite3_column_type(st, i)) {
        case SQLITE_INTEGER:
            return static_cast<double>(sqlite3_column_int64(st, i));
        case SQLITE_FLOAT:
            return sqlite3_column_double(st, i);
        default:
            return std::nullopt;
    }
}

Cell cellOf(sqlite3_stmt* st, int i) {
    switch (sqlite3_column_type(st, i)) {
        case SQLITE_INTEGER:
            return static_cast<int64_t>(sqlite3_column_int64(st, i));
        case SQLITE_FLOAT:
            return sqlite3_column_double(st, i);
        case SQLITE_TEXT: {
            const auto* t = reinterpret_cast<const char*>(sqlite3_column_text(st, i));
            return std::string(t ? t : "", static_cast<size_t>(sqlite3_column_bytes(st, i)));
        }
        default:
            return Cell{};
    }
}

// cid of every aggregated column of the group (mat_agg_cols); empty without schema 2.
std::map<std::string, int64_t> aggCids(sqlite3* db, const QueryGroup& g) {
    std::map<std::string, int64_t> out;
    Stmt s;
    if (!s.prepare(db, "SELECT col, cid FROM mat_agg_cols WHERE tbl = ?")) return out;
    sqlite3_bind_text(s.st, 1, g.table.c_str(), -1, SQLITE_TRANSIENT);
    while (sqlite3_step(s.st) == SQLITE_ROW) {
        const auto* n = reinterpret_cast<const char*>(sqlite3_column_text(s.st, 0));
        if (n) out[n] = sqlite3_column_int64(s.st, 1);
    }
    return out;
}

std::string cidList(const std::vector<int64_t>& cids) {  // numbers of our own, not of the client
    std::string s;
    for (int64_t c : cids) {
        if (!s.empty()) s += ",";
        s += std::to_string(c);
    }
    return s.empty() ? "-1" : s;
}

// Share of [from, to) between the first and the last bucket of `res` of these columns.
double coverageOf(sqlite3* db, const std::vector<int64_t>& cids, int64_t res, int64_t from,
                  int64_t to, std::optional<Range>* range) {
    if (cids.empty() || to <= from) return 0;
    int rc = 0;
    const std::string where = " FROM mat_agg WHERE res = ? AND cid IN (" + cidList(cids) +
                              ") AND bucket >= ? AND bucket < ?";
    const auto lo = oneInt(db, "SELECT min(bucket)" + where, {res, from - res + 1, to}, rc);
    const auto hi = oneInt(db, "SELECT max(bucket)" + where, {res, from - res + 1, to}, rc);
    if (!lo || !hi) return 0;
    const int64_t a = std::max(from, *lo);
    const int64_t b = std::min(to, *hi + res);
    if (range) *range = Range{a, b};
    return b > a ? static_cast<double>(b - a) / static_cast<double>(to - from) : 0.0;
}

AggBucket bucketOf(sqlite3_stmt* st, int base) {
    AggBucket b;
    b.n = sqlite3_column_int64(st, base);
    b.min = sqlite3_column_double(st, base + 1);
    b.max = sqlite3_column_double(st, base + 2);
    b.first = sqlite3_column_double(st, base + 3);
    b.last = sqlite3_column_double(st, base + 4);
    b.sumw = sqlite3_column_double(st, base + 5);
    b.wms = sqlite3_column_int64(st, base + 6);
    return b;
}

const char* kAggSelect =
    "SELECT cid, bucket, n, \"min\", \"max\", \"first\", \"last\", sumw, wms FROM mat_agg WHERE "
    "res = ? AND cid = ? AND bucket >= ? AND bucket < ? ORDER BY bucket";

}  // namespace

// ---------------------------------------------------------------- catalog

int QueryGroup::indexOfTag(const std::string& tagId) const {
    for (size_t i = 0; i < tags.size(); ++i)
        if (tags[i].tagId == tagId) return static_cast<int>(i);
    return -1;
}

const QueryGroup* HistoryCatalog::find(const std::string& id) const {
    for (const auto& g : groups)
        if (g.id == id) return &g;
    return nullptr;
}

int64_t estimateRowBytes(const LoggingGroupModel& g) {
    double b = 24;
    for (const auto& c : g.columns) b += cellBytes(c.type, c.maxLength);
    return static_cast<int64_t>(b);
}

HistoryCatalog buildCatalog(const LoggingModel& model,
                            const std::function<std::string(const std::string&)>& unitOf) {
    HistoryCatalog cat;
    for (const auto& g : model.groups) {
        QueryGroup q;
        q.id = g.id;
        q.name = g.name;
        q.table = g.table;
        q.mode = g.mode == LogMode::Cyclic    ? "cyclic"
                 : g.mode == LogMode::Trigger ? "trigger"
                                              : "onChange";
        q.offsetMin = model.offsetMin;
        q.periodMs = g.periodMs;
        q.minIntervalMs = g.minIntervalMs;
        q.maxIntervalMs = g.maxIntervalMs;
        q.hasAggregates = g.aggregates.has_value() && !g.aggregateColumns().empty();
        q.rowBytes = estimateRowBytes(g);
        const auto aggCols = g.aggregateColumns();
        for (size_t i = 0; i < g.columns.size(); ++i) {
            QueryTag t;
            t.tagId = g.columns[i].tagId;
            t.column = g.columns[i].column;
            t.type = typeName(g.columns[i].type);
            t.unit = unitOf ? unitOf(t.tagId) : "";
            t.aggregated = q.hasAggregates &&
                           std::find(aggCols.begin(), aggCols.end(), i) != aggCols.end();
            q.tags.push_back(std::move(t));
        }
        cat.groups.push_back(std::move(q));
    }
    return cat;
}

// ---------------------------------------------------------------- gaps

std::vector<Gap> queryGaps(sqlite3* db, int64_t from, int64_t to) {
    std::vector<Gap> out;
    Stmt s;
    // the run before the range too: its end may fall inside
    if (!s.prepare(db,
                   "SELECT start_ms, alive_ms FROM mat_runs WHERE alive_ms >= (SELECT "
                   "COALESCE(max(alive_ms), 0) FROM mat_runs WHERE alive_ms < ?) AND start_ms < "
                   "? ORDER BY start_ms"))
        return out;
    sqlite3_bind_int64(s.st, 1, from);
    sqlite3_bind_int64(s.st, 2, to);
    int64_t prevEnd = -1;
    while (sqlite3_step(s.st) == SQLITE_ROW) {
        const int64_t start = sqlite3_column_int64(s.st, 0);
        const int64_t alive = sqlite3_column_int64(s.st, 1);
        if (prevEnd >= 0 && start > prevEnd) {
            const int64_t a = std::max(prevEnd, from);
            const int64_t b = std::min(start, to);
            if (b > a) out.push_back({a, b});
        }
        prevEnd = std::max(prevEnd, alive);
    }
    return out;
}

// ---------------------------------------------------------------- series

SeriesResult querySeries(ReaderPool::Lease& lease, const SeriesParams& p) {
    SeriesResult r;
    const int64_t t0 = steadyMs();
    sqlite3* db = lease.db();
    const QueryGroup& g = *p.group;
    int rc = 0;
    // 1. what is there: the aggregate coverage and the raw scan estimate (index lookups only)
    const auto cids = aggCids(db, g);
    std::vector<int64_t> wanted;
    for (size_t t : p.tags)
        if (auto it = cids.find(g.tags[t].column); it != cids.end()) wanted.push_back(it->second);
    SourceInput in;
    in.from = p.from;
    in.to = p.to;
    in.maxPoints = p.maxPoints;
    in.res = p.res;
    in.reduce = p.reduce;
    in.groupHasAggregates = g.hasAggregates && !wanted.empty();
    in.scanLimitBytes = p.scanLimitBytes;
    std::optional<Range> hourRange, minuteRange;
    if (in.groupHasAggregates) {
        in.hourCoverage = coverageOf(db, wanted, kHourMs, p.from, p.to, &hourRange);
        in.minuteCoverage = coverageOf(db, wanted, kMinuteMs, p.from, p.to, &minuteRange);
    }
    const std::string t = logTable(g);
    const auto seqLo = oneInt(db, "SELECT seq FROM " + t + " WHERE ts >= ? ORDER BY ts, seq LIMIT 1",
                              {p.from}, rc);
    const auto seqHi = oneInt(
        db, "SELECT seq FROM " + t + " WHERE ts < ? ORDER BY ts DESC, seq DESC LIMIT 1", {p.to},
        rc);
    if (rc != SQLITE_OK) {
        r.status = statusOfRc(lease, rc);
        return r;
    }
    const int64_t rowsInRange = (seqLo && seqHi && *seqHi >= *seqLo) ? *seqHi - *seqLo + 1 : 0;
    r.scanRowsEstimate = rowsInRange;
    in.scanBytes = rowsInRange * (g.rowBytes + 16);
    const SourceChoice choice = chooseSource(in);
    if (choice.error == "NO_AGGREGATES") {
        r.status = QueryStatus::NoAggregates;
        return r;
    }
    if (choice.error == "SCAN_LIMIT") {
        r.status = QueryStatus::ScanLimit;
        return r;
    }
    r.res = choice.res;
    r.approximate = choice.approximate;
    r.gaps = queryGaps(db, p.from, p.to);

    if (choice.res == SourceRes::Raw) {
        r.reduce = choice.reduce == ReduceParam::MinMax    ? "minmax"
                   : choice.reduce == ReduceParam::Lttb    ? "lttb"
                                                           : "decimate";
        const std::string sel = selectCols(db, g, p.tags);
        std::optional<int64_t> first, last;
        if (choice.reduce == ReduceParam::Decimate) {
            // one index lookup per window: the first row at or after the window start
            Stmt s;
            if (!s.prepare(db, sel + " WHERE ts >= ? AND ts < ? ORDER BY ts, seq LIMIT 1")) {
                r.status = QueryStatus::Unavailable;
                return r;
            }
            std::vector<SeriesLine> lines(p.tags.size());
            for (size_t i = 0; i < p.tags.size(); ++i) lines[i].tag = p.tags[i];
            for (int64_t k = 0; k < p.maxPoints; ++k) {
                const int64_t lo = p.from + static_cast<int64_t>(static_cast<__int128>(k) * (p.to - p.from) / p.maxPoints);
                const int64_t hi = p.from + static_cast<int64_t>(static_cast<__int128>(k + 1) * (p.to - p.from) / p.maxPoints);
                sqlite3_reset(s.st);
                sqlite3_bind_int64(s.st, 1, lo);
                sqlite3_bind_int64(s.st, 2, hi);
                rc = sqlite3_step(s.st);
                if (rc == SQLITE_ROW) {
                    ++r.rowsRead;
                    const int64_t ts = sqlite3_column_int64(s.st, 1);
                    if (!first) first = ts;
                    last = ts;
                    for (size_t i = 0; i < p.tags.size(); ++i) {
                        lines[i].t.push_back(ts);
                        lines[i].v.push_back(numberOf(s.st, static_cast<int>(i) + 2));
                    }
                } else if (rc != SQLITE_DONE) {
                    r.status = statusOfRc(lease, rc);
                    return r;
                }
            }
            r.lines = std::move(lines);
        } else {
            Stmt s;
            if (!s.prepare(db, sel + " WHERE ts >= ? AND ts < ? ORDER BY ts, seq")) {
                r.status = QueryStatus::Unavailable;
                return r;
            }
            sqlite3_bind_int64(s.st, 1, p.from);
            sqlite3_bind_int64(s.st, 2, p.to);
            std::vector<MinMaxReducer> red;
            std::vector<std::vector<SeriesPoint>> all;  // lttb keeps the rows
            const bool lttb = choice.reduce == ReduceParam::Lttb;
            for (size_t i = 0; i < p.tags.size(); ++i) {
                red.emplace_back(p.from, p.to, p.maxPoints);
                all.emplace_back();
            }
            while ((rc = sqlite3_step(s.st)) == SQLITE_ROW) {
                ++r.rowsRead;
                const int64_t ts = sqlite3_column_int64(s.st, 1);
                if (!first) first = ts;
                last = ts;
                for (size_t i = 0; i < p.tags.size(); ++i) {
                    const auto v = numberOf(s.st, static_cast<int>(i) + 2);
                    if (lttb)
                        all[i].push_back({ts, v});
                    else
                        red[i].add(ts, v);
                }
            }
            if (rc != SQLITE_DONE) {
                r.status = statusOfRc(lease, rc);
                return r;
            }
            for (size_t i = 0; i < p.tags.size(); ++i) {
                SeriesLine line;
                line.tag = p.tags[i];
                const auto pts = lttb ? reduceLttb(all[i], p.maxPoints) : red[i].finish();
                for (const auto& q : pts) {
                    line.t.push_back(q.t);
                    line.v.push_back(q.v);
                }
                r.lines.push_back(std::move(line));
            }
        }
        if (first) r.coverage = Range{*first, *last + 1};
    } else {
        r.reduce = "merge";
        const int64_t res = choice.res == SourceRes::Hour ? kHourMs : kMinuteMs;
        r.coverage = choice.res == SourceRes::Hour ? hourRange : minuteRange;
        Stmt s;
        if (!s.prepare(db, kAggSelect)) {
            r.status = QueryStatus::Unavailable;
            return r;
        }
        for (size_t t : p.tags) {
            SeriesLine line;
            line.tag = t;
            const auto it = cids.find(g.tags[t].column);
            if (it != cids.end()) {
                std::vector<BucketRow> rows;
                sqlite3_reset(s.st);
                sqlite3_bind_int64(s.st, 1, res);
                sqlite3_bind_int64(s.st, 2, it->second);
                sqlite3_bind_int64(s.st, 3, floorDiv(p.from, res) * res);
                sqlite3_bind_int64(s.st, 4, p.to);
                while ((rc = sqlite3_step(s.st)) == SQLITE_ROW) {
                    ++r.rowsRead;
                    rows.push_back({sqlite3_column_int64(s.st, 1), bucketOf(s.st, 2)});
                }
                if (rc != SQLITE_DONE) {
                    r.status = statusOfRc(lease, rc);
                    return r;
                }
                for (const auto& m : reduceMerge(rows, p.from, p.to, res, p.maxPoints)) {
                    line.t.push_back(m.t);
                    line.v.push_back(m.v);
                    line.min.push_back(m.min);
                    line.max.push_back(m.max);
                }
            }
            r.lines.push_back(std::move(line));
        }
    }
    r.elapsedMs = steadyMs() - t0;
    return r;
}

// ---------------------------------------------------------------- aggregate

AggregateResult queryAggregate(ReaderPool::Lease& lease, const AggregateParams& p) {
    AggregateResult r;
    const int64_t t0 = steadyMs();
    sqlite3* db = lease.db();
    const QueryGroup& g = *p.group;
    r.tags = p.tags;
    const auto cids = aggCids(db, g);
    if (!g.hasAggregates || cids.empty()) {
        r.status = QueryStatus::NoAggregates;
        return r;
    }
    const int64_t a = floorDiv(p.from - p.offsetMs, p.bucketMs) * p.bucketMs + p.offsetMs;
    const int64_t count = (p.to - a + p.bucketMs - 1) / p.bucketMs;
    r.start = a;
    r.count = count;
    if (count > kMaxAggregateWindows) {
        r.status = QueryStatus::RangeTooLarge;
        return r;
    }
    int64_t res = kMinuteMs;
    if (p.bucketMs % kHourMs == 0 && p.offsetMs % kHourMs == 0) {
        std::vector<int64_t> wanted;
        for (const auto& kv : cids) wanted.push_back(kv.second);
        if (coverageOf(db, wanted, kHourMs, a, a + count * p.bucketMs, nullptr) > 0) res = kHourMs;
    }
    r.source = res == kHourMs ? "hour" : "minute";
    const int64_t rowsEstimate = count * (p.bucketMs / res) * static_cast<int64_t>(p.tags.size());
    if (rowsEstimate > kMaxAggregateRows) {
        r.status = QueryStatus::RangeTooLarge;
        return r;
    }
    Stmt s;
    if (!s.prepare(db, kAggSelect)) {
        r.status = QueryStatus::Unavailable;
        return r;
    }
    r.buckets.assign(p.tags.size(), std::vector<AggBucket>(static_cast<size_t>(count)));
    for (size_t i = 0; i < p.tags.size(); ++i) {
        const auto it = cids.find(g.tags[p.tags[i]].column);
        if (it == cids.end()) continue;
        sqlite3_reset(s.st);
        sqlite3_bind_int64(s.st, 1, res);
        sqlite3_bind_int64(s.st, 2, it->second);
        sqlite3_bind_int64(s.st, 3, a);
        sqlite3_bind_int64(s.st, 4, a + count * p.bucketMs);
        int rc;
        while ((rc = sqlite3_step(s.st)) == SQLITE_ROW) {
            ++r.rowsRead;
            const int64_t bucket = sqlite3_column_int64(s.st, 1);
            const auto k = static_cast<size_t>((bucket - a) / p.bucketMs);
            if (k < r.buckets[i].size())
                r.buckets[i][k] = mergeBuckets(r.buckets[i][k], bucketOf(s.st, 2));
        }
        if (rc != SQLITE_DONE) {
            r.status = statusOfRc(lease, rc);
            return r;
        }
    }
    r.elapsedMs = steadyMs() - t0;
    return r;
}

// ---------------------------------------------------------------- rows

RowsResult queryRows(ReaderPool::Lease& lease, const RowsParams& p) {
    RowsResult r;
    const int64_t t0 = steadyMs();
    sqlite3* db = lease.db();
    const QueryGroup& g = *p.group;
    std::string sql = selectCols(db, g, p.tags) + " WHERE ts >= ? AND ts < ?";
    if (p.after) sql += p.descending ? " AND seq < ?" : " AND seq > ?";
    sql += p.descending ? " ORDER BY seq DESC LIMIT ?" : " ORDER BY seq LIMIT ?";
    Stmt s;
    if (!s.prepare(db, sql)) {
        r.status = QueryStatus::Unavailable;
        return r;
    }
    int i = 1;
    sqlite3_bind_int64(s.st, i++, p.from);
    sqlite3_bind_int64(s.st, i++, p.to);
    if (p.after) sqlite3_bind_int64(s.st, i++, *p.after);
    sqlite3_bind_int(s.st, i++, p.limit + 1);  // one more: is there a next page?
    int rc;
    while ((rc = sqlite3_step(s.st)) == SQLITE_ROW) {
        StoredRow row;
        row.seq = sqlite3_column_int64(s.st, 0);
        row.ts = sqlite3_column_int64(s.st, 1);
        for (size_t k = 0; k < p.tags.size(); ++k) row.cells.push_back(cellOf(s.st, static_cast<int>(k) + 2));
        r.rows.push_back(std::move(row));
    }
    if (rc != SQLITE_DONE) {
        r.status = statusOfRc(lease, rc);
        return r;
    }
    if (r.rows.size() > static_cast<size_t>(p.limit)) {
        r.rows.pop_back();
        r.next = r.rows.back().seq;
    }
    r.elapsedMs = steadyMs() - t0;
    return r;
}

// ---------------------------------------------------------------- export

ExportInfo estimateExport(ReaderPool::Lease& lease, const ExportParams& p) {
    ExportInfo info;
    sqlite3* db = lease.db();
    const QueryGroup& g = *p.group;
    if (p.res == ResParam::Raw) {
        int rc = 0;
        const std::string t = logTable(g);
        const auto lo = oneInt(db, "SELECT seq FROM " + t + " WHERE ts >= ? ORDER BY ts, seq LIMIT 1",
                               {p.from}, rc);
        const auto hi = oneInt(db, "SELECT seq FROM " + t + " WHERE ts < ? ORDER BY ts DESC, seq DESC LIMIT 1",
                               {p.to}, rc);
        if (rc != SQLITE_OK) {
            info.status = statusOfRc(lease, rc);
            return info;
        }
        info.rowsEstimate = (lo && hi && *hi >= *lo) ? *hi - *lo + 1 : 0;
    } else {
        if (!g.hasAggregates || aggCids(db, g).empty()) {
            info.status = QueryStatus::NoAggregates;
            return info;
        }
        const int64_t res = p.res == ResParam::Hour ? kHourMs : kMinuteMs;
        info.rowsEstimate = (p.to - floorDiv(p.from, res) * res + res - 1) / res;
    }
    if (info.rowsEstimate > p.maxRows) info.status = QueryStatus::ExportTooLarge;
    return info;
}

QueryStatus exportCsv(ReaderPool::Lease& lease, const ExportParams& p,
                      const std::function<bool(const std::string&)>& sink, int64_t& rowsOut) {
    rowsOut = 0;
    sqlite3* db = lease.db();
    const QueryGroup& g = *p.group;
    CsvChunker out(sink);
    if (p.bom) out.append(csvBom());
    if (p.res == ResParam::Raw) {
        std::vector<std::string> names;
        for (size_t t : p.tags) names.push_back(g.tags[t].column);
        out.append(csvHeader(names));
        Stmt s;
        if (!s.prepare(db, selectCols(db, g, p.tags) + " WHERE ts >= ? AND ts < ? ORDER BY ts, seq"))
            return QueryStatus::Unavailable;
        sqlite3_bind_int64(s.st, 1, p.from);
        sqlite3_bind_int64(s.st, 2, p.to);
        int rc;
        std::vector<std::string> cells(p.tags.size());
        while ((rc = sqlite3_step(s.st)) == SQLITE_ROW) {
            const int64_t ts = sqlite3_column_int64(s.st, 1);
            for (size_t k = 0; k < p.tags.size(); ++k) cells[k] = csvCell(cellOf(s.st, static_cast<int>(k) + 2));
            if (!out.append(csvLine(csvTime(ts, g.offsetMin, 0), cells))) return QueryStatus::Cancelled;
            if (++rowsOut > p.maxRows) break;
        }
        if (rc != SQLITE_DONE && rc != SQLITE_ROW) return statusOfRc(lease, rc);
        return out.flush() ? QueryStatus::Ok : QueryStatus::Cancelled;
    }
    // aggregate rows: one line per bucket, <column>.<field> per aggregated Tag
    const int64_t res = p.res == ResParam::Hour ? kHourMs : kMinuteMs;
    const auto cids = aggCids(db, g);
    std::vector<std::string> fields = p.fields;
    if (fields.empty()) fields = {"avg", "min", "max", "last"};
    std::vector<std::string> names;
    std::vector<int64_t> wanted;
    std::vector<size_t> wantedTags;
    for (size_t t : p.tags) {
        const auto it = cids.find(g.tags[t].column);
        if (it == cids.end()) continue;
        wanted.push_back(it->second);
        wantedTags.push_back(t);
        for (const auto& f : fields) names.push_back(g.tags[t].column + "." + f);
    }
    out.append(csvHeader(names));
    Stmt s;
    if (!s.prepare(db,
                   "SELECT cid, bucket, n, \"min\", \"max\", \"first\", \"last\", sumw, wms FROM "
                   "mat_agg WHERE res = ? AND cid IN (" +
                       cidList(wanted) + ") AND bucket >= ? AND bucket < ? ORDER BY bucket, cid"))
        return QueryStatus::Unavailable;
    sqlite3_bind_int64(s.st, 1, res);
    sqlite3_bind_int64(s.st, 2, floorDiv(p.from, res) * res);
    sqlite3_bind_int64(s.st, 3, p.to);
    std::map<int64_t, size_t> pos;
    for (size_t i = 0; i < wanted.size(); ++i) pos[wanted[i]] = i;
    auto fieldText = [](const AggBucket& b, const std::string& f) -> std::string {
        if (b.empty()) return "";
        if (f == "min") return csvNumber(b.min);
        if (f == "max") return csvNumber(b.max);
        if (f == "first") return csvNumber(b.first);
        if (f == "last") return csvNumber(b.last);
        if (f == "sum") return csvNumber(*aggSum(b));
        if (f == "count") return std::to_string(b.n);
        return csvNumber(*aggAvg(b));
    };
    int64_t curBucket = INT64_MIN;
    std::vector<AggBucket> row(wanted.size());
    auto emit = [&]() -> bool {
        if (curBucket == INT64_MIN) return true;
        std::vector<std::string> cells;
        for (size_t i = 0; i < wanted.size(); ++i)
            for (const auto& f : fields) cells.push_back(fieldText(row[i], f));
        ++rowsOut;
        return out.append(csvLine(csvTime(curBucket, g.offsetMin, res), cells));
    };
    int rc;
    while ((rc = sqlite3_step(s.st)) == SQLITE_ROW) {
        const int64_t bucket = sqlite3_column_int64(s.st, 1);
        if (bucket != curBucket) {
            if (!emit()) return QueryStatus::Cancelled;
            curBucket = bucket;
            row.assign(wanted.size(), AggBucket{});
        }
        const auto it = pos.find(sqlite3_column_int64(s.st, 0));
        if (it != pos.end()) row[it->second] = bucketOf(s.st, 2);
        if (rowsOut > p.maxRows) break;
    }
    if (rc != SQLITE_DONE && rc != SQLITE_ROW) return statusOfRc(lease, rc);
    if (!emit()) return QueryStatus::Cancelled;
    return out.flush() ? QueryStatus::Ok : QueryStatus::Cancelled;
}

}  // namespace mat
