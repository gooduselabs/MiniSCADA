// Fuzz of the Modbus TCP frames (specs/006 T101; FR-032; research R11). Deterministic generator
// (splitmix64) inside GoogleTest, no sanitizer needed: it mutates valid frames of
// tests/modbus-vectors/frames and checks two targets against a reference written from the
// contract and not from the code under test.
//   1. the pure decoders (splitFrame, checkTcpResponse): they accept exactly the frames the
//      reference accepts, never read outside the bytes they are given;
//   2. the receive state machine of the driver, on a fake transport whose replies are damaged,
//      cut in pieces, delayed or cut off: it never hangs, it makes a Tag GOOD exactly when the
//      reference says the delivered bytes are an answer to the request, with the value in them.
// Duration: MAT_FUZZ_SECONDS (default 60, half for each target); seed: MAT_FUZZ_SEED. The seed of
// the iteration is printed on a failure and replays it.
#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <fstream>
#include <map>
#include <mutex>
#include <thread>

#include "drivers/modbus/mbap.hpp"
#include "drivers/modbus/modbus_tcp_driver.hpp"
#include "drivers/modbus/tests/fake_plc.hpp"
#include "drivers/modbus/tests/tcp_harness.hpp"
#include "nlohmann/json.hpp"

using namespace mat;
using namespace mat::drv;
using namespace mat::testing;
using modbus::Bytes;
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

double fuzzSeconds() {
    const char* e = std::getenv("MAT_FUZZ_SECONDS");
    return e ? std::atof(e) : 60.0;
}

uint64_t baseSeed() {
    const char* e = std::getenv("MAT_FUZZ_SEED");
    return e ? std::strtoull(e, nullptr, 0) : 0x6d41545f46555a5aULL;
}

Bytes bytesOf(const std::string& hex) {
    Bytes out;
    for (size_t i = 0; i < hex.size();) {
        if (hex[i] == ' ') {
            ++i;
            continue;
        }
        out.push_back(static_cast<uint8_t>(std::stoul(hex.substr(i, 2), nullptr, 16)));
        i += 2;
    }
    return out;
}

json loadVectors(const char* file) {
    std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/modbus-vectors/frames/" + file,
                    std::ios::binary);
    return json::parse(f)["cases"];
}

// The mutations of research R11: flip a bit, insert, delete, truncate, duplicate a byte; change the
// length, the byte count, the transaction id, the unit; garbage before or after; twice the frame.
Bytes mutate(Rng& rng, Bytes f) {
    const int rounds = 1 + static_cast<int>(rng.below(3));
    for (int i = 0; i < rounds; ++i) {
        switch (rng.below(13)) {
            case 0:
                if (!f.empty()) f[rng.below(f.size())] ^= static_cast<uint8_t>(1u << rng.below(8));
                break;
            case 1:
                f.insert(f.begin() + static_cast<long>(rng.below(f.size() + 1)), rng.byte());
                break;
            case 2:
                if (!f.empty()) f.erase(f.begin() + static_cast<long>(rng.below(f.size())));
                break;
            case 3:
                f.resize(rng.below(f.size() + 1));
                break;
            case 4:
                if (!f.empty()) {
                    const size_t at = rng.below(f.size());
                    f.insert(f.begin() + static_cast<long>(at), f[at]);
                }
                break;
            case 5:
                if (f.size() > 5) {
                    f[4] = rng.chance(50) ? 0 : rng.byte();
                    f[5] = rng.byte();
                }
                break;
            case 6:
                if (f.size() > 5) f[5] = static_cast<uint8_t>(f[5] + (rng.chance(50) ? 1 : -1));
                break;
            case 7:
                if (f.size() > 8) f[8] = rng.byte();
                break;
            case 8:
                if (f.size() > 1) {
                    f[0] = rng.byte();
                    f[1] = rng.byte();
                }
                break;
            case 9:
                if (f.size() > 6) f[6] = rng.byte();
                break;
            case 10: {
                Bytes g(1 + rng.below(8));
                for (auto& b : g) b = rng.byte();
                f.insert(f.begin(), g.begin(), g.end());
                break;
            }
            case 11: {
                Bytes g(1 + rng.below(8));
                for (auto& b : g) b = rng.byte();
                f.insert(f.end(), g.begin(), g.end());
                break;
            }
            default: {
                const Bytes copy = f;
                f.insert(f.end(), copy.begin(), copy.end());
                break;
            }
        }
    }
    return f;
}

