#include "server/cli/auth_bench.hpp"

#include <sys/utsname.h>
#include <time.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <fstream>
#include <string>
#include <vector>

#include "core/auth/password_hash.hpp"
#include "core/crypto/hex.hpp"
#include "core/crypto/random.hpp"

namespace mat {

namespace {

// Decimal digits only, no sign, no leading zero, at most 9 digits.
bool parseCount(const char* s, uint32_t& out) {
    const size_t n = std::strlen(s);
    if (n == 0 || n > 9 || (n > 1 && s[0] == '0')) return false;
    uint32_t v = 0;
    for (size_t i = 0; i < n; ++i) {
        if (s[i] < '0' || s[i] > '9') return false;
        v = v * 10 + static_cast<uint32_t>(s[i] - '0');
    }
    out = v;
    return true;
}

// A field of /proc/self/status in KiB ("VmRSS", "VmHWM"); -1 when it is not there.
long statusKiB(const char* field) {
    std::ifstream f("/proc/self/status");
    const std::string key = std::string(field) + ":";
    for (std::string line; std::getline(f, line);)
        // NOLINTNEXTLINE(cert-err34-c): a kernel line of /proc/self/status, bench CLI (SAST T055)
        if (line.compare(0, key.size(), key) == 0) return std::atol(line.c_str() + key.size());
    return -1;
}

std::string cpuModel() {
    std::ifstream f("/proc/cpuinfo");
    for (std::string line; std::getline(f, line);)
        if (line.compare(0, 10, "model name") == 0) {
            const size_t colon = line.find(':');
            if (colon != std::string::npos) {
                const size_t start = line.find_first_not_of(" \t", colon + 1);
                return start == std::string::npos ? "" : line.substr(start);
            }
        }
    return "";
}

double threadCpuMs() {
    timespec ts{};
    ::clock_gettime(CLOCK_THREAD_CPUTIME_ID, &ts);
    return static_cast<double>(ts.tv_sec) * 1e3 + static_cast<double>(ts.tv_nsec) / 1e6;
}

double median(std::vector<double> v) {
    std::sort(v.begin(), v.end());
    const size_t n = v.size();
    return n % 2 ? v[n / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}

std::string fixed1(double v, char point) {
    char buf[32];
    std::snprintf(buf, sizeof buf, "%.1f", v);
    std::string s = buf;
    std::replace(s.begin(), s.end(), '.', point);
    return s;
}

}  // namespace

int runAuthBenchCli(int argc, char** argv, std::ostream& out, std::ostream& err) {
    Argon2Params p = kArgon2Default;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--auth-bench") continue;
        const bool m = arg == "--m";
        if (!m && arg != "--t") {
            err << "tham số không hỗ trợ: " << arg
                << " (dùng --auth-bench [--m <KiB>] [--t <n>])\n";
            return 2;
        }
        uint32_t v = 0;
        if (i + 1 >= argc || !parseCount(argv[i + 1], v)) {
            err << arg << " cần một số nguyên dương\n";
            return 2;
        }
        ++i;
        if (m && (v < kArgon2MinMKiB || v > kArgon2MaxMKiB)) {
            err << "--m phải trong " << kArgon2MinMKiB << "–" << kArgon2MaxMKiB
                << " KiB (khoảng runtime chấp nhận khi đọc users.json)\n";
            return 2;
        }
        if (!m && (v < kArgon2MinT || v > kArgon2MaxT)) {
            err << "--t phải trong " << kArgon2MinT << "–" << kArgon2MaxT << "\n";
            return 2;
        }
        (m ? p.mKiB : p.t) = v;
    }

    // Not a secret: a random text of the length of a real password, with a fresh salt.
    const std::string password = "mat-auth-bench-" + toHex(randomBytes(8));
    const std::string salt = randomBytes(kSaltBytes);
    const long rssBefore = statusKiB("VmRSS");
    const auto memBefore = detail::argon2MemoryStats();
    std::vector<double> wall, cpu;
    try {
        argon2idHash(password, salt, p);  // warm-up: caches, CPU frequency
        for (int i = 0; i < kAuthBenchRuns; ++i) {
            const auto t0 = std::chrono::steady_clock::now();
            const double c0 = threadCpuMs();
            argon2idHash(password, salt, p);
            cpu.push_back(threadCpuMs() - c0);
            wall.push_back(
                std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0)
                    .count());
        }
    } catch (const std::exception& e) {
        err << "không băm được (Argon2id m=" << p.mKiB << " KiB, t=" << p.t << "): " << e.what()
            << "\n";
        return 4;
    }
    const long rssPeak = statusKiB("VmHWM");
    const auto memAfter = detail::argon2MemoryStats();
    const double med = median(wall);
    const double low = *std::min_element(wall.begin(), wall.end());
    const double high = *std::max_element(wall.begin(), wall.end());
    const long rise = rssBefore >= 0 && rssPeak >= rssBefore ? rssPeak - rssBefore : -1;

    utsname u{};
    ::uname(&u);
    const long cpus = ::sysconf(_SC_NPROCESSORS_ONLN);
    const std::string model = cpuModel();
    const std::string machine = std::string(u.machine) + ", " + std::to_string(cpus) + " CPU" +
                                (model.empty() ? "" : ", " + model) + ", Linux " + u.release;

    out << "Argon2id m=" << p.mKiB << " KiB, t=" << p.t << ", p=" << p.p << ": " << kAuthBenchRuns
        << " lần băm (sau 1 lần làm nóng); không ghi gì ra đĩa\n";
    out << "thời gian mỗi lần (ms): trung vị " << fixed1(med, '.') << ", min " << fixed1(low, '.')
        << ", max " << fixed1(high, '.') << "; CPU trung vị " << fixed1(median(cpu), '.') << "\n";
    out << "RSS (KiB): trước " << rssBefore << ", đỉnh " << rssPeak;
    if (rise >= 0) out << " (+" << rise << ")";
    out << "; bộ nhớ băm " << p.mKiB << " KiB (mmap: " << memAfter.maps - memBefore.maps
        << " lần cấp, " << memAfter.unmaps - memBefore.unmaps << " lần trả)\n";
    out << "máy: " << machine << "\n";
    out << "so với mục tiêu R7 (0,3–0,8 s mỗi lần đăng nhập trên BL335; trần SC-007 1 s): ";
    if (med <= 800)
        out << "đạt (≤ 0,8 s), giữ tham số\n";
    else if (med <= 1000)
        out << "vượt 0,8 s: theo R7 hạ t = 1, giữ m; ghi vào ADR-011\n";
    else
        out << "vượt trần 1 s: hạ t = 1; nếu t = 1 vẫn vượt 1 s, xem lại ADR-011 (điều kiện xem "
               "xét "
               "lại)\n";
    out << "dòng cho ADR-011 (mục Số đo / bằng chứng):\n";
    out << "| Argon2id m = " << p.mKiB << ", t = " << p.t << ", p = " << p.p << " ("
        << kAuthBenchRuns << " lần; " << u.machine << ") | trung vị " << fixed1(med, ',')
        << " ms; min " << fixed1(low, ',') << "; max " << fixed1(high, ',') << " | RSS đỉnh "
        << (rise >= 0 ? "+" + fixed1(static_cast<double>(rise) / 1024, ',') + " MiB" : "?")
        << " |\n";
    return 0;
}

}  // namespace mat
