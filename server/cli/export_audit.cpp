#include "server/cli/export_audit.hpp"

#include <pwd.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cstring>
#include <exception>
#include <optional>
#include <string>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/audit/audit_record_json.hpp"
#include "core/common/json_text.hpp"
#include "core/historian/clock.hpp"
#include "nlohmann/json.hpp"
#include "server/cli/csv.hpp"

namespace mat {

namespace {

using nlohmann::json;

struct Args {
    std::string from, to, tz = "+07:00", format = "csv";
    bool haveFrom = false, haveTo = false;
    std::vector<std::string> overrides;  // --config, --data-dir for loadDeviceCliConfig
};

// false, with the message in `err`, for a bad argument.
bool parseArgs(int argc, char** argv, Args& a, std::ostream& err) {
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--export-audit") continue;
        const bool known = arg == "--from" || arg == "--to" || arg == "--tz" || arg == "--format" ||
                           arg == "--data-dir" || arg == "--config";
        if (!known) {
            err << "tham số không hỗ trợ: " << arg << "\n";
            return false;
        }
        if (i + 1 >= argc) {
            err << arg << " cần một giá trị\n";
            return false;
        }
        const std::string value = argv[++i];
        if (arg == "--from") {
            a.from = value;
            a.haveFrom = true;
        } else if (arg == "--to") {
            a.to = value;
            a.haveTo = true;
        } else if (arg == "--tz") {
            a.tz = value;
        } else if (arg == "--format") {
            a.format = value;
        } else {
            a.overrides.push_back(arg);
            a.overrides.push_back(value);
        }
    }
    if (a.format != "csv" && a.format != "jsonl") {
        err << "--format phải là csv hoặc jsonl\n";
        return false;
    }
    return true;
}

std::string osUserName() {
    if (const passwd* pw = ::getpwuid(::geteuid())) return pw->pw_name;
    return "uid-" + std::to_string(::geteuid());
}

constexpr const char* kCsvHeader =
    "id,time,ts_ms,clock_ok,user,role,source,channel,action,target,result,code,detail,count";

std::string optText(const std::optional<std::string>& s, bool terminal) {
    if (!s) return "";
    return csvText(terminal ? forTerminal(*s) : *s);
}

std::string csvRow(const AuditRecord& r, int offsetMin, bool terminal) {
    const auto text = [terminal](const std::string& s) {
        return csvText(terminal ? forTerminal(s) : s);
    };
    std::string row = std::to_string(r.id) + "," + formatLocalTime(r.tsMs, offsetMin) + "," +
                      std::to_string(r.tsMs) + "," + (r.clockOk ? "1" : "0") + ",";
    row += optText(r.user, terminal) + "," + optText(r.role, terminal) + "," + text(r.source) +
           "," + text(r.channel) + "," + text(r.action) + "," + optText(r.target, terminal) + "," +
           text(r.result) + "," + optText(r.code, terminal) + "," + optText(r.detail, terminal) +
           "," + std::to_string(r.count);
    return row;
}

}  // namespace

bool isExportAuditCommand(int argc, char** argv) {
    for (int i = 1; i < argc; ++i)
        if (std::strcmp(argv[i], "--export-audit") == 0) return true;
    return false;
}

int runExportAuditCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
                      std::ostream& err, bool terminal) {
    Args a;
    if (!parseArgs(argc, argv, a, err)) return 2;
    const auto offset = parseUtcOffset(a.tz);
    if (!offset) {
        err << "--tz phải có dạng ±HH:MM (ví dụ +07:00)\n";
        return 2;
    }
    AuditQuery q;
    q.limit = kAuditQueryMaxLimit;
    if (a.haveFrom) {
        const auto v = parseLocalTime(a.from, *offset);
        if (!v) {
            err << "--from phải có dạng YYYY-MM-DD[ HH:MM[:SS]]\n";
            return 2;
        }
        q.fromMs = *v;
    }
    if (a.haveTo) {
        const auto v = parseLocalTime(a.to, *offset);
        if (!v) {
            err << "--to phải có dạng YYYY-MM-DD[ HH:MM[:SS]]\n";
            return 2;
        }
        q.toMs = *v;
    }
    if (q.fromMs && q.toMs && *q.fromMs >= *q.toMs) {
        err << "--from phải sớm hơn --to\n";
        return 2;
    }

    RuntimeConfig cfg;
    std::string error;
    if (!loadDeviceCliConfig(a.overrides, env, cfg, error)) {
        err << "config: " << error << "\n";
        return 2;
    }
    const AuditOptions options = deviceCliAuditOptions(cfg, env);
    const std::string path = options.dataDir + "/" + kAuditFileName;
    struct stat st {};
    if (::stat(path.c_str(), &st) != 0) {  // do not create an empty log just to export it
        err << "không có " << path << ": thiết bị chưa ghi audit hoặc sai --data-dir\n";
        return 4;
    }
    AuditLog log(options);
    std::string openError;
    if (!log.open(openError)) {
        err << "không mở được " << path << ": " << openError << "\n";
        return 4;
    }

    // The record first: no data leaves the device without it (Constitution V). It is part of the
    // export, as its last row.
    try {
        AuditEvent e(AuditAction::AuditExport, AuditResult::Ok, AuditChannel::Cli, "cli");
        e.user = osUserName();
        e.target = a.format;
        json detail = {{"format", a.format}};
        if (a.haveFrom) detail["from"] = a.from;
        if (a.haveTo) detail["to"] = a.to;
        if (a.tz != "+07:00") detail["tz"] = a.tz;
        e.detail = jsonText(detail);
        log.append(e);
    } catch (const std::exception& ex) {
        err << "không ghi được bản ghi audit.export: " << ex.what() << "; không xuất gì\n";
        return 5;
    }

    try {
        if (a.format == "csv") out << kCsvHeader << '\n';
        int64_t after = 0;
        for (;;) {
            const AuditPage page = log.queryAscending(q, after);
            for (const AuditRecord& r : page.records) {
                if (a.format == "csv")
                    out << csvRow(r, *offset, terminal) << '\n';
                else
                    out << jsonText(auditRecordJson(r)) << '\n';
                if (!out) break;  // output that failed: no use reading on
            }
            if (!out || !page.next) break;
            after = *page.next;
        }
    } catch (const std::exception& ex) {
        err << "lỗi đọc audit: " << ex.what() << "\n";
        return 4;
    }
    out.flush();
    if (!out) {  // a full disk or a closed output: the export is cut
        err << "không ghi được kết quả (đĩa đầy hoặc đầu ra đã đóng): bản xuất audit không đủ\n";
        return 5;
    }
    return 0;
}

}  // namespace mat
