// Fuzz of the MC protocol frames (feature 017, FR-010; the shape of modbus_fuzz_test). A
// deterministic generator (splitmix64) inside GoogleTest:
//   1. the pure decoders (splitResponse, checkResponse) on damaged copies of the response frames
//      of tests/mc-vectors/frames.json: no read outside the bytes (run under ASan by
//      tools/fuzz/cpp/run.sh), a split size within the bytes, and an accepted frame always has the
//      data length its command wants;
//   2. the driver on a fake PLC whose replies have their header damaged, are cut short, split in
//      pieces, preceded by junk or lost: it never hangs, and a Tag is GOOD only with the value the
//      PLC holds (the data bytes are never damaged, so a GOOD value with another number would be a
//      frame taken for the wrong request).
// Duration: MAT_FUZZ_SECONDS (default 5, half per target); seed: MAT_FUZZ_SEED.
#include <gtest/gtest.h>

#include <chrono>
#include <cstdlib>
#include <fstream>

#include "drivers/mc/mc_driver.hpp"
#include "drivers/mc/tests/fake_mc_plc.hpp"
#include "drivers/sdk/tests/driver_conformance.hpp"
#include "nlohmann/json.hpp"

using namespace mat;
using namespace mat::drv;
using namespace mat::testing;
using nlohmann::json;

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

int64_t seconds() {
    const char* s = std::getenv("MAT_FUZZ_SECONDS");
    return s ? std::max(1L, std::atol(s)) : 5;
}
uint64_t baseSeed() {
    const char* s = std::getenv("MAT_FUZZ_SEED");
    return s ? std::strtoull(s, nullptr, 10) : 20261023ULL;
}
int64_t nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

mc::DevRef devOf(const json& j) {
    return {mc::deviceByName(j["device"].get<std::string>())->device, j["number"].get<uint32_t>()};
}

}  // namespace

TEST(McFuzz, Decoders) {
    std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/mc-vectors/frames.json",
                    std::ios::binary);
    const json cases = json::parse(f)["cases"];
    struct Seed {
        mc::FrameOptions o;
        uint16_t serial;
        mc::Request r;
        mc::Bytes wire;
    };
    std::vector<Seed> seeds;
    for (const auto& c : cases) {
        Seed s;
        const json& o = c["options"];
        s.o.frame = o["frame"] == "4E" ? mc::FrameType::E4 : mc::FrameType::E3;
        s.o.code = o["code"] == "ascii" ? mc::CodeType::Ascii : mc::CodeType::Binary;
        s.o.route = {o["network"].get<uint8_t>(), o["station"].get<uint8_t>(),
                     o["moduleIo"].get<uint16_t>(), o["moduleStation"].get<uint8_t>()};
        s.serial = o["serial"].get<uint16_t>();
        const json& rq = c["request"];
        const std::string cmd = rq["cmd"];
        if (cmd == "randomRead") {
            s.r.cmd = mc::Cmd::RandomRead;
            for (const auto& d : rq.value("randomWords", json::array()))
                s.r.randomWords.push_back(devOf(d));
            for (const auto& d : rq.value("randomDwords", json::array()))
                s.r.randomDwords.push_back(devOf(d));
        } else {
            s.r.dev = devOf(rq);
            s.r.cmd = cmd == "batchReadWords"
                          ? mc::Cmd::ReadWords
                          : cmd == "batchReadBits" ? mc::Cmd::ReadBits
                                                   : cmd == "batchWriteWords" ? mc::Cmd::WriteWords
                                                                              : mc::Cmd::WriteBits;
            s.r.points = rq.value("points", uint16_t{0});
        }
        for (const auto& resp : c["responses"]) {
            const std::string w = resp["wire"];
            if (s.o.code == mc::CodeType::Ascii) {
                s.wire.assign(w.begin(), w.end());
            } else {
                s.wire.clear();
                for (size_t i = 0; i < w.size(); i += 3)
                    s.wire.push_back(static_cast<uint8_t>(std::stoul(w.substr(i, 2), nullptr, 16)));
            }
            seeds.push_back(s);
        }
    }
    ASSERT_FALSE(seeds.empty());
    const uint64_t seed = baseSeed();
    const int64_t end = nowMs() + seconds() * 500;
    uint64_t inputs = 0;
    for (uint64_t i = 0; nowMs() < end || i < 2000; ++i) {
        Rng rng(seed + i);
        const Seed& s = seeds[rng.below(seeds.size())];
        mc::Bytes b = s.wire;
        const int ops = 1 + static_cast<int>(rng.below(4));
        for (int k = 0; k < ops; ++k) {
            switch (rng.below(5)) {
                case 0:
                    if (!b.empty()) b[rng.below(b.size())] = rng.byte();
                    break;
                case 1:
                    b.resize(rng.below(b.size() + 1));
                    break;
                case 2:
                    b.insert(b.begin() + static_cast<long>(rng.below(b.size() + 1)), rng.byte());
                    break;
                case 3:
                    if (!b.empty()) b.erase(b.begin() + static_cast<long>(rng.below(b.size())));
                    break;
                default:
                    for (int n = static_cast<int>(rng.below(8)); n > 0; --n)
                        b.push_back(rng.byte());
            }
        }
        // exact-size copies so that ASan sees any read past the end
        std::unique_ptr<uint8_t[]> buf(new uint8_t[b.size() + 1]);
        std::copy(b.begin(), b.end(), buf.get());
        const mc::Split sp = mc::splitResponse(s.o.frame, s.o.code, buf.get(), b.size());
        if (sp.status == mc::SplitStatus::Frame) {
            ASSERT_LE(sp.size, b.size()) << "seed " << seed + i;
        }
        const mc::Response r = mc::checkResponse(s.o, s.serial, s.r, buf.get(), b.size());
        if (r.issue == mc::Issue::None && r.endCode == 0) {
            size_t got = r.words.size(), want = 0;
            if (s.r.cmd == mc::Cmd::ReadBits) {
                got = r.bits.size();
                want = s.r.points;
            } else if (s.r.cmd == mc::Cmd::ReadWords) {
                want = s.r.points;
            } else if (s.r.cmd == mc::Cmd::RandomRead) {
                want = s.r.randomWords.size() + 2 * s.r.randomDwords.size();
            }
            ASSERT_EQ(got, want) << "seed " << seed + i;
        }
        ++inputs;
    }
    std::printf("fuzz mc decoders: %llu inputs, seed %llu\n",
                static_cast<unsigned long long>(inputs), static_cast<unsigned long long>(seed));
}

