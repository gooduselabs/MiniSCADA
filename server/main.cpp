// mat-runtime: CivetWeb (HTTP for the runtime page, HTTPS for the engineering API) + live protocol
// 1.1.0 + Mock Tag provider + project v0 + tag history (003) + sign-in, audit, discovery (005).
// Contracts: specs/002-vertical-slice/contracts/, specs/003-data-logging/contracts/,
// specs/005-device-online/contracts/ (start-up order: device-config.md §7). Exit codes: 0 ok,
// 1 --check-project invalid, 2 bad configuration, 3 cannot start the web server.
#include <sys/prctl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <atomic>
#include <cerrno>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <memory>
#include <optional>
#include <string>
#include <thread>

#include "core/audit/audit_log.hpp"
#include "core/auth/auth_service.hpp"
#include "core/auth/auth_state.hpp"
#include "core/historian/historian.hpp"
#include "core/historian/status.hpp"
#include "core/package/project_digest.hpp"
#include "core/project-manager/project_validator.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "drivers/simulation/mock_tag_provider.hpp"
#include "server/cli/auth_bench.hpp"
#include "server/cli/cert.hpp"
#include "server/cli/export_history.hpp"
#include "server/cli/package.hpp"
#include "server/cli/set_secret.hpp"
#include "server/cli/users.hpp"
#include "server/config.hpp"
#include "server/device_state.hpp"
#include "server/discovery/discovery_server.hpp"
#include "server/http/engineering_api.hpp"
#include "server/http/http_api.hpp"
#include "server/http/web_contexts.hpp"
#include "server/startup.hpp"
#include "server/tls/server_cert.hpp"
#include "server/tls/tls_init.hpp"
#include "server/websocket/civet_transport.hpp"
#include "server/websocket/live_hub.hpp"

namespace {

std::atomic<bool> g_run{true};
void onSignal(int) { g_run = false; }

int64_t epochMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}
int64_t monoMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

std::string exeDir() {
    char buf[4096];
    const ssize_t n = readlink("/proc/self/exe", buf, sizeof buf - 1);
    if (n <= 0) return ".";
    std::string p(buf, static_cast<size_t>(n));
    const auto slash = p.rfind('/');
    return slash == std::string::npos ? "." : p.substr(0, slash);
}

bool hasArg(int argc, char** argv, const char* name) {
    for (int i = 1; i < argc; ++i)
        if (std::strcmp(argv[i], name) == 0) return true;
    return false;
}

// mkdir -p with 0700 (systemd's StateDirectory creates it on the device; x64 runs do not).
bool ensureDir(const std::string& dir) {
    for (size_t pos = 1; pos <= dir.size(); ++pos) {
        if (pos != dir.size() && dir[pos] != '/') continue;
        const std::string part = dir.substr(0, pos);
        if (::mkdir(part.c_str(), 0700) != 0 && errno != EEXIST) return false;
    }
    struct stat st {};
    return ::stat(dir.c_str(), &st) == 0 && S_ISDIR(st.st_mode);
}

// The audit log on the tick thread (core/audit/audit_log.hpp): counts of the coalesced 60 s windows
// every few seconds, retention and size cap once a day.
constexpr int64_t kAuditFlushMs = 5000;
constexpr int64_t kAuditMaintainMs = 24LL * 60 * 60 * 1000;
constexpr int64_t kAuditErrorLogMs = 60000;

}  // namespace

