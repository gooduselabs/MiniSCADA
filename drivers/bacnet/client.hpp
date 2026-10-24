// One confirmed request of BACnet/IP at a time over a DatagramPort (feature 020, spec FR-003,
// FR-010): the driver thread and the connection test both use it.
//
// A request gets the next invoke ID of the port (0-255, rolling, skipping the IDs of requests that
// timed out recently and whose answer may still come). A timeout sends the same datagram again
// with the same invoke ID (clause 5.4.4, APDU_Retries). An answer must come from the target's IP
// and port, carry the invoke ID and, for an ACK or an Error, the service; for a device behind a
// router the SNET/SADR of the answer must be the target's. Anything else is a bad frame: counted
// and dropped, the wait goes on. Unsolicited frames (I-Am, BVLC-Result) go to `onOther`.
#pragma once
#include <atomic>
#include <deque>
#include <functional>

#include "drivers/bacnet/codec.hpp"
#include "drivers/bacnet/udp_port.hpp"
#include "drivers/sdk/transport.hpp"

namespace mat::bacnet {

struct Target {
    uint32_t ip = 0;
    uint16_t port = kDefaultPort;
    Route route;  // network 0: on the IP network of the target
    int maxApdu = kMaxApdu;
};

struct Reply {
    enum class Code { Ack, Error, Reject, Abort, Segmented, Timeout, Closed, Interrupted };
    Code code = Code::Timeout;
    uint8_t pduType = 0;
    uint32_t errorClass = 0, errorCode = 0;
    uint8_t reason = 0;  // Reject / Abort
    Bytes data;          // the service data of an ACK
    int64_t elapsedMs = 0;
    int64_t responseMs = 0;  // from the last send to the answer
    Bytes request, response;
};

class Client {
   public:
    Client(DatagramPort& port, const drv::Clock& clock, const std::atomic<bool>* stopping = nullptr)
        : port_(port), clock_(clock), stopping_(stopping) {}

    void setFirstInvokeId(uint8_t id) { nextInvoke_ = id; }
    // A confirmed request; `retries` more sends after a timeout.
    Reply request(const Target& t, uint8_t service, const Bytes& data, int timeoutMs, int retries);
    // An unconfirmed datagram to ip:port.
    bool send(uint32_t ip, uint16_t port, const Bytes& datagram);
    // Reads and hands every frame to `onOther` until `untilMs` (monotonic) or `stop` returns true.
    void drain(int64_t untilMs, const std::function<bool()>& stop = nullptr);

    std::function<void()> onBadFrame;
    std::function<void()> onTimeout;  // every attempt that timed out
    std::function<void(const Frame&, uint32_t ip, uint16_t port)> onOther;

   private:
    bool stopped() const { return stopping_ && stopping_->load(); }
    DatagramPort& port_;
    const drv::Clock& clock_;
    const std::atomic<bool>* stopping_;
    uint8_t nextInvoke_ = 0;
    std::deque<uint8_t> late_;
};

}  // namespace mat::bacnet
