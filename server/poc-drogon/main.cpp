// mat-poc-drogon: PoC so sánh (T026, FR-007) — cùng contract với server/main.cpp (CivetWeb):
// file tĩnh (.gz nén sẵn) + WebSocket /api/v1/live (contracts/live-ws.md). Dùng chung
// SessionManager và SimTags để phép đo chỉ khác ở tầng web server. Không dùng cho vận hành: không
// auth, không TLS.
#include <drogon/WebSocketController.h>
#include <drogon/drogon.h>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "core/session-manager/session_manager.hpp"
#include "sim_tags.hpp"

namespace {

using Clock = std::chrono::steady_clock;
constexpr const char* kVersion = "0.1.0-poc-drogon";
constexpr int kCloseMaxClients = 4429;
constexpr int kCloseHeartbeatTimeout = 4408;
constexpr double kDeltaPeriodS = 0.25;
constexpr int64_t kHeartbeatPeriodMs = 5000;

int64_t nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now().time_since_epoch())
        .count();
}

struct ConnCtx {
    uint64_t sid = 0;
    bool accepted = false;
    bool subscribed = false;
};

mat::SimTags g_tags;
std::mutex g_tagMu;
std::atomic<uint64_t> g_seq{0};
std::mutex g_regMu;
std::vector<drogon::WebSocketConnectionPtr> g_conns;  // đã được nhận, đang mở
std::unique_ptr<mat::SessionManager> g_sessions;
int64_t g_startMs = 0;

drogon::CloseCode closeCode(int code) { return static_cast<drogon::CloseCode>(code); }

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

std::vector<drogon::WebSocketConnectionPtr> subscribers() {
    std::lock_guard<std::mutex> g(g_regMu);
    std::vector<drogon::WebSocketConnectionPtr> v;
    for (auto& c : g_conns)
        if (c->getContext<ConnCtx>()->subscribed) v.push_back(c);
    return v;
}

// Mỗi 250 ms: đổi 1/4 số Tag (cả 500 Tag đổi mỗi giây), gửi delta; mỗi 5 s gửi heartbeat;
// phiên im lặng > 15 s bị đóng 4408 (giống server CivetWeb).
void tick() {
    static size_t cursor = 0;
    static std::vector<size_t> changed;
    static int64_t nextHb = nowMs() + kHeartbeatPeriodMs;
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
    for (auto& c : subscribers()) c->send(d);

    const int64_t t = nowMs();
    if (t >= nextHb) {
        nextHb = t + kHeartbeatPeriodMs;
        const std::string hb = "{\"type\":\"heartbeat\",\"ts\":" + std::to_string(t) + "}";
        for (auto& c : subscribers()) c->send(hb);
    }
    for (uint64_t sid : g_sessions->expireIds()) {
        std::lock_guard<std::mutex> g(g_regMu);
        for (auto& c : g_conns) {
            auto ctx = c->getContext<ConnCtx>();
            if (ctx->sid == sid) {
                ctx->subscribed = false;
                c->shutdown(closeCode(kCloseHeartbeatTimeout), "HEARTBEAT_TIMEOUT");
            }
        }
    }
}

}  // namespace

class LiveWs : public drogon::WebSocketController<LiveWs> {
   public:
    void handleNewConnection(const drogon::HttpRequestPtr&,
                             const drogon::WebSocketConnectionPtr& conn) override {
        auto ctx = std::make_shared<ConnCtx>();
        conn->setContext(ctx);
        auto id = g_sessions->tryAcquire();
        if (!id) {
            conn->send(
                "{\"type\":\"error\",\"code\":\"MAX_CLIENTS_REACHED\",\"message\":"
                "\"He thong da dat toi da 10 ket noi. Vui long thu lai sau.\"}");
            conn->shutdown(closeCode(kCloseMaxClients), "MAX_CLIENTS_REACHED");
            return;
        }
        ctx->sid = *id;
        ctx->accepted = true;
        {
            std::lock_guard<std::mutex> g(g_regMu);
            g_conns.push_back(conn);
        }
        char hello[160];
        std::snprintf(
            hello, sizeof hello,
            "{\"type\":\"hello\",\"serverVersion\":\"%s\",\"maxClients\":%zu,\"tagCount\":%zu}",
            kVersion, g_sessions->maxClients(), g_tags.size());
        conn->send(hello);
    }

