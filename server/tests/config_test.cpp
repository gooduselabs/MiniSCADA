#include "server/config.hpp"

#include <gtest/gtest.h>
#include <unistd.h>

#include <map>

#include "core/session-manager/session_manager.hpp"
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
    for (auto bad : std::vector<std::string>{
             R"({"deltaPeriodMs":50})", R"({"deltaPeriodMs":300})", R"({"port":80})",
             R"({"maxClients":0})", R"({"sendQueueBytes":1000})", R"({"port":"x"})", "{broken"}) {
        Args a{"--config", "/c.json"};
        auto r = loadConfig(a.argc(), a.argv(), files({{"/c.json", bad}}));
        EXPECT_FALSE(r.ok) << bad;
        EXPECT_FALSE(r.error.empty());
    }
    // Feature 011 (contracts/device-api-011.md §6): an unknown key is a warning, not an error.
    Args a{"--config", "/c.json"};
    auto r = loadConfig(a.argc(), a.argv(), files({{"/c.json", R"({"unknownKey":1})"}}));
    EXPECT_TRUE(r.ok) << r.error;
    ASSERT_EQ(r.warnings.size(), 1u);
    EXPECT_NE(r.warnings[0].find("unknownKey"), std::string::npos) << r.warnings[0];
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
    EXPECT_EQ(r.cfg.httpsThreads,
              64);  // 011: 10 pages behind one address (48 per source) + 16 for the others
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
             R"({"httpsThreads":4})", R"({"httpsThreads":64})", R"({"discoveryPort":1024})",
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
             R"({"httpsThreads":65})",
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
    j["httpsport"] = 9443;  // a typo of httpsPort is an unknown key: named, and the default stays
    auto u = loadJson(j.dump());
    ASSERT_TRUE(u.ok) << u.error;
    EXPECT_EQ(u.cfg.httpsPort, 8443);
    ASSERT_EQ(u.warnings.size(), 1u);
    EXPECT_NE(u.warnings[0].find("httpsport"), std::string::npos) << u.warnings[0];
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

// ---- feature 006 (contracts/device-config.md §1) ----

TEST(Config006, DefaultsOfTheNewKeys) {
    Args a{};
    auto r = loadConfig(a.argc(), a.argv(), files({}), host("bl335"));
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.serialPorts, (std::vector<std::string>{"ttyAS*"}));
    EXPECT_EQ(r.cfg.viewerAccess, "private");
    EXPECT_EQ(r.cfg.retainWindowS, 5);
    EXPECT_EQ(r.cfg.retainDir, "/var/lib/mat-runtime/retain");
    EXPECT_EQ(r.cfg.tagWriteSessionBurst, 10);
    EXPECT_EQ(r.cfg.tagWriteSessionPerMin, 20);
    EXPECT_EQ(r.cfg.tagWriteGlobalBurst, 20);
    EXPECT_EQ(r.cfg.tagWriteGlobalPerMin, 20);  // provisional (plan question 3)
    EXPECT_EQ(r.cfg.tagWriteQueuePerChannel, 16);
    EXPECT_EQ(r.cfg.tagWriteQueueTotal, 64);
}

TEST(Config006, RetainDirFollowsDataDirUnlessGiven) {
    auto a = loadJson(R"({"dataDir":"/srv/d"})");
    ASSERT_TRUE(a.ok) << a.error;
    EXPECT_EQ(a.cfg.retainDir, "/srv/d/retain");
    auto b = loadJson(R"({"dataDir":"/srv/d","retainDir":"/srv/r"})");
    ASSERT_TRUE(b.ok) << b.error;
    EXPECT_EQ(b.cfg.retainDir, "/srv/r");
}

