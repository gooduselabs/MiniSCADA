// S7comm frames on the shared byte vectors (tests/s7-vectors/frames.json, feature 016 T010): the
// same bytes as tools/s7-sim (sim.test.mjs).
#include <gtest/gtest.h>

#include <cmath>
#include <cstdio>
#include <fstream>

#include "drivers/s7/frames.hpp"
#include "nlohmann/json.hpp"

using nlohmann::json;
using namespace mat;
using namespace mat::s7;

namespace {

const json& vectors() {
    static const json j = [] {
        std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/s7-vectors/frames.json",
                        std::ios::binary);
        return json::parse(f);
    }();
    return j;
}

Bytes bytesOf(const std::string& hex) {
    Bytes b;
    for (size_t i = 0; i < hex.size();) {
        while (i < hex.size() && hex[i] == ' ') ++i;
        if (i >= hex.size()) break;
        b.push_back(static_cast<uint8_t>(std::stoul(hex.substr(i, 2), nullptr, 16)));
        i += 2;
    }
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

uint16_t tsap(const json& v) {
    return static_cast<uint16_t>(std::stoul(v.get<std::string>(), nullptr, 16));
}

Area areaOf(const std::string& a) {
    return a == "DB" ? Area::DB : a == "I" ? Area::I : a == "Q" ? Area::Q : Area::M;
}

Item itemOf(const json& j) {
    Item it;
    it.area = areaOf(j["area"]);
    it.db = j["db"];
    it.byte = j["byte"];
    it.bit = j["bit"].is_null() ? -1 : j["bit"].get<int>();
    it.size = j["size"];
    return it;
}

S7Type typeOf(const std::string& n) {
    for (int t = 0; t <= static_cast<int>(S7Type::STRING); ++t)
        if (n == s7TypeName(static_cast<S7Type>(t))) return static_cast<S7Type>(t);
    ADD_FAILURE() << n;
    return S7Type::BYTE;
}

// The S7 PDU of a whole frame (after TPKT and COTP DT).
Bytes pduOf(const Bytes& frame) { return Bytes(frame.begin() + 7, frame.end()); }

}  // namespace

TEST(S7Frames, ConnectRequest) {
    for (const auto& c : vectors()["cotpConnect"])
        EXPECT_EQ(hexOf(encodeConnect(tsap(c["localTsap"]), tsap(c["remoteTsap"]))),
                  c["hex"].get<std::string>())
            << c["name"];
    for (const auto& c : vectors()["tsap"])
        EXPECT_EQ(remoteTsapOf(c["rack"], c["slot"]), tsap(c["remote"]));
}

TEST(S7Frames, ConnectConfirm) {
    for (const auto& c : vectors()["cotpConfirm"]) {
        const Bytes f = bytesOf(c["hex"]);
        EXPECT_EQ(isConnectConfirm(f.data(), f.size()), c["expect"]["accepted"].get<bool>())
            << c["name"];
    }
}

TEST(S7Frames, Setup) {
    for (const auto& c : vectors()["setupRequest"])
        EXPECT_EQ(hexOf(encodeSetup(c["ref"], c["pduSize"])), c["hex"].get<std::string>())
            << c["name"];
    for (const auto& c : vectors()["setupResponse"]) {
        const Bytes p = pduOf(bytesOf(c["hex"]));
        const SetupReply r = decodeSetup(p.data(), p.size());
        const json& e = c["expect"];
        EXPECT_EQ(r.ok, e["ok"].get<bool>()) << c["name"];
        EXPECT_EQ(r.format, e.value("format", false)) << c["name"];
        if (e.contains("ref")) EXPECT_EQ(r.ref, e["ref"].get<int>()) << c["name"];
        if (e.contains("pduSize")) EXPECT_EQ(r.pduSize, e["pduSize"].get<int>()) << c["name"];
        EXPECT_EQ(r.error, e.value("error", 0)) << c["name"];
    }
}

TEST(S7Frames, ReadRequest) {
    for (const auto& c : vectors()["readRequest"]) {
        std::vector<Item> items;
        for (const auto& i : c["items"]) items.push_back(itemOf(i));
        EXPECT_EQ(hexOf(encodeRead(c["ref"], items)), c["hex"].get<std::string>()) << c["name"];
    }
}

TEST(S7Frames, ReadResponse) {
    for (const auto& c : vectors()["readResponse"]) {
        const Bytes p = pduOf(bytesOf(c["hex"]));
        const ReadReply r = decodeRead(p.data(), p.size(), c["sizes"].get<std::vector<int>>());
        const json& e = c["expect"];
        EXPECT_EQ(r.ok, e["ok"].get<bool>()) << c["name"];
        EXPECT_EQ(r.format, e.value("format", false)) << c["name"];
        EXPECT_EQ(r.error, e.value("error", 0)) << c["name"];
        if (e.contains("ref")) EXPECT_EQ(r.ref, e["ref"].get<int>()) << c["name"];
        if (!e.contains("items")) continue;
        ASSERT_EQ(r.items.size(), e["items"].size()) << c["name"];
        for (size_t i = 0; i < r.items.size(); ++i) {
            EXPECT_EQ(r.items[i].rc, e["items"][i]["rc"].get<int>()) << c["name"] << " " << i;
            EXPECT_EQ(hexOf(r.items[i].data), e["items"][i]["data"].get<std::string>())
                << c["name"] << " " << i;
        }
    }
}

