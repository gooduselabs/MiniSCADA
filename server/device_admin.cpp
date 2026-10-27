#include "server/device_admin.hpp"

#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <ctime>

#include "core/notify/email_config.hpp"

namespace mat {

using nlohmann::json;

namespace {

std::string utcNow() {
    const std::time_t t = std::time(nullptr);
    std::tm tm{};
    gmtime_r(&t, &tm);
    char buf[32];
    std::strftime(buf, sizeof buf, "%Y-%m-%dT%H:%M:%SZ", &tm);
    return buf;
}

// "2026-10-26T03:00:00Z" -> "20261026T030000Z"
std::string compact(const std::string& iso) {
    std::string s;
    for (char c : iso)
        if (c != '-' && c != ':' && c != '.') s += c;
    if (s.size() > 15) s = s.substr(0, 15) + "Z";
    return s;
}

// The file (or its .bak when the file is damaged), parsed; null when neither is usable.
json readStore(const std::string& path) {
    for (const std::string& p : {path, path + ".bak"}) {
        const auto text = readTextFile(p, 64 * 1024);
        if (!text) continue;
        json j = json::parse(*text, nullptr, false);
        if (j.is_object() && j.contains("rev") && j["rev"].is_number_integer() &&
            j.contains("values") && j["values"].is_object())
            return j;
    }
    return nullptr;
}

int accessRank(const json& v) {
    const std::string s = v.is_string() ? v.get<std::string>() : "";
    return s == "off" ? 0 : s == "private" ? 1 : 2;
}

}  // namespace

std::vector<std::string> securityLowered(const json& before, const json& after) {
    std::vector<std::string> out;
    if (before.value("viewerLogin", "off") == "required" &&
        after.value("viewerLogin", "off") != "required")
        out.push_back("viewerLogin");
    if (accessRank(after.value("viewerAccess", json("private"))) >
        accessRank(before.value("viewerAccess", json("private"))))
        out.push_back("viewerAccess");
    if (!before.value("updateEnabled", false) && after.value("updateEnabled", false))
        out.push_back("updateEnabled");
    const json none = json::array();
    const json& was = before.contains("allowedHosts") ? before["allowedHosts"] : none;
    if (after.contains("allowedHosts"))
        for (const json& h : after["allowedHosts"])
            if (std::find(was.begin(), was.end(), h) == was.end()) {
                out.push_back("allowedHosts");
                break;
            }
    return out;
}

DeviceAdmin::DeviceAdmin(DeviceAdminOptions options) : o_(std::move(options)) {}

int64_t DeviceAdmin::rev() {
    std::lock_guard<std::mutex> l(mu_);
    const json j = readStore(deviceSettingsPath(o_.dataDir));
    return j.is_null() ? 0 : j["rev"].get<int64_t>();
}

json DeviceAdmin::storedValues() {
    std::lock_guard<std::mutex> l(mu_);
    const json j = readStore(deviceSettingsPath(o_.dataDir));
    return j.is_null() ? json::object() : j["values"];
}

bool DeviceAdmin::effectiveWith(const json& values, json& effective, std::string& err) {
    RuntimeConfig c = o_.base;
    if (!applyDeviceSettings(values, c, err)) return false;
    effective = deviceSettingsOf(c);
    return true;
}

json DeviceAdmin::effectiveStored() {
    json e;
    std::string err;
    if (!effectiveWith(storedValues(), e, err)) e = base();
    return e;
}

std::vector<std::string> DeviceAdmin::cardIps() const {
    return o_.cardIps ? o_.cardIps() : std::vector<std::string>{};
}

json DeviceAdmin::certInfo() {
    const ServerCert c = readServerCert(o_.dataDir);
    json j = {{"ok", c.ok}, {"cardIps", cardIps()}};
    if (!c.ok) {
        j["error"] = c.error;
        return j;
    }
    j["fingerprint"] = c.fingerprint;
    j["fingerprintColons"] = c.fingerprintColons;
    j["subject"] = c.cert.subject;
    j["issuer"] = c.cert.issuer;
    j["selfSigned"] = c.cert.selfSigned;
    j["sanDns"] = c.cert.sanDns;
    j["sanIps"] = c.cert.sanIps;
    j["notBefore"] = c.cert.notBefore;
    j["notAfter"] = c.cert.notAfter;
    j["chainLength"] = c.cert.chainLength;
    j["warnings"] = tlsWarnings(c, cardIps());
    return j;
}

json DeviceAdmin::info() {
    json stored;
    int64_t r = 0;
    {
        std::lock_guard<std::mutex> l(mu_);
        const json j = readStore(deviceSettingsPath(o_.dataDir));
        stored = j.is_null() ? json::object() : j["values"];
        r = j.is_null() ? 0 : j["rev"].get<int64_t>();
    }
    json effective;
    std::string err;
    if (!effectiveWith(stored, effective, err)) effective = base();
    struct stat st {};
    return {{"rev", r},
            {"settings", stored},
            {"base", base()},
            {"effective", effective},
            {"running", running()},
            {"restartPending", restartPending_ || effective != running()},
            {"cert", certInfo()},
            {"update",
             {{"enabled", o_.running.updateEnabled},
              {"updaterInstalled", ::stat(o_.updaterPath.c_str(), &st) == 0}}}};
}

DeviceSaveResult DeviceAdmin::save(const json& values, int64_t expectedRev, const std::string& by) {
    DeviceSaveResult r;
    json effective;
    if (!effectiveWith(values, effective, r.error)) {
        r.status = DeviceSaveStatus::Invalid;
        return r;
    }
    {
        std::lock_guard<std::mutex> l(mu_);
        const std::string path = deviceSettingsPath(o_.dataDir);
        const json cur = readStore(path);
        const int64_t now = cur.is_null() ? 0 : cur["rev"].get<int64_t>();
        if (now != expectedRev) {
            r.status = DeviceSaveStatus::Conflict;
            r.rev = now;
            return r;
        }
        const json next = {{"rev", now + 1},
                           {"values", values},
                           {"updatedAt", o_.nowIso ? o_.nowIso() : utcNow()},
                           {"updatedBy", by}};
        std::string err;
        if (!cur.is_null() && !notify::writeFileAtomic(path + ".bak", cur.dump(2) + "\n", err)) {
            r.status = DeviceSaveStatus::IoError;
            r.error = err;
            return r;
        }
        if (!notify::writeFileAtomic(path, next.dump(2) + "\n", err)) {
            r.status = DeviceSaveStatus::IoError;
            r.error = err;
            return r;
        }
        r.rev = now + 1;
    }
    r.restart = effective != running();
    if (r.restart) scheduleRestart();
    return r;
}

ServerCertOptions DeviceAdmin::certOptions(const std::vector<SanEntry>& extra) const {
    ServerCertOptions c;
    c.dataDir = o_.dataDir;
    c.deviceName = o_.running.deviceName;
    c.hostname = o_.hostname ? o_.hostname() : systemHostname();
    c.ipAddresses = cardIps();
    c.extraSans = extra;
    return c;
}

ServerCert DeviceAdmin::regenerate(const std::vector<SanEntry>& extra) {
    std::lock_guard<std::mutex> l(mu_);
    ServerCert c = regenerateServerCert(certOptions(extra));
    return c;
}

CsrResult DeviceAdmin::makeCsr(const std::vector<SanEntry>& extra) {
    std::lock_guard<std::mutex> l(mu_);
    return makeServerCsr(certOptions(extra), compact(o_.nowIso ? o_.nowIso() : utcNow()));
}

ImportResult DeviceAdmin::importCert(const std::string& pem) {
    std::lock_guard<std::mutex> l(mu_);
    ImportOptions io;
    io.dataDir = o_.dataDir;
    io.hostname = o_.hostname ? o_.hostname() : systemHostname();
    io.ipAddresses = cardIps();
    io.rejectExpired = true;
    return importServerCert(io, pem);
}

void DeviceAdmin::scheduleRestart() {
    restartPending_ = true;
    if (o_.requestRestart) o_.requestRestart();
}

}  // namespace mat
