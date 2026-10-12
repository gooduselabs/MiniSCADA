// Modbus RTU frames on the shared vectors (tests/modbus-vectors/frames): CRC, encoder, expected
// length, timing, the check of a response (bad-rtu), and the receiver on a fake clock and a fake
// byte source. specs/006 T157; contracts/modbus-driver.md §3.
#include "drivers/modbus/rtu_frame.hpp"

#include <gtest/gtest.h>

#include <cmath>
#include <cstdint>
#include <deque>
#include <fstream>
#include <string>
#include <vector>

#include "drivers/modbus/address.hpp"
#include "drivers/modbus/pdu.hpp"
#include "drivers/modbus/tests/fake_plc.hpp"  // FakeClock
#include "nlohmann/json.hpp"

using nlohmann::json;
using namespace mat;
using namespace mat::modbus;

namespace {

json load(const char* file) {
    std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/modbus-vectors/frames/" + file,
                    std::ios::binary);
    return json::parse(f);
}

Bytes bytesOf(const std::string& hex) {
    Bytes out;
    size_t i = 0;
    while (i < hex.size()) {
        if (hex[i] == ' ') {
            ++i;
            continue;
        }
        out.push_back(static_cast<uint8_t>(std::stoul(hex.substr(i, 2), nullptr, 16)));
        i += 2;
    }
    return out;
}

// A byte source with a script: (time since the read began or the previous event, bytes).
class ScriptSource : public drv::Transport {
   public:
    struct Event {
        int64_t atMs;  // absolute, on the fake clock
        Bytes bytes;
        int code = 0;  // 0 data, 1 closed, 2 interrupted
    };
    explicit ScriptSource(mat::testing::FakeClock& clock) : clock_(clock) {}
    void at(int64_t ms, Bytes b) { events_.push_back({clock_.monoMs() + ms, std::move(b), 0}); }
    void closeAt(int64_t ms) { events_.push_back({clock_.monoMs() + ms, {}, 1}); }

    drv::ConnectCode connect(const std::string&, int, int) override { return drv::ConnectCode::Ok; }
    bool isOpen() const override { return true; }
    void close() override {}
    bool peerClosed() override { return false; }
    size_t discardInput() override { return 0; }
    bool writeAll(const uint8_t*, size_t, int) override { return true; }
    drv::ReadResult read(uint8_t* buf, size_t max, int timeoutMs) override {
        const int64_t deadline = clock_.monoMs() + timeoutMs;
        if (events_.empty() || events_.front().atMs > deadline) {
            clock_.set(deadline);
            return {drv::ReadCode::Timeout, 0};
        }
        Event e = events_.front();
        events_.pop_front();
        clock_.set(e.atMs);
        if (e.code == 1) return {drv::ReadCode::Closed, 0};
        const size_t n = std::min(max, e.bytes.size());
        std::copy(e.bytes.begin(), e.bytes.begin() + static_cast<long>(n), buf);
        if (n < e.bytes.size()) {
            e.bytes.erase(e.bytes.begin(), e.bytes.begin() + static_cast<long>(n));
            events_.push_front(e);
        }
        return {drv::ReadCode::Data, n};
    }
    void interrupt() override {}
    void clearInterrupt() override {}
    uint64_t bytesSent() const override { return 0; }
    uint64_t bytesReceived() const override { return 0; }

   private:
    mat::testing::FakeClock& clock_;
    std::deque<Event> events_;
};

const Bytes kFrame = bytesOf("11 03 06 02 2B 00 00 00 64 C8 BA");  // 11 bytes

}  // namespace

TEST(RtuCrc, MatchesTheVectors) {
    const json cases = load("crc.json")["cases"];
    ASSERT_GE(cases.size(), 40u);
    for (const auto& c : cases) {
        const Bytes data = bytesOf(c["data"]);
        const Bytes want = bytesOf(c["crc"]);
        const uint16_t crc = crc16(data.data(), data.size());
        EXPECT_EQ(crc & 0xFF, want[0]) << c["name"];  // the low byte goes first
        EXPECT_EQ(crc >> 8, want[1]) << c["name"];
    }
}

TEST(RtuFrame, EncoderMatchesTheVectors) {
    const json cases = load("rtu.json")["cases"];
    ASSERT_GE(cases.size(), 30u);
    for (const auto& c : cases) {
        const Bytes req = bytesOf(c["request"]);
        // the PDU is between the address and the CRC
        const Bytes pdu(req.begin() + 1, req.end() - 2);
        EXPECT_EQ(encodeRtu(static_cast<uint8_t>(c["unit"].get<int>()), pdu), req) << c["name"];
        // and the response of the vector passes the check as the answer to this request
        const Bytes resp = bytesOf(c["response"]);
        const RtuCheck ck = checkRtuResponse(static_cast<uint8_t>(c["unit"].get<int>()), pdu,
                                             resp.data(), resp.size());
        EXPECT_EQ(ck.issue, RtuIssue::None) << c["name"] << " " << rtuIssueName(ck.issue);
    }
}

