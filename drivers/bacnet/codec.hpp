// BACnet/IP encoding and decoding (feature 020, spec FR-001 to FR-004, FR-009; ADR-048). Pure
// code, no I/O; byte vectors in tests/bacnet-vectors/frames.json (ASHRAE 135 Annex F examples and
// Annex J framing).
//
//   BVLC (Annex J.2): 0x81, function, length (16 bit, the whole datagram)
//   NPDU (clause 6):  version 1, control, [DNET DLEN DADR], [SNET SLEN SADR], [hop count]
//   APDU (clause 20): PDU type in the high nibble of the first byte, then the service
//   data: tags (clause 20.2): application tags 0-12, context tags, opening / closing tags
//
// The decoder never reads past its buffer, rejects lengths larger than what is left and limits the
// nesting of opening tags (kMaxDepth): every failure is a false return, never an exception.
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace mat::bacnet {

using Bytes = std::vector<uint8_t>;

constexpr int kDefaultPort = 47808;  // 0xBAC0
constexpr int kMaxApdu = 1476;       // BACnet/IP
constexpr int kMaxDepth = 8;         // nested opening tags the decoder accepts

// BVLC functions (Annex J.2).
enum BvlcFunction : uint8_t {
    kBvlcResult = 0x00,
    kBvlcForwardedNpdu = 0x04,
    kBvlcRegisterForeignDevice = 0x05,
    kBvlcDistributeBroadcast = 0x09,
    kBvlcOriginalUnicast = 0x0A,
    kBvlcOriginalBroadcast = 0x0B,
};

// APDU types (clause 20.1).
enum PduType : uint8_t {
    kConfirmedRequest = 0,
    kUnconfirmedRequest = 1,
    kSimpleAck = 2,
    kComplexAck = 3,
    kSegmentAck = 4,
    kError = 5,
    kReject = 6,
    kAbort = 7,
};

// Services used.
enum Service : uint8_t {
    kServiceIAm = 0,    // unconfirmed
    kServiceWhoIs = 8,  // unconfirmed
    kServiceReadProperty = 12,
    kServiceReadPropertyMultiple = 14,
    kServiceWriteProperty = 15,
};

// Application tags (clause 20.2.1.4).
enum AppTag : uint8_t {
    kTagNull = 0,
    kTagBoolean = 1,
    kTagUnsigned = 2,
    kTagSigned = 3,
    kTagReal = 4,
    kTagDouble = 5,
    kTagOctetString = 6,
    kTagCharString = 7,
    kTagBitString = 8,
    kTagEnumerated = 9,
    kTagDate = 10,
    kTagTime = 11,
    kTagObjectId = 12,
};

// Error codes the driver names (BACnetErrorCode) and reject / abort reasons.
enum ErrorCode : uint32_t {
    kErrInvalidDataType = 9,
    kErrUnknownObject = 31,
    kErrUnknownProperty = 32,
    kErrValueOutOfRange = 37,
    kErrWriteAccessDenied = 40,
    kErrServiceRequestDenied = 29,
    kErrPropertyIsNotAnArray = 50,
    kErrInvalidArrayIndex = 42,
};
constexpr uint8_t kRejectUnrecognizedService = 9;
constexpr uint8_t kAbortBufferOverflow = 1;
constexpr uint8_t kAbortSegmentationNotSupported = 4;
constexpr uint8_t kAbortApduTooLong = 11;

struct ObjectId {
    uint32_t type = 0;
    uint32_t instance = 0;
    uint32_t raw() const { return (type << 22) | (instance & 0x3FFFFF); }
    static ObjectId of(uint32_t raw) { return {raw >> 22, raw & 0x3FFFFF}; }
    bool operator==(const ObjectId& o) const { return type == o.type && instance == o.instance; }
};

// A decoded application value.
struct Value {
    AppTag tag = kTagNull;
    bool b = false;     // Boolean
    uint64_t u = 0;     // Unsigned, Enumerated
    int64_t i = 0;      // Signed
    double d = 0;       // Real, Double
    std::string s;      // CharString (UTF-8 / ANSI X3.4), OctetString
    uint32_t bits = 0;  // BitString: bit 0 the first bit, up to 32 bits
    int bitCount = 0;
    ObjectId obj;      // ObjectId
    uint32_t raw = 0;  // Date, Time: the four bytes

    static Value null() { return {}; }
    static Value boolean(bool v);
    static Value unsignedInt(uint64_t v);
    static Value signedInt(int64_t v);
    static Value real(float v);
    static Value enumerated(uint64_t v);
    static Value charString(const std::string& v);
};

// ---- encoding ----
void encodeAppValue(Bytes& out, const Value& v);
void encodeContextUnsigned(Bytes& out, uint8_t tag, uint64_t v);
void encodeContextObjectId(Bytes& out, uint8_t tag, ObjectId id);
void encodeOpening(Bytes& out, uint8_t tag);
void encodeClosing(Bytes& out, uint8_t tag);

// ---- tag reader ----
struct TagHeader {
    uint8_t number = 0;
    bool context = false;
    bool opening = false;
    bool closing = false;
    uint32_t length = 0;  // value length (or the Boolean value of an application Boolean)
};

class Reader {
   public:
    Reader(const uint8_t* p, size_t n) : p_(p), n_(n) {}
    explicit Reader(const Bytes& b) : p_(b.data()), n_(b.size()) {}
    bool atEnd() const { return pos_ >= n_; }
    size_t pos() const { return pos_; }
    size_t left() const { return n_ - pos_; }
    // The next tag header without taking it.
    bool peek(TagHeader& h) const;
    bool next(TagHeader& h);
    // An application value (header and content).
    bool appValue(Value& v);
    // Context tag `tag` with an unsigned / object id content.
    bool contextUnsigned(uint8_t tag, uint64_t& v);
    bool contextObjectId(uint8_t tag, ObjectId& id);
    bool opening(uint8_t tag);
    bool closing(uint8_t tag);
    bool isOpening(uint8_t tag) const;
    bool isClosing(uint8_t tag) const;
    bool isContext(uint8_t tag) const;
    // Skips one complete element (a primitive or an opening ... closing block).
    bool skip();
    bool take(size_t n, const uint8_t*& data);

   private:
    bool unsignedContent(uint32_t len, uint64_t& v);
    const uint8_t* p_;
    size_t n_;
    size_t pos_ = 0;
};

// ---- NPDU routing ----
struct Route {
    int network = 0;  // 0: the local network; 0xFFFF: global broadcast
    Bytes mac;        // DADR (empty with network 0xFFFF: broadcast on all networks)
};

// ---- frames ----
// Max APDU code of a confirmed request (clause 20.1.2.5): 0 50, 1 128, 2 206, 3 480, 4 1024, 5
// 1476.
uint8_t maxApduCode(int maxApdu);
int maxApduOfCode(uint8_t code);

// A confirmed request, BVLC Original-Unicast. No segmentation: segmented-response-accepted 0.
Bytes buildConfirmed(uint8_t invokeId, uint8_t service, const Bytes& serviceData,
                     const Route& dst = {}, int maxApduAccepted = kMaxApdu);
// An unconfirmed request; `bvlc` Original-Unicast, Original-Broadcast or Distribute-Broadcast.
Bytes buildUnconfirmed(uint8_t service, const Bytes& serviceData, uint8_t bvlc,
                       const Route& dst = {});
// Register-Foreign-Device with a time-to-live in seconds.
Bytes buildRegisterForeignDevice(uint16_t ttlS);

struct Frame {
    uint8_t bvlc = 0;
    uint16_t bvlcResult = 0;  // BVLC-Result
    // Forwarded-NPDU: the B/IP address of the origin
    uint32_t originIp = 0;
    uint16_t originPort = 0;
    bool hasApdu = false;
    int srcNetwork = 0;  // SNET, 0 none
    Bytes srcMac;
    uint8_t pduType = 0;
    uint8_t invokeId = 0;
    uint8_t service = 0;  // service choice; reject / abort reason for those PDUs
    bool segmented = false;
    bool serverAbort = false;
    uint8_t maxApduCode = 0;  // a confirmed request
    // Error PDU
    uint32_t errorClass = 0;
    uint32_t errorCode = 0;
    // the service data after the APDU header (a view into the datagram)
    const uint8_t* data = nullptr;
    size_t dataLen = 0;
};

// false: not a BACnet/IP datagram the driver understands (counted as a bad frame); `why` names it.
bool parseFrame(const uint8_t* p, size_t n, Frame& f, std::string* why = nullptr);
inline bool parseFrame(const Bytes& b, Frame& f, std::string* why = nullptr) {
    return parseFrame(b.data(), b.size(), f, why);
}

// ---- services ----
struct PropertyRef {
    uint32_t property = 0;
    int64_t arrayIndex = -1;  // -1: none
};
struct ObjectRefs {
    ObjectId obj;
    std::vector<PropertyRef> props;
};

Bytes encodeWhoIs(int64_t low = -1, int64_t high = -1);
Bytes encodeReadProperty(ObjectId obj, uint32_t property, int64_t arrayIndex = -1);
Bytes encodeReadPropertyMultiple(const std::vector<ObjectRefs>& objects);
// `value` null: relinquish. `priority` 0: none.
Bytes encodeWriteProperty(ObjectId obj, uint32_t property, const Value& value, int priority = 0,
                          int64_t arrayIndex = -1);

struct IAm {
    uint32_t instance = 0;
    uint32_t maxApdu = 0;
    uint32_t segmentation = 3;  // 0 both, 1 transmit, 2 receive, 3 none
    uint32_t vendorId = 0;
};
bool decodeIAm(const uint8_t* p, size_t n, IAm& out);

// ReadProperty-ACK: the values of the property (usually one; several for a list or an array).
struct PropertyResult {
    ObjectId obj;
    uint32_t property = 0;
    int64_t arrayIndex = -1;
    bool ok = false;
    std::vector<Value> values;
    uint32_t errorClass = 0, errorCode = 0;
};
bool decodeReadPropertyAck(const uint8_t* p, size_t n, PropertyResult& out);
bool decodeReadPropertyMultipleAck(const uint8_t* p, size_t n, std::vector<PropertyResult>& out);

// Bytes a property takes in a RPM request and (an estimate) in its answer.
size_t rpmRequestBytes(const PropertyRef& ref);
size_t rpmObjectRequestBytes();
size_t rpmAnswerBytes(uint32_t property, int stringLength);

// The SDK reason of a BACnet error code (spec FR-009).
const char* errorReason(uint32_t errorCode);
std::string hexOf(const Bytes& b);
Bytes fromHex(const std::string& hex);

}  // namespace mat::bacnet