TEST(Config006, KeysFromFile) {
    auto r =
        loadJson(R"({"serialPorts":["ttyAS2","ttyUSB*","/dev/serial/by-id/usb-FTDI_X-if00-port0"],
        "viewerAccess":"any","retainWindowS":60,"retainDir":"/tmp/ret","tagWriteSessionBurst":1,
        "tagWriteSessionPerMin":20,"tagWriteGlobalBurst":20,"tagWriteGlobalPerMin":30,
        "tagWriteQueuePerChannel":64,"tagWriteQueueTotal":256})");
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.serialPorts.size(), 3u);
    EXPECT_EQ(r.cfg.serialPorts[1], "ttyUSB*");
    EXPECT_EQ(r.cfg.viewerAccess, "any");
    EXPECT_EQ(r.cfg.retainWindowS, 60);
    EXPECT_EQ(r.cfg.retainDir, "/tmp/ret");
    EXPECT_EQ(r.cfg.tagWriteSessionBurst, 1);
    EXPECT_EQ(r.cfg.tagWriteGlobalPerMin, 30);
    EXPECT_EQ(r.cfg.tagWriteQueuePerChannel, 64);
    EXPECT_EQ(r.cfg.tagWriteQueueTotal, 256);
}

TEST(Config006, ViewerAccessValues) {
    for (const char* ok : {"private", "any", "off"})
        EXPECT_TRUE(loadJson(std::string(R"({"viewerAccess":")") + ok + R"("})").ok) << ok;
    for (const char* bad : {R"({"viewerAccess":"public"})", R"({"viewerAccess":""})",
                            R"({"viewerAccess":true})", R"({"viewerAccess":"Private"})"})
        EXPECT_FALSE(loadJson(bad).ok) << bad;
}

TEST(Config006, RangesAreChecked) {
    for (const char* ok : {R"({"retainWindowS":1})", R"({"retainWindowS":60})",
                           R"({"tagWriteSessionBurst":10})", R"({"tagWriteSessionPerMin":1})",
                           R"({"tagWriteGlobalBurst":20})", R"({"tagWriteGlobalPerMin":30})",
                           R"({"tagWriteQueuePerChannel":1})", R"({"tagWriteQueueTotal":256})"})
        EXPECT_TRUE(loadJson(ok).ok) << ok;
    for (const char* bad :
         {R"({"retainWindowS":0})", R"({"retainWindowS":61})", R"({"tagWriteSessionBurst":0})",
          R"({"tagWriteSessionBurst":11})", R"({"tagWriteSessionPerMin":0})",
          R"({"tagWriteSessionPerMin":21})", R"({"tagWriteGlobalBurst":0})",
          R"({"tagWriteGlobalBurst":21})", R"({"tagWriteGlobalPerMin":0})",
          R"({"tagWriteGlobalPerMin":31})", R"({"tagWriteQueuePerChannel":0})",
          R"({"tagWriteQueuePerChannel":65})", R"({"tagWriteQueueTotal":0})",
          R"({"tagWriteQueueTotal":257})", R"({"retainWindowS":"5"})", R"({"retainDir":""})",
          R"({"retainDir":1})"})
        EXPECT_FALSE(loadJson(bad).ok) << bad;
}

TEST(Config006, SerialPortEntries) {
    for (const char* ok : {R"(["ttyAS*"])", R"(["ttyAS2"])", R"(["ttyUSB0","ttyUSB1"])",
                           R"(["ttyS0"])", R"(["/dev/serial/by-id/usb-FTDI_FT232R-if00-port0"])",
                           R"(["/dev/serial/by-path/platform-1c28000.uart"])", R"([])"})
        EXPECT_TRUE(loadJson(std::string(R"({"serialPorts":)") + ok + "}").ok) << ok;
    for (const char* bad :
         {R"(["AS2"])", R"(["/dev/ttyAS2"])", R"(["tty"])", R"(["ttyAS*2"])", R"(["tty*"])",
          R"(["/dev/serial/by-id/"])", R"(["/dev/serial/by-id/a/b"])",
          R"(["/dev/serial/by-id/a b"])", R"(["/dev/serial/by-id/x*"])",
          R"(["/dev/serial/by-uuid/x"])", R"(["ttyAS2",1])", R"("ttyAS2")", R"([""])",
          R"(["tty AS"])", R"(["../ttyAS2"])"}) {
        auto r = loadJson(std::string(R"({"serialPorts":)") + bad + "}");
        EXPECT_FALSE(r.ok) << bad;
    }
}

TEST(Config006, CommandLine) {
    Args a{"--serial-ports", "ttyUSB0,ttyAS*", "--viewer-access", "off", "--retain-dir", "/x/ret"};
    auto r = loadConfig(a.argc(), a.argv(), files({}), host("bl335"));
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.serialPorts, (std::vector<std::string>{"ttyUSB0", "ttyAS*"}));
    EXPECT_EQ(r.cfg.viewerAccess, "off");
    EXPECT_EQ(r.cfg.retainDir, "/x/ret");
    Args bad1{"--viewer-access", "public"};
    EXPECT_FALSE(loadConfig(bad1.argc(), bad1.argv(), files({}), host("bl335")).ok);
    Args bad2{"--serial-ports", "bad name"};
    EXPECT_FALSE(loadConfig(bad2.argc(), bad2.argv(), files({}), host("bl335")).ok);
    Args bad3{"--retain-dir", ""};
    EXPECT_FALSE(loadConfig(bad3.argc(), bad3.argv(), files({}), host("bl335")).ok);
}

