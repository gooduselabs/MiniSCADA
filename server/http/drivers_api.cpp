#include "server/http/drivers_api.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "civetweb.h"
#include "core/audit/audit_log.hpp"
#include "core/common/json_limits.hpp"
#include "core/common/json_text.hpp"
#include "core/common/serial_match.hpp"
#include "drivers/modbus/address.hpp"
#include "drivers/modbus/exceptions.hpp"
#include "drivers/sdk/serial_port.hpp"
#include "drivers/sdk/serial_ports.hpp"
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
    if (code == "PORT_BUSY")
        return "Cổng đang được chương trình khác dùng, hoặc kênh khác đang giữ cổng với tham số "
               "khác";
    if (code == "PORT_CONSOLE") return "Cổng này là console của hệ điều hành, không dùng được";
    if (code == "PORT_NOT_ALLOWED")
        return "Cổng không nằm trong danh sách serialPorts của thiết bị";
    if (code == "PORT_ERROR") return "Không mở được cổng serial";
    return "";
}

}  // namespace

namespace {

struct ReadSpec {
    bool read = false;
    modbus::Area area = modbus::Area::HR;
    int offset = 0;
    int count = 1;
};

// The optional `read` of a test: an address (the base of the field device applied) and a count, 1-4
// registers or 1-16 bits; the same for TCP and RTU.
void parseRead(const json& body, int base, ReadSpec& out, std::vector<ProbeIssue>& issues) {
    if (!body.contains("read")) return;
    const json& rd = body["read"];
    if (!rd.is_object() || !rd.contains("address") || !rd["address"].is_string()) {
        issue(issues, "E_FIELD_MISSING", "read.address", "Thiếu địa chỉ cần đọc.");
        return;
    }
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
        issue(issues, a.error.c_str(), "read.address", "Địa chỉ không hợp lệ: " + a.error + ".");
        return;
    }
    const bool bits = a.area == modbus::Area::C || a.area == modbus::Area::DI;
    const int maxCount = bits ? 16 : 4;
    if (count < 1 || count > maxCount) {
        issue(issues, "E_PROBE_COUNT", "read.count",
              std::string("Số lượng phải từ 1 đến ") + std::to_string(maxCount) +
                  (bits ? " bit." : " thanh ghi."));
    } else if (a.offset + count > 65536) {
        issue(issues, "E_ADDR_RANGE", "read.address", "Địa chỉ vượt quá 65.535.");
    } else {
        out.read = true;
        out.area = a.area;
        out.offset = a.offset;
        out.count = count;
    }
}

// A boolean field; `def` when absent.
bool boolField(const json& obj, const char* key, const std::string& path, bool def, bool& out,
               std::vector<ProbeIssue>& issues) {
    out = def;
    if (!obj.is_object() || !obj.contains(key)) return true;
    if (!obj[key].is_boolean()) {
        issue(issues, "E_FIELD_VALUE", path + "." + key, "Phải là true hoặc false.");
        return false;
    }
    out = obj[key].get<bool>();
    return true;
}

