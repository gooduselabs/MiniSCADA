// Omron FINS driver (feature 018; spec FR-001 to FR-010; ADR-046). One driver per channel, one
// thread per channel (stack 256 KiB), as the Modbus TCP driver: the channel is one IP endpoint (an
// Ethernet unit or the built-in port of a CJ2 / CP1L-E), its field devices are FINS addresses
// (network, node, unit) behind it, one request in flight at a time.
//
// The loop of the thread:
//   - not connected: wait out the backoff, open the link: UDP opens a socket (nothing is sent);
//     TCP connects and exchanges the node addresses (FINS/TCP command 0 / 1). A failure makes every
//     Tag BAD DISCONNECTED (REFUSED when the PLC refused);
//   - connected: the scheduler gives the next job, a queued write first, then the read request
//     with the earliest due time. A read is a Memory Area Read (0101) of a block of words (or
//     flags) or a Multiple Memory Area Read (0104) of small scattered blocks;
//   - a response is matched by its addresses, SID and command code; one that does not match is
//     dropped and counted, and the wait goes on. A timeout sends the command again with a new SID
//     (`retries`); the answer to an old SID is dropped when it comes;
//   - no answer after the retries: the Tags of that field device are BAD TIMEOUT and the device
//     waits out its own backoff (1 s to 30 s), then one probe read asks it again. 3 timeouts in a
//     row over 2 field devices (or the only one) close the link: TCP disconnects, UDP opens a new
//     socket, after the channel's backoff;
//   - an end code other than 0000 is a valid answer: 1103/1104/110B on a request of several Tags
//     splits it (a 0104 goes back to one 0101 per block), on one Tag that Tag is BAD FINS_ADDRESS;
//     other end codes make the Tags of the request BAD FINS_* (end_codes.hpp); 01xx/02xx/05xx (the
//     destination is not reachable) put the field device in the error state;
//   - a write is sent once (0102, with a bit area code for a bit), never again; a readback
//     follows (as Modbus, data-model §8 of feature 006).
//
// Tests run it without a thread: `manual` in FinsEnv, then pump(untilMs) runs the loop on the
// injected clock and transport.
#pragma once
#include <pthread.h>

#include <array>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include "drivers/fins/address.hpp"
#include "drivers/fins/frame.hpp"
#include "drivers/modbus/codec.hpp"
#include "drivers/sdk/backoff.hpp"
#include "drivers/sdk/diag.hpp"
#include "drivers/sdk/driver.hpp"
#include "drivers/sdk/scheduler.hpp"
#include "drivers/sdk/transport.hpp"

