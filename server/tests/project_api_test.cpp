// T109 (feature 005; contracts/device-api.md §1.3, §4, §5, §8): the project routes of the
// engineering API on the two listeners of mat-runtime in process (WebContexts, CivetWeb with TLS),
// over a real project store and deploy pipeline with the real verify-package and validate steps;
// only the restart (execv) is a stand-in that records the call and returns "replaced".
// - viewer 403, no session 401, HTTP 403 HTTPS_REQUIRED; every refusal has its audit row;
// - GET versions (state, restorable, backupsMax), manifest, package (bytes, headers, audit);
// - POST deployments: 415, 411 (no length, chunked), 413, checks before the body (busy, no space,
//   audit down, base changed), 202 after the whole body, the steps run on a worker, a failed
//   package ends the operation, a connection dropped mid-body is RECEIVE_ABORTED and frees the
//   lock;
// - GET deployments/{opId}, GET operation, POST restore; the idle time of a session (§1.3).
#include <curl/curl.h>
#include <dirent.h>
#include <gtest/gtest.h>
#include <sys/stat.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <map>
#include <memory>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/auth/auth_service.hpp"
#include "core/auth/tests/auth_test_support.hpp"
#include "core/package/package_rules.hpp"
#include "core/package/zip_reader.hpp"
#include "core/project-manager/project_validator.hpp"
#include "core/project-store/boot_decision.hpp"
#include "core/project-store/deploy_pipeline.hpp"
#include "core/project-store/store.hpp"
#include "nlohmann/json.hpp"
#include "server/device_state.hpp"
#include "server/http/engineering_api.hpp"
#include "server/http/web_contexts.hpp"
#include "server/project_glue.hpp"
#include "server/tests/tls_test_support.hpp"
#include "server/tls/server_cert.hpp"

using namespace mat;
using nlohmann::json;
using test::CurlClient;
using test::HttpRequest;
using test::HttpResult;
using test::TempDir;

namespace {

const std::string kSource = MAT_SOURCE_DIR;
const std::string kVectors = kSource + "/tests/project-vectors";
const std::string kPackages = kSource + "/tests/package-vectors";
const std::string kSchemas = kSource + "/schemas";
const std::string kTankPackage = kPackages + "/valid-device-tank-demo/package.matscada";
constexpr int64_t kMin = 60 * 1000;

std::string fileText(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    std::stringstream s;
    s << in.rdbuf();
    return s.str();
}

std::string tankDigest() {
    return json::parse(fileText(kPackages + "/valid-device-tank-demo/expected.json"))["digest"];
}

std::string header(const HttpResult& r, const std::string& name) {
    std::istringstream lines(r.headers);
    std::string line, found, lower = name;
    std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
    while (std::getline(lines, line)) {
        const size_t colon = line.find(':');
        if (colon == std::string::npos) continue;
        std::string key = line.substr(0, colon);
        std::transform(key.begin(), key.end(), key.begin(), ::tolower);
        if (key != lower) continue;
        std::string value = line.substr(colon + 1);
        while (!value.empty() && value.front() == ' ') value.erase(0, 1);
        while (!value.empty() && (value.back() == '\r' || value.back() == ' ')) value.pop_back();
        found = value;
    }
    return found;
}

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

void copyTree(const std::string& from, const std::string& to) {
    const std::string cmd = "mkdir -p '" + to + "' && cp -r '" + from + "'/. '" + to + "'/";
    ASSERT_EQ(std::system(cmd.c_str()), 0);
}

std::vector<std::string> listDir(const std::string& p) {
    std::vector<std::string> out;
    if (DIR* d = ::opendir(p.c_str())) {
        while (const dirent64* e = ::readdir64(d)) {
            const std::string n = e->d_name;
            if (n != "." && n != "..") out.push_back(n);
        }
        ::closedir(d);
    }
    std::sort(out.begin(), out.end());
    return out;
}

// A TLS connection to the runtime that sends raw bytes: what libcurl will not produce (no
// Content-Length, chunked, a body cut short, a length far above the limit).
class RawTls {
   public:
    ~RawTls() { close(); }
    bool connect(int port) {
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
        return curl_easy_perform(curl_) == CURLE_OK;
    }
    bool send(const std::string& data) {
        size_t off = 0;
        const auto end = std::chrono::steady_clock::now() + std::chrono::seconds(10);
        while (off < data.size() && std::chrono::steady_clock::now() < end) {
            size_t n = 0;
            const CURLcode rc = curl_easy_send(curl_, data.data() + off, data.size() - off, &n);
            if (rc == CURLE_AGAIN) {
                std::this_thread::sleep_for(std::chrono::milliseconds(2));
                continue;
            }
            if (rc != CURLE_OK) return false;
            off += n;
        }
        return off == data.size();
    }
    // Reads until the server closes the connection or `ms` pass.
    std::string readAll(int ms) {
        std::string out;
        const auto end = std::chrono::steady_clock::now() + std::chrono::milliseconds(ms);
        char buf[4096];
        while (std::chrono::steady_clock::now() < end) {
            size_t n = 0;
            const CURLcode rc = curl_easy_recv(curl_, buf, sizeof buf, &n);
            if (rc == CURLE_AGAIN) {
                std::this_thread::sleep_for(std::chrono::milliseconds(5));
                continue;
            }
            if (rc != CURLE_OK || n == 0) break;
            out.append(buf, n);
        }
        return out;
    }
    void close() {
        if (curl_) curl_easy_cleanup(curl_);
        curl_ = nullptr;
    }
    static int statusOf(const std::string& raw) {
        return raw.compare(0, 9, "HTTP/1.1 ") == 0 ? std::atoi(raw.c_str() + 9) : 0;
    }
    static std::string bodyOf(const std::string& raw) {
        const size_t e = raw.find("\r\n\r\n");
        return e == std::string::npos ? "" : raw.substr(e + 4);
    }

