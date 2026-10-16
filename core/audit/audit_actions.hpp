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
    // Feature 006 (device-api 1.1.0)
    DriverTest,  // driver.test: the connection test; result ok / failed / denied
    TagWrite,    // tag.write: started, ok, failed, denied, interrupted (data-model §9)
    // Feature 007 (device-api 1.2.0)
    AuthSessionEvicted,  // auth.session_evicted: the idlest web session left for a new one
    TlsCsr,              // tls.csr: --make-csr (started, ok / failed)
    TlsImport,           // tls.import: --import-cert (started, ok / failed)
    // Feature 009 (device-api 1.3.0, data-model §8)
    AlarmAck,       // alarm.ack: ok / denied
    AlarmShelve,    // alarm.shelve: by a person (web, https) or by system (chatter)
    AlarmUnshelve,  // alarm.unshelve
    AlarmDisable,   // alarm.disable: engineer, Bearer only
    AlarmEnable,    // alarm.enable
    AlarmPurged,    // alarm.purged: the clean-up of alarm.db (system)
    // Feature 010 (device-api 1.4.0)
    HistoryExport,  // history.export: GET /history/export.csv (ok, aborted, timeout)
};

enum class AuditResult { Ok, Failed, Denied, Started, RolledBack, Interrupted };

// Web: a tag write or a sign-in of a web page (cookie session, feature 007); Https: every other
// request over HTTPS (the Studio, tools).
enum class AuditChannel { Https, Http, Cli, System, Web };

inline constexpr std::array<AuditAction, 34> kAuditActions = {
    AuditAction::AuthLogin,          AuditAction::AuthLocked,
    AuditAction::AuthLockout,        AuditAction::AuthLogout,
    AuditAction::AuthSessionRevoked, AuditAction::AccessDenied,
    AuditAction::ProjectDeploy,      AuditAction::ProjectRestore,
    AuditAction::ProjectRead,        AuditAction::ProjectAdopt,
    AuditAction::CertGenerate,       AuditAction::CertRegenerate,
    AuditAction::AuditRead,          AuditAction::AuditExport,
    AuditAction::AuditPurged,        AuditAction::AuditSuppressed,
    AuditAction::AccountCreate,      AuditAction::AccountPassword,
    AuditAction::AccountRole,        AuditAction::AccountDisable,
    AuditAction::AccountEnable,      AuditAction::AccountUnlock,
    AuditAction::DriverTest,         AuditAction::TagWrite,
    AuditAction::AuthSessionEvicted, AuditAction::TlsCsr,
    AuditAction::TlsImport,          AuditAction::AlarmAck,
    AuditAction::AlarmShelve,        AuditAction::AlarmUnshelve,
    AuditAction::AlarmDisable,       AuditAction::AlarmEnable,
    AuditAction::AlarmPurged,        AuditAction::HistoryExport,
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
        case AuditAction::DriverTest:
            return "driver.test";
        case AuditAction::TagWrite:
            return "tag.write";
        case AuditAction::AuthSessionEvicted:
            return "auth.session_evicted";
        case AuditAction::TlsCsr:
            return "tls.csr";
        case AuditAction::TlsImport:
            return "tls.import";
        case AuditAction::AlarmAck:
            return "alarm.ack";
        case AuditAction::AlarmShelve:
            return "alarm.shelve";
        case AuditAction::AlarmUnshelve:
            return "alarm.unshelve";
        case AuditAction::AlarmDisable:
            return "alarm.disable";
        case AuditAction::AlarmEnable:
            return "alarm.enable";
        case AuditAction::AlarmPurged:
            return "alarm.purged";
        case AuditAction::HistoryExport:
            return "history.export";
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
        case AuditChannel::Web:
            return "web";
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
constexpr bool auditLimited(AuditAction a, AuditResult r, AuditChannel c = AuditChannel::Https) {
    return (a == AuditAction::AuthLogin && r == AuditResult::Failed) ||
           a == AuditAction::AuthLocked || a == AuditAction::AccessDenied ||
           // feature 006: a refused tag write or connection test can be repeated at will too
           ((a == AuditAction::TagWrite || a == AuditAction::DriverTest) &&
            r == AuditResult::Denied) ||
           // feature 009: every refused alarm action; alarm.shelve / alarm.unshelve by `system`
           // (chatter quarantine, expiry) too
           ((a == AuditAction::AlarmAck || a == AuditAction::AlarmShelve ||
             a == AuditAction::AlarmUnshelve || a == AuditAction::AlarmDisable ||
             a == AuditAction::AlarmEnable) &&
            r == AuditResult::Denied) ||
           ((a == AuditAction::AlarmShelve || a == AuditAction::AlarmUnshelve) &&
            c == AuditChannel::System);
}

}  // namespace mat
