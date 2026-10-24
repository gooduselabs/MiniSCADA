// OPC UA values, StatusCodes and certificates without a server (feature 019, contracts/opcua.md
// §2, spec D6, D9, D10).
#include <gtest/gtest.h>
#include <mbedtls/entropy.h>

#include <cstring>

#include "drivers/opcua/client_cert.hpp"
#include "drivers/opcua/status_map.hpp"
#include "drivers/opcua/tests/opcua_test_util.hpp"
#include "drivers/opcua/value_codec.hpp"

using namespace mat;
using namespace mat::opcua;

namespace {

template <typename T>
UA_Variant scalar(T v, int type) {
    UA_Variant out;
    UA_Variant_setScalarCopy(&out, &v, &UA_TYPES[type]);
    return out;
}

bool decodes(UA_Variant v, TagType t, TagScalar& out) {
    const bool ok = decodeVariant(v, t, out);
    UA_Variant_clear(&v);
    return ok;
}

}  // namespace

TEST(OpcUaStatus, QualityAndReason) {
    EXPECT_EQ(qualityOf(UA_STATUSCODE_GOOD).quality, Quality::GOOD);
    EXPECT_EQ(qualityOf(UA_STATUSCODE_UNCERTAINLASTUSABLEVALUE).quality, Quality::UNCERTAIN);
    EXPECT_STREQ(qualityOf(UA_STATUSCODE_UNCERTAINLASTUSABLEVALUE).reason, "OPCUA_UNCERTAIN");
    EXPECT_STREQ(qualityOf(UA_STATUSCODE_BADNODEIDUNKNOWN).reason, "OPCUA_NODE_UNKNOWN");
    EXPECT_STREQ(qualityOf(UA_STATUSCODE_BADNOTREADABLE).reason, "OPCUA_ACCESS_DENIED");
    EXPECT_STREQ(qualityOf(UA_STATUSCODE_BADUSERACCESSDENIED).reason, "OPCUA_ACCESS_DENIED");
    EXPECT_STREQ(qualityOf(UA_STATUSCODE_BADTYPEMISMATCH).reason, "OPCUA_TYPE_MISMATCH");
    EXPECT_STREQ(qualityOf(UA_STATUSCODE_BADWAITINGFORINITIALDATA).reason, "OPCUA_BAD_STATUS");
    EXPECT_EQ(qualityOf(UA_STATUSCODE_BADNODEIDUNKNOWN).quality, Quality::BAD);
    EXPECT_STREQ(connectFailureCode(UA_STATUSCODE_BADIDENTITYTOKENREJECTED), "OPCUA_AUTH_FAILED");
    EXPECT_STREQ(connectFailureCode(UA_STATUSCODE_BADUSERACCESSDENIED), "OPCUA_AUTH_FAILED");
    EXPECT_STREQ(connectFailureCode(UA_STATUSCODE_BADSECURITYCHECKSFAILED),
                 "OPCUA_SECURITY_REJECTED");
    EXPECT_STREQ(connectFailureCode(UA_STATUSCODE_BADCERTIFICATEUNTRUSTED),
                 "OPCUA_SECURITY_REJECTED");
    EXPECT_STREQ(connectFailureCode(UA_STATUSCODE_BADTIMEOUT), "TIMEOUT");
    EXPECT_STREQ(connectFailureCode(UA_STATUSCODE_BADCONNECTIONCLOSED), "REFUSED");
    EXPECT_EQ(statusName(UA_STATUSCODE_BADNODEIDUNKNOWN), "BadNodeIdUnknown");
}

