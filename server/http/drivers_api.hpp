// POST /api/v1/drivers/test (feature 006 T106, T164; contracts/device-api-1.1.md §4): the request
// is read and checked here, with no connection to CivetWeb, so that every rule is a function of the
// JSON. And the body of GET /api/v1/drivers/diagnostics (T195, §5).
#pragma once
#include <string>
#include <vector>

#include "core/tag-engine/engine.hpp"
#include "core/tag-engine/tag_model.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "drivers/bacnet/bacnet_driver.hpp"
#include "drivers/fins/fins_driver.hpp"
#include "drivers/mc/mc_driver.hpp"
#include "drivers/modbus/exceptions.hpp"
#include "drivers/modbus/modbus_tcp_driver.hpp"
#include "drivers/modbus/test_probe.hpp"
#include "nlohmann/json.hpp"

namespace mat {

struct ProbeIssue {
    std::string code;  // E_ADDR_SYNTAX, E_ADDR_RANGE, E_ADDR_AREA, E_FIELD_MISSING, E_FIELD_VALUE,
                       // E_PROBE_COUNT
    std::string path;  // "channel.tcp.host"
    std::string message;  // Vietnamese
};

struct ProbeSpec {
    bool rtu = false;             // kind modbus-rtu
    drv::TcpProbeRequest tcp;     // kind modbus-tcp
    drv::RtuProbeRequest rtuReq;  // kind modbus-rtu
    std::string rtuPort;          // serial.port as the project names it ("ttyAS2")
    std::string target;           // "host:port" or the port name: the `target` of the audit row
    bool fins = false;            // kind fins (feature 018)
    drv::FinsProbeRequest finsReq;
    bool bacnet = false;  // kind bacnet (feature 020)
    drv::BacnetProbeRequest bacnetReq;
};

// Checks the body of the test. `issues` empty: `spec` is ready. Defaults of data-model §2: port
// 502, connectTimeoutMs 3000, unitId 1, timeoutMs 1000, addressBase 0. The two waits are cut so
// that connect + response + 2 s stay within 35 s (the hard cap of the answer).
bool parseProbeRequest(const nlohmann::json& body, ProbeSpec& spec,
                       std::vector<ProbeIssue>& issues);

// The 200 answer of §4 for a result: ok, code, message, connectMs, responseMs, read, exception.
nlohmann::json probeAnswerJson(const drv::TestOutcome& outcome, bool hadRead);
// The 200 answer of a FINS test (feature 018): ok, code, message, connectMs, responseMs, model
// (0501), nodes (TCP), read {address, count, words | bits}, endCode {code, meaning}.
nlohmann::json finsProbeAnswerJson(const drv::FinsProbeOutcome& outcome,
                                   const drv::FinsProbeRequest& req);
// The 200 answer of a BACnet test (feature 020): ok, code, message, action, connectMs, responseMs;
// read {address, value, kind}; devices [{instance, host, port, network, mac, maxApdu,
// segmentation, vendorId}]; objects [{type, instance, address, name}], truncated; error {class,
// code, reason} | reject / abort {reason}.
nlohmann::json bacnetProbeAnswerJson(const drv::BacnetProbeOutcome& outcome,
                                     const drv::BacnetProbeRequest& req);
// The key of a BACnet exception counter of the diagnostics: "error:31", "reject:9", "abort:4".
std::string bacnetExceptionKey(int code);

// GET /api/v1/drivers/diagnostics (device-api-1.1 §5): the channels with their field devices and
// the counters of FR-029, the Tags that are BAD with their reason and detail. Pure: the drivers,
// the model and the store are read, nothing is changed.
struct DriversDiagInput {
    const ProjectModel* model = nullptr;
    // One driver per channel of the model, in its order (null: the channel has none).
    std::vector<const drv::Driver*> channels;
    const TagStore* store = nullptr;
    const Engine* engine = nullptr;  // null: no detail for a calculated Tag
    int64_t nowMs = 0;               // UTC
    int64_t startedAtMs = 0;         // UTC: when the runtime started (the counters begin there)
};
constexpr size_t kDiagBadTagsMax = 500;
nlohmann::json driversDiagnosticsJson(const DriversDiagInput& input);

// The code of a device error in the API: a Modbus exception ("02", <= 0xFF) or an MC end code
// ("C056", feature 017; end codes are never below 0x100).
inline std::string exceptionKey(int code) {
    return code > 0xFF ? drv::mcEndCodeHex(code) : modbus::exceptionHex(code);
}
inline nlohmann::json exceptionJson(int code) {
    return {{"code", exceptionKey(code)},
            {"meaning", code > 0xFF ? drv::mcEndMeaning(static_cast<uint16_t>(code))
                                    : modbus::exceptionMeaning(code)}};
}

constexpr int64_t kProbeHardCapMs = 35000;
constexpr int kProbeRatePerMinute = 10;

}  // namespace mat
