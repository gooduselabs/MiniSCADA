// Modbus TCP frames on the shared vectors (tests/modbus-vectors/frames): the request encoders byte
// by byte, the response checks of FR-032 (transaction id, protocol id, length, unit, function or
// function | 0x80, byte count, echoed fields) and the stream splitter. specs/006 T093.
#include <gtest/gtest.h>

#include <cstdint>
#include <fstream>
#include <string>
#include <vector>

#include "drivers/modbus/codec.hpp"
#include "drivers/modbus/exceptions.hpp"
#include "drivers/modbus/mbap.hpp"
#include "drivers/modbus/pdu.hpp"
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

int u16(const Bytes& b, size_t at) { return (b[at] << 8) | b[at + 1]; }

// The request PDU of a vector rebuilt from its fields with the encoders.
Bytes rebuild(const Bytes& req) {
    switch (req[0]) {
        case 1:
        case 2:
        case 3:
        case 4:
            return readRequest(req[0], u16(req, 1), u16(req, 3));
        case 5:
            return writeSingleCoil(u16(req, 1), u16(req, 3) == 0xFF00);
        case 6:
            return writeSingleRegister(u16(req, 1), static_cast<uint16_t>(u16(req, 3)));
        case 15: {
            const Bytes data(req.begin() + 6, req.end());
            return writeMultipleCoils(u16(req, 1),
                                      unpackBits(data, static_cast<size_t>(u16(req, 3))));
        }
        case 16: {
            std::vector<uint16_t> regs;
            for (size_t i = 6; i + 1 < req.size(); i += 2)
                regs.push_back(static_cast<uint16_t>(u16(req, i)));
            return writeMultipleRegisters(u16(req, 1), regs);
        }
        case 22:
            return maskWriteRegister(u16(req, 1), static_cast<uint16_t>(u16(req, 3)),
                                     static_cast<uint16_t>(u16(req, 5)));
    }
    return {};
}

}  // namespace

TEST(ModbusPdu, RequestsMatchTheVectorsByteForByte) {
    const json cases = load("pdu.json")["cases"];
    ASSERT_GE(cases.size(), 30u);
    for (const auto& c : cases) {
        const Bytes req = bytesOf(c["request"].get<std::string>());
        EXPECT_EQ(rebuild(req), req) << c["name"];
    }
}

TEST(ModbusPdu, CorrectResponsesPassTheCheckAndGiveTheirData) {
    for (const auto& c : load("pdu.json")["cases"]) {
        const Bytes req = bytesOf(c["request"].get<std::string>());
        const Bytes resp = bytesOf(c["response"].get<std::string>());
        const PduCheck pc = checkResponsePdu(req, resp.data(), resp.size());
        EXPECT_EQ(pc.kind, ResponseKind::Ok) << c["name"];
        if (req[0] == 3 || req[0] == 4) {
            const auto regs = responseRegisters(resp);
            ASSERT_EQ(regs.size(), static_cast<size_t>(u16(req, 3))) << c["name"];
            EXPECT_EQ(regs[0], u16(resp, 2)) << c["name"];
        }
        if (req[0] == 1 || req[0] == 2) {
            const auto bits = responseBits(resp, static_cast<size_t>(u16(req, 3)));
            ASSERT_EQ(bits.size(), static_cast<size_t>(u16(req, 3))) << c["name"];
            EXPECT_EQ(bits[0], resp[2] & 1) << c["name"];
        }
    }
}

TEST(ModbusPdu, ExceptionResponsesGiveTheirCode) {
    const json cases = load("exceptions.json")["cases"];
    ASSERT_GE(cases.size(), 100u);
    for (const auto& c : cases) {
        const int fc = c["fc"].get<int>();
        const Bytes req =
            fc == 15 ? bytesOf("0F 00 13 00 0A 02 CD 01")
                     : (fc == 16 ? bytesOf("10 00 01 00 01 02 00 0A")
                                 : (fc == 22 ? bytesOf("16 00 04 00 F2 00 25")
                                             : bytesOf("0" + std::to_string(fc) + " 00 01 00 01")));
        const Bytes pdu = bytesOf(c["pdu"].get<std::string>());
        const PduCheck pc = checkResponsePdu(req, pdu.data(), pdu.size());
        EXPECT_EQ(pc.kind, ResponseKind::Exception) << c["name"];
        EXPECT_EQ(pc.exception, c["code"].get<int>()) << c["name"];
    }
}

