// Atomic diagnostics counters (FR-029, contract §9): counts match what was injected; a snapshot
// taken from another thread while the driver counts is consistent; no reset (D28).
#include <gtest/gtest.h>

#include <atomic>
#include <thread>

#include "drivers/sdk/diag.hpp"

using namespace mat::drv;

TEST(DiagCounters, CountsMatchTheInjectedErrors) {
    DiagCounters d("plc1", {"dev-a", "dev-b"});
    d.setChannelState("connected");
    for (int i = 0; i < 7; ++i) d.onRequestOk(0, 20 + i, 1'000'000 + i);
    for (int i = 0; i < 3; ++i) d.onTimeout(0);
    d.onException(0, 2);
    d.onException(0, 2);
    d.onException(0, 3);
    d.onBadFrame(0, BadFrameKind::Crc);
    d.onBadFrame(0, BadFrameKind::Crc);
    d.onBadFrame(0, BadFrameKind::Tid);
    d.onBadFrame(1, BadFrameKind::Echo);
    d.onWrite(0, WriteOutcome::Confirmed);
    d.onWrite(0, WriteOutcome::Failed);
    d.onWrite(0, WriteOutcome::Timeout);
    d.onWrite(0, WriteOutcome::Rejected);
    d.onReconnect();
    d.onReconnect();
    d.setLastError("TIMEOUT", 123456);
    d.addWarning("RS485_UNSUPPORTED");
    d.addWarning("RS485_UNSUPPORTED");  // once
    d.setDeviceState(1, "suspended");

    const DriverDiag s = d.snapshot(1'000'010);
    EXPECT_EQ(s.channel.id, "plc1");
    EXPECT_EQ(s.channel.state, "connected");
    EXPECT_EQ(s.channel.reconnects, 2u);
    EXPECT_EQ(s.channel.lastErrorCode, "TIMEOUT");
    EXPECT_EQ(s.channel.lastErrorAt, 123456);
    EXPECT_EQ(s.channel.warnings, (std::vector<std::string>{"RS485_UNSUPPORTED"}));
    ASSERT_EQ(s.devices.size(), 2u);
    EXPECT_EQ(s.devices[0].id, "dev-a");
    EXPECT_EQ(s.devices[0].requestsOk, 7u);
    EXPECT_EQ(s.devices[0].timeouts, 3u);
    EXPECT_EQ(s.devices[0].exceptions.at(2), 2u);
    EXPECT_EQ(s.devices[0].exceptions.at(3), 1u);
    EXPECT_EQ(s.devices[0].badFrames.crc, 2u);
    EXPECT_EQ(s.devices[0].badFrames.tid, 1u);
    EXPECT_EQ(s.devices[0].writes.confirmed, 1u);
    EXPECT_EQ(s.devices[0].writes.failed, 1u);
    EXPECT_EQ(s.devices[0].writes.timeout, 1u);
    EXPECT_EQ(s.devices[0].writes.rejected, 1u);
    EXPECT_EQ(s.devices[0].responseMaxMs, 26);
    EXPECT_GT(s.devices[0].responseAvgMs, 20.0);
    EXPECT_LT(s.devices[0].responseAvgMs, 26.0);
    EXPECT_EQ(s.devices[1].badFrames.echo, 1u);
    EXPECT_EQ(s.devices[1].state, "suspended");
}

TEST(DiagCounters, ResponseMaxCoversTheLast60SecondsOnly) {
    DiagCounters d("c", {"x"});
    d.onRequestOk(0, 500, 10'000'000);  // second 10000
    d.onRequestOk(0, 30, 10'030'000);
    EXPECT_EQ(d.snapshot(10'031'000).devices[0].responseMaxMs, 500);
    EXPECT_EQ(d.snapshot(10'059'999).devices[0].responseMaxMs, 500);
    EXPECT_EQ(d.snapshot(10'060'000).devices[0].responseMaxMs, 30);  // 500 is 60 s old
    EXPECT_EQ(d.snapshot(10'091'000).devices[0].responseMaxMs, 0);
}

TEST(DiagCounters, EwmaFollowsTheLatestResponses) {
    DiagCounters d("c", {"x"});
    d.onRequestOk(0, 100, 1000);
    EXPECT_DOUBLE_EQ(d.snapshot(1000).devices[0].responseAvgMs, 100.0);
    for (int i = 0; i < 50; ++i) d.onRequestOk(0, 10, 2000 + i);
    EXPECT_NEAR(d.snapshot(3000).devices[0].responseAvgMs, 10.0, 0.5);
}

TEST(DiagCounters, SnapshotFromAnotherThreadWhileCountingIsConsistent) {
    DiagCounters d("c", {"x"});
    std::atomic<bool> stop{false};
    std::atomic<uint64_t> written{0};
    std::thread writer([&] {
        for (int i = 0; i < 200000; ++i) {
            d.onRequestOk(0, 5, 1000 + i);
            d.onTimeout(0);
            ++written;
        }
        stop = true;
    });
    uint64_t lastOk = 0, lastTimeouts = 0;
    while (!stop) {
        const DriverDiag s = d.snapshot(1000);
        // monotonic, and timeouts never run ahead of requestsOk by more than the one in flight
        EXPECT_GE(s.devices[0].requestsOk, lastOk);
        EXPECT_GE(s.devices[0].timeouts, lastTimeouts);
        EXPECT_LE(s.devices[0].timeouts, s.devices[0].requestsOk);
        lastOk = s.devices[0].requestsOk;
        lastTimeouts = s.devices[0].timeouts;
    }
    writer.join();
    const DriverDiag s = d.snapshot(1000);
    EXPECT_EQ(s.devices[0].requestsOk, 200000u);
    EXPECT_EQ(s.devices[0].timeouts, 200000u);
}

TEST(DiagCounters, OutOfRangeDeviceIsIgnored) {
    DiagCounters d("c", {"x"});
    d.onTimeout(5);
    d.onException(5, 1);
    d.setDeviceState(5, "x");
    EXPECT_EQ(d.snapshot(0).devices[0].timeouts, 0u);
}
