// The engineering API of mat-runtime in process for tests (feature 006 T105, T144): the two
// CivetWeb listeners (HTTP and HTTPS), the real audit log and sign-in service (fake hash), four
// accounts (administrator, engineer, operator, viewer), clocks the test moves. Each test adds the
// backends it exercises through `configure`, before the routes are installed.
#pragma once
#include <curl/curl.h>
#include <gtest/gtest.h>
#include <sys/stat.h>

#include <atomic>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/auth/auth_service.hpp"
#include "core/auth/tests/auth_test_support.hpp"
#include "nlohmann/json.hpp"
#include "server/device_state.hpp"
#include "server/http/engineering_api.hpp"
#include "server/http/web_contexts.hpp"
#include "server/tests/tls_test_support.hpp"
#include "server/tls/server_cert.hpp"

namespace mat::test {

constexpr int64_t kApiT0 = 1791600000000LL;

inline nlohmann::json bodyJson(const HttpResult& r) {
    nlohmann::json j = nlohmann::json::parse(r.body, nullptr, false);
    return j.is_discarded() ? nlohmann::json::object() : j;
}

inline HttpRequest getReq(const std::string& path, std::vector<std::string> headers = {}) {
    HttpRequest q;
    q.method = "GET";
    q.path = path;
    q.headers = std::move(headers);
    return q;
}

inline HttpRequest postReq(const std::string& path, const std::string& body,
                           std::vector<std::string> headers = {}) {
    HttpRequest q;
    q.method = "POST";
    q.path = path;
    q.body = body;
    q.headers = std::move(headers);
    q.headers.push_back("Content-Type: application/json");
    return q;
}

struct ApiRig {
    // Runs once the audit log, the sign-in service and the API object exist, before the routes are
    // installed: the place to give the API its backends.
    using Configure = std::function<void(ApiRig&)>;
    using AuditTweak = std::function<void(AuditOptions&)>;

    explicit ApiRig(Configure configure = {}, AuditTweak tweak = {}) {
        dataDir = dir.file("data");
        ::mkdir(dataDir.c_str(), 0700);
        usersFile = dir.file("users.json");
        std::vector<TestAccount> list;
        for (const auto& a :
             std::vector<std::pair<std::string, std::string>>{{"admin1", "administrator"},
                                                              {"kysu1", "engineer"},
                                                              {"vh1", "operator"},
                                                              {"vh2", "operator"},
                                                              {"xem1", "viewer"}}) {
            pw[a.first] = randomPassword();
            list.push_back({a.first, a.second, fakePhc(pw[a.first])});
        }
        writeFile(usersFile, usersText(list));

        AuditOptions ao;
        ao.dataDir = dataDir;
        ao.clock.wallMs = [this] { return wall.load(); };
        ao.clock.monoMs = [this] { return mono.load(); };
        ao.clock.synced = [](int64_t) { return true; };
        if (tweak) tweak(ao);
        audit = std::make_unique<AuditLog>(ao);
        std::string err;
        EXPECT_TRUE(audit->open(err)) << err;

        AuthOptions au;
        au.usersFile = usersFile;
        au.audit = [this](const AuditEvent& e) { audit->append(e); };
        au.log = [](const std::string&) {};
        au.monoMs = [this] { return mono.load(); };
        au.hash = [](std::string_view password, const PasswordHash& ref) {
            return fakeHash(password, ref);
        };
        au.bootId = [] { return std::string("0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0"); };
        auth = std::make_unique<AuthService>(au);

        DeviceFacts facts;
        facts.deviceId = loadOrCreateDeviceId(dataDir).id;
        facts.name = "BL335-thử";
        facts.model = "BL335";
        device = std::make_unique<DeviceState>(facts);

        WebOptions wo;
        wo.httpListen = "127.0.0.1:0";
        wo.httpsListen = "127.0.0.1:0s";
        cert = loadOrCreateServerCert({dataDir, facts.name, "mat-test"});
        eng = std::make_unique<EngineeringApi>(EngineeringApi::Options{}, *device, *auth, *audit);
        if (configure) configure(*this);
        wo.hostPolicy = hostPolicy;  // feature 011: set by `configure` (null: no Host check)
        std::string e;
        EXPECT_TRUE(web.startHttp(wo, e)) << e;
        EXPECT_EQ(web.startHttps(wo, cert, e), HttpsState::Ok) << e;
        device->setPorts(web.httpPort(), web.httpsPort());
        for (mg_context* ctx : {web.http(), web.https()})
            if (ctx) eng->install(ctx);
    }
    ~ApiRig() { web.stop(); }

    std::string https() const { return httpsUrl(web.httpsPort()); }
    std::string http() const { return "http://127.0.0.1:" + std::to_string(web.httpPort()); }
    HttpResult call(const HttpRequest& q) {
        CurlClient c(https());
        return c.request(q);
    }
    HttpResult callHttp(const HttpRequest& q) {
        CurlClient c(http());
        return c.request(q);
    }
    HttpResult login(const std::string& user) {
        return call(postReq("/api/v1/auth/login",
                            nlohmann::json{{"user", user}, {"password", pw[user]}}.dump()));
    }
    std::string bearer(const std::string& user) {
        const HttpResult r = login(user);
        EXPECT_EQ(r.status, 200) << r.body;
        return "Authorization: Bearer " + bodyJson(r).value("token", "");
    }
    HttpResult postAs(const std::string& user, const std::string& path, const std::string& body) {
        return call(postReq(path, body, {bearer(user)}));
    }
    HttpResult getAs(const std::string& user, const std::string& path) {
        return call(getReq(path, {bearer(user)}));
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
    std::atomic<int64_t> wall{kApiT0};
    std::unique_ptr<AuditLog> audit;
    std::unique_ptr<AuthService> auth;
    std::unique_ptr<DeviceState> device;
    ServerCert cert;
    std::unique_ptr<EngineeringApi> eng;
    const HostPolicy* hostPolicy = nullptr;  // must outlive `web`
    WebContexts web;                         // last: stopped first
};

}  // namespace mat::test
