#include "core/session-manager/session_manager.hpp"

#include <gtest/gtest.h>

#include <vector>

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

// Security review of 011 (M1, T062): one address could take every live slot (10). Now one source
// holds at most its share, ceil(maxClients / 2) by default (5 of 10); the global limit stays.
TEST(SessionManager, OneSourceHoldsAtMostItsShareOfTheSlots) {
    EXPECT_EQ(SessionManager::defaultMaxPerSource(10), 5u);
    EXPECT_EQ(SessionManager::defaultMaxPerSource(5), 3u);
    EXPECT_EQ(SessionManager::defaultMaxPerSource(1), 1u);
    int64_t now = 0;
    SessionManager m(
        10, [&] { return now; }, 15000);
    m.setMaxPerSource(5);
    EXPECT_EQ(m.maxPerSource(), 5u);
    std::vector<uint64_t> mine;
    for (int i = 0; i < 5; ++i) {
        const auto a = m.tryAcquireFrom("10.0.0.5");
        ASSERT_TRUE(a.id.has_value()) << i;
        mine.push_back(*a.id);
    }
    const auto over = m.tryAcquireFrom("10.0.0.5");
    EXPECT_FALSE(over.id.has_value());
    EXPECT_TRUE(over.sourceFull);
    EXPECT_EQ(m.rejectedTotal(), 1u);
    for (int i = 0; i < 5; ++i) EXPECT_TRUE(m.tryAcquireFrom("10.0.0.6").id.has_value()) << i;
    const auto full = m.tryAcquireFrom("10.0.0.7");
    EXPECT_FALSE(full.id.has_value());
    EXPECT_FALSE(full.sourceFull) << "the device is full, not the source";
    m.release(mine[0]);
    EXPECT_TRUE(m.tryAcquireFrom("10.0.0.5").id.has_value()) << "its place came back";
    now = 20000;  // every session silent: expired, the shares come back too
    EXPECT_EQ(m.expireIds().size(), 10u);
    for (int i = 0; i < 5; ++i) EXPECT_TRUE(m.tryAcquireFrom("10.0.0.5").id.has_value()) << i;
    EXPECT_EQ(m.sourceCount("10.0.0.5"), 5u);
}

TEST(SessionManager, NoShareMeansOnlyTheGlobalLimit) {
    int64_t now = 0;
    SessionManager m(3, [&] { return now; });
    for (int i = 0; i < 3; ++i) EXPECT_TRUE(m.tryAcquireFrom("10.0.0.5").id.has_value()) << i;
    EXPECT_FALSE(m.tryAcquireFrom("10.0.0.5").sourceFull);
}