namespace mat::drv {

// A Tag of a FINS field device, resolved by the engine (fins_factory).
struct FinsTagBinding {
    size_t tag = 0;       // index in the TagStore
    uint32_t device = 0;  // field device number inside the driver
    fins::Address addr;   // parsed (ok)
    TagType rawType = TagType::UINT16;
    modbus::ByteOrder byteOrder = modbus::ByteOrder::CDAB;  // Omron: low word first
    modbus::StringByteOrder stringOrder = modbus::StringByteOrder::AB;
    int stringLength = 0;
    bool bcd = false;
    ScanGroup group = ScanGroup::Normal;
    bool readback = true;
};

struct FinsDeviceConfig {
    std::string id;
    bool enabled = true;
    int network = 0;  // DNA, 0 the local network
    int node = 0;     // DA1; 0: automatic (UDP: the last byte of the PLC's IPv4; TCP: the server)
    int unit = 0;     // DA2, 0 the CPU unit
    int timeoutMs = 1000;
    int retries = 1;
    int writeDeadlineMs = 5000;
    int maxReadWords = 999;
    int maxGapWords = 10;
    bool multiRead = true;
    int maxMultiItems = 64;
};

struct FinsConfig {
    std::string channelId;
    bool enabled = true;
    std::string host;
    int port = 9600;
    bool tcp = false;
    int sourceNetwork = 0;  // SNA
    int sourceNode = 0;     // SA1; 0: automatic (UDP: the last byte of our IPv4; TCP: assigned)
    int localPort = 0;      // UDP: 0 a port of the system's choice
    int connectTimeoutMs = 3000;
    int reconnectMaxS = 10;
    int requestGapMs = 0;
    std::array<int64_t, 3> scanMs = {250, 1000, 5000};
    int writeQueueCapacity = 16;
    std::vector<FinsDeviceConfig> devices;
    std::vector<FinsTagBinding> tags;
};

// What a test replaces. Empty members take the real thing.
struct FinsEnv {
    std::function<std::unique_ptr<Transport>()> makeTransport;  // default: UdpLink or TcpSocket
    const Clock* clock = nullptr;
    std::function<double()> uniform;  // backoff jitter, [0, 1)
    std::function<uint8_t()> firstSid;
    bool manual = false;
    std::function<void(int64_t untilMs)> sleep;
};

// A connection test of a FINS endpoint (POST /api/v1/drivers/test, kind fins).
struct FinsProbeRequest {
    std::string host;
    int port = 9600;
    bool tcp = false;
    int localPort = 0;
    int connectTimeoutMs = 3000;
    int timeoutMs = 1000;
    fins::Endpoint dst;  // node 0: automatic
    fins::Endpoint src;  // node 0: automatic
    bool read = false;   // false: a Controller Data Read (0501)
    fins::Address addr;  // with `read`
    int count = 1;       // words (or flags) read, 1-4
};
struct FinsProbeOutcome {
    TestOutcome base;  // code OK, TIMEOUT, REFUSED, UNREACHABLE, DNS, BAD_FRAME, END_CODE, ...
    uint16_t endCode = 0;
    std::string model;                     // 0501: the CPU model
    int clientNode = -1, serverNode = -1;  // TCP: the nodes the server gave
};
FinsProbeOutcome probeFins(const FinsProbeRequest& req, Transport& transport, const Clock& clock);
// The same on a new UdpLink or TcpSocket and the system clock.
FinsProbeOutcome probeFins(const FinsProbeRequest& req);

class FinsDriver : public Driver {
   public:
    explicit FinsDriver(FinsConfig config, FinsEnv env = {});
    ~FinsDriver() override;

    void start(EngineSink& sink) override;
    void stop() override;
    bool enqueueWrite(WriteCommand cmd) override;
    std::vector<uint64_t> cancelQueuedWrites() override;
    LinkState linkState(uint32_t device) const override;
    void diagnostics(DriverDiag& out, int64_t nowMs) const override;
    // A new, temporary link (the channel's own is not touched): 0501, or a read of `req.address`
    // (as a UINT16 / BOOL address) when `req.read`.
    TestOutcome test(const TestRequest& req) override;

    void pump(int64_t untilMs);
    const FinsConfig& config() const { return cfg_; }

    // The plan as it is now (tests): per device and group, the requests with their kind (0101 or
    // 0104), first wire address and word / item count.
    struct PlannedRequest {
        bool multi = false;
        uint8_t code = 0;
        int start = 0;
        int count = 0;  // words, flags or 0104 items
        std::vector<size_t> tags;
    };
    std::vector<PlannedRequest> plannedRequests(uint32_t device, int group) const;

   private:
    struct SubBlock {
        uint8_t code = 0;
        bool words = true;  // false: flags (1 byte each)
        int start = 0;      // wire address
        int count = 0;
        std::vector<size_t> tags;  // indexes in cfg_.tags
    };
    struct Request {
        bool multi = false;
        std::vector<SubBlock> blocks;  // one for a 0101; the blocks packed into a 0104
        std::vector<size_t> tags() const;
    };
    struct Round {
        std::vector<Request> requests;
    };
    enum class Outcome { Ok, EndCode, Timeout, Closed, Lost, Interrupted };
    struct Exchange {
        Outcome outcome = Outcome::Timeout;
        fins::Response resp;
        int64_t elapsedMs = 0;
    };
    struct QueuedWrite {
        WriteCommand cmd;
        int64_t enqueuedMs = 0;
    };

