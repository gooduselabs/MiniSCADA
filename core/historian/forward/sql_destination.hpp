// Shared part of the SQL destinations (MySQL/MariaDB, SQL Server, PostgreSQL): schema sync and
// cursor read on top of two primitives of each client (specs/003-data-logging
// contracts/external-schema.md "Đồng bộ lược đồ").
#pragma once
#include <string>
#include <vector>

#include "core/historian/forward/destination.hpp"

namespace mat {

// What one statement may take (security review of the fixes): a hostile server, or a man in the
// middle of a connection that is not verify-full, must neither fill the memory of the device nor
// hold the sending thread forever. MySQL and FreeTDS bound the time themselves (30 s).
struct SqlLimits {
    int64_t queryTimeoutMs = 35000;  // PostgreSQL: the client's own deadline per statement
    size_t maxResultRows = 100000;
    size_t maxResultBytes = 16u << 20;
};

class SqlDestination : public Destination {
   public:
    bool transactional() const override { return true; }
    size_t batchRows(const DestTable& t) const override { return SqlGen::batchRowsFor(t.columns); }
    // Creates what is missing; a DDL statement the account may not run is not an error as long as
    // the tables already have every column (tables prepared by the database administrator).
    bool syncSchema(const std::string& sourceId, const std::vector<DestTable>& tables,
                    DestError& err) override;
    bool readCursor(const std::string& sourceId, const std::string& table, int64_t& lastSeq,
                    DestError& err) override;

    // Plain session on the same client code (integration tests, tools), after connect():
    // one statement (or batch) without result rows …
    virtual bool exec(const std::string& sql, DestError& err) = 0;
    // … or the first column of every result row as text (NULL → "").
    virtual bool query(const std::string& sql, std::vector<std::string>& column,
                       DestError& err) = 0;
    virtual SqlGen gen() const = 0;
    DestCounters counters() const override { return counters_; }

   protected:
    explicit SqlDestination(ConnectionModel c, SqlLimits limits = {})
        : c_(std::move(c)), limits_(limits) {}
    SqlTable sqlTable(const DestTable& t) const { return SqlTable{c_.schema, t.name, t.columns}; }
    // Each connect(): the cursor table is checked once per session, not once per group.
    void newSession() { stateReady_ = false; }

    ConnectionModel c_;
    SqlLimits limits_;
    DestCounters counters_;

   private:
    bool stateReady_ = false;
};

std::unique_ptr<SqlDestination> makeMysqlDestination(const ConnectionModel& c,
                                                     const std::string& libDir,
                                                     const SqlLimits& limits = {});
std::unique_ptr<SqlDestination> makeMssqlDestination(const ConnectionModel& c,
                                                     const std::string& libDir,
                                                     const SqlLimits& limits = {});
std::unique_ptr<SqlDestination> makePgDestination(const ConnectionModel& c,
                                                  const std::string& libDir,
                                                  const SqlLimits& limits = {});
// MySQL, SQL Server or PostgreSQL by connection type; nullptr for InfluxDB.
std::unique_ptr<SqlDestination> makeSqlDestination(const ConnectionModel& c,
                                                   const std::string& libDir,
                                                   const SqlLimits& limits = {});

}  // namespace mat
