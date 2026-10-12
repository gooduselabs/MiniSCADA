#include "server/config.hpp"

#include <gtest/gtest.h>
#include <unistd.h>

#include <map>

#include "nlohmann/json.hpp"

using namespace mat;

namespace {
struct Args {
    std::vector<std::string> v;
    std::vector<char*> p;
    Args(std::initializer_list<std::string> a) : v(a) {
        v.insert(v.begin(), "mat-runtime");
        for (auto& s : v) p.push_back(&s[0]);
    }
    int argc() { return static_cast<int>(p.size()); }
    char** argv() { return p.data(); }
};
FileReader files(std::map<std::string, std::string> m) {
    return [m](const std::string& path) -> std::optional<std::string> {
        auto it = m.find(path);
        if (it == m.end()) return std::nullopt;
        return it->second;
    };
}
}  // namespace

TEST(Config, DefaultsWhenDefaultFileMissing) {
    Args a{};
    auto r = loadConfig(a.argc(), a.argv(), files({}));
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.port, 8080);
    EXPECT_EQ(r.cfg.docroot, "/opt/mat-runtime/web");
    EXPECT_EQ(r.cfg.projectDir, "/opt/mat-runtime/project");
    EXPECT_EQ(r.cfg.maxClients, 10);
    ASSERT_EQ(r.cfg.allowedOrigins.size(), 2u);
    EXPECT_EQ(r.cfg.allowedOrigins[0], "http://tauri.localhost");
    EXPECT_EQ(r.cfg.allowedOrigins[1], "tauri://localhost");
    EXPECT_EQ(r.cfg.deltaPeriodMs, 250);
    EXPECT_TRUE(r.cfg.simLoad);
    EXPECT_EQ(r.cfg.sendQueueBytes, 262144u);
    EXPECT_EQ(r.cfg.heartbeatTimeoutMs, 15000);
    EXPECT_EQ(r.cfg.threads, 24);
    EXPECT_FALSE(r.cfg.checkProject);
}

TEST(Config, FileOverridesDefaultsAndCliOverridesFile) {
    Args a{"--config", "/c.json", "--port", "9000", "--no-sim-load"};
    auto r = loadConfig(a.argc(), a.argv(),
                        files({{"/c.json", R"({"port":8081,"maxClients":5,"deltaPeriodMs":100,
                                 "allowedOrigins":["http://x"],"docroot":"/w"})"}}));
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.port, 9000);
    EXPECT_EQ(r.cfg.maxClients, 5);
    EXPECT_EQ(r.cfg.deltaPeriodMs, 100);
    EXPECT_EQ(r.cfg.docroot, "/w");
    ASSERT_EQ(r.cfg.allowedOrigins.size(), 1u);
    EXPECT_FALSE(r.cfg.simLoad);
}

TEST(Config, MaxClientsAboveTenIsClampedWithWarning) {
    Args a{"--max-clients", "11"};
    auto r = loadConfig(a.argc(), a.argv(), files({}));
    ASSERT_TRUE(r.ok);
    EXPECT_EQ(r.cfg.maxClients, 10);
    ASSERT_FALSE(r.warnings.empty());
}

TEST(Config, InvalidValuesAreErrors) {
    for (auto bad : std::vector<std::string>{R"({"deltaPeriodMs":50})", R"({"deltaPeriodMs":300})",
                                             R"({"port":80})", R"({"maxClients":0})",
                                             R"({"sendQueueBytes":1000})", R"({"port":"x"})",
                                             R"({"unknownKey":1})", "{broken"}) {
        Args a{"--config", "/c.json"};
        auto r = loadConfig(a.argc(), a.argv(), files({{"/c.json", bad}}));
        EXPECT_FALSE(r.ok) << bad;
        EXPECT_FALSE(r.error.empty());
    }
}

TEST(Config, ExplicitConfigFileMustExist) {
    Args a{"--config", "/missing.json"};
    auto r = loadConfig(a.argc(), a.argv(), files({}));
    EXPECT_FALSE(r.ok);
}

TEST(Config, UnknownArgumentIsError) {
    Args a{"--bogus"};
    EXPECT_FALSE(loadConfig(a.argc(), a.argv(), files({})).ok);
}

TEST(Config, CheckProjectModeAndDirs) {
    Args a{"--check-project", "--project-dir", "/p", "--schemas-dir", "/s"};
    auto r = loadConfig(a.argc(), a.argv(), files({}));
    ASSERT_TRUE(r.ok);
    EXPECT_TRUE(r.cfg.checkProject);
    EXPECT_EQ(r.cfg.projectDir, "/p");
    EXPECT_EQ(r.cfg.schemasDir, "/s");
}

// Feature 003 (contracts/device.md): historian keys and CLI overrides.
TEST(Config, HistorianDefaults) {
    Args a{};
    auto r = loadConfig(a.argc(), a.argv(), files({}));
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.dataDir, "/var/lib/mat-runtime");
    EXPECT_EQ(r.cfg.secretsFile, "/etc/mat-runtime/secrets.json");
    EXPECT_EQ(r.cfg.clientLibDir, "/opt/mat-runtime/lib");
    EXPECT_EQ(r.cfg.historianMaxDbMB, 2048);
    EXPECT_EQ(r.cfg.historianMinFreeMB, 500);
    EXPECT_EQ(r.cfg.historianCommitMs, 5000);
}

