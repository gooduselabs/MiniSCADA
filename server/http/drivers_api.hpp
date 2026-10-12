// POST /api/v1/drivers/test (feature 006 T106; contracts/device-api-1.1.md §4): the request is read
// and checked here, with no connection to CivetWeb, so that every rule is a function of the JSON.
#pragma once
#include <string>
#include <vector>

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
    bool rtu = false;          // kind modbus-rtu: not served yet
    drv::TcpProbeRequest tcp;  // kind modbus-tcp
    std::string target;        // "host:port", the `target` of the audit row
};

// Checks the body of the test. `issues` empty: `spec` is ready. Defaults of data-model §2: port
// 502, connectTimeoutMs 3000, unitId 1, timeoutMs 1000, addressBase 0. The two waits are cut so
// that connect + response + 2 s stay within 35 s (the hard cap of the answer).
bool parseProbeRequest(const nlohmann::json& body, ProbeSpec& spec,
                       std::vector<ProbeIssue>& issues);

// The 200 answer of §4 for a result: ok, code, message, connectMs, responseMs, read, exception.
nlohmann::json probeAnswerJson(const drv::TestOutcome& outcome, bool hadRead);

constexpr int64_t kProbeHardCapMs = 35000;
constexpr int kProbeRatePerMinute = 10;

}  // namespace mat
