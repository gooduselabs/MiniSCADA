// Dev tool for the historian scenarios of tools/historian-it.ps1 (x64 only, never packaged).
// Columns are NAME:TYPE, TYPE a Tag type (BOOL, INT32, FLOAT64, STRING, …) or a SQLite affinity
// (REAL, INTEGER, TEXT).
//   fill       --data-dir D --group G --table T --columns … --retention DAYS
//              (--days N --period MS: rows from now−N days to now
//               | --rows N --period MS [--start-ms T]: N rows from T, default now)
//   write-loop --data-dir D --table T --columns … [--rows N] [--every MS]
//              commits N synthetic rows every MS until killed (kill -9 scenarios)
//   fill-agg   --data-dir D [--group bench --table bench] --days N --tags N --period MS
//              [--start-ms T] [--run-hours H] [--agg 1|0] [--dump FILE]
//              Deterministic bench data (feature 010): N tags (every 20th a BOOL) as a model of
//              sines, ramps, steps and counters; one row per period; a new run (mat_runs, a 10
//              minute gap) every H hours; the minute/hour tables built with the same accumulator as
//              the runtime unless --agg 0 (then agg_built_to stays empty: the back-fill test).
//              --dump writes "ts,v1,v2,..." for tools/history-ref. Big transactions: 7 days x 200
//              tags in minutes.
//   backfill   --data-dir D [--table bench] --tags N [--timeout-s S]
//              runs the real Historian (aggregates on) over a fill-agg --agg 0 file until the
//              back-fill is done; prints one JSON line with the time it took and the bucket counts.
//   soak       --data-dir D [--days 7] [--tags 200] [--retention-days 3] [--agg 1|0] [--changes 10]
//              the real Historian over a compressed clock (100 ms passes without sleeping):
//              onChange group, retention and aggregate cleaning every simulated hour. Prints one
//              JSON line: real write_bytes of this process per simulated day, db size per day,
//              rows, bucket rows and the logging estimate (estimateLogging) for the same
//              configuration (T139, SC-025 on x64).
//   count      --data-dir D --table T [--older-than-days N | --older-than-hours N]
//   purge      --data-dir D --table T --older-than-days N   delete like retention (lost rows)
//   integrity  --data-dir D                    PRAGMA integrity_check
//   forward    --data-dir D --table T --columns … --dest DEST.json [--timeout-ms MS]
//              runs one forwarder until nothing is left (or killed); secret in MAT_IT_SECRET.
//              The device cursor (InfluxDB) is saved after every batch, like the historian does.
//   verify     --data-dir D --table T --columns … --dest DEST.json [--from-ms MS]
//              compares the destination with history.db: rows, duplicates, missing, values
//              (from MS on: rows sent, then deleted on the device, stay at the destination).
// forward and verify print one JSON line; exit code 0 = done / identical.
#include <sys/stat.h>

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "core/historian/aggregator.hpp"
#include "core/historian/clock.hpp"
#include "core/historian/forward/forwarder.hpp"
#include "core/historian/forward/sql_destination.hpp"
#include "core/historian/historian.hpp"
#include "core/historian/io_meter.hpp"
#include "core/historian/local_store.hpp"
#include "core/historian/tests/it_support.hpp"
#include "core/historian/write_counter_vfs.hpp"
#include "core/project-manager/logging_estimate.hpp"
#include "nlohmann/json.hpp"

using namespace mat;

namespace {

int64_t nowMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}
int64_t monoMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

std::map<std::string, std::string> parseArgs(int argc, char** argv) {
    std::map<std::string, std::string> a;
    for (int i = 2; i + 1 < argc; i += 2) a[argv[i]] = argv[i + 1];
    return a;
}

struct Column {
    ColumnSpec spec;  // name, SQLite affinity
    TagType type = TagType::FLOAT64;
};

std::vector<Column> parseColumns(const std::string& s) {
    std::vector<Column> out;
    size_t start = 0;
    while (start < s.size()) {
        size_t end = s.find(',', start);
        if (end == std::string::npos) end = s.size();
        const std::string item = s.substr(start, end - start);
        const size_t colon = item.find(':');
        Column c;
        c.spec.name = item.substr(0, colon);
        const std::string type = colon == std::string::npos ? "" : item.substr(colon + 1);
        if (const auto t = parseTagType(type)) {
            c.type = *t;
            c.spec.affinity = sqliteAffinity(*t);
        } else {
            c.spec.affinity = type;
            c.type = type == "REAL" ? TagType::FLOAT64
                                    : type == "TEXT" ? TagType::STRING : TagType::INT64;
        }
        out.push_back(c);
        start = end + 1;
    }
    return out;
}

