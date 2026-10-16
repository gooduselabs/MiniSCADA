#include "server/tests/tls_test_support.hpp"

#include <curl/curl.h>
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/ecp.h>
#include <mbedtls/entropy.h>
#include <mbedtls/pk.h>
#include <mbedtls/x509_crt.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#include <algorithm>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <utility>

namespace mat::test {

bool writeSelfSignedPem(const std::string& path, const std::string& commonName) {
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context drbg;
    mbedtls_pk_context key;
    mbedtls_x509write_cert crt;
    mbedtls_entropy_init(&entropy);
    mbedtls_ctr_drbg_init(&drbg);
    mbedtls_pk_init(&key);
    mbedtls_x509write_crt_init(&crt);
    unsigned char keyPem[1024] = {0};
    unsigned char crtPem[2048] = {0};
    unsigned char serial[16] = {0};
    const std::string name = "CN=" + commonName;
    const char pers[] = "mat-tls-test";
    bool ok =
        mbedtls_ctr_drbg_seed(&drbg, mbedtls_entropy_func, &entropy,
                              reinterpret_cast<const unsigned char*>(pers), sizeof pers - 1) == 0 &&
        mbedtls_pk_setup(&key, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY)) == 0 &&
        mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(key), mbedtls_ctr_drbg_random,
                            &drbg) == 0 &&
        mbedtls_ctr_drbg_random(&drbg, serial, sizeof serial) == 0;
    if (ok) {
        // A positive INTEGER in minimal DER: a leading 0x00 makes Mbed TLS write a non-minimal
        // encoding that OpenSSL rejects (about 1 run in 128 before this fix).
        serial[0] &= 0x7F;
        if (serial[0] == 0) serial[0] = 1;
        mbedtls_x509write_crt_set_version(&crt, MBEDTLS_X509_CRT_VERSION_3);
        mbedtls_x509write_crt_set_md_alg(&crt, MBEDTLS_MD_SHA256);
        mbedtls_x509write_crt_set_subject_key(&crt, &key);
        mbedtls_x509write_crt_set_issuer_key(&crt, &key);
        ok = mbedtls_x509write_crt_set_subject_name(&crt, name.c_str()) == 0 &&
             mbedtls_x509write_crt_set_issuer_name(&crt, name.c_str()) == 0 &&
             mbedtls_x509write_crt_set_serial_raw(&crt, serial, sizeof serial) == 0 &&
             mbedtls_x509write_crt_set_validity(&crt, "20000101000000", "99991231235959") == 0 &&
             mbedtls_x509write_crt_pem(&crt, crtPem, sizeof crtPem, mbedtls_ctr_drbg_random,
                                       &drbg) == 0 &&
             mbedtls_pk_write_key_pem(&key, keyPem, sizeof keyPem) == 0;
    }
    if (ok) {
        std::ofstream f(path, std::ios::binary | std::ios::trunc);
        f << reinterpret_cast<const char*>(keyPem) << reinterpret_cast<const char*>(crtPem);
        ok = static_cast<bool>(f);
        ::chmod(path.c_str(), 0600);
    }
    mbedtls_x509write_crt_free(&crt);
    mbedtls_pk_free(&key);
    mbedtls_ctr_drbg_free(&drbg);
    mbedtls_entropy_free(&entropy);
    return ok;
}

namespace {

int tlsHandler(mg_connection* c, void*) {
    const std::string body = mg_get_request_info(c)->is_ssl ? "ok-tls" : "ok-plain";
    mg_send_http_ok(c, "text/plain", static_cast<long long>(body.size()));
    mg_write(c, body.data(), body.size());
    return 200;
}

TlsTestServer* serverOf(const mg_connection* conn) {
    return static_cast<TlsTestServer*>(mg_get_user_data(mg_get_context(conn)));
}

}  // namespace

TlsTestServer::TlsTestServer(const std::vector<std::string>& options) {
    char tmpl[] = "/tmp/mat-tls-test-XXXXXX";
    if (::mkdtemp(tmpl) == nullptr) return;
    dir_ = tmpl;
    pem_ = dir_ + "/server.pem";
    if (!writeSelfSignedPem(pem_)) return;
    std::vector<std::pair<std::string, std::string>> opts = {{"listening_ports", "127.0.0.1:0s"},
                                                             {"ssl_certificate", pem_},
                                                             {"num_threads", "4"},
                                                             {"request_timeout_ms", "10000"}};
    for (size_t i = 0; i + 1 < options.size(); i += 2) {
        const auto same = [&](const auto& o) { return o.first == options[i]; };
        const auto it = std::find_if(opts.begin(), opts.end(), same);
        if (it != opts.end())
            it->second = options[i + 1];  // CivetWeb logs a warning for a repeated option
        else
            opts.emplace_back(options[i], options[i + 1]);
    }
    std::vector<const char*> argv;
    for (const auto& o : opts) {
        argv.push_back(o.first.c_str());
        argv.push_back(o.second.c_str());
    }
    argv.push_back(nullptr);
    mg_init_library(0);
    library_ = true;
    mg_callbacks cb{};
    cb.log_message = &TlsTestServer::onLog;
    cb.connection_closed = &TlsTestServer::onClosed;
    ctx = mg_start(&cb, this, argv.data());
    mg_server_port ports[1];
    if (ctx && mg_get_server_ports(ctx, 1, ports) == 1 && ports[0].is_ssl) port = ports[0].port;
    if (ctx) mg_set_request_handler(ctx, "/tls", tlsHandler, nullptr);
}

