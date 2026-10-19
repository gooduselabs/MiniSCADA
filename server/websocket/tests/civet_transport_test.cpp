// CivetLiveTransport in-process on x64 (T044, audit FR-021): the real CivetWeb (NO_FILES build,
// with the mAT patches) on 127.0.0.1, a raw WebSocket client, and a fake monotonic clock driving
// expire(). Covers the slot limit (4429), heartbeat expiry (4408), the deadline after our close
// frame, the 96 KiB frame limit (1009) and a short write to a client that stopped reading.
#include "server/websocket/civet_transport.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <memory>
#include <thread>
#include <vector>

#include "nlohmann/json.hpp"
#include "server/http/viewer_gate.hpp"
#include "server/tests/civet_test_support.hpp"

using namespace mat;
using nlohmann::json;
using test::WsClient;

namespace {

struct Rig {
    // CivetWeb's own idle timeout stays out of the way: only expire() may end a session here.
    explicit Rig(size_t maxClients, size_t queueBytes = SendQueue::kDefaultMaxBytes,
                 const std::string& writeTimeoutMs = "10000", size_t perSource = 0)
        : transport(options(maxClients, queueBytes, perSource), [this] { return now.load(); }),
          hub(store, transport, hubOptions(transport.maxClients()), [this] { return now.load(); }),
          server({"request_timeout_ms", writeTimeoutMs, "websocket_timeout_ms", "3600000"}) {
        transport.attach(&hub);
        transport.install(server.ctx, "/api/v1/live");
    }
    ~Rig() { server.stop(); }  // close handlers run while hub and transport still exist

    static CivetLiveTransport::Options options(size_t maxClients, size_t queueBytes,
                                               size_t perSource = 0) {
        CivetLiveTransport::Options o;
        o.maxClients = maxClients;
        o.queueBytes = queueBytes;
        o.maxClientsPerSource = perSource;
        return o;
    }
    static HubOptions hubOptions(size_t maxClients) {
        HubOptions h;
        h.serverVersion = "test";
        h.maxClients = maxClients;
        return h;
    }
    // A connected client that got its hello.
    std::unique_ptr<WsClient> client(int rcvbuf = 0) {
        auto c = std::make_unique<WsClient>();
        EXPECT_TRUE(c->connect(server.port, rcvbuf));
        const auto hello = c->read(3000);
        EXPECT_EQ(hello.opcode, 1);
        EXPECT_NE(hello.payload.find("\"type\":\"hello\""), std::string::npos) << hello.payload;
        return c;
    }

    std::atomic<int64_t> now{1000000};  // fake monotonic ms
    TagStore store;
    CivetLiveTransport transport;
    LiveHub hub;
    test::TestServer server;
};

std::string subscribe(const std::string& requestId, const std::string& pad = "") {
    std::string m =
        "{\"type\":\"subscribe\",\"requestId\":\"" + requestId + "\",\"tags\":[\"T.A\"]";
    if (!pad.empty()) m += ",\"pad\":\"" + pad + "\"";
    return m + "}";
}

}  // namespace

// Master Plan 10.2: client 11 gets MAX_CLIENTS_REACHED + 4429, the 10 others are not disturbed.
TEST(CivetTransport, EleventhClientGetsMaxClientsReachedAnd4429) {
    Rig r(10);
    r.store.add({"T.A", TagType::FLOAT32, "x"});
    std::vector<std::unique_ptr<WsClient>> ten;
    for (int i = 0; i < 10; ++i) ten.push_back(r.client());
    EXPECT_EQ(r.transport.active(), 10u);

    WsClient eleventh;
    ASSERT_TRUE(eleventh.connect(r.server.port));
    const auto err = eleventh.read(3000);
    ASSERT_EQ(err.opcode, 1);
    const json e = json::parse(err.payload);
    EXPECT_EQ(e["type"], "error");
    EXPECT_EQ(e["code"], "MAX_CLIENTS_REACHED");
    EXPECT_EQ(e["message"], "Hệ thống đã đạt tối đa 10 kết nối. Vui lòng thử lại sau.");
    const auto close = eleventh.read(3000);
    EXPECT_EQ(close.opcode, 8);
    EXPECT_EQ(close.closeCode(), 4429);
    EXPECT_EQ(r.transport.rejectedTotal(), 1u);
    EXPECT_EQ(r.transport.active(), 10u);

    // The ten sessions still work.
    ASSERT_TRUE(ten[0]->sendText(subscribe("r1")));
    const auto snap = ten[0]->read(3000);
    EXPECT_NE(snap.payload.find("\"type\":\"snapshot\""), std::string::npos) << snap.payload;

    // A rejected client that never answers our close frame is cut after the 5 s grace period.
    EXPECT_FALSE(eleventh.closedWithin(200));
    r.now += 5000;
    r.transport.expire();
    EXPECT_TRUE(eleventh.closedWithin(3000));
    EXPECT_EQ(r.transport.active(), 10u);
}

