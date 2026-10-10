#include "server/config.hpp"

#include <gtest/gtest.h>

#include <map>

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

TEST(Config, ThreadsRaisedToFitClients) {
    Args a{"--threads", "4"};
    auto r = loadConfig(a.argc(), a.argv(), files({}));
    ASSERT_TRUE(r.ok);
    EXPECT_GE(r.cfg.threads, r.cfg.maxClients + 4);
    EXPECT_FALSE(r.warnings.empty());
}
