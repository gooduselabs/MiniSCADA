// T041 (feature 005; contracts/device-api.md §1–§3, live-protocol-1.1.md §1, research R5, R9,
// R10, FR-007, FR-033, Constitution IV and V): the two listeners of mat-runtime in process, as
// main opens them (WebContexts), with the real audit log, sign-in service, certificate module and
// live transport; clients are libcurl (HTTP, HTTPS, and WebSocket over TLS through
// CURLOPT_CONNECT_ONLY) and the raw WebSocket client of civet_test_support.
// - HTTP serves exactly what 0.3.0 served, without signing in; HTTPS serves the same plus the
//   engineering API; the engineering API over HTTP is 403 HTTPS_REQUIRED and audited.
// - One limit of 10 live sessions for both listeners: 6 ws + 5 wss → the 11th gets 4429.
// - system/info: block "device" (https ok / off / cert-error / tls-error), project.digest,
//   operation null, nothing secret; projects/active has the digest.
// - device/identity, auth/login, auth/logout, auth/session with their codes and headers; body
//   limits, 405 with Allow, no CORS; the test passwords leave no trace.
#include <curl/curl.h>
#include <gtest/gtest.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/auth/auth_service.hpp"
#include "core/auth/tests/auth_test_support.hpp"
#include "core/package/project_digest.hpp"
#include "core/project-manager/project_validator.hpp"
#include "nlohmann/json.hpp"
#include "server/device_state.hpp"
#include "server/http/engineering_api.hpp"
#include "server/http/http_api.hpp"
#include "server/http/web_contexts.hpp"
#include "server/startup.hpp"
#include "server/tests/civet_test_support.hpp"
#include "server/tests/tls_test_support.hpp"
#include "server/tls/server_cert.hpp"
#include "server/websocket/civet_transport.hpp"
#include "server/websocket/live_hub.hpp"

using namespace mat;
using nlohmann::json;
using test::CurlClient;
using test::HttpRequest;
using test::HttpResult;
using test::TempDir;

namespace {

const std::string kVectors = std::string(MAT_SOURCE_DIR) + "/tests/project-vectors";
const std::string kSchemas = std::string(MAT_SOURCE_DIR) + "/schemas";
const std::string kProject = "valid-minimal";
constexpr int64_t kMin = 60 * 1000;

std::string fileText(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    std::stringstream s;
    s << in.rdbuf();
    return s.str();
}

std::string expectedDigest() {
    return json::parse(fileText(kVectors + "/" + kProject + "/expected.json"))["digest"];
}

int64_t monoNow() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

// Value of a response header (name in any case), "" when absent.
std::string header(const HttpResult& r, const std::string& name) {
    std::istringstream lines(r.headers);
    std::string line;
    std::string lower = name;
    std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
    std::string found;
    while (std::getline(lines, line)) {
        const size_t colon = line.find(':');
        if (colon == std::string::npos) continue;
        std::string key = line.substr(0, colon);
        std::transform(key.begin(), key.end(), key.begin(), ::tolower);
        if (key != lower) continue;
        std::string value = line.substr(colon + 1);
        while (!value.empty() && (value.front() == ' ')) value.erase(0, 1);
        while (!value.empty() && (value.back() == '\r' || value.back() == ' ')) value.pop_back();
        found = value;
    }
    return found;
}

bool hasHeaderPrefix(const HttpResult& r, const std::string& prefix) {
    std::string h = r.headers, p = prefix;
    std::transform(h.begin(), h.end(), h.begin(), ::tolower);
    std::transform(p.begin(), p.end(), p.begin(), ::tolower);
    return h.find("\n" + p) != std::string::npos;
}

// The body as a JSON object; an empty object when it is not one, so that a wrong answer fails an
// assertion instead of throwing.
json bodyJson(const HttpResult& r) {
    json j = json::parse(r.body, nullptr, false);
    return j.is_object() ? j : json::object();
}

HttpRequest req(const std::string& method, const std::string& path, const std::string& body = "",
                std::vector<std::string> headers = {}) {
    HttpRequest q;
    q.method = method;
    q.path = path;
    q.body = body;
    q.headers = std::move(headers);
    return q;
}

std::string loginBody(const std::string& user, const std::string& password) {
    return json{{"user", user}, {"password", password}}.dump();
}

size_t appendText(char* data, size_t size, size_t n, void* out) {
    static_cast<std::string*>(out)->append(data, size * n);
    return size * n;
}

// POST of a JSON body over HTTPS from another loopback address (`localIp`, e.g. 127.0.0.2): the
// sign-in sees another client address.
HttpResult postFrom(const std::string& localIp, const std::string& url, const std::string& body) {
    HttpResult r;
    CURL* c = curl_easy_init();
    curl_slist* headers = curl_slist_append(nullptr, "Content-Type: application/json");
    headers = curl_slist_append(headers, "Expect:");
    curl_easy_setopt(c, CURLOPT_URL, url.c_str());
    curl_easy_setopt(c, CURLOPT_INTERFACE, localIp.c_str());
    curl_easy_setopt(c, CURLOPT_SSL_VERIFYPEER, 0L);
    curl_easy_setopt(c, CURLOPT_SSL_VERIFYHOST, 0L);
    curl_easy_setopt(c, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(c, CURLOPT_PROXY, "");
    curl_easy_setopt(c, CURLOPT_TIMEOUT_MS, 10000L);
    curl_easy_setopt(c, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(c, CURLOPT_POSTFIELDSIZE, static_cast<long>(body.size()));
    curl_easy_setopt(c, CURLOPT_COPYPOSTFIELDS, body.c_str());
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, appendText);
    curl_easy_setopt(c, CURLOPT_WRITEDATA, &r.body);
    curl_easy_setopt(c, CURLOPT_HEADERFUNCTION, appendText);
    curl_easy_setopt(c, CURLOPT_HEADERDATA, &r.headers);
    r.curlCode = static_cast<int>(curl_easy_perform(c));
    r.error = curl_easy_strerror(static_cast<CURLcode>(r.curlCode));
    curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &r.status);
    curl_slist_free_all(headers);
    curl_easy_cleanup(c);
    return r;
}

// A TCP listener that keeps a port busy (tls-error test).
struct TakenPort {
    int fd = -1;
    int port = 0;
    TakenPort() {
        fd = ::socket(AF_INET, SOCK_STREAM, 0);
        sockaddr_in a{};
        a.sin_family = AF_INET;
        a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        socklen_t len = sizeof a;
        if (::bind(fd, reinterpret_cast<sockaddr*>(&a), sizeof a) == 0 && ::listen(fd, 4) == 0 &&
            ::getsockname(fd, reinterpret_cast<sockaddr*>(&a), &len) == 0)
            port = ntohs(a.sin_port);
    }
    ~TakenPort() {
        if (fd >= 0) ::close(fd);
    }
};

// WebSocket over TLS: libcurl makes the TCP connection and the TLS handshake
// (CURLOPT_CONNECT_ONLY), then the upgrade and the frames go through curl_easy_send/recv.
class WssClient {
   public:
    using Frame = test::WsClient::Frame;
    ~WssClient() { close(); }

