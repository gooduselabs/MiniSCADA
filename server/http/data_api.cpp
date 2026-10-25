#include "server/http/data_api.hpp"

#include <algorithm>
#include <chrono>
#include <cstring>
#include <set>

#include "civetweb.h"
#include "core/common/json_limits.hpp"
#include "core/common/json_text.hpp"
#include "core/crypto/hex.hpp"
#include "core/crypto/random.hpp"
#include "core/crypto/sha256.hpp"
#include "core/tag-engine/write_coordinator.hpp"
#include "server/alarm_glue.hpp"
#include "server/http/alarms_api.hpp"
#include "server/http/auth_gate.hpp"
#include "server/http/engineering_api.hpp"
#include "server/http/engineering_api_internal.hpp"
#include "server/http/history_api.hpp"
#include "server/http/tags_write_json.hpp"

namespace mat {

namespace {

using nlohmann::json;

constexpr const char* kPrefix = "/api/v1/data/";
constexpr int kMaxBodyDepth = 8;
constexpr size_t kMaxWriteRequests = 16;

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
        case TagType::FLOAT64:
            return "FLOAT64";
        case TagType::STRING:
            return "STRING";
    }
    return "";
}

json isoOrNull(int64_t ms) { return ms > 0 ? json(isoUtcMsText(ms)) : json(nullptr); }

// A UUID v4 for a write request that came without one (no idempotency then).
std::string newRequestId() {
    std::string b = randomBytes(16);
    b[6] = static_cast<char>((b[6] & 0x0f) | 0x40);
    b[8] = static_cast<char>((b[8] & 0x3f) | 0x80);
    const std::string h = toHex(b);
    return h.substr(0, 8) + "-" + h.substr(8, 4) + "-" + h.substr(12, 4) + "-" + h.substr(16, 4) +
           "-" + h.substr(20, 12);
}

// "a,b,c" of a query parameter (decoded by CivetWeb's mg_get_var).
std::vector<std::string> splitList(const std::string& s) {
    std::vector<std::string> out;
    size_t at = 0;
    while (at <= s.size()) {
        size_t end = s.find(',', at);
        if (end == std::string::npos) end = s.size();
        if (end > at) out.push_back(s.substr(at, end - at));
        at = end + 1;
    }
    return out;
}

// The value of query parameter `name`; nullopt when absent. false in `ok` when it does not fit.
std::optional<std::string> queryVar(mg_connection* c, const char* name, bool& ok) {
    const mg_request_info* ri = mg_get_request_info(c);
    if (!ri->query_string) return std::nullopt;
    std::string buf(8192, '\0');
    const int n =
        mg_get_var(ri->query_string, std::strlen(ri->query_string), name, &buf[0], buf.size());
    if (n == -1) return std::nullopt;
    if (n < 0) {
        ok = false;
        return std::nullopt;
    }
    buf.resize(static_cast<size_t>(n));
    return buf;
}

}  // namespace

std::unordered_set<std::string> operableTags(const ResourceCatalog& catalog,
                                             const SessionAccess& access) {
    std::unordered_set<std::string> out;
    for (const CatalogScreen& s : catalog.screens)
        for (const CatalogItem& it : s.items)
            if (it.operable && (access.all() || access.access.canOperate(s.id, it.id)))
                for (const std::string& t : it.tags) out.insert(t);
    return out;
}

Principal DataApi::principalOf(const ApiKey& k) {
    Principal p;
    p.user = "apikey:" + k.id;
    p.role = k.role;
    p.groups = k.groups;
    return p;
}

DataApi::DataApi(DataBackend backend)
    : b_(std::move(backend)), alarmLimiter_(std::make_unique<alarmsapi::SourceLimiter>()) {}

DataApi::~DataApi() = default;