TlsTestServer::~TlsTestServer() {
    stop();
    if (!pem_.empty()) std::remove(pem_.c_str());
    if (!dir_.empty()) ::rmdir(dir_.c_str());
}

void TlsTestServer::stop() {
    if (ctx) mg_stop(ctx);
    ctx = nullptr;
    if (library_) mg_exit_library();
    library_ = false;
}

std::vector<std::string> TlsTestServer::errorLog() const {
    std::lock_guard<std::mutex> lock(logMutex_);
    return log_;
}

int TlsTestServer::onLog(const mg_connection* conn, const char* message) {
    TlsTestServer* self = serverOf(conn);
    if (self == nullptr) return 0;
    std::lock_guard<std::mutex> lock(self->logMutex_);
    self->log_.emplace_back(message);
    return 1;  // handled: no error_log_file
}

void TlsTestServer::onClosed(const mg_connection* conn) {
    if (TlsTestServer* self = serverOf(conn)) ++self->closed_;
}

namespace {

void curlGlobalInit() {
    static std::once_flag once;
    std::call_once(once, [] {
        // CURLOPT_NOSIGNAL below: libcurl does not ignore SIGPIPE itself (CivetWeb also does).
        std::signal(SIGPIPE, SIG_IGN);
        curl_global_init(CURL_GLOBAL_DEFAULT);
    });
}

size_t appendTo(char* data, size_t size, size_t n, void* out) {
    static_cast<std::string*>(out)->append(data, size * n);
    return size * n;
}

int keepInfoText(CURL*, curl_infotype type, char* data, size_t size, void* out) {
    if (type == CURLINFO_TEXT) static_cast<std::string*>(out)->append(data, size);
    return 0;
}

}  // namespace

std::string httpsUrl(int port) { return "https://127.0.0.1:" + std::to_string(port); }

CurlClient::CurlClient(std::string baseUrl, ClientOptions options)
    : base_(std::move(baseUrl)), options_(std::move(options)) {
    curlGlobalInit();
    curl_ = curl_easy_init();
}

CurlClient::~CurlClient() { close(); }

void CurlClient::close() {
    if (curl_) curl_easy_cleanup(static_cast<CURL*>(curl_));
    curl_ = nullptr;
}

HttpResult CurlClient::request(const HttpRequest& req) { return perform(&req); }

HttpResult CurlClient::handshake() { return perform(nullptr); }

int CurlClient::socket() const {
    curl_socket_t s = CURL_SOCKET_BAD;
    if (curl_ == nullptr ||
        curl_easy_getinfo(static_cast<CURL*>(curl_), CURLINFO_ACTIVESOCKET, &s) != CURLE_OK)
        return -1;
    return s == CURL_SOCKET_BAD ? -1 : static_cast<int>(s);
}