// ---- The reference: the contract of modbus-driver.md §3, written plainly ----------------------

struct Req {
    uint16_t tid = 0;
    uint8_t unit = 0;
    Bytes pdu;
};

enum class Verdict { Reject, Answer, Exception };

// Is `frame` (whole, as cut by the length field) the answer to `r`?
Verdict reference(const Req& r, const Bytes& f) {
    if (f.size() < 8) return Verdict::Reject;
    if (f[0] != (r.tid >> 8) || f[1] != (r.tid & 0xFF)) return Verdict::Reject;
    if (f[2] != 0 || f[3] != 0) return Verdict::Reject;
    if (static_cast<size_t>(f[4]) * 256 + f[5] != f.size() - 6) return Verdict::Reject;
    if (f[6] != r.unit) return Verdict::Reject;
    const size_t n = f.size() - 7;
    const uint8_t fc = r.pdu[0];
    const uint8_t* p = f.data() + 7;
    if (p[0] == (fc | 0x80)) return n == 2 ? Verdict::Exception : Verdict::Reject;
    if (p[0] != fc) return Verdict::Reject;
    const size_t qty = static_cast<size_t>(r.pdu[3]) * 256 + r.pdu[4];
    if (fc == 1 || fc == 2)
        return (n == 2 + (qty + 7) / 8 && p[1] == (qty + 7) / 8) ? Verdict::Answer
                                                                 : Verdict::Reject;
    if (fc == 3 || fc == 4)
        return (n == 2 + qty * 2 && p[1] == qty * 2) ? Verdict::Answer : Verdict::Reject;
    if (fc == 5 || fc == 6 || fc == 22)
        return (n == r.pdu.size() && std::equal(r.pdu.begin(), r.pdu.end(), p)) ? Verdict::Answer
                                                                                : Verdict::Reject;
    if (fc == 15 || fc == 16)
        return (n == 5 && std::equal(r.pdu.begin(), r.pdu.begin() + 5, p)) ? Verdict::Answer
                                                                           : Verdict::Reject;
    return Verdict::Reject;
}

// The frame boundary by the length field only; false: the stream cannot be cut (Lost).
enum class Cut { NeedMore, Frame, Lost };
Cut cut(const Bytes& s, size_t pos, size_t& size) {
    if (s.size() - pos < 6) return Cut::NeedMore;
    const size_t len = static_cast<size_t>(s[pos + 4]) * 256 + s[pos + 5];
    if (len < 2 || len > 254) return Cut::Lost;
    if (s.size() - pos < 6 + len) return Cut::NeedMore;
    size = 6 + len;
    return Cut::Frame;
}

// ---- Target 1: the pure decoders ---------------------------------------------------------------

struct Base {
    Req req;
    Bytes response;
};

std::vector<Base> baseCases() {
    std::vector<Base> out;
    for (const auto& c : loadVectors("mbap.json")) {
        Base b;
        const Bytes rq = bytesOf(c["request"].get<std::string>());
        b.req.tid = static_cast<uint16_t>(c["tid"].get<int>());
        b.req.unit = static_cast<uint8_t>(c["unit"].get<int>());
        b.req.pdu.assign(rq.begin() + 7, rq.end());
        b.response = bytesOf(c["response"].get<std::string>());
        out.push_back(std::move(b));
    }
    for (const auto& c : loadVectors("bad-tcp.json")) {
        Base b;
        b.req.tid = static_cast<uint16_t>(c["request"]["tid"].get<int>());
        b.req.unit = static_cast<uint8_t>(c["request"]["unit"].get<int>());
        b.req.pdu = bytesOf(c["request"]["pdu"].get<std::string>());
        b.response = bytesOf(c["response"].get<std::string>());
        out.push_back(std::move(b));
    }
    return out;
}

}  // namespace

