#include "server/http/http_api.hpp"

#include <dirent.h>
#include <sys/stat.h>

#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstring>

#include "civetweb.h"
#include "core/common/json_text.hpp"
#include "server/alarm_glue.hpp"
#include "server/device_state.hpp"
#include "server/http/alarms_api.hpp"
#include "server/http/source_filter.hpp"
#include "server/http/viewer_gate.hpp"

namespace mat {

namespace {

// 0.3.0 closed every connection after its answer, and the HTTP listener still does (no keep-alive).
// Over HTTPS the Studio keeps its connection for the next request.
const char* connectionClose(mg_connection* c) {
    return mg_get_request_info(c)->is_ssl ? "" : "Connection: close\r\n";
}

// Checked from outside by tools/measure/http-check.mjs (T068).
const char* const kCspRuntime =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' "
    "data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; "
    "form-action 'none'";
const char* const kCspProject =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";

bool isGetOrHead(mg_connection* c) {
    const char* m = mg_get_request_info(c)->request_method;
    return std::strcmp(m, "GET") == 0 || std::strcmp(m, "HEAD") == 0;
}

bool isHead(mg_connection* c) {
    return std::strcmp(mg_get_request_info(c)->request_method, "HEAD") == 0;
}

int methodNotAllowed(mg_connection* c) {
    mg_printf(c,
              "HTTP/1.1 405 Method Not Allowed\r\nAllow: GET, HEAD\r\nContent-Length: 0\r\n"
              "X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n%s\r\n",
              connectionClose(c));
    return 405;
}

int sendJson(mg_connection* c, int status, const std::string& body, const std::string& extra) {
    mg_printf(c,
              "HTTP/1.1 %d %s\r\nContent-Type: application/json; charset=utf-8\r\n"
              "Content-Length: %zu\r\nCache-Control: no-store\r\nX-Content-Type-Options: "
              "nosniff\r\nReferrer-Policy: no-referrer\r\n"
              "%s%s\r\n",
              status, status == 200 ? "OK" : "Service Unavailable", body.size(), extra.c_str(),
              connectionClose(c));
    if (!isHead(c)) mg_write(c, body.data(), body.size());
    return status;
}

int notFound(mg_connection* c) {
    const char* body = "Not found";
    mg_printf(c,
              "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: %zu\r\n"
              "X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n%s\r\n%s",
              std::strlen(body), connectionClose(c), body);
    return 404;
}

// Serves one regular file with ETag/304, optional pre-compressed .gz, and extra headers.
// Returns the HTTP status sent.
int serveFile(mg_connection* c, const std::string& path, const char* contentType,
              const std::string& extraHeaders, bool allowGzip) {
    std::string file = path;
    bool gz = false;
    if (allowGzip) {
        const char* ae = mg_get_header(c, "Accept-Encoding");
        struct stat gst {};
        if (ae && std::strstr(ae, "gzip") && stat((path + ".gz").c_str(), &gst) == 0) {
            file = path + ".gz";
            gz = true;
        }
    }
    struct stat st {};
    if (stat(file.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) return notFound(c);
    char etag[64];
    std::snprintf(etag, sizeof etag, "\"%lx-%lx%s\"", static_cast<unsigned long>(st.st_size),
                  static_cast<unsigned long>(st.st_mtime), gz ? "-gz" : "");
    const std::string common =
        std::string("ETag: ") + etag + "\r\nVary: Accept-Encoding\r\n" +
        "X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n" + extraHeaders;
    const char* inm = mg_get_header(c, "If-None-Match");
    if (inm && std::strcmp(inm, etag) == 0) {
        mg_printf(c, "HTTP/1.1 304 Not Modified\r\n%sContent-Length: 0\r\n\r\n", common.c_str());
        return 304;
    }
    std::FILE* in = std::fopen(file.c_str(), "rb");
    if (!in) return notFound(c);
    mg_printf(c, "HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %llu\r\n%s%s\r\n",
              contentType, static_cast<unsigned long long>(st.st_size),
              gz ? "Content-Encoding: gzip\r\n" : "", common.c_str());
    if (!isHead(c)) {
        // Stream in chunks: memory per request stays small whatever the file size (review m-3).
        char buf[16384];
        size_t n;
        while ((n = std::fread(buf, 1, sizeof buf, in)) > 0)
            if (mg_write(c, buf, n) <= 0) break;
    }
    std::fclose(in);
    return 200;
}

}  // namespace

HttpApi::HttpApi(Options opt, InfoProvider info)
    : opt_(std::move(opt)),
      info_(std::move(info)),
      historyLimiter_(std::make_shared<alarmsapi::SourceLimiter>()) {
    // Allowlist of the static assets produced by the web build (hashed names, no sub-folders).
    // CivetWeb is built with NO_FILES: it never maps URLs to files itself (security review H1).
    if (DIR* d = opendir((opt_.docroot + "/assets").c_str())) {
        while (dirent* e = readdir(d)) {
            const std::string name = e->d_name;
            struct stat st {};
            const bool gz = name.size() > 3 && name.compare(name.size() - 3, 3, ".gz") == 0;
            if (!name.empty() && name[0] != '.' && name.size() <= 128 && !gz &&
                stat((opt_.docroot + "/assets/" + name).c_str(), &st) == 0 && S_ISREG(st.st_mode))
                assets_.insert(name);
        }
        closedir(d);
    }
}

namespace {

// The host name of a Host header without its port, when it is something a Location header may
// carry (letters, digits, dots, hyphens, or an IPv6 literal in brackets); "" otherwise.
std::string safeHostOf(const char* hostHeader) {
    if (!hostHeader) return "";
    std::string h = hostHeader;
    std::string host;
    if (!h.empty() && h[0] == '[') {  // [fe80::1]:8080
        const size_t close = h.find(']');
        if (close == std::string::npos) return "";
        host = h.substr(0, close + 1);
        for (size_t i = 1; i + 1 < host.size(); ++i)
            if (!std::isxdigit(static_cast<unsigned char>(host[i])) && host[i] != ':' &&
                host[i] != '.')
                return "";
        return host;
    }
    host = h.substr(0, h.find(':'));
    if (host.empty() || host.size() > 253) return "";
    for (const char ch : host)
        if (!std::isalnum(static_cast<unsigned char>(ch)) && ch != '.' && ch != '-') return "";
    return host;
}

}  // namespace

// FR-055a: the page and its API are for the private networks (and for a valid session). The 403
// is a short HTML page on the page paths and JSON on the API paths; nothing is audited. Feature
// 007: with viewerLogin = required a request without a session gets the sign-in page (302), a
// short guide to HTTPS (a cookie does not travel over HTTP) or 401 on the data paths.
int HttpApi::filtered(mg_connection* c, FilterOutcome* outcome) const {
    if (outcome) *outcome = FilterOutcome::Serve;
    if (!opt_.gate) return 0;
    const char* uri = mg_get_request_info(c)->local_uri;
    const FilteredPath kind = classifyPath(uri ? uri : "");
    const FilterDecision d = opt_.gate->check(kind, opt_.gate->originOf(c));
    if (outcome) *outcome = d.outcome;
    if (d.allow) return 0;
    if (d.outcome == FilterOutcome::LoginRedirect) {
        mg_printf(c,
                  "HTTP/1.1 302 Found\r\nLocation: /login\r\nContent-Length: 0\r\n"
                  "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: "
                  "no-referrer\r\n%s\r\n",
                  connectionClose(c));
        return 302;
    }
    if (d.outcome == FilterOutcome::HttpGuide) {
        std::string url = "https://";
        const DeviceFacts f = opt_.device ? opt_.device->facts() : DeviceFacts{};
        const std::string host = safeHostOf(mg_get_header(c, "Host"));
        url += host.empty() ? "<địa chỉ thiết bị>" : host;
        if (f.httpsPort > 0) url += ":" + std::to_string(f.httpsPort);
        url += "/";
        const std::string body = httpGuidePageHtml(url);
        mg_printf(c,
                  "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n"
                  "Content-Length: %zu\r\nCache-Control: no-store\r\nX-Content-Type-Options: "
                  "nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src "
                  "'none'\r\n%s\r\n",
                  body.size(), connectionClose(c));
        if (!isHead(c)) mg_write(c, body.data(), body.size());
        return 200;
    }
    const bool page =
        kind == FilteredPath::Page || kind == FilteredPath::Asset || kind == FilteredPath::Project;
    const std::string body =
        page && d.status != 401 ? blockedPageHtml(d.error) : blockedJson(d.error);
    const bool html = page && d.status != 401;
    mg_printf(c,
              "HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %zu\r\n"
              "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: "
              "no-referrer\r\n%s%s\r\n",
              d.status, d.status == 401 ? "Unauthorized" : "Forbidden",
              html ? "text/html; charset=utf-8" : "application/json; charset=utf-8", body.size(),
              html ? "Content-Security-Policy: default-src 'none'\r\n" : "", connectionClose(c));
    if (!isHead(c)) mg_write(c, body.data(), body.size());
    return d.status;
}

void HttpApi::install(mg_context* ctx) {
    mg_set_request_handler(ctx, "/$", onIndex, this);
    mg_set_request_handler(ctx, "/index.html$", onIndex, this);
    mg_set_request_handler(ctx, "/login$", onLogin, this);
    mg_set_request_handler(ctx, "/device.crt$", onDeviceCert, this);
    mg_set_request_handler(ctx, "/assets/", onAsset, this);
    mg_set_request_handler(ctx, "/api/v1/system/info$", onInfo, this);
    mg_set_request_handler(ctx, "/api/v1/projects/active$", onActive, this);
    mg_set_request_handler(ctx, "/api/v1/alarms$", onAlarms, this);
    mg_set_request_handler(ctx, "/api/v1/alarms/history$", onAlarmsHistory, this);
    mg_set_request_handler(ctx, "/project/", onProjectFile, this);
}

// GET /login (device-api-1.2 §3.1): over HTTPS the static sign-in page, for every source; over HTTP
// a redirect to the same page on HTTPS (a cookie, so a sign-in, needs it), or 404 without HTTPS.
int HttpApi::onLogin(mg_connection* c, void* self) {
    auto* api = static_cast<HttpApi*>(self);
    if (!isGetOrHead(c)) return methodNotAllowed(c);
    if (mg_get_request_info(c)->is_ssl) {
        const std::string extra = std::string("Content-Security-Policy: ") + kCspRuntime +
                                  "\r\nCache-Control: no-cache\r\n";
        return serveFile(c, api->opt_.docroot + "/login.html", "text/html; charset=utf-8", extra,
                         true);
    }
    const DeviceFacts f = api->opt_.device ? api->opt_.device->facts() : DeviceFacts{};
    const std::string host = safeHostOf(mg_get_header(c, "Host"));
    if (f.https != HttpsState::Ok || f.httpsPort <= 0 || host.empty()) return notFound(c);
    mg_printf(c,
              "HTTP/1.1 302 Found\r\nLocation: https://%s:%d/login\r\nContent-Length: 0\r\n"
              "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: "
              "no-referrer\r\n%s\r\n",
              host.c_str(), f.httpsPort, connectionClose(c));
    return 302;
}

// GET /device.crt (device-api-1.2 §3.2): the certificate of the device, to install in the trust
// store of the browser (compare its fingerprint first). Public: no sign-in, no source filter. Only
// over HTTPS; while the HTTPS listener is down because of its certificate: 503.
int HttpApi::onDeviceCert(mg_connection* c, void* self) {
    auto* api = static_cast<HttpApi*>(self);
    if (!isGetOrHead(c)) return methodNotAllowed(c);
    const DeviceFacts f = api->opt_.device ? api->opt_.device->facts() : DeviceFacts{};
    const bool tls = mg_get_request_info(c)->is_ssl != 0;
    if (!tls) {
        if (f.https == HttpsState::CertError || f.https == HttpsState::TlsError)
            return sendJson(c, 503, R"({"error":"HTTPS_DOWN"})", "");
        return notFound(c);
    }
    const std::string& pem = api->opt_.deviceCertPem;
    // A key must never leave the device, whatever went wrong before: the bytes are checked once
    // more.
    if (pem.empty() || pem.find("PRIVATE KEY") != std::string::npos ||
        pem.find("-----BEGIN CERTIFICATE-----") == std::string::npos)
        return sendJson(c, 503, R"({"error":"CERT_ERROR"})", "");
    mg_printf(c,
              "HTTP/1.1 200 OK\r\nContent-Type: application/x-x509-ca-cert\r\n"
              "Content-Disposition: attachment; filename=\"mat-device.crt\"\r\n"
              "Content-Length: %zu\r\nCache-Control: no-store\r\nX-Content-Type-Options: "
              "nosniff\r\nReferrer-Policy: no-referrer\r\n"
              "%s\r\n",
              pem.size(), connectionClose(c));
    if (!isHead(c)) mg_write(c, pem.data(), pem.size());
    return 200;
}

int HttpApi::onIndex(mg_connection* c, void* self) {
    auto* api = static_cast<HttpApi*>(self);
    if (!isGetOrHead(c)) return methodNotAllowed(c);
    if (const int blocked = api->filtered(c)) return blocked;
    const std::string extra =
        std::string("Content-Security-Policy: ") + kCspRuntime + "\r\nCache-Control: no-cache\r\n";
    return serveFile(c, api->opt_.docroot + "/index.html", "text/html; charset=utf-8", extra, true);
}

int HttpApi::onInfo(mg_connection* c, void* self) {
    auto* api = static_cast<HttpApi*>(self);
    if (!isGetOrHead(c)) return methodNotAllowed(c);
    FilterOutcome outcome = FilterOutcome::Serve;
    if (const int blocked = api->filtered(c, &outcome)) return blocked;
    std::string extra = "Vary: Origin\r\n";
    if (const char* origin = mg_get_header(c, "Origin"))
        for (const auto& a : api->opt_.allowedOrigins)
            if (a == origin) extra += "Access-Control-Allow-Origin: " + a + "\r\n";
    std::string body;
    try {  // an exception here would end the runtime from inside CivetWeb
        nlohmann::json info = api->info_();
        // Feature 005 (device-api §2): the device, and the operation in progress (null until US2
        // gives one). A public page: neither block holds an account, an address or a fingerprint.
        if (api->opt_.device) info["device"] = api->opt_.device->systemInfoJson();
        if (!info.contains("operation")) info["operation"] = nullptr;
        // device-api-1.1 §2: viewerAccess any is a public page: the warning VIEWER_PUBLIC
        nlohmann::json warnings = info.contains("warnings") && info["warnings"].is_array()
                                      ? info["warnings"]
                                      : nlohmann::json::array();
        if (api->opt_.device && api->opt_.device->facts().viewerAccess == "any")
            warnings.push_back("VIEWER_PUBLIC");
        // device-api-1.2 §5: the sign-in of the page, and the warnings about the certificate and
        // the HTTPS listener.
        if (api->opt_.device) {
            info["web"] = api->opt_.device->webInfoJson();
            for (const std::string& w : api->opt_.device->deviceWarnings()) warnings.push_back(w);
        }
        if (api->opt_.alarms) {  // feature 009 (device-api-1.3 §4.1)
            info["alarms"] = api->opt_.alarms->infoJson();
            for (const std::string& w : api->opt_.alarms->warnings()) warnings.push_back(w);
        }
        // Feature 011 (device-api-011 §5): the 1.0 sources, then one detail per code, same order.
        std::map<std::string, SystemWarning> raised;
        if (api->opt_.systemWarnings)
            for (SystemWarning& w : api->opt_.systemWarnings->list()) {
                warnings.push_back(w.code);
                raised.emplace(w.code, std::move(w));
            }
        nlohmann::json details = nlohmann::json::array();
        {
            const int64_t nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                                      std::chrono::system_clock::now().time_since_epoch())
                                      .count();
            std::lock_guard<std::mutex> l(*api->firstSeenMu_);
            std::map<std::string, int64_t> seen;
            for (const auto& w : warnings) {
                const std::string code = w.is_string() ? w.get<std::string>() : w.dump();
                auto r = raised.find(code);
                int64_t since = 0;
                nlohmann::json detail = nullptr;
                if (r != raised.end()) {
                    since = r->second.sinceMs;
                    detail = r->second.detail;
                } else {
                    auto f = api->firstSeen_->find(code);
                    since = f != api->firstSeen_->end() ? f->second : nowMs;
                }
                seen[code] = since;
                details.push_back({{"code", code},
                                   {"message", warningMessage(code)},
                                   {"since", since},
                                   {"detail", detail}});
            }
            *api->firstSeen_ = std::move(seen);  // a code that went away starts again next time
        }
        info["warnings"] = warnings;
        info["warningDetails"] = details;
        info["update"] = {{"enabled", api->opt_.updateEnabled}, {"supported", true}};
        info["logic"] = {{"present", api->opt_.logicPresent},
                         {"writes", api->opt_.logicWritesNow ? api->opt_.logicWritesNow()
                                                             : api->opt_.logicWrites}};
        // viewerLogin = required and no session: only what a page over HTTP needs to build the link
        // to HTTPS (the version tells it which page this is, `web` where HTTPS is).
        if (outcome == FilterOutcome::MinimalInfo) {
            nlohmann::json minimal = {{"runtimeVersion", info.value("runtimeVersion", "")}};
            if (info.contains("web")) minimal["web"] = info["web"];
            info = std::move(minimal);
        }
        body = jsonText(info);
    } catch (const std::exception&) {
        return sendJson(c, 503, R"({"error":"INFO_UNAVAILABLE"})", extra);
    }
    return sendJson(c, 200, body, extra);
}

int HttpApi::onActive(mg_connection* c, void* self) {
    auto* api = static_cast<HttpApi*>(self);
    if (!isGetOrHead(c)) return methodNotAllowed(c);
    if (const int blocked = api->filtered(c)) return blocked;
    if (api->opt_.activeProjectJson.empty()) {
        nlohmann::json body = {{"error", "NO_VALID_PROJECT"}, {"errors", api->opt_.projectErrors}};
        return sendJson(c, 503, jsonText(body), "");
    }
    return sendJson(c, 200, api->opt_.activeProjectJson, "");
}

// GET /api/v1/alarms and /api/v1/alarms/history (feature 009, device-api-1.3 §2): the same source
// filter as the other reads of the page; no state is changed, so no CSRF or Origin check. The
// answer says no-store. A runtime without the alarm engine does not have the routes (404).
int HttpApi::onAlarms(mg_connection* c, void* self) {
    auto* api = static_cast<HttpApi*>(self);
    if (!isGetOrHead(c)) return methodNotAllowed(c);
    if (const int blocked = api->filtered(c)) return blocked;
    if (!api->opt_.alarms) return notFound(c);
    try {                  // an exception here would end the runtime from inside CivetWeb
        bool full = true;  // no source filter (tests): nothing to hide from
        if (api->opt_.gate) {
            const RequestOrigin o = api->opt_.gate->originOf(c);
            full = api->opt_.gate->validSession(o) || api->opt_.gate->validWebSession(o);
        }
        return alarmsapi::getList(c, *api->opt_.alarms, full);
    } catch (const std::exception&) {
        return sendJson(c, 503, R"({"error":"INTERNAL_ERROR"})", "");
    }
}

int HttpApi::onAlarmsHistory(mg_connection* c, void* self) {
    auto* api = static_cast<HttpApi*>(self);
    if (!isGetOrHead(c)) return methodNotAllowed(c);
    if (const int blocked = api->filtered(c)) return blocked;
    if (!api->opt_.alarms) return notFound(c);
    try {
        bool full = true;  // M1: account names only for a source with a sign-in
        if (api->opt_.gate) {
            const RequestOrigin o = api->opt_.gate->originOf(c);
            full = api->opt_.gate->validSession(o) || api->opt_.gate->validWebSession(o);
        }
        return alarmsapi::getHistory(c, *api->opt_.alarms, *api->historyLimiter_, full);
    } catch (const std::exception&) {
        return sendJson(c, 503, R"({"error":"INTERNAL_ERROR"})", "");
    }
}

namespace {
const char* assetType(const std::string& name) {
    auto ends = [&](const char* ext) {
        const size_t n = std::strlen(ext);
        return name.size() > n && name.compare(name.size() - n, n, ext) == 0;
    };
    if (ends(".js")) return "text/javascript; charset=utf-8";
    if (ends(".css")) return "text/css; charset=utf-8";
    if (ends(".svg")) return "image/svg+xml";
    if (ends(".png")) return "image/png";
    if (ends(".woff2")) return "font/woff2";
    return "application/octet-stream";
}
}  // namespace

int HttpApi::onAsset(mg_connection* c, void* self) {
    auto* api = static_cast<HttpApi*>(self);
    if (!isGetOrHead(c)) return methodNotAllowed(c);
    if (const int blocked = api->filtered(c)) return blocked;
    const char* uri = mg_get_request_info(c)->local_uri;
    const std::string prefix = "/assets/";
    if (!uri || std::strncmp(uri, prefix.c_str(), prefix.size()) != 0) return notFound(c);
    const std::string name = uri + prefix.size();
    if (!api->assets_.count(name)) return notFound(c);  // allowlist built at startup
    std::string extra = "Cache-Control: public, max-age=31536000, immutable\r\n";
    // Feature 011 (L-17 of 007): an SVG opened on its own is a document; the CSP of the project
    // drawings applies to it too (no script, nothing loaded, sandbox).
    if (std::strcmp(assetType(name), "image/svg+xml") == 0)
        extra += std::string("Content-Security-Policy: ") + kCspProject + "\r\n";
    return serveFile(c, api->opt_.docroot + "/assets/" + name, assetType(name), extra, true);
}

int HttpApi::onProjectFile(mg_connection* c, void* self) {
    auto* api = static_cast<HttpApi*>(self);
    if (!isGetOrHead(c)) return methodNotAllowed(c);
    if (const int blocked = api->filtered(c)) return blocked;
    const char* uri = mg_get_request_info(c)->local_uri;
    const std::string prefix = "/project/";
    if (!uri || std::strncmp(uri, prefix.c_str(), prefix.size()) != 0) return notFound(c);
    const std::string rel = uri + prefix.size();
    // Only files listed by the validated project are served: no traversal, no directory listing.
    if (!api->opt_.projectAllowlist.count(rel)) return notFound(c);
    const std::string extra =
        std::string("Content-Security-Policy: ") + kCspProject + "\r\nCache-Control: no-cache\r\n";
    const bool json = rel.size() > 5 && rel.compare(rel.size() - 5, 5, ".json") == 0;
    return serveFile(c, api->opt_.projectDir + "/" + rel,
                     json ? "application/json" : "image/svg+xml", extra, false);
}

}  // namespace mat
