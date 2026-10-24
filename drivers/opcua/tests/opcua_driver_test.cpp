// The OPC UA driver against the open62541 test server in the same process (feature 019,
// specs/019-driver-opcua/spec.md US1-US4, contracts/opcua.md). Real sockets on localhost, real
// time: each wait has a deadline of seconds.
#include "drivers/opcua/opcua_driver.hpp"

#include <gtest/gtest.h>

#include "drivers/opcua/tests/opcua_test_util.hpp"

using namespace mat;
using namespace mat::opcuatest;
using drv::OpcUaDriver;
using drv::ScanGroup;
using opcuasim::SimOptions;
using opcuasim::SimServer;

namespace {

SimOptions plain(uint16_t port) {
    SimOptions o;
    o.port = port;
    o.changeMs = 100;
    return o;
}

SimOptions secure(uint16_t port) {
    SimOptions o = plain(port);
    o.secure = true;
    o.certDir = certDir("server");
    o.users = {{"operator", "secret123"}};
    o.allowAnonymous = false;
    return o;
}

drv::WriteCommand writeOf(uint64_t id, size_t tag, TagScalar raw) {
    drv::WriteCommand c;
    c.id = id;
    c.tag = tag;
    c.raw = std::move(raw);
    return c;
}

}  // namespace

TEST(OpcUaDriver, ReadsEveryTypeThroughASubscription) {
    const uint16_t port = SimServer::freePort();
    SimServer server(plain(port));
    ASSERT_TRUE(server.start()) << server.error();
    drv::OpcUaConfig c = config(port);
    c.tags = {
        tag(0, "ns=2;s=Boolean", TagType::BOOL),    tag(1, "ns=2;s=SByte", TagType::INT16),
        tag(2, "ns=2;s=Byte", TagType::UINT16),     tag(3, "ns=2;s=Int16", TagType::INT16),
        tag(4, "ns=2;s=UInt16", TagType::UINT16),   tag(5, "ns=2;s=Int32", TagType::INT32),
        tag(6, "ns=2;s=UInt32", TagType::UINT32),   tag(7, "ns=2;s=Int64", TagType::INT64),
        tag(8, "ns=2;s=UInt64", TagType::UINT64),   tag(9, "ns=2;s=Float", TagType::FLOAT32),
        tag(10, "ns=2;s=Double", TagType::FLOAT64), tag(11, "ns=2;s=String", TagType::STRING),
        tag(12, "ns=2;s=DateTime", TagType::INT64), tag(13, "ns=2;s=DateTime", TagType::STRING),
        tag(14, "ns=2;i=1004", TagType::INT16),     tag(15, "i=2258", TagType::INT64)};
    RecordingSink sink;
    OpcUaDriver d(c, env());
    d.start(sink);
    ASSERT_TRUE(sink.waitFor([&] {
        for (size_t i = 0; i < 16; ++i)
            if (!sink.goodNoLock(i)) return false;
        return true;
    })) << detail(d, "lastStatus");
    EXPECT_EQ(std::get<bool>(sink.last(0).value), true);
    EXPECT_EQ(std::get<int64_t>(sink.last(1).value), -5);
    EXPECT_EQ(std::get<uint64_t>(sink.last(2).value), 200u);
    EXPECT_EQ(std::get<int64_t>(sink.last(3).value), -1234);
    EXPECT_EQ(std::get<uint64_t>(sink.last(4).value), 54321u);
    EXPECT_EQ(std::get<int64_t>(sink.last(5).value), -123456);
    EXPECT_EQ(std::get<uint64_t>(sink.last(6).value), 3000000000u);
    EXPECT_EQ(std::get<int64_t>(sink.last(7).value), -9000000000LL);
    EXPECT_EQ(std::get<uint64_t>(sink.last(8).value), 18000000000000000000ULL);
    EXPECT_DOUBLE_EQ(std::get<double>(sink.last(9).value), 3.5);
    EXPECT_DOUBLE_EQ(std::get<double>(sink.last(10).value), 2.718281828);
    EXPECT_EQ(std::get<std::string>(sink.last(11).value), "Xin chào");
    EXPECT_EQ(std::get<int64_t>(sink.last(12).value), 1792810800000LL);  // 2026-10-24T03:00Z
    EXPECT_EQ(std::get<std::string>(sink.last(13).value), "2026-10-24T03:00:00.000Z");
    EXPECT_EQ(std::get<int64_t>(sink.last(14).value), -1234);
    EXPECT_GT(std::get<int64_t>(sink.last(15).value), 1792810800000LL);  // Server/CurrentTime
    EXPECT_EQ(detail(d, "readMode"), "subscription");
    EXPECT_EQ(detail(d, "session"), "active");
    EXPECT_EQ(detail(d, "securityPolicy"), "None");
    EXPECT_EQ(detail(d, "publishingMs"), "100/200/400");
    EXPECT_EQ(d.linkState(0).channel, drv::ChannelState::Connected);
    d.stop();
}

