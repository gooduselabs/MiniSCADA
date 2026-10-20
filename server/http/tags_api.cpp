// POST /api/v1/tags/write, GET /api/v1/tags/write/{requestId} and GET /api/v1/tags/write?ids=
// (feature 006 T145; contracts/device-api-1.1.md §3). The rules of a write live in the coordinator
// (core/tag-engine/write_coordinator); this file reads the request, calls it and writes the answer.
#include <algorithm>
#include <cstdio>
#include <ctime>
#include <optional>
#include <set>

#include "civetweb.h"
#include "core/auth/access_service.hpp"
#include "core/common/json_limits.hpp"
#include "core/common/json_text.hpp"
#include "core/crypto/hex.hpp"
#include "core/crypto/sha256.hpp"
#include "core/tag-engine/write_coordinator.hpp"
#include "drivers/modbus/exceptions.hpp"
#include "server/http/access_filter.hpp"
#include "server/http/engineering_api.hpp"
#include "server/http/engineering_api_internal.hpp"

namespace mat {

namespace {

using nlohmann::json;

constexpr size_t kMaxRequests = 16;
constexpr size_t kMaxTagBytes = 64;
constexpr int kMaxBodyDepth = 8;

bool isHex(char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); }

// 8-4-4-4-12 lower-case hex, version 4, variant 8, 9, a or b.
bool isUuidV4(const std::string& s) {
    if (s.size() != 36) return false;
    for (size_t i = 0; i < s.size(); ++i) {
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (s[i] != '-') return false;
        } else if (!isHex(s[i])) {
            return false;
        }
    }
    return s[14] == '4' && (s[19] == '8' || s[19] == '9' || s[19] == 'a' || s[19] == 'b');
}

// 2026-10-20T03:12:00.123Z
std::string isoUtcMs(int64_t ms) {
    const time_t secs = static_cast<time_t>(ms / 1000);
    int rem = static_cast<int>(ms % 1000);
    if (rem < 0) rem += 1000;
    std::tm tm{};
    ::gmtime_r(&secs, &tm);
    char buf[40];
    std::snprintf(buf, sizeof buf, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", tm.tm_year + 1900,
                  tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec, rem);
    return buf;
}

// A TagScalar as JSON, 64-bit integers beyond 2^53 as decimal strings.
json scalarJson(const TagScalar& v) {
    constexpr int64_t kMax = 9007199254740992LL;
    if (const bool* b = std::get_if<bool>(&v)) return *b;
    if (const int64_t* i = std::get_if<int64_t>(&v))
        return (*i > kMax || *i < -kMax) ? json(std::to_string(*i)) : json(*i);
    if (const uint64_t* u = std::get_if<uint64_t>(&v))
        return *u > static_cast<uint64_t>(kMax) ? json(std::to_string(*u)) : json(*u);
    if (const double* d = std::get_if<double>(&v))
        return std::isfinite(*d) ? json(*d) : json(nullptr);
    if (const std::string* s = std::get_if<std::string>(&v)) return *s;
    return nullptr;
}

// The value of a request as the client wrote it; nullopt for a kind that is no value.
std::optional<WriteValue> valueOf(const json& v) {
    if (v.is_boolean()) return WriteValue::boolean(v.get<bool>());
    if (v.is_number_unsigned()) {
        const uint64_t u = v.get<uint64_t>();
        return u <= static_cast<uint64_t>(INT64_MAX) ? WriteValue::integer(static_cast<int64_t>(u))
                                                     : WriteValue::unsignedInt(u);
    }
    if (v.is_number_integer()) return WriteValue::integer(v.get<int64_t>());
    if (v.is_number_float()) return WriteValue::number(v.get<double>());
    if (v.is_string()) return WriteValue::text(v.get<std::string>());
    return std::nullopt;
}

json valueJson(const WriteValue& v) {
    const json parsed = json::parse(v.json(), nullptr, false);
    return parsed.is_discarded() ? json(nullptr) : parsed;
}

