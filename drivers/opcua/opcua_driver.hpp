// OPC UA client driver (feature 019, specs/019-driver-opcua/spec.md, contracts/opcua.md; ADR-047)
// on open62541 1.4 (third_party/open62541). One driver per channel, one thread per channel, one
// server (field device 0) per channel. Only this thread touches the UA_Client.
//
// The loop of the thread:
//   - not connected: wait out the backoff (drivers/sdk/backoff), then a new UA_Client: security
//     (None, or Basic256Sha256 Sign/SignAndEncrypt with the client certificate of client_cert and
//     the server certificate checked against the pinned SHA-256), identity (anonymous, or user and
//     password from the device secrets), asynchronous connect so that stop() is never held up.
//     A failure makes every Tag BAD (DISCONNECTED or the OPCUA_* code of the cause);
//   - connected: one subscription per scan group (publishing interval = the group's period) with
//     a monitored item per Tag, created in batches; a group the server refuses a subscription for
//     is read with Read requests every period instead (OPCUA_SUBSCRIPTION_FALLBACK), as is every
//     group with readMode poll. A queued write goes first: one Write of one node, then a Read of
//     it (readback). UA_Client_run_iterate handles the publish responses between them;
//   - the connection, the session or a subscription is lost: every Tag BAD DISCONNECTED, the client
//     is deleted, a new one connects after the backoff and makes the subscriptions again.
#pragma once
#include <pthread.h>

#include <array>
#include <atomic>
#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "drivers/opcua/client_cert.hpp"
#include "drivers/sdk/backoff.hpp"
#include "drivers/sdk/diag.hpp"
#include "drivers/sdk/driver.hpp"
#include "drivers/sdk/transport.hpp"

struct UA_Client;
struct UA_DataType;

namespace mat::drv {

enum class OpcUaSecurityMode { None, Sign, SignAndEncrypt };

// A Tag of an OPC UA channel, resolved by the engine.
struct OpcUaTagBinding {
    size_t tag = 0;      // index in the TagStore
    std::string nodeId;  // normalized string form (drivers/opcua/node_id)
    TagType rawType = TagType::FLOAT64;
    ScanGroup group = ScanGroup::Normal;
    bool readback = true;
};

struct OpcUaConfig {
    std::string channelId;
    bool enabled = true;
    std::string endpointUrl;
    OpcUaSecurityMode securityMode = OpcUaSecurityMode::None;
    bool basic256Sha256 = false;   // securityPolicy; false: None
    std::string serverCertSha256;  // the pin, lower-case hex ("" none)
    bool authUsername = false;
    std::string username, secretId;
    bool poll = false;  // readMode poll
    int sessionTimeoutMs = 60000;
    int connectTimeoutMs = 5000;
    int reconnectMaxS = 10;
    std::array<int64_t, 3> scanMs = {250, 1000, 5000};
    int writeQueueCapacity = 16;
    // The server (field device 0); `hasDevice` false: a channel without one (no traffic).
    bool hasDevice = true;
    std::string deviceId;
    bool deviceEnabled = true;
    int timeoutMs = 2000;  // one request
    std::vector<OpcUaTagBinding> tags;
};

// What the runtime (or a test) gives the driver.
struct OpcUaEnv {
    // Where the client certificate and key are kept (<dataDir>/opcua); "" made in memory.
    std::string certDir;
    std::string applicationUri;  // "" urn:atpro:mat-scada:<hostname>
    // The password of a secret id; nullopt when the device has none.
    std::function<std::optional<std::string>(const std::string& secretId)> password;
    std::function<double()> uniform;  // backoff jitter
    const Clock* clock = nullptr;     // default: SystemClock
    int batch = 200;                  // monitored items per call, nodes per Read
};

class OpcUaDriver final : public Driver {
   public:
    explicit OpcUaDriver(OpcUaConfig config, OpcUaEnv env = {});
    ~OpcUaDriver() override;