TEST(OpcUaDriver, ChangesArriveAndBadNodesStayAlone) {
    const uint16_t port = SimServer::freePort();
    SimServer server(plain(port));
    ASSERT_TRUE(server.start()) << server.error();
    drv::OpcUaConfig c = config(port);
    c.tags = {tag(0, "ns=2;s=Int16", TagType::INT16, ScanGroup::Fast),
              tag(1, "ns=2;s=Nope", TagType::FLOAT64), tag(2, "ns=2;s=Array", TagType::INT32),
              tag(3, "ns=2;s=Int32", TagType::INT16),  // -123456 does not fit INT16
              tag(4, "ns=2;s=Counter", TagType::UINT32, ScanGroup::Fast)};
    RecordingSink sink;
    OpcUaDriver d(c, env());
    d.start(sink);
    ASSERT_TRUE(sink.waitFor([&] {
        return sink.goodNoLock(0) && sink.reasonNoLock(1, "OPCUA_NODE_UNKNOWN") &&
               sink.reasonNoLock(2, "OPCUA_TYPE_MISMATCH") &&
               sink.reasonNoLock(3, "OPCUA_TYPE_MISMATCH") && sink.goodNoLock(4);
    }));
    ASSERT_TRUE(server.set("ns=2;s=Int16", "77"));
    ASSERT_TRUE(sink.waitFor([&] {
        const drv::TagUpdate* u = sink.lastNoLock(0);
        return u && u->quality == Quality::GOOD && std::get<int64_t>(u->value) == 77;
    }));
    // the counter moves by itself every 100 ms
    const uint64_t first = std::get<uint64_t>(sink.last(4).value);
    ASSERT_TRUE(sink.waitFor([&] {
        const drv::TagUpdate* u = sink.lastNoLock(4);
        return u && u->quality == Quality::GOOD && std::get<uint64_t>(u->value) > first + 2;
    }));
    d.stop();
}

TEST(OpcUaDriver, PollModeReadsWithReadRequests) {
    const uint16_t port = SimServer::freePort();
    SimServer server(plain(port));
    ASSERT_TRUE(server.start()) << server.error();
    drv::OpcUaConfig c = config(port);
    c.poll = true;
    c.tags = {tag(0, "ns=2;s=Double", TagType::FLOAT64), tag(1, "ns=2;s=Nope", TagType::INT16),
              tag(2, "ns=2;s=Counter", TagType::UINT32, ScanGroup::Fast)};
    RecordingSink sink;
    drv::OpcUaEnv e = env();
    e.batch = 2;  // two Read requests per round for the normal group
    OpcUaDriver d(c, e);
    d.start(sink);
    ASSERT_TRUE(sink.waitFor([&] {
        return sink.goodNoLock(0) && sink.reasonNoLock(1, "OPCUA_NODE_UNKNOWN") &&
               sink.goodNoLock(2);
    }));
    ASSERT_TRUE(server.set("ns=2;s=Double", "-8.5"));
    ASSERT_TRUE(sink.waitFor([&] {
        const drv::TagUpdate* u = sink.lastNoLock(0);
        return u && std::get<double>(u->value) == -8.5;
    }));
    EXPECT_EQ(detail(d, "readMode"), "poll");
    d.stop();
}

