// A small SMTP client (RFC 5321) for the alarm emails (specs/023-alarm-email FR-001, FR-002;
// ADR-051): STARTTLS (RFC 3207) or implicit TLS (SMTPS, RFC 8314) on Mbed TLS, AUTH PLAIN or LOGIN
// (RFC 4954), a deadline on every step. The server certificate is checked against CA certificates
// with the host name (SNI + name check), or pinned by the SHA-256 of its DER. Without TLS no
// password is ever sent. Blocking; one call = one connection. Never logs or returns the password.
#pragma once
#include <string>
#include <vector>

#include "core/notify/email_config.hpp"

namespace mat::notify {

constexpr const char* kDefaultCaFile = "/etc/ssl/certs/ca-certificates.crt";

struct SmtpOptions {
    std::string host;
    int port = 587;
    SmtpSecurity security = SmtpSecurity::StartTls;
    std::string username, password;  // username "" = no AUTH
    std::string auth = "auto";       // auto | plain | login
    std::string caFile;              // "" = kDefaultCaFile (when caPem is empty)
    std::string caPem;               // CA certificates as PEM text (tests); wins over caFile
    std::string pinSha256;           // 64 lowercase hex: pin instead of the CA check
    int timeoutMs = 20000;
    std::string heloName = "mat-scada.local";
};

SmtpOptions smtpOptionsOf(const SmtpSettings& s, const std::string& password);

struct SmtpResult {
    bool ok = false;
    bool permanent = false;  // 5xx on MAIL/RCPT/DATA: retrying the same email will not help
    std::string stage;       // connect, greeting, ehlo, starttls, tls, auth, mail, rcpt, data, ...
    int code = 0;            // the SMTP reply code, 0 when none
    std::string error;       // code word: CONNECT, TIMEOUT, TLS, CERT, PIN, AUTH, AUTH_INSECURE,
                             // STARTTLS_UNSUPPORTED, REJECTED, PROTOCOL, ...
    std::string message;     // Vietnamese, for the page (the server's text, cut, no secrets)
    std::vector<std::string> rejected;  // recipients refused with 5xx (the others got it)
    std::string peerSha256;             // SHA-256 of the server certificate seen (TLS), for pinning
};

// Sends `data` (a whole message, see buildMime) to `to`. A recipient refused with 5xx is reported
// in `rejected`; the email still goes to the others (ok when at least one took it).
SmtpResult smtpSend(const SmtpOptions& o, const std::string& from,
                    const std::vector<std::string>& to, const std::string& data);

}  // namespace mat::notify
