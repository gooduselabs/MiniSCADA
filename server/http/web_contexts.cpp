#include "server/http/web_contexts.hpp"

#include <string>

#include "civetweb.h"
#include "server/tls/server_cert.hpp"

namespace mat {

namespace {

// mg_start2 with the error text of CivetWeb (port taken, certificate refused, …).
mg_context* startContext(const char** options, std::string& error) {
    char text[256] = {0};
    mg_error_data err{};
    err.text = text;
    err.text_buffer_size = sizeof text;
    mg_callbacks callbacks{};
    mg_init_data init{};
    init.callbacks = &callbacks;
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
    http_ = startContext(opts, error);
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
    https_ = startContext(opts, error);
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
