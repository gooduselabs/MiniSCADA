// T001 (feature 025, specs/025-data-api FR-001 to FR-005, FR-008): API keys. The token and its
// hash, the addresses and networks, api-keys.json (shape, damage, never the token), the checks of a
// request (unknown, expired, source, rate, the source that guesses keys), the changes by `rev`.
#include "core/auth/api_keys.hpp"

#include <gtest/gtest.h>
#include <sys/stat.h>

#include <fstream>
#include <sstream>
#include <string>

#include "core/auth/tests/auth_test_support.hpp"

namespace mat {
namespace {

using mat::test::TempDir;

constexpr int64_t kNow = 1793000000000LL;  // 2026-10-27

struct Rig {
    TempDir dir;
    int64_t wall = kNow;
    int64_t mono = 1000000;
    int tokens = 0;
    std::unique_ptr<ApiKeyService> svc;

    explicit Rig(bool loadNow = true) {
        ::mkdir(dir.file("auth").c_str(), 0700);
        build();
        if (loadNow) {
            std::string err;
            EXPECT_TRUE(svc->load(err)) << err;
        }
    }
    void build() {
        ApiKeyService::Options o;
        o.dir = dir.file("auth");
        o.ownerUser = "no-such-user-mat";
        o.wallMs = [this] { return wall; };
        o.monoMs = [this] { return mono; };
        svc = std::make_unique<ApiKeyService>(o);
    }
    std::string path() { return dir.file("auth") + "/" + kApiKeysFileName; }
    std::string text() {
        std::ifstream f(path());
        std::stringstream s;
        s << f.rdbuf();
        return s.str();
    }
    // A key made through the service; its token.
    std::string make(ApiKey draft, ApiKey* out = nullptr) {
        std::string token, err;
        ApiKey made;
        int64_t rev = 0;
        const int64_t before = svc->list().rev;
        EXPECT_EQ(svc->create(before, std::move(draft), "admin", token, made, rev, err),
                  ApiKeyChange::Ok)
            << err;
        if (out) *out = made;
        return token;
    }
    static ApiKey draft(const std::string& name = "ERP") {
        ApiKey k;
        k.name = name;
        return k;
    }
};

TEST(ApiKeys, TokenShapeAndHash) {
    const std::string t = newApiKeyToken();
    EXPECT_EQ(t.size(), kApiKeyTokenLength);
    EXPECT_EQ(t.rfind("matk_", 0), 0u);
    EXPECT_TRUE(isApiKeyFormat(t));
    EXPECT_NE(t, newApiKeyToken());
    EXPECT_FALSE(isApiKeyFormat("mats_" + t.substr(5)));
    EXPECT_FALSE(isApiKeyFormat(t.substr(0, 47)));
    EXPECT_FALSE(isApiKeyFormat(t + "A"));
    EXPECT_FALSE(isApiKeyFormat("matk_" + std::string(42, 'A') + "+"));
    EXPECT_EQ(apiKeyHash(t).size(), 64u);
    EXPECT_EQ(apiKeyHash("abc"),
              "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}

TEST(ApiKeys, AddressesAndNetworks) {
    const auto n24 = parseIpNet("192.0.2.0/24");
    ASSERT_TRUE(n24);
    EXPECT_TRUE(ipInNet("192.0.2.77", *n24));
    EXPECT_FALSE(ipInNet("192.0.3.1", *n24));
    EXPECT_TRUE(ipInNet("::ffff:192.0.2.9", *n24)) << "IPv4 seen as IPv6";
    const auto one = parseIpNet("198.51.100.7");
    ASSERT_TRUE(one);
    EXPECT_EQ(one->prefix, 32);
    EXPECT_TRUE(ipInNet("198.51.100.7", *one));
    EXPECT_FALSE(ipInNet("198.51.100.8", *one));
    const auto v6 = parseIpNet("2001:db8::/32");
    ASSERT_TRUE(v6);
    EXPECT_TRUE(ipInNet("2001:db8:1::5", *v6));
    EXPECT_FALSE(ipInNet("2001:db9::1", *v6));
    EXPECT_FALSE(ipInNet("192.0.2.1", *v6));
    const auto all = parseIpNet("0.0.0.0/0");
    ASSERT_TRUE(all);
    EXPECT_TRUE(ipInNet("203.0.113.5", *all));
    EXPECT_FALSE(ipInNet("not-an-ip", *all));
    for (const char* bad :
         {"", "192.0.2.0/33", "192.0.2.0/", "192.0.2.0/-1", "192.0.2/24", "2001:db8::/129",
          "host.example.com", "192.0.2.0/24/1", "192.0.2.0/2a", " 192.0.2.1"})
        EXPECT_FALSE(parseIpNet(bad)) << bad;
}

TEST(ApiKeys, IsoDates) {
    EXPECT_EQ(parseIsoUtcMs("1970-01-01T00:00:01Z"), 1000);
    EXPECT_EQ(parseIsoUtcMs("2026-10-27T00:00:00.250Z"), 1793059200250LL);
    EXPECT_FALSE(parseIsoUtcMs("2026-10-27"));
    EXPECT_FALSE(parseIsoUtcMs("2026-13-01T00:00:00Z"));
    EXPECT_FALSE(parseIsoUtcMs("2026-10-27T00:00:00+07:00"));
    EXPECT_EQ(isoUtcText(1793059200250LL), "2026-10-27T00:00:00.250Z");
}

TEST(ApiKeys, SettingsAreChecked) {
    ApiKey k = Rig::draft();
    EXPECT_EQ(apiKeySettingsProblem(k, kNow), "");
    auto bad = [&](auto change) {
        ApiKey x = Rig::draft();
        change(x);
        return !apiKeySettingsProblem(x, kNow).empty();
    };
    EXPECT_TRUE(bad([](ApiKey& x) { x.name = ""; }));
    EXPECT_TRUE(bad([](ApiKey& x) { x.name = std::string(65, 'a'); }));
    EXPECT_TRUE(bad([](ApiKey& x) { x.name = "a\nb"; }));
    EXPECT_TRUE(bad([](ApiKey& x) { x.role = Role::Engineer; }));
    EXPECT_TRUE(bad([](ApiKey& x) { x.role = Role::Administrator; }));
    EXPECT_TRUE(bad([](ApiKey& x) { x.groups = {"Not A Group"}; }));
    EXPECT_TRUE(bad([](ApiKey& x) { x.groups = {"ca-sang", "ca-sang"}; }));
    EXPECT_TRUE(bad([](ApiKey& x) { x.allowFrom = {"192.0.2.0/40"}; }));
    EXPECT_TRUE(bad([](ApiKey& x) { x.allowFrom.assign(17, "192.0.2.1"); }));
    EXPECT_TRUE(bad([](ApiKey& x) { x.ratePerMin = 9; }));
    EXPECT_TRUE(bad([](ApiKey& x) { x.ratePerMin = 6001; }));
    EXPECT_TRUE(bad([](ApiKey& x) { x.expiresAtMs = kNow - 1; }));
    EXPECT_FALSE(bad([](ApiKey& x) {
        x.role = Role::Operator;
        x.readOnly = false;
        x.groups = {"ca-sang"};
        x.allowFrom = {"192.0.2.0/24", "2001:db8::1"};
        x.expiresAtMs = kNow + 1000;
        x.ratePerMin = 6000;
    }));
}

TEST(ApiKeys, AKeyIsKeptAsAHashAndTheTokenOnlyComesBackOnce) {
    Rig r;
    ApiKey made;
    const std::string token = r.make(Rig::draft(), &made);
    ASSERT_TRUE(isApiKeyFormat(token));
    EXPECT_EQ(made.prefix, token.substr(0, kApiKeyShownPrefix));
    EXPECT_EQ(made.hash, apiKeyHash(token));
    EXPECT_EQ(made.id.size(), 12u);
    EXPECT_EQ(made.createdBy, "admin");
    const std::string text = r.text();
    EXPECT_EQ(text.find(token), std::string::npos) << "never the token on disk";
    EXPECT_EQ(text.find(token.substr(kApiKeyShownPrefix)), std::string::npos);
    EXPECT_NE(text.find(apiKeyHash(token)), std::string::npos);
    struct stat st {};
    ASSERT_EQ(::stat(r.path().c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 0777, 0600u);
    // read again by a new service (a restart)
    r.build();
    std::string err;
    ASSERT_TRUE(r.svc->load(err)) << err;
    const ApiKeyAuth a = r.svc->authenticate(token, "192.0.2.10");
    ASSERT_EQ(a.status, ApiKeyAuthStatus::Ok);
    EXPECT_EQ(a.key.id, made.id);
    EXPECT_EQ(a.key.name, "ERP");
}

TEST(ApiKeys, TheRefusalsOfARequest) {
    Rig r;
    ApiKey d = Rig::draft();
    d.allowFrom = {"192.0.2.0/24"};
    d.expiresAtMs = kNow + 60000;
    const std::string token = r.make(d);
    EXPECT_EQ(r.svc->authenticate("", "192.0.2.1").status, ApiKeyAuthStatus::Missing);
    EXPECT_EQ(r.svc->authenticate("mats_abc", "192.0.2.1").status, ApiKeyAuthStatus::Missing);
    EXPECT_EQ(r.svc->authenticate(newApiKeyToken(), "192.0.2.1").status, ApiKeyAuthStatus::Invalid);
    EXPECT_EQ(r.svc->authenticate(token, "198.51.100.1").status, ApiKeyAuthStatus::Source);
    EXPECT_EQ(r.svc->authenticate(token, "192.0.2.1").status, ApiKeyAuthStatus::Ok);
    r.wall = kNow + 60000;
    EXPECT_EQ(r.svc->authenticate(token, "192.0.2.1").status, ApiKeyAuthStatus::Expired);
    EXPECT_STREQ(apiKeyAuthCode(ApiKeyAuthStatus::Expired), "APIKEY_EXPIRED");
    EXPECT_EQ(apiKeyAuthHttp(ApiKeyAuthStatus::Expired), 401);
    EXPECT_EQ(apiKeyAuthHttp(ApiKeyAuthStatus::Source), 403);
    EXPECT_EQ(apiKeyAuthHttp(ApiKeyAuthStatus::RateLimited), 429);
    EXPECT_EQ(apiKeyAuthHttp(ApiKeyAuthStatus::Store), 503);
}

TEST(ApiKeys, TheRateLimitOfAKey) {
    Rig r;
    ApiKey d = Rig::draft();
    d.ratePerMin = 60;  // one a second, a burst of 10
    const std::string token = r.make(d);
    int ok = 0;
    ApiKeyAuth last;
    for (int i = 0; i < 30; ++i) {
        last = r.svc->authenticate(token, "192.0.2.1");
        if (last.status == ApiKeyAuthStatus::Ok) ++ok;
    }
    EXPECT_EQ(ok, 10);
    EXPECT_EQ(last.status, ApiKeyAuthStatus::RateLimited);
    EXPECT_GT(last.retryAfterMs, 0);
    EXPECT_LE(last.retryAfterMs, 1000);
    r.mono += 1000;
    EXPECT_EQ(r.svc->authenticate(token, "192.0.2.1").status, ApiKeyAuthStatus::Ok);
    EXPECT_EQ(r.svc->authenticate(token, "192.0.2.1").status, ApiKeyAuthStatus::RateLimited);
    const auto u = r.svc->usage();
    ASSERT_EQ(u.size(), 1u);
    EXPECT_EQ(u.begin()->second.calls, 11);
    EXPECT_EQ(u.begin()->second.lastFrom, "192.0.2.1");
    EXPECT_EQ(u.begin()->second.lastUsedMs, kNow);
    EXPECT_EQ(u.begin()->second.denied, 21);
}

TEST(ApiKeys, ASourceThatGuessesKeysIsThrottled) {
    Rig r;
    const std::string token = r.make(Rig::draft());
    for (int i = 0; i < kApiKeyFailuresPerMinute; ++i)
        EXPECT_EQ(r.svc->authenticate(newApiKeyToken(), "203.0.113.9").status,
                  ApiKeyAuthStatus::Invalid);
    const ApiKeyAuth t = r.svc->authenticate(token, "203.0.113.9");
    EXPECT_EQ(t.status, ApiKeyAuthStatus::Throttled) << "even a good key, from that source";
    EXPECT_GT(t.retryAfterMs, 0);
    EXPECT_EQ(r.svc->authenticate(token, "203.0.113.10").status, ApiKeyAuthStatus::Ok)
        << "another source is not touched";
    r.mono += 60000;
    EXPECT_EQ(r.svc->authenticate(token, "203.0.113.9").status, ApiKeyAuthStatus::Ok);
}

TEST(ApiKeys, ChangesGoByRevAndARevokedKeyIsRefusedAtOnce) {
    Rig r;
    ApiKey made;
    const std::string token = r.make(Rig::draft(), &made);
    const int64_t rev = r.svc->list().rev;
    EXPECT_EQ(rev, 1);
    ApiKey after;
    int64_t newRev = 0;
    std::string err;
    EXPECT_EQ(r.svc->update(
                  rev - 1, made.id, [](ApiKey& k) { k.name = "x"; }, after, newRev, err),
              ApiKeyChange::Conflict);
    EXPECT_EQ(newRev, rev);
    EXPECT_EQ(r.svc->update(
                  rev, "000000000000", [](ApiKey& k) { k.name = "x"; }, after, newRev, err),
              ApiKeyChange::NotFound);
    EXPECT_EQ(r.svc->update(
                  rev, made.id, [](ApiKey& k) { k.ratePerMin = 1; }, after, newRev, err),
              ApiKeyChange::Invalid);
    EXPECT_FALSE(err.empty());
    ASSERT_EQ(r.svc->update(
                  rev, made.id,
                  [](ApiKey& k) {
                      k.role = Role::Operator;
                      k.readOnly = false;
                  },
                  after, newRev, err),
              ApiKeyChange::Ok)
        << err;
    EXPECT_EQ(newRev, rev + 1);
    EXPECT_EQ(after.rev, made.rev + 1) << "its rights changed";
    EXPECT_EQ(after.hash, made.hash) << "the token stays";
    EXPECT_TRUE(r.svc->authenticate(token, "192.0.2.1").key.canWrite());
    ApiKey gone;
    ASSERT_EQ(r.svc->revoke(newRev, made.id, gone, newRev, err), ApiKeyChange::Ok);
    EXPECT_EQ(gone.id, made.id);
    EXPECT_EQ(r.svc->authenticate(token, "192.0.2.1").status, ApiKeyAuthStatus::Invalid);
    EXPECT_FALSE(r.svc->find(made.id));
    EXPECT_EQ(r.text().find(made.hash), std::string::npos);
}

TEST(ApiKeys, AtMost32Keys) {
    Rig r;
    for (size_t i = 0; i < kMaxApiKeys; ++i) r.make(Rig::draft("k" + std::to_string(i)));
    std::string token, err;
    ApiKey made;
    int64_t rev = 0;
    EXPECT_EQ(r.svc->create(r.svc->list().rev, Rig::draft(), "admin", token, made, rev, err),
              ApiKeyChange::Full);
    EXPECT_TRUE(token.empty());
}

TEST(ApiKeys, ADamagedFileRefusesEveryKeyUntilSaved) {
    Rig r;
    ApiKey made;
    const std::string token = r.make(Rig::draft(), &made);
    {
        std::ofstream f(r.path(), std::ios::trunc);
        f << "{\"schemaVersion\":\"1.0.0\",\"rev\":";
    }
    ::chmod(r.path().c_str(), 0600);
    r.build();
    std::string err;
    EXPECT_FALSE(r.svc->load(err));
    EXPECT_FALSE(r.svc->storeOk());
    EXPECT_EQ(r.svc->authenticate(token, "192.0.2.1").status, ApiKeyAuthStatus::Store);
    ApiKey m2;
    int64_t rev = 0;
    std::string t2;
    EXPECT_EQ(r.svc->create(0, Rig::draft(), "admin", t2, m2, rev, err), ApiKeyChange::Store);
    // a file others may read is refused too (it holds the hashes)
    Rig r2;
    r2.make(Rig::draft());
    ::chmod(r2.path().c_str(), 0644);
    r2.build();
    EXPECT_FALSE(r2.svc->load(err));
}

TEST(ApiKeys, TheFileIsStrict) {
    EXPECT_TRUE(parseApiKeysFile(R"({"schemaVersion":"1.0.0","rev":0,"keys":[]})").ok);
    for (const char* bad : {"[]", R"({"schemaVersion":"2.0.0","rev":0,"keys":[]})",
                            R"({"schemaVersion":"1.0.0","rev":-1,"keys":[]})",
                            R"({"schemaVersion":"1.0.0","rev":0,"keys":[{"id":"x"}]})",
                            R"({"schemaVersion":"1.0.0","rev":0,"keys":[],"extra":1})"})
        EXPECT_FALSE(parseApiKeysFile(bad).ok) << bad;
    ApiKeysFile f;
    f.rev = 4;
    ApiKey k = Rig::draft();
    k.id = "0123456789ab";
    k.hash = std::string(64, 'a');
    k.prefix = "matk_ABCDEFG";
    k.role = Role::Operator;
    k.readOnly = false;
    k.groups = {"ca-sang"};
    k.allowFrom = {"192.0.2.0/24"};
    k.expiresAtMs = kNow + 1000;
    k.createdAt = "2026-10-25T00:00:00.000Z";
    k.createdBy = "admin";
    f.keys = {k, k};
    EXPECT_FALSE(parseApiKeysFile(apiKeysFileJson(f)).ok) << "ids are unique";
    f.keys.pop_back();
    const ApiKeysParse p = parseApiKeysFile(apiKeysFileJson(f));
    ASSERT_TRUE(p.ok) << p.error;
    EXPECT_EQ(p.file.rev, 4);
    ASSERT_EQ(p.file.keys.size(), 1u);
    EXPECT_EQ(p.file.keys[0].expiresAtMs, kNow + 1000);
    EXPECT_EQ(p.file.keys[0].groups, std::vector<std::string>{"ca-sang"});
    EXPECT_TRUE(p.file.keys[0].canWrite());
}

}  // namespace
}  // namespace mat
