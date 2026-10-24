// FINS addresses, frames, end codes and BCD on the shared vectors (tests/fins-vectors): the
// address vectors are the same as packages/tag-codec's, the frames follow the layout of the
// public manuals (W342, W421).
#include <gtest/gtest.h>

#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "drivers/fins/address.hpp"
#include "drivers/fins/bcd.hpp"
#include "drivers/fins/end_codes.hpp"
#include "drivers/fins/frame.hpp"
#include "nlohmann/json.hpp"

using nlohmann::json;
using namespace mat::fins;

namespace {

json load(const char* file) {
    std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/fins-vectors/" + file, std::ios::binary);
    return json::parse(f);
}

Bytes hex(const std::string& s) {
    Bytes b;
    std::istringstream in(s);
    std::string tok;
    while (in >> tok) b.push_back(static_cast<uint8_t>(std::stoul(tok, nullptr, 16)));
    return b;
}

std::string hexOf(const Bytes& b) {
    std::string s;
    char buf[4];
    for (size_t i = 0; i < b.size(); ++i) {
        std::snprintf(buf, sizeof buf, "%02X", b[i]);
        if (i) s += ' ';
        s += buf;
    }
    return s;
}

Endpoint ep(const json& a) {
    return {static_cast<uint8_t>(a[0].get<int>()), static_cast<uint8_t>(a[1].get<int>()),
            static_cast<uint8_t>(a[2].get<int>())};
}

uint8_t code(const json& s) {
    return static_cast<uint8_t>(std::stoul(s.get<std::string>(), nullptr, 16));
}

std::string hex16(uint16_t v) {
    char b[8];
    std::snprintf(b, sizeof b, "%04X", v);
    return b;
}

std::string hex2(uint8_t v) {
    char b[4];
    std::snprintf(b, sizeof b, "%02X", v);
    return b;
}

mat::TagType typeOf(const std::string& s) { return mat::parseTagType(s).value(); }

const char* issueName(FrameIssue i) {
    switch (i) {
        case FrameIssue::None:
            return "None";
        case FrameIssue::Short:
            return "Short";
        case FrameIssue::NotResponse:
            return "NotResponse";
        case FrameIssue::Route:
            return "Route";
        case FrameIssue::Sid:
            return "Sid";
        case FrameIssue::Command:
            return "Command";
        case FrameIssue::Length:
            return "Length";
    }
    return "?";
}

}  // namespace

TEST(FinsAddress, Vectors) {
    const json cases = load("address.json")["cases"];
    ASSERT_GE(cases.size(), 60u);
    for (const json& c : cases) {
        SCOPED_TRACE(c["name"].get<std::string>());
        AddressOptions o;
        o.rawType = typeOf(c["rawType"]);
        o.stringLength = c.value("stringLength", 0);
        o.rw = c.value("access", "R") == "RW";
        const Address r = parseAddress(c["address"].get<std::string>(), o);
        const json& ex = c["expect"];
        if (ex.contains("error")) {
            EXPECT_FALSE(r.ok);
            EXPECT_EQ(r.error, ex["error"].get<std::string>());
            continue;
        }
        ASSERT_TRUE(r.ok) << r.error;
        EXPECT_EQ(r.normalized, ex["normalized"].get<std::string>());
        EXPECT_STREQ(areaName(r.area), ex["area"].get<std::string>().c_str());
        EXPECT_EQ(r.bank, ex["bank"].is_null() ? -1 : ex["bank"].get<int>());
        EXPECT_EQ(r.offset, ex["offset"].get<int>());
        EXPECT_EQ(r.wire, ex["wire"].get<int>());
        EXPECT_EQ(r.bit, ex["bit"].is_null() ? -1 : ex["bit"].get<int>());
        EXPECT_EQ(r.words, ex["words"].get<int>());
        EXPECT_EQ(r.flag, ex["flag"].get<bool>());
        EXPECT_EQ(hex2(r.wordCode), ex["wordCode"].get<std::string>());
        EXPECT_EQ(hex2(r.bitCode), ex["bitCode"].get<std::string>());
        EXPECT_EQ(r.writable, ex["writable"].get<bool>());
    }
}