    bool connect(int port, const std::string& path = "/api/v1/live") {
        curl_ = curl_easy_init();
        if (!curl_) return false;
        const std::string url = test::httpsUrl(port) + "/";
        curl_easy_setopt(curl_, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl_, CURLOPT_CONNECT_ONLY, 1L);
        curl_easy_setopt(curl_, CURLOPT_SSL_VERIFYPEER, 0L);
        curl_easy_setopt(curl_, CURLOPT_SSL_VERIFYHOST, 0L);
        curl_easy_setopt(curl_, CURLOPT_NOSIGNAL, 1L);
        curl_easy_setopt(curl_, CURLOPT_PROXY, "");
        curl_easy_setopt(curl_, CURLOPT_TIMEOUT_MS, 5000L);
        if (curl_easy_perform(curl_) != CURLE_OK) return false;
        curl_socket_t s = CURL_SOCKET_BAD;
        curl_easy_getinfo(curl_, CURLINFO_ACTIVESOCKET, &s);
        sock_ = static_cast<int>(s);
        if (!sendAll("GET " + path +
                     " HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: "
                     "Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
                     "Sec-WebSocket-Version: 13\r\n\r\n"))
            return false;
        std::string head;
        char c;
        while (head.find("\r\n\r\n") == std::string::npos)
            if (recvSome(&c, 1, 3000) != 1)
                return false;
            else
                head += c;
        return head.compare(0, 12, "HTTP/1.1 101") == 0;
    }

    Frame read(int timeoutMs) {
        Frame f;
        unsigned char h[2];
        const int got = readExact(reinterpret_cast<char*>(h), 2, timeoutMs);
        if (got == 0) f.opcode = -2;
        if (got != 2) return f;
        uint64_t len = h[1] & 0x7F;
        if (len >= 126) {
            unsigned char ext[8];
            const int n = len == 126 ? 2 : 8;
            if (readExact(reinterpret_cast<char*>(ext), n, timeoutMs) != n) {
                f.opcode = -2;
                return f;
            }
            len = 0;
            for (int i = 0; i < n; ++i) len = (len << 8) | ext[i];
        }
        f.payload.resize(static_cast<size_t>(len));
        if (len && readExact(&f.payload[0], static_cast<int>(len), timeoutMs) != int(len)) {
            f.opcode = -2;
            return f;
        }
        f.opcode = h[0] & 0x0F;
        return f;
    }

    void close() {
        if (curl_) curl_easy_cleanup(curl_);
        curl_ = nullptr;
        sock_ = -1;
    }

   private:
    bool sendAll(const std::string& data) {
        size_t off = 0;
        const auto end = std::chrono::steady_clock::now() + std::chrono::seconds(5);
        while (off < data.size()) {
            size_t n = 0;
            const CURLcode rc = curl_easy_send(curl_, data.data() + off, data.size() - off, &n);
            if (rc == CURLE_AGAIN) {
                pollfd p{sock_, POLLOUT, 0};
                ::poll(&p, 1, 100);
            } else if (rc != CURLE_OK) {
                return false;
            }
            off += n;
            if (std::chrono::steady_clock::now() > end) return false;
        }
        return true;
    }
    // Bytes read, 0 at the end of the stream, -1 on timeout or error. libcurl first (OpenSSL may
    // hold decrypted bytes the socket no longer shows), then poll() the socket.
    int recvSome(char* buf, size_t n, int timeoutMs) {
        const auto end = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
        for (;;) {
            size_t got = 0;
            const CURLcode rc = curl_easy_recv(curl_, buf, n, &got);
            if (rc == CURLE_OK) return static_cast<int>(got);
            if (rc != CURLE_AGAIN) return -1;
            const auto left = std::chrono::duration_cast<std::chrono::milliseconds>(
                                  end - std::chrono::steady_clock::now())
                                  .count();
            if (left <= 0) return -1;
            pollfd p{sock_, POLLIN, 0};
            ::poll(&p, 1, static_cast<int>(std::min<int64_t>(left, 50)));
        }
    }
    int readExact(char* buf, int n, int timeoutMs) {
        int off = 0;
        while (off < n) {
            const int r = recvSome(buf + off, static_cast<size_t>(n - off), timeoutMs);
            if (r == 0) return 0;
            if (r < 0) return -1;
            off += r;
        }
        return n;
    }

