#include "core/recipe/recipe_service.hpp"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <ctime>
#include <iostream>
#include <random>
#include <set>

namespace mat::recipe {

using nlohmann::json;

struct Service::Job {
    std::string id;
    std::string type, recipe, recipeName;
    Caller who;
    std::string state = "running";  // running, done, failed
    json results = json::array();   // {tag, value, status, code?, message?}
    std::string startedAt, finishedAt;
};

namespace {

Reply error(int status, const std::string& code, const std::string& message,
            json more = json::object()) {
    Reply r;
    r.status = status;
    r.body = std::move(more);
    r.body["error"] = code;
    r.body["message"] = message;
    return r;
}

bool allowed(const Caller& who, const std::string& need) {
    return roleRank(who.role) >= 0 && roleRank(who.role) >= roleRank(need);
}

std::string str(const json& o, const char* key) {
    const auto it = o.find(key);
    return it != o.end() && it->is_string() ? it->get<std::string>() : std::string();
}

bool validName(const std::string& n) {
    if (n.empty() || n.size() > 240) return false;  // 80 characters of up to 3 bytes
    size_t chars = 0;
    for (const unsigned char c : n) {
        if (c < 0x20 || c == 0x7f) return false;
        if ((c & 0xc0) != 0x80) ++chars;
    }
    return chars <= 80;
}

// The values of a recipe in an audit record: compact JSON text, cut to 600 bytes (a detail holds
// 1 KiB).
std::string valuesText(const json& v) {
    std::string t = v.dump();
    if (t.size() > 600) t = t.substr(0, 597) + "...";
    return t;
}

const std::set<std::string> kTerminal = {"CONFIRMED", "FAILED", "TIMEOUT", "UNKNOWN", "REJECTED"};

}  // namespace

Service::Service(ServiceOptions options) : o_(std::move(options)), store_(o_.storePath) {}

Service::~Service() {
    if (worker_.joinable()) worker_.join();
}

bool Service::start() {
    std::lock_guard<std::mutex> lock(mu_);
    std::string err;
    storeOk_ = store_.load(err);
    if (!err.empty()) logLine("recipe: " + err);
    return storeOk_;
}

std::string Service::now() const {
    if (o_.nowIso) return o_.nowIso();
    const std::time_t t = std::time(nullptr);
    std::tm tm{};
    gmtime_r(&t, &tm);
    char buf[32];
    std::strftime(buf, sizeof buf, "%Y-%m-%dT%H:%M:%SZ", &tm);
    return buf;
}

int64_t Service::mono() const {
    if (o_.monoMs) return o_.monoMs();
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

void Service::logLine(const std::string& s) const {
    if (o_.log)
        o_.log(s);
    else
        std::cerr << s << "\n";
}

void Service::waitIdle() {
    std::unique_lock<std::mutex> lock(mu_);
    idleCv_.wait(lock, [&] { return !busy_; });
}

Reply Service::call(const std::string& method, const std::string& path,
                    const std::map<std::string, std::string>& query, const std::string& body,
                    const Caller& who) {
    const std::string base = "/api/v1/recipes";
    if (method == "GET") {
        if (path == base) return list(who);
        if (path == base + "/current") {
            const auto t = query.find("type");
            return current(t == query.end() ? "" : t->second, who);
        }
        const std::string jobs = base + "/jobs/";
        if (path.rfind(jobs, 0) == 0) return job(path.substr(jobs.size()), who);
        return error(404, "NOT_FOUND", "Không có tài nguyên này.");
    }
    const json b = json::parse(body, nullptr, false);
    if (b.is_discarded() || !b.is_object())
        return error(400, "BAD_REQUEST", "Thân yêu cầu phải là một đối tượng JSON.");
    if (path == base + "/save") return save(b, who);
    if (path == base + "/delete") return remove(b, who);
    if (path == base + "/capture") return capture(b, who);
    if (path == base + "/download") return download(b, who);
    return error(404, "NOT_FOUND", "Không có tài nguyên này.");
}

std::optional<json> Service::valuesOf(const TypeDef& t, const std::string& id) const {
    for (const auto& r : t.projectRecipes)
        if (str(r, "id") == id) return r["values"];
    if (const StoredRecipe* r = store_.find(t.id, id)) return r->values;
    return std::nullopt;
}

size_t Service::countOf(const TypeDef& t) const {
    return t.projectRecipes.size() + store_.list(t.id).size();
}

Reply Service::list(const Caller& who) {
    std::lock_guard<std::mutex> lock(mu_);
    json types = json::array();
    for (const auto& t : o_.catalog.types) {
        if (!allowed(who, t.view)) continue;
        json recipes = json::array();
        for (const auto& r : t.projectRecipes)
            recipes.push_back({{"id", str(r, "id")},
                               {"name", str(r, "name")},
                               {"values", r["values"]},
                               {"origin", "project"}});
        for (const auto& r : store_.list(t.id))
            recipes.push_back({{"id", r.id},
                               {"name", r.name},
                               {"values", r.values},
                               {"origin", "device"},
                               {"updatedAt", r.updatedAt},
                               {"updatedBy", r.updatedBy}});
        json ty = {{"id", t.id},
                   {"name", t.name},
                   {"params", t.paramsJson()},
                   {"can", {{"operate", allowed(who, t.operate)}, {"edit", allowed(who, t.edit)}}},
                   {"recipes", std::move(recipes)}};
        if (!t.description.empty()) ty["description"] = t.description;
        types.push_back(std::move(ty));
    }
    Reply r;
    r.body = {{"rev", store_.rev()}, {"types", std::move(types)}};
    return r;
}

Reply Service::current(const std::string& type, const Caller& who) {
    const TypeDef* t = o_.catalog.find(type);
    if (!t || !allowed(who, t->view))
        return error(404, "RECIPE_NOT_FOUND", "Không có loại recipe này.");
    json values = json::object();
    for (const auto& p : t->params) {
        const auto c = o_.current ? o_.current(p.tag) : std::nullopt;
        values[p.tag] = c ? json{{"value", c->value}, {"quality", c->quality}}
                          : json{{"value", nullptr}, {"quality", "BAD"}};
    }
    Reply r;
    r.body = {{"type", t->id}, {"values", std::move(values)}};
    return r;
}

Reply Service::job(const std::string& id, const Caller& who) {
    std::lock_guard<std::mutex> lock(mu_);
    for (const auto& j : jobs_)
        if (j->id == id) {
            const TypeDef* t = o_.catalog.find(j->type);
            if (!t || !allowed(who, t->view)) break;
            Reply r;
            r.body = jobJson(*j);
            return r;
        }
    return error(404, "RECIPE_NOT_FOUND", "Không có lượt tải này.");
}

json Service::jobJson(const Job& j) const {
    json out = {{"jobId", j.id},     {"type", j.type},       {"recipe", j.recipe},
                {"state", j.state},  {"results", j.results}, {"startedAt", j.startedAt},
                {"user", j.who.user}};
    if (!j.finishedAt.empty()) out["finishedAt"] = j.finishedAt;
    return out;
}

Reply Service::store(const TypeDef& t, const std::string& id, const std::string& name,
                     const json& values, int64_t rev, const Caller& who, const char* action,
                     json detail) {
    // the caller holds mu_
    if (!storeOk_) return error(500, "RECIPE_STORE_FAILED", "Không ghi được kho recipe.");
    if (rev != store_.rev())
        return error(409, "CONFLICT", "Recipe vừa được người khác thay đổi; tải lại.",
                     {{"rev", store_.rev()}});
    const auto issues = checkValues(t, values);
    if (!issues.empty())
        return error(400, "RECIPE_INVALID", "Giá trị không hợp lệ.",
                     {{"issues", issuesJson(issues)}});
    StoredRecipe r;
    r.id = id;
    r.name = name;
    r.values = values;
    r.updatedAt = now();
    r.updatedBy = who.user;
    AuditRecord a;
    a.action = action;
    a.result = "ok";
    a.who = who;
    a.target = t.id + "/" + id;
    a.detail = std::move(detail);
    a.detail["name"] = name;
    try {
        if (o_.audit) o_.audit(a);
    } catch (const std::exception&) {
        return error(503, "AUDIT_UNAVAILABLE", "Không ghi được nhật ký kiểm toán.");
    }
    std::string err;
    switch (store_.put(t.id, r, rev, err)) {
        case RecipeStore::Status::Ok:
            break;
        case RecipeStore::Status::Conflict:
            return error(409, "CONFLICT", "Recipe vừa được người khác thay đổi; tải lại.",
                         {{"rev", store_.rev()}});
        default:
            logLine("recipe: " + err);
            return error(500, "RECIPE_STORE_FAILED", "Không ghi được kho recipe.");
    }
    Reply out;
    out.body = {{"rev", store_.rev()},
                {"recipe",
                 {{"id", r.id},
                  {"name", r.name},
                  {"values", r.values},
                  {"origin", "device"},
                  {"updatedAt", r.updatedAt},
                  {"updatedBy", r.updatedBy}}}};
    return out;
}

Reply Service::save(const json& b, const Caller& who) {
    const TypeDef* t = o_.catalog.find(str(b, "type"));
    if (!t || !allowed(who, t->view))
        return error(404, "RECIPE_NOT_FOUND", "Không có loại recipe này.");
    if (!allowed(who, t->edit))
        return error(403, "FORBIDDEN", "Cần vai trò " + t->edit + " để sửa recipe.");
    const std::string name = str(b, "name");
    if (!validName(name) || !b.contains("rev") || !b["rev"].is_number_integer() ||
        !b.contains("values"))
        return error(400, "BAD_REQUEST", "Cần {type, name (1-80 ký tự), values, rev}.");
    std::lock_guard<std::mutex> lock(mu_);
    std::string id = str(b, "id");
    bool created = false;
    if (id.empty()) {
        if (countOf(*t) >= kMaxRecipesPerType)
            return error(409, "RECIPE_FULL", "Loại này đã có 200 bản recipe.");
        do {
            id = o_.newRecipeId ? o_.newRecipeId() : std::string();
            if (id.empty()) {
                static thread_local std::mt19937 rng{std::random_device{}()};
                char buf[16];
                std::snprintf(buf, sizeof buf, "d-%08x", static_cast<unsigned>(rng()));
                id = buf;
            }
        } while (valuesOf(*t, id));
        created = true;
    } else {
        for (const auto& r : t->projectRecipes)
            if (str(r, "id") == id)
                return error(409, "RECIPE_READONLY",
                             "Bản recipe của project chỉ đọc trên thiết bị; hãy sao chép.");
        if (!store_.find(t->id, id)) return error(404, "RECIPE_NOT_FOUND", "Không có bản này.");
    }
    return store(*t, id, name, b["values"], b["rev"].get<int64_t>(), who, "recipe.save",
                 {{"created", created}});
}

Reply Service::remove(const json& b, const Caller& who) {
    const TypeDef* t = o_.catalog.find(str(b, "type"));
    if (!t || !allowed(who, t->view))
        return error(404, "RECIPE_NOT_FOUND", "Không có loại recipe này.");
    if (!allowed(who, t->edit))
        return error(403, "FORBIDDEN", "Cần vai trò " + t->edit + " để xóa recipe.");
    const std::string id = str(b, "id");
    if (id.empty() || !b.contains("rev") || !b["rev"].is_number_integer())
        return error(400, "BAD_REQUEST", "Cần {type, id, rev}.");
    std::lock_guard<std::mutex> lock(mu_);
    if (!storeOk_) return error(500, "RECIPE_STORE_FAILED", "Không ghi được kho recipe.");
    for (const auto& r : t->projectRecipes)
        if (str(r, "id") == id)
            return error(409, "RECIPE_READONLY", "Bản recipe của project không xóa được.");
    const StoredRecipe* r = store_.find(t->id, id);
    if (!r) return error(404, "RECIPE_NOT_FOUND", "Không có bản này.");
    const int64_t rev = b["rev"].get<int64_t>();
    if (rev != store_.rev())
        return error(409, "CONFLICT", "Recipe vừa được người khác thay đổi; tải lại.",
                     {{"rev", store_.rev()}});
    AuditRecord a;
    a.action = "recipe.delete";
    a.result = "ok";
    a.who = who;
    a.target = t->id + "/" + id;
    a.detail = {{"name", r->name}, {"values", valuesText(r->values)}};
    try {
        if (o_.audit) o_.audit(a);
    } catch (const std::exception&) {
        return error(503, "AUDIT_UNAVAILABLE", "Không ghi được nhật ký kiểm toán.");
    }
    std::string err;
    if (store_.remove(t->id, id, rev, err) != RecipeStore::Status::Ok) {
        logLine("recipe: " + err);
        return error(500, "RECIPE_STORE_FAILED", "Không ghi được kho recipe.");
    }
    Reply out;
    out.body = {{"rev", store_.rev()}};
    return out;
}

Reply Service::capture(const json& b, const Caller& who) {
    const TypeDef* t = o_.catalog.find(str(b, "type"));
    if (!t || !allowed(who, t->view))
        return error(404, "RECIPE_NOT_FOUND", "Không có loại recipe này.");
    if (!allowed(who, t->edit))
        return error(403, "FORBIDDEN", "Cần vai trò " + t->edit + " để lưu recipe.");
    const std::string name = str(b, "name");
    if (!validName(name) || !b.contains("rev") || !b["rev"].is_number_integer())
        return error(400, "BAD_REQUEST", "Cần {type, name (1-80 ký tự), rev}.");
    json values = json::object();
    json bad = json::array();
    for (const auto& p : t->params) {
        const auto c = o_.current ? o_.current(p.tag) : std::nullopt;
        if (!c || c->quality != "GOOD" || c->value.is_null())
            bad.push_back(p.tag);
        else
            values[p.tag] = c->value;
    }
    if (!bad.empty())
        return error(409, "RECIPE_BAD_QUALITY", "Có Tag không đọc được giá trị tốt (GOOD) từ PLC.",
                     {{"tags", bad}});
    std::lock_guard<std::mutex> lock(mu_);
    if (countOf(*t) >= kMaxRecipesPerType)
        return error(409, "RECIPE_FULL", "Loại này đã có 200 bản recipe.");
    std::string id;
    do {
        id = o_.newRecipeId ? o_.newRecipeId() : std::string();
        if (id.empty()) {
            static thread_local std::mt19937 rng{std::random_device{}()};
            char buf[16];
            std::snprintf(buf, sizeof buf, "d-%08x", static_cast<unsigned>(rng()));
            id = buf;
        }
    } while (valuesOf(*t, id));
    return store(*t, id, name, values, b["rev"].get<int64_t>(), who, "recipe.capture",
                 {{"values", valuesText(values)}});
}

Reply Service::download(const json& b, const Caller& who) {
    const TypeDef* t = o_.catalog.find(str(b, "type"));
    if (!t || !allowed(who, t->view))
        return error(404, "RECIPE_NOT_FOUND", "Không có loại recipe này.");
    if (!allowed(who, t->operate))
        return error(403, "FORBIDDEN", "Cần vai trò " + t->operate + " để tải recipe xuống PLC.");
    const std::string rid = str(b, "recipe");
    std::unique_lock<std::mutex> lock(mu_);
    const auto values = valuesOf(*t, rid);
    if (!values) return error(404, "RECIPE_NOT_FOUND", "Không có bản này.");
    const auto issues = checkValues(*t, *values);
    if (!issues.empty())
        return error(400, "RECIPE_INVALID", "Giá trị không hợp lệ; không ghi Tag nào.",
                     {{"issues", issuesJson(issues)}});
    if (!o_.writer) return error(503, "WRITES_UNAVAILABLE", "Runtime không ghi được Tag lúc này.");
    if (busy_)
        return error(409, "RECIPE_BUSY",
                     "Một recipe khác đang được tải xuống; chờ xong rồi thử lại.");
    auto job = std::make_shared<Job>();
    job->id = "j" + std::to_string(nextJob_++);
    job->type = t->id;
    job->recipe = rid;
    job->who = who;
    job->startedAt = now();
    for (const auto& p : t->params)
        job->results.push_back(
            {{"tag", p.tag}, {"value", (*values)[p.tag]}, {"status", "pending"}});
    AuditRecord a;
    a.action = "recipe.download";
    a.result = "started";
    a.who = who;
    a.target = t->id + "/" + rid;
    a.detail = {{"job", job->id}, {"values", valuesText(*values)}};
    try {
        if (o_.audit) o_.audit(a);
    } catch (const std::exception&) {
        return error(503, "AUDIT_UNAVAILABLE",
                     "Không ghi được nhật ký kiểm toán; không ghi Tag nào.");
    }
    busy_ = true;
    jobs_.push_back(job);
    while (jobs_.size() > o_.keepJobs) jobs_.pop_front();
    if (worker_.joinable()) worker_.join();  // the previous run has ended (busy_ was false)
    worker_ = std::thread([this, job] { run(job); });
    Reply r;
    r.status = 202;
    r.body = jobJson(*job);
    return r;
}

void Service::run(std::shared_ptr<Job> job) {
    size_t written = 0;
    std::string failedTag, failedCode, failedMessage;
    const size_t n = job->results.size();
    for (size_t i = 0; i < n; ++i) {
        std::string tag;
        json value;
        {
            std::lock_guard<std::mutex> lock(mu_);
            tag = job->results[i]["tag"].get<std::string>();
            value = job->results[i]["value"];
        }
        std::string requestId = o_.writer->newRequestId();
        WriteStep s =
            o_.writer->submit(job->who, requestId, tag, value, "recipe-" + job->type, job->recipe);
        // the rate limit of the coordinator: wait and send again (a new id: a refused one is kept)
        const int64_t rateDeadline = mono() + o_.rateWaitMaxMs;
        while (s.status == "REJECTED" && s.code == "RATE_LIMITED" && mono() < rateDeadline) {
            const int64_t wait = std::max<int64_t>(s.retryAfterMs, o_.pollMs);
            if (o_.sleepMs)
                o_.sleepMs(wait);
            else
                std::this_thread::sleep_for(std::chrono::milliseconds(wait));
            requestId = o_.writer->newRequestId();
            s = o_.writer->submit(job->who, requestId, tag, value, "recipe-" + job->type,
                                  job->recipe);
        }
        const int64_t deadline = mono() + o_.writeTimeoutMs;
        while (!kTerminal.count(s.status)) {
            if (mono() >= deadline) {
                s = {"TIMEOUT", "RECIPE_WRITE_TIMEOUT", "Không có kết quả ghi trong thời hạn."};
                break;
            }
            if (o_.sleepMs)
                o_.sleepMs(o_.pollMs);
            else
                std::this_thread::sleep_for(std::chrono::milliseconds(o_.pollMs));
            s = o_.writer->status(job->who, requestId);
        }
        std::lock_guard<std::mutex> lock(mu_);
        json& r = job->results[i];
        r["requestId"] = requestId;
        if (s.status == "CONFIRMED") {
            r["status"] = "ok";
            if (!s.code.empty()) r["code"] = s.code;
            ++written;
            continue;
        }
        r["status"] = "failed";
        r["code"] = s.code.empty() ? s.status : s.code;
        if (!s.message.empty()) r["message"] = s.message;
        failedTag = tag;
        failedCode = r["code"].get<std::string>();
        failedMessage = s.message;
        for (size_t k = i + 1; k < n; ++k) job->results[k]["status"] = "skipped";
        break;
    }
    AuditRecord a;
    a.action = "recipe.download";
    a.result = failedTag.empty() ? "ok" : "failed";
    a.who = job->who;
    a.target = job->type + "/" + job->recipe;
    a.code = failedCode;
    a.detail = {{"job", job->id}, {"written", written}, {"total", n}};
    if (!failedTag.empty()) a.detail["failedTag"] = failedTag;
    try {
        if (o_.audit) o_.audit(a);
    } catch (const std::exception& e) {
        logLine(std::string("recipe: audit recipe.download không ghi được: ") + e.what());
    }
    std::lock_guard<std::mutex> lock(mu_);
    job->state = failedTag.empty() ? "done" : "failed";
    job->finishedAt = now();
    busy_ = false;
    idleCv_.notify_all();
}

}  // namespace mat::recipe
