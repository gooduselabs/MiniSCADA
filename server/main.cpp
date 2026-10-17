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
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/auth/auth_service.hpp"
#include "core/auth/auth_state.hpp"
#include "core/common/thread_name.hpp"
#include "core/diagnostics/daily_writes.hpp"
#include "core/diagnostics/emmc_life.hpp"
#include "core/diagnostics/proc_stats.hpp"
#include "core/diagnostics/run_record.hpp"
#include "core/historian/historian.hpp"
#include "core/historian/status.hpp"
#include "core/historian/write_counter_vfs.hpp"
#include "core/package/manifest.hpp"
#include "core/package/project_digest.hpp"
#include "core/project-manager/logging_estimate.hpp"
#include "core/project-manager/project_validator.hpp"
#include "core/project-store/boot_decision.hpp"
#include "core/project-store/deploy_pipeline.hpp"
#include "core/project-store/health_check.hpp"
#include "core/project-store/store.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "server/alarm_glue.hpp"
#include "server/cache_budget.hpp"
#include "server/cli/alarm_db_check.hpp"
#include "server/cli/auth_bench.hpp"
#include "server/cli/cert.hpp"
#include "server/cli/check_data.hpp"
#include "server/cli/export_audit.hpp"
#include "server/cli/export_history.hpp"
#include "server/cli/package.hpp"
#include "server/cli/project.hpp"
#include "server/cli/retain.hpp"
#include "server/cli/self_check.hpp"
#include "server/cli/serial.hpp"
#include "server/cli/set_secret.hpp"
#include "server/cli/trust_key.hpp"
#include "server/cli/update_status.hpp"
#include "server/cli/users.hpp"
#include "server/cli/verify_aggregates.hpp"
#include "server/config.hpp"
#include "server/device_state.hpp"
#include "server/discovery/discovery_server.hpp"
#include "server/host_policy.hpp"
#include "server/http/conn_limit.hpp"
#include "server/http/engineering_api.hpp"
#include "server/http/history_api.hpp"
#include "server/http/http_api.hpp"
#include "server/http/viewer_gate.hpp"
#include "server/http/web_contexts.hpp"
#include "server/project_glue.hpp"
#include "server/runtime_engine.hpp"
#include "server/serial_policy.hpp"
#include "server/serial_probe.hpp"
#include "server/ssh_audit.hpp"
#include "server/startup.hpp"
#include "server/time_sync.hpp"
#include "server/tls/server_cert.hpp"
#include "server/tls/tls_init.hpp"
#include "server/update_service.hpp"
#include "server/websocket/civet_transport.hpp"
#include "server/websocket/live_hub.hpp"
#include "server/write_subsystem.hpp"

namespace {

std::atomic<bool> g_run{true};
#ifdef MAT_TEST_HOOKS
// --test-persist-fail (feature 011, T054): the store's fsync fails ENOSPC once the runtime serves.
std::atomic<bool> g_persistFailArmed{false};
#endif
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
    if (hasArg(argc, argv, "--verify-aggregates"))
        return runVerifyAggregatesCli(argc, argv, std::cout, std::cerr);
    if (hasArg(argc, argv, "--history-stats"))
        return runHistoryStatsCli(argc, argv, std::cout, std::cerr);
    if (hasArg(argc, argv, "--check-history"))
        return runCheckHistoryCli(argc, argv, std::cout, std::cerr);
    // Feature 005 T146 (contracts/device-config.md §4): the audit log on stdout, run as matscada.
    if (isExportAuditCommand(argc, argv))
        return runExportAuditCli(argc, argv, systemDeviceCliEnv(), std::cout, std::cerr,
                                 ::isatty(STDOUT_FILENO) != 0);
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
    // Feature 006 (contracts/device-config.md §4): the serial ports as the API lists them; opens
    // none.
    if (isSerialCommand(argc, argv))
        return runSerialCli(argc, argv, systemDeviceCliEnv(), std::cout, std::cerr);
    // The values of the retained Tags as the store holds them (read only).
    // Feature 009 (specs/009-alarms T038): the integrity of alarm.db, read only.
    if (isAlarmDbCheckCommand(argc, argv))
        return runAlarmDbCheckCli(argc, argv, systemDeviceCliEnv(), std::cout, std::cerr);
    // Feature 011 (FR-040): the data on the eMMC after a power cut, read only; exit 0, 1, 2.
    if (isCheckDataCommand(argc, argv))
        return runCheckDataCli(argc, argv, systemDeviceCliEnv(), std::cout, std::cerr);
    // Feature 011 (US4, device-api-011 §7): the commands of OTA. --self-check runs as matscada
    // under mat-updater with the binary of the new tree (its schemas: <exe>/../schemas); read only.
    if (isSelfCheckCommand(argc, argv))
        return runSelfCheckCli(argc, argv, systemDeviceCliEnv(), exeDir() + "/../schemas",
                               std::cout, std::cerr);
    if (isTrustKeyCommand(argc, argv))
        return runTrustKeyCli(argc, argv, systemDeviceCliEnv(), std::cout, std::cerr);
    if (isUpdateStatusCommand(argc, argv))
        return runUpdateStatusCli(argc, argv, systemDeviceCliEnv(), std::cout, std::cerr);
    if (isRetainCommand(argc, argv))
        return runRetainCli(argc, argv, systemDeviceCliEnv(), std::cout, std::cerr);
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
    // Feature 011 (FR-009 `restarts`): why this run began, from the record of the one before.
    RunRecord runRecord(cfg.dataDir + "/" + kRunRecordFile);
    {
        std::string err;
        if (!runRecord.begin(epochMs(), kRuntimeVersion, systemBootId(), &err))
            std::fprintf(stderr, "run record: %s\n", err.c_str());
        const RestartInfo ri = runRecord.info();
        if (ri.total > 0)
            std::printf("restart %lld: %s%s\n", static_cast<long long>(ri.total),
                        ri.lastReason.c_str(), ri.bootChanged ? " (machine restarted)" : "");
    }
    // Step 2 (feature 006, device-config §7): a command of the last run that has a record of
    // receipt and no result is marked "interrupted" now, before any command can be taken; it is
    // never sent again. Without the audit log nothing is recovered and every write is refused
    // later.
    try {
        const size_t openWrites = audit.recoverTagWrites();
        if (openWrites > 0)
            std::printf(
                "tag writes: %zu command(s) of the last run have no known result (interrupted)\n",
                openWrites);
    } catch (const std::exception& ex) {
        std::fprintf(stderr, "tag writes: cannot recover the open commands: %s\n", ex.what());
    }

