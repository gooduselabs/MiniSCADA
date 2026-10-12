// T143 (feature 005, US4; contracts/device-api.md §6, §7, §8, §1.3): GET /api/v1/diagnostics and
// GET /api/v1/audit on the HTTPS listener of mat-runtime in process (WebContexts, CivetWeb with
// TLS), over the real audit log and sign-in service (fake hash), the diagnostics numbers injected.
// - diagnostics (viewer): every block of §6 with the injected numbers, the sessions counted, the
// versions;
//   it does not restart the idle time of the session and writes no audit row;
// - audit (administrator): an engineer or a viewer gets 403 and an access.denied row; the filters
// from,
//   to, user, action (prefix), before, limit (1–200, 100 by default) and their errors (400); newest
//   first, `next` pages to the end; every call writes audit.read; nothing secret in the answer;
// - audit down: no data without its audit.read row (503).
#include <curl/curl.h>
#include <gtest/gtest.h>
#include <sys/stat.h>

#include <algorithm>
#include <atomic>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/auth/auth_service.hpp"
#include "core/auth/tests/auth_test_support.hpp"
#include "core/diagnostics/proc_stats.hpp"
#include "nlohmann/json.hpp"
#include "server/device_state.hpp"
#include "server/http/engineering_api.hpp"
#include "server/http/web_contexts.hpp"
#include "server/tests/tls_test_support.hpp"
#include "server/tls/server_cert.hpp"

using namespace mat;
using nlohmann::json;
using test::CurlClient;
using test::HttpRequest;
using test::HttpResult;
using test::TempDir;

namespace {

constexpr int64_t kMin = 60 * 1000;
constexpr int64_t kT0 = 1791600000000LL;  // a Unix time in ms for the injected audit clock

json bodyJson(const HttpResult& r) {
    json j = json::parse(r.body, nullptr, false);
    return j.is_object() ? j : json::object();
}

HttpRequest get(const std::string& path, std::vector<std::string> headers = {}) {
    HttpRequest q;
    q.method = "GET";
    q.path = path;
    q.headers = std::move(headers);
    return q;
}

struct Rig {
    explicit Rig(bool diagnostics = true) {
        dataDir = dir.file("data");
        ::mkdir(dataDir.c_str(), 0700);
        usersFile = dir.file("users.json");
        std::vector<test::TestAccount> list;
        for (const auto& a : std::vector<std::pair<std::string, std::string>>{
                 {"admin1", "administrator"}, {"kysu1", "engineer"}, {"xem1", "viewer"}}) {
            pw[a.first] = test::randomPassword();
            list.push_back({a.first, a.second, test::fakePhc(pw[a.first])});
        }
        test::writeFile(usersFile, test::usersText(list));

        AuditOptions ao;
        ao.dataDir = dataDir;
        ao.clock.wallMs = [this] { return wall.load(); };
        ao.clock.monoMs = [this] { return mono.load(); };
        ao.clock.synced = [](int64_t) { return true; };
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

        DeviceFacts facts;
        facts.deviceId = loadOrCreateDeviceId(dataDir).id;
        facts.name = "BL335-thử";
        facts.model = "BL335";
        facts.discovery = true;
        device = std::make_unique<DeviceState>(facts);

        WebOptions wo;
        wo.httpListen = "127.0.0.1:0";
        wo.httpsListen = "127.0.0.1:0s";
        cert = loadOrCreateServerCert({dataDir, facts.name, "mat-test"});
        eng = std::make_unique<EngineeringApi>(EngineeringApi::Options{}, *device, *auth, *audit);
        if (diagnostics) {
            EngineeringApi::DiagnosticsBackend d;
            d.proc = [this] { return snapshot; };
            d.liveClients = [] { return 3; };
            d.maxClients = [] { return 10; };
            d.discovery = [] {
                discovery::Counters c;
                c.replies = 42;
                c.format = 3;
                return c;
            };
            d.timeSynced = [this](int64_t) { return synced; };
            d.wallMs = [this] { return wall.load(); };
            eng->setDiagnostics(d);
        }
        std::string e;
        EXPECT_TRUE(web.startHttp(wo, e)) << e;
        const HttpsState st = web.startHttps(wo, cert, e);
        EXPECT_EQ(st, HttpsState::Ok) << e;
        device->setPorts(web.httpPort(), web.httpsPort());
        for (mg_context* ctx : {web.http(), web.https()})
            if (ctx) eng->install(ctx);

        snapshot.sampled = true;
        snapshot.systemPct1m = 11.74;
        snapshot.runtimePct1m = 4.16;
        snapshot.loadAvg1 = 0.42;
        snapshot.cores = 2;
        snapshot.runtimeRssBytes = 9900032;
        snapshot.systemTotalBytes = 1041235968;
        snapshot.systemAvailableBytes = 909115392;
        snapshot.systemUptimeS = 123456.78;
        snapshot.runtimeUptimeS = 3600.9;
        snapshot.diskPath = "/var/lib/mat-runtime";
        snapshot.disk = DiskSpace{7301234688LL, 6512341504LL};
    }
    ~Rig() { web.stop(); }

