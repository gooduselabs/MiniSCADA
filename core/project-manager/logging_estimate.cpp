#include "core/project-manager/logging_estimate.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <regex>
#include <set>

#include "core/project-manager/rules_010.hpp"

namespace mat {

namespace {
constexpr double kDayMs = 86400000;
constexpr double kCommitsPerDay = kDayMs / 5000;  // default commit interval
constexpr double kPageBytes = 4096;
// Calibrated on x64 (historian_tool soak, ADR-034): pages a commit dirties (table leaf and its
// neighbour, the ts index, sqlite_sequence, ... with the WAL frame of each) and the write factor of
// the aggregate rows (page rewrite, checkpoint copy and the marks) over their stored size.
constexpr double kCommitPages = 6;
constexpr double kAggWriteFactor = 3.6;

std::string pointerToken(const std::string& key) {
    std::string out;
    for (char c : key) {
        if (c == '~')
            out += "~0";
        else if (c == '/')
            out += "~1";
        else
            out += c;
    }
    return out;
}
}  // namespace

double logCellBytes(const std::string& type, int maxLength) {
    if (type == "BOOL") return 2;
    if (type == "INT16" || type == "UINT16") return 3;
    if (type == "INT32" || type == "UINT32") return 5;
    if (type == "STRING") return 2 + std::min(maxLength, 64);
    return 9;
}

LoggingEstimate estimateLogging(const nlohmann::json& logging,
                                const std::map<std::string, std::string>& tagTypes,
                                bool extremeWarning) {
    LoggingEstimate e;
    // The sums are added in the order of the groups in the file, like the TypeScript twin.
    for (const auto& g : logging["groups"]) {
        double rowBytes = 24;
        for (const auto& t : g["tags"]) {
            const auto it = tagTypes.find(t["tagId"].get<std::string>());
            rowBytes += logCellBytes(it == tagTypes.end() ? std::string() : it->second,
                                     t.value("maxLength", 255));
        }
        const std::string mode = g["mode"].get<std::string>();
        const bool periodic =
            mode == "cyclic" ||
            (mode == "trigger" && g.contains("trigger") && g["trigger"].value("edge", "") == "active");
        const double upper =
            kDayMs / (periodic ? g.value("periodMs", kDayMs) : g.value("minIntervalMs", 1000.0));
        const bool hasExpected = !periodic && g.contains("expectedRowsPerDay");
        const double rowsPerDay =
            hasExpected ? std::min(g["expectedRowsPerDay"].get<double>(), upper) : upper;
        GroupEstimate ge;
        ge.basis = periodic ? "exact" : hasExpected ? "expected" : "upper";
        const double rawWrite =
            2 * rowsPerDay * rowBytes + std::min(kCommitsPerDay, rowsPerDay) * kCommitPages * kPageBytes;
        const double aggTags = static_cast<double>(aggregatedTagCount(g, tagTypes));
        const double perDayAgg = aggTags * (1440 + 24) * kAggRowBytes;
        const double aggWrite = kAggWriteFactor * perDayAgg;
        const double rawStorage = rowsPerDay * rowBytes * g["retentionDays"].get<double>();
        const double minuteDays = g.contains("aggregates")
                                      ? g["aggregates"].value("minuteRetentionDays",
                                                              kDefaultMinuteRetentionDays)
                                      : kDefaultMinuteRetentionDays;
        const double hourDays = g.contains("aggregates")
                                    ? g["aggregates"].value("hourRetentionDays",
                                                            kDefaultHourRetentionDays)
                                    : kDefaultHourRetentionDays;
        const double aggStorage = aggTags * (1440 * minuteDays + 24 * hourDays) * kAggRowBytes;
        e.rawWriteBytesPerDay += rawWrite;
        e.aggWriteBytesPerDay += aggWrite;
        e.writeBytesPerDay += rawWrite + aggWrite;
        e.storageBytes += rawStorage + aggStorage;
        e.dailyGrowthBytes += rowsPerDay * rowBytes + perDayAgg;
        ge.rowsPerDay = rowsPerDay;
        ge.rowBytes = rowBytes;
        ge.rawWrite = rawWrite;
        ge.aggWrite = aggWrite;
        ge.rawStorage = rawStorage;
        ge.aggStorage = aggStorage;
        ge.aggTags = aggTags;
        e.groups.push_back(std::move(ge));
    }
    if (e.writeBytesPerDay > kLogBudgetBytes) e.warnings.push_back("W_LOG_WRITE_BUDGET");
    if (extremeWarning && e.writeBytesPerDay > kLogExtremeBytes)
        e.warnings.push_back("W_LOG_WRITE_EXTREME");
    if (e.storageBytes > kLogBudgetBytes) e.warnings.push_back("W_LOG_SIZE_CAP");
    if (e.dailyGrowthBytes > 0) e.daysToFillCap = std::floor(kLogBudgetBytes / e.dailyGrowthBytes);
    return e;
}

std::optional<std::string> findUrlCredentials(const nlohmann::json& logging) {
    if (!logging.is_object() || !logging.contains("connections") ||
        !logging["connections"].is_array())
        return std::nullopt;
    const nlohmann::json& conns = logging["connections"];
    for (size_t i = 0; i < conns.size(); ++i) {
        const nlohmann::json& c = conns[i];
        if (!c.is_object() || !c.contains("url") || !c["url"].is_string()) continue;
        const std::string url = c["url"];
        const size_t scheme = url.find("://");
        const std::string rest = scheme == std::string::npos ? url : url.substr(scheme + 3);
        const std::string authority = rest.substr(0, rest.find_first_of("/?#"));
        if (authority.find('@') != std::string::npos)
            return "/connections/" + std::to_string(i) + "/url";
    }
    return std::nullopt;
}

std::vector<size_t> unverifiedConnections(const nlohmann::json& logging) {
    static const std::regex kLoopback(R"(^(localhost|127(\.[0-9]{1,3}){3}|\[::1\])(:[0-9]+)?$)",
                                      std::regex::icase);
    std::vector<size_t> out;
    if (!logging.contains("groups") || !logging.contains("connections")) return out;
    std::set<std::string> used;
    for (const auto& g : logging["groups"])
        if (g.contains("destinations"))
            for (const auto& d : g["destinations"]) used.insert(d.get<std::string>());
    const nlohmann::json& conns = logging["connections"];
    for (size_t i = 0; i < conns.size(); ++i) {
        const nlohmann::json& c = conns[i];
        if (!used.count(c.value("id", ""))) continue;
        const std::string tls = c.value("tls", "");
        if (c.value("type", "") != "influxdb") {
            if (!tls.empty() && tls != "verify-full") out.push_back(i);  // none: verify-full
            continue;
        }
        const std::string url = c.value("url", "");
        if (url.rfind("https://", 0) == 0) {
            if (tls == "require") out.push_back(i);
            continue;
        }
        const size_t scheme = url.find("://");
        const std::string rest = scheme == std::string::npos ? url : url.substr(scheme + 3);
        if (!std::regex_match(rest.substr(0, rest.find_first_of("/?#")), kLoopback))
            out.push_back(i);
    }
    return out;
}

std::optional<std::string> findSecretKey(const nlohmann::json& v, const std::string& path) {
    static const char* const kWords[] = {"password", "passwd", "pwd",    "secret",
                                         "token",    "apikey", "api_key"};
    if (v.is_array()) {
        for (size_t i = 0; i < v.size(); ++i)
            if (auto r = findSecretKey(v[i], path + "/" + std::to_string(i))) return r;
        return std::nullopt;
    }
    if (!v.is_object()) return std::nullopt;
    for (auto it = v.begin(); it != v.end(); ++it) {
        const std::string p = path + "/" + pointerToken(it.key());
        std::string lower = it.key();
        for (char& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (const char* w : kWords)
            if (lower.find(w) != std::string::npos) return p;
        if (auto r = findSecretKey(it.value(), p)) return r;
    }
    return std::nullopt;
}

}  // namespace mat