TEST(McFuzz, DriverOnDamagedLine) {
    const uint64_t seed = baseSeed();
    const int64_t end = nowMs() + seconds() * 500;
    uint64_t runs = 0;
    for (uint64_t i = 0; nowMs() < end || i < 20; ++i) {
        Rng rng(seed * 31 + i);
        McConfig c;
        c.channelId = "fz";
        c.frame = rng.chance(50) ? mc::FrameType::E4 : mc::FrameType::E3;
        c.code = rng.chance(50) ? mc::CodeType::Ascii : mc::CodeType::Binary;
        McDeviceConfig d;
        d.id = "d";
        c.devices.push_back(d);
        auto bind = [](size_t tag, mc::Device dev, uint32_t n, TagType t, bool bit) {
            McTagBinding b;
            b.tag = tag;
            b.dev = dev;
            b.number = n;
            b.bitDevice = bit;
            b.words = bit ? 1 : (t == TagType::INT32 ? 2 : 1);
            b.rawType = t;
            return b;
        };
        c.tags = {bind(0, mc::Device::D, 0, TagType::INT16, false),
                  bind(1, mc::Device::D, 5, TagType::INT32, false),
                  bind(2, mc::Device::M, 3, TagType::BOOL, true),
                  bind(3, mc::Device::D, 700, TagType::INT16, false)};
        FakeClock clock;
        FakeMcPlc plc;
        plc.setWord(255, mc::Device::D, 0, 1111);
        plc.setWords(255, mc::Device::D, 5, {0x1234, 0x0001});
        plc.setBit(255, mc::Device::M, 3, true);
        plc.setWord(255, mc::Device::D, 700, 7777);
        conformance::RecordingSink sink;
        McEnv env;
        env.manual = true;
        env.clock = &clock;
        env.uniform = [] { return 0.0; };
        env.sleep = [&clock](int64_t t) { clock.set(t); };
        env.makeTransport = [&] {
            auto t = std::make_unique<McFakeTransport>(plc, clock);
            t->mutateReply = [&rng](McReply& r) {
                if (r.pieces.empty()) return;
                McBytes& f = r.pieces[0];
                switch (rng.below(8)) {
                    case 0:  // damage the header (never the data)
                        if (f.size() > 11) f[rng.below(11)] = rng.byte();
                        break;
                    case 1:
                        f.resize(rng.below(f.size() + 1));
                        break;
                    case 2: {  // pieces
                        McBytes all = f;
                        r.pieces.clear();
                        for (size_t k = 0; k < all.size();) {
                            const size_t n = 1 + rng.below(6);
                            r.pieces.push_back(McBytes(
                                all.begin() + static_cast<long>(k),
                                all.begin() + static_cast<long>(std::min(all.size(), k + n))));
                            k += n;
                        }
                        break;
                    }
                    case 3:
                        r.pieces.clear();  // lost
                        break;
                    case 4:
                        f.insert(f.begin(), rng.byte());
                        break;
                    case 5:
                        r.delayMs = static_cast<int64_t>(rng.below(1500));
                        break;
                    default:
                        break;  // intact
                }
            };
            return std::unique_ptr<Transport>(std::move(t));
        };
        McDriver drv(c, env);
        drv.start(sink);
        drv.pump(clock.monoMs() + 20000);
        drv.stop();
        const TagScalar want[] = {int64_t{1111}, int64_t{0x11234}, true, int64_t{7777}};
        for (const auto& u : sink.all) {
            if (u.quality != Quality::GOOD) continue;
            ASSERT_EQ(u.value, want[u.tag]) << "seed " << seed * 31 + i << " tag " << u.tag;
        }
        ++runs;
    }
    std::printf("fuzz mc driver: %llu runs of 20 s (fake clock), seed %llu\n",
                static_cast<unsigned long long>(runs), static_cast<unsigned long long>(seed));
}
