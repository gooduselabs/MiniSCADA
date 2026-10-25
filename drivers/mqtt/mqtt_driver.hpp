// MQTT 3.1.1 client driver (feature 022, specs/022-driver-mqtt/spec.md; ADR-050). One driver per
// channel, one thread per channel, one broker (field device 0) per channel. Only this thread
// touches the link.
//
// The loop of the thread:
//   - not connected: wait out the backoff (drivers/sdk/backoff), then TCP (and TLS: pin or CA),
//     CONNECT (client id, keepalive, clean session, will, user and the password of the device
//     secrets), CONNACK, then one SUBSCRIBE per 32 topic filters. A failure makes every Tag BAD
//     (DISCONNECTED or the MQTT_* code of the cause);
//   - connected: read what the broker sends (PUBLISH -> the Tags whose filter matches, PUBACK of a
//     write, PINGRESP), send one queued write at a time as a PUBLISH (the token bucket
//     maxPublishPerS covers every PUBLISH of the channel), the publish groups when due or changed,
//     PINGREQ every keepalive, and UNCERTAIN MQTT_STALE for a Tag without a message for
//     staleAfterMs;
//   - the link fails or the broker is silent for 1.5 keepalives: every Tag BAD DISCONNECTED, a new
//     connection after the backoff.
#pragma once
#include <pthread.h>

#include <atomic>
#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "drivers/mqtt/address.hpp"
#include "drivers/mqtt/link.hpp"
#include "drivers/mqtt/packet.hpp"
#include "drivers/sdk/backoff.hpp"
#include "drivers/sdk/diag.hpp"
#include "drivers/sdk/driver.hpp"
#include "drivers/sdk/transport.hpp"

namespace mat::drv {

// A Tag of an MQTT channel, resolved by the engine (address parsed by drivers/mqtt/address).
struct MqttTagBinding {
    size_t tag = 0;  // index in the TagStore
    mqtt::Address addr;
    TagType rawType = TagType::FLOAT64;
    int stringLength = 0;
};

// A publish group: the values of `tags` as one JSON message on `topic`.
struct MqttGroupConfig {
    std::string topic;
    std::vector<size_t> tags;      // indexes in the TagStore
    std::vector<std::string> ids;  // the Tag ids, same order
    int64_t intervalMs = 0;        // 0: not periodic
    bool onChange = false;
    int qos = 0;
    bool retain = false;
};

struct MqttConfig {
    std::string channelId;
    bool enabled = true;
    std::string host;
    int port = 1883;
    std::string clientId;
    int keepAliveS = 30;
    bool cleanSession = true;
    mqtt::TlsOptions tls;
    bool hasAuth = false;
    std::string username, secretId;
    bool hasWill = false;
    std::string willTopic, willPayload;
    int willQos = 0;
    bool willRetain = false;
    int maxPublishPerS = 20;
    int connectTimeoutMs = 5000;
    int reconnectMaxS = 10;
    int writeQueueCapacity = 16;
    // The broker (field device 0); `hasDevice` false: a channel without one (no traffic).
    bool hasDevice = true;
    std::string deviceId;
    bool deviceEnabled = true;
    int timeoutMs = 2000;      // CONNACK, SUBACK, PUBACK
    int64_t staleAfterMs = 0;  // 0: never stale
    std::vector<MqttTagBinding> tags;
    std::vector<MqttGroupConfig> groups;
};

// What the runtime (or a test) gives the driver.
struct MqttEnv {
    // The password of a secret id; nullopt when the device has none.
    std::function<std::optional<std::string>(const std::string& secretId)> password;
    // The current values of Tags (TagStore indexes), for the publish groups.
    std::function<void(const std::vector<size_t>&, std::vector<TagValue>&)> snapshot;
    std::function<double()> uniform;  // backoff jitter
    const Clock* clock = nullptr;     // default: SystemClock
    int groupCheckMs = 250;           // how often a group is compared for onChange
};

class MqttDriver final : public Driver {
   public:
    explicit MqttDriver(MqttConfig config, MqttEnv env = {});
    ~MqttDriver() override;