TEST(Config, HistorianKeysFromFileAndCli) {
    Args a{"--config", "/c.json", "--data-dir", "/tmp/d", "--secrets-file", "/tmp/s.json"};
    auto r =
        loadConfig(a.argc(), a.argv(),
                   files({{"/c.json", R"({"dataDir":"/x","secretsFile":"/y","clientLibDir":"/l",
                                 "historianMaxDbMB":64,"historianMinFreeMB":50,
                                 "historianCommitMs":60000})"}}));
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.dataDir, "/tmp/d");
    EXPECT_EQ(r.cfg.secretsFile, "/tmp/s.json");
    EXPECT_EQ(r.cfg.clientLibDir, "/l");
    EXPECT_EQ(r.cfg.historianMaxDbMB, 64);
    EXPECT_EQ(r.cfg.historianMinFreeMB, 50);
    EXPECT_EQ(r.cfg.historianCommitMs, 60000);
}

TEST(Config, HistorianRangesAreErrors) {
    for (auto bad :
         std::vector<std::string>{R"({"historianMaxDbMB":63})", R"({"historianMaxDbMB":65537})",
                                  R"({"historianMinFreeMB":49})", R"({"historianMinFreeMB":65537})",
                                  R"({"historianCommitMs":999})", R"({"historianCommitMs":60001})",
                                  R"({"dataDir":1})", R"({"dataDir":""})"}) {
        Args a{"--config", "/c.json"};
        auto r = loadConfig(a.argc(), a.argv(), files({{"/c.json", bad}}));
        EXPECT_FALSE(r.ok) << bad;
    }
}

TEST(Config, ThreadsRaisedToFitClients) {
    Args a{"--threads", "4"};
    auto r = loadConfig(a.argc(), a.argv(), files({}));
    ASSERT_TRUE(r.ok);
    EXPECT_GE(r.cfg.threads, r.cfg.maxClients + 4);
    EXPECT_FALSE(r.warnings.empty());
}

// Feature 005 (specs/005-device-online/contracts/device-config.md §1): every new key has a default,
// so the runtime.json already on devices loads unchanged.
namespace {
HostnameFn host(std::string name) {
    return [name] { return name; };
}
ConfigResult loadJson(const std::string& text) {
    Args a{"--config", "/c.json"};
    return loadConfig(a.argc(), a.argv(), files({{"/c.json", text}}), host("bl335"));
}
}  // namespace

TEST(DeviceConfig, Defaults) {
    Args a{};
    auto r = loadConfig(a.argc(), a.argv(), files({}), host("bl335-a"));
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.httpsPort, 8443);
    EXPECT_EQ(r.cfg.httpsThreads, 8);
    EXPECT_TRUE(r.cfg.discoveryEnabled);
    EXPECT_EQ(r.cfg.discoveryPort, 8446);
    EXPECT_EQ(r.cfg.deviceName, "bl335-a");
    EXPECT_EQ(r.cfg.deviceModel, "BL335");
    EXPECT_EQ(r.cfg.projectStoreDir, "/var/lib/mat-runtime/projects");
    EXPECT_EQ(r.cfg.projectBackups, 3);
    EXPECT_EQ(r.cfg.usersFile, "/etc/mat-runtime/users.json");
    EXPECT_EQ(r.cfg.auditRetentionDays, 365);
    EXPECT_EQ(r.cfg.auditMaxMB, 64);
}