    CURL* curl_ = nullptr;
    int sock_ = -1;
};

struct RigOptions {
    bool https = true;               // an HTTPS listener is configured
    bool badCertificate = false;     // server.pem with mode 0640: cert-error
    bool takeHttpsPort = false;      // the HTTPS port is already in use: tls-error
    int configuredHttpsPort = 8443;  // reported while HTTPS is not running
    bool accounts = true;            // users.json with four accounts
    bool realHash = false;           // Argon2id instead of the fake hash
    int httpsThreads = 12;
};

// The runtime's web part as main builds it, on 127.0.0.1 with random ports.
struct Rig {
    explicit Rig(RigOptions o = {}) : options(o) {
        dataDir = dir.file("data");
        ::mkdir(dataDir.c_str(), 0700);
        docroot = dir.file("web");
        ::mkdir(docroot.c_str(), 0755);
        ::mkdir((docroot + "/assets").c_str(), 0755);
        test::writeFile(docroot + "/index.html", "<!doctype html><title>mat</title>", 0644);
        test::writeFile(docroot + "/assets/app-1.js", "console.log(1)", 0644);
        usersFile = dir.file("users.json");
        if (o.accounts) {
            std::vector<test::TestAccount> list;
            for (const auto& a :
                 std::vector<std::pair<std::string, std::string>>{{"admin1", "administrator"},
                                                                  {"kysu1", "engineer"},
                                                                  {"xem1", "viewer"},
                                                                  {"tat1", "engineer"}}) {
                pw[a.first] = test::randomPassword();
                test::TestAccount acc{
                    a.first, a.second,
                    o.realHash ? hashPassword(pw[a.first]) : test::fakePhc(pw[a.first])};
                acc.enabled = a.first != "tat1";
                list.push_back(acc);
            }
            test::writeFile(usersFile, test::usersText(list));
        }

        AuditOptions ao;
        ao.dataDir = dataDir;
        audit = std::make_unique<AuditLog>(ao);
        std::string err;
        EXPECT_TRUE(audit->open(err)) << err;

        AuthOptions au;
        au.usersFile = usersFile;
        au.audit = [this](const AuditEvent& e) { audit->append(e); };
        au.log = [this](const std::string& line) {
            std::lock_guard<std::mutex> l(mu);
            authLog.push_back(line);
        };
        au.monoMs = [this] { return mono.load(); };
        if (!o.realHash)
            au.hash = [this](std::string_view password, const PasswordHash& ref) {
                if (beforeHash) beforeHash();
                return test::fakeHash(password, ref);
            };
        au.bootId = [] { return std::string("0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0"); };
        auth = std::make_unique<AuthService>(au);

        const ProjectValidation v = validateProject(kVectors + "/" + kProject, kSchemas);
        EXPECT_TRUE(v.valid);
        const auto digest = projectDirDigest(kVectors + "/" + kProject, v.project->files());
        active = activateProject(v, 10, store, digest);

        CivetLiveTransport::Options to;
        to.maxClients = active.maxClients;
        to.allowedOrigins = {"http://tauri.localhost"};
        transport = std::make_unique<CivetLiveTransport>(to, monoNow);
        HubOptions ho;
        ho.serverVersion = kRuntimeVersion;
        ho.maxClients = transport->maxClients();
        ho.projectJson = active.helloJson;
        hub = std::make_unique<LiveHub>(store, *transport, ho, monoNow);
        transport->attach(hub.get());

        DeviceFacts facts;
        facts.deviceId = loadOrCreateDeviceId(dataDir).id;
        facts.name = "BL335-thử";
        facts.model = "BL335";
        device = std::make_unique<DeviceState>(facts);

        WebOptions wo;
        wo.httpListen = "127.0.0.1:0";
        wo.httpThreads = 16;
        wo.httpsThreads = o.httpsThreads;
        if (o.https) {
            cert = loadOrCreateServerCert({dataDir, facts.name, "mat-test"});
            if (o.badCertificate) {
                ::chmod(cert.pemPath.c_str(), 0640);
                cert = loadOrCreateServerCert({dataDir, facts.name, "mat-test"});
                EXPECT_FALSE(cert.ok);
            }
            wo.httpsListen = "127.0.0.1:" + std::to_string(o.takeHttpsPort ? taken.port : 0) + "s";
        }

        HttpApi::Options hopt;
        hopt.docroot = docroot;
        hopt.projectDir = kVectors + "/" + kProject;
        hopt.allowedOrigins = {"http://tauri.localhost"};
        hopt.projectAllowlist = active.allowlist;
        hopt.activeProjectJson = active.activeJson;
        hopt.projectErrors = active.errors;
        hopt.device = device.get();
        api = std::make_unique<HttpApi>(hopt, [this] {
            return json{{"runtimeVersion", kRuntimeVersion},
                        {"protocolVersion", kLiveProtocolVersion},
                        {"clients", transport->active()},
                        {"maxClients", transport->maxClients()},
                        {"project", active.info},
                        {"tagCount", store.size()}};
        });
        eng = std::make_unique<EngineeringApi>(EngineeringApi::Options{}, *device, *auth, *audit);

        EXPECT_TRUE(web.startHttp(wo, err)) << err;
        httpsState = web.startHttps(wo, cert, httpsError);
        const int reported = httpsState == HttpsState::Ok
                                 ? web.httpsPort()
                                 : httpsState == HttpsState::Off ? 0 : o.configuredHttpsPort;
        device->setPorts(web.httpPort(), reported);
        device->setHttps(httpsState, cert.fingerprint);
        for (mg_context* ctx : {web.http(), web.https()}) {
            if (!ctx) continue;
            api->install(ctx);
            eng->install(ctx);
            transport->install(ctx, "/api/v1/live");
        }
    }
    ~Rig() { web.stop(); }  // close handlers run while the transport and the hub exist

    std::string http() const { return "http://127.0.0.1:" + std::to_string(web.httpPort()); }
    std::string https() const { return test::httpsUrl(web.httpsPort()); }

    HttpResult call(const std::string& base, const HttpRequest& q) {
        CurlClient c(base);
        return c.request(q);
    }
    HttpResult get(const std::string& base, const std::string& path,
                   std::vector<std::string> headers = {}) {
        return call(base, req("GET", path, "", std::move(headers)));
    }
    HttpResult login(const std::string& user, const std::string& password) {
        return call(https(), req("POST", "/api/v1/auth/login", loginBody(user, password),
                                 {"Content-Type: application/json"}));
    }
    std::string token(const std::string& user) {
        const HttpResult r = login(user, pw[user]);
        EXPECT_EQ(r.status, 200) << user << ": " << r.body;
        return bodyJson(r).value("token", "");
    }
    std::vector<AuditRecord> records(const std::string& prefix) {
        AuditQuery q;
        q.actionPrefix = prefix;
        q.limit = 200;
        return audit->query(q).records;
    }

    RigOptions options;
    TempDir dir;
    TakenPort taken;
    std::string dataDir, docroot, usersFile;
    std::map<std::string, std::string> pw;
    std::atomic<int64_t> mono{7000000};
    std::function<void()> beforeHash;  // runs on the hash thread before each fake hash
    std::mutex mu;
    std::vector<std::string> authLog;
    std::unique_ptr<AuditLog> audit;
    std::unique_ptr<AuthService> auth;
    TagStore store;
    ActiveProject active;
    std::unique_ptr<CivetLiveTransport> transport;
    std::unique_ptr<LiveHub> hub;
    std::unique_ptr<DeviceState> device;
    ServerCert cert;
    std::unique_ptr<HttpApi> api;
    std::unique_ptr<EngineeringApi> eng;
    HttpsState httpsState = HttpsState::Off;
    std::string httpsError;
    WebContexts web;  // last: stopped first
};

// A concrete path for a pattern of the roles table.
std::string concrete(const std::string& pattern) {
    std::string out;
    for (size_t i = 0; i < pattern.size(); ++i) {
        if (pattern[i] == '{') {
            out += "op-1";
            i = pattern.find('}', i);
        } else {
            out += pattern[i];
        }
    }
    return out;
}

}  // namespace

