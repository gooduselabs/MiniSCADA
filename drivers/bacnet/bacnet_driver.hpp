// BACnet/IP client driver (feature 020; spec FR-001 to FR-014; ADR-048). One driver per channel,
// one thread per channel (stack 256 KiB), as the Modbus, S7 and FINS drivers: the channel is one
// UDP port (47808 by default), its field devices are BACnet devices at their own IPv4 address (or
// behind a BACnet router: network + MAC), one confirmed request in flight at a time.
//
// The loop of the thread:
//   - not open: wait out the backoff, open the UDP port (a taken port is PORT_BUSY), resolve the
//     devices' hosts; with a BBMD, register as a foreign device (again every TTL / 2);
//   - open: the scheduler gives the next job, a queued write first, then the read request with the
//     earliest due time. A read is a ReadPropertyMultiple of several objects and properties, sized
//     to the device's maxApdu both ways (no segmentation), or a ReadProperty per property when the
//     device has no RPM (`useRpm` false, or it rejected the service: then for good);
//   - a Tag of present-value brings the status-flags of its object into the same request: fault
//     makes it BAD BACNET_FAULT, out-of-service or overridden UNCERTAIN;
//   - an error per property (unknown-object, ...) makes only those Tags BAD; an Abort for the size
//     of the answer (or a segmented answer) splits the request in two;
//   - a timeout sends the request again with the same invoke ID (`retries`); no answer after the
//     retries: the Tags of that device are BAD TIMEOUT and it waits out its own backoff (1 s to
//     30 s), then one probe request asks it again;
//   - a write is a WriteProperty of present-value at the Tag's priority (or the device's
//     `writePriority`), NULL for a `relinquish` Tag; sent once, never again, then read back.
//
// Tests run it without a thread: `manual` in BacnetEnv, then pump(untilMs) runs the loop on the
// injected clock and port.
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

#include "drivers/bacnet/address.hpp"
#include "drivers/bacnet/client.hpp"
#include "drivers/bacnet/codec.hpp"
#include "drivers/bacnet/udp_port.hpp"
#include "drivers/sdk/backoff.hpp"
#include "drivers/sdk/diag.hpp"
#include "drivers/sdk/driver.hpp"
#include "drivers/sdk/scheduler.hpp"

namespace mat::drv {

// A Tag of a BACnet device, resolved by the engine (bacnet_factory).
struct BacnetTagBinding {
    size_t tag = 0;        // index in the TagStore
    uint32_t device = 0;   // field device number inside the driver
    bacnet::Address addr;  // parsed (ok)
    TagType rawType = TagType::FLOAT32;
    int stringLength = 0;  // STRING: the longest text kept (0: as it comes)
    ScanGroup group = ScanGroup::Normal;
    bool readback = true;
};

struct BacnetDeviceConfig {
    std::string id;
    bool enabled = true;
    uint32_t deviceInstance = 0;
    std::string host;
    int port = bacnet::kDefaultPort;
    int network = 0;    // DNET of a device behind a router, 0 none
    bacnet::Bytes mac;  // its DADR
    int maxApdu = bacnet::kMaxApdu;
    int timeoutMs = 500;
    int retries = 1;
    int writeDeadlineMs = 5000;
    int writePriority = 16;
    bool useRpm = true;
    int maxRpmProps = 32;
};

struct BacnetConfig {
    std::string channelId;
    bool enabled = true;
    int localPort = bacnet::kDefaultPort;
    std::string bindAddress;                    // "" every interface
    std::string broadcast = "255.255.255.255";  // Who-Is of the connection test
    std::string bbmdHost;                       // "" not a foreign device
    int bbmdPort = bacnet::kDefaultPort;
    int bbmdTtlS = 300;
    int reconnectMaxS = 10;
    int requestGapMs = 0;
    std::array<int64_t, 3> scanMs = {250, 1000, 5000};
    int writeQueueCapacity = 16;
    std::vector<BacnetDeviceConfig> devices;
    std::vector<BacnetTagBinding> tags;
};

// What a test replaces. Empty members take the real thing.
struct BacnetEnv {
    std::function<std::unique_ptr<bacnet::DatagramPort>()> makePort;  // default: UdpPort
    std::function<bool(const std::string&, uint32_t&)> resolve;       // default: resolveIpv4
    const Clock* clock = nullptr;
    std::function<double()> uniform;  // backoff jitter, [0, 1)
    std::function<uint8_t()> firstInvokeId;
    bool manual = false;
    std::function<void(int64_t untilMs)> sleep;
};

// The connection test of a BACnet channel (POST /api/v1/drivers/test, kind bacnet).
struct BacnetProbeRequest {
    enum class Action { Read, WhoIs, Objects };
    Action action = Action::Read;
    int localPort = 0;  // 0: a port of the system's choice (the channel may hold 47808)
    std::string bindAddress;
    std::string broadcast = "255.255.255.255";
    int broadcastPort = bacnet::kDefaultPort;
    std::string bbmdHost;
    int bbmdPort = bacnet::kDefaultPort;
    // Read, Objects: the device
    std::string host;
    int port = bacnet::kDefaultPort;
    int network = 0;
    bacnet::Bytes mac;
    uint32_t deviceInstance = 0;
    int timeoutMs = 3000;
    bool hasAddress = false;  // Read: false reads object-name of the Device object
    bacnet::Address addr;
    // WhoIs
    int64_t low = -1, high = -1;
    int waitMs = 3000;
    size_t maxObjects = 2000;
};
struct BacnetFoundDevice {
    uint32_t instance = 0;
    std::string host;
    int port = 0;
    int network = 0;
    bacnet::Bytes mac;
    uint32_t maxApdu = 0;
    uint32_t segmentation = 3;
    uint32_t vendorId = 0;
};
struct BacnetProbeOutcome {
    TestOutcome
        base;  // OK, TIMEOUT, PORT_BUSY, DNS, BACNET_ERROR, BACNET_REJECT, BACNET_ABORT, ...
    std::string valueText;  // Read: the value as text
    std::string valueKind;  // real, unsigned, signed, boolean, enumerated, string, null, ...
    uint32_t errorClass = 0, errorCode = 0;
    int reason = -1;                         // Reject / Abort reason
    std::vector<BacnetFoundDevice> devices;  // WhoIs
    std::vector<bacnet::ObjectId> objects;   // Objects
    std::vector<std::string> objectNames;    // Objects: object-name of each (may be "")
    bool truncated = false;
};
BacnetProbeOutcome probeBacnet(const BacnetProbeRequest& req, bacnet::DatagramPort& port,
                               const Clock& clock,
                               const std::function<bool(const std::string&, uint32_t&)>& resolve);
// The same on a new UdpPort, the system clock and resolver.
BacnetProbeOutcome probeBacnet(const BacnetProbeRequest& req);

class BacnetDriver : public Driver {
   public:
    explicit BacnetDriver(BacnetConfig config, BacnetEnv env = {});
    ~BacnetDriver() override;