int DataApi::refuse(mg_connection* c, const GateRequest& r, const std::optional<ApiKey>& key,
                    int status, const std::string& code, bool close, const std::string& extra,
                    json more) {
    if (b_.audit) {
        AuditEvent e(AuditAction::ApiKeyDenied, AuditResult::Denied, AuditChannel::Https,
                     r.from.text());
        if (key) {
            e.user = "apikey:" + key->id;
            e.role = roleName(key->role);
        }
        e.target = r.method + " " + r.path;
        e.code = code;
        try {
            b_.audit(e);
        } catch (const std::exception&) {  // the answer does not depend on the record
        }
    }
    std::string headers = extra;
    if (status == 401) headers += "WWW-Authenticate: Bearer\r\n";
    return eapi::sendError(c, status, code, close, headers, std::move(more));
}

int DataApi::handle(mg_connection* c, const GateRequest& r, const GateDecision& d, bool close) {
    (void)d;
    if (!b_.keys || !b_.access) return eapi::sendError(c, 501, "NOT_IMPLEMENTED", close);
    std::optional<std::string_view> token;
    if (r.authorization) token = bearerToken(*r.authorization);
    const ApiKeyAuth a = b_.keys->authenticate(token ? *token : std::string_view(), r.from.ip);
    if (a.status != ApiKeyAuthStatus::Ok) {
        if (r.method == "POST") eapi::drain(c);
        const std::optional<ApiKey> key = a.status == ApiKeyAuthStatus::Expired ||
                                                  a.status == ApiKeyAuthStatus::Source ||
                                                  a.status == ApiKeyAuthStatus::RateLimited
                                              ? std::optional<ApiKey>(a.key)
                                              : std::nullopt;
        std::string extra;
        json more = json::object();
        if (a.retryAfterMs > 0) {
            extra = "Retry-After: " + std::to_string((a.retryAfterMs + 999) / 1000) + "\r\n";
            more["retryAfterMs"] = a.retryAfterMs;
        }
        return refuse(c, r, key, apiKeyAuthHttp(a.status), apiKeyAuthCode(a.status), close, extra,
                      std::move(more));
    }
    DataCaller who;
    who.key = a.key;
    who.from = r.from;
    who.access = b_.access->forPrincipal(principalOf(a.key), a.key.rev, a.storeRev);
    if (a.key.canWrite()) who.writable = operableTags(b_.access->catalog(), *who.access);

    const std::string sub = r.path.substr(std::strlen(kPrefix));
    if (sub == "key") return keyInfo(c, who, close);
    if (sub == "tags") return tags(c, who, close);
    if (sub == "values") return values(c, who, close);
    if (sub.rfind("history/", 0) == 0) return history(c, r, who, close);
    if (sub == "alarms" || sub == "alarms/history") return alarms(c, r, who, close);
    if (sub == "write" && r.method == "POST") return write(c, r, who, close);
    if (sub == "write" || sub.rfind("write/", 0) == 0) return writeAsk(c, r, who, close);
    return eapi::sendError(c, 404, "NOT_FOUND", close);
}

int DataApi::keyInfo(mg_connection* c, const DataCaller& who, bool close) {
    const ApiKey& k = who.key;
    json body = {{"apiVersion", "1.0"},
                 {"id", k.id},
                 {"name", k.name},
                 {"prefix", k.prefix},
                 {"role", roleName(k.role)},
                 {"groups", k.groups},
                 {"readOnly", k.readOnly},
                 {"canWrite", k.canWrite()},
                 {"expiresAt", k.expiresAtMs ? json(isoUtcText(*k.expiresAtMs)) : json(nullptr)},
                 {"ratePerMin", k.ratePerMin},
                 {"source", who.from.ip}};
    return eapi::send(c, 200, jsonText(body), close);
}

