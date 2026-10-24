// A short-lived OPC UA connection for the engineer (feature 019, contracts/opcua.md §4): the
// endpoints and certificate of a server (GetEndpoints, no session), or the children of a node
// (a session with the channel's security and identity, then Browse and Read). Runs on the HTTP
// worker that took POST /api/v1/drivers/opcua/browse; never touches the running drivers.
#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "drivers/opcua/opcua_driver.hpp"

namespace mat::opcua {

struct BrowseRequest {
    std::string action = "browse";  // endpoints | browse
    std::string endpointUrl;
    drv::OpcUaSecurityMode securityMode = drv::OpcUaSecurityMode::None;
    bool basic256Sha256 = false;
    std::string serverCertSha256;
    bool authUsername = false;
    std::string username;
    std::optional<std::string> password;  // nullopt with authUsername: OPCUA_SECRET_MISSING
    std::string nodeId = "i=85";          // Objects
    int timeoutMs = 5000;
    std::string certDir, applicationUri;  // the client certificate (as the drivers)
};

struct BrowseEndpoint {
    std::string securityMode, securityPolicy;  // "SignAndEncrypt", "Basic256Sha256"
    std::vector<std::string> userTokens;       // anonymous, username, certificate, issued
};

struct BrowseRef {
    std::string nodeId, browseName, displayName, nodeClass;
    std::string dataType, tagType;  // variables only; "" unknown
    std::optional<bool> writable;   // variables only
    bool hasChildren = false;
};

struct BrowseResult {
    bool ok = false;
    std::string code = "OK";  // OK, REFUSED, TIMEOUT, OPCUA_*
    std::string status;       // the StatusCode name of a failure
    int64_t elapsedMs = 0;
    std::string applicationUri, certSha256, certSubject;
    int64_t certNotAfterMs = 0;
    std::vector<BrowseEndpoint> endpoints;
    std::vector<BrowseRef> references;
    bool truncated = false;
};

constexpr size_t kBrowseMaxReferences = 1000;

BrowseResult browse(const BrowseRequest& request);

}  // namespace mat::opcua