TEST(DeviceConfig, DeviceNameDefaultsToTheHostName) {
    char name[256] = {0};
    ASSERT_EQ(gethostname(name, sizeof name - 1), 0);
    EXPECT_EQ(systemHostname(), name);
    Args a{};
    auto r = loadConfig(a.argc(), a.argv(), files({}));  // the real host name
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.deviceName, std::string(name).substr(0, 32));
}

// A host name that is no valid deviceName still gives one: cut to 32 bytes on a character
// boundary, else the model.
TEST(DeviceConfig, HostNameMadeIntoAValidName) {
    Args a{};
    auto name = [&](const std::string& h) {
        auto r = loadConfig(a.argc(), a.argv(), files({}), host(h));
        EXPECT_TRUE(r.ok) << h << ": " << r.error;
        return r.cfg.deviceName;
    };
    EXPECT_EQ(name(std::string(40, 'h')), std::string(32, 'h'));
    EXPECT_EQ(name(std::string(31, 'h') + "ệ"), std::string(31, 'h'));  // 'ệ' is 3 bytes
    EXPECT_EQ(name(std::string(29, 'h') + "ệ"), std::string(29, 'h') + "ệ");
    EXPECT_EQ(name(""), "BL335");
    EXPECT_EQ(name("bad\nname"), "BL335");
    auto r = loadConfig(a.argc(), a.argv(),
                        files({{"/etc/mat-runtime/runtime.json", R"({"deviceModel":"BL335-X"})"}}),
                        host(""));
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.deviceName, "BL335-X");
}

TEST(DeviceConfig, KeysFromFile) {
    auto r = loadJson(R"({"httpsPort":9443,"httpsThreads":4,"discoveryEnabled":false,
        "discoveryPort":9446,"deviceName":"Trạm bơm 1","deviceModel":"BL335-X",
        "projectStoreDir":"/srv/p","projectBackups":10,"usersFile":"/tmp/u.json",
        "auditRetentionDays":30,"auditMaxMB":1024})");
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.httpsPort, 9443);
    EXPECT_EQ(r.cfg.httpsThreads, 4);
    EXPECT_FALSE(r.cfg.discoveryEnabled);
    EXPECT_EQ(r.cfg.discoveryPort, 9446);
    EXPECT_EQ(r.cfg.deviceName, "Trạm bơm 1");
    EXPECT_EQ(r.cfg.deviceModel, "BL335-X");
    EXPECT_EQ(r.cfg.projectStoreDir, "/srv/p");
    EXPECT_EQ(r.cfg.projectBackups, 10);
    EXPECT_EQ(r.cfg.usersFile, "/tmp/u.json");
    EXPECT_EQ(r.cfg.auditRetentionDays, 30);
    EXPECT_EQ(r.cfg.auditMaxMB, 1024);
}

