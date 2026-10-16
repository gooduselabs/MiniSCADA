// liveLagP95Ms of GET /api/v1/diagnostics (specs/011-pilot-hardening FR-009, test-protocols §5
// X3): the time from the Tag Engine round that committed a change to the moment the WebSocket
// frame of its delta was written, p95 over the last five minutes.
//
// One histogram per minute (minute = monotonic ms / 60000), five of them in a ring; p95() merges
// the minutes that are less than five old (the current one included, so the window is 4 to 5
// minutes long). Bins: 1 ms up to 100 ms, 10 ms up to 1 s, 100 ms up to 10 s, one bin above. The
// p95 is the upper edge of the bin that holds it (never below the true value, at most one bin
// above). No sample in the window: nullopt (not 0). Thread-safe: the writer threads of the live
// sessions add, HTTP workers read.
#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <mutex>
#include <optional>

namespace mat {

class LiveLagWindow {
   public:
    static constexpr int kMinutes = 5;
    static constexpr int64_t kMinuteMs = 60000;
    static constexpr int kBins = 100 + 90 + 90 + 1;

    // Bin of a lag, and the upper edge of a bin (ms).
    static int binOf(int64_t lagMs) {
        if (lagMs < 0) lagMs = 0;
        if (lagMs < 100) return static_cast<int>(lagMs);
        if (lagMs < 1000) return 100 + static_cast<int>((lagMs - 100) / 10);
        if (lagMs < 10000) return 190 + static_cast<int>((lagMs - 1000) / 100);
        return kBins - 1;
    }
    static int64_t upperEdge(int bin) {
        if (bin < 100) return bin + 1;
        if (bin < 190) return 100 + (bin - 100 + 1) * 10;
        if (bin < 280) return 1000 + (bin - 190 + 1) * 100;
        return 10000;  // "10 s or more": reported as 10000
    }

    void add(int64_t nowMono, int64_t lagMs) {
        std::lock_guard<std::mutex> g(mu_);
        Minute& m = slotFor(nowMono / kMinuteMs);
        ++m.bins[static_cast<size_t>(binOf(lagMs))];
        ++m.count;
    }

    std::optional<int64_t> p95(int64_t nowMono) const {
        std::lock_guard<std::mutex> g(mu_);
        const int64_t minute = nowMono / kMinuteMs;
        std::array<uint64_t, kBins> merged{};
        uint64_t total = 0;
        for (const Minute& m : ring_) {
            if (m.count == 0 || m.minute > minute || minute - m.minute >= kMinutes) continue;
            for (int i = 0; i < kBins; ++i) merged[static_cast<size_t>(i)] += m.bins[i];
            total += m.count;
        }
        if (total == 0) return std::nullopt;
        // The smallest bin with at least 95 % of the samples at or below it.
        const uint64_t need = (total * 95 + 99) / 100;
        uint64_t seen = 0;
        for (int i = 0; i < kBins; ++i) {
            seen += merged[static_cast<size_t>(i)];
            if (seen >= need) return upperEdge(i);
        }
        return upperEdge(kBins - 1);
    }

   private:
    struct Minute {
        int64_t minute = -1;
        uint64_t count = 0;
        std::array<uint64_t, kBins> bins{};
    };
    Minute& slotFor(int64_t minute) {
        Minute& m = ring_[static_cast<size_t>(((minute % kMinutes) + kMinutes) % kMinutes)];
        if (m.minute != minute) {
            m.minute = minute;
            m.count = 0;
            m.bins.fill(0);
        }
        return m;
    }
    mutable std::mutex mu_;
    std::array<Minute, kMinutes> ring_{};
};

}  // namespace mat
