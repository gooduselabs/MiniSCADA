// OPC UA StatusCodes in mAT terms (feature 019, specs/019-driver-opcua/spec.md D6,
// contracts/opcua.md): the quality and reason of a Tag for the status of a value, and the error
// code of a connection that could not be made.
#pragma once
#include <cstdint>
#include <string>

#include "core/tag-engine/tag_store.hpp"

namespace mat::opcua {

struct StatusQuality {
    Quality quality = Quality::GOOD;
    const char* reason = "";  // "" with GOOD
};

// Good -> GOOD; Uncertain -> UNCERTAIN OPCUA_UNCERTAIN; Bad -> BAD with OPCUA_NODE_UNKNOWN,
// OPCUA_ACCESS_DENIED, OPCUA_TYPE_MISMATCH or OPCUA_BAD_STATUS.
StatusQuality qualityOf(uint32_t status);

// The diagnostics code of a failed connect (session activated or not): OPCUA_AUTH_FAILED,
// OPCUA_SECURITY_REJECTED, OPCUA_ENDPOINT_NOT_FOUND, TIMEOUT or REFUSED.
const char* connectFailureCode(uint32_t status);

// The level of the open62541 log (stdout): errors only; warnings too when the environment has
// MAT_OPCUA_LOG=1 (field diagnosis of a connection).
int logLevel();

// The upstream name ("BadNodeIdUnknown"); "0x80AB0000" when it has none.
std::string statusName(uint32_t status);

}  // namespace mat::opcua