Cell synthetic(const Column& c, int64_t i) {
    switch (c.type) {
        case TagType::FLOAT32:
        case TagType::FLOAT64:
            return 50.0 + 40.0 * std::sin(static_cast<double>(i) / 600.0);
        case TagType::STRING:
            return std::string("s") + std::to_string(i % 1000);
        case TagType::BOOL:
            return static_cast<int64_t>(i % 2);
        default:
            return static_cast<int64_t>(i);
    }
}

bool openStore(LocalStore& s, std::map<std::string, std::string>& a,
               const std::vector<Column>& cols) {
    ::mkdir(a["--data-dir"].c_str(), 0700);  // mat-runtime creates it too (ensureDir)
    std::string err;
    if (!s.open(err)) {
        std::fprintf(stderr, "open: %s\n", err.c_str());
        return false;
    }
    TableSpec t;
    t.table = a["--table"];
    t.groupId = a.count("--group") ? a["--group"] : t.table;
    t.retentionDays = a.count("--retention") ? std::stoi(a["--retention"]) : 30;
    for (const auto& c : cols) t.columns.push_back(c.spec);
    if (!s.ensureTables({t}, err)) {
        std::fprintf(stderr, "tables: %s\n", err.c_str());
        return false;
    }
    return true;
}

int fill(std::map<std::string, std::string>& a) {
    const int64_t now = nowMs();
    const auto cols = parseColumns(a["--columns"]);
    LocalStore s(a["--data-dir"], [now] { return now; });
    if (!openStore(s, a, cols)) return 1;
    const int64_t period = std::stoll(a["--period"]);
    int64_t from = 0, count = 0;
    if (a.count("--rows")) {
        count = std::stoll(a["--rows"]);
        from = a.count("--start-ms") ? std::stoll(a["--start-ms"]) : now;
    } else {
        from = now - std::stoll(a["--days"]) * 86400000LL;
        count = (now - from + period - 1) / period;
    }
    std::vector<PendingRow> rows;
    std::string err;
    int64_t total = 0;
    for (int64_t i = 0; i < count; ++i) {
        PendingRow r{0, from + i * period, {}};
        for (const auto& c : cols) r.cells.push_back(synthetic(c, i));
        rows.push_back(std::move(r));
        if (rows.size() == 50000 || i + 1 == count) {
            if (!s.commit(rows, err)) {
                std::fprintf(stderr, "commit: %s\n", err.c_str());
                return 1;
            }
            total += static_cast<int64_t>(rows.size());
            rows.clear();
        }
    }
    std::printf("filled %lld rows, %lld bytes used\n", static_cast<long long>(total),
                static_cast<long long>(s.usedBytes()));
    return 0;
}

int writeLoop(std::map<std::string, std::string>& a) {
    const auto cols = parseColumns(a["--columns"]);
    LocalStore s(a["--data-dir"], nowMs);
    if (!openStore(s, a, cols)) return 1;
    const int perCommit = a.count("--rows") ? std::stoi(a["--rows"]) : 100;
    const int64_t every = a.count("--every") ? std::stoll(a["--every"]) : 10;
    std::string err;
    int64_t i = 0;
    while (true) {
        std::vector<PendingRow> rows;
        for (int k = 0; k < perCommit; ++k, ++i) {
            PendingRow r{0, nowMs(), {}};
            for (const auto& c : cols) r.cells.push_back(synthetic(c, i));
            rows.push_back(std::move(r));
        }
        if (!s.commit(rows, err)) {
            std::fprintf(stderr, "commit: %s\n", err.c_str());
            return 1;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(every));
    }
}

int count(std::map<std::string, std::string>& a) {
    HistoryReader r;
    std::string err;
    if (!r.open(a["--data-dir"] + "/history.db", err)) {
        std::fprintf(stderr, "open: %s\n", err.c_str());
        return 1;
    }
    int64_t to = INT64_MAX;
    if (a.count("--older-than-days"))
        to = nowMs() - std::stoll(a["--older-than-days"]) * 86400000LL;
    if (a.count("--older-than-hours"))
        to = nowMs() - std::stoll(a["--older-than-hours"]) * 3600000LL;
    int64_t n = 0;
    if (!r.readRange(
            a["--table"], {}, INT64_MIN, to,
            [&](const StoredRow&) {
                ++n;
                return true;
            },
            err)) {
        std::fprintf(stderr, "read: %s\n", err.c_str());
        return 1;
    }
    std::printf("%lld\n", static_cast<long long>(n));
    return 0;
}