    // Step 3: the project store (state.json, v/<seq>) decides which project runs. The project
    // installed the old way (projectDir) is taken into it at the first start (FR-027). A store
    // that cannot be opened (read-only disk) leaves the runtime as 0.3.0 was: it runs projectDir
    // and refuses deploys.
    StoreOptions storeOptions;
    storeOptions.dir = cfg.projectStoreDir;
    storeOptions.projectBackups = cfg.projectBackups;
#ifdef MAT_TEST_HOOKS
    // Feature 011 (T054 persist-slow, SC-007): a slow or failing eMMC for the project store.
    if (cfg.testPersistDelayMs > 0 || cfg.testPersistFail)
        storeOptions.fsync = [&cfg](int fd) {
            if (cfg.testPersistFail && g_persistFailArmed) {
                errno = ENOSPC;
                return -1;
            }
            if (cfg.testPersistDelayMs > 0)
                std::this_thread::sleep_for(std::chrono::milliseconds(cfg.testPersistDelayMs));
            return ::fsync(fd);
        };
#endif
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
        std::atomic<RuntimeEngine*> engine{nullptr};  // feature 006: drivers and the retained store
        std::atomic<WriteSubsystem*> writes{nullptr};  // feature 006: the tag write coordinator
        std::atomic<AlarmGlue*> alarms{nullptr};       // feature 009: the alarm engine and alarm.db
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
    const SerialPolicy serialPolicy = serialPolicyOf(cfg.serialPorts);
    deployHooks.validate = [&cfg, &serialPolicy](const std::string& dir) {
        return validateStep(dir, cfg.schemasDir, &serialPolicy);
    };
    // Feature 006 (FR-042): just before the activation the tag writes in flight end and are
    // audited.
    deployHooks.quiesce = [&parts] {
        if (WriteSubsystem* w = parts.writes.load()) w->coordinator().quiesce();
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
        // device-config §7: the retained Tags are written and the drivers stop before the steps of
        // 005
        // device-config §7: quiesce the tag writes, then the retained values, then the drivers
        if (WriteSubsystem* w = parts.writes.load())
            w->beforeRestart();
        else if (RuntimeEngine* e = parts.engine.load())
            e->stop();
        if (AlarmGlue* g = parts.alarms.load()) g->stop();  // alarm.db written and closed clean
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
        runRecord.end(true);  // the same process goes on: not a restart (FR-009)
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
    // Feature 011 (FR-060): an OTA update and a deployment never run together (DEVICE_BUSY both
    // ways); the service is made below, once the warnings exist.
    std::unique_ptr<UpdateService> updateService;
    DeployOptions deployOptions;
    deployOptions.otherBusy = [&updateService]() -> std::optional<BusyInfo> {
        return updateService ? updateService->busy() : std::nullopt;
    };
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
        mat::setThreadName("mat-watchdog");
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
    const ActiveProject active = activateProject(validation, static_cast<size_t>(cfg.maxClients),
                                                 store, digest, cfg.simLoad);
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
    // Feature 011 (device-api-011 §5): the warnings of system/info raised by the 1.0 sources (the
    // pulse journal below is the first of them).
    static SystemWarnings systemWarnings([] {
        return std::chrono::duration_cast<std::chrono::milliseconds>(
                   std::chrono::system_clock::now().time_since_epoch())
            .count();
    });
    // Feature 011 (T140, R23): is the clock synchronised? Read once now, then once a minute on a
    // thread of its own (the programs it asks may take up to 2 s); TIME_NOT_SYNCED when not.
    // Feature 011 (US4): OTA. Off by default (update.enabled); the routes answer 404 then. The
    // result left by mat-updater (last.json) is audited here, once (FR-063).
    {
        UpdateServiceOptions uo;
        uo.enabled = cfg.updateEnabled;
        uo.maxPackageBytes = static_cast<uint64_t>(cfg.updateMaxPackageMiB) << 20;
        uo.trustedKeysDir = cfg.updateTrustedKeysDir;
        uo.dataDir = cfg.dataDir;
        {
            std::string root = selfPath.substr(0, selfPath.rfind('/'));  // <root>/bin
            root = root.substr(0, root.rfind('/'));
            uo.installRoot = root.empty() ? "/opt/mat-runtime" : root;
        }
        uo.version = kRuntimeVersion;
        const std::string runDir = startup.runDir;
        uo.projectFormat = [runDir]() -> std::string {
            const auto text = readTextFile(runDir + "/project.json");
            if (!text) return {};
            const nlohmann::json j = nlohmann::json::parse(*text, nullptr, false);
            return j.is_object() && j.contains("schemaVersion") && j["schemaVersion"].is_string()
                       ? j["schemaVersion"].get<std::string>()
                       : std::string();
        };
        uo.deployBusy = [&pipeline]() -> std::optional<BusyInfo> {
            const auto op = pipeline.current();
            if (!op) return std::nullopt;
            BusyInfo b;
            b.opId = op->opId;
            b.kind = op->kind;
            b.user = op->user;
            b.source = op->source;
            b.since = op->startedMs;
            return b;
        };
        uo.audit = [&audit](const AuditEvent& e) {
            try {
                audit.append(e);
                return true;
            } catch (const std::exception&) {
                return false;
            }
        };
        uo.warnings = &systemWarnings;
        updateService = std::make_unique<UpdateService>(uo);
        updateService->start();
    }
    static TimeSync timeSync(systemTimeSyncProbes(), &systemWarnings);
    timeSync.refresh();
    Joiner timeSyncThread;
    timeSyncThread.t = std::thread([] {
        mat::setThreadName("mat-timesync");
        int64_t next = monoMs() + kTimeSyncPeriodMs;
        while (g_run) {
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
            if (monoMs() < next) continue;
            next = monoMs() + kTimeSyncPeriodMs;
            timeSync.refresh();
        }
    });
    // Step 4 (device-config §7): the engine over the Tags of the active project (a 0.1 project
    // runs its Tags as `legacy` simulation Tags), the retained store opened and applied, the first
    // round. The driver threads start at step 6, after the web server is up.
    RuntimeEngineOptions engineOptions;
    engineOptions.retainDir = cfg.retainDir;
    engineOptions.checkPort = [patterns = cfg.serialPorts](const std::string& port) {
        return serialPortRefusal(patterns, port);
    };
    engineOptions.retainWindowS = cfg.retainWindowS;
    engineOptions.writeQueuePerChannel = cfg.tagWriteQueuePerChannel;
    // Feature 011 (logic v2, T136 to T139): logic.json of the active project in the engine's
    // round; its writes go to the coordinator (set below), its state to <dataDir>/logic-state.json.
    if (active.active && validation.project && validation.project->logic.is_object())
        engineOptions.logic = &validation.project->logic;
    engineOptions.logicOptions.writes = cfg.logicWrites;
    engineOptions.logicOptions.scanMs = cfg.logicScanMs;
    engineOptions.logicOptions.maxWritesPerMin = cfg.logicMaxWritesPerMin;
    engineOptions.logicOptions.flushS = cfg.logicFlushS;
    engineOptions.logicOptions.tzOffsetMin = cfg.tzOffsetMin;
    engineOptions.logicOptions.statePath = cfg.dataDir + "/" + kLogicStateFile;
    engineOptions.logicOptions.writesResetRequestPath = cfg.dataDir + "/" + kLogicWritesResetFile;
    engineOptions.logicOptions.timeSynced = [] { return timeSync.synced(); };
    engineOptions.logicOptions.warnings = &systemWarnings;
    engineOptions.logicOptions.audit = [&audit](const AuditEvent& e) { audit.append(e); };
    RuntimeEngine rtEngine(active.model, store, engineOptions);
    rtEngine.firstRound(epochMs());
    parts.engine.store(&rtEngine);
    // The alarm engine (feature 009 T038): alarm.db opened and the state rebuilt from it, then
    // from the conditions of the Tags (FR-022). One round per tick, right after the Tag Engine's.
    AlarmGlueOptions alarmOptions;
    alarmOptions.dataDir = cfg.dataDir;
    alarmOptions.engine.chatterWindowS = cfg.alarmChatterWindowS;
    alarmOptions.engine.chatterShelveS = cfg.alarmChatterShelveS;
    alarmOptions.engine.maxShelved = cfg.alarmMaxShelved;
    alarmOptions.service.commitMs = cfg.alarmCommitMs;
    alarmOptions.service.commitMaxMs = cfg.alarmCommitMaxMs;
    alarmOptions.service.commitRows = cfg.alarmCommitRows;
    alarmOptions.service.bufferMax = static_cast<size_t>(cfg.alarmBufferMax);
    alarmOptions.service.purgeIntervalS = cfg.alarmPurgeIntervalS;
    alarmOptions.service.retentionDays = cfg.alarmRetentionDays;
    alarmOptions.service.maxBytes = cfg.alarmMaxBytes;
    alarmOptions.service.purgeBatch = cfg.alarmPurgeBatch;
    alarmOptions.minFreeBytes = int64_t{cfg.historianMinFreeMB} * 1024 * 1024;
    alarmOptions.epochMs = epochMs;
    alarmOptions.monoMs = monoMs;
    alarmOptions.clockOk = [](int64_t wallMs) {
        return timesyncSynchronized(kTimesyncFlag, wallMs);
    };
    alarmOptions.audit = [&audit](const AuditEvent& e) { audit.append(e); };
    AlarmGlue alarmGlue(alarmOptions);
    {
        std::string alarmError;
        const LoadedProject* alarmProject =
            active.active && validation.project ? &*validation.project : nullptr;
        if (!alarmGlue.start(alarmProject, store, alarmError))
            std::fprintf(stderr, "alarms not started: %s\n", alarmError.c_str());
    }
    parts.alarms.store(&alarmGlue);
    // The tag write coordinator (feature 006 T147): only when a project runs. Its audit is audit.db
    // version 2; its limits come from runtime.json (device-config §1).
    std::unique_ptr<WriteSubsystem> writes;
    const std::string pulseJournalPath = cfg.dataDir + "/pulse.journal";
    if (rtEngine.active() && rtEngine.model()) {
        CoordinatorOptions co;
        co.rate.sessionBurst = cfg.tagWriteSessionBurst;
        co.rate.sessionPerMin = cfg.tagWriteSessionPerMin;
        co.rate.globalBurst = cfg.tagWriteGlobalBurst;
        co.rate.globalPerMin = cfg.tagWriteGlobalPerMin;
        co.queuePerChannel = cfg.tagWriteQueuePerChannel;
        co.queueTotal = cfg.tagWriteQueueTotal;
        co.clockSynced = [](int64_t wallMs) { return timesyncSynchronized(kTimesyncFlag, wallMs); };
        // Feature 011 (FR-018 to FR-020): the journal of pulses; the pulses a kill -9 or a power
        // cut left on are released as their channels connect (the drivers start at step 6).
        PulseOptions po;
        po.journalPath = pulseJournalPath;
        po.recovery = cfg.pulseRecovery != "off";
        po.warnings = &systemWarnings;
        writes = std::make_unique<WriteSubsystem>(rtEngine, store, audit, co, po);
        writes->recoverPulses();
        parts.writes.store(writes.get());
        if (rtEngine.logic()) rtEngine.logic()->setCoordinator(&writes->coordinator());
    } else {
        // No project runs: nothing can release a pulse of the last run; say so (PULSE_STUCK).
        PulseJournal journal(pulseJournalPath);
        std::vector<std::string> tags;
        for (const PulseArm& a : journal.load()) tags.push_back(a.tag);
        if (!tags.empty())
            systemWarnings.set("PULSE_STUCK", {{"tags", tags}, {"pulseRecovery", "no-project"}});
    }

    // Step 5: the sign-in service (its hash thread starts here, after the device commands above
    // have returned), with the sessions and lockouts carried across execv (read, then deleted).
    AuthOptions authOptions;
    authOptions.usersFile = cfg.usersFile;
    // Feature 007: the limits of the sessions of the runtime page (runtime.json).
    authOptions.webIdleLimitS = int64_t{cfg.webSessionIdleMin} * 60;
    authOptions.webMaxLifetimeS = int64_t{cfg.webSessionMaxHours} * 3600;
    authOptions.webMaxSessions = static_cast<size_t>(cfg.webMaxSessions);
    // Feature 011 (FR-016, FR-017): concurrent sign-ins and the request file of --user-unlock-all.
    authOptions.maxConcurrentLogins = static_cast<size_t>(cfg.maxConcurrentLogins);
    authOptions.unlockRequestFile = cfg.dataDir + "/" + kUnlockRequestFileName;
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
        // Feature 007: the SAN holds the addresses of the cards, so that Chrome accepts
        // https://<IP>. An existing certificate is never changed (it keeps what it has; the
        // warnings say what is missing).
        ServerCertOptions certOptions;
        certOptions.dataDir = cfg.dataDir;
        certOptions.deviceName = cfg.deviceName;
        certOptions.hostname = systemHostname();
        certOptions.ipAddresses = systemIpv4Addresses();
        cert = loadOrCreateServerCert(certOptions);
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
    facts.viewerAccess = cfg.viewerAccess;  // system/info.device.viewerAccess (feature 006)
    facts.viewerLogin = cfg.viewerLogin;    // system/info.web (feature 007)
    facts.warnings = tlsWarnings(cert, systemIpv4Addresses());  // TLS_NO_IP_SAN, TLS_SAN_MISMATCH
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

    // FR-055a (ADR-018): the page, its API and the live channel are for the private networks and
    // for a valid session. The session is only looked at: the idle time of a signed-in person does
    // not restart because a page was read.
    ViewerGate viewerGate(parseViewerAccess(cfg.viewerAccess).value_or(ViewerAccess::Private),
                          [&auth](const std::string& token, const std::string& ip, int port) {
                              ClientAddress from;
                              from.ip = ip;
                              from.port = port;
                              return auth.authorize(token, from, Role::Viewer, false).status ==
                                     AccessStatus::Ok;
                          });
    // Feature 007: the cookie session of the page opens the page as a Bearer session does, and
    // viewerLogin = required asks for one.
    viewerGate.setWebSessions(
        [&auth](const std::string& token, const std::string& ip, int port) {
            ClientAddress from;
            from.ip = ip;
            from.port = port;
            return auth.authorizeWeb(token, from, Role::Viewer, false).status == AccessStatus::Ok;
        },
        cfg.viewerLogin == "required");
    if (cfg.viewerLogin == "required")
        std::printf("viewerLogin is required: the page and its data need a sign-in\n");
    if (viewerGate.access() == ViewerAccess::Any)
        std::fprintf(stderr,
                     "viewerAccess is any: the page is open to every source (VIEWER_PUBLIC)\n");
    CivetLiveTransport::Options to;
    to.gate = &viewerGate;
    to.maxClients = active.maxClients;
    // M1 of the review of 011: one address holds at most its share of the live slots.
    to.maxClientsPerSource =
        SessionManager::effectiveMaxPerSource(cfg.maxLiveClientsPerSource, active.maxClients);
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
    // live 1.2.0 §4: a write message is refused and told to the audit (tag.write denied)
    if (writes) hub.setRejectedWriteHook(liveRejectedWriteHook(writes->coordinator()));
    // live 1.3.0: the alarms ride the live connection; an acknowledgement on it is refused and told
    // to the audit (alarm.ack denied LIVE_ACK_NOT_ALLOWED, coalesced by the log).
    hub.setAlarmSource(&alarmGlue);
    hub.setRejectedAckHook(
        [&audit](const std::string& id, const std::string& occurrence, uint64_t) {
            AuditEvent e(AuditAction::AlarmAck, AuditResult::Denied, AuditChannel::Https, "live");
            if (!id.empty()) e.target = id;
            e.code = "LIVE_ACK_NOT_ALLOWED";
            nlohmann::json d = {{"channel", "live"}};
            if (!id.empty()) d["id"] = id;
            if (!occurrence.empty()) d["occurrence"] = occurrence;
            e.detail = d.dump();
            try {
                audit.append(e);
            } catch (const std::exception&) {
            }
        });

    const int64_t startMs = monoMs();
    HttpApi::Options hopt;
    hopt.docroot = cfg.docroot;
    hopt.projectDir = startup.runDir;
    hopt.allowedOrigins = cfg.allowedOrigins;
    hopt.projectAllowlist = active.allowlist;
    hopt.activeProjectJson = active.activeJson;
    hopt.projectErrors = active.errors;
    hopt.device = &device;     // system/info: blocks "device" and "operation" (005)
    hopt.alarms = &alarmGlue;  // feature 009: GET alarms, alarms/history, system/info.alarms
    hopt.gate = &viewerGate;
    // Feature 011 (device-api-011 §5): the warnings of the 1.0 sources (set by their tasks), and
    // the blocks `update` and `logic` the Studio reads to show or hide OTA and logic.
    hopt.systemWarnings = &systemWarnings;
    // Feature 011 (device-api-011 §1, R4): the check of Host on both listeners, before anything
    // else; the host name is read once, here. hostCheck "off" raises HOST_CHECK_OFF.
    HostPolicyOptions hostOptions;
    hostOptions.enabled = cfg.hostCheck != "off";
    hostOptions.hostname = systemHostname();
    hostOptions.allowedHosts = cfg.allowedHosts;
    HostPolicy hostPolicy(hostOptions, [&audit](const AuditEvent& e) { audit.append(e); });
    hostPolicy.publishWarning(systemWarnings);
    // FR-034: SSH_ROOT_PASSWORD from /etc/ssh/sshd_config (read-only), again every 10 minutes.
    publishSshWarning(auditSshConfig(), systemWarnings);
    hopt.updateEnabled = cfg.updateEnabled;
    hopt.logicWrites = cfg.logicWrites;
    hopt.logicPresent = rtEngine.logic() != nullptr;
    hopt.logicWritesNow = [&rtEngine, &cfg] {
        LogicSubsystem* l = rtEngine.logic();
        return l ? l->writesState() : cfg.logicWrites;
    };
    // GET /device.crt (feature 007): the certificate blocks of server.pem, never a key.
    if (cert.ok) {
        if (const auto pemText = readTextFile(cert.pemPath, 64 * 1024))
            hopt.deviceCertPem = publicCertificatePem(*pemText);
    }
    // contracts/system-info.md (core/historian/status.cpp). Public page: no host, user, database,
    // URL or secret; W_LOG_* of the active project come from the validator (FR-024).
    HistorianInfoInput historianInput;
    if (historian) {
        historianInput.enabled = true;
        historianInput.groups = historian->model().groups.size();
        historianInput.commitMs = cfg.historianCommitMs;
        historianInput.startError = historianError;
        {  // the estimate of the running configuration, to be set against io.bytesPerDay
           // (device-010 §1)
            static const char* const kTypeNames[] = {"BOOL",    "INT16", "UINT16", "INT32",
                                                     "UINT32",  "INT64", "UINT64", "FLOAT32",
                                                     "FLOAT64", "STRING"};
            std::map<std::string, std::string> types;
            for (size_t i = 0; i < store.size(); ++i)
                types[store.def(i).id] = kTypeNames[static_cast<int>(store.def(i).type)];
            historianInput.estimateBytesPerDay = static_cast<int64_t>(
                estimateLogging(validation.project->logging, types).writeBytesPerDay);
        }
        for (const auto& w : validation.warnings)
            if (w.code.rfind("W_LOG_", 0) == 0) historianInput.warnings.push_back(w.code);
    }
    std::unique_ptr<HistoryApi> historyApi;  // set below, read by the system/info lambda
    auto historianInfo = [&]() -> nlohmann::json {
        if (historyApi) {
            const auto qs = historyApi->limiter().stats();
            HistoryQueryInfo qi;
            qi.enabled = historyApi->options().enabled;
            qi.inFlight = qs.inFlight;
            qi.served = qs.served;
            qi.rejectedBusy = qs.rejectedBusy;
            qi.rejectedLimit = qs.rejectedLimit;
            qi.timeouts = qs.timeouts;
            qi.errors = qs.errors;
            qi.p95Ms = qs.p95Ms;
            qi.lastErrorCode = qs.lastErrorCode;
            qi.lastErrorAt = qs.lastErrorAt;
            historianInput.query = qi;
        }
        return historianInfoJson(historianInput,
                                 historian ? historian->status() : HistorianStatus{});
    };
    HttpApi api(hopt, [&] {
        return nlohmann::json{{"runtimeVersion", kRuntimeVersion},
                              {"protocolVersion", kLiveProtocolVersion},
                              {"schemaVersions", {"0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "1.0"}},
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
                              {"operation", operationInfoJson(pipeline.current())},
                              {"timeSynced", timeSync.synced()},  // feature 011 (T140)
                              // feature 011 (US4): the order of releases (build-info.json), which
                              // mat-updater checks after a switch
                              {"releaseSeq", updateService->releaseSeq()}};
    });

    // The engineering API (device-api §3): on HTTPS; on HTTP its paths answer 403 HTTPS_REQUIRED.
    EngineeringApi::Options engOptions;
    engOptions.hostPolicy = &hostPolicy;  // device/identity.acceptedHosts (011 §1)
    EngineeringApi engineering(engOptions, device, auth, audit);
    if (startup.opened) engineering.setProject({&pstore, &pipeline});  // device-api §4
    // Diagnostics and audit (device-api §6, §7; T142, T144): CPU, memory, disk and uptime from
    // /proc sampled every 5 s by the tick loop below; the discovery counters once that server
    // exists.
    ProcStats procStats(systemProcSource(), cfg.dataDir);
    procStats.sample();
    // Feature 011 (FR-009, FR-045): the bytes written today per component, from 00:00 of
    // tzOffsetMin. The counters only grow while the process lives (ADR-039 for the databases).
    DailyWriteMeter dailyWrites(cfg.tzOffsetMin);
    const auto sampleWrites = [&dailyWrites, &procStats, &rtEngine] {
        std::map<std::string, int64_t> c{{kWriteHistory, 0},
                                         {kWriteAlarm, 0},
                                         {kWriteAudit, 0},
                                         {kWriteRetain, 0},
                                         {kWriteLogic, 0}};
        for (const DbWriteBytes& d : dbWriteBytes()) {
            if (d.db == "history.db") c[kWriteHistory] += d.bytes;
            if (d.db == "alarm.db") c[kWriteAlarm] += d.bytes;
            if (d.db == "audit.db") c[kWriteAudit] += d.bytes;
        }
        c[kWriteRetain] = static_cast<int64_t>(rtEngine.retainDiag().bytesWritten);
        if (const auto io = procStats.snapshot().ioWriteBytes) c[kWriteProcess] = *io;
        dailyWrites.update(epochMs(), c);
    };
    sampleWrites();
    std::atomic<DiscoveryServer*> discoveryForDiag{nullptr};
    {
        EngineeringApi::DiagnosticsBackend diag;
        diag.proc = [&procStats] { return procStats.snapshot(); };
        diag.liveClients = [&transport] { return static_cast<int>(transport.active()); };
        diag.maxClients = [&transport] { return static_cast<int>(transport.maxClients()); };
        diag.discovery = [&discoveryForDiag] {
            const DiscoveryServer* d = discoveryForDiag.load();
            return d ? d->counters() : discovery::Counters{};
        };
        // Feature 011 (T140): the same answer as system/info.timeSynced.
        diag.timeSynced = [](int64_t) { return timeSync.synced(); };
        // Feature 011 (FR-009): restarts, bytes written today, eMMC wear, live lag.
        diag.restarts = [&runRecord] { return runRecord.info(); };
        diag.writesToday = [&dailyWrites] { return dailyWrites.today(); };
        diag.emmcLife = [] { return readEmmcLife(systemSysfsReader()); };
        diag.liveLagP95Ms = [&transport] { return transport.liveLagP95Ms(); };
        // Device API 1.1.0 §2: what the source filter turned away, the quality of the Tags, the
        // store of the retained ones.
        diag.viewer = [&viewerGate] {
            return nlohmann::json{{"access", viewerAccessName(viewerGate.access())},
                                  {"blockedTotal", viewerGate.blockedTotal()},
                                  {"lastBlockedAt", viewerGate.lastBlockedAt()}};
        };
        diag.tags = [&store] {
            std::vector<size_t> all(store.size());
            for (size_t i = 0; i < all.size(); ++i) all[i] = i;
            std::vector<TagValue> v;
            store.snapshot(all, v);
            size_t good = 0, uncertain = 0, bad = 0;
            for (const TagValue& t : v) {
                if (t.quality == Quality::GOOD)
                    ++good;
                else if (t.quality == Quality::UNCERTAIN)
                    ++uncertain;
                else
                    ++bad;
            }
            return nlohmann::json{
                {"total", v.size()}, {"good", good}, {"uncertain", uncertain}, {"bad", bad}};
        };
        diag.retain = [&rtEngine] {
            const RetainDiag rd = rtEngine.retainDiag();
            if (!rtEngine.retainStore()) return nlohmann::json{{"state", "off"}};
            // data-model §6: ok | fallback (the older file) | lost (both damaged) | off (no
            // retained Tag)
            const char* state = rd.status == RetainStatus::Lost
                                    ? "lost"
                                    : (rd.status == RetainStatus::Fallback ? "fallback" : "ok");
            const int64_t at = rtEngine.retainLastSaveAt();
            return nlohmann::json{
                {"state", state},
                {"tags", rd.entries},
                {"lastSaveAt", at > 0 ? nlohmann::json(at) : nlohmann::json(nullptr)},
                {"saves", rd.saves}};
        };
        engineering.setDiagnostics(std::move(diag));
    }

    // The connection test (device-api-1.1 §4; feature 006 T106): a new, temporary connection made
    // on the HTTP worker thread that took the request.
    {
        SerialDeviceEnv serialEnv;
        serialEnv.allowPatterns = cfg.serialPorts;
        serialEnv.channels = [&rtEngine] {
            return std::vector<drv::ModbusTcpDriver*>(rtEngine.channelDrivers().begin(),
                                                      rtEngine.channelDrivers().end());
        };
        EngineeringApi::DriversBackend drivers;
        drivers.probeTcp = [](const drv::TcpProbeRequest& r) { return drv::probeModbusTcp(r); };
        // Modbus RTU (T164): the console and ports out of serialPorts are refused, a port that a
        // channel holds is used through that channel.
        drivers.probeRtu = [serialEnv](const std::string& port, const drv::RtuProbeRequest& r) {
            return probeSerialOnDevice(serialEnv, port, r);
        };
        // GET /api/v1/drivers/diagnostics (T195)
        drivers.diagnostics = [&rtEngine, &store, startWallMs = epochMs()] {
            DriversDiagInput in;
            in.model = rtEngine.model();
            in.channels.assign(rtEngine.channelDrivers().begin(), rtEngine.channelDrivers().end());
            in.store = &store;
            in.engine = rtEngine.engine();
            in.nowMs = epochMs();
            in.startedAtMs = startWallMs;
            return driversDiagnosticsJson(in);
        };
        engineering.setDrivers(std::move(drivers));
        // GET /api/v1/serial/ports (T168)
        EngineeringApi::SerialBackend serial;
        serial.list = [serialEnv](bool probe, std::vector<std::string>& probed) {
            return serialPortsOnDevice(serialEnv, probe, probed);
        };
        engineering.setSerial(std::move(serial));
    }
    if (writes) engineering.setTags({&writes->coordinator()});  // device-api-1.1 §3
    engineering.setAlarms({&alarmGlue, monoMs});                // device-api-1.3 §3 (feature 009)
    engineering.setLogic({[&rtEngine] { return rtEngine.logic(); }});  // device-api-011 §4
    engineering.setUpdate({updateService.get()});                      // device-api-011 §3
    // GET /api/v1/history/* (feature 010): reads of history.db on connections of their own.
    if (historian) {
        HistoryApi::Options hq;
        hq.catalog = buildCatalog(historian->model(), {});
        hq.dbPath = cfg.dataDir + "/history.db";
        hq.enabled = cfg.historyApi && !historian->model().groups.empty();
        hq.maxConcurrent = cfg.historyMaxConcurrent;
        hq.timeoutMs = cfg.historyQueryTimeoutMs;
        hq.maxScanMiB = cfg.historyMaxScanMiB;
        const CacheBudget cb = budgetCaches(cfg.historyReaderCacheKiB);
        if (cb.lowered)
            std::fprintf(
                stderr,
                "history: historyReaderCacheKiB %d would take the SQLite caches above 32 MiB; "
                "using %d KiB\n",
                cfg.historyReaderCacheKiB, cb.readCacheKiB);
        hq.cacheKiB = cb.readCacheKiB;
        Historian* hp = historian.get();
        hq.state = [hp] { return std::string(historianStateName(hp->status().state)); };
        hq.audit = [&audit](const AuditEvent& e) { audit.append(e); };
        hq.nowUtc = epochMs;
        historyApi = std::make_unique<HistoryApi>(std::move(hq));
        engineering.setHistory(historyApi.get());
    }

    std::signal(SIGINT, onSignal);
    std::signal(SIGTERM, onSignal);
    // Step 8: the HTTP context (as in 0.3.0), then the HTTPS context with its own workers. HTTPS
    // failing never stops HTTP: system/info says why (device.https).
    // Feature 011 (FR-025): connections at once per source IP, HTTP, HTTPS and WebSocket together;
    // declared before the contexts so that it outlives them.
    ConnLimiter connLimiter(effectiveMaxConnPerSource(cfg.maxConnPerSource, cfg.httpsThreads));
    WebContexts web;
    WebOptions wo;
    wo.httpListen = std::to_string(cfg.port);
    wo.httpThreads = cfg.threads;
    wo.httpsListen = cfg.httpsPort != 0 ? std::to_string(cfg.httpsPort) + "s" : "";
    wo.httpsThreads = cfg.httpsThreads;
    wo.hostPolicy = &hostPolicy;
    wo.connLimiter = &connLimiter;
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
    discoveryForDiag.store(&discoveryServer);
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

    // Step 6 (device-config §7): the threads of the drivers and of the retained store.
    rtEngine.start();

    auto next = std::chrono::steady_clock::now();
    int64_t nextAuditFlush = monoMs() + kAuditFlushMs;
    int64_t nextAuditMaintain = monoMs() + kAuditMaintainMs;  // open() ran it once
    int64_t lastAuditError = -kAuditErrorLogMs;
    int64_t nextProcSample = monoMs() + kProcStatsPeriodMs;
    int64_t nextSshAudit = monoMs() + kSshAuditPeriodMs;
    int64_t nextUpdateSettle = monoMs() + 1000;
#ifdef MAT_TEST_HOOKS
    g_persistFailArmed = cfg.testPersistFail;
#endif
    while (g_run) {
        next += std::chrono::milliseconds(cfg.deltaPeriodMs);
        std::this_thread::sleep_until(next);
        const int64_t commitMono = monoMs();  // FR-009: liveLagP95Ms counts from here
        rtEngine.tick(epochMs());             // the Tag Engine round, right before the live deltas
        alarmGlue.tick();                     // the alarm round, right after it (feature 009)
        hub.tick(commitMono);
        transport.expire();
        tickCount.fetch_add(1);
        const int64_t now = monoMs();
        if (writes) writes->maintain(now);  // the table of write request ids, every 10 minutes
        if (now >= nextProcSample) {        // CPU, memory, disk for GET /api/v1/diagnostics (T142)
            nextProcSample = now + kProcStatsPeriodMs;
            procStats.sample();
            sampleWrites();
        }
        if (now >= nextSshAudit) {  // a few small files, read-only (FR-034)
            nextSshAudit = now + kSshAuditPeriodMs;
            publishSshWarning(auditSshConfig(), systemWarnings);
        }
        // OTA (feature 011, review T062): a verified package expires; a result of mat-updater that
        // did not restart the runtime is audited and frees the device. One small file, every
        // second.
        if (updateService && now >= nextUpdateSettle) {
            nextUpdateSettle = now + 1000;
            updateService->expire();
        }
        if (audit.isOpen() && now >= nextAuditFlush) {
            nextAuditFlush = now + kAuditFlushMs;
            hostPolicy.flushDenied();  // L1 of the review of 011: sums of the Host refusals
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
    parts.writes.store(nullptr);
    parts.alarms.store(nullptr);
    if (writes) writes->coordinator().waitAuditIdle();
    rtEngine.stop();   // the retained values first, then the drivers (device-config §7)
    alarmGlue.stop();  // what alarm.db still queues is written, the file closed clean
    discoveryForDiag.store(nullptr);
    discoveryServer.stop();            // device discovery (T060)
    if (historian) historian->stop();  // commits the buffered rows
    web.stop();                        // HTTPS, then HTTP: no request runs after this
    hostPolicy.flushDenied(true);      // the sums of the Host refusals still counted
    audit.close();                     // the counts still in memory
    runRecord.end(false);              // a clean stop (FR-009 restarts)
    return g_exitCode;
}
