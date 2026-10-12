// Modbus TCP driver (feature 006 T100, T141; contracts/modbus-driver.md; ADR-014). One driver per
// channel, one thread per channel (stack 256 KiB). The channel holds one connection shared by its
// field devices (unit ids), one request in flight at a time.
//
// The loop of the thread:
//   - not connected: wait out the backoff, connect (BAD DISCONNECTED/REFUSED to every Tag while it
//     fails);
//   - connected: the scheduler (drivers/sdk/scheduler) gives the next job: a queued write first,
//     then the read block with the earliest due time. A read goes through exchange(): the response
//     is checked against the request (mbap.hpp); a frame that does not match is dropped, counted
//     and the wait goes on until the deadline;
//   - a timeout closes the connection: the Tags of the request become BAD TIMEOUT, every other Tag
//     of the channel BAD DISCONNECTED, and the connection is opened again after the backoff;
//   - exception 02/03 on a block of several Tags splits it (merge_planner), on one Tag it makes
//   that
//     Tag BAD EXCEPTION_02/03; other exceptions make the Tags of the block BAD EXCEPTION_xx;
//   - a write is sent once, never again; a readback follows (data-model §8).
//
//
// Modbus RTU (feature 006 T164): the same driver with `serial` set. The channel then holds a serial
// port instead of a connection, and the loop changes in three places:
//   - the port is opened (R13 rules, SerialPort) instead of connected; a failed open is the
//   channel's
//     error (PORT_BUSY, PORT_CONSOLE, ...) with BAD on every Tag, the other channels run on;
//   - a request is an RTU frame (rtu_frame.hpp): the line is quiet for t3.5 and the input flushed
//     before it goes; the response is cut by the length the function asks for; a frame with a wrong
//     CRC, address, function, length, or the echo of the request, is dropped and counted;
//   - no answer is not a lost connection: the Tags of the request are BAD TIMEOUT, and the device
//     is suspended after 3 requests in a row without a valid answer (its Tags BAD DEVICE_SUSPENDED,
//     one probe read every 10 s); the other field devices of the bus keep their cycle. An
//     exception is a valid answer.
//
// Tests run it without a thread: `manual` in DriverEnv, then pump(untilMs) runs the loop on the
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
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "drivers/modbus/pdu.hpp"
#include "drivers/modbus/test_probe.hpp"
#include "drivers/sdk/backoff.hpp"
#include "drivers/sdk/diag.hpp"
#include "drivers/sdk/driver.hpp"
#include "drivers/sdk/merge_planner.hpp"
#include "drivers/sdk/scheduler.hpp"
#include "drivers/sdk/transport.hpp"

namespace mat::drv {

struct ModbusDeviceConfig {
    std::string id;
    int unit = 1;
    bool enabled = true;
    int timeoutMs = 1000;
    int retries = 0;
    int writeDeadlineMs = 5000;
    int maxReadRegisters = 125;
    int maxReadBits = 2000;
    int maxGapRegisters = 10;
    int maxGapBits = 64;
};

// The serial line of a Modbus RTU channel (connections.json `serial`).
struct SerialLink {
    std::string port;  // "ttyAS2" or "/dev/serial/by-id/..."; the device path follows from it
    int baud = 9600;
    int dataBits = 8;
    char parity = 'E';  // N, E, O
    int stopBits = 1;
    bool rs485 = true;
    bool dropEcho = false;
    int silenceMs = 0;  // 0: t3.5 of the speed
};

struct ModbusTcpConfig {
    std::string channelId;
    bool enabled = true;
    std::string host;
    int port = 502;
    std::optional<SerialLink> serial;  // set: a Modbus RTU channel (host and port are not used)
    int connectTimeoutMs = 3000;
    int reconnectMaxS = 10;
    int requestGapMs = 0;
    std::array<int64_t, 3> scanMs = {250, 1000, 5000};  // fast, normal, slow
    int writeQueueCapacity = 16;
    std::vector<ModbusDeviceConfig> devices;
    // TagBinding::device is an index in `devices`; TagBinding::tag is the Tag index of the store.
    std::vector<TagBinding> tags;
};

// What a test replaces. Empty members take the real thing.
struct DriverEnv {
    std::function<std::unique_ptr<Transport>()> makeTransport;  // default: TcpSocket
    const Clock* clock = nullptr;                               // default: SystemClock
    std::function<double()> uniform;                            // backoff jitter, [0, 1)
    std::function<uint16_t()> firstTid;                         // default: random
    // RTU: "" when the channel may use this port; PORT_CONSOLE (the console or a getty holds it) or
    // PORT_NOT_ALLOWED (not in `serialPorts`) otherwise. Empty: no check.
    std::function<std::string(const std::string& port)> checkPort;
    // true: start() makes no thread; the test calls pump(). `sleep` moves a fake clock to
    // `untilMs`.
    bool manual = false;
    std::function<void(int64_t untilMs)> sleep;
};

class ModbusTcpDriver : public Driver {
   public:
    explicit ModbusTcpDriver(ModbusTcpConfig config, DriverEnv env = {});
    ~ModbusTcpDriver() override;

    void start(EngineSink& sink) override;
    void stop() override;
    bool enqueueWrite(WriteCommand cmd) override;
    std::vector<uint64_t> cancelQueuedWrites() override;
    LinkState linkState(uint32_t device) const override;
    void diagnostics(DriverDiag& out, int64_t nowMs) const override;
    // A new, temporary connection (the channel's own connection is not touched). `req.address` is
    // read as an address without base (offset = number).
    TestOutcome test(const TestRequest& req) override;

