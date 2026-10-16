// Budget of the SQLite page caches of the runtime (specs/010-history-reports plan "Constraints",
// task T070): the writer 8 MiB, three read connections of `historyReaderCacheKiB` each, the
// forwarder connections about 8 MiB together, alarm.db 2 MiB and the audit log 0.25 MiB must fit
// in 32 MiB. When a configured read cache would not fit it is lowered and the journal says so.
#pragma once
#include <algorithm>

namespace mat {

struct CacheBudget {
    int readCacheKiB = 4096;  // what the pool should use (never more than configured)
    bool lowered = false;
    double totalMiB = 0;  // with the value in readCacheKiB
};

constexpr double kCacheBudgetMiB = 32.0;
constexpr double kFixedCachesMiB =
    8.0 /*writer*/ + 8.0 /*senders*/ + 2.0 /*alarm.db*/ + 0.25 /*audit*/;
constexpr int kReadConnections = 3;

inline CacheBudget budgetCaches(int configuredKiB) {
    CacheBudget b;
    const double want = kFixedCachesMiB + kReadConnections * configuredKiB / 1024.0;
    b.readCacheKiB = configuredKiB;
    if (want > kCacheBudgetMiB) {
        b.lowered = true;
        b.readCacheKiB = std::max(
            256, static_cast<int>((kCacheBudgetMiB - kFixedCachesMiB) * 1024.0 / kReadConnections));
    }
    b.totalMiB = kFixedCachesMiB + kReadConnections * b.readCacheKiB / 1024.0;
    return b;
}

}  // namespace mat