TEST(DeviceConfig, CommandLineOverridesFile) {
    Args a{
        "--config",     "/c.json",       "--https-port",  "0", "--project-store-dir", "/x/projects",
        "--users-file", "/x/users.json", "--no-discovery"};
    auto r = loadConfig(a.argc(), a.argv(),
                        files({{"/c.json", R"({"httpsPort":9443,"discoveryEnabled":true,
                                 "projectStoreDir":"/srv/p","usersFile":"/u.json"})"}}),
                        host("bl335"));
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.httpsPort, 0);  // HTTPS and the engineering API off
    EXPECT_EQ(r.cfg.projectStoreDir, "/x/projects");
    EXPECT_EQ(r.cfg.usersFile, "/x/users.json");
    EXPECT_FALSE(r.cfg.discoveryEnabled);
    Args b{"--https-port", "9443"};
    auto s = loadConfig(b.argc(), b.argv(), files({}), host("bl335"));
    ASSERT_TRUE(s.ok) << s.error;
    EXPECT_EQ(s.cfg.httpsPort, 9443);
    // Args keeps pointers into its own strings: built in place, never copied.
    auto rejected = [](Args& c) {
        return !loadConfig(c.argc(), c.argv(), files({}), host("bl335")).ok;
    };
    Args c1{"--https-port"}, c2{"--https-port", "x"}, c3{"--project-store-dir"}, c4{"--users-file"};
    EXPECT_TRUE(rejected(c1));
    EXPECT_TRUE(rejected(c2));
    EXPECT_TRUE(rejected(c3));
    EXPECT_TRUE(rejected(c4));
}

TEST(DeviceConfig, ProjectStoreDirFollowsDataDir) {
    Args a{"--data-dir", "/tmp/d"};
    auto r = loadConfig(a.argc(), a.argv(), files({}), host("bl335"));
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.projectStoreDir, "/tmp/d/projects");
    EXPECT_EQ(loadJson(R"({"dataDir":"/srv/mat"})").cfg.projectStoreDir, "/srv/mat/projects");
    EXPECT_EQ(loadJson(R"({"dataDir":"/srv/mat/"})").cfg.projectStoreDir, "/srv/mat/projects");
    EXPECT_EQ(loadJson(R"({"dataDir":"/srv/mat","projectStoreDir":"/p"})").cfg.projectStoreDir,
              "/p");
}

TEST(DeviceConfig, RangeLimitsAreAccepted) {
    const std::string name32 = "Trạm bơm số 1 – Nhà máy";  // 32 bytes of UTF-8
    ASSERT_EQ(name32.size(), 32u);
    for (const auto& ok : std::vector<std::string>{
             R"({"httpsPort":0})", R"({"httpsPort":1024})", R"({"httpsPort":65535})",
             R"({"httpsThreads":4})", R"({"httpsThreads":32})", R"({"discoveryPort":1024})",
             R"({"discoveryPort":65535})", R"({"discoveryEnabled":true})",
             R"({"projectBackups":1})", R"({"projectBackups":10})", R"({"auditRetentionDays":30})",
             R"({"auditRetentionDays":3650})", R"({"auditMaxMB":8})", R"({"auditMaxMB":1024})",
             R"({"deviceName":"A"})", R"({"deviceName":")" + name32 + R"("})",
             R"({"deviceModel":")" + std::string(32, 'M') + R"("})"}) {
        auto r = loadJson(ok);
        EXPECT_TRUE(r.ok) << ok << ": " << r.error;
    }
}

