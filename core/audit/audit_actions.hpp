// Catalogue of the audit log (specs/005-device-online data-model §7, research R11): actions,
// results and channels, stored in audit.db by name. Later stages add actions at the end.
#pragma once
#include <array>
#include <optional>
#include <string_view>

namespace mat {

enum class AuditAction {
    // Sign-in
    AuthLogin,           // auth.login: result ok / failed
    AuthLocked,          // auth.locked: refused while locked
    AuthLockout,         // auth.lockout: the account or the address has just been locked
    AuthLogout,          // auth.logout
    AuthSessionRevoked,  // auth.session-revoked
    // Access
    AccessDenied,  // access.denied: code AUTH_REQUIRED, SESSION_EXPIRED, SESSION_INVALID,
                   // FORBIDDEN or HTTPS_REQUIRED
    // Project
    ProjectDeploy,   // project.deploy: started, then ok / failed / rolled-back / interrupted
    ProjectRestore,  // project.restore: as project.deploy
    ProjectRead,     // project.read: upload of the running package
    ProjectAdopt,    // project.adopt: project installed the old way taken into the store
    // Device
    CertGenerate,     // cert.generate
    CertRegenerate,   // cert.regenerate
    AuditRead,        // audit.read
    AuditExport,      // audit.export
    AuditPurged,      // audit.purged: oldest rows deleted above the size cap
    AuditSuppressed,  // audit.suppressed: limited rows over 10 per minute, counted
    // Accounts
    AccountCreate,    // account.create
    AccountPassword,  // account.password
    AccountRole,      // account.role
    AccountDisable,   // account.disable
    AccountEnable,    // account.enable
    AccountUnlock,    // account.unlock
};

enum class AuditResult { Ok, Failed, Denied, Started, RolledBack, Interrupted };

enum class AuditChannel { Https, Http, Cli, System };

inline constexpr std::array<AuditAction, 22> kAuditActions = {
    AuditAction::AuthLogin,       AuditAction::AuthLocked,         AuditAction::AuthLockout,
    AuditAction::AuthLogout,      AuditAction::AuthSessionRevoked, AuditAction::AccessDenied,
    AuditAction::ProjectDeploy,   AuditAction::ProjectRestore,     AuditAction::ProjectRead,
    AuditAction::ProjectAdopt,    AuditAction::CertGenerate,       AuditAction::CertRegenerate,
    AuditAction::AuditRead,       AuditAction::AuditExport,        AuditAction::AuditPurged,
    AuditAction::AuditSuppressed, AuditAction::AccountCreate,      AuditAction::AccountPassword,
    AuditAction::AccountRole,     AuditAction::AccountDisable,     AuditAction::AccountEnable,
    AuditAction::AccountUnlock,
};

constexpr const char* auditActionName(AuditAction a) {
    switch (a) {
        case AuditAction::AuthLogin:
            return "auth.login";
        case AuditAction::AuthLocked:
            return "auth.locked";
        case AuditAction::AuthLockout:
            return "auth.lockout";
        case AuditAction::AuthLogout:
            return "auth.logout";
        case AuditAction::AuthSessionRevoked:
            return "auth.session-revoked";
        case AuditAction::AccessDenied:
            return "access.denied";
        case AuditAction::ProjectDeploy:
            return "project.deploy";
        case AuditAction::ProjectRestore:
            return "project.restore";
        case AuditAction::ProjectRead:
            return "project.read";
        case AuditAction::ProjectAdopt:
            return "project.adopt";
        case AuditAction::CertGenerate:
            return "cert.generate";
        case AuditAction::CertRegenerate:
            return "cert.regenerate";
        case AuditAction::AuditRead:
            return "audit.read";
        case AuditAction::AuditExport:
            return "audit.export";
        case AuditAction::AuditPurged:
            return "audit.purged";
        case AuditAction::AuditSuppressed:
            return "audit.suppressed";
        case AuditAction::AccountCreate:
            return "account.create";
        case AuditAction::AccountPassword:
            return "account.password";
        case AuditAction::AccountRole:
            return "account.role";
        case AuditAction::AccountDisable:
            return "account.disable";
        case AuditAction::AccountEnable:
            return "account.enable";
        case AuditAction::AccountUnlock:
            return "account.unlock";
    }
    return "";
}

constexpr const char* auditResultName(AuditResult r) {
    switch (r) {
        case AuditResult::Ok:
            return "ok";
        case AuditResult::Failed:
            return "failed";
        case AuditResult::Denied:
            return "denied";
        case AuditResult::Started:
            return "started";
        case AuditResult::RolledBack:
            return "rolled-back";
        case AuditResult::Interrupted:
            return "interrupted";
    }
    return "";
}

constexpr const char* auditChannelName(AuditChannel c) {
    switch (c) {
        case AuditChannel::Https:
            return "https";
        case AuditChannel::Http:
            return "http";
        case AuditChannel::Cli:
            return "cli";
        case AuditChannel::System:
            return "system";
    }
    return "";
}

constexpr std::optional<AuditAction> parseAuditAction(std::string_view name) {
    for (AuditAction a : kAuditActions)
        if (name == auditActionName(a)) return a;
    return std::nullopt;
}

// The kinds an attacker can repeat at will (failed sign-in, refusal while locked, refused
// access): coalesced per 60 s and limited to 10 rows per minute (research R11). Changes and
// successful sign-ins are never limited.
constexpr bool auditLimited(AuditAction a, AuditResult r) {
    return (a == AuditAction::AuthLogin && r == AuditResult::Failed) ||
           a == AuditAction::AuthLocked || a == AuditAction::AccessDenied;
}

}  // namespace mat
