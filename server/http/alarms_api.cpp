#include "server/http/alarms_api.hpp"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <set>

#include "civetweb.h"
#include "core/alarm/alarm_text.hpp"
#include "core/common/json_limits.hpp"
#include "core/common/json_text.hpp"
#include "core/common/utf8.hpp"
#include "core/crypto/hex.hpp"
#include "core/crypto/sha256.hpp"

namespace mat {

namespace alarmsapi {

using nlohmann::json;

namespace {

constexpr int kMaxBodyDepth = 8;
constexpr size_t kMaxAckItems = 100;

AlarmApiResult badRequest(const std::string& why) {
    return {400, {{"error", "BAD_REQUEST"}, {"message", "Yêu cầu không hợp lệ: " + why}}};
}

AlarmApiResult badQuery(const std::string& field, const std::string& why) {
    return {400, {{"error", "BAD_QUERY"}, {"field", field}, {"message", why}}};
}

bool onlyKeys(const json& o, std::initializer_list<const char*> keys) {
    for (auto it = o.begin(); it != o.end(); ++it) {
        bool known = false;
        for (const char* k : keys) known = known || it.key() == k;
        if (!known) return false;
    }
    return true;
}

bool isInt(const json& v) { return v.is_number_integer() || v.is_number_unsigned(); }

int priorityFromName(const std::string& s) {
    const auto p = alarm::parsePriority(s);
    return p ? static_cast<int>(*p) : 0;
}

bool simpleId(const std::string& s) {  // an area or a class id
    if (s.empty() || s.size() > 32) return false;
    for (unsigned char c : s)
        if (!std::isalnum(c) && c != '_' && c != '-') return false;
    return true;
}

// Decodes %XX and + (a query string is form encoded). false: a broken escape or a result that is
// not UTF-8.
bool urlDecode(const std::string& in, std::string& out) {
    out.clear();
    auto hex = [](char h) -> int {
        if (h >= '0' && h <= '9') return h - '0';
        if (h >= 'a' && h <= 'f') return h - 'a' + 10;
        if (h >= 'A' && h <= 'F') return h - 'A' + 10;
        return -1;
    };
    for (size_t i = 0; i < in.size(); ++i) {
        const char c = in[i];
        if (c == '+') {
            out += ' ';
        } else if (c == '%') {
            if (i + 2 >= in.size()) return false;
            const int a = hex(in[i + 1]), b = hex(in[i + 2]);
            if (a < 0 || b < 0) return false;
            out += static_cast<char>(a * 16 + b);
            i += 2;
        } else {
            out += c;
        }
    }
    return isValidUtf8(out);
}

bool parseInt64(const std::string& s, int64_t& out) {
    if (s.empty() || s.size() > 18) return false;
    int64_t v = 0;
    for (char c : s) {
        if (c < '0' || c > '9') return false;
        v = v * 10 + (c - '0');
    }
    out = v;
    return true;
}

}  // namespace

bool validInstanceId(const std::string& s) {
    std::string base = s;
    const size_t dot = s.find('.');
    if (dot != std::string::npos) {
        const std::string limit = s.substr(dot + 1);
        if (limit != "HH" && limit != "H" && limit != "L" && limit != "LL") return false;
        base = s.substr(0, dot);
    }
    if (base.size() < 2 || base.size() > 48 || !std::isalpha(static_cast<unsigned char>(base[0])) ||
        !(base[0] < 0x80))
        return false;
    for (unsigned char c : base)
        if (!(std::isalnum(c) && c < 0x80) && c != '_') return false;
    return true;
}

std::optional<AlarmApiResult> parseHistoryQuery(const std::string& rawQuery, int64_t nowMs,
                                                alarm::HistoryQuery& out) {
    out = alarm::HistoryQuery{};
    if (rawQuery.size() > kMaxQueryStringBytes) return badQuery("query", "Chuỗi truy vấn quá dài");
    std::map<std::string, std::string> params;
    size_t pos = 0;
    while (pos <= rawQuery.size() && !rawQuery.empty()) {
        size_t amp = rawQuery.find('&', pos);
        if (amp == std::string::npos) amp = rawQuery.size();
        const std::string pair = rawQuery.substr(pos, amp - pos);
        pos = amp + 1;
        if (pair.empty()) continue;
        const size_t eq = pair.find('=');
        std::string name, value;
        if (!urlDecode(pair.substr(0, eq), name) ||
            (eq != std::string::npos && !urlDecode(pair.substr(eq + 1), value)))
            return badQuery(pair.substr(0, eq).substr(0, 40), "Chuỗi truy vấn không giải mã được");
        if (!params.emplace(name, value).second) return badQuery(name, "Tham số bị lặp");
    }
    static const std::set<std::string> kKnown = {"from",  "to",       "alarmId", "area",
                                                 "class", "priority", "state",   "q",
                                                 "limit", "beforeId", "unsynced"};
    for (const auto& kv : params)
        if (!kKnown.count(kv.first))
            return badQuery(kv.first.substr(0, 40), "Tham số không được hỗ trợ");

    auto get = [&](const char* k) -> const std::string* {
        auto it = params.find(k);
        return it == params.end() ? nullptr : &it->second;
    };
    int64_t v = 0;
    std::optional<int64_t> from, to;
    if (const auto* s = get("from")) {
        if (!parseInt64(*s, v)) return badQuery("from", "from phải là số nguyên ms UTC");
        from = v;
    }
    if (const auto* s = get("to")) {
        if (!parseInt64(*s, v)) return badQuery("to", "to phải là số nguyên ms UTC");
        to = v;
    }
    out.toMs = to ? *to : nowMs;
    out.fromMs = from ? *from : out.toMs - 24LL * 3600 * 1000;
    if (const auto* s = get("alarmId")) {
        if (!validInstanceId(*s)) return badQuery("alarmId", "alarmId không đúng dạng");
        out.alarmId = *s;
    }
    if (const auto* s = get("area")) {
        if (*s == "-") {
            out.area = "";
        } else if (simpleId(*s)) {
            out.area = *s;
        } else {
            return badQuery("area", "area không đúng dạng");
        }
    }
    if (const auto* s = get("class")) {
        if (!simpleId(*s)) return badQuery("class", "class không đúng dạng");
        out.classId = *s;
    }
    if (const auto* s = get("priority")) {
        const int p = priorityFromName(*s);
        if (p == 0)
            return badQuery("priority", "priority phải là critical, major, minor hoặc advisory");
        out.priority = p;
    }
    if (const auto* s = get("state")) {
        if (*s != "active" && *s != "acked" && *s != "closed" && *s != "all")
            return badQuery("state", "state phải là active, acked, closed hoặc all");
        out.state = *s;
    }
    if (const auto* s = get("q")) out.q = *s;
    if (const auto* s = get("limit")) {
        if (!parseInt64(*s, v) || v < 1 || v > alarm::kMaxHistoryLimit)
            return badQuery("limit", "limit phải từ 1 đến 500");
        out.limit = static_cast<int>(v);
    }
    if (const auto* s = get("beforeId")) {
        if (!parseInt64(*s, v) || v < 1)
            return badQuery("beforeId", "beforeId phải là số nguyên ≥ 1");
        out.beforeId = v;
    }
    if (const auto* s = get("unsynced")) {
        if (*s != "0" && *s != "1") return badQuery("unsynced", "unsynced phải là 0 hoặc 1");
        out.unsynced = *s == "1";
    }
    const alarm::HistoryResult check = alarm::validateHistoryQuery(out);
    if (check.status != alarm::HistoryStatus::Ok) return badQuery(check.field, check.message);
    return std::nullopt;
}

// ---------------------------------------------------------------------------------------------

AlarmApiResult post(const std::string& verb, const std::string& body, AlarmGlue& glue,
                    const AlarmActor& who) {
    if (jsonNestingDepth(body.data(), body.size()) > kMaxBodyDepth)
        return badRequest("JSON lồng quá sâu");
    const json j = json::parse(body, nullptr, false);
    if (!j.is_object()) return badRequest("thân phải là JSON object");

    auto idOf = [&](std::string& id) {
        if (!j.contains("id") || !j["id"].is_string()) return false;
        id = j["id"].get<std::string>();
        return validInstanceId(id);
    };

    if (verb == "ack") {
        if (!onlyKeys(j, {"items", "all", "upToRevision", "filter"})) return badRequest("khóa lạ");
        AckSpec spec;
        const bool hasItems = j.contains("items"), hasAll = j.contains("all");
        if (hasItems == hasAll) return badRequest("cần đúng một trong items hoặc all");
        if (hasItems) {
            if (j.contains("upToRevision") || j.contains("filter"))
                return badRequest("upToRevision và filter chỉ đi với all");
            const json& items = j["items"];
            if (!items.is_array() || items.empty() || items.size() > kMaxAckItems)
                return badRequest("items phải có 1 đến 100 phần tử");
            std::set<std::string> seen;
            for (const json& it : items) {
                if (!it.is_object() || !onlyKeys(it, {"id", "occurrence"}) || !it.contains("id") ||
                    !it["id"].is_string() || !it.contains("occurrence") || !isInt(it["occurrence"]))
                    return badRequest("mỗi phần tử cần id và occurrence");
                const std::string id = it["id"].get<std::string>();
                const int64_t occ = it["occurrence"].is_number_unsigned()
                                        ? static_cast<int64_t>(std::min<uint64_t>(
                                              it["occurrence"].get<uint64_t>(), INT64_MAX))
                                        : it["occurrence"].get<int64_t>();
                if (!validInstanceId(id) || occ < 1) return badRequest("id hoặc occurrence sai");
                if (!seen.insert(id).second) return badRequest("id bị lặp trong items");
                spec.items.push_back({id, occ});
            }
        } else {
            if (!j["all"].is_boolean() || !j["all"].get<bool>())
                return badRequest("all phải là true");
            if (!j.contains("upToRevision") || !isInt(j["upToRevision"]) ||
                j["upToRevision"].get<int64_t>() < 0)
                return badRequest("all cần upToRevision là số nguyên ≥ 0");
            spec.all = true;
            spec.upToRevision = j["upToRevision"].get<int64_t>();
            if (j.contains("filter")) {
                const json& f = j["filter"];
                if (!f.is_object() ||
                    !onlyKeys(f, {"areas", "classes", "priorities", "states", "q"}))
                    return badRequest("filter sai");
                auto strings = [&](const char* key, size_t max, std::vector<std::string>& dst) {
                    if (!f.contains(key)) return true;
                    if (!f[key].is_array() || f[key].size() > max) return false;
                    for (const json& s : f[key]) {
                        if (!s.is_string()) return false;
                        dst.push_back(s.get<std::string>());
                    }
                    return true;
                };
                if (!strings("areas", 64, spec.areas) || !strings("classes", 16, spec.classes))
                    return badRequest("filter.areas hoặc filter.classes sai");
                for (const auto& a : spec.areas)
                    if (a != "-" && !simpleId(a)) return badRequest("filter.areas có id sai");
                for (const auto& c : spec.classes)
                    if (!simpleId(c)) return badRequest("filter.classes có id sai");
                std::vector<std::string> pri;
                if (!strings("priorities", 4, pri)) return badRequest("filter.priorities sai");
                for (const auto& p : pri) {
                    const int n = priorityFromName(p);
                    if (n == 0) return badRequest("filter.priorities có mức lạ");
                    spec.priorities.push_back(n);
                }
                if (!strings("states", 2, spec.states)) return badRequest("filter.states sai");
                for (const auto& s : spec.states)
                    if (s != "ACTIVE_UNACK" && s != "RTN_UNACK")
                        return badRequest("filter.states có giá trị lạ");
                if (f.contains("q")) {
                    if (!f["q"].is_string()) return badRequest("filter.q phải là chuỗi");
                    spec.q = f["q"].get<std::string>();
                    if (alarm::utf8Length(spec.q) > 80)
                        return badRequest("filter.q tối đa 80 ký tự");
                }
            }
        }
        return glue.ack(spec, who);
    }

    std::string id;
    if (verb == "shelve") {
        if (!onlyKeys(j, {"id", "reason", "durationS"})) return badRequest("khóa lạ");
        if (!idOf(id)) return badRequest("id sai");
        if (!j.contains("reason") || !j["reason"].is_string())
            return badRequest("reason phải là chuỗi");
        if (!j.contains("durationS") || !isInt(j["durationS"]))
            return badRequest("durationS phải là số nguyên");
        const int64_t d = j["durationS"].is_number_unsigned()
                              ? static_cast<int64_t>(
                                    std::min<uint64_t>(j["durationS"].get<uint64_t>(), INT64_MAX))
                              : j["durationS"].get<int64_t>();
        return glue.shelve(id, j["reason"].get<std::string>(), d, who);
    }
    if (verb == "unshelve" || verb == "enable") {
        if (!onlyKeys(j, {"id"})) return badRequest("khóa lạ");
        if (!idOf(id)) return badRequest("id sai");
        return verb == "unshelve" ? glue.unshelve(id, who) : glue.enable(id, who);
    }
    if (verb == "disable") {
        if (!onlyKeys(j, {"id", "reason"})) return badRequest("khóa lạ");
        if (!idOf(id)) return badRequest("id sai");
        if (!j.contains("reason") || !j["reason"].is_string())
            return badRequest("reason là bắt buộc");
        std::string reason = j["reason"].get<std::string>();
        size_t a = 0, b = reason.size();
        while (a < b && (reason[a] == ' ' || reason[a] == '\t')) ++a;
        while (b > a && (reason[b - 1] == ' ' || reason[b - 1] == '\t')) --b;
        reason = reason.substr(a, b - a);
        if (reason.empty() || alarm::utf8Length(reason) > 120)
            return badRequest("reason phải từ 1 đến 120 ký tự");
        for (unsigned char c : reason)
            if (c < 0x20 || c == 0x7f) return badRequest("reason có ký tự điều khiển");
        return glue.disable(id, reason, who);
    }
    return badRequest("thao tác lạ");
}

// ---------------------------------------------------------------------------------------------

bool PostLimiter::allow(const std::string& key, int& retryAfterMs) {
    const int64_t now = mono_();
    std::lock_guard<std::mutex> l(mu_);
    auto& q = times_[key];
    while (!q.empty() && now - q.front() >= 1000) q.pop_front();
    if (static_cast<int>(q.size()) >= kPostsPerSecond) {
        retryAfterMs = static_cast<int>(std::max<int64_t>(1, 1000 - (now - q.front())));
        return false;
    }
    q.push_back(now);
    if (times_.size() > 256) {  // sessions that left
        for (auto it = times_.begin(); it != times_.end();) {
            if (it->second.empty() || now - it->second.back() >= 1000)
                it = times_.erase(it);
            else
                ++it;
        }
    }
    return true;
}

bool SourceLimiter::enter(const std::string& ip) {
    std::lock_guard<std::mutex> l(mu_);
    int& n = busy_[ip];
    if (n >= 1) return false;
    ++n;
    return true;
}

void SourceLimiter::leave(const std::string& ip) {
    std::lock_guard<std::mutex> l(mu_);
    auto it = busy_.find(ip);
    if (it != busy_.end() && --it->second <= 0) busy_.erase(it);
}

// ---------------------------------------------------------------------------------------------

namespace {
int sendResult(mg_connection* c, const AlarmApiResult& r, const std::string& extra = "") {
    const bool close = !mg_get_request_info(c)->is_ssl;
    const std::string body = jsonText(r.body);  // the headers of device-api §1.2
    mg_printf(c,
              "HTTP/1.1 %d %s\r\nContent-Type: application/json; charset=utf-8\r\n"
              "Content-Length: %zu\r\nCache-Control: no-store\r\nX-Content-Type-Options: "
              "nosniff\r\nReferrer-Policy: no-referrer\r\n"
              "%s%s\r\n",
              r.status, mg_get_response_code_text(c, r.status), body.size(), extra.c_str(),
              close ? "Connection: close\r\n" : "");
    mg_write(c, body.data(), body.size());
    return r.status;
}
}  // namespace

namespace {
void keepAllowed(json& body, const char* list, const char* key, const AlarmFilter& allow) {
    if (!allow || !body.contains(list) || !body[list].is_array()) return;
    json kept = json::array();
    for (auto& x : body[list])
        if (x.is_object() && x.contains(key) && x[key].is_string() &&
            allow(x[key].get<std::string>()))
            kept.push_back(std::move(x));
    body[list] = std::move(kept);
}
}  // namespace

int getList(mg_connection* c, AlarmGlue& glue, bool full, const AlarmFilter& allow) {
    json body = glue.listJson(full);
    keepAllowed(body, "instances", "id", allow);
    return sendResult(c, {200, std::move(body)});
}

int getHistory(mg_connection* c, AlarmGlue& glue, SourceLimiter& limiter, bool full,
               const AlarmFilter& allow) {
    const mg_request_info* ri = mg_get_request_info(c);
    const int64_t now = std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::system_clock::now().time_since_epoch())
                            .count();
    alarm::HistoryQuery q;
    if (auto bad = parseHistoryQuery(ri->query_string ? ri->query_string : "", now, q))
        return sendResult(c, *bad);
    const std::string ip = ri->remote_addr;
    if (!limiter.enter(ip))
        return sendResult(
            c,
            {429,
             {{"error", "RATE_LIMITED"},
              {"message", "Đang có một truy vấn lịch sử của địa chỉ này. Hãy đợi nó xong."},
              {"retryAfterMs", 1000}}},
            "Retry-After: 1\r\n");
    // The query holds the source's slot, the sending of the answer does not: a client that reads
    // the whole answer and asks again at once must find the slot free (T059: before, the slot was
    // left after the answer was written, and the next query of the same client got 429).
    AlarmApiResult result;
    {
        struct Leave {
            SourceLimiter& l;
            std::string ip;
            ~Leave() { l.leave(ip); }
        } leave{limiter, ip};
        result = glue.history(q, full);
    }
    if (result.status == 200) keepAllowed(result.body, "items", "alarmId", allow);
    return sendResult(c, result);
}

}  // namespace alarmsapi

}  // namespace mat