// The element of `results` for a view (device-api-1.1 §3.1, §3.2).
json viewJson(const WriteView& v) {
    json j = {{"requestId", v.requestId}, {"status", v.status}};
    if (v.status == "UNKNOWN") return j;
    if (v.status == "REJECTED") {
        j["reason"] = v.code;
        if (!v.message.empty()) j["message"] = v.message;
        if (v.retryAfterMs > 0) j["retryAfterMs"] = v.retryAfterMs;
        if (v.duplicate) j["duplicate"] = true;
        return j;
    }
    if (!v.tag.empty()) j["tag"] = v.tag;
    if (v.hasValue) j["value"] = valueJson(v.value);
    if (v.status == "ACCEPTED") {
        j["phase"] = v.phase.empty() ? "queued" : v.phase;  // queued, or release (a pulse)
        if (v.hasOld)
            j["old"] = {{"value", scalarJson(v.oldValue)}, {"quality", qualityName(v.oldQuality)}};
        if (v.hasRaw) j["raw"] = scalarJson(v.raw);
        if (v.receivedAtMs > 0) j["receivedAt"] = isoUtcMs(v.receivedAtMs);
    } else {
        j["code"] = v.code;
        if (v.pulseEnded) j["pulse"] = {{"valueMs", v.pulseMs}, {"released", v.pulseReleased}};
        if (!v.message.empty()) j["message"] = v.message;
        if (v.hasReadback) j["readback"] = scalarJson(v.readback);
        if (v.exception >= 0)
            j["exception"] = {{"code", modbus::exceptionHex(v.exception)},
                              {"meaning", modbus::exceptionMeaning(v.exception)}};
        if (v.receivedAtMs > 0) j["receivedAt"] = isoUtcMs(v.receivedAtMs);
        if (v.finishedAtMs > 0) {
            j["finishedAt"] = isoUtcMs(v.finishedAtMs);
            j["clockOk"] = v.clockOk;
        }
    }
    if (v.duplicate) j["duplicate"] = true;
    return j;
}

// The strict reading of the body: 1-16 requests, each with a UUID v4, a Tag and a value.
bool parseBody(const json& body, std::vector<WriteRequest>& out) {
    if (!body.is_object() || !body.contains("requests") || !body["requests"].is_array())
        return false;
    const json& list = body["requests"];
    if (list.empty() || list.size() > kMaxRequests) return false;
    for (const json& r : list) {
        if (!r.is_object() || !r.contains("requestId") || !r["requestId"].is_string() ||
            !r.contains("tag") || !r["tag"].is_string() || !r.contains("value"))
            return false;
        WriteRequest w;
        w.requestId = r["requestId"].get<std::string>();
        w.tag = r["tag"].get<std::string>();
        if (!isUuidV4(w.requestId) || w.tag.empty() || w.tag.size() > kMaxTagBytes) return false;
        const auto v = valueOf(r["value"]);
        if (!v) return false;
        w.value = *v;
        // Feature 007 (device-api-1.2 §6): `expect` a boolean, `pulseMs` an integer (its range is
        // the coordinator's to judge), `context` an object whose strings are judged there; any
        // other shape of the first two refuses the batch, a context that is no object is ignored.
        if (r.contains("expect")) {
            if (!r["expect"].is_boolean()) return false;
            w.expect = r["expect"].get<bool>();
        }
        if (r.contains("pulseMs")) {
            if (!r["pulseMs"].is_number_integer() && !r["pulseMs"].is_number_unsigned())
                return false;
            w.pulseMs = r["pulseMs"].is_number_unsigned()
                            ? static_cast<int64_t>(std::min<uint64_t>(r["pulseMs"].get<uint64_t>(),
                                                                      uint64_t{1} << 40))
                            : r["pulseMs"].get<int64_t>();
        }
        if (r.contains("context") && r["context"].is_object()) {
            const json& c = r["context"];
            if (c.contains("screen") && c["screen"].is_string())
                w.context.screen = c["screen"].get<std::string>();
            if (c.contains("widget") && c["widget"].is_string())
                w.context.widget = c["widget"].get<std::string>();
        }
        out.push_back(std::move(w));
    }
    return true;
}

WriteCaller callerOf(const GateRequest& r, const GateDecision& d) {
    WriteCaller w;
    w.user = d.access.user;
    if (d.access.role) w.role = roleName(*d.access.role);
    w.source = r.from.text();
    w.administrator = d.access.role && *d.access.role == Role::Administrator;
    w.channel = r.tls ? "https" : "http";
    if (d.viaCookie) {  // the page: the session is the cookie's, the channel is `web`
        w.channel = "web";
        w.sessionKey = toHex(sha256(d.webToken));
        return w;
    }
    if (r.authorization) {
        if (const auto t = bearerToken(*r.authorization)) w.sessionKey = toHex(sha256(*t));
    }
    return w;
}

}  // namespace