    std::string https() const { return test::httpsUrl(web.httpsPort()); }
    HttpResult call(const HttpRequest& q) {
        CurlClient c(https());
        return c.request(q);
    }
    HttpResult login(const std::string& user) {
        HttpRequest q;
        q.method = "POST";
        q.path = "/api/v1/auth/login";
        q.body = json{{"user", user}, {"password", pw[user]}}.dump();
        q.headers = {"Content-Type: application/json"};
        return call(q);
    }
    std::string bearer(const std::string& user) {
        const HttpResult r = login(user);
        EXPECT_EQ(r.status, 200) << r.body;
        return "Authorization: Bearer " + bodyJson(r).value("token", "");
    }
    HttpResult getAs(const std::string& user, const std::string& path) {
        return call(get(path, {bearer(user)}));
    }
    std::vector<AuditRecord> records(const std::string& prefix) {
        AuditQuery q;
        q.actionPrefix = prefix;
        q.limit = 200;
        return audit->query(q).records;
    }

    TempDir dir;
    std::string dataDir, usersFile;
    std::map<std::string, std::string> pw;
    std::atomic<int64_t> mono{7000000};
    std::atomic<int64_t> wall{kT0};
    bool synced = true;
    ProcSnapshot snapshot;
    std::unique_ptr<AuditLog> audit;
    std::unique_ptr<AuthService> auth;
    std::unique_ptr<DeviceState> device;
    ServerCert cert;
    std::unique_ptr<EngineeringApi> eng;
    WebContexts web;  // last: stopped first
};

}  // namespace

// ---------- §6 diagnostics ----------

TEST(DiagnosticsApi, HasEveryBlockOfTheContractWithTheInjectedNumbers) {
    Rig r;
    r.login("xem1");  // two sessions alive (and the viewer's own below)
    const HttpResult res = r.getAs("xem1", "/api/v1/diagnostics");
    ASSERT_EQ(res.status, 200) << res.body;
    const json b = bodyJson(res);
    EXPECT_EQ(b["at"], kT0);
    EXPECT_EQ(b["timeSynced"], true);
    EXPECT_DOUBLE_EQ(b["cpu"]["systemPct1m"].get<double>(), 11.7);
    EXPECT_DOUBLE_EQ(b["cpu"]["runtimePct1m"].get<double>(), 4.2);
    EXPECT_DOUBLE_EQ(b["cpu"]["loadAvg1"].get<double>(), 0.42);
    EXPECT_EQ(b["cpu"]["cores"], 2);
    EXPECT_EQ(b["memory"]["runtimeRssBytes"], 9900032);
    EXPECT_EQ(b["memory"]["systemTotalBytes"], 1041235968);
    EXPECT_EQ(b["memory"]["systemAvailableBytes"], 909115392);
    EXPECT_EQ(b["disk"]["path"], "/var/lib/mat-runtime");
    EXPECT_EQ(b["disk"]["totalBytes"], 7301234688LL);
    EXPECT_EQ(b["disk"]["freeBytes"], 6512341504LL);
    EXPECT_EQ(b["uptime"]["systemS"], 123456);
    EXPECT_EQ(b["uptime"]["runtimeS"], 3600);
    EXPECT_EQ(b["clients"]["live"], 3);
    EXPECT_EQ(b["clients"]["max"], 10);
    EXPECT_EQ(b["clients"]["sessions"], 2);
    EXPECT_EQ(b["discovery"]["enabled"], true);
    EXPECT_EQ(b["discovery"]["replies"], 42);
    EXPECT_EQ(b["discovery"]["dropped"]["format"], 3);
    EXPECT_EQ(b["discovery"]["dropped"]["subnet"], 0);
    EXPECT_EQ(b["discovery"]["dropped"]["rate"], 0);
    EXPECT_EQ(b["discovery"]["dropped"]["port"], 0);
    EXPECT_EQ(b["versions"]["runtime"], "0.4.0");
    EXPECT_EQ(b["versions"]["protocol"], "1.1.0");
    EXPECT_EQ(b["versions"]["api"], "1.0.0");
    EXPECT_EQ(res.headers.find("Cache-Control: no-store") != std::string::npos, true);
}

