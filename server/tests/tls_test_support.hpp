// In-process HTTPS for x64 tests (feature 005): a CivetWeb HTTPS context (civetweb_runtime, i.e.
// USE_MBEDTLS with the mAT patches) on 127.0.0.1 with a random port and a key and certificate
// generated at run time; a TLS client on the libcurl + OpenSSL of the toolchain image (Mbed TLS is
// configured server-only); process helpers to measure CPU and capture stderr.
// Used by https_handshake_test (T036) and https_api_test (T041). No key material is committed:
// each server writes a fresh key into its own temporary directory and deletes it.
#pragma once
#include <atomic>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

#include "civetweb.h"

namespace mat::test {

// Writes a new self-signed ECDSA P-256 key and X.509 v3 certificate into one PEM file (key first,
// then certificate; mode 0600), the layout research R5 plans for <dataDir>/tls/server.pem.
// Returns false on any Mbed TLS or file error.
bool writeSelfSignedPem(const std::string& path, const std::string& commonName = "mAT test");

// CivetWeb HTTPS context on 127.0.0.1 with a random port. GET /tls answers "ok-tls" (Content-Length
// set; keep-alive follows the context options). Counts closed connections and keeps CivetWeb's
// error log.
class TlsTestServer {
   public:
    // `options`: CivetWeb options as name/value pairs. They replace the defaults (num_threads 4,
    // request_timeout_ms 10000, like the runtime) or add to them.
    explicit TlsTestServer(const std::vector<std::string>& options = {});
    ~TlsTestServer();
    TlsTestServer(const TlsTestServer&) = delete;
    TlsTestServer& operator=(const TlsTestServer&) = delete;

    // mg_stop(): returns when every worker has ended.
    void stop();
    // Connections CivetWeb has closed (callback connection_closed), failed handshakes included.
    int closedConnections() const { return closed_.load(); }
    // Lines CivetWeb sent to its error log (callback log_message).
    std::vector<std::string> errorLog() const;
    const std::string& certPath() const { return pem_; }

    mg_context* ctx = nullptr;
    int port = 0;  // 0 when the context did not start

   private:
    static int onLog(const mg_connection* conn, const char* message);
    static void onClosed(const mg_connection* conn);

    std::string dir_, pem_;
    bool library_ = false;
    std::atomic<int> closed_{0};
    mutable std::mutex logMutex_;
    std::vector<std::string> log_;
};

enum class TlsVersion { Default, Tls12, Tls13 };  // Default: what libcurl offers (TLS 1.2 to 1.3)

struct ClientOptions {
    ClientOptions() = default;
    ClientOptions(TlsVersion version, std::string cipherList = {})
        : tls(version), ciphers(std::move(cipherList)) {}

    TlsVersion tls = TlsVersion::Default;
    std::string ciphers;  // TLS 1.2 suites, OpenSSL names (CURLOPT_SSL_CIPHER_LIST); empty: default
    long timeoutMs = 10000;
    // Feature 011 (T039): the source address of the connection ("127.0.0.2"); empty: any.
    std::string localAddress;
};

struct HttpRequest {
    std::string method = "GET";
    std::string path = "/";
    std::vector<std::string> headers;  // "Name: value"
    std::string body;
};

struct HttpResult {
    int curlCode = -1;    // CURLcode: 0 success, 35 a failed TLS handshake
    std::string error;    // libcurl's error text
    long status = 0;      // HTTP status, 0 without a response
    std::string headers;  // raw response header lines
    std::string body;
    std::string info;  // libcurl's verbose text, e.g. "SSL connection using TLSv1.3 / TLS_..."
    bool ok() const { return curlCode == 0; }
};

// "https://127.0.0.1:<port>"
std::string httpsUrl(int port);

// A libcurl easy handle (HTTP/1.1) on one server: requests reuse the connection while the server
// keeps it open. The certificate is not verified: the Studio pins its fingerprint instead
// (research R6). close() and the destructor send close_notify, then close the TCP connection.
class CurlClient {
   public:
    // `baseUrl`: scheme, host and port, e.g. httpsUrl(port) or "http://127.0.0.1:8080".
    explicit CurlClient(std::string baseUrl, ClientOptions options = {});
    ~CurlClient();
    CurlClient(const CurlClient&) = delete;
    CurlClient& operator=(const CurlClient&) = delete;

    HttpResult request(const HttpRequest& req);
    // TCP connect and TLS handshake, no request (CURLOPT_CONNECT_ONLY); afterwards only close().
    HttpResult handshake();
    // Socket of the open connection, -1 when there is none.
    int socket() const;
    void close();

   private:
    HttpResult perform(const HttpRequest* req);

    std::string base_;
    ClientOptions options_;
    void* curl_ = nullptr;  // CURL*
    std::string info_;      // libcurl's verbose text, written until the handle is cleaned up
};

// One request on a fresh connection, closed afterwards.
HttpResult httpsGet(int port, const std::string& path, const ClientOptions& options = {});

// User + system CPU time of the whole process (every thread, CivetWeb workers included), in ms.
double processCpuMs();

// Sends what the process writes to stderr (fd 2) into a temporary file until finish(), which
// restores stderr and returns the text. CivetWeb prints its TLS read and write errors there.
class StderrCapture {
   public:
    StderrCapture();
    ~StderrCapture();
    StderrCapture(const StderrCapture&) = delete;
    StderrCapture& operator=(const StderrCapture&) = delete;
    std::string finish();

   private:
    int saved_ = -1;
    std::string path_;
};

struct CommandResult {
    int code = -1;
    std::string out;  // stdout and stderr
};

CommandResult runCommand(const std::string& cmd);
bool haveTool(const char* name);

}  // namespace mat::test
