// Helpers of the OPC UA driver tests (feature 019): a sink that records what the driver publishes,
// waits with a deadline, and a test server (tools/opcua-sim) on a free port of localhost.
#pragma once
#include <sys/stat.h>
#include <unistd.h>

#include <chrono>
#include <condition_variable>
#include <functional>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "drivers/opcua/opcua_driver.hpp"
#include "tools/opcua-sim/sim_server.hpp"

namespace mat::opcuatest {

class RecordingSink : public drv::EngineSink {
   public:
    void publish(std::vector<drv::TagUpdate>&& updates) override {
        std::lock_guard<std::mutex> g(mu_);
        for (auto& u : updates) {
            last_[u.tag] = u;
            all_.push_back(std::move(u));
        }
        cv_.notify_all();
    }
    void writeDone(drv::WriteResult&& r) override {
        std::lock_guard<std::mutex> g(mu_);
        writes_[r.id] = std::move(r);
        cv_.notify_all();
    }
    // Waits until `pred` holds (checked under the lock), at most `ms`.
    bool waitFor(const std::function<bool()>& pred, int ms = 10000) {
        std::unique_lock<std::mutex> l(mu_);
        return cv_.wait_for(l, std::chrono::milliseconds(ms), pred);
    }
    bool has(size_t tag) const { return last_.count(tag) != 0; }
    drv::TagUpdate last(size_t tag) {
        std::lock_guard<std::mutex> g(mu_);
        return last_[tag];
    }
    // Under the lock (inside waitFor's predicate): the last update of `tag`, or null.
    const drv::TagUpdate* lastNoLock(size_t tag) const {
        const auto it = last_.find(tag);
        return it == last_.end() ? nullptr : &it->second;
    }
    bool goodNoLock(size_t tag) const {
        const drv::TagUpdate* u = lastNoLock(tag);
        return u && u->quality == Quality::GOOD;
    }
    bool reasonNoLock(size_t tag, const std::string& reason) const {
        const drv::TagUpdate* u = lastNoLock(tag);
        return u && u->quality != Quality::GOOD && u->reason == reason;
    }
    const drv::WriteResult* writeNoLock(uint64_t id) const {
        const auto it = writes_.find(id);
        return it == writes_.end() ? nullptr : &it->second;
    }
    drv::WriteResult write(uint64_t id) {
        std::lock_guard<std::mutex> g(mu_);
        return writes_[id];
    }
    size_t count() {
        std::lock_guard<std::mutex> g(mu_);
        return all_.size();
    }

   private:
    mutable std::mutex mu_;
    std::condition_variable cv_;
    std::map<size_t, drv::TagUpdate> last_;
    std::vector<drv::TagUpdate> all_;
    std::map<uint64_t, drv::WriteResult> writes_;
};

// One directory per test process for the certificates (made once: RSA keys are slow under qemu).
inline std::string certDir(const char* what) {
    static const std::string base = "/tmp/mat-opcua-test-" + std::to_string(::getpid());
    const std::string d = base + "/" + what;
    std::string cur;
    for (size_t i = 0; i <= d.size(); ++i) {
        if (i == d.size() || d[i] == '/') {
            if (!cur.empty()) ::mkdir(cur.c_str(), 0700);
        }
        if (i < d.size()) cur += d[i];
    }
    return d;
}

inline drv::OpcUaTagBinding tag(size_t index, const std::string& nodeId, TagType raw,
                                drv::ScanGroup group = drv::ScanGroup::Normal) {
    drv::OpcUaTagBinding b;
    b.tag = index;
    b.nodeId = nodeId;
    b.rawType = raw;
    b.group = group;
    return b;
}

inline drv::OpcUaConfig config(uint16_t port) {
    drv::OpcUaConfig c;
    c.channelId = "ua-1";
    c.endpointUrl = "opc.tcp://127.0.0.1:" + std::to_string(port);
    c.deviceId = "srv1";
    c.scanMs = {100, 200, 400};
    c.timeoutMs = 2000;
    c.connectTimeoutMs = 5000;
    c.reconnectMaxS = 1;
    return c;
}

inline drv::OpcUaEnv env() {
    drv::OpcUaEnv e;
    e.certDir = certDir("client");
    e.applicationUri = "urn:atpro:mat-scada:test";
    e.uniform = [] { return 0.0; };
    return e;
}

inline std::string detail(const drv::Driver& d, const std::string& key) {
    drv::DriverDiag diag;
    d.diagnostics(diag, 0);
    for (const auto& [k, v] : diag.channel.details)
        if (k == key) return v;
    return "";
}

inline bool hasWarning(const drv::Driver& d, const std::string& code) {
    drv::DriverDiag diag;
    d.diagnostics(diag, 0);
    for (const auto& w : diag.channel.warnings)
        if (w == code) return true;
    return false;
}

}  // namespace mat::opcuatest