TEST(OpcUaDriver, AGroupTheServerRefusesASubscriptionIsPolled) {
    const uint16_t port = SimServer::freePort();
    SimOptions o = plain(port);
    o.maxSubscriptions = 1;  // the normal group gets it, the slow group does not
    SimServer server(o);
    ASSERT_TRUE(server.start()) << server.error();
    drv::OpcUaConfig c = config(port);
    c.tags = {tag(0, "ns=2;s=Double", TagType::FLOAT64, ScanGroup::Normal),
              tag(1, "ns=2;s=UInt16", TagType::UINT16, ScanGroup::Slow)};
    RecordingSink sink;
    OpcUaDriver d(c, env());
    d.start(sink);
    ASSERT_TRUE(sink.waitFor([&] { return sink.goodNoLock(0) && sink.goodNoLock(1); }));
    ASSERT_TRUE(server.set("ns=2;s=UInt16", "9"));
    ASSERT_TRUE(sink.waitFor([&] {
        const drv::TagUpdate* u = sink.lastNoLock(1);
        return u && std::get<uint64_t>(u->value) == 9u;
    }));
    EXPECT_TRUE(hasWarning(d, "OPCUA_SUBSCRIPTION_FALLBACK"));
    EXPECT_EQ(detail(d, "readMode"), "subscription+poll");
    d.stop();
}

TEST(OpcUaDriver, WritesAreConfirmedByReadback) {
    const uint16_t port = SimServer::freePort();
    SimServer server(plain(port));
    ASSERT_TRUE(server.start()) << server.error();
    drv::OpcUaConfig c = config(port);
    c.tags = {tag(0, "ns=2;s=Int16", TagType::INT16),     tag(1, "ns=2;s=Double", TagType::FLOAT64),
              tag(2, "ns=2;s=String", TagType::STRING),   tag(3, "ns=2;s=Boolean", TagType::BOOL),
              tag(4, "ns=2;s=DateTime", TagType::STRING), tag(5, "ns=2;s=Float", TagType::FLOAT32),
              tag(6, "ns=2;s=UInt64", TagType::UINT64),   tag(7, "ns=2;s=Byte", TagType::UINT16)};
    RecordingSink sink;
    OpcUaDriver d(c, env());
    d.start(sink);
    ASSERT_TRUE(sink.waitFor([&] {
        for (size_t i = 0; i < 8; ++i)
            if (!sink.goodNoLock(i)) return false;
        return true;
    }));
    ASSERT_TRUE(d.enqueueWrite(writeOf(1, 0, int64_t{99})));
    ASSERT_TRUE(d.enqueueWrite(writeOf(2, 1, 1.25)));
    ASSERT_TRUE(d.enqueueWrite(writeOf(3, 2, std::string("abc"))));
    ASSERT_TRUE(d.enqueueWrite(writeOf(4, 3, false)));
    ASSERT_TRUE(d.enqueueWrite(writeOf(5, 4, std::string("2027-01-02T03:04:05.006Z"))));
    ASSERT_TRUE(d.enqueueWrite(writeOf(6, 5, 0.1)));
    ASSERT_TRUE(d.enqueueWrite(writeOf(7, 6, uint64_t{12345678901234ULL})));
    ASSERT_TRUE(d.enqueueWrite(writeOf(8, 7, uint64_t{7})));
    ASSERT_TRUE(sink.waitFor([&] {
        for (uint64_t id = 1; id <= 8; ++id)
            if (!sink.writeNoLock(id)) return false;
        return true;
    }));
    for (uint64_t id = 1; id <= 8; ++id) EXPECT_EQ(sink.write(id).code, "CONFIRMED") << id;
    EXPECT_EQ(server.get("ns=2;s=Int16"), "99");
    EXPECT_EQ(server.get("ns=2;s=Double"), "1.25");
    EXPECT_EQ(server.get("ns=2;s=String"), "abc");
    EXPECT_EQ(server.get("ns=2;s=Boolean"), "false");
    EXPECT_EQ(server.get("ns=2;s=DateTime"), "2027-01-02T03:04:05.006Z");
    EXPECT_EQ(server.get("ns=2;s=UInt64"), "12345678901234");
    EXPECT_EQ(server.get("ns=2;s=Byte"), "7");
    EXPECT_EQ(std::get<int64_t>(sink.write(1).readback), 99);
    // the readback is published at once, whatever the deadband
    EXPECT_TRUE(sink.last(0).afterWrite || std::get<int64_t>(sink.last(0).value) == 99);
    d.stop();
}

