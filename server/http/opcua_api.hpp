// POST /api/v1/drivers/opcua/browse (feature 019, specs/019-driver-opcua/contracts/opcua.md §4):
// the request is read and checked here, with no connection to CivetWeb, so that every rule is a
// function of the JSON; and the body of the answer.
#pragma once
#include <string>
#include <vector>

#include "drivers/opcua/browse.hpp"
#include "nlohmann/json.hpp"
#include "server/http/drivers_api.hpp"

namespace mat {

struct OpcUaBrowseSpec {
    opcua::BrowseRequest request;  // without the password, the certificate directory
    std::string secretId;          // auth username: where the password is
    std::string target;            // the endpoint URL: the `target` of the audit row
};

// `issues` empty: `spec` is ready.
bool parseOpcUaBrowseRequest(const nlohmann::json& body, OpcUaBrowseSpec& spec,
                             std::vector<ProbeIssue>& issues);

// The 200 answer of §4.
nlohmann::json opcuaBrowseAnswerJson(const opcua::BrowseResult& result);

constexpr int kOpcUaBrowseRatePerMinute = 60;

}  // namespace mat