TEST(DiagnosticsApi, ClockNotSyncedAndNoDiskAreSaidNotInvented) {
    Rig r;
    r.synced = false;
    r.snapshot.disk = std::nullopt;
    const json b = bodyJson(r.getAs("xem1", "/api/v1/diagnostics"));
    EXPECT_EQ(b["timeSynced"], false);
    EXPECT_TRUE(b["disk"].is_null());
}

TEST(DiagnosticsApi, DoesNotRestartTheIdleTimeAndWritesNoAuditRow) {
    Rig r;
    const std::string auth = r.bearer("xem1");
    const size_t before = r.records("").size();
    r.mono += 10 * kMin;
    ASSERT_EQ(r.call(get("/api/v1/diagnostics", {auth})).status, 200);
    const json s = bodyJson(r.call(get("/api/v1/auth/session", {auth})));
    EXPECT_EQ(s["idleRemainingS"], 1200);  // 30 min - 10 min: the poll did not restart it
    EXPECT_EQ(r.records("").size(), before);
}

TEST(DiagnosticsApi, NeedsASessionAndHttps) {
    Rig r;
    EXPECT_EQ(bodyJson(r.call(get("/api/v1/diagnostics")))["error"], "AUTH_REQUIRED");
}

TEST(DiagnosticsApi, WithoutABackendTheRoutesAnswer501AfterTheGate) {
    Rig r(false);
    EXPECT_EQ(r.getAs("xem1", "/api/v1/diagnostics").status, 501);
    EXPECT_EQ(r.getAs("admin1", "/api/v1/audit").status, 501);
}

TEST(DiagnosticsApi, TheFeaturesOfTheIdentityNameDiagnosticsAndAudit) {
    Rig r;
    const json f = bodyJson(r.call(get("/api/v1/device/identity")))["features"];
    for (const char* name : {"diagnostics", "audit"})
        EXPECT_NE(std::find(f.begin(), f.end(), json(name)), f.end()) << name;
}

// ---------- §7 audit ----------

TEST(AuditApi, OnlyTheAdministratorReadsAndARefusalIsAudited) {
    Rig r;
    for (const char* user : {"kysu1", "xem1"}) {
        const HttpResult res = r.getAs(user, "/api/v1/audit");
        EXPECT_EQ(res.status, 403) << user;
        EXPECT_EQ(bodyJson(res)["error"], "FORBIDDEN");
    }
    const auto denied = r.records("access.denied");
    ASSERT_FALSE(denied.empty());
    EXPECT_EQ(denied[0].target.value_or(""), "/api/v1/audit");
    EXPECT_EQ(r.records("audit.read").size(), 0u);  // a refused call reads nothing
}

TEST(AuditApi, NewestFirstWithTheFieldsOfARecordAndEveryCallWritesAuditRead) {
    Rig r;
    r.wall += 1000;
    r.login("kysu1");
    r.wall += 1000;
    HttpResult res = r.getAs("admin1", "/api/v1/audit");
    ASSERT_EQ(res.status, 200) << res.body;
    json b = bodyJson(res);
    ASSERT_TRUE(b["records"].is_array());
    ASSERT_GE(b["records"].size(), 2u);
    EXPECT_TRUE(b["next"].is_null());
    int64_t prev = INT64_MAX;
    for (const json& rec : b["records"]) {
        EXPECT_LT(rec["id"].get<int64_t>(), prev);  // newest (highest id) first
        prev = rec["id"].get<int64_t>();
    }
    const json& newest = b["records"][0];
    EXPECT_EQ(newest["action"], "auth.login");  // the admin's own sign-in just before the read
    EXPECT_EQ(newest["user"], "admin1");
    EXPECT_EQ(newest["role"], "administrator");
    EXPECT_EQ(newest["result"], "ok");
    EXPECT_EQ(newest["channel"], "https");
    EXPECT_EQ(newest["clockOk"], true);
    EXPECT_EQ(newest["count"], 1);
    EXPECT_TRUE(newest["ts"].is_number_integer());
    EXPECT_TRUE(newest["source"].is_string());
    // Every call writes audit.read (after the query: the answer does not hold its own record).
    EXPECT_EQ(r.records("audit.read").size(), 1u);
    r.getAs("admin1", "/api/v1/audit");
    const auto reads = r.records("audit.read");
    ASSERT_EQ(reads.size(), 2u);
    EXPECT_EQ(reads[0].user.value_or(""), "admin1");
    EXPECT_EQ(reads[0].result, "ok");
    EXPECT_EQ(reads[0].channel, "https");
    // The second answer does hold the first audit.read.
    res = r.getAs("admin1", "/api/v1/audit?action=audit.");
    b = bodyJson(res);
    ASSERT_GE(b["records"].size(), 2u);
    for (const json& rec : b["records"]) EXPECT_EQ(rec["action"], "audit.read");
}