// Security review of 011 (M1, T062): one source holds at most its share of the slots (5 of 10 by
// default); the next one from that source gets MAX_CLIENTS_REACHED with scope "source" and a
// sentence about this computer, then 4429 as for a full device (a 1.x page waits 30 s and tries
// again). Another source still gets in; a place given back is free again.
TEST(CivetTransport, OneSourceGetsAtMostItsShareOfTheSlots) {
    Rig r(10, SendQueue::kDefaultMaxBytes, "10000", 5);
    std::vector<std::unique_ptr<WsClient>> five;
    for (int i = 0; i < 5; ++i) five.push_back(r.client());
    EXPECT_EQ(r.transport.active(), 5u);
    WsClient sixth;
    ASSERT_TRUE(sixth.connect(r.server.port));
    const auto err = sixth.read(3000);
    ASSERT_EQ(err.opcode, 1);
    const json e = json::parse(err.payload);
    EXPECT_EQ(e["type"], "error");
    EXPECT_EQ(e["code"], "MAX_CLIENTS_REACHED");
    EXPECT_EQ(e["scope"], "source");
    EXPECT_EQ(e["message"],
              "Máy này đã mở tối đa 5 kết nối dữ liệu sống. Đóng bớt tab hoặc thử lại sau.");
    EXPECT_EQ(sixth.read(3000).closeCode(), 4429);
    EXPECT_EQ(r.transport.rejectedTotal(), 1u);
    EXPECT_EQ(r.transport.active(), 5u);
    five.pop_back();  // one closes: its place comes back
    for (int i = 0; i < 100 && r.transport.active() != 4u; ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    ASSERT_EQ(r.transport.active(), 4u);
    auto again = r.client();
    EXPECT_EQ(r.transport.active(), 5u);
}

// Feature 011 (FR-009 liveLagP95Ms): the writer of the session measures, for each delta frame, the
// time from the commit of its round to the end of the write, on the transport's clock; nothing
// before the first delta (null, not 0); a heartbeat or a snapshot is not a sample.
TEST(CivetTransport, MeasuresTheLagFromTheCommitToTheWrittenDeltaFrame) {
    Rig r(10);
    r.store.add({"T.A", TagType::FLOAT32, "x"});
    auto c = r.client();
    ASSERT_TRUE(c->sendText(subscribe("r1")));
    EXPECT_NE(c->read(3000).payload.find("snapshot"), std::string::npos);
    EXPECT_FALSE(r.transport.liveLagP95Ms().has_value());
    r.store.set(0, 2.5, Quality::GOOD, 2, 2);
    const int64_t commit = r.now.load() - 250;  // the round committed 250 ms before the fake now
    r.hub.tick(commit);
    EXPECT_NE(c->read(3000).payload.find("\"type\":\"delta\""), std::string::npos);
    for (int i = 0; i < 100 && !r.transport.liveLagP95Ms(); ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    ASSERT_TRUE(r.transport.liveLagP95Ms().has_value());
    EXPECT_EQ(*r.transport.liveLagP95Ms(), 260);  // the 250..260 ms bin
}

// The limit is min(config, project), 1-10: the message names the real limit (audit C-15).
TEST(CivetTransport, FullMessageNamesTheEffectiveLimit) {
    Rig r(2);
    auto a = r.client();
    auto b = r.client();
    WsClient third;
    ASSERT_TRUE(third.connect(r.server.port));
    const auto err = third.read(3000);
    ASSERT_EQ(err.opcode, 1);
    EXPECT_EQ(json::parse(err.payload)["message"],
              "Hệ thống đã đạt tối đa 2 kết nối. Vui lòng thử lại sau.");
    EXPECT_EQ(third.read(3000).closeCode(), 4429);
}

// FR-021: silent > 15 s → close 4408, timeoutClosedTotal grows and the slot is free at once.
TEST(CivetTransport, SilentSessionIsClosed4408AndItsSlotFreed) {
    Rig r(1);
    auto a = r.client();
    r.now += 15000;
    r.transport.expire();  // exactly the timeout: still allowed
    EXPECT_EQ(r.transport.timeoutClosedTotal(), 0u);
    r.now += 1;
    r.transport.expire();
    const auto f = a->read(3000);
    EXPECT_EQ(f.opcode, 8);
    EXPECT_EQ(f.closeCode(), 4408);
    EXPECT_EQ(r.transport.timeoutClosedTotal(), 1u);
    EXPECT_EQ(r.transport.active(), 0u);
    auto b = r.client();  // the only slot is free before `a` answers
    EXPECT_EQ(r.transport.active(), 1u);
}

// After our close frame the client has 5 s to close; then the TCP connection is shut down so it
// cannot keep a CivetWeb worker thread (review minor-2).
TEST(CivetTransport, CloseDeadlineCutsAClientThatNeverAnswers) {
    Rig r(10);
    auto a = r.client();
    r.now += 15001;
    r.transport.expire();
    ASSERT_EQ(a->read(3000).closeCode(), 4408);
    EXPECT_FALSE(a->closedWithin(300));  // CivetWeb waits for the client's close frame
    r.now += 4999;
    r.transport.expire();
    EXPECT_FALSE(a->closedWithin(200));
    r.now += 1;
    r.transport.expire();
    EXPECT_TRUE(a->closedWithin(3000));
}

// A frame larger than 96 KiB is refused with 1009 before its payload is allocated (CivetWeb mAT
// patch); a frame of exactly 96 KiB still reaches the hub.
TEST(CivetTransport, FrameOver96KiBIsRefusedWith1009) {
    Rig r(10);
    r.store.add({"T.A", TagType::FLOAT32, "x"});
    auto big = r.client();
    ASSERT_TRUE(big->sendHeader(0x1, 96 * 1024 + 1));  // the payload is never sent
    const auto f = big->read(3000);
    EXPECT_EQ(f.opcode, 8);
    EXPECT_EQ(f.closeCode(), 1009);
    EXPECT_TRUE(big->closedWithin(3000));
    EXPECT_TRUE(test::waitFor([&] { return r.transport.active() == 0; }, 3000));

    auto fits = r.client();
    std::string msg = subscribe("r1", "");
    msg = subscribe("r1",
                    std::string(96 * 1024 - msg.size() - std::string(",\"pad\":\"\"").size(), 'x'));
    ASSERT_EQ(msg.size(), 96u * 1024);
    ASSERT_TRUE(fits->sendText(msg));
    const auto snap = fits->read(3000);
    EXPECT_NE(snap.payload.find("\"type\":\"snapshot\""), std::string::npos) << snap.opcode;
}

// Live protocol 1.1.0 §2 (feature 005, T105): before execv every session gets close 1012
// ("Service Restart"); the call waits for the close frames and returns how many went out
// (clientsNotified); a session opened afterwards is refused with 1012 at once.
TEST(CivetTransport, CloseAllForRestartSends1012AndCounts) {
    Rig r(10);
    r.store.add({"T.A", TagType::FLOAT32, "x"});
    auto a = r.client();
    auto b = r.client();
    auto c = r.client();
    ASSERT_TRUE(b->sendText(subscribe("r1")));
    ASSERT_EQ(b->read(3000).opcode, 1);  // snapshot: b is a subscribed session
    const auto t0 = std::chrono::steady_clock::now();
    EXPECT_EQ(r.transport.closeAllForRestart(1000), 3u);
    EXPECT_LT(std::chrono::steady_clock::now() - t0, std::chrono::milliseconds(1000));
    for (WsClient* x : {a.get(), b.get(), c.get()}) {
        const auto f = x->read(3000);
        EXPECT_EQ(f.opcode, 8);
        EXPECT_EQ(f.closeCode(), 1012);
    }
    WsClient late;
    ASSERT_TRUE(late.connect(r.server.port));
    const auto f = late.read(3000);
    EXPECT_EQ(f.opcode, 8);
    EXPECT_EQ(f.closeCode(), 1012);
    EXPECT_EQ(r.transport.closeAllForRestart(1000), 0u);  // nothing left to tell
}

// A writer stuck on a client that stopped reading cannot send its close frame: the call gives up
// after 1 s and does not count that session; the others are told.
TEST(CivetTransport, CloseAllForRestartWaitsAtMostOneSecond) {
    Rig r(10, size_t{64} << 20, "3000");
    auto slow = r.client(4096);  // small receive buffer, and it never reads again
    auto fine = r.client();
    ASSERT_EQ(r.transport.push(1, std::string(size_t{8} << 20, 'x')), SendQueue::PushResult::Ok);
    std::this_thread::sleep_for(std::chrono::milliseconds(200));  // the writer is in the write
    const auto t0 = std::chrono::steady_clock::now();
    EXPECT_EQ(r.transport.closeAllForRestart(1000), 1u);
    const auto ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    EXPECT_GE(ms, 950);
    EXPECT_LT(ms, 1500);
    EXPECT_EQ(fine->read(3000).closeCode(), 1012);
}

// A client that stops reading: the write times out in the middle of a frame (short write). That
// counts as a failure: writeFailedTotal grows, the slot is freed and the connection is cut
// (review I-1).
TEST(CivetTransport, ShortWriteDropsTheSession) {
    Rig r(10, size_t{64} << 20, "300");
    auto slow = r.client(4096);  // small receive buffer, and it never reads again
    ASSERT_EQ(r.transport.active(), 1u);
    ASSERT_EQ(r.transport.push(1, std::string(size_t{32} << 20, 'x')), SendQueue::PushResult::Ok);
    EXPECT_TRUE(test::waitFor([&] { return r.transport.writeFailedTotal() == 1; }, 10000));
    EXPECT_EQ(r.transport.active(), 0u);
    EXPECT_TRUE(slow->closedWithin(10000));
}

// Feature 011 (CPU of the live path): the writer sends header and payload of a frame with one
// write (one TLS record over wss). The frame is the one mg_websocket_write sent: FIN + text, no
// mask, the shortest length form (7 bits, 16 bits from 126, 64 bits above 65535), the payload as
// is.
TEST(CivetTransport, TextFramesKeepTheirBytesAtEveryLengthForm) {
    Rig r(10);
    auto c = r.client();
    for (size_t len : {size_t{0}, size_t{1}, size_t{125}, size_t{126}, size_t{127}, size_t{65535},
                       size_t{65536}, size_t{70001}}) {
        std::string text(len, '\0');
        for (size_t k = 0; k < len; ++k) text[k] = static_cast<char>('a' + (k * 7 + len) % 26);
        ASSERT_EQ(r.transport.push(1, text), SendQueue::PushResult::Ok);
        const auto f = c->read(5000);
        std::string header = "\x81";
        if (len < 126) {
            header += static_cast<char>(len);
        } else if (len <= 0xFFFF) {
            header += '\x7e';
            header += static_cast<char>(len >> 8);
            header += static_cast<char>(len & 0xFF);
        } else {
            header += '\x7f';
            for (int shift = 56; shift >= 0; shift -= 8)
                header += static_cast<char>((uint64_t{len} >> shift) & 0xFF);
        }
        EXPECT_EQ(f.opcode, 1) << len;
        EXPECT_EQ(f.header, header) << len;
        EXPECT_EQ(f.payload, text) << len;
    }
}

// ---- feature 006: the source filter and the sessions of the live upgrade (FR-055a, live 1.2.0 §2,
// §3) ----

namespace {

// A transport with a ViewerGate. `remote` and `tls` are what the in-process client "looks like"
// (it is always on the loopback without TLS); `sessionAlive` answers the session check.
struct GateRig {
    GateRig(ViewerAccess access, std::string remoteIp, bool tlsClaimed, size_t maxClients = 10)
        : remote(std::move(remoteIp)),
          gate(access,
               [this](const std::string& token, const std::string& ip, int) {
                   ++peeks;
                   lastIp = ip;
                   lastToken = token;
                   return sessionAlive.load();
               },
               {[this](const std::string&) { return remote; },
                [tlsClaimed](bool) { return tlsClaimed; }}),
          transport(options(maxClients, &gate), [this] { return now.load(); }),
          hub(store, transport, hubOptions(transport.maxClients()), [this] { return now.load(); }),
          server({"request_timeout_ms", "10000", "websocket_timeout_ms", "3600000"}) {
        transport.attach(&hub);
        transport.install(server.ctx, "/api/v1/live");
    }
    ~GateRig() { server.stop(); }

    static CivetLiveTransport::Options options(size_t maxClients, ViewerGate* g) {
        CivetLiveTransport::Options o;
        o.maxClients = maxClients;
        o.heartbeatTimeoutMs =
            3600000;  // the fake clock jumps minutes: only the session recheck acts
        o.gate = g;
        return o;
    }
    static HubOptions hubOptions(size_t maxClients) {
        HubOptions h;
        h.serverVersion = "test";
        h.maxClients = maxClients;
        return h;
    }
    // The raw handshake with extra request headers. Returns the response (the headers, and for a
    // refusal also the body); on 101 the connection stays open in *fdOut when given.
    std::string upgrade(const std::string& extraHeaders, int* fdOut = nullptr) {
        const int fd = test::connectLocal(server.port);
        EXPECT_GE(fd, 0);
        test::sendAll(fd,
                      "GET /api/v1/live HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n"
                      "Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
                      "Sec-WebSocket-Version: 13\r\n" +
                          extraHeaders + "\r\n");
        std::string head;
        char c;
        while (head.find("\r\n\r\n") == std::string::npos && test::recvSome(fd, &c, 1, 3000) == 1)
            head += c;
        if (head.compare(0, 12, "HTTP/1.1 101") == 0) {
            if (fdOut)
                *fdOut = fd;
            else
                ::close(fd);
            return head;
        }
        char buf[1024];  // a refusal: the short body follows, then the server closes
        ssize_t n;
        while ((n = test::recvSome(fd, buf, sizeof buf, 1000)) > 0)
            head.append(buf, static_cast<size_t>(n));
        ::close(fd);
        return head;
    }
    // An upgraded connection as a WsClient, its hello read and the slot counted.
    std::unique_ptr<test::WsClient> accepted(const std::string& extraHeaders) {
        int fd = -1;
        const std::string head = upgrade(extraHeaders, &fd);
        EXPECT_EQ(head.compare(0, 12, "HTTP/1.1 101"), 0) << head;
        auto c = std::make_unique<test::WsClient>();
        c->adopt(fd);
        const auto hello = c->read(3000);
        EXPECT_NE(hello.payload.find("hello"), std::string::npos);
        return c;
    }

    std::string remote;
    std::atomic<bool> sessionAlive{true};
    std::atomic<int> peeks{0};
    std::string lastIp, lastToken;
    std::atomic<int64_t> now{1000000};
    TagStore store;
    ViewerGate gate;
    CivetLiveTransport transport;
    LiveHub hub;
    test::TestServer server;
};

}  // namespace

TEST(CivetTransportGate, APublicSourceWithoutASessionGets403BeforeAnySlot) {
    GateRig r(ViewerAccess::Private, "203.0.113.9", false);
    const std::string head = r.upgrade("");
    EXPECT_EQ(head.compare(0, 12, "HTTP/1.1 403"), 0) << head;
    EXPECT_NE(head.find("SOURCE_NOT_ALLOWED"), std::string::npos) << head;  // body, short
    EXPECT_EQ(r.transport.active(), 0u);
    EXPECT_EQ(r.transport.rejectedTotal(), 0u);  // no slot was taken, none refused for being full
    EXPECT_EQ(r.gate.blockedTotal(), 1u);
}

TEST(CivetTransportGate, ATokenOverHttpIsHttpsRequiredAndTakesNoSlot) {
    GateRig r(ViewerAccess::Private, "192.168.1.20", /*tls*/ false);
    const std::string head = r.upgrade("Authorization: Bearer mats_abc\r\n");
    EXPECT_EQ(head.compare(0, 12, "HTTP/1.1 403"), 0) << head;
    EXPECT_NE(head.find("HTTPS_REQUIRED"), std::string::npos);
    EXPECT_EQ(r.transport.active(), 0u);
    EXPECT_EQ(r.peeks.load(), 0) << "the token is not even looked at over HTTP";
}

TEST(CivetTransportGate, APrivateSourceNeedsNoSession) {
    GateRig r(ViewerAccess::Private, "192.168.1.20", false);
    test::WsClient c;
    ASSERT_TRUE(c.connect(r.server.port));
    EXPECT_NE(c.read(3000).payload.find("hello"), std::string::npos);
    EXPECT_EQ(r.transport.active(), 1u);
    EXPECT_EQ(r.peeks.load(), 0);
}

TEST(CivetTransportGate, AValidTokenOverHttpsLetsAPublicSourceIn) {
    GateRig r(ViewerAccess::Private, "203.0.113.9", /*tls*/ true);
    int fd = -1;
    const std::string head = r.upgrade("Authorization: Bearer mats_good\r\n", &fd);
    EXPECT_EQ(head.compare(0, 12, "HTTP/1.1 101"), 0) << head;
    if (fd >= 0) ::close(fd);
    EXPECT_EQ(r.lastToken, "mats_good");
    EXPECT_EQ(r.lastIp,
              "203.0.113.9");  // the session is checked against the address of the request
    EXPECT_EQ(r.gate.blockedTotal(), 0u);
}

TEST(CivetTransportGate, ATokenOfADeadSessionIsFilteredLikeNoToken) {
    GateRig r(ViewerAccess::Private, "203.0.113.9", true);
    r.sessionAlive = false;
    const std::string head = r.upgrade("Authorization: Bearer mats_dead\r\n");
    EXPECT_EQ(head.compare(0, 12, "HTTP/1.1 403"), 0) << head;
    EXPECT_NE(head.find("SOURCE_NOT_ALLOWED"), std::string::npos);
    EXPECT_EQ(r.transport.active(), 0u);
}

TEST(CivetTransportGate, ASessionThatEndsClosesTheConnection4401WithinAMinute) {
    GateRig r(ViewerAccess::Private, "203.0.113.9", true);
    r.transport.expire();  // starts the 60 s clock
    auto c = r.accepted("Authorization: Bearer mats_good\r\n");
    ASSERT_EQ(r.transport.active(), 1u);
    // alive: nothing happens at 59 s, and at 60 s the look finds it alive
    r.now += 59000;
    r.transport.expire();
    EXPECT_EQ(r.transport.active(), 1u);
    r.now += 1000;
    r.transport.expire();
    EXPECT_EQ(r.transport.active(), 1u);
    // the sign-in ends: the next look closes with 4401
    r.sessionAlive = false;
    r.now += 60000;
    r.transport.expire();
    const auto f = c->read(3000);
    EXPECT_EQ(f.opcode, 8);
    EXPECT_EQ(f.closeCode(), 4401);
}

TEST(CivetTransportGate, AConnectionFromThePrivateNetworkIsNotClosedWhenTheSessionEnds) {
    GateRig r(ViewerAccess::Private, "192.168.1.20", true);
    r.transport.expire();
    auto c = r.accepted("Authorization: Bearer mats_good\r\n");
    ASSERT_EQ(r.transport.active(), 1u);
    const int peeksAtUpgrade = r.peeks.load();
    r.sessionAlive = false;
    for (int i = 0; i < 3; ++i) {
        r.now += 120000;
        r.transport.expire();
    }
    EXPECT_EQ(r.transport.active(), 1u) << "a private source did not need the token";
    EXPECT_EQ(r.peeks.load(), peeksAtUpgrade) << "and its session is not looked at again";
}

TEST(CivetTransportGate, TenSessionsInAllWithAndWithoutATokenThenFull) {
    GateRig r(ViewerAccess::Any, "203.0.113.9", true, 10);
    std::vector<int> fds;
    for (int i = 0; i < 10; ++i) {
        int fd = -1;
        const std::string head = r.upgrade(i % 2 ? "Authorization: Bearer mats_good\r\n" : "", &fd);
        ASSERT_EQ(head.compare(0, 12, "HTTP/1.1 101"), 0) << i << " " << head;
        fds.push_back(fd);
    }
    EXPECT_EQ(r.transport.active(), 10u);
    int fd = -1;
    const std::string head = r.upgrade("Authorization: Bearer mats_good\r\n", &fd);
    EXPECT_EQ(head.compare(0, 12, "HTTP/1.1 101"),
              0);  // the handshake is made, then the error and 4429
    test::WsClient extra;
    extra.adopt(fd);
    EXPECT_NE(extra.read(3000).payload.find("MAX_CLIENTS_REACHED"), std::string::npos);
    EXPECT_EQ(r.transport.active(), 10u);
    for (int f : fds) ::close(f);
}

TEST(CivetTransportGate, OffRefusesEverySourceButTheLoopback) {
    GateRig priv(ViewerAccess::Off, "192.168.1.20", false);
    EXPECT_NE(priv.upgrade("").find("VIEWER_OFF"), std::string::npos);
    GateRig loop(ViewerAccess::Off, "127.0.0.1", false);
    EXPECT_EQ(loop.upgrade("").compare(0, 12, "HTTP/1.1 101"), 0);
}
