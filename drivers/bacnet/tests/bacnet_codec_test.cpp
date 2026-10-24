// BACnet addresses and frames on the shared vectors (tests/bacnet-vectors): the address vectors are
// the same as packages/tag-codec's, the frames are ASHRAE 135 Annex F examples wrapped in BVLC /
// NPDU (Annex J, clause 6).
#include <gtest/gtest.h>

#include <cmath>
#include <fstream>
#include <map>
#include <string>

#include "drivers/bacnet/address.hpp"
#include "drivers/bacnet/codec.hpp"
#include "nlohmann/json.hpp"

using nlohmann::json;
using namespace mat;
using namespace mat::bacnet;

namespace {

json load(const char* file) {
    std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/bacnet-vectors/" + file,
                    std::ios::binary);
    return json::parse(f);
}

ObjectId objectOf(const std::string& text) {
    const size_t c = text.find(':');
    const std::string type = text.substr(0, c);
    for (uint32_t t : {0u, 1u, 2u, 3u, 4u, 5u, 8u, 13u, 14u, 19u})
        if (type == typeName(t)) return {t, static_cast<uint32_t>(std::stoul(text.substr(c + 1)))};
    ADD_FAILURE() << "object " << text;
    return {};
}

std::string objectText(ObjectId id) {
    return std::string(typeName(id.type)) + ":" + std::to_string(id.instance);
}

TagType typeOf(const std::string& s) { return parseTagType(s).value(); }

}  // namespace

TEST(BacnetAddress, SharedVectors) {
    const json v = load("address.json");
    for (const json& c : v["cases"]) {
        SCOPED_TRACE(c["name"].get<std::string>());
        AddressOptions o;
        o.rawType = typeOf(c["rawType"]);
        o.rw = c["access"] == "RW";
        const Address a = parseAddress(c["address"], o);
        const json& e = c["expect"];
        if (e.contains("error")) {
            EXPECT_FALSE(a.ok);
            EXPECT_EQ(a.error, e["error"].get<std::string>());
            continue;
        }
        ASSERT_TRUE(a.ok) << a.error;
        EXPECT_EQ(typeName(a.objectType), e["objectType"].get<std::string>());
        EXPECT_EQ(a.instance, e["instance"].get<uint32_t>());
        EXPECT_EQ(a.property, e["property"].get<uint32_t>());
        EXPECT_EQ(a.priority, e["priority"].get<int>());
        EXPECT_EQ(a.relinquish, e["relinquish"].get<bool>());
        EXPECT_EQ(a.normalized, e["normalized"].get<std::string>());
    }
}

TEST(BacnetCodec, EncodeVectors) {
    const json v = load("frames.json");
    for (const json& c : v["encode"]) {
        SCOPED_TRACE(c["name"].get<std::string>());
        const std::string service = c["service"];
        Route route;
        if (c.contains("network")) route.network = c["network"];
        if (c.contains("mac")) route.mac = fromHex(c["mac"]);
        Bytes got;
        if (service == "readProperty") {
            got = buildConfirmed(c["invokeId"].get<uint8_t>(), kServiceReadProperty,
                                 encodeReadProperty(objectOf(c["object"]), c["property"]), route,
                                 c["maxApdu"]);
        } else if (service == "readPropertyMultiple") {
            std::vector<ObjectRefs> objs;
            for (const json& o : c["objects"]) {
                ObjectRefs r;
                r.obj = objectOf(o["object"]);
                for (const json& p : o["properties"]) r.props.push_back({p.get<uint32_t>(), -1});
                objs.push_back(r);
            }
            got = buildConfirmed(c["invokeId"].get<uint8_t>(), kServiceReadPropertyMultiple,
                                 encodeReadPropertyMultiple(objs), route, c["maxApdu"]);
        } else if (service == "writeProperty") {
            const json& jv = c["value"];
            Value value;
            if (jv.contains("real")) value = Value::real(jv["real"].get<float>());
            if (jv.contains("enumerated")) value = Value::enumerated(jv["enumerated"]);
            got = buildConfirmed(c["invokeId"].get<uint8_t>(), kServiceWriteProperty,
                                 encodeWriteProperty(objectOf(c["object"]), c["property"], value,
                                                     c.value("priority", 0)),
                                 route, c["maxApdu"]);
        } else if (service == "whoIs") {
            const uint8_t bvlc =
                c["bvlc"] == "distribute" ? kBvlcDistributeBroadcast : kBvlcOriginalBroadcast;
            got = buildUnconfirmed(
                kServiceWhoIs, encodeWhoIs(c.value("low", -1), c.value("high", -1)), bvlc, route);
        } else if (service == "registerForeignDevice") {
            got = buildRegisterForeignDevice(c["ttl"]);
        }
        EXPECT_EQ(hexOf(got), hexOf(fromHex(c["hex"])));
    }
}

