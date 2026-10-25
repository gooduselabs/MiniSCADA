#include "server/http/drivers_api.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "civetweb.h"
#include "core/audit/audit_log.hpp"
#include "core/common/json_limits.hpp"
#include "core/common/json_text.hpp"
#include "core/common/serial_match.hpp"
#include "drivers/fins/end_codes.hpp"
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
    if (code == "END_CODE") return "PLC trả lời bằng mã kết thúc lỗi (FINS end code)";
    if (code == "DISCONNECTED") return "Kết nối bị đóng giữa chừng";
    if (code == "BACNET_ERROR") return "Thiết bị BACnet trả lời bằng lỗi (Error)";
    if (code == "BACNET_REJECT") return "Thiết bị BACnet từ chối yêu cầu (Reject)";
    if (code == "BACNET_ABORT") return "Thiết bị BACnet hủy giao dịch (Abort)";
    if (code == "BACNET_SEGMENTATION")
        return "Câu trả lời quá lớn, cần segmentation (driver không hỗ trợ)";
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

// Omron FINS (feature 018): channel.fins {host, port, transport, sourceNetwork, sourceNode,
// localPort, connectTimeoutMs}, device {network, node, unit, timeoutMs}, read {address, count 1-4}.
void parseFins(const json& ch, const json& dev, const json& body, ProbeSpec& spec,
               std::vector<ProbeIssue>& issues) {
    drv::FinsProbeRequest& f = spec.finsReq;
    const json fj = ch.contains("fins") && ch["fins"].is_object() ? ch["fins"] : json::object();
    if (!fj.contains("host")) {
        issue(issues, "E_FIELD_MISSING", "channel.fins.host", "Thiếu địa chỉ PLC (host).");
    } else if (!fj["host"].is_string() || fj["host"].get<std::string>().empty() ||
               fj["host"].get<std::string>().size() > 253 ||
               fj["host"].get<std::string>().find_first_of(" \t\r\n/\\") != std::string::npos) {
        issue(issues, "E_FIELD_VALUE", "channel.fins.host",
              "Địa chỉ PLC phải là IPv4 hoặc tên máy, tối đa 253 ký tự.");
    } else {
        f.host = fj["host"].get<std::string>();
    }
    intField(fj, "port", "channel.fins", 1, 65535, 9600, f.port, issues);
    intField(fj, "connectTimeoutMs", "channel.fins", 500, 30000, 3000, f.connectTimeoutMs, issues);
    intField(fj, "localPort", "channel.fins", 0, 65535, 0, f.localPort, issues);
    if (fj.contains("transport")) {
        const std::string t = fj["transport"].is_string() ? fj["transport"].get<std::string>() : "";
        if (t != "udp" && t != "tcp")
            issue(issues, "E_FIELD_VALUE", "channel.fins.transport", "Phải là udp hoặc tcp.");
        f.tcp = t == "tcp";
    }
    int v = 0;
    if (intField(fj, "sourceNetwork", "channel.fins", 0, 127, 0, v, issues))
        f.src.network = static_cast<uint8_t>(v);
    if (intField(fj, "sourceNode", "channel.fins", 0, 254, 0, v, issues))
        f.src.node = static_cast<uint8_t>(v);
    if (intField(dev, "network", "device", 0, 127, 0, v, issues))
        f.dst.network = static_cast<uint8_t>(v);
    if (intField(dev, "node", "device", 0, 254, 0, v, issues)) f.dst.node = static_cast<uint8_t>(v);
    if (intField(dev, "unit", "device", 0, 255, 0, v, issues)) f.dst.unit = static_cast<uint8_t>(v);
    intField(dev, "timeoutMs", "device", 100, 10000, 1000, f.timeoutMs, issues);
    if (body.contains("read")) {
        const json& rd = body["read"];
        if (!rd.is_object() || !rd.contains("address") || !rd["address"].is_string()) {
            issue(issues, "E_FIELD_MISSING", "read.address", "Thiếu địa chỉ cần đọc.");
        } else {
            int count = 1;
            intField(rd, "count", "read", -1000000, 1000000, 1, count, issues);
            const std::string a = rd["address"].get<std::string>();
            fins::AddressOptions o;
            o.rawType = TagType::UINT16;
            fins::Address addr = fins::parseAddress(a, o);
            if (!addr.ok && addr.error == "E_ADDR_AREA") {  // a bit or a flag
                o.rawType = TagType::BOOL;
                addr = fins::parseAddress(a, o);
            }
            if (!addr.ok) {
                issue(issues, addr.error.c_str(), "read.address",
                      "Địa chỉ không hợp lệ: " + addr.error + ".");
            } else if (count < 1 || count > 4) {
                issue(issues, "E_PROBE_COUNT", "read.count", "Số lượng phải từ 1 đến 4.");
            } else if (addr.offset + count - 1 > fins::areaMax(addr.area)) {
                issue(issues, "E_ADDR_RANGE", "read.address", "Địa chỉ vượt cuối vùng nhớ.");
            } else {
                f.read = true;
                f.addr = addr;
                f.count = count;
            }
        }
    }
    if (issues.empty()) {
        f.timeoutMs = std::max(100, std::min(f.timeoutMs, static_cast<int>(kProbeHardCapMs) - 2000 -
                                                              f.connectTimeoutMs));
        spec.target = f.host + ":" + std::to_string(f.port);
    }
}

