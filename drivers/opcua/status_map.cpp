#include "drivers/opcua/status_map.hpp"

#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "open62541.h"

namespace mat::opcua {

StatusQuality qualityOf(uint32_t status) {
    // severity: the two top bits (Part 4, 7.34): 00 Good, 01 Uncertain, 10/11 Bad
    const uint32_t severity = status >> 30;
    if (severity == 0) return {Quality::GOOD, ""};
    if (severity == 1) return {Quality::UNCERTAIN, "OPCUA_UNCERTAIN"};
    const uint32_t code = status & 0xFFFF0000u;  // without the info bits
    switch (code) {
        case UA_STATUSCODE_BADNODEIDUNKNOWN:
        case UA_STATUSCODE_BADNODEIDINVALID:
        case UA_STATUSCODE_BADATTRIBUTEIDINVALID:
            return {Quality::BAD, "OPCUA_NODE_UNKNOWN"};
        case UA_STATUSCODE_BADNOTREADABLE:
        case UA_STATUSCODE_BADUSERACCESSDENIED:
        case UA_STATUSCODE_BADSECURITYMODEINSUFFICIENT:
            return {Quality::BAD, "OPCUA_ACCESS_DENIED"};
        case UA_STATUSCODE_BADTYPEMISMATCH:
        case UA_STATUSCODE_BADDATAENCODINGUNSUPPORTED:
            return {Quality::BAD, "OPCUA_TYPE_MISMATCH"};
        default:
            return {Quality::BAD, "OPCUA_BAD_STATUS"};
    }
}

const char* connectFailureCode(uint32_t status) {
    switch (status & 0xFFFF0000u) {
        case UA_STATUSCODE_BADIDENTITYTOKENINVALID:
        case UA_STATUSCODE_BADIDENTITYTOKENREJECTED:
        case UA_STATUSCODE_BADUSERACCESSDENIED:
        case UA_STATUSCODE_BADUSERSIGNATUREINVALID:
            return "OPCUA_AUTH_FAILED";
        case UA_STATUSCODE_BADSECURITYCHECKSFAILED:
        case UA_STATUSCODE_BADCERTIFICATEINVALID:
        case UA_STATUSCODE_BADCERTIFICATEUNTRUSTED:
        case UA_STATUSCODE_BADCERTIFICATETIMEINVALID:
        case UA_STATUSCODE_BADCERTIFICATEURIINVALID:
        case UA_STATUSCODE_BADCERTIFICATEUSENOTALLOWED:
        case UA_STATUSCODE_BADCERTIFICATEREVOKED:
        case UA_STATUSCODE_BADCERTIFICATEISSUERREVOKED:
        case UA_STATUSCODE_BADCERTIFICATEREVOCATIONUNKNOWN:
        case UA_STATUSCODE_BADSECURITYPOLICYREJECTED:
        case UA_STATUSCODE_BADSECURITYMODEREJECTED:
        case UA_STATUSCODE_BADNONCEINVALID:
        case UA_STATUSCODE_BADAPPLICATIONSIGNATUREINVALID:
            return "OPCUA_SECURITY_REJECTED";
        case UA_STATUSCODE_BADTIMEOUT:
            return "TIMEOUT";
        default:
            return "REFUSED";
    }
}

int logLevel() {
    const char* v = std::getenv("MAT_OPCUA_LOG");
    return v && *v && *v != '0' ? UA_LOGLEVEL_WARNING : UA_LOGLEVEL_ERROR;
}

std::string statusName(uint32_t status) {
    const char* n = UA_StatusCode_name(status);
    if (n && std::strncmp(n, "Unknown", 7) != 0) return n;
    char b[16];
    std::snprintf(b, sizeof b, "0x%08X", status);
    return b;
}

}  // namespace mat::opcua