// FR-033: the HTTP listener serves the runtime page and its read-only API as in 0.3.0, without
// signing in, and every response closes its connection.
TEST(HttpsApi, HttpListenerServesThePageAsBefore) {
    Rig r;
    ASSERT_EQ(r.httpsState, HttpsState::Ok) << r.httpsError;
    for (const char* path : {"/", "/index.html", "/assets/app-1.js", "/api/v1/system/info",
                             "/api/v1/projects/active", "/project/screens/main.svg"}) {
        const HttpResult res = r.get(r.http(), path);
        EXPECT_EQ(res.status, 200) << path;
        EXPECT_NE(header(res, "Connection"), "keep-alive") << path;
        EXPECT_EQ(header(res, "X-Content-Type-Options"), "nosniff") << path;
        // An HTTP/1.1 request without "Connection: close": the server still closes after it.
        const int fd = test::connectLocal(r.web.httpPort());
        ASSERT_GE(fd, 0);
        ASSERT_TRUE(test::sendAll(fd, std::string("GET ") + path + " HTTP/1.1\r\nHost: x\r\n\r\n"));
        char buf[4096];
        bool closed = false;
        for (int i = 0; i < 100 && !closed; ++i) {
            const ssize_t n = test::recvSome(fd, buf, sizeof buf, 3000);
            if (n <= 0) closed = n == 0;
            if (n < 0) break;
        }
        ::close(fd);
        EXPECT_TRUE(closed) << path;
    }
    EXPECT_EQ(header(r.get(r.http(), "/api/v1/system/info"), "Connection"), "close");
    EXPECT_EQ(r.get(r.http(), "/nothing").status, 404);
    EXPECT_EQ(r.get(r.http(), "/project/project.json").status, 404);  // allowlist as before
}

// The HTTPS listener serves the same endpoints (the Studio's wss and system/info) plus the
// engineering API, and keeps the connection for the next request.
TEST(HttpsApi, HttpsListenerServesTheSameAndTheEngineeringApi) {
    Rig r;
    ASSERT_EQ(r.httpsState, HttpsState::Ok) << r.httpsError;
    CurlClient c(r.https());
    for (const char* path :
         {"/", "/assets/app-1.js", "/api/v1/system/info", "/api/v1/projects/active",
          "/project/screens/main.svg", "/api/v1/device/identity"}) {
        const HttpResult res = c.request(req("GET", path));
        EXPECT_EQ(res.status, 200) << path << " " << res.error;
        EXPECT_NE(header(res, "Connection"), "close") << path;
    }
}

// ADR-010, decision 2026-10-12: an idle HTTPS connection holds one of the few HTTPS workers, so
// the server closes it after 15 s without a request (it was 60 s: 8 machines of the LAN could hold
// every worker for a minute). The Studio drops its idle connections after 10 s, before the server.
TEST(HttpsApi, IdleKeepAliveConnectionClosesAfter15s) {
    EXPECT_EQ(kHttpsKeepAliveMs, 15000);
    Rig r;
    ASSERT_EQ(r.httpsState, HttpsState::Ok) << r.httpsError;
    CurlClient c(r.https());
    ASSERT_EQ(c.request(req("GET", "/api/v1/device/identity")).status, 200);
    const int fd = c.socket();
    ASSERT_GE(fd, 0);
    const auto t0 = std::chrono::steady_clock::now();
    // The server's close (close_notify, then FIN) makes the socket readable.
    pollfd p{fd, POLLIN, 0};
    const int n = ::poll(&p, 1, 30000);
    const double s = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    ASSERT_EQ(n, 1) << "the idle connection was still open after 30 s";
    std::printf("idle HTTPS connection closed by the server after %.1f s\n", s);
    EXPECT_GE(s, 14.0);
    EXPECT_LE(s, 16.5);
}

// FR-007: every endpoint of the roles table over HTTP is 403 HTTPS_REQUIRED, recorded as
// access.denied (channel http, target the path without the query string).
TEST(HttpsApi, EngineeringApiOverHttpIs403AndAudited) {
    Rig r;
    std::vector<std::string> paths;
    for (const auto& rule : endpointRules()) {
        const std::string path = concrete(rule.path);
        paths.push_back(path);
        const bool post = std::string(rule.method) == "POST";
        const HttpResult res = r.call(r.http(), req(rule.method, path, post ? "{}" : ""));
        EXPECT_EQ(res.status, 403) << path;
        const json body = bodyJson(res);
        EXPECT_EQ(body.value("error", ""), "HTTPS_REQUIRED") << path << " " << res.body;
        EXPECT_FALSE(body.value("message", "").empty()) << path;
        EXPECT_EQ(header(res, "Content-Type"), "application/json; charset=utf-8") << path;
        EXPECT_EQ(header(res, "Cache-Control"), "no-store") << path;
        EXPECT_EQ(header(res, "Connection"), "close") << path;
    }
    const HttpResult q = r.get(r.http(), "/api/v1/auth/session?token=abc&x=1");
    EXPECT_EQ(q.status, 403);
    // 20 refusals. The audit log keeps at most 10 rows of refusals a minute (research R11): the
    // first 10 endpoints have their row, the request with a query string counts in the row of its
    // path, the last 9 endpoints count in audit.suppressed.
    ASSERT_EQ(paths.size(), 19u);
    std::map<std::string, int64_t> counts;  // target → count
    for (const auto& rec : r.records("access.")) {
        EXPECT_EQ(rec.channel, "http");
        EXPECT_EQ(rec.code.value_or(""), "HTTPS_REQUIRED");
        EXPECT_EQ(rec.result, "denied");
        counts[rec.target.value_or("")] += rec.count;
    }
    EXPECT_EQ(counts.size(), 10u);
    for (size_t i = 0; i < 10; ++i) EXPECT_TRUE(counts.count(paths[i])) << paths[i];
    EXPECT_EQ(counts["/api/v1/auth/session"], 2);  // the target has no query string
    int64_t suppressed = 0;
    for (const auto& rec : r.records("audit.suppressed")) suppressed += rec.count;
    EXPECT_EQ(suppressed, 9);
}

