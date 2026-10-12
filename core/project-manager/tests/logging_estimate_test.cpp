// Write and storage estimate of logging.json (specs/003-data-logging/contracts/logging-config.md).
// Same numbers as packages/project-schema/src/logging.test.ts.
#include "core/project-manager/logging_estimate.hpp"

#include <gtest/gtest.h>

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
    EXPECT_EQ(e.writeBytesPerDay, 994083840.0);
    EXPECT_TRUE(e.warnings.empty());
}

TEST(LoggingEstimate, EveryHundredMillisecondsIsOverBudget) {
    std::map<std::string, std::string> types;
    const auto e = estimateLogging(floats(500, 100, types), types);
    EXPECT_EQ(e.writeBytesPerDay, 8029808640.0);
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
    EXPECT_EQ(e.writeBytesPerDay, 2 * rows * row + std::min(17280.0, rows) * 3 * 4096);
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
