#include "server/http/web_contexts.hpp"

#include <exception>
#include <string>

#include "civetweb.h"
#include "server/host_policy.hpp"
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
    const auto* policy = static_cast<const HostPolicy*>(mg_get_user_data(mg_get_context(c)));
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
              "X-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
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

// mg_start2 with the error text of CivetWeb (port taken, certificate refused, …).
mg_context* startContext(const char** options, const HostPolicy* host, std::string& error) {
    char text[256] = {0};
    mg_error_data err{};
    err.text = text;
    err.text_buffer_size = sizeof text;
    mg_callbacks callbacks{};
    callbacks.begin_request = onBeginRequest;
    mg_init_data init{};
    init.callbacks = &callbacks;
    init.user_data = const_cast<HostPolicy*>(host);  // read back as const by checkHost
    init.configuration_options = options;
    mg_context* ctx = mg_start2(&init, &err);
    if (ctx == nullptr) error = text[0] ? text : "CivetWeb error " + std::to_string(err.code);
    return ctx;
}

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
                          "X-Content-Type-Options: nosniff",
                          nullptr};
    http_ = startContext(opts, o.hostPolicy, error);
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
                          "X-Content-Type-Options: nosniff",
                          nullptr};
    https_ = startContext(opts, o.hostPolicy, error);
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
