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
#include <functional>
#include <string>
#include <utility>
#include <vector>

namespace mat {

// One name of the subject alternative names (feature 007, FR-053, FR-055): an IPv4 address in
// dotted decimal or a DNS host name (RFC 1123). IPv6 addresses and wildcards are not accepted.
struct SanEntry {
    bool ip = false;
    std::string text;
};

// "a,b,c" (the value of --san): every item an IPv4 address or a valid host name, at most 16.
// false + `error` (Vietnamese) for an empty item, IPv6, a wildcard, or anything else.
bool parseSanList(const std::string& text, std::vector<SanEntry>& out, std::string& error);

struct ServerCertOptions {
    std::string dataDir;     // the certificate is <dataDir>/tls/server.pem
    std::string deviceName;  // subject CN "mAT <deviceName>" (deviceName of runtime.json)
    std::string hostname;    // SAN dNSName; left out when empty or not a DNS host name
    // Feature 007: the IPv4 addresses of the cards (dotted decimal; the caller leaves out the
    // loopback) become SAN iPAddress entries, so Chrome accepts https://<IP>:8443; extraSans is
    // --san. Duplicates are written once; at most 16 entries in all.
    std::vector<std::string> ipAddresses;
    std::vector<SanEntry> extraSans;

    ServerCertOptions() = default;
    ServerCertOptions(std::string dataDirIn, std::string deviceNameIn, std::string hostnameIn = {},
                      std::vector<std::string> ips = {}, std::vector<SanEntry> extra = {})
        : dataDir(std::move(dataDirIn)),
          deviceName(std::move(deviceNameIn)),
          hostname(std::move(hostnameIn)),
          ipAddresses(std::move(ips)),
          extraSans(std::move(extra)) {}
};

// What a certificate says about itself, for --cert-info and the warnings of system/info.
struct CertDetails {
    std::string subject;      // "CN=mAT BL335-01"
    std::string issuer;       // the same for a self-signed certificate
    bool selfSigned = false;  // issuer = subject
    std::vector<std::string> sanDns;
    std::vector<std::string> sanIps;  // IPv4 dotted decimal
    std::string notBefore;            // "2000-01-01 00:00:00" (UTC)
    std::string notAfter;
    int chainLength = 0;  // certificates in the file: the server's and the chain
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
    CertDetails cert;               // filled when ok
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

// The CERTIFICATE blocks of a server.pem text and nothing else (GET /device.crt): never a key, a
// comment or a block of another kind. Empty when there is none.
std::string publicCertificatePem(const std::string& pemText);

// system/info.warnings (device-api-1.2 §5): TLS_NO_IP_SAN when the certificate has no iPAddress
// SAN; TLS_SAN_MISMATCH when it has some but one of `currentIps` (the cards now, no loopback) is
// not among them. Empty when !cert.ok.
std::vector<std::string> tlsWarnings(const ServerCert& cert,
                                     const std::vector<std::string>& currentIps);

// --make-csr: a new ECDSA P-256 key goes to <dataDir>/tls/pending-key.pem (0600) and a PKCS#10
// request for it (CN "mAT <deviceName>", SAN as for a certificate, keyUsage digitalSignature,
// extendedKeyUsage serverAuth) to <dataDir>/tls/csr-<stamp>.pem (0644). The certificate in use is
// not touched. `stamp` is the time for the file name ("20261020T030000Z").
struct CsrResult {
    bool ok = false;
    std::string csrPem;   // the request, PEM text (no secret)
    std::string csrPath;  // <dataDir>/tls/csr-<stamp>.pem
    std::string error;
};
CsrResult makeServerCsr(const ServerCertOptions& options, const std::string& stamp);

// --import-cert (device-config-007 §2). Exit codes of the command: 0 done, 2 the file is not
// usable (no certificate, a private key in it, unreadable), 3 no key of the device fits the
// certificate, 4 writing failed.
struct ImportOptions {
    std::string dataDir;
    std::string hostname;                  // the host name the SAN should hold (may be empty)
    std::vector<std::string> ipAddresses;  // the cards now
    // Feature 027 (the admin API): a certificate out of its dates (by the device clock) is refused
    // with code 5 before anything is written. --import-cert only warns.
    bool rejectExpired = false;
    // A test hook: called after each step ("new-written", "prev-linked"); false stops the
    // import there, as a power cut would, with code 4.
    std::function<bool(const char* step)> afterStep;
};
struct ImportResult {
    int code = 0;
    std::string error;
    std::vector<std::string> warnings;  // SAN does not cover the cards or the host name, expired
    std::string fingerprint;            // of the new server certificate, 64 lowercase hex
    std::string fingerprintColons;
};
ImportResult importServerCert(const ImportOptions& options, const std::string& pemText);

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
