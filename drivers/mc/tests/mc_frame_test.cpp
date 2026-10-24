// MC protocol frames on the shared vectors (tests/mc-vectors/frames.json: hand-written from the
// public frame structure of Mitsubishi's manuals; the simulator answers the same bytes). Feature
// 017.
#include "drivers/mc/mc_frame.hpp"

#include <gtest/gtest.h>

#include <fstream>

#include "nlohmann/json.hpp"

using nlohmann::json;
using namespace mat::mc;

namespace {

json loadCases() {
    std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/mc-vectors/frames.json",
                    std::ios::binary);
    return json::parse(f)["cases"];
}

Bytes wireOf(const std::string& s, CodeType code) {
    Bytes b;
    if (code == CodeType::Ascii) return Bytes(s.begin(), s.end());
    for (size_t i = 0; i < s.size(); ++i) {
        if (s[i] == ' ') continue;
        b.push_back(static_cast<uint8_t>(std::stoul(s.substr(i, 2), nullptr, 16)));
        ++i;
    }
    return b;
}

DevRef devOf(const json& j) {
    const McDeviceInfo* d = deviceByName(j["device"].get<std::string>());
    EXPECT_NE(d, nullptr);
    return {d ? d->device : Device::D, j["number"].get<uint32_t>()};
}

FrameOptions optionsOf(const json& o) {
    FrameOptions f;
    f.frame = o["frame"] == "4E" ? FrameType::E4 : FrameType::E3;
    f.code = o["code"] == "ascii" ? CodeType::Ascii : CodeType::Binary;
    f.route.network = o["network"].get<uint8_t>();
    f.route.station = o["station"].get<uint8_t>();
    f.route.moduleIo = o["moduleIo"].get<uint16_t>();
    f.route.moduleStation = o["moduleStation"].get<uint8_t>();
    f.timer = o["timer"].get<uint16_t>();
    f.xyOctal = o["xyOctal"].get<bool>();
    return f;
}

Request requestOf(const json& j) {
    Request r;
    const std::string cmd = j["cmd"];
    if (cmd == "randomRead") {
        r.cmd = Cmd::RandomRead;
        for (const auto& d : j.value("randomWords", json::array()))
            r.randomWords.push_back(devOf(d));
        for (const auto& d : j.value("randomDwords", json::array()))
            r.randomDwords.push_back(devOf(d));
        return r;
    }
    r.dev = devOf(j);
    if (cmd == "batchReadWords") {
        r.cmd = Cmd::ReadWords;
        r.points = j["points"].get<uint16_t>();
    } else if (cmd == "batchReadBits") {
        r.cmd = Cmd::ReadBits;
        r.points = j["points"].get<uint16_t>();
    } else if (cmd == "batchWriteWords") {
        r.cmd = Cmd::WriteWords;
        r.words = j["words"].get<std::vector<uint16_t>>();
    } else {
        r.cmd = Cmd::WriteBits;
        r.bits = j["bits"].get<std::vector<uint8_t>>();
    }
    return r;
}

Issue issueOf(const std::string& s) {
    if (s == "none") return Issue::None;
    if (s == "route") return Issue::Route;
    if (s == "serial") return Issue::Serial;
    if (s == "length") return Issue::Length;
    return Issue::Format;
}

}  // namespace

TEST(McFrame, EncodeVectors) {
    const json cases = loadCases();
    ASSERT_GE(cases.size(), 15u);
    for (const auto& c : cases) {
        SCOPED_TRACE(c["name"].get<std::string>());
        const FrameOptions o = optionsOf(c["options"]);
        const Bytes got =
            encodeRequest(o, c["options"]["serial"].get<uint16_t>(), requestOf(c["request"]));
        EXPECT_EQ(got, wireOf(c["wire"].get<std::string>(), o.code));
    }
}