int purge(std::map<std::string, std::string>& a) {
    LocalStore s(a["--data-dir"], nowMs);
    std::string err;
    if (!s.open(err)) {
        std::fprintf(stderr, "open: %s\n", err.c_str());
        return 1;
    }
    const int64_t cutoff = nowMs() - std::stoll(a["--older-than-days"]) * 86400000LL;
    int64_t total = 0;
    int n;
    while ((n = s.deleteExpired(a["--table"], cutoff, 2000, err)) > 0) total += n;
    if (n < 0) {
        std::fprintf(stderr, "purge: %s\n", err.c_str());
        return 1;
    }
    std::printf("%lld\n", static_cast<long long>(total));
    return 0;
}

int integrity(std::map<std::string, std::string>& a) {
    LocalStore s(a["--data-dir"], nowMs);
    std::string err;
    if (!s.open(err)) {
        std::fprintf(stderr, "open: %s\n", err.c_str());
        return 1;
    }
    const std::string r = s.pragmaText("integrity_check");
    std::printf("%s\n", r.c_str());
    return r == "ok" && !s.recovered() ? 0 : 1;
}

bool loadDest(std::map<std::string, std::string>& a, ConnectionModel& c) {
    std::ifstream f(a["--dest"]);
    std::stringstream text;
    text << f.rdbuf();
    const auto j = nlohmann::json::parse(text.str(), nullptr, false);
    if (!f || j.is_discarded() || !j.is_object()) {
        std::fprintf(stderr, "--dest: cannot read %s\n", a["--dest"].c_str());
        return false;
    }
    c = it::connectionFromJson(j);
    return true;
}

std::vector<SqlColumn> sqlColumns(const std::vector<Column>& cols) {
    std::vector<SqlColumn> out;
    for (const auto& c : cols) out.push_back({c.spec.name, c.type, 255});
    return out;
}

int forward(std::map<std::string, std::string>& a) {
    ConnectionModel c;
    if (!loadDest(a, c)) return 2;
    const auto cols = parseColumns(a["--columns"]);
    const std::string dir = a["--data-dir"];
    LocalStore store(dir, nowMs);  // saves the device cursor, as the historian does
    std::string err;
    if (!store.open(err)) {
        std::fprintf(stderr, "open: %s\n", err.c_str());
        return 1;
    }
    ForwarderOptions o;
    o.dbPath = dir + "/history.db";
    const char* secret = std::getenv("MAT_IT_SECRET");
    const std::string s = secret ? secret : "";
    o.secret = [s](const std::string&) {
        SecretResult r;
        r.ok = !s.empty();
        r.secret = s;
        r.reason = s.empty() ? "no_entry" : "";
        return r;
    };
    const std::string table = a["--table"];
    Forwarder f(c, {ForwardGroup{table, DestTable{table, sqlColumns(cols)}}},
                makeDestination(c, ""), o, nowMs, monoMs);
    const int64_t timeout = a.count("--timeout-ms") ? std::stoll(a["--timeout-ms"]) : 300000;
    const int64_t t0 = monoMs();
    // The forwarder's own thread, paced as in the runtime; the cursor is saved like the historian
    // does (every 100 ms here instead of every commit).
    if (!f.start(err)) {
        std::fprintf(stderr, "start: %s\n", err.c_str());
        return 1;
    }
    bool done = false;
    int idle = 0;
    while (monoMs() - t0 < timeout) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        const auto up = f.takeCursorUpdates();
        if (!up.empty() && !store.saveCursors(up, err))
            std::fprintf(stderr, "mat_forward: %s\n", err.c_str());
        const DestStatus st = f.status();
        idle = st.state == DestState::Ok && st.pendingRows == 0 ? idle + 1 : 0;
        if (idle >= 2) {  // twice in a row: not the moment between connect and the first count
            done = true;
            break;
        }
    }
    f.stop();
    const auto last = f.takeCursorUpdates();
    if (!last.empty() && !store.saveCursors(last, err))
        std::fprintf(stderr, "mat_forward: %s\n", err.c_str());
    const DestStatus st = f.status();
    nlohmann::json out = {{"state", destStateName(st.state)},
                          {"lastError", errorClassCode(st.lastError)},
                          {"dbCode", st.lastErrorDbCode},
                          {"sentRows", st.sentRows},
                          {"lostRows", st.lostRows},
                          {"pendingRows", st.pendingRows},
                          {"seconds", static_cast<double>(monoMs() - t0) / 1000.0}};
    std::printf("%s\n", out.dump().c_str());
    return done ? 0 : 1;
}

