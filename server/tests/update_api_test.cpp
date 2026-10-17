// T107 (feature 011; SC-022; FR-058, FR-059, FR-060, FR-061, FR-065; device-api-011 §3,
// contracts/update-package.md §4 S1–S3, §6): the five update routes on the two listeners of
// mat-runtime in process, over the real audit log, the real sign-in service (fake hash) and the
// update service on a temporary data directory and installed tree.
// - OTA off: 404 UPDATE_DISABLED on all five routes;
// - rights: no session 401, viewer / operator / engineer 403, the page's cookie 403 SESSION_SCOPE,
//   plain HTTP 403 HTTPS_REQUIRED; each refusal audited; nothing written under update/;
// - POST /system/update: `accepted` audited before the first byte (audit down: 503 and nothing
//   received), Content-Length required (chunked 411), application/octet-stream (415), over
//   maxPackageMiB 413, a body cut short or too slow 408 UPDATE_RECEIVE_ABORTED with the files
//   removed and the lock freed; the bad packages of tests/update-vectors refused with their codes
//   (`rejected` audited, update/incoming and update/ready empty); a valid one 201 with its plan;
// - DEVICE_BUSY shared with the deployment, both ways;
// - apply: password missing or wrong 403 REAUTH_FAILED, counted in the lockout of the pair;
//   right: 202, request.json, `applying` audited; the same updateId again 409 DEVICE_BUSY;
// - a verified package expires after 30 minutes; cancel; rollback without .prev 409.
#include <curl/curl.h>
#include <dirent.h>
#include <gtest/gtest.h>
#include <sys/stat.h>

#include <chrono>
#include <fstream>
#include <regex>
#include <thread>

#include "core/update/tests/update_test_support.hpp"
#include "server/tests/api_rig.hpp"
#include "server/update_service.hpp"

using namespace mat;
using namespace mat::test;
using nlohmann::json;

namespace {

const std::string kUpdate = "/api/v1/system/update";

struct Opts {
    bool enabled = true;
    uint64_t maxPackageBytes = 64ULL << 20;
    bool noKeys = false;
    int64_t rateGraceMs = 10000;
    uint64_t minRate = 64 * 1024;
    bool copyKeys = false;  // the trusted keys in a copy (a keyset may change them)
};

struct Rig : ApiRig {
    std::shared_ptr<std::unique_ptr<UpdateService>> holder;
    std::shared_ptr<std::atomic<bool>> deployBusy;
    std::string install;

    explicit Rig(
        Opts o = {},
        std::shared_ptr<std::unique_ptr<UpdateService>> h =
            std::make_shared<std::unique_ptr<UpdateService>>(),
        std::shared_ptr<std::atomic<bool>> busy = std::make_shared<std::atomic<bool>>(false))
        : ApiRig([h, busy, o](ApiRig& r) {
              const std::string inst = r.dir.file("opt-mat-runtime");
              ::mkdir(inst.c_str(), 0755);
              std::ofstream(inst + "/build-info.json") << R"({"version":"1.0.0","releaseSeq":10})";
              UpdateServiceOptions u;
              u.enabled = o.enabled;
              u.maxPackageBytes = o.maxPackageBytes;
              u.trustedKeysDir = o.noKeys ? r.dir.file("no-keys") : vectorPath("keys-trusted");
              if (o.copyKeys) {
                  u.trustedKeysDir = r.dir.file("trusted-keys");
                  ::mkdir(u.trustedKeysDir.c_str(), 0755);
                  writeBytes(u.trustedKeysDir + "/test-ec-p256.pem",
                             readBytes(vectorPath("keys-trusted/test-ec-p256.pem")));
              }
              u.dataDir = r.dataDir;
              u.installRoot = inst;
              u.arch = "armhf";
              u.version = "1.0.0";
              u.projectFormat = [] { return std::string("1.0.0"); };
              u.deployBusy = [busy]() -> std::optional<BusyInfo> {
                  if (!busy->load()) return std::nullopt;
                  BusyInfo b;
                  b.opId = "op_1";
                  b.user = "kysu1";
                  return b;
              };
              u.audit = [&r](const AuditEvent& e) {
                  try {
                      r.audit->append(e);
                      return true;
                  } catch (const std::exception&) {
                      return false;
                  }
              };
              u.wallMs = [&r] { return r.wall.load(); };
              u.monoMs = [&r] { return r.mono.load(); };
              u.rateGraceMs = o.rateGraceMs;
              u.minRateBytesPerS = o.minRate;
              u.log = [](const std::string&) {};
              *h = std::make_unique<UpdateService>(u);
              (*h)->start();
              EngineeringApi::UpdateBackend b;
              b.service = h->get();
              r.eng->setUpdate(b);
          }),
          holder(std::move(h)),
          deployBusy(std::move(busy)) {
        install = dir.file("opt-mat-runtime");
        keys = dir.file("trusted-keys");
    }
    std::string keys;
    UpdateService& svc() { return **holder; }
    std::string upd(const std::string& sub) const { return dataDir + "/update/" + sub; }

