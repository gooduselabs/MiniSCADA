// Siemens S7 driver over ISO-on-TCP (feature 016, specs/016-driver-s7/contracts/s7-driver.md;
// ADR-044). One driver per channel, one thread per channel (stack 256 KiB), one CPU per channel,
// one request in flight at a time. Same SDK pieces as the Modbus TCP driver: Scheduler, Backoff,
// DiagCounters, Transport; the read plan merges Tags into byte ranges and packs them into
// multi-item Read Var requests that fit the negotiated PDU (drivers/s7/plan.hpp).
//
// The loop of the thread:
//   - not connected: wait out the backoff, then TCP connect, COTP CR/CC, Setup Communication (the
//     PDU used is the smaller of the asked and the answered one); while it fails every Tag is BAD
//     (REFUSED, DISCONNECTED, S7_CONNECT_REJECTED, S7_SETUP_FAILED). A Tag larger than one read of
//     the negotiated PDU is BAD S7_PDU_TOO_SMALL and left out of the plan;
//   - connected: a queued write first, then the read request with the earliest due time. The
//     answer must carry the PDU reference of the request; another one is dropped and counted (tid);
//   - no answer within timeoutMs (after `retries` more tries) closes the connection: the Tags of
//   the
//     request become BAD TIMEOUT, every other Tag BAD DISCONNECTED, the connection opens again
//     after the backoff (a PLC is one end point, there is no gateway behind it). A socket error
//     closes it too (DISCONNECTED), a frame error as well (BAD_FRAME);
//   - an item error makes the Tags of that item BAD S7_* (contract §5); 05 or 0A on an item of
//     several Tags splits it (the halves are read from the next request on); a header error (81 04:
//     PUT/GET not allowed) makes every Tag of the request BAD;
//   - a write is one Write Var of one item, sent once, never again; a readback follows.
//
// Tests run it without a thread: `manual` in S7Env, then pump(untilMs) runs the loop on the
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

#include "drivers/s7/address.hpp"
#include "drivers/s7/frames.hpp"
#include "drivers/s7/plan.hpp"
#include "drivers/sdk/backoff.hpp"
#include "drivers/sdk/diag.hpp"
#include "drivers/sdk/driver.hpp"
#include "drivers/sdk/scheduler.hpp"
#include "drivers/sdk/transport.hpp"

namespace mat::drv {

// A Tag of an S7 channel, resolved by the engine.
struct S7TagBinding {
    size_t tag = 0;    // index in the TagStore
    s7::Address addr;  // parsed (ok) address
    int stringLength = 0;
    ScanGroup group = ScanGroup::Normal;
    bool readback = true;
};

struct S7Config {
    std::string channelId;
    bool enabled = true;
    std::string host;
    int port = 102;
    int connectTimeoutMs = 3000;
    int reconnectMaxS = 10;
    int requestGapMs = 0;
    uint16_t localTsap = 0x0100;
    uint16_t remoteTsap = 0x0101;
    int pduSize = 480;  // asked for; the PLC may answer less
    std::array<int64_t, 3> scanMs = {250, 1000, 5000};
    int writeQueueCapacity = 16;
    // The CPU (field device 0); `hasDevice` false: a channel without a device (no traffic).
    bool hasDevice = true;
    std::string deviceId;
    bool deviceEnabled = true;
    int timeoutMs = 1000;
    int retries = 0;
    int maxGapBytes = 16;
    std::vector<S7TagBinding> tags;
};

// What a test replaces. Empty members take the real thing.
struct S7Env {
    std::function<std::unique_ptr<Transport>()> makeTransport;  // default: TcpSocket
    const Clock* clock = nullptr;                               // default: SystemClock
    std::function<double()> uniform;                            // backoff jitter, [0, 1)
    std::function<uint16_t()> firstRef;                         // default: random
    bool manual = false;
    std::function<void(int64_t untilMs)> sleep;
};

class S7Driver final : public Driver {
   public:
    explicit S7Driver(S7Config config, S7Env env = {});
    ~S7Driver() override;