TEST(ModbusFuzz, PureDecodersAgreeWithTheReferenceOnMutatedFrames) {
    const auto bases = baseCases();
    ASSERT_GE(bases.size(), 70u);
    const auto end = std::chrono::steady_clock::now() +
                     std::chrono::milliseconds(static_cast<int64_t>(fuzzSeconds() * 500));
    const uint64_t seed0 = baseSeed();
    uint64_t iter = 0;
    uint64_t accepted = 0;
    do {
        for (int k = 0; k < 500; ++k, ++iter) {
            Rng rng(seed0 ^ (iter * 0x9E3779B97F4A7C15ULL));
            const Base& b = bases[rng.below(bases.size())];
            const Bytes f = rng.chance(5) ? b.response : mutate(rng, b.response);
            const std::string where =
                "seed " + std::to_string(seed0) + " iteration " + std::to_string(iter);
            // the stream cutter: never beyond the bytes, never an impossible frame
            size_t pos = 0;
            for (int guard = 0; guard < 64; ++guard) {
                const modbus::Split s = modbus::splitFrame(f.data() + pos, f.size() - pos);
                size_t refSize = 0;
                const Bytes rest(f.begin() + static_cast<long>(pos), f.end());
                const Cut rc = cut(rest, 0, refSize);
                ASSERT_EQ(static_cast<int>(s.status), static_cast<int>(rc)) << where;
                if (s.status != modbus::SplitStatus::Frame) break;
                ASSERT_EQ(s.size, refSize) << where;
                ASSERT_LE(pos + s.size, f.size()) << where;
                ASSERT_GE(s.size, 8u) << where;
                ASSERT_LE(s.size, 260u) << where;
                pos += s.size;
            }
            // the response check: same verdict as the reference, on every whole-buffer input
            const modbus::AduCheck ck =
                modbus::checkTcpResponse(b.req.tid, b.req.unit, b.req.pdu, f.data(), f.size());
            const Verdict v = reference(b.req, f);
            ASSERT_EQ(ck.issue == modbus::FrameIssue::None, v != Verdict::Reject) << where;
            if (ck.issue == modbus::FrameIssue::None) {
                ++accepted;
                ASSERT_EQ(ck.pdu.kind == modbus::ResponseKind::Exception, v == Verdict::Exception)
                    << where;
                if (ck.pdu.kind == modbus::ResponseKind::Ok) {
                    const Bytes pdu(f.begin() + 7, f.end());
                    if (b.req.pdu[0] == 3 || b.req.pdu[0] == 4) {
                        ASSERT_EQ(modbus::responseRegisters(pdu).size(),
                                  static_cast<size_t>(b.req.pdu[3] * 256 + b.req.pdu[4]))
                            << where;
                    }
                }
            }
        }
    } while (std::chrono::steady_clock::now() < end);
    EXPECT_GT(iter, 1000u);
    EXPECT_GT(accepted, 0u) << "the mutations never left a valid frame: the check would be vacuous";
}

// ---- Target 2: the receive state machine of the driver -----------------------------------------

