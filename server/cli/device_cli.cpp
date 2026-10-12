#include "server/cli/device_cli.hpp"

#include <fcntl.h>
#include <grp.h>
#include <pwd.h>
#include <spawn.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <ctime>
#include <exception>
#include <utility>

extern char** environ;

namespace mat {

namespace {

constexpr size_t kChildMessageMax = 4096;
constexpr int kChildFailed = 70;       // fn threw, or the child could not run it
constexpr int kChildNotSwitched = 71;  // the switch to the service user failed

bool writeAll(int fd, const char* p, size_t n) {
    while (n > 0) {
        const ssize_t w = ::write(fd, p, n);
        if (w < 0) {
            if (errno == EINTR) continue;
            return false;
        }
        p += w;
        n -= static_cast<size_t>(w);
    }
    return true;
}

struct ServiceAccount {
    bool found = false;
    uid_t uid = 0;
    gid_t gid = 0;
};

ServiceAccount lookUpUser(const std::string& name) {
    ServiceAccount a;
    passwd pw{};
    passwd* result = nullptr;
    std::vector<char> buf(16384);
    if (::getpwnam_r(name.c_str(), &pw, buf.data(), buf.size(), &result) == 0 && result) {
        a.found = true;
        a.uid = pw.pw_uid;
        a.gid = pw.pw_gid;
    }
    return a;
}

// In the child: the service user for good (no supplementary group, no way back to root).
bool switchTo(const ServiceAccount& a, std::string& why) {
    if (::setgroups(0, nullptr) != 0) {
        why = std::string("setgroups: ") + std::strerror(errno);
        return false;
    }
    if (::setgid(a.gid) != 0) {
        why = std::string("setgid: ") + std::strerror(errno);
        return false;
    }
    if (::setuid(a.uid) != 0) {
        why = std::string("setuid: ") + std::strerror(errno);
        return false;
    }
    if (a.uid != 0 && (::setuid(0) == 0 || ::geteuid() == 0 || ::getegid() != a.gid)) {
        why = "vẫn lấy lại được quyền root";
        return false;
    }
    return true;
}

}  // namespace

std::string utcIsoNow() {
    const std::time_t t = std::time(nullptr);
    std::tm tm{};
    ::gmtime_r(&t, &tm);
    char buf[32];
    std::strftime(buf, sizeof buf, "%Y-%m-%dT%H:%M:%SZ", &tm);
    return buf;
}

int runProgram(const std::vector<std::string>& argv) {
    if (argv.empty()) return 127;
    std::vector<char*> args;
    for (const auto& a : argv) args.push_back(const_cast<char*>(a.c_str()));
    args.push_back(nullptr);
    pid_t pid = 0;
    if (::posix_spawnp(&pid, args[0], nullptr, nullptr, args.data(), environ) != 0) return 127;
    int status = 0;
    while (::waitpid(pid, &status, 0) < 0)
        if (errno != EINTR) return 127;
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
    return 127;
}

DeviceCliEnv systemDeviceCliEnv() {
    DeviceCliEnv e;
    e.isRoot = ::geteuid() == 0;
    e.inFd = STDIN_FILENO;
    e.nowIso = utcIsoNow;
    e.hostname = systemHostname;
    e.runCommand = runProgram;
    return e;
}

bool loadDeviceCliConfig(const std::vector<std::string>& overrides, const DeviceCliEnv& env,
                         RuntimeConfig& cfg, std::string& error) {
    std::vector<std::string> args{"mat-runtime"};
    args.insert(args.end(), overrides.begin(), overrides.end());
    std::vector<char*> argv;
    for (auto& s : args) argv.push_back(&s[0]);
    const ConfigResult cr = loadConfig(
        static_cast<int>(argv.size()), argv.data(),
        [](const std::string& p) { return readTextFile(p); },
        env.hostname ? env.hostname : HostnameFn(systemHostname));
    if (!cr.ok) {
        error = cr.error;
        return false;
    }
    cfg = cr.cfg;
    return true;
}

AuditOptions deviceCliAuditOptions(const RuntimeConfig& cfg, const DeviceCliEnv& env) {
    AuditOptions o;
    o.dataDir = cfg.dataDir;
    o.retentionDays = cfg.auditRetentionDays;
    o.maxBytes = int64_t{cfg.auditMaxMB} * 1024 * 1024;
    o.clock = env.auditClock;
    return o;
}

ChildResult runAsServiceUser(const DeviceCliEnv& env,
                             const std::function<int(std::string& message)>& fn) {
    ChildResult r;
    ServiceAccount account;
    if (::geteuid() == 0) {
        account = lookUpUser(env.serviceUser);
        if (!account.found)
            r.warning = "không có user " + env.serviceUser +
                        ": tiến trình con ghi bằng user đang chạy lệnh (chỉ hợp lệ khi chạy thử; "
                        "trên thiết bị, deploy.sh tạo user này)";
    }
    int p[2];
    if (::pipe2(p, O_CLOEXEC) != 0) {
        r.message = std::string("pipe: ") + std::strerror(errno);
        return r;
    }
    const pid_t pid = ::fork();
    if (pid < 0) {
        r.message = std::string("fork: ") + std::strerror(errno);
        ::close(p[0]);
        ::close(p[1]);
        return r;
    }
    if (pid == 0) {
        ::close(p[0]);
        std::string message;
        int code = kChildFailed;
        std::string why;
        if (account.found && !switchTo(account, why)) {
            message = "không chuyển được sang user " + env.serviceUser + ": " + why;
            code = kChildNotSwitched;
        } else {
            ::umask(077);
            if (::chdir("/") != 0) {
                // the files are reached by absolute paths; the working directory does not matter
            }
            try {
                code = fn(message);
            } catch (const std::exception& e) {
                message = e.what();
                code = kChildFailed;
            } catch (...) {
                message = "lỗi không rõ trong tiến trình con";
                code = kChildFailed;
            }
        }
        if (message.size() > kChildMessageMax) message.resize(kChildMessageMax);
        writeAll(p[1], message.data(), message.size());
        ::_exit(code);  // no atexit handler, no buffer of the parent written twice
    }
    ::close(p[1]);
    char buf[512];
    for (;;) {
        const ssize_t n = ::read(p[0], buf, sizeof buf);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) break;
        if (r.message.size() < kChildMessageMax) r.message.append(buf, static_cast<size_t>(n));
    }
    ::close(p[0]);
    int status = 0;
    while (::waitpid(pid, &status, 0) < 0)
        if (errno != EINTR) break;
    r.status = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
    if (r.status != 0 && r.message.empty())
        r.message = WIFSIGNALED(status)
                        ? "tiến trình con dừng vì tín hiệu " + std::to_string(WTERMSIG(status))
                        : "tiến trình con trả mã " + std::to_string(r.status);
    return r;
}

bool appendAuditAsServiceUser(const DeviceCliEnv& env, const AuditOptions& options,
                              const AuditEvent& event, std::string& error, std::string* warning) {
    const ChildResult c = runAsServiceUser(env, [&](std::string& message) {
        AuditLog log(options);  // its own connection, opened after the switch
        std::string e;
        if (!log.open(e)) {
            message = e;
            return 5;
        }
        try {
            log.append(event);
        } catch (const std::exception& ex) {
            message = ex.what();
            return 5;
        }
        log.close();
        return 0;
    });
    if (warning) *warning = c.warning;
    if (c.status == 0) return true;
    error = c.message;
    return false;
}

}  // namespace mat
