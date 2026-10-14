#include "server/http/history_api.hpp"

#include <sys/resource.h>
#include <sys/syscall.h>
#include <unistd.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <map>
#include <set>
#include <thread>

#include "civetweb.h"
#include "core/common/json_text.hpp"
#include "core/crypto/hex.hpp"
#include "core/crypto/sha256.hpp"
#include "core/historian/clock.hpp"
#include "server/device_state.hpp"
#include "server/http/engineering_api_internal.hpp"

namespace mat {

namespace {

using nlohmann::json;
using Params = std::map<std::string, std::string>;

constexpr int64_t kDayMs = 86400000;
constexpr int64_t kMaxRangeMs = 3650 * kDayMs;

int hexValue(char x) {
    if (x >= '0' && x <= '9') return x - '0';
    if (x >= 'a' && x <= 'f') return x - 'a' + 10;
    if (x >= 'A' && x <= 'F') return x - 'A' + 10;
    return -1;
}

// name=value pairs, percent-decoded; false for a malformed escape, a repeated name or a pair
// without a name or '='.
bool parseQuery(const char* query, Params& out) {
    out.clear();
    if (!query || !*query) return true;
    const std::string q = query;
    size_t at = 0;
    for (;;) {
        size_t end = q.find('&', at);
        if (end == std::string::npos) end = q.size();
        const std::string part = q.substr(at, end - at);
        const size_t eq = part.find('=');
        if (eq == std::string::npos || eq == 0) return false;
        std::string value;
        for (size_t i = eq + 1; i < part.size(); ++i) {
            const char ch = part[i];
            if (ch == '+') {
                value += ' ';
            } else if (ch == '%') {
                if (i + 2 >= part.size()) return false;  // two hex digits needed
                const int hi = hexValue(part[i + 1]);
                const int lo = hexValue(part[i + 2]);
                if (hi < 0 || lo < 0) return false;
                value += static_cast<char>(hi * 16 + lo);
                i += 2;
            } else {
                value += ch;
            }
        }
        if (!out.emplace(part.substr(0, eq), value).second) return false;
        if (end >= q.size()) break;
        at = end + 1;
    }
    return true;
}

// ^-?[0-9]{1,15}$
bool parseInt(const std::string& s, int64_t& out) {
    size_t i = 0;
    if (!s.empty() && s[0] == '-') i = 1;
    const size_t digits = s.size() - i;
    if (digits < 1 || digits > 15) return false;
    for (size_t k = i; k < s.size(); ++k)
        if (!std::isdigit(static_cast<unsigned char>(s[k]))) return false;
    out = std::strtoll(s.c_str(), nullptr, 10);
    return true;
}

bool onlyKeys(const Params& p, const std::set<std::string>& allowed) {
    for (const auto& kv : p)
        if (!allowed.count(kv.first)) return false;
    return true;
}

std::vector<std::string> split(const std::string& s, char sep) {
    std::vector<std::string> out;
    size_t at = 0;
    for (;;) {
        const size_t e = s.find(sep, at);
        out.push_back(s.substr(at, e == std::string::npos ? std::string::npos : e - at));
        if (e == std::string::npos) break;
        at = e + 1;
    }
    return out;
}

const char* messageOf(const std::string& code) {
    static const std::map<std::string, const char*> m = {
        {"BAD_REQUEST", "Tham số không hợp lệ."},
        {"NO_HISTORY", "Dự án không có lưu trữ lịch sử."},
        {"UNKNOWN_GROUP", "Không có nhóm lưu trữ này."},
        {"UNKNOWN_TAG", "Tag không thuộc nhóm lưu trữ."},
        {"RANGE_TOO_LARGE", "Khoảng yêu cầu có quá nhiều cửa sổ hoặc hàng tổng hợp."},
        {"SCAN_LIMIT", "Khoảng thời gian quá dài để đọc dòng thô; chọn tổng hợp hoặc khoảng ngắn hơn."},
        {"NO_AGGREGATES", "Nhóm này không bật bảng tổng hợp."},
        {"EXPORT_TOO_LARGE", "Quá nhiều dòng để xuất; chọn khoảng ngắn hơn hoặc độ phân giải thấp hơn."},
        {"BUSY", "Máy chủ đang bận truy vấn khác; thử lại sau ít giây."},
        {"HISTORY_UNAVAILABLE", "Dữ liệu lưu trữ chưa sẵn sàng."},
        {"QUERY_TIMEOUT", "Truy vấn quá hạn."},
    };
    const auto it = m.find(code);
    return it == m.end() ? "Lỗi." : it->second;
}

int fail(mg_connection* c, int status, const std::string& code, bool close,
         const std::string& extra = "", json more = json::object()) {
    more["message"] = messageOf(code);
    return eapi::sendError(c, status, code, close, extra, std::move(more));
}

int statusFail(mg_connection* c, QueryStatus s, bool close) {
    switch (s) {
        case QueryStatus::NoAggregates:
            return fail(c, 422, "NO_AGGREGATES", close);
        case QueryStatus::ScanLimit:
            return fail(c, 422, "SCAN_LIMIT", close, "", {{"suggest", {{"res", "auto"}}}});
        case QueryStatus::RangeTooLarge:
            return fail(c, 422, "RANGE_TOO_LARGE", close);
        case QueryStatus::ExportTooLarge:
            return fail(c, 422, "EXPORT_TOO_LARGE", close);
        case QueryStatus::Timeout:
            return fail(c, 503, "QUERY_TIMEOUT", close);
        default:
            return fail(c, 503, "HISTORY_UNAVAILABLE", close);
    }
}

// The query on a thread of its own with nice +10: the worker thread of the request keeps its
// priority (a thread cannot lower its nice value again without privilege).
template <class F>
void runLowPriority(F fn) {
    std::thread t([&fn] {
        ::setpriority(PRIO_PROCESS, static_cast<id_t>(::syscall(SYS_gettid)), 10);
        fn();
    });
    t.join();
}

std::string sessionKey(const GateRequest& r, const GateDecision& d) {
    if (d.viaCookie && !d.webToken.empty()) return toHex(sha256(d.webToken));
    if (r.authorization) {
        const std::string& h = *r.authorization;
        const size_t sp = h.find(' ');
        return toHex(sha256(sp == std::string::npos ? h : h.substr(sp + 1)));
    }
    return "";
}

json numOrNull(const std::optional<double>& v) {
    return v && std::isfinite(*v) ? json(*v) : json(nullptr);
}

json tagInfo(const QueryTag& t) {
    return {{"tagId", t.tagId}, {"column", t.column}, {"type", t.type}, {"unit", t.unit}};
}

struct Common {
    const QueryGroup* group = nullptr;
    std::vector<size_t> tags;
    int64_t from = 0;
    int64_t to = 0;
};

}  // namespace

HistoryApi::HistoryApi(Options opt)
    : opt_(std::move(opt)),
      pool_(ReaderPool::Options{opt_.dbPath, opt_.cacheKiB, 3, 60000, {}}),
      limiter_(opt_.maxConcurrent) {}

int HistoryApi::handle(mg_connection* c, const GateRequest& r, const GateDecision& d, bool close) {
    const std::string path = d.rule->path;
    if (path == "/api/v1/history/catalog") return catalogJson(c, close);
    if (!opt_.enabled || opt_.catalog.groups.empty()) return fail(c, 404, "NO_HISTORY", close);
    if (path == "/api/v1/history/series") return series(c, r, d, close);
    if (path == "/api/v1/history/aggregate") return aggregate(c, r, d, close);
    if (path == "/api/v1/history/rows") return rows(c, r, d, close);
    if (path == "/api/v1/history/export.csv") return exportCsv(c, r, d, close);
    return fail(c, 404, "NO_HISTORY", close);
}

// ---------------------------------------------------------------- catalog

int HistoryApi::catalogJson(mg_connection* c, bool close) {
    json body = {{"apiVersion", kDeviceApiVersion},
                 {"enabled", opt_.enabled && !opt_.catalog.groups.empty()},
                 {"state", opt_.state ? opt_.state() : "running"},
                 {"limits",
                  {{"maxTags", 16},
                   {"maxRowsTags", 32},
                   {"maxPoints", 5000},
                   {"defaultMaxPoints", 1000},
                   {"maxBuckets", kMaxAggregateWindows},
                   {"maxRows", 500},
                   {"maxExportRows", 500000},
                   {"maxRangeDays", 3650},
                   {"maxConcurrent", opt_.maxConcurrent},
                   {"timeoutMs", opt_.timeoutMs},
                   {"maxScanMiB", opt_.maxScanMiB}}},
                 {"groups", json::array()}};
    if (!body["enabled"].get<bool>()) return eapi::send(c, 200, jsonText(body), close);
    std::string err;
    auto lease = pool_.acquire(pool_.now() + opt_.timeoutMs, nullptr, err);
    for (const auto& g : opt_.catalog.groups) {
        json gj = {{"id", g.id},
                   {"name", g.name},
                   {"mode", g.mode},
                   {"timeZone", formatUtcOffset(g.offsetMin)},
                   {"periodMs", g.periodMs > 0 ? json(g.periodMs) : json(nullptr)},
                   {"minIntervalMs", g.minIntervalMs},
                   {"maxIntervalMs", g.maxIntervalMs > 0 ? json(g.maxIntervalMs) : json(nullptr)},
                   {"raw", nullptr},
                   {"aggregates", nullptr},
                   {"tags", json::array()}};
        for (const auto& t : g.tags) {
            json tj = tagInfo(t);
            tj["aggregated"] = t.aggregated;
            tj["orphan"] = false;
            gj["tags"].push_back(std::move(tj));
        }
        if (lease) {
            sqlite3* db = lease->db();
            sqlite3_stmt* st = nullptr;
            const std::string tbl = quoteIdent("log_" + g.table);
            if (sqlite3_prepare_v2(db, ("SELECT min(ts), max(ts) FROM " + tbl).c_str(), -1, &st,
                                   nullptr) == SQLITE_OK) {
                if (sqlite3_step(st) == SQLITE_ROW && sqlite3_column_type(st, 0) != SQLITE_NULL)
                    gj["raw"] = {{"from", sqlite3_column_int64(st, 0)},
                                 {"to", sqlite3_column_int64(st, 1)}};
                sqlite3_finalize(st);
            }
            if (g.hasAggregates) {
                json agg = {{"minute", nullptr}, {"hour", nullptr}};
                for (const auto& res : {std::make_pair("minute", 60000), std::make_pair("hour", 3600000)}) {
                    if (sqlite3_prepare_v2(db,
                                           "SELECT min(bucket), max(bucket) FROM mat_agg WHERE res "
                                           "= ? AND cid = (SELECT min(cid) FROM mat_agg_cols WHERE "
                                           "tbl = ?)",
                                           -1, &st, nullptr) != SQLITE_OK)
                        continue;
                    sqlite3_bind_int(st, 1, res.second);
                    sqlite3_bind_text(st, 2, g.table.c_str(), -1, SQLITE_TRANSIENT);
                    if (sqlite3_step(st) == SQLITE_ROW && sqlite3_column_type(st, 0) != SQLITE_NULL)
                        agg[res.first] = {{"from", sqlite3_column_int64(st, 0)},
                                          {"to", sqlite3_column_int64(st, 1) + res.second}};
                    sqlite3_finalize(st);
                }
                gj["aggregates"] = agg;
            }
        }
        body["groups"].push_back(std::move(gj));
    }
    return eapi::send(c, 200, jsonText(body), close);
}

// ---------------------------------------------------------------- shared parameter checks

namespace {

// group, tags, from, to; fills `out`. Returns 0 when fine, else the HTTP status already sent.
int commonParams(mg_connection* c, const HistoryCatalog& cat, const Params& p, bool tagsRequired,
                 size_t maxTags, bool allowStrings, bool close, Common& out) {
    const auto g = p.find("group");
    const auto f = p.find("from");
    const auto t = p.find("to");
    if (g == p.end() || f == p.end() || t == p.end() || (tagsRequired && !p.count("tags")))
        return fail(c, 400, "BAD_REQUEST", close);
    if (!parseInt(f->second, out.from) || !parseInt(t->second, out.to) || out.from >= out.to ||
        out.to - out.from > kMaxRangeMs || out.from < 0)
        return fail(c, 400, "BAD_REQUEST", close);
    out.group = cat.find(g->second);
    if (!out.group) return fail(c, 404, "UNKNOWN_GROUP", close);
    if (p.count("tags")) {
        const auto names = split(p.at("tags"), ',');
        if (names.empty() || names.size() > maxTags) return fail(c, 400, "BAD_REQUEST", close);
        std::set<std::string> seen;
        for (const auto& n : names) {
            if (!seen.insert(n).second) return fail(c, 400, "BAD_REQUEST", close);
            const int idx = out.group->indexOfTag(n);
            if (idx < 0) return fail(c, 404, "UNKNOWN_TAG", close);
            if (!allowStrings && !out.group->tags[static_cast<size_t>(idx)].numeric())
                return fail(c, 400, "BAD_REQUEST", close);
            out.tags.push_back(static_cast<size_t>(idx));
        }
    } else {
        for (size_t i = 0; i < out.group->tags.size() && out.tags.size() < maxTags; ++i)
            if (allowStrings || out.group->tags[i].numeric()) out.tags.push_back(i);
    }
    return 0;
}

}  // namespace

// ---------------------------------------------------------------- series

int HistoryApi::series(mg_connection* c, const GateRequest& r, const GateDecision& d, bool close) {
    Params p;
    if (!parseQuery(mg_get_request_info(c)->query_string, p) ||
        !onlyKeys(p, {"group", "tags", "from", "to", "maxPoints", "res", "reduce"}))
        return fail(c, 400, "BAD_REQUEST", close);
    Common cm;
    if (const int s = commonParams(c, opt_.catalog, p, true, 16, false, close, cm)) return s;
    SeriesParams sp;
    sp.group = cm.group;
    sp.tags = cm.tags;
    sp.from = cm.from;
    sp.to = cm.to;
    sp.scanLimitBytes = static_cast<int64_t>(opt_.maxScanMiB) << 20;
    if (p.count("maxPoints")) {
        int64_t mp = 0;
        if (!parseInt(p["maxPoints"], mp) || mp < 10 || mp > 5000)
            return fail(c, 400, "BAD_REQUEST", close);
        sp.maxPoints = static_cast<int>(mp);
    }
    if (p.count("res")) {
        const std::string& v = p["res"];
        if (v == "auto") sp.res = ResParam::Auto;
        else if (v == "raw") sp.res = ResParam::Raw;
        else if (v == "1m") sp.res = ResParam::Minute;
        else if (v == "1h") sp.res = ResParam::Hour;
        else return fail(c, 400, "BAD_REQUEST", close);
    }
    if (p.count("reduce")) {
        const std::string& v = p["reduce"];
        if (v == "minmax") sp.reduce = ReduceParam::MinMax;
        else if (v == "lttb") sp.reduce = ReduceParam::Lttb;
        else if (v == "decimate") sp.reduce = ReduceParam::Decimate;
        else return fail(c, 400, "BAD_REQUEST", close);
    }
    auto ticket = limiter_.tryAcquire(QueryLimiter::Kind::Query, sessionKey(r, d));
    if (!ticket) return fail(c, 429, "BUSY", close, "Retry-After: 2\r\n");
    std::string err;
    auto lease = pool_.acquire(pool_.now() + opt_.timeoutMs, nullptr, err);
    if (!lease) {
        if (err == "busy") return fail(c, 429, "BUSY", close, "Retry-After: 2\r\n");
        limiter_.recordError("HISTORY_UNAVAILABLE", opt_.nowUtc ? opt_.nowUtc() : 0);
        return fail(c, 503, "HISTORY_UNAVAILABLE", close);
    }
    SeriesResult res;
    runLowPriority([&] { res = querySeries(*lease, sp); });
    if (res.status != QueryStatus::Ok) {
        if (res.status == QueryStatus::ScanLimit) limiter_.recordRejectedLimit();
        else if (res.status == QueryStatus::Timeout) limiter_.recordTimeout(opt_.nowUtc ? opt_.nowUtc() : 0);
        else if (res.status == QueryStatus::Unavailable) limiter_.recordError("HISTORY_UNAVAILABLE", opt_.nowUtc ? opt_.nowUtc() : 0);
        return statusFail(c, res.status, close);
    }
    limiter_.recordServed(res.elapsedMs);
    json body = {{"apiVersion", kDeviceApiVersion},
                 {"group", cm.group->id},
                 {"timeZone", formatUtcOffset(cm.group->offsetMin)},
                 {"from", cm.from},
                 {"to", cm.to},
                 {"res", sourceResName(res.res)},
                 {"reduce", res.reduce},
                 {"approximate", res.approximate},
                 {"maxPoints", sp.maxPoints},
                 {"coverage", res.coverage ? json{{"from", res.coverage->from}, {"to", res.coverage->to}}
                                           : json(nullptr)},
                 {"gaps", json::array()},
                 {"series", json::array()},
                 {"stats", {{"source", res.res == SourceRes::Raw ? "log" : "mat_agg"},
                            {"rowsRead", res.rowsRead},
                            {"elapsedMs", res.elapsedMs}}}};
    for (const auto& g : res.gaps) body["gaps"].push_back({g.from, g.to});
    for (const auto& line : res.lines) {
        json s = tagInfo(cm.group->tags[line.tag]);
        s["t"] = line.t;
        json v = json::array();
        for (const auto& x : line.v) v.push_back(numOrNull(x));
        s["v"] = v;
        if (res.res != SourceRes::Raw) {
            s["min"] = line.min;
            s["max"] = line.max;
        }
        body["series"].push_back(std::move(s));
    }
    return eapi::send(c, 200, jsonText(body), close);
}

// ---------------------------------------------------------------- aggregate

int HistoryApi::aggregate(mg_connection* c, const GateRequest& r, const GateDecision& d, bool close) {
    Params p;
    if (!parseQuery(mg_get_request_info(c)->query_string, p) ||
        !onlyKeys(p, {"group", "tags", "from", "to", "bucketMs", "offsetMs"}) ||
        !p.count("bucketMs"))
        return fail(c, 400, "BAD_REQUEST", close);
    Common cm;
    if (const int s = commonParams(c, opt_.catalog, p, true, 16, false, close, cm)) return s;
    AggregateParams ap;
    ap.group = cm.group;
    ap.tags = cm.tags;
    ap.from = cm.from;
    ap.to = cm.to;
    if (!parseInt(p["bucketMs"], ap.bucketMs) || ap.bucketMs < 60000 || ap.bucketMs > 2678400000LL ||
        ap.bucketMs % 60000 != 0)
        return fail(c, 400, "BAD_REQUEST", close);
    if (p.count("offsetMs") &&
        (!parseInt(p["offsetMs"], ap.offsetMs) || ap.offsetMs < 0 || ap.offsetMs >= ap.bucketMs ||
         ap.offsetMs % 60000 != 0))
        return fail(c, 400, "BAD_REQUEST", close);
    auto ticket = limiter_.tryAcquire(QueryLimiter::Kind::Query, sessionKey(r, d));
    if (!ticket) return fail(c, 429, "BUSY", close, "Retry-After: 2\r\n");
    std::string err;
    auto lease = pool_.acquire(pool_.now() + opt_.timeoutMs, nullptr, err);
    if (!lease) {
        if (err == "busy") return fail(c, 429, "BUSY", close, "Retry-After: 2\r\n");
        return fail(c, 503, "HISTORY_UNAVAILABLE", close);
    }
    AggregateResult res;
    runLowPriority([&] { res = queryAggregate(*lease, ap); });
    if (res.status != QueryStatus::Ok) {
        if (res.status == QueryStatus::RangeTooLarge) limiter_.recordRejectedLimit();
        else if (res.status == QueryStatus::Timeout) limiter_.recordTimeout(opt_.nowUtc ? opt_.nowUtc() : 0);
        return statusFail(c, res.status, close);
    }
    limiter_.recordServed(res.elapsedMs);
    json body = {{"apiVersion", kDeviceApiVersion},
                 {"group", cm.group->id},
                 {"timeZone", formatUtcOffset(cm.group->offsetMin)},
                 {"from", cm.from},
                 {"to", cm.to},
                 {"bucketMs", ap.bucketMs},
                 {"offsetMs", ap.offsetMs},
                 {"start", res.start},
                 {"count", res.count},
                 {"source", res.source},
                 {"series", json::array()},
                 {"stats", {{"source", "mat_agg"}, {"rowsRead", res.rowsRead}, {"elapsedMs", res.elapsedMs}}}};
    for (size_t i = 0; i < res.tags.size(); ++i) {
        json s = tagInfo(cm.group->tags[res.tags[i]]);
        json n = json::array(), mn = json::array(), mx = json::array(), fi = json::array(),
             la = json::array(), sw = json::array(), wm = json::array(), av = json::array(),
             su = json::array();
        for (const auto& b : res.buckets[i]) {
            n.push_back(b.n);
            wm.push_back(b.wms);
            if (b.empty()) {
                for (json* a : {&mn, &mx, &fi, &la, &sw, &av, &su}) a->push_back(nullptr);
            } else {
                mn.push_back(b.min);
                mx.push_back(b.max);
                fi.push_back(b.first);
                la.push_back(b.last);
                sw.push_back(b.sumw);
                av.push_back(numOrNull(aggAvg(b)));
                su.push_back(numOrNull(aggSum(b)));
            }
        }
        s["n"] = n; s["min"] = mn; s["max"] = mx; s["first"] = fi; s["last"] = la;
        s["sumw"] = sw; s["wms"] = wm; s["avg"] = av; s["sum"] = su;
        body["series"].push_back(std::move(s));
    }
    return eapi::send(c, 200, jsonText(body), close);
}

// ---------------------------------------------------------------- rows

int HistoryApi::rows(mg_connection* c, const GateRequest& r, const GateDecision& d, bool close) {
    Params p;
    if (!parseQuery(mg_get_request_info(c)->query_string, p) ||
        !onlyKeys(p, {"group", "tags", "from", "to", "limit", "order", "after"}))
        return fail(c, 400, "BAD_REQUEST", close);
    Common cm;
    if (const int s = commonParams(c, opt_.catalog, p, false, 32, true, close, cm)) return s;
    RowsParams rp;
    rp.group = cm.group;
    rp.tags = cm.tags;
    rp.from = cm.from;
    rp.to = cm.to;
    if (p.count("limit")) {
        int64_t l = 0;
        if (!parseInt(p["limit"], l) || l < 1 || l > 500) return fail(c, 400, "BAD_REQUEST", close);
        rp.limit = static_cast<int>(l);
    }
    if (p.count("order")) {
        if (p["order"] == "asc") rp.descending = false;
        else if (p["order"] == "desc") rp.descending = true;
        else return fail(c, 400, "BAD_REQUEST", close);
    }
    if (p.count("after")) {
        int64_t a = 0;
        if (!parseInt(p["after"], a) || a < 0) return fail(c, 400, "BAD_REQUEST", close);
        rp.after = a;
    }
    auto ticket = limiter_.tryAcquire(QueryLimiter::Kind::Query, sessionKey(r, d));
    if (!ticket) return fail(c, 429, "BUSY", close, "Retry-After: 2\r\n");
    std::string err;
    auto lease = pool_.acquire(pool_.now() + opt_.timeoutMs, nullptr, err);
    if (!lease) {
        if (err == "busy") return fail(c, 429, "BUSY", close, "Retry-After: 2\r\n");
        return fail(c, 503, "HISTORY_UNAVAILABLE", close);
    }
    RowsResult res;
    runLowPriority([&] { res = queryRows(*lease, rp); });
    if (res.status != QueryStatus::Ok) {
        if (res.status == QueryStatus::Timeout) limiter_.recordTimeout(opt_.nowUtc ? opt_.nowUtc() : 0);
        return statusFail(c, res.status, close);
    }
    limiter_.recordServed(res.elapsedMs);
    json body = {{"group", cm.group->id},
                 {"timeZone", formatUtcOffset(cm.group->offsetMin)},
                 {"order", rp.descending ? "desc" : "asc"},
                 {"columns", json::array()},
                 {"rows", json::array()},
                 {"next", res.next ? json(*res.next) : json(nullptr)}};
    for (size_t t : cm.tags) {
        json col = tagInfo(cm.group->tags[t]);
        col.erase("unit");
        body["columns"].push_back(col);
    }
    for (const auto& row : res.rows) {
        json jr = json::array({row.seq, row.ts});
        for (const auto& cell : row.cells) {
            if (const auto* i = std::get_if<int64_t>(&cell)) jr.push_back(*i);
            else if (const auto* dd = std::get_if<double>(&cell)) jr.push_back(std::isfinite(*dd) ? json(*dd) : json(nullptr));
            else if (const auto* s = std::get_if<std::string>(&cell)) jr.push_back(*s);
            else jr.push_back(nullptr);
        }
        body["rows"].push_back(std::move(jr));
    }
    return eapi::send(c, 200, jsonText(body), close);
}

// ---------------------------------------------------------------- export.csv

namespace {
std::string safeFileName(const std::string& s) {
    std::string out;
    for (char ch : s) out += (std::strchr("\\/:*?\"<>| ", ch) || static_cast<unsigned char>(ch) < 32) ? '-' : ch;
    return out;
}
}  // namespace

int HistoryApi::exportCsv(mg_connection* c, const GateRequest& r, const GateDecision& d, bool close) {
    Params p;
    if (!parseQuery(mg_get_request_info(c)->query_string, p) ||
        !onlyKeys(p, {"group", "tags", "from", "to", "res", "fields", "bom"}))
        return fail(c, 400, "BAD_REQUEST", close);
    Common cm;
    if (const int s = commonParams(c, opt_.catalog, p, false, 1000, true, close, cm)) return s;
    ExportParams ep;
    ep.group = cm.group;
    ep.tags = cm.tags;
    ep.from = cm.from;
    ep.to = cm.to;
    if (p.count("res")) {
        const std::string& v = p["res"];
        if (v == "raw") ep.res = ResParam::Raw;
        else if (v == "1m") ep.res = ResParam::Minute;
        else if (v == "1h") ep.res = ResParam::Hour;
        else return fail(c, 400, "BAD_REQUEST", close);
    }
    if (p.count("fields")) {
        static const std::set<std::string> ok = {"min", "max", "avg", "first", "last", "sum", "count"};
        for (const auto& f : split(p["fields"], ','))
            if (!ok.count(f)) return fail(c, 400, "BAD_REQUEST", close);
            else ep.fields.push_back(f);
    }
    if (p.count("bom")) {
        if (p["bom"] == "1") ep.bom = true;
        else if (p["bom"] == "0") ep.bom = false;
        else return fail(c, 400, "BAD_REQUEST", close);
    }
    auto ticket = limiter_.tryAcquire(QueryLimiter::Kind::Export, sessionKey(r, d));
    if (!ticket) return fail(c, 429, "BUSY", close, "Retry-After: 2\r\n");
    std::string err;
    auto lease = pool_.acquire(pool_.now() + opt_.exportTimeoutMs, nullptr, err);
    if (!lease) {
        if (err == "busy") return fail(c, 429, "BUSY", close, "Retry-After: 2\r\n");
        return fail(c, 503, "HISTORY_UNAVAILABLE", close);
    }
    ExportInfo info;
    runLowPriority([&] { info = estimateExport(*lease, ep); });
    if (info.status != QueryStatus::Ok) {
        if (info.status == QueryStatus::ExportTooLarge) limiter_.recordRejectedLimit();
        return statusFail(c, info.status, close);
    }
    const std::string name = safeFileName(cm.group->id) + "_" + std::to_string(cm.from) + "_" +
                             std::to_string(cm.to) + ".csv";
    mg_printf(c,
              "HTTP/1.1 200 OK\r\nContent-Type: text/csv; charset=utf-8\r\nContent-Disposition: "
              "attachment; filename=\"%s\"\r\nCache-Control: no-store\r\nX-Content-Type-Options: "
              "nosniff\r\nTransfer-Encoding: chunked\r\n%s\r\n",
              name.c_str(), close ? "Connection: close\r\n" : "");
    const int64_t t0 = pool_.now();
    bool writeOk = true;
    int64_t rowsOut = 0;
    QueryStatus st = QueryStatus::Ok;
    runLowPriority([&] {
        st = ::mat::exportCsv(*lease, ep,
                       [&](const std::string& chunk) {
                           char head[24];
                           const int n = std::snprintf(head, sizeof head, "%zx\r\n", chunk.size());
                           if (mg_write(c, head, static_cast<size_t>(n)) <= 0 ||
                               mg_write(c, chunk.data(), chunk.size()) <= 0 ||
                               mg_write(c, "\r\n", 2) <= 0) {
                               writeOk = false;
                               return false;
                           }
                           return true;
                       },
                       rowsOut);
    });
    const bool complete = st == QueryStatus::Ok && writeOk;
    if (complete) mg_write(c, "0\r\n\r\n", 5);  // no terminator on a failure: an incomplete file
    else mg_disable_connection_keep_alive(c);
    limiter_.recordServed(pool_.now() - t0);
    if (st == QueryStatus::Timeout) limiter_.recordTimeout(opt_.nowUtc ? opt_.nowUtc() : 0);
    if (opt_.audit) {
        AuditEvent e(AuditAction::HistoryExport, complete ? AuditResult::Ok : AuditResult::Failed,
                     d.viaCookie ? AuditChannel::Web : AuditChannel::Https, r.from.text());
        e.user = d.access.user;
        e.target = cm.group->id;
        if (!complete) e.code = st == QueryStatus::Timeout ? "timeout" : "aborted";
        e.detail = jsonText({{"group", cm.group->id},
                             {"from", cm.from},
                             {"to", cm.to},
                             {"res", ep.res == ResParam::Raw ? "raw" : ep.res == ResParam::Minute ? "1m" : "1h"},
                             {"rows", rowsOut}});
        try {
            opt_.audit(e);
        } catch (const std::exception&) {
        }
    }
    return 200;
}

}  // namespace mat
