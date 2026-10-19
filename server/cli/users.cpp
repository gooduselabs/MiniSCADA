#include "server/cli/users.hpp"

#include <fcntl.h>
#include <grp.h>
#include <pwd.h>
#include <signal.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <termios.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <iterator>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "core/auth/access_model.hpp"
#include "core/auth/access_store.hpp"
#include "core/auth/account_store.hpp"
#include "core/auth/auth_service.hpp"
#include "core/auth/password_hash.hpp"
#include "core/common/json_text.hpp"
#include "core/common/utf8.hpp"
#include "nlohmann/json.hpp"

namespace mat {

namespace {

enum class Command {
    None,
    Add,
    Passwd,
    Role,
    Disable,
    Enable,
    Unlock,
    UnlockAll,
    List,
    LogicWritesReset,
    PulseAck,
    // Feature 013 (contracts/admin-api.md §8)
    Groups,
    Remove,
    GroupAdd,
    GroupRemove,
    AccessReset
};

struct CommandSpec {
    const char* flag;
    Command command;
    int values;  // the account name, and for --user-role the role
};

constexpr CommandSpec kCommands[] = {
    {"--user-add", Command::Add, 1},
    {"--user-passwd", Command::Passwd, 1},
    {"--user-role", Command::Role, 2},
    {"--user-disable", Command::Disable, 1},
    {"--user-enable", Command::Enable, 1},
    {"--user-unlock", Command::Unlock, 1},
    {"--user-unlock-all", Command::UnlockAll, 0},
    {"--user-list", Command::List, 0},
    // Feature 011 (follow-up of T137): clear an administrator stop of the PLC writes of logic.
    {"--logic-writes-reset", Command::LogicWritesReset, 0},
    // Second review T202 (N-L3): close pulse journal entries reported as PULSE_STUCK.
    {"--pulse-ack", Command::PulseAck, 1},
    // Feature 013: groups of an account, removal, the groups of access.json, the rules reset.
    {"--user-groups", Command::Groups, 2},
    {"--user-remove", Command::Remove, 1},
    {"--group-add", Command::GroupAdd, 2},
    {"--group-remove", Command::GroupRemove, 1},
    {"--access-reset", Command::AccessReset, 0},
};

const CommandSpec* findCommand(const char* arg) {
    for (const auto& c : kCommands)
        if (std::strcmp(arg, c.flag) == 0) return &c;
    return nullptr;
}

constexpr const char* kRoles = "viewer, operator, engineer hoặc administrator";

struct Args {
    Command command = Command::None;
    std::string name;
    std::string role;
    bool roleOption = false;  // --role (of --user-add)
    bool passwordStdin = false;
    std::vector<std::string> overrides;  // --config, --data-dir, --users-file with their values
};

// How an argument the command did not expect appears in a message: an option up to its '=', never
// a value. A password typed as an argument must not end up in a log or on a shared screen.
std::string shown(const std::string& arg) {
    if (arg.rfind("--", 0) != 0) return "một giá trị thừa";
    const size_t eq = arg.find('=');
    return eq == std::string::npos ? arg : arg.substr(0, eq) + "=…";
}

constexpr const char* kNoPasswordArgument =
    "mật khẩu không bao giờ là tham số dòng lệnh (lộ trong ps và lịch sử shell): nhập trên "
    "terminal, hoặc một dòng stdin với --password-stdin";

bool parse(int argc, char** argv, Args& a, std::string& error) {
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        // A value never starts with "--": "--users-file --data-dir x" is a missing value.
        auto value = [&](std::string& dst) {
            if (i + 1 >= argc || std::strncmp(argv[i + 1], "--", 2) == 0) return false;
            dst = argv[++i];
            return true;
        };
        if (const CommandSpec* c = findCommand(argv[i])) {
            if (a.command != Command::None) {
                error = "mỗi lần chạy chỉ một lệnh --user-*";
                return false;
            }
            a.command = c->command;
            if (c->values >= 1 && !value(a.name)) {
                error = c->command == Command::PulseAck
                            ? arg + " cần mã yêu cầu của xung (requestId) hoặc all"
                            : c->command == Command::GroupAdd || c->command == Command::GroupRemove
                                  ? arg + " cần mã nhóm"
                                  : arg + " cần tên tài khoản";
                return false;
            }
            if (c->values == 2 && !value(a.role)) {
                error = c->command == Command::Groups
                            ? "--user-groups cần tên tài khoản và danh sách mã nhóm (g1,g2; - "
                              "là không nhóm nào)"
                            : c->command == Command::GroupAdd
                                  ? "--group-add cần mã nhóm và tên hiển thị"
                                  : "--user-role cần tên tài khoản và role (" +
                                        std::string(kRoles) + ")";
                return false;
            }
        } else if (arg == "--role") {
            if (!value(a.role)) {
                error = "--role cần một role: " + std::string(kRoles);
                return false;
            }
            a.roleOption = true;
        } else if (arg == "--password-stdin") {
            a.passwordStdin = true;
        } else if (arg == "--config" || arg == "--data-dir" || arg == "--users-file") {
            std::string v;
            if (!value(v)) {
                error = arg + " cần một giá trị";
                return false;
            }
            a.overrides.insert(a.overrides.end(), {arg, v});
        } else {
            error = "tham số không hỗ trợ: " + shown(arg);
            if (arg.rfind("--pass", 0) == 0 || arg.rfind("--", 0) != 0)
                error += std::string("; ") + kNoPasswordArgument;
            return false;
        }
    }
    if (a.command == Command::None) {
        error = "thiếu lệnh --user-*";
        return false;
    }
    if (a.roleOption && a.command != Command::Add) {
        error = "--role chỉ dùng với --user-add (đổi role: --user-role <tên> <role>)";
        return false;
    }
    if (a.command == Command::Add && !a.roleOption) {
        error = "--user-add cần --role <role>: " + std::string(kRoles);
        return false;
    }
    if (a.passwordStdin && a.command != Command::Add && a.command != Command::Passwd) {
        error = "--password-stdin chỉ dùng với --user-add và --user-passwd";
        return false;
    }
    return true;
}

// --- password input

// Echo off on a terminal while a password is typed. The settings come back when the object goes,
// and also when SIGINT, SIGQUIT, SIGTERM or SIGHUP ends the command at the prompt: the handler
// restores them, then the signal does what it would have done.
volatile sig_atomic_t g_echoFd = -1;
termios g_echoSaved{};

void restoreEchoAndRaise(int sig) {
    const int saved = errno;
    if (g_echoFd >= 0) ::tcsetattr(g_echoFd, TCSANOW, &g_echoSaved);
    errno = saved;
    ::raise(sig);  // SA_RESETHAND: the default action now; delivered when the handler returns
}

constexpr int kPromptSignals[] = {SIGINT, SIGQUIT, SIGTERM, SIGHUP};

class EchoOff {
   public:
    explicit EchoOff(int fd) : fd_(fd) {
        if (::tcgetattr(fd, &saved_) != 0) return;
        g_echoSaved = saved_;
        g_echoFd = fd;
        struct sigaction sa {};
        sa.sa_handler = restoreEchoAndRaise;
        sigemptyset(&sa.sa_mask);
        sa.sa_flags = SA_RESETHAND;
        for (size_t i = 0; i < std::size(kPromptSignals); ++i)
            ::sigaction(kPromptSignals[i], &sa, &old_[i]);
        termios t = saved_;
        t.c_lflag &= ~static_cast<tcflag_t>(ECHO);
        // TCSAFLUSH: what was typed before the prompt is not taken as the password
        on_ = ::tcsetattr(fd, TCSAFLUSH, &t) == 0;
        if (!on_) restore();
    }
    ~EchoOff() {
        if (on_) restore();
    }
    EchoOff(const EchoOff&) = delete;
    EchoOff& operator=(const EchoOff&) = delete;
    bool on() const { return on_; }

