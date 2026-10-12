// POST /api/v1/drivers/test (feature 006 T106, T164; contracts/device-api-1.1.md §4): the request
// is read and checked here, with no connection to CivetWeb, so that every rule is a function of the
// JSON. And the body of GET /api/v1/drivers/diagnostics (T195, §5).
#pragma once
#include <string>
#include <vector>

#include "core/tag-engine/engine.hpp"
#include "core/tag-engine/tag_model.hpp"
#include "core/tag-engine/tag_store.hpp"
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
};

// Checks the body of the test. `issues` empty: `spec` is ready. Defaults of data-model §2: port
// 502, connectTimeoutMs 3000, unitId 1, timeoutMs 1000, addressBase 0. The two waits are cut so
// that connect + response + 2 s stay within 35 s (the hard cap of the answer).
bool parseProbeRequest(const nlohmann::json& body, ProbeSpec& spec,
                       std::vector<ProbeIssue>& issues);

// The 200 answer of §4 for a result: ok, code, message, connectMs, responseMs, read, exception.
nlohmann::json probeAnswerJson(const drv::TestOutcome& outcome, bool hadRead);

// GET /api/v1/drivers/diagnostics (device-api-1.1 §5): the channels with their field devices and
// the counters of FR-029, the Tags that are BAD with their reason and detail. Pure: the drivers,
// the model and the store are read, nothing is changed.
struct DriversDiagInput {
    const ProjectModel* model = nullptr;
    // One driver per channel of the model, in its order (null: the channel has none).
    std::vector<const drv::ModbusTcpDriver*> channels;
    const TagStore* store = nullptr;
    const Engine* engine = nullptr;  // null: no detail for a calculated Tag
    int64_t nowMs = 0;               // UTC
    int64_t startedAtMs = 0;         // UTC: when the runtime started (the counters begin there)
};
constexpr size_t kDiagBadTagsMax = 500;
nlohmann::json driversDiagnosticsJson(const DriversDiagInput& input);

constexpr int64_t kProbeHardCapMs = 35000;
constexpr int kProbeRatePerMinute = 10;

}  // namespace mat
