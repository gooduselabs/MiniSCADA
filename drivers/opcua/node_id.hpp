// The NodeId of an OPC UA Tag in its string form (feature 019, specs/019-driver-opcua/spec.md D4):
// `[ns=<0-65535>;](i=<0-4294967295>|s=<string>|g=<GUID>|b=<base64>)`. No `ns=` means namespace 0;
// `nsu=` is not supported. Pure (no open62541): the project validator uses it. Same rules as
// packages/tag-codec/src/opcua-node-id.ts, shared vectors tests/opcua-vectors/nodeid.json.
#pragma once
#include <cstdint>
#include <string>

namespace mat::opcua {

enum class IdType { Numeric, String, Guid, Opaque };

struct NodeIdRef {
    bool ok = false;
    std::string error;  // E_ADDR_SYNTAX, E_ADDR_RANGE
    uint16_t ns = 0;
    IdType type = IdType::Numeric;
    uint32_t numeric = 0;  // IdType::Numeric
    // Numeric: decimal without leading zeros; Guid: lower case; String, Opaque: as written.
    std::string id;
    std::string normalized;  // ns=0 has no prefix
};

NodeIdRef parseNodeId(const std::string& address);

// "i", "s", "g", "b"
const char* idTypeName(IdType t);

}  // namespace mat::opcua
