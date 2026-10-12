#include "server/cli/set_secret.hpp"

#include <termios.h>
#include <unistd.h>

#include <algorithm>
#include <iostream>
#include <string>
#include <vector>

#include "core/historian/secrets.hpp"
#include "server/config.hpp"

namespace mat {

namespace {

// Terminal echo off while the secret is typed (only when reading the real stdin from a TTY).
class EchoOff {
   public:
    explicit EchoOff(bool active) {
        if (!active || !::isatty(STDIN_FILENO) || ::tcgetattr(STDIN_FILENO, &old_) != 0) return;
        termios t = old_;
        t.c_lflag &= ~static_cast<tcflag_t>(ECHO);
        on_ = ::tcsetattr(STDIN_FILENO, TCSAFLUSH, &t) == 0;
    }
    ~EchoOff() {
        if (on_) ::tcsetattr(STDIN_FILENO, TCSAFLUSH, &old_);
    }
    EchoOff(const EchoOff&) = delete;
    EchoOff& operator=(const EchoOff&) = delete;
    bool on() const { return on_; }

   private:
    termios old_{};
    bool on_ = false;
};

}  // namespace

int runSetSecretCli(int argc, char** argv, std::istream& in, std::ostream& out, std::ostream& err,
                    bool isRoot) {
    std::string id, file, configPath;
    bool haveFile = false, haveConfig = false;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        auto next = [&](std::string& dst) {
            if (i + 1 >= argc || std::string(argv[i + 1]).rfind("--", 0) == 0) return false;
            dst = argv[++i];
            return true;
        };
        bool ok = true;
        if (a == "--set-secret") {
            ok = next(id);
        } else if (a == "--secrets-file") {
            ok = haveFile = next(file);
        } else if (a == "--config") {
            ok = haveConfig = next(configPath);
        } else {
            err << "tham số không hỗ trợ: " << a << "\n";
            return 4;
        }
        if (!ok) {
            err << a << " cần một giá trị\n";
            return 4;
        }
    }
    if (!isRoot) {
        err << "cần chạy bằng root (sudo): file bí mật thuộc root:matscada\n";
        return 4;
    }
    if (!validConnectionId(id)) {
        err << "id kết nối không hợp lệ: '" << id
            << "' (chữ thường, số, gạch ngang; như trong logging.json)\n";
        return 4;
    }
    if (!haveFile) {  // secretsFile of runtime.json, as the service sees it
        std::vector<std::string> args{"mat-runtime"};
        if (haveConfig) args.insert(args.end(), {"--config", configPath});
        std::vector<char*> cargv;
        for (auto& s : args) cargv.push_back(&s[0]);
        const auto cr = loadConfig(static_cast<int>(cargv.size()), cargv.data(),
                                   [](const std::string& p) { return readTextFile(p); });
        if (!cr.ok) {
            err << "config: " << cr.error << "\n";
            return 4;
        }
        file = cr.cfg.secretsFile;
    }

    const bool interactive = &in == &std::cin && ::isatty(STDIN_FILENO);
    EchoOff echo(interactive);
    if (interactive) err << "Mật khẩu/token của kết nối " << id << ": " << std::flush;
    std::string secret;
    std::getline(in, secret);
    if (interactive) err << "\n";
    if (!secret.empty() && secret.back() == '\r') secret.pop_back();
    if (secret.empty()) {
        err << "không có mật khẩu/token (dòng đầu của stdin rỗng): không ghi gì\n";
        return 4;
    }
    std::string e, warning;
    const bool written = writeSecret(file, id, secret, e, &warning);
    std::fill(secret.begin(), secret.end(), '\0');
    if (!written) {
        err << e << "\n";
        return 4;
    }
    out << "đã lưu bí mật của kết nối " << id << " vào " << file << "\n";
    if (!warning.empty()) err << "cảnh báo: " << warning << "\n";
    return 0;
}

}  // namespace mat
