#include "core/session-manager/session_manager.hpp"

#include <gtest/gtest.h>

using mat::SessionManager;

TEST(SessionManager, AcceptsUpToTenAndRejectsEleventh) {
    int64_t now = 0;
    SessionManager m(10, [&] { return now; });
    for (int i = 0; i < 10; ++i) EXPECT_TRUE(m.tryAcquire().has_value());
    EXPECT_EQ(m.active(), 10u);
    EXPECT_FALSE(m.tryAcquire().has_value());
    EXPECT_EQ(m.rejectedTotal(), 1u);
    EXPECT_EQ(m.active(), 10u);  // existing sessions unaffected
}

TEST(SessionManager, ReleaseFreesSlot) {
    int64_t now = 0;
    SessionManager m(2, [&] { return now; });
    auto a = m.tryAcquire();
    m.tryAcquire();
    EXPECT_FALSE(m.tryAcquire().has_value());
    m.release(*a);
    EXPECT_TRUE(m.tryAcquire().has_value());
}

TEST(SessionManager, HeartbeatTimeoutFreesSlot) {
    int64_t now = 0;
    SessionManager m(
        1, [&] { return now; }, 15000);
    auto a = m.tryAcquire();
    now = 14000;
    EXPECT_EQ(m.expire(), 0u);
    EXPECT_FALSE(m.tryAcquire().has_value());
    now = 15001;
    EXPECT_EQ(m.expire(), 1u);
    EXPECT_TRUE(m.tryAcquire().has_value());
    (void)a;
}

TEST(SessionManager, HeartbeatKeepsSessionAlive) {
    int64_t now = 0;
    SessionManager m(
        1, [&] { return now; }, 15000);
    auto a = m.tryAcquire();
    now = 10000;
    m.heartbeat(*a);
    now = 20000;  // 10 s since last heartbeat
    EXPECT_EQ(m.expire(), 0u);
    EXPECT_EQ(m.active(), 1u);
}

TEST(SessionManager, MaxClientsIsClampedToTen) {
    EXPECT_EQ(SessionManager::clampMax(50), 10u);
    EXPECT_EQ(SessionManager::clampMax(0), 1u);
    EXPECT_EQ(SessionManager::clampMax(7), 7u);
    int64_t now = 0;
    SessionManager m(50, [&] { return now; });
    EXPECT_EQ(m.maxClients(), 10u);
}

TEST(SessionManager, ExpireIdsReturnsDroppedIds) {
    int64_t now = 0;
    SessionManager m(
        3, [&] { return now; }, 15000);
    auto a = m.tryAcquire();
    auto b = m.tryAcquire();
    now = 10000;
    m.heartbeat(*b);
    now = 16000;
    auto dropped = m.expireIds();
    ASSERT_EQ(dropped.size(), 1u);
    EXPECT_EQ(dropped[0], *a);
}