TEST(Config006, TheFileInstalledOnTheDeviceStillLoadsAndAnUnknownKeyIsNamed) {
    const auto text = readTextFile(std::string(MAT_SOURCE_DIR) + "/deployment/config/runtime.json");
    ASSERT_TRUE(text.has_value());
    auto r = loadJson(*text);
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_TRUE(r.warnings.empty());  // every key of the installed file is known
    EXPECT_EQ(r.cfg.viewerAccess, "private");
    // Feature 011 (contract §6): a misspelt key is skipped with a warning; the safe default stays.
    auto typo = loadJson(R"({"viewerAcces":"any"})");
    ASSERT_TRUE(typo.ok) << typo.error;
    EXPECT_EQ(typo.cfg.viewerAccess, "private");
    ASSERT_EQ(typo.warnings.size(), 1u);
    EXPECT_NE(typo.warnings[0].find("viewerAcces"), std::string::npos) << typo.warnings[0];
}

// ---- feature 007 (contracts/device-config-007.md §1): the web sign-in ----

TEST(Config007, DefaultsOfTheWebKeys) {
    Args a{};
    auto r = loadConfig(a.argc(), a.argv(), files({}), host("bl335"));
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.viewerLogin, "off");
    EXPECT_EQ(r.cfg.webSessionIdleMin, 30);
    EXPECT_EQ(r.cfg.webMaxSessions, 12);  // 10 live clients (maxClients) and some room, ADR-032
    EXPECT_EQ(r.cfg.webSessionMaxHours, 12);
}

TEST(Config007, KeysFromFile) {
    auto r = loadJson(R"({"viewerAccess":"private","viewerLogin":"required",
        "webSessionIdleMin":480,"webSessionMaxHours":24,"webMaxSessions":16})");
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.viewerLogin, "required");
    EXPECT_EQ(r.cfg.webSessionIdleMin, 480);
    EXPECT_EQ(r.cfg.webSessionMaxHours, 24);
    EXPECT_EQ(r.cfg.webMaxSessions, 16);
}

// A value the runtime does not know stops it, and says which key (the safe side: not a silent
// "off").
TEST(Config007, ViewerLoginValuesAndTheKeyThatIsNamedInTheError) {
    for (const char* ok : {"off", "required"})
        EXPECT_TRUE(loadJson(std::string(R"({"viewerLogin":")") + ok + R"("})").ok) << ok;
    for (const char* bad :
         {R"({"viewerLogin":"on"})", R"({"viewerLogin":""})", R"({"viewerLogin":true})",
          R"({"viewerLogin":"Required"})", R"({"viewerLogin":"yes"})", R"({"viewerLogin":null})",
          R"({"viewerLogin":1})"}) {
        const auto r = loadJson(bad);
        EXPECT_FALSE(r.ok) << bad;
        EXPECT_NE(r.error.find("viewerLogin"), std::string::npos) << r.error;
    }
}

TEST(Config007, RangesAreChecked) {
    for (const char* ok : {R"({"webSessionIdleMin":5})", R"({"webSessionIdleMin":480})",
                           R"({"webMaxSessions":1})", R"({"webMaxSessions":16})",
                           R"({"webSessionMaxHours":1})", R"({"webSessionMaxHours":24})"})
        EXPECT_TRUE(loadJson(ok).ok) << ok;
    for (const char* bad :
         {R"({"webSessionIdleMin":4})", R"({"webSessionIdleMin":481})", R"({"webMaxSessions":0})",
          R"({"webMaxSessions":17})", R"({"webSessionMaxHours":0})", R"({"webSessionMaxHours":25})",
          R"({"webSessionIdleMin":"30"})", R"({"webMaxSessions":1.5})"}) {
        const auto r = loadJson(bad);
        EXPECT_FALSE(r.ok) << bad;
        EXPECT_FALSE(r.error.empty()) << bad;
    }
}

TEST(Config007, CommandLine) {
    Args a{"--viewer-login", "required"};
    auto r = loadConfig(a.argc(), a.argv(), files({}), host("bl335"));
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.viewerLogin, "required");
    Args bad{"--viewer-login", "yes"};
    EXPECT_FALSE(loadConfig(bad.argc(), bad.argv(), files({}), host("bl335")).ok);
}

