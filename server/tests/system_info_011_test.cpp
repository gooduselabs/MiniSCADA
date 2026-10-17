// system/info of feature 011 (specs/011-pilot-hardening/contracts/device-api-011.md §5; FR-010,
// T030): `warnings` stays the list of codes the 0.x clients read, `warningDetails` gives each one
// {code, message, since, detail}, and the blocks `update` and `logic` tell the Studio what the
// runtime supports.
#include <gtest/gtest.h>
#include <stdlib.h>

#include <algorithm>
#include <filesystem>
#include <fstream>

#include "nlohmann/json.hpp"
#include "server/http/http_api.hpp"
#include "server/http/viewer_gate.hpp"
#include "server/system_warnings.hpp"
#include "server/tests/civet_test_support.hpp"
#include "server/tests/tls_test_support.hpp"

using namespace mat;
using json = nlohmann::json;

namespace {

// A docroot and a project folder of its own (a shared temp folder made two tests race, 2026-10-16).
struct Dirs {
    std::filesystem::path root;
    Dirs() {
        std::string t = (std::filesystem::temp_directory_path() / "mat-info011-XXXXXX").string();
        root = mkdtemp(t.data());
        std::filesystem::create_directories(root / "docroot");
        std::filesystem::create_directories(root / "project");
        std::ofstream(root / "docroot" / "index.html") << "<!doctype html>";
    }
    ~Dirs() { std::filesystem::remove_all(root); }
};

json infoOf(HttpApi::Options o, const Dirs& d, json provided = json{{"runtimeVersion", "1.0.0"}}) {
    test::TestServer http;
    o.docroot = (d.root / "docroot").string();
    o.projectDir = (d.root / "project").string();
    HttpApi api(o, [provided] { return provided; });
    api.install(http.ctx);
    const auto r = test::httpGet(http.port, "/api/v1/system/info");
    EXPECT_EQ(r.status, 200);
    return json::parse(r.body);
}

}  // namespace

TEST(SystemWarnings, EveryCodeOfTheContractHasAVietnameseMessage) {
    for (const char* code :
         {"HOST_CHECK_OFF", "SSH_ROOT_PASSWORD", "PULSE_STUCK", "LOGIC_WRITES_OFF",
          "LOGIC_THROTTLED", "LOGIC_RETAIN_LOST", "UPDATE_ROLLED_BACK", "TIME_NOT_SYNCED",
          "UPDATE_KEYS_MISSING", "VIEWER_PUBLIC", "HTTPS_DOWN"}) {
        const std::string m = warningMessage(code);
        EXPECT_FALSE(m.empty()) << code;
        EXPECT_NE(m, warningMessage("NO_SUCH_CODE")) << code << " uses the generic text";
    }
    EXPECT_FALSE(warningMessage("NO_SUCH_CODE").empty());  // a new code still reads
}

TEST(SystemWarnings, SinceIsTheFirstTimeAndStaysWhileTheWarningLasts) {
    int64_t now = 1000;
    SystemWarnings w([&] { return now; });
    w.set("PULSE_STUCK", json{{"tag", "TANK01.START"}});
    now = 5000;
    w.set("PULSE_STUCK", json{{"tag", "TANK01.STOP"}});  // the detail follows, `since` does not
    auto all = w.list();
    ASSERT_EQ(all.size(), 1u);
    EXPECT_EQ(all[0].code, "PULSE_STUCK");
    EXPECT_EQ(all[0].sinceMs, 1000);
    EXPECT_EQ(all[0].detail["tag"], "TANK01.STOP");
    w.clear("PULSE_STUCK");
    EXPECT_TRUE(w.list().empty());
    now = 9000;
    w.set("PULSE_STUCK", nullptr);  // a new episode starts a new `since`
    EXPECT_EQ(w.list()[0].sinceMs, 9000);
    EXPECT_TRUE(w.list()[0].detail.is_null());
}