    void handleNewMessage(const drogon::WebSocketConnectionPtr& conn, std::string&& msg,
                          const drogon::WebSocketMessageType& type) override {
        auto ctx = conn->getContext<ConnCtx>();
        if (!ctx || !ctx->accepted) return;
        g_sessions->heartbeat(ctx->sid);
        if (type != drogon::WebSocketMessageType::Text) return;
        if (msg.find("\"subscribe\"") != std::string::npos) {
            // Xử lý trên cùng event loop với tick(): snapshot và đăng ký không bị delta chen giữa.
            drogon::app().getLoop()->queueInLoop([conn, ctx] {
                if (ctx->subscribed) return;
                conn->send(snapshotJson());
                ctx->subscribed = true;
            });
        }
    }

    void handleConnectionClosed(const drogon::WebSocketConnectionPtr& conn) override {
        auto ctx = conn->getContext<ConnCtx>();
        if (!ctx || !ctx->accepted) return;
        g_sessions->release(ctx->sid);
        std::lock_guard<std::mutex> g(g_regMu);
        for (auto it = g_conns.begin(); it != g_conns.end(); ++it)
            if (*it == conn) {
                g_conns.erase(it);
                break;
            }
    }

    WS_PATH_LIST_BEGIN
    WS_PATH_ADD("/api/v1/live");
    WS_PATH_LIST_END
};

int main(int argc, char** argv) {
    uint16_t port = 8080;
    std::string docroot = "./web";
    size_t maxClients = 10;
    for (int i = 1; i + 1 < argc; i += 2) {
        if (!std::strcmp(argv[i], "--port"))
            port = static_cast<uint16_t>(std::strtoul(argv[i + 1], nullptr, 10));
        else if (!std::strcmp(argv[i], "--docroot"))
            docroot = argv[i + 1];
        else if (!std::strcmp(argv[i], "--max-clients"))
            maxClients = std::strtoul(argv[i + 1], nullptr, 10);
    }
    if (maxClients > mat::SessionManager::kHardLimit)
        std::fprintf(stderr, "warning: --max-clients %zu > 10, clamped to 10\n", maxClients);
    g_startMs = nowMs();
    g_sessions = std::make_unique<mat::SessionManager>(maxClients, nowMs);

    drogon::app().registerHandler(
        "/api/v1/system/info",
        [](const drogon::HttpRequestPtr&,
           std::function<void(const drogon::HttpResponsePtr&)>&& callback) {
            char body[256];
            const int n =
                std::snprintf(body, sizeof body,
                              "{\"version\":\"%s\",\"clients\":%zu,\"maxClients\":%zu,"
                              "\"rejectedTotal\":%llu,\"uptimeS\":%lld}",
                              kVersion, g_sessions->active(), g_sessions->maxClients(),
                              static_cast<unsigned long long>(g_sessions->rejectedTotal()),
                              static_cast<long long>((nowMs() - g_startMs) / 1000));
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setContentTypeCode(drogon::CT_APPLICATION_JSON);
            resp->addHeader("Cache-Control", "no-store");
            // setBody(const char (&)[N]) gửi cả mảng N byte: phải truyền độ dài thật.
            resp->setBody(std::string(body, static_cast<size_t>(n)));
            callback(resp);
        },
        {drogon::Get});

    std::printf("mat-poc-drogon %s on :%u docroot=%s maxClients=%zu\n", kVersion, port,
                docroot.c_str(), g_sessions->maxClients());
    std::fflush(stdout);

    drogon::app()
        .setLogLevel(trantor::Logger::kWarn)
        .addListener("0.0.0.0", port)
        .setThreadNum(2)  // 2 nhân Cortex-A7
        .setDocumentRoot(docroot)
        // Mặc định Drogon không phục vụ .json; danh sách này đủ cho apps/runtime-web/dist.
        .setFileTypes({"html", "js", "css", "svg", "json", "png", "ico", "txt"})
        // Số âm = không cache file tĩnh trong RAM (giống CivetWeb đọc từ đĩa) để so sánh RSS công
        // bằng.
        .setStaticFilesCacheTime(-1)
        .setStaticFileHeaders({{"Cache-Control", "max-age=3600"}})
        .setGzipStatic(true);
    drogon::app().getLoop()->runEvery(kDeltaPeriodS, tick);
    drogon::app().run();
    return 0;
}