TEST(ModbusPdu, QuantityLimitsOfTheVectors) {
    const json cases = load("limits.json")["cases"];
    ASSERT_GE(cases.size(), 40u);
    for (const auto& c : cases)
        EXPECT_EQ(validQuantity(c["fc"].get<int>(), c["qty"].get<int>()), c["valid"].get<bool>())
            << c["name"];
}

TEST(ModbusPdu, EncodersRefuseWhatTheLimitsRefuse) {
    EXPECT_TRUE(readRequest(3, 0, 126).empty());
    EXPECT_TRUE(readRequest(1, 0, 2001).empty());
    EXPECT_TRUE(readRequest(5, 0, 1).empty());  // not a read function
    EXPECT_TRUE(writeMultipleRegisters(0, std::vector<uint16_t>(124)).empty());
    EXPECT_TRUE(writeMultipleRegisters(0, {}).empty());
    EXPECT_TRUE(writeMultipleCoils(0, std::vector<uint8_t>(1969, 1)).empty());
    EXPECT_FALSE(writeMultipleRegisters(0, std::vector<uint16_t>(123)).empty());
    EXPECT_FALSE(writeMultipleCoils(0, std::vector<uint8_t>(1968, 1)).empty());
}

TEST(ModbusMbap, AdusMatchTheVectors) {
    const json cases = load("mbap.json")["cases"];
    ASSERT_GE(cases.size(), 30u);
    const json pdus = load("pdu.json")["cases"];
    for (size_t i = 0; i < cases.size(); ++i) {
        const auto& c = cases[i];
        const Bytes req = bytesOf(c["request"].get<std::string>());
        const Bytes resp = bytesOf(c["response"].get<std::string>());
        const Bytes pdu(req.begin() + 7, req.end());
        const uint16_t tid = static_cast<uint16_t>(c["tid"].get<int>());
        const uint8_t unit = static_cast<uint8_t>(c["unit"].get<int>());
        EXPECT_EQ(encodeAdu(tid, unit, pdu), req) << c["name"];
        EXPECT_LE(req.size(), 260u) << c["name"];
        EXPECT_LE(resp.size(), 260u) << c["name"];
        const AduCheck ck = checkTcpResponse(tid, unit, pdu, resp.data(), resp.size());
        EXPECT_EQ(ck.issue, FrameIssue::None) << c["name"];
    }
}

TEST(ModbusMbap, WrongResponsesGiveTheKindAndCounterOfTheVectors) {
    const json cases = load("bad-tcp.json")["cases"];
    ASSERT_GE(cases.size(), 35u);
    int bad = 0;
    for (const auto& c : cases) {
        const auto& rq = c["request"];
        const Bytes pdu = bytesOf(rq["pdu"].get<std::string>());
        const Bytes resp = bytesOf(c["response"].get<std::string>());
        const AduCheck ck = checkTcpResponse(static_cast<uint16_t>(rq["tid"].get<int>()),
                                             static_cast<uint8_t>(rq["unit"].get<int>()), pdu,
                                             resp.data(), resp.size());
        const auto& expect = c["expect"];
        if (expect.is_string()) {
            EXPECT_EQ(ck.issue, FrameIssue::None) << c["name"];
            continue;
        }
        ++bad;
        EXPECT_EQ(std::string(frameIssueName(ck.issue)), expect["kind"].get<std::string>())
            << c["name"];
        const std::string counter = expect["counter"].get<std::string>();
        const auto k = frameIssueCounter(ck.issue);
        const char* got = k == drv::BadFrameKind::Tid
                              ? "tid"
                              : k == drv::BadFrameKind::Unit
                                    ? "unit"
                                    : k == drv::BadFrameKind::Length
                                          ? "length"
                                          : k == drv::BadFrameKind::Crc
                                                ? "crc"
                                                : k == drv::BadFrameKind::Echo ? "echo" : "format";
        EXPECT_EQ(counter, got) << c["name"];
    }
    EXPECT_GE(bad, 30);
}

TEST(ModbusMbap, ResponseMustBeExactlyAsLongAsTheHeaderSays) {
    const Bytes pdu = bytesOf("03 00 6B 00 03");
    Bytes ok = bytesOf("12 34 00 00 00 09 11 03 06 02 2B 00 00 00 64");
    EXPECT_EQ(checkTcpResponse(0x1234, 17, pdu, ok.data(), ok.size()).issue, FrameIssue::None);
    ok.push_back(0);
    EXPECT_EQ(checkTcpResponse(0x1234, 17, pdu, ok.data(), ok.size()).issue, FrameIssue::Length);
}