    void start(EngineSink& sink) override;
    void stop() override;
    bool enqueueWrite(WriteCommand cmd) override;
    std::vector<uint64_t> cancelQueuedWrites() override;
    LinkState linkState(uint32_t device) const override;
    void diagnostics(DriverDiag& out, int64_t nowMs) const override;
    TestOutcome test(const TestRequest& req) override;  // NOT_SUPPORTED

    const MqttConfig& config() const { return cfg_; }

   private:
    struct QueuedWrite {
        WriteCommand cmd;
        int64_t enqueuedMs = 0;
    };
    struct InFlight {
        bool active = false;
        uint64_t id = 0;
        uint16_t packetId = 0;
        int64_t sentMs = 0;
        size_t local = 0;
        TagScalar raw;
    };
    struct GroupState {
        int64_t nextDueMs = 0;
        int64_t nextCheckMs = 0;
        std::string lastSig;
        bool pending = false;
    };

    int64_t mono() const { return clock_->monoMs(); }
    int64_t wall() const { return clock_->wallMs(); }
    static void* threadMain(void* self);
    void loop();
    void idle(int64_t untilMs);

    void connectNow();
    void failConnect(const std::string& code, const std::string& reason);
    void dropConnection(const std::string& code);
    bool send(const std::vector<uint8_t>& bytes);
    // Reads for at most `waitMs` and handles what came. false: the link failed.
    bool pump(int waitMs);
    void handle(const mqtt::Packet& p);
    void onPublish(const mqtt::Publish& m);
    bool takeToken();
    void runWrite();
    void runGroups();
    void checkStale();
    void finishWrite(WriteResult&& r);
    void failQueuedWrites(const char* code);
    void failInFlight(const char* code);
    void publishBad(const std::vector<size_t>& locals, const std::string& reason);
    void publishBadAll(const std::string& reason);
    void setChannelState(ChannelState s);
    void setDeviceState(DeviceState s);
    void updateDetails();
    uint16_t nextPacketId();

    MqttConfig cfg_;
    MqttEnv env_;
    SystemClock systemClock_;
    const Clock* clock_;
    DiagCounters diag_;
    Backoff backoff_;
    mqtt::Link link_;
    mqtt::Framer framer_;

    EngineSink* sink_ = nullptr;
    pthread_t thread_{};
    bool threadRunning_ = false;
    std::atomic<bool> started_{false};
    std::atomic<bool> stopping_{false};
    std::atomic<int> channelState_{0};
    std::atomic<int> deviceState_{0};

    std::mutex wmu_;
    std::deque<QueuedWrite> writes_;
    InFlight inflight_;

    bool connected_ = false;
    int64_t nextConnectMs_ = 0;
    int64_t lastTxMs_ = 0, lastRxMs_ = 0;
    bool pingOutstanding_ = false;
    int64_t pingSentMs_ = 0;
    uint16_t packetId_ = 0;
    double tokens_ = 0;
    int64_t tokensAtMs_ = 0;
    int64_t lastDetailsMs_ = 0;

    // per Tag (local index)
    std::vector<std::string> lastBad_;
    std::vector<TagScalar> lastRaw_;
    std::vector<int64_t> lastMsgMs_;
    std::vector<bool> stale_;
    // subscriptions: filter -> locals; exact topics in a map, wildcard filters in a list
    std::vector<std::pair<std::string, int>> filters_;  // filter, QoS
    std::unordered_map<std::string, std::vector<size_t>> byFilter_;
    std::vector<size_t> wildcardFilters_;  // indexes in filters_
    std::vector<GroupState> groups_;
    std::unordered_map<size_t, size_t> localOf_;  // TagStore index -> local

    mutable std::mutex detailsMu_;
    uint64_t messagesIn_ = 0, messagesOut_ = 0, dropped_ = 0;
    std::string lastError_;
};

}  // namespace mat::drv