TEST(Config007, TheSessionsOfTheWebAndOfTheStudioFitTogether) {
    // webMaxSessions 16 and the 32 of the Bearer table: the web never takes more than its own quota
    // (AuthService), so the two limits do not contradict each other at the largest settings.
    auto r = loadJson(R"({"webMaxSessions":16})");
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_LE(static_cast<size_t>(r.cfg.webMaxSessions), 32u);
}

// ---- feature 009: the keys of the alarms (data-model §11): defaults, file, clamped with a warning
// ----

TEST(Config009, DefaultsAndKeysFromFile) {
    auto d = loadJson("{}");
    ASSERT_TRUE(d.ok) << d.error;
    EXPECT_EQ(d.cfg.alarmRetentionDays, 180);
    EXPECT_EQ(d.cfg.alarmMaxBytes, 67108864);
    EXPECT_EQ(d.cfg.alarmCommitMs, 2000);
    EXPECT_EQ(d.cfg.alarmChatterWindowS, 60);
    EXPECT_EQ(d.cfg.alarmMaxShelved, 50);
    auto r = loadJson(R"({"alarmRetentionDays":30,"alarmMaxBytes":8388608,"alarmCommitMs":500,
        "alarmCommitMaxMs":20000,"alarmChatterWindowS":120})");
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.alarmRetentionDays, 30);
    EXPECT_EQ(r.cfg.alarmMaxBytes, 8388608);
    EXPECT_EQ(r.cfg.alarmCommitMs, 500);
    EXPECT_EQ(r.cfg.alarmCommitMaxMs, 20000);
    EXPECT_EQ(r.cfg.alarmChatterWindowS, 120);
    EXPECT_TRUE(r.warnings.empty());
}

TEST(Config009, OutOfRangeIsClampedWithAWarningNotAnError) {
    auto r = loadJson(R"({"alarmRetentionDays":0,"alarmMaxBytes":1,"alarmCommitMs":10,
        "alarmChatterWindowS":99999,"alarmMaxShelved":500})");
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.alarmRetentionDays, 1);
    EXPECT_EQ(r.cfg.alarmMaxBytes, 4 * 1024 * 1024);
    EXPECT_EQ(r.cfg.alarmCommitMs, 200);
    EXPECT_EQ(r.cfg.alarmChatterWindowS, 600);
    EXPECT_EQ(r.cfg.alarmMaxShelved, 200);
    EXPECT_EQ(r.warnings.size(), 5u);
    bool named = false;
    for (const auto& w : r.warnings) named = named || w.find("alarmRetentionDays") == 0;
    EXPECT_TRUE(named);
}

TEST(Config009, TheStormWindowIsNeverShorterThanTheCommitWindow) {
    auto r = loadJson(R"({"alarmCommitMs":30000,"alarmCommitMaxMs":5000})");
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.alarmCommitMaxMs, 30000);
    EXPECT_EQ(r.warnings.size(), 1u);
}

TEST(Config009, ANotAnIntegerStopsTheRuntimeAndAnUnknownAlarmKeyIsNamed) {
    auto r = loadJson(R"({"alarmCommitMs":"fast"})");
    EXPECT_FALSE(r.ok);
    EXPECT_NE(r.error.find("alarmCommitMs"), std::string::npos);
    r = loadJson(R"({"alarmUnknown":1})");  // feature 011 (contract §6): a warning
    ASSERT_TRUE(r.ok) << r.error;
    ASSERT_EQ(r.warnings.size(), 1u);
    EXPECT_NE(r.warnings[0].find("alarmUnknown"), std::string::npos) << r.warnings[0];
}

