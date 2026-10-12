// Dev tool for the historian scenarios of tools/historian-it.ps1 (x64 only, never packaged).
// Columns are NAME:TYPE, TYPE a Tag type (BOOL, INT32, FLOAT64, STRING, …) or a SQLite affinity
// (REAL, INTEGER, TEXT).
//   fill       --data-dir D --group G --table T --columns … --retention DAYS
//              (--days N --period MS: rows from now−N days to now
//               | --rows N --period MS [--start-ms T]: N rows from T, default now)
//   write-loop --data-dir D --table T --columns … [--rows N] [--every MS]
//              commits N synthetic rows every MS until killed (kill -9 scenarios)
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

#include "core/historian/clock.hpp"
#include "core/historian/forward/forwarder.hpp"
#include "core/historian/forward/sql_destination.hpp"
#include "core/historian/local_store.hpp"
#include "core/historian/tests/it_support.hpp"
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