   private:
    CURL* curl_ = nullptr;
};

enum class Preload {
    Empty,    // no project anywhere: no state.json
    Adopted,  // project installed the old way (valid-minimal) taken in as v/1
    Seeded,   // v/7 running (the tank-demo package), v/6 a complete backup, v/5 in state.json only
};

struct Rig {
    explicit Rig(Preload initial = Preload::Seeded) : preload(initial) {
        dataDir = dir.file("data");
        ::mkdir(dataDir.c_str(), 0700);
        storeDir = dir.file("data/projects");
        usersFile = dir.file("users.json");
        std::vector<test::TestAccount> list;
        for (const auto& a :
             std::vector<std::pair<std::string, std::string>>{{"admin1", "administrator"},
                                                              {"kysu1", "engineer"},
                                                              {"xem1", "viewer"},
                                                              {"van1", "operator"}}) {
            pw[a.first] = test::randomPassword();
            list.push_back({a.first, a.second, test::fakePhc(pw[a.first])});
        }
        test::writeFile(usersFile, test::usersText(list));

        AuditOptions ao;
        ao.dataDir = dataDir;
        audit = std::make_unique<AuditLog>(ao);
        std::string err;
        EXPECT_TRUE(audit->open(err)) << err;
        AuthOptions au;
        au.usersFile = usersFile;
        au.audit = [this](const AuditEvent& e) { audit->append(e); };
        au.log = [](const std::string&) {};
        au.monoMs = [this] { return mono.load(); };
        au.hash = [](std::string_view password, const PasswordHash& ref) {
            return test::fakeHash(password, ref);
        };
        au.bootId = [] { return std::string("0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0"); };
        auth = std::make_unique<AuthService>(au);

        std::string schemaError;
        schema = PackageSchema::loadFromDir(kSchemas, schemaError);
        EXPECT_TRUE(schema) << schemaError;

        if (preload == Preload::Seeded) seed();
        StoreOptions so;
        so.dir = storeDir;
        store = std::make_unique<ProjectStore>(so);
        BootHooks bh;
        bh.legacy = [this] {
            if (preload != Preload::Adopted) return LegacyProject{};
            return legacyProjectOf(validateProject(kVectors + "/valid-minimal", kSchemas),
                                   kVectors + "/valid-minimal");
        };
        bh.pack = storedPackFn(nullptr);
        bh.audit = [this](const AuditEvent& e) { audit->append(e); };
        startup = startStore(*store, bh);

        DeployHooks hooks;
        hooks.verifyPackage = [this](const VerifyRequest& q) {
            return verifyPackageStep(q, *schema);
        };
        hooks.validate = [](const std::string& d) { return validateStep(d, kSchemas); };
        hooks.notifyClients = [this] { return notified.load(); };
        hooks.restart = [this](std::string& e) {
            ++restarts;
            if (restartFails) {
                e = "execv failed (test)";
                return RestartOutcome::Failed;
            }
            return RestartOutcome::Replaced;
        };
        hooks.freeBytes = [this](const std::string&, uint64_t& out) {
            out = freeBytes.load();
            return true;
        };
        DeployOptions dopt;
        dopt.minFreeBytes = 1 << 20;
        dopt.audit = [this](const AuditEvent& e) {
            if (auditFails) throw AuditUnavailable("audit down (test)");
            audit->append(e);
        };
        dopt.log = [](const std::string&) {};
        pipeline = std::make_unique<DeployPipeline>(*store, hooks, dopt);
        pipeline->resume(startup);

        DeviceFacts facts;
        facts.deviceId = loadOrCreateDeviceId(dataDir).id;
        facts.name = "BL335-thử";
        facts.model = "BL335";
        device = std::make_unique<DeviceState>(facts);
        cert = loadOrCreateServerCert({dataDir, facts.name, "mat-test"});
        WebOptions wo;
        wo.httpListen = "127.0.0.1:0";
        wo.httpThreads = 8;
        wo.httpsThreads = 12;
        wo.httpsListen = "127.0.0.1:0s";
        eng = std::make_unique<EngineeringApi>(EngineeringApi::Options{}, *device, *auth, *audit);
        eng->setProject({store.get(), pipeline.get()});
        EXPECT_TRUE(web.startHttp(wo, err)) << err;
        httpsState = web.startHttps(wo, cert, err);
        EXPECT_EQ(httpsState, HttpsState::Ok) << err;
        device->setPorts(web.httpPort(), web.httpsPort());
        for (mg_context* ctx : {web.http(), web.https()})
            if (ctx) eng->install(ctx);
    }
    ~Rig() {
        web.stop();
        eng.reset();  // joins the worker
    }

    // Version 7 running, 6 a backup, 5 listed but incomplete (it has no meta.json: cleaned away).
    void seed() {
        ProjectVersion v7;
        v7.seq = 7;
        v7.digest = tankDigest();
        v7.projectId = "tank-demo";
        v7.projectName = "Tank demo";
        v7.projectVersion = "1.3.0";
        v7.minRuntimeVersion = "0.3.0";
        v7.size = static_cast<int64_t>(fileText(kTankPackage).size());
        v7.activatedAt = "2026-10-20T03:12:00Z";
        v7.clockOk = true;
        v7.deployedBy = "kysu1";
        v7.deployedFrom = "192.168.1.20";
        ProjectVersion v6 = v7;
        v6.seq = 6;
        v6.projectVersion = "1.2.0";
        v6.digest = "sha256:" + std::string(64, 'c');
        v6.activatedAt = "2026-10-19T03:12:00Z";
        v6.source = VersionSource::RuntimePackage;
        v6.deployedBy.reset();
        v6.deployedFrom.reset();
        ProjectVersion v5 = v6;
        v5.seq = 5;
        v5.projectVersion = "1.1.0";
        v5.digest = "sha256:" + std::string(64, 'd');
        StoreState s;
        s.active = 7;
        s.nextSeq = 8;
        s.versions = {v7, v6, v5};
        ::mkdir(storeDir.c_str(), 0700);
        test::writeFile(storeDir + "/state.json", storeStateJson(s), 0600);
        for (const auto& v : {v7, v6}) {
            const std::string vd = storeDir + "/v/" + std::to_string(v.seq);
            copyTree(kVectors + "/valid-minimal", vd + "/project");
            // A stored project holds its files only (feature 011: an extra file fails validate).
            ::unlink((vd + "/project/expected.json").c_str());
            test::writeFile(vd + "/package.matscada", fileText(kTankPackage), 0600);
            test::writeFile(vd + "/meta.json", versionMetaJson(v), 0600);
        }
    }

    std::string https() const { return test::httpsUrl(web.httpsPort()); }
    std::string http() const { return "http://127.0.0.1:" + std::to_string(web.httpPort()); }
    HttpResult call(const std::string& base, const HttpRequest& q) {
        CurlClient c(base);
        return c.request(q);
    }
    std::string token(const std::string& user) {
        const HttpResult r = call(https(), req("POST", "/api/v1/auth/login",
                                               json{{"user", user}, {"password", pw[user]}}.dump(),
                                               {"Content-Type: application/json"}));
        EXPECT_EQ(r.status, 200) << user << ": " << r.body;
        return bodyJson(r).value("token", "");
    }
    std::string engineer() {
        if (engToken.empty()) engToken = token("kysu1");
        return engToken;
    }
    HttpResult get(const std::string& path, const std::string& tok = "") {
        return call(https(), req("GET", path, "",
                                 {"Authorization: Bearer " + (tok.empty() ? engineer() : tok)}));
    }
    HttpResult postJson(const std::string& path, const json& body, const std::string& tok = "") {
        return call(https(), req("POST", path, body.dump(),
                                 {"Authorization: Bearer " + (tok.empty() ? engineer() : tok),
                                  "Content-Type: application/json"}));
    }
    HttpResult deploy(const std::string& package, const std::string& digest,
                      const std::string& base, const std::string& tok = "") {
        return call(https(), req("POST", "/api/v1/project/deployments", package,
                                 {"Authorization: Bearer " + (tok.empty() ? engineer() : tok),
                                  "Content-Type: application/zip", "X-Mat-Digest: " + digest,
                                  "X-Mat-Base-Digest: " + base, "Expect:"}));
    }
    // The raw head of a deploy request.
    std::string rawHead(const std::string& extra, const std::string& base, long long length) {
        std::string h =
            "POST /api/v1/project/deployments HTTP/1.1\r\nHost: x\r\nAuthorization: "
            "Bearer " +
            engineer() + "\r\nX-Mat-Digest: " + tankDigest() + "\r\nX-Mat-Base-Digest: " + base +
            "\r\n";
        if (length >= 0) h += "Content-Length: " + std::to_string(length) + "\r\n";
        return h + extra + "\r\n";
    }
    std::string activeDigest() { return store->state().versions.at(0).digest; }
    std::string activeSeqDir() { return storeDir + "/v/" + std::to_string(*store->state().active); }