int main(int argc, char** argv) {
    using namespace mat;
    // No core file and no ptrace by the same user: a dump would hold the secrets of the external
    // databases (security review of the fixes; LimitCORE=0 in the unit too).
    ::prctl(PR_SET_DUMPABLE, 0, 0, 0, 0);
    // Device commands (specs/003-data-logging/contracts/device.md); they never open the port and
    // keep the default SIGPIPE: `--export-history … | head` ends quietly when head is done.
    if (hasArg(argc, argv, "--export-history"))
        return runExportHistoryCli(argc, argv, std::cout, std::cerr, epochMs(),
                                   ::isatty(STDOUT_FILENO) != 0);
    if (hasArg(argc, argv, "--check-history"))
        return runCheckHistoryCli(argc, argv, std::cout, std::cerr);
    if (hasArg(argc, argv, "--set-secret"))
        return runSetSecretCli(argc, argv, std::cin, std::cout, std::cerr, ::geteuid() == 0);
    // Feature 005 T095: checks a .matscada package, read-only (contracts/device-config.md §4).
    if (hasArg(argc, argv, "--check-package"))
        return runCheckPackageCli(argc, argv, std::cout, std::cerr, exeDir() + "/../schemas");
    // Feature 005 (contracts/device-config.md §4): accounts, certificate, hash timing. Like the
    // commands above they open no port; the account commands create no AuthService.
    if (isUserCommand(argc, argv))
        return runUserCli(argc, argv, systemDeviceCliEnv(), std::cout, std::cerr);
    if (isCertCommand(argc, argv))
        return runCertCli(argc, argv, systemDeviceCliEnv(), std::cout, std::cerr);
    if (hasArg(argc, argv, "--auth-bench"))
        return runAuthBenchCli(argc, argv, std::cout, std::cerr);
    // Before any thread exists (forwarders, CivetWeb): a peer that closed its socket must give
    // EPIPE, not end the process (review S9).
    std::signal(SIGPIPE, SIG_IGN);

    auto cr = loadConfig(argc, argv, [](const std::string& p) { return readTextFile(p); });
    for (const auto& w : cr.warnings) std::fprintf(stderr, "warning: %s\n", w.c_str());
    if (!cr.ok) {
        std::fprintf(stderr, "config error: %s\n", cr.error.c_str());
        return 2;
    }
    RuntimeConfig cfg = cr.cfg;
    if (cfg.schemasDir.empty()) cfg.schemasDir = exeDir() + "/../schemas";

    const ProjectValidation validation = validateProject(cfg.projectDir, cfg.schemasDir);
    if (cfg.checkProject) {
        std::printf("%s\n", resultJson(validation).c_str());
        return validation.valid ? 0 : 1;
    }

    // device-config §7 step 1: PSA Crypto before any port opens, so that a failure shows now and
    // not at the first TLS 1.3 handshake. Without it HTTPS stays off (tls-error).
    std::string tlsError;
    const bool tlsReady = initTlsCrypto(tlsError);
    if (!tlsReady) std::fprintf(stderr, "tls: %s; HTTPS stays off\n", tlsError.c_str());
    // Step 2: the audit log. Without it the runtime page still runs, but sign-ins and every change
    // of the device are refused (503 AUDIT_UNAVAILABLE).
    AuditOptions auditOptions;
    auditOptions.dataDir = cfg.dataDir;
    auditOptions.retentionDays = cfg.auditRetentionDays;
    auditOptions.maxBytes = int64_t{cfg.auditMaxMB} << 20;
    AuditLog audit(auditOptions);
    {
        std::string err = "cannot create " + cfg.dataDir;
        if (!ensureDir(cfg.dataDir) || !audit.open(err))
            std::fprintf(stderr, "audit: %s; sign-in and changes are refused\n", err.c_str());
    }

    // Tags of the active project; an invalid project is not activated (FR-025), but the page and
    // the system info stay available so the error is visible (server/startup.cpp, T063). Its
    // content digest goes to system/info, projects/active, the live hello and discovery (005).
    std::optional<std::string> digest;
    if (validation.valid) {
        std::string err;
        digest = projectDirDigest(cfg.projectDir, validation.project->files(), &err);
        if (!digest) std::fprintf(stderr, "project digest: %s\n", err.c_str());
    }
    TagStore store;
    const ActiveProject active =
        activateProject(validation, static_cast<size_t>(cfg.maxClients), store, digest);
    if (active.active) {
        std::printf("project '%s' %s active (%zu tags, %s)\n",
                    active.info["projectId"].get<std::string>().c_str(),
                    active.info["projectVersion"].get<std::string>().c_str(), store.size(),
                    active.digest.value_or("no digest").c_str());
    } else {
        std::fprintf(stderr, "project in %s is NOT active:\n%s\n", cfg.projectDir.c_str(),
                     resultJson(validation).c_str());
    }
    MockTagProvider provider(store, cfg.simLoad);

    // Step 5: the sign-in service (its hash thread starts here, after the device commands above
    // have returned), with the sessions and lockouts carried across execv (read, then deleted).
    AuthOptions authOptions;
    authOptions.usersFile = cfg.usersFile;
    authOptions.audit = [&audit](const AuditEvent& e) { audit.append(e); };
    AuthService auth(authOptions);
    auth.loadState(kAuthStateFile);

    // Step 6: device id and certificate. A missing certificate is made (cert.generate); a damaged
    // one is never replaced, since a new key would look like an impersonation: HTTPS stays off
    // (cert-error) until `mat-runtime --regen-cert`.
    const DeviceId deviceId = loadOrCreateDeviceId(cfg.dataDir);
    if (!deviceId.warning.empty())
        std::fprintf(stderr, "device-id: %s\n", deviceId.warning.c_str());
    ServerCert cert;
    if (cfg.httpsPort != 0 && tlsReady) {
        cert = loadOrCreateServerCert({cfg.dataDir, cfg.deviceName, systemHostname()});
        if (!cert.ok)
            std::fprintf(stderr, "certificate: %s; HTTPS stays off (mat-runtime --regen-cert)\n",
                         cert.error.c_str());
        if (cert.generated) {
            AuditEvent e(AuditAction::CertGenerate, AuditResult::Ok, AuditChannel::System,
                         "system");
            e.target = cert.fingerprint;
            try {
                audit.append(e);
            } catch (const std::exception& ex) {
                std::fprintf(stderr, "audit cert.generate not written: %s\n", ex.what());
            }
        }
        if (cert.ok)
            std::printf("certificate%s: SHA256 Fingerprint=%s\n", cert.generated ? " (new)" : "",
                        cert.fingerprintColons.c_str());
    }
    DeviceFacts facts;
    facts.deviceId = deviceId.id;
    facts.name = cfg.deviceName;
    facts.model = cfg.deviceModel;
    facts.httpPort = cfg.port;
    facts.httpsPort = cfg.httpsPort;
    DeviceState device(facts);

    // Tag history (feature 003): only when the active project declares a logging file. A failure
    // here never stops the runtime; it shows in system/info.
    std::unique_ptr<Historian> historian;
    std::string historianError;
    if (validation.valid && !validation.project->logging.is_null()) {
        HistorianOptions ho;
        ho.dataDir = cfg.dataDir;
        ho.commitMs = cfg.historianCommitMs;
        ho.maxDbBytes = int64_t{cfg.historianMaxDbMB} << 20;
        ho.minFreeBytes = int64_t{cfg.historianMinFreeMB} << 20;
        ho.secretsFile = cfg.secretsFile;
        ho.clientLibDir = cfg.clientLibDir;
        historian = std::make_unique<Historian>(
            buildLoggingModel(validation.project->logging, store), store, ho, epochMs, monoMs);
        if (!ensureDir(cfg.dataDir)) {
            historianError = "không tạo được thư mục dữ liệu " + cfg.dataDir;
        } else if (!historian->start(historianError)) {
            historianError = "không mở được lưu trữ: " + historianError;
        } else {
            std::printf("historian: %zu groups → %s/history.db\n", historian->model().groups.size(),
                        cfg.dataDir.c_str());
        }
        if (!historianError.empty())
            std::fprintf(stderr, "historian: %s\n", historianError.c_str());
    }

    CivetLiveTransport::Options to;
    to.maxClients = active.maxClients;
    to.queueBytes = cfg.sendQueueBytes;
    to.heartbeatTimeoutMs = cfg.heartbeatTimeoutMs;
    to.allowedOrigins = cfg.allowedOrigins;
    CivetLiveTransport transport(to, monoMs);

    HubOptions ho;
    ho.serverVersion = kRuntimeVersion;
    ho.maxClients = transport.maxClients();
    ho.timeoutMs = cfg.heartbeatTimeoutMs;
    ho.projectJson = active.helloJson;
    LiveHub hub(store, transport, ho, epochMs, monoMs);
    transport.attach(&hub);

    const int64_t startMs = monoMs();
    HttpApi::Options hopt;
    hopt.docroot = cfg.docroot;
    hopt.projectDir = cfg.projectDir;
    hopt.allowedOrigins = cfg.allowedOrigins;
    hopt.projectAllowlist = active.allowlist;
    hopt.activeProjectJson = active.activeJson;
    hopt.projectErrors = active.errors;
    hopt.device = &device;  // system/info: blocks "device" and "operation" (005)
    // contracts/system-info.md (core/historian/status.cpp). Public page: no host, user, database,
    // URL or secret; W_LOG_* of the active project come from the validator (FR-024).
    HistorianInfoInput historianInput;
    if (historian) {
        historianInput.enabled = true;
        historianInput.groups = historian->model().groups.size();
        historianInput.commitMs = cfg.historianCommitMs;
        historianInput.startError = historianError;
        for (const auto& w : validation.warnings)
            if (w.code.rfind("W_LOG_", 0) == 0) historianInput.warnings.push_back(w.code);
    }
    auto historianInfo = [&]() -> nlohmann::json {
        return historianInfoJson(historianInput,
                                 historian ? historian->status() : HistorianStatus{});
    };
    HttpApi api(hopt, [&] {
        return nlohmann::json{{"runtimeVersion", kRuntimeVersion},
                              {"protocolVersion", kLiveProtocolVersion},
                              {"schemaVersions", {"0.1"}},
                              {"clients", transport.active()},
                              {"maxClients", transport.maxClients()},
                              {"rejectedTotal", transport.rejectedTotal()},
                              {"originRejectedTotal", transport.originRejectedTotal()},
                              {"overflowClosedTotal", hub.overflowClosedTotal()},
                              {"timeoutClosedTotal", transport.timeoutClosedTotal()},
                              {"writeFailedTotal", transport.writeFailedTotal()},
                              {"uptimeS", (monoMs() - startMs) / 1000},
                              {"project", active.info},
                              {"tagCount", store.size()},
                              {"historian", historianInfo()}};
    });

    // The engineering API (device-api §3): on HTTPS; on HTTP its paths answer 403 HTTPS_REQUIRED.
    EngineeringApi engineering(EngineeringApi::Options{}, device, auth, audit);

    std::signal(SIGINT, onSignal);
    std::signal(SIGTERM, onSignal);
    // Step 8: the HTTP context (as in 0.3.0), then the HTTPS context with its own workers. HTTPS
    // failing never stops HTTP: system/info says why (device.https).
    WebContexts web;
    WebOptions wo;
    wo.httpListen = std::to_string(cfg.port);
    wo.httpThreads = cfg.threads;
    wo.httpsListen = cfg.httpsPort != 0 ? std::to_string(cfg.httpsPort) + "s" : "";
    wo.httpsThreads = cfg.httpsThreads;
    std::string webError;
    if (!web.startHttp(wo, webError)) {
        std::fprintf(stderr, "cannot start web server on port %d: %s\n", cfg.port,
                     webError.c_str());
        return 3;
    }
    api.install(web.http());
    engineering.install(web.http());
    transport.install(web.http(), "/api/v1/live");
    HttpsState https = HttpsState::Off;
    if (cfg.httpsPort != 0 && !tlsReady) {
        https = HttpsState::TlsError;
    } else if (cfg.httpsPort != 0) {
        https = web.startHttps(wo, cert, webError);
        if (https == HttpsState::TlsError)
            std::fprintf(stderr, "https: cannot open port %d: %s\n", cfg.httpsPort,
                         webError.c_str());
    }
    device.setHttps(https, cert.fingerprint);
    if (https == HttpsState::Ok) {
        api.install(web.https());
        engineering.install(web.https());
        transport.install(web.https(), "/api/v1/live");  // one limit of 10 sessions for both
    }
    std::printf("mat-runtime %s listening on :%d, https %s%s (maxClients=%zu, docroot=%s)\n",
                kRuntimeVersion, cfg.port, httpsStateName(https),
                https == HttpsState::Ok ? (" on :" + std::to_string(cfg.httpsPort)).c_str() : "",
                transport.maxClients(), cfg.docroot.c_str());

    // ---- Device discovery (feature 005, T060; contracts/discovery.md; device-config §7 step 8).
    // Device id and certificate from step 6; https and fp only while the HTTPS listener runs.
    discovery::DeviceInfo self;  // no secret goes in here (Constitution V)
    self.deviceId = deviceId.id;
    self.name = cfg.deviceName;
    self.model = cfg.deviceModel;
    self.runtime = kRuntimeVersion;
    self.api = kDeviceApiVersion;
    self.httpPort = cfg.port;
    if (https == HttpsState::Ok) {
        self.httpsPort = cfg.httpsPort;
        self.fingerprint = cert.fingerprint;
    }
    if (active.active) {
        const nlohmann::json& p = validation.project->project;
        self.status = discovery::DeviceStatus::Running;
        self.project = discovery::ProjectInfo{p.value("projectId", ""), p.value("projectName", ""),
                                              p.value("projectVersion", ""), active.digest};
    } else {
        self.status = active.info.value("status", "") == "missing"
                          ? discovery::DeviceStatus::NoProject
                          : discovery::DeviceStatus::ProjectError;
    }
    DiscoveryServer discoveryServer({cfg.discoveryEnabled, cfg.discoveryPort},
                                    [self] { return self; });
    std::string discoveryError;
    if (!discoveryServer.start(discoveryError))
        std::fprintf(stderr, "discovery: %s\n", discoveryError.c_str());
    else if (discoveryServer.running())
        std::printf("discovery: udp port %d\n", discoveryServer.port());
    else
        std::printf("discovery: off (discoveryEnabled = false)\n");
    device.setDiscovery(discoveryServer.running());  // system/info.device.discovery
    // ---- end of device discovery
    std::fflush(stdout);

    auto next = std::chrono::steady_clock::now();
    int64_t nextAuditFlush = monoMs() + kAuditFlushMs;
    int64_t nextAuditMaintain = monoMs() + kAuditMaintainMs;  // open() ran it once
    int64_t lastAuditError = -kAuditErrorLogMs;
    while (g_run) {
        next += std::chrono::milliseconds(cfg.deltaPeriodMs);
        std::this_thread::sleep_until(next);
        provider.step(epochMs());
        hub.tick();
        transport.expire();
        const int64_t now = monoMs();
        if (audit.isOpen() && now >= nextAuditFlush) {
            nextAuditFlush = now + kAuditFlushMs;
            std::string error;
            try {
                audit.flushExpired();  // counts of the 60 s windows that are over
            } catch (const std::exception& ex) {
                error = ex.what();
            }
            if (now >= nextAuditMaintain) {
                nextAuditMaintain = now + kAuditMaintainMs;
                const AuditMaintenance m = audit.maintain(epochMs());
                if (error.empty()) error = m.error;
            }
            if (!error.empty() && now - lastAuditError >= kAuditErrorLogMs) {
                lastAuditError = now;
                std::fprintf(stderr, "audit: %s\n", error.c_str());
            }
        }
    }
    std::printf("mat-runtime stopping\n");
    discoveryServer.stop();            // device discovery (T060)
    if (historian) historian->stop();  // commits the buffered rows
    web.stop();                        // HTTPS, then HTTP: no request runs after this
    audit.close();                     // the counts still in memory
    return 0;
}