TEST(OpcUaDriver, RefusedAndUnfitWrites) {
    const uint16_t port = SimServer::freePort();
    SimServer server(plain(port));
    ASSERT_TRUE(server.start()) << server.error();
    drv::OpcUaConfig c = config(port);
    c.tags = {tag(0, "ns=2;s=ReadOnly", TagType::FLOAT64), tag(1, "ns=2;s=Int16", TagType::INT32),
              tag(2, "ns=2;s=Double", TagType::FLOAT64)};
    c.tags[2].readback = false;
    RecordingSink sink;
    OpcUaDriver d(c, env());
    d.start(sink);
    ASSERT_TRUE(sink.waitFor([&] { return sink.goodNoLock(0) && sink.goodNoLock(1); }));
    ASSERT_TRUE(d.enqueueWrite(writeOf(1, 0, 5.0)));
    ASSERT_TRUE(d.enqueueWrite(writeOf(2, 1, int64_t{70000})));  // the node is Int16
    ASSERT_TRUE(d.enqueueWrite(writeOf(3, 2, 6.5)));
    ASSERT_TRUE(sink.waitFor(
        [&] { return sink.writeNoLock(1) && sink.writeNoLock(2) && sink.writeNoLock(3); }));
    EXPECT_EQ(sink.write(1).code, "DEVICE_EXCEPTION");
    EXPECT_EQ(sink.write(2).code, "NOT_SENT_UNSUPPORTED");
    EXPECT_EQ(sink.write(3).code, "NO_READBACK");
    EXPECT_EQ(detail(d, "lastStatus").rfind("Bad", 0), 0u) << detail(d, "lastStatus");
    EXPECT_EQ(server.get("ns=2;s=ReadOnly"), "42.5");
    EXPECT_EQ(server.get("ns=2;s=Double"), "6.5");
    d.stop();
}

TEST(OpcUaDriver, ReconnectsAndSubscribesAgainAfterTheServerComesBack) {
    const uint16_t port = SimServer::freePort();
    SimServer server(plain(port));
    ASSERT_TRUE(server.start()) << server.error();
    drv::OpcUaConfig c = config(port);
    c.tags = {tag(0, "ns=2;s=Int32", TagType::INT32, ScanGroup::Fast)};
    RecordingSink sink;
    OpcUaDriver d(c, env());
    d.start(sink);
    ASSERT_TRUE(sink.waitFor([&] { return sink.goodNoLock(0); }));
    server.stop();
    ASSERT_TRUE(sink.waitFor([&] { return sink.reasonNoLock(0, "DISCONNECTED"); }, 15000));
    EXPECT_EQ(d.linkState(0).channel, drv::ChannelState::Error);
    // writes while it is down are answered at once
    ASSERT_TRUE(d.enqueueWrite(writeOf(1, 0, int64_t{1})));
    ASSERT_TRUE(sink.waitFor([&] { return sink.writeNoLock(1) != nullptr; }));
    EXPECT_EQ(sink.write(1).code, "NOT_SENT_DISCONNECTED");
    ASSERT_TRUE(server.start()) << server.error();
    ASSERT_TRUE(server.set("ns=2;s=Int32", "4242"));
    ASSERT_TRUE(sink.waitFor(
        [&] {
            const drv::TagUpdate* u = sink.lastNoLock(0);
            return u && u->quality == Quality::GOOD && std::get<int64_t>(u->value) == 4242;
        },
        20000));
    drv::DriverDiag diag;
    d.diagnostics(diag, 0);
    EXPECT_GE(diag.channel.reconnects, 1u);
    d.stop();
}

