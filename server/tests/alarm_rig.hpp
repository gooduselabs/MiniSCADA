// The alarm engine in process for the tests of the routes (feature 009 T044, T090, T114): an
// AlarmGlue over a real TagStore, alarm.db in a temp directory and the real audit log of ApiRig, a
// thread that gives the engine its rounds, and the two listeners with the page's handlers (HttpApi,
// source filter) and the engineering API with the POST routes. A test moves a Tag and waits for the
// engine; the audit of the glue can be made to fail.
#pragma once
#include <sys/stat.h>

#include <atomic>
#include <chrono>
#include <functional>
#include <memory>
#include <thread>

#include "core/alarm/alarm_store.hpp"
#include "server/alarm_glue.hpp"
#include "server/http/http_api.hpp"
#include "server/http/source_filter.hpp"
#include "server/http/viewer_gate.hpp"
#include "server/tests/api_rig.hpp"

namespace mat::test {

inline nlohmann::json alarmClassesDoc() {
    using nlohmann::json;
    return {{"classes",
             json::array(
                 {{{"id", "critical"}, {"name", "Khẩn cấp"}, {"priority", "critical"},
                   {"color", "red"}, {"blink", true}, {"requiresAck", true}, {"ackReturn", false},
                   {"sound", "siren"}, {"chatterLimit", 5}},
                  {{"id", "minor"}, {"name", "Nhỏ"}, {"priority", "minor"}, {"color", "amber"},
                   {"blink", false}, {"requiresAck", true}, {"ackReturn", false},
                   {"sound", "beep"}, {"chatterLimit", 5}},
                  {{"id", "info"}, {"name", "Thông tin"}, {"priority", "advisory"},
                   {"color", "blue"}, {"blink", false}, {"requiresAck", false},
                   {"ackReturn", false}, {"sound", "none"}, {"chatterLimit", 0}}})}};
}

struct AlarmWorldOptions {
    int extra = 0;           // X01..Xnn: more digital alarms of class minor (the limit of 50 shelves)
    bool withAlarms = true;  // false: a project without alarms
    int commandWaitMs = 1500;
    int commitMs = 100;
    // Before the engine starts: put things in the data directory (an old alarm.db, a damaged one).
    std::function<void(const std::string& dataDir)> prepare;
    alarm::HistoryOptions history;
    std::function<int64_t()> freeBytes;
    std::vector<std::string> tagsOn;  // BOOL Tags that are true when the engine starts
    int64_t minFreeBytes = 0;
};

class AlarmWorld {
   public:
    ~AlarmWorld() { stopTicker(); }

    TagStore store;
    std::unique_ptr<AlarmGlue> glue;
    LoadedProject project;
    std::atomic<bool> auditFails{false};
    std::atomic<int> auditCalls{0};

    static int64_t nowMs() {
        return std::chrono::duration_cast<std::chrono::milliseconds>(
                   std::chrono::system_clock::now().time_since_epoch())
            .count();
    }

