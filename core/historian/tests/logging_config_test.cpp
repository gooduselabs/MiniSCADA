// Validated logging.json → runtime model (specs/003-data-logging/data-model.md §1).
#include "core/historian/logging_config.hpp"

#include <gtest/gtest.h>

using namespace mat;
using nlohmann::json;

namespace {
void fillDemo(TagStore& s) {
    s.add({"TANK01.LEVEL", TagType::FLOAT32, ""});
    s.add({"MOTOR01.RUN", TagType::BOOL, ""});
    s.add({"LINE.NAME", TagType::STRING, ""});
    s.add({"C.COUNT", TagType::UINT64, ""});
}
}  // namespace

TEST(LoggingConfig, DefaultNames) {
    EXPECT_EQ(defaultTableName("van-hanh"), "van_hanh");
    EXPECT_EQ(defaultTableName("3pha"), "t_3pha");
    EXPECT_EQ(defaultColumnName("TANK01.LEVEL"), "TANK01_LEVEL");
    EXPECT_EQ(defaultColumnName("A_b.c9"), "A_b_c9");
}

TEST(LoggingConfig, SqliteAffinityFollowsTagType) {
    EXPECT_STREQ(sqliteAffinity(TagType::BOOL), "INTEGER");
    EXPECT_STREQ(sqliteAffinity(TagType::INT16), "INTEGER");
    EXPECT_STREQ(sqliteAffinity(TagType::UINT64), "");  // > INT64_MAX must stay exact text
    EXPECT_STREQ(sqliteAffinity(TagType::UINT32), "INTEGER");
    EXPECT_STREQ(sqliteAffinity(TagType::FLOAT32), "REAL");
    EXPECT_STREQ(sqliteAffinity(TagType::FLOAT64), "REAL");
    EXPECT_STREQ(sqliteAffinity(TagType::STRING), "TEXT");
}

TEST(LoggingConfig, BuildsModelWithDefaults) {
    TagStore s;
    fillDemo(s);
    json cfg = json::parse(R"({
      "schemaVersion": "0.1.0",
      "groups": [
        {"id": "van-hanh", "name": "Vận hành", "mode": "onChange", "retentionDays": 30,
         "destinations": ["db1"],
         "tags": [{"tagId": "TANK01.LEVEL", "deadband": 0.5}, {"tagId": "MOTOR01.RUN"},
                  {"tagId": "LINE.NAME"}]},
        {"id": "3pha", "name": "Ba pha", "table": "ba_pha", "mode": "cyclic", "periodMs": 60000,
         "retentionDays": 365,
         "tags": [{"tagId": "TANK01.LEVEL", "column": "MUC_BON"}, {"tagId": "C.COUNT"},
                  {"tagId": "LINE.NAME", "maxLength": 32}]}
      ],
      "connections": [
        {"id": "db1", "type": "mysql", "host": "10.0.0.5", "database": "scada", "user": "w"},
        {"id": "db2", "type": "mssql", "host": "h", "database": "d", "user": "u",
         "tls": "require", "timeZone": "+08:00"},
        {"id": "db3", "type": "postgresql", "host": "h", "database": "d", "user": "u"},
        {"id": "in1", "type": "influxdb", "url": "https://influx:8086", "org": "o", "bucket": "b"},
        {"id": "in2", "type": "influxdb", "url": "http://influx:8086", "org": "o", "bucket": "b"}
      ]
    })");
    LoggingModel m = buildLoggingModel(cfg, s);
    EXPECT_EQ(m.offsetMin, 420);  // default +07:00
    ASSERT_EQ(m.groups.size(), 2u);

    const auto& g0 = m.groups[0];
    EXPECT_EQ(g0.id, "van-hanh");
    EXPECT_EQ(g0.table, "van_hanh");
    EXPECT_EQ(g0.mode, LogMode::OnChange);
    EXPECT_EQ(g0.minIntervalMs, 1000);
    EXPECT_EQ(g0.maxIntervalMs, 0);
    EXPECT_EQ(g0.retentionDays, 30);
    ASSERT_EQ(g0.destinations.size(), 1u);
    ASSERT_EQ(g0.columns.size(), 3u);
    EXPECT_EQ(g0.columns[0].column, "TANK01_LEVEL");
    EXPECT_EQ(g0.columns[0].tagIndex, 0u);
    EXPECT_EQ(g0.columns[0].type, TagType::FLOAT32);
    EXPECT_DOUBLE_EQ(g0.columns[0].deadband, 0.5);
    EXPECT_EQ(g0.columns[1].tagIndex, 1u);
    EXPECT_DOUBLE_EQ(g0.columns[1].deadband, 0.0);
    EXPECT_EQ(g0.columns[2].maxLength, 255);

    const auto& g1 = m.groups[1];
    EXPECT_EQ(g1.table, "ba_pha");
    EXPECT_EQ(g1.mode, LogMode::Cyclic);
    EXPECT_EQ(g1.periodMs, 60000);
    EXPECT_EQ(g1.columns[0].column, "MUC_BON");
    EXPECT_EQ(g1.columns[1].type, TagType::UINT64);
    EXPECT_EQ(g1.columns[2].maxLength, 32);

    ASSERT_EQ(m.connections.size(), 5u);
    EXPECT_EQ(m.connections[0].type, DbType::MySql);
    EXPECT_EQ(m.connections[0].port, 3306);
    EXPECT_EQ(m.connections[0].tls, TlsMode::VerifyFull);  // SQL default: check the server
    EXPECT_EQ(m.connections[0].offsetMin, 420);
    EXPECT_EQ(m.connections[1].port, 1433);
    EXPECT_EQ(m.connections[1].schema, "dbo");
    EXPECT_EQ(m.connections[1].tls, TlsMode::Require);
    EXPECT_EQ(m.connections[1].offsetMin, 480);
    EXPECT_EQ(m.connections[2].port, 5432);
    EXPECT_EQ(m.connections[2].schema, "public");
    EXPECT_EQ(m.connections[3].tls, TlsMode::VerifyFull);  // https default
    EXPECT_EQ(m.connections[4].tls, TlsMode::Disable);     // http
    EXPECT_EQ(m.connections[3].offsetMin, 0);              // InfluxDB is always UTC
}

TEST(LoggingConfig, RootTimeZoneIsUsed) {
    TagStore s;
    fillDemo(s);
    json cfg = json::parse(R"({"schemaVersion":"0.1.0","timeZone":"-03:30",
      "groups":[{"id":"g","name":"G","mode":"cyclic","periodMs":1000,"retentionDays":1,
                 "tags":[{"tagId":"MOTOR01.RUN"}]}],
      "connections":[{"id":"c","type":"postgresql","host":"h","database":"d","user":"u"}]})");
    LoggingModel m = buildLoggingModel(cfg, s);
    EXPECT_EQ(m.offsetMin, -210);
    EXPECT_EQ(m.connections[0].offsetMin, -210);
}

TEST(LoggingConfig, MissingTagIsRejected) {
    TagStore s;
    fillDemo(s);
    json cfg = json::parse(R"({"schemaVersion":"0.1.0",
      "groups":[{"id":"g","name":"G","mode":"cyclic","periodMs":1000,"retentionDays":1,
                 "tags":[{"tagId":"NOPE"}]}]})");
    EXPECT_THROW(buildLoggingModel(cfg, s), std::invalid_argument);
}
