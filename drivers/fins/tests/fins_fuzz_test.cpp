// Timed fuzz of the FINS decoders and driver (feature 018, T023; core/common/tests/fuzz_util.hpp):
// mutated responses, TCP streams and addresses never crash a decoder or break its invariants, and
// the driver fed mutated answers never hangs. MAT_FUZZ_SECONDS (5 s by default, 20 s under the
// sanitizer run of ctest); tools/fuzz/cpp/run.sh runs it for an hour under ASan + UBSan.
#include <gtest/gtest.h>

#include <chrono>
#include <cstdio>

#include "core/common/tests/fuzz_util.hpp"
#include "drivers/fins/address.hpp"
#include "drivers/fins/fins_driver.hpp"
#include "drivers/fins/frame.hpp"
#include "drivers/fins/tests/fake_fins_plc.hpp"
#include "drivers/sdk/tests/driver_conformance.hpp"

GTEST_ALLOW_UNINSTANTIATED_PARAMETERIZED_TEST(DriverConformance);

namespace {

using mat::fins::Bytes;
using mat::fuzz::Rng;

Bytes mutateBytes(Bytes b, Rng& r) {
    const int ops = 1 + static_cast<int>(r.below(4));
    for (int k = 0; k < ops; ++k) {
        const size_t at = r.below(b.size() + 1);
        switch (r.below(6)) {
            case 0:
                if (!b.empty()) b[r.below(b.size())] ^= static_cast<uint8_t>(1u << r.below(8));
                break;
            case 1:
                if (!b.empty()) b[r.below(b.size())] = static_cast<uint8_t>(r.next());
                break;
            case 2:
                b.resize(r.below(b.size() + 1));
                break;
            case 3:
                b.insert(b.begin() + static_cast<long>(at), static_cast<uint8_t>(r.next()));
                break;
            case 4: {
                const size_t n = r.below(3000);
                b.insert(b.begin() + static_cast<long>(at), n, static_cast<uint8_t>(r.next()));
                break;
            }
            default:
                if (b.size() >= 8) {  // a length field to the edges
                    static const uint32_t kLens[] = {0, 7, 8, 9, 2020, 2021, 0xFFFFFFFF};
                    const uint32_t v = kLens[r.below(7)];
                    for (int s = 0; s < 4; ++s) b[4 + s] = static_cast<uint8_t>(v >> (24 - 8 * s));
                }
                break;
        }
    }
    return b;
}

const Bytes kSeeds[] = {
    {0xC0, 0x00, 0x02, 0x00, 0x05, 0x00, 0x00, 0x0A, 0x00, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00,
     0x01},
    {0xC0, 0x00, 0x02, 0x00, 0x05, 0x00, 0x00, 0x0A, 0x00, 0x06, 0x01,
     0x04, 0x00, 0x00, 0x82, 0x00, 0x2A, 0x30, 0x01, 0x89, 0x01, 0xF4},
    {'F', 'I', 'N', 'S', 0, 0, 0, 0x10, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 10},
    {'F', 'I',  'N',  'S',  0,    0,    0,    0x16, 0,    0,    0,    2,    0,    0,    0,
     0,   0xC0, 0x00, 0x02, 0x00, 0x05, 0x00, 0x00, 0x0A, 0x00, 0x01, 0x01, 0x01, 0x00, 0x00},
};

TEST(FinsFuzz, DecodersKeepTheirInvariantsOnMutatedBytes) {
    const double seconds = mat::fuzz::budgetSeconds(5.0) * 0.5;
    const mat::fuzz::Deadline end(seconds);
    Rng r{mat::fuzz::baseSeed()};
    const std::vector<mat::fins::MultiItem> items = {{0x82, 100, 0}, {0x30, 10, 3}, {0x89, 5, 0}};
    uint64_t n = 0;
    while (!end.passed()) {
        const Bytes b = mutateBytes(kSeeds[r.below(4)], r);
        ++n;
        SCOPED_TRACE("case " + std::to_string(n));
        const mat::fins::Response resp = mat::fins::parseResponse(b.data(), b.size());
        if (resp.issue == mat::fins::FrameIssue::None) {
            ASSERT_GE(b.size(), 14u);
            ASSERT_LE(b.size(), mat::fins::kMaxFrame);
            ASSERT_EQ(resp.data.size(), b.size() - 14);
            ASSERT_EQ(resp.endCode & 0x80C0, 0);
            std::vector<uint16_t> v;
            if (mat::fins::readData(resp.data, true, resp.data.size() / 2, v)) {
                ASSERT_EQ(v.size() * 2, resp.data.size());
            }
            if (mat::fins::multipleReadData(resp.data, items, v)) {
                ASSERT_EQ(v.size(), items.size());
            }
            (void)mat::fins::checkResponse(resp, {0, 10, 0}, {0, 5, 0}, 1, 0x0101);
            (void)mat::fins::controllerModel(resp.data);
        }
        const mat::fins::TcpMessage m = mat::fins::splitTcp(b.data(), b.size());
        if (m.status == mat::fins::TcpSplit::Message) {
            ASSERT_GE(m.size, 16u);
            ASSERT_LE(m.size, b.size());
            ASSERT_LE(m.size, mat::fins::kTcpHeaderSize + mat::fins::kMaxFrame);
            uint32_t c = 0, s = 0;
            (void)mat::fins::tcpNodeResponse(b.data(), m.size, c, s);
        }
        const std::string text(b.begin(), b.end());
        mat::fins::AddressOptions o;
        o.rawType = static_cast<mat::TagType>(r.below(10));
        o.stringLength = static_cast<int>(r.below(300));
        o.rw = r.chance(50);
        const mat::fins::Address a = mat::fins::parseAddress(text.substr(0, 20), o);
        if (a.ok) {
            ASSERT_GE(a.offset, 0);
            ASSERT_LE(a.offset + std::max(1, a.words) - 1, mat::fins::areaMax(a.area));
            ASSERT_TRUE(a.bit >= -1 && a.bit <= 15);
        }
    }
    std::printf("fins decoders: %llu cases\n", static_cast<unsigned long long>(n));
}

// A link whose answers are the fake PLC's, mutated now and then.
class MutatingTransport : public mat::drv::Transport {
   public:
    MutatingTransport(mat::testing::FakeFinsPlc& plc, mat::testing::FinsClock& clock, bool tcp,
                      Rng& r)
        : inner_(plc, clock, tcp), r_(r) {}
    mat::drv::ConnectCode connect(const std::string& h, int p, int t) override {
        return inner_.connect(h, p, t);
    }
    bool isOpen() const override { return inner_.isOpen(); }
    void close() override { inner_.close(); }
    bool peerClosed() override { return inner_.peerClosed(); }
    size_t discardInput() override { return 0; }
    bool writeAll(const uint8_t* d, size_t n, int t) override { return inner_.writeAll(d, n, t); }
    mat::drv::ReadResult read(uint8_t* buf, size_t max, int timeoutMs) override {
        mat::drv::ReadResult rr = inner_.read(buf, max, timeoutMs);
        if (rr.code != mat::drv::ReadCode::Data || !r_.chance(30)) return rr;
        Bytes b(buf, buf + rr.n);
        b = mutateBytes(b, r_);
        b.resize(std::min(b.size(), max));
        std::copy(b.begin(), b.end(), buf);
        rr.n = b.size();
        return rr;
    }
    void interrupt() override {}
    void clearInterrupt() override {}
    uint64_t bytesSent() const override { return 0; }
    uint64_t bytesReceived() const override { return 0; }

