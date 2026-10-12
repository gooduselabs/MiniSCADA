// mat-runtime: CivetWeb (HTTP for the runtime page, HTTPS for the engineering API) + live protocol
// 1.1.0 + Mock Tag provider + project v0 + tag history (003) + sign-in, audit, discovery, the
// project store with deploy, restore and health check (005).
// Contracts: specs/002-vertical-slice/contracts/, specs/003-data-logging/contracts/,
// specs/005-device-online/contracts/ (start-up order: device-config.md §7). Exit codes: 0 ok,
// 1 --check-project invalid, 2 bad configuration, 3 cannot start the web server, 4 the restart
// that switches the project (execv) failed and the runtime stopped for systemd to start it again.
#include <limits.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <atomic>
#include <cerrno>
#include <chrono>
#include <csignal>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/auth/auth_service.hpp"
#include "core/auth/auth_state.hpp"
#include "core/historian/historian.hpp"
#include "core/historian/status.hpp"
#include "core/package/manifest.hpp"
#include "core/package/project_digest.hpp"
#include "core/project-manager/project_validator.hpp"
#include "core/project-store/boot_decision.hpp"
#include "core/project-store/deploy_pipeline.hpp"
#include "core/project-store/health_check.hpp"
#include "core/project-store/store.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "drivers/simulation/mock_tag_provider.hpp"
#include "server/cli/auth_bench.hpp"
#include "server/cli/cert.hpp"
#include "server/cli/export_history.hpp"
#include "server/cli/package.hpp"
#include "server/cli/project.hpp"
#include "server/cli/set_secret.hpp"
#include "server/cli/users.hpp"
#include "server/config.hpp"
#include "server/device_state.hpp"
#include "server/discovery/discovery_server.hpp"
#include "server/http/engineering_api.hpp"
#include "server/http/http_api.hpp"
#include "server/http/web_contexts.hpp"
#include "server/project_glue.hpp"
#include "server/startup.hpp"
#include "server/tls/server_cert.hpp"
#include "server/tls/tls_init.hpp"
#include "server/websocket/civet_transport.hpp"
#include "server/websocket/live_hub.hpp"