    void start(EngineSink& sink) override;
    void stop() override;
    bool enqueueWrite(WriteCommand cmd) override;
    std::vector<uint64_t> cancelQueuedWrites() override;
    LinkState linkState(uint32_t device) const override;
    void diagnostics(DriverDiag& out, int64_t nowMs) const override;
    // The connection test of POST /api/v1/drivers/test is not offered: NOT_SUPPORTED (the browse
    // route tests an endpoint, contracts §4).
    TestOutcome test(const TestRequest& req) override;

    const OpcUaConfig& config() const { return cfg_; }

    // Called from the open62541 callbacks (static trampolines); not for other use.
    void onDataChange(size_t local, const void* value);  // a UA_DataValue
    void onSubscriptionLost();
    bool verifyServerCert(const uint8_t* der, size_t size);

   private:
    struct QueuedWrite {
        WriteCommand cmd;
        int64_t enqueuedMs = 0;
    };
    struct Group {
        bool subscribed = false;  // has a live subscription
        uint32_t subscriptionId = 0;
        double revisedMs = 0;
        std::vector<size_t> polled;  // local indexes read by Read requests
        int64_t nextPollMs = 0;
    };

    int64_t mono() const { return clock_->monoMs(); }
    int64_t wall() const { return clock_->wallMs(); }
    static void* threadMain(void* self);
    void loop();
    void idle(int64_t untilMs);

    bool connectNow();
    void failConnect(const std::string& code, const std::string& reason);
    void dropConnection(const std::string& code);
    void closeClient();
    void setupReading();
    void subscribeGroup(int g, const std::vector<size_t>& tags);
    void pollDue();
    void readNodes(const std::vector<size_t>& locals, std::vector<TagUpdate>& out);
    void runWrite();
    void finishWrite(WriteResult&& r);
    void failQueuedWrites(const char* code);
    bool learnType(size_t local);
    void flushUpdates();
    void updateDetails();

    void setChannelState(ChannelState s);
    void setDeviceState(DeviceState s);
    void publishBad(const std::vector<size_t>& locals, const std::string& reason);
    void publishBadAll(const std::string& reason);
    // A value with its status: GOOD (with a value), UNCERTAIN or BAD; the type is remembered for
    // the writes.
    void addValue(size_t local, const void* value, std::vector<TagUpdate>& out,
                  bool afterWrite = false);
    void noteStatus(uint32_t status);

    OpcUaConfig cfg_;
    OpcUaEnv env_;
    SystemClock systemClock_;
    const Clock* clock_;
    EngineSink* sink_ = nullptr;
    DiagCounters diag_;
    Backoff backoff_;
    std::unordered_map<size_t, size_t> localOf_;  // store index -> index in cfg_.tags
    std::vector<std::string> lastBad_;            // "" when the last update was not BAD
    std::vector<const UA_DataType*> serverType_;  // data type of the node's last value

    UA_Client* client_ = nullptr;
    bool everConnected_ = false;
    int64_t nextConnectMs_ = 0;
    bool lost_ = false;           // a callback saw the session or a subscription go
    bool certRejected_ = false;   // the server certificate was not the pinned one
    std::string seenCertSha256_;  // the server certificate seen last
    std::string identityError_;
    opcua::ClientIdentity identity_;
    bool haveIdentity_ = false;
    std::array<Group, 3> groups_;
    std::vector<TagUpdate> pending_;  // from the data change callbacks of one iterate
    std::string lastStatus_;
    bool fallbackWarned_ = false;

    mutable std::mutex detailsMu_;
    std::string publishing_ = "";  // "250/1000/5000" as revised by the server
    std::string readMode_ = "subscription";

    mutable std::mutex wmu_;
    std::deque<QueuedWrite> writes_;

    std::atomic<int> channelState_{static_cast<int>(ChannelState::Disabled)};
    std::atomic<int> deviceState_{static_cast<int>(DeviceState::Disabled)};
    std::atomic<bool> stopping_{false};
    bool started_ = false;
    bool threadRunning_ = false;
    pthread_t thread_{};
};

}  // namespace mat::drv
