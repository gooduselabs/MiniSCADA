// Certificates of the OPC UA client (feature 019, spec D9, D10; contracts/opcua.md §5):
// - the client's own certificate and key, made once (RSA 2048, SHA-256, 10 years, ApplicationUri
//   in the subject alternative name) and kept in <dataDir>/opcua (DER, mode 0600);
// - what a server certificate is: its SHA-256 (the pin), subject and expiry.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace mat::opcua {

struct CertInfo {
    bool ok = false;         // the DER parsed as an X.509 certificate
    std::string sha256;      // of the DER, 64 lower-case hex digits (also when !ok)
    std::string subject;     // "CN=..., O=..."
    int64_t notAfterMs = 0;  // UTC ms
};

CertInfo certInfo(const uint8_t* der, size_t size);
std::string sha256Hex(const uint8_t* data, size_t size);

struct ClientIdentity {
    std::vector<uint8_t> cert, key;  // DER
    std::string applicationUri;
    std::string sha256;  // of the certificate
};

// urn:atpro:mat-scada:<hostname>
std::string defaultApplicationUri();

// The identity of `dir`: read client-cert.der and client-key.der, or make and write them when one
// is missing or does not match `applicationUri`. `dir` "": made in memory only (tests). One
// identity per (dir, uri) for the whole process: made once, then shared. false: `err` says why.
bool clientIdentity(const std::string& dir, const std::string& applicationUri, ClientIdentity& out,
                    std::string& err);

}  // namespace mat::opcua