// Feature 010 (contracts/device-010.md §2): the keys of the history API.
TEST(Config010, DefaultsAndKeysFromFile) {
    Args a{};
    auto r = loadConfig(a.argc(), a.argv(), files({}), host("bl335"));
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_TRUE(r.cfg.historyApi);
    EXPECT_EQ(r.cfg.historyMaxConcurrent, 2);
    EXPECT_EQ(r.cfg.historyQueryTimeoutMs, 10000);
    EXPECT_EQ(r.cfg.historyMaxScanMiB, 64);
    EXPECT_EQ(r.cfg.historyReaderCacheKiB, 4096);
    const auto f = loadJson(R"({"historyApi":false,"historyMaxConcurrent":4,
        "historyQueryTimeoutMs":30000,"historyMaxScanMiB":256,"historyReaderCacheKiB":8192})");
    ASSERT_TRUE(f.ok) << f.error;
    EXPECT_FALSE(f.cfg.historyApi);
    EXPECT_EQ(f.cfg.historyMaxConcurrent, 4);
    EXPECT_EQ(f.cfg.historyReaderCacheKiB, 8192);
}

TEST(Config010, RangesAreCheckedAndTheKeyIsNamed) {
    for (const char* bad :
         {R"({"historyMaxConcurrent":0})", R"({"historyMaxConcurrent":5})",
          R"({"historyQueryTimeoutMs":999})", R"({"historyQueryTimeoutMs":30001})",
          R"({"historyMaxScanMiB":7})", R"({"historyMaxScanMiB":257})",
          R"({"historyReaderCacheKiB":1023})", R"({"historyReaderCacheKiB":8193})",
          R"({"historyApi":"yes"})", R"({"historyMaxConcurrent":"2"})"}) {
        const auto r = loadJson(bad);
        EXPECT_FALSE(r.ok) << bad;
        EXPECT_NE(r.error.find("history"), std::string::npos) << r.error;
    }
    // Feature 011 (contracts/device-api-011.md §6): an unknown key is skipped with a warning.
    auto unknown = loadJson(R"({"historyFoo":1})");
    ASSERT_TRUE(unknown.ok) << unknown.error;
    EXPECT_EQ(unknown.warnings.size(), 1u);
}

// ---- feature 011 (contracts/device-api-011.md §6; FR-008, T026) ----

TEST(Config011, DefaultsOfTheNewKeysAreTheSafeOnes) {
    Args a{};
    auto r = loadConfig(a.argc(), a.argv(), files({}), host("bl335"));
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_TRUE(r.cfg.allowedHosts.empty());
    EXPECT_EQ(r.cfg.hostCheck, "strict");
    EXPECT_EQ(r.cfg.maxConnPerSource, 48);
    EXPECT_EQ(r.cfg.maxConcurrentLogins, 2);
    EXPECT_EQ(r.cfg.pulseRecovery, "on");
    EXPECT_FALSE(r.cfg.updateEnabled);
    EXPECT_EQ(r.cfg.updateMaxPackageMiB, 64);
    EXPECT_EQ(r.cfg.updateTrustedKeysDir, "/etc/mat-runtime/trusted-keys");
    EXPECT_EQ(r.cfg.logicWrites, "off");
    EXPECT_EQ(r.cfg.logicMaxWritesPerMin, 20);
    EXPECT_EQ(r.cfg.logicFlushS, 60);
    EXPECT_EQ(r.cfg.logicScanMs, 100);
    EXPECT_EQ(r.cfg.tzOffsetMin, 420);
    EXPECT_TRUE(r.warnings.empty());
}

