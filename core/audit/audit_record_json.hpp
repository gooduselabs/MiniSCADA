// An AuditRecord as JSON, the one shape of GET /api/v1/audit (device-api §7) and of
// `--export-audit --format jsonl`: id, ts (UTC ms), clockOk, user, role, source, channel, action,
// target, result, code, detail (the stored JSON object, or null), count. Header-only so that the
// users of the log need not link anything more.
#pragma once
#include <optional>
#include <string>
#include <utility>

#include "core/audit/audit_log.hpp"
#include "nlohmann/json.hpp"

namespace mat {

inline nlohmann::json auditRecordJson(const AuditRecord& r) {
    using nlohmann::json;
    json detail = nullptr;
    if (r.detail) {
        json parsed = json::parse(*r.detail, nullptr, false);
        if (parsed.is_object()) detail = std::move(parsed);
    }
    const auto text = [](const std::optional<std::string>& s) {
        return s ? json(*s) : json(nullptr);
    };
    return {{"id", r.id},           {"ts", r.tsMs},         {"clockOk", r.clockOk},
            {"user", text(r.user)}, {"role", text(r.role)}, {"source", r.source},
            {"channel", r.channel}, {"action", r.action},   {"target", text(r.target)},
            {"result", r.result},   {"code", text(r.code)}, {"detail", detail},
            {"count", r.count}};
}

}  // namespace mat
