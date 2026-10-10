#include "core/session-manager/send_queue.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <thread>

using mat::SendQueue;
using Item = SendQueue::Item;
using Pop = SendQueue::PopStatus;
using Push = SendQueue::PushResult;

TEST(SendQueue, FifoAndByteCounting) {
    SendQueue q(100);
    EXPECT_EQ(q.push("aaaa"), Push::Ok);
    EXPECT_EQ(q.push("bb"), Push::Ok);
    EXPECT_EQ(q.bytes(), 6u);
    Item it;
    ASSERT_EQ(q.pop(it, 0), Pop::Item);
    EXPECT_EQ(it.text, "aaaa");
    EXPECT_EQ(q.bytes(), 2u);
    ASSERT_EQ(q.pop(it, 0), Pop::Item);
    EXPECT_EQ(it.text, "bb");
    EXPECT_EQ(q.bytes(), 0u);
    EXPECT_EQ(q.pop(it, 0), Pop::Timeout);
}

TEST(SendQueue, DefaultLimitIs256KiB) {
    SendQueue q;
    EXPECT_EQ(q.maxBytes(), 262144u);
}

TEST(SendQueue, OverflowDropsPendingAndQueuesResyncThenClose) {
    SendQueue q(10);
    EXPECT_EQ(q.push("123456"), Push::Ok);
    EXPECT_EQ(q.push("7890"), Push::Ok);  // exactly 10 bytes: still fine
    EXPECT_EQ(q.push("x"), Push::Overflow);
    EXPECT_TRUE(q.overflowed());
    Item it;
    ASSERT_EQ(q.pop(it, 0), Pop::Item);
    EXPECT_EQ(it.text, SendQueue::kResyncRequired);
    EXPECT_EQ(it.closeCode, 0);
    ASSERT_EQ(q.pop(it, 0), Pop::Item);
    EXPECT_EQ(it.closeCode, SendQueue::kCloseResync);
    EXPECT_EQ(q.pop(it, 0), Pop::Closed);
}

TEST(SendQueue, PushAfterOverflowIsDropped) {
    SendQueue q(4);
    EXPECT_EQ(q.push("12345"), Push::Overflow);  // single message larger than the limit
    EXPECT_EQ(q.push("a"), Push::Closed);
    Item it;
    ASSERT_EQ(q.pop(it, 0), Pop::Item);
    EXPECT_EQ(it.text, SendQueue::kResyncRequired);
}

TEST(SendQueue, RequestCloseDeliversPendingThenClose) {
    SendQueue q(100);
    q.push("err");
    q.requestClose(4429, "MAX_CLIENTS_REACHED");
    EXPECT_EQ(q.push("late"), Push::Closed);
    Item it;
    ASSERT_EQ(q.pop(it, 0), Pop::Item);
    EXPECT_EQ(it.text, "err");
    ASSERT_EQ(q.pop(it, 0), Pop::Item);
    EXPECT_EQ(it.closeCode, 4429);
    EXPECT_EQ(it.closeReason, "MAX_CLIENTS_REACHED");
    EXPECT_EQ(q.pop(it, 0), Pop::Closed);
}

TEST(SendQueue, PopWaitsWithTimeout) {
    SendQueue q(100);
    Item it;
    auto t0 = std::chrono::steady_clock::now();
    EXPECT_EQ(q.pop(it, 50), Pop::Timeout);
    EXPECT_GE(std::chrono::steady_clock::now() - t0, std::chrono::milliseconds(40));
}

TEST(SendQueue, PushWakesWaitingWriter) {
    SendQueue q(100);
    std::atomic<bool> got{false};
    std::thread w([&] {
        Item it;
        if (q.pop(it, 2000) == Pop::Item && it.text == "hi") got = true;
    });
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
    q.push("hi");
    w.join();
    EXPECT_TRUE(got);
}

TEST(SendQueue, AbortWakesWriterAndDropsEverything) {
    SendQueue q(100);
    q.push("pending");
    q.abort();
    Item it;
    EXPECT_EQ(q.pop(it, 1000), Pop::Closed);
    EXPECT_EQ(q.push("x"), Push::Closed);
    EXPECT_EQ(q.bytes(), 0u);

    SendQueue q2(100);
    std::atomic<bool> closed{false};
    std::thread w([&] {
        Item i2;
        closed = q2.pop(i2, 5000) == Pop::Closed;
    });
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
    q2.abort();
    w.join();
    EXPECT_TRUE(closed);
}