// BACnet/IP (feature 020): channel.bacnet {localPort, bindAddress, broadcast, bbmd {host, port}},
// device {deviceInstance, host, port, network, mac, timeoutMs}, action read | whois | objects,
// read {address}, whois {low, high, waitMs}.
bool hostOk(const json& v) {
    return v.is_string() && !v.get<std::string>().empty() && v.get<std::string>().size() <= 253 &&
           v.get<std::string>().find_first_of(" \t\r\n/\\") == std::string::npos;
}

void parseBacnet(const json& ch, const json& dev, const json& body, ProbeSpec& spec,
                 std::vector<ProbeIssue>& issues) {
    drv::BacnetProbeRequest& b = spec.bacnetReq;
    const json bj =
        ch.contains("bacnet") && ch["bacnet"].is_object() ? ch["bacnet"] : json::object();
    std::string action = "read";
    if (body.contains("action")) {
        action = body["action"].is_string() ? body["action"].get<std::string>() : "";
        if (action != "read" && action != "whois" && action != "objects")
            issue(issues, "E_FIELD_VALUE", "action", "Phải là read, whois hoặc objects.");
    }
    b.action = action == "whois" ? drv::BacnetProbeRequest::Action::WhoIs
                                 : action == "objects" ? drv::BacnetProbeRequest::Action::Objects
                                                       : drv::BacnetProbeRequest::Action::Read;
    int localPort = 47808;
    intField(bj, "localPort", "channel.bacnet", 0, 65535, 47808, localPort, issues);
    // Who-Is listens on the channel's port (the I-Am are broadcast to it); the other actions take
    // a port of the system's choice (the answers come back to it)
    b.localPort = b.action == drv::BacnetProbeRequest::Action::WhoIs ? localPort : 0;
    b.broadcastPort = localPort == 0 ? 47808 : localPort;
    if (bj.contains("bindAddress")) {
        if (!hostOk(bj["bindAddress"]))
            issue(issues, "E_FIELD_VALUE", "channel.bacnet.bindAddress", "Phải là địa chỉ IPv4.");
        else
            b.bindAddress = bj["bindAddress"].get<std::string>();
    }
    if (bj.contains("broadcast")) {
        if (!hostOk(bj["broadcast"]))
            issue(issues, "E_FIELD_VALUE", "channel.bacnet.broadcast", "Phải là địa chỉ IPv4.");
        else
            b.broadcast = bj["broadcast"].get<std::string>();
    }
    if (bj.contains("bbmd") && bj["bbmd"].is_object()) {
        const json& m = bj["bbmd"];
        if (!m.contains("host") || !hostOk(m["host"]))
            issue(issues, "E_FIELD_VALUE", "channel.bacnet.bbmd.host",
                  "Địa chỉ BBMD phải là IPv4 hoặc tên máy.");
        else
            b.bbmdHost = m["host"].get<std::string>();
        intField(m, "port", "channel.bacnet.bbmd", 1, 65535, 47808, b.bbmdPort, issues);
    }
    intField(dev, "timeoutMs", "device", 100, 10000, 3000, b.timeoutMs, issues);
    if (b.action == drv::BacnetProbeRequest::Action::WhoIs) {
        const json w =
            body.contains("whois") && body["whois"].is_object() ? body["whois"] : json::object();
        int lo = -1, hi = -1;
        intField(w, "low", "whois", 0, 4194303, -1, lo, issues);
        intField(w, "high", "whois", 0, 4194303, -1, hi, issues);
        if ((lo < 0) != (hi < 0) || (lo >= 0 && lo > hi))
            issue(issues, "E_FIELD_VALUE", "whois", "Cần cả low và high, low không lớn hơn high.");
        b.low = lo;
        b.high = hi;
        intField(w, "waitMs", "whois", 500, 10000, 3000, b.waitMs, issues);
        spec.target = b.bbmdHost.empty() ? b.broadcast : b.bbmdHost;
        return;
    }
    if (!dev.contains("host")) {
        issue(issues, "E_FIELD_MISSING", "device.host", "Thiếu địa chỉ IP của thiết bị BACnet.");
    } else if (!hostOk(dev["host"])) {
        issue(issues, "E_FIELD_VALUE", "device.host",
              "Phải là IPv4 hoặc tên máy, tối đa 253 ký tự.");
    } else {
        b.host = dev["host"].get<std::string>();
    }
    intField(dev, "port", "device", 1, 65535, 47808, b.port, issues);
    int instance = 0;
    if (!dev.contains("deviceInstance"))
        issue(issues, "E_FIELD_MISSING", "device.deviceInstance", "Thiếu device instance.");
    else if (intField(dev, "deviceInstance", "device", 0, 4194302, 0, instance, issues))
        b.deviceInstance = static_cast<uint32_t>(instance);
    intField(dev, "network", "device", 0, 65534, 0, b.network, issues);
    if (dev.contains("mac")) {
        const std::string mac = dev["mac"].is_string() ? dev["mac"].get<std::string>() : "#";
        const bool hex = !mac.empty() && mac.size() <= 12 && mac.size() % 2 == 0 &&
                         mac.find_first_not_of("0123456789abcdefABCDEF") == std::string::npos;
        if (!hex)
            issue(issues, "E_FIELD_VALUE", "device.mac",
                  "MAC phải là 1 đến 6 byte hex (ví dụ 07).");
        else
            b.mac = bacnet::fromHex(mac);
    }
    if (b.action == drv::BacnetProbeRequest::Action::Read && body.contains("read")) {
        const json& rd = body["read"];
        if (!rd.is_object() || !rd.contains("address") || !rd["address"].is_string()) {
            issue(issues, "E_FIELD_MISSING", "read.address", "Thiếu địa chỉ cần đọc.");
        } else {
            const std::string a = rd["address"].get<std::string>();
            bacnet::Address addr;
            // the type does not matter for a read: the first one the address accepts
            for (TagType t : {TagType::FLOAT64, TagType::BOOL, TagType::UINT32, TagType::STRING}) {
                bacnet::AddressOptions o;
                o.rawType = t;
                addr = bacnet::parseAddress(a, o);
                if (addr.ok || addr.error != "E_ADDR_AREA") break;
            }
            if (!addr.ok) {
                issue(issues, addr.error.c_str(), "read.address",
                      "Địa chỉ không hợp lệ: " + addr.error + ".");
            } else {
                b.hasAddress = true;
                b.addr = addr;
            }
        }
    }
    if (issues.empty()) {
        b.timeoutMs = std::max(100, std::min(b.timeoutMs, static_cast<int>(kProbeHardCapMs) / 4));
        spec.target = b.host + ":" + std::to_string(b.port);
    }
}

}  // namespace

