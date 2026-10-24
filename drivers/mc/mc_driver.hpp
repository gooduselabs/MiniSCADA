// Mitsubishi MC protocol (SLMP) driver (feature 017; specs/017-driver-mc/plan.md, contracts/
// mc-protocol.md; ADR-045). The shape of ModbusTcpDriver: one driver and one thread (stack 256 KiB)
// per channel, one connection (TCP, or a UDP socket) shared by the field devices of the channel
// (PLCs reached through network/station/module I/O), one request in flight at a time.
//
// The loop of the thread:
//   - not connected: wait out the backoff, connect (BAD DISCONNECTED/REFUSED to every Tag while
//     it fails);
//   - connected: the scheduler (drivers/sdk/scheduler) gives the next job: a queued write first,
//     then the read block with the earliest due time. Reads are planned per (field device, scan
//     group): the Tags of each device code are merged into Batch Read (0401, word units; a bit
//     device is read 16 points per word) blocks by planBlocks; blocks of at most 2 words that
//     stand apart go together into Random Read (0403) requests when the device allows it.
//   - every response is checked against its request (routing, serial of 4E, length): a frame
//     that does not match is dropped and counted, the wait goes on until the deadline;
//   - end code MC_END_RANGE on a block of several Tags splits it (a Random Read becomes Batch
//     Reads); other end codes make the Tags of the request BAD MC_END_*;
//   - a timeout: with 3E over TCP the stream cannot be trusted any more (no serial): the
//     connection is closed and opened again after the backoff. With 4E (serial numbers) or UDP,
//     the device waits out its own backoff (1 s ... 30 s) and is asked again with one probe read
//     (feature 011, as Modbus TCP behind a gateway); 3 timeouts in a row over 2 devices or more
//     close the connection;
//   - a write is sent once, never again; a readback follows (data-model §8).
//
// Tests run it without a thread: `manual` in McEnv, then pump(untilMs) runs the loop on the
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

#include "drivers/mc/mc_frame.hpp"
#include "drivers/modbus/codec.hpp"
#include "drivers/sdk/backoff.hpp"
#include "drivers/sdk/diag.hpp"
#include "drivers/sdk/driver.hpp"
#include "drivers/sdk/scheduler.hpp"
#include "drivers/sdk/transport.hpp"

namespace mat::drv {

struct McDeviceConfig {
    std::string id;
    bool enabled = true;
    mc::Route route;
    bool xyOctal = false;
    int timeoutMs = 1000;
    int retries = 0;
    int writeDeadlineMs = 5000;
    int maxBatchWords = 960;
    int maxGapWords = 16;
    bool randomRead = true;
    int maxRandomPoints = 192;
    bool bitRmw = false;  // write.registerBit = rmw
};

// A Tag of an MC field device, as the driver needs it (resolved by the engine).
struct McTagBinding {
    size_t tag = 0;       // index in the TagStore
    uint32_t device = 0;  // field device number inside the driver
    mc::Device dev = mc::Device::D;
    uint32_t number = 0;
    bool bitDevice = false;
    int words = 1;  // words taken (a bit device: 1)
    int bit = -1;   // bit inside the word, -1 none
    TagType rawType = TagType::UINT16;
    modbus::ByteOrder byteOrder = modbus::ByteOrder::CDAB;  // Mitsubishi: low word first
    modbus::StringByteOrder stringOrder = modbus::StringByteOrder::BA;  // first char low byte
    int stringLength = 0;
    ScanGroup group = ScanGroup::Normal;
    bool readback = true;
};

struct McConfig {
    std::string channelId;
    bool enabled = true;
    std::string host;
    int port = 5007;
    mc::FrameType frame = mc::FrameType::E3;
    mc::CodeType code = mc::CodeType::Binary;
    bool udp = false;
    int connectTimeoutMs = 3000;
    int reconnectMaxS = 10;
    int requestGapMs = 0;
    std::array<int64_t, 3> scanMs = {250, 1000, 5000};
    int writeQueueCapacity = 16;
    std::vector<McDeviceConfig> devices;
    std::vector<McTagBinding> tags;
};

// What a test replaces. Empty members take the real thing.
struct McEnv {
    std::function<std::unique_ptr<Transport>()> makeTransport;  // default: TcpSocket / UdpSocket
    const Clock* clock = nullptr;                               // default: SystemClock
    std::function<double()> uniform;                            // backoff jitter, [0, 1)
    std::function<uint16_t()> firstSerial;                      // 4E; default: random
    bool manual = false;
    std::function<void(int64_t untilMs)> sleep;
};

// The quality reason of an end code (contracts §4): MC_END_RANGE, MC_END_DEVICE, MC_END_COMMAND,
// MC_END_OTHER.
const char* mcEndReason(uint16_t endCode);
// "C056": the 4 hex digits of an end code (diagnostics keys, write results).
std::string mcEndCodeHex(int endCode);
// What the reason of an end code means, in Vietnamese (write results).
const char* mcEndMeaning(uint16_t endCode);

class McDriver : public Driver {
   public:
    explicit McDriver(McConfig config, McEnv env = {});
    ~McDriver() override;

