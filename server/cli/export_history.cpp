#include "server/cli/export_history.hpp"

#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "core/common/utf8.hpp"
#include "core/historian/clock.hpp"
#include "core/historian/local_store.hpp"
#include "server/cli/csv.hpp"
#include "server/config.hpp"

namespace mat {

namespace {

constexpr int64_t kDayMs = 86400000;

// Shortest text that reads back to the same double (65.2, not 65.200000000000003).
std::string number(double d) {
    char buf[40];
    std::snprintf(buf, sizeof buf, "%.15g", d);
    if (std::strtod(buf, nullptr) != d) std::snprintf(buf, sizeof buf, "%.17g", d);
    return buf;
}

// dataDir of runtime.json, as the service sees it.
bool configDataDir(bool haveConfig, const std::string& configPath, std::string& dataDir,
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

std::string csvCell(const Cell& c, bool terminal) {
    if (const auto* i = std::get_if<int64_t>(&c)) return std::to_string(*i);
    if (const auto* u = std::get_if<uint64_t>(&c)) return std::to_string(*u);
    if (const auto* d = std::get_if<double>(&c)) return number(*d);
    if (const auto* b = std::get_if<bool>(&c)) return *b ? "1" : "0";
    if (const auto* s = std::get_if<std::string>(&c))
        return csvText(terminal ? forTerminal(*s) : *s);
    return "";
}

}  // namespace

int runExportHistoryCli(int argc, char** argv, std::ostream& out, std::ostream& err, int64_t nowUtc,
                        bool terminal) {
    std::string group, from, to, tz = "+07:00", dataDir, configPath;
    bool haveDataDir = false, haveConfig = false;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        auto next = [&](std::string& dst) {
            if (i + 1 >= argc) return false;
            dst = argv[++i];
            return true;
        };
        bool ok = true;
        if (a == "--export-history") {
            ok = next(group);
        } else if (a == "--from") {
            ok = next(from);
        } else if (a == "--to") {
            ok = next(to);
        } else if (a == "--tz") {
            ok = next(tz);
        } else if (a == "--data-dir") {
            ok = haveDataDir = next(dataDir);
        } else if (a == "--config") {
            ok = haveConfig = next(configPath);
        } else {
            err << "tham số không hỗ trợ: " << a << "\n";
            return 2;
        }
        if (!ok) {
            err << a << " cần một giá trị\n";
            return 2;
        }
    }
    if (group.empty()) {
        err << "cần id nhóm: --export-history <groupId>\n";
        return 2;
    }
    const auto off = parseUtcOffset(tz);
    if (!off) {
        err << "--tz phải có dạng ±HH:MM (ví dụ +07:00)\n";
        return 2;
    }
    int64_t fromUtc = nowUtc - kDayMs;
    int64_t toUtc = nowUtc + 1;
    if (!from.empty()) {
        const auto v = parseLocalTime(from, *off);
        if (!v) {
            err << "--from phải có dạng YYYY-MM-DD[ HH:MM[:SS]]\n";
            return 2;
        }
        fromUtc = *v;
    }
    if (!to.empty()) {
        const auto v = parseLocalTime(to, *off);
        if (!v) {
            err << "--to phải có dạng YYYY-MM-DD[ HH:MM[:SS]]\n";
            return 2;
        }
        toUtc = *v;
    }
    if (!haveDataDir && !configDataDir(haveConfig, configPath, dataDir, err)) return 2;

    HistoryReader reader;
    std::string e;
    if (!reader.open(dataDir + "/history.db", e)) {
        err << "không mở được " << dataDir << "/history.db: " << e << "\n";
        return 4;
    }
    const auto table = reader.tableOfGroup(group);
    if (!table) {
        err << "không có nhóm '" << group << "' trong dữ liệu lưu trữ\n";
        return 4;
    }
    const auto cols = reader.columns(*table);
    out << "time";
    for (const auto& c : cols) out << ',' << csvField(c);
    out << '\n';
    const bool ok = reader.readRange(
        *table, cols, fromUtc, toUtc,
        [&](const StoredRow& r) {
            out << formatLocalTime(r.ts, *off);
            for (const auto& c : r.cells) out << ',' << csvCell(c, terminal);
            out << '\n';
            return static_cast<bool>(out);  // output that failed: no use reading on
        },
        e);
    if (!ok) {
        err << "lỗi đọc dữ liệu: " << e << "\n";
        return 4;
    }
    out.flush();
    if (!out) {  // a full disk or a closed output: the CSV is cut (review of the fixes, minor 5)
        err << "không ghi được kết quả (đĩa đầy hoặc đầu ra đã đóng): file CSV không đủ\n";
        return 5;
    }
    return 0;
}

int runCheckHistoryCli(int argc, char** argv, std::ostream& out, std::ostream& err) {
    std::string dataDir, configPath;
    bool haveDataDir = false, haveConfig = false;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--check-history") continue;
        if (a != "--data-dir" && a != "--config") {
            err << "tham số không hỗ trợ: " << a << "\n";
            return 2;
        }
        if (i + 1 >= argc) {
            err << a << " cần một giá trị\n";
            return 2;
        }
        if (a == "--data-dir") {
            haveDataDir = true;
            dataDir = argv[++i];
        } else {
            haveConfig = true;
            configPath = argv[++i];
        }
    }
    if (!haveDataDir && !configDataDir(haveConfig, configPath, dataDir, err)) return 2;
    const std::string path = dataDir + "/history.db";
    HistoryReader reader;
    std::string e;
    if (!reader.open(path, e)) {
        err << "không mở được " << path << ": " << e << "\n";
        // a file that is there but cannot be read is damaged (or not a history.db)
        return ::access(path.c_str(), F_OK) == 0 ? 6 : 4;
    }
    out << "history.db: " << path << "\n";
    const auto problems = reader.integrityCheck(20);
    const bool ok = problems.size() == 1 && problems[0] == "ok";
    for (const auto& p : problems) out << "integrity: " << p << "\n";
    for (const auto& [table, rows] : reader.tableRows()) {
        if (rows < 0)
            out << table << ": unreadable\n";
        else
            out << table << ": " << rows << " rows\n";
    }
    return ok ? 0 : 6;
}

}  // namespace mat