TEST(DeviceConfig, ValuesOutOfRangeAreErrors) {
    for (const auto& bad : std::vector<std::string>{
             R"({"httpsPort":1023})",
             R"({"httpsPort":65536})",
             R"({"httpsPort":-1})",
             R"({"httpsPort":8080})",        // the HTTP port
             R"({"httpsPort":4294975739})",  // 2^32 + 8443: must not wrap to 8443
             R"({"httpsPort":"8443"})",
             R"({"httpsPort":8443.5})",
             R"({"httpsThreads":3})",
             R"({"httpsThreads":33})",
             R"({"discoveryPort":1023})",
             R"({"discoveryPort":65536})",
             R"({"discoveryPort":0})",
             R"({"discoveryEnabled":"yes"})",
             R"({"discoveryEnabled":1})",
             R"({"deviceName":""})",
             R"({"deviceName":")" + std::string(33, 'n') + R"("})",
             R"({"deviceName":"a\nb"})",
             R"({"deviceName":"a\u007fb"})",
             R"({"deviceName":"a\u0085b"})",  // DEL, C1
             R"({"deviceName":"a‮b"})",     // right-to-left override
             R"({"deviceName":1})",
             R"({"deviceModel":""})",
             R"({"deviceModel":")" + std::string(33, 'M') + R"("})",
             R"({"projectBackups":0})",
             R"({"projectBackups":11})",
             R"({"auditRetentionDays":29})",
             R"({"auditRetentionDays":3651})",
             R"({"auditMaxMB":7})",
             R"({"auditMaxMB":1025})",
             R"({"projectStoreDir":""})",
             R"({"projectStoreDir":1})",
             R"({"usersFile":""})",
             R"({"usersFile":true})"}) {
        auto r = loadJson(bad);
        EXPECT_FALSE(r.ok) << bad;
        EXPECT_FALSE(r.error.empty()) << bad;
    }
}

TEST(DeviceConfig, HttpsPortMustDifferFromPort) {
    Args a{"--port", "9000", "--https-port", "9000"};
    EXPECT_FALSE(loadConfig(a.argc(), a.argv(), files({}), host("bl335")).ok);
    Args b{"--port", "9000", "--https-port", "0"};
    EXPECT_TRUE(loadConfig(b.argc(), b.argv(), files({}), host("bl335")).ok);
}

// deployment/config/runtime.json as installed on the BL335 (no feature 005 key) still loads; an
// unknown key still stops the runtime (exit code 2 in main).
TEST(DeviceConfig, RuntimeJsonOfTheDeviceStillLoads) {
    const std::string path = std::string(MAT_SOURCE_DIR) + "/deployment/config/runtime.json";
    const auto text = readTextFile(path);
    ASSERT_TRUE(text.has_value()) << path;
    auto r = loadJson(*text);
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.port, 8080);
    EXPECT_EQ(r.cfg.httpsPort, 8443);
    EXPECT_TRUE(r.cfg.discoveryEnabled);
    EXPECT_EQ(r.cfg.projectStoreDir, "/var/lib/mat-runtime/projects");
    EXPECT_EQ(r.cfg.usersFile, "/etc/mat-runtime/users.json");

    auto j = nlohmann::json::parse(*text);
    j["httpsport"] = 8443;  // a typo of httpsPort is an unknown key
    auto u = loadJson(j.dump());
    EXPECT_FALSE(u.ok);
    EXPECT_NE(u.error.find("httpsport"), std::string::npos) << u.error;
}

// T108: the test hooks of the project switch exist only in a build with -DMAT_TEST_HOOKS=ON; the
// production runtime (armhf included) refuses them like any unknown argument.
TEST(ConfigTestHooks, OnlyABuildWithTheOptionAcceptsThem) {
    for (const char* flag : {"--test-kill-at", "--test-health"}) {
        std::vector<std::string> args{"mat-runtime", flag, "die"};
        std::vector<char*> argv;
        for (auto& a : args) argv.push_back(&a[0]);
        const ConfigResult r = loadConfig(static_cast<int>(argv.size()), argv.data(),
                                          [](const std::string&) { return std::nullopt; });
#ifdef MAT_TEST_HOOKS
        EXPECT_TRUE(r.ok) << flag << " " << r.error;
#else
        EXPECT_FALSE(r.ok) << flag;
        EXPECT_NE(r.error.find("không hỗ trợ"), std::string::npos) << r.error;
#endif
    }
}