std::string bacnetExceptionKey(int code) {
    if (code >= 2000) return "abort:" + std::to_string(code - 2000);
    if (code >= 1000) return "reject:" + std::to_string(code - 1000);
    return "error:" + std::to_string(code);
}

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
    if (kind != "modbus-tcp" && kind != "modbus-rtu" && kind != "fins" && kind != "bacnet") {
        issue(issues, "E_FIELD_VALUE", "channel.kind",
              "Loại kênh phải là modbus-tcp, modbus-rtu, fins hoặc bacnet.");
        return false;
    }
    const json dev =
        body.contains("device") && body["device"].is_object() ? body["device"] : json::object();
    if (kind == "fins") {  // feature 018
        spec.fins = true;
        parseFins(ch, dev, body, spec, issues);
        return issues.empty();
    }
    if (kind == "bacnet") {  // feature 020
        spec.bacnet = true;
        parseBacnet(ch, dev, body, spec, issues);
        return issues.empty();
    }
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
        j["exception"] = exceptionJson(o.exception);
        if (o.responseMs > 0 || hadRead) j["responseMs"] = o.responseMs;
    }
    return j;
}

json finsProbeAnswerJson(const drv::FinsProbeOutcome& out, const drv::FinsProbeRequest& req) {
    const drv::TestOutcome& o = out.base;
    json j = {{"ok", o.code == "OK"}, {"code", o.code}, {"connectMs", o.connectMs}};
    const char* msg = messageOf(o.code);
    if (*msg) j["message"] = msg;
    if (!o.responseFrame.empty()) j["responseMs"] = o.responseMs;
    if (!out.model.empty()) j["model"] = out.model;
    if (out.clientNode >= 0) j["nodes"] = {{"client", out.clientNode}, {"server", out.serverNode}};
    if (o.code == "OK" && req.read) {
        json rd = {{"address", req.addr.normalized}, {"count", req.count}};
        if (!o.registers.empty()) {
            json words = json::array();
            for (uint16_t r : o.registers) words.push_back(hex16(r));
            rd["words"] = words;
        } else {
            json bits = json::array();
            for (uint8_t b : o.bits) bits.push_back(b != 0);
            rd["bits"] = bits;
        }
        j["read"] = rd;
    }
    if (o.code == "END_CODE")
        j["endCode"] = {{"code", fins::endCodeHex(out.endCode)},
                        {"reason", fins::endCodeReason(out.endCode)},
                        {"meaning", fins::endCodeMeaning(out.endCode)}};
    return j;
}