TEST(OpcUaDriver, NoServerIsRefusedAndDisconnected) {
    const uint16_t port = SimServer::freePort();
    drv::OpcUaConfig c = config(port);
    c.tags = {tag(0, "ns=2;s=Int32", TagType::INT32)};
    RecordingSink sink;
    OpcUaDriver d(c, env());
    d.start(sink);
    ASSERT_TRUE(sink.waitFor([&] { return sink.reasonNoLock(0, "DISCONNECTED"); }));
    drv::DriverDiag diag;
    d.diagnostics(diag, 0);
    EXPECT_EQ(diag.channel.lastErrorCode, "REFUSED");
    d.stop();
}

TEST(OpcUaDriver, SignAndEncryptWithThePinnedCertificateAndAUser) {
    const uint16_t port = SimServer::freePort();
    SimServer server(secure(port));
    ASSERT_TRUE(server.start()) << server.error();
    for (auto mode : {drv::OpcUaSecurityMode::SignAndEncrypt, drv::OpcUaSecurityMode::Sign}) {
        drv::OpcUaConfig c = config(port);
        c.securityMode = mode;
        c.basic256Sha256 = true;
        c.serverCertSha256 = server.certSha256();
        c.authUsername = true;
        c.username = "operator";
        c.secretId = "opcua-ua-1";
        c.tags = {tag(0, "ns=2;s=Double", TagType::FLOAT64)};
        drv::OpcUaEnv e = env();
        e.password = [](const std::string& id) -> std::optional<std::string> {
            if (id == "opcua-ua-1") return std::string("secret123");
            return std::nullopt;
        };
        RecordingSink sink;
        OpcUaDriver d(c, e);
        d.start(sink);
        ASSERT_TRUE(sink.waitFor([&] { return sink.goodNoLock(0); }, 20000))
            << detail(d, "lastStatus");
        EXPECT_EQ(detail(d, "securityPolicy"), "Basic256Sha256");
        EXPECT_EQ(detail(d, "serverCertSha256"), server.certSha256());
        EXPECT_EQ(detail(d, "clientCertSha256").size(), 64u);
        ASSERT_TRUE(d.enqueueWrite(writeOf(1, 0, 3.25)));
        ASSERT_TRUE(sink.waitFor([&] { return sink.writeNoLock(1) != nullptr; }));
        EXPECT_EQ(sink.write(1).code, "CONFIRMED");
        d.stop();
    }
}

TEST(OpcUaDriver, AnUnpinnedOrOtherServerCertificateIsNotTrusted) {
    const uint16_t port = SimServer::freePort();
    SimServer server(secure(port));
    ASSERT_TRUE(server.start()) << server.error();
    for (const std::string pin : {std::string(), std::string(64, 'a')}) {
        drv::OpcUaConfig c = config(port);
        c.securityMode = drv::OpcUaSecurityMode::SignAndEncrypt;
        c.basic256Sha256 = true;
        c.serverCertSha256 = pin;
        c.authUsername = true;
        c.username = "operator";
        c.secretId = "x";
        c.tags = {tag(0, "ns=2;s=Double", TagType::FLOAT64)};
        drv::OpcUaEnv e = env();
        e.password = [](const std::string&) { return std::optional<std::string>("secret123"); };
        RecordingSink sink;
        OpcUaDriver d(c, e);
        d.start(sink);
        ASSERT_TRUE(
            sink.waitFor([&] { return sink.reasonNoLock(0, "OPCUA_CERT_UNTRUSTED"); }, 20000))
            << detail(d, "lastStatus");
        // the certificate seen is there for the engineer to confirm (TOFU, spec D10)
        EXPECT_EQ(detail(d, "serverCertSha256"), server.certSha256());
        d.stop();
    }
}