TEST(OpcUaValue, DecodeFitsTheTagTypeOrIsAMismatch) {
    TagScalar v;
    ASSERT_TRUE(decodes(scalar<UA_Int32>(300, UA_TYPES_INT32), TagType::INT16, v));
    EXPECT_EQ(std::get<int64_t>(v), 300);
    EXPECT_FALSE(decodes(scalar<UA_Int32>(40000, UA_TYPES_INT32), TagType::INT16, v));
    EXPECT_FALSE(decodes(scalar<UA_Int32>(-1, UA_TYPES_INT32), TagType::UINT16, v));
    ASSERT_TRUE(decodes(scalar<UA_UInt64>(UINT64_MAX, UA_TYPES_UINT64), TagType::UINT64, v));
    EXPECT_EQ(std::get<uint64_t>(v), UINT64_MAX);
    EXPECT_FALSE(decodes(scalar<UA_UInt64>(UINT64_MAX, UA_TYPES_UINT64), TagType::INT64, v));
    EXPECT_FALSE(decodes(scalar<UA_Double>(1.5, UA_TYPES_DOUBLE), TagType::INT32, v));
    EXPECT_FALSE(decodes(scalar<UA_Double>(1e300, UA_TYPES_DOUBLE), TagType::FLOAT32, v));
    ASSERT_TRUE(decodes(scalar<UA_Double>(1e300, UA_TYPES_DOUBLE), TagType::FLOAT64, v));
    ASSERT_TRUE(decodes(scalar<UA_Boolean>(true, UA_TYPES_BOOLEAN), TagType::INT16, v));
    EXPECT_EQ(std::get<int64_t>(v), 1);
    ASSERT_TRUE(decodes(scalar<UA_Byte>(0, UA_TYPES_BYTE), TagType::BOOL, v));
    EXPECT_EQ(std::get<bool>(v), false);
    EXPECT_FALSE(decodes(scalar<UA_Float>(1, UA_TYPES_FLOAT), TagType::BOOL, v));
    ASSERT_TRUE(decodes(scalar<UA_Int16>(-7, UA_TYPES_INT16), TagType::STRING, v));
    EXPECT_EQ(std::get<std::string>(v), "-7");
    EXPECT_FALSE(decodes(scalar<UA_Double>(1, UA_TYPES_DOUBLE), TagType::STRING, v));
    const UA_DateTime t = fromUnixMs(1792810800123LL);
    ASSERT_TRUE(decodes(scalar<UA_DateTime>(t, UA_TYPES_DATETIME), TagType::INT64, v));
    EXPECT_EQ(std::get<int64_t>(v), 1792810800123LL);
    ASSERT_TRUE(decodes(scalar<UA_DateTime>(t, UA_TYPES_DATETIME), TagType::STRING, v));
    EXPECT_EQ(std::get<std::string>(v), "2026-10-24T03:00:00.123Z");
    EXPECT_FALSE(decodes(scalar<UA_DateTime>(t, UA_TYPES_DATETIME), TagType::INT32, v));
    // an array is not a scalar
    UA_Variant arr;
    UA_Int32 a[2] = {1, 2};
    UA_Variant_setArrayCopy(&arr, a, 2, &UA_TYPES[UA_TYPES_INT32]);
    EXPECT_FALSE(decodes(arr, TagType::INT32, v));
    // a type outside contracts §2
    UA_LocalizedText lt = UA_LOCALIZEDTEXT(const_cast<char*>("en"), const_cast<char*>("x"));
    UA_Variant ltv;
    UA_Variant_setScalar(&ltv, &lt, &UA_TYPES[UA_TYPES_LOCALIZEDTEXT]);
    EXPECT_FALSE(decodeVariant(ltv, TagType::STRING, v));
}

TEST(OpcUaValue, EncodeInTheNodesType) {
    UA_Variant out;
    ASSERT_TRUE(encodeVariant(int64_t{-5}, TagType::INT32, &UA_TYPES[UA_TYPES_INT16], out));
    EXPECT_EQ(out.type, &UA_TYPES[UA_TYPES_INT16]);
    EXPECT_EQ(*static_cast<UA_Int16*>(out.data), -5);
    UA_Variant_clear(&out);
    EXPECT_FALSE(encodeVariant(int64_t{70000}, TagType::INT32, &UA_TYPES[UA_TYPES_INT16], out));
    EXPECT_FALSE(encodeVariant(int64_t{-1}, TagType::INT32, &UA_TYPES[UA_TYPES_UINT32], out));
    ASSERT_TRUE(encodeVariant(4.0, TagType::FLOAT64, &UA_TYPES[UA_TYPES_INT32], out));
    EXPECT_EQ(*static_cast<UA_Int32*>(out.data), 4);
    UA_Variant_clear(&out);
    EXPECT_FALSE(encodeVariant(4.5, TagType::FLOAT64, &UA_TYPES[UA_TYPES_INT32], out));
    EXPECT_FALSE(encodeVariant(1e300, TagType::FLOAT64, &UA_TYPES[UA_TYPES_FLOAT], out));
    ASSERT_TRUE(encodeVariant(true, TagType::BOOL, &UA_TYPES[UA_TYPES_BOOLEAN], out));
    UA_Variant_clear(&out);
    ASSERT_TRUE(encodeVariant(std::string("2027-01-02T03:04:05Z"), TagType::STRING,
                              &UA_TYPES[UA_TYPES_DATETIME], out));
    EXPECT_EQ(unixMs(*static_cast<UA_DateTime*>(out.data)), 1798859045000LL);
    UA_Variant_clear(&out);
    ASSERT_TRUE(
        encodeVariant(int64_t{1798859045000LL}, TagType::INT64, &UA_TYPES[UA_TYPES_DATETIME], out));
    UA_Variant_clear(&out);
    EXPECT_FALSE(
        encodeVariant(std::string("tomorrow"), TagType::STRING, &UA_TYPES[UA_TYPES_DATETIME], out));
    EXPECT_FALSE(encodeVariant(std::string("1"), TagType::STRING, &UA_TYPES[UA_TYPES_INT32], out));
    EXPECT_FALSE(encodeVariant(1.0, TagType::FLOAT64, &UA_TYPES[UA_TYPES_LOCALIZEDTEXT], out));
    EXPECT_EQ(naturalType(TagType::FLOAT32), &UA_TYPES[UA_TYPES_FLOAT]);
}