    // Polls GET deployments/{opId} until `done` holds or 5 s pass.
    json waitOp(const std::string& opId, const std::function<bool(const json&)>& done) {
        json last;
        for (int i = 0; i < 250; ++i) {
            last = bodyJson(get("/api/v1/project/deployments/" + opId));
            if (!last.empty() && done(last)) return last;
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        return last;
    }
    std::vector<AuditRecord> records(const std::string& prefix) {
        AuditQuery q;
        q.actionPrefix = prefix;
        q.limit = 200;
        return audit->query(q).records;
    }

    Preload preload;
    TempDir dir;
    std::string dataDir, storeDir, usersFile, engToken;
    std::map<std::string, std::string> pw;
    std::atomic<int64_t> mono{7000000};
    std::atomic<int> restarts{0};
    std::atomic<int> notified{3};
    std::atomic<bool> restartFails{false};
    std::atomic<bool> auditFails{false};
    std::atomic<uint64_t> freeBytes{uint64_t{1} << 40};
    std::unique_ptr<AuditLog> audit;
    std::unique_ptr<AuthService> auth;
    std::unique_ptr<PackageSchema> schema;
    std::unique_ptr<ProjectStore> store;
    StoreStartup startup;
    std::unique_ptr<DeployPipeline> pipeline;
    std::unique_ptr<DeviceState> device;
    ServerCert cert;
    std::unique_ptr<EngineeringApi> eng;
    HttpsState httpsState = HttpsState::Off;
    WebContexts web;
};

const char* const kRoutes[][2] = {
    {"GET", "/api/v1/project/versions"},
    {"GET", "/api/v1/project/manifest"},
    {"GET", "/api/v1/project/package"},
    {"POST", "/api/v1/project/deployments"},
    {"GET", "/api/v1/project/deployments/0f8fad5b-d9cb-469f-a165-70867728950e"},
    {"GET", "/api/v1/project/operation"},
    {"POST", "/api/v1/project/restore"},
};

}  // namespace

// ---------- the gate in front of every route ----------

TEST(ProjectApi, ViewerAndOperatorAreForbiddenEverywhereAndAudited) {
    Rig r;
    for (const char* user : {"xem1", "van1"}) {
        const std::string tok = r.token(user);
        for (const auto& route : kRoutes) {
            const bool post = std::string(route[0]) == "POST";
            const HttpResult res = r.call(
                r.https(), req(route[0], route[1], post ? "{}" : "",
                               {"Authorization: Bearer " + tok, "Content-Type: application/json"}));
            EXPECT_EQ(res.status, 403) << user << " " << route[1];
            EXPECT_EQ(bodyJson(res).value("error", ""), "FORBIDDEN") << route[1];
        }
    }
    int64_t denied = 0;
    for (const auto& rec : r.records("access.")) {
        EXPECT_EQ(rec.code.value_or(""), "FORBIDDEN");
        denied += rec.count;
    }
    // 2 accounts x 7 routes; the audit log keeps 10 rows of refusals a minute (research R11) and
    // counts the rest in audit.suppressed.
    for (const auto& rec : r.records("audit.suppressed")) denied += rec.count;
    EXPECT_EQ(denied, 14);
    EXPECT_GE(r.records("access.").size(), 1u);
    EXPECT_FALSE(r.store->stateStatus() == StateStatus::Corrupt);
    EXPECT_EQ(r.restarts.load(), 0);
}

TEST(ProjectApi, NoSessionIs401AndHttpIs403) {
    Rig r;
    for (const auto& route : kRoutes) {
        const bool post = std::string(route[0]) == "POST";
        const HttpResult none = r.call(r.https(), req(route[0], route[1], post ? "{}" : ""));
        EXPECT_EQ(none.status, 401) << route[1];
        EXPECT_EQ(bodyJson(none).value("error", ""), "AUTH_REQUIRED");
        const HttpResult http = r.call(r.http(), req(route[0], route[1], post ? "{}" : "",
                                                     {"Authorization: Bearer " + r.engineer()}));
        EXPECT_EQ(http.status, 403) << route[1];
        EXPECT_EQ(bodyJson(http).value("error", ""), "HTTPS_REQUIRED");
    }
    int64_t refusals = 0;  // rows past 10 a minute are counted in audit.suppressed (research R11)
    for (const auto& rec : r.records("access.")) refusals += rec.count;
    for (const auto& rec : r.records("audit.suppressed")) refusals += rec.count;
    EXPECT_EQ(refusals, 14);
    EXPECT_FALSE(r.records("access.").empty());
}

TEST(ProjectApi, ARouteTheRuntimeDoesNotServeYetStays501WithoutABackend) {
    // The runtime built without a project store (setProject not called) keeps the 501 of US1.
    TempDir dir;
    AuditOptions ao;
    ao.dataDir = dir.path();
    AuditLog audit(ao);
    std::string err;
    ASSERT_TRUE(audit.open(err)) << err;
    AuthOptions au;
    au.usersFile = dir.file("users.json");
    au.audit = [&audit](const AuditEvent& e) { audit.append(e); };
    au.log = [](const std::string&) {};
    au.hash = [](std::string_view p, const PasswordHash& ref) { return test::fakeHash(p, ref); };
    const std::string password = test::randomPassword();
    test::writeFile(au.usersFile,
                    test::usersText({{"kysu1", "engineer", test::fakePhc(password)}}));
    AuthService auth(au);
    DeviceState device;
    EngineeringApi eng(EngineeringApi::Options{}, device, auth, audit);
    ServerCert cert = loadOrCreateServerCert({dir.path(), "x", "mat-test"});
    WebContexts web;
    WebOptions wo;
    wo.httpListen = "127.0.0.1:0";
    wo.httpsListen = "127.0.0.1:0s";
    ASSERT_TRUE(web.startHttp(wo, err));
    ASSERT_EQ(web.startHttps(wo, cert, err), HttpsState::Ok) << err;
    eng.install(web.https());
    CurlClient c(test::httpsUrl(web.httpsPort()));
    const HttpResult login = c.request(req("POST", "/api/v1/auth/login",
                                           json{{"user", "kysu1"}, {"password", password}}.dump(),
                                           {"Content-Type: application/json"}));
    ASSERT_EQ(login.status, 200) << login.body;
    const std::string tok = bodyJson(login).value("token", "");
    const HttpResult v =
        c.request(req("GET", "/api/v1/project/versions", "", {"Authorization: Bearer " + tok}));
    EXPECT_EQ(v.status, 501);
    EXPECT_EQ(bodyJson(v).value("error", ""), "NOT_IMPLEMENTED");
    web.stop();
}

TEST(ProjectApi, FeaturesOfIdentityListDeployUploadRestore) {
    Rig r;
    const HttpResult id = r.call(r.https(), req("GET", "/api/v1/device/identity"));
    ASSERT_EQ(id.status, 200);
    const json features = bodyJson(id)["features"];
    for (const char* f : {"auth", "deploy", "upload", "restore"})
        EXPECT_NE(std::find(features.begin(), features.end(), json(f)), features.end()) << f;
}

// ---------- GET /project/versions ----------

TEST(ProjectApi, VersionsListTheActiveAndTheBackups) {
    Rig r;
    const HttpResult res = r.get("/api/v1/project/versions");
    ASSERT_EQ(res.status, 200) << res.body;
    EXPECT_EQ(header(res, "Content-Type"), "application/json; charset=utf-8");
    EXPECT_EQ(header(res, "Cache-Control"), "no-store");
    const json j = bodyJson(res);
    EXPECT_EQ(j["active"], 7);
    EXPECT_EQ(j["backupsMax"], 3);
    ASSERT_EQ(j["versions"].size(), 3u);
    const json& a = j["versions"][0];
    EXPECT_EQ(a["seq"], 7);
    EXPECT_EQ(a["state"], "active");
    EXPECT_EQ(a["digest"], tankDigest());
    EXPECT_EQ(a["projectId"], "tank-demo");
    EXPECT_EQ(a["projectName"], "Tank demo");
    EXPECT_EQ(a["projectVersion"], "1.3.0");
    EXPECT_EQ(a["minRuntimeVersion"], "0.3.0");
    EXPECT_EQ(a["activatedAt"], "2026-10-20T03:12:00Z");
    EXPECT_EQ(a["clockOk"], true);
    EXPECT_EQ(a["deployedBy"], "kysu1");
    EXPECT_EQ(a["deployedFrom"], "192.168.1.20");
    EXPECT_EQ(a["source"], "studio");
    EXPECT_TRUE(a["size"].is_number());
    const json& b = j["versions"][1];
    EXPECT_EQ(b["seq"], 6);
    EXPECT_EQ(b["state"], "backup");
    EXPECT_EQ(b["restorable"], true);
    EXPECT_EQ(b["source"], "runtime-package");
    EXPECT_TRUE(b["deployedBy"].is_null());  // adopted by the runtime
    const json& c = j["versions"][2];
    EXPECT_EQ(c["seq"], 5);
    EXPECT_EQ(c["state"], "backup");
    EXPECT_EQ(c["restorable"], false);  // no meta.json
}

TEST(ProjectApi, VersionsOfAnEmptyStore) {
    Rig r(Preload::Empty);
    const HttpResult res = r.get("/api/v1/project/versions");
    ASSERT_EQ(res.status, 200) << res.body;
    const json j = bodyJson(res);
    EXPECT_TRUE(j["active"].is_null());
    EXPECT_EQ(j["backupsMax"], 3);
    EXPECT_TRUE(j["versions"].is_array());
    EXPECT_TRUE(j["versions"].empty());
}

TEST(ProjectApi, VersionsOfAnAdoptedProject) {
    Rig r(Preload::Adopted);
    const json j = bodyJson(r.get("/api/v1/project/versions"));
    ASSERT_EQ(j["versions"].size(), 1u);
    EXPECT_EQ(j["active"], 1);
    EXPECT_EQ(j["versions"][0]["source"], "runtime-package");
    EXPECT_EQ(j["versions"][0]["state"], "active");
}

// ---------- GET /project/manifest ----------

TEST(ProjectApi, ManifestIsTheStoredMatscadaJson) {
    Rig r;
    std::string error;
    auto src = FileSource::open(r.storeDir + "/v/7/package.matscada", error);
    ASSERT_TRUE(src) << error;
    std::vector<ZipEntry> entries;
    ASSERT_FALSE(readZipDirectory(*src, entries).has_value());
    ASSERT_EQ(entries.at(0).name, "matscada.json");
    std::string stored;
    ASSERT_FALSE(readZipEntry(*src, entries[0], stored).has_value());
    for (const char* path : {"/api/v1/project/manifest", "/api/v1/project/manifest?seq=7",
                             "/api/v1/project/manifest?seq=6"}) {
        const HttpResult res = r.get(path);
        ASSERT_EQ(res.status, 200) << path << res.body;
        EXPECT_EQ(res.body, stored) << path;
        EXPECT_EQ(header(res, "Content-Type"), "application/json; charset=utf-8");
    }
    EXPECT_EQ(json::parse(stored)["digest"], tankDigest());
}

TEST(ProjectApi, ManifestErrors) {
    Rig r;
    EXPECT_EQ(bodyJson(r.get("/api/v1/project/manifest?seq=99")).value("error", ""),
              "NO_SUCH_VERSION");
    EXPECT_EQ(r.get("/api/v1/project/manifest?seq=99").status, 404);
    EXPECT_EQ(r.get("/api/v1/project/manifest?seq=5").status, 404);  // listed, files gone
    for (const char* q : {"seq=abc", "seq=", "seq=-1", "seq=1.5", "seq=99999999999999999999"})
        EXPECT_EQ(r.get(std::string("/api/v1/project/manifest?") + q).status, 400) << q;
}

TEST(ProjectApi, NoPackageIs404WithTheReason) {
    Rig r(Preload::Empty);
    for (const char* path : {"/api/v1/project/manifest", "/api/v1/project/package"}) {
        const HttpResult res = r.get(path);
        EXPECT_EQ(res.status, 404) << path;
        const json j = bodyJson(res);
        EXPECT_EQ(j.value("error", ""), "NO_PROJECT_PACKAGE") << path;
        EXPECT_FALSE(j.value("message", "").empty());
    }
    // The message says why: the store has no project (a legacy directory without project.json).
    EXPECT_NE(bodyJson(r.get("/api/v1/project/manifest")).value("message", "").find("project"),
              std::string::npos);
}

// ---------- GET /project/package ----------

TEST(ProjectApi, PackageIsTheStoredBytesWithItsHeaders) {
    Rig r;
    const std::string stored = fileText(r.storeDir + "/v/7/package.matscada");
    ASSERT_FALSE(stored.empty());
    for (const char* path : {"/api/v1/project/package", "/api/v1/project/package?seq=7"}) {
        const HttpResult res = r.get(path);
        ASSERT_EQ(res.status, 200) << path;
        EXPECT_EQ(res.body, stored) << path;
        EXPECT_EQ(header(res, "Content-Type"), "application/zip");
        EXPECT_EQ(header(res, "Content-Length"), std::to_string(stored.size()));
        EXPECT_EQ(header(res, "Content-Disposition"),
                  "attachment; filename=\"tank-demo-1.3.0.matscada\"");
        EXPECT_EQ(header(res, "X-Mat-Digest"), tankDigest());
        EXPECT_EQ(header(res, "ETag"), "\"" + tankDigest() + "\"");
        EXPECT_EQ(header(res, "Cache-Control"), "no-store");
        EXPECT_EQ(header(res, "X-Content-Type-Options"), "nosniff");
    }
    const HttpResult old = r.get("/api/v1/project/package?seq=6");
    EXPECT_EQ(old.status, 200);
    EXPECT_EQ(header(old, "X-Mat-Digest"), "sha256:" + std::string(64, 'c'));
    EXPECT_EQ(header(old, "Content-Disposition"),
              "attachment; filename=\"tank-demo-1.2.0.matscada\"");
}

TEST(ProjectApi, PackageReadIsAudited) {
    Rig r;
    ASSERT_EQ(r.get("/api/v1/project/package?seq=7").status, 200);
    const auto rows = r.records("project.read");
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].target.value_or(""), tankDigest());
    EXPECT_EQ(rows[0].user.value_or(""), "kysu1");
    EXPECT_EQ(rows[0].role.value_or(""), "engineer");
    EXPECT_EQ(rows[0].result, "ok");
    EXPECT_EQ(rows[0].channel, "https");
    EXPECT_EQ(rows[0].source.rfind("127.0.0.1:", 0), 0u);
}