TEST(McFrame, ResponseVectors) {
    for (const auto& c : loadCases()) {
        const FrameOptions o = optionsOf(c["options"]);
        const Request r = requestOf(c["request"]);
        const uint16_t serial = c["options"]["serial"].get<uint16_t>();
        int k = 0;
        for (const auto& resp : c["responses"]) {
            SCOPED_TRACE(c["name"].get<std::string>() + " #" + std::to_string(k++));
            const Bytes w = wireOf(resp["wire"].get<std::string>(), o.code);
            const Response got = checkResponse(o, serial, r, w.data(), w.size());
            const json& e = resp["expect"];
            EXPECT_EQ(static_cast<int>(got.issue), static_cast<int>(issueOf(e["issue"])));
            if (got.issue != Issue::None) continue;
            EXPECT_EQ(got.endCode, e["endCode"].get<uint16_t>());
            if (e.contains("words")) {
                EXPECT_EQ(got.words, e["words"].get<std::vector<uint16_t>>());
            }
            if (e.contains("bits")) {
                EXPECT_EQ(got.bits, e["bits"].get<std::vector<uint8_t>>());
            }
            // a good frame is one whole frame for the stream splitter too
            const Split s = splitResponse(o.frame, o.code, w.data(), w.size());
            EXPECT_EQ(s.status, SplitStatus::Frame);
            EXPECT_EQ(s.size, w.size());
        }
    }
}

TEST(McFrame, SplitStream) {
    // two binary 3E frames back to back, given byte by byte
    const Bytes a = wireOf("D0 00 00 FF FF 03 00 04 00 00 00 2A 00", CodeType::Binary);
    Bytes both = a;
    both.insert(both.end(), a.begin(), a.end());
    for (size_t n = 0; n < a.size(); ++n)
        EXPECT_EQ(splitResponse(FrameType::E3, CodeType::Binary, both.data(), n).status,
                  SplitStatus::NeedMore);
    const Split s = splitResponse(FrameType::E3, CodeType::Binary, both.data(), both.size());
    EXPECT_EQ(s.status, SplitStatus::Frame);
    EXPECT_EQ(s.size, a.size());
    // garbage
    const Bytes g = {0xFF, 0x00, 0x01};
    EXPECT_EQ(splitResponse(FrameType::E3, CodeType::Binary, g.data(), g.size()).status,
              SplitStatus::Lost);
    // a first byte that cannot start a response is lost at once
    EXPECT_EQ(splitResponse(FrameType::E3, CodeType::Binary, g.data(), 1).status,
              SplitStatus::Lost);
    // 4E ASCII
    const std::string t = "D40000AB000000FF03FF0000080000002A";
    EXPECT_EQ(splitResponse(FrameType::E4, CodeType::Ascii,
                            reinterpret_cast<const uint8_t*>(t.data()), t.size() - 1)
                  .status,
              SplitStatus::NeedMore);
    EXPECT_EQ(splitResponse(FrameType::E4, CodeType::Ascii,
                            reinterpret_cast<const uint8_t*>(t.data()), t.size())
                  .size,
              t.size());
    // ASCII length field that is not hex
    const std::string bad = "D00000FF03FF00Z0080000";
    EXPECT_EQ(splitResponse(FrameType::E3, CodeType::Ascii,
                            reinterpret_cast<const uint8_t*>(bad.data()), bad.size())
                  .status,
              SplitStatus::Lost);
    // a length that no response of these commands can have
    const Bytes huge = wireOf("D0 00 00 FF FF 03 00 FF FF", CodeType::Binary);
    EXPECT_EQ(splitResponse(FrameType::E3, CodeType::Binary, huge.data(), huge.size()).status,
              SplitStatus::Lost);
}

TEST(McFrame, MonitoringTimer) {
    EXPECT_EQ(monitoringTimer(100), 1);
    EXPECT_EQ(monitoringTimer(1000), 3);
    EXPECT_EQ(monitoringTimer(10000), 39);
}

TEST(McFrame, WriteBitsOddPoints) {
    Request r;
    r.cmd = Cmd::WriteBits;
    r.dev = {Device::M, 0};
    r.bits = {1, 1, 1};
    const Bytes b = encodeRequest(FrameOptions{}, 0, r);
    // data: 0x11 0x10 (the low nibble of the last byte is padding)
    ASSERT_GE(b.size(), 2u);
    EXPECT_EQ(b[b.size() - 2], 0x11);
    EXPECT_EQ(b[b.size() - 1], 0x10);
}
