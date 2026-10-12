#include "server/cli/cert.hpp"

#include <cstring>
#include <string>
#include <vector>

#include "core/common/json_text.hpp"
#include "nlohmann/json.hpp"
#include "server/tls/server_cert.hpp"

namespace mat {

namespace {

enum class Command { None, Fingerprint, Regen };

bool parse(int argc, char** argv, Command& command, std::vector<std::string>& overrides,
           std::string& error) {
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--cert-fingerprint" || arg == "--regen-cert") {
            if (command != Command::None) {
                error = "mỗi lần chạy chỉ một lệnh: --cert-fingerprint hoặc --regen-cert";
                return false;
            }
            command = arg == "--regen-cert" ? Command::Regen : Command::Fingerprint;
        } else if (arg == "--config" || arg == "--data-dir") {
            if (i + 1 >= argc || std::strncmp(argv[i + 1], "--", 2) == 0) {
                error = arg + " cần một giá trị";
                return false;
            }
            overrides.insert(overrides.end(), {arg, argv[++i]});
        } else {
            const size_t eq = arg.find('=');
            error = "tham số không hỗ trợ: " +
                    (arg.rfind("--", 0) == 0 ? arg.substr(0, eq) : std::string("một giá trị thừa"));
            return false;
        }
    }
    if (command == Command::None) {
        error = "thiếu lệnh --cert-fingerprint hoặc --regen-cert";
        return false;
    }
    return true;
}

std::string fingerprintLine(const ServerCert& c) {
    return "SHA256 Fingerprint=" + c.fingerprintColons;
}

int regenerate(const DeviceCliEnv& env, const RuntimeConfig& cfg, std::ostream& out,
               std::ostream& err) {
    const AuditOptions ao = deviceCliAuditOptions(cfg, env);
    const ServerCert old = readServerCert(cfg.dataDir);  // its fingerprint goes in the record
    nlohmann::json detail = {{"from", old.ok ? nlohmann::json(old.fingerprint) : nullptr}};
    AuditEvent event(AuditAction::CertRegenerate, AuditResult::Started, AuditChannel::Cli, "cli");
    event.detail = jsonText(detail);
    std::string e, warning;
    const bool started = appendAuditAsServiceUser(env, ao, event, e, &warning);
    if (!warning.empty()) err << "cảnh báo: " << warning << "\n";
    if (!started) {
        err << "không ghi được audit vào " << cfg.dataDir << "/" << kAuditFileName << ": " << e
            << "\nchứng chỉ giữ nguyên (mã 5)\n";
        return 5;
    }

    // The service user writes the files, so they are its own (0600, directory 0700).
    const ServerCertOptions options{cfg.dataDir, cfg.deviceName,
                                    env.hostname ? env.hostname() : systemHostname()};
    const ChildResult made = runAsServiceUser(env, [&](std::string& message) {
        const ServerCert c = regenerateServerCert(options);
        message = c.ok ? c.fingerprint : c.error;
        return c.ok ? 0 : 4;
    });
    const ServerCert now = made.status == 0 ? readServerCert(cfg.dataDir) : ServerCert{};
    const bool ok = made.status == 0 && now.ok && now.fingerprint == made.message;
    const std::string why = made.status != 0
                                ? made.message
                                : !now.ok ? now.error : "chứng chỉ đọc lại khác chứng chỉ vừa ghi";

    AuditEvent result = event;
    result.result = ok ? AuditResult::Ok : AuditResult::Failed;
    if (ok) {
        detail["to"] = now.fingerprint;
    } else {
        result.code = "CERT_WRITE_FAILED";
        detail["error"] = why;
    }
    result.detail = jsonText(detail);
    std::string resultError;
    const bool recorded = appendAuditAsServiceUser(env, ao, result, resultError);
    if (!ok) {
        err << "không tạo được chứng chỉ mới trong " << cfg.dataDir << "/tls: " << why << "\n";
        if (!recorded) err << "cũng không ghi được kết quả vào audit: " << resultError << "\n";
        return 4;
    }

    out << "đã tạo khóa và chứng chỉ mới cho thiết bị\n"
        << fingerprintLine(now) << "\n"
        << "Studio đã ghim fingerprint cũ sẽ chặn thiết bị này tới khi kỹ sư gỡ ghim và ghim lại; "
           "khi ghim, so fingerprint Studio hiện với dòng trên\n";
    if (!recorded)
        err << "cảnh báo: không ghi được kết quả vào audit (đã có bản ghi started): " << resultError
            << "\n";
    out.flush();
    err.flush();
    const std::vector<std::string> restart{"systemctl", "try-restart", "mat-runtime"};
    const int status = env.runCommand ? env.runCommand(restart) : runProgram(restart);
    if (status != 0) {
        err << "cảnh báo: "
            << (status == 127
                    ? std::string("không chạy được systemctl")
                    : "systemctl try-restart mat-runtime trả mã " + std::to_string(status))
            << ": runtime dùng chứng chỉ cũ tới lần khởi động sau; chạy systemctl restart "
               "mat-runtime\n";
    } else {
        out << "đã khởi động lại mat-runtime (nếu đang chạy) để dùng chứng chỉ mới\n";
    }
    return 0;
}

}  // namespace

bool isCertCommand(int argc, char** argv) {
    for (int i = 1; i < argc; ++i)
        if (std::strcmp(argv[i], "--cert-fingerprint") == 0 ||
            std::strcmp(argv[i], "--regen-cert") == 0)
            return true;
    return false;
}

int runCertCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
               std::ostream& err) {
    Command command = Command::None;
    std::vector<std::string> overrides;
    std::string error;
    if (!parse(argc, argv, command, overrides, error)) {
        err << error << "\n";
        return 2;
    }
    if (command == Command::Regen && !env.isRoot) {
        err << "cần chạy bằng root: --regen-cert ghi audit và thay khóa của thiết bị\n";
        return 4;
    }
    RuntimeConfig cfg;
    if (!loadDeviceCliConfig(overrides, env, cfg, error)) {
        err << "config: " << error << "\n";
        return 2;
    }
    if (command == Command::Regen) return regenerate(env, cfg, out, err);

    const ServerCert c = readServerCert(cfg.dataDir);  // only reads
    if (!c.ok) {
        err << "không có fingerprint: " << c.error
            << "\n(runtime tạo chứng chỉ ở lần chạy đầu; chứng chỉ hỏng thì tạo lại bằng "
               "--regen-cert)\n";
        return 6;
    }
    out << fingerprintLine(c) << "\n";
    return 0;
}

}  // namespace mat