   private:
    mat::testing::FakeFinsTransport inner_;
    Rng& r_;
};

TEST(FinsFuzz, DriverNeverHangsOnMutatedAnswers) {
    const double seconds = mat::fuzz::budgetSeconds(5.0) * 0.5;
    const mat::fuzz::Deadline end(seconds);
    Rng r{mat::fuzz::baseSeed() + 1};
    uint64_t rounds = 0;
    while (!end.passed()) {
        const bool tcp = r.chance(50);
        mat::testing::FinsClock clock;
        mat::testing::FakeFinsPlc plc;
        mat::drv::FinsConfig c;
        c.channelId = "fz";
        c.host = "10.0.0.1";
        c.tcp = tcp;
        c.sourceNode = tcp ? 0 : 5;
        mat::drv::FinsDeviceConfig d;
        d.id = "plc";
        d.node = tcp ? 0 : 10;
        c.devices.push_back(d);
        const char* addrs[] = {"D0", "D1", "D2.03", "CIO5", "T3", "E1_10", "W7.15", "D500"};
        const mat::TagType types[] = {
            mat::TagType::UINT16, mat::TagType::INT32,   mat::TagType::BOOL, mat::TagType::INT16,
            mat::TagType::BOOL,   mat::TagType::FLOAT32, mat::TagType::BOOL, mat::TagType::FLOAT64};
        for (size_t i = 0; i < 8; ++i) {
            mat::drv::FinsTagBinding b;
            b.tag = i;
            mat::fins::AddressOptions o;
            o.rawType = types[i];
            b.addr = mat::fins::parseAddress(addrs[i], o);
            ASSERT_TRUE(b.addr.ok);
            b.rawType = types[i];
            c.tags.push_back(b);
        }
        mat::drv::FinsEnv env;
        env.manual = true;
        env.clock = &clock;
        env.uniform = [] { return 0.0; };
        env.sleep = [&clock](int64_t t) { clock.set(t); };
        env.makeTransport = [&] {
            return std::unique_ptr<mat::drv::Transport>(new MutatingTransport(plc, clock, tcp, r));
        };
        mat::drv::FinsDriver drv(c, env);
        mat::drv::conformance::RecordingSink sink;
        drv.start(sink);
        const auto wallStart = std::chrono::steady_clock::now();
        drv.pump(clock.monoMs() + 60000);
        const auto took = std::chrono::steady_clock::now() - wallStart;
        ASSERT_LT(std::chrono::duration_cast<std::chrono::seconds>(took).count(), 5)
            << "round " << rounds;
        drv.stop();
        ++rounds;
    }
    std::printf("fins driver: %llu rounds of 60 s\n", static_cast<unsigned long long>(rounds));
}

}  // namespace
