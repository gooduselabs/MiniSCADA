// mat-poc: Sprint 0 PoC. Static files + WebSocket /api/v1/live
// (contract: specs/001-platform-validation/contracts/live-ws.md). CivetWeb based.
// Not for production: no auth, no TLS, no write-queue backpressure.
#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "civetweb.h"
#include "core/session-manager/session_manager.hpp"
#include "sim_tags.hpp"

namespace {

using Clock = std::chrono::steady_clock;
constexpr const char* kVersion = "0.1.0-poc";
constexpr int kCloseMaxClients = 4429;
constexpr int kCloseHeartbeatTimeout = 4408;
constexpr int kDeltaPeriodMs = 250;
constexpr int kHeartbeatPeriodMs = 5000;

int64_t nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now().time_since_epoch())
        .count();
}

struct Conn {
    uint64_t sid = 0;
    mg_connection* c = nullptr;
    std::mutex wmu;  // serialises writes and guards `alive`
    bool alive = true;
    std::atomic<bool> subscribed{false};
    bool accepted = false;
};

std::atomic<bool> g_run{true};
mat::SimTags g_tags;
std::mutex g_tagMu;
// Tuần tự hóa "snapshot + đăng ký" với "tạo + gửi delta": không để delta chen giữa snapshot và
// lúc client được đưa vào danh sách nhận (trước đây gây mất 1 sequence lúc đăng ký).
std::mutex g_bcMu;
std::atomic<uint64_t> g_seq{0};
std::mutex g_regMu;
std::vector<std::shared_ptr<Conn>> g_conns;     // accepted, currently open
std::vector<std::shared_ptr<Conn>> g_retained;  // owns Conn memory (raw ptr kept in civetweb)
std::unique_ptr<mat::SessionManager> g_sessions;
int64_t g_startMs = 0;

bool writeText(Conn& cn, const std::string& s) {
    std::lock_guard<std::mutex> g(cn.wmu);
    if (!cn.alive) return false;
    return mg_websocket_write(cn.c, MG_WEBSOCKET_OPCODE_TEXT, s.data(), s.size()) > 0;
}

void sendClose(Conn& cn, int code, const char* reason) {
    std::lock_guard<std::mutex> g(cn.wmu);
    if (!cn.alive) return;
    std::string p;
    p.push_back(static_cast<char>(code >> 8));
    p.push_back(static_cast<char>(code & 0xFF));
    p += reason;
    mg_websocket_write(cn.c, MG_WEBSOCKET_OPCODE_CONNECTION_CLOSE, p.data(), p.size());
}

std::string snapshotJson() {
    std::string s = "{\"type\":\"snapshot\",\"subscriptionId\":\"s1\",\"sequence\":" +
                    std::to_string(g_seq.load()) + ",\"tags\":[";
    std::lock_guard<std::mutex> g(g_tagMu);
    char buf[96];
    for (size_t i = 0; i < g_tags.size(); ++i) {
        std::snprintf(buf, sizeof buf,
                      "%s{\"id\":\"SIM.T%04zu\",\"value\":%.2f,\"quality\":\"GOOD\"}", i ? "," : "",
                      i + 1, g_tags.value(i));
        s += buf;
    }
    return s + "]}";
}

int wsConnect(const mg_connection*, void*) { return 0; }

void wsReady(mg_connection* c, void*) {
    auto cn = std::make_shared<Conn>();
    cn->c = c;
    {
        std::lock_guard<std::mutex> g(g_regMu);
        g_retained.push_back(cn);
        // Bound memory: drop closed entries (alive=false) beyond a small backlog.
        if (g_retained.size() > 256) {
            std::vector<std::shared_ptr<Conn>> keep;
            for (auto& r : g_retained)
                if (r->alive) keep.push_back(r);
            g_retained.swap(keep);
        }
    }
    mg_set_user_connection_data(c, cn.get());
    auto id = g_sessions->tryAcquire();
    if (!id) {
        writeText(*cn,
                  "{\"type\":\"error\",\"code\":\"MAX_CLIENTS_REACHED\",\"message\":"
                  "\"He thong da dat toi da 10 ket noi. Vui long thu lai sau.\"}");
        sendClose(*cn, kCloseMaxClients, "MAX_CLIENTS_REACHED");
        return;
    }
    cn->sid = *id;
    cn->accepted = true;
    {
        std::lock_guard<std::mutex> g(g_regMu);
        g_conns.push_back(cn);
    }
    char hello[160];
    std::snprintf(
        hello, sizeof hello,
        "{\"type\":\"hello\",\"serverVersion\":\"%s\",\"maxClients\":%zu,\"tagCount\":%zu}",
        kVersion, g_sessions->maxClients(), g_tags.size());
    writeText(*cn, hello);
}

int wsData(mg_connection* c, int flags, char* data, size_t len, void*) {
    auto* cn = static_cast<Conn*>(mg_get_user_connection_data(c));
    if (!cn) return 0;
    const int opcode = flags & 0xF;
    if (opcode == MG_WEBSOCKET_OPCODE_CONNECTION_CLOSE) return 0;
    if (!cn->accepted) return 0;  // rejected client: end the connection
    g_sessions->heartbeat(cn->sid);
    if (opcode != MG_WEBSOCKET_OPCODE_TEXT) return 1;
    std::string msg(data, len);
    if (msg.find("\"subscribe\"") != std::string::npos && !cn->subscribed) {
        std::lock_guard<std::mutex> b(g_bcMu);
        writeText(*cn, snapshotJson());
        cn->subscribed = true;
    }
    return 1;
}