    // Tags: TANK.LEVEL (FLOAT32), P1.FAULT, P2.FAULT, P3.INFO (BOOL), X01.. (BOOL)
    void init(ApiRig& rig, const AlarmWorldOptions& o) {
        using nlohmann::json;
        json tags = json::array();
        auto addTag = [&](const std::string& id, const char* type, const char* unit = "") {
            store.add({id, type[0] == 'F' ? TagType::FLOAT32 : TagType::BOOL, ""});
            tags.push_back({{"id", id}, {"type", type}, {"unit", unit}});
        };
        addTag("TANK.LEVEL", "FLOAT32", "%");
        addTag("P1.FAULT", "BOOL");
        addTag("P2.FAULT", "BOOL");
        addTag("P3.INFO", "BOOL");
        for (int i = 1; i <= o.extra; ++i) addTag(xName(i), "BOOL");
        for (size_t i = 0; i < store.size(); ++i)
            store.set(i, store.def(i).type == TagType::BOOL ? TagScalar(false) : TagScalar(10.0),
                      Quality::GOOD, nowMs(), nowMs());
        store.takeDirty();
        project.tags = {{"tags", tags}};
        if (o.withAlarms) {
            json alarms = json::array(
                {{{"id", "TANK_LEVEL"}, {"type", "limit"}, {"name", "Mức bồn"}, {"area", "bon"},
                  {"tag", "TANK.LEVEL"},
                  {"limits", {{"HH", {{"value", 90}, {"class", "critical"}}},
                              {"H", {{"value", 80}, {"class", "minor"}}}}}},
                 {{"id", "P1_FAULT"}, {"type", "digital"}, {"name", "Bơm 1 lỗi"}, {"area", "bom"},
                  {"tag", "P1.FAULT"}, {"class", "critical"}},
                 {{"id", "P2_FAULT"}, {"type", "digital"}, {"name", "Bơm 2 lỗi"}, {"tag", "P2.FAULT"},
                  {"class", "minor"}},
                 {{"id", "P3_INFO"}, {"type", "digital"}, {"name", "Báo thông tin"}, {"tag", "P3.INFO"},
                  {"class", "info"}}});
            for (int i = 1; i <= o.extra; ++i)
                alarms.push_back({{"id", "X" + two(i)}, {"type", "digital"},
                                  {"name", "Alarm phụ " + two(i)}, {"tag", xName(i)},
                                  {"class", "minor"}});
            project.alarms = {{"areas", json::array({{{"id", "bon"}, {"name", "Bồn"}},
                                                     {{"id", "bom"}, {"name", "Bơm"}}})},
                              {"alarms", alarms}};
            project.alarmClasses = alarmClassesDoc();
        }
        for (const auto& t : o.tagsOn) setBool(t, true);
        store.takeDirty();
        if (o.prepare) o.prepare(rig.dataDir);

        AlarmGlueOptions go;
        go.dataDir = rig.dataDir;
        go.commandWaitMs = o.commandWaitMs;
        go.service.commitMs = o.commitMs;
        go.service.commitMaxMs = 1000;
        go.service.retryMs = 200;
        go.service.freeBytes = o.freeBytes;
        go.minFreeBytes = o.minFreeBytes;
        go.history = o.history;
        go.audit = [this, &rig](const AuditEvent& e) {
            ++auditCalls;
            if (auditFails) throw AuditUnavailable("test: audit.db cannot be written");
            rig.audit->append(e);
        };
        glue = std::make_unique<AlarmGlue>(go);
        std::string err;
        EXPECT_TRUE(glue->start(o.withAlarms ? &project : nullptr, store, err)) << err;
        startTicker();
    }

    static std::string two(int i) { return (i < 10 ? "0" : "") + std::to_string(i); }
    static std::string xName(int i) { return "X" + two(i) + ".FAULT"; }

    void startTicker() {
        run_ = true;
        ticker_ = std::thread([this] {
            while (run_) {
                glue->tick();
                std::this_thread::sleep_for(std::chrono::milliseconds(20));
            }
        });
    }
    void stopTicker() {
        run_ = false;
        if (ticker_.joinable()) ticker_.join();
    }

    void setBool(const std::string& tag, bool v) {
        const auto i = store.indexOf(tag);
        ASSERT_TRUE(i.has_value()) << tag;
        store.set(*i, TagScalar(v), Quality::GOOD, nowMs(), nowMs());
    }
    void setNumber(const std::string& tag, double v) {
        const auto i = store.indexOf(tag);
        ASSERT_TRUE(i.has_value()) << tag;
        store.set(*i, TagScalar(v), Quality::GOOD, nowMs(), nowMs());
    }

    // Waits for `pred` (polled every 10 ms).
    static bool waitFor(const std::function<bool()>& pred, int timeoutMs = 3000) {
        const auto end = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
        while (std::chrono::steady_clock::now() < end) {
            if (pred()) return true;
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        return pred();
    }
    // The state of an instance in the engine's view; "NORMAL" when it is not in it.
    std::string stateOf(const std::string& id) {
        auto v = glue->engine().view();
        const alarm::AlarmItem* it = v ? v->find(id) : nullptr;
        return it ? alarm::stateName(it->state) : "NORMAL";
    }
    int64_t occurrenceOf(const std::string& id) {
        auto v = glue->engine().view();
        const alarm::AlarmItem* it = v ? v->find(id) : nullptr;
        return it ? it->occurrence : 0;
    }
    // Moves the Tag and waits until the instance is in `state`.
    bool raise(const std::string& tag, const std::string& id, const std::string& state = "ACTIVE_UNACK") {
        setBool(tag, true);
        return waitFor([&] { return stateOf(id) == state; });
    }

   private:
    std::atomic<bool> run_{false};
    std::thread ticker_;
};

// The two listeners with the page's handlers and the alarm routes. `viewerHooks`: the address the
// source filter sees (a test hook, the sessions are still looked up under the real one).
struct AlarmRig : ApiRig {
    explicit AlarmRig(AlarmWorldOptions options = {}, std::shared_ptr<AlarmWorld> w = std::make_shared<AlarmWorld>())
        : ApiRig([w, options](ApiRig& r) {
              w->init(r, options);
              EngineeringApi::DiagnosticsBackend diag;  // GET /audit and /diagnostics
              diag.proc = [] { return ProcSnapshot{}; };
              r.eng->setDiagnostics(diag);
              r.eng->setAlarms({w->glue.get(), [&r] { return r.mono.load(); }});
          }),
          world(std::move(w)) {
        docroot = dir.file("web");
        ::mkdir(docroot.c_str(), 0755);
        ::mkdir((docroot + "/assets").c_str(), 0755);
        origin = "https://127.0.0.1:" + std::to_string(web.httpsPort());
    }

