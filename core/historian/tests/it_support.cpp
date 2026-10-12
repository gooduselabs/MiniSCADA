#include "core/historian/tests/it_support.hpp"

#include <algorithm>
#include <cstdlib>

#include "core/historian/clock.hpp"
#include "core/historian/forward/curl_api.hpp"

namespace mat::it {

std::string schemaOf(DbType t) {
    return t == DbType::MsSql ? "dbo" : t == DbType::PostgreSql ? "public" : "";
}

std::string valueExpr(DbType t, const SqlGen& g, const SqlColumn& c) {
    const std::string x = g.ident(c.name);
    if (t == DbType::MySql)
        return "CASE WHEN " + x + " IS NULL THEN 'N' ELSE CONCAT('V', " + x + ") END";
    if (t == DbType::MsSql) {
        const bool real = c.type == TagType::FLOAT32 || c.type == TagType::FLOAT64;
        const std::string text =
            c.type == TagType::STRING
                ? x
                : real ? "CONVERT(NVARCHAR(60), " + x + ", 3)" : "CAST(" + x + " AS NVARCHAR(60))";
        return "CASE WHEN " + x + " IS NULL THEN N'N' ELSE N'V' + " + text + " END";
    }
    const std::string text =
        c.type == TagType::BOOL ? "CASE WHEN " + x + " THEN '1' ELSE '0' END" : x + "::text";
    return "CASE WHEN " + x + " IS NULL THEN 'N' ELSE 'V' || " + text + " END";
}

std::string timeExpr(DbType t, const SqlGen& g) {
    const std::string x = g.ident("time");
    if (t == DbType::MySql) return "DATE_FORMAT(" + x + ", '%Y-%m-%d %H:%i:%s.%f')";
    if (t == DbType::MsSql) return "CONVERT(VARCHAR(23), " + x + ", 121)";
    return "to_char(" + x + ", 'YYYY-MM-DD HH24:MI:SS.MS')";
}

std::string expectedText(const Cell& c) {
    if (std::holds_alternative<std::monostate>(c)) return "N";
    if (const auto* s = std::get_if<std::string>(&c)) return "V" + *s;
    if (const auto* i = std::get_if<int64_t>(&c)) return "V" + std::to_string(*i);
    if (const auto* u = std::get_if<uint64_t>(&c)) return "V" + std::to_string(*u);
    if (const auto* b = std::get_if<bool>(&c)) return *b ? "V1" : "V0";
    return "V" + shortestDouble(std::get<double>(c));
}

bool sameValue(const std::string& got, const Cell& want, TagType type) {
    Cell w = want;
    if (type == TagType::BOOL) {  // stored as INTEGER 0/1
        if (const auto* i = std::get_if<int64_t>(&w)) w = int64_t{*i != 0};
        if (const auto* d = std::get_if<double>(&w)) w = int64_t{*d != 0.0};
    }
    const bool real = type == TagType::FLOAT32 || type == TagType::FLOAT64;
    if (!real || got.empty() || got[0] != 'V' || std::holds_alternative<std::monostate>(w))
        return got == expectedText(w);
    double v = 0;
    if (const auto* d = std::get_if<double>(&w))
        v = *d;
    else if (const auto* i = std::get_if<int64_t>(&w))
        v = static_cast<double>(*i);
    else
        return false;
    const double g = std::strtod(got.c_str() + 1, nullptr);
    return type == TagType::FLOAT32 ? static_cast<float>(g) == static_cast<float>(v) : g == v;
}

namespace {
size_t collectAll(char* p, size_t size, size_t n, void* user) {
    static_cast<std::string*>(user)->append(p, size * n);
    return size * n;
}
}  // namespace

std::string fluxCsv(const std::string& url, const std::string& token, const std::string& org,
                    const std::string& flux, std::string& err) {
    using namespace capi;
    const CurlApi* api = loadCurlApi("", err);
    if (!api) return "";
    void* h = api->easyInit();
    if (!h) {
        err = "curl_easy_init failed";
        return "";
    }
    std::string reply;
    char* o = api->easyEscape(h, org.c_str(), static_cast<int>(org.size()));
    const std::string full = url + "/api/v2/query?org=" + (o ? o : "");
    if (o) api->free(o);
    const std::string auth = "Authorization: Token " + token;
    CurlSlist* headers = api->slistAppend(nullptr, auth.c_str());
    headers = api->slistAppend(headers, "Content-Type: application/vnd.flux");
    headers = api->slistAppend(headers, "Accept: application/csv");
    api->easySetopt(h, kCurloptUrl, full.c_str());
    api->easySetopt(h, kCurloptHttpheader, headers);
    api->easySetopt(h, kCurloptPost, 1L);
    api->easySetopt(h, kCurloptPostfields, flux.c_str());
    api->easySetopt(h, kCurloptPostfieldsize, static_cast<long>(flux.size()));
    api->easySetopt(h, kCurloptWritefunction, &collectAll);
    api->easySetopt(h, kCurloptWritedata, &reply);
    api->easySetopt(h, kCurloptTimeoutMs, 60000L);
    const int rc = api->easyPerform(h);
    long status = 0;
    api->easyGetinfo(h, kCurlinfoResponseCode, &status);
    api->easyCleanup(h);
    api->slistFreeAll(headers);
    if (rc != kCurleOk || status != 200) {
        err = "flux query: curl " + std::to_string(rc) + ", HTTP " + std::to_string(status) + " " +
              reply.substr(0, 300);
        return "";
    }
    return reply;
}

std::string influxRequest(const std::string& url, const std::string& token, const std::string& path,
                          const std::string* jsonBody, long& status, std::string& err) {
    using namespace capi;
    status = 0;
    const CurlApi* api = loadCurlApi("", err);
    if (!api) return "";
    void* h = api->easyInit();
    if (!h) {
        err = "curl_easy_init failed";
        return "";
    }
    std::string reply;
    const std::string full = url + path;
    const std::string auth = "Authorization: Token " + token;
    CurlSlist* headers = api->slistAppend(nullptr, auth.c_str());
    headers = api->slistAppend(headers, "Content-Type: application/json");
    api->easySetopt(h, kCurloptUrl, full.c_str());
    api->easySetopt(h, kCurloptHttpheader, headers);
    if (jsonBody) {
        api->easySetopt(h, kCurloptPost, 1L);
        api->easySetopt(h, kCurloptPostfields, jsonBody->c_str());
        api->easySetopt(h, kCurloptPostfieldsize, static_cast<long>(jsonBody->size()));
    } else {
        api->easySetopt(h, kCurloptHttpget, 1L);
    }
    api->easySetopt(h, kCurloptWritefunction, &collectAll);
    api->easySetopt(h, kCurloptWritedata, &reply);
    api->easySetopt(h, kCurloptTimeoutMs, 30000L);
    const int rc = api->easyPerform(h);
    api->easyGetinfo(h, kCurlinfoResponseCode, &status);
    api->easyCleanup(h);
    api->slistFreeAll(headers);
    if (rc != kCurleOk) {
        err = "curl " + std::to_string(rc);
        return "";
    }
    return reply;
}

bool ensureBucket(const std::string& url, const std::string& token, const std::string& org,
                  const std::string& bucket, int everySeconds, std::string& err) {
    long status = 0;
    const auto found = nlohmann::json::parse(
        influxRequest(url, token, "/api/v2/buckets?name=" + bucket, nullptr, status, err), nullptr,
        false);
    if (status == 200 && found.is_object() && found.contains("buckets") &&
        !found["buckets"].empty())
        return true;
    const auto orgs = nlohmann::json::parse(
        influxRequest(url, token, "/api/v2/orgs?org=" + org, nullptr, status, err), nullptr, false);
    if (status != 200 || !orgs.is_object() || !orgs.contains("orgs") || orgs["orgs"].empty()) {
        err = "org " + org + ": HTTP " + std::to_string(status);
        return false;
    }
    const nlohmann::json req = {
        {"orgID", orgs["orgs"][0]["id"]},
        {"name", bucket},
        {"retentionRules",
         nlohmann::json::array({{{"type", "expire"}, {"everySeconds", everySeconds}}})}};
    const std::string body = req.dump();
    const std::string reply = influxRequest(url, token, "/api/v2/buckets", &body, status, err);
    if (status != 201) {
        err = "create bucket: HTTP " + std::to_string(status) + " " + reply.substr(0, 300);
        return false;
    }
    return true;
}

std::vector<std::vector<std::string>> parseCsv(const std::string& text) {
    std::vector<std::vector<std::string>> rows(1);
    std::string field;
    bool quoted = false;
    for (size_t i = 0; i < text.size(); ++i) {
        const char c = text[i];
        if (quoted) {
            if (c == '"' && i + 1 < text.size() && text[i + 1] == '"') {
                field += '"';
                ++i;
            } else if (c == '"') {
                quoted = false;
            } else {
                field += c;
            }
        } else if (c == '"') {
            quoted = true;
        } else if (c == ',') {
            rows.back().push_back(field);
            field.clear();
        } else if (c == '\n' || c == '\r') {
            if (c == '\r' && i + 1 < text.size() && text[i + 1] == '\n') ++i;
            rows.back().push_back(field);
            field.clear();
            rows.emplace_back();
        } else {
            field += c;
        }
    }
    if (!field.empty() || !rows.back().empty()) rows.back().push_back(field);
    return rows;
}

std::string rfc3339(int64_t utcMs) {
    std::string s = formatLocalTime(utcMs, 0, 'T');  // YYYY-MM-DDTHH:MM:SS.mmm
    while (s.back() == '0') s.pop_back();
    if (s.back() == '.') s.pop_back();
    return s + "Z";
}

std::vector<std::pair<std::string, std::string>> influxField(
    const std::string& url, const std::string& token, const std::string& org,
    const std::string& bucket, const std::string& measurement, const std::string& source,
    const std::string& field, std::string& err, int64_t startMs) {
    const std::string flux =
        "from(bucket: \"" + bucket + "\") |> range(start: " + rfc3339(startMs) +
        ", stop: 2100-01-01T00:00:00Z)"
        " |> filter(fn: (r) => r._measurement == \"" +
        measurement + "\" and r._field == \"" + field + "\" and r.source == \"" + source +
        "\") |> keep(columns: [\"_time\", \"_value\"])"
        " |> sort(columns: [\"_time\"])";
    const auto rows = parseCsv(fluxCsv(url, token, org, flux, err));
    std::vector<std::pair<std::string, std::string>> out;
    int t = -1, v = -1;
    for (const auto& r : rows) {
        if (r.size() < 2) continue;
        const auto ti = std::find(r.begin(), r.end(), "_time");
        if (ti != r.end()) {  // header, repeated per table
            t = static_cast<int>(ti - r.begin());
            v = static_cast<int>(std::find(r.begin(), r.end(), "_value") - r.begin());
            continue;
        }
        if (t >= 0 && v >= 0 && static_cast<size_t>(std::max(t, v)) < r.size())
            out.emplace_back(r[t], r[v]);
    }
    return out;
}

ConnectionModel connectionFromJson(const nlohmann::json& j) {
    ConnectionModel c;
    c.id = j.value("id", std::string("tool"));
    const std::string type = j.value("type", std::string("mysql"));
    c.type = type == "mssql"
                 ? DbType::MsSql
                 : type == "postgresql" ? DbType::PostgreSql
                                        : type == "influxdb" ? DbType::InfluxDb : DbType::MySql;
    c.host = j.value("host", std::string());
    c.port = j.value("port",
                     c.type == DbType::MsSql ? 1433 : c.type == DbType::PostgreSql ? 5432 : 3306);
    c.database = j.value("database", std::string("scada"));
    c.schema = j.value("schema", schemaOf(c.type));
    c.user = j.value("user", std::string());
    c.url = j.value("url", std::string());
    c.org = j.value("org", std::string());
    c.bucket = j.value("bucket", std::string());
    const std::string tls =
        j.value("tls", std::string(c.type == DbType::InfluxDb ? "disable" : "prefer"));
    c.tls = tls == "disable"
                ? TlsMode::Disable
                : tls == "require" ? TlsMode::Require
                                   : tls == "verify-full" ? TlsMode::VerifyFull : TlsMode::Prefer;
    const auto off = parseUtcOffset(j.value("timeZone", std::string("+07:00")));
    c.offsetMin = c.type == DbType::InfluxDb ? 0 : off.value_or(420);
    return c;
}

}  // namespace mat::it
