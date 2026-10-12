#include "core/auth/auth_service.hpp"

#include <mutex>
#include <set>
#include <utility>
#include <vector>

#include "core/auth/auth_state.hpp"
#include "core/auth/login_guard.hpp"
#include "core/auth/session_store.hpp"
#include "core/common/json_text.hpp"
#include "core/crypto/ct_compare.hpp"

namespace mat {

namespace {

constexpr int64_t kAuditErrorLogEveryMs = 60000;

// A typed name goes into the audit only when it could be an account name; anything else may be a
// password typed in the wrong field (SC-005): no user, and "userInvalid" in the detail.
void typedUser(AuditEvent& e, const std::string& name, bool valid, nlohmann::json& detail) {
    if (valid)
        e.user = name;
    else
        detail["userInvalid"] = true;
}

void setDetail(AuditEvent& e, const nlohmann::json& detail) {
    if (!detail.empty()) e.detail = jsonText(detail);
}

std::string paramsText(const Argon2Params& p) {
    return "m=" + std::to_string(p.mKiB) + ",t=" + std::to_string(p.t) +
           ",p=" + std::to_string(p.p);
}

}  // namespace

std::string ClientAddress::text() const {
    const std::string host = ip.find(':') != std::string::npos ? "[" + ip + "]" : ip;
    return host + ":" + std::to_string(port);
}

const char* loginErrorCode(LoginStatus s) {
    switch (s) {
        case LoginStatus::Ok:
            return "";
        case LoginStatus::Failed:
            return "AUTH_FAILED";
        case LoginStatus::Locked:
            return "AUTH_LOCKED";
        case LoginStatus::Busy:
            return "AUTH_BUSY";
        case LoginStatus::AuditUnavailable:
            return "AUDIT_UNAVAILABLE";
        case LoginStatus::Error:
            return "INTERNAL_ERROR";
    }
    return "";
}

const char* accessErrorCode(AccessStatus s) {
    switch (s) {
        case AccessStatus::Ok:
            return "";
        case AccessStatus::SessionExpired:
            return "SESSION_EXPIRED";
        case AccessStatus::SessionInvalid:
            return "SESSION_INVALID";
        case AccessStatus::Forbidden:
            return "FORBIDDEN";
    }
    return "";
}

struct AuthService::Impl {
    AuthOptions o;
    AuthLogFn log;
    std::function<int64_t()> mono;
    std::mutex mu;  // accounts, sessions, guard, rehashLogged, audit error throttle
    AccountStore accounts;
    SessionStore sessions;
    LoginGuard guard;
    const PasswordHash dummy;
    std::set<std::pair<std::string, int64_t>> rehashLogged;
    int64_t lastAuditErrorLog = 0;
    bool auditErrorLogged = false;
    int64_t auditErrorsSilenced = 0;
    PasswordHasher hasher;  // last: its thread stops first

    explicit Impl(AuthOptions options)
        : o(std::move(options)),
          log(authLogOrStderr(o.log)),
          mono(o.monoMs ? o.monoMs : bootTimeMs),
          accounts(o.usersFile, log),
          sessions(o.newToken),
          dummy(dummyPasswordHash()),
          hasher(o.hash, log, o.hashMaxWaiting) {}

    // rev of an enabled account, for the session check.
    std::optional<int64_t> revOf(const std::string& user) const {
        const Account* a = accounts.find(user);
        if (!a || !a->enabled) return std::nullopt;
        return a->rev;
    }

    // Under `mu`. Changes of users.json end sessions (audit rows queued in `pending`, written by
    // the caller after the lock) and clear lockouts.
    void refreshLocked(int64_t now, std::vector<AuditEvent>& pending) {
        const AccountChanges ch = accounts.refresh(now);
        for (const auto& name : ch.revoked) {
            const size_t n = sessions.removeUser(name);
            if (n == 0) continue;
            AuditEvent e(AuditAction::AuthSessionRevoked, AuditResult::Ok, AuditChannel::System,
                         "system");
            e.user = name;
            e.detail = jsonText({{"sessions", n}, {"reason", "account-changed"}});
            pending.push_back(std::move(e));
        }
        for (const auto& name : ch.unlocked) guard.clearUser(name);
    }

    // Commits one record; false (logged, at most once a minute) when it cannot.
    bool audit(const AuditEvent& e) {
        std::string error;
        if (!o.audit) {
            error = "no audit log";
        } else {
            try {
                o.audit(e);
                return true;
            } catch (const std::exception& ex) {
                error = ex.what();
            }
        }
        std::string line;
        {
            std::lock_guard<std::mutex> l(mu);
            const int64_t now = mono();
            if (auditErrorLogged && now - lastAuditErrorLog < kAuditErrorLogEveryMs) {
                ++auditErrorsSilenced;
                return false;
            }
            line = std::string("audit ") + auditActionName(e.action) + " not written: " + error;
            if (auditErrorsSilenced > 0)
                line += " (" + std::to_string(auditErrorsSilenced) + " more since the last line)";
            auditErrorLogged = true;
            lastAuditErrorLog = now;
            auditErrorsSilenced = 0;
        }
        log(line);
        return false;
    }

