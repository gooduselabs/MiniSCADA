// The source filter on the page handlers, over HTTP and over HTTPS (FR-055a, ADR-018, research R19;
// contracts/device-api-1.1.md §1.2, §2): every filtered path answers 403 to a public source (here a
// hook gives the in-process client a public address), a private source and the loopback are served
// as before, a valid session over HTTPS is never filtered, a token over HTTP is HTTPS_REQUIRED,
// `any` serves everyone and warns, `off` closes everything but the loopback and the system info.
#include <gtest/gtest.h>

#include <filesystem>
#include <fstream>

#include "nlohmann/json.hpp"
#include "server/device_state.hpp"
#include "server/http/http_api.hpp"
#include "server/http/viewer_gate.hpp"
#include "server/tests/civet_test_support.hpp"
#include "server/tests/tls_test_support.hpp"

using nlohmann::json;
using namespace mat;
namespace fs = std::filesystem;

namespace {

struct Docroot {
    fs::path root;
    Docroot() : root(fs::temp_directory_path() / "mat-viewer-test") {
        fs::remove_all(root);
        fs::create_directories(root / "docroot/assets");
        fs::create_directories(root / "project/screens");
        std::ofstream(root / "docroot/index.html") << "<!doctype html><title>runtime</title>";
        std::ofstream(root / "docroot/assets/app.js") << "console.log(1)";
        std::ofstream(root / "project/screens/main.svg")
            << "<svg xmlns='http://www.w3.org/2000/svg'/>";
    }
    ~Docroot() { fs::remove_all(root); }
};

// One HttpApi on a plain context and one on a TLS context, behind one ViewerGate.
struct Rig {
    Rig(ViewerAccess access, std::string remote,
        std::function<bool(const std::string&, const std::string&)> peek = nullptr)
        : remote(std::move(remote)),
          gate(
              access,
              [this, peek](const std::string& token, const std::string& ip, int) {
                  lastToken = token;
                  lastIp = ip;
                  return peek ? peek(token, ip) : false;
              },
              {[this](const std::string&) { return this->remote; }, nullptr},
              [] { return int64_t{1791601205000}; }),
          device(makeFacts(access)),
          http(),
          https() {
        HttpApi::Options o;
        o.docroot = (docs.root / "docroot").string();
        o.projectDir = (docs.root / "project").string();
        o.projectAllowlist = {"screens/main.svg"};
        o.activeProjectJson = R"({"project":{"projectId":"x"},"tags":{"tags":[]},"screens":{}})";
        o.device = &device;
        o.gate = &gate;
        api = std::make_unique<HttpApi>(o, [] { return json{{"runtimeVersion", "0.5.0"}}; });
        api->install(http.ctx);
        api->install(https.ctx);
    }
    static DeviceFacts makeFacts(ViewerAccess a) {
        DeviceFacts f;
        f.deviceId = "dev";
        f.name = "bl335";
        f.model = "BL335";
        f.viewerAccess = viewerAccessName(a);
        return f;
    }

    std::string remote;
    std::string lastToken, lastIp;
    Docroot docs;
    ViewerGate gate;
    DeviceState device;
    test::TestServer http;
    test::TlsTestServer https;
    std::unique_ptr<HttpApi> api;

    test::HttpResult overHttps(const std::string& path,
                               const std::vector<std::string>& headers = {}) {
        test::CurlClient c(test::httpsUrl(https.port));
        test::HttpRequest r;
        r.path = path;
        r.headers = headers;
        return c.request(r);
    }
    test::HttpResult overHttp(const std::string& path,
                              const std::vector<std::string>& headers = {}) {
        test::CurlClient c("http://127.0.0.1:" + std::to_string(http.port));
        test::HttpRequest r;
        r.path = path;
        r.headers = headers;
        return c.request(r);
    }
};

const char* const kPaths[] = {"/",
                              "/index.html",
                              "/assets/app.js",
                              "/project/screens/main.svg",
                              "/api/v1/system/info",
                              "/api/v1/projects/active"};

bool isPage(const std::string& p) {
    return p == "/" || p == "/index.html" || p.rfind("/assets/", 0) == 0 ||
           p.rfind("/project/", 0) == 0;
}

}  // namespace

TEST(ViewerAccess, APublicSourceGets403OnEveryFilteredPathOverHttpAndHttps) {
    Rig r(ViewerAccess::Private, "203.0.113.9");
    for (const char* path : kPaths) {
        for (int tls = 0; tls < 2; ++tls) {
            const auto res = tls ? r.overHttps(path) : r.overHttp(path);
            ASSERT_TRUE(res.ok()) << path << " " << res.error;
            EXPECT_EQ(res.status, 403) << path << (tls ? " https" : " http");
            if (isPage(path)) {
                EXPECT_NE(res.headers.find("text/html"), std::string::npos) << path;
                EXPECT_NE(res.headers.find("default-src 'none'"), std::string::npos) << path;
                EXPECT_NE(res.body.find("mạng nội bộ"), std::string::npos) << path;
            } else {
                const json j = json::parse(res.body);
                EXPECT_EQ(j["error"], "SOURCE_NOT_ALLOWED") << path;
                EXPECT_FALSE(j["message"].get<std::string>().empty());
            }
        }
    }
    EXPECT_EQ(r.gate.blockedTotal(), 12u);
    EXPECT_EQ(r.gate.lastBlockedAt(), 1791601205000);
}