TEST(RtuFrame, ExpectedLengthMatchesTheVectors) {
    const json cases = load("rtu-length.json")["cases"];
    ASSERT_GE(cases.size(), 30u);
    for (const auto& c : cases) {
        const Bytes head = bytesOf(c["head"]);
        const size_t want = c["expected"].get<size_t>();
        EXPECT_EQ(rtuExpectedLength(head.data(), head.size()), want) << c["name"];
    }
    // not enough bytes yet
    const uint8_t one[] = {0x11};
    EXPECT_EQ(rtuExpectedLength(one, 1), kRtuNeedMore);
    const uint8_t two[] = {0x11, 0x03};
    EXPECT_EQ(rtuExpectedLength(two, 2), kRtuNeedMore);  // a read: the byte count is not there yet
    const uint8_t w[] = {0x11, 0x06};
    EXPECT_EQ(rtuExpectedLength(w, 2), 8u);  // a write needs nothing more
    const uint8_t bad[] = {0x11, 0x2B, 0x00};
    EXPECT_EQ(rtuExpectedLength(bad, 3), kRtuBadFunction);
}

TEST(RtuFrame, ResponseChecksMatchTheVectors) {
    const json cases = load("bad-rtu.json")["cases"];
    ASSERT_GE(cases.size(), 30u);
    for (const auto& c : cases) {
        const Bytes pdu = bytesOf(c["request"]["pdu"]);
        const Bytes resp = bytesOf(c["response"]);
        const RtuCheck ck = checkRtuResponse(static_cast<uint8_t>(c["request"]["unit"].get<int>()),
                                             pdu, resp.data(), resp.size());
        if (c["expect"].is_string()) {
            EXPECT_EQ(ck.issue, RtuIssue::None) << c["name"];
            continue;
        }
        EXPECT_EQ(std::string(rtuIssueName(ck.issue)), c["expect"]["kind"].get<std::string>())
            << c["name"];
        const std::string counter = c["expect"]["counter"];
        const drv::BadFrameKind k = rtuIssueCounter(ck.issue);
        const char* name = k == drv::BadFrameKind::Crc
                               ? "crc"
                               : k == drv::BadFrameKind::Unit
                                     ? "unit"
                                     : k == drv::BadFrameKind::Length
                                           ? "length"
                                           : k == drv::BadFrameKind::Echo ? "echo" : "format";
        EXPECT_EQ(std::string(name), counter) << c["name"];
    }
}

TEST(RtuTiming, CharacterAndSilenceMatchTheVectors) {
    const json cases = load("rtu-timing.json")["cases"];
    ASSERT_GE(cases.size(), 40u);
    for (const auto& c : cases) {
        const std::string par = c["parity"];
        const char parity = par == "none" ? 'N' : (par == "even" ? 'E' : 'O');
        const int bits = rtuCharBits(c["dataBits"], parity, c["stopBits"]);
        EXPECT_EQ(bits, c["charBits"].get<int>()) << c["name"];
        EXPECT_NEAR(rtuT35Ms(c["baud"], bits), c["t35Ms"].get<double>(), 1e-6) << c["name"];
    }
    // 9,600 8E1 = 4.0 ms (contract: 4.01); the silence is whole milliseconds, never below t3.5
    EXPECT_NEAR(rtuT35Ms(9600, rtuCharBits(8, 'E', 1)), 4.0, 0.02);
    EXPECT_EQ(rtuSilenceMs(9600, 8, 'E', 1, 0), 5);
    EXPECT_EQ(rtuSilenceMs(115200, 8, 'N', 1, 0), 2);
    EXPECT_EQ(rtuSilenceMs(9600, 8, 'E', 1, 10), 10);  // a larger `silenceMs` wins
    EXPECT_EQ(rtuSilenceMs(9600, 8, 'E', 1, 1), 5);    // a smaller one is lifted to t3.5
    EXPECT_EQ(rtuGapMs(4), 20);                        // gapFloor
    EXPECT_EQ(rtuGapMs(32), 32);
}

TEST(RtuReceive, WholeFrameInOneRead) {
    mat::testing::FakeClock clock;
    ScriptSource src(clock);
    src.at(5, kFrame);
    const RtuReceive r = rtuReceive(src, clock, clock.monoMs() + 1000, 20, 4);
    EXPECT_EQ(r.status, RtuReceive::Status::Frame);
    EXPECT_EQ(r.bytes, kFrame);
}