int verify(std::map<std::string, std::string>& a) {
    ConnectionModel c;
    if (!loadDest(a, c)) return 2;
    const auto cols = parseColumns(a["--columns"]);
    const std::string table = a["--table"];
    HistoryReader r;
    std::string err;
    if (!r.open(a["--data-dir"] + "/history.db", err)) {
        std::fprintf(stderr, "open: %s\n", err.c_str());
        return 1;
    }
    std::vector<std::string> names;
    for (const auto& col : cols) names.push_back(col.spec.name);
    const int64_t from = a.count("--from-ms") ? std::stoll(a["--from-ms"]) : INT64_MIN;
    std::vector<StoredRow> local;
    if (!r.readRange(
            table, names, from, INT64_MAX,
            [&](const StoredRow& row) {
                local.push_back(row);
                return true;
            },
            err)) {
        std::fprintf(stderr, "read: %s\n", err.c_str());
        return 1;
    }
    const auto sqlCols = sqlColumns(cols);
    const char* secret = std::getenv("MAT_IT_SECRET");
    int64_t remoteRows = 0, duplicates = 0, missing = 0, extra = 0, mismatches = 0;

    if (c.type == DbType::InfluxDb) {  // every column of every row has a value (fill)
        std::multiset<std::string> times;
        auto pts =
            it::influxField(c.url, secret ? secret : "", c.org, c.bucket, table, r.instanceId(),
                            sqlCols[0].name, err, from == INT64_MIN ? 946684800000 : from);
        if (!err.empty()) {
            std::fprintf(stderr, "%s\n", err.c_str());
            return 1;
        }
        for (const auto& p : pts) times.insert(p.first);
        remoteRows = static_cast<int64_t>(pts.size());
        std::set<std::string> want;
        for (const auto& row : local) want.insert(it::rfc3339(row.ts));
        for (const auto& t : want) missing += times.count(t) ? 0 : 1;
        for (const auto& t : times) {
            extra += want.count(t) ? 0 : 1;
            duplicates += times.count(t) > 1 ? 1 : 0;
        }
        for (size_t i = 0; i < pts.size() && i < local.size(); ++i)
            if (!it::sameValue("V" + pts[i].second, local[i].cells[0], sqlCols[0].type))
                ++mismatches;
    } else {
        auto s = makeSqlDestination(c, "");
        DestError e;
        if (!s->connect(secret ? secret : "", e)) {
            std::fprintf(stderr, "connect: %s %s\n", e.dbCode.c_str(), e.detail.c_str());
            return 1;
        }
        const SqlGen g = s->gen();
        const std::string where =
            from == INT64_MIN ? "" : " WHERE " + g.ident("time") + " >= " + g.timeLiteral(from);
        const std::string tail = " FROM " + g.qualified(it::schemaOf(c.type), table) + where +
                                 " ORDER BY " + g.ident("time");
        std::vector<std::string> times;
        if (!s->query("SELECT " + it::timeExpr(c.type, g) + tail, times, e)) {
            std::fprintf(stderr, "query: %s %s\n", e.dbCode.c_str(), e.detail.c_str());
            return 1;
        }
        for (auto& t : times) t = t.substr(0, 23);
        remoteRows = static_cast<int64_t>(times.size());
        std::multiset<std::string> have(times.begin(), times.end());
        std::set<std::string> want;
        for (const auto& row : local) want.insert(formatLocalTime(row.ts, c.offsetMin));
        for (const auto& t : want) missing += have.count(t) ? 0 : 1;
        for (const auto& t : std::set<std::string>(times.begin(), times.end())) {
            extra += want.count(t) ? 0 : 1;
            if (have.count(t) > 1) duplicates += static_cast<int64_t>(have.count(t)) - 1;
        }
        if (duplicates == 0 && missing == 0 && extra == 0) {
            for (size_t k = 0; k < sqlCols.size(); ++k) {
                std::vector<std::string> values;
                if (!s->query("SELECT " + it::valueExpr(c.type, g, sqlCols[k]) + tail, values, e)) {
                    std::fprintf(stderr, "query: %s %s\n", e.dbCode.c_str(), e.detail.c_str());
                    return 1;
                }
                for (size_t i = 0; i < values.size() && i < local.size(); ++i)
                    if (!it::sameValue(values[i], local[i].cells[k], sqlCols[k].type)) ++mismatches;
            }
        }
    }
    const bool same = remoteRows == static_cast<int64_t>(local.size()) && duplicates == 0 &&
                      missing == 0 && extra == 0 && mismatches == 0;
    nlohmann::json out = {{"localRows", local.size()},
                          {"remoteRows", remoteRows},
                          {"duplicates", duplicates},
                          {"missing", missing},
                          {"extra", extra},
                          {"valueMismatches", mismatches},
                          {"same", same}};
    std::printf("%s\n", out.dump().c_str());
    return same ? 0 : 1;
}