TEST(Config011, KeysFromFileAtTheEdgesOfTheirRanges) {
    auto r = loadJson(R"({"allowedHosts":["scada.local","bl335.example.vn"],"hostCheck":"off",
        "maxConnPerSource":64,"maxConcurrentLogins":1,"pulseRecovery":"off",
        "update":{"enabled":true,"maxPackageMiB":256,"trustedKeysDir":"/etc/k"},
        "logic":{"writes":"on","maxWritesPerMin":60,"flushS":10,"scanMs":50},"tzOffsetMin":-720})");
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.allowedHosts, (std::vector<std::string>{"scada.local", "bl335.example.vn"}));
    EXPECT_EQ(r.cfg.hostCheck, "off");
    EXPECT_EQ(r.cfg.maxConnPerSource, 64);
    EXPECT_EQ(r.cfg.maxConcurrentLogins, 1);
    EXPECT_EQ(r.cfg.pulseRecovery, "off");
    EXPECT_TRUE(r.cfg.updateEnabled);
    EXPECT_EQ(r.cfg.updateMaxPackageMiB, 256);
    EXPECT_EQ(r.cfg.updateTrustedKeysDir, "/etc/k");
    EXPECT_EQ(r.cfg.logicWrites, "on");
    EXPECT_EQ(r.cfg.logicMaxWritesPerMin, 60);
    EXPECT_EQ(r.cfg.logicFlushS, 10);
    EXPECT_EQ(r.cfg.logicScanMs, 50);
    EXPECT_EQ(r.cfg.tzOffsetMin, -720);
    auto hi =
        loadJson(R"({"maxConnPerSource":4,"maxConcurrentLogins":4,"update":{"maxPackageMiB":8},
        "logic":{"maxWritesPerMin":1,"flushS":600,"scanMs":1000},"tzOffsetMin":840})");
    ASSERT_TRUE(hi.ok) << hi.error;
    EXPECT_EQ(hi.cfg.tzOffsetMin, 840);
    EXPECT_FALSE(hi.cfg.updateEnabled);  // a partial object keeps the other defaults
    EXPECT_EQ(hi.cfg.logicWrites, "off");
}

// FR-025 (T039): a maxConnPerSource above 60 % of httpsThreads is kept as set, and the runtime
// says it applies the lower value (conn_limit.hpp).
TEST(Config011, AMaxConnPerSourceAboveThreeQuartersOfTheWorkersIsAWarning) {
    auto r = loadJson(R"({"maxConnPerSource":64})");
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.maxConnPerSource, 64);
    ASSERT_EQ(r.warnings.size(), 1u);
    EXPECT_NE(r.warnings[0].find("maxConnPerSource 64"), std::string::npos) << r.warnings[0];
    EXPECT_NE(r.warnings[0].find("dùng 48"), std::string::npos) << r.warnings[0];
    auto ok = loadJson(R"({"maxConnPerSource":48,"httpsThreads":64})");
    ASSERT_TRUE(ok.ok) << ok.error;
    EXPECT_TRUE(ok.warnings.empty());
}

// Security review of 011 (M1): live sessions of one source address. Not set: half of the live
// slots, rounded up (5 of 10); 1-10 in runtime.json, or --max-live-clients-per-source (test rigs
// that open 10 pages from one computer).
TEST(Config011, MaxLiveClientsPerSourceDefaultsToHalfTheSlots) {
    Args a{};
    auto d = loadConfig(a.argc(), a.argv(), files({}), host("bl335"));
    ASSERT_TRUE(d.ok) << d.error;
    EXPECT_EQ(d.cfg.maxLiveClientsPerSource, 0);
    EXPECT_EQ(SessionManager::effectiveMaxPerSource(d.cfg.maxLiveClientsPerSource, 10), 5u);
    EXPECT_EQ(SessionManager::effectiveMaxPerSource(0, 3), 2u);
    EXPECT_EQ(SessionManager::effectiveMaxPerSource(8, 4), 4u) << "never above maxClients";
    for (const char* text :
         {R"({"maxLiveClientsPerSource":1})", R"({"maxLiveClientsPerSource":10})"}) {
        auto r = loadJson(text);
        ASSERT_TRUE(r.ok) << text << " " << r.error;
        EXPECT_TRUE(r.warnings.empty()) << text;
    }
    EXPECT_EQ(loadJson(R"({"maxLiveClientsPerSource":10})").cfg.maxLiveClientsPerSource, 10);
    for (const char* text :
         {R"({"maxLiveClientsPerSource":0})", R"({"maxLiveClientsPerSource":11})",
          R"({"maxLiveClientsPerSource":"5"})"}) {
        auto r = loadJson(text);
        EXPECT_FALSE(r.ok) << text;
        EXPECT_NE(r.error.find("maxLiveClientsPerSource"), std::string::npos) << r.error;
    }
    Args cli{"--max-live-clients-per-source", "10"};
    auto c = loadConfig(cli.argc(), cli.argv(), files({}), host("bl335"));
    ASSERT_TRUE(c.ok) << c.error;
    EXPECT_EQ(c.cfg.maxLiveClientsPerSource, 10);
    Args bad{"--max-live-clients-per-source", "0"};
    EXPECT_FALSE(loadConfig(bad.argc(), bad.argv(), files({}), host("bl335")).ok);
}