int EngineeringApi::tagsWrite(mg_connection* c, const GateRequest& r, const GateDecision& d,
                              bool close) {
    using eapi::send;
    using eapi::sendError;
    // The page sends JSON and nothing else (a form from another site could be text/plain).
    if (d.viaCookie) {
        const char* type = mg_get_header(c, "Content-Type");
        std::string t = type ? type : "";
        t = t.substr(0, t.find(';'));
        while (!t.empty() && t.back() == ' ') t.pop_back();
        for (char& ch : t)
            if (ch >= 'A' && ch <= 'Z') ch = static_cast<char>(ch - 'A' + 'a');
        if (t != "application/json") {
            eapi::drain(c);
            return sendError(c, 415, "UNSUPPORTED_MEDIA_TYPE", close, "",
                             {{"message", "Chỉ nhận application/json."}});
        }
    }
    std::string body;
    if (!eapi::readBody(c, body)) {
        mg_disable_connection_keep_alive(c);
        return sendError(c, 400, "BAD_REQUEST", true);
    }
    if (jsonNestingDepth(body.data(), body.size()) > kMaxBodyDepth)
        return sendError(c, 400, "BAD_REQUEST", close);
    const json j = json::parse(body, nullptr, false);
    std::vector<WriteRequest> reqs;
    if (j.is_discarded() || !parseBody(j, reqs)) return sendError(c, 400, "BAD_REQUEST", close);

    // Feature 011 (T209, report 008 F5): a Tag with `writeMinRole` above the caller's role refuses
    // the whole batch before anything is sent (403 FORBIDDEN, every request audited as denied),
    // whatever the page showed: the `minRole` of a button or an SVG event only locks the page.
    const WriteCaller who = callerOf(r, d);
    std::string needed;
    for (const WriteRequest& w : reqs) {
        const std::string need = tags_.coordinator->writeMinRole(w.tag);
        const auto have = d.access.role;
        const auto want = need.empty() ? std::nullopt : parseRole(need);
        if (want && (!have || !roleAtLeast(*have, *want))) {
            needed = need;
            break;
        }
    }
    if (!needed.empty()) {
        const std::string msg = "Lô lệnh có Tag chỉ ghi được từ vai trò " + needed + " trở lên.";
        json results = json::array();
        for (const WriteRequest& w : reqs) {
            tags_.coordinator->recordDenied(who, w.requestId, w.tag, w.value, true, "FORBIDDEN");
            const std::string need = tags_.coordinator->writeMinRole(w.tag);
            results.push_back(
                {{"requestId", w.requestId},
                 {"status", "REJECTED"},
                 {"reason", "FORBIDDEN"},
                 {"message",
                  need.empty() ? msg : "Tag này chỉ ghi được từ vai trò " + need + " trở lên."}});
        }
        return sendError(c, 403, "FORBIDDEN", close, "", {{"results", std::move(results)}});
    }

    // Feature 013 (contracts/admin-api.md §6, FR-033): a write of the page names the component
    // that sends it (context.screen, context.widget); the item must be operated by this person and
    // its bindings must hold the Tag. A request that does not is REJECTED ACCESS_DENIED and
    // audited; the others of the batch go on. Bearer (the engineer's tools): as before.
    std::vector<std::optional<json>> denied(reqs.size());
    if (d.viaCookie && access_) {
        const SessionAccessPtr a = access_->forAccess(d.access, d.viaCookie);
        for (size_t i = 0; i < reqs.size(); ++i) {
            const WriteRequest& w = reqs[i];
            const std::string why =
                pageWriteRefusal(access_->catalog(), *a, w.context.screen, w.context.widget, w.tag);
            if (why.empty()) continue;
            tags_.coordinator->recordDenied(who, w.requestId, w.tag, w.value, true,
                                            "ACCESS_DENIED");
            denied[i] = json{{"requestId", w.requestId},
                             {"status", "REJECTED"},
                             {"reason", "ACCESS_DENIED"},
                             {"message", why}};
        }
    }
    std::vector<WriteRequest> allowed;
    for (size_t i = 0; i < reqs.size(); ++i)
        if (!denied[i]) allowed.push_back(reqs[i]);
    std::vector<WriteView> views;
    if (!allowed.empty()) views = tags_.coordinator->submit(who, allowed);
    json results = json::array();
    size_t next = 0;
    for (size_t i = 0; i < reqs.size(); ++i) {
        if (denied[i])
            results.push_back(*denied[i]);
        else if (next < views.size())
            results.push_back(viewJson(views[next++]));
    }
    return send(c, 200, jsonText({{"results", results}}), close);
}