int DataApi::tags(mg_connection* c, const DataCaller& who, bool close) {
    json list = json::array();
    if (b_.model) {
        for (const TagModel& t : b_.model->tags) {
            if (!who.access->access.liveTag(t.id) && !who.access->all()) continue;
            bool writable = t.writable && !t.logicOwned && who.writable.count(t.id) > 0;
            if (writable && !t.writeMinRole.empty()) {
                const auto need = parseRole(t.writeMinRole);
                writable = !need || roleAtLeast(who.key.role, *need);
            }
            json j = {{"name", t.id}, {"type", typeName(t.type)}, {"writable", writable}};
            j["unit"] = t.unit.empty() ? json(nullptr) : json(t.unit);
            j["description"] = t.description.empty() ? json(nullptr) : json(t.description);
            j["history"] = who.access->access.historyTag(t.id) || who.access->all();
            list.push_back(std::move(j));
        }
    }
    return eapi::send(c, 200, jsonText({{"tags", std::move(list)}}), close);
}

int DataApi::values(mg_connection* c, const DataCaller& who, bool close) {
    bool ok = true;
    const auto param = queryVar(c, "tags", ok);
    if (!ok) return eapi::sendError(c, 400, "BAD_REQUEST", close);
    const auto allowed = [&](const std::string& id) {
        return who.access->all() || who.access->access.liveTag(id);
    };
    std::vector<std::string> names;
    std::vector<size_t> idx;
    if (param) {
        names = splitList(*param);
        if (names.empty() || names.size() > kDataMaxValueTags)
            return eapi::sendError(c, 400, "BAD_REQUEST", close, "",
                                   {{"message", "Cần 1 đến 200 Tag trong tags."}});
        json refused = json::array();
        for (const std::string& n : names) {
            const auto i = b_.store ? b_.store->indexOf(n) : std::nullopt;
            if (!i || !allowed(n)) {
                refused.push_back(n);
                continue;
            }
            idx.push_back(*i);
        }
        if (!refused.empty())  // an unknown Tag and a Tag of another person look the same
            return eapi::sendError(
                c, 403, "ACCESS_DENIED", close, "",
                {{"tags", std::move(refused)},
                 {"message", "Key không được đọc Tag này, hoặc không có Tag này."}});
    } else if (b_.store) {
        for (size_t i = 0; i < b_.store->size(); ++i)
            if (allowed(b_.store->def(i).id)) idx.push_back(i);
    }
    std::vector<TagValue> v;
    if (b_.store) b_.store->snapshot(idx, v);
    json list = json::array();
    for (size_t k = 0; k < idx.size() && k < v.size(); ++k) {
        json j = {{"name", b_.store->def(idx[k]).id},
                  {"value", tagScalarJson(v[k].value)},
                  {"quality", qualityName(v[k].quality)},
                  {"sourceTs", isoOrNull(v[k].sourceTs)},
                  {"serverTs", isoOrNull(v[k].serverTs)}};
        if (!v[k].reason.empty()) j["reason"] = v[k].reason;
        list.push_back(std::move(j));
    }
    const int64_t now = std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::system_clock::now().time_since_epoch())
                            .count();
    return eapi::send(c, 200, jsonText({{"time", isoUtcMsText(now)}, {"values", std::move(list)}}),
                      close);
}

int DataApi::history(mg_connection* c, const GateRequest& r, const DataCaller& who, bool close) {
    if (!b_.history) return eapi::sendError(c, 404, "NO_HISTORY", close);
    const std::string historyPath = "/api/v1/history/" + r.path.substr(std::strlen(kPrefix) + 8);
    GateDecision d;
    d.rule = findEndpointRule("GET", historyPath);
    if (!d.rule) return eapi::sendError(c, 404, "NOT_FOUND", close);
    d.access.status = AccessStatus::Ok;
    d.access.user = "apikey:" + who.key.id;
    d.access.role = who.key.role;
    d.access.groups = who.key.groups;
    d.access.accountRev = who.key.rev;
    GateRequest r2 = r;
    r2.path = historyPath;
    return b_.history->handle(c, r2, d, close);
}