TEST(ProjectApi, PackageIsNotSentWhenTheAuditCannotBeWritten) {
    Rig r;
    r.engineer();  // sign in while the log works
    r.audit->close();
    const HttpResult res = r.get("/api/v1/project/package?seq=7");
    EXPECT_EQ(res.status, 503);
    EXPECT_EQ(bodyJson(res).value("error", ""), "AUDIT_UNAVAILABLE");
    EXPECT_EQ(res.body.find("PK"), std::string::npos);  // not a byte of the package
}

TEST(ProjectApi, PackageErrors) {
    Rig r;
    EXPECT_EQ(r.get("/api/v1/project/package?seq=5").status, 404);  // incomplete
    EXPECT_EQ(bodyJson(r.get("/api/v1/project/package?seq=42")).value("error", ""),
              "NO_SUCH_VERSION");
    EXPECT_EQ(r.get("/api/v1/project/package?seq=x").status, 400);
    EXPECT_TRUE(r.records("project.read").empty());  // nothing was read
}

// ---------- POST /project/deployments: checks before the body ----------

TEST(ProjectApi, DeployChecksTheContentTypeAndLength) {
    Rig r;
    const std::string tok = r.engineer();
    // 415: not application/zip (parameters and case are fine for the right type).
    const HttpResult wrong =
        r.call(r.https(),
               req("POST", "/api/v1/project/deployments", "x",
                   {"Authorization: Bearer " + tok, "Content-Type: application/json",
                    "X-Mat-Digest: " + tankDigest(), "X-Mat-Base-Digest: " + r.activeDigest()}));
    EXPECT_EQ(wrong.status, 415);
    EXPECT_EQ(bodyJson(wrong).value("error", ""), "UNSUPPORTED_MEDIA_TYPE");
    const HttpResult none = r.call(r.https(), req("POST", "/api/v1/project/deployments", "x",
                                                  {"Authorization: Bearer " + tok,
                                                   "Content-Type:", "X-Mat-Digest: " + tankDigest(),
                                                   "X-Mat-Base-Digest: " + r.activeDigest()}));
    EXPECT_EQ(none.status, 415);

    // 411: no Content-Length at all.
    RawTls a;
    ASSERT_TRUE(a.connect(r.web.httpsPort()));
    ASSERT_TRUE(a.send(r.rawHead("Content-Type: application/zip\r\n", r.activeDigest(), -1)));
    EXPECT_EQ(RawTls::statusOf(a.readAll(3000)), 411);

    // 411: chunked is not taken.
    RawTls b;
    ASSERT_TRUE(b.connect(r.web.httpsPort()));
    ASSERT_TRUE(b.send(r.rawHead("Content-Type: application/zip\r\nTransfer-Encoding: chunked\r\n",
                                 r.activeDigest(), -1) +
                       "5\r\nhello\r\n0\r\n\r\n"));
    const std::string chunked = b.readAll(3000);
    EXPECT_EQ(RawTls::statusOf(chunked), 411) << chunked;
    EXPECT_EQ(json::parse(RawTls::bodyOf(chunked), nullptr, false).value("error", ""),
              "LENGTH_REQUIRED");
    EXPECT_TRUE(r.records("project.deploy").empty());  // refused before anything started
    EXPECT_FALSE(r.pipeline->current().has_value());
}