    void auditAll(const std::vector<AuditEvent>& events) {
        for (const auto& e : events) audit(e);
    }
};

AuthService::AuthService(AuthOptions options) : impl_(new Impl(std::move(options))) {}

AuthService::~AuthService() = default;

LoginResult AuthService::login(std::string_view user, std::string& password,
                               const ClientAddress& from) {
    struct Wipe {
        std::string& p;
        ~Wipe() { secureZero(p); }
    } wipe{password};
    Impl& s = *impl_;
    LoginResult res;
    if (user.size() > kLoginMaxUserBytes || password.size() > kPasswordMaxBytes) return res;
    const std::string name(user);
    const bool nameValid = validAccountName(name);
    // The lockout counts per name only for names an account could have (login_guard.hpp).
    const std::string key = nameValid ? name : std::string();

    std::vector<AuditEvent> pending;
    GuardDecision decision;
    LockoutNow lockedNow;
    std::optional<std::future<std::string>> job;
    PasswordHash target;
    bool real = false;
    Role role = Role::Viewer;
    int64_t rev = 0;
    {
        std::lock_guard<std::mutex> l(s.mu);
        const int64_t now = s.mono();
        s.refreshLocked(now, pending);
        const Account* acc = nameValid ? s.accounts.find(name) : nullptr;
        std::optional<AccountGeneration> generation;
        if (acc) generation = AccountGeneration{acc->rev, acc->unlockSeq};
        decision = s.guard.check(key, from.ip, now, generation);
        if (!decision.locked) {
            // Unknown, damaged or disabled, or no account at all: one hash of the dummy, with the
            // default parameters, so the time tells nothing (not even old parameters).
            real = acc && acc->hash && acc->enabled;
            target = real ? *acc->hash : s.dummy;
            if (acc) {
                role = acc->role;
                rev = acc->rev;
            }
            job = s.hasher.submit(password, target);
            // Counted before the hash, so attempts in parallel cannot pass 5 (research R9); a
            // right password clears it below.
            if (job) lockedNow = s.guard.recordFailure(key, from.ip, now, generation);
        }
    }
    s.auditAll(pending);
    const std::string source = from.text();

    if (decision.locked) {
        AuditEvent e(AuditAction::AuthLocked, AuditResult::Denied, AuditChannel::Https, source);
        e.code = "AUTH_LOCKED";
        nlohmann::json detail = nlohmann::json::object();
        typedUser(e, name, nameValid, detail);
        setDetail(e, detail);
        if (!s.audit(e)) {
            res.status = LoginStatus::AuditUnavailable;
            return res;
        }
        res.status = LoginStatus::Locked;
        res.retryAfterS = decision.retryAfterS;
        return res;
    }
    if (!job) {
        res.status = LoginStatus::Busy;
        return res;
    }
    secureZero(password);  // the hasher has its own copy, wiped after its hash

    std::string computed;
    try {
        computed = job->get();
    } catch (const std::exception& ex) {
        s.log(std::string("password hash failed: ") + ex.what());
        res.status = LoginStatus::Error;
        return res;
    }
    const bool equal = constantTimeEqual(computed, target.hash);
    secureZero(computed);

    if (real && equal) {
        AuditEvent ok(AuditAction::AuthLogin, AuditResult::Ok, AuditChannel::Https, source);
        ok.user = name;
        ok.role = roleName(role);
        if (!s.audit(ok)) {  // no token without its record (device-api §3)
            res.status = LoginStatus::AuditUnavailable;
            return res;
        }
        bool noteRehash = false;
        {
            std::lock_guard<std::mutex> l(s.mu);
            s.guard.recordSuccess(key, from.ip);
            res.token = s.sessions.create(name, rev, from.ip, s.mono());
            noteRehash = needsRehash(target) && s.rehashLogged.emplace(name, rev).second;
        }
        if (noteRehash)
            s.log("account " + name + ": its password hash uses " + paramsText(target.params) +
                  "; set the password again (mat-runtime --user-passwd " + name + ") to move to " +
                  paramsText(kArgon2Default));
        res.status = LoginStatus::Ok;
        res.user = name;
        res.role = role;
        return res;
    }

    AuditEvent failed(AuditAction::AuthLogin, AuditResult::Failed, AuditChannel::Https, source);
    failed.code = "AUTH_FAILED";
    nlohmann::json detail = nlohmann::json::object();
    typedUser(failed, name, nameValid, detail);
    setDetail(failed, detail);
    bool audited = s.audit(failed);
    if (lockedNow.user || lockedNow.source) {
        AuditEvent lockout(AuditAction::AuthLockout, AuditResult::Denied, AuditChannel::Https,
                           source);
        lockout.code = "AUTH_LOCKED";
        nlohmann::json d = nlohmann::json::object();
        nlohmann::json by = nlohmann::json::array();
        if (lockedNow.user) by.push_back("user");
        if (lockedNow.source) by.push_back("source");
        d["by"] = by;
        typedUser(lockout, name, nameValid, d);
        setDetail(lockout, d);
        audited = s.audit(lockout) && audited;
    }
    res.status = audited ? LoginStatus::Failed : LoginStatus::AuditUnavailable;
    return res;
}

Access AuthService::authorize(std::string_view token, const ClientAddress& from, Role minRole,
                              bool refresh) {
    Impl& s = *impl_;
    Access a;
    std::vector<AuditEvent> pending;
    {
        std::lock_guard<std::mutex> l(s.mu);
        const int64_t now = s.mono();
        s.refreshLocked(now, pending);
        const SessionCheck c =
            s.sessions.check(token, from.ip, now, [&](const std::string& u) { return s.revOf(u); });
        a.user = c.user;
        const Account* acc = c.status == SessionStatus::Ok ? s.accounts.find(c.user) : nullptr;
        if (c.status == SessionStatus::Expired) {
            a.status = AccessStatus::SessionExpired;
        } else if (!acc) {
            a.status = AccessStatus::SessionInvalid;
        } else {
            a.role = acc->role;  // read from users.json at every request (research R10)
            if (!roleAtLeast(acc->role, minRole)) {
                a.status = AccessStatus::Forbidden;
            } else {
                a.status = AccessStatus::Ok;
                if (refresh) s.sessions.touch(token, now);
                a.idleRemainingS = refresh ? kSessionIdleMs / 1000 : c.idleRemainingS;
                a.lifetimeRemainingS = c.lifetimeRemainingS;
            }
        }
    }
    s.auditAll(pending);
    return a;
}

AccessStatus AuthService::logout(std::string_view token, const ClientAddress& from) {
    Impl& s = *impl_;
    std::vector<AuditEvent> pending;
    AccessStatus status = AccessStatus::SessionExpired;
    std::string user;
    Role role = Role::Viewer;
    {
        std::lock_guard<std::mutex> l(s.mu);
        const int64_t now = s.mono();
        s.refreshLocked(now, pending);
        const SessionCheck c =
            s.sessions.check(token, from.ip, now, [&](const std::string& u) { return s.revOf(u); });
        const Account* acc = c.status == SessionStatus::Ok ? s.accounts.find(c.user) : nullptr;
        if (c.status == SessionStatus::Expired) {
            status = AccessStatus::SessionExpired;
        } else if (!acc) {
            status = AccessStatus::SessionInvalid;
        } else {
            s.sessions.remove(token);
            status = AccessStatus::Ok;
            user = c.user;
            role = acc->role;
        }
    }
    s.auditAll(pending);
    if (status == AccessStatus::Ok) {
        // The session has ended already: signing out never waits for the audit.
        AuditEvent e(AuditAction::AuthLogout, AuditResult::Ok, AuditChannel::Https, from.text());
        e.user = user;
        e.role = roleName(role);
        s.audit(e);
    }
    return status;
}

bool AuthService::setupRequired() {
    Impl& s = *impl_;
    std::vector<AuditEvent> pending;
    bool required = false;
    {
        std::lock_guard<std::mutex> l(s.mu);
        s.refreshLocked(s.mono(), pending);
        required = s.accounts.status() == UsersStatus::Missing ||
                   (s.accounts.status() == UsersStatus::Ok && s.accounts.size() == 0);
    }
    s.auditAll(pending);
    return required;
}

UsersStatus AuthService::accountsStatus() {
    Impl& s = *impl_;
    std::vector<AuditEvent> pending;
    UsersStatus status;
    {
        std::lock_guard<std::mutex> l(s.mu);
        s.refreshLocked(s.mono(), pending);
        status = s.accounts.status();
    }
    s.auditAll(pending);
    return status;
}

size_t AuthService::activeSessions() {
    std::lock_guard<std::mutex> l(impl_->mu);
    return impl_->sessions.activeCount(impl_->mono());
}

size_t AuthService::hashesWaiting() const { return impl_->hasher.waiting(); }

bool AuthService::saveState(const std::string& path, std::string& err) {
    Impl& s = *impl_;
    AuthState st;
    st.bootId = s.o.bootId ? s.o.bootId() : readBootId();
    {
        std::lock_guard<std::mutex> l(s.mu);
        st.sessions = s.sessions.sessions();
        st.guard = s.guard.state();
    }
    return writeAuthState(path, st, err);
}

void AuthService::loadState(const std::string& path) {
    Impl& s = *impl_;
    const std::string boot = s.o.bootId ? s.o.bootId() : readBootId();
    std::string why;
    {
        std::lock_guard<std::mutex> l(s.mu);
        const int64_t now = s.mono();
        AuthState st = readAuthState(path, boot, now, &why);
        s.sessions.restore(std::move(st.sessions), now);
        s.guard.restore(std::move(st.guard));
    }
    if (!why.empty() && why != "missing") s.log(path + " not used: " + why);
}

}  // namespace mat