int DataApi::alarms(mg_connection* c, const GateRequest& r, const DataCaller& who, bool close) {
    if (!b_.alarms) return eapi::sendError(c, 404, "NO_ALARMS", close);
    alarmsapi::AlarmFilter allow;
    const SessionAccessPtr a = who.access;
    if (!a->all()) {
        if (!a->access.canViewPage("alarms"))
            return eapi::sendError(c, 403, "ACCESS_DENIED", close, "",
                                   {{"message", "Key không được xem alarm."}});
        allow = [a](const std::string& id) { return a->access.alarmAllowed(id); };
    }
    if (r.path == std::string(kPrefix) + "alarms")
        return alarmsapi::getList(c, *b_.alarms, true, allow);
    return alarmsapi::getHistory(c, *b_.alarms, *alarmLimiter_, true, allow);
}

int DataApi::write(mg_connection* c, const GateRequest& r, const DataCaller& who, bool close) {
    if (!b_.coordinator) {
        eapi::drain(c);
        return eapi::sendError(c, 501, "NOT_IMPLEMENTED", close);
    }
    const char* type = mg_get_header(c, "Content-Type");
    std::string t = type ? type : "";
    t = t.substr(0, t.find(';'));
    while (!t.empty() && (t.back() == ' ' || t.back() == '\t')) t.pop_back();
    for (char& ch : t)
        if (ch >= 'A' && ch <= 'Z') ch = static_cast<char>(ch - 'A' + 'a');
    if (t != "application/json") {
        eapi::drain(c);
        return eapi::sendError(c, 415, "UNSUPPORTED_MEDIA_TYPE", close, "",
                               {{"message", "Chỉ nhận application/json."}});
    }
    std::string body;
    if (!eapi::readBody(c, body)) {
        mg_disable_connection_keep_alive(c);
        return eapi::sendError(c, 400, "BAD_REQUEST", true);
    }
    if (jsonNestingDepth(body.data(), body.size()) > kMaxBodyDepth)
        return eapi::sendError(c, 400, "BAD_REQUEST", close);
    json j = json::parse(body, nullptr, false);
    // A request without requestId gets one here (no idempotency for it); a pulse is the page's.
    if (j.is_object() && j.contains("requests") && j["requests"].is_array() &&
        j["requests"].size() <= kMaxWriteRequests)
        for (json& q : j["requests"])
            if (q.is_object()) {
                if (!q.contains("requestId")) q["requestId"] = newRequestId();
                q.erase("pulseMs");
                q.erase("context");
            }
    std::vector<WriteRequest> reqs;
    if (j.is_discarded() || !parseWriteRequests(j, reqs))
        return eapi::sendError(c, 400, "BAD_REQUEST", close);

    WriteCaller w;
    w.user = "apikey:" + who.key.id;
    w.role = roleName(who.key.role);
    w.source = r.from.text();
    w.sessionKey = "apikey:" + who.key.id;
    w.channel = "https";
    for (WriteRequest& q : reqs) {
        q.context.screen = "api-key";
        q.context.widget = "key-" + who.key.id;
    }
    // A key that may not write refuses the whole batch, each request on record.
    if (!who.key.canWrite()) {
        json results = json::array();
        for (const WriteRequest& q : reqs) {
            b_.coordinator->recordDenied(w, q.requestId, q.tag, q.value, true, "FORBIDDEN");
            results.push_back({{"requestId", q.requestId},
                               {"tag", q.tag},
                               {"status", "REJECTED"},
                               {"reason", "FORBIDDEN"},
                               {"message", "Key chỉ đọc: không ghi được Tag."}});
        }
        return refuse(c, r, who.key, 403, "FORBIDDEN", close, "",
                      {{"results", std::move(results)}});
    }
    if (b_.auditAvailable && !b_.auditAvailable())
        return eapi::sendError(c, 503, "AUDIT_UNAVAILABLE", close);
    // writeMinRole above the key's role: the whole batch, as on /api/v1/tags/write.
    for (const WriteRequest& q : reqs) {
        const std::string need = b_.coordinator->writeMinRole(q.tag);
        const auto want = need.empty() ? std::nullopt : parseRole(need);
        if (want && !roleAtLeast(who.key.role, *want)) {
            json results = json::array();
            for (const WriteRequest& x : reqs) {
                b_.coordinator->recordDenied(w, x.requestId, x.tag, x.value, true, "FORBIDDEN");
                results.push_back({{"requestId", x.requestId},
                                   {"tag", x.tag},
                                   {"status", "REJECTED"},
                                   {"reason", "FORBIDDEN"}});
            }
            return refuse(
                c, r, who.key, 403, "FORBIDDEN", close, "",
                {{"results", std::move(results)},
                 {"message", "Lô lệnh có Tag chỉ ghi được từ vai trò " + need + " trở lên."}});
        }
    }
    // Feature 013: a Tag outside the items the key may operate is ACCESS_DENIED, the rest go on.
    std::vector<std::optional<json>> denied(reqs.size());
    std::vector<WriteRequest> allowed;
    for (size_t i = 0; i < reqs.size(); ++i) {
        if (who.writable.count(reqs[i].tag) > 0) {
            allowed.push_back(reqs[i]);
            continue;
        }
        b_.coordinator->recordDenied(w, reqs[i].requestId, reqs[i].tag, reqs[i].value, true,
                                     "ACCESS_DENIED");
        denied[i] = json{{"requestId", reqs[i].requestId},
                         {"tag", reqs[i].tag},
                         {"status", "REJECTED"},
                         {"reason", "ACCESS_DENIED"},
                         {"message", "Key không được ghi Tag này."}};
    }
    std::vector<WriteView> views;
    if (!allowed.empty()) views = b_.coordinator->submit(w, allowed);
    json results = json::array();
    size_t next = 0;
    for (size_t i = 0; i < reqs.size(); ++i) {
        if (denied[i]) {
            results.push_back(*denied[i]);
        } else if (next < views.size()) {
            json v = writeViewJson(views[next++]);
            if (!v.contains("tag")) v["tag"] = reqs[i].tag;
            results.push_back(std::move(v));
        }
    }
    return eapi::send(c, 200, jsonText({{"results", results}}), close);
}

