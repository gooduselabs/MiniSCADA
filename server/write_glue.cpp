#include "server/write_glue.hpp"

#include <algorithm>

#include "core/common/json_text.hpp"
#include "nlohmann/json.hpp"
#include "server/runtime_engine.hpp"

namespace mat {

namespace {

using nlohmann::json;

AuditChannel channelOf(const std::string& name) {
    if (name == "http") return AuditChannel::Http;
    if (name == "https") return AuditChannel::Https;
    if (name == "web") return AuditChannel::Web;  // the cookie session of the page (feature 007)
    if (name == "system") return AuditChannel::System;  // the runtime itself (pulse-recovery)
    if (name == "logic") return AuditChannel::Logic;    // a rule of logic.json (feature 011)
    return AuditChannel::Http;  // the live channel is served by both listeners; the record says
                                // "live" in `detail`
}

json parseOr(const std::string& text, json fallback) {
    if (text.empty()) return fallback;
    const json j = json::parse(text, nullptr, false);
    return j.is_discarded() ? fallback : j;
}

// The facts shared by the record of receipt and the record of the end.
json detailOf(const WriteRecord& r) {
    json d = {{"requestId", r.requestId}, {"kind", r.kind}};
    if (!r.channel.empty()) d["channel"] = r.channel;
    if (!r.device.empty()) d["device"] = r.device;
    d["old"] = parseOr(r.oldJson, nullptr);
    d["new"] = parseOr(r.newJson, nullptr);
    if (!r.rawJson.empty()) d["raw"] = parseOr(r.rawJson, nullptr);
    // Feature 007 (device-api-1.2 §6): what the page said about the command.
    if (!r.contextJson.empty()) d["context"] = parseOr(r.contextJson, nullptr);
    if (r.pulseMs > 0) d["pulseMs"] = r.pulseMs;
    if (r.expect >= 0) d["expect"] = r.expect == 1;
    // Feature 011 (FR-019): the release of a pulse the runtime owed, and the pulse it ends.
    if (!r.origin.empty()) d["source"] = r.origin;
    if (!r.pulseOf.empty()) d["pulseOf"] = r.pulseOf;
    // Feature 011 (FR-080, data-model §1.5): the rule, its `writes` entry, the edge and at most 8
    // inputs of its condition.
    if (!r.logicJson.empty()) {
        const json l = parseOr(r.logicJson, json::object());
        if (l.is_object())
            for (auto it = l.begin(); it != l.end(); ++it) d[it.key()] = it.value();
    }
    return d;
}

AuditEvent eventOf(const WriteRecord& r, AuditResult result, const std::string& code,
                   const json& detail) {
    // a write of a rule is logic.write (device-api-011 §4), with the same two transactions
    AuditEvent e(r.who.channel == "logic" ? AuditAction::LogicWrite : AuditAction::TagWrite, result,
                 channelOf(r.who.channel), r.who.source);
    e.user = r.who.user;
    if (!r.who.role.empty()) e.role = r.who.role;  // a journal entry of the last run has none
    e.target = r.tag;
    e.code = code;
    e.detail = jsonText(detail);
    return e;
}

}  // namespace

void AuditLogWriteAudit::started(const WriteRecord& r) {
    log_.appendTagWriteStarted(eventOf(r, AuditResult::Started, "ACCEPTED", detailOf(r)),
                               r.requestId);
}

void AuditLogWriteAudit::finished(const WriteRecord& r, const WriteOutcome& o) {
    json d = detailOf(r);
    if (!o.readbackJson.empty()) d["readback"] = parseOr(o.readbackJson, nullptr);
    if (o.exception >= 0) d["exception"] = o.exception;
    if (!o.pulseJson.empty()) d["pulse"] = parseOr(o.pulseJson, nullptr);
    const AuditResult result =
        o.result == "ok"
            ? AuditResult::Ok
            : (o.result == "interrupted" ? AuditResult::Interrupted : AuditResult::Failed);
    log_.appendTagWriteResult(eventOf(r, result, o.code, d), r.requestId);
}

void AuditLogWriteAudit::denied(const WriteCaller& who, const std::string& requestId,
                                const std::string& tag, const std::string& valueJson,
                                const std::string& code) {
    AuditEvent e(AuditAction::TagWrite, AuditResult::Denied, channelOf(who.channel),
                 who.source.empty() ? "system" : who.source);
    if (!who.user.empty()) e.user = who.user;
    if (!who.role.empty()) e.role = who.role;
    if (!tag.empty()) e.target = tag;
    e.code = code;
    json d = json::object();
    if (!requestId.empty()) d["requestId"] = requestId;
    if (!valueJson.empty()) d["value"] = parseOr(valueJson, nullptr);
    if (who.channel == "live") d["channel"] = "live";
    if (!d.empty()) e.detail = jsonText(d);
    log_.append(e);
}

std::optional<StoredWrite> AuditLogWriteAudit::find(const std::string& requestId) {
    std::optional<TagWriteInfo> info;
    try {
        info = log_.findTagWrite(requestId);
    } catch (const std::exception&) {
        return std::nullopt;
    }
    if (!info) return std::nullopt;
    StoredWrite s;
    s.requestId = requestId;
    s.user = info->started.user.value_or("");
    s.tag = info->started.target.value_or("");
    const json d = parseOr(info->started.detail.value_or(""), json::object());
    if (d.is_object() && d.contains("new")) s.newJson = jsonText(d["new"]);
    s.receivedWallMs = info->started.tsMs;
    s.clockOk = info->started.clockOk;
    if (info->result) {
        s.finished = true;
        s.outcome.result = info->result->result;
        s.outcome.code = info->result->code.value_or("");
        s.finishedWallMs = info->result->tsMs;
        s.clockOk = info->result->clockOk;
        const json rd = parseOr(info->result->detail.value_or(""), json::object());
        if (rd.is_object() && rd.contains("exception") && rd["exception"].is_number_integer())
            s.outcome.exception = rd["exception"].get<int>();
        if (rd.is_object() && rd.contains("readback"))
            s.outcome.readbackJson = jsonText(rd["readback"]);
    }
    return s;
}

// ---- backend ----

drv::LinkState RuntimeWriteBackend::link(size_t tag) {
    if (drv::ModbusTcpDriver* d = rt_.driverOf(tag)) return d->linkState(rt_.deviceOf(tag));
    // an external Tag whose channel has no driver here (RTU, until its stage): never writable
    return {drv::ChannelState::Error, drv::DeviceState::Error};
}

bool RuntimeWriteBackend::submit(size_t tag, drv::WriteCommand cmd) {
    const ProjectModel* m = rt_.model();
    if (!m || tag >= m->tags.size()) return false;
    switch (m->tags[tag].kind) {
        case TagKind::External: {
            drv::ModbusTcpDriver* d = rt_.driverOf(tag);
            return d && d->enqueueWrite(std::move(cmd));
        }
        case TagKind::Internal:
            if (!rt_.engine()) return false;
            rt_.engine()->setInternal(tag, cmd.raw,
                                      cmd.id);  // the engine answers APPLIED in its next round
            return true;
        case TagKind::Simulation:
            return rt_.simulationDriver() && rt_.simulationDriver()->enqueueWrite(std::move(cmd));
        case TagKind::Calculated:
            break;
    }
    return false;
}

std::vector<uint64_t> RuntimeWriteBackend::cancelUnsent() {
    std::vector<uint64_t> ids;
    for (drv::ModbusTcpDriver* d : rt_.channelDrivers()) {
        auto got = d->cancelQueuedWrites();
        ids.insert(ids.end(), got.begin(), got.end());
    }
    if (rt_.simulationDriver()) {
        auto got = rt_.simulationDriver()->cancelQueuedWrites();
        ids.insert(ids.end(), got.begin(), got.end());
    }
    return ids;
}

int64_t RuntimeWriteBackend::maxTimeoutMs() {
    int64_t t = 1000;
    for (drv::ModbusTcpDriver* d : rt_.channelDrivers())
        for (const auto& dev : d->config().devices) t = std::max<int64_t>(t, dev.timeoutMs);
    return t;
}

std::function<void(const std::string&, const std::string&, uint64_t)> liveRejectedWriteHook(
    WriteCoordinator& coordinator) {
    return [&coordinator](const std::string& tag, const std::string& valueJson, uint64_t sid) {
        WriteCaller who;
        (void)sid;  // the hub knows a session by number only; one source keeps repeated refusals in
                    // one row
        who.source = "live";
        who.channel = "live";
        coordinator.recordDeniedJson(who, "", tag, valueJson, "LIVE_WRITE_NOT_ALLOWED");
    };
}

}  // namespace mat
