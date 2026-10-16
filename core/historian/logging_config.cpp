#include "core/historian/logging_config.hpp"

#include <stdexcept>

#include "core/historian/clock.hpp"

namespace mat {

using nlohmann::json;

namespace {

DbType parseDbType(const std::string& s) {
    if (s == "mssql") return DbType::MsSql;
    if (s == "postgresql") return DbType::PostgreSql;
    if (s == "influxdb") return DbType::InfluxDb;
    return DbType::MySql;
}

TlsMode parseTls(const std::string& s) {
    if (s == "disable") return TlsMode::Disable;
    if (s == "require") return TlsMode::Require;
    if (s == "verify-full") return TlsMode::VerifyFull;
    return TlsMode::Prefer;
}

int offsetOr(const json& j, const char* key, int fallback) {
    if (j.contains(key))
        if (auto o = parseUtcOffset(j[key].get<std::string>())) return *o;
    return fallback;
}

}  // namespace

std::string defaultTableName(const std::string& groupId) {
    std::string t = groupId;
    for (char& c : t)
        if (c == '-') c = '_';
    if (!t.empty() && t[0] >= '0' && t[0] <= '9') t = "t_" + t;
    return t;
}

std::string defaultColumnName(const std::string& tagId) {
    std::string c = tagId;
    for (char& ch : c) {
        const bool keep = (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') ||
                          (ch >= '0' && ch <= '9') || ch == '_';
        if (!keep) ch = '_';
    }
    return c;
}

const char* sqliteAffinity(TagType t) {
    switch (t) {
        case TagType::FLOAT32:
        case TagType::FLOAT64:
            return "REAL";
        case TagType::STRING:
            return "TEXT";
        case TagType::UINT64:
            // No declared type (BLOB affinity): INTEGER affinity would turn a decimal text above
            // INT64_MAX into an inexact REAL. Values ≤ INT64_MAX are still stored as INTEGER.
            return "";
        default:
            return "INTEGER";
    }
}

const char* dbTypeName(DbType t) {
    switch (t) {
        case DbType::MsSql:
            return "mssql";
        case DbType::PostgreSql:
            return "postgresql";
        case DbType::InfluxDb:
            return "influxdb";
        default:
            return "mysql";
    }
}

std::vector<size_t> LoggingGroupModel::aggregateColumns() const {
    std::vector<size_t> out;
    if (!aggregates) return out;
    for (size_t i = 0; i < columns.size(); ++i)
        if (columns[i].aggregate && columns[i].type != TagType::STRING) out.push_back(i);
    return out;
}

LoggingModel buildLoggingModel(const json& logging, const TagStore& store) {
    LoggingModel m;
    m.offsetMin = offsetOr(logging, "timeZone", 420);

    for (const json& gj : logging["groups"]) {
        LoggingGroupModel g;
        g.id = gj["id"].get<std::string>();
        g.name = gj["name"].get<std::string>();
        g.table = gj.contains("table") ? gj["table"].get<std::string>() : defaultTableName(g.id);
        g.mode = gj["mode"] == "cyclic"    ? LogMode::Cyclic
                 : gj["mode"] == "trigger" ? LogMode::Trigger
                                           : LogMode::OnChange;
        g.periodMs = gj.value("periodMs", int64_t{0});
        g.expectedRowsPerDay = gj.value("expectedRowsPerDay", int64_t{0});
        if (gj.contains("trigger")) {
            const json& tj = gj["trigger"];
            TriggerModel t;
            t.tagId = tj["tagId"].get<std::string>();
            const auto idx = store.indexOf(t.tagId);
            if (!idx) throw std::invalid_argument("logging trigger tag not in the tag store: " + t.tagId);
            t.tagIndex = *idx;
            t.type = store.def(*idx).type;
            const std::string e = tj["edge"].get<std::string>();
            t.edge = e == "falling" ? TriggerEdge::Falling
                     : e == "both"  ? TriggerEdge::Both
                     : e == "active" ? TriggerEdge::Active
                                     : TriggerEdge::Rising;
            t.threshold = tj.value("threshold", 0.0);
            g.trigger = std::move(t);
        }
        if (gj.contains("aggregates")) {
            AggregatesModel a;
            a.minuteRetentionDays = gj["aggregates"].value("minuteRetentionDays", 31);
            a.hourRetentionDays = gj["aggregates"].value("hourRetentionDays", 730);
            g.aggregates = a;
        }
        g.minIntervalMs = gj.value("minIntervalMs", int64_t{1000});
        g.maxIntervalMs = gj.value("maxIntervalMs", int64_t{0});
        g.retentionDays = gj["retentionDays"].get<int>();
        if (gj.contains("destinations"))
            for (const json& d : gj["destinations"]) g.destinations.push_back(d.get<std::string>());
        for (const json& tj : gj["tags"]) {
            LoggedColumn c;
            c.tagId = tj["tagId"].get<std::string>();
            const auto idx = store.indexOf(c.tagId);
            if (!idx) throw std::invalid_argument("logging tag not in the tag store: " + c.tagId);
            c.tagIndex = *idx;
            c.type = store.def(*idx).type;
            c.column = tj.contains("column") ? tj["column"].get<std::string>()
                                             : defaultColumnName(c.tagId);
            c.deadband = tj.value("deadband", 0.0);
            c.maxLength = tj.value("maxLength", 255);
            c.aggregate = tj.value("aggregate", true);
            g.columns.push_back(std::move(c));
        }
        m.groups.push_back(std::move(g));
    }

    if (logging.contains("connections"))
        for (const json& cj : logging["connections"]) {
            ConnectionModel c;
            c.id = cj["id"].get<std::string>();
            c.type = parseDbType(cj["type"].get<std::string>());
            c.host = cj.value("host", "");
            c.database = cj.value("database", "");
            c.user = cj.value("user", "");
            c.url = cj.value("url", "");
            c.org = cj.value("org", "");
            c.bucket = cj.value("bucket", "");
            switch (c.type) {
                case DbType::MySql:
                    c.port = cj.value("port", 3306);
                    break;
                case DbType::MsSql:
                    c.port = cj.value("port", 1433);
                    c.schema = cj.value("schema", "dbo");
                    break;
                case DbType::PostgreSql:
                    c.port = cj.value("port", 5432);
                    c.schema = cj.value("schema", "public");
                    break;
                case DbType::InfluxDb:
                    break;
            }
            if (c.type == DbType::InfluxDb) {
                const bool https = c.url.rfind("https://", 0) == 0;
                c.tls = cj.contains("tls") ? parseTls(cj["tls"].get<std::string>())
                                           : (https ? TlsMode::VerifyFull : TlsMode::Disable);
                c.offsetMin = 0;  // InfluxDB stores instants (UTC)
            } else {
                // Without "tls" the server is checked (Constitution V: secure by default); a
                // self-signed server needs an explicit "prefer"/"require" (W_LOG_TLS_UNVERIFIED).
                c.tls = cj.contains("tls") ? parseTls(cj["tls"].get<std::string>())
                                           : TlsMode::VerifyFull;
                c.offsetMin = offsetOr(cj, "timeZone", m.offsetMin);
            }
            m.connections.push_back(std::move(c));
        }
    return m;
}

}  // namespace mat
