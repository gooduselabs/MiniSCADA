// MQTT 3.1.1 packets (OASIS standard, feature 022): the encoders and decoders the client needs
// (CONNECT, PUBLISH QoS 0/1, PUBACK, SUBSCRIBE, PINGREQ, DISCONNECT; CONNACK, SUBACK, PINGRESP
// read) and the ones of a broker (tools/mqtt-sim and the tests). Pure, no I/O. The Framer cuts a
// byte stream into packets; a remaining length over `maxPacket` or of more than 4 bytes is an
// error (the connection is then dropped).
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace mat::mqtt {

enum class PacketType : uint8_t {
    Connect = 1,
    Connack = 2,
    Publish = 3,
    Puback = 4,
    Subscribe = 8,
    Suback = 9,
    Unsubscribe = 10,
    Unsuback = 11,
    Pingreq = 12,
    Pingresp = 13,
    Disconnect = 14,
};

struct Packet {
    PacketType type = PacketType::Pingreq;
    uint8_t flags = 0;  // the low 4 bits of the fixed header
    std::vector<uint8_t> body;
};

struct ConnectOptions {
    std::string clientId;
    int keepAliveS = 30;
    bool cleanSession = true;
    bool hasUsername = false, hasPassword = false;
    std::string username, password;
    bool hasWill = false;
    std::string willTopic, willPayload;
    int willQos = 0;
    bool willRetain = false;
};

struct Connack {
    bool sessionPresent = false;
    int returnCode = 0;  // 0 accepted; 1-5 refused (section 3.2.2.3)
};

struct Publish {
    std::string topic;
    std::string payload;
    int qos = 0;
    bool retain = false;
    bool dup = false;
    uint16_t packetId = 0;  // QoS 1-2
};

struct Subscribe {
    uint16_t packetId = 0;
    std::vector<std::pair<std::string, int>> filters;  // filter, requested QoS
};

// ---- client -> broker ----
std::vector<uint8_t> encodeConnect(const ConnectOptions& o);
std::vector<uint8_t> encodePublish(const Publish& p);
std::vector<uint8_t> encodePuback(uint16_t packetId);
std::vector<uint8_t> encodeSubscribe(const Subscribe& s);
std::vector<uint8_t> encodePingreq();
std::vector<uint8_t> encodeDisconnect();

// ---- broker -> client ----
std::vector<uint8_t> encodeConnack(const Connack& c);
std::vector<uint8_t> encodeSuback(uint16_t packetId, const std::vector<uint8_t>& codes);
std::vector<uint8_t> encodePingresp();

// ---- decoders: false on a malformed packet ----
bool parseConnack(const Packet& p, Connack& out);
bool parsePublish(const Packet& p, Publish& out);
bool parsePacketId(const Packet& p, uint16_t& out);  // PUBACK, UNSUBACK
bool parseSuback(const Packet& p, uint16_t& id, std::vector<uint8_t>& codes);
bool parseConnect(const Packet& p, ConnectOptions& out);
bool parseSubscribe(const Packet& p, Subscribe& out);

// Cuts a byte stream into packets.
class Framer {
   public:
    explicit Framer(size_t maxPacket = 256 * 1024) : max_(maxPacket) {}
    void feed(const uint8_t* data, size_t n) { buf_.insert(buf_.end(), data, data + n); }
    enum class Result { Need, Ready, Error };
    // Ready: `out` holds the next packet. Error: the stream is not MQTT or a packet is too large.
    Result next(Packet& out);
    void clear() { buf_.clear(); }
    size_t buffered() const { return buf_.size(); }

   private:
    size_t max_;
    std::vector<uint8_t> buf_;
};

// Remaining length (section 2.2.3), appended to `out`; false over 268435455.
bool appendRemainingLength(std::vector<uint8_t>& out, size_t n);

}  // namespace mat::mqtt