json bacnetProbeAnswerJson(const drv::BacnetProbeOutcome& out, const drv::BacnetProbeRequest& req) {
    const drv::TestOutcome& o = out.base;
    const char* action =
        req.action == drv::BacnetProbeRequest::Action::WhoIs
            ? "whois"
            : req.action == drv::BacnetProbeRequest::Action::Objects ? "objects" : "read";
    json j = {
        {"ok", o.code == "OK"}, {"code", o.code}, {"action", action}, {"connectMs", o.connectMs}};
    const char* msg = messageOf(o.code);
    if (*msg) j["message"] = msg;
    if (!o.responseFrame.empty()) j["responseMs"] = o.responseMs;
    if (req.action == drv::BacnetProbeRequest::Action::Read && o.code == "OK")
        j["read"] = {{"address", req.hasAddress ? req.addr.normalized
                                                : "DEV:" + std::to_string(req.deviceInstance) +
                                                      ":object-name"},
                     {"value", out.valueText},
                     {"kind", out.valueKind}};
    if (req.action == drv::BacnetProbeRequest::Action::WhoIs) {
        json devs = json::array();
        for (const auto& d : out.devices)
            devs.push_back({{"instance", d.instance},
                            {"host", d.host},
                            {"port", d.port},
                            {"network", d.network},
                            {"mac", bacnet::hexOf(d.mac)},
                            {"maxApdu", d.maxApdu},
                            {"segmentation", d.segmentation},
                            {"vendorId", d.vendorId}});
        j["devices"] = devs;
        j["truncated"] = out.truncated;
    }
    if (req.action == drv::BacnetProbeRequest::Action::Objects) {
        json objs = json::array();
        for (size_t i = 0; i < out.objects.size(); ++i) {
            const bacnet::ObjectId& id = out.objects[i];
            const char* t = bacnet::typeName(id.type);
            json x = {{"type", id.type}, {"instance", id.instance}};
            if (*t) x["address"] = std::string(t) + ":" + std::to_string(id.instance);
            if (i < out.objectNames.size() && !out.objectNames[i].empty())
                x["name"] = out.objectNames[i];
            objs.push_back(x);
        }
        j["objects"] = objs;
        j["truncated"] = out.truncated;
    }
    if (o.code == "BACNET_ERROR")
        j["error"] = {{"class", out.errorClass},
                      {"code", out.errorCode},
                      {"reason", bacnet::errorReason(out.errorCode)}};
    if (out.reason >= 0 && o.code != "OK" && o.code != "BACNET_ERROR") j["reason"] = out.reason;
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

    // Feature 019 (contracts/opcua.md §4): an OPC UA channel is tested by the browse route.
    if (j.is_object() && j.contains("channel") && j["channel"].is_object() &&
        j["channel"].value("kind", "") == "opcua")
        return send(c, 200,
                    jsonText({{"ok", false},
                              {"code", "NOT_SUPPORTED"},
                              {"message", "Kênh OPC UA: dùng Lấy chứng chỉ / Duyệt node."}}),
                    close);
    // Feature 022: an MQTT channel has no request to try; its diagnostics show the broker.
    if (j.is_object() && j.contains("channel") && j["channel"].is_object() &&
        j["channel"].value("kind", "") == "mqtt")
        return send(c, 200,
                    jsonText({{"ok", false},
                              {"code", "NOT_SUPPORTED"},
                              {"message", "Kênh MQTT: xem Chẩn đoán driver."}}),
                    close);
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
    if (spec.fins && !drivers_.probeFins)
        return sendError(
            c, 501, "NOT_IMPLEMENTED", close, "",
            {{"message", "Thử kết nối Omron FINS chưa có trong phiên bản runtime này."}});
    if (spec.bacnet && !drivers_.probeBacnet)
        return sendError(
            c, 501, "NOT_IMPLEMENTED", close, "",
            {{"message", "Thử kết nối BACnet/IP chưa có trong phiên bản runtime này."}});

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
    drv::FinsProbeOutcome finsOutcome;
    drv::BacnetProbeOutcome bacnetOutcome;
    try {
        if (spec.fins) {
            finsOutcome = drivers_.probeFins(spec.finsReq);
            outcome = finsOutcome.base;
        } else if (spec.bacnet) {
            bacnetOutcome = drivers_.probeBacnet(spec.bacnetReq);
            outcome = bacnetOutcome.base;
        } else {
            outcome = spec.rtu ? drivers_.probeRtu(spec.rtuPort, spec.rtuReq)
                               : drivers_.probeTcp(spec.tcp);
        }
    } catch (const std::exception&) {
        outcome.code = "UNREACHABLE";
        finsOutcome.base = outcome;
        bacnetOutcome.base = outcome;
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
    if (spec.fins)
        return send(c, 200, jsonText(finsProbeAnswerJson(finsOutcome, spec.finsReq)), close);
    if (spec.bacnet)
        return send(c, 200, jsonText(bacnetProbeAnswerJson(bacnetOutcome, spec.bacnetReq)), close);
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

// `kind`: the channel kind; the exceptions of a FINS channel are end codes (feature 018), four hex
// digits, those of a BACnet/IP channel error codes, rejects and aborts (feature 020).
json deviceJson(const drv::DeviceDiag& d, const std::string& name, const std::string& kind) {
    json ex = json::object();
    // FINS: end code; BACnet: error:31, reject:9, abort:4. Otherwise exceptionKey: two hex digits
    // (Modbus exception, S7 item code), four for an S7 header error (8104) or an MC end code (C056)
    for (const auto& [code, n] : d.exceptions)
        ex[kind == "fins" ? fins::endCodeHex(static_cast<uint16_t>(code))
                          : kind == "bacnet" ? bacnetExceptionKey(code) : exceptionKey(code)] = n;
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
                devices.push_back(deviceJson(dd, dm.name, ch.kind));
            }
            json warnings = json::array();
            for (const auto& w : d.channel.warnings) warnings.push_back(w);
            channels.push_back({{"id", ch.id},
                                {"name", ch.name},
                                {"kind", ch.rtu ? std::string("modbus-rtu") : ch.kind},
                                {"state", d.channel.state.empty() ? "disabled" : d.channel.state},
                                {"lastError", lastError},
                                {"reconnects", d.channel.reconnects},
                                {"warnings", warnings},
                                {"devices", devices}});
            // feature 016: facts of the connection of a driver that has some (S7: PDU size, TSAPs)
            if (!d.channel.details.empty()) {
                json details = json::object();
                for (const auto& [k, v] : d.channel.details) details[k] = v;
                channels.back()["details"] = details;
            }
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
