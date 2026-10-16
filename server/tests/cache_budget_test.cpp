// The cache budget of the runtime (specs/010-history-reports plan, T070).
#include "server/cache_budget.hpp"

#include <gtest/gtest.h>

using namespace mat;

TEST(CacheBudget, TheDefaultFits) {
    const auto b = budgetCaches(4096);
    EXPECT_FALSE(b.lowered);
    EXPECT_EQ(b.readCacheKiB, 4096);
    EXPECT_DOUBLE_EQ(b.totalMiB, 30.25);
    EXPECT_LE(b.totalMiB, kCacheBudgetMiB);
}

TEST(CacheBudget, ASmallerCacheFits) {
    EXPECT_FALSE(budgetCaches(1024).lowered);
    EXPECT_FALSE(budgetCaches(4500).lowered);  // 8+8+2+0.25+13.2 = 31.45
}

TEST(CacheBudget, ATooBigCacheIsLoweredToWhatFits) {
    const auto b = budgetCaches(8192);
    EXPECT_TRUE(b.lowered);
    EXPECT_LT(b.readCacheKiB, 8192);
    EXPECT_GT(b.readCacheKiB, 4096);
    EXPECT_LE(b.totalMiB, kCacheBudgetMiB + 1e-9);
}