void parseRtu(const json& ch, const json& dev, const json& body, ProbeSpec& spec,
              std::vector<ProbeIssue>& issues) {
    drv::RtuProbeRequest& r = spec.rtuReq;
    const json ser =
        ch.contains("serial") && ch["serial"].is_object() ? ch["serial"] : json::object();
    if (!ser.contains("port")) {
        issue(issues, "E_FIELD_MISSING", "channel.serial.port", "Thiếu cổng serial (port).");
    } else if (!ser["port"].is_string() || !serialPortNameOk(ser["port"].get<std::string>())) {
        issue(issues, "E_SERIAL_PORT", "channel.serial.port",
              "Cổng phải là tên dạng ttyXXXn, hoặc đường dẫn /dev/serial/by-id/… hay by-path/….");
    } else {
        spec.rtuPort = ser["port"].get<std::string>();
        r.devicePath = drv::serialDevicePath(spec.rtuPort);
    }
    int baud = 9600;
    if (intField(ser, "baud", "channel.serial", 1200, 115200, 9600, baud, issues)) {
        if (!drv::serialBaudSupported(baud))
            issue(issues, "E_FIELD_VALUE", "channel.serial.baud",
                  "Tốc độ phải là 1200, 2400, 4800, 9600, 19200, 38400, 57600 hoặc 115200.");
        r.baud = baud;
    }
    int dataBits = 8, stopBits = 1;
    if (intField(ser, "dataBits", "channel.serial", 7, 8, 8, dataBits, issues))
        r.dataBits = dataBits;
    if (intField(ser, "stopBits", "channel.serial", 1, 2, 1, stopBits, issues))
        r.stopBits = stopBits;
    r.parity = 'E';
    if (ser.contains("parity")) {
        const std::string p = ser["parity"].is_string() ? ser["parity"].get<std::string>() : "";
        if (p == "none")
            r.parity = 'N';
        else if (p == "even")
            r.parity = 'E';
        else if (p == "odd")
            r.parity = 'O';
        else
            issue(issues, "E_FIELD_VALUE", "channel.serial.parity", "Phải là none, even hoặc odd.");
    }
    boolField(ser, "rs485", "channel.serial", true, r.rs485, issues);
    boolField(ser, "dropEcho", "channel.serial", false, r.dropEcho, issues);
    intField(ser, "silenceMs", "channel.serial", 0, 1000, 0, r.silenceMs, issues);
    // no broadcast (D31): the slave is 1-247
    intField(dev, "slave", "device", 1, 247, 1, r.unit, issues);
    intField(dev, "timeoutMs", "device", 100, 10000, 1000, r.timeoutMs, issues);
    int base = 0;
    if (dev.contains("addressBase")) {
        if (!dev["addressBase"].is_number_integer() ||
            (dev["addressBase"].get<int>() != 0 && dev["addressBase"].get<int>() != 1))
            issue(issues, "E_FIELD_VALUE", "device.addressBase", "Phải là 0 hoặc 1.");
        else
            base = dev["addressBase"].get<int>();
    }
    ReadSpec rd;
    parseRead(body, base, rd, issues);
    r.read = rd.read;
    r.area = rd.area;
    r.offset = rd.offset;
    r.count = rd.count;
    r.connectTimeoutMs = 3000;
    if (issues.empty()) {
        r.timeoutMs = std::max(100, std::min(r.timeoutMs, static_cast<int>(kProbeHardCapMs) - 2000 -
                                                              r.connectTimeoutMs));
        spec.target = spec.rtuPort;
    }
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
        parseRtu(ch, dev, body, spec, issues);
        return issues.empty();
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
    ReadSpec rd;
    parseRead(body, base, rd, issues);
    t.read = rd.read;
    t.area = rd.area;
    t.offset = rd.offset;
    t.count = rd.count;
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
    if (spec.rtu && !drivers_.probeRtu)
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
        outcome =
            spec.rtu ? drivers_.probeRtu(spec.rtuPort, spec.rtuReq) : drivers_.probeTcp(spec.tcp);
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
    return send(c, 200,
                jsonText(probeAnswerJson(outcome, spec.rtu ? spec.rtuReq.read : spec.tcp.read)),
                close);
}

// ---------- GET /api/v1/drivers/diagnostics ----------

int EngineeringApi::driversDiagnostics(mg_connection* c, bool close) {
    using eapi::send;
    json body;
    try {
        body = drivers_.diagnostics();
    } catch (const std::exception&) {
        return eapi::sendError(c, 500, "INTERNAL_ERROR", close);
    }
    return send(c, 200, jsonText(body), close);
}

// ---------- GET /api/v1/serial/ports[?probe=1] ----------

int EngineeringApi::serialPorts(mg_connection* c, const GateRequest& r, const GateDecision& d,
                                bool close) {
    using eapi::send;
    using eapi::sendError;
    bool probe = false;
    if (const char* qs = mg_get_request_info(c)->query_string) {
        const std::string q = qs;
        if (q == "probe=1")
            probe = true;
        else if (q != "probe=0")
            return sendError(c, 400, "BAD_REQUEST", close);
    }
    // A probe touches the ports: without the audit log it is not made (a test is a use of the
    // engineering door).
    if (probe && !audit_.isOpen()) return sendError(c, 503, "AUDIT_UNAVAILABLE", close);
    std::vector<std::string> probed;
    json body;
    try {
        body = serial_.list(probe, probed);
    } catch (const std::exception&) {
        return sendError(c, 500, "INTERNAL_ERROR", close);
    }
    for (const std::string& port : probed) {
        try {
            AuditEvent e(AuditAction::DriverTest, AuditResult::Ok, AuditChannel::Https,
                         r.from.text());
            e.user = d.access.user;
            if (d.access.role) e.role = roleName(*d.access.role);
            e.target = port;
            e.code = "RS485_PROBE";
            audit_.append(e);
        } catch (const std::exception&) {
            return sendError(c, 503, "AUDIT_UNAVAILABLE", close);
        }
    }
    return send(c, 200, jsonText(body), close);
}

// ---------- the body of GET /api/v1/drivers/diagnostics ----------

