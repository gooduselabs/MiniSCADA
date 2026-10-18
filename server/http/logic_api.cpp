// The routes of logic (feature 011 T138; device-api-011 §4; FR-083): GET /api/v1/logic,
// POST /api/v1/logic/writes, POST /api/v1/logic/reset. The gate has already checked the session,
// the role and HTTPS (core/auth/roles.cpp: only the GET takes the cookie of the page).
#include <cmath>
#include <cstring>

#include "civetweb.h"
#include "core/auth/roles.hpp"
#include "core/common/json_text.hpp"
#include "server/http/engineering_api.hpp"
#include "server/http/engineering_api_internal.hpp"
#include "server/logic_glue.hpp"
#include "server/malloc_tuning.hpp"

namespace mat {

using nlohmann::json;

namespace {
// T062: the largest value a reset takes (2^53: exact as a double and as the counter's int64).
constexpr double kLogicResetMax = 9007199254740992.0;
}  // namespace

void EngineeringApi::setLogic(LogicBackend backend) {
    logic_ = std::move(backend);
    if (!logic_.logic) return;
    if (std::find(opt_.features.begin(), opt_.features.end(), "logic") == opt_.features.end())
        opt_.features.push_back("logic");
}

int EngineeringApi::logicRoute(mg_connection* c, const GateRequest& r, const GateDecision& d,
                               bool close) {
    using eapi::send;
    using eapi::sendError;
    const std::string path = d.rule->path;
    LogicSubsystem* logic = logic_.logic ? logic_.logic() : nullptr;
    if (path == "/api/v1/logic") {
        if (!logic) return send(c, 200, jsonText(json{{"enabled", false}}), close);
        const std::string text = jsonText(logic->status());
        // T147: the tree of the maximum (550 blocks) is ~1 MB of small blocks for 77 KB of text,
        // in the arena of this worker; its pages go back to the kernel now, not at the next
        // trim of the main loop (the Studio's online view asks every few seconds)
        trimMalloc();
        return send(c, 200, text, close);
    }
    // the two POST routes: a JSON object
    std::string body;
    if (!eapi::readBody(c, body)) {
        mg_disable_connection_keep_alive(c);
        return sendError(c, 400, "BAD_REQUEST", true);
    }
    const json j = json::parse(body, nullptr, false);
    if (j.is_discarded() || !j.is_object())
        return sendError(c, 400, "BAD_REQUEST", close, "",
                         {{"message", "Thân yêu cầu phải là một đối tượng JSON."}});
    if (!logic)
        return sendError(c, 404, "LOGIC_NOT_PRESENT", close, "",
                         {{"message", "Project đang chạy không có logic."}});
    WriteCaller who;
    who.user = d.access.user;
    if (d.access.role) who.role = roleName(*d.access.role);
    who.source = r.from.text();
    who.channel = d.viaCookie ? "web" : "https";
    std::string code;
    if (path == "/api/v1/logic/writes") {
        const auto e = j.find("enabled");
        if (e == j.end() || !e->is_boolean())
            return sendError(c, 400, "BAD_REQUEST", close, "",
                             {{"message", "Cần {\"enabled\": false}."}});
        if (e->get<bool>())
            return sendError(
                c, 403, "LOGIC_ENABLE_ROOT_ONLY", close, "",
                {{"message",
                  "Chỉ root bật lại ghi PLC từ logic: mat-runtime --logic-writes-reset trên "
                  "thiết bị (logic.writes của runtime.json phải là \"on\")."}});
        if (!logic->stopWrites(who, code))
            return sendError(c, 500, code, close, "",
                             {{"message", "Không lưu được trạng thái dừng ghi."}});
        return send(c, 200, jsonText(json{{"writes", logic->writesState()}}), close);
    }
    // reset
    const auto id = j.find("id");
    const auto value = j.find("value");
    if (id == j.end() || !id->is_string() ||
        (value != j.end() && (!value->is_number() || !std::isfinite(value->get<double>()) ||
                              value->get<double>() < 0 || value->get<double>() > kLogicResetMax)))
        return sendError(c, 400, "BAD_REQUEST", close, "",
                         {{"message", "Cần {\"id\": \"<id khối>\", \"value\": số 0 đến 2^53}."}});
    const double v = value == j.end() ? 0 : value->get<double>();
    try {
        if (!logic->reset(id->get<std::string>(), v, who, code)) {
            if (code == "NO_SUCH_BLOCK")
                return sendError(c, 404, code, close, "",
                                 {{"message", "Không có khối logic này."}});
            return sendError(c, 409, code, close, "",
                             {{"message", "Chỉ đặt lại được counter, totalizer, giờ chạy."}});
        }
    } catch (const std::exception&) {
        return sendError(c, 503, "AUDIT_UNAVAILABLE", close);
    }
    return send(c, 200, jsonText(json{{"id", *id}, {"value", v}}), close);
}

}  // namespace mat