namespace {

// One run: a driver on a fake PLC whose replies are damaged. Everything that can go wrong is
// reported with the seed.
class DriverFuzz {
   public:
    explicit DriverFuzz(uint64_t seed) : rng_(seed), seed_(seed) {
        auto c = baseConfig();
        for (size_t i = 0; i < 4; ++i)
            c.tags.push_back(bind(i, 0, Area::HR, static_cast<int>(i), TagType::INT16));
        for (size_t i = 0; i < 4; ++i)
            c.tags.push_back(bind(4 + i, 0, Area::C, static_cast<int>(i), TagType::BOOL));
        for (int i = 0; i < 4; ++i) {
            plc_.set(1, Area::HR, i, static_cast<uint16_t>(0x1111 * (i + 1) + rng_.below(7)));
            plc_.set(1, Area::C, i, rng_.chance(50) ? 1 : 0);
        }
        DriverEnv env;
        env.manual = true;
        env.clock = &clock_;
        env.uniform = [] { return 0.0; };
        env.firstTid = [this] { return static_cast<uint16_t>(rng_.below(65536)); };
        env.sleep = [this](int64_t t) { clock_.set(t); };
        env.makeTransport = [this] {
            auto t = std::make_unique<FakeTransport>(plc_, clock_);
            t->onReset = [this] { stream_.clear(), pos_ = 0; };
            t->onWrite = [this](const Bytes& f) { onWrite(f); };
            t->onDelivered = [this](const uint8_t* d, size_t n) { onDelivered(d, n); };
            t->mutateReply = [this](PlcReply& r) { damage(r); };
            return std::unique_ptr<Transport>(std::move(t));
        };
        drv_ = std::make_unique<ModbusTcpDriver>(c, env);
        drv_->start(sink_);
    }
    ~DriverFuzz() { drv_->stop(); }

    void step() {
        drv_->pump(clock_.monoMs() + 1000);
        finalize();
    }
    uint64_t exchanges = 0, answered = 0, goodTags = 0;

   private:
    void fail(const std::string& what) {
        ADD_FAILURE() << what << " (seed " << seed_ << ", exchange " << exchanges << ")";
    }

    void damage(PlcReply& r) {
        if (r.silent || r.close || r.pieces.empty()) return;
        if (rng_.chance(5)) {
            r.close = true;
            return;
        }
        if (rng_.chance(5)) {
            r.silent = true;
            return;
        }
        Bytes whole;
        for (const auto& p : r.pieces) whole.insert(whole.end(), p.begin(), p.end());
        if (rng_.chance(40)) whole = mutate(rng_, whole);
        r.pieces.clear();
        r.gapsMs.clear();
        size_t at = 0;
        while (at < whole.size() || r.pieces.empty()) {
            const size_t n = rng_.chance(50) ? 1 + rng_.below(3) : 1 + rng_.below(whole.size() + 1);
            r.pieces.emplace_back(
                whole.begin() + static_cast<long>(at),
                whole.begin() + static_cast<long>(std::min(whole.size(), at + n)));
            r.gapsMs.push_back(rng_.chance(30) ? static_cast<int64_t>(rng_.below(400)) : 1);
            at += n;
            if (whole.empty()) break;
        }
        if (rng_.chance(5))
            r.delayMs = 800 + static_cast<int64_t>(rng_.below(800));  // around the deadline
    }

