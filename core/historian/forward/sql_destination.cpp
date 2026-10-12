#include "core/historian/forward/sql_destination.hpp"

#include <cctype>
#include <cerrno>
#include <cstdlib>
#include <set>

namespace mat {

namespace {

std::string lower(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

DestError missingTable(const std::string& name) {
    DestError e;
    e.cls = ErrorClass::SchemaMismatch;
    e.detail = "table " + name + " does not exist and could not be created";
    return e;
}

}  // namespace

bool SqlDestination::syncSchema(const std::string&, const std::vector<DestTable>& tables,
                                DestError& err) {
    const SqlGen g = gen();
    DestError ddl;  // first DDL refused: reported only when the table turns out to be unusable
    // A statement the account may not run is fine (tables prepared by the administrator); a
    // connection that is gone or timed out stops everything at once (review I7).
    auto tryDdl = [&](const std::string& sql) {
        DestError e;
        if (exec(sql, e)) return true;
        if (!isStatementError(e.cls)) {
            err = e;
            return false;
        }
        if (ddl.cls == ErrorClass::None) ddl = e;
        return true;
    };
    if (!stateReady_) {
        for (const auto& s : g.createStateTable(c_.schema))
            if (!tryDdl(s)) return false;
        std::vector<std::string> have;
        if (!query(g.listStateColumns(c_.schema), have, err)) return false;
        if (have.empty()) {
            err = ddl.cls != ErrorClass::None ? ddl : missingTable("mat_forward_state");
            return false;
        }
        stateReady_ = true;
    }
    for (const auto& t : tables) {
        const SqlTable st = sqlTable(t);
        for (const auto& s : g.createTable(st))
            if (!tryDdl(s)) return false;
        std::vector<std::string> cols;
        if (!query(g.listColumns(st), cols, err)) return false;
        if (cols.empty()) {
            err = ddl.cls != ErrorClass::None ? ddl : missingTable(t.name);
            return false;
        }
        // The time index only speeds up queries: a missing one is never an error.
        const std::string ixQuery = g.indexQuery(st);
        if (!ixQuery.empty()) {
            std::vector<std::string> ix;
            DestError e;
            if (!query(ixQuery, ix, e)) {
                if (!isStatementError(e.cls)) {
                    err = e;
                    return false;
                }
            } else if (ix.empty() && !tryDdl(g.createIndex(st))) {
                return false;
            }
        }
        std::set<std::string> existing;
        for (const auto& c : cols) existing.insert(lower(c));
        for (const auto& c : t.columns) {  // a Tag added to the group: new column, NULL in old rows
            if (existing.count(lower(g.storedName(c.name)))) continue;
            if (!exec(g.addColumn(st, c), err)) return false;
        }
    }
    return true;
}

bool SqlDestination::readCursor(const std::string& sourceId, const std::string& table,
                                int64_t& lastSeq, DestError& err) {
    std::vector<std::string> v;
    if (!query(gen().readCursor(c_.schema, sourceId, table), v, err)) return false;
    lastSeq = 0;
    if (v.empty()) return true;
    char* end = nullptr;
    errno = 0;
    const long long n = std::strtoll(v[0].c_str(), &end, 10);
    if (v[0].empty() || !end || *end != '\0' || errno == ERANGE || n < 0) {
        err.cls = ErrorClass::SchemaMismatch;
        err.detail = "mat_forward_state.last_seq is not a number";
        return false;
    }
    lastSeq = n;
    return true;
}

}  // namespace mat