TEST(ProjectApi, DeployOverTheLimitIs413WithoutReadingTheBody) {
    Rig r;
    for (long long len : {static_cast<long long>(kPackageMaxBytes) + 1, 4000000000LL}) {
        RawTls c;
        ASSERT_TRUE(c.connect(r.web.httpsPort()));
        // Only the head is sent: the answer must not wait for 50 MiB.
        ASSERT_TRUE(c.send(r.rawHead("Content-Type: application/zip\r\n", r.activeDigest(), len)));
        const std::string raw = c.readAll(3000);
        EXPECT_EQ(RawTls::statusOf(raw), 413) << len << " " << raw;
        const json j = json::parse(RawTls::bodyOf(raw), nullptr, false);
        EXPECT_EQ(j.value("error", ""), "PACKAGE_TOO_LARGE");
        EXPECT_NE(raw.find("Connection: close"), std::string::npos);
    }
    EXPECT_FALSE(r.pipeline->current().has_value());
    EXPECT_TRUE(listDir(r.storeDir + "/staging").empty());
}

TEST(ProjectApi, DeployNeedsTheTwoDigestHeaders) {
    Rig r;
    const std::string tok = r.engineer();
    const std::string tank = fileText(kTankPackage);
    for (const auto& headers : std::vector<std::vector<std::string>>{
             {"X-Mat-Base-Digest: none"},                              // no X-Mat-Digest
             {"X-Mat-Digest: " + tankDigest()},                        // no base
             {"X-Mat-Digest: sha256:xyz", "X-Mat-Base-Digest: none"},  // not a digest
             {"X-Mat-Digest: " + tankDigest(), "X-Mat-Base-Digest: yes"}}) {
        std::vector<std::string> h{"Authorization: Bearer " + tok, "Content-Type: application/zip",
                                   "Expect:"};
        h.insert(h.end(), headers.begin(), headers.end());
        const HttpResult res =
            r.call(r.https(), req("POST", "/api/v1/project/deployments", tank, h));
        EXPECT_EQ(res.status, 400);
        EXPECT_EQ(bodyJson(res).value("error", ""), "BAD_REQUEST");
    }
}

TEST(ProjectApi, DeployWhileBusyIs409WithWhoAndSince) {
    Rig r;
    // A deploy of another account that is still receiving.
    BeginRequest b;
    b.kind = OpKind::Deploy;
    b.who = {"admin1", "administrator", "192.168.1.31", "192.168.1.31:50001"};
    b.baseDigest = r.activeDigest();
    b.packageDigest = tankDigest();
    b.contentLength = 1000;
    const BeginResult first = r.pipeline->begin(b);
    ASSERT_EQ(first.status, BeginStatus::Started) << first.message;
    const HttpResult res = r.deploy(fileText(kTankPackage), tankDigest(), r.activeDigest());
    EXPECT_EQ(res.status, 409);
    const json j = bodyJson(res);
    EXPECT_EQ(j["error"], "DEVICE_BUSY");
    EXPECT_EQ(j["opId"], first.opId);
    EXPECT_EQ(j["kind"], "deploy");
    EXPECT_EQ(j["user"], "admin1");
    EXPECT_EQ(j["source"], "192.168.1.31");
    EXPECT_TRUE(j["since"].is_number());
    EXPECT_FALSE(j.value("message", "").empty());
    r.pipeline->receiveEnd(first.opId, false);  // release
}

TEST(ProjectApi, DeployChecksBaseSpaceAndAuditBeforeTheBody) {
    Rig r;
    const std::string pkg = fileText(kTankPackage);
    const HttpResult base = r.deploy(pkg, tankDigest(), "sha256:" + std::string(64, 'e'));
    EXPECT_EQ(base.status, 409);
    EXPECT_EQ(bodyJson(base).value("error", ""), "BASE_CHANGED");
    EXPECT_EQ(r.deploy(pkg, tankDigest(), "none").status, 409);  // a project does run

    r.freeBytes = 1 << 20;  // below minFreeBytes + the package
    const HttpResult space = r.deploy(pkg, tankDigest(), r.activeDigest());
    EXPECT_EQ(space.status, 507);
    EXPECT_EQ(bodyJson(space).value("error", ""), "NO_SPACE");
    r.freeBytes = uint64_t{1} << 40;

    r.auditFails = true;
    const HttpResult audit = r.deploy(pkg, tankDigest(), r.activeDigest());
    EXPECT_EQ(audit.status, 503);
    EXPECT_EQ(bodyJson(audit).value("error", ""), "AUDIT_UNAVAILABLE");
    r.auditFails = false;
    EXPECT_FALSE(r.pipeline->current().has_value());  // nothing started, the lock is free
    EXPECT_TRUE(listDir(r.storeDir + "/staging").empty());
    EXPECT_EQ(r.restarts.load(), 0);
}

TEST(ProjectApi, DeployWithoutAProjectNeedsBaseNone) {
    Rig r(Preload::Empty);
    EXPECT_EQ(r.deploy(fileText(kTankPackage), tankDigest(), tankDigest()).status, 409);
    const HttpResult ok = r.deploy(fileText(kTankPackage), tankDigest(), "none");
    EXPECT_EQ(ok.status, 202) << ok.body;
}

// ---------- POST /project/deployments: the operation ----------

TEST(ProjectApi, DeployIsAcceptedAfterTheWholeBodyAndRunsToTheRestart) {
    Rig r;
    const std::string pkg = fileText(kTankPackage);
    const std::string base = r.activeDigest();
    const HttpResult res = r.deploy(pkg, tankDigest(), base);
    ASSERT_EQ(res.status, 202) << res.body;
    const json j = bodyJson(res);
    const std::string opId = j.value("opId", "");
    EXPECT_TRUE(validOpId(opId)) << opId;
    EXPECT_EQ(j.value("status", ""), "/api/v1/project/deployments/" + opId);
    EXPECT_EQ(header(res, "Cache-Control"), "no-store");

    // The steps ran on a worker; the stand-in restart replaced the process at "activate".
    // The record is read again after the restart: the read that saw the counter change may have
    // been fetched before the record said "activate running" (a slow machine).
    r.waitOp(opId, [&](const json&) { return r.restarts.load() == 1; });
    ASSERT_EQ(r.restarts.load(), 1);
    const json op = r.waitOp(opId, [](const json&) { return true; });
    ASSERT_FALSE(op.empty());
    EXPECT_EQ(op["opId"], opId);
    EXPECT_EQ(op["kind"], "deploy");
    EXPECT_EQ(op["user"], "kysu1");
    EXPECT_EQ(op["source"], "127.0.0.1");
    EXPECT_EQ(op["result"], "running");
    EXPECT_EQ(op["from"]["seq"], 7);
    EXPECT_EQ(op["from"]["digest"], base);
    EXPECT_EQ(op["to"]["digest"], tankDigest());
    EXPECT_EQ(op["to"]["projectId"], "tank-demo");
    EXPECT_EQ(op["clientsNotified"], 3);
    std::map<std::string, std::string> steps;
    for (const auto& s : op["steps"]) steps[s["id"]] = s["state"];
    for (const char* id : {"receive", "verify-package", "validate", "backup"})
        EXPECT_EQ(steps[id], "ok") << id;
    EXPECT_EQ(steps["activate"], "running");
    EXPECT_EQ(steps["health"], "pending");

    // The store: the new version is v/8, state.json says pending (activating).
    const StoreState s = r.store->state();
    ASSERT_TRUE(s.pending.has_value());
    EXPECT_EQ(s.pending->opId, opId);
    EXPECT_EQ(s.pending->to, 8);
    EXPECT_EQ(s.pending->from, 7);
    EXPECT_EQ(s.active, 7);
    EXPECT_EQ(fileText(r.storeDir + "/v/8/package.matscada"), pkg);  // the bytes received
    EXPECT_TRUE(r.store->isComplete(8));

    const auto started = r.records("project.deploy");
    ASSERT_EQ(started.size(), 1u);
    EXPECT_EQ(started[0].result, "started");
    EXPECT_EQ(started[0].user.value_or(""), "kysu1");
    EXPECT_EQ(started[0].target.value_or(""), tankDigest());
}

