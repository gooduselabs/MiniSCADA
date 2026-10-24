// Fuzz of the S7comm decoders and of the S7 driver's receive path (feature 016 T013), in the manner
// of modbus_fuzz_test: a deterministic generator (splitmix64) inside GoogleTest mutates the valid
// frames of tests/s7-vectors/frames.json and the answers of the fake PLC.
//   1. the pure decoders (splitTpkt, dataOf, isConnectConfirm, decodeSetup, decodeRead,
//      decodeWrite, decodeValue) on buffers of the exact size: they never read past them (ASan in
//      tools/fuzz/cpp/run.sh), and an accepted Read Var answer has exactly the items and sizes
//      asked for;
//   2. the driver on a fake transport whose answers are damaged, cut, extended or dropped: it never
//      hangs, every update it publishes has the variant of its Tag's type, and it keeps answering
//      write commands.
// Duration: MAT_FUZZ_SECONDS (default 10, half per target); seed: MAT_FUZZ_SEED.
#include <gtest/gtest.h>

#include <chrono>
#include <cstdlib>
#include <fstream>
#include <memory>

#include "drivers/s7/frames.hpp"
#include "drivers/s7/s7_driver.hpp"
#include "drivers/s7/tests/fake_s7.hpp"
#include "drivers/sdk/tests/driver_conformance.hpp"
#include "nlohmann/json.hpp"

using namespace mat;
using namespace mat::s7;
using nlohmann::json;
namespace fake = mat::testing::s7fake;

GTEST_ALLOW_UNINSTANTIATED_PARAMETERIZED_TEST(DriverConformance);

namespace {

class Rng {
   public:
    explicit Rng(uint64_t seed) : s_(seed) {}
    uint64_t next() {
        uint64_t z = (s_ += 0x9E3779B97F4A7C15ULL);
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
        return z ^ (z >> 31);
    }
    size_t below(size_t n) { return n == 0 ? 0 : static_cast<size_t>(next() % n); }
    bool chance(int percent) { return static_cast<int>(below(100)) < percent; }
    uint8_t byte() { return static_cast<uint8_t>(next() & 0xFF); }

   private:
    uint64_t s_;
};

double fuzzSeconds() {
    const char* e = std::getenv("MAT_FUZZ_SECONDS");
    return e ? std::atof(e) : 10.0;
}

uint64_t baseSeed() {
    const char* e = std::getenv("MAT_FUZZ_SEED");
    return e ? std::strtoull(e, nullptr, 0) : 0x5337465555a5aULL;
}

Bytes bytesOf(const std::string& hex) {
    Bytes b;
    for (size_t i = 0; i < hex.size();) {
        if (hex[i] == ' ') {
            ++i;
            continue;
        }
        b.push_back(static_cast<uint8_t>(std::stoul(hex.substr(i, 2), nullptr, 16)));
        i += 2;
    }
    return b;
}

std::vector<Bytes> corpus() {
    std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/s7-vectors/frames.json",
                    std::ios::binary);
    const json j = json::parse(f);
    std::vector<Bytes> out;
    for (const auto& [key, list] : j.items())
        if (list.is_array())
            for (const auto& c : list)
                if (c.contains("hex")) out.push_back(bytesOf(c["hex"]));
    return out;
}

void mutate(Rng& rng, Bytes& b) {
    const int ops = 1 + static_cast<int>(rng.below(4));
    for (int k = 0; k < ops; ++k) {
        switch (rng.below(6)) {
            case 0:
                if (!b.empty()) b[rng.below(b.size())] = rng.byte();
                break;
            case 1:
                if (!b.empty()) b.resize(rng.below(b.size()));
                break;
            case 2:
                for (size_t i = rng.below(8); i > 0; --i) b.push_back(rng.byte());
                break;
            case 3:  // a length field
                if (b.size() > 16)
                    b[rng.chance(50) ? 2 + rng.below(2) : 13 + rng.below(4)] = rng.byte();
                break;
            case 4:
                if (b.size() > 20)
                    b[19 + rng.below(b.size() - 19)] ^= static_cast<uint8_t>(1u << rng.below(8));
                break;
            default:
                if (!b.empty()) b.erase(b.begin() + static_cast<long>(rng.below(b.size())));
                break;
        }
    }
}

bool expired(std::chrono::steady_clock::time_point end) {
    return std::chrono::steady_clock::now() >= end;
}

}  // namespace