    // The page's own handlers (HttpApi) on both listeners. `publicSource`: the filter sees a
    // source outside the private networks.
    void servePage(bool publicSource = false, ViewerAccess access = ViewerAccess::Private) {
        ViewerGate::Hooks hooks;
        if (publicSource) hooks.remoteIp = [](const std::string&) { return "8.8.8.8"; };
        const auto real = [publicSource](const std::string& ip) {
            return publicSource ? std::string("127.0.0.1") : ip;
        };
        gate = std::make_unique<ViewerGate>(
            access,
            [this, real](const std::string& token, const std::string& ip, int port) {
                ClientAddress from;
                from.ip = real(ip);
                from.port = port;
                return auth->authorize(token, from, Role::Viewer, false).status == AccessStatus::Ok;
            },
            hooks);
        gate->setWebSessions(
            [this, real](const std::string& token, const std::string& ip, int port) {
                ClientAddress from;
                from.ip = real(ip);
                from.port = port;
                return auth->authorizeWeb(token, from, Role::Viewer, false).status ==
                       AccessStatus::Ok;
            },
            false);
        HttpApi::Options o;
        o.docroot = docroot;
        o.projectDir = dir.file("project");
        o.device = device.get();
        o.gate = gate.get();
        o.alarms = world->glue.get();
        api = std::make_unique<HttpApi>(o, [] {
            return nlohmann::json{{"runtimeVersion", "0.8.0"}, {"project", {{"status", "running"}}}};
        });
        for (mg_context* ctx : {web.http(), web.https()}) api->install(ctx);
    }

    // The cookie and the CSRF token of a web session.
    struct Session {
        std::string token, csrf;
        std::string cookieHeader() const { return "Cookie: __Host-mat_sid=" + token; }
    };
    Session webSession(const std::string& user) {
        const HttpResult r = call(postReq("/api/v1/web/login",
                                          nlohmann::json{{"username", user}, {"password", pw[user]}}.dump(),
                                          {"Origin: " + origin}));
        EXPECT_EQ(r.status, 200) << r.body;
        Session s;
        const std::string key = "__Host-mat_sid=";
        const size_t at = r.headers.find(key);
        if (at != std::string::npos) {
            const size_t end = r.headers.find(';', at);
            s.token = r.headers.substr(at + key.size(), end - at - key.size());
        }
        s.csrf = bodyJson(r).value("csrfToken", "");
        return s;
    }
    HttpResult postWeb(const Session& s, const std::string& path, const std::string& body,
                       std::vector<std::string> extra = {}) {
        HttpRequest q = postReq(path, body, {s.cookieHeader(), "Origin: " + origin, "X-MAT-CSRF: " + s.csrf});
        for (auto& e : extra) q.headers.push_back(e);
        return call(q);
    }
    HttpResult getWeb(const Session& s, const std::string& path) {
        return call(getReq(path, {s.cookieHeader(), "Sec-Fetch-Site: same-origin"}));
    }

    ~AlarmRig() { web.stop(); }  // before the glue and the page handlers go
    std::vector<AuditRecord> alarmAudit() { return records("alarm."); }

    std::shared_ptr<AlarmWorld> world;
    std::string docroot, origin;
    std::unique_ptr<ViewerGate> gate;
    std::unique_ptr<HttpApi> api;
};

}  // namespace mat::test
