#include "server/cli/check_data.hpp"

#include <sqlite3.h>
#include <sys/stat.h>

#include <algorithm>
#include <chrono>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <optional>
#include <ostream>
#include <string>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/package/project_digest.hpp"
#include "core/project-store/store.hpp"
#include "core/tag-engine/pulse_journal.hpp"
#include "core/tag-engine/retain_store.hpp"
#include "nlohmann/json.hpp"
#include "server/cli/readonly_retain_io.hpp"

namespace mat {

namespace {

using nlohmann::json;
namespace fs = std::filesystem;

constexpr const char* kLogicStateFile = "logic-state.json";
constexpr size_t kLogicStateMaxBytes = 4 * 1024 * 1024;
constexpr int64_t kWalHeaderBytes = 32;  // a -wal of only its header holds no frame

int64_t steadyMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

std::optional<int64_t> fileSize(const std::string& p) {
    struct stat st {};
    if (::stat(p.c_str(), &st) != 0) return std::nullopt;
    return static_cast<int64_t>(st.st_size);
}

bool isDir(const std::string& p) {
    struct stat st {};
    return ::stat(p.c_str(), &st) == 0 && S_ISDIR(st.st_mode);
}

// file: URI of a path (RFC 3986 percent-encoding of what SQLite's URI parser treats specially).
std::string fileUri(const std::string& path, const char* query) {
    std::string u = "file:";
    static const char* hex = "0123456789ABCDEF";
    for (unsigned char c : path) {
        if (c == '%' || c == '?' || c == '#' || c <= 0x20 || c >= 0x7f) {
            u += '%';
            u += hex[c >> 4];
            u += hex[c & 15];
        } else {
            u += static_cast<char>(c);
        }
    }
    return u + "?" + query;
}

struct Deadline {
    int64_t at;
};

int onProgress(void* p) { return steadyMs() > static_cast<Deadline*>(p)->at ? 1 : 0; }

// The header of a database in rollback journal mode (file format bytes 18 and 19 are 1; 2 is WAL).
bool rollbackJournalMode(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    char h[100] = {};
    if (!f.read(h, sizeof h)) return false;
    return std::memcmp(h, "SQLite format 3", 16) == 0 && h[18] == 1 && h[19] == 1;
}

// One PRAGMA quick_check(8) over `uri`.
struct QuickCheck {
    bool opened = false;
    int rc = SQLITE_OK;
    int ext = 0;
    std::string err;
    std::vector<std::string> lines;
};

QuickCheck quickCheck(const std::string& uri, Deadline& deadline) {
    QuickCheck q;
    sqlite3* db = nullptr;
    q.rc = sqlite3_open_v2(uri.c_str(), &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_URI, nullptr);
    if (q.rc != SQLITE_OK) {
        q.err = db ? sqlite3_errmsg(db) : "?";
        q.ext = db ? sqlite3_extended_errcode(db) : q.rc;
        sqlite3_close(db);
        return q;
    }
    q.opened = true;
    sqlite3_busy_timeout(db, 2000);
    sqlite3_progress_handler(db, 1000, onProgress, &deadline);
    sqlite3_stmt* st = nullptr;
    q.rc = sqlite3_prepare_v2(db, "PRAGMA quick_check(8)", -1, &st, nullptr);
    if (q.rc == SQLITE_OK) {
        while ((q.rc = sqlite3_step(st)) == SQLITE_ROW) {
            const unsigned char* t = sqlite3_column_text(st, 0);
            q.lines.push_back(t ? reinterpret_cast<const char*>(t) : "");
        }
    }
    q.err = sqlite3_errmsg(db);
    q.ext = sqlite3_extended_errcode(db);
    sqlite3_finalize(st);
    sqlite3_close(db);
    return q;
}

CheckItem checkDatabase(const std::string& dir, const std::string& name, Deadline& deadline) {
    CheckItem item{name, "ok", ""};
    const std::string path = dir + "/" + name;
    if (!fileSize(path)) {
        item.status = "missing";
        item.detail = "chưa có tệp";
        return item;
    }
    const auto walBytes = fileSize(path + "-wal");
    const bool shm = fileSize(path + "-shm").has_value();
    // Without a -shm SQLite would make one (and a -wal) to read a WAL database: open it immutable
    // instead (the main file only). With one, read only with the usual locks (a runtime may run).
    // T062: a rollback journal database has no -shm either, and immutable takes no lock: a writer
    // in the middle of a transaction showed a half-written file, reported damaged. It is read
    // with the usual locks too (no file is made in that mode): a locked file is a warning.
    const bool locks = shm || rollbackJournalMode(path);
    const QuickCheck q = quickCheck(fileUri(path, locks ? "mode=ro" : "immutable=1"), deadline);
    if (!q.opened) {
        item.status = "damaged";
        item.detail = std::string("không mở được: ") + q.err;
        return item;
    }
    if (q.rc == SQLITE_INTERRUPT) {
        item.status = "warning";
        item.detail = "chưa kiểm hết: hết thời gian cho phép (--budget-s)";
        return item;
    }
    if (q.rc == SQLITE_BUSY || q.rc == SQLITE_LOCKED) {
        item.status = "warning";
        item.detail = "chưa kiểm được: tệp đang bị khóa (" + q.err + ")";
        return item;
    }
    if (q.ext == SQLITE_READONLY_ROLLBACK) {  // a hot journal: rolled back at the next open
        item.status = "warning";
        item.detail = "chưa kiểm được: journal dở cần phục hồi khi runtime mở lại (" + q.err + ")";
        return item;
    }
    if (q.rc != SQLITE_DONE) {
        item.status = "damaged";
        item.detail = "quick_check lỗi: " + q.err + " (" + std::to_string(q.ext) + ")";
        return item;
    }
    if (q.lines.size() != 1 || q.lines[0] != "ok") {
        item.status = "damaged";
        std::string d;
        for (const std::string& l : q.lines) d += (d.empty() ? "" : "; ") + l;
        item.detail = "quick_check: " + d.substr(0, 512);
        return item;
    }
    item.detail = "quick_check ok";
    if (walBytes && *walBytes > kWalHeaderBytes) {
        item.status = "warning";
        item.detail = "quick_check ok; wal " + std::to_string(*walBytes) +
                      " byte chưa checkpoint (lần mở sau sẽ phục hồi" +
                      (shm ? "" : ", nội dung wal chưa kiểm") + ")";
    }
    return item;
}

CheckItem checkProject(const std::string& storeDir) {
    CheckItem item{"project", "ok", ""};
    const std::string statePath = storeDir + "/" + kStoreStateFile;
    if (!fileSize(statePath)) {
        item.status = "missing";
        item.detail = "kho project chưa có state.json";
        return item;
    }
    const auto text = readTextFile(statePath, kStoreJsonMaxBytes);
    std::string why;
    const auto state = text ? parseStoreState(*text, why) : std::nullopt;
    if (!state) {
        item.status = "damaged";
        item.detail = "state.json hỏng: " + (text ? why : std::string("không đọc được"));
        return item;
    }
    if (!state->active) {
        item.detail = "không có project đang chạy";
    } else {
        const ProjectVersion* v = state->find(*state->active);
        const std::string dir =
            storeDir + "/v/" + std::to_string(*state->active) + "/" + kStoreProjectDir;
        if (!v || !isDir(dir)) {
            item.status = "damaged";
            item.detail = "thiếu thư mục của bản đang chạy: v/" + std::to_string(*state->active);
            return item;
        }
        std::vector<std::string> files;
        std::error_code ec;
        for (auto it = fs::recursive_directory_iterator(dir, ec);
             !ec && it != fs::recursive_directory_iterator(); it.increment(ec)) {
            if (it->is_symlink(ec) || !it->is_regular_file(ec)) {
                if (!it->is_directory(ec)) {
                    item.status = "damaged";
                    item.detail = "tệp lạ trong project: " +
                                  fs::relative(it->path(), dir, ec).generic_string();
                    return item;
                }
                continue;
            }
            files.push_back(fs::relative(it->path(), dir, ec).generic_string());
        }
        if (ec) {
            item.status = "damaged";
            item.detail = "không đọc được thư mục project: " + ec.message();
            return item;
        }
        std::sort(files.begin(), files.end());
        std::string err;
        const auto digest = projectDirDigest(dir, files, &err);
        if (!digest || *digest != v->digest) {
            item.status = "damaged";
            item.detail = digest ? "digest khác state.json: " + *digest + " ≠ " + v->digest
                                 : "không băm được: " + err;
            return item;
        }
        item.detail = "v/" + std::to_string(v->seq) + " " + v->projectId + " " + v->projectVersion +
                      ", digest khớp";
    }
    if (state->pending) {
        item.status = "warning";
        item.detail += "; có thao tác dở (" + std::string(pendingPhaseName(state->pending->phase)) +
                       "): runtime xử lý khi khởi động";
    }
    return item;
}

CheckItem checkRetain(const std::string& dir) {
    CheckItem item{"retain", "ok", ""};
    if (!isDir(dir)) {
        item.status = "missing";
        item.detail = "chưa có thư mục retain";
        return item;
    }
    ReadOnlyRetainIo io(dir);
    RetainStore store(io, 0);
    const RetainStatus s = store.open();
    const RetainDiag d = store.diag();
    switch (s) {
        case RetainStatus::Ok:
            item.detail = d.file + ", thế hệ " + std::to_string(d.generation) + ", " +
                          std::to_string(d.entries) + " giá trị";
            break;
        case RetainStatus::Fresh:
            item.status = "missing";
            item.detail = "chưa lưu giá trị nào";
            break;
        case RetainStatus::Fallback:
            item.status = "warning";
            item.detail = "dùng tệp cũ hơn " + d.file + " (tệp mới hơn hỏng)";
            break;
        case RetainStatus::Lost:
            item.status = "damaged";
            item.detail = "cả hai tệp hỏng" + (d.lastError.empty() ? "" : ": " + d.lastError);
            break;
    }
    return item;
}

CheckItem checkPulseJournal(const std::string& path) {
    CheckItem item{"pulse.journal", "ok", ""};
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        item.status = "missing";
        item.detail = "chưa có tệp";
        return item;
    }
    const PulseJournal::Parsed p = PulseJournal::parse(in);
    if (p.armed.empty()) {
        item.detail = std::to_string(p.lines) + " dòng, không có xung chờ nhả";
    } else {
        item.status = "warning";
        std::string tags;
        for (size_t i = 0; i < p.armed.size() && i < 5; ++i)
            tags += (i ? ", " : "") + p.armed[i].tag;
        if (p.armed.size() > 5) tags += ", …";
        item.detail = std::to_string(p.armed.size()) +
                      " xung chờ nhả (runtime nhả khi kênh nối lại): " + tags;
    }
    if (p.bad > 0) item.detail += "; " + std::to_string(p.bad) + " dòng không đọc được (bỏ qua)";
    return item;
}

CheckItem checkLogicState(const std::string& path) {
    CheckItem item{"logic-state", "ok", ""};
    if (!fileSize(path)) {
        item.status = "missing";
        item.detail = "chưa có tệp";
        return item;
    }
    const auto text = readTextFile(path, kLogicStateMaxBytes);
    const json j = text ? json::parse(*text, nullptr, false) : json();
    if (!text || j.is_discarded() || !j.is_object()) {
        item.status = "damaged";
        item.detail = text ? "không phải JSON hợp lệ" : "không đọc được";
        return item;
    }
    item.detail = "JSON hợp lệ";
    return item;
}

const char* statusText(const std::string& s) {
    if (s == "ok") return "ổn";
    if (s == "warning") return "cảnh báo";
    if (s == "damaged") return "hỏng";
    return "không có";
}

const char* resultName(int code) { return code == 0 ? "ok" : code == 1 ? "warning" : "damaged"; }

}  // namespace

