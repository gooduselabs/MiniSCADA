#include "server/cli/verify_aggregates.hpp"

#include <cstdlib>
#include <string>
#include <vector>

#include "core/historian/clock.hpp"
#include "core/historian/query/agg_verify.hpp"
#include "nlohmann/json.hpp"
#include "server/config.hpp"

namespace mat {

namespace {

bool dataDirOf(bool haveConfig, const std::string& configPath, std::string& dataDir,
               std::ostream& err) {
    std::vector<std::string> args{"mat-runtime"};
    if (haveConfig) args.insert(args.end(), {"--config", configPath});
    std::vector<char*> cargv;
    for (auto& s : args) cargv.push_back(&s[0]);
    const auto cr = loadConfig(static_cast<int>(cargv.size()), cargv.data(),
                               [](const std::string& p) { return readTextFile(p); });
    if (!cr.ok) {
        err << "config: " << cr.error << "\n";
        return false;
    }
    dataDir = cr.cfg.dataDir;
    return true;
}

// UTC ms or a local time of the group (--tz).
std::optional<int64_t> timeOf(const std::string& s, int offsetMin) {
    if (s.empty()) return std::nullopt;
    char* end = nullptr;
    const long long v = std::strtoll(s.c_str(), &end, 10);
    if (end && *end == '\0' && s.size() >= 10 && s.find('-') == std::string::npos) return v;
    return parseLocalTime(s, offsetMin);
}

struct Common {
    std::string group, from, to, dataDir, configPath, tz = "+07:00";
    bool json = false, haveDataDir = false, haveConfig = false;
};

// 0 fine, 2 bad
int parse(int argc, char** argv, const std::string& command, Common& c, std::ostream& err) {
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        auto next = [&](std::string& dst) {
            if (i + 1 >= argc) return false;
            dst = argv[++i];
            return true;
        };
        bool ok = true;
        if (a == command) {
            if (command == "--verify-aggregates") ok = next(c.group);
        } else if (a == "--from") ok = next(c.from);
        else if (a == "--to") ok = next(c.to);
        else if (a == "--tz") ok = next(c.tz);
        else if (a == "--json") c.json = true;
        else if (a == "--data-dir") ok = c.haveDataDir = next(c.dataDir);
        else if (a == "--config") ok = c.haveConfig = next(c.configPath);
        else {
            err << "tham số không hỗ trợ: " << a << "\n";
            return 2;
        }
        if (!ok) {
            err << a << " cần một giá trị\n";
            return 2;
        }
    }
    if (!c.haveDataDir && !dataDirOf(c.haveConfig, c.configPath, c.dataDir, err)) return 2;
    return 0;
}

}  // namespace

int runVerifyAggregatesCli(int argc, char** argv, std::ostream& out, std::ostream& err) {
    Common c;
    if (parse(argc, argv, "--verify-aggregates", c, err) != 0) return 2;
    if (c.group.empty()) {
        err << "cần id nhóm: --verify-aggregates <groupId>\n";
        return 2;
    }
    const auto off = parseUtcOffset(c.tz);
    if (!off) {
        err << "--tz phải có dạng ±HH:MM\n";
        return 2;
    }
    const auto from = timeOf(c.from, *off);
    const auto to = timeOf(c.to, *off);
    if ((!c.from.empty() && !from) || (!c.to.empty() && !to)) {
        err << "--from/--to: epoch ms hoặc YYYY-MM-DD[ HH:MM[:SS]]\n";
        return 2;
    }
    VerifyResult r;
    std::string e;
    if (!verifyAggregates(c.dataDir + "/history.db", c.group, from, to, r, e)) {
        err << e << "\n";
        return 2;
    }
    if (c.json) {
        nlohmann::json j = {{"checked", r.checked}, {"tolerated", r.tolerated}, {"missing", r.missing},
                            {"extra", r.extra}, {"mismatch", r.mismatch}, {"note", r.note},
                            {"diffs", nlohmann::json::array()}};
        for (const auto& d : r.diffs)
            j["diffs"].push_back({{"column", d.column}, {"res", d.res}, {"bucket", d.bucket},
                                  {"kind", d.kind}, {"detail", d.detail}});
        out << j.dump() << "\n";
    } else {
        if (!r.note.empty()) out << r.note << "\n";
        for (const auto& d : r.diffs)
            out << d.kind << " " << d.column << " res=" << d.res << " bucket=" << d.bucket
                << (d.detail.empty() ? "" : " (" + d.detail + ")") << "\n";
        out << r.missing << " thiếu, " << r.extra << " thừa, " << r.mismatch << " lệch ("
            << r.checked << " bucket đã so, " << r.tolerated << " bỏ qua ở ranh giới lần chạy)\n";
    }
    return r.clean() ? 0 : 1;
}

int runHistoryStatsCli(int argc, char** argv, std::ostream& out, std::ostream& err) {
    Common c;
    if (parse(argc, argv, "--history-stats", c, err) != 0) return 2;
    nlohmann::json j;
    std::string e;
    if (!historyStats(c.dataDir + "/history.db", j, e)) {
        err << e << "\n";
        return 2;
    }
    if (c.json) {
        out << j.dump() << "\n";
        return 0;
    }
    out << "schema " << j["schema"] << ", " << j["fileBytes"] << " byte, " << j["runs"] << " lần chạy\n";
    for (const auto& t : j["tables"])
        out << t["group"].get<std::string>() << ": " << t["rows"] << " dòng\n";
    out << "mat_agg: phút " << j["aggregates"]["minute"] << ", giờ " << j["aggregates"]["hour"] << "\n";
    return 0;
}

}  // namespace mat
