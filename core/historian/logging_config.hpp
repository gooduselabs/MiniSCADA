// Runtime model of a validated logging.json (specs/003-data-logging data-model §1): defaults are
// applied here (table and column names, intervals, ports, TLS, time zones) and tags are resolved
// to TagStore indexes.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "core/tag-engine/tag_store.hpp"
#include "nlohmann/json.hpp"

namespace mat {

enum class LogMode { Cyclic, OnChange };
enum class DbType { MySql, MsSql, PostgreSql, InfluxDb };
enum class TlsMode { Disable, Prefer, Require, VerifyFull };

struct LoggedColumn {
    std::string tagId;
    size_t tagIndex = 0;
    TagType type = TagType::FLOAT64;
    std::string column;
    double deadband = 0;
    int maxLength = 255;  // STRING only
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
