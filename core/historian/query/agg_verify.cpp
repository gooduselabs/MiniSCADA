#include "core/historian/query/agg_verify.hpp"

#include <sys/stat.h>

#include <algorithm>
#include <cmath>
#include <map>
#include <memory>

#include "core/historian/aggregator.hpp"
#include "core/historian/local_store.hpp"
#include "core/historian/query/reader_pool.hpp"

namespace mat {

namespace {

int64_t floorTo(int64_t t, int64_t res) {
    int64_t r = t % res;
    if (r < 0) r += res;
    return t - r;
}

struct Stmt {
    sqlite3_stmt* st = nullptr;
    ~Stmt() { sqlite3_finalize(st); }
    bool prepare(sqlite3* db, const std::string& sql) {
        return sqlite3_prepare_v2(db, sql.c_str(), -1, &st, nullptr) == SQLITE_OK;
    }
};

std::optional<int64_t> queryInt(sqlite3* db, const std::string& sql) {
    Stmt s;
    if (!s.prepare(db, sql)) return std::nullopt;
    if (sqlite3_step(s.st) == SQLITE_ROW && sqlite3_column_type(s.st, 0) != SQLITE_NULL)
        return sqlite3_column_int64(s.st, 0);
    return std::nullopt;
}

bool near(double a, double b) {
    return std::fabs(a - b) <= 1e-9 * std::max({1.0, std::fabs(a), std::fabs(b)});
}

AggBucket readBucket(sqlite3_stmt* st, int base) {
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

std::string differs(const AggBucket& a, const AggBucket& e) {
    if (a.n != e.n) return "n";
    if (a.wms != e.wms) return "wms";
    if (!near(a.min, e.min)) return "min";
    if (!near(a.max, e.max)) return "max";
    if (!near(a.first, e.first)) return "first";
    if (!near(a.last, e.last)) return "last";
    if (!near(a.sumw, e.sumw)) return "sumw";
    return "";
}

}  // namespace

bool verifyAggregates(const std::string& dbPath, const std::string& groupId,
                      std::optional<int64_t> from, std::optional<int64_t> to, VerifyResult& out,
                      std::string& err) {
    out = VerifyResult{};
    ReaderPool pool(ReaderPool::Options{dbPath, 4096, 1, 60000, {}});
    auto lease = pool.acquire(0, nullptr, err);
    if (!lease) {
        err = "không mở được history.db";
        return false;
    }
    sqlite3* db = lease->db();
    std::string table;
    {
        Stmt s;
        if (!s.prepare(db,
                       "SELECT name FROM mat_tables WHERE group_id = ? ORDER BY updated_ms DESC "
                       "LIMIT 1")) {
            err = "file không phải history.db";
            return false;
        }
        sqlite3_bind_text(s.st, 1, groupId.c_str(), -1, SQLITE_TRANSIENT);
        if (sqlite3_step(s.st) != SQLITE_ROW) {
            err = "không có nhóm '" + groupId + "' trong dữ liệu lưu trữ";
            return false;
        }
        table = reinterpret_cast<const char*>(sqlite3_column_text(s.st, 0));
    }
    std::vector<std::pair<std::string, int64_t>> cols;  // column, cid
    {
        Stmt s;
        if (!s.prepare(db, "SELECT col, cid FROM mat_agg_cols WHERE tbl = ? ORDER BY cid")) {
            out.note = "file chưa có bảng tổng hợp (schema 1)";
            return true;
        }
        sqlite3_bind_text(s.st, 1, table.c_str(), -1, SQLITE_TRANSIENT);
        while (sqlite3_step(s.st) == SQLITE_ROW)
            cols.emplace_back(reinterpret_cast<const char*>(sqlite3_column_text(s.st, 0)),
                              sqlite3_column_int64(s.st, 1));
    }
    if (cols.empty()) {
        out.note = "nhóm không bật tổng hợp";
        return true;
    }
    const std::string tq = quoteIdent("log_" + table);
    const auto builtTo =
        queryInt(db, "SELECT agg_built_to FROM mat_tables WHERE name = '" + table + "'");
    if (!builtTo) {
        out.note = "chưa dựng bucket nào";
        return true;
    }
    const auto minTs = queryInt(db, "SELECT min(ts) FROM " + tq);
    if (!minTs) {
        out.note = "nhóm chưa có dòng thô";
        return true;
    }
    const int64_t lo = std::max(from.value_or(*minTs), *minTs);
    const int64_t hi = std::min(to.value_or(*builtTo), *builtTo);
    if (hi <= lo) return true;
    std::vector<int64_t> runStarts;
    std::vector<int64_t> runAlive;
    {
        Stmt s;
        if (s.prepare(db, "SELECT start_ms, alive_ms FROM mat_runs ORDER BY start_ms"))
            while (sqlite3_step(s.st) == SQLITE_ROW) {
                runStarts.push_back(sqlite3_column_int64(s.st, 0));
                runAlive.push_back(sqlite3_column_int64(s.st, 1));
            }
    }
    // Where the signal of the run that holds `ts` ended: at its last row or at its last sign of
    // life (a clean stop writes it; after a kill it is up to a minute old), never into the next
    // run.
    auto endOfRun = [&](int64_t lastRow) {
        int64_t end = lastRow;
        size_t k = 0;
        while (k < runStarts.size() && runStarts[k] <= lastRow) ++k;
        if (k > 0) {
            end = std::max(lastRow, runAlive[k - 1]);
            if (k < runStarts.size()) end = std::min(end, runStarts[k]);
        }
        return end;
    };
    // The tolerated windows: [start, end)
    std::vector<std::pair<int64_t, int64_t>> tol;
    if (from) tol.emplace_back(floorTo(lo, kAggMinuteMs), floorTo(lo, kAggMinuteMs) + kAggMinuteMs);

    // Raw rows → expected minute buckets
    std::string sel = "SELECT ts";
    for (const auto& c : cols) sel += ", " + quoteIdent(c.first);
    sel += " FROM " + tq + " WHERE ts >= ? AND ts < ? ORDER BY ts, seq";
    Stmt rows;
    if (!rows.prepare(db, sel)) {
        err = "không đọc được dòng thô";
        return false;
    }
    sqlite3_bind_int64(rows.st, 1, lo);
    sqlite3_bind_int64(rows.st, 2, hi);
    std::map<std::pair<size_t, int64_t>, AggBucket> expected;  // (column index, bucket)
    auto agg = std::make_unique<GroupAggregator>(cols.size());
    std::vector<AggOut> drained;
    auto take = [&] {
        drained.clear();
        agg->drain(drained);
        for (const auto& o : drained) {
            if (o.res != kAggMinuteMs) continue;
            auto& slot = expected[{o.col, o.bucket}];
            slot = slot.empty() && slot.n == 0 && slot.wms == 0 ? o.agg : mergeBuckets(slot, o.agg);
        }
    };
    size_t seg = 0;  // index of the last run start <= the row
    while (seg < runStarts.size() && runStarts[seg] <= lo) ++seg;
    int64_t lastTs = -1;
    bool any = false;
    while (sqlite3_step(rows.st) == SQLITE_ROW) {
        const int64_t ts = sqlite3_column_int64(rows.st, 0);
        // a new run begins before this row: the old signal ended at its last row
        while (seg < runStarts.size() && runStarts[seg] <= ts) {
            if (any) {
                const int64_t end = endOfRun(lastTs);
                agg->breakAll(end);
                take();
                tol.emplace_back(floorTo(lastTs, kAggMinuteMs),
                                 floorTo(end, kAggMinuteMs) + 17 * kAggMinuteMs);
            }
            ++seg;
        }
        std::vector<std::optional<double>> v(cols.size());
        for (size_t i = 0; i < cols.size(); ++i) {
            const int t = sqlite3_column_type(rows.st, static_cast<int>(i) + 1);
            if (t == SQLITE_INTEGER || t == SQLITE_FLOAT)
                v[i] = sqlite3_column_double(rows.st, static_cast<int>(i) + 1);
        }
        agg->row(ts, v);
        take();
        lastTs = ts;
        any = true;
    }
    if (any) {
        if (runStarts.empty()) {
            agg->advance(hi);  // the windows below agg_built_to are closed
        } else {
            // the last run: its signal ends at its last sign of life; the windows around that are
            // not compared (a running runtime is a minute ahead of mat_runs.alive_ms)
            const int64_t end = std::min(endOfRun(lastTs), hi);
            agg->breakAll(end);
            tol.emplace_back(floorTo(lastTs, kAggMinuteMs),
                             floorTo(end, kAggMinuteMs) + 17 * kAggMinuteMs);
        }
        take();
    }

    // Actual buckets
    std::map<std::pair<size_t, int64_t>, AggBucket> actual;
    std::map<int64_t, size_t> index;
    for (size_t i = 0; i < cols.size(); ++i) index[cols[i].second] = i;
    std::string cidIn;
    for (const auto& c : cols) cidIn += (cidIn.empty() ? "" : ",") + std::to_string(c.second);
    std::map<std::pair<size_t, int64_t>, AggBucket> actualHour;
    for (const int64_t res : {kAggMinuteMs, kAggHourMs}) {
        Stmt s;
        if (!s.prepare(db,
                       "SELECT cid, bucket, n, \"min\", COALESCE(\"max\", \"min\"), "
                       "COALESCE(\"first\", \"min\"), COALESCE(\"last\", \"min\"), sumw, wms FROM "
                       "mat_agg WHERE res = ? AND bucket >= ? AND bucket < ? AND cid IN (" +
                           cidIn + ")")) {
            err = "không đọc được mat_agg";
            return false;
        }
        sqlite3_bind_int64(s.st, 1, res);
        sqlite3_bind_int64(s.st, 2, floorTo(lo, res));
        sqlite3_bind_int64(s.st, 3, hi);
        while (sqlite3_step(s.st) == SQLITE_ROW) {
            const auto it = index.find(sqlite3_column_int64(s.st, 0));
            if (it == index.end()) continue;
            (res == kAggMinuteMs ? actual
                                 : actualHour)[{it->second, sqlite3_column_int64(s.st, 1)}] =
                readBucket(s.st, 2);
        }
    }
    auto tolerated = [&](int64_t b, int64_t res) {
        for (const auto& t : tol)
            if (b < t.second && b + res > t.first) return true;
        return false;
    };
    auto record = [&](size_t col, int64_t res, int64_t bucket, const char* kind,
                      const std::string& detail, int64_t& counter) {
        ++counter;
        if (out.diffs.size() < 200)
            out.diffs.push_back({cols[col].first, res, bucket, kind, detail});
    };
    // minutes
    for (const auto& [key, e] : expected) {
        if (tolerated(key.second, kAggMinuteMs)) {
            ++out.tolerated;
            continue;
        }
        ++out.checked;
        const auto it = actual.find(key);
        if (it == actual.end())
            record(key.first, kAggMinuteMs, key.second, "missing", "", out.missing);
        else if (const std::string d = differs(it->second, e); !d.empty())
            record(key.first, kAggMinuteMs, key.second, "mismatch", d, out.mismatch);
    }
    for (const auto& [key, a] : actual) {
        (void)a;
        if (key.second >= hi || tolerated(key.second, kAggMinuteMs) || expected.count(key))
            continue;
        if (key.second + kAggMinuteMs > hi) continue;
        record(key.first, kAggMinuteMs, key.second, "extra", "", out.extra);
    }
    // hours: each is the merge of the minute rows of its hour (the minutes were compared with the
    // raw rows above, so the chain raw -> minute -> hour is checked end to end). Only hours that
    // lie whole inside the range are looked at.
    std::map<std::pair<size_t, int64_t>, AggBucket> fromMinutes;
    for (const auto& [key, a2] : actual) {
        auto& slot = fromMinutes[{key.first, floorTo(key.second, kAggHourMs)}];
        slot = mergeBuckets(slot, a2);
    }
    const int64_t firstWhole = floorTo(lo, kAggHourMs) + (lo % kAggHourMs ? kAggHourMs : 0);
    for (const auto& [key, e] : fromMinutes) {
        if (key.second < firstWhole || key.second + kAggHourMs > hi) continue;
        ++out.checked;
        const auto it = actualHour.find(key);
        if (it == actualHour.end())
            record(key.first, kAggHourMs, key.second, "missing", "", out.missing);
        else if (const std::string d = differs(it->second, e); !d.empty())
            record(key.first, kAggHourMs, key.second, "mismatch", d, out.mismatch);
    }
    return true;
}

bool historyStats(const std::string& dbPath, nlohmann::json& out, std::string& err) {
    ReaderPool pool(ReaderPool::Options{dbPath, 4096, 1, 60000, {}});
    auto lease = pool.acquire(0, nullptr, err);
    if (!lease) {
        err = "không mở được history.db";
        return false;
    }
    sqlite3* db = lease->db();
    out = nlohmann::json::object();
    out["schema"] =
        queryInt(db, "SELECT CAST(value AS INTEGER) FROM mat_meta WHERE key='schema'").value_or(1);
    struct stat st {};
    out["fileBytes"] = ::stat(dbPath.c_str(), &st) == 0 ? static_cast<int64_t>(st.st_size) : -1;
    out["tables"] = nlohmann::json::array();
    {
        Stmt s;
        if (s.prepare(db, "SELECT name, group_id FROM mat_tables ORDER BY name")) {
            std::vector<std::pair<std::string, std::string>> t;
            while (sqlite3_step(s.st) == SQLITE_ROW)
                t.emplace_back(reinterpret_cast<const char*>(sqlite3_column_text(s.st, 0)),
                               reinterpret_cast<const char*>(sqlite3_column_text(s.st, 1)));
            for (const auto& [name, group] : t) {
                const std::string q = quoteIdent("log_" + name);
                nlohmann::json j = {
                    {"group", group},
                    {"rows", queryInt(db, "SELECT count(*) FROM " + q).value_or(-1)}};
                const auto a = queryInt(db, "SELECT min(ts) FROM " + q);
                const auto b = queryInt(db, "SELECT max(ts) FROM " + q);
                j["from"] = a ? nlohmann::json(*a) : nlohmann::json(nullptr);
                j["to"] = b ? nlohmann::json(*b) : nlohmann::json(nullptr);
                out["tables"].push_back(j);
            }
        }
    }
    nlohmann::json agg = {
        {"minute", queryInt(db, "SELECT count(*) FROM mat_agg WHERE res = 60000").value_or(-1)},
        {"hour", queryInt(db, "SELECT count(*) FROM mat_agg WHERE res = 3600000").value_or(-1)}};
    out["aggregates"] = agg;
    out["runs"] = queryInt(db, "SELECT count(*) FROM mat_runs").value_or(-1);
    return true;
}

}  // namespace mat
