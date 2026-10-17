#include "core/historian/io_meter.hpp"

#include <cstdio>

namespace mat {

namespace {
constexpr int64_t kCellMs = 60000;
constexpr size_t kCells = 1440;
}  // namespace

std::optional<int64_t> readProcSelfIoWriteBytes() {
    std::FILE* f = std::fopen("/proc/self/io", "r");
    if (!f) return std::nullopt;
    char line[160];
    std::optional<int64_t> out;
    while (std::fgets(line, sizeof line, f)) {
        long long v = 0;
        // NOLINTNEXTLINE(cert-err34-c): a kernel line of /proc/self/io (SAST T055)
        if (std::sscanf(line, "write_bytes: %lld", &v) == 1) {
            out = static_cast<int64_t>(v);
            break;
        }
    }
    std::fclose(f);
    return out;
}

IoMeter::IoMeter(Source source)
    : source_(source ? std::move(source) : Source(readProcSelfIoWriteBytes)) {}

void IoMeter::sample(int64_t nowMono) {
    if (haveBase_ && nowMono - lastMono_ < kCellMs) return;
    if (unavailable_ && nowMono - lastTry_ < kCellMs) return;  // not a /proc read every pass
    lastTry_ = nowMono;
    const auto v = source_();
    if (!v) {
        unavailable_ = true;
        return;
    }
    unavailable_ = false;
    if (!haveBase_) {
        haveBase_ = true;
        lastMono_ = nowMono;
        lastCounter_ = *v;
        return;
    }
    Cell c;
    c.seconds = static_cast<int32_t>((nowMono - lastMono_ + 500) / 1000);
    c.bytes = *v >= lastCounter_ ? *v - lastCounter_ : 0;  // a counter that went back is rebased
    lastMono_ = nowMono;
    lastCounter_ = *v;
    if (ring_.size() >= kCells) ring_.erase(ring_.begin());
    ring_.push_back(c);
}

IoSnapshot IoMeter::snapshot() const {
    IoSnapshot s;
    s.available = !unavailable_;
    if (unavailable_) return s;
    int64_t seconds = 0;
    for (size_t i = 0; i < ring_.size(); ++i) {
        s.writeBytes24h += ring_[i].bytes;
        seconds += ring_[i].seconds;
        if (i + 60 >= ring_.size()) s.writeBytes1h += ring_[i].bytes;
    }
    s.coverageS = seconds > 86400 ? 86400 : seconds;
    if (s.coverageS >= 600) s.bytesPerDay = s.writeBytes24h * 86400 / s.coverageS;
    return s;
}

}  // namespace mat