    // The previous request is over: what the driver published since must be what the reference
    // says.
    void onWrite(const Bytes& frame) {
        finalize();
        cur_ = Req{};
        cur_.tid = static_cast<uint16_t>((frame[0] << 8) | frame[1]);
        cur_.unit = frame[6];
        cur_.pdu.assign(frame.begin() + 7, frame.end());
        haveCur_ = true;
        resolved_ = Verdict::Reject;
        payload_.clear();
        ++exchanges;
        scan();  // bytes left over from the previous exchange count too
    }
    void onDelivered(const uint8_t* d, size_t n) {
        stream_.insert(stream_.end(), d, d + n);
        scan();
    }
    void scan() {
        while (haveCur_ && resolved_ == Verdict::Reject) {
            size_t size = 0;
            const Cut c = cut(stream_, pos_, size);
            if (c == Cut::NeedMore) return;
            if (c == Cut::Lost) {  // the driver closes the connection: the stream is gone
                stream_.clear();
                pos_ = 0;
                return;
            }
            const Bytes frame(stream_.begin() + static_cast<long>(pos_),
                              stream_.begin() + static_cast<long>(pos_ + size));
            pos_ += size;
            const Verdict v = reference(cur_, frame);
            if (v != Verdict::Reject) {
                resolved_ = v;
                payload_.assign(frame.begin() + 7, frame.end());
            }
        }
    }
    void finalize() {
        std::vector<TagUpdate> ups;
        {
            std::lock_guard<std::mutex> g(sink_.mu);
            ups.swap(sink_.all);
        }
        if (!haveCur_) return;
        std::map<size_t, TagScalar> good;
        for (const auto& u : ups)
            if (u.quality == Quality::GOOD) good[u.tag] = u.value;
        std::map<size_t, TagScalar> want;
        if (resolved_ == Verdict::Answer) {
            const int fc = cur_.pdu[0];
            const int addr = cur_.pdu[1] * 256 + cur_.pdu[2];
            const int qty = cur_.pdu[3] * 256 + cur_.pdu[4];
            if (fc == 3) {
                for (int i = 0; i < qty; ++i) {
                    const uint16_t reg =
                        static_cast<uint16_t>(payload_[2 + 2 * i] * 256 + payload_[3 + 2 * i]);
                    want[static_cast<size_t>(addr + i)] =
                        static_cast<int64_t>(static_cast<int16_t>(reg));
                }
            } else if (fc == 1) {
                for (int i = 0; i < qty; ++i)
                    want[static_cast<size_t>(4 + addr + i)] =
                        ((payload_[2 + i / 8] >> (i % 8)) & 1) != 0;
            }
            ++answered;
        }
        if (good != want) {
            fail("the driver made Tags GOOD " + std::to_string(good.size()) +
                 " but the reference accepts an answer for " + std::to_string(want.size()));
            for (const auto& [t, v] : want)
                if (!good.count(t) || good[t] != v)
                    fail("Tag " + std::to_string(t) +
                         " should be GOOD with the value in the answer");
            for (const auto& [t, v] : good)
                if (!want.count(t))
                    fail("Tag " + std::to_string(t) +
                         " is GOOD without an answer that matches the request");
        }
        goodTags += good.size();
        haveCur_ = false;
    }

    Rng rng_;
    uint64_t seed_;
    FakeClock clock_;
    FakePlc plc_;
    conformance::RecordingSink sink_;
    std::unique_ptr<ModbusTcpDriver> drv_;
    Bytes stream_;
    size_t pos_ = 0;
    Req cur_;
    bool haveCur_ = false;
    Verdict resolved_ = Verdict::Reject;
    Bytes payload_;
};

}  // namespace

TEST(ModbusFuzz, DriverReceiveStateMachineNeverHangsAndOnlyTakesAnswersToItsRequest) {
    const double seconds = fuzzSeconds() * 0.5;
    const uint64_t seed0 = baseSeed();
    std::atomic<uint64_t> progress{0};
    std::atomic<uint64_t> iteration{0};
    std::atomic<bool> done{false};
    std::mutex mu;
    std::condition_variable cv;
    uint64_t exchanges = 0, answered = 0;
    std::thread worker([&] {
        const auto end = std::chrono::steady_clock::now() +
                         std::chrono::milliseconds(static_cast<int64_t>(seconds * 1000));
        uint64_t run = 0;
        do {
            // a fresh driver and PLC per run of 2.000 simulated seconds, its own seed
            const uint64_t seed = seed0 ^ (run++ * 0xD1B54A32D192ED03ULL);
            iteration = run;
            DriverFuzz f(seed);
            for (int i = 0; i < 2000; ++i) {
                f.step();
                ++progress;
            }
            exchanges += f.exchanges;
            answered += f.answered;
        } while (std::chrono::steady_clock::now() < end);
        done = true;
        cv.notify_all();
    });
    // The watchdog: no input may keep the loop for long (a hang would end the run silently).
    uint64_t last = 0;
    for (;;) {
        std::unique_lock<std::mutex> l(mu);
        if (cv.wait_for(l, std::chrono::seconds(10), [&] { return done.load(); })) break;
        if (progress.load() == last) {
            ADD_FAILURE() << "the driver hangs (seed " << seed0 << ", run " << iteration.load()
                          << ")";
            std::fflush(stderr);
            std::_Exit(1);
        }
        last = progress.load();
    }
    worker.join();
    EXPECT_GT(exchanges, 1000u);
    EXPECT_GT(answered, 100u) << "too few answers got through: the check would be vacuous";
}