CheckDataResult checkData(const CheckDataOptions& o) {
    const int64_t t0 = steadyMs();
    Deadline deadline{t0 + o.budgetMs};
    CheckDataResult r;
    for (const char* db : {"history.db", kAuditFileName, "alarm.db"})
        r.checks.push_back(checkDatabase(o.dataDir, db, deadline));
    r.checks.push_back(
        checkProject(o.projectStoreDir.empty() ? o.dataDir + "/projects" : o.projectStoreDir));
    r.checks.push_back(checkRetain(o.retainDir.empty() ? o.dataDir + "/retain" : o.retainDir));
    r.checks.push_back(checkPulseJournal(o.dataDir + "/pulse.journal"));
    r.checks.push_back(checkLogicState(o.dataDir + "/" + kLogicStateFile));
    for (const CheckItem& c : r.checks) {
        if (c.status == "damaged") r.exitCode = 2;
        if (c.status == "warning" && r.exitCode == 0) r.exitCode = 1;
    }
    r.durationMs = steadyMs() - t0;
    return r;
}

std::string checkDataJson(const CheckDataResult& r) {
    json checks = json::array();
    for (const CheckItem& c : r.checks)
        checks.push_back({{"name", c.name}, {"status", c.status}, {"detail", c.detail}});
    return json{{"schema", "mat-check-data/1"},
                {"result", resultName(r.exitCode)},
                {"exitCode", r.exitCode},
                {"durationMs", r.durationMs},
                {"checks", checks}}
        .dump(-1, ' ', false, json::error_handler_t::replace);
}

