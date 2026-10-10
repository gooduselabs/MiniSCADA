// mat-runtime (Sprint 1): CivetWeb + live protocol 1.0.0 + Mock Tag provider + project v0.
// Contracts: specs/002-vertical-slice/contracts/. Exit codes: 0 ok, 1 --check-project invalid,
// 2 bad configuration, 3 cannot start the web server.
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <memory>
#include <string>
#include <thread>

#include "civetweb.h"
#include "core/project-manager/project_validator.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "drivers/simulation/mock_tag_provider.hpp"
#include "server/config.hpp"
#include "server/http/http_api.hpp"
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

}  // namespace

int main(int argc, char** argv) {
    using namespace mat;
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

    // Tags of the active project; an invalid project is not activated (FR-025), but the page and
    // the system info stay available so the error is visible.
    TagStore store;
    size_t maxClients = static_cast<size_t>(cfg.maxClients);
    std::string helloProject = "null";
    if (validation.valid) {
        const auto& p = *validation.project;
        for (const auto& t : p.tags["tags"]) {
            auto type = parseTagType(t["type"].get<std::string>());
            store.add({t["id"].get<std::string>(), type ? *type : TagType::FLOAT64,
                       t["source"]["signal"].get<std::string>()});
        }
        maxClients = std::min(maxClients, p.project["maxClients"].get<size_t>());
        helloProject = p.helloJson();
        std::printf("project '%s' %s active (%zu tags)\n",
                    p.project["projectId"].get<std::string>().c_str(),
                    p.project["projectVersion"].get<std::string>().c_str(), store.size());
    } else {
        std::fprintf(stderr, "project in %s is NOT active:\n%s\n", cfg.projectDir.c_str(),
                     resultJson(validation).c_str());
    }
    MockTagProvider provider(store, cfg.simLoad);

    CivetLiveTransport::Options to;
    to.maxClients = maxClients;
    to.queueBytes = cfg.sendQueueBytes;
    to.heartbeatTimeoutMs = cfg.heartbeatTimeoutMs;
    to.allowedOrigins = cfg.allowedOrigins;
    CivetLiveTransport transport(to, monoMs);

    HubOptions ho;
    ho.serverVersion = kRuntimeVersion;
    ho.maxClients = transport.maxClients();
    ho.timeoutMs = cfg.heartbeatTimeoutMs;
    ho.projectJson = helloProject;
    LiveHub hub(store, transport, ho, epochMs, monoMs);
    transport.attach(&hub);

    const int64_t startMs = monoMs();
    HttpApi::Options hopt;
    hopt.docroot = cfg.docroot;
    hopt.projectDir = cfg.projectDir;
    hopt.allowedOrigins = cfg.allowedOrigins;
    if (validation.valid) {
        hopt.projectAllowlist = validation.project->allowlist();
        hopt.activeProjectJson = validation.project->activeJson();
    }
    hopt.projectErrors = issuesJson(validation.errors);
    nlohmann::json projectInfo = {{"status", validation.valid ? "active" : "invalid"},
                                  {"errors", issuesJson(validation.errors)}};
    if (validation.valid) {
        projectInfo["projectId"] = validation.project->project["projectId"];
        projectInfo["projectVersion"] = validation.project->project["projectVersion"];
    } else if (!validation.errors.empty() && validation.errors[0].code == "E_FILE_MISSING" &&
               validation.errors[0].file == "project.json") {
        projectInfo["status"] = "missing";
    }
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
                              {"project", projectInfo},
                              {"tagCount", store.size()}};
    });

    std::signal(SIGINT, onSignal);
    std::signal(SIGTERM, onSignal);
    std::signal(SIGPIPE, SIG_IGN);
    mg_init_library(0);
    const std::string port = std::to_string(cfg.port);
    const std::string threads = std::to_string(cfg.threads);
    const char* opts[] = {"listening_ports",
                          port.c_str(),
                          "num_threads",
                          threads.c_str(),
                          "request_timeout_ms",
                          "10000",
                          "websocket_timeout_ms",
                          "5000",
                          "enable_websocket_ping_pong",
                          "yes",
                          "additional_header",
                          "X-Content-Type-Options: nosniff",
                          nullptr};
    mg_callbacks cb{};
    mg_context* ctx = mg_start(&cb, nullptr, opts);
    if (!ctx) {
        std::fprintf(stderr, "cannot start web server on port %s\n", port.c_str());
        mg_exit_library();
        return 3;
    }
    api.install(ctx);
    transport.install(ctx, "/api/v1/live");
    std::printf("mat-runtime %s listening on :%s (maxClients=%zu, docroot=%s)\n", kRuntimeVersion,
                port.c_str(), transport.maxClients(), cfg.docroot.c_str());
    std::fflush(stdout);

    auto next = std::chrono::steady_clock::now();
    while (g_run) {
        next += std::chrono::milliseconds(cfg.deltaPeriodMs);
        std::this_thread::sleep_until(next);
        provider.step(epochMs());
        hub.tick();
        transport.expire();
    }
    std::printf("mat-runtime stopping\n");
    mg_stop(ctx);
    mg_exit_library();
    return 0;
}
