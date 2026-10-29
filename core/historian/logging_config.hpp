// Runtime model of a validated logging.json (specs/003-data-logging data-model §1): defaults are
// applied here (table and column names, intervals, ports, TLS, time zones) and tags are resolved
// to TagStore indexes.
#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "core/tag-engine/tag_store.hpp"
#include "nlohmann/json.hpp"

namespace mat {

enum class LogMode { Cyclic, OnChange, Trigger };
enum class TriggerEdge { Rising, Falling, Both, Active };  // specs/010 contracts/logging-config-0.2
enum class DbType { MySql, MsSql, PostgreSql, InfluxDb };
enum class TlsMode { Disable, Prefer, Require, VerifyFull };

struct LoggedColumn {
    std::string tagId;
    size_t tagIndex = 0;
    TagType type = TagType::FLOAT64;
    std::string column;
    double deadband = 0;
    int maxLength = 255;    // STRING only
    bool aggregate = true;  // 0.2: false leaves the column out of the aggregate tables
    std::string label;      // 1.x (042): display label; empty = column/tag name (last: aggregate init)
};

// 0.2 `trigger` group: the row is written on an edge of this tag (which need not be a column).
struct TriggerModel {
    std::string tagId;
    size_t tagIndex = 0;
    TagType type = TagType::BOOL;
    TriggerEdge edge = TriggerEdge::Rising;
    double threshold = 0;  // numeric tags: on = value > threshold
};

// 0.2 `aggregates`: the group keeps the 1-minute and 1-hour tables (history.db schema 2).
struct AggregatesModel {
    int minuteRetentionDays = 31;
    int hourRetentionDays = 730;
};

struct LoggingGroupModel {
    std::string id;
    std::string name;
    std::string table;
    LogMode mode = LogMode::Cyclic;
    int64_t periodMs = 0;          // cyclic
    int64_t minIntervalMs = 1000;  // onChange
    int64_t maxIntervalMs = 0;     // onChange; 0 = no heartbeat rows
    int retentionDays = 1;
    std::vector<std::string> destinations;
    std::vector<LoggedColumn> columns;
    // 0.2 (specs/010-history-reports)
    std::optional<TriggerModel> trigger;
    std::optional<AggregatesModel> aggregates;
    int64_t expectedRowsPerDay = 0;  // estimate only; 0 = not given
    // Columns with a numeric or BOOL tag that take part in the aggregate tables (indexes into
    // `columns`); empty when `aggregates` is not set.
    std::vector<size_t> aggregateColumns() const;
};

struct ConnectionModel {
    std::string id;
    DbType type = DbType::MySql;
    std::string host;
    int port = 0;
    std::string database;
    std::string schema;  // mssql (dbo) / postgresql (public)
    std::string user;
    std::string url;  // influxdb
    std::string org;
    std::string bucket;
    TlsMode tls = TlsMode::VerifyFull;  // secure by default (Constitution V)
    int offsetMin = 420;                // time column of SQL tables; InfluxDB is always UTC (0)
};

struct LoggingModel {
    int offsetMin = 420;  // +07:00 unless logging.json says otherwise
    std::vector<LoggingGroupModel> groups;
    std::vector<ConnectionModel> connections;
};

std::string defaultTableName(const std::string& groupId);  // "van-hanh" → "van_hanh"
std::string defaultColumnName(const std::string& tagId);   // "TANK01.LEVEL" → "TANK01_LEVEL"
const char* sqliteAffinity(TagType t);                     // INTEGER / REAL / TEXT
const char* dbTypeName(DbType t);                          // "mysql", "mssql", ...

// `logging` must have passed the validator. Throws std::invalid_argument on a tag that is not in
// `store` (cannot happen for a validated project).
LoggingModel buildLoggingModel(const nlohmann::json& logging, const TagStore& store);

}  // namespace mat