namespace {

std::atomic<bool> g_run{true};
std::atomic<int> g_exitCode{0};
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

// The absolute path of this binary, from argv[0] (a path, or a name looked up in PATH), kept for
// the execv that switches the project. Not /proc/self/exe: under qemu-user that is the emulator.
std::string absoluteSelfPath(const char* argv0) {
    char buf[PATH_MAX];
    if (std::strchr(argv0, '/')) return ::realpath(argv0, buf) ? buf : argv0;
    const char* path = std::getenv("PATH");
    std::string rest = path ? path : "";
    while (!rest.empty()) {
        const size_t colon = rest.find(':');
        const std::string dir = rest.substr(0, colon);
        rest = colon == std::string::npos ? "" : rest.substr(colon + 1);
        const std::string candidate = (dir.empty() ? "." : dir) + "/" + argv0;
        if (::access(candidate.c_str(), X_OK) == 0 && ::realpath(candidate.c_str(), buf))
            return buf;
    }
    return argv0;
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
    // Feature 005 T107 (contracts/device-config.md §4): --project-status, --check-project
    // --project-store <dir>. Read-only; open no port.
    if (isProjectCommand(argc, argv))
        return runProjectCli(argc, argv, systemDeviceCliEnv(), std::cout, std::cerr,
                             exeDir() + "/../schemas");
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

    if (cfg.checkProject) {  // the older check of projectDir (the store one is a project command)
        const ProjectValidation v = validateProject(cfg.projectDir, cfg.schemasDir);
        std::printf("%s\n", resultJson(v).c_str());
        return v.valid ? 0 : 1;
    }
    // For the execv that switches the project: this binary's absolute path and its arguments.
    const std::string selfPath = absoluteSelfPath(argv[0]);
    const std::vector<std::string> selfArgs(argv, argv + argc);

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

    // Step 3: the project store (state.json, v/<seq>) decides which project runs. The project
    // installed the old way (projectDir) is taken into it at the first start (FR-027). A store
    // that cannot be opened (read-only disk) leaves the runtime as 0.3.0 was: it runs projectDir
    // and refuses deploys.
    StoreOptions storeOptions;
    storeOptions.dir = cfg.projectStoreDir;
    storeOptions.projectBackups = cfg.projectBackups;
    ProjectStore pstore(storeOptions);
    std::optional<ProjectValidation> legacyValidation;  // projectDir, validated at most once
    BootHooks bootHooks;
    bootHooks.legacy = [&] {
        if (!legacyValidation) legacyValidation = validateProject(cfg.projectDir, cfg.schemasDir);
        return legacyProjectOf(*legacyValidation, cfg.projectDir);
    };
    bootHooks.pack = storedPackFn(nullptr);
    bootHooks.audit = [&audit](const AuditEvent& e) { audit.append(e); };
    StoreStartup startup = startStore(pstore, bootHooks);
    if (!startup.opened) startup.runDir = cfg.projectDir;
    std::printf("project store %s: %s%s%s\n", cfg.projectStoreDir.c_str(),
                startup.opened ? bootActionName(startup.decision.action) : "not usable",
                startup.decision.reason.empty() ? "" : " - ", startup.decision.reason.c_str());
    if (!startup.error.empty()) std::fprintf(stderr, "project store: %s\n", startup.error.c_str());

    // What the restart that switches the project must stop, filled in as the parts come up (a
    // hang during start is caught by the health deadline, whichever part exists by then).
    struct RestartParts {
        std::atomic<CivetLiveTransport*> transport{nullptr};
        std::atomic<Historian*> historian{nullptr};
        std::atomic<DiscoveryServer*> discovery{nullptr};
        std::atomic<WebContexts*> web{nullptr};
        std::atomic<AuthService*> auth{nullptr};
    } parts;
    std::mutex runningMu;
    std::optional<std::string> runningDigest;  // of the project the runtime runs now

    std::string schemaError;
    const std::unique_ptr<PackageSchema> packageSchema =
        PackageSchema::loadFromDir(cfg.schemasDir, schemaError);
    if (!packageSchema)
        std::fprintf(stderr, "package schema: %s; deploys fail at verify-package\n",
                     schemaError.c_str());
    DeployHooks deployHooks;
    deployHooks.verifyPackage = [&packageSchema, &schemaError](const VerifyRequest& q) {
        if (packageSchema) return verifyPackageStep(q, *packageSchema);
        VerifyOutcome o;
        o.code = "STORE_IO";
        o.message = "không nạp được schema của gói: " + schemaError;
        return o;
    };
    deployHooks.validate = [&cfg](const std::string& dir) {
        return validateStep(dir, cfg.schemasDir);
    };
    deployHooks.notifyClients = [&parts] {
        CivetLiveTransport* t = parts.transport.load();
        return t ? static_cast<int>(t->closeAllForRestart()) : 0;
    };
    // device-config §7: the live sessions were closed with 1012 just before; commit the history
    // buffer, stop CivetWeb, keep the sessions across the restart, close the audit log, then
    // execv this very binary.
    deployHooks.restart = [&](std::string& error) {
        ::alarm(20);  // a stop that hangs ends the process; systemd starts it, pending counts boots
        if (Historian* h = parts.historian.load()) h->stop();
        if (DiscoveryServer* d = parts.discovery.load()) d->stop();  // its UDP port stays free
        if (WebContexts* w = parts.web.load()) w->stop();
        if (AuthService* a = parts.auth.load()) {
            std::string saveError;
            ::mkdir("/run/mat-runtime", 0700);  // systemd's RuntimeDirectory on the device
            if (!a->saveState(kAuthStateFile, saveError))
                std::fprintf(stderr, "auth-state not saved: %s\n", saveError.c_str());
        }
        audit.close();
        ::alarm(0);
        std::fflush(stdout);
        std::vector<char*> args;
        for (const auto& a : selfArgs) args.push_back(const_cast<char*>(a.c_str()));
        args.push_back(nullptr);
        ::execv(selfPath.c_str(), args.data());
        error = "execv " + selfPath + ": " + std::strerror(errno);
        std::fprintf(stderr, "%s\n", error.c_str());
        // CivetWeb is down: leave for systemd to start the runtime again; the audit log opens
        // again so that the failure of the operation is recorded.
        std::string reopenError;
        audit.open(reopenError);
        g_exitCode = 4;
        g_run = false;
        return RestartOutcome::Failed;
    };
#ifdef MAT_TEST_HOOKS
    if (!cfg.testKillAtStep.empty())
        deployHooks.beforeStep = [&cfg](const std::string& stepId) {
            if (stepId == cfg.testKillAtStep) ::raise(SIGKILL);  // like kill -9, no cleanup
            return true;
        };
#endif
    DeployOptions deployOptions;
    deployOptions.minFreeBytes = static_cast<uint64_t>(cfg.historianMinFreeMB) << 20;
    deployOptions.audit = [&audit](const AuditEvent& e) { audit.append(e); };
    deployOptions.runningDigest = [&]() -> std::optional<std::string> {
        std::lock_guard<std::mutex> l(runningMu);
        return runningDigest;
    };
    DeployPipeline pipeline(pstore, deployHooks, deployOptions);
    if (startup.opened) pipeline.resume(startup);
    // Counts the 15 s of a version being tried from the moment state.json was read, so a process
    // that hangs at start is turned back too; it also ends a receive left open for 10 minutes.
    struct Joiner {
        std::thread t;
        ~Joiner() {
            g_run = false;
            if (t.joinable()) t.join();
        }
    } watchdog;
    watchdog.t = std::thread([&pipeline] {
        while (g_run) {
            for (int i = 0; i < 5 && g_run; ++i)
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            if (g_run) pipeline.poll();
        }
    });

    // Step 4: the project of the version that runs; an invalid project is not activated (FR-025),
    // but the page and the system info stay available so the error is visible (server/startup.cpp,
    // T063). Its content digest goes to system/info, projects/active, the live hello and discovery.
    ProjectValidation validation;
    if (startup.runDir.empty()) {
        validation.errors.push_back({startup.decision.action == BootAction::NoProject
                                         ? "E_FILE_MISSING"
                                         : "E_NO_VALID_PROJECT",
                                     "project.json", "", startup.decision.reason});
    } else if (startup.runDir == cfg.projectDir && legacyValidation) {
        validation = *legacyValidation;
    } else {
        validation = validateProject(startup.runDir, cfg.schemasDir);
    }
    std::optional<std::string> digest;
    if (validation.valid) {
        std::string err;
        digest = projectDirDigest(startup.runDir, validation.project->files(), &err);
        if (!digest) std::fprintf(stderr, "project digest: %s\n", err.c_str());
    }
    TagStore store;
    const ActiveProject active =
        activateProject(validation, static_cast<size_t>(cfg.maxClients), store, digest);
    {
        std::lock_guard<std::mutex> l(runningMu);
        runningDigest = active.digest;
    }
    if (active.active) {
        std::printf("project '%s' %s active (%zu tags, %s)\n",
                    active.info["projectId"].get<std::string>().c_str(),
                    active.info["projectVersion"].get<std::string>().c_str(), store.size(),
                    active.digest.value_or("no digest").c_str());
    } else {
        std::fprintf(stderr, "project in %s is NOT active:\n%s\n", startup.runDir.c_str(),
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
    parts.auth = &auth;

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
        else
            parts.historian = historian.get();
    }

    CivetLiveTransport::Options to;
    to.maxClients = active.maxClients;
    to.queueBytes = cfg.sendQueueBytes;
    to.heartbeatTimeoutMs = cfg.heartbeatTimeoutMs;
    to.allowedOrigins = cfg.allowedOrigins;
    CivetLiveTransport transport(to, monoMs);
    parts.transport = &transport;

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
    hopt.projectDir = startup.runDir;
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
                              {"historian", historianInfo()},
                              {"operation", operationInfoJson(pipeline.current())}};
    });

    // The engineering API (device-api §3): on HTTPS; on HTTP its paths answer 403 HTTPS_REQUIRED.
    EngineeringApi engineering(EngineeringApi::Options{}, device, auth, audit);
    if (startup.opened) engineering.setProject({&pstore, &pipeline});  // device-api §4

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
    parts.web = &web;
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
    parts.discovery = &discoveryServer;
    // ---- end of device discovery
    std::fflush(stdout);

    // Step 9 (research R13): a version being tried (or a rollback) is checked within 15 s of the
    // read of state.json; passed → commit, failed → rollback by the pipeline (execv again). The
    // tick loop below only counts its passes.
    std::atomic<int64_t> tickCount{0};
    Joiner health;
    if (const auto deadline = pipeline.healthDeadlineMs();
        deadline && startup.decision.runSeq && pstore.readMeta(*startup.decision.runSeq)) {
        const std::string expected = pstore.readMeta(*startup.decision.runSeq)->digest;
        const bool tryingNew = startup.decision.action == BootAction::TryNew;
        health.t = std::thread([&, expected, deadline, tryingNew] {
#ifdef MAT_TEST_HOOKS
            if (tryingNew && cfg.testHealth == "die") ::raise(SIGKILL);  // dies while tried
            if (tryingNew && cfg.testHealth == "hang") {  // the deadline turns it back
                while (g_run) std::this_thread::sleep_for(std::chrono::milliseconds(100));
                return;
            }
#else
            (void)tryingNew;
#endif
            HealthProbes probes;
            probes.projectActive = [&active] { return active.active; };
            probes.httpsOpen = [&] { return cfg.httpsPort == 0 || https == HttpsState::Ok; };
            probes.reportedDigest = [&] { return fetchSystemInfoDigest(web.httpPort(), 1500); };
            probes.tickCount = [&tickCount] { return tickCount.load(); };
            probes.tickFailed = [] { return false; };  // an exception in the loop ends the process
            HealthClock clock;                         // a stop request ends the check at once
            clock.monoMs = [] { return g_run ? systemMonoMs() : INT64_MAX / 2; };
            const HealthOutcome o = runHealthCheck(probes, expected, *deadline, clock);
            if (!g_run) return;
            if (o.ok) {
                pipeline.healthPassed();
            } else {
                std::fprintf(stderr, "health check failed: %s (%s)\n", o.code.c_str(),
                             o.detail.c_str());
                pipeline.healthFailed(o.code);
            }
        });
    }

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
        tickCount.fetch_add(1);
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
    // The threads that may restart the runtime end first: nothing they use is destroyed under them.
    g_run = false;
    if (health.t.joinable()) health.t.join();
    if (watchdog.t.joinable()) watchdog.t.join();
    discoveryServer.stop();            // device discovery (T060)
    if (historian) historian->stop();  // commits the buffered rows
    web.stop();                        // HTTPS, then HTTP: no request runs after this
    audit.close();                     // the counts still in memory
    return g_exitCode;
}