// Constitution IV: one limit of 10 live sessions for both listeners. 6 ws + 4 wss fill it; the
// 5th wss, and one more ws, get MAX_CLIENTS_REACHED and close 4429. Every hello is protocol 1.1.0
// with the digest of the running project.
TEST(HttpsApi, LiveSessionLimitIsSharedByBothListeners) {
    Rig r;
    ASSERT_EQ(r.httpsState, HttpsState::Ok) << r.httpsError;
    const std::string digest = expectedDigest();
    std::vector<std::unique_ptr<test::WsClient>> ws;
    std::vector<std::unique_ptr<WssClient>> wss;
    for (int i = 0; i < 6; ++i) {
        auto c = std::make_unique<test::WsClient>();
        ASSERT_TRUE(c->connect(r.web.httpPort())) << i;
        const auto hello = c->read(3000);
        ASSERT_EQ(hello.opcode, 1) << i;
        const json h = json::parse(hello.payload);
        EXPECT_EQ(h["type"], "hello");
        EXPECT_EQ(h["protocolVersion"], kLiveProtocolVersion);
        EXPECT_EQ(h["project"]["digest"], digest);
        ws.push_back(std::move(c));
    }
    for (int i = 0; i < 4; ++i) {
        auto c = std::make_unique<WssClient>();
        ASSERT_TRUE(c->connect(r.web.httpsPort())) << i;
        const auto hello = c->read(3000);
        ASSERT_EQ(hello.opcode, 1) << i;
        const json h = json::parse(hello.payload);
        EXPECT_EQ(h["protocolVersion"], kLiveProtocolVersion);
        EXPECT_EQ(h["project"]["digest"], digest);
        wss.push_back(std::move(c));
    }
    EXPECT_EQ(r.transport->active(), 10u);

    WssClient eleventh;
    ASSERT_TRUE(eleventh.connect(r.web.httpsPort()));
    const auto err = eleventh.read(3000);
    ASSERT_EQ(err.opcode, 1);
    EXPECT_EQ(json::parse(err.payload)["code"], "MAX_CLIENTS_REACHED");
    const auto close = eleventh.read(3000);
    EXPECT_EQ(close.opcode, 8);
    EXPECT_EQ(close.closeCode(), 4429);

    test::WsClient twelfth;
    ASSERT_TRUE(twelfth.connect(r.web.httpPort()));
    EXPECT_EQ(twelfth.read(3000).opcode, 1);
    EXPECT_EQ(twelfth.read(3000).closeCode(), 4429);
    EXPECT_EQ(r.transport->active(), 10u);
    EXPECT_EQ(r.transport->rejectedTotal(), 2u);
}

// device-api §2: block "device", project.digest, operation null, protocol 1.1.0; a public page
// holds no fingerprint, account or address. projects/active carries the same digest.
TEST(HttpsApi, SystemInfoHasTheDeviceBlockAndTheDigest) {
    Rig r;
    ASSERT_EQ(r.httpsState, HttpsState::Ok) << r.httpsError;
    for (const std::string& base : {r.http(), r.https()}) {
        const HttpResult res = r.get(base, "/api/v1/system/info");
        ASSERT_EQ(res.status, 200) << base;
        const json info = bodyJson(res);
        EXPECT_EQ(info["protocolVersion"], kLiveProtocolVersion);
        EXPECT_EQ(info["runtimeVersion"], kRuntimeVersion);
        EXPECT_EQ(info["project"]["digest"], expectedDigest());
        ASSERT_TRUE(info.contains("operation"));
        EXPECT_TRUE(info["operation"].is_null());
        const json& d = info["device"];
        EXPECT_EQ(d["deviceId"], r.device->facts().deviceId);
        EXPECT_EQ(d.value("deviceId", "").size(), 36u);
        EXPECT_EQ(d["name"], "BL335-thử");
        EXPECT_EQ(d["model"], "BL335");
        EXPECT_EQ(d["apiVersion"], kDeviceApiVersion);
        EXPECT_EQ(d["httpsPort"], r.web.httpsPort());
        EXPECT_EQ(d["https"], "ok");
        EXPECT_TRUE(d["discovery"].is_boolean());
        EXPECT_EQ(d["viewerAccess"], "private");  // feature 006 (device-api-1.1 §2)
        EXPECT_EQ(d.size(), 8u);
        for (const std::string& secret :
             {r.cert.fingerprint, r.cert.fingerprintColons, std::string("kysu1"),
              std::string("admin1"), std::string("127.0.0.1")})
            EXPECT_EQ(res.body.find(secret), std::string::npos) << secret;
        const HttpResult active = r.get(base, "/api/v1/projects/active");
        ASSERT_EQ(active.status, 200);
        EXPECT_EQ(bodyJson(active)["digest"], expectedDigest());
    }
}

// R5: a damaged certificate (or wrong mode) is never replaced; HTTPS stays off, HTTP serves and
// says cert-error.
TEST(HttpsApi, CertificateErrorKeepsHttpAndSaysCertError) {
    RigOptions o;
    o.badCertificate = true;
    Rig r(o);
    EXPECT_EQ(r.httpsState, HttpsState::CertError);
    EXPECT_EQ(r.web.https(), nullptr);
    const HttpResult res = r.get(r.http(), "/api/v1/system/info");
    ASSERT_EQ(res.status, 200);
    EXPECT_EQ(bodyJson(res)["device"]["https"], "cert-error");
    EXPECT_EQ(bodyJson(res)["device"]["httpsPort"], 8443);
    EXPECT_EQ(r.get(r.http(), "/").status, 200);
    EXPECT_EQ(r.get(r.http(), "/api/v1/device/identity").status, 403);
}

// device-api §2 (analyze B4): the certificate is fine but the port is taken: HTTP serves and says
// tls-error, with the reason in the error text for the log.
TEST(HttpsApi, PortTakenKeepsHttpAndSaysTlsError) {
    RigOptions o;
    o.takeHttpsPort = true;
    Rig r(o);
    ASSERT_GT(r.taken.port, 0);
    EXPECT_EQ(r.httpsState, HttpsState::TlsError);
    EXPECT_FALSE(r.httpsError.empty());
    EXPECT_EQ(r.web.https(), nullptr);
    const HttpResult res = r.get(r.http(), "/api/v1/system/info");
    ASSERT_EQ(res.status, 200);
    EXPECT_EQ(bodyJson(res)["device"]["https"], "tls-error");
    EXPECT_EQ(r.get(r.http(), "/").status, 200);
}

