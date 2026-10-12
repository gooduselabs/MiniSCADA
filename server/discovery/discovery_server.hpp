// The discovery server of the runtime (feature 005, T060; contracts/discovery.md, research R2):
// one UDP socket on discoveryPort, bound to every address so that the directed broadcast of each
// interface arrives; IP_PKTINFO tells which interface received a query and makes the reply leave
// from that interface's address; one thread waits in poll(). Every datagram goes through
// discovery::Responder, nothing is logged per datagram. discoveryEnabled = false opens no socket
// at all (FR-004).
//
// Budget: one thread, one 1024-byte buffer, no allocation per datagram: the device info is asked
// for at most once per kInfoMaxAgeMs, the interface table read at most every 30 s.
#pragma once
#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <thread>

#include "core/discovery/discovery_proto.hpp"

namespace mat {

class DiscoveryServer {
   public:
    struct Options {
        bool enabled = true;                 // discoveryEnabled
        int port = discovery::kDefaultPort;  // discoveryPort; 0 takes a free port (tests)
    };
    // What the replies say. Called on the discovery thread, at most once per kInfoMaxAgeMs; it
    // must not block.
    using InfoFn = std::function<discovery::DeviceInfo()>;
    using Clock = std::function<int64_t()>;  // monotonic ms
    static constexpr int64_t kInfoMaxAgeMs = 1000;

    // An empty clock is steady_clock.
    DiscoveryServer(Options options, InfoFn info, Clock monoMs = {});
    ~DiscoveryServer();  // stop()
    DiscoveryServer(const DiscoveryServer&) = delete;
    DiscoveryServer& operator=(const DiscoveryServer&) = delete;

    // Opens the socket and starts the thread. Disabled: opens nothing and returns true. False,
    // with `error`, when the socket cannot be opened (the port is taken, ...): the runtime goes on
    // without discovery. Call once.
    bool start(std::string& error);
    // Wakes the thread, waits for it and closes the socket. Idempotent.
    void stop();

    bool enabled() const { return options_.enabled; }
    bool running() const { return port_.load() != 0; }  // socket open, thread running
    int port() const { return port_.load(); }           // the bound UDP port; 0 when not running
    // Any thread may read these (device-api §6, block "discovery").
    discovery::Counters counters() const { return responder_.counters(); }

   private:
    void run();
    void receiveBatch();
    void handle(size_t size, bool cut, uint32_t source, uint16_t sourcePort, int ifindex);
    const discovery::DeviceInfo* info(int64_t nowMs);

    Options options_;
    InfoFn infoFn_;
    Clock now_;
    int sock_ = -1;
    int wake_ = -1;  // eventfd: stop() wakes poll()
    std::atomic<int> port_{0};
    std::atomic<bool> stopping_{false};
    std::thread thread_;
    discovery::Responder responder_;
    std::unique_ptr<discovery::IfaceTable> ifaces_;
    discovery::Packet buf_{};  // the query in, then the reply out
    discovery::DeviceInfo info_;
    bool haveInfo_ = false;
    int64_t infoAtMs_ = 0;
};

}  // namespace mat