TEST(ModbusMbap, ExceptionResponseIsAValidAnswer) {
    const Bytes pdu = bytesOf("03 00 6B 00 03");
    const Bytes r = bytesOf("12 34 00 00 00 03 11 83 02");
    const AduCheck ck = checkTcpResponse(0x1234, 17, pdu, r.data(), r.size());
    EXPECT_EQ(ck.issue, FrameIssue::None);
    EXPECT_EQ(ck.pdu.kind, ResponseKind::Exception);
    EXPECT_EQ(ck.pdu.exception, 2);
}

TEST(ModbusMbap, SplitterCutsTheStreamByTheLengthField) {
    const Bytes frame = bytesOf("12 34 00 00 00 09 11 03 06 02 2B 00 00 00 64");
    for (size_t n = 0; n < frame.size(); ++n)
        EXPECT_EQ(splitFrame(frame.data(), n).status, SplitStatus::NeedMore) << n;
    const Split s = splitFrame(frame.data(), frame.size());
    EXPECT_EQ(s.status, SplitStatus::Frame);
    EXPECT_EQ(s.size, frame.size());
    Bytes two = frame;
    two.insert(two.end(), frame.begin(), frame.end());
    EXPECT_EQ(splitFrame(two.data(), two.size()).size, frame.size());
}

TEST(ModbusMbap, SplitterGivesUpOnAnImpossibleLength) {
    // length 0, 1 (no unit and PDU) and 255 (ADU would pass 260 bytes) cannot be a response
    for (const char* h : {"12 34 00 00 00 00 11 03", "12 34 00 00 00 01 11 03",
                          "12 34 00 00 00 FF 11 03 06 02", "12 34 00 00 FF FF 11 03"}) {
        const Bytes b = bytesOf(h);
        EXPECT_EQ(splitFrame(b.data(), b.size()).status, SplitStatus::Lost) << h;
    }
    // the biggest legal frame is 260 bytes: length field 254
    Bytes big = bytesOf("12 34 00 00 00 FE 11");
    EXPECT_EQ(splitFrame(big.data(), big.size()).status, SplitStatus::NeedMore);
}

TEST(ModbusExceptions, MeaningsAndReasons) {
    EXPECT_STREQ(exceptionMeaning(1), "mã hàm không hỗ trợ");
    EXPECT_STREQ(exceptionMeaning(2), "địa chỉ không hợp lệ");
    EXPECT_STREQ(exceptionMeaning(3), "giá trị dữ liệu không hợp lệ");
    EXPECT_STREQ(exceptionMeaning(4), "thiết bị trường lỗi");
    EXPECT_STREQ(exceptionMeaning(5), "đã nhận, đang xử lý");
    EXPECT_STREQ(exceptionMeaning(6), "thiết bị trường bận");
    EXPECT_STREQ(exceptionMeaning(7), "không thực hiện được (NAK)");
    EXPECT_STREQ(exceptionMeaning(8), "lỗi chẵn lẻ bộ nhớ");
    EXPECT_STREQ(exceptionMeaning(9), "mã không xác định");
    EXPECT_STREQ(exceptionMeaning(10), "cổng nối không có đường tới thiết bị");
    EXPECT_STREQ(exceptionMeaning(11), "thiết bị sau cổng nối không trả lời");
    EXPECT_STREQ(exceptionMeaning(0x7F), "mã lạ");
    EXPECT_EQ(exceptionReason(1), "EXCEPTION_01");
    EXPECT_EQ(exceptionReason(2), "EXCEPTION_02");
    EXPECT_EQ(exceptionReason(8), "EXCEPTION_08");
    EXPECT_EQ(exceptionReason(10), "EXCEPTION_0A");
    EXPECT_EQ(exceptionReason(11), "EXCEPTION_0B");
    EXPECT_EQ(exceptionReason(9), "EXCEPTION_OTHER");
    EXPECT_EQ(exceptionReason(0), "EXCEPTION_OTHER");
    EXPECT_EQ(exceptionReason(12), "EXCEPTION_OTHER");
    EXPECT_EQ(exceptionReason(255), "EXCEPTION_OTHER");
    EXPECT_EQ(exceptionHex(10), "0A");
    EXPECT_EQ(exceptionHex(2), "02");
}