TEST(S7Fuzz, Decoders) {
    const std::vector<Bytes> seeds = corpus();
    ASSERT_GT(seeds.size(), 30u);
    const auto end = std::chrono::steady_clock::now() +
                     std::chrono::milliseconds(static_cast<int64_t>(fuzzSeconds() * 500));
    uint64_t n = 0;
    for (uint64_t it = 0; !expired(end) || it < 2000; ++it, ++n) {
        const uint64_t seed = baseSeed() + it;
        Rng rng(seed);
        Bytes b = seeds[rng.below(seeds.size())];
        mutate(rng, b);
        // exact-size heap copies: any read past them is caught by ASan
        auto exact = [](size_t len) {
            return std::unique_ptr<uint8_t[]>(len ? new uint8_t[len] : nullptr);
        };
        std::unique_ptr<uint8_t[]> f = exact(b.size());
        if (!b.empty()) std::copy(b.begin(), b.end(), f.get());
        const Split s = splitTpkt(f.get(), b.size());
        if (s.status == Split::Status::Frame) ASSERT_LE(s.size, b.size()) << "seed " << seed;
        (void)isConnectConfirm(f.get(), b.size());
        const DataTpdu dt = dataOf(f.get(), b.size());
        if (dt.ok) ASSERT_LE(dt.offset + dt.size, b.size()) << "seed " << seed;
        const size_t off = b.size() > 7 ? 7 : 0;
        const size_t len = b.size() - off;
        std::unique_ptr<uint8_t[]> p = exact(len);
        if (len) std::copy(b.begin() + static_cast<long>(off), b.end(), p.get());
        (void)decodeSetup(p.get(), len);
        (void)decodeWrite(p.get(), len);
        std::vector<int> sizes(1 + rng.below(3));
        for (int& z : sizes) z = 1 + static_cast<int>(rng.below(8));
        const ReadReply r = decodeRead(p.get(), len, sizes);
        if (r.ok) {
            ASSERT_EQ(r.items.size(), sizes.size()) << "seed " << seed;
            for (size_t i = 0; i < sizes.size(); ++i)
                if (r.items[i].rc == 0xFF)
                    ASSERT_EQ(r.items[i].data.size(), static_cast<size_t>(sizes[i]))
                        << "seed " << seed;
        }
        const S7Type t = static_cast<S7Type>(rng.below(10));
        const int strLen = static_cast<int>(rng.below(12));
        (void)decodeValue(t, static_cast<int>(rng.below(8)), p.get(), len, strLen);
    }
    std::printf("fuzz s7-decoders: %llu inputs\n", static_cast<unsigned long long>(n));
}

TEST(S7Fuzz, DriverReceivePath) {
    const auto end = std::chrono::steady_clock::now() +
                     std::chrono::milliseconds(static_cast<int64_t>(fuzzSeconds() * 500));
    uint64_t rounds = 0;
    for (uint64_t it = 0; !expired(end) || it < 20; ++it, ++rounds) {
        const uint64_t seed = baseSeed() ^ (it * 7919);
        Rng rng(seed);
        fake::Clock clock;
        fake::Plc plc;
        plc.mem["DB1"] = fake::Bytes(256, 0x11);
        plc.mem["M"] = fake::Bytes(64, 0x22);
        drv::S7Config c;
        c.channelId = "s7";
        c.deviceId = "cpu";
        c.timeoutMs = 200;
        c.retries = static_cast<int>(rng.below(2));
        const char* addrs[] = {"DB1.DBX0.1",   "DB1.DBW2", "DB1.DBD8",
                               "DB1.STRING20", "MW4",      "DB1.LREAL40"};
        const TagType types[] = {TagType::BOOL,   TagType::INT16,  TagType::FLOAT32,
                                 TagType::STRING, TagType::UINT16, TagType::FLOAT64};
        for (size_t i = 0; i < 6; ++i) {
            drv::S7TagBinding b;
            b.tag = i;
            s7::AddressOptions o;
            o.rawType = types[i];
            o.stringLength = 8;
            o.rw = true;
            b.addr = s7::parseAddress(addrs[i], o);
            b.stringLength = 8;
            c.tags.push_back(b);
        }
        drv::S7Env env;
        env.manual = true;
        env.clock = &clock;
        env.uniform = [] { return 0.0; };
        env.firstRef = [&rng] { return static_cast<uint16_t>(rng.next()); };
        env.sleep = [&clock](int64_t t) { clock.set(t); };
        env.makeTransport = [&] {
            auto t = std::make_unique<fake::Transport>(plc, clock);
            t->mutate = [&rng](fake::Reply& r) {
                if (rng.chance(30)) return;
                for (auto& piece : r.pieces)
                    if (rng.chance(60)) mutate(rng, piece);
                if (rng.chance(10)) r.pieces.clear();
                if (rng.chance(10) && !r.pieces.empty()) {
                    fake::Bytes& last = r.pieces.back();
                    const size_t cut = rng.below(last.size() + 1);
                    fake::Bytes tail(last.begin() + static_cast<long>(cut), last.end());
                    last.resize(cut);
                    r.pieces.push_back(tail);
                }
            };
            return std::unique_ptr<drv::Transport>(std::move(t));
        };
        drv::conformance::RecordingSink sink;
        drv::S7Driver d(c, env);
        d.start(sink);
        for (int step = 0; step < 8; ++step) {
            if (rng.chance(30)) {
                drv::WriteCommand w;
                w.id = static_cast<uint64_t>(step + 1);
                w.tag = rng.below(6);
                w.raw =
                    types[w.tag] == TagType::STRING
                        ? TagScalar(std::string("ab"))
                        : types[w.tag] == TagType::BOOL ? TagScalar(true) : TagScalar(int64_t{3});
                d.enqueueWrite(w);
            }
            d.pump(clock.monoMs() + 1000);
        }
        d.stop();
        for (const auto& u : sink.all) {
            if (u.quality != Quality::GOOD) continue;
            const TagType t = types[u.tag];
            const bool okType =
                (t == TagType::BOOL && std::holds_alternative<bool>(u.value)) ||
                (t == TagType::INT16 && std::holds_alternative<int64_t>(u.value)) ||
                (t == TagType::UINT16 && std::holds_alternative<uint64_t>(u.value)) ||
                ((t == TagType::FLOAT32 || t == TagType::FLOAT64) &&
                 std::holds_alternative<double>(u.value)) ||
                (t == TagType::STRING && std::holds_alternative<std::string>(u.value));
            ASSERT_TRUE(okType) << "seed " << seed << " tag " << u.tag;
        }
        for (const auto& r : sink.results) ASSERT_FALSE(r.code.empty()) << "seed " << seed;
    }
    std::printf("fuzz s7-driver: %llu rounds\n", static_cast<unsigned long long>(rounds));
}