TEST(FinsFrame, CommandsAreEncodedByteForByte) {
    for (const json& c : load("frames.json")["commands"]) {
        SCOPED_TRACE(c["name"].get<std::string>());
        const json& p = c["params"];
        Bytes params;
        const std::string kind = p["kind"];
        if (kind == "read")
            params = memoryAreaReadParams(code(p["areaCode"]),
                                          static_cast<uint16_t>(p["address"].get<int>()),
                                          static_cast<uint8_t>(p["bit"].get<int>()),
                                          static_cast<uint16_t>(p["count"].get<int>()));
        else if (kind == "write")
            params = memoryAreaWriteParams(
                code(p["areaCode"]), static_cast<uint16_t>(p["address"].get<int>()),
                static_cast<uint8_t>(p["bit"].get<int>()),
                static_cast<uint16_t>(p["count"].get<int>()), hex(p["data"].get<std::string>()));
        else if (kind == "multi") {
            std::vector<MultiItem> items;
            for (const json& it : p["items"])
                items.push_back({code(it[0]), static_cast<uint16_t>(it[1].get<int>()),
                                 static_cast<uint8_t>(it[2].get<int>())});
            params = multipleReadParams(items);
        } else {
            params = hex(p["hex"].get<std::string>());
        }
        const Bytes f = encodeCommand(
            ep(c["dst"]), ep(c["src"]), static_cast<uint8_t>(c["sid"].get<int>()),
            static_cast<uint16_t>(std::stoul(c["command"].get<std::string>(), nullptr, 16)),
            params);
        EXPECT_EQ(hexOf(f), c["hex"].get<std::string>());
    }
}

TEST(FinsFrame, ResponsesAreReadWithTheirEndCodeAndData) {
    for (const json& c : load("frames.json")["responses"]) {
        SCOPED_TRACE(c["name"].get<std::string>());
        const Bytes b = hex(c["hex"].get<std::string>());
        const Response r = parseResponse(b.data(), b.size());
        const json& ex = c["expect"];
        ASSERT_EQ(r.issue, FrameIssue::None);
        EXPECT_EQ(r.dst.network, ep(ex["dst"]).network);
        EXPECT_EQ(r.dst.node, ep(ex["dst"]).node);
        EXPECT_EQ(r.src.node, ep(ex["src"]).node);
        EXPECT_EQ(r.sid, ex["sid"].get<int>());
        EXPECT_EQ(hex16(r.command), ex["command"].get<std::string>());
        EXPECT_EQ(hex16(r.endCode), ex["endCode"].get<std::string>());
        EXPECT_EQ(r.relayError, ex["relayError"].get<bool>());
        EXPECT_EQ(r.plcFatal, ex["plcFatal"].get<bool>());
        EXPECT_EQ(r.plcNonFatal, ex["plcNonFatal"].get<bool>());
        EXPECT_EQ(hexOf(r.data), ex["data"].get<std::string>());
        if (ex.contains("reason"))
            EXPECT_STREQ(endCodeReason(r.endCode), ex["reason"].get<std::string>().c_str());
        if (ex.contains("words")) {
            std::vector<uint16_t> v;
            ASSERT_TRUE(readData(r.data, true, ex["words"].size(), v));
            for (size_t i = 0; i < v.size(); ++i)
                EXPECT_EQ(hex16(v[i]), ex["words"][i].get<std::string>());
            EXPECT_FALSE(readData(r.data, true, ex["words"].size() + 1, v));
        }
        if (ex.contains("bits")) {
            std::vector<uint16_t> v;
            ASSERT_TRUE(readData(r.data, false, ex["bits"].size(), v));
            for (size_t i = 0; i < v.size(); ++i) EXPECT_EQ(v[i], ex["bits"][i].get<int>());
        }
        if (ex.contains("multi")) {
            std::vector<MultiItem> items;
            for (const json& it : ex["multi"]["items"])
                items.push_back({code(it[0]), static_cast<uint16_t>(it[1].get<int>()),
                                 static_cast<uint8_t>(it[2].get<int>())});
            std::vector<uint16_t> v;
            ASSERT_TRUE(multipleReadData(r.data, items, v));
            for (size_t i = 0; i < v.size(); ++i)
                EXPECT_EQ(hex16(v[i]), ex["multi"]["values"][i].get<std::string>());
            items.pop_back();
            EXPECT_FALSE(multipleReadData(r.data, items, v)) << "bytes left over";
            items.push_back({0x82, 5, 0});
            items.push_back({0x82, 6, 0});
            EXPECT_FALSE(multipleReadData(r.data, items, v)) << "wrong area code";
        }
        if (ex.contains("model"))
            EXPECT_EQ(controllerModel(r.data), ex["model"].get<std::string>());
    }
    for (const json& c : load("frames.json")["badResponses"]) {
        const Bytes b = hex(c["hex"].get<std::string>());
        EXPECT_STREQ(issueName(parseResponse(b.data(), b.size()).issue),
                     c["issue"].get<std::string>().c_str())
            << c["name"].get<std::string>();
    }
    const Bytes huge(kMaxFrame + 1, 0xC0);
    EXPECT_EQ(parseResponse(huge.data(), huge.size()).issue, FrameIssue::Length);
}