int EngineeringApi::tagsRefused(mg_connection* c, const GateRequest& r, const GateDecision& d,
                                bool close) {
    using eapi::sendError;
    // The body, when there is one that can be read (at most 16 KiB, not chunked): what it asks for
    // goes to the audit with the reason of the refusal.
    const mg_request_info* ri = mg_get_request_info(c);
    json parsed = nullptr;
    const bool chunked = mg_get_header(c, "Transfer-Encoding") != nullptr;
    if (!chunked && ri->content_length > 0 &&
        ri->content_length <= static_cast<long long>(kJsonBodyMaxBytes)) {
        std::string body;
        if (eapi::readBody(c, body) &&
            jsonNestingDepth(body.data(), body.size()) <= kMaxBodyDepth) {
            const json j = json::parse(body, nullptr, false);
            if (!j.is_discarded()) parsed = j;
        }
    }
    struct Item {
        std::string id, tag;
        std::optional<WriteValue> value;
    };
    std::vector<Item> items;
    if (parsed.is_object() && parsed.contains("requests") && parsed["requests"].is_array()) {
        for (const json& q : parsed["requests"]) {
            if (!q.is_object() || items.size() >= kMaxRequests) continue;
            Item it;
            if (q.contains("requestId") && q["requestId"].is_string())
                it.id = q["requestId"].get<std::string>();
            if (q.contains("tag") && q["tag"].is_string() &&
                q["tag"].get<std::string>().size() <= 256)
                it.tag = q["tag"].get<std::string>();
            if (q.contains("value")) it.value = valueOf(q["value"]);
            items.push_back(std::move(it));
        }
    }
    const WriteCaller who = callerOf(r, d);
    if (items.empty()) {
        tags_.coordinator->recordDenied(who, "", "", WriteValue{}, false, d.error);
    } else {
        for (const Item& it : items)
            tags_.coordinator->recordDenied(who, it.id, it.tag, it.value ? *it.value : WriteValue{},
                                            it.value.has_value(), d.error);
    }

    std::string extra;
    if (d.status == 401 && !d.viaCookie) extra = "WWW-Authenticate: Bearer\r\n";
    json more = json::object();
    if (d.error != "HTTPS_REQUIRED" && !items.empty()) {
        json results = json::array();
        for (const Item& it : items) {
            json x = {{"requestId", it.id}, {"status", "REJECTED"}, {"reason", d.error}};
            const char* msg = gateMessage(d.error);
            if (*msg) x["message"] = msg;
            results.push_back(std::move(x));
        }
        more["results"] = std::move(results);
    }
    return sendError(c, d.status, d.error, close, extra, std::move(more));
}

int EngineeringApi::tagsAsk(mg_connection* c, const GateRequest& r, const GateDecision& d,
                            bool close) {
    using eapi::send;
    using eapi::sendError;
    const WriteCaller who = callerOf(r, d);
    const std::string prefix = "/api/v1/tags/write/";
    if (r.path.rfind(prefix, 0) == 0) {  // one request id in the path
        const std::string id = r.path.substr(prefix.size());
        const WriteView v = isUuidV4(id) ? tags_.coordinator->status(who, id) : WriteView{};
        if (v.status.empty() || v.status == "UNKNOWN") {
            return sendError(
                c, 404, "NO_SUCH_REQUEST", close, "",
                {{"message",
                  "Không có lệnh ghi này (mã lạ, quá 15 phút, hoặc của tài khoản khác)."}});
        }
        return send(c, 200, jsonText({{"results", json::array({viewJson(v)})}}), close);
    }
    // ?ids=a,b,c (at most 16)
    const char* qs = mg_get_request_info(c)->query_string;
    std::string ids;
    if (qs) {
        const std::string q = qs;
        if (q.rfind("ids=", 0) != 0 || q.find('&') != std::string::npos)
            return sendError(c, 400, "BAD_REQUEST", close);
        ids = q.substr(4);
    }
    std::vector<std::string> list;
    size_t at = 0;
    while (!ids.empty() && at <= ids.size()) {
        size_t end = ids.find(',', at);
        if (end == std::string::npos) end = ids.size();
        list.push_back(ids.substr(at, end - at));
        at = end + 1;
    }
    if (list.empty() || list.size() > kMaxRequests) return sendError(c, 400, "BAD_REQUEST", close);
    json results = json::array();
    for (const std::string& id : list) {
        WriteView v;
        if (isUuidV4(id)) v = tags_.coordinator->status(who, id);
        if (v.status.empty() || v.status == "UNKNOWN") {
            v = WriteView{};
            v.requestId = id;
            v.status = "UNKNOWN";
        }
        results.push_back(viewJson(v));
    }
    return send(c, 200, jsonText({{"results", results}}), close);
}

}  // namespace mat