TEST(Config011, OutOfRangeOrWrongTypeStopsTheRuntimeWithTheKeyNamed) {
    const std::pair<const char*, const char*> bad[] = {
        {R"({"maxConnPerSource":3})", "maxConnPerSource"},
        {R"({"maxConnPerSource":65})", "maxConnPerSource"},
        {R"({"maxConcurrentLogins":0})", "maxConcurrentLogins"},
        {R"({"maxConcurrentLogins":5})", "maxConcurrentLogins"},
        {R"({"maxConcurrentLogins":"2"})", "maxConcurrentLogins"},
        {R"({"hostCheck":"lax"})", "hostCheck"},
        {R"({"pulseRecovery":true})", "pulseRecovery"},
        {R"({"allowedHosts":"scada.local"})", "allowedHosts"},
        {R"({"allowedHosts":[1]})", "allowedHosts"},
        {R"({"allowedHosts":[""]})", "allowedHosts"},
        {R"({"update":true})", "update"},
        {R"({"update":{"enabled":"yes"}})", "update.enabled"},
        {R"({"update":{"maxPackageMiB":7}})", "update.maxPackageMiB"},
        {R"({"update":{"maxPackageMiB":257}})", "update.maxPackageMiB"},
        {R"({"update":{"trustedKeysDir":""}})", "update.trustedKeysDir"},
        {R"({"logic":[]})", "logic"},
        {R"({"logic":{"writes":true}})", "logic.writes"},
        {R"({"logic":{"writes":"maybe"}})", "logic.writes"},
        {R"({"logic":{"maxWritesPerMin":0}})", "logic.maxWritesPerMin"},
        {R"({"logic":{"maxWritesPerMin":61}})", "logic.maxWritesPerMin"},
        {R"({"logic":{"flushS":9}})", "logic.flushS"},
        {R"({"logic":{"flushS":601}})", "logic.flushS"},
        {R"({"logic":{"scanMs":49}})", "logic.scanMs"},
        {R"({"logic":{"scanMs":1001}})", "logic.scanMs"},
        {R"({"tzOffsetMin":-721})", "tzOffsetMin"},
        {R"({"tzOffsetMin":841})", "tzOffsetMin"},
        {R"({"tzOffsetMin":420.5})", "tzOffsetMin"},
    };
    for (const auto& [text, key] : bad) {
        auto r = loadJson(text);
        EXPECT_FALSE(r.ok) << text;
        EXPECT_NE(r.error.find(key), std::string::npos) << text << " -> " << r.error;
    }
}

TEST(Config011, AllowedHostsIsBoundedInCountAndLength) {
    std::string many = R"({"allowedHosts":[)";
    for (int i = 0; i < 33; ++i) many += (i ? ",\"h" : "\"h") + std::to_string(i) + "\"";
    many += "]}";
    EXPECT_FALSE(loadJson(many).ok);
    const std::string longName(254, 'a');
    EXPECT_FALSE(loadJson(R"({"allowedHosts":[")" + longName + R"("]})").ok);
    const std::string okName(253, 'a');
    EXPECT_TRUE(loadJson(R"({"allowedHosts":[")" + okName + R"("]})").ok);
}

TEST(Config011, UnknownKeysAreSkippedWithAWarningAtTopLevelAndInsideObjects) {
    // Backward compatible: a runtime.json written for a newer runtime still starts (contract §6).
    // Every new key defaults to the safe value, so a misspelt key keeps the protection on.
    auto r = loadJson(R"({"hostChek":"off","update":{"enabld":true},"logic":{"writez":"on"}})");
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.hostCheck, "strict");
    EXPECT_FALSE(r.cfg.updateEnabled);
    EXPECT_EQ(r.cfg.logicWrites, "off");
    ASSERT_EQ(r.warnings.size(), 3u);
    std::string all;
    for (const auto& w : r.warnings) all += w + "\n";
    EXPECT_NE(all.find("hostChek"), std::string::npos) << all;
    EXPECT_NE(all.find("update.enabld"), std::string::npos) << all;
    EXPECT_NE(all.find("logic.writez"), std::string::npos) << all;
}