TEST(FinsFrame, ResponsesAreMatchedToTheirCommand) {
    for (const json& c : load("frames.json")["checks"]) {
        const Bytes b = hex(c["hex"].get<std::string>());
        const Response r = parseResponse(b.data(), b.size());
        const FrameIssue i = checkResponse(
            r, ep(c["peer"]), ep(c["us"]), static_cast<uint8_t>(c["sid"].get<int>()),
            static_cast<uint16_t>(std::stoul(c["command"].get<std::string>(), nullptr, 16)));
        EXPECT_STREQ(issueName(i), c["issue"].get<std::string>().c_str())
            << c["name"].get<std::string>();
    }
}

TEST(FinsFrame, TcpMessages) {
    for (const json& c : load("frames.json")["tcp"]) {
        SCOPED_TRACE(c["name"].get<std::string>());
        const Bytes b = hex(c["hex"].get<std::string>());
        if (c.contains("build")) {
            const Bytes built = c["build"] == "nodeRequest"
                                    ? tcpNodeRequest(c["clientNode"].get<uint32_t>())
                                    : tcpWrap(hex(c["frame"].get<std::string>()));
            EXPECT_EQ(hexOf(built), c["hex"].get<std::string>());
            const TcpMessage m = splitTcp(built.data(), built.size());
            EXPECT_EQ(m.status, TcpSplit::Message);
            EXPECT_EQ(m.size, built.size());
            continue;
        }
        const TcpMessage m = splitTcp(b.data(), b.size());
        const std::string want = c["split"];
        EXPECT_EQ(m.status, want == "Message"
                                ? TcpSplit::Message
                                : want == "NeedMore" ? TcpSplit::NeedMore : TcpSplit::Bad);
        if (want != "Message") continue;
        EXPECT_EQ(m.size, b.size());
        EXPECT_EQ(m.command, c["command"].get<uint32_t>());
        EXPECT_EQ(m.error, c["error"].get<uint32_t>());
        if (c.contains("clientNode")) {
            uint32_t client = 0, server = 0;
            ASSERT_TRUE(tcpNodeResponse(b.data(), b.size(), client, server));
            EXPECT_EQ(client, c["clientNode"].get<uint32_t>());
            EXPECT_EQ(server, c["serverNode"].get<uint32_t>());
        }
    }
    EXPECT_STREQ(tcpErrorName(0x20), "all connections are in use");
}

TEST(FinsEndCodes, ReasonOfEveryMainCode) {
    for (const json& c : load("frames.json")["endCodes"]) {
        const uint16_t code16 =
            static_cast<uint16_t>(std::stoul(c[0].get<std::string>(), nullptr, 16));
        EXPECT_STREQ(endCodeReason(code16), c[1].get<std::string>().c_str()) << c[0];
        EXPECT_NE(std::string(endCodeMeaning(code16)), "");
    }
    EXPECT_EQ(endCodeHex(0x110B), "110B");
    EXPECT_TRUE(endCodeSplits(0x1103));
    EXPECT_TRUE(endCodeSplits(0x1104));
    EXPECT_TRUE(endCodeSplits(0x110B));
    EXPECT_FALSE(endCodeSplits(0x1101));
    EXPECT_TRUE(endCodeUnreachable(0x0201));
    EXPECT_TRUE(endCodeUnreachable(0x0502));
    EXPECT_FALSE(endCodeUnreachable(0x2203));
}

TEST(FinsBcd, Vectors) {
    for (const json& c : load("frames.json")["bcd"]) {
        std::vector<uint16_t> regs;
        for (const json& w : c["words"])
            regs.push_back(static_cast<uint16_t>(std::stoul(w.get<std::string>(), nullptr, 16)));
        uint64_t v = 0;
        const bool ok = bcdDecode(regs, static_cast<int>(regs.size()), v);
        if (c.value("invalid", false)) {
            EXPECT_FALSE(ok) << c.dump();
            continue;
        }
        ASSERT_TRUE(ok) << c.dump();
        EXPECT_EQ(v, c["value"].get<uint64_t>());
        std::vector<uint16_t> back;
        ASSERT_TRUE(bcdEncode(v, static_cast<int>(regs.size()), back));
        EXPECT_EQ(back, regs);
    }
    std::vector<uint16_t> out;
    EXPECT_FALSE(bcdEncode(10000, 1, out));
    EXPECT_FALSE(bcdEncode(100000000, 2, out));
    EXPECT_FALSE(bcdEncode(1, 3, out));
}