TEST(ViewerAccess, APrivateSourceAndTheLoopbackAreServedAsBefore) {
    for (const char* remote :
         {"192.168.1.20", "10.1.2.3", "127.0.0.1", "::1", "::ffff:192.168.0.9"}) {
        Rig r(ViewerAccess::Private, remote);
        for (const char* path : kPaths) {
            EXPECT_EQ(r.overHttp(path).status, 200) << remote << " " << path << " http";
            EXPECT_EQ(r.overHttps(path).status, 200) << remote << " " << path << " https";
        }
        EXPECT_EQ(r.gate.blockedTotal(), 0u) << remote;
    }
}

TEST(ViewerAccess, AValidSessionOverHttpsIsNeverFiltered) {
    Rig r(ViewerAccess::Private, "203.0.113.9",
          [](const std::string& token, const std::string& ip) {
              return token == "mats_good" && ip == "203.0.113.9";
          });
    for (const char* path : kPaths) {
        const auto ok = r.overHttps(path, {"Authorization: Bearer mats_good"});
        EXPECT_EQ(ok.status, 200) << path;
        const auto bad = r.overHttps(path, {"Authorization: Bearer mats_bad"});
        EXPECT_EQ(bad.status, 403)
            << path;  // a token that does not check out is just a public source
    }
    EXPECT_EQ(r.lastIp, "203.0.113.9");
    // the scheme in any case and spaces around the token
    EXPECT_EQ(r.overHttps("/", {"Authorization:   bearer   mats_good  "}).status, 200);
    // not a bearer credential
    EXPECT_EQ(r.overHttps("/", {"Authorization: Basic abc"}).status, 403);
}

TEST(ViewerAccess, ATokenOverHttpIsHttpsRequiredEvenFromThePrivateNetwork) {
    Rig r(ViewerAccess::Private, "192.168.1.20",
          [](const std::string&, const std::string&) { return true; });
    for (const char* path : kPaths) {
        const auto res = r.overHttp(path, {"Authorization: Bearer mats_good"});
        EXPECT_EQ(res.status, 403) << path;
        if (!isPage(path)) {
            EXPECT_EQ(json::parse(res.body)["error"], "HTTPS_REQUIRED") << path;
        }
    }
    EXPECT_TRUE(r.lastToken.empty()) << "the token is not looked at over HTTP";
}

TEST(ViewerAccess, AnyServesEveryoneAndTheSystemInfoWarns) {
    Rig r(ViewerAccess::Any, "203.0.113.9");
    for (const char* path : kPaths) EXPECT_EQ(r.overHttp(path).status, 200) << path;
    const json info = json::parse(r.overHttp("/api/v1/system/info").body);
    EXPECT_EQ(info["device"]["viewerAccess"], "any");
    EXPECT_EQ(info["warnings"], (json::array({"VIEWER_PUBLIC"})));
    // and no channel, PLC address or account in that public page
    const std::string text = info.dump();
    EXPECT_EQ(text.find("channel"), std::string::npos);
    EXPECT_EQ(text.find("host"), std::string::npos);
}

TEST(ViewerAccess, PrivateSystemInfoHasNoWarning) {
    Rig r(ViewerAccess::Private, "192.168.1.20");
    const json info = json::parse(r.overHttp("/api/v1/system/info").body);
    EXPECT_EQ(info["device"]["viewerAccess"], "private");
    EXPECT_EQ(info["warnings"], json::array());
}

TEST(ViewerAccess, OffClosesEverythingButTheLoopbackAndTheSystemInfoOfThePrivateNetwork) {
    Rig priv(ViewerAccess::Off, "192.168.1.20");
    for (const char* path :
         {"/", "/assets/app.js", "/project/screens/main.svg", "/api/v1/projects/active"}) {
        const auto res = priv.overHttp(path);
        EXPECT_EQ(res.status, 403) << path;
        if (!isPage(path)) {
            EXPECT_EQ(json::parse(res.body)["error"], "VIEWER_OFF");
        }
    }
    EXPECT_EQ(priv.overHttp("/api/v1/system/info").status, 200);  // deploy script, health check
    EXPECT_EQ(json::parse(priv.overHttps("/api/v1/system/info").body)["device"]["viewerAccess"],
              "off");

    Rig pub(ViewerAccess::Off, "203.0.113.9");
    EXPECT_EQ(pub.overHttp("/api/v1/system/info").status, 403);

    Rig loop(ViewerAccess::Off, "127.0.0.1");
    for (const char* path : kPaths) EXPECT_EQ(loop.overHttp(path).status, 200) << path;
}

TEST(ViewerAccess, NoGateMeansNoFilterAsBefore) {
    Docroot docs;
    test::TestServer http;
    DeviceState device;
    HttpApi::Options o;
    o.docroot = (docs.root / "docroot").string();
    o.projectDir = (docs.root / "project").string();
    o.device = &device;
    HttpApi api(o, [] { return json{{"runtimeVersion", "0.5.0"}}; });
    api.install(http.ctx);
    EXPECT_EQ(test::httpGet(http.port, "/").status, 200);
    EXPECT_EQ(test::httpGet(http.port, "/api/v1/system/info").status, 200);
}

TEST(ViewerAccess, TheEngineeringPathsAreNotFilteredByTheGate) {
    // device/identity, auth/* and the rest of the API are the engineering API (HTTPS, session): not
    // handled by HttpApi at all; the classification says they are not filtered paths.
    for (const char* p : {"/api/v1/device/identity", "/api/v1/auth/login", "/api/v1/projects",
                          "/api/v1/tags/write"})
        EXPECT_EQ(classifyPath(p), FilteredPath::None) << p;
}