TEST(HttpsApi, HttpsPortZeroSaysOff) {
    RigOptions o;
    o.https = false;
    Rig r(o);
    EXPECT_EQ(r.httpsState, HttpsState::Off);
    const HttpResult res = r.get(r.http(), "/api/v1/system/info");
    ASSERT_EQ(res.status, 200);
    EXPECT_EQ(bodyJson(res)["device"]["https"], "off");
    EXPECT_EQ(bodyJson(res)["device"]["httpsPort"], 0);
}

// device-api §3: open on HTTPS, with the fingerprint the TLS handshake presents.
TEST(HttpsApi, IdentityNeedsNoSignIn) {
    Rig r;
    const HttpResult res = r.get(r.https(), "/api/v1/device/identity");
    ASSERT_EQ(res.status, 200) << res.body;
    const json id = bodyJson(res);
    EXPECT_EQ(id["deviceId"], r.device->facts().deviceId);
    EXPECT_EQ(id["name"], "BL335-thử");
    EXPECT_EQ(id["model"], "BL335");
    EXPECT_EQ(id["runtimeVersion"], kRuntimeVersion);
    EXPECT_EQ(id["apiVersion"], kDeviceApiVersion);
    EXPECT_EQ(id["protocolVersion"], kLiveProtocolVersion);
    EXPECT_EQ(id["httpPort"], r.web.httpPort());
    EXPECT_EQ(id["httpsPort"], r.web.httpsPort());
    EXPECT_EQ(id["fingerprint"], r.cert.fingerprint);
    const std::string fp = id.value("fingerprint", "");
    EXPECT_EQ(fp.size(), 64u);
    EXPECT_EQ(fp.find_first_not_of("0123456789abcdef"), std::string::npos) << fp;
    EXPECT_EQ(id["setupRequired"], false);
    EXPECT_EQ(id["features"], json::array({"auth"}));
    EXPECT_EQ(header(res, "Cache-Control"), "no-store");
    EXPECT_EQ(header(res, "Content-Type"), "application/json; charset=utf-8");
}

TEST(HttpsApi, IdentitySaysSetupRequiredWithoutAccounts) {
    RigOptions o;
    o.accounts = false;
    Rig r(o);
    const HttpResult res = r.get(r.https(), "/api/v1/device/identity");
    ASSERT_EQ(res.status, 200);
    EXPECT_EQ(bodyJson(res)["setupRequired"], true);
    // No account at all: every sign-in is AUTH_FAILED.
    const HttpResult login = r.login("admin", test::randomPassword());
    EXPECT_EQ(login.status, 401);
    EXPECT_EQ(bodyJson(login)["error"], "AUTH_FAILED");
}

TEST(HttpsApi, LoginGivesATokenForTheRightPassword) {
    Rig r;
    const HttpResult res = r.login("kysu1", r.pw["kysu1"]);
    ASSERT_EQ(res.status, 200) << res.body;
    const json b = bodyJson(res);
    const std::string token = b.value("token", "");
    EXPECT_EQ(token.size(), 48u);
    EXPECT_EQ(token.rfind("mats_", 0), 0u);
    EXPECT_EQ(b["user"], "kysu1");
    EXPECT_EQ(b["role"], "engineer");
    EXPECT_EQ(b["idleTimeoutS"], 1800);
    EXPECT_EQ(b["maxLifetimeS"], 43200);
    EXPECT_EQ(b.size(), 5u);
    EXPECT_EQ(header(res, "Cache-Control"), "no-store");
    bool ok = false;
    for (const auto& rec : r.records("auth.login"))
        ok = ok || (rec.result == "ok" && rec.user.value_or("") == "kysu1" &&
                    rec.channel == "https" && rec.source.rfind("127.0.0.1:", 0) == 0);
    EXPECT_TRUE(ok);
}

// FR-013: the same 401 AUTH_FAILED, word for word, for a wrong password, an unknown name, a
// disabled account and a name that cannot be an account.
TEST(HttpsApi, LoginFailuresLookTheSame) {
    Rig r;
    std::vector<std::string> bodies;
    for (const auto& c :
         std::vector<std::pair<std::string, std::string>>{{"kysu1", r.pw["kysu1"] + "x"},
                                                          {"khongco", r.pw["kysu1"]},
                                                          {"tat1", r.pw["tat1"]},
                                                          {r.pw["xem1"], r.pw["xem1"]}}) {
        const HttpResult res = r.login(c.first, c.second);
        EXPECT_EQ(res.status, 401) << c.first.size();
        EXPECT_EQ(bodyJson(res)["error"], "AUTH_FAILED");
        bodies.push_back(res.body);
    }
    for (const auto& b : bodies) EXPECT_EQ(b, bodies[0]);
}

// FR-013: 5 failures lock the name and the address for 5 minutes; then even the right password
// gets 429 AUTH_LOCKED with retryAfterS and Retry-After.
TEST(HttpsApi, LoginLocksAfterFiveFailures) {
    Rig r;
    for (int i = 0; i < 5; ++i) EXPECT_EQ(r.login("kysu1", r.pw["kysu1"] + "x").status, 401);
    const HttpResult res = r.login("kysu1", r.pw["kysu1"]);
    EXPECT_EQ(res.status, 429);
    const json b = bodyJson(res);
    EXPECT_EQ(b["error"], "AUTH_LOCKED");
    const int64_t retry = b.value("retryAfterS", int64_t{0});
    EXPECT_GT(retry, 0);
    EXPECT_LE(retry, 300);
    EXPECT_EQ(header(res, "Retry-After"), std::to_string(retry));
}

