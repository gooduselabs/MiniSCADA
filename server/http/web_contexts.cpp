#include "server/http/web_contexts.hpp"

#include <exception>
#include <string>

#include "civetweb.h"
#include "server/host_policy.hpp"
#include "server/http/conn_limit.hpp"
#include "server/tls/server_cert.hpp"

namespace mat {

namespace {

bool loopbackAddress(const std::string& ip) {
    return ip.rfind("127.", 0) == 0 || ip == "::1" || ip.rfind("::ffff:127.", 0) == 0;
}

// Feature 011 (device-api-011 §1): CivetWeb calls this for every request of the context, the
// WebSocket upgrades included, before it looks for a handler, so the check of Host comes before the
// source filter, the gate, the files and the Origin check. 0: CivetWeb goes on; otherwise the
// refusal was sent (the connection closes) and this is its status.
int checkHost(mg_connection* c) {
    const auto* hooks = static_cast<const WebContexts::Hooks*>(mg_get_user_data(mg_get_context(c)));
    const HostPolicy* policy = hooks ? hooks->host : nullptr;
    if (policy == nullptr || !policy->enabled()) return 0;
    const mg_request_info* ri = mg_get_request_info(c);
    HostRequest r;
    for (int i = 0; i < ri->num_headers; ++i)
        if (ri->http_headers[i].name && mg_strcasecmp(ri->http_headers[i].name, "Host") == 0)
            r.hosts.emplace_back(ri->http_headers[i].value ? ri->http_headers[i].value : "");
    const std::string ip = ri->remote_addr;
    r.http10 = ri->http_version && std::string(ri->http_version) == "1.0";
    r.loopback = loopbackAddress(ip);
    const HostVerdict v = policy->check(r);
    if (v == HostVerdict::Accept) return 0;
    const std::string source = (ip.find(':') != std::string::npos ? "[" + ip + "]" : ip) + ":" +
                               std::to_string(ri->remote_port);
    policy->recordDenied(v, r, ri->local_uri ? ri->local_uri : "", source, ri->is_ssl != 0);
    const int status = HostPolicy::status(v);
    const std::string body = HostPolicy::body(v);
    mg_disable_connection_keep_alive(c);
    mg_printf(c,
              "HTTP/1.1 %d %s\r\nContent-Type: application/json; charset=utf-8\r\n"
              "Content-Length: %zu\r\nCache-Control: no-store\r\n"
              "X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: "
              "close\r\n\r\n",
              status, status == 421 ? "Misdirected Request" : "Bad Request", body.size());
    mg_write(c, body.data(), body.size());
    return status;
}

int onBeginRequest(mg_connection* c) {
    try {  // an exception here would end the runtime from inside CivetWeb
        return checkHost(c);
    } catch (const std::exception&) {
        mg_disable_connection_keep_alive(c);
        mg_printf(c,
                  "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n"
                  "Connection: close\r\n\r\n");
        return 500;
    }
}

// Feature 011 (FR-025, mAT patch 5): the master thread asks before a socket waits for a worker;
// the worker gives the place back when the connection ends. HTTP and HTTPS share the limiter; each
// context has its own share of it (M1 of the security review of 011).
int onAccept(const mg_context* ctx, const sockaddr* peer) {
    const auto* hooks = static_cast<const WebContexts::Hooks*>(mg_get_user_data(ctx));
    if (hooks == nullptr || hooks->limiter == nullptr) return 1;
    try {
        return hooks->limiter->acquire(sourceAddress(peer), hooks->context) ? 1 : 0;
    } catch (const std::exception&) {
        return 0;  // out of memory: refusing is the safe side
    }
}

void onRelease(const mg_context* ctx, const sockaddr* peer) {
    const auto* hooks = static_cast<const WebContexts::Hooks*>(mg_get_user_data(ctx));
    if (hooks == nullptr || hooks->limiter == nullptr) return;
    try {
        hooks->limiter->release(sourceAddress(peer), hooks->context);
    } catch (const std::exception&) {
    }
}

// mg_start2 with the error text of CivetWeb (port taken, certificate refused, …).
mg_context* startContext(const char** options, WebContexts::Hooks* hooks, std::string& error) {
    char text[256] = {0};
    mg_error_data err{};
    err.text = text;
    err.text_buffer_size = sizeof text;
    mg_callbacks callbacks{};
    callbacks.begin_request = onBeginRequest;
    callbacks.mat_accept = onAccept;
    callbacks.mat_release = onRelease;
    mg_init_data init{};
    init.callbacks = &callbacks;
    init.user_data = hooks;  // read back by checkHost, onAccept, onRelease
    init.configuration_options = options;
    mg_context* ctx = mg_start2(&init, &err);
    if (ctx == nullptr) error = text[0] ? text : "CivetWeb error " + std::to_string(err.code);
    return ctx;
}

// Headers CivetWeb adds to the responses it makes itself (feature 011, L-17 of 007: no address of
// the device leaks through the Referer header); the handlers write the same two lines.
const char* const kAdditionalHeaders =
    "X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer";

int boundPort(const mg_context* ctx) {
    mg_server_port ports[1];
    return mg_get_server_ports(ctx, 1, ports) == 1 ? ports[0].port : 0;
}

}  // namespace

WebContexts::WebContexts() { mg_init_library(0); }

WebContexts::~WebContexts() {
    stop();
    mg_exit_library();
}

bool WebContexts::startHttp(const WebOptions& o, std::string& error) {
    const std::string threads = std::to_string(o.httpThreads);
    const std::string timeout = std::to_string(kRequestTimeoutMs);
    // As in 0.3.0: no keep-alive (CivetWeb's default), every response closes its connection.
    const char* opts[] = {"listening_ports",
                          o.httpListen.c_str(),
                          "num_threads",
                          threads.c_str(),
                          "request_timeout_ms",
                          timeout.c_str(),
                          "websocket_timeout_ms",
                          "5000",
                          "enable_websocket_ping_pong",
                          "yes",
                          "additional_header",
                          kAdditionalHeaders,
                          nullptr};
    httpHooks_ = Hooks{o.hostPolicy, o.connLimiter, kHttpContext};
    // M1: one source holds at most 75 % of the HTTP workers (18 of 24), not only of the HTTPS ones.
    if (o.connLimiter)
        o.connLimiter->setContextLimit(
            kHttpContext, effectiveMaxConnPerSource(o.connLimiter->maxPerSource(), o.httpThreads));
    http_ = startContext(opts, &httpHooks_, error);
    httpPort_ = http_ ? boundPort(http_) : 0;
    return http_ != nullptr;
}

HttpsState WebContexts::startHttps(const WebOptions& o, const ServerCert& cert,
                                   std::string& error) {
    if (o.httpsListen.empty()) return HttpsState::Off;
    if (!cert.ok) {
        error = cert.error;
        return HttpsState::CertError;
    }
    const std::string threads = std::to_string(o.httpsThreads);
    const std::string timeout = std::to_string(kRequestTimeoutMs);
    const std::string keepAlive = std::to_string(kHttpsKeepAliveMs);
    // TLS policy (versions, suites, curves) is in third_party/mbedtls-config: with Mbed TLS,
    // CivetWeb's ssl_protocol_version and ssl_cipher_list do nothing (T007).
    const char* opts[] = {"listening_ports",
                          o.httpsListen.c_str(),
                          "ssl_certificate",
                          cert.pemPath.c_str(),
                          "num_threads",
                          threads.c_str(),
                          "request_timeout_ms",
                          timeout.c_str(),
                          "enable_keep_alive",
                          "yes",
                          "keep_alive_timeout_ms",
                          keepAlive.c_str(),
                          "websocket_timeout_ms",
                          "5000",
                          "enable_websocket_ping_pong",
                          "yes",
                          "additional_header",
                          kAdditionalHeaders,
                          nullptr};
    httpsHooks_ = Hooks{o.hostPolicy, o.connLimiter, kHttpsContext};
    if (o.connLimiter)
        o.connLimiter->setContextLimit(
            kHttpsContext,
            effectiveMaxConnPerSource(o.connLimiter->maxPerSource(), o.httpsThreads));
    https_ = startContext(opts, &httpsHooks_, error);
    if (https_ == nullptr) return HttpsState::TlsError;
    httpsPort_ = boundPort(https_);
    return HttpsState::Ok;
}

void WebContexts::stop() {
    if (https_) mg_stop(https_);
    https_ = nullptr;
    httpsPort_ = 0;
    if (http_) mg_stop(http_);
    http_ = nullptr;
    httpPort_ = 0;
}

}  // namespace mat