   private:
    void restore() {
        ::tcsetattr(fd_, TCSANOW, &saved_);
        for (size_t i = 0; i < std::size(kPromptSignals); ++i)
            ::sigaction(kPromptSignals[i], &old_[i], nullptr);
        g_echoFd = -1;
        on_ = false;
    }

    int fd_;
    termios saved_{};
    struct sigaction old_[std::size(kPromptSignals)]{};
    bool on_ = false;
};

enum class LineStatus { Ok, Empty, TooLong, Error };

// One line of `fd` (byte by byte: nothing after it is consumed), without its line feed and a CR
// before it. At most kPasswordMaxBytes are kept; a longer line is read to its end and refused. The
// string never grows past its first allocation, so no copy of the password is left in freed memory.
LineStatus readLine(int fd, std::string& line) {
    line.clear();
    line.reserve(kPasswordMaxBytes + 1);
    bool tooLong = false;
    for (;;) {
        char c = 0;
        const ssize_t n = ::read(fd, &c, 1);
        if (n < 0) {
            if (errno == EINTR) continue;
            return LineStatus::Error;
        }
        if (n == 0 || c == '\n') break;
        if (line.size() < kPasswordMaxBytes + 1)
            line.push_back(c);
        else
            tooLong = true;
        c = 0;
    }
    if (!line.empty() && line.back() == '\r') line.pop_back();
    // A UTF-8 byte order mark before the line (a PowerShell 5.1 pipe adds one) is not the password.
    if (line.compare(0, 3, "\xEF\xBB\xBF") == 0) line.erase(0, 3);
    if (tooLong || line.size() > kPasswordMaxBytes) return LineStatus::TooLong;
    return line.empty() ? LineStatus::Empty : LineStatus::Ok;
}

// The blocks of combining marks of ADR-011 (decision of 2026-10-11).
bool combiningMark(char32_t c) {
    return (c >= 0x0300 && c <= 0x036F) || (c >= 0x1AB0 && c <= 0x1AFF) ||
           (c >= 0x1DC0 && c <= 0x1DFF) || (c >= 0x20D0 && c <= 0x20FF) ||
           (c >= 0xFE20 && c <= 0xFE2F);
}

// For valid UTF-8.
bool hasCombiningMark(const std::string& s) {
    for (size_t i = 0; i < s.size();) {
        const auto b = static_cast<unsigned char>(s[i]);
        size_t len = 1;
        char32_t c = b;
        if (b >= 0xF0) {
            len = 4;
            c = b & 0x07;
        } else if (b >= 0xE0) {
            len = 3;
            c = b & 0x0F;
        } else if (b >= 0xC0) {
            len = 2;
            c = b & 0x1F;
        }
        for (size_t k = 1; k < len && i + k < s.size(); ++k)
            c = (c << 6) | (static_cast<unsigned char>(s[i + k]) & 0x3F);
        if (combiningMark(c)) return true;
        i += len;
    }
    return false;
}

const char* passwordProblemMessage(PasswordProblem p) {
    switch (p) {
        case PasswordProblem::None:
            return "";
        case PasswordProblem::NotUtf8:
            return "mật khẩu không phải UTF-8: đặt terminal về UTF-8 rồi nhập lại";
        case PasswordProblem::TooShort:
            return "mật khẩu quá ngắn: cần ít nhất 15 ký tự";
        case PasswordProblem::TooLong:
            return "mật khẩu quá dài: tối đa 128 ký tự";
        case PasswordProblem::SameAsName:
            return "mật khẩu không được trùng tên tài khoản";
    }
    return "mật khẩu không hợp lệ";
}

constexpr const char* kCombiningHint =
    "mật khẩu có dấu tổ hợp (chữ cái và dấu gõ thành hai ký tự riêng): đặt bộ gõ (Unikey, EVKey…) "
    "về bảng mã \"Unicode dựng sẵn\" rồi nhập lại. Studio gửi mật khẩu ở dạng dựng sẵn, nên mật "
    "khẩu có dấu tổ hợp sẽ không đăng nhập được";

// The new password of `name`: one line of env.inFd with --password-stdin, else asked twice on the
// terminal. 0 and `pw` set, or 2 with a message (never quoting the password).
int readNewPassword(const DeviceCliEnv& env, bool fromStdin, const std::string& name,
                    std::string& pw, std::ostream& err) {
    const bool terminal = ::isatty(env.inFd) == 1;
    if (!fromStdin && !terminal) {
        err << "không có terminal để hỏi mật khẩu: dùng --password-stdin (mật khẩu là dòng đầu của "
               "stdin)\n";
        return 2;
    }
    LineStatus status = LineStatus::Ok;
    {
        std::optional<EchoOff> echo;
        if (terminal) {
            echo.emplace(env.inFd);
            if (!echo->on()) {
                err << "không tắt được echo của terminal: không hỏi mật khẩu\n";
                return 2;
            }
            err << "Mật khẩu mới của " << name
                << " (15–128 ký tự, không hiện khi gõ): " << std::flush;
        }
        status = readLine(env.inFd, pw);
        if (terminal) err << "\n";
        if (!fromStdin && status == LineStatus::Ok) {
            err << "Nhập lại mật khẩu: " << std::flush;
            std::string again;
            const LineStatus second = readLine(env.inFd, again);
            err << "\n";
            const bool same = second == LineStatus::Ok && again == pw;
            secureZero(again);
            if (!same) {
                secureZero(pw);
                err << "hai lần nhập không giống nhau: không đổi gì\n";
                return 2;
            }
        }
    }
    const char* problem = nullptr;
    if (status == LineStatus::Error) {
        problem = "không đọc được mật khẩu";
    } else if (status == LineStatus::Empty) {
        problem = "không có mật khẩu (dòng trống, hoặc stdin không có gì)";
    } else if (status == LineStatus::TooLong) {
        problem = passwordProblemMessage(PasswordProblem::TooLong);
    } else if (!isValidUtf8(pw)) {
        problem = passwordProblemMessage(PasswordProblem::NotUtf8);
    } else if (hasCombiningMark(pw)) {
        problem = kCombiningHint;
    } else if (const PasswordProblem p = checkNewPassword(pw, name); p != PasswordProblem::None) {
        problem = passwordProblemMessage(p);
    }
    if (problem) {
        secureZero(pw);
        err << problem << ": không đổi gì\n";
        return 2;
    }
    return 0;
}

// The Argon2id PHC text of a password read as above; the password is wiped either way.
int hashNewPassword(const DeviceCliEnv& env, bool fromStdin, const std::string& name,
                    std::string& phc, std::ostream& err) {
    std::string pw;
    if (const int code = readNewPassword(env, fromStdin, name, pw, err); code != 0) return code;
    try {
        phc = hashPassword(pw);
    } catch (const std::exception& e) {
        secureZero(pw);
        err << "không băm được mật khẩu: " << e.what() << "\n";
        return 4;
    }
    secureZero(pw);
    return 0;
}

// --- changes

// What a command changes: its audit record, the edit of the two files under the store's lock, and
// what to print once they are written.
struct Change {
    AuditAction action = AuditAction::AccountCreate;
    std::string target;
    nlohmann::json detail = nlohmann::json::object();
    std::string done;
};

// Under the lock (AuthStore::transact): the rules of the command on the files as read now (0, or
// the exit code with its message printed), then the audit `started` (as the service user), then
// the files are written; then `ok` or `failed`.
int commit(const DeviceCliEnv& env, const RuntimeConfig& cfg, AuthStore& store, Change& c,
           const std::function<int(AuthTxn&, Change&)>& edit, std::ostream& out,
           std::ostream& err) {
    const AuditOptions ao = deviceCliAuditOptions(cfg, env);
    int code = 0;
    bool started = false;
    AuditEvent event(c.action, AuditResult::Started, AuditChannel::Cli, "cli");
    std::string txnError;
    const TxnStatus s = store.transact(
        [&](AuthTxn& t) {
            code = edit(t, c);
            if (code != 0 || (!t.usersChanged && !t.accessChanged)) return false;
            event = AuditEvent(c.action, AuditResult::Started, AuditChannel::Cli, "cli");
            if (!c.target.empty()) event.target = c.target;
            if (!c.detail.empty()) event.detail = jsonText(c.detail);
            std::string e, warning;
            started = appendAuditAsServiceUser(env, ao, event, e, &warning);
            if (!warning.empty()) err << "cảnh báo: " << warning << "\n";
            if (!started) {
                err << "không ghi được audit vào " << cfg.dataDir << "/" << kAuditFileName << ": "
                    << e << "\nkhông đổi gì (mã 5)\n";
                code = 5;
                return false;
            }
            return true;
        },
        txnError);
    if (s == TxnStatus::Aborted) {
        if (code == 0) out << c.done << "\n";  // nothing to change
        return code;
    }
    AuditEvent result = event;
    result.result = s == TxnStatus::Ok ? AuditResult::Ok : AuditResult::Failed;
    if (s == TxnStatus::Failed) {
        if (!started) {  // the lock or the directory: nothing was audited, nothing changed
            err << txnError << "\n";
            return 4;
        }
        result.code = "USERS_WRITE_FAILED";
        nlohmann::json detail = c.detail;
        detail["error"] = txnError;
        result.detail = jsonText(detail);
    }
    std::string resultError;
    const bool recorded = appendAuditAsServiceUser(env, ao, result, resultError);
    if (s == TxnStatus::Failed) {
        err << txnError << "\n";
        if (!recorded) err << "cũng không ghi được kết quả vào audit: " << resultError << "\n";
        return 4;
    }
    out << c.done << "\n";
    if (!recorded)
        err << "cảnh báo: đã đổi, nhưng không ghi được kết quả vào audit (đã có bản ghi started): "
            << resultError << "\n";
    return 0;
}

// "g1,g2" (or "-": none) as distinct group ids.
bool groupList(const std::string& text, std::vector<std::string>& out) {
    out.clear();
    if (text == "-" || text.empty()) return true;
    size_t at = 0;
    while (at <= text.size()) {
        size_t end = text.find(',', at);
        if (end == std::string::npos) end = text.size();
        const std::string g = text.substr(at, end - at);
        if (!validGroupId(g) || std::find(out.begin(), out.end(), g) != out.end()) return false;
        out.push_back(g);
        at = end + 1;
    }
    return out.size() <= kMaxAccountGroups;
}
// The request file of --logic-writes-reset: kLogicWritesResetFile of server/logic_glue.hpp.
constexpr const char* kLogicWritesResetRequestFile = "logic-writes-reset.req";
// The request file of --pulse-ack: kPulseAckFile of server/write_subsystem.hpp.
constexpr const char* kPulseAckRequestFile = "pulse-ack.req";

// --pulse-ack: "all", or a request id (a UUID: letters, digits, '-', '_', at most 64).
bool validPulseAckTarget(const std::string& t) {
    if (t == "all") return true;
    if (t.empty() || t.size() > 64) return false;
    for (const char c : t)
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
              c == '-' || c == '_'))
            return false;
    return true;
}