bool isCheckDataCommand(int argc, char** argv) {
    for (int i = 1; i < argc; ++i)
        if (std::strcmp(argv[i], "--check-data") == 0) return true;
    return false;
}

int runCheckDataCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
                    std::ostream& err) {
    std::vector<std::string> overrides;  // --config, --data-dir
    bool asJson = false;
    int64_t budgetS = 25;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--check-data") continue;
        if (a == "--json") {
            asJson = true;
        } else if (a == "--config" || a == "--data-dir" || a == "--budget-s") {
            if (i + 1 >= argc || *argv[i + 1] == '\0') {
                err << a << " cần một giá trị\n";
                return 3;
            }
            const std::string v = argv[++i];
            if (a == "--budget-s") {
                char* end = nullptr;
                const long n = std::strtol(v.c_str(), &end, 10);
                if (*end != '\0' || n < 1 || n > 300) {
                    err << "--budget-s: số giây từ 1 đến 300\n";
                    return 3;
                }
                budgetS = n;
            } else {
                overrides.push_back(a);
                overrides.push_back(v);
            }
        } else {
            err << "tham số không hỗ trợ: " << a << "\n";
            return 3;
        }
    }
    RuntimeConfig cfg;
    std::string error;
    if (!loadDeviceCliConfig(overrides, env, cfg, error)) {
        err << "cấu hình: " << error << "\n";
        return 3;
    }
    CheckDataOptions o;
    o.dataDir = cfg.dataDir;
    o.projectStoreDir = cfg.projectStoreDir;
    o.retainDir = cfg.retainDir;
    o.budgetMs = budgetS * 1000;
    const CheckDataResult r = checkData(o);
    if (asJson) {
        out << checkDataJson(r) << "\n";
    } else {
        out << "Kiểm dữ liệu " << o.dataDir << " (" << r.durationMs << " ms):\n";
        for (const CheckItem& c : r.checks)
            out << "  " << c.name << ": " << statusText(c.status) << " — " << c.detail << "\n";
        out << "Kết quả: "
            << (r.exitCode == 0 ? "nguyên vẹn"
                                : r.exitCode == 1 ? "có cảnh báo phục hồi được" : "có dữ liệu hỏng")
            << " (mã " << r.exitCode << ")\n";
    }
    return r.exitCode;
}

}  // namespace mat
