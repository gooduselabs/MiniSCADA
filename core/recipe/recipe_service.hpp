// The recipe API of the device (feature 024, specs/024-recipes/plan.md "Hợp đồng"), without HTTP:
// server/http/recipes_api.cpp reads the request and calls `call`; tests call it directly. The gate
// has already checked HTTPS, the session, the role of the endpoint table (core/auth/roles.cpp),
// Origin and the CSRF token of a cookie. Here: the role each recipe type asks for (security.view,
// operate, edit), the `rev` of the device store, the values (checkValues), the audit (written
// before the store or the first write: 503 AUDIT_UNAVAILABLE), one download at a time.
//
// A download runs on a thread of its own: each parameter in the order of the type is handed to the
// writer (the tag write coordinator in the runtime: audit tag.write, writeMinRole, limits), and its
// status is asked until it ends (at most writeTimeoutMs); anything but CONFIRMED stops the run, the
// rest is "skipped". The run is audited as recipe.download started (before the first write) and ok
// / failed (what was written, where it stopped).
#pragma once
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "core/recipe/recipe_model.hpp"
#include "core/recipe/recipe_store.hpp"
#include "nlohmann/json.hpp"

namespace mat::recipe {

struct Caller {
    std::string user;
    std::string role;    // viewer, operator, engineer, administrator
    std::string source;  // "IP:port"
    bool viaCookie = false;
};

// One tag write as the coordinator sees it (WriteView): status ACCEPTED, REJECTED, CONFIRMED,
// FAILED, TIMEOUT or UNKNOWN, and the code of a refusal or a result.
struct WriteStep {
    std::string status;
    std::string code;
    std::string message;
    int64_t retryAfterMs = 0;  // REJECTED RATE_LIMITED: when to try again
};

class Writer {
   public:
    virtual ~Writer() = default;
    virtual std::string newRequestId() = 0;
    // `screen`, `widget`: the context of the audit record ("recipe-<type>", the recipe id).
    virtual WriteStep submit(const Caller& who, const std::string& requestId,
                             const std::string& tag, const nlohmann::json& value,
                             const std::string& screen, const std::string& widget) = 0;
    virtual WriteStep status(const Caller& who, const std::string& requestId) = 0;
};

struct Current {
    nlohmann::json value;
    std::string quality;  // GOOD, BAD, UNCERTAIN
};

struct AuditRecord {
    std::string action;  // recipe.download, recipe.save, recipe.delete, recipe.capture
    std::string result;  // started, ok, failed
    Caller who;
    std::string target;  // "<type>/<recipe id>"
    std::string code;
    nlohmann::json detail = nlohmann::json::object();
};

struct ServiceOptions {
    Catalog catalog;
    std::string storePath;     // <dataDir>/recipes/<projectId>.json
    Writer* writer = nullptr;  // null: no download (503 WRITES_UNAVAILABLE)
    std::function<std::optional<Current>(const std::string& tag)> current;
    std::function<void(const AuditRecord&)> audit;  // throws when the record cannot be written
    std::function<int64_t()> monoMs;                // empty: steady clock
    std::function<void(int64_t ms)> sleepMs;        // empty: this_thread::sleep_for
    std::function<std::string()> nowIso;            // empty: the system clock, UTC
    std::function<std::string()> newRecipeId;       // empty: "d-" + 8 random hex digits
    std::function<void(const std::string&)> log;    // empty: stderr
    int64_t writeTimeoutMs = 15000;
    // A write refused with RATE_LIMITED (the limits of the coordinator, 20 a minute) is sent again
    // with a new request id after retryAfterMs, for at most this long per parameter.
    int64_t rateWaitMaxMs = 120000;
    int64_t pollMs = 50;
    size_t keepJobs = 16;
};

struct Reply {
    int status = 200;
    nlohmann::json body = nlohmann::json::object();
};

class Service {
   public:
    explicit Service(ServiceOptions options);
    ~Service();  // waits for a download that runs
    Service(const Service&) = delete;
    Service& operator=(const Service&) = delete;

    // Reads the device store (a damaged one is set aside and logged). false: its folder cannot be
    // made; the routes that change it then answer 500.
    bool start();

    // GET /api/v1/recipes, GET /api/v1/recipes/current?type=, GET /api/v1/recipes/jobs/{id},
    // POST /api/v1/recipes/{save,delete,capture,download}. `body`: JSON text ("" for a GET).
    Reply call(const std::string& method, const std::string& path,
               const std::map<std::string, std::string>& query, const std::string& body,
               const Caller& who);

    // Tests: waits until no download runs.
    void waitIdle();

   private:
    struct Job;
    Reply list(const Caller& who);
    Reply current(const std::string& type, const Caller& who);
    Reply job(const std::string& id, const Caller& who);
    Reply save(const nlohmann::json& b, const Caller& who);
    Reply remove(const nlohmann::json& b, const Caller& who);
    Reply capture(const nlohmann::json& b, const Caller& who);
    Reply download(const nlohmann::json& b, const Caller& who);
    Reply store(const TypeDef& t, const std::string& id, const std::string& name,
                const nlohmann::json& values, int64_t rev, const Caller& who, const char* action,
                nlohmann::json detail);
    void run(std::shared_ptr<Job> job);
    nlohmann::json jobJson(const Job& j) const;
    // the values of a recipe of `t` (project or device), nullopt when there is none
    std::optional<nlohmann::json> valuesOf(const TypeDef& t, const std::string& id) const;
    size_t countOf(const TypeDef& t) const;
    std::string now() const;
    int64_t mono() const;
    void logLine(const std::string& s) const;

    ServiceOptions o_;
    RecipeStore store_;
    bool storeOk_ = false;
    mutable std::mutex mu_;
    std::condition_variable idleCv_;
    bool busy_ = false;
    std::deque<std::shared_ptr<Job>> jobs_;
    std::thread worker_;
    uint64_t nextJob_ = 1;
};

}  // namespace mat::recipe
