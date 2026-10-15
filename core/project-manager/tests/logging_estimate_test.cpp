// Write and storage estimate of logging.json (specs/003-data-logging/contracts/logging-config.md).
// Same numbers as packages/project-schema/src/logging.test.ts.
#include "core/project-manager/logging_estimate.hpp"
#include "core/project-manager/project_validator.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <set>
#include <sstream>

using namespace mat;
using nlohmann::json;

namespace {

json oneGroup(json group) {
    json g = {{"id", "g"},
              {"name", "G"},
              {"mode", "cyclic"},
              {"retentionDays", 1},
              {"tags", json::array()}};
    g.update(group);
    return {{"schemaVersion", "0.1.0"}, {"groups", json::array({g})}};
}

json floats(int n, int periodMs, std::map<std::string, std::string>& types) {
    json tags = json::array();
    for (int i = 0; i < n; ++i) {
        tags.push_back({{"tagId", "T" + std::to_string(i)}});
        types["T" + std::to_string(i)] = "FLOAT32";
    }
    return oneGroup({{"periodMs", periodMs}, {"tags", tags}});
}

}  // namespace

TEST(LoggingEstimate, FiveHundredFloatsEverySecondStayWithinBudget) {
    std::map<std::string, std::string> types;
    const auto e = estimateLogging(floats(500, 1000, types), types);
    EXPECT_EQ(e.writeBytesPerDay, 1206420480.0);
    EXPECT_TRUE(e.warnings.empty());
}

TEST(LoggingEstimate, EveryHundredMillisecondsIsOverBudget) {
    std::map<std::string, std::string> types;
    const auto e = estimateLogging(floats(500, 100, types), types);
    EXPECT_EQ(e.writeBytesPerDay, 8242145280.0);
    EXPECT_EQ(e.storageBytes, 864000.0 * 4524);  // one day of rows: over the size cap as well
    EXPECT_EQ(e.warnings, (std::vector<std::string>{"W_LOG_WRITE_BUDGET", "W_LOG_SIZE_CAP"}));
}

TEST(LoggingEstimate, LongRetentionIsOverTheSizeCap) {
    const json cfg = oneGroup({{"periodMs", 1000},
                               {"retentionDays", 3650},
                               {"tags", {{{"tagId", "A"}}, {{"tagId", "B"}}, {{"tagId", "C"}}}}});
    const auto e = estimateLogging(cfg, {{"A", "FLOAT32"}, {"B", "BOOL"}, {"C", "STRING"}});
    EXPECT_EQ(e.storageBytes, 86400.0 * 101 * 3650);
    EXPECT_EQ(e.warnings, std::vector<std::string>{"W_LOG_SIZE_CAP"});
}

TEST(LoggingEstimate, CellSizesAndOnChangeInterval) {
    const json cfg = oneGroup({{"mode", "onChange"},
                               {"minIntervalMs", 2000},
                               {"tags",
                                {{{"tagId", "B"}},
                                 {{"tagId", "I16"}},
                                 {{"tagId", "U32"}},
                                 {{"tagId", "I64"}},
                                 {{"tagId", "S"}, {"maxLength", 10}}}}});
    const auto e = estimateLogging(
        cfg,
        {{"B", "BOOL"}, {"I16", "INT16"}, {"U32", "UINT32"}, {"I64", "INT64"}, {"S", "STRING"}});
    const double row = 24 + 2 + 3 + 5 + 9 + (2 + 10);
    const double rows = 86400000.0 / 2000;
    EXPECT_EQ(e.storageBytes, rows * row);
    EXPECT_EQ(e.writeBytesPerDay, 2 * rows * row + std::min(17280.0, rows) * 6 * 4096);
    const auto d = estimateLogging(oneGroup({{"mode", "onChange"}, {"tags", {{{"tagId", "B"}}}}}),
                                   {{"B", "BOOL"}});
    EXPECT_EQ(d.storageBytes, 86400.0 * 26);
}

// Review I9, S13; security review M2, L4: the same answers as
// packages/project-schema/src/logging.ts.
TEST(LoggingNames, SecretKeysCompareInAsciiOnly) {
    EXPECT_EQ(findSecretKey(json::parse(R"({"a":{"PassWord":1}})")).value_or(""), "/a/PassWord");
    EXPECT_FALSE(findSecretKey(json::parse("{\"to\\u212Aen\":1}")).has_value());
}

