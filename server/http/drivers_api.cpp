#include "server/http/drivers_api.hpp"

#include <algorithm>
#include <cstdio>

#include "civetweb.h"
#include "core/audit/audit_log.hpp"
#include "core/common/json_limits.hpp"
#include "core/common/json_text.hpp"
#include "drivers/modbus/address.hpp"
#include "drivers/modbus/exceptions.hpp"
#include "server/http/engineering_api.hpp"
#include "server/http/engineering_api_internal.hpp"

namespace mat {

namespace {

using nlohmann::json;

void issue(std::vector<ProbeIssue>& out, const char* code, const std::string& path,
           const std::string& message) {
    out.push_back({code, path, message});
}

// An integer field in [lo, hi]; `def` when absent. false (and an issue) when it is there and wrong.
bool intField(const json& obj, const char* key, const std::string& path, int lo, int hi, int def,
              int& out, std::vector<ProbeIssue>& issues) {
    out = def;
    if (!obj.is_object() || !obj.contains(key)) return true;
    const json& v = obj[key];
    if (!v.is_number_integer() || v.get<int64_t>() < lo || v.get<int64_t>() > hi) {
        issue(issues, "E_FIELD_VALUE", path + "." + key,
              std::string("Phải là số nguyên từ ") + std::to_string(lo) + " đến " +
                  std::to_string(hi) + ".");
        return false;
    }
    out = static_cast<int>(v.get<int64_t>());
    return true;
}

std::string hex16(uint16_t v) {
    char b[8];
    std::snprintf(b, sizeof b, "%04X", v);
    return b;
}

const char* messageOf(const std::string& code) {
    if (code == "REFUSED") return "PLC từ chối kết nối (có thể đã đủ số kết nối)";
    if (code == "TIMEOUT") return "PLC không trả lời trong thời gian chờ";
    if (code == "UNREACHABLE") return "Không tới được địa chỉ này (mạng hoặc địa chỉ sai)";
    if (code == "DNS") return "Không phân giải được tên máy";
    if (code == "BAD_FRAME") return "PLC trả lời không đúng khung Modbus TCP";
    if (code == "EXCEPTION") return "PLC trả lời bằng mã lỗi (exception)";
    return "";
}

}  // namespace

bool parseProbeRequest(const json& body, ProbeSpec& spec, std::vector<ProbeIssue>& issues) {
    spec = ProbeSpec{};
    issues.clear();
    if (!body.is_object()) {
        issue(issues, "E_FIELD_MISSING", "", "Thân yêu cầu phải là một đối tượng JSON.");
        return false;
    }
    if (!body.contains("channel") || !body["channel"].is_object()) {
        issue(issues, "E_FIELD_MISSING", "channel", "Thiếu cấu hình kênh.");
        return false;
    }
    const json& ch = body["channel"];
    const std::string kind =
        ch.contains("kind") && ch["kind"].is_string() ? ch["kind"].get<std::string>() : "";
    if (kind != "modbus-tcp" && kind != "modbus-rtu") {
        issue(issues, "E_FIELD_VALUE", "channel.kind",
              "Loại kênh phải là modbus-tcp hoặc modbus-rtu.");
        return false;
    }
    const json dev =
        body.contains("device") && body["device"].is_object() ? body["device"] : json::object();
    if (kind == "modbus-rtu") {
        spec.rtu = true;
        return true;  // the caller answers 501 until the serial driver exists
    }

    drv::TcpProbeRequest& t = spec.tcp;
    const json tcp = ch.contains("tcp") && ch["tcp"].is_object() ? ch["tcp"] : json::object();
    if (!tcp.contains("host")) {
        issue(issues, "E_FIELD_MISSING", "channel.tcp.host", "Thiếu địa chỉ PLC (host).");
    } else if (!tcp["host"].is_string() || tcp["host"].get<std::string>().empty() ||
               tcp["host"].get<std::string>().size() > 253 ||
               tcp["host"].get<std::string>().find_first_of(" \t\r\n/\\") != std::string::npos) {
        issue(issues, "E_FIELD_VALUE", "channel.tcp.host",
              "Địa chỉ PLC phải là IPv4 hoặc tên máy, tối đa 253 ký tự.");
    } else {
        t.host = tcp["host"].get<std::string>();
    }
    intField(tcp, "port", "channel.tcp", 1, 65535, 502, t.port, issues);
    intField(tcp, "connectTimeoutMs", "channel.tcp", 500, 30000, 3000, t.connectTimeoutMs, issues);
    intField(dev, "unitId", "device", 0, 255, 1, t.unit, issues);
    intField(dev, "timeoutMs", "device", 100, 10000, 1000, t.timeoutMs, issues);
    int base = 0;
    if (dev.contains("addressBase")) {
        if (!dev["addressBase"].is_number_integer() ||
            (dev["addressBase"].get<int>() != 0 && dev["addressBase"].get<int>() != 1))
            issue(issues, "E_FIELD_VALUE", "device.addressBase", "Phải là 0 hoặc 1.");
        else
            base = dev["addressBase"].get<int>();
    }

    if (body.contains("read")) {
        const json& rd = body["read"];
        if (!rd.is_object() || !rd.contains("address") || !rd["address"].is_string()) {
            issue(issues, "E_FIELD_MISSING", "read.address", "Thiếu địa chỉ cần đọc.");
        } else {
            int count = 1;
            intField(rd, "count", "read", -1000000, 1000000, 1, count, issues);
            // Coils and discrete inputs hold BOOL, registers numbers: the address says which.
            modbus::AddressOptions o;
            o.addressBase = base;
            o.rawType = TagType::BOOL;
            modbus::AddressResult a = modbus::parseAddress(rd["address"].get<std::string>(), o);
            if (!a.ok && a.error == "E_ADDR_AREA") {
                o.rawType = TagType::UINT16;
                a = modbus::parseAddress(rd["address"].get<std::string>(), o);
            }
            if (!a.ok) {
                issue(issues, a.error.c_str(), "read.address",
                      "Địa chỉ không hợp lệ: " + a.error + ".");
            } else {
                const bool bits = a.area == modbus::Area::C || a.area == modbus::Area::DI;
                const int maxCount = bits ? 16 : 4;
                if (count < 1 || count > maxCount) {
                    issue(issues, "E_PROBE_COUNT", "read.count",
                          std::string("Số lượng phải từ 1 đến ") + std::to_string(maxCount) +
                              (bits ? " bit." : " thanh ghi."));
                } else if (a.offset + count > 65536) {
                    issue(issues, "E_ADDR_RANGE", "read.address", "Địa chỉ vượt quá 65.535.");
                } else {
                    t.read = true;
                    t.area = a.area;
                    t.offset = a.offset;
                    t.count = count;
                }
            }
        }
    }
    if (!issues.empty()) return false;
    // The hard cap of 35 s: the wait for the answer gives way, the wait for the connection stays.
    t.timeoutMs = std::max(
        100, std::min(t.timeoutMs, static_cast<int>(kProbeHardCapMs) - 2000 - t.connectTimeoutMs));
    spec.target = t.host + ":" + std::to_string(t.port);
    return true;
}

json probeAnswerJson(const drv::TestOutcome& o, bool hadRead) {
    json j = {{"ok", o.code == "OK"}, {"code", o.code}, {"connectMs", o.connectMs}};
    if (hadRead && o.fc != 0) j["responseMs"] = o.responseMs;
    const char* msg = messageOf(o.code);
    if (*msg) j["message"] = msg;
    if (o.code == "OK" && hadRead && o.fc != 0) {
        json rd = {{"fc", o.fc}, {"offset", o.offset}, {"count", o.count}};
        if (o.fc <= 2) {
            json bits = json::array();
            for (uint8_t b : o.bits) bits.push_back(b != 0);
            rd["bits"] = bits;
        } else {
            json regs = json::array();
            for (uint16_t r : o.registers) regs.push_back(hex16(r));
            rd["registers"] = regs;
        }
        j["read"] = rd;
    }
    if (o.code == "EXCEPTION") {
        j["exception"] = {{"code", modbus::exceptionHex(o.exception)},
                          {"meaning", modbus::exceptionMeaning(o.exception)}};
        if (o.responseMs > 0 || hadRead) j["responseMs"] = o.responseMs;
    }
    return j;
}

// ---------- POST /api/v1/drivers/test ----------

int EngineeringApi::driversTest(mg_connection* c, const GateRequest& r, const GateDecision& d,
                                bool close) {
    using eapi::send;
    using eapi::sendError;
    std::string body;
    if (!eapi::readBody(c, body)) {
        mg_disable_connection_keep_alive(c);
        return sendError(c, 400, "BAD_REQUEST", true);
    }
    if (jsonNestingDepth(body.data(), body.size()) > 8)
        return sendError(c, 400, "BAD_REQUEST", close);
    const json j = json::parse(body, nullptr, false);
    if (j.is_discarded()) return sendError(c, 400, "BAD_REQUEST", close);

    ProbeSpec spec;
    std::vector<ProbeIssue> issues;
    if (!parseProbeRequest(j, spec, issues)) {
        json list = json::array();
        for (const auto& i : issues)
            list.push_back({{"code", i.code}, {"path", i.path}, {"message", i.message}});
        return sendError(c, 400, "BAD_REQUEST", close, "", {{"issues", list}});
    }
    if (spec.rtu)
        return sendError(
            c, 501, "NOT_IMPLEMENTED", close, "",
            {{"message", "Thử kết nối Modbus RTU chưa có trong phiên bản runtime này."}});

    // Ten a minute and one at a time (contract §4): refused before anything is tried.
    const int64_t now =
        drivers_.monoMs
            ? drivers_.monoMs()
            : static_cast<int64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
                                       std::chrono::steady_clock::now().time_since_epoch())
                                       .count());
    {
        std::lock_guard<std::mutex> l(testMu_);
        while (!testTimes_.empty() && now - testTimes_.front() >= 60000) testTimes_.pop_front();
        if (static_cast<int>(testTimes_.size()) >= kProbeRatePerMinute) {
            const int64_t wait =
                std::max<int64_t>(1, (testTimes_.front() + 60000 - now + 999) / 1000);
            return sendError(c, 429, "TEST_RATE_LIMITED", close,
                             "Retry-After: " + std::to_string(wait) + "\r\n",
                             {{"retryAfterS", wait},
                              {"message", "Thử kết nối quá nhiều lần: tối đa 10 lần mỗi phút."}});
        }
        if (testBusy_)
            return sendError(c, 409, "TEST_BUSY", close, "",
                             {{"message", "Đang có một lần thử kết nối khác."}});
        testBusy_ = true;
        testTimes_.push_back(now);
    }
    drv::TestOutcome outcome;
    try {
        outcome = drivers_.probeTcp(spec.tcp);
    } catch (const std::exception&) {
        outcome.code = "UNREACHABLE";
    }
    {
        std::lock_guard<std::mutex> l(testMu_);
        testBusy_ = false;
    }

    // The record of the test; without it no answer leaves (a test is a use of the engineering
    // door).
    try {
        AuditEvent e(AuditAction::DriverTest,
                     outcome.code == "OK" ? AuditResult::Ok : AuditResult::Failed,
                     AuditChannel::Https, r.from.text());
        e.user = d.access.user;
        if (d.access.role) e.role = roleName(*d.access.role);
        e.target = spec.target;
        e.code = outcome.code;
        audit_.append(e);
    } catch (const std::exception&) {
        return sendError(c, 503, "AUDIT_UNAVAILABLE", close);
    }
    return send(c, 200, jsonText(probeAnswerJson(outcome, spec.tcp.read)), close);
}

}  // namespace mat
