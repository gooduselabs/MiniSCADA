// Endpoints and Browse for the engineer (feature 019, contracts/opcua.md §4) against the test
// server in process.
#include <gtest/gtest.h>

#include <algorithm>

#include "drivers/opcua/browse.hpp"
#include "drivers/opcua/tests/opcua_test_util.hpp"

using namespace mat;
using namespace mat::opcua;
using opcuasim::SimOptions;
using opcuasim::SimServer;

namespace {

BrowseRequest request(uint16_t port, const std::string& action) {
    BrowseRequest q;
    q.action = action;
    q.endpointUrl = "opc.tcp://127.0.0.1:" + std::to_string(port);
    q.certDir = opcuatest::certDir("client");
    q.applicationUri = "urn:atpro:mat-scada:test";
    return q;
}

const BrowseRef* find(const BrowseResult& r, const std::string& nodeId) {
    for (const auto& b : r.references)
        if (b.nodeId == nodeId) return &b;
    return nullptr;
}

}  // namespace

TEST(OpcUaBrowse, EndpointsOfASecureServerNeedNoTrust) {
    SimOptions o;
    o.port = SimServer::freePort();
    o.secure = true;
    o.certDir = opcuatest::certDir("server");
    SimServer server(o);
    ASSERT_TRUE(server.start()) << server.error();
    BrowseRequest q = request(o.port, "endpoints");
    q.securityMode = drv::OpcUaSecurityMode::SignAndEncrypt;
    q.basic256Sha256 = true;
    const BrowseResult r = browse(q);
    ASSERT_TRUE(r.ok) << r.code << " " << r.status;
    EXPECT_EQ(r.certSha256, server.certSha256());
    EXPECT_NE(r.certSubject.find("mat-opcua-sim"), std::string::npos) << r.certSubject;
    EXPECT_GT(r.certNotAfterMs, 0);
    EXPECT_EQ(r.applicationUri, "urn:mat:opcua-sim:server");
    const bool has =
        std::any_of(r.endpoints.begin(), r.endpoints.end(), [](const BrowseEndpoint& e) {
            return e.securityMode == "SignAndEncrypt" && e.securityPolicy == "Basic256Sha256";
        });
    EXPECT_TRUE(has);
    const bool none =
        std::any_of(r.endpoints.begin(), r.endpoints.end(), [](const BrowseEndpoint& e) {
            return e.securityMode == "None" && e.securityPolicy == "None";
        });
    EXPECT_TRUE(none);
}

TEST(OpcUaBrowse, ChildrenOfObjectsAndOfAFolder) {
    SimOptions o;
    o.port = SimServer::freePort();
    o.benchNodes = 3;
    SimServer server(o);
    ASSERT_TRUE(server.start()) << server.error();
    BrowseResult r = browse(request(o.port, "browse"));
    ASSERT_TRUE(r.ok) << r.code << " " << r.status;
    const BrowseRef* sim = find(r, "ns=2;s=Sim");
    ASSERT_NE(sim, nullptr);
    EXPECT_EQ(sim->nodeClass, "Object");
    EXPECT_TRUE(sim->hasChildren);
    EXPECT_NE(find(r, "i=2253"), nullptr);  // Server
    BrowseRequest q = request(o.port, "browse");
    q.nodeId = "ns=2;s=Sim";
    r = browse(q);
    ASSERT_TRUE(r.ok) << r.code << " " << r.status;
    const BrowseRef* dbl = find(r, "ns=2;s=Double");
    ASSERT_NE(dbl, nullptr);
    EXPECT_EQ(dbl->nodeClass, "Variable");
    EXPECT_EQ(dbl->dataType, "Double");
    EXPECT_EQ(dbl->tagType, "FLOAT64");
    EXPECT_EQ(dbl->browseName, "2:Double");
    EXPECT_EQ(dbl->writable, std::optional<bool>(true));
    EXPECT_FALSE(dbl->hasChildren);
    const BrowseRef* ro = find(r, "ns=2;s=ReadOnly");
    ASSERT_NE(ro, nullptr);
    EXPECT_EQ(ro->writable, std::optional<bool>(false));
    EXPECT_EQ(find(r, "ns=2;s=Byte")->tagType, "UINT16");
    EXPECT_EQ(find(r, "ns=2;s=Array")->tagType, "INT32");
    EXPECT_NE(find(r, "ns=2;s=Sim.Numeric"), nullptr);
    EXPECT_FALSE(r.truncated);
}

TEST(OpcUaBrowse, SecureBrowseNeedsThePinAndTheSecret) {
    SimOptions o;
    o.port = SimServer::freePort();
    o.secure = true;
    o.certDir = opcuatest::certDir("server");
    o.users = {{"operator", "secret123"}};
    o.allowAnonymous = false;
    SimServer server(o);
    ASSERT_TRUE(server.start()) << server.error();
    BrowseRequest q = request(o.port, "browse");
    q.securityMode = drv::OpcUaSecurityMode::SignAndEncrypt;
    q.basic256Sha256 = true;
    q.authUsername = true;
    q.username = "operator";
    // no secret on the device
    BrowseResult r = browse(q);
    EXPECT_FALSE(r.ok);
    EXPECT_EQ(r.code, "OPCUA_SECRET_MISSING");
    // not pinned: the certificate seen comes back for the engineer to confirm
    q.password = "secret123";
    r = browse(q);
    EXPECT_FALSE(r.ok);
    EXPECT_EQ(r.code, "OPCUA_CERT_UNTRUSTED");
    EXPECT_EQ(r.certSha256, server.certSha256());
    // pinned
    q.serverCertSha256 = server.certSha256();
    r = browse(q);
    ASSERT_TRUE(r.ok) << r.code << " " << r.status;
    EXPECT_NE(find(r, "ns=2;s=Sim"), nullptr);
    // a wrong password
    q.password = "nope";
    r = browse(q);
    EXPECT_FALSE(r.ok);
    EXPECT_EQ(r.code, "OPCUA_AUTH_FAILED") << r.status;
}

TEST(OpcUaBrowse, NoServer) {
    const BrowseResult r = browse(request(SimServer::freePort(), "endpoints"));
    EXPECT_FALSE(r.ok);
    EXPECT_EQ(r.code, "REFUSED") << r.status;
    BrowseRequest q = request(SimServer::freePort(), "browse");
    q.nodeId = "ns=2;s=Nope";
    EXPECT_EQ(browse(q).code, "REFUSED");
}