TEST(LoggingNames, AUserOrPasswordInAConnectionUrlIsASecret) {
    auto cfg = [](const std::string& url) {
        return json{
            {"connections", json::array({json{{"id", "a"}}, json{{"id", "b"}, {"url", url}}})}};
    };
    EXPECT_EQ(findUrlCredentials(cfg("https://admin:S3cret@influx:8086")).value_or(""),
              "/connections/1/url");
    EXPECT_EQ(findUrlCredentials(cfg("https://admin@influx:8086")).value_or(""),
              "/connections/1/url");
    EXPECT_FALSE(findUrlCredentials(cfg("https://influx:8086/a@b")).has_value());
    EXPECT_FALSE(findUrlCredentials(cfg("https://influx:8086")).has_value());
}

TEST(LoggingNames, ConnectionsAGroupSendsToWithoutCheckingTheServer) {
    const json cfg = json::parse(R"({
      "groups": [{"id": "g", "destinations": ["a", "b", "c", "d", "e", "f", "g", "h"]}],
      "connections": [
        {"id": "a", "type": "mysql"},
        {"id": "b", "type": "postgresql", "tls": "verify-full"},
        {"id": "c", "type": "mssql", "tls": "require"},
        {"id": "d", "type": "influxdb", "url": "https://i:8086"},
        {"id": "e", "type": "influxdb", "url": "https://i:8086", "tls": "require"},
        {"id": "f", "type": "influxdb", "url": "http://10.0.0.7:8086"},
        {"id": "g", "type": "influxdb", "url": "http://127.0.0.1:8086/"},
        {"id": "h", "type": "mysql", "tls": "prefer"},
        {"id": "unused", "type": "mysql", "tls": "disable"}
      ]})");
    // A SQL connection without "tls" checks the server (verify-full, Constitution V).
    EXPECT_EQ(unverifiedConnections(cfg), (std::vector<size_t>{2, 4, 5, 7}));
}

// ---- Feature 010 (T012): estimate v2 on the vectors shared with TypeScript ----
// tests/project-vectors/*logging-010-*: every case with `estimate` gives the fixed numbers of
// contracts/logging-config-0.2.md §5 (not computed by a formula); the sums may differ by 1 byte.

namespace {

const std::string kVectors = std::string(MAT_SOURCE_DIR) + "/tests/project-vectors";
const std::string kSchemas = std::string(MAT_SOURCE_DIR) + "/schemas";

json readJsonFile(const std::string& path) {
    std::ifstream f(path);
    std::stringstream ss;
    ss << f.rdbuf();
    return json::parse(ss.str());
}

// Cases of logging-010: the 0.6 ones and the two of 0.1.
std::vector<std::string> listLoggingCases() {
    std::vector<std::string> out;
    for (const auto& e : std::filesystem::directory_iterator(kVectors)) {
        const std::string n = e.path().filename().string();
        if (e.is_directory() &&
            (n.rfind("v06-logging-010-", 0) == 0 || n.rfind("logging-010-", 0) == 0))
            out.push_back(n);
    }
    std::sort(out.begin(), out.end());
    return out;
}

std::vector<std::string> listEstimateCases() {
    std::vector<std::string> out;
    for (const auto& n : listLoggingCases())
        if (readJsonFile(kVectors + "/" + n + "/expected.json").contains("estimate"))
            out.push_back(n);
    return out;
}

}  // namespace

class Estimate010 : public ::testing::TestWithParam<std::string> {};