    // RTU only: a connection test sent through the queue of this channel, as a read like any other
    // (the port is open and the line is shared). Waits at most `waitMs` for the answer; code
    // PORT_BUSY when the channel is not connected. Any thread.
    TestOutcome probeThroughQueue(const RtuProbeRequest& request, int waitMs);
    // true when this channel holds a serial port with exactly these parameters (a test may then go
    // through its queue).
    bool sameSerialFrame(const SerialLink& other) const;
    bool isRtu() const { return cfg_.serial.has_value(); }

    // Manual mode: runs the loop until the clock reaches `untilMs`.
    void pump(int64_t untilMs);

    const ModbusTcpConfig& config() const { return cfg_; }

   private:
    struct Block {
        modbus::Area area = modbus::Area::HR;
        int start = 0;
        int count = 0;
        std::vector<size_t> tags;  // indexes in cfg_.tags
    };
    struct Round {
        std::vector<Block> blocks;
    };
    enum class Outcome { Ok, Exception, Timeout, Closed, Lost, Interrupted };
    struct Exchange {
        Outcome outcome = Outcome::Timeout;
        modbus::Bytes pdu;   // the response PDU, with Ok and Exception
        int exception = -1;  // with Exception
        int64_t elapsedMs = 0;
    };
    struct QueuedWrite {
        WriteCommand cmd;
        int64_t enqueuedMs = 0;
    };
    struct WritePlan;

    void loop(int64_t untilMs);
    void idle(int64_t untilMs);
    static void* threadMain(void* self);

    int64_t mono() const { return clock_->monoMs(); }
    int64_t wall() const { return clock_->wallMs(); }

    bool connectNow();
    void onConnected();
    void onConnectFailed(ConnectCode code);
    void handleIdleClose();
    void dropConnection(const char* errorCode, const std::vector<size_t>& failedTags,
                        const char* failedReason);
    void buildPlan();
    void setChannelState(ChannelState s);
    void setDeviceState(size_t dev, DeviceState s);

    void runRead(const Scheduler::Job& job);
    Exchange exchange(size_t dev, const modbus::Bytes& pdu, int timeoutMs, int retries);
    Exchange exchangeRtu(size_t dev, const modbus::Bytes& pdu, int timeoutMs, int retries);
    void failConnect(const std::string& code, const std::string& reason);
    // RTU: a request of the device ended with no valid answer / with one.
    void deviceFailed(size_t dev, const std::vector<size_t>& tags, const char* reason);
    void deviceAnswered(size_t dev);
    bool deviceSuspended(size_t dev) const;
    void runProbeRequest();
    std::unique_ptr<Transport> makeDefaultTransport() const;
    void publishBlock(const Block& b, const modbus::Bytes& response);
    bool splitBlockAt(size_t dev, int group, size_t blockIndex);
    void publishBad(const std::vector<size_t>& tags, const std::string& reason);
    void publishBadAll(const std::string& reason, const std::vector<size_t>* except);
    bool decodeTag(const TagBinding& t, int blockStart, const std::vector<uint16_t>& regs,
                   const std::vector<uint8_t>& bits, TagScalar& out, std::string& reason) const;

    void runWrite();
    void finishWrite(size_t local, WriteResult&& r);
    void failQueuedWrites(const char* code);
    void failQueuedProbes();

    ModbusTcpConfig cfg_;
    DriverEnv env_;
    SystemClock systemClock_;
    const Clock* clock_;
    EngineSink* sink_ = nullptr;
    std::unique_ptr<Transport> transport_;
    DiagCounters diag_;
    Backoff backoff_;
    std::unordered_map<size_t, size_t> localOf_;  // store index -> index in cfg_.tags

    // The plan: rounds_[device][group]; rounds_ and sched_ are changed by the driver thread under
    // schedMu_, and read by diagnostics().
    std::vector<std::array<Round, 3>> rounds_;
    mutable std::mutex schedMu_;
    Scheduler sched_;

    // The connection (driver thread only)
    bool connected_ = false;
    bool everConnected_ = false;
    int64_t nextConnectMs_ = 0;
    bool firstSuccessPending_ = false;  // reset the backoff at the first valid response
    modbus::Bytes rx_;
    uint16_t nextTid_ = 0;
    std::vector<std::string> lastBad_;  // reason last published as BAD per Tag; "" otherwise

    // RTU
    int silenceMs_ = 0;            // t3.5 of the line, whole ms
    int gapMs_ = 0;                // between two bytes of a frame
    std::vector<int> failStreak_;  // requests in a row without a valid answer, per device

    // The write queue; the connection tests of an RTU channel wait in the same turn
    struct ProbeSlot {
        RtuProbeRequest req;
        bool done = false;
        TestOutcome out;
    };
    mutable std::mutex wmu_;
    std::deque<QueuedWrite> writes_;
    std::deque<std::shared_ptr<ProbeSlot>> probes_;
    std::mutex probeMu_;
    std::condition_variable probeCv_;

    // Read from other threads
    std::atomic<int> channelState_{static_cast<int>(ChannelState::Disabled)};
    std::unique_ptr<std::atomic<int>[]> deviceState_;

    // The thread and its wake-up
    std::mutex mu_;
    std::condition_variable cv_;
    bool wake_ = false;
    std::atomic<bool> stopping_{false};
    bool started_ = false;
    bool threadRunning_ = false;
    pthread_t thread_{};
};

}  // namespace mat::drv