// Value of tag `k` at row `i` (time `t`): the models of the bench data, all deterministic.
double benchValue(int k, int64_t i, int64_t t) {
    const double s = static_cast<double>(t) / 1000.0;
    switch (k % 5) {
        case 0:  // sine, a different period per tag
            return 100.0 + 40.0 * std::sin(s / (300.0 + 17.0 * k));
        case 1:  // ramp that wraps
            return std::fmod(static_cast<double>(i) * 0.25 + k, 500.0);
        case 2:  // steps every 10 minutes
            return 10.0 * static_cast<double>((t / 600000 + k) % 7);
        case 3:  // counter that only goes up
            return static_cast<double>(i) * 0.5 + k * 1000.0;
        default:  // slow noise-like signal
            return 50.0 + 20.0 * std::sin(s / 97.0) * std::cos(s / 31.0 + k);
    }
}

int fillAgg(std::map<std::string, std::string>& a) {
    const std::string table = a.count("--table") ? a["--table"] : "bench";
    const std::string group = a.count("--group") ? a["--group"] : table;
    const int tags = a.count("--tags") ? std::stoi(a["--tags"]) : 24;
    const double days = a.count("--days") ? std::stod(a["--days"]) : 1.0;
    const int64_t period = a.count("--period") ? std::stoll(a["--period"]) : 5000;
    const int64_t runMs = (a.count("--run-hours") ? std::stoll(a["--run-hours"]) : 24) * 3600000LL;
    const bool withAgg = !a.count("--agg") || a["--agg"] != "0";
    const int64_t now = nowMs();
    const int64_t total = static_cast<int64_t>(days * 86400000.0);
    int64_t start = a.count("--start-ms") ? std::stoll(a["--start-ms"]) : now - total;
    start -= start % 3600000;  // a whole hour
    ::mkdir(a["--data-dir"].c_str(), 0700);
    LocalStore s(a["--data-dir"], [now] { return now; });
    std::string err;
    if (!s.open(err)) {
        std::fprintf(stderr, "open: %s\n", err.c_str());
        return 1;
    }
    TableSpec t;
    t.table = table;
    t.groupId = group;
    t.retentionDays = 3650;
    std::vector<size_t> aggCols;
    for (int k = 0; k < tags; ++k) {
        char name[16];
        std::snprintf(name, sizeof name, "%c%04d", k % 20 == 19 ? 'S' : 'T', k + 1);
        t.columns.push_back({name, k % 20 == 19 ? "INTEGER" : "REAL"});
        if (withAgg) {
            t.aggColumns.push_back(name);
            aggCols.push_back(static_cast<size_t>(k));
        }
    }
    if (withAgg) {
        t.aggMinuteDays = 3650;
        t.aggHourDays = 3650;
    }
    if (!s.ensureTables({t}, err)) {
        std::fprintf(stderr, "tables: %s\n", err.c_str());
        return 1;
    }
    std::ofstream dump;
    if (a.count("--dump")) dump.open(a["--dump"]);
    GroupAggregator agg(static_cast<size_t>(withAgg ? tags : 0));
    std::vector<PendingRow> rows;
    std::vector<AggWrite> aggs;
    std::vector<AggOut> out;
    int64_t written = 0, runStart = start, runs = 0, lastHour = start / 3600000;
    int64_t t0 = start;
    const int64_t end = start + total;
    int64_t runId = -1;
    auto flush = [&](int64_t builtTo) {
        std::vector<AggMark> marks;
        if (withAgg) marks.push_back(AggMark{0, true, builtTo, false, std::nullopt});
        if (!s.commit(rows, err, {}, aggs, marks)) {
            std::fprintf(stderr, "commit: %s\n", err.c_str());
            return false;
        }
        written += static_cast<int64_t>(rows.size());
        rows.clear();
        aggs.clear();
        return true;
    };
    std::vector<std::optional<double>> vals(static_cast<size_t>(tags));
    int64_t i = 0;
    for (int64_t ts = start; ts < end; ts += period, ++i) {
        // a new run every runMs, after a gap of 10 minutes
        if (ts == start || ts - runStart >= runMs) {
            if (runId > 0) s.touchRun(runId, ts - period, err);
            if (ts != start) {
                if (withAgg) {
                    agg.breakAll(ts - period);
                    agg.drain(out);
                    for (const auto& o : out)
                        if (o.res == kAggMinuteMs)
                            aggs.push_back({0, o.col, o.res, o.bucket, o.agg});
                    out.clear();
                }
                ts += 600000;  // the gap
            }
            runStart = ts;
            runId = s.startRun(ts, err);
            ++runs;
        }
        PendingRow r;
        r.spec = 0;
        r.ts = ts;
        std::string line;
        if (dump.is_open()) line = std::to_string(ts);
        for (int k = 0; k < tags; ++k) {
            const double v = benchValue(k, i, ts);
            if (k % 20 == 19) {
                r.cells.push_back(static_cast<int64_t>(v) % 2);
                vals[static_cast<size_t>(k)] = static_cast<double>(static_cast<int64_t>(v) % 2);
            } else {
                r.cells.push_back(v);
                vals[static_cast<size_t>(k)] = v;
            }
            if (dump.is_open()) {
                char b[40];
                std::snprintf(b, sizeof b, ",%.15g", *vals[static_cast<size_t>(k)]);
                line += b;
            }
        }
        if (dump.is_open()) dump << line << "\n";
        rows.push_back(std::move(r));
        if (withAgg) {
            agg.row(ts, vals);
            agg.drain(out);
            for (const auto& o : out)
                if (o.res == kAggMinuteMs) aggs.push_back({0, o.col, o.res, o.bucket, o.agg});
            out.clear();
            const int64_t hour = ts / 3600000;
            if (hour > lastHour) {
                for (size_t c = 0; c < static_cast<size_t>(tags); ++c) {
                    AggWrite w{0, c, kAggHourMs, lastHour * 3600000, {}, true};
                    aggs.push_back(w);
                }
                lastHour = hour;
            }
        }
        if (rows.size() >= 20000 && !flush(ts - ts % 60000)) return 1;
    }
    if (withAgg) {
        agg.breakAll(end);
        agg.drain(out);
        for (const auto& o : out)
            if (o.res == kAggMinuteMs) aggs.push_back({0, o.col, o.res, o.bucket, o.agg});
        for (int64_t h = lastHour; h <= end / 3600000; ++h)
            for (size_t c = 0; c < static_cast<size_t>(tags); ++c)
                aggs.push_back({0, c, kAggHourMs, h * 3600000, {}, true});
    }
    if (runId > 0) s.touchRun(runId, end, err);
    if (!flush(end - end % 60000)) return 1;
    std::printf(
        "{\"rows\":%lld,\"runs\":%lld,\"tags\":%d,\"startMs\":%lld,\"endMs\":%lld,\"agg\":%s}\n",
        static_cast<long long>(written), static_cast<long long>(runs), tags,
        static_cast<long long>(start), static_cast<long long>(end), withAgg ? "true" : "false");
    (void)t0;
    return 0;
}