    void start(EngineSink& sink) override;
    void stop() override;
    bool enqueueWrite(WriteCommand cmd) override;
    std::vector<uint64_t> cancelQueuedWrites() override;
    LinkState linkState(uint32_t device) const override;
    void diagnostics(DriverDiag& out, int64_t nowMs) const override;
    // A read of object-name of the first device's Device object, on a new temporary port.
    TestOutcome test(const TestRequest& req) override;

    void pump(int64_t untilMs);
    const BacnetConfig& config() const { return cfg_; }

    // The plan as it is now (tests): per device and group, each request with its kind and items.
    struct PlannedItem {
        bacnet::ObjectId obj;
        uint32_t property = 0;
        int64_t arrayIndex = -1;
    };
    struct PlannedRequest {
        bool rpm = true;
        std::vector<PlannedItem> items;
    };
    std::vector<PlannedRequest> plannedRequests(uint32_t device, int group) const;

   private:
    struct Item {
        bacnet::ObjectId obj;
        uint32_t property = 0;
        int64_t arrayIndex = -1;
        std::vector<size_t> tags;  // indexes in cfg_.tags
        int stringLength = 0;
    };
    struct Request {
        bool rpm = true;
        std::vector<Item> items;
        std::vector<size_t> tags() const;
    };
    struct Round {
        std::vector<Request> requests;
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

    bool openNow();
    void failOpen(const std::string& code);
    void registerForeign();
    void onOther(const bacnet::Frame& f, uint32_t ip, uint16_t port);
    void buildPlan();
    void buildDevicePlan(size_t dev);
    bool splitRequestAt(size_t dev, int group, size_t index);
    void setChannelState(ChannelState s);
    void setDeviceState(size_t dev, DeviceState s);
    bool deviceSuspended(size_t dev) const;
    void deviceAnswered(size_t dev);
    void deviceTimedOut(size_t dev);
    void countException(size_t dev, const bacnet::Reply& r);
    std::string replyReason(const bacnet::Reply& r) const;

    bacnet::Reply call(size_t dev, uint8_t service, const bacnet::Bytes& data, int retries);
    void runRead(const Scheduler::Job& job);
    bool readRequest(size_t dev, const Request& r, std::vector<bacnet::PropertyResult>& results,
                     bacnet::Reply& reply);
    void publishResults(size_t dev, const Request& r,
                        const std::vector<bacnet::PropertyResult>& results);
    bool decodeTag(const BacnetTagBinding& t, const std::vector<bacnet::Value>& values,
                   TagScalar& out, std::string& reason) const;
    void publishBad(const std::vector<size_t>& tags, const std::string& reason);
    void publishBadAll(const std::string& reason);

    void runWrite();
    void finishWrite(size_t local, WriteResult&& r);
    void failQueuedWrites(const char* code);

    BacnetConfig cfg_;
    BacnetEnv env_;
    SystemClock systemClock_;
    const Clock* clock_;
    EngineSink* sink_ = nullptr;
    std::unique_ptr<bacnet::DatagramPort> port_;
    std::unique_ptr<bacnet::Client> client_;
    DiagCounters diag_;
    Backoff backoff_;
    std::unordered_map<size_t, size_t> localOf_;  // store index -> index in cfg_.tags

    std::vector<std::array<Round, 3>> rounds_;
    mutable std::mutex schedMu_;
    Scheduler sched_;

    // driver thread only
    bool open_ = false;
    bool everOpen_ = false;
    int64_t nextOpenMs_ = 0;
    int64_t nextRegisterMs_ = 0;
    uint32_t bbmdIp_ = 0;
    bool bbmdNakWarned_ = false;
    std::vector<bacnet::Target> targets_;
    std::vector<bool> resolved_;
    std::vector<bool> rpmOff_;
    std::vector<std::string> lastBad_;
    std::vector<Backoff> deviceBackoff_;
    std::vector<int64_t> probeAt_;
    size_t currentDevice_ = 0;
    std::unordered_map<uint64_t, uint32_t> flags_;  // (device, object) -> its last status-flags

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