TEST_P(Estimate010, SameNumbersAsTypeScript) {
    const std::string dir = kVectors + "/" + GetParam();
    const json expected = readJsonFile(dir + "/expected.json");
    const json want = expected["estimate"];
    const ProjectValidation r = validateProject(dir, kSchemas);
    ASSERT_TRUE(r.project.has_value()) << resultJson(r);
    std::map<std::string, std::string> types;
    for (const auto& t : r.project->tags["tags"])
        types[t["id"].get<std::string>()] = t["type"].get<std::string>();
    const LoggingEstimate e = estimateLogging(r.project->logging, types);
    EXPECT_NEAR(e.writeBytesPerDay, want["writeBytesPerDay"].get<double>(), 1);
    EXPECT_NEAR(e.rawWriteBytesPerDay, want["rawWriteBytesPerDay"].get<double>(), 1);
    EXPECT_NEAR(e.aggWriteBytesPerDay, want["aggWriteBytesPerDay"].get<double>(), 1);
    EXPECT_NEAR(e.storageBytes, want["storageBytes"].get<double>(), 1);
    EXPECT_NEAR(e.dailyGrowthBytes, want["dailyGrowthBytes"].get<double>(), 1);
    if (want["daysToFillCap"].is_null())
        EXPECT_EQ(e.daysToFillCap, -1);
    else
        EXPECT_EQ(e.daysToFillCap, want["daysToFillCap"].get<double>());
    ASSERT_EQ(e.groups.size(), want["groups"].size());
    for (size_t i = 0; i < e.groups.size(); ++i) {
        const json& g = want["groups"][i];
        const GroupEstimate& x = e.groups[i];
        EXPECT_NEAR(x.rowsPerDay, g["rowsPerDay"].get<double>(), 1) << i;
        EXPECT_NEAR(x.rowBytes, g["rowBytes"].get<double>(), 1) << i;
        EXPECT_NEAR(x.rawWrite, g["rawWrite"].get<double>(), 1) << i;
        EXPECT_NEAR(x.aggWrite, g["aggWrite"].get<double>(), 1) << i;
        EXPECT_NEAR(x.rawStorage, g["rawStorage"].get<double>(), 1) << i;
        EXPECT_NEAR(x.aggStorage, g["aggStorage"].get<double>(), 1) << i;
        EXPECT_NEAR(x.aggTags, g["aggTags"].get<double>(), 1) << i;
        EXPECT_EQ(x.basis, g["basis"].get<std::string>()) << i;
    }
    // the warnings of the estimate are the ones of the case (W_LOG_WRITE_EXTREME: 0.6 only)
    std::set<std::string> gotW(e.warnings.begin(), e.warnings.end()), wantW;
    for (const auto& w : expected["warnings"]) wantW.insert(w.get<std::string>());
    EXPECT_EQ(gotW, wantW);
}

INSTANTIATE_TEST_SUITE_P(EstimateVectors, Estimate010, ::testing::ValuesIn(listEstimateCases()),
                         [](const ::testing::TestParamInfo<std::string>& i) {
                             std::string n = i.param;
                             std::replace(n.begin(), n.end(), '-', '_');
                             return n;
                         });

TEST(Estimate010Cases, CoverTheEstimateVectorsAndAllWarnings) {
    EXPECT_GE(listEstimateCases().size(), 7u);
    std::set<std::string> warns;
    for (const auto& n : listLoggingCases())
        for (const auto& w :
             readJsonFile(kVectors + "/" + n + "/expected.json").value("warnings", json::array()))
            warns.insert(w.get<std::string>());
    for (const char* w : {"W_LOG_WRITE_BUDGET", "W_LOG_WRITE_EXTREME", "W_LOG_SIZE_CAP"})
        EXPECT_TRUE(warns.count(w)) << w;
}

// Direct checks of the rules of the estimate v2: a trigger group is bounded by minIntervalMs, an
// active trigger is exact, and aggregates add 64-byte rows.
TEST(LoggingEstimateV2, TriggerExpectedActiveAndAggregates) {
    json g = {{"id", "g"},
              {"name", "G"},
              {"mode", "trigger"},
              {"minIntervalMs", 5000},
              {"retentionDays", 10},
              {"trigger", {{"tagId", "B"}, {"edge", "rising"}}},
              {"expectedRowsPerDay", 100000},
              {"aggregates", json::object()},
              {"tags", {{{"tagId", "A"}}, {{"tagId", "S"}}}}};
    json cfg = {{"schemaVersion", "0.6.0"}, {"groups", json::array({g})}};
    const std::map<std::string, std::string> types{
        {"A", "FLOAT32"}, {"S", "STRING"}, {"B", "BOOL"}};
    const auto e = estimateLogging(cfg, types);
    ASSERT_EQ(e.groups.size(), 1u);
    EXPECT_EQ(e.groups[0].basis, "expected");
    EXPECT_EQ(e.groups[0].rowsPerDay, 17280.0) << "capped by 86400000 / minIntervalMs";
    EXPECT_EQ(e.groups[0].aggTags, 1.0) << "the STRING Tag is not aggregated";
    EXPECT_EQ(e.groups[0].aggWrite, 3.6 * 1 * (1440 + 24) * 64);
    cfg["groups"][0]["trigger"]["edge"] = "active";
    cfg["groups"][0]["periodMs"] = 60000;
    const auto a = estimateLogging(cfg, types);
    EXPECT_EQ(a.groups[0].basis, "exact");
    EXPECT_EQ(a.groups[0].rowsPerDay, 1440.0);
    EXPECT_EQ(estimateLogging(json{{"groups", json::array()}}, {}).daysToFillCap, -1);
}