TEST(AuditApi, FiltersByUserActionPrefixAndTime) {
    Rig r;
    r.wall = kT0 + 1000;
    r.login("kysu1");
    r.wall = kT0 + 5000;
    r.login("xem1");
    r.wall = kT0 + 9000;
    const std::string admin = r.bearer("admin1");  // kT0 + 9000

    auto read = [&](const std::string& query) {
        const HttpResult res = r.call(get("/api/v1/audit" + query, {admin}));
        EXPECT_EQ(res.status, 200) << query << " " << res.body;
        return bodyJson(res);
    };
    json b = read("?user=kysu1");
    ASSERT_EQ(b["records"].size(), 1u);
    EXPECT_EQ(b["records"][0]["user"], "kysu1");
    b = read("?action=auth.login");
    EXPECT_EQ(b["records"].size(), 3u);
    b = read("?action=auth.");
    EXPECT_EQ(b["records"].size(), 3u);
    b = read("?action=project.");
    EXPECT_EQ(b["records"].size(), 0u);
    EXPECT_TRUE(b["next"].is_null());
    b = read("?from=" + std::to_string(kT0 + 4000) + "&to=" + std::to_string(kT0 + 9000));
    ASSERT_EQ(b["records"].size(), 1u);  // `to` excludes the instant itself
    EXPECT_EQ(b["records"][0]["user"], "xem1");
    b = read("?user=kysu1&action=auth.login&from=" + std::to_string(kT0));
    EXPECT_EQ(b["records"].size(), 1u);
}

TEST(AuditApi, LimitPagesAndNextReachTheEnd) {
    Rig r;
    for (int i = 0; i < 6; ++i) {
        r.wall += 1000;
        r.login("kysu1");
    }
    const std::string admin = r.bearer("admin1");
    std::set<int64_t> seen;
    std::string query = "?limit=2&user=kysu1";
    int pages = 0;
    for (;;) {
        const json b = bodyJson(r.call(get("/api/v1/audit" + query, {admin})));
        ASSERT_TRUE(b["records"].is_array());
        EXPECT_LE(b["records"].size(), 2u);
        for (const json& rec : b["records"])
            EXPECT_TRUE(seen.insert(rec["id"].get<int64_t>()).second);
        ++pages;
        if (b["next"].is_null()) break;
        ASSERT_LT(pages, 10);
        query = "?limit=2&user=kysu1&before=" + std::to_string(b["next"].get<int64_t>());
    }
    EXPECT_EQ(seen.size(), 6u);
    EXPECT_EQ(pages, 3);
}

TEST(AuditApi, LimitDefaultsTo100AndIsBetween1And200) {
    Rig r;
    const std::string admin = r.bearer("admin1");
    EXPECT_EQ(r.call(get("/api/v1/audit?limit=1", {admin})).status, 200);
    EXPECT_EQ(r.call(get("/api/v1/audit?limit=200", {admin})).status, 200);
    for (const char* bad : {"limit=0", "limit=201", "limit=-1", "limit=abc", "limit=", "limit=1.5",
                            "limit=99999999999999999999"}) {
        const HttpResult res = r.call(get(std::string("/api/v1/audit?") + bad, {admin}));
        EXPECT_EQ(res.status, 400) << bad;
        EXPECT_EQ(bodyJson(res)["error"], "BAD_REQUEST") << bad;
    }
    // Over 100 rows: the default page holds 100 and says where the next one starts.
    for (int i = 0; i < 105; ++i) {  // rows straight into the log: 105 sign-ins would cost 10 s
        AuditEvent e(AuditAction::AuthLogout, AuditResult::Ok, AuditChannel::Https, "127.0.0.1:1");
        e.user = "kysu1";
        r.audit->append(e);
    }
    const json b = bodyJson(r.call(get("/api/v1/audit", {admin})));
    EXPECT_EQ(b["records"].size(), 100u);
    EXPECT_TRUE(b["next"].is_number());
}