    void start(EngineSink& sink) override;
    void stop() override;
    bool enqueueWrite(WriteCommand cmd) override;
    std::vector<uint64_t> cancelQueuedWrites() override;
    LinkState linkState(uint32_t device) const override;
    void diagnostics(DriverDiag& out, int64_t nowMs) const override;
    // A new, temporary connection; with `read`, one Batch Read of `count` words at `address` (an
    // MC address of a word device) on the first field device of the channel.
    TestOutcome test(const TestRequest& req) override;

    void pump(int64_t untilMs);
    const McConfig& config() const { return cfg_; }

   private:
    struct Entry {  // one point of a Random Read, or the whole of a Batch Read
        mc::Device dev = mc::Device::D;
        uint32_t start = 0;  // word index: the device number, or number / 16 for a bit device
        int count = 0;       // words
        std::vector<size_t> tags;
    };
    struct Block {
        bool random = false;
        std::vector<Entry> entries;  // batch: one
        std::vector<size_t> tags() const;
    };
    struct Round {
        std::vector<Block> blocks;
    };
    enum class Outcome { Ok, EndCode, Timeout, Closed, Lost, Interrupted };
    struct Exchange {
        Outcome outcome = Outcome::Timeout;
        mc::Response response;
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

    mc::FrameOptions optionsOf(size_t dev) const;
    static mc::Request requestOf(const Block& b);
    bool tcp3E() const { return cfg_.frame == mc::FrameType::E3 && !cfg_.udp; }

    bool connectNow();
    void onConnected();
    void failConnect(const std::string& code, const std::string& reason);
    void handleIdleClose();
    void dropConnection(const char* errorCode, const std::vector<size_t>& failedTags,
                        const char* failedReason);
    void buildPlan();
    bool splitBlockAt(size_t dev, int group, size_t blockIndex);
    void setChannelState(ChannelState s);
    void setDeviceState(size_t dev, DeviceState s);
    bool deviceSuspended(size_t dev) const;
    void deviceAnswered(size_t dev);
    bool deviceTimedOut(size_t dev, const std::vector<size_t>& tags);
    void lose(size_t dev, Outcome o, const std::vector<size_t>& tags);

    void runRead(const Scheduler::Job& job);
    Exchange exchange(size_t dev, const mc::Request& req, int timeoutMs, int retries);
    bool lateSerial(uint16_t s) const;
    void publishBlock(const Block& b, const std::vector<uint16_t>& words);
    void publishBad(const std::vector<size_t>& tags, const std::string& reason);
    void publishBadAll(const std::string& reason, const std::vector<size_t>* except);
    bool decodeTag(const McTagBinding& t, uint32_t start, const std::vector<uint16_t>& words,
                   TagScalar& out, std::string& reason) const;

    void runWrite();
    void finishWrite(size_t local, WriteResult&& r);
    void failQueuedWrites(const char* code);

    McConfig cfg_;
    McEnv env_;
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

    bool connected_ = false;
    bool everConnected_ = false;
    int64_t nextConnectMs_ = 0;
    bool firstSuccessPending_ = false;
    mc::Bytes rx_;
    uint16_t nextSerial_ = 0;
    std::deque<uint16_t> lateSerials_;
    std::vector<std::string> lastBad_;

    std::vector<Backoff> deviceBackoff_;
    std::vector<int64_t> probeAt_;
    int timeoutsInARow_ = 0;
    std::vector<bool> timeoutDevices_;

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
