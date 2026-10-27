// Feature 027 (specs/027-device-settings, ADR-054): what the Studio and the admin page change on
// the device without SSH. The settings of <dataDir>/settings.json (config.hpp: keys, checks, the
// order of the layers), the HTTPS certificate in <dataDir>/tls (server/tls/server_cert.hpp) and the
// controlled restart that applies both (the execv of a project switch, asked of the tick loop).
//
// The admin API (server/http/admin_api.cpp) checks the caller, the body, the rev, the re-entered
// password and writes the audit; this class only keeps the files.
#pragma once
#include <atomic>
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"
#include "server/config.hpp"
#include "server/tls/server_cert.hpp"

namespace mat {

struct DeviceAdminOptions {
    std::string dataDir;
    RuntimeConfig base;     // runtime.json and the command line (ConfigResult::base)
    RuntimeConfig running;  // what this process uses (ConfigResult::cfg)
    std::function<std::string()> hostname;                         // empty: systemHostname
    std::function<std::vector<std::string>()> cardIps;             // IPv4 of the cards, no loopback
    std::function<std::string()> nowIso;                           // updatedAt, the CSR stamp
    std::function<void()> requestRestart;                          // empty: nothing (tests)
    std::string updaterPath = "/usr/lib/mat-updater/mat-updater";  // installed by deploy.sh
};

enum class DeviceSaveStatus { Ok, Conflict, Invalid, IoError };

struct DeviceSaveResult {
    DeviceSaveStatus status = DeviceSaveStatus::Ok;
    int64_t rev = 0;       // the new rev (Ok) or the current one (Conflict)
    bool restart = false;  // the effective values differ from those running: restart asked
    std::string error;
};

class DeviceAdmin {
   public:
    explicit DeviceAdmin(DeviceAdminOptions options);

    int64_t rev();
    nlohmann::json storedValues();  // the values of settings.json ({} when none)
    // base + `values`: the values that would apply; false + err when a value is wrong.
    bool effectiveWith(const nlohmann::json& values, nlohmann::json& effective, std::string& err);
    nlohmann::json effectiveStored();  // base + storedValues()
    nlohmann::json running() const { return deviceSettingsOf(o_.running); }
    nlohmann::json base() const { return deviceSettingsOf(o_.base); }

    // GET /api/v1/admin/device-settings
    nlohmann::json info();
    // Replaces the values (keys left out fall back to runtime.json); keeps the previous file as
    // settings.json.bak. A restart is asked when the effective values then differ from the running
    // ones.
    DeviceSaveResult save(const nlohmann::json& values, int64_t expectedRev, const std::string& by);

    nlohmann::json certInfo();
    ServerCert regenerate(const std::vector<SanEntry>& extra);
    CsrResult makeCsr(const std::vector<SanEntry>& extra);
    ImportResult importCert(const std::string& pem);

    void scheduleRestart();
    bool restartPending() const { return restartPending_; }

   private:
    ServerCertOptions certOptions(const std::vector<SanEntry>& extra) const;
    std::vector<std::string> cardIps() const;
    DeviceAdminOptions o_;
    std::mutex mu_;
    std::atomic<bool> restartPending_{false};
};

// Reasons a change lowers the protection of the device (FR-005), so that it needs the re-entered
// password: viewerLogin required -> off, viewerAccess wider (off < private < any), updateEnabled
// turned on, a name added to allowedHosts. Empty: none.
std::vector<std::string> securityLowered(const nlohmann::json& before, const nlohmann::json& after);

}  // namespace mat