TEST(OpcUaValue, ReadbackComparesAsTheTagType) {
    EXPECT_TRUE(sameRaw(0.1, static_cast<double>(0.1f), TagType::FLOAT32));
    EXPECT_FALSE(sameRaw(0.1, static_cast<double>(0.1f), TagType::FLOAT64));
    EXPECT_TRUE(sameRaw(int64_t{5}, uint64_t{5}, TagType::UINT16));
    EXPECT_TRUE(sameRaw(true, int64_t{1}, TagType::BOOL));
    EXPECT_FALSE(sameRaw(std::string("a"), std::string("b"), TagType::STRING));
}

TEST(OpcUaValue, IsoDates) {
    UA_DateTime t = 0;
    ASSERT_TRUE(parseIsoUtc("1970-01-01T00:00:00Z", t));
    EXPECT_EQ(unixMs(t), 0);
    ASSERT_TRUE(parseIsoUtc("2026-10-24T03:00:00.5Z", t));
    EXPECT_EQ(unixMs(t), 1792810800500LL);
    EXPECT_EQ(isoUtc(t), "2026-10-24T03:00:00.500Z");
    EXPECT_FALSE(parseIsoUtc("2026-10-24T03:00:00", t));
    EXPECT_FALSE(parseIsoUtc("2026-10-24 03:00:00Z", t));
    EXPECT_FALSE(parseIsoUtc("2026-13-24T03:00:00Z", t));
    EXPECT_FALSE(parseIsoUtc("2026-10-24T03:00:00.Z", t));
}

TEST(OpcUaValue, SuggestedTagTypes) {
    EXPECT_STREQ(suggestedTagType(UA_NODEID_NUMERIC(0, UA_NS0ID_DOUBLE)), "FLOAT64");
    EXPECT_STREQ(suggestedTagType(UA_NODEID_NUMERIC(0, UA_NS0ID_BYTE)), "UINT16");
    EXPECT_STREQ(suggestedTagType(UA_NODEID_NUMERIC(0, UA_NS0ID_DATETIME)), "INT64");
    EXPECT_EQ(suggestedTagType(UA_NODEID_NUMERIC(0, UA_NS0ID_LOCALIZEDTEXT)), nullptr);
    EXPECT_EQ(suggestedTagType(UA_NODEID_NUMERIC(2, 11)), nullptr);
    EXPECT_EQ(dataTypeName(UA_NODEID_NUMERIC(0, UA_NS0ID_DOUBLE)), "Double");
}

TEST(OpcUaCert, ClientIdentityIsMadeOnceAndKept) {
    const std::string dir = opcuatest::certDir("identity");
    ClientIdentity a, b;
    std::string err;
    ASSERT_TRUE(clientIdentity(dir, "urn:test:a", a, err)) << err;
    ASSERT_TRUE(clientIdentity(dir, "urn:test:a", b, err)) << err;
    EXPECT_EQ(a.sha256, b.sha256);
    EXPECT_EQ(a.sha256.size(), 64u);
    const CertInfo info = certInfo(a.cert.data(), a.cert.size());
    ASSERT_TRUE(info.ok);
    EXPECT_EQ(info.sha256, a.sha256);
    EXPECT_NE(info.subject.find("mAT SCADA OPC UA Client"), std::string::npos) << info.subject;
    EXPECT_GT(info.notAfterMs, 1792810800000LL + 9LL * 365 * 86400000);
    struct stat st {};
    ASSERT_EQ(::stat((dir + "/client-key.der").c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 0777, 0600u);
    EXPECT_FALSE(certInfo(reinterpret_cast<const uint8_t*>("nope"), 4).ok);
    EXPECT_EQ(sha256Hex(reinterpret_cast<const uint8_t*>("abc"), 3),
              "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}

// open62541 runs the entropy self test when it sets up a SecurityPolicy (mat_mbedtls_config.h).
TEST(OpcUaCert, TheEntropySelfTestOfTheSecurityPoliciesPasses) {
    EXPECT_EQ(mbedtls_entropy_self_test(1), 0);
    UA_SecurityPolicy sp;
    std::memset(&sp, 0, sizeof sp);
    ClientIdentity id;
    std::string err;
    ASSERT_TRUE(clientIdentity(opcuatest::certDir("identity"), "urn:test:a", id, err)) << err;
    UA_ByteString cert = {id.cert.size(), id.cert.data()};
    UA_ByteString key = {id.key.size(), id.key.data()};
    UA_Logger* logger = UA_Log_Stdout_new(UA_LOGLEVEL_WARNING);
    const UA_StatusCode st = UA_SecurityPolicy_Basic256Sha256(&sp, cert, key, logger);
    EXPECT_EQ(st, UA_STATUSCODE_GOOD) << UA_StatusCode_name(st);
    if (st == UA_STATUSCODE_GOOD) sp.clear(&sp);
    logger->clear(logger);
}