void wsClose(const mg_connection* c, void*) {
    auto* cn = static_cast<Conn*>(mg_get_user_connection_data(c));
    if (!cn) return;
    {
        std::lock_guard<std::mutex> g(cn->wmu);
        cn->alive = false;
    }
    if (cn->accepted) g_sessions->release(cn->sid);
    std::lock_guard<std::mutex> g(g_regMu);
    for (auto it = g_conns.begin(); it != g_conns.end(); ++it)
        if (it->get() == cn) {
            g_conns.erase(it);
            break;
        }
}

int infoHandler(mg_connection* c, void*) {
    char body[256];
    int n = std::snprintf(body, sizeof body,
                          "{\"version\":\"%s\",\"clients\":%zu,\"maxClients\":%zu,"
                          "\"rejectedTotal\":%llu,\"uptimeS\":%lld}",
                          kVersion, g_sessions->active(), g_sessions->maxClients(),
                          static_cast<unsigned long long>(g_sessions->rejectedTotal()),
                          static_cast<long long>((nowMs() - g_startMs) / 1000));
    mg_printf(c,
              "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\n"
              "Cache-Control: no-store\r\nConnection: close\r\n\r\n%s",
              n, body);
    return 200;
}

std::vector<std::shared_ptr<Conn>> subscribers() {
    std::lock_guard<std::mutex> g(g_regMu);
    std::vector<std::shared_ptr<Conn>> v;
    for (auto& c : g_conns)
        if (c->subscribed) v.push_back(c);
    return v;
}

// Every 250 ms advance a quarter of the tags (all 500 change once per second) and push a
// delta; every 5 s a heartbeat; also frees the slots of silent sessions.
void broadcastLoop() {
    size_t cursor = 0;
    std::vector<size_t> changed;
    int64_t nextHb = nowMs() + kHeartbeatPeriodMs;
    auto next = Clock::now();
    while (g_run) {
        next += std::chrono::milliseconds(kDeltaPeriodMs);
        std::this_thread::sleep_until(next);
        std::unique_lock<std::mutex> bc(g_bcMu);
        std::string d;
        {
            std::lock_guard<std::mutex> g(g_tagMu);
            g_tags.step(&cursor, g_tags.size() / 4, &changed);
            d.reserve(changed.size() * 24 + 80);
            d = "{\"type\":\"delta\",\"subscriptionId\":\"s1\",\"sequence\":" +
                std::to_string(++g_seq) + ",\"tags\":[";
            char buf[48];
            for (size_t k = 0; k < changed.size(); ++k) {
                std::snprintf(buf, sizeof buf, "%s[%zu,%.2f,\"GOOD\"]", k ? "," : "", changed[k],
                              g_tags.value(changed[k]));
                d += buf;
            }
            d += "]}";
        }
        for (auto& cn : subscribers()) writeText(*cn, d);
        bc.unlock();

        const int64_t t = nowMs();
        if (t >= nextHb) {
            nextHb = t + kHeartbeatPeriodMs;
            const std::string hb = "{\"type\":\"heartbeat\",\"ts\":" + std::to_string(t) + "}";
            for (auto& cn : subscribers()) writeText(*cn, hb);
        }
        // Silent clients lose their slot after 15 s; they are also told to go away (4408).
        for (uint64_t sid : g_sessions->expireIds()) {
            std::shared_ptr<Conn> victim;
            {
                std::lock_guard<std::mutex> g(g_regMu);
                for (auto& c : g_conns)
                    if (c->sid == sid) victim = c;
            }
            if (victim) {
                victim->subscribed = false;
                sendClose(*victim, kCloseHeartbeatTimeout, "HEARTBEAT_TIMEOUT");
            }
        }
    }
}

void onSignal(int) { g_run = false; }

}  // namespace

int main(int argc, char** argv) {
    std::string port = "8080", docroot = "./web";
    size_t maxClients = 10;
    for (int i = 1; i + 1 < argc; i += 2) {
        if (!std::strcmp(argv[i], "--port"))
            port = argv[i + 1];
        else if (!std::strcmp(argv[i], "--docroot"))
            docroot = argv[i + 1];
        else if (!std::strcmp(argv[i], "--max-clients"))
            maxClients = std::strtoul(argv[i + 1], nullptr, 10);
    }
    if (maxClients > mat::SessionManager::kHardLimit)
        std::fprintf(stderr, "warning: --max-clients %zu > 10, clamped to 10\n", maxClients);
    g_startMs = nowMs();
    g_sessions = std::make_unique<mat::SessionManager>(maxClients, nowMs);

    std::signal(SIGINT, onSignal);
    std::signal(SIGTERM, onSignal);
    mg_init_library(0);
    const char* opts[] = {"listening_ports",
                          port.c_str(),
                          "document_root",
                          docroot.c_str(),
                          "num_threads",
                          "16",
                          "enable_directory_listing",
                          "no",
                          "static_file_max_age",
                          "3600",
                          nullptr};
    mg_callbacks cb{};
    mg_context* ctx = mg_start(&cb, nullptr, opts);
    if (!ctx) {
        std::fprintf(stderr, "mg_start failed\n");
        return 1;
    }
    mg_set_request_handler(ctx, "/api/v1/system/info", infoHandler, nullptr);
    mg_set_websocket_handler(ctx, "/api/v1/live", wsConnect, wsReady, wsData, wsClose, nullptr);
    std::printf("mat-poc %s on :%s docroot=%s maxClients=%zu\n", kVersion, port.c_str(),
                docroot.c_str(), g_sessions->maxClients());
    std::fflush(stdout);

    std::thread bc(broadcastLoop);
    while (g_run) std::this_thread::sleep_for(std::chrono::milliseconds(200));
    bc.join();
    mg_stop(ctx);
    mg_exit_library();
    return 0;
}