TEST(BacnetCodec, DecodeVectors) {
    const json v = load("frames.json");
    for (const json& c : v["decode"]) {
        SCOPED_TRACE(c["name"].get<std::string>());
        const Bytes b = fromHex(c["hex"]);
        Frame f;
        const json& e = c["expect"];
        const bool ok = parseFrame(b, f);
        if (e.contains("invalid")) {
            EXPECT_FALSE(ok);
            continue;
        }
        ASSERT_TRUE(ok);
        if (e.contains("bvlcResult")) {
            EXPECT_EQ(f.bvlc, kBvlcResult);
            EXPECT_EQ(f.bvlcResult, e["bvlcResult"].get<int>());
            continue;
        }
        if (e.contains("noApdu")) {
            EXPECT_FALSE(f.hasApdu);
            continue;
        }
        ASSERT_TRUE(f.hasApdu);
        const std::string pdu = e["pdu"];
        const std::map<std::string, int> types = {
            {"complexAck", kComplexAck}, {"simpleAck", kSimpleAck},
            {"error", kError},           {"reject", kReject},
            {"abort", kAbort},           {"unconfirmed", kUnconfirmedRequest}};
        EXPECT_EQ(f.pduType, types.at(pdu));
        if (e.contains("invokeId")) {
            EXPECT_EQ(f.invokeId, e["invokeId"].get<int>());
        }
        if (e.contains("service")) {
            EXPECT_EQ(f.service, e["service"].get<int>());
        }
        if (e.contains("reason")) {
            EXPECT_EQ(f.service, e["reason"].get<int>());
        }
        if (e.contains("server")) {
            EXPECT_EQ(f.serverAbort, e["server"].get<bool>());
        }
        if (e.contains("segmented")) {
            EXPECT_EQ(f.segmented, e["segmented"].get<bool>());
        }
        if (e.contains("errorClass")) {
            EXPECT_EQ(f.errorClass, e["errorClass"].get<uint32_t>());
        }
        if (e.contains("errorCode")) {
            EXPECT_EQ(f.errorCode, e["errorCode"].get<uint32_t>());
        }
        if (e.contains("srcNetwork")) {
            EXPECT_EQ(f.srcNetwork, e["srcNetwork"].get<int>());
        }
        if (e.contains("srcMac")) {
            EXPECT_EQ(hexOf(f.srcMac), e["srcMac"].get<std::string>());
        }
        if (e.contains("originIp")) {
            const uint32_t ip = f.originIp;
            const std::string text =
                std::to_string(ip >> 24) + "." + std::to_string((ip >> 16) & 255) + "." +
                std::to_string((ip >> 8) & 255) + "." + std::to_string(ip & 255);
            EXPECT_EQ(text, e["originIp"].get<std::string>());
            EXPECT_EQ(f.originPort, e["originPort"].get<int>());
        }
        if (e.contains("iAm")) {
            IAm i;
            ASSERT_TRUE(decodeIAm(f.data, f.dataLen, i));
            EXPECT_EQ(i.instance, e["iAm"]["instance"].get<uint32_t>());
            EXPECT_EQ(i.maxApdu, e["iAm"]["maxApdu"].get<uint32_t>());
            EXPECT_EQ(i.segmentation, e["iAm"]["segmentation"].get<uint32_t>());
            EXPECT_EQ(i.vendorId, e["iAm"]["vendorId"].get<uint32_t>());
        }
        if (e.contains("readProperty")) {
            PropertyResult r;
            ASSERT_TRUE(decodeReadPropertyAck(f.data, f.dataLen, r));
            EXPECT_EQ(objectText(r.obj), e["readProperty"]["object"].get<std::string>());
            EXPECT_EQ(r.property, e["readProperty"]["property"].get<uint32_t>());
            ASSERT_EQ(r.values.size(), 1u);
            EXPECT_NEAR(r.values[0].d, e["readProperty"]["real"].get<double>(), 1e-5);
        }
        if (e.contains("results")) {
            std::vector<PropertyResult> rs;
            ASSERT_TRUE(decodeReadPropertyMultipleAck(f.data, f.dataLen, rs));
            ASSERT_EQ(rs.size(), e["results"].size());
            for (size_t i = 0; i < rs.size(); ++i) {
                const json& x = e["results"][i];
                EXPECT_EQ(objectText(rs[i].obj), x["object"].get<std::string>());
                EXPECT_EQ(rs[i].property, x["property"].get<uint32_t>());
                if (x.contains("errorCode")) {
                    EXPECT_FALSE(rs[i].ok);
                    EXPECT_EQ(rs[i].errorClass, x["errorClass"].get<uint32_t>());
                    EXPECT_EQ(rs[i].errorCode, x["errorCode"].get<uint32_t>());
                    continue;
                }
                ASSERT_TRUE(rs[i].ok);
                ASSERT_EQ(rs[i].values.size(), 1u);
                if (x.contains("real")) {
                    EXPECT_NEAR(rs[i].values[0].d, x["real"].get<double>(), 1e-5);
                }
                if (x.contains("enumerated")) {
                    EXPECT_EQ(rs[i].values[0].tag, kTagEnumerated);
                    EXPECT_EQ(rs[i].values[0].u, x["enumerated"].get<uint64_t>());
                }
            }
        }
    }
}

TEST(BacnetCodec, ValueVectorsDecodeAndEncodeBack) {
    const json v = load("frames.json");
    for (const json& c : v["values"]) {
        SCOPED_TRACE(c["name"].get<std::string>());
        Bytes b;
        if (c.contains("repeat")) {
            b = fromHex(c["repeat"]["prefix"]);
            const Bytes one = fromHex(c["repeat"]["byte"]);
            for (int i = 0; i < c["repeat"]["count"].get<int>(); ++i) b.push_back(one[0]);
        } else {
            b = fromHex(c["hex"]);
        }
        Reader r(b);
        Value val;
        ASSERT_TRUE(r.appValue(val));
        EXPECT_TRUE(r.atEnd());
        EXPECT_EQ(val.tag, c["tag"].get<int>());
        if (c.contains("bool")) {
            EXPECT_EQ(val.b, c["bool"].get<bool>());
        }
        if (c.contains("unsigned")) {
            EXPECT_EQ(val.u, c["unsigned"].get<uint64_t>());
        }
        if (c.contains("signed")) {
            EXPECT_EQ(val.i, c["signed"].get<int64_t>());
        }
        if (c.contains("real")) {
            EXPECT_NEAR(val.d, c["real"].get<double>(), 1e-5);
        }
        if (c.contains("string")) {
            EXPECT_EQ(val.s, c["string"].get<std::string>());
        }
        if (c.contains("stringLength")) {
            EXPECT_EQ(val.s.size(), c["stringLength"].get<size_t>());
        }
        if (c.contains("bits")) {
            EXPECT_EQ(val.bits, c["bits"].get<uint32_t>());
            EXPECT_EQ(val.bitCount, c["bitCount"].get<int>());
        }
        if (c.contains("instance")) {
            EXPECT_EQ(val.obj.type, c["objectType"].get<uint32_t>());
            EXPECT_EQ(val.obj.instance, c["instance"].get<uint32_t>());
        }
        Bytes back;
        encodeAppValue(back, val);
        EXPECT_EQ(hexOf(back), hexOf(b));  // the shortest form round trips
    }
}

TEST(BacnetCodec, ReaderRejectsLengthsPastTheEnd) {
    for (const char* h :
         {"75", "7505", "75fe", "75fe0100", "75ff00000005", "4442", "c4020003", "1f", "2900"}) {
        SCOPED_TRACE(h);
        const Bytes b = fromHex(h);
        Reader r(b);
        Value v;
        EXPECT_FALSE(r.appValue(v));
    }
    // nesting deeper than kMaxDepth
    Bytes deep;
    for (int i = 0; i < kMaxDepth + 2; ++i) encodeOpening(deep, 1);
    for (int i = 0; i < kMaxDepth + 2; ++i) encodeClosing(deep, 1);
    Reader r(deep);
    EXPECT_FALSE(r.skip());
}

TEST(BacnetCodec, MaxApduCodes) {
    EXPECT_EQ(maxApduCode(1476), 5);
    EXPECT_EQ(maxApduCode(1024), 4);
    EXPECT_EQ(maxApduCode(480), 3);
    EXPECT_EQ(maxApduCode(206), 2);
    EXPECT_EQ(maxApduCode(128), 1);
    EXPECT_EQ(maxApduCode(50), 0);
    EXPECT_EQ(maxApduOfCode(5), 1476);
    EXPECT_EQ(maxApduOfCode(9), 50);
}

TEST(BacnetCodec, ErrorReasons) {
    EXPECT_STREQ(errorReason(31), "BACNET_UNKNOWN_OBJECT");
    EXPECT_STREQ(errorReason(32), "BACNET_UNKNOWN_PROPERTY");
    EXPECT_STREQ(errorReason(40), "BACNET_WRITE_DENIED");
    EXPECT_STREQ(errorReason(37), "BACNET_VALUE_RANGE");
    EXPECT_STREQ(errorReason(9), "BACNET_DATA_TYPE");
    EXPECT_STREQ(errorReason(2), "BACNET_ERROR");
}
