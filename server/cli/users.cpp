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

#include "core/auth/account_store.hpp"
#include "core/auth/auth_service.hpp"
#include "core/auth/password_hash.hpp"
#include "core/common/json_text.hpp"
#include "core/common/utf8.hpp"
#include "nlohmann/json.hpp"

namespace mat {

namespace {

enum class Command { None, Add, Passwd, Role, Disable, Enable, Unlock, UnlockAll, List };

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
                error = arg + " cần tên tài khoản";
                return false;
            }
            if (c->values == 2 && !value(a.role)) {
                error = "--user-role cần tên tài khoản và role (" + std::string(kRoles) + ")";
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

// The primary group of the service user, which reads users.json (0640); the user name when the
// user does not exist (writeUsersFile then warns that the group is missing).
std::string serviceGroup(const std::string& user) {
    passwd pw{};
    passwd* result = nullptr;
    std::vector<char> buf(16384);
    if (::getpwnam_r(user.c_str(), &pw, buf.data(), buf.size(), &result) == 0 && result) {
        group gr{};
        group* g = nullptr;
        if (::getgrgid_r(result->pw_gid, &gr, buf.data(), buf.size(), &g) == 0 && g)
            return g->gr_name;
    }
    return user;
}

struct Change {
    AuditAction action = AuditAction::AccountCreate;
    std::string target;
    nlohmann::json detail = nlohmann::json::object();
    UsersFile file;    // users.json after the change
    std::string done;  // what to print once it is written
};

// Audit `started` (as the service user), then users.json, then `ok` or `failed`.
int commit(const DeviceCliEnv& env, const RuntimeConfig& cfg, const Change& c, std::ostream& out,
           std::ostream& err) {
    const AuditOptions ao = deviceCliAuditOptions(cfg, env);
    AuditEvent event(c.action, AuditResult::Started, AuditChannel::Cli, "cli");
    event.target = c.target;
    if (!c.detail.empty()) event.detail = jsonText(c.detail);
    std::string e, warning;
    const bool started = appendAuditAsServiceUser(env, ao, event, e, &warning);
    if (!warning.empty()) err << "cảnh báo: " << warning << "\n";
    if (!started) {
        err << "không ghi được audit vào " << cfg.dataDir << "/" << kAuditFileName << ": " << e
            << "\nkhông đổi gì (mã 5)\n";
        return 5;
    }
    UsersWriteOptions wo;
    wo.group = serviceGroup(env.serviceUser);
    std::string writeError, writeWarning;
    const bool written = writeUsersFile(cfg.usersFile, c.file, writeError, &writeWarning, wo);
    AuditEvent result = event;
    result.result = written ? AuditResult::Ok : AuditResult::Failed;
    if (!written) {
        result.code = "USERS_WRITE_FAILED";
        nlohmann::json detail = c.detail;
        detail["error"] = writeError;
        result.detail = jsonText(detail);
    }
    std::string resultError;
    const bool recorded = appendAuditAsServiceUser(env, ao, result, resultError);
    if (!written) {
        err << writeError << "\n";
        if (!recorded) err << "cũng không ghi được kết quả vào audit: " << resultError << "\n";
        return 4;
    }
    out << c.done << "\n";
    if (!writeWarning.empty()) err << "cảnh báo: " << writeWarning << "\n";
    if (!recorded)
        err << "cảnh báo: đã đổi, nhưng không ghi được kết quả vào audit (đã có bản ghi started): "
            << resultError << "\n";
    return 0;
}

// An exclusive flock on the directory of users.json (as server_cert does on its directory), so the
// account commands take turns from their read to their write; released when the object goes. The
// directory is opened at once: a missing one stops the command before any password is asked.
class UsersLock {
   public:
    explicit UsersLock(const std::string& usersFile) {
        const size_t slash = usersFile.rfind('/');
        dir_ = slash == std::string::npos ? "." : slash == 0 ? "/" : usersFile.substr(0, slash);
        fd_ = ::open(dir_.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
        if (fd_ < 0)
            error_ =
                "không mở được thư mục " + dir_ + " của file tài khoản: " + std::strerror(errno);
    }
    ~UsersLock() {
        if (fd_ >= 0) ::close(fd_);
    }
    UsersLock(const UsersLock&) = delete;
    UsersLock& operator=(const UsersLock&) = delete;

    bool opened() const { return fd_ >= 0; }
    // Waits while another account command holds it (it only does from its read to its write).
    bool acquire() {
        while (::flock(fd_, LOCK_EX) != 0) {
            if (errno == EINTR) continue;
            error_ = "không khóa được thư mục " + dir_ + ": " + std::strerror(errno);
            return false;
        }
        return true;
    }
    const std::string& error() const { return error_; }

   private:
    std::string dir_;
    int fd_ = -1;
    std::string error_;
};

// --- --user-unlock-all (feature 011, FR-017)

// The lockouts live in the runtime's memory: a request file in the data directory, which the
// runtime (the service user owns the directory) deletes within 5 s or at its next start, then
// clears every pair and address lock. Audit account.unlock, target "*", started then ok or failed.
// An old file or a symbolic link in its place is removed first and never followed.
int requestUnlockAll(const DeviceCliEnv& env, const RuntimeConfig& cfg, std::ostream& out,
                     std::ostream& err) {
    const AuditOptions ao = deviceCliAuditOptions(cfg, env);
    AuditEvent event(AuditAction::AccountUnlock, AuditResult::Started, AuditChannel::Cli, "cli");
    event.target = "*";
    event.detail = jsonText({{"scope", "all"}});
    std::string e, warning;
    const bool started = appendAuditAsServiceUser(env, ao, event, e, &warning);
    if (!warning.empty()) err << "cảnh báo: " << warning << "\n";
    if (!started) {
        err << "không ghi được audit vào " << cfg.dataDir << "/" << kAuditFileName << ": " << e
            << "\nkhông đổi gì (mã 5)\n";
        return 5;
    }
    const std::string path = cfg.dataDir + "/" + kUnlockRequestFileName;
    std::string writeError;
    if (::unlink(path.c_str()) != 0 && errno != ENOENT) {
        writeError = "không xóa được " + path + ": " + std::strerror(errno);
    } else {
        const int fd =
            ::open(path.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
        if (fd < 0) {
            writeError = "không tạo được " + path + ": " + std::strerror(errno);
        } else {
            const std::string text =
                "unlock-all " + (env.nowIso ? env.nowIso() : utcIsoNow()) + "\n";
            const bool ok =
                ::write(fd, text.data(), text.size()) == static_cast<ssize_t>(text.size()) &&
                ::fchmod(fd, 0600) == 0 && ::fsync(fd) == 0;
            if (!ok) writeError = "không ghi được " + path + ": " + std::strerror(errno);
            if (::close(fd) != 0 && writeError.empty())
                writeError = "không ghi được " + path + ": " + std::strerror(errno);
            if (!writeError.empty()) ::unlink(path.c_str());
        }
    }
    AuditEvent result = event;
    result.result = writeError.empty() ? AuditResult::Ok : AuditResult::Failed;
    if (!writeError.empty()) {
        result.code = "UNLOCK_REQUEST_FAILED";
        result.detail = jsonText({{"scope", "all"}, {"error", writeError}});
    }
    std::string resultError;
    const bool recorded = appendAuditAsServiceUser(env, ao, result, resultError);
    if (!writeError.empty()) {
        err << writeError << "\n";
        if (!recorded) err << "cũng không ghi được kết quả vào audit: " << resultError << "\n";
        return 4;
    }
    out << "đã gửi yêu cầu mở mọi khóa đăng nhập (mọi cặp tên và IP, mọi IP): runtime áp dụng "
           "trong 5 s, hoặc khi khởi động lại\n";
    if (!recorded)
        err << "cảnh báo: đã gửi, nhưng không ghi được kết quả vào audit (đã có bản ghi started): "
            << resultError << "\n";
    return 0;
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
    if (!env.isRoot) {
        err << "cần chạy bằng root: users.json thuộc root:matscada (BL335 không có sudo)\n";
        return 4;
    }
    if (a.command != Command::List && a.command != Command::UnlockAll &&
        !validAccountName(a.name)) {
        err << accountEditMessage(AccountEditError::InvalidName) << "\n";
        return 4;
    }
    RuntimeConfig cfg;
    if (!loadDeviceCliConfig(a.overrides, env, cfg, error)) {
        err << "config: " << error << "\n";
        return 2;
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
        const Account* acc = r.status == UsersStatus::Ok ? r.file.find(name) : nullptr;
        if (a.command == Command::Add) {
            if (acc) return refuse(AccountEditError::Exists);
            if (r.file.users.size() >= kMaxAccounts) return refuse(AccountEditError::TooMany);
        } else if (!acc) {
            return refuse(AccountEditError::NotFound);
        }
        return 0;
    };
    if (a.command == Command::UnlockAll) return requestUnlockAll(env, cfg, out, err);
    if (a.command == Command::List) {
        const UsersRead r = readUsersFile(cfg.usersFile, /*enforceMode=*/false);
        if (r.status == UsersStatus::Error) return check(r);
        return list(r.file, cfg.usersFile, out, err);
    }
    UsersLock lock(cfg.usersFile);  // the directory must be there: checked before any password
    if (!lock.opened()) {
        err << lock.error() << "\n";
        return 4;
    }
    std::string phc;  // new hash of --user-add and --user-passwd
    if (a.command == Command::Add || a.command == Command::Passwd) {
        // The checks run once before the password is asked (no typing for nothing), and again
        // under the lock below. The lock is not held while someone types.
        if (const int code = check(readUsersFile(cfg.usersFile, false)); code != 0) return code;
        if (const int code = hashNewPassword(env, a.passwordStdin, name, phc, err); code != 0)
            return code;
    }
    // Account commands take turns from this read to the write, so two at once cannot lose a
    // change (a disabled account coming back enabled).
    if (!lock.acquire()) {
        err << lock.error() << "\n";
        return 4;
    }
    UsersRead read = readUsersFile(cfg.usersFile, /*enforceMode=*/false);
    if (const int code = check(read); code != 0) return code;
    const UsersFile file = read.status == UsersStatus::Ok ? std::move(read.file) : UsersFile{};
    const Account* current = file.find(name);
    const std::string now = env.nowIso ? env.nowIso() : utcIsoNow();

    Change c;
    c.target = name;
    c.file = file;
    AccountEditError e = AccountEditError::None;
    switch (a.command) {
        case Command::Add:
            e = addAccount(c.file, name, *role, phc, now);
            c.action = AuditAction::AccountCreate;
            c.detail["role"] = roleName(*role);
            c.done = "đã tạo tài khoản " + name + " (" + roleName(*role) + ")";
            break;
        case Command::Passwd: {
            e = setAccountPassword(c.file, name, phc, now);
            c.action = AuditAction::AccountPassword;
            c.done = "đã đặt mật khẩu mới cho " + name + "; các phiên đang mở của tài khoản bị hủy";
            break;
        }
        case Command::Role:
            if (current->role == *role) {
                out << name << " đã có role " << roleName(*role) << ": không đổi gì\n";
                return 0;
            }
            e = setAccountRole(c.file, name, *role, now);
            c.action = AuditAction::AccountRole;
            c.detail = {{"from", roleName(current->role)}, {"to", roleName(*role)}};
            c.done = "đã đổi role của " + name + ": " + roleName(current->role) + " → " +
                     roleName(*role) + "; các phiên đang mở của tài khoản bị hủy";
            break;
        case Command::Disable:
        case Command::Enable: {
            const bool enable = a.command == Command::Enable;
            if (current->enabled == enable) {
                out << name << (enable ? " đang bật" : " đã tắt") << ": không đổi gì\n";
                return 0;
            }
            e = setAccountEnabled(c.file, name, enable, now);
            c.action = enable ? AuditAction::AccountEnable : AuditAction::AccountDisable;
            c.done = enable
                         ? "đã bật tài khoản " + name
                         : "đã tắt tài khoản " + name + "; các phiên đang mở của tài khoản bị hủy";
            break;
        }
        case Command::Unlock:
            e = unlockAccount(c.file, name, now);
            c.action = AuditAction::AccountUnlock;
            c.done = "đã mở khóa tạm của " + name +
                     " ở mọi địa chỉ (runtime đọc lại file trong 2 s); khóa theo IP: "
                     "--user-unlock-all";
            break;
        case Command::UnlockAll:
        case Command::List:
        case Command::None:
            return 2;
    }
    if (e != AccountEditError::None) return refuse(e);
    return commit(env, cfg, c, out, err);
}

}  // namespace mat