TEST(ProjectApi, ADeployWhoseRestartFailsEndsFailedAndFreesTheLock) {
    Rig r;
    r.restartFails = true;
    const HttpResult res = r.deploy(fileText(kTankPackage), tankDigest(), r.activeDigest());
    ASSERT_EQ(res.status, 202) << res.body;
    const json op =
        r.waitOp(bodyJson(res)["opId"], [](const json& j) { return j["result"] != "running"; });
    EXPECT_EQ(op["result"], "failed");
    EXPECT_EQ(op["error"]["code"], "EXEC_FAILED");
    // The record says "failed" before the worker frees the lock and clears the pending state (a slow
    // machine sees the gap): wait for both, bounded.
    for (int i = 0; i < 250 && (r.pipeline->current().has_value() ||
                                r.store->state().pending.has_value());
         ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    EXPECT_FALSE(r.pipeline->current().has_value());
    // The lock is free and the version that ran keeps running.
    EXPECT_EQ(r.store->state().active, 7);
    EXPECT_FALSE(r.store->state().pending.has_value());
}

TEST(ProjectApi, APackageWithTheWrongDigestEndsTheOperationAtVerifyPackage) {
    Rig r;
    const HttpResult res =
        r.deploy(fileText(kTankPackage), "sha256:" + std::string(64, '0'), r.activeDigest());
    ASSERT_EQ(res.status, 202) << res.body;
    const json op =
        r.waitOp(bodyJson(res)["opId"], [](const json& j) { return j["result"] != "running"; });
    EXPECT_EQ(op["result"], "failed");
    EXPECT_EQ(op["error"]["code"], "E_PKG_DIGEST");
    std::map<std::string, std::string> steps;
    for (const auto& s : op["steps"]) steps[s["id"]] = s["state"];
    EXPECT_EQ(steps["receive"], "ok");
    EXPECT_EQ(steps["verify-package"], "failed");
    EXPECT_EQ(r.restarts.load(), 0);
    EXPECT_TRUE(listDir(r.storeDir + "/staging").empty());
    EXPECT_EQ(r.store->state().active, 7);
    EXPECT_EQ(r.store->state().versions.size(), 3u);  // nothing added
    // The result is audited under the account that started it.
    const auto rows = r.records("project.deploy");
    ASSERT_EQ(rows.size(), 2u);
    EXPECT_EQ(rows[0].result, "failed");
    EXPECT_EQ(rows[0].code.value_or(""), "E_PKG_DIGEST");
    EXPECT_EQ(rows[0].user.value_or(""), "kysu1");
}

// Feature 011 (T023, FR-024): a valid package holding a file the project does not reference ends
// at the validate step with E_PACKAGE_EXTRA_FILE (the digest of the running project would differ
// from the package digest and the health check would time out); nothing is activated.
TEST(ProjectApi, APackageWithAnExtraFileEndsTheOperationAtValidate) {
    Rig r;
    const std::string dir = kPackages + "/extra-root-file";
    const json expected = json::parse(fileText(dir + "/expected.json"));
    const HttpResult res = r.deploy(fileText(dir + "/package.matscada"),
                                    expected["digest"].get<std::string>(), r.activeDigest());
    ASSERT_EQ(res.status, 202) << res.body;
    const json op =
        r.waitOp(bodyJson(res)["opId"], [](const json& j) { return j["result"] != "running"; });
    EXPECT_EQ(op["result"], "failed") << op.dump();
    EXPECT_EQ(op["error"]["code"], "E_PACKAGE_EXTRA_FILE") << op.dump();
    EXPECT_NE(op["error"].dump().find("notes.json"), std::string::npos) << op.dump();
    std::map<std::string, std::string> steps;
    for (const auto& s : op["steps"]) steps[s["id"]] = s["state"];
    EXPECT_EQ(steps["verify-package"], "ok");
    EXPECT_EQ(steps["validate"], "failed");
    EXPECT_EQ(r.restarts.load(), 0);
    EXPECT_EQ(r.store->state().active, 7);
}

TEST(ProjectApi, ANotAPackageEndsFailedWithAPackageCode) {
    Rig r;
    const HttpResult res = r.deploy("this is not a zip file", tankDigest(), r.activeDigest());
    ASSERT_EQ(res.status, 202) << res.body;
    const json op =
        r.waitOp(bodyJson(res)["opId"], [](const json& j) { return j["result"] != "running"; });
    EXPECT_EQ(op["result"], "failed");
    EXPECT_EQ(op["error"]["code"].get<std::string>().rfind("E_PKG_", 0), 0u) << op.dump();
}

TEST(ProjectApi, ADroppedConnectionIsReceiveAbortedAndFreesTheLock) {
    Rig r;
    const std::string pkg = fileText(kTankPackage);
    RawTls c;
    ASSERT_TRUE(c.connect(r.web.httpsPort()));
    ASSERT_TRUE(c.send(r.rawHead("Content-Type: application/zip\r\n", r.activeDigest(),
                                 static_cast<long long>(pkg.size())) +
                       pkg.substr(0, 3000)));
    for (int i = 0; i < 100 && !r.pipeline->current(); ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    ASSERT_TRUE(r.pipeline->current().has_value());  // receiving: busy
    c.close();                                       // the network drops

    std::optional<DeployOperation> last;
    for (int i = 0; i < 300; ++i) {
        last = r.pipeline->latest();
        if (last && last->result != DeployResult::Running) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    ASSERT_TRUE(last.has_value());
    EXPECT_EQ(last->result, DeployResult::Failed);
    ASSERT_TRUE(last->error.has_value());
    EXPECT_EQ(last->error->code, "RECEIVE_ABORTED");
    // The result reads Failed as soon as the operation ends; its last record is then written with
    // the mutex released (FR-023) and the operation is let go after: wait for that, bounded (red 3
    // in 8 when read at once, 2026-10-17).
    for (int i = 0; i < 250 && (r.pipeline->current() || !listDir(r.storeDir + "/staging").empty());
         ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    EXPECT_FALSE(r.pipeline->current().has_value());
    EXPECT_TRUE(listDir(r.storeDir + "/staging").empty());
    EXPECT_EQ(r.store->state().versions.size(), 3u);
    // The lock is free again: the next deploy is accepted.
    EXPECT_EQ(r.deploy(pkg, tankDigest(), r.activeDigest()).status, 202);
    const auto rows = r.records("project.deploy");
    ASSERT_GE(rows.size(), 2u);
    bool aborted = false;
    for (const auto& row : rows) aborted |= row.code.value_or("") == "RECEIVE_ABORTED";
    EXPECT_TRUE(aborted);
}

TEST(ProjectApi, ABodyCutShortByTheClientNeverReachesTheBackup) {
    Rig r;
    const std::string pkg = fileText(kTankPackage);
    RawTls c;
    ASSERT_TRUE(c.connect(r.web.httpsPort()));
    // Declares the whole package, sends the first half and goes quiet, then closes.
    ASSERT_TRUE(c.send(r.rawHead("Content-Type: application/zip\r\n", r.activeDigest(),
                                 static_cast<long long>(pkg.size())) +
                       pkg.substr(0, pkg.size() / 2)));
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    c.close();
    for (int i = 0; i < 300 && r.pipeline->current(); ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    EXPECT_EQ(r.restarts.load(), 0);
    EXPECT_EQ(r.store->state().versions.size(), 3u);
    EXPECT_FALSE(r.store->state().pending.has_value());
}

// ---------- GET deployments/{opId}, GET operation ----------

TEST(ProjectApi, UnknownOperationIs404) {
    Rig r;
    for (const char* id : {"0f8fad5b-d9cb-469f-a165-70867728950e", "not-an-op-id"}) {
        const HttpResult res = r.get(std::string("/api/v1/project/deployments/") + id);
        EXPECT_EQ(res.status, 404) << id;
        EXPECT_EQ(bodyJson(res).value("error", ""), "NO_SUCH_OPERATION") << id;
    }
    // A name that is not one path segment is not an endpoint at all.
    EXPECT_EQ(r.get("/api/v1/project/deployments/..%2f..%2fstate.json").status, 404);
}

TEST(ProjectApi, OperationIsNullUntilThereIsOne) {
    Rig r;
    const HttpResult none = r.get("/api/v1/project/operation");
    EXPECT_EQ(none.status, 200);
    EXPECT_EQ(none.body, "null");
    EXPECT_EQ(header(none, "Content-Type"), "application/json; charset=utf-8");
    const HttpResult res =
        r.deploy(fileText(kTankPackage), "sha256:" + std::string(64, '0'), r.activeDigest());
    ASSERT_EQ(res.status, 202);
    const std::string opId = bodyJson(res)["opId"];
    r.waitOp(opId, [](const json& j) { return j["result"] != "running"; });
    const json latest = bodyJson(r.get("/api/v1/project/operation"));
    EXPECT_EQ(latest["opId"], opId);  // the latest operation, also after it ended
    EXPECT_EQ(latest["result"], "failed");
}

// ---------- POST /project/restore ----------

TEST(ProjectApi, RestoreStartsAnOperationThatSkipsReceiveAndVerify) {
    Rig r;
    const HttpResult res =
        r.postJson("/api/v1/project/restore", {{"seq", 6}, {"baseDigest", r.activeDigest()}});
    ASSERT_EQ(res.status, 202) << res.body;
    const std::string opId = bodyJson(res).value("opId", "");
    EXPECT_TRUE(validOpId(opId));
    EXPECT_EQ(bodyJson(res).value("status", ""), "/api/v1/project/deployments/" + opId);
    r.waitOp(opId, [&](const json&) { return r.restarts.load() == 1; });
    const json op = r.waitOp(opId, [](const json&) { return true; });  // read after the restart
    EXPECT_EQ(op["kind"], "restore");
    EXPECT_EQ(op["to"]["seq"], 6);
    std::map<std::string, std::string> steps;
    for (const auto& s : op["steps"]) steps[s["id"]] = s["state"];
    EXPECT_EQ(steps["receive"], "skipped");
    EXPECT_EQ(steps["verify-package"], "skipped");
    EXPECT_EQ(steps["validate"], "ok");
    EXPECT_EQ(steps["backup"], "ok");
    EXPECT_EQ(steps["activate"], "running");
    ASSERT_TRUE(r.store->state().pending.has_value());
    EXPECT_EQ(r.store->state().pending->to, 6);
    const auto rows = r.records("project.restore");
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].result, "started");
}

TEST(ProjectApi, RestoreErrors) {
    Rig r;
    const std::string base = r.activeDigest();
    HttpResult res = r.postJson("/api/v1/project/restore", {{"seq", 99}, {"baseDigest", base}});
    EXPECT_EQ(res.status, 404);
    EXPECT_EQ(bodyJson(res).value("error", ""), "NO_SUCH_VERSION");
    res = r.postJson("/api/v1/project/restore", {{"seq", 5}, {"baseDigest", base}});  // incomplete
    EXPECT_EQ(res.status, 404);
    res = r.postJson("/api/v1/project/restore", {{"seq", 7}, {"baseDigest", base}});
    EXPECT_EQ(res.status, 409);
    EXPECT_EQ(bodyJson(res).value("error", ""), "ALREADY_ACTIVE");
    res = r.postJson("/api/v1/project/restore",
                     {{"seq", 6}, {"baseDigest", "sha256:" + std::string(64, 'e')}});
    EXPECT_EQ(res.status, 409);
    EXPECT_EQ(bodyJson(res).value("error", ""), "BASE_CHANGED");
    for (const json& bad : std::vector<json>{json::object(),
                                             {{"seq", "6"}, {"baseDigest", base}},
                                             {{"seq", 6}},
                                             {{"seq", 6.5}, {"baseDigest", base}},
                                             {{"seq", -1}, {"baseDigest", base}},
                                             {{"seq", 6}, {"baseDigest", 7}},
                                             {{"seq", 6}, {"baseDigest", "yes"}}}) {
        res = r.postJson("/api/v1/project/restore", bad);
        EXPECT_EQ(res.status, 400) << bad.dump();
        EXPECT_EQ(bodyJson(res).value("error", ""), "BAD_REQUEST");
    }
    res = r.call(r.https(), req("POST", "/api/v1/project/restore", "[1,2]",
                                {"Authorization: Bearer " + r.engineer()}));
    EXPECT_EQ(res.status, 400);
    res = r.call(r.https(), req("POST", "/api/v1/project/restore", std::string(20000, ' '),
                                {"Authorization: Bearer " + r.engineer()}));
    EXPECT_EQ(res.status, 413);  // the JSON limit of 16 KiB still holds
    EXPECT_EQ(bodyJson(res).value("error", ""), "BODY_TOO_LARGE");
    EXPECT_EQ(r.restarts.load(), 0);
    EXPECT_FALSE(r.pipeline->current().has_value());
}

TEST(ProjectApi, RestoreWhileBusyIs409) {
    Rig r;
    BeginRequest b;
    b.kind = OpKind::Deploy;
    b.who = {"admin1", "administrator", "192.168.1.31", "192.168.1.31:50001"};
    b.baseDigest = r.activeDigest();
    b.packageDigest = tankDigest();
    b.contentLength = 1000;
    const BeginResult first = r.pipeline->begin(b);
    ASSERT_EQ(first.status, BeginStatus::Started);
    const HttpResult res =
        r.postJson("/api/v1/project/restore", {{"seq", 6}, {"baseDigest", r.activeDigest()}});
    EXPECT_EQ(res.status, 409);
    EXPECT_EQ(bodyJson(res).value("error", ""), "DEVICE_BUSY");
    EXPECT_EQ(bodyJson(res).value("opId", ""), first.opId);
    r.pipeline->receiveEnd(first.opId, false);
}

// ---------- the idle time of the session (§1.3) ----------

TEST(ProjectApi, OnlyWhatAPersonDoesRestartsTheIdleTime) {
    Rig r;
    const std::string tok = r.engineer();
    auto idle = [&] {
        return bodyJson(r.get("/api/v1/auth/session", tok)).value("idleRemainingS", int64_t{-1});
    };
    EXPECT_GE(idle(), 1790);
    r.mono += 10 * kMin;
    EXPECT_LE(idle(), 1200);
    // Polling does not restart it: deployments/{opId} (even for an unknown id, the gate decides),
    // and operation.
    r.get("/api/v1/project/operation", tok);
    r.get("/api/v1/project/deployments/0f8fad5b-d9cb-469f-a165-70867728950e", tok);
    EXPECT_LE(idle(), 1200);
    // What a person does does: versions, manifest, package.
    r.get("/api/v1/project/versions", tok);
    EXPECT_GE(idle(), 1790);
    r.mono += 10 * kMin;
    EXPECT_LE(idle(), 1200);
    r.get("/api/v1/project/manifest", tok);
    EXPECT_GE(idle(), 1790);
    r.mono += 10 * kMin;
    r.get("/api/v1/project/package", tok);
    EXPECT_GE(idle(), 1790);
    r.mono += 10 * kMin;
    r.postJson("/api/v1/project/restore", {{"seq", 99}, {"baseDigest", "none"}}, tok);  // a POST
    EXPECT_GE(idle(), 1790);
}