TEST(AuditApi, MalformedParametersAre400) {
    Rig r;
    const std::string admin = r.bearer("admin1");
    const std::string longName(65, 'a');
    for (const std::string& bad : std::vector<std::string>{
             "from=abc", "from=-5", "from=", "to=1.5", "before=0", "before=x", "before=-1",
             "user=" + longName, "action=" + longName, "action=auth%0A", "action=%22x",
             "user=a&user=b", "limit=1&limit=2", "nope=1", "from=1&nope=2"}) {
        const HttpResult res = r.call(get("/api/v1/audit?" + bad, {admin}));
        EXPECT_EQ(res.status, 400) << bad << " " << res.body;
        EXPECT_EQ(bodyJson(res)["error"], "BAD_REQUEST") << bad;
    }
    EXPECT_EQ(r.records("audit.read").size(), 0u);  // a refused request reads (and records) nothing
}

TEST(AuditApi, AuditReadSaysWhichFiltersWereUsedButNothingSecret) {
    Rig r;
    r.login("kysu1");
    const std::string admin = r.bearer("admin1");
    r.call(get("/api/v1/audit?user=kysu1&action=auth.&limit=5", {admin}));
    const auto reads = r.records("audit.read");
    ASSERT_EQ(reads.size(), 1u);
    const json detail = json::parse(reads[0].detail.value_or("{}"));
    EXPECT_EQ(detail["user"], "kysu1");
    EXPECT_EQ(detail["action"], "auth.");
    EXPECT_EQ(detail["limit"], 5);
    EXPECT_EQ(reads[0].target.value_or(""), "/api/v1/audit");
}

TEST(AuditApi, TheAnswerHoldsNoPasswordTokenOrHash) {
    Rig r;
    const std::string kysuToken = r.bearer("kysu1");
    r.login("kysu1");
    HttpRequest bad;
    bad.method = "POST";
    bad.path = "/api/v1/auth/login";
    bad.body = json{{"user", "kysu1"}, {"password", "sai-mat-khau-thu-123456"}}.dump();
    bad.headers = {"Content-Type: application/json"};
    r.call(bad);  // a failed sign-in is recorded
    const HttpResult res = r.getAs("admin1", "/api/v1/audit?limit=200");
    ASSERT_EQ(res.status, 200);
    EXPECT_NE(res.body.find("AUTH_FAILED"), std::string::npos);  // the failure is there…
    const std::string token = kysuToken.substr(kysuToken.find("Bearer ") + 7);
    for (const std::string& secret :
         {token, r.pw["kysu1"], r.pw["admin1"], std::string("sai-mat-khau-thu-123456"),
          std::string("$argon2"), std::string("password"), std::string("token")})
        EXPECT_EQ(res.body.find(secret), std::string::npos) << secret;
}

TEST(AuditApi, AuditDownGivesNoDataBecauseTheReadCannotBeRecorded) {
    Rig r;
    const std::string admin = r.bearer("admin1");
    r.audit->close();  // as if audit.db became unusable after the sign-in
    const HttpResult res = r.call(get("/api/v1/audit", {admin}));
    EXPECT_EQ(res.status, 503);
    EXPECT_EQ(bodyJson(res)["error"], "AUDIT_UNAVAILABLE");
    EXPECT_TRUE(bodyJson(res)["records"].is_null());
}

TEST(AuditApi, AuditReadRestartsTheIdleTimeBecauseAPersonMadeTheRequest) {
    Rig r;
    const std::string admin = r.bearer("admin1");
    r.mono += 10 * kMin;
    ASSERT_EQ(r.call(get("/api/v1/audit", {admin})).status, 200);
    const json s = bodyJson(r.call(get("/api/v1/auth/session", {admin})));
    EXPECT_EQ(s["idleRemainingS"], 1800);
}