TEST(RtuReceive, FrameInPiecesWithinTheGap) {
    mat::testing::FakeClock clock;
    ScriptSource src(clock);
    src.at(5, Bytes(kFrame.begin(), kFrame.begin() + 3));
    src.at(10, Bytes(kFrame.begin() + 3, kFrame.begin() + 7));
    src.at(15, Bytes(kFrame.begin() + 7, kFrame.end()));
    const RtuReceive r = rtuReceive(src, clock, clock.monoMs() + 1000, 20, 4);
    EXPECT_EQ(r.status, RtuReceive::Status::Frame);
    EXPECT_EQ(r.bytes, kFrame);
}

TEST(RtuReceive, GapLongerThanTheLimitMidFrameIsShort) {
    mat::testing::FakeClock clock;
    ScriptSource src(clock);
    src.at(5, Bytes(kFrame.begin(), kFrame.begin() + 6));
    src.at(60, Bytes(kFrame.begin() + 6, kFrame.end()));  // 55 ms later: too late
    const RtuReceive r = rtuReceive(src, clock, clock.monoMs() + 1000, 20, 4);
    EXPECT_EQ(r.status, RtuReceive::Status::Short);
    EXPECT_EQ(r.bytes.size(), 6u);
}

TEST(RtuReceive, ByteAfterTheFrameMakesItExtra) {
    mat::testing::FakeClock clock;
    ScriptSource src(clock);
    Bytes more = kFrame;
    more.push_back(0xFF);
    src.at(5, more);
    EXPECT_EQ(rtuReceive(src, clock, clock.monoMs() + 1000, 20, 4).status,
              RtuReceive::Status::Extra);
    // the extra byte comes after a pause shorter than the silence of the frame's end
    mat::testing::FakeClock clock2;
    ScriptSource src2(clock2);
    src2.at(5, kFrame);
    src2.at(7, Bytes{0x00});
    const RtuReceive r2 = rtuReceive(src2, clock2, clock2.monoMs() + 1000, 20, 4);
    EXPECT_EQ(r2.status, RtuReceive::Status::Extra);
    EXPECT_EQ(r2.bytes.size(), kFrame.size() + 1);
}

TEST(RtuReceive, ByteAfterTheSilenceBelongsToTheNextFrame) {
    mat::testing::FakeClock clock;
    ScriptSource src(clock);
    src.at(5, kFrame);
    src.at(30, Bytes{0x00});  // 25 ms after the end: past t3.5, the frame is already complete
    const RtuReceive r = rtuReceive(src, clock, clock.monoMs() + 1000, 20, 4);
    EXPECT_EQ(r.status, RtuReceive::Status::Frame);
    EXPECT_EQ(r.bytes, kFrame);
}

TEST(RtuReceive, NothingBeforeTheDeadlineIsTimeout) {
    mat::testing::FakeClock clock;
    ScriptSource src(clock);
    const int64_t deadline = clock.monoMs() + 300;
    const RtuReceive r = rtuReceive(src, clock, deadline, 20, 4);
    EXPECT_EQ(r.status, RtuReceive::Status::Timeout);
    EXPECT_TRUE(r.bytes.empty());
    EXPECT_EQ(clock.monoMs(), deadline);
}

TEST(RtuReceive, UnknownFunctionIsFormat) {
    mat::testing::FakeClock clock;
    ScriptSource src(clock);
    src.at(5, bytesOf("11 2B 00 01 02 03"));
    EXPECT_EQ(rtuReceive(src, clock, clock.monoMs() + 1000, 20, 4).status,
              RtuReceive::Status::Format);
}

TEST(RtuReceive, ExceptionFrameIsFiveBytes) {
    mat::testing::FakeClock clock;
    ScriptSource src(clock);
    src.at(3, bytesOf("11 83 02 C1 34"));
    const RtuReceive r = rtuReceive(src, clock, clock.monoMs() + 1000, 20, 4);
    EXPECT_EQ(r.status, RtuReceive::Status::Frame);
    EXPECT_EQ(r.bytes.size(), 5u);
}

TEST(RtuReceive, CarryIsTheStartOfTheFrame) {
    mat::testing::FakeClock clock;
    ScriptSource src(clock);
    src.at(5, Bytes(kFrame.begin() + 4, kFrame.end()));
    const RtuReceive r = rtuReceive(src, clock, clock.monoMs() + 1000, 20, 4,
                                    Bytes(kFrame.begin(), kFrame.begin() + 4));
    EXPECT_EQ(r.status, RtuReceive::Status::Frame);
    EXPECT_EQ(r.bytes, kFrame);
}

TEST(RtuReceive, ClosedPassesThrough) {
    mat::testing::FakeClock clock;
    ScriptSource src(clock);
    src.closeAt(5);
    EXPECT_EQ(rtuReceive(src, clock, clock.monoMs() + 1000, 20, 4).status,
              RtuReceive::Status::Closed);
}
