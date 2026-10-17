// Errors of the update package checks (specs/011-pilot-hardening/contracts/update-package.md §1–§3,
// §6; device-api-011 §3): the API code, the detail code of UPDATE_PACKAGE_INVALID, the HTTP status
// of POST /system/update and the exit code of mat-update-verify. No dependency: mat-update-verify,
// the runtime and the fuzz target share it.
#pragma once
#include <string>

namespace mat::update {

// Exit codes of mat-update-verify (device-api-011 §7; 6 added by T096 for the refusals that depend
// on the device and not on the package: arch, releaseSeq, versions, project, updater protocol).
enum ExitCode : int {
    kExitOk = 0,
    kExitUsage = 2,
    kExitSignature = 3,  // UPDATE_SIGNATURE_INVALID
    kExitKeys = 4,       // UPDATE_KEYS_MISSING: no usable trusted key
    kExitInvalid = 5,  // UPDATE_PACKAGE_INVALID, UPDATE_TOO_LARGE, a SHA256SUMS that does not match
    kExitRefused = 6,  // refused for this device (UPDATE_DOWNGRADE, UPDATE_ARCH_MISMATCH, …)
};

struct Error {
    std::string code;        // UPDATE_PACKAGE_INVALID, UPDATE_SIGNATURE_INVALID, …
    std::string detailCode;  // UPDATE_PACKAGE_INVALID: ENVELOPE_HEADER, PAYLOAD_DIGEST, …; else ""
    std::string detail;      // for people and logs (an English phrase, a path); never a secret
    int http = 400;
    int exit = kExitInvalid;
};

inline Error invalid(const char* detailCode, std::string detail = {}) {
    return Error{"UPDATE_PACKAGE_INVALID", detailCode, std::move(detail), 400, kExitInvalid};
}
inline Error refused(const char* code, int http, std::string detail = {}) {
    return Error{code, "", std::move(detail), http, kExitRefused};
}

// Fixed limits of contract §1, §2 and FR-061.
constexpr unsigned long long kManifestMaxBytes = 256ULL * 1024;
constexpr unsigned long long kSigMaxBytes = 128;
constexpr unsigned long long kUnpackedMaxBytes = 128ULL * 1024 * 1024;
constexpr unsigned long long kMaxRatio = 20;
constexpr size_t kPathMaxBytes = 200;
constexpr size_t kMaxFiles = 20000;
constexpr size_t kMaxTrustedKeys = 4;  // ADR-035 "Số đo": each wrong key costs one verify
constexpr size_t kKeysetMaxAdd = 4;
constexpr int kUpdaterProtocol = 1;  // updaterRequired that this mat-updater understands

}  // namespace mat::update
