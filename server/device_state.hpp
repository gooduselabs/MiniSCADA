// What the runtime tells about the device (feature 005; contracts/device-api.md §2, §3,
// contracts/discovery.md §3): identity, ports, state of the HTTPS listener, discovery. One object
// for system/info (block "device"), GET /api/v1/device/identity and the discovery replies, so the
// three never disagree. Thread-safe: main sets the HTTPS state while the HTTP listener already
// serves system/info.
#pragma once
#include <mutex>
#include <string>
#include <utility>

#include "nlohmann/json.hpp"

namespace mat {

constexpr const char* kDeviceApiVersion = "1.1.0";  // device-api-1.1.md (feature 006), apiVersion

// system/info.device.https (device-api §2).
enum class HttpsState {
    Off,        // httpsPort = 0: no HTTPS listener, no engineering API
    Ok,         // the HTTPS listener runs
    CertError,  // server.pem damaged or with wrong permissions (never replaced on its own)
    TlsError,   // the certificate is usable but the listener could not open (port taken, TLS
                // set-up failure; the details are in the log)
};

inline const char* httpsStateName(HttpsState s) {
    switch (s) {
        case HttpsState::Off:
            return "off";
        case HttpsState::Ok:
            return "ok";
        case HttpsState::CertError:
            return "cert-error";
        case HttpsState::TlsError:
            return "tls-error";
    }
    return "off";
}

struct DeviceFacts {
    std::string deviceId;  // <dataDir>/device-id
    std::string name;      // deviceName
    std::string model;     // deviceModel
    int httpPort = 0;      // the HTTP listener
    int httpsPort = 0;     // the HTTPS listener: bound port when Ok, else configured; 0: off
    HttpsState https = HttpsState::Off;
    std::string fingerprint;  // SHA-256 of the certificate, 64 lowercase hex; "" unless Ok
    bool discovery = false;   // the discovery server answers
    std::string viewerAccess = "private";  // private | any | off (feature 006, FR-055a)
};

class DeviceState {
   public:
    explicit DeviceState(DeviceFacts facts = {}) : f_(std::move(facts)) {}

    DeviceFacts facts() const {
        std::lock_guard<std::mutex> l(mu_);
        return f_;
    }
    void setPorts(int httpPort, int httpsPort) {
        std::lock_guard<std::mutex> l(mu_);
        f_.httpPort = httpPort;
        f_.httpsPort = httpsPort;
    }
    // The fingerprint is kept only while the listener runs: a client never gets a fingerprint
    // that no listener presents.
    void setHttps(HttpsState state, std::string fingerprint = {}) {
        std::lock_guard<std::mutex> l(mu_);
        f_.https = state;
        f_.fingerprint = state == HttpsState::Ok ? std::move(fingerprint) : std::string();
    }
    void setDiscovery(bool running) {
        std::lock_guard<std::mutex> l(mu_);
        f_.discovery = running;
    }
    void setViewerAccess(std::string access) {
        std::lock_guard<std::mutex> l(mu_);
        f_.viewerAccess = std::move(access);
    }

    // Block "device" of GET /api/v1/system/info. A public page: no fingerprint (it could be
    // changed on its way over HTTP; the Studio trusts only the one of the TLS handshake), no
    // account, no address.
    nlohmann::json systemInfoJson() const {
        const DeviceFacts f = facts();
        return {{"deviceId", f.deviceId},   {"name", f.name},
                {"model", f.model},         {"apiVersion", kDeviceApiVersion},
                {"httpsPort", f.httpsPort}, {"https", httpsStateName(f.https)},
                {"discovery", f.discovery}, {"viewerAccess", f.viewerAccess}};
    }

   private:
    mutable std::mutex mu_;
    DeviceFacts f_;
};

}  // namespace mat
