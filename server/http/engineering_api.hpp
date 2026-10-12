// The engineering API of mat-runtime, stage 1 part "device and sign-in" (specs/005-device-online
// contracts/device-api.md §1–§3, research R5, R9, R10, ADR-011): GET /api/v1/device/identity,
// POST /api/v1/auth/login, POST /api/v1/auth/logout, GET /api/v1/auth/session.
//
// Installed on both listeners for every endpoint of the roles table (core/auth/roles.hpp). Each
// request goes through the gate (auth_gate.hpp) first: over HTTP it gets 403 HTTPS_REQUIRED; over
// HTTPS, endpoints of the table that this runtime does not serve yet answer 501 NOT_IMPLEMENTED
// after the gate (the project routes come with US2, diagnostics and audit with US4), so a refusal
// never depends on what is implemented.
//
// Responses: JSON (UTF-8), Cache-Control: no-store, X-Content-Type-Options: nosniff, no CORS
// header; errors are {"error": <CODE>, "message": <Vietnamese sentence>, …}. Request bodies: at
// most 16 KiB (sign-in 4 KiB), else 413 BODY_TOO_LARGE; a chunked body gets 411. Over HTTPS the
// connection stays open (keep-alive) unless the body was too large to drain.
#pragma once
#include <cstddef>
#include <string>
#include <vector>

#include "server/device_state.hpp"
#include "server/http/auth_gate.hpp"

struct mg_connection;
struct mg_context;

namespace mat {

class AuditLog;
class AuthService;

constexpr size_t kJsonBodyMaxBytes = 16 * 1024;  // device-api §1.2
constexpr size_t kLoginBodyMaxBytes = 4 * 1024;  // device-api §3
// A body over the limit is read and dropped up to this size, so the answer reaches the client and
// the connection can stay; above it (or chunked) the connection closes without reading it.
constexpr size_t kBodyDrainMaxBytes = 64 * 1024;

class EngineeringApi {
   public:
    struct Options {
        // "features" of device/identity: what this runtime serves. US2 adds deploy, upload,
        // restore; US4 diagnostics, audit.
        std::vector<std::string> features{"auth"};
    };

    // `audit` may be closed (open() failed): sign-ins and changes are then refused with 503
    // AUDIT_UNAVAILABLE. Every argument must outlive the CivetWeb contexts it is installed on.
    EngineeringApi(Options options, const DeviceState& device, AuthService& auth, AuditLog& audit);
    EngineeringApi(const EngineeringApi&) = delete;
    EngineeringApi& operator=(const EngineeringApi&) = delete;

    // Registers the endpoints of the roles table on `ctx` (HTTP or HTTPS listener).
    void install(mg_context* ctx);

   private:
    // `close`: the answer says Connection: close (always over HTTP, as in 0.3.0).
    static int onRequest(mg_connection* c, void* self);
    int handle(mg_connection* c);
    int identity(mg_connection* c, bool close);
    int login(mg_connection* c, const GateRequest& request, bool close);
    int logout(mg_connection* c, const GateRequest& request, bool close);
    int session(mg_connection* c, const GateDecision& decision, bool close);

    Options opt_;
    const DeviceState& device_;
    AuthService& auth_;
    AuditLog& audit_;
    AuthGate gate_;
};

}  // namespace mat