// R7: one hash at a time, 4 waiting; the 6th sign-in gets 429 AUTH_BUSY with Retry-After: 2 at
// once, while 5 workers of the HTTPS listener wait for their hash.
TEST(HttpsApi, LoginBusyWhenFourHashesWait) {
    Rig r;
    std::mutex m;
    std::condition_variable cv;
    bool open = false;
    r.beforeHash = [&] {
        std::unique_lock<std::mutex> l(m);
        cv.wait(l, [&] { return open; });
    };
    std::vector<std::thread> waiting;
    std::atomic<int> ok{0};
    const std::string password = r.pw["kysu1"];
    for (int i = 0; i < 5; ++i)
        waiting.emplace_back([&] {
            if (r.login("kysu1", password).status == 200) ++ok;
        });
    // Whatever the assertions below do, the hashes are let go and the threads joined.
    struct Release {
        std::function<void()> fn;
        ~Release() { fn(); }
    } release{[&] {
        {
            std::lock_guard<std::mutex> l(m);
            open = true;
        }
        cv.notify_all();
        for (auto& t : waiting)
            if (t.joinable()) t.join();
    }};
    ASSERT_TRUE(test::waitFor([&] { return r.auth->hashesWaiting() == 4; }, 10000));
    // The 5 attempts above count as failures until their hash says otherwise (T035), so they lock
    // kysu1 and 127.0.0.1 meanwhile: the 6th comes from another address and another account.
    const HttpResult busy =
        postFrom("127.0.0.2", test::httpsUrl(r.web.httpsPort()) + "/api/v1/auth/login",
                 loginBody("admin1", r.pw["admin1"]));
    EXPECT_EQ(busy.status, 429) << busy.error;
    EXPECT_EQ(bodyJson(busy)["error"], "AUTH_BUSY");
    EXPECT_EQ(header(busy, "Retry-After"), "2");
    release.fn();
    EXPECT_EQ(ok.load(), 5);
}

// No token without its audit record (device-api §3): audit.db closed → 503 AUDIT_UNAVAILABLE.
TEST(HttpsApi, LoginWithoutAuditIs503AndGivesNoToken) {
    Rig r;
    r.audit->close();
    const HttpResult res = r.login("kysu1", r.pw["kysu1"]);
    EXPECT_EQ(res.status, 503);
    EXPECT_EQ(bodyJson(res)["error"], "AUDIT_UNAVAILABLE");
    EXPECT_EQ(res.body.find("mats_"), std::string::npos);
}

// device-api §1.2, §3: body ≤ 4 KiB, user ≤ 64 bytes, password ≤ 512 bytes, a JSON object with
// both strings; otherwise 413 BODY_TOO_LARGE or 400 BAD_REQUEST, and no sign-in is attempted.
TEST(HttpsApi, LoginBodyLimits) {
    Rig r;
    auto post = [&](const std::string& body) {
        return r.call(r.https(),
                      req("POST", "/api/v1/auth/login", body, {"Content-Type: application/json"}));
    };
    const std::string big = json{{"user", "kysu1"}, {"password", std::string(4097, 'x')}}.dump();
    HttpResult res = post(big);
    EXPECT_EQ(res.status, 413);
    EXPECT_EQ(bodyJson(res)["error"], "BODY_TOO_LARGE");
    for (const std::string& body :
         {std::string("[]"), std::string("{}"), std::string("not json"), std::string(""),
          json{{"user", 1}, {"password", "x"}}.dump(), json{{"user", "kysu1"}}.dump(),
          loginBody(std::string(65, 'a'), "x"), loginBody("kysu1", std::string(513, 'x')),
          std::string(40, '[') + std::string(40, ']')}) {
        res = post(body);
        EXPECT_EQ(res.status, 400) << body.substr(0, 40);
        EXPECT_EQ(bodyJson(res)["error"], "BAD_REQUEST") << body.substr(0, 40);
    }
    EXPECT_TRUE(r.records("auth.login").empty());  // none of these reached the sign-in
    // At the limits: a 64-byte name and a 512-byte password are an ordinary failed sign-in.
    res = post(loginBody(std::string(64, 'a'), std::string(512, 'x')));
    EXPECT_EQ(res.status, 401);
    EXPECT_EQ(r.records("auth.login").size(), 1u);
}

// POST /auth/logout: 204, auth.logout; the token is dead afterwards.
TEST(HttpsApi, LogoutEndsTheSession) {
    Rig r;
    const std::string token = r.token("kysu1");
    const std::string auth = "Authorization: Bearer " + token;
    const HttpResult out = r.call(r.https(), req("POST", "/api/v1/auth/logout", "", {auth}));
    EXPECT_EQ(out.status, 204);
    EXPECT_TRUE(out.body.empty());
    bool logged = false;
    for (const auto& rec : r.records("auth.logout"))
        logged = logged || (rec.user.value_or("") == "kysu1" && rec.result == "ok");
    EXPECT_TRUE(logged);
    const HttpResult after = r.get(r.https(), "/api/v1/auth/session", {auth});
    EXPECT_EQ(after.status, 401);
    EXPECT_EQ(bodyJson(after)["error"], "SESSION_EXPIRED");
    EXPECT_EQ(header(after, "WWW-Authenticate"), "Bearer");
}

// GET /auth/session answers the remaining times and does not restart the idle time; a request a
// person makes (§1.3) does.
TEST(HttpsApi, SessionDoesNotRestartTheIdleTime) {
    Rig r;
    const std::string auth = "Authorization: Bearer " + r.token("kysu1");
    r.mono += 10 * kMin;
    HttpResult s = r.get(r.https(), "/api/v1/auth/session", {auth});
    ASSERT_EQ(s.status, 200) << s.body;
    json b = bodyJson(s);
    EXPECT_EQ(b["user"], "kysu1");
    EXPECT_EQ(b["role"], "engineer");
    EXPECT_EQ(b["idleRemainingS"], 1200);
    EXPECT_EQ(b["lifetimeRemainingS"], 43200 - 600);
    r.mono += 10 * kMin;
    s = r.get(r.https(), "/api/v1/auth/session", {auth});
    EXPECT_EQ(bodyJson(s)["idleRemainingS"], 600);
    // GET /project/versions is a request a person makes: through the gate it restarts the idle
    // time, even while this runtime answers it 501 (US2).
    const HttpResult v = r.get(r.https(), "/api/v1/project/versions", {auth});
    EXPECT_EQ(v.status, 501);
    EXPECT_EQ(bodyJson(v)["error"], "NOT_IMPLEMENTED");
    r.mono += kMin;
    s = r.get(r.https(), "/api/v1/auth/session", {auth});
    EXPECT_EQ(bodyJson(s)["idleRemainingS"], 1740);
}