TEST(S7Frames, Write) {
    for (const auto& c : vectors()["writeRequest"])
        EXPECT_EQ(hexOf(encodeWrite(c["ref"], itemOf(c["item"]), bytesOf(c["data"]))),
                  c["hex"].get<std::string>())
            << c["name"];
    for (const auto& c : vectors()["writeResponse"]) {
        const Bytes p = pduOf(bytesOf(c["hex"]));
        const WriteReply r = decodeWrite(p.data(), p.size());
        const json& e = c["expect"];
        EXPECT_EQ(r.ok, e["ok"].get<bool>()) << c["name"];
        EXPECT_EQ(r.format, e.value("format", false)) << c["name"];
        EXPECT_EQ(r.error, e.value("error", 0)) << c["name"];
        if (e.contains("ref")) EXPECT_EQ(r.ref, e["ref"].get<int>()) << c["name"];
        if (e.contains("rc")) EXPECT_EQ(r.rc, e["rc"].get<int>()) << c["name"];
    }
}

TEST(S7Frames, Split) {
    for (const auto& c : vectors()["split"]) {
        const Bytes b = bytesOf(c["hex"]);
        size_t off = 0;
        std::vector<int> frames;
        bool bad = false;
        for (;;) {
            const Split s = splitTpkt(b.data() + off, b.size() - off);
            if (s.status == Split::Status::Bad) {
                bad = true;
                break;
            }
            if (s.status == Split::Status::NeedMore) break;
            frames.push_back(static_cast<int>(s.size));
            off += s.size;
        }
        EXPECT_EQ(frames, c["expect"]["frames"].get<std::vector<int>>()) << c["name"];
        EXPECT_EQ(b.size() - off, c["expect"]["rest"].get<size_t>()) << c["name"];
        EXPECT_EQ(bad, c["expect"]["bad"].get<bool>()) << c["name"];
    }
}

TEST(S7Frames, DataTpdu) {
    const Bytes dt = bytesOf("03 00 00 08 02 F0 00 32");
    const DataTpdu d = dataOf(dt.data(), dt.size());
    EXPECT_TRUE(d.ok);
    EXPECT_FALSE(d.eot);
    EXPECT_EQ(d.offset, 7u);
    EXPECT_EQ(d.size, 1u);
    const Bytes cc = bytesOf("03 00 00 0B 06 D0 00 01 44 31 00");
    EXPECT_FALSE(dataOf(cc.data(), cc.size()).ok);
}

TEST(S7Frames, Values) {
    for (const auto& c : vectors()["values"]) {
        const std::string name = c["name"];
        const S7Type t = typeOf(c["s7Type"]);
        const Bytes b = bytesOf(c["bytes"]);
        const int length = c.value("length", 0);
        const Decoded d = decodeValue(t, c.value("bit", -1), b.data(), b.size(), length);
        if (c.value("invalid", false)) {
            EXPECT_FALSE(d.ok) << name;
            EXPECT_EQ(d.reason, "INVALID_VALUE") << name;
            continue;
        }
        ASSERT_TRUE(d.ok) << name;
        const json& v = c["value"];
        TagScalar want;
        if (v.is_boolean())
            want = v.get<bool>();
        else if (v.is_string())
            want = v.get<std::string>();
        else if (t == S7Type::REAL || t == S7Type::LREAL)
            want = v.get<double>();
        else if (t == S7Type::INT || t == S7Type::DINT)
            want = v.get<int64_t>();
        else
            want = v.get<uint64_t>();
        EXPECT_EQ(d.value, want) << name;
        if (t == S7Type::BOOL || c.value("decodeOnly", false)) continue;
        Bytes enc;
        ASSERT_TRUE(encodeValue(t, want, length, enc)) << name;
        EXPECT_EQ(hexOf(enc), c.value("encodes", c["bytes"].get<std::string>())) << name;
    }
    for (const auto& c : vectors()["encodeErrors"]) {
        Bytes enc;
        EXPECT_FALSE(
            encodeValue(typeOf(c["s7Type"]), c["value"].get<std::string>(), c["length"], enc))
            << c["name"];
    }
}

TEST(S7Frames, EncodeRanges) {
    Bytes b;
    EXPECT_FALSE(encodeValue(S7Type::INT, int64_t{40000}, 0, b));
    EXPECT_FALSE(encodeValue(S7Type::BYTE, int64_t{256}, 0, b));
    EXPECT_FALSE(encodeValue(S7Type::WORD, int64_t{-1}, 0, b));
    EXPECT_FALSE(encodeValue(S7Type::REAL, 1e300, 0, b));
    EXPECT_FALSE(encodeValue(S7Type::DWORD, std::string("x"), 0, b));
    EXPECT_TRUE(encodeValue(S7Type::DWORD, uint64_t{4294967295u}, 0, b));
    EXPECT_EQ(hexOf(b), "FF FF FF FF");
    EXPECT_TRUE(encodeValue(S7Type::BOOL, int64_t{1}, 0, b));
    EXPECT_EQ(hexOf(b), "01");
    EXPECT_STREQ(itemReason(0x0A), "S7_OBJECT_NOT_FOUND");
    EXPECT_STREQ(itemReason(0x42), "S7_ITEM_ERROR");
    EXPECT_STREQ(headerReason(0x8104), "S7_FUNCTION_NOT_AVAILABLE");
    EXPECT_STREQ(headerReason(0x8500), "S7_REQUEST_ERROR");
}