namespace {

double round1(double v) { return std::round(v * 10.0) / 10.0; }

json groupJson(const drv::GroupDiag& g) {
    return {{"group", g.name},
            {"periodMs", g.periodMs},
            {"actualMs", {{"avg", round1(g.actualAvgMs)}, {"max", g.actualMaxMs}}},
            {"overruns", g.overruns},
            {"overloaded", g.overloaded}};
}

json deviceJson(const drv::DeviceDiag& d, const std::string& name) {
    json ex = json::object();
    for (const auto& [code, n] : d.exceptions) ex[modbus::exceptionHex(code)] = n;
    json groups = json::array();
    for (const auto& g : d.groups) groups.push_back(groupJson(g));
    return {{"id", d.id},
            {"name", name},
            {"state", d.state},
            {"requestsOk", d.requestsOk},
            {"timeouts", d.timeouts},
            {"exceptions", ex},
            {"badFrames",
             {{"crc", d.badFrames.crc},
              {"format", d.badFrames.format},
              {"tid", d.badFrames.tid},
              {"unit", d.badFrames.unit},
              {"length", d.badFrames.length},
              {"echo", d.badFrames.echo}}},
            {"responseMs", {{"avg", round1(d.responseAvgMs)}, {"max", d.responseMaxMs}}},
            {"groups", groups},
            {"writes",
             {{"confirmed", d.writes.confirmed},
              {"failed", d.writes.failed},
              {"timeout", d.writes.timeout},
              {"rejected", d.writes.rejected}}}};
}

}  // namespace

json driversDiagnosticsJson(const DriversDiagInput& in) {
    json out = {{"at", in.nowMs}, {"runtimeStartedAt", in.startedAtMs}};
    json channels = json::array();
    const ProjectModel* model = in.model;
    if (model) {
        out["scanGroups"] = {{"fast", model->scanGroupMs[0]},
                             {"normal", model->scanGroupMs[1]},
                             {"slow", model->scanGroupMs[2]}};
        for (size_t ci = 0; ci < model->channels.size(); ++ci) {
            const ChannelModel& ch = model->channels[ci];
            drv::DriverDiag d;
            if (ci < in.channels.size() && in.channels[ci])
                in.channels[ci]->diagnostics(d, in.nowMs);
            json lastError = nullptr;
            if (!d.channel.lastErrorCode.empty()) {
                lastError = {{"code", d.channel.lastErrorCode}, {"at", d.channel.lastErrorAt}};
                if (!d.channel.lastErrorDevice.empty())
                    lastError["device"] = d.channel.lastErrorDevice;
            }
            json devices = json::array();
            for (size_t k = 0; k < ch.devices.size(); ++k) {
                const DeviceModel& dm = model->devices[ch.devices[k]];
                drv::DeviceDiag dd;
                if (k < d.devices.size()) dd = d.devices[k];
                dd.id = dm.id;
                // a channel that is off has no traffic whatever its field devices say
                if (dd.state.empty() || d.channel.state.empty() || d.channel.state == "disabled")
                    dd.state = "disabled";
                devices.push_back(deviceJson(dd, dm.name));
            }
            json warnings = json::array();
            for (const auto& w : d.channel.warnings) warnings.push_back(w);
            channels.push_back({{"id", ch.id},
                                {"name", ch.name},
                                {"kind", ch.rtu ? "modbus-rtu" : "modbus-tcp"},
                                {"state", d.channel.state.empty() ? "disabled" : d.channel.state},
                                {"lastError", lastError},
                                {"reconnects", d.channel.reconnects},
                                {"warnings", warnings},
                                {"devices", devices}});
        }
    }
    out["channels"] = channels;

    // The Tags that are BAD, the newest first: where a reader looks for the cause (FR-051).
    struct Bad {
        size_t index;
        TagValue value;
    };
    std::vector<Bad> bad;
    if (model && in.store) {
        std::vector<size_t> all(in.store->size());
        for (size_t i = 0; i < all.size(); ++i) all[i] = i;
        std::vector<TagValue> values;
        in.store->snapshot(all, values);
        for (size_t i = 0; i < values.size(); ++i)
            if (values[i].quality == Quality::BAD) bad.push_back({i, values[i]});
        std::stable_sort(bad.begin(), bad.end(), [](const Bad& a, const Bad& b) {
            return a.value.serverTs > b.value.serverTs;
        });
    }
    json badTags = json::array();
    for (size_t k = 0; k < bad.size() && k < kDiagBadTagsMax; ++k) {
        const Bad& b = bad[k];
        json detail = nullptr;
        if (b.value.reason == "INPUT_BAD" && in.engine && in.store) {
            if (const std::vector<size_t>* inputs = in.engine->inputsOf(b.index))
                for (size_t input : *inputs)
                    if (in.store->get(input).quality == Quality::BAD) {
                        detail = in.store->def(input).id;
                        break;
                    }
        } else if (b.value.reason.rfind("EXCEPTION_", 0) == 0 && b.value.reason.size() > 10) {
            detail = b.value.reason.substr(10);
        }
        badTags.push_back({{"id", in.store->def(b.index).id},
                           {"quality", "BAD"},
                           {"reason", b.value.reason},
                           {"detail", detail},
                           {"updatedAt", b.value.serverTs}});
    }
    out["badTags"] = badTags;
    out["badTagsTruncated"] = bad.size() > kDiagBadTagsMax;
    return out;
}

}  // namespace mat