    void halt();
    void loop(int64_t untilMs);
    void idle(int64_t untilMs);
    static void* threadMain(void* self);
    int64_t mono() const { return clock_->monoMs(); }
    int64_t wall() const { return clock_->wallMs(); }

    bool connectNow();
    bool tcpHandshake();
    void onConnected();
    void failConnect(const std::string& code, const std::string& reason);
    void dropConnection(const char* errorCode, const std::vector<size_t>& failedTags,
                        const char* failedReason);
    void buildPlan();
    bool splitRequestAt(size_t dev, int group, size_t index);
    void setChannelState(ChannelState s);
    void setDeviceState(size_t dev, DeviceState s);
    bool deviceSuspended(size_t dev) const;
    void deviceAnswered(size_t dev);
    bool deviceTimedOut(size_t dev, const std::vector<size_t>& tags);
    void forgetLate();

    fins::Endpoint peerOf(size_t dev) const;
    Exchange exchange(size_t dev, uint16_t command, const fins::Bytes& params, int timeoutMs,
                      int retries);
    bool receiveFrame(int64_t deadline, fins::Bytes& frame, Outcome& fail);

    void runRead(const Scheduler::Job& job);
    bool requestValues(const Request& r, const fins::Response& resp,
                       std::vector<std::vector<uint16_t>>& values) const;
    bool decodeTag(const FinsTagBinding& t, const std::vector<uint16_t>& words, TagScalar& out,
                   std::string& reason) const;
    void publishRequest(const Request& r, const std::vector<std::vector<uint16_t>>& values);
    void publishBad(const std::vector<size_t>& tags, const std::string& reason);
    void publishBadAll(const std::string& reason, const std::vector<size_t>* except);

    void runWrite();
    void finishWrite(size_t local, WriteResult&& r);
    void failQueuedWrites(const char* code);

    FinsConfig cfg_;
    FinsEnv env_;
    SystemClock systemClock_;
    const Clock* clock_;
    EngineSink* sink_ = nullptr;
    std::unique_ptr<Transport> transport_;
    DiagCounters diag_;
    Backoff backoff_;
    std::unordered_map<size_t, size_t> localOf_;  // store index -> index in cfg_.tags

    std::vector<std::array<Round, 3>> rounds_;
    mutable std::mutex schedMu_;
    Scheduler sched_;

    // the link (driver thread only)
    bool connected_ = false;
    bool everConnected_ = false;
    int64_t nextConnectMs_ = 0;
    bool firstSuccessPending_ = false;
    fins::Bytes rx_;  // TCP: bytes not yet cut into messages
    uint8_t nextSid_ = 0;
    fins::Endpoint us_;     // our FINS address on this link
    int serverNode_ = 0;    // TCP: the node of the PLC's unit from the handshake
    int peerAutoNode_ = 0;  // UDP: the last byte of the PLC's IPv4
    std::vector<std::string> lastBad_;
    std::vector<Backoff> deviceBackoff_;
    std::vector<int64_t> probeAt_;
    int timeoutsInARow_ = 0;
    std::vector<bool> timeoutDevices_;
    std::deque<uint8_t> lateSids_;

    mutable std::mutex wmu_;
    std::deque<QueuedWrite> writes_;

    std::atomic<int> channelState_{static_cast<int>(ChannelState::Disabled)};
    std::unique_ptr<std::atomic<int>[]> deviceState_;

    std::mutex mu_;
    std::condition_variable cv_;
    bool wake_ = false;
    std::atomic<bool> stopping_{false};
    bool started_ = false;
    bool threadRunning_ = false;
    pthread_t thread_{};
};

}  // namespace mat::drv