// Endpoints of the table that come with later stories pass the gate first: 401 without a token,
// 403 below the role, 501 NOT_IMPLEMENTED once through.
TEST(HttpsApi, LaterEndpointsAnswer501AfterTheGate) {
    Rig r;
    EXPECT_EQ(bodyJson(r.get(r.https(), "/api/v1/diagnostics"))["error"], "AUTH_REQUIRED");
    const std::string viewer = "Authorization: Bearer " + r.token("xem1");
    const std::string engineer = "Authorization: Bearer " + r.token("kysu1");
    HttpResult res = r.get(r.https(), "/api/v1/diagnostics", {viewer});
    EXPECT_EQ(res.status, 501);
    EXPECT_EQ(bodyJson(res)["error"], "NOT_IMPLEMENTED");
    res = r.call(r.https(), req("POST", "/api/v1/project/deployments", "", {viewer}));
    EXPECT_EQ(res.status, 403);
    EXPECT_EQ(bodyJson(res)["error"], "FORBIDDEN");
    res = r.call(r.https(), req("POST", "/api/v1/project/restore", "{}", {engineer}));
    EXPECT_EQ(res.status, 501);
    res = r.get(r.https(), "/api/v1/audit", {engineer});
    EXPECT_EQ(res.status, 403);
    res = r.get(r.https(), "/api/v1/project/deployments/op-1", {engineer});
    EXPECT_EQ(res.status, 501);
    res = r.get(r.https(), "/api/v1/nothing", {engineer});
    EXPECT_EQ(res.status, 404);
}

// device-api §1.2: no-store, nosniff, JSON, no CORS header even for an origin system/info allows;
// 405 with Allow; a JSON body over 16 KiB is 413 and the connection stays usable.
TEST(HttpsApi, HeadersMethodsAndBodyLimit) {
    Rig r;
    const std::string origin = "Origin: http://tauri.localhost";
    const std::string auth = "Authorization: Bearer " + r.token("kysu1");
    CurlClient c(r.https());
    std::vector<HttpResult> all;
    all.push_back(c.request(req("GET", "/api/v1/device/identity", "", {origin})));
    all.push_back(c.request(req("GET", "/api/v1/auth/session", "", {origin, auth})));
    all.push_back(c.request(req("GET", "/api/v1/auth/session", "", {origin})));
    all.push_back(c.request(req("POST", "/api/v1/auth/login", "{}", {origin})));
    const HttpResult notAllowed = c.request(req("DELETE", "/api/v1/auth/session", "", {origin}));
    EXPECT_EQ(notAllowed.status, 405);
    EXPECT_EQ(header(notAllowed, "Allow"), "GET");
    EXPECT_EQ(bodyJson(notAllowed)["error"], "METHOD_NOT_ALLOWED");
    all.push_back(notAllowed);
    const HttpResult tooBig = c.request(
        req("POST", "/api/v1/auth/logout", std::string(16 * 1024 + 1, ' '), {origin, auth}));
    EXPECT_EQ(tooBig.status, 413);
    EXPECT_EQ(bodyJson(tooBig)["error"], "BODY_TOO_LARGE");
    all.push_back(tooBig);
    for (const auto& res : all) {
        EXPECT_EQ(header(res, "Cache-Control"), "no-store") << res.status;
        EXPECT_EQ(header(res, "X-Content-Type-Options"), "nosniff") << res.status;
        EXPECT_EQ(header(res, "Content-Type"), "application/json; charset=utf-8") << res.status;
        EXPECT_FALSE(hasHeaderPrefix(res, "Access-Control-")) << res.status;
    }
    // The connection is still good after the 413 (the body was read and dropped).
    const HttpResult after = c.request(req("GET", "/api/v1/auth/session", "", {auth}));
    EXPECT_EQ(after.status, 200) << after.error;
    // system/info keeps its CORS answer of Sprint 1 for the Studio's origin.
    EXPECT_EQ(
        header(r.get(r.https(), "/api/v1/system/info", {origin}), "Access-Control-Allow-Origin"),
        "http://tauri.localhost");
}

// SC-005: the passwords of the test (made at run time) appear in no response, audit row, log line
// or stderr byte.
TEST(HttpsApi, TestPasswordsLeaveNoTrace) {
    test::StderrCapture err;
    std::string seen;
    {
        Rig r;
        std::map<std::string, std::string> pw = r.pw;
        std::vector<long> statuses;
        for (const auto& c :
             std::vector<std::pair<std::string, std::string>>{{"kysu1", pw["kysu1"]},
                                                              {"kysu1", pw["admin1"]},
                                                              {pw["xem1"], pw["xem1"]},
                                                              {"tat1", pw["tat1"]}}) {
            const HttpResult res = r.login(c.first, c.second);
            statuses.push_back(res.status);
            seen += res.headers + res.body;
        }
        // The sign-ins really ran: one right, three refused, all in the audit.
        EXPECT_EQ(statuses, (std::vector<long>{200, 401, 401, 401}));
        EXPECT_EQ(r.records("auth.login").size(), 4u);
        seen += r.get(r.https(), "/api/v1/system/info").body;
        r.audit->close();
        for (const char* f : {"/audit.db", "/audit.db-wal", "/audit.db-shm"})
            seen += fileText(r.dataDir + f);
        {
            std::lock_guard<std::mutex> l(r.mu);
            for (const auto& line : r.authLog) seen += line + "\n";
        }
        r.web.stop();
        seen += err.finish();
        ASSERT_FALSE(seen.empty());
        for (const auto& kv : pw) EXPECT_EQ(seen.find(kv.second), std::string::npos) << kv.first;
    }
}

// SC-007 on x64: one sign-in with the real Argon2id (m = 19 MiB, t = 2) over HTTPS, TLS handshake
// included. The BL335 figure comes from T055/T158.
TEST(HttpsApi, RealArgon2SignInTime) {
    RigOptions o;
    o.realHash = true;
    Rig r(o);
    std::vector<double> ms;
    for (int i = 0; i < 5; ++i) {
        const auto t0 = std::chrono::steady_clock::now();
        const HttpResult res = r.login("kysu1", r.pw["kysu1"]);
        ms.push_back(
            std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0)
                .count());
        EXPECT_EQ(res.status, 200) << res.body;
    }
    std::sort(ms.begin(), ms.end());
    std::printf("sign-in over HTTPS, real Argon2id: median %.1f ms (min %.1f, max %.1f)\n", ms[2],
                ms[0], ms[4]);
    EXPECT_LT(ms[2], 1000.0);
}
