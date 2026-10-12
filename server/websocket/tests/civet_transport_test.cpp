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

#include "nlohmann/json.hpp"
#include "server/tests/civet_test_support.hpp"

using namespace mat;
using nlohmann::json;
using test::WsClient;

namespace {

struct Rig {
    // CivetWeb's own idle timeout stays out of the way: only expire() may end a session here.
    explicit Rig(size_t maxClients, size_t queueBytes = SendQueue::kDefaultMaxBytes,
                 const std::string& writeTimeoutMs = "10000")
        : transport(options(maxClients, queueBytes), [this] { return now.load(); }),
          hub(store, transport, hubOptions(transport.maxClients()), [this] { return now.load(); }),
          server({"request_timeout_ms", writeTimeoutMs, "websocket_timeout_ms", "3600000"}) {
        transport.attach(&hub);
        transport.install(server.ctx, "/api/v1/live");
    }
    ~Rig() { server.stop(); }  // close handlers run while hub and transport still exist

    static CivetLiveTransport::Options options(size_t maxClients, size_t queueBytes) {
        CivetLiveTransport::Options o;
        o.maxClients = maxClients;
        o.queueBytes = queueBytes;
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