int DataApi::writeAsk(mg_connection* c, const GateRequest& r, const DataCaller& who, bool close) {
    if (!b_.coordinator) return eapi::sendError(c, 501, "NOT_IMPLEMENTED", close);
    WriteCaller w;
    w.user = "apikey:" + who.key.id;
    w.role = roleName(who.key.role);
    w.source = r.from.text();
    w.sessionKey = "apikey:" + who.key.id;
    w.channel = "https";
    std::vector<std::string> ids;
    const std::string one = std::string(kPrefix) + "write/";
    if (r.path.rfind(one, 0) == 0) {
        ids.push_back(r.path.substr(one.size()));
    } else {
        bool ok = true;
        const auto param = queryVar(c, "ids", ok);
        if (!ok || !param) return eapi::sendError(c, 400, "BAD_REQUEST", close);
        ids = splitList(*param);
        if (ids.empty() || ids.size() > kMaxWriteRequests)
            return eapi::sendError(c, 400, "BAD_REQUEST", close);
    }
    json results = json::array();
    for (const std::string& id : ids) {
        WriteView v;
        if (isWriteRequestId(id)) v = b_.coordinator->status(w, id);
        if (v.status.empty() || v.status == "UNKNOWN") {
            v = WriteView{};
            v.requestId = id;
            v.status = "UNKNOWN";
        }
        results.push_back(writeViewJson(v));
    }
    return eapi::send(c, 200, jsonText({{"results", results}}), close);
}

}  // namespace mat