int backfill(std::map<std::string, std::string>& a) {
    const std::string table = a.count("--table") ? a["--table"] : "bench";
    const int tags = a.count("--tags") ? std::stoi(a["--tags"]) : 24;
    const int timeoutS = a.count("--timeout-s") ? std::stoi(a["--timeout-s"]) : 3600;
    TagStore store;
    LoggingModel m;
    LoggingGroupModel g;
    g.id = table;
    g.name = table;
    g.table = table;
    g.mode = LogMode::Cyclic;
    g.periodMs = 60000;
    g.retentionDays = 3650;
    g.aggregates = AggregatesModel{3650, 3650};
    for (int k = 0; k < tags; ++k) {
        char name[16];
        std::snprintf(name, sizeof name, "%c%04d", k % 20 == 19 ? 'S' : 'T', k + 1);
        const bool isBool = k % 20 == 19;
        const size_t idx = store.add({name, isBool ? TagType::INT64 : TagType::FLOAT64, ""});
        store.set(idx, isBool ? TagScalar(int64_t{0}) : TagScalar(1.0), Quality::GOOD, 0, 0);
        g.columns.push_back({name, idx, isBool ? TagType::INT64 : TagType::FLOAT64, name, 0, 255});
    }
    m.groups.push_back(g);
    HistorianOptions opt;
    opt.dataDir = a["--data-dir"];
    opt.maxDbBytes = int64_t{1} << 40;
    opt.minFreeBytes = 0;
    opt.aggCountEveryMs = 1000;
    Historian h(m, store, opt, nowMs, monoMs);
    std::string err;
    const int64_t t0 = monoMs();
    if (!h.start(err)) {
        std::fprintf(stderr, "historian: %s\n", err.c_str());
        return 1;
    }
    int64_t maxPassMs = 0;
    bool done = false;
    while (monoMs() - t0 < int64_t{timeoutS} * 1000) {
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
        const auto s = h.status();
        if (s.aggEnabled && !s.backfillActive && monoMs() - t0 > 3000) {
            done = true;
            break;
        }
    }
    const int64_t took = monoMs() - t0;
    const auto s = h.status();
    h.stop();
    std::printf("{\"done\":%s,\"tookMs\":%lld,\"rowsMinute\":%lld,\"rowsHour\":%lld}\n",
                done ? "true" : "false", static_cast<long long>(took),
                static_cast<long long>(s.aggRowsMinute), static_cast<long long>(s.aggRowsHour));
    (void)maxPassMs;
    return done ? 0 : 1;
}

