#include "core/historian/forward/destination.hpp"

#include "core/historian/forward/sql_destination.hpp"

namespace mat {

std::unique_ptr<SqlDestination> makeSqlDestination(const ConnectionModel& c,
                                                   const std::string& libDir,
                                                   const SqlLimits& limits) {
    switch (c.type) {
        case DbType::MySql:
            return makeMysqlDestination(c, libDir, limits);
        case DbType::MsSql:
            return makeMssqlDestination(c, libDir, limits);
        case DbType::PostgreSql:
            return makePgDestination(c, libDir, limits);
        case DbType::InfluxDb:
            break;
    }
    return nullptr;
}

std::unique_ptr<Destination> makeDestination(const ConnectionModel& c, const std::string& libDir) {
    if (c.type == DbType::InfluxDb) return makeInfluxDestination(c, libDir);
    return makeSqlDestination(c, libDir);
}

}  // namespace mat
