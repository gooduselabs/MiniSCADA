// Shared by historian_it and historian_tool (x64 dev builds only): reading back what an external
// database holds, to compare it with history.db (specs/003-data-logging T052, T056).
#pragma once
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "core/historian/forward/sql_destination.hpp"
#include "nlohmann/json.hpp"

namespace mat::it {

std::string schemaOf(DbType t);  // dbo / public / "" (MySQL)
// 'N' for NULL, else 'V' + the value as text.
std::string valueExpr(DbType t, const SqlGen& g, const SqlColumn& c);
// Local time with milliseconds: YYYY-MM-DD HH:MM:SS.mmm (MySQL gives 6 fraction digits: compare
// the first 23 characters).
std::string timeExpr(DbType t, const SqlGen& g);
// 'N' / 'V' + text of a stored cell (integers, strings; doubles in shortest form).
std::string expectedText(const Cell& c);
// got ('N' / 'V…') against a stored cell; FLOAT32 compared as float, FLOAT64 exactly.
bool sameValue(const std::string& got, const Cell& want, TagType type);

// InfluxDB 2.x: Flux query → CSV (Accept: application/csv); "" + err on failure.
std::string fluxCsv(const std::string& url, const std::string& token, const std::string& org,
                    const std::string& flux, std::string& err);
std::vector<std::vector<std::string>> parseCsv(const std::string& text);
// One InfluxDB 2.x API call (GET without body, else POST with a JSON body): the reply text and
// the HTTP status; "" + err when the request itself failed.
std::string influxRequest(const std::string& url, const std::string& token, const std::string& path,
                          const std::string* jsonBody, long& status, std::string& err);
// Bucket `bucket` of `org` keeping data `everySeconds` (created when missing).
bool ensureBucket(const std::string& url, const std::string& token, const std::string& org,
                  const std::string& bucket, int everySeconds, std::string& err);
std::string rfc3339(int64_t utcMs);  // as InfluxDB prints _time
// (time, value) of one field of one measurement and source, in time order, from startMs on.
std::vector<std::pair<std::string, std::string>> influxField(
    const std::string& url, const std::string& token, const std::string& org,
    const std::string& bucket, const std::string& measurement, const std::string& source,
    const std::string& field, std::string& err, int64_t startMs = 946684800000);

// Connection description for historian_tool: {"id","type","host","port","database","schema",
// "user","url","org","bucket","tls","timeZone"} (no secret: MAT_IT_SECRET).
ConnectionModel connectionFromJson(const nlohmann::json& j);

}  // namespace mat::it
