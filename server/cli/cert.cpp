#include "server/cli/cert.hpp"

#include <sys/stat.h>

#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "core/common/json_text.hpp"
#include "nlohmann/json.hpp"
#include "server/tls/server_cert.hpp"

namespace mat {

namespace {

enum class Command { None, Fingerprint, Regen, Info, Csr, Import };

struct Args {
    Command command = Command::None;
    std::vector<std::string> overrides;  // --config, --data-dir
    bool hasSan = false;
    std::string san;  // value of --san
    std::string out;  // --out of --make-csr
    std::string importFile;
};

bool isOption(const char* s) { return std::strncmp(s, "--", 2) == 0; }

bool parse(int argc, char** argv, Args& a, std::string& error) {
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        Command c = Command::None;
        if (arg == "--cert-fingerprint")
            c = Command::Fingerprint;
        else if (arg == "--regen-cert")
            c = Command::Regen;
        else if (arg == "--cert-info")
            c = Command::Info;
        else if (arg == "--make-csr")
            c = Command::Csr;
        else if (arg == "--import-cert")
            c = Command::Import;
        if (c != Command::None) {
            if (a.command != Command::None) {
                error =
                    "mỗi lần chạy chỉ một lệnh: --cert-fingerprint, --cert-info, --regen-cert, "
                    "--make-csr hoặc --import-cert";
                return false;
            }
            a.command = c;
            if (c == Command::Import) {
                if (i + 1 >= argc || isOption(argv[i + 1])) {
                    error = "--import-cert cần tệp chứng chỉ (PEM)";
                    return false;
                }
                a.importFile = argv[++i];
            }
        } else if (arg == "--config" || arg == "--data-dir") {
            if (i + 1 >= argc || isOption(argv[i + 1])) {
                error = arg + " cần một giá trị";
                return false;
            }
            a.overrides.insert(a.overrides.end(), {arg, argv[++i]});
        } else if (arg == "--san" || arg == "--out") {
            if (i + 1 >= argc || (arg == "--out" && isOption(argv[i + 1]))) {
                error = arg + " cần một giá trị";
                return false;
            }
            if (arg == "--san") {
                a.hasSan = true;
                a.san = argv[++i];
            } else {
                a.out = argv[++i];
            }
        } else {
            const size_t eq = arg.find('=');
            error = "tham số không hỗ trợ: " +
                    (arg.rfind("--", 0) == 0 ? arg.substr(0, eq) : std::string("một giá trị thừa"));
            return false;
        }
    }
    if (a.command == Command::None) {
        error =
            "thiếu lệnh --cert-fingerprint, --cert-info, --regen-cert, --make-csr hoặc "
            "--import-cert";
        return false;
    }
    if (a.hasSan && a.command != Command::Regen && a.command != Command::Csr) {
        error = "--san chỉ dùng với --regen-cert hoặc --make-csr";
        return false;
    }
    if (!a.out.empty() && a.command != Command::Csr) {
        error = "--out chỉ dùng với --make-csr";
        return false;
    }
    return true;
}

std::string fingerprintLine(const ServerCert& c) {
    return "SHA256 Fingerprint=" + c.fingerprintColons;
}

std::string sanText(const CertDetails& d) {
    std::string out;
    for (const std::string& n : d.sanDns) out += (out.empty() ? "" : ", ") + ("DNS:" + n);
    for (const std::string& n : d.sanIps) out += (out.empty() ? "" : ", ") + ("IP:" + n);
    return out.empty() ? "không có" : out;
}

std::vector<std::string> cardAddresses(const DeviceCliEnv& env) {
    return env.ipv4Addresses ? env.ipv4Addresses() : systemIpv4Addresses();
}

// "20261020T030000Z" from "2026-10-20T03:00:00Z" (the name of the request file).
std::string compactStamp(const std::string& iso) {
    std::string s;
    for (const char c : iso)
        if (c != '-' && c != ':') s += c;
    return s;
}

int info(const RuntimeConfig& cfg, std::ostream& out, std::ostream& err) {
    const ServerCert c = readServerCert(cfg.dataDir);  // only reads
    if (!c.ok) {
        err << "không đọc được chứng chỉ: " << c.error
            << "\n(runtime tạo chứng chỉ ở lần chạy đầu; chứng chỉ hỏng thì tạo lại bằng "
               "--regen-cert)\n";
        return 6;
    }
    out << "Chủ thể:  " << c.cert.subject << "\n"
        << "Người ký: "
        << (c.cert.selfSigned ? std::string("tự ký (không có CA)") : "CA " + c.cert.issuer) << "\n"
        << "SAN:      " << sanText(c.cert) << "\n"
        << "Hiệu lực: " << c.cert.notBefore << " đến " << c.cert.notAfter << " (UTC)\n"
        << "Chuỗi:    " << c.cert.chainLength << " chứng chỉ trong tệp\n"
        << fingerprintLine(c) << "\n";
    return 0;
}

// The options of a new certificate or request: the host name, the cards and --san (added to them
// for a certificate; for a request --san replaces them, as the engineer names what the CA signs).
ServerCertOptions certOptions(const DeviceCliEnv& env, const RuntimeConfig& cfg,
                              const std::vector<SanEntry>& extra, bool replaceDefaults) {
    ServerCertOptions o;
    o.dataDir = cfg.dataDir;
    o.deviceName = cfg.deviceName;
    if (!replaceDefaults) {
        o.hostname = env.hostname ? env.hostname() : systemHostname();
        o.ipAddresses = cardAddresses(env);
    }
    o.extraSans = extra;
    return o;
}

int regenerate(const DeviceCliEnv& env, const RuntimeConfig& cfg, const ServerCertOptions& options,
               std::ostream& out, std::ostream& err) {
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
        detail["san"] = nlohmann::json{{"dns", now.cert.sanDns}, {"ip", now.cert.sanIps}};
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
        << "SAN: " << sanText(now.cert) << "\n"
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

// The names a request will hold, for the audit record ("DNS:x", "IP:y").
nlohmann::json sanNames(const ServerCertOptions& o) {
    nlohmann::json names = nlohmann::json::array();
    if (!o.hostname.empty()) names.push_back("DNS:" + o.hostname);
    for (const std::string& ip : o.ipAddresses) names.push_back("IP:" + ip);
    for (const SanEntry& e : o.extraSans) names.push_back((e.ip ? "IP:" : "DNS:") + e.text);
    return names;
}

// --make-csr: audit `tls.csr` started; the key and the request are written by the service user;
// the certificate in use and the runtime are left alone.
int makeCsr(const DeviceCliEnv& env, const RuntimeConfig& cfg, const ServerCertOptions& options,
            const std::string& outFile, std::ostream& out, std::ostream& err) {
    const AuditOptions ao = deviceCliAuditOptions(cfg, env);
    nlohmann::json detail = {{"san", sanNames(options)}};
    AuditEvent event(AuditAction::TlsCsr, AuditResult::Started, AuditChannel::Cli, "cli");
    event.detail = jsonText(detail);
    std::string e, warning;
    const bool started = appendAuditAsServiceUser(env, ao, event, e, &warning);
    if (!warning.empty()) err << "cảnh báo: " << warning << "\n";
    if (!started) {
        err << "không ghi được audit vào " << cfg.dataDir << "/" << kAuditFileName << ": " << e
            << "\nkhông tạo khóa và yêu cầu (mã 5)\n";
        return 5;
    }
    const std::string stamp = compactStamp(env.nowIso ? env.nowIso() : utcIsoNow());
    const ChildResult made = runAsServiceUser(env, [&](std::string& message) {
        const CsrResult c = makeServerCsr(options, stamp);
        message = c.ok ? c.csrPem : c.error;
        return c.ok ? 0 : 4;
    });
    const bool ok = made.status == 0;
    const std::string csrFile = cfg.dataDir + "/tls/csr-" + stamp + ".pem";
    AuditEvent result = event;
    result.result = ok ? AuditResult::Ok : AuditResult::Failed;
    if (ok) {
        detail["csr"] = csrFile;
    } else {
        result.code = "CSR_WRITE_FAILED";
        detail["error"] = made.message;
    }
    result.detail = jsonText(detail);
    std::string resultError;
    const bool recorded = appendAuditAsServiceUser(env, ao, result, resultError);
    if (!ok) {
        err << "không tạo được yêu cầu chứng chỉ: " << made.message << "\n";
        if (!recorded) err << "cũng không ghi được kết quả vào audit: " << resultError << "\n";
        return 4;
    }
    if (!recorded)
        err << "cảnh báo: không ghi được kết quả vào audit (đã có bản ghi started): " << resultError
            << "\n";
    if (outFile.empty()) {
        out << made.message;  // the request only: it can be redirected to a file
    } else {
        std::ofstream f(outFile, std::ios::binary | std::ios::trunc);
        f << made.message;
        f.flush();
        if (!f) {
            err << "không ghi được " << outFile << " (yêu cầu vẫn nằm ở " << csrFile << ")\n";
            return 4;
        }
        f.close();
        ::chmod(outFile.c_str(), 0644);
        out << "đã ghi yêu cầu chứng chỉ vào " << outFile << "\n";
    }
    err << "yêu cầu chứng chỉ (không bí mật) cũng nằm ở " << csrFile << "\nkhóa riêng nằm ở "
        << cfg.dataDir
        << "/tls/pending-key.pem và không rời thiết bị; gửi yêu cầu cho CA, rồi nhập chứng chỉ do "
           "CA ký bằng --import-cert\n";
    return 0;
}

// --import-cert (device-config-007 §2).
int importCert(const DeviceCliEnv& env, const RuntimeConfig& cfg, const std::string& file,
               std::ostream& out, std::ostream& err) {
    struct stat st {};
    if (::stat(file.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) {
        err << "không đọc được tệp " << file << "\n";
        return 2;
    }
    if (st.st_size > 64 * 1024) {
        err << file << " quá lớn cho một tệp chứng chỉ\n";
        return 2;
    }
    std::ifstream in(file, std::ios::binary);
    const std::string text((std::istreambuf_iterator<char>(in)), {});
    if (!in && !in.eof()) {
        err << "không đọc được tệp " << file << "\n";
        return 2;
    }
    // A private key in the file is refused before anything is written or audited: it must not be
    // sent anywhere (the key of a request never leaves the device).
    if (text.find("PRIVATE KEY-----") != std::string::npos) {
        err << "tệp có khối khóa riêng: không gửi khóa riêng; chứng chỉ chỉ gồm phần công khai "
               "(chứng chỉ máy chủ rồi chuỗi CA)\n";
        return 2;
    }

    const AuditOptions ao = deviceCliAuditOptions(cfg, env);
    const ServerCert old = readServerCert(cfg.dataDir);
    nlohmann::json detail = {{"from", old.ok ? nlohmann::json(old.fingerprint) : nullptr}};
    AuditEvent event(AuditAction::TlsImport, AuditResult::Started, AuditChannel::Cli, "cli");
    event.detail = jsonText(detail);
    std::string e, warning;
    const bool started = appendAuditAsServiceUser(env, ao, event, e, &warning);
    if (!warning.empty()) err << "cảnh báo: " << warning << "\n";
    if (!started) {
        err << "không ghi được audit vào " << cfg.dataDir << "/" << kAuditFileName << ": " << e
            << "\nchứng chỉ giữ nguyên (mã 5)\n";
        return 5;
    }

    ImportOptions options;
    options.dataDir = cfg.dataDir;
    options.hostname = env.hostname ? env.hostname() : systemHostname();
    options.ipAddresses = cardAddresses(env);
    const ChildResult made = runAsServiceUser(env, [&](std::string& message) {
        const ImportResult r = importServerCert(options, text);
        nlohmann::json j = {{"error", r.error},
                            {"warnings", r.warnings},
                            {"fingerprint", r.fingerprint},
                            {"colons", r.fingerprintColons}};
        message = jsonText(j);
        return r.code;
    });
    ImportResult r;
    r.code = made.status < 0 ? 4 : made.status;
    const nlohmann::json j = nlohmann::json::parse(made.message, nullptr, false);
    if (j.is_object()) {
        r.error = j.value("error", "");
        r.warnings = j.value("warnings", std::vector<std::string>{});
        r.fingerprint = j.value("fingerprint", "");
        r.fingerprintColons = j.value("colons", "");
    } else {
        r.error = made.message.empty() ? "không nhập được chứng chỉ" : made.message;
    }
    const bool ok = r.code == 0 && !r.fingerprint.empty();
    const ServerCert now = ok ? readServerCert(cfg.dataDir) : ServerCert{};
    AuditEvent result = event;
    result.result = ok ? AuditResult::Ok : AuditResult::Failed;
    if (ok) {
        detail["to"] = r.fingerprint;
        detail["warnings"] = r.warnings;
    } else {
        result.code = r.code == 2 ? "CERT_FILE_INVALID"
                                  : r.code == 3 ? "CERT_KEY_MISMATCH" : "CERT_WRITE_FAILED";
        detail["error"] = r.error;
    }
    result.detail = jsonText(detail);
    std::string resultError;
    const bool recorded = appendAuditAsServiceUser(env, ao, result, resultError);
    if (!ok) {
        err << (r.error.empty() ? "không nhập được chứng chỉ" : r.error) << "\n";
        if (!recorded) err << "cũng không ghi được kết quả vào audit: " << resultError << "\n";
        return r.code == 0 ? 4 : r.code;
    }
    for (const std::string& w : r.warnings) err << "cảnh báo: " << w << "\n";
    if (!recorded)
        err << "cảnh báo: không ghi được kết quả vào audit (đã có bản ghi started): " << resultError
            << "\n";
    out << "đã nhập chứng chỉ; bản trước giữ ở " << cfg.dataDir << "/tls/server.pem.prev\n"
        << "SHA256 Fingerprint=" << r.fingerprintColons << "\n";
    if (now.ok) out << "Người ký: " << (now.cert.selfSigned ? "tự ký" : now.cert.issuer) << "\n";
    out << "chạy systemctl restart mat-runtime để dùng chứng chỉ mới; Studio phải ghim lại "
           "fingerprint (kỹ sư so với dòng trên)\n";
    return 0;
}

}  // namespace

bool isCertCommand(int argc, char** argv) {
    for (int i = 1; i < argc; ++i)
        if (std::strcmp(argv[i], "--cert-fingerprint") == 0 ||
            std::strcmp(argv[i], "--regen-cert") == 0 || std::strcmp(argv[i], "--cert-info") == 0 ||
            std::strcmp(argv[i], "--make-csr") == 0 || std::strcmp(argv[i], "--import-cert") == 0)
            return true;
    return false;
}

int runCertCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
               std::ostream& err) {
    Args a;
    std::string error;
    if (!parse(argc, argv, a, error)) {
        err << error << "\n";
        return 2;
    }
    std::vector<SanEntry> extra;
    if (a.hasSan && !parseSanList(a.san, extra, error)) {
        err << error << "\n";
        return 2;
    }
    const bool writes =
        a.command == Command::Regen || a.command == Command::Csr || a.command == Command::Import;
    if (writes && !env.isRoot) {
        err << "cần chạy bằng root: lệnh này ghi audit và đổi khóa hay chứng chỉ của thiết bị\n";
        return 4;
    }
    RuntimeConfig cfg;
    if (!loadDeviceCliConfig(a.overrides, env, cfg, error)) {
        err << "config: " << error << "\n";
        return 2;
    }
    switch (a.command) {
        case Command::Regen:
            return regenerate(env, cfg, certOptions(env, cfg, extra, false), out, err);
        case Command::Csr:
            return makeCsr(env, cfg, certOptions(env, cfg, extra, a.hasSan), a.out, out, err);
        case Command::Import:
            return importCert(env, cfg, a.importFile, out, err);
        case Command::Info:
            return info(cfg, out, err);
        default:
            break;
    }
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
