// The two CivetWeb contexts of mat-runtime (feature 005; research R5, ADR-010,
// contracts/device-config.md §7 step 8): HTTP for the runtime page and its read-only API, exactly
// as in 0.3.0 (FR-033), and HTTPS for the same plus the engineering API, with its own small pool of
// workers. A failure of HTTPS (certificate, port, TLS set-up) never stops HTTP. main and the tests
// open them with the same options; the handlers are installed by their owners afterwards.
#pragma once
#include <string>

#include "server/device_state.hpp"

struct mg_context;

namespace mat {

struct ServerCert;
class HostPolicy;

struct WebOptions {
    std::string httpListen = "8080";  // listening_ports of the HTTP context
    int httpThreads = 24;
    // listening_ports of the HTTPS context, e.g. "8443s" ("127.0.0.1:0s" in tests); "": HTTPS off
    // (httpsPort = 0).
    std::string httpsListen;
    int httpsThreads = 40;  // 007: a live socket and an idle keep-alive connection each hold a
                            // worker (see config.hpp)
    // Feature 011 (device-api-011 §1): the check of Host, run on both contexts before anything
    // else (begin_request). Null: no check (tests of the other features). Must outlive the
    // contexts.
    const HostPolicy* hostPolicy = nullptr;
};

// Timeouts of both contexts. HTTPS: a request (and the TLS handshake, mAT patch 3) has 10 s; an
// idle connection between requests stays open 3 s and holds one of the httpsThreads workers
// meanwhile (ADR-010: 60 s → 15 s on 2026-10-12; 15 s → 3 s on 2026-10-16, when 10 pages pressing
// F5 together kept 41 connections for 40 workers and live sockets waited 8 s for a worker). The
// Studio drops its idle connections after 2 s, before the server does.
constexpr int kRequestTimeoutMs = 10000;
constexpr int kHttpsKeepAliveMs = 3000;

class WebContexts {
   public:
    WebContexts();   // mg_init_library
    ~WebContexts();  // stop(), mg_exit_library
    WebContexts(const WebContexts&) = delete;
    WebContexts& operator=(const WebContexts&) = delete;

    // The HTTP context. false, with `error`, when it cannot open (port taken): mat-runtime exits 3.
    bool startHttp(const WebOptions& options, std::string& error);
    // The HTTPS context, after the certificate step: Off when options.httpsListen is empty,
    // CertError when the certificate is not usable (no listener then), TlsError when CivetWeb
    // cannot open the listener (`error` says why), Ok otherwise.
    HttpsState startHttps(const WebOptions& options, const ServerCert& cert, std::string& error);
    // HTTPS first, then HTTP. When it returns every connection is closed and every close handler
    // has run. Idempotent.
    void stop();

    mg_context* http() const { return http_; }
    mg_context* https() const { return https_; }
    int httpPort() const { return httpPort_; }    // bound port; 0 when not running
    int httpsPort() const { return httpsPort_; }  // bound port; 0 when not running

   private:
    mg_context* http_ = nullptr;
    mg_context* https_ = nullptr;
    int httpPort_ = 0;
    int httpsPort_ = 0;
};

}  // namespace mat
