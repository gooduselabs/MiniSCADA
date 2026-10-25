#include "server/recipe_glue.hpp"

#include <cmath>
#include <cstdio>

#include "core/audit/audit_actions.hpp"

namespace mat {

using nlohmann::json;

namespace {

WriteCaller callerOf(const recipe::Caller& who) {
    WriteCaller w;
    w.user = who.user;
    w.role = who.role;
    w.source = who.source;
    w.sessionKey = "recipe:" + who.user;
    w.administrator = who.role == "administrator";
    w.channel = who.viaCookie ? "web" : "https";
    return w;
}

recipe::WriteStep stepOf(const WriteView& v) {
    recipe::WriteStep s;
    s.status = v.status;
    s.code = v.code;
    s.message = v.message;
    s.retryAfterMs = v.retryAfterMs;
    return s;
}

WriteValue valueOf(const json& v) {
    if (v.is_boolean()) return WriteValue::boolean(v.get<bool>());
    if (v.is_number_unsigned()) {
        const uint64_t u = v.get<uint64_t>();
        return u <= static_cast<uint64_t>(INT64_MAX) ? WriteValue::integer(static_cast<int64_t>(u))
                                                     : WriteValue::unsignedInt(u);
    }
    if (v.is_number_integer()) return WriteValue::integer(v.get<int64_t>());
    if (v.is_number_float()) {
        // an integral float (180.0) goes as an integer, like the integer it stands for
        const double d = v.get<double>();
        if (std::trunc(d) == d && std::fabs(d) < 9007199254740992.0)
            return WriteValue::integer(static_cast<int64_t>(d));
        return WriteValue::number(d);
    }
    return WriteValue::text(v.is_string() ? v.get<std::string>() : std::string());
}

}  // namespace

recipe::WriteStep CoordinatorRecipeWriter::submit(const recipe::Caller& who,
                                                  const std::string& requestId,
                                                  const std::string& tag, const json& value,
                                                  const std::string& screen,
                                                  const std::string& widget) {
    WriteRequest r;
    r.requestId = requestId;
    r.tag = tag;
    r.value = valueOf(value);
    r.context.screen = screen;
    r.context.widget = widget;
    const std::vector<WriteView> views = c_.submit(callerOf(who), {r});
    if (views.empty()) return {"REJECTED", "INTERNAL", "", 0};
    return stepOf(views.front());
}

recipe::WriteStep CoordinatorRecipeWriter::status(const recipe::Caller& who,
                                                  const std::string& requestId) {
    return stepOf(c_.status(callerOf(who), requestId));
}

AuditEvent recipeAuditEvent(const recipe::AuditRecord& r) {
    AuditAction a = AuditAction::RecipeSave;
    if (r.action == "recipe.download") a = AuditAction::RecipeDownload;
    if (r.action == "recipe.delete") a = AuditAction::RecipeDelete;
    if (r.action == "recipe.capture") a = AuditAction::RecipeCapture;
    AuditResult res = AuditResult::Ok;
    if (r.result == "started") res = AuditResult::Started;
    if (r.result == "failed") res = AuditResult::Failed;
    AuditEvent e(a, res, r.who.viaCookie ? AuditChannel::Web : AuditChannel::Https,
                 r.who.source.empty() ? "system" : r.who.source);
    if (!r.who.user.empty()) e.user = r.who.user;
    if (!r.who.role.empty()) e.role = r.who.role;
    e.target = r.target;
    if (!r.code.empty()) e.code = r.code;
    e.detail = r.detail.dump();
    return e;
}

json recipeScalarJson(const TagScalar& v) {
    constexpr int64_t kMax = 9007199254740992LL;
    if (const bool* b = std::get_if<bool>(&v)) return *b;
    if (const int64_t* i = std::get_if<int64_t>(&v))
        return (*i > kMax || *i < -kMax) ? json(std::to_string(*i)) : json(*i);
    if (const uint64_t* u = std::get_if<uint64_t>(&v))
        return *u > static_cast<uint64_t>(kMax) ? json(std::to_string(*u)) : json(*u);
    if (const double* d = std::get_if<double>(&v))
        return std::isfinite(*d) ? json(*d) : json(nullptr);
    if (const std::string* s = std::get_if<std::string>(&v)) return *s;
    return nullptr;
}

std::unique_ptr<recipe::Service> makeRecipeService(const LoadedProject& project,
                                                   const std::string& dataDir, TagStore& store,
                                                   AuditLog& audit, recipe::Writer* writer) {
    if (!project.recipes.is_object()) return nullptr;
    recipe::ServiceOptions o;
    o.catalog = recipe::catalogFrom(project.recipes, project.tags);
    o.storePath = dataDir + "/recipes/" + project.project.value("projectId", "project") + ".json";
    o.writer = writer;
    o.current = [&store](const std::string& tag) -> std::optional<recipe::Current> {
        const auto i = store.indexOf(tag);
        if (!i) return std::nullopt;
        const TagValue v = store.get(*i);
        return recipe::Current{recipeScalarJson(v.value), qualityName(v.quality)};
    };
    o.audit = [&audit](const recipe::AuditRecord& r) { audit.append(recipeAuditEvent(r)); };
    o.log = [](const std::string& line) { std::fprintf(stderr, "%s\n", line.c_str()); };
    auto svc = std::make_unique<recipe::Service>(std::move(o));
    svc->start();
    return svc;
}

}  // namespace mat