HttpResult CurlClient::perform(const HttpRequest* req) {
    HttpResult r;
    CURL* c = static_cast<CURL*>(curl_);
    if (c == nullptr) {
        r.error = "no libcurl handle";
        return r;
    }
    // Options go back to their defaults; the open connection stays for reuse.
    curl_easy_reset(c);
    char error[CURL_ERROR_SIZE] = {0};
    info_.clear();
    curl_easy_setopt(c, CURLOPT_ERRORBUFFER, error);
    curl_easy_setopt(c, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(c, CURLOPT_PROXY, "");
    curl_easy_setopt(c, CURLOPT_HTTP_VERSION, static_cast<long>(CURL_HTTP_VERSION_1_1));
    curl_easy_setopt(c, CURLOPT_TIMEOUT_MS, options_.timeoutMs);
    curl_easy_setopt(c, CURLOPT_SSL_VERIFYPEER, 0L);
    curl_easy_setopt(c, CURLOPT_SSL_VERIFYHOST, 0L);
    long version = CURL_SSLVERSION_DEFAULT;
    if (options_.tls == TlsVersion::Tls12)
        version = CURL_SSLVERSION_TLSv1_2 | CURL_SSLVERSION_MAX_TLSv1_2;
    else if (options_.tls == TlsVersion::Tls13)
        version = CURL_SSLVERSION_TLSv1_3;
    curl_easy_setopt(c, CURLOPT_SSLVERSION, version);
    if (!options_.ciphers.empty())
        curl_easy_setopt(c, CURLOPT_SSL_CIPHER_LIST, options_.ciphers.c_str());
    const std::string iface = "host!" + options_.localAddress;
    if (!options_.localAddress.empty()) curl_easy_setopt(c, CURLOPT_INTERFACE, iface.c_str());
    // Verbose text goes to info_, never to stderr (tests capture stderr).
    curl_easy_setopt(c, CURLOPT_VERBOSE, 1L);
    curl_easy_setopt(c, CURLOPT_DEBUGFUNCTION, keepInfoText);
    curl_easy_setopt(c, CURLOPT_DEBUGDATA, &info_);

    const std::string url = base_ + (req ? req->path : "/");
    curl_easy_setopt(c, CURLOPT_URL, url.c_str());
    curl_slist* headers = nullptr;
    if (req == nullptr) {
        curl_easy_setopt(c, CURLOPT_CONNECT_ONLY, 1L);
    } else {
        headers = curl_slist_append(headers, "Expect:");  // no 100-continue round trip
        for (const auto& h : req->headers) headers = curl_slist_append(headers, h.c_str());
        curl_easy_setopt(c, CURLOPT_HTTPHEADER, headers);
        if (req->method == "HEAD") {
            curl_easy_setopt(c, CURLOPT_NOBODY, 1L);
        } else if (req->method != "GET" || !req->body.empty()) {
            curl_easy_setopt(c, CURLOPT_CUSTOMREQUEST, req->method.c_str());
            if (!req->body.empty() || req->method == "POST" || req->method == "PUT") {
                curl_easy_setopt(c, CURLOPT_POSTFIELDSIZE, static_cast<long>(req->body.size()));
                curl_easy_setopt(c, CURLOPT_COPYPOSTFIELDS, req->body.c_str());
            }
        }
        curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, appendTo);
        curl_easy_setopt(c, CURLOPT_WRITEDATA, &r.body);
        curl_easy_setopt(c, CURLOPT_HEADERFUNCTION, appendTo);
        curl_easy_setopt(c, CURLOPT_HEADERDATA, &r.headers);
    }
    const CURLcode code = curl_easy_perform(c);
    r.curlCode = static_cast<int>(code);
    r.error = error[0] ? error : curl_easy_strerror(code);
    curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &r.status);
    r.info = info_;
    // The handle must not keep pointers into this call's buffers.
    curl_easy_setopt(c, CURLOPT_ERRORBUFFER, static_cast<char*>(nullptr));
    curl_easy_setopt(c, CURLOPT_HTTPHEADER, static_cast<curl_slist*>(nullptr));
    curl_slist_free_all(headers);
    return r;
}

HttpResult httpsGet(int port, const std::string& path, const ClientOptions& options) {
    CurlClient client(httpsUrl(port), options);
    HttpRequest req;
    req.path = path;
    return client.request(req);
}

double processCpuMs() {
    rusage u{};
    ::getrusage(RUSAGE_SELF, &u);
    return static_cast<double>(u.ru_utime.tv_sec + u.ru_stime.tv_sec) * 1e3 +
           static_cast<double>(u.ru_utime.tv_usec + u.ru_stime.tv_usec) / 1e3;
}

StderrCapture::StderrCapture() {
    char tmpl[] = "/tmp/mat-stderr-XXXXXX";
    const int fd = ::mkstemp(tmpl);
    if (fd < 0) return;
    path_ = tmpl;
    std::fflush(stderr);
    saved_ = ::dup(STDERR_FILENO);
    ::dup2(fd, STDERR_FILENO);
    ::close(fd);
}

StderrCapture::~StderrCapture() { finish(); }

std::string StderrCapture::finish() {
    if (saved_ < 0) return "";
    std::fflush(stderr);
    ::dup2(saved_, STDERR_FILENO);
    ::close(saved_);
    saved_ = -1;
    std::ifstream f(path_, std::ios::binary);
    std::ostringstream text;
    text << f.rdbuf();
    std::remove(path_.c_str());
    return text.str();
}

CommandResult runCommand(const std::string& cmd) {
    CommandResult r;
    FILE* p = ::popen((cmd + " 2>&1").c_str(), "r");
    if (p == nullptr) return r;
    char buf[4096];
    size_t n;
    while ((n = std::fread(buf, 1, sizeof buf, p)) > 0) r.out.append(buf, n);
    const int status = ::pclose(p);
    r.code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
    return r;
}

bool haveTool(const char* name) {
    return std::system((std::string("command -v ") + name + " >/dev/null 2>&1").c_str()) == 0;
}

}  // namespace mat::test