// --- Requests to the running runtime: --user-unlock-all (feature 011, FR-017),
// --logic-writes-reset (feature 011, follow-up of T137)

// What a request to the runtime is: its audit record, its file in the data directory, its line.
struct RuntimeRequest {
    AuditAction action;
    std::string target;  // "" = none
    nlohmann::json detail;
    const char* fileName;
    std::string line;      // the file's line, before the time
    const char* failCode;  // audit code when the file cannot be written
    std::string done;      // what the person reads when it went out
};

// State the runtime keeps in memory or owns (the lockouts, logic-state.json) is changed through a
// request file in the data directory, which the runtime (the service user owns the directory)
// deletes within 5 s or at its next start, then applies. Audit started then ok or failed. An old
// file or a symbolic link in its place is removed first and never followed.
int requestToRuntime(const DeviceCliEnv& env, const RuntimeConfig& cfg, const RuntimeRequest& q,
                     std::ostream& out, std::ostream& err) {
    const AuditOptions ao = deviceCliAuditOptions(cfg, env);
    AuditEvent event(q.action, AuditResult::Started, AuditChannel::Cli, "cli");
    if (!q.target.empty()) event.target = q.target;
    event.detail = jsonText(q.detail);
    std::string e, warning;
    const bool started = appendAuditAsServiceUser(env, ao, event, e, &warning);
    if (!warning.empty()) err << "cảnh báo: " << warning << "\n";
    if (!started) {
        err << "không ghi được audit vào " << cfg.dataDir << "/" << kAuditFileName << ": " << e
            << "\nkhông đổi gì (mã 5)\n";
        return 5;
    }
    const std::string path = cfg.dataDir + "/" + q.fileName;
    std::string writeError;
    // L3 of the security review of 011: the data directory is opened once, without following a
    // link, and the file is removed and created relative to it: a directory swapped for a link
    // (the service user owns it) cannot send the file of root elsewhere.
    const int dirFd = ::open(cfg.dataDir.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (dirFd < 0) {
        writeError = "không mở được thư mục " + cfg.dataDir + " (phải là thư mục, không phải " +
                     "liên kết): " + std::strerror(errno);
    } else if (::unlinkat(dirFd, q.fileName, 0) != 0 && errno != ENOENT) {
        writeError = "không xóa được " + path + ": " + std::strerror(errno);
    } else {
        const int fd =
            ::openat(dirFd, q.fileName, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
        if (fd < 0) {
            writeError = "không tạo được " + path + ": " + std::strerror(errno);
        } else {
            const std::string text =
                q.line + " " + (env.nowIso ? env.nowIso() : utcIsoNow()) + "\n";
            const bool ok =
                ::write(fd, text.data(), text.size()) == static_cast<ssize_t>(text.size()) &&
                ::fchmod(fd, 0600) == 0 && ::fsync(fd) == 0;
            if (!ok) writeError = "không ghi được " + path + ": " + std::strerror(errno);
            if (::close(fd) != 0 && writeError.empty())
                writeError = "không ghi được " + path + ": " + std::strerror(errno);
            if (!writeError.empty()) ::unlinkat(dirFd, q.fileName, 0);
        }
    }
    if (dirFd >= 0) ::close(dirFd);
    AuditEvent result = event;
    result.result = writeError.empty() ? AuditResult::Ok : AuditResult::Failed;
    if (!writeError.empty()) {
        result.code = q.failCode;
        nlohmann::json d = q.detail;
        d["error"] = writeError;
        result.detail = jsonText(d);
    }
    std::string resultError;
    const bool recorded = appendAuditAsServiceUser(env, ao, result, resultError);
    if (!writeError.empty()) {
        err << writeError << "\n";
        if (!recorded) err << "cũng không ghi được kết quả vào audit: " << resultError << "\n";
        return 4;
    }
    out << q.done << "\n";
    if (!recorded)
        err << "cảnh báo: đã gửi, nhưng không ghi được kết quả vào audit (đã có bản ghi started): "
            << resultError << "\n";
    return 0;
}

// --user-unlock-all: every pair and address lock. Audit account.unlock, target "*".
int requestUnlockAll(const DeviceCliEnv& env, const RuntimeConfig& cfg, std::ostream& out,
                     std::ostream& err) {
    return requestToRuntime(
        env, cfg,
        {AuditAction::AccountUnlock,
         "*",
         {{"scope", "all"}},
         kUnlockRequestFileName,
         "unlock-all",
         "UNLOCK_REQUEST_FAILED",
         "đã gửi yêu cầu mở mọi khóa đăng nhập (mọi cặp tên và IP, mọi IP): runtime áp dụng "
         "trong 5 s, hoặc khi khởi động lại"},
        out, err);
}

// --logic-writes-reset: the runtime clears the stop of an administrator (writesStopped of
// logic-state.json, edges kept) within 5 s while a project with logic.json runs, or at its next
// start. Audit logic.writes.enabled; the runtime writes the second record when it applies it.
// The configured logic.writes of runtime.json still decides (off stays off).
int requestLogicWritesReset(const DeviceCliEnv& env, const RuntimeConfig& cfg, std::ostream& out,
                            std::ostream& err) {
    return requestToRuntime(
        env, cfg,
        {AuditAction::LogicWritesEnabled,
         "",
         {{"configured", cfg.logicWrites}},
         kLogicWritesResetRequestFile,
         "logic-writes-reset",
         "LOGIC_RESET_REQUEST_FAILED",
         std::string("đã gửi yêu cầu bỏ lệnh dừng ghi PLC của logic: runtime áp dụng trong 5 s "
                     "(project có logic.json), hoặc khi khởi động lại; logic.writes của "
                     "runtime.json hiện là \"" +
                     cfg.logicWrites + "\"" +
                     (cfg.logicWrites == "on" ? "" : " (vẫn tắt ghi tới khi đặt \"on\")"))},
        out, err);
}

// --pulse-ack <rid|all> (second review T202, N-L3): the runtime closes the pulse journal entries
// reported as PULSE_STUCK (the rid, or every one) within 5 s, or at its next start: a `done` line
// each, the warning cleared, audit pulse.ack. Root checked the bits on the PLC by hand first.
int requestPulseAck(const DeviceCliEnv& env, const RuntimeConfig& cfg, const std::string& target,
                    std::ostream& out, std::ostream& err) {
    return requestToRuntime(
        env, cfg,
        {AuditAction::PulseAck,
         target,
         {{"scope", target == "all" ? "all" : "one"}},
         kPulseAckRequestFile,
         "pulse-ack " + target,
         "PULSE_ACK_REQUEST_FAILED",
         "đã gửi yêu cầu đóng mục PULSE_STUCK (" + target +
             ") của pulse.journal: runtime áp dụng trong 5 s, hoặc khi khởi "
             "động lại; chỉ đóng mục đã báo PULSE_STUCK, không ghi gì xuống PLC"},
        out, err);
}

// --- --user-list

size_t chars(const std::string& s) {  // code points of valid UTF-8
    size_t n = 0;
    for (const char c : s)
        if ((static_cast<unsigned char>(c) & 0xC0) != 0x80) ++n;
    return n;
}

std::string padded(const std::string& s, size_t width) {
    const size_t n = chars(s);
    return n >= width ? s : s + std::string(width - n, ' ');
}

// Text of the file shown in a column: no control character, no space (the columns stay columns).
std::string column(const std::string& s) {
    std::string out = sanitizeUtf8(s);
    for (char& c : out)
        if (static_cast<unsigned char>(c) <= 0x20 || c == 0x7f) c = '?';
    return out.empty() ? "-" : out;
}

int list(const UsersFile& f, const std::string& path, std::ostream& out, std::ostream& err) {
    struct stat st {};
    if (::stat(path.c_str(), &st) == 0 && (st.st_mode & 0007) != 0)
        err << "cảnh báo: " << path << " cho người khác đọc hoặc ghi: runtime không dùng file này "
            << "(mọi đăng nhập bị từ chối). Lệnh --user-* kế tiếp ghi lại file với quyền 0640\n";
    if (f.users.empty()) {
        out << "chưa có tài khoản nào: tạo tài khoản quản trị bằng "
               "mat-runtime --user-add <tên> --role administrator\n";
        return 0;
    }
    size_t nameWidth = 3;
    for (const auto& a : f.users) nameWidth = std::max(nameWidth, chars(a.name));
    out << padded("TÊN", nameWidth) << "  " << padded("ROLE", 13) << "  "
        << padded("TRẠNG THÁI", 10) << "  ĐỔI LẦN CUỐI (UTC)\n";
    for (const auto& a : f.users) {
        out << padded(a.name, nameWidth) << "  " << padded(roleName(a.role), 13) << "  "
            << padded(a.enabled ? "bật" : "tắt", 10) << "  " << column(a.updatedAt);
        if (!a.hash) out << "  (mật khẩu hỏng, không đăng nhập được: đặt lại bằng --user-passwd)";
        out << "\n";
    }
    return 0;
}

}  // namespace

bool isUserCommand(int argc, char** argv) {
    for (int i = 1; i < argc; ++i)
        if (findCommand(argv[i])) return true;
    return false;
}

int runUserCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
               std::ostream& err) {
    Args a;
    std::string error;
    if (!parse(argc, argv, a, error)) {
        err << error << "\n";
        return 2;
    }
    std::optional<Role> role;
    if (a.command == Command::Add || a.command == Command::Role) {
        role = parseRole(a.role);
        if (!role) {  // the value is not quoted: it may be a password typed in the wrong place
            err << "role không hợp lệ: chọn " << kRoles << "\n";
            return 2;
        }
    }
    std::vector<std::string> groups;
    if (a.command == Command::Groups && !groupList(a.role, groups)) {
        err << "danh sách nhóm không hợp lệ: mã nhóm a-z, 0-9, '-' (2–32 ký tự), cách nhau bằng "
               "dấu phẩy, tối đa 16; \"-\" là không nhóm nào\n";
        return 2;
    }
    const bool groupCommand = a.command == Command::GroupAdd || a.command == Command::GroupRemove;
    if (groupCommand && !validGroupId(a.name)) {
        err << "mã nhóm không hợp lệ: 2–32 ký tự a-z, 0-9, '-', bắt đầu bằng chữ\n";
        return 2;
    }
    if (a.command == Command::GroupAdd && !validGroupName(a.role)) {
        err << "tên nhóm không hợp lệ: 1–64 ký tự, không có ký tự điều khiển\n";
        return 2;
    }
    if (!env.isRoot) {
        err << "cần chạy bằng root (BL335 không có sudo)\n";
        return 4;
    }
    if (a.command == Command::PulseAck && !validPulseAckTarget(a.name)) {
        err << "--pulse-ack cần mã yêu cầu của xung (requestId trong PULSE_STUCK, pulse.journal) "
               "hoặc all\n";
        return 2;
    }
    const bool named = a.command != Command::List && a.command != Command::UnlockAll &&
                       a.command != Command::LogicWritesReset && a.command != Command::PulseAck &&
                       a.command != Command::AccessReset && !groupCommand;
    if (named && !validAccountName(a.name)) {
        err << accountEditMessage(AccountEditError::InvalidName) << "\n";
        return 4;
    }
    RuntimeConfig cfg;
    if (!loadDeviceCliConfig(a.overrides, env, cfg, error)) {
        err << "config: " << error << "\n";
        return 2;
    }
    if (a.command == Command::UnlockAll) return requestUnlockAll(env, cfg, out, err);
    if (a.command == Command::LogicWritesReset) return requestLogicWritesReset(env, cfg, out, err);
    if (a.command == Command::PulseAck) return requestPulseAck(env, cfg, a.name, out, err);

    // Feature 013: the accounts are in <dataDir>/auth/users.json, made once from the seed
    // (usersFile, /etc/mat-runtime/users.json), under the lock the runtime takes too.
    AuthStoreOptions so;
    so.dir = cfg.authDir;
    so.seedUsersFile = cfg.usersFile;
    so.ownerUser = env.serviceUser;
    so.deviceCommand = true;
    AuthStore store(so);
    {
        std::string prepError, seedError;
        bool migrated = false;
        if (!store.prepare(prepError, &migrated, &seedError)) {
            err << prepError << "\n";
            return 4;
        }
        if (migrated) {
            AuditEvent e(AuditAction::AccountMigrate, AuditResult::Ok, AuditChannel::Cli, "cli");
            e.target = store.usersPath();
            e.detail = jsonText({{"from", cfg.usersFile}});
            std::string ae;
            appendAuditAsServiceUser(env, deviceCliAuditOptions(cfg, env), e, ae);
            err << "đã chép tài khoản từ " << cfg.usersFile << " sang " << store.usersPath()
                << " (từ nay sửa ở đó)\n";
        }
        if (!seedError.empty() && store.read().users.status == UsersStatus::Missing) {
            err << "không đọc được file tài khoản: " << seedError
                << "\nsửa hoặc khôi phục file rồi chạy lại (mã 6)\n";
            return 6;
        }
    }
    const std::string& name = a.name;
    auto refuse = [&](AccountEditError e) {
        err << accountEditMessage(e) << ": " << name << "\n";
        return 4;
    };
    // The account rules on users.json as read now: 0, or the exit code with its message.
    auto check = [&](const UsersRead& r) {
        if (r.status == UsersStatus::Error) {
            err << "không đọc được file tài khoản: " << r.error
                << "\nsửa hoặc khôi phục file rồi chạy lại (mã 6)\n";
            return 6;
        }
        if (!named) return 0;
        const Account* acc = r.status == UsersStatus::Ok ? r.file.find(name) : nullptr;
        if (a.command == Command::Add) {
            if (acc) return refuse(AccountEditError::Exists);
            if (r.file.users.size() >= kMaxAccounts) return refuse(AccountEditError::TooMany);
        } else if (!acc) {
            return refuse(AccountEditError::NotFound);
        }
        return 0;
    };
    if (a.command == Command::List) {
        const UsersRead r = readUsersFile(store.usersPath(), /*enforceMode=*/false);
        if (r.status == UsersStatus::Error) return check(r);
        return list(r.file, store.usersPath(), out, err);
    }
    std::string phc;  // new hash of --user-add and --user-passwd
    if (a.command == Command::Add || a.command == Command::Passwd) {
        // The checks run once before the password is asked (no typing for nothing), and again
        // under the lock. The lock is not held while someone types.
        if (const int code = check(store.read().users); code != 0) return code;
        if (const int code = hashNewPassword(env, a.passwordStdin, name, phc, err); code != 0)
            return code;
    }
    const std::string now = env.nowIso ? env.nowIso() : utcIsoNow();
    // access.json must be readable for what changes it (or names its groups)
    auto accessOk = [&](const AuthTxn& t) {
        if (t.before.accessState != AccessFileState::Invalid) return 0;
        err << "access.json hỏng: " << t.before.accessError
            << "\nkhôi phục trên trang Quản trị hoặc chạy --access-reset (mã 6)\n";
        return 6;
    };
    Change c;
    c.target = name;
    const std::function<int(AuthTxn&, Change&)> edit = [&](AuthTxn& t, Change& ch) -> int {
        if (const int code = check(t.before.users); code != 0) return code;
        const Account* current = t.users.find(name);
        AccountEditError e = AccountEditError::None;
        switch (a.command) {
            case Command::Add:
                e = addAccount(t.users, name, *role, phc, now);
                ch.action = AuditAction::AccountCreate;
                ch.detail["role"] = roleName(*role);
                ch.done = "đã tạo tài khoản " + name + " (" + roleName(*role) + ")";
                break;
            case Command::Passwd:
                e = setAccountPassword(t.users, name, phc, now);
                ch.action = AuditAction::AccountPassword;
                ch.done =
                    "đã đặt mật khẩu mới cho " + name + "; các phiên đang mở của tài khoản bị hủy";
                break;
            case Command::Role:
                ch.action = AuditAction::AccountRole;
                if (current->role == *role) {
                    ch.done = name + " đã có role " + roleName(*role) + ": không đổi gì";
                    return 0;
                }
                ch.detail = {{"from", roleName(current->role)}, {"to", roleName(*role)}};
                ch.done = "đã đổi role của " + name + ": " + roleName(current->role) + " → " +
                          roleName(*role) + "; các phiên đang mở của tài khoản bị hủy";
                e = setAccountRole(t.users, name, *role, now);
                break;
            case Command::Disable:
            case Command::Enable: {
                const bool enable = a.command == Command::Enable;
                ch.action = enable ? AuditAction::AccountEnable : AuditAction::AccountDisable;
                if (current->enabled == enable) {
                    ch.done = name + (enable ? " đang bật" : " đã tắt") + ": không đổi gì";
                    return 0;
                }
                e = setAccountEnabled(t.users, name, enable, now);
                ch.done = enable ? "đã bật tài khoản " + name
                                 : "đã tắt tài khoản " + name +
                                       "; các phiên đang mở của tài khoản bị hủy";
                break;
            }
            case Command::Unlock:
                e = unlockAccount(t.users, name, now);
                ch.action = AuditAction::AccountUnlock;
                ch.done = "đã mở khóa tạm của " + name +
                          " ở mọi địa chỉ (runtime đọc lại file trong 2 s); khóa theo IP: "
                          "--user-unlock-all";
                break;
            case Command::Groups: {
                ch.action = AuditAction::AccountGroups;
                if (const int code = accessOk(t); code != 0) return code;
                for (const auto& g : groups)
                    if (!t.access.group(g)) {
                        err << "không có nhóm " << g << " (tạo bằng --group-add)\n";
                        return 4;
                    }
                ch.detail = {{"before", current->groups}, {"after", groups}};
                if (current->groups == groups) {
                    ch.done = name + " đã có đúng các nhóm này: không đổi gì";
                    return 0;
                }
                e = setAccountGroups(t.users, name, groups, now);
                ch.done = "đã đặt nhóm của " + name + "; các phiên đang mở của tài khoản bị hủy";
                break;
            }
            case Command::Remove: {
                ch.action = AuditAction::AccountDelete;
                if (const int code = accessOk(t); code != 0) return code;
                ch.detail = {{"role", roleName(current->role)}, {"groups", current->groups}};
                e = removeAccount(t.users, name);
                if (e != AccountEditError::None) break;
                size_t fromRules = 0;
                for (auto& r : t.access.rules) {
                    const auto it = std::find(r.grantees.begin(), r.grantees.end(), "user:" + name);
                    if (it == r.grantees.end()) continue;
                    r.grantees.erase(it);
                    ++fromRules;
                }
                if (fromRules > 0) t.accessChanged = true;
                ch.detail["removedFromRules"] = fromRules;
                ch.done = "đã xóa tài khoản " + name + "; các phiên đang mở của tài khoản bị hủy";
                break;
            }
            case Command::GroupAdd: {
                ch.action = AuditAction::GroupCreate;
                if (const int code = accessOk(t); code != 0) return code;
                if (t.access.group(name)) {
                    err << "đã có nhóm " << name << "\n";
                    return 4;
                }
                if (t.access.groups.size() >= kMaxAccessGroups) {
                    err << "đã đủ 50 nhóm\n";
                    return 4;
                }
                t.access.groups.push_back({name, a.role});
                t.accessChanged = true;
                ch.detail = {{"name", a.role}};
                ch.done = "đã tạo nhóm " + name;
                return 0;
            }
            case Command::GroupRemove: {
                // The recovery path: the group goes from the accounts and the rules as well.
                ch.action = AuditAction::GroupDelete;
                if (const int code = accessOk(t); code != 0) return code;
                if (!t.access.group(name)) {
                    err << "không có nhóm " << name << "\n";
                    return 4;
                }
                t.access.groups.erase(
                    std::remove_if(t.access.groups.begin(), t.access.groups.end(),
                                   [&](const AccessGroup& g) { return g.id == name; }),
                    t.access.groups.end());
                size_t members = 0, fromRules = 0;
                for (const Account& acc : t.before.users.file.users) {
                    if (std::find(acc.groups.begin(), acc.groups.end(), name) == acc.groups.end())
                        continue;
                    std::vector<std::string> left = acc.groups;
                    left.erase(std::remove(left.begin(), left.end(), name), left.end());
                    setAccountGroups(t.users, acc.name, left, now);
                    ++members;
                }
                for (auto& r : t.access.rules) {
                    const auto it =
                        std::find(r.grantees.begin(), r.grantees.end(), "group:" + name);
                    if (it == r.grantees.end()) continue;
                    r.grantees.erase(it);
                    ++fromRules;
                }
                t.accessChanged = true;
                if (members > 0) t.usersChanged = true;
                ch.detail = {{"members", members}, {"removedFromRules", fromRules}};
                ch.done = "đã xóa nhóm " + name + " (" + std::to_string(members) + " tài khoản, " +
                          std::to_string(fromRules) + " quy tắc)";
                return 0;
            }
            case Command::AccessReset: {
                // Every rule goes, the groups stay (a damaged file: none can be kept).
                ch.action = AuditAction::AccessReset;
                ch.target = "access.json";
                const size_t n = t.access.rules.size();
                t.access.rules.clear();
                t.accessChanged = true;
                ch.detail = {{"removed", n},
                             {"damaged", t.before.accessState == AccessFileState::Invalid}};
                ch.done = "đã xóa mọi quy tắc quyền (" + std::to_string(n) +
                          "): mọi trang và thành phần về mặc định của project";
                return 0;
            }
            case Command::UnlockAll:
            case Command::LogicWritesReset:
            case Command::PulseAck:
            case Command::List:
            case Command::None:
                return 2;
        }
        if (e != AccountEditError::None) return refuse(e);
        t.usersChanged = true;
        return 0;
    };
    return commit(env, cfg, store, c, edit, out, err);
}

}  // namespace mat