#include "drivers/opcua/browse.hpp"

#include <algorithm>
#include <chrono>
#include <cstring>

#include "drivers/opcua/client_cert.hpp"
#include "drivers/opcua/node_id.hpp"
#include "drivers/opcua/status_map.hpp"
#include "drivers/opcua/value_codec.hpp"
#include "open62541.h"

namespace mat::opcua {

namespace {

constexpr const char* kPolicyNone = "http://opcfoundation.org/UA/SecurityPolicy#None";
constexpr const char* kPolicyBasic256Sha256 =
    "http://opcfoundation.org/UA/SecurityPolicy#Basic256Sha256";

struct Pin {
    std::string expected, seen;
    bool rejected = false;
};

UA_StatusCode verifyCert(const UA_CertificateVerification* cv, const UA_ByteString* cert) {
    auto* p = static_cast<Pin*>(cv->context);
    p->seen = sha256Hex(cert->data, cert->length);
    if (!p->expected.empty() && p->seen == p->expected) return UA_STATUSCODE_GOOD;
    p->rejected = true;
    return UA_STATUSCODE_BADCERTIFICATEUNTRUSTED;
}

UA_StatusCode verifyUri(const UA_CertificateVerification*, const UA_ByteString*, const UA_String*) {
    return UA_STATUSCODE_GOOD;
}

std::string str(const UA_String& s) {
    return std::string(reinterpret_cast<const char*>(s.data), s.length);
}

std::string modeName(UA_MessageSecurityMode m) {
    switch (m) {
        case UA_MESSAGESECURITYMODE_NONE:
            return "None";
        case UA_MESSAGESECURITYMODE_SIGN:
            return "Sign";
        case UA_MESSAGESECURITYMODE_SIGNANDENCRYPT:
            return "SignAndEncrypt";
        default:
            return "Invalid";
    }
}

std::string policyName(const UA_String& uri) {
    const std::string u = str(uri);
    const size_t h = u.rfind('#');
    return h == std::string::npos ? u : u.substr(h + 1);
}

std::string tokenName(UA_UserTokenType t) {
    switch (t) {
        case UA_USERTOKENTYPE_ANONYMOUS:
            return "anonymous";
        case UA_USERTOKENTYPE_USERNAME:
            return "username";
        case UA_USERTOKENTYPE_CERTIFICATE:
            return "certificate";
        default:
            return "issued";
    }
}

std::string nodeClassName(UA_NodeClass c) {
    switch (c) {
        case UA_NODECLASS_OBJECT:
            return "Object";
        case UA_NODECLASS_VARIABLE:
            return "Variable";
        case UA_NODECLASS_METHOD:
            return "Method";
        case UA_NODECLASS_OBJECTTYPE:
            return "ObjectType";
        case UA_NODECLASS_VARIABLETYPE:
            return "VariableType";
        case UA_NODECLASS_REFERENCETYPE:
            return "ReferenceType";
        case UA_NODECLASS_DATATYPE:
            return "DataType";
        case UA_NODECLASS_VIEW:
            return "View";
        default:
            return "Unspecified";
    }
}

// The string form of a node id, normalized as the Tag addresses are (node_id.hpp).
std::string nodeIdText(const UA_NodeId& id) {
    UA_String s = UA_STRING_NULL;
    if (UA_NodeId_print(&id, &s) != UA_STATUSCODE_GOOD) return "";
    const std::string t = str(s);
    UA_String_clear(&s);
    const NodeIdRef r = parseNodeId(t);
    return r.ok ? r.normalized : t;
}

UA_NodeId parse(const std::string& s) {
    UA_NodeId id;
    UA_NodeId_init(&id);
    UA_String str2;
    str2.length = s.size();
    str2.data = reinterpret_cast<UA_Byte*>(const_cast<char*>(s.data()));
    if (UA_NodeId_parse(&id, str2) != UA_STATUSCODE_GOOD) UA_NodeId_init(&id);
    return id;
}

void failWith(BrowseResult& r, const char* code, UA_StatusCode st) {
    r.ok = false;
    r.code = code;
    if (st != UA_STATUSCODE_GOOD) r.status = statusName(st);
}

void endpoints(const BrowseRequest& q, BrowseResult& r) {
    UA_ClientConfig cc;
    std::memset(&cc, 0, sizeof cc);
    cc.logging = UA_Log_Stdout_new(static_cast<UA_LogLevel>(opcua::logLevel()));
    UA_ClientConfig_setDefault(&cc);
    cc.timeout = static_cast<UA_UInt32>(q.timeoutMs);
    UA_Client* c = UA_Client_newWithConfig(&cc);
    if (!c) return failWith(r, "REFUSED", UA_STATUSCODE_BADOUTOFMEMORY);
    size_t n = 0;
    UA_EndpointDescription* eps = nullptr;
    const UA_StatusCode st = UA_Client_getEndpoints(c, q.endpointUrl.c_str(), &n, &eps);
    if (st != UA_STATUSCODE_GOOD) {
        failWith(r, connectFailureCode(st), st);
        UA_Client_delete(c);
        return;
    }
    const std::string wantMode = modeName(q.securityMode == drv::OpcUaSecurityMode::None
                                              ? UA_MESSAGESECURITYMODE_NONE
                                              : q.securityMode == drv::OpcUaSecurityMode::Sign
                                                    ? UA_MESSAGESECURITYMODE_SIGN
                                                    : UA_MESSAGESECURITYMODE_SIGNANDENCRYPT);
    const std::string wantPolicy = q.basic256Sha256 ? "Basic256Sha256" : "None";
    const UA_EndpointDescription* certOf = nullptr;
    for (size_t i = 0; i < n; ++i) {
        const UA_EndpointDescription& e = eps[i];
        BrowseEndpoint be;
        be.securityMode = modeName(e.securityMode);
        be.securityPolicy = policyName(e.securityPolicyUri);
        for (size_t k = 0; k < e.userIdentityTokensSize; ++k) {
            const std::string t = tokenName(e.userIdentityTokens[k].tokenType);
            if (std::find(be.userTokens.begin(), be.userTokens.end(), t) == be.userTokens.end())
                be.userTokens.push_back(t);
        }
        const bool match = be.securityMode == wantMode && be.securityPolicy == wantPolicy;
        if (e.serverCertificate.length > 0 && (!certOf || match)) {
            if (!certOf || match) certOf = &e;
        }
        if (r.applicationUri.empty()) r.applicationUri = str(e.server.applicationUri);
        r.endpoints.push_back(std::move(be));
    }
    if (certOf) {
        const CertInfo info =
            certInfo(certOf->serverCertificate.data, certOf->serverCertificate.length);
        r.certSha256 = info.sha256;
        r.certSubject = info.subject;
        r.certNotAfterMs = info.notAfterMs;
        r.applicationUri = str(certOf->server.applicationUri);
    }
    UA_Array_delete(eps, n, &UA_TYPES[UA_TYPES_ENDPOINTDESCRIPTION]);
    UA_Client_delete(c);
    r.ok = true;
    r.code = "OK";
}

void browseNode(const BrowseRequest& q, BrowseResult& r) {
    const bool secure = q.securityMode != drv::OpcUaSecurityMode::None;
    if (q.authUsername && !q.password) return failWith(r, "OPCUA_SECRET_MISSING", 0);
    ClientIdentity id;
    if (secure || q.authUsername) {
        std::string err;
        if (!clientIdentity(q.certDir,
                            q.applicationUri.empty() ? defaultApplicationUri() : q.applicationUri,
                            id, err))
            return failWith(r, "OPCUA_SECURITY_REJECTED", 0);
    }
    Pin pin;
    pin.expected = q.serverCertSha256;
    UA_ClientConfig cc;
    std::memset(&cc, 0, sizeof cc);
    cc.logging = UA_Log_Stdout_new(static_cast<UA_LogLevel>(opcua::logLevel()));
    UA_ClientConfig_setDefault(&cc);
    cc.timeout = static_cast<UA_UInt32>(q.timeoutMs);
    cc.noNewSession = true;  // noReconnect stays false: the channel is reopened secure once
    UA_String_clear(&cc.clientDescription.applicationUri);
    cc.clientDescription.applicationUri = UA_STRING_ALLOC(
        (q.applicationUri.empty() ? defaultApplicationUri() : q.applicationUri).c_str());
    cc.securityMode = q.securityMode == drv::OpcUaSecurityMode::None
                          ? UA_MESSAGESECURITYMODE_NONE
                          : q.securityMode == drv::OpcUaSecurityMode::Sign
                                ? UA_MESSAGESECURITYMODE_SIGN
                                : UA_MESSAGESECURITYMODE_SIGNANDENCRYPT;
    cc.securityPolicyUri = UA_STRING_ALLOC(q.basic256Sha256 ? kPolicyBasic256Sha256 : kPolicyNone);
    if (!id.cert.empty()) {
        UA_ByteString cert = {id.cert.size(), id.cert.data()};
        UA_ByteString key = {id.key.size(), id.key.data()};
        if (UA_ClientConfig_setDefaultEncryption(&cc, cert, key, nullptr, 0, nullptr, 0) !=
            UA_STATUSCODE_GOOD) {
            UA_ClientConfig_clear(&cc);
            return failWith(r, "OPCUA_SECURITY_REJECTED", 0);
        }
        if (cc.certificateVerification.clear)
            cc.certificateVerification.clear(&cc.certificateVerification);
        std::memset(&cc.certificateVerification, 0, sizeof cc.certificateVerification);
        cc.certificateVerification.context = &pin;
        cc.certificateVerification.verifyCertificate = &verifyCert;
        cc.certificateVerification.verifyApplicationURI = &verifyUri;
        cc.certificateVerification.logging = cc.logging;
    }
    UA_Client* c = UA_Client_newWithConfig(&cc);
    if (!c) return failWith(r, "REFUSED", UA_STATUSCODE_BADOUTOFMEMORY);
    if (q.authUsername)
        UA_ClientConfig_setAuthenticationUsername(UA_Client_getConfig(c), q.username.c_str(),
                                                  q.password->c_str());
    UA_StatusCode st = UA_Client_connect(c, q.endpointUrl.c_str());
    if (st != UA_STATUSCODE_GOOD) {
        if (pin.rejected) {
            failWith(r, "OPCUA_CERT_UNTRUSTED", st);
            r.certSha256 = pin.seen;
        } else {
            failWith(r, connectFailureCode(st), st);
        }
        UA_Client_delete(c);
        return;
    }
    r.certSha256 = pin.seen;

    UA_BrowseDescription bd;
    UA_BrowseDescription_init(&bd);
    bd.nodeId = parse(q.nodeId);
    bd.browseDirection = UA_BROWSEDIRECTION_FORWARD;
    bd.referenceTypeId = UA_NODEID_NUMERIC(0, UA_NS0ID_HIERARCHICALREFERENCES);
    bd.includeSubtypes = true;
    bd.resultMask = UA_BROWSERESULTMASK_ALL;
    UA_BrowseRequest br;
    UA_BrowseRequest_init(&br);
    br.nodesToBrowse = &bd;
    br.nodesToBrowseSize = 1;
    br.requestedMaxReferencesPerNode = static_cast<UA_UInt32>(kBrowseMaxReferences);
    UA_BrowseResponse bresp = UA_Client_Service_browse(c, br);
    UA_NodeId_clear(&bd.nodeId);
    st = bresp.responseHeader.serviceResult;
    if (st == UA_STATUSCODE_GOOD && bresp.resultsSize == 1) st = bresp.results[0].statusCode;
    if (st != UA_STATUSCODE_GOOD) {
        failWith(r, "OPCUA_BROWSE_FAILED", st);
        UA_BrowseResponse_clear(&bresp);
        UA_Client_disconnect(c);
        UA_Client_delete(c);
        return;
    }
    const UA_BrowseResult& res = bresp.results[0];
    r.truncated = res.continuationPoint.length > 0;
    std::vector<UA_NodeId> variables;
    std::vector<size_t> varIndex;
    for (size_t i = 0; i < res.referencesSize && r.references.size() < kBrowseMaxReferences; ++i) {
        const UA_ReferenceDescription& ref = res.references[i];
        if (ref.nodeId.serverIndex != 0) continue;  // another server
        BrowseRef b;
        b.nodeId = nodeIdText(ref.nodeId.nodeId);
        b.browseName =
            std::to_string(ref.browseName.namespaceIndex) + ":" + str(ref.browseName.name);
        b.displayName = str(ref.displayName.text);
        b.nodeClass = nodeClassName(ref.nodeClass);
        b.hasChildren = ref.nodeClass == UA_NODECLASS_OBJECT || ref.nodeClass == UA_NODECLASS_VIEW;
        if (ref.nodeClass == UA_NODECLASS_VARIABLE) {
            variables.push_back(ref.nodeId.nodeId);  // shallow, read below while bresp lives
            varIndex.push_back(r.references.size());
        }
        r.references.push_back(std::move(b));
    }
    if (r.references.size() >= kBrowseMaxReferences && res.referencesSize > kBrowseMaxReferences)
        r.truncated = true;
    // DataType and UserAccessLevel of the variables, one Read
    if (!variables.empty()) {
        std::vector<UA_ReadValueId> rv(variables.size() * 2);
        for (size_t k = 0; k < variables.size(); ++k) {
            UA_ReadValueId_init(&rv[2 * k]);
            rv[2 * k].nodeId = variables[k];
            rv[2 * k].attributeId = UA_ATTRIBUTEID_DATATYPE;
            UA_ReadValueId_init(&rv[2 * k + 1]);
            rv[2 * k + 1].nodeId = variables[k];
            rv[2 * k + 1].attributeId = UA_ATTRIBUTEID_USERACCESSLEVEL;
        }
        UA_ReadRequest rr;
        UA_ReadRequest_init(&rr);
        rr.nodesToRead = rv.data();
        rr.nodesToReadSize = rv.size();
        UA_ReadResponse rresp = UA_Client_Service_read(c, rr);
        if (rresp.responseHeader.serviceResult == UA_STATUSCODE_GOOD &&
            rresp.resultsSize == rv.size()) {
            for (size_t k = 0; k < variables.size(); ++k) {
                BrowseRef& b = r.references[varIndex[k]];
                const UA_DataValue& dt = rresp.results[2 * k];
                if (dt.hasValue &&
                    UA_Variant_hasScalarType(&dt.value, &UA_TYPES[UA_TYPES_NODEID])) {
                    const auto* t = static_cast<const UA_NodeId*>(dt.value.data);
                    b.dataType = dataTypeName(*t);
                    if (const char* tt = suggestedTagType(*t)) b.tagType = tt;
                }
                const UA_DataValue& al = rresp.results[2 * k + 1];
                if (al.hasValue && UA_Variant_hasScalarType(&al.value, &UA_TYPES[UA_TYPES_BYTE]))
                    b.writable = (*static_cast<const UA_Byte*>(al.value.data) &
                                  UA_ACCESSLEVELMASK_WRITE) != 0;
            }
        }
        UA_ReadResponse_clear(&rresp);
    }
    UA_BrowseResponse_clear(&bresp);
    UA_Client_disconnect(c);
    UA_Client_delete(c);
    r.ok = true;
    r.code = "OK";
}

}  // namespace

BrowseResult browse(const BrowseRequest& q) {
    BrowseResult r;
    const auto t0 = std::chrono::steady_clock::now();
    if (q.action == "endpoints")
        endpoints(q, r);
    else
        browseNode(q, r);
    r.elapsedMs =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    return r;
}

}  // namespace mat::opcua