// Feature 027 (FR-001, FR-002): <dataDir>/settings.json over runtime.json and the command line,
// only for the keys the Studio may change; a damaged file never stops the runtime.
TEST(DeviceSettings, OverlayWinsOverRuntimeJsonForTheAllowedKeys) {
    Args a{"--config", "/c.json"};
    auto r = loadConfig(
        a.argc(), a.argv(),
        files({{"/c.json",
                R"({"dataDir":"/d","viewerLogin":"off","update":{"enabled":false},"port":8081})"},
               {"/d/settings.json",
                R"({"rev":4,"values":{"viewerLogin":"required","viewerAccess":"any",
                    "allowedHosts":["scada.local"],"maxLiveClientsPerSource":3,
                    "updateEnabled":true,"deviceName":"Trạm bơm 1"}})"}}));
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.viewerLogin, "required");
    EXPECT_EQ(r.cfg.viewerAccess, "any");
    ASSERT_EQ(r.cfg.allowedHosts.size(), 1u);
    EXPECT_EQ(r.cfg.allowedHosts[0], "scada.local");
    EXPECT_EQ(r.cfg.maxLiveClientsPerSource, 3);
    EXPECT_TRUE(r.cfg.updateEnabled);
    EXPECT_EQ(r.cfg.deviceName, "Trạm bơm 1");
    EXPECT_EQ(r.cfg.port, 8081);
    EXPECT_EQ(r.settingsRev, 4);
    EXPECT_EQ(r.base.viewerLogin, "off") << "base: runtime.json without the overlay";
    EXPECT_FALSE(r.base.updateEnabled);
}

TEST(DeviceSettings, DamagedFileFallsBackToBakThenIsIgnoredWithAWarning) {
    Args a{"--data-dir", "/d"};
    auto r = loadConfig(
        a.argc(), a.argv(),
        files({{"/d/settings.json", "{not json"},
               {"/d/settings.json.bak", R"({"rev":2,"values":{"viewerLogin":"required"}})"}}));
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.cfg.viewerLogin, "required");
    EXPECT_EQ(r.settingsRev, 2);
    EXPECT_FALSE(r.warnings.empty());

    auto bad = loadConfig(a.argc(), a.argv(),
                          files({{"/d/settings.json", R"({"rev":1,"values":{"port":1}})"}}));
    ASSERT_TRUE(bad.ok) << "never stops the start: " << bad.error;
    EXPECT_EQ(bad.cfg.port, 8080) << "a key outside the list is not applied";
    EXPECT_EQ(bad.settingsRev, 0);
    EXPECT_FALSE(bad.warnings.empty());
}

TEST(DeviceSettings, ApplyChecksEveryValueAndRefusesOtherKeys) {
    RuntimeConfig c;
    std::string err;
    EXPECT_TRUE(applyDeviceSettings(nlohmann::json::object(), c, err)) << err;
    EXPECT_FALSE(applyDeviceSettings({{"viewerLogin", "maybe"}}, c, err));
    EXPECT_FALSE(applyDeviceSettings({{"viewerAccess", "all"}}, c, err));
    EXPECT_FALSE(applyDeviceSettings({{"maxLiveClientsPerSource", 11}}, c, err));
    EXPECT_FALSE(applyDeviceSettings({{"updateEnabled", "yes"}}, c, err));
    EXPECT_FALSE(applyDeviceSettings({{"deviceName", ""}}, c, err));
    EXPECT_FALSE(applyDeviceSettings({{"allowedHosts", "x"}}, c, err));
    EXPECT_FALSE(applyDeviceSettings({{"httpsPort", 9443}}, c, err));
    EXPECT_NE(err.find("httpsPort"), std::string::npos);
    EXPECT_TRUE(
        applyDeviceSettings({{"updateEnabled", true}, {"allowedHosts", {"a", "b"}}}, c, err));
    EXPECT_TRUE(c.updateEnabled);
    const nlohmann::json v = deviceSettingsOf(c);
    EXPECT_EQ(v["updateEnabled"], true);
    EXPECT_EQ(v["allowedHosts"].size(), 2u);
    EXPECT_EQ(v.size(), 6u);
}