    static HttpRequest upload(const std::string& bytes, std::vector<std::string> headers) {
        HttpRequest q;
        q.method = "POST";
        q.path = kUpdate;
        q.body = bytes;
        q.headers = std::move(headers);
        q.headers.push_back("Content-Type: application/octet-stream");
        return q;
    }
    HttpResult send(const std::string& bytes, const std::string& auth) {
        return call(upload(bytes, {auth}));
    }
    HttpResult sendFile(const std::string& rel, const std::string& auth) {
        return send(readBytes(vectorPath(rel)), auth);
    }
};

std::vector<std::string> names(const std::string& dir) {
    std::vector<std::string> out;
    if (DIR* d = ::opendir(dir.c_str())) {
        while (dirent* e = ::readdir(d)) {
            const std::string n = e->d_name;
            if (n != "." && n != "..") out.push_back(n);
        }
        ::closedir(d);
    }
    return out;
}

std::string errorOf(const HttpResult& r) {
    const json b = bodyJson(r);
    return b.contains("error") && b["error"].is_string() ? b["error"].get<std::string>() : "";
}

// ---------------------------------------------------------------- off, rights

TEST(UpdateApi, OffAnswers404OnEveryRoute) {
    Opts o;
    o.enabled = false;
    Rig r(o);
    const std::string a = r.bearer("admin1");
    EXPECT_EQ(errorOf(r.call(getReq(kUpdate, {a}))), "UPDATE_DISABLED");
    const HttpResult up = r.sendFile("valid.matupdate", a);
    EXPECT_EQ(up.status, 404);
    EXPECT_EQ(errorOf(up), "UPDATE_DISABLED");
    for (const char* p : {"/apply", "/cancel", "/rollback"}) {
        const HttpResult x = r.call(postReq(kUpdate + p, "{}", {a}));
        EXPECT_EQ(x.status, 404) << p;
        EXPECT_EQ(errorOf(x), "UPDATE_DISABLED") << p;
    }
    EXPECT_TRUE(names(r.upd("incoming")).empty());
    EXPECT_TRUE(names(r.upd("ready")).empty());
    EXPECT_TRUE(r.records("system.update").empty());
}

TEST(UpdateApi, OnlyAnAdministratorWithBearerOverHttps) {
    Rig r;
    const std::string pkg = readBytes(vectorPath("valid.matupdate"));
    // no session
    HttpResult x = r.call(Rig::upload(pkg, {}));
    EXPECT_EQ(x.status, 401);
    // viewer, operator, engineer
    for (const char* u : {"xem1", "vh1", "kysu1"}) {
        x = r.send(pkg, r.bearer(u));
        EXPECT_EQ(x.status, 403) << u;
        EXPECT_EQ(errorOf(x), "FORBIDDEN") << u;
        EXPECT_EQ(r.call(getReq(kUpdate, {r.bearer(u)})).status, 403) << u;
        EXPECT_EQ(r.call(postReq(kUpdate + "/apply", "{}", {r.bearer(u)})).status, 403) << u;
    }
    // the cookie of the page: a real web session of the administrator
    const std::string origin = r.https();
    const HttpResult web = r.call(postReq(
        "/api/v1/web/login", json{{"username", "admin1"}, {"password", r.pw["admin1"]}}.dump(),
        {"Origin: " + origin}));
    ASSERT_EQ(web.status, 200) << web.body;
    const size_t at = web.headers.find("__Host-mat_sid=");
    ASSERT_NE(at, std::string::npos) << web.headers;
    const std::string cookie = web.headers.substr(at, web.headers.find(';', at) - at);
    const std::string csrf = bodyJson(web).value("csrfToken", "");
    x = r.call(Rig::upload(pkg, {"Cookie: " + cookie, "Origin: " + origin, "X-MAT-CSRF: " + csrf}));
    EXPECT_EQ(x.status, 403);
    EXPECT_EQ(errorOf(x), "SESSION_SCOPE");
    // plain HTTP, even with the administrator's token
    x = r.callHttp(Rig::upload(pkg, {r.bearer("admin1")}));
    EXPECT_EQ(x.status, 403);
    EXPECT_EQ(errorOf(x), "HTTPS_REQUIRED");
    EXPECT_EQ(r.callHttp(getReq(kUpdate, {r.bearer("admin1")})).status, 403);
    // refusals are audited; nothing received
    EXPECT_FALSE(r.records("access.denied").empty());
    EXPECT_TRUE(r.records("system.update").empty());
    EXPECT_TRUE(names(r.upd("incoming")).empty());
    EXPECT_TRUE(names(r.upd("ready")).empty());
}

// ---------------------------------------------------------------- upload

TEST(UpdateApi, AValidPackageIsVerifiedWithItsPlan) {
    Rig r;
    const std::string a = r.bearer("admin1");
    const HttpResult x = r.sendFile("valid.matupdate", a);
    ASSERT_EQ(x.status, 201) << x.body;
    const json b = bodyJson(x);
    const std::string id = b.value("updateId", "");
    EXPECT_TRUE(std::regex_match(id, std::regex("^upd_[0-9a-f]{16}$"))) << id;
    EXPECT_EQ(b["state"], "verified");
    const json& plan = b["plan"];
    EXPECT_EQ(plan["from"], "1.0.0");
    EXPECT_EQ(plan["to"], "1.0.1");
    EXPECT_EQ(plan["releaseSeq"], 11);
    EXPECT_EQ(plan["signer"]["keyId"], vectorCases()["valid"]["keyId"]);
    EXPECT_EQ(plan["signer"]["label"], "test-ec-p256");
    EXPECT_EQ(plan["projectCompatible"], true);
    EXPECT_EQ(plan["restartRequired"], true);
    EXPECT_GT(plan["estimatedDowntimeS"].get<int>(), 0);
    // ready/<id>.matupdate (0600), nothing left in incoming/, the step recorded
    const std::string ready = r.upd("ready/" + id + ".matupdate");
    struct stat st {};
    ASSERT_EQ(::stat(ready.c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 0777, 0600u);
    EXPECT_TRUE(names(r.upd("incoming")).empty());
    const json op = json::parse(readBytes(r.upd("ops/" + id + ".json")));
    EXPECT_EQ(op["step"], 2);
    EXPECT_EQ(op["name"], "verified");
    // GET
    const json s = bodyJson(r.call(getReq(kUpdate, {a})));
    EXPECT_EQ(s["enabled"], true);
    EXPECT_EQ(s["state"], "verified");
    EXPECT_EQ(s["updateId"], id);
    EXPECT_EQ(s["plan"]["to"], "1.0.1");
    // audit: accepted then verified, both by admin1
    const auto acc = r.records("system.update.accepted");
    ASSERT_EQ(acc.size(), 1u);
    EXPECT_EQ(acc[0].user, "admin1");
}

TEST(UpdateApi, AcceptedIsAuditedBeforeTheFirstByte) {
    Rig r;
    const std::string a = r.bearer("admin1");
    r.audit->close();  // the audit log is down: nothing may be received
    const HttpResult x = r.sendFile("valid.matupdate", a);
    EXPECT_EQ(x.status, 503);
    EXPECT_EQ(errorOf(x), "AUDIT_UNAVAILABLE");
    EXPECT_TRUE(names(r.upd("incoming")).empty());
    EXPECT_TRUE(names(r.upd("ready")).empty());
    EXPECT_FALSE(r.svc().busy().has_value());
}

TEST(UpdateApi, LengthTypeAndSizeAreCheckedBeforeTheBody) {
    Opts o;
    o.maxPackageBytes = 4096;
    Rig r(o);
    const std::string a = r.bearer("admin1");
    HttpRequest q = Rig::upload(readBytes(vectorPath("valid.matupdate")), {a});
    q.headers.back() = "Content-Type: application/zip";
    EXPECT_EQ(r.call(q).status, 415);
    q.headers.back() = "Content-Type: application/octet-stream";
    q.headers.push_back("Transfer-Encoding: chunked");
    EXPECT_EQ(r.call(q).status, 411);
    const HttpResult big = r.sendFile("valid.matupdate", a);  // 5 KiB > 4 KiB
    EXPECT_EQ(big.status, 413);
    EXPECT_EQ(errorOf(big), "UPDATE_TOO_LARGE");
    EXPECT_FALSE(r.records("system.update.rejected").empty());
    EXPECT_TRUE(names(r.upd("incoming")).empty());
    EXPECT_FALSE(r.svc().busy().has_value());
}

TEST(UpdateApi, KeysMissingRefusesUploads) {
    Opts o;
    o.noKeys = true;
    Rig r(o);
    const HttpResult x = r.sendFile("valid.matupdate", r.bearer("admin1"));
    EXPECT_EQ(x.status, 503);
    EXPECT_EQ(errorOf(x), "UPDATE_KEYS_MISSING");
    EXPECT_EQ(r.svc().infoBlock()["keys"], 0);
}

TEST(UpdateApi, EveryBadPackageIsRefusedWithItsCodeAndNothingStays) {
    Rig r;
    const std::string a = r.bearer("admin1");
    const json meta = vectorCases();
    int n = 0;
    for (const auto& c : meta["cases"]) {
        if (c.contains("api") || c.contains("device")) continue;  // below
        const std::string path = vectorPath(c["file"]);
        ASSERT_TRUE(exists(path))
            << path << " missing: run node tools/release/make-update.mjs --vectors --out";
        const HttpResult x = r.send(readBytes(path), a);
        const json& e = c["expect"];
        EXPECT_EQ(x.status, e["http"].get<int>()) << c["name"] << " " << x.body;
        EXPECT_EQ(errorOf(x), e["code"].get<std::string>()) << c["name"];
        if (e.contains("detailCode")) {
            EXPECT_EQ(bodyJson(x)["detail"].value("code", ""), e["detailCode"].get<std::string>())
                << c["name"];
        }
        EXPECT_TRUE(names(r.upd("incoming")).empty()) << c["name"];
        EXPECT_TRUE(names(r.upd("ready")).empty()) << c["name"];
        EXPECT_FALSE(r.svc().busy().has_value()) << c["name"];
        ++n;
    }
    EXPECT_GE(n, 28);
    EXPECT_EQ(static_cast<int>(r.records("system.update.rejected").size()), n);
    // the installed tree is untouched
    EXPECT_EQ(readBytes(r.install + "/build-info.json"), R"({"version":"1.0.0","releaseSeq":10})");
    EXPECT_FALSE(exists(r.upd("request.json")));
}

// A body shorter than its Content-Length, then the connection closed (case 30 of §6).
HttpResult shortBody(Rig& r, const std::string& auth, const std::string& part, size_t claimed,
                     int pauseMs = 0) {
    CURL* c = curl_easy_init();
    curl_easy_setopt(c, CURLOPT_URL, r.https().c_str());
    curl_easy_setopt(c, CURLOPT_CONNECT_ONLY, 1L);
    curl_easy_setopt(c, CURLOPT_SSL_VERIFYPEER, 0L);
    curl_easy_setopt(c, CURLOPT_SSL_VERIFYHOST, 0L);
    HttpResult out;
    if (curl_easy_perform(c) != CURLE_OK) {
        curl_easy_cleanup(c);
        return out;
    }
    const std::string head =
        "POST " + kUpdate + " HTTP/1.1\r\nHost: 127.0.0.1\r\n" + auth +
        "\r\nContent-Type: application/octet-stream\r\nContent-Length: " + std::to_string(claimed) +
        "\r\n\r\n";
    auto sendAll = [&](const std::string& s) {
        size_t off = 0;
        while (off < s.size()) {
            size_t sent = 0;
            const CURLcode rc = curl_easy_send(c, s.data() + off, s.size() - off, &sent);
            if (rc == CURLE_AGAIN) {
                std::this_thread::sleep_for(std::chrono::milliseconds(5));
                continue;
            }
            if (rc != CURLE_OK) return;
            off += sent;
        }
    };
    sendAll(head);
    std::string got;
    auto poll = [&] {
        char buf[4096];
        size_t n = 0;
        if (curl_easy_recv(c, buf, sizeof buf, &n) == CURLE_OK && n) got.append(buf, n);
    };
    if (pauseMs) {  // a drip of 600 bytes every pauseMs until the server answers (at most 8 s)
        const auto stop = std::chrono::steady_clock::now() + std::chrono::seconds(8);
        for (size_t off = 0;
             off < part.size() && got.empty() && std::chrono::steady_clock::now() < stop;
             off += 600) {
            sendAll(part.substr(off, 600));
            std::this_thread::sleep_for(std::chrono::milliseconds(pauseMs));
            poll();
        }
    } else {
        sendAll(part);
    }
    // read the answer when the server gives one before the end (the slow case)
    const auto until =
        std::chrono::steady_clock::now() + std::chrono::milliseconds(pauseMs ? 3000 : 300);
    while (std::chrono::steady_clock::now() < until) {
        char buf[4096];
        size_t n = 0;
        const CURLcode rc = curl_easy_recv(c, buf, sizeof buf, &n);
        if (rc == CURLE_AGAIN) {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
            continue;
        }
        if (rc != CURLE_OK || n == 0) break;
        got.append(buf, n);
        if (got.find("\r\n\r\n") != std::string::npos && got.find('}') != std::string::npos) break;
    }
    curl_easy_cleanup(c);  // closes: the server sees the end of the body
    if (got.rfind("HTTP/1.1 ", 0) == 0) out.status = std::stol(got.substr(9, 3));
    const size_t body = got.find("\r\n\r\n");
    if (body != std::string::npos) out.body = got.substr(body + 4);
    out.curlCode = 0;
    return out;
}

void waitIdle(Rig& r) {
    for (int i = 0; i < 300 && r.svc().busy(); ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
}

TEST(UpdateApi, ABodyCutShortIsAbortedCleanedAndFreesTheLock) {
    Rig r;
    const std::string a = r.bearer("admin1");
    const std::string pkg = readBytes(vectorPath("valid.matupdate"));
    shortBody(r, a, pkg.substr(0, 1000), pkg.size());
    waitIdle(r);
    EXPECT_FALSE(r.svc().busy().has_value());
    EXPECT_TRUE(names(r.upd("incoming")).empty());
    EXPECT_TRUE(names(r.upd("ready")).empty());
    const auto rej = r.records("system.update.rejected");
    ASSERT_EQ(rej.size(), 1u);
    EXPECT_EQ(rej[0].code, "UPDATE_RECEIVE_ABORTED");
    // the next upload goes through
    EXPECT_EQ(r.send(pkg, a).status, 201);
}

TEST(UpdateApi, ASlowSenderIsAborted) {
    Opts o;
    o.rateGraceMs = 200;
    o.minRate = 1 << 20;  // 1 MiB/s: 600 bytes per 300 ms is far below
    Rig r(o);
    const std::string a = r.bearer("admin1");
    const std::string pkg = readBytes(vectorPath("valid.matupdate"));
    const HttpResult x = shortBody(r, a, pkg, pkg.size(), 300);
    EXPECT_EQ(x.status, 408) << x.body;
    EXPECT_EQ(errorOf(x), "UPDATE_RECEIVE_ABORTED");
    waitIdle(r);
    EXPECT_TRUE(names(r.upd("incoming")).empty());
    EXPECT_FALSE(r.svc().busy().has_value());
}

// ---------------------------------------------------------------- busy

TEST(UpdateApi, DeviceBusyIsSharedWithTheDeployment) {
    Rig r;
    const std::string a = r.bearer("admin1");
    r.deployBusy->store(true);
    HttpResult x = r.sendFile("valid.matupdate", a);
    EXPECT_EQ(x.status, 409);
    EXPECT_EQ(errorOf(x), "DEVICE_BUSY");
    r.deployBusy->store(false);
    x = r.sendFile("valid.matupdate", a);
    ASSERT_EQ(x.status, 201);
    // a verified package holds the device: a second upload and the deployment are refused
    EXPECT_EQ(errorOf(r.sendFile("valid.matupdate", a)), "DEVICE_BUSY");
    const auto busy = r.svc().busy();
    ASSERT_TRUE(busy.has_value());
    EXPECT_EQ(busy->user, "admin1");
}

// ---------------------------------------------------------------- apply, cancel, expiry, rollback

std::string verified(Rig& r, const std::string& a) {
    const HttpResult x = r.sendFile("valid.matupdate", a);
    EXPECT_EQ(x.status, 201) << x.body;
    return bodyJson(x).value("updateId", "");
}

TEST(UpdateApi, ApplyNeedsThePasswordAgain) {
    Rig r;
    const std::string a = r.bearer("admin1");
    const std::string id = verified(r, a);
    // missing, wrong
    HttpResult x = r.call(postReq(kUpdate + "/apply", json{{"updateId", id}}.dump(), {a}));
    EXPECT_EQ(x.status, 403);
    EXPECT_EQ(errorOf(x), "REAUTH_FAILED");
    x = r.call(postReq(kUpdate + "/apply",
                       json{{"updateId", id}, {"password", "sai-mat-khau-123"}}.dump(), {a}));
    EXPECT_EQ(x.status, 403);
    EXPECT_EQ(errorOf(x), "REAUTH_FAILED");
    EXPECT_FALSE(exists(r.upd("request.json")));
    // wrong passwords count in the lockout of (admin1, 127.0.0.1): the fifth locks the pair
    for (int i = 0; i < 4; ++i)
        r.call(postReq(kUpdate + "/apply",
                       json{{"updateId", id}, {"password", "sai-mat-khau-123"}}.dump(), {a}));
    x = r.call(postReq(kUpdate + "/apply",
                       json{{"updateId", id}, {"password", r.pw["admin1"]}}.dump(), {a}));
    EXPECT_EQ(x.status, 429) << x.body;
    EXPECT_EQ(r.login("admin1").status, 429);  // the sign-in of the same pair too
    EXPECT_FALSE(r.records("auth.lockout").empty());
}

TEST(UpdateApi, ApplyWritesTheRequestAndAuditsFirst) {
    Rig r;
    const std::string a = r.bearer("admin1");
    const std::string id = verified(r, a);
    const HttpResult x = r.call(postReq(
        kUpdate + "/apply", json{{"updateId", id}, {"password", r.pw["admin1"]}}.dump(), {a}));
    ASSERT_EQ(x.status, 202) << x.body;
    EXPECT_EQ(bodyJson(x)["state"], "applying");
    const json req = json::parse(readBytes(r.upd("request.json")));
    EXPECT_EQ(req["updateId"], id);
    EXPECT_EQ(req["op"], "apply");
    EXPECT_EQ(req["user"], "admin1");
    EXPECT_EQ(req["sha256"].get<std::string>().size(), 64u);
    EXPECT_EQ(req["sha256"], bodyJson(r.call(getReq(kUpdate, {a})))["sha256"]);
    EXPECT_EQ(r.records("system.update.applying").size(), 1u);
    EXPECT_FALSE(r.records("auth.reauth").empty());
    const json op = json::parse(readBytes(r.upd("ops/" + id + ".json")));
    EXPECT_EQ(op["step"], 3);
    EXPECT_EQ(op["name"], "requested");
    EXPECT_EQ(bodyJson(r.call(getReq(kUpdate, {a})))["state"], "applying");
    // case 29: the same updateId again
    const HttpResult again = r.call(postReq(
        kUpdate + "/apply", json{{"updateId", id}, {"password", r.pw["admin1"]}}.dump(), {a}));
    EXPECT_EQ(again.status, 409);
    EXPECT_EQ(errorOf(again), "DEVICE_BUSY");
    // the password never reaches a file
    EXPECT_EQ(readBytes(r.upd("request.json")).find(r.pw["admin1"]), std::string::npos);
}

TEST(UpdateApi, AVerifiedPackageExpiresAfterThirtyMinutes) {
    Rig r;
    const std::string a = r.bearer("admin1");
    const std::string id = verified(r, a);
    r.mono += 29 * 60 * 1000;
    EXPECT_EQ(bodyJson(r.call(getReq(kUpdate, {r.bearer("admin1")})))["state"], "verified");
    r.mono += 2 * 60 * 1000;
    const std::string b = r.bearer("admin1");
    EXPECT_EQ(bodyJson(r.call(getReq(kUpdate, {b})))["state"], "idle");
    EXPECT_TRUE(names(r.upd("ready")).empty());
    const HttpResult x = r.call(postReq(
        kUpdate + "/apply", json{{"updateId", id}, {"password", r.pw["admin1"]}}.dump(), {b}));
    EXPECT_EQ(x.status, 404);
    EXPECT_EQ(errorOf(x), "UPDATE_NOT_FOUND");
    EXPECT_FALSE(r.svc().busy().has_value());
}

TEST(UpdateApi, CancelFreesTheDevice) {
    Rig r;
    const std::string a = r.bearer("admin1");
    const std::string id = verified(r, a);
    EXPECT_EQ(
        r.call(postReq(kUpdate + "/cancel", json{{"updateId", "upd_0000000000000000"}}.dump(), {a}))
            .status,
        404);
    const HttpResult x = r.call(postReq(kUpdate + "/cancel", json{{"updateId", id}}.dump(), {a}));
    EXPECT_EQ(x.status, 200) << x.body;
    EXPECT_EQ(bodyJson(x)["state"], "idle");
    EXPECT_TRUE(names(r.upd("ready")).empty());
    EXPECT_FALSE(r.svc().busy().has_value());
    EXPECT_EQ(r.records("system.update.cancelled").size(), 1u);
}

TEST(UpdateApi, RollbackNeedsAPreviousTreeAndThePassword) {
    Rig r;
    const std::string a = r.bearer("admin1");
    HttpResult x =
        r.call(postReq(kUpdate + "/rollback", json{{"password", r.pw["admin1"]}}.dump(), {a}));
    EXPECT_EQ(x.status, 409);
    EXPECT_EQ(errorOf(x), "UPDATE_NO_PREVIOUS");
    const std::string prev = r.install + ".prev";
    ::mkdir(prev.c_str(), 0755);
    ::mkdir((prev + "/bin").c_str(), 0755);
    std::ofstream(prev + "/bin/mat-runtime") << "#!/bin/sh\n";
    std::ofstream(prev + "/build-info.json") << R"({"version":"0.9.0","releaseSeq":9})";
    EXPECT_EQ(bodyJson(r.call(getReq(kUpdate, {a})))["previous"]["version"], "0.9.0");
    x = r.call(postReq(kUpdate + "/rollback", json{{"password", "sai-mat-khau-123"}}.dump(), {a}));
    EXPECT_EQ(errorOf(x), "REAUTH_FAILED");
    x = r.call(postReq(kUpdate + "/rollback", json{{"password", r.pw["admin1"]}}.dump(), {a}));
    ASSERT_EQ(x.status, 202) << x.body;
    const json req = json::parse(readBytes(r.upd("request.json")));
    EXPECT_EQ(req["op"], "rollback");
    EXPECT_TRUE(
        std::regex_match(req["updateId"].get<std::string>(), std::regex("^upd_[0-9a-f]{16}$")));
    EXPECT_EQ(r.records("system.update.manual-rollback").size(), 1u);
}

// ---------------------------------------------------------------- the result of mat-updater, live

// What mat-updater (root) leaves when it ends without restarting the runtime: request.json taken,
// last.json written as matscada with audited false (contracts/update-package.md §5).
void rootFinished(Rig& r, const std::string& id, const std::string& op, const std::string& result,
                  const std::string& code) {
    ::unlink(r.upd("request.json").c_str());
    writeBytes(r.upd("last.json"),
               json{{"updateId", id},
                    {"op", op},
                    {"result", result},
                    {"from", "1.0.0"},
                    {"to", "1.0.1"},
                    {"user", "admin1"},
                    {"code", code},
                    {"reason", "test"},
                    {"finishedAt", "2026-10-17T00:00:00Z"},
                    {"finishedAtMs", 1},
                    {"audited", false}}
                   .dump(),
               0600);
}

std::string applied(Rig& r, const std::string& a, const std::string& file) {
    const HttpResult v = r.sendFile(file, a);
    EXPECT_EQ(v.status, 201) << v.body;
    const std::string id = bodyJson(v).value("updateId", "");
    const HttpResult x = r.call(postReq(
        kUpdate + "/apply", json{{"updateId", id}, {"password", r.pw["admin1"]}}.dump(), {a}));
    EXPECT_EQ(x.status, 202) << x.body;
    return id;
}

// review 011 (T062): a refusal of the root side before the switch (RATE_LIMITED, sha256, verify,
// self-check, UPDATER_MANUAL_ONLY) leaves the runtime running: its result is audited and the
// device freed at once, not at the next restart.
TEST(UpdateApi, ARootSideRefusalIsAuditedAndFreesTheDeviceWithoutARestart) {
    Rig r;
    const std::string a = r.bearer("admin1");
    const std::string id = applied(r, a, "valid.matupdate");
    ASSERT_TRUE(r.svc().busy().has_value());
    rootFinished(r, id, "apply", "failed", "RATE_LIMITED");
    const json s = bodyJson(r.call(getReq(kUpdate, {a})));
    EXPECT_NE(s["state"], "applying");
    EXPECT_EQ(s["last"]["updateId"], id);
    EXPECT_EQ(s["last"]["result"], "failed");
    EXPECT_FALSE(r.svc().busy().has_value());
    const auto rej = r.records("system.update.rejected");
    ASSERT_EQ(rej.size(), 1u);
    EXPECT_EQ(rej[0].code, "RATE_LIMITED");
    EXPECT_EQ(rej[0].target, id);
    EXPECT_EQ(json::parse(readBytes(r.upd("last.json")))["audited"], true);
    // audited once: not again at the next start
    r.svc().start();
    EXPECT_EQ(r.records("system.update.rejected").size(), 1u);
    // the device takes the next upload
    EXPECT_EQ(r.sendFile("valid.matupdate", a).status, 201);
}

TEST(UpdateApi, TheTickSettlesARootSideResultWithoutAStatusRequest) {
    Rig r;
    const std::string a = r.bearer("admin1");
    const std::string id = applied(r, a, "valid.matupdate");
    rootFinished(r, id, "apply", "failed", "SELF_CHECK_FAILED");
    r.svc().expire();  // the runtime's tick
    EXPECT_FALSE(r.svc().busy().has_value());
    const auto rej = r.records("system.update.rejected");
    ASSERT_EQ(rej.size(), 1u);
    EXPECT_EQ(rej[0].code, "SELF_CHECK_FAILED");
}

TEST(UpdateApi, AResultOfAnotherUpdateDoesNotFreeTheDevice) {
    Rig r;
    const std::string a = r.bearer("admin1");
    applied(r, a, "valid.matupdate");
    rootFinished(r, "upd_0000000000000000", "apply", "failed", "RATE_LIMITED");
    r.svc().expire();
    EXPECT_EQ(bodyJson(r.call(getReq(kUpdate, {a})))["state"], "applying");
    EXPECT_TRUE(r.svc().busy().has_value());
    EXPECT_TRUE(r.records("system.update.rejected").empty());
}

TEST(UpdateApi, ACommittedKeysetIsAuditedOnceAndTheKeysReloaded) {
    Opts o;
    o.copyKeys = true;
    Rig r(o);
    const std::string a = r.bearer("admin1");
    const std::string id = applied(r, a, "keyset-add.matupdate");
    EXPECT_EQ(json::parse(readBytes(r.upd("request.json")))["op"], "keyset");
    // mat-updater swapped the key set in (a keyset does not restart the runtime)
    writeBytes(r.keys + "/test-ec-p256-other.pem",
               readBytes(vectorPath("keys/test-ec-p256-other.pub.pem")));
    rootFinished(r, id, "keyset", "committed", "");
    const json s = bodyJson(r.call(getReq(kUpdate, {a})));
    EXPECT_NE(s["state"], "applying");
    EXPECT_EQ(s["keys"], 2);
    EXPECT_FALSE(r.svc().busy().has_value());
    ASSERT_EQ(r.records("system.keys.updated").size(), 1u);
    // the key change is not audited a second time at the next start (keys-seen.json)
    r.svc().start();
    EXPECT_EQ(r.records("system.keys.updated").size(), 1u);
}

}  // namespace