int soak(std::map<std::string, std::string>& a) {
    const double days = a.count("--days") ? std::stod(a["--days"]) : 7;
    const int tags = a.count("--tags") ? std::stoi(a["--tags"]) : 200;
    const int retention = a.count("--retention-days") ? std::stoi(a["--retention-days"]) : 3;
    const bool withAgg = !a.count("--agg") || a["--agg"] != "0";
    const int changes = a.count("--changes") ? std::stoi(a["--changes"]) : 10;
    TagStore store;
    LoggingModel m;
    LoggingGroupModel g;
    g.id = "bench";
    g.name = "bench";
    g.table = "bench";
    g.mode = LogMode::OnChange;
    g.minIntervalMs = 1000;
    g.retentionDays = retention;
    if (withAgg) g.aggregates = AggregatesModel{retention + 1, retention + 4};
    nlohmann::json logging = {{"schemaVersion", "0.6.0"},
                              {"groups", nlohmann::json::array()},
                              {"connections", nlohmann::json::array()}};
    nlohmann::json jg = {{"id", "bench"},
                         {"name", "bench"},
                         {"mode", "onChange"},
                         {"minIntervalMs", 1000},
                         {"retentionDays", retention},
                         {"tags", nlohmann::json::array()}};
    if (withAgg)
        jg["aggregates"] = {{"minuteRetentionDays", retention + 1},
                            {"hourRetentionDays", retention + 4}};
    std::map<std::string, std::string> types;
    for (int k = 0; k < tags; ++k) {
        char name[16];
        std::snprintf(name, sizeof name, "T%04d", k + 1);
        const size_t idx = store.add({name, TagType::FLOAT32, ""});
        store.set(idx, TagScalar(50.0), Quality::GOOD, 0, 0);
        g.columns.push_back({name, idx, TagType::FLOAT32, name, 0, 255});
        jg["tags"].push_back({{"tagId", name}});
        types[name] = "FLOAT32";
    }
    logging["groups"].push_back(jg);
    m.groups.push_back(g);
    int64_t wall = 1791000000000LL;
    int64_t mono = 0;
    HistorianOptions opt;
    opt.dataDir = a["--data-dir"];
    ::mkdir(opt.dataDir.c_str(), 0700);
    opt.clockFloorMs = wall - 86400000;
    opt.maxDbBytes = int64_t{1} << 40;
    opt.minFreeBytes = 0;
    opt.retentionEveryMs = 3600000;
    opt.checkEveryMs = 600000;
    opt.aggCountEveryMs = 3600000;
    if (a.count("--flush-ms")) opt.aggFlushMs = opt.aliveEveryMs = std::stoll(a["--flush-ms"]);
    Historian h(
        m, store, opt, [&] { return wall; }, [&] { return mono; });
    std::string err;
    if (!h.open(err)) {
        std::fprintf(stderr, "open: %s\n", err.c_str());
        return 1;
    }
    // ADR-039: the kernel figure when /proc/self/io exists (x64), else the bytes the SQLite VFS
    // counted (the BL335 kernel has none); both are printed.
    const bool procIo = readProcSelfIoWriteBytes().has_value();
    const auto measure = [&]() -> int64_t {
        return procIo ? readProcSelfIoWriteBytes().value_or(0) : totalDbWriteBytes();
    };
    const auto io0 = measure();
    const int64_t vfs0 = totalDbWriteBytes();
    const int64_t steps = static_cast<int64_t>(days * 864000.0);
    uint64_t lcg = 88172645463325252ULL;
    auto rnd = [&] {
        lcg = lcg * 6364136223846793005ULL + 1442695040888963407ULL;
        return static_cast<uint32_t>(lcg >> 33);
    };
    nlohmann::json daysOut = nlohmann::json::array();
    int64_t lastIo = io0;
    for (int64_t i = 0; i < steps; ++i) {
        for (int c = 0; c < changes; ++c) {
            const size_t idx = rnd() % static_cast<uint32_t>(tags);
            store.set(idx, TagScalar(static_cast<double>(rnd() % 100000) / 100.0), Quality::GOOD,
                      wall, wall);
        }
        h.runOnce();
        wall += 100;
        mono += 100;
        if ((i + 1) % 864000 == 0) {  // a simulated day
            const auto s = h.status();
            const int64_t io = measure();
            daysOut.push_back({{"day", (i + 1) / 864000},
                               {"writeBytes", io - lastIo},
                               {"dbBytes", s.dbBytes},
                               {"rowsWritten", s.rowsWritten},
                               {"rows24h", s.groups.empty() ? 0 : s.groups[0].rows24h},
                               {"aggRowsMinute", s.aggRowsMinute},
                               {"aggRowsHour", s.aggRowsHour}});
            lastIo = io;
        }
    }
    h.stop();
    const auto s = h.status();
    const int64_t ioEnd = measure();
    const int64_t vfsEnd = totalDbWriteBytes();
    const auto est = estimateLogging(logging, types);
    LocalStore ls(opt.dataDir, [&] { return wall; });
    std::string e2;
    ls.open(e2);
    const auto minTs = ls.minTs("bench");
    nlohmann::json out = {
        {"days", days},
        {"tags", tags},
        {"retentionDays", retention},
        {"aggregates", withAgg},
        {"rowsWritten", s.rowsWritten},
        {"rowsPerDayMeasured", static_cast<double>(s.rowsWritten) / days},
        {"writeBytesTotal", ioEnd - io0},
        {"writeBytesPerDay", static_cast<double>(ioEnd - io0) / days},
        {"writeSource", procIo ? "proc-self-io" : "sqlite-vfs"},
        {"sqliteVfsBytesTotal", vfsEnd - vfs0},
        {"sqliteVfsBytesPerDay", static_cast<double>(vfsEnd - vfs0) / days},
        {"estimateWriteBytesPerDay", est.writeBytesPerDay},
        {"estimateStorageBytes", est.storageBytes},
        {"dbBytes", s.dbBytes},
        {"oldestRowAgeDays", minTs ? static_cast<double>(wall - *minTs) / 86400000.0 : -1.0},
        {"aggRowsMinute", ls.aggRows(kAggMinuteMs)},
        {"aggRowsHour", ls.aggRows(kAggHourMs)},
        {"capRowsDeleted", s.capRowsDeleted},
        {"perDay", daysOut}};
    std::printf("%s\n", out.dump().c_str());
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr,
                     "usage: historian_tool fill|write-loop|count|purge|integrity|forward|verify "
                     "--data-dir D ...\n");
        return 2;
    }
    auto a = parseArgs(argc, argv);
    const std::string cmd = argv[1];
    try {
        if (cmd == "fill") return fill(a);
        if (cmd == "fill-agg") return fillAgg(a);
        if (cmd == "backfill") return backfill(a);
        if (cmd == "soak") return soak(a);
        if (cmd == "write-loop") return writeLoop(a);
        if (cmd == "count") return count(a);
        if (cmd == "purge") return purge(a);
        if (cmd == "integrity") return integrity(a);
        if (cmd == "forward") return forward(a);
        if (cmd == "verify") return verify(a);
    } catch (const std::exception& e) {
        std::fprintf(stderr, "%s: %s\n", cmd.c_str(), e.what());
        return 2;
    }
    std::fprintf(stderr, "unknown command %s\n", cmd.c_str());
    return 2;
}
