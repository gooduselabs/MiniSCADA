// One external database of a connection (specs/003-data-logging research R8–R12). The forwarder
// drives it from its own thread; the client library is loaded on the first connect().
#pragma once
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "core/historian/forward/error_class.hpp"
#include "core/historian/forward/sql_dialect.hpp"
#include "core/historian/local_store.hpp"
#include "core/historian/logging_config.hpp"

namespace mat {

struct DestError {
    ErrorClass cls = ErrorClass::None;
    std::string dbCode;  // 1045, 28P01, 404 … (shown in system/info)
    std::string detail;  // raw client text: journal only, never in system/info
};

// What a destination could not take as it was, since start (shown in system/info).
struct DestCounters {
    uint64_t outOfRangeValues = 0;  // values the column cannot hold: NULL (numbers), cut (text)
    uint64_t rejectedRows = 0;      // rows the server dropped in a partial write (InfluxDB)
};

struct DestTable {
    std::string name;                // group table, same in every destination
    std::vector<SqlColumn> columns;  // Tag columns in group order
};

class Destination {
   public:
    virtual ~Destination() = default;
    // true: the cursor lives in the destination and moves in the same transaction as the rows
    // (SQL, exactly once). false: at least once, the cursor stays on the device (InfluxDB).
    virtual bool transactional() const = 0;
    // Rows per writeBatch() for this table (bounded in cells and in bytes).
    virtual size_t batchRows(const DestTable& table) const = 0;
    virtual bool connect(const std::string& secret, DestError& err) = 0;
    // Cursor table, data tables, indexes and missing columns; never drops or changes a column.
    virtual bool syncSchema(const std::string& sourceId, const std::vector<DestTable>& tables,
                            DestError& err) = 0;
    // Transactional only: last_seq of (sourceId, table); 0 when there is none.
    virtual bool readCursor(const std::string& sourceId, const std::string& table, int64_t& lastSeq,
                            DestError& err) = 0;
    // Rows in seq order and, when transactional, the cursor moved from prevSeq (what this forwarder
    // read or last wrote; 0 = none) to lastSeq in one transaction. No rows: only the cursor moves
    // (rows lost on the device before they could be sent, or the C1 rewind). A transactional
    // destination whose cursor is not prevSeq any more stores nothing and fails with a statement
    // error: a batch of an earlier session committed after its client gave up (or another writer
    // uses this instance id); the forwarder reads the cursor again (review of the fixes, I2).
    virtual bool writeBatch(const std::string& sourceId, const DestTable& table,
                            const std::vector<StoredRow>& rows, int64_t prevSeq, int64_t lastSeq,
                            DestError& err) = 0;
    virtual void close() = 0;
    virtual DestCounters counters() const { return {}; }
};

std::unique_ptr<Destination> makeInfluxDestination(const ConnectionModel& c,
                                                   const std::string& libDir);
// By connection type (the SQL ones: sql_destination.hpp).
std::unique_ptr<Destination> makeDestination(const ConnectionModel& c, const std::string& libDir);

}  // namespace mat