TEST(OpcUaDriver, AWrongPasswordOrNoSecret) {
    const uint16_t port = SimServer::freePort();
    SimServer server(secure(port));
    ASSERT_TRUE(server.start()) << server.error();
    drv::OpcUaConfig c = config(port);
    c.securityMode = drv::OpcUaSecurityMode::SignAndEncrypt;
    c.basic256Sha256 = true;
    c.serverCertSha256 = server.certSha256();
    c.authUsername = true;
    c.username = "operator";
    c.secretId = "opcua-ua-1";
    c.tags = {tag(0, "ns=2;s=Double", TagType::FLOAT64)};
    {
        drv::OpcUaEnv e = env();
        e.password = [](const std::string&) { return std::optional<std::string>("wrong"); };
        RecordingSink sink;
        OpcUaDriver d(c, e);
        d.start(sink);
        ASSERT_TRUE(sink.waitFor([&] { return sink.reasonNoLock(0, "OPCUA_AUTH_FAILED"); }, 20000))
            << detail(d, "lastStatus");
        d.stop();
    }
    {
        drv::OpcUaEnv e = env();
        e.password = [](const std::string&) { return std::optional<std::string>(); };
        RecordingSink sink;
        OpcUaDriver d(c, e);
        d.start(sink);
        ASSERT_TRUE(sink.waitFor([&] { return sink.reasonNoLock(0, "OPCUA_SECRET_MISSING"); }));
        drv::DriverDiag diag;
        d.diagnostics(diag, 0);
        EXPECT_EQ(diag.channel.lastErrorCode, "OPCUA_SECRET_MISSING");
        d.stop();
    }
}

TEST(OpcUaDriver, AnonymousRefusedByTheServer) {
    const uint16_t port = SimServer::freePort();
    SimServer server(secure(port));
    ASSERT_TRUE(server.start()) << server.error();
    drv::OpcUaConfig c = config(port);  // None, anonymous: the server wants a user
    c.tags = {tag(0, "ns=2;s=Double", TagType::FLOAT64)};
    RecordingSink sink;
    OpcUaDriver d(c, env());
    d.start(sink);
    ASSERT_TRUE(sink.waitFor(
        [&] {
            const drv::TagUpdate* u = sink.lastNoLock(0);
            return u && u->quality == Quality::BAD && u->reason != "DISCONNECTED";
        },
        20000))
        << detail(d, "lastStatus");
    EXPECT_TRUE(sink.last(0).reason == "OPCUA_AUTH_FAILED" ||
                sink.last(0).reason == "OPCUA_ENDPOINT_NOT_FOUND")
        << sink.last(0).reason << " " << detail(d, "lastStatus");
    d.stop();
}

TEST(OpcUaDriver, ADisabledChannelOrServerPublishesDisabled) {
    drv::OpcUaConfig c = config(1);
    c.enabled = false;
    c.tags = {tag(0, "ns=2;s=Double", TagType::FLOAT64)};
    RecordingSink sink;
    OpcUaDriver d(c, env());
    d.start(sink);
    EXPECT_EQ(sink.last(0).reason, "DISABLED");
    EXPECT_FALSE(d.enqueueWrite(writeOf(1, 0, 1.0)));
    d.stop();
    drv::OpcUaConfig c2 = config(1);
    c2.deviceEnabled = false;
    c2.tags = c.tags;
    RecordingSink sink2;
    OpcUaDriver d2(c2, env());
    d2.start(sink2);
    EXPECT_EQ(sink2.last(0).reason, "DISABLED");
    d2.stop();
    EXPECT_EQ(d2.test({}).code, "NOT_SUPPORTED");
}