    void start(EngineSink& sink) override;
    void stop() override;
    bool enqueueWrite(WriteCommand cmd) override;
    std::vector<uint64_t> cancelQueuedWrites() override;
    LinkState linkState(uint32_t device) const override;
    void diagnostics(DriverDiag& out, int64_t nowMs) const override;
    // Not offered for S7 yet (spec D8): code NOT_SUPPORTED.
    TestOutcome test(const TestRequest& req) override;

    void pump(int64_t untilMs);
    const S7Config& config() const { return cfg_; }
    int negotiatedPdu() const { return pdu_.load(); }

   private:
    enum class Outcome { Ok, Timeout, Closed, Lost, Interrupted };
    struct Exchange {
        Outcome outcome = Outcome::Timeout;
        s7::Bytes pdu;  // the S7 PDU of the answer, with Ok
    };
    struct Round {
        std::vector<s7::ReadItem> items;
        std::vector<s7::ReadRequest> requests;
    };
    struct QueuedWrite {
        WriteCommand cmd;
        int64_t enqueuedMs = 0;
    };

    int64_t mono() const { return clock_->monoMs(); }
    int64_t wall() const { return clock_->wallMs(); }
    void halt();
    void loop(int64_t untilMs);
    void idle(int64_t untilMs);
    static void* threadMain(void* self);

    bool connectNow();
    bool handshake();
    void failConnect(const std::string& code, const std::string& reason);
    void dropConnection(const char* code, const std::vector<size_t>& failed, const char* reason);
    void handleIdleClose();
    void setChannelState(ChannelState s);
    void setDeviceState(DeviceState s);
    void buildPlan();
    void repack(int group);
    std::vector<s7::PlanTag> planTags(int group) const;

    Exchange exchange(uint16_t& ref, const std::function<s7::Bytes(uint16_t)>& frame, int timeoutMs,
                      int retries);
    // Reads one whole S7 PDU (COTP DT fragments joined) before `deadline`.
    Outcome receivePdu(int64_t deadline, s7::Bytes& pdu);
    uint16_t nextRef();

    void runRead(const Scheduler::Job& job);
    void runWrite();
    void finishWrite(size_t local, WriteResult&& r);
    void failQueuedWrites(const char* code);
    void completeWriteJob();

    void publishBad(const std::vector<size_t>& tags, const std::string& reason);
    void publishBadAll(const std::string& reason, const std::vector<size_t>* except);
    bool decodeTag(const S7TagBinding& t, const s7::Item& item, const s7::Bytes& data,
                   TagScalar& out, std::string& reason) const;

    S7Config cfg_;
    S7Env env_;
    SystemClock systemClock_;
    const Clock* clock_;
    EngineSink* sink_ = nullptr;
    std::unique_ptr<Transport> transport_;
    DiagCounters diag_;
    Backoff backoff_;
    std::unordered_map<size_t, size_t> localOf_;  // store index -> index in cfg_.tags
    std::vector<std::string> lastBad_;

    mutable std::mutex schedMu_;
    std::array<Round, 3> rounds_;
    Scheduler sched_;

    bool connected_ = false;
    bool everConnected_ = false;
    int64_t nextConnectMs_ = 0;
    bool firstSuccessPending_ = false;
    s7::Bytes rx_;
    uint16_t ref_ = 0;
    std::atomic<int> pdu_{0};
    std::vector<bool> tooLarge_;  // Tags left out of the plan for the negotiated PDU

    mutable std::mutex wmu_;
    std::deque<QueuedWrite> writes_;

    std::atomic<int> channelState_{static_cast<int>(ChannelState::Disabled)};
    std::atomic<int> deviceState_{static_cast<int>(DeviceState::Disabled)};

    std::mutex mu_;
    std::condition_variable cv_;
    bool wake_ = false;
    std::atomic<bool> stopping_{false};
    bool started_ = false;
    bool threadRunning_ = false;
    pthread_t thread_{};
};

}  // namespace mat::drv
