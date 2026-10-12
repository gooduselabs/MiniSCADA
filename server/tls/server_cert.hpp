// The device's HTTPS certificate and device id (feature 005; data-model §3, research R5,
// contracts/device-config.md §2 and §7).
//
// On first start the runtime makes an ECDSA P-256 key and a self-signed X.509 v3 certificate with
// Mbed TLS and keeps both in <dataDir>/tls/server.pem (private key, then certificate; file 0600,
// directory 0700), which CivetWeb loads through ssl_certificate. The Studio pins the SHA-256 of the
// certificate (research R6), so a damaged file, or one with wrong permissions, is never replaced on
// its own: a new key would look like an impersonation. Only regenerateServerCert (--regen-cert)
// makes a new key. Files are written to a temporary name, fsync'd, renamed, and the directory is
// fsync'd; writers of one directory take turns (flock), so a start-up and --regen-cert cannot mix.
//
// Mbed TLS stays behind this interface: users need neither its headers nor its configuration.
#pragma once
#include <string>

namespace mat {

struct ServerCertOptions {
    std::string dataDir;     // the certificate is <dataDir>/tls/server.pem
    std::string deviceName;  // subject CN "mAT <deviceName>" (deviceName of runtime.json)
    std::string hostname;    // SAN dNSName; left out when empty or not a DNS host name
};

struct ServerCert {
    // ok: pemPath holds a usable key and certificate. Otherwise HTTPS stays off and
    // system/info.device.https is "cert-error" (main adds "off" and "tls-error", T044).
    bool ok = false;
    const char* httpsState() const { return ok ? "ok" : "cert-error"; }
    std::string pemPath;            // <dataDir>/tls/server.pem, for CivetWeb's ssl_certificate
    std::string fingerprint;        // SHA-256 of the certificate DER, 64 lowercase hex; "" if !ok
    std::string fingerprintColons;  // the same as "AB:CD:…" (95 characters), like
                                    // `openssl x509 -fingerprint -sha256`; "" if !ok
    bool generated = false;         // this call wrote a new key and certificate (cert.generate)
    std::string error;              // why not ok, for the log and the device commands
};

// <dataDir>/tls/server.pem
std::string serverCertPath(const std::string& dataDir);

// Start-up (device-config §7, step 6): reads server.pem, or makes it when the file does not exist
// (with <dataDir> and <dataDir>/tls when missing). An existing file is never replaced: damaged
// (key or certificate unreadable, not an ECDSA key, key not matching the certificate, certificate
// not self-signed with it: a changed byte breaks the signature) or with wrong permissions (file or
// directory mode & 077 != 0, a symbolic link, not a regular file or directory) gives !ok.
// Thread-safe; several processes may call it at once.
ServerCert loadOrCreateServerCert(const ServerCertOptions& options);

// --cert-fingerprint: the same checks, but never writes anything.
ServerCert readServerCert(const std::string& dataDir);

// --regen-cert: a new key and certificate replace whatever is there (also a damaged file); the
// directory gets mode 0700 again. The fingerprint changes: Studios that pinned the old one refuse
// the device until an engineer pins again.
ServerCert regenerateServerCert(const ServerCertOptions& options);

struct DeviceId {
    std::string id;        // UUID version 4, lowercase ("4f9c2a8e-6d1b-4c3a-9e57-0b2f1d6c8a10")
    bool created = false;  // this call made the id (first start, or the old file was damaged)
    std::string warning;   // the old file was damaged, or the new one could not be written
};

// <dataDir>/device-id
std::string deviceIdPath(const std::string& dataDir);

// <dataDir>/device-id: made once (mode 0600, the id and a newline), then kept. The id only lets a
// Studio recognise a device it has seen (discovery, device/identity); it is no secret and proves
// nothing. So, unlike the certificate, a damaged file (anything but a version 4 UUID in lowercase)
// is replaced by a new id with a warning, and a readable file is used whatever its mode. When the
// new file cannot be written, the id still comes back (valid until the process ends) with a
// warning. `id` is empty only when the kernel gives no random bytes (getrandom fails).
DeviceId loadOrCreateDeviceId(const std::string& dataDir);

}  // namespace mat