TEST(SystemInfo011, WarningsStayCodesAndWarningDetailsDescribeEachOne) {
    Dirs d;
    int64_t now = 1792000000000;
    SystemWarnings sw([&] { return now; });
    sw.set("TIME_NOT_SYNCED", json{{"source", "timedatectl"}});
    HttpApi::Options o;
    o.systemWarnings = &sw;
    const json info =
        infoOf(o, d, json{{"runtimeVersion", "1.0.0"}, {"warnings", json::array({"W_PROVIDED"})}});
    ASSERT_TRUE(info["warnings"].is_array());
    for (const auto& w : info["warnings"]) EXPECT_TRUE(w.is_string()) << w;  // 0.x clients
    ASSERT_TRUE(info["warningDetails"].is_array());
    ASSERT_EQ(info["warningDetails"].size(), info["warnings"].size());
    for (size_t i = 0; i < info["warnings"].size(); ++i) {
        const json& e = info["warningDetails"][i];
        EXPECT_EQ(e["code"], info["warnings"][i]);
        EXPECT_TRUE(e["message"].is_string() && !e["message"].get<std::string>().empty()) << e;
        EXPECT_TRUE(e["since"].is_number_integer()) << e;
        EXPECT_TRUE(e.contains("detail")) << e;
    }
    bool found = false;
    for (const auto& e : info["warningDetails"])
        if (e["code"] == "TIME_NOT_SYNCED") {
            found = true;
            EXPECT_EQ(e["since"], 1792000000000);
            EXPECT_EQ(e["detail"]["source"], "timedatectl");
            EXPECT_EQ(e["message"], warningMessage("TIME_NOT_SYNCED"));
        }
    EXPECT_TRUE(found) << info.dump();
}

TEST(SystemInfo011, UpdateAndLogicBlocksFollowTheConfiguration) {
    Dirs d;
    HttpApi::Options o;
    const json off = infoOf(o, d);
    EXPECT_EQ(off["update"], (json{{"enabled", false}, {"supported", true}}));
    EXPECT_EQ(off["logic"], (json{{"present", false}, {"writes", "off"}}));
    o.updateEnabled = true;
    o.logicWrites = "on";
    const json on = infoOf(o, d);
    EXPECT_EQ(on["update"]["enabled"], true);
    EXPECT_EQ(on["logic"]["writes"], "on");
}

// L6 of the security review of 011 (reconnaissance through the public system/info): a caller
// without a session (Bearer or the cookie of a web session) gets the codes and their generic
// sentences, never the detail of a warning (a path, a tag, a source); a session gets everything.
TEST(SystemInfo011, WithoutASessionWarningsKeepTheirCodesButNotTheirDetail) {
    Dirs d;
    SystemWarnings sw([] { return int64_t{1792000000000}; });
    sw.set("UPDATE_KEYS_MISSING", json{{"dir", "/etc/mat-runtime/trusted-keys"}});
    sw.set("PULSE_STUCK", json{{"tag", "TANK01.START"}});
    // Any source may read; the test server is plain HTTP, the hook makes it count as HTTPS.
    ViewerGate gate(
        ViewerAccess::Any,
        [](const std::string& token, const std::string&, int) { return token == "mats_good"; },
        ViewerGate::Hooks{nullptr, [](bool) { return true; }});
    HttpApi::Options o;
    o.systemWarnings = &sw;
    o.gate = &gate;
    o.docroot = (d.root / "docroot").string();
    o.projectDir = (d.root / "project").string();
    test::TestServer http;
    HttpApi api(o, [] { return json{{"runtimeVersion", "1.0.0"}}; });
    api.install(http.ctx);
    test::CurlClient c("http://127.0.0.1:" + std::to_string(http.port));
    const auto get = [&](std::vector<std::string> headers) {
        test::HttpRequest r;
        r.path = "/api/v1/system/info";
        r.headers = std::move(headers);
        const test::HttpResult res = c.request(r);
        EXPECT_EQ(res.status, 200) << res.body;
        return res.body;
    };
    for (const auto& headers : {std::vector<std::string>{},
                                std::vector<std::string>{"Authorization: Bearer mats_wrong"}}) {
        const std::string body = get(headers);
        EXPECT_EQ(body.find("trusted-keys"), std::string::npos) << body;
        EXPECT_EQ(body.find("TANK01"), std::string::npos) << body;
        const json info = json::parse(body);
        EXPECT_NE(
            std::find(info["warnings"].begin(), info["warnings"].end(), "UPDATE_KEYS_MISSING"),
            info["warnings"].end());
        ASSERT_EQ(info["warningDetails"].size(), info["warnings"].size());
        for (const auto& e : info["warningDetails"]) {
            EXPECT_TRUE(e["detail"].is_null()) << e;
            EXPECT_EQ(e["message"], warningMessage(e["code"].get<std::string>()));
        }
    }
    const json full = json::parse(get({"Authorization: Bearer mats_good"}));
    bool found = false;
    for (const auto& e : full["warningDetails"])
        if (e["code"] == "UPDATE_KEYS_MISSING") {
            found = true;
            EXPECT_EQ(e["detail"]["dir"], "/etc/mat-runtime/trusted-keys");
        }
    EXPECT_TRUE(found) << full.dump();
}
