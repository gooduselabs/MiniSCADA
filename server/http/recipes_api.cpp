// The routes of recipes (feature 024; specs/024-recipes/plan.md "Hợp đồng"): the gate has already
// checked HTTPS, the session, the role of the table (core/auth/roles.cpp), and for a cookie the
// Origin and the CSRF token of a POST. The recipe service (core/recipe) does the rest.
#include <algorithm>
#include <cstring>

#include "civetweb.h"
#include "core/auth/roles.hpp"
#include "core/common/json_text.hpp"
#include "core/recipe/recipe_service.hpp"
#include "server/http/engineering_api.hpp"
#include "server/http/engineering_api_internal.hpp"

namespace mat {

using nlohmann::json;

void EngineeringApi::setRecipes(RecipesBackend backend) {
    recipes_ = std::move(backend);
    if (!recipes_.service) return;
    if (std::find(opt_.features.begin(), opt_.features.end(), "recipes") == opt_.features.end())
        opt_.features.push_back("recipes");
}

int EngineeringApi::recipesRoute(mg_connection* c, const GateRequest& r, const GateDecision& d,
                                 bool close) {
    recipe::Service* svc = recipes_.service ? recipes_.service() : nullptr;
    std::string body;
    if (r.method == "POST") {
        // JSON only (a form of another site could send text/plain)
        const char* type = mg_get_header(c, "Content-Type");
        std::string t = type ? type : "";
        t = t.substr(0, t.find(';'));
        while (!t.empty() && (t.back() == ' ' || t.back() == '\t')) t.pop_back();
        for (char& ch : t)
            if (ch >= 'A' && ch <= 'Z') ch = static_cast<char>(ch - 'A' + 'a');
        if (t != "application/json") {
            eapi::drain(c);
            return eapi::sendError(c, 415, "UNSUPPORTED_MEDIA_TYPE", close, "",
                                   {{"message", "Chỉ nhận application/json."}});
        }
        if (!eapi::readBody(c, body)) {
            mg_disable_connection_keep_alive(c);
            return eapi::sendError(c, 400, "BAD_REQUEST", true);
        }
    }
    if (!svc)
        return eapi::sendError(c, 404, "NO_RECIPES", close, "",
                               {{"message", "Project đang chạy không có recipe."}});
    std::map<std::string, std::string> query;
    if (const char* q = mg_get_request_info(c)->query_string) {
        char type[128];
        if (mg_get_var(q, std::strlen(q), "type", type, sizeof type) >= 0) query["type"] = type;
    }
    recipe::Caller who;
    who.user = d.access.user;
    if (d.access.role) who.role = roleName(*d.access.role);
    who.source = r.from.text();
    who.viaCookie = d.viaCookie;
    const recipe::Reply reply = svc->call(r.method, r.path, query, body, who);
    return eapi::send(c, reply.status, jsonText(reply.body), close);
}

}  // namespace mat
