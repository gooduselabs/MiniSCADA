#include "core/auth/auth_service.hpp"

#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <map>
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
constexpr int64_t kBusyReportEveryMs = 60000;   // auth.busy: at most one record a minute (L4)
constexpr int64_t kLastLoginEveryMs = 3600000;  // feature 013: lastLoginAt once an hour

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

// "::ffff:192.168.1.20" (an IPv4 client on a dual stack socket) is 192.168.1.20.
std::string normalizedIp(const std::string& ip) {
    constexpr const char* kMapped = "::ffff:";
    if (ip.size() > 7 && ip.compare(0, 7, kMapped) == 0 && ip.find('.') != std::string::npos)
        return ip.substr(7);
    return ip;
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
            return "LOGIN_BUSY";
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
    size_t inFlight = 0;  // sign-ins waiting for or running their hash (maxConcurrentLogins)
    // L4 of the security review of 011: LOGIN_BUSY refusals since the last auth.busy record.
    int64_t busyRefused = 0;
    bool busyReported = false;
    int64_t lastBusyReport = 0;
    bool unlockChecked = false;
    int64_t lastUnlockCheck = 0;
    bool unlockErrorLogged = false;
    std::map<std::string, int64_t> lastLoginNoted;  // feature 013: wall ms of the last note
    PasswordHasher hasher;                          // last: its thread stops first

    explicit Impl(AuthOptions options)
        : o(std::move(options)),
          log(authLogOrStderr(o.log)),
          mono(o.monoMs ? o.monoMs : bootTimeMs),
          accounts(o.usersFile, log),
          sessions(o.newToken, o.newWebToken, o.newCsrf),
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
    void refreshLocked(int64_t now, std::vector<AuditEvent>& pending,
                       const std::optional<KeepSession>& keep = std::nullopt,
                       std::vector<std::pair<std::string, size_t>>* ended = nullptr) {
        const AccountChanges ch = accounts.refresh(now);
        for (const auto& name : ch.revoked) {
            const Account* still = accounts.find(name);
            const size_t n =
                keep && keep->user == name && still && still->enabled
                    ? sessions.removeUserExcept(name, keep->token, keep->kind, still->rev)
                    : sessions.removeUser(name);
            if (ended) ended->emplace_back(name, n);
            if (n == 0) continue;
            AuditEvent e(AuditAction::AuthSessionRevoked, AuditResult::Ok, AuditChannel::System,
                         "system");
            e.user = name;
            e.detail = jsonText({{"sessions", n}, {"reason", "account-changed"}});
            pending.push_back(std::move(e));
        }
        for (const auto& name : ch.unlocked) guard.clearUser(name);
        checkUnlockRequest(now, pending, false);
    }

    // Under `mu`. --user-unlock-all (FR-017) leaves o.unlockRequestFile; looked at every
    // kUnlockRequestCheckMs (and by loadState with `force`). It is deleted first: every lock goes
    // only when it could be, so a file the runtime cannot remove does not unlock every 5 s.
    void checkUnlockRequest(int64_t now, std::vector<AuditEvent>& pending, bool force) {
        if (o.unlockRequestFile.empty()) return;
        if (!force && unlockChecked && now - lastUnlockCheck < kUnlockRequestCheckMs) return;
        unlockChecked = true;
        lastUnlockCheck = now;
        struct stat st {};
        if (::lstat(o.unlockRequestFile.c_str(), &st) != 0) return;
        // L2 of the review of 011: only what --user-unlock-all writes (a regular file of root,
        // 0600). A file the service user (or anyone else) could have left is not a request.
        const char* refused = !S_ISREG(st.st_mode)
                                  ? "type"
                                  : st.st_uid != o.requestFileOwner
                                        ? "owner"
                                        : (st.st_mode & 077) != 0 ? "mode" : nullptr;
        if (refused) {
            const int rc = S_ISDIR(st.st_mode) ? ::rmdir(o.unlockRequestFile.c_str())
                                               : ::unlink(o.unlockRequestFile.c_str());
            const bool removed = rc == 0;
            if (!removed && unlockErrorLogged) return;  // logged and audited once already
            unlockErrorLogged = !removed;
            log(o.unlockRequestFile + " not used: " + refused + " (a regular file of uid " +
                std::to_string(o.requestFileOwner) + ", mode 0600, is expected)" +
                (removed ? ": removed"
                         : std::string(": cannot remove it: ") + std::strerror(errno)));
            AuditEvent e(AuditAction::AccountUnlock, AuditResult::Denied, AuditChannel::System,
                         "system");
            e.target = "*";
            e.code = "UNLOCK_REQUEST_REFUSED";
            e.detail = jsonText({{"scope", "all"},
                                 {"via", "request-file"},
                                 {"reason", refused},
                                 {"uid", static_cast<int64_t>(st.st_uid)},
                                 {"mode", static_cast<int64_t>(st.st_mode & 07777)}});
            pending.push_back(std::move(e));
            return;
        }
        if (::unlink(o.unlockRequestFile.c_str()) != 0) {
            if (!unlockErrorLogged)
                log(o.unlockRequestFile + " not used: cannot delete it: " + std::strerror(errno));
            unlockErrorLogged = true;
            return;
        }
        unlockErrorLogged = false;
        guard.clearAll();
        log("every sign-in lock cleared (" + o.unlockRequestFile + ", --user-unlock-all)");
        AuditEvent e(AuditAction::AccountUnlock, AuditResult::Ok, AuditChannel::System, "system");
        e.target = "*";
        e.detail = jsonText({{"scope", "all"}, {"via", "request-file"}});
        pending.push_back(std::move(e));
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

    // L4 / N-A1 (T202): the auth.busy record and its log line for the refusals counted since the
    // last one, when there are some and `force` or the first one or a minute since the last one.
    // Under `mu`; the record and the line are written by the caller after the lock.
    void takeBusyReportLocked(int64_t now, bool force, std::vector<AuditEvent>& pending,
                              std::string& line) {
        if (busyRefused == 0) return;
        if (!force && busyReported && now - lastBusyReport < kBusyReportEveryMs) return;
        const size_t limit = std::max<size_t>(1, o.maxConcurrentLogins);
        AuditEvent e(AuditAction::AuthBusy, AuditResult::Denied, AuditChannel::System, "system");
        e.code = "LOGIN_BUSY";
        e.detail = jsonText({{"refused", busyRefused},
                             {"maxConcurrentLogins", limit},
                             {"windowS", kBusyReportEveryMs / 1000}});
        pending.push_back(std::move(e));
        line = "sign-ins refused with LOGIN_BUSY: " + std::to_string(busyRefused) +
               (busyReported ? " since the last report" : "") + " (maxConcurrentLogins " +
               std::to_string(limit) + "; many sign-ins at once: an attack, or a script)";
        busyRefused = 0;
        busyReported = true;
        lastBusyReport = now;
    }
};

AuthService::AuthService(AuthOptions options) : impl_(new Impl(std::move(options))) {}

AuthService::~AuthService() = default;

LoginResult AuthService::login(std::string_view user, std::string& password,
                               const ClientAddress& from) {
    return loginKind(SessionKind::Bearer, user, password, from);
}

LoginResult AuthService::loginWeb(std::string_view user, std::string& password,
                                  const ClientAddress& from) {
    return loginKind(SessionKind::Web, user, password, from);
}

LoginResult AuthService::reauthenticate(std::string_view user, std::string& password,
                                        const ClientAddress& from) {
    return loginKind(SessionKind::Bearer, user, password, from, true);
}

LoginResult AuthService::loginKind(SessionKind kind, std::string_view user, std::string& password,
                                   const ClientAddress& from, bool reauth) {
    struct Wipe {
        std::string& p;
        ~Wipe() { secureZero(p); }
    } wipe{password};
    Impl& s = *impl_;
    const bool web = kind == SessionKind::Web;
    const AuditChannel channel = web ? AuditChannel::Web : AuditChannel::Https;
    // A web session is bound to the address of its sign-in; an IPv4 address in IPv6 form is the
    // same address (the listener may be dual stack).
    const std::string sessionIp = web ? normalizedIp(from.ip) : from.ip;
    // L7 of the security review of 011: the lockout counts the address, whatever the listener.
    const std::string guardIp = normalizedIp(from.ip);
    LoginResult res;
    if (user.size() > kLoginMaxUserBytes || password.size() > kPasswordMaxBytes) return res;
    const std::string name(user);
    const bool nameValid = validAccountName(name);
    // The lockout counts pairs only for names an account could have (login_guard.hpp).
    const std::string key = guardName(name);

    std::vector<AuditEvent> pending;
    GuardDecision decision;
    LockoutNow lockedNow;
    std::optional<std::future<std::string>> job;
    bool busy = false;
    std::string busyLine;  // L4: the warning that goes with auth.busy
    int64_t attemptMono = 0;
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
        decision = s.guard.check(key, guardIp, now, generation);
        if (!decision.locked) {
            // Unknown, damaged or disabled, or no account at all: one hash of the dummy, with the
            // default parameters, so the time tells nothing (not even old parameters).
            real = acc && acc->hash && acc->enabled;
            target = real ? *acc->hash : s.dummy;
            if (acc) {
                role = acc->role;
                rev = acc->rev;
            }
            // FR-016: at most maxConcurrentLogins wait for or run their hash; one more is
            // LOGIN_BUSY: no hash, no failure counted, no audit (a refusal for load).
            if (s.inFlight < std::max<size_t>(1, s.o.maxConcurrentLogins))
                job = s.hasher.submit(password, target);
            busy = !job;
            if (busy) {  // L4: counted; one auth.busy a minute (written after the lock)
                ++s.busyRefused;
                s.takeBusyReportLocked(now, false, pending, busyLine);
            }
            if (job) {
                ++s.inFlight;
                attemptMono = now;
                // Counted before the hash, so attempts in parallel cannot pass a limit (research
                // R9); a right password takes it back below.
                lockedNow = s.guard.recordFailure(key, guardIp, now, generation);
            }
        }
    }
    // The slot is free again once the hash has answered, whatever happens next.
    struct Slot {
        Impl& s;
        bool held;
        ~Slot() {
            if (!held) return;
            std::lock_guard<std::mutex> l(s.mu);
            --s.inFlight;
        }
    } slot{s, job.has_value()};
    s.auditAll(pending);
    const std::string source = from.text();

    if (decision.locked) {
        AuditEvent e(AuditAction::AuthLocked, AuditResult::Denied, channel, source);
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
    if (busy) {
        if (!busyLine.empty()) s.log(busyLine);
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
    {
        std::lock_guard<std::mutex> l(s.mu);
        --s.inFlight;
        slot.held = false;
    }

    if (real && equal && reauth) {  // the password again (OTA): no session
        AuditEvent ok(AuditAction::AuthReauth, AuditResult::Ok, channel, source);
        ok.user = name;
        ok.role = roleName(role);
        if (!s.audit(ok)) {
            res.status = LoginStatus::AuditUnavailable;
            return res;
        }
        {
            std::lock_guard<std::mutex> l(s.mu);
            s.guard.recordSuccess(key, guardIp, attemptMono);
        }
        res.status = LoginStatus::Ok;
        res.user = name;
        res.role = role;
        return res;
    }
    if (real && equal) {
        AuditEvent ok(AuditAction::AuthLogin, AuditResult::Ok, channel, source);
        ok.user = name;
        ok.role = roleName(role);
        if (!s.audit(ok)) {  // no token without its record (device-api §3)
            res.status = LoginStatus::AuditUnavailable;
            return res;
        }
        bool noteRehash = false;
        std::optional<std::string> evicted;
        {
            std::lock_guard<std::mutex> l(s.mu);
            s.guard.recordSuccess(key, guardIp, attemptMono);
            if (web) {
                const int64_t now = s.mono();
                WebSessionCreated w =
                    s.sessions.createWeb(name, rev, sessionIp, now, s.o.webIdleLimitS * 1000,
                                         s.o.webMaxLifetimeS * 1000, s.o.webMaxSessions);
                res.token = std::move(w.token);
                res.csrf = std::move(w.csrf);
                evicted = std::move(w.evicted);
                res.idleTimeoutS = s.o.webIdleLimitS;
                res.maxSessionS = s.o.webMaxLifetimeS;
            } else {
                res.token = s.sessions.create(name, rev, from.ip, s.mono());
            }
            noteRehash = needsRehash(target) && s.rehashLogged.emplace(name, rev).second;
        }
        if (evicted) {  // the idlest web session left for this one (device-api-1.2 §2.1)
            AuditEvent e(AuditAction::AuthSessionEvicted, AuditResult::Ok, AuditChannel::System,
                         "system");
            e.user = *evicted;
            e.detail = jsonText({{"kind", "web"}, {"reason", "quota"}});
            s.audit(e);
        }
        if (noteRehash)
            s.log("account " + name + ": its password hash uses " + paramsText(target.params) +
                  "; set the password again (mat-runtime --user-passwd " + name + ") to move to " +
                  paramsText(kArgon2Default));
        // Feature 013: lastLoginAt at most once an hour per account (eMMC budget).
        if (s.o.noteLogin) {
            const int64_t wall = s.o.wallMs
                                     ? s.o.wallMs()
                                     : std::chrono::duration_cast<std::chrono::milliseconds>(
                                           std::chrono::system_clock::now().time_since_epoch())
                                           .count();
            bool due = false;
            {
                std::lock_guard<std::mutex> l(s.mu);
                std::optional<int64_t> last;
                if (const Account* acc = s.accounts.find(name)) last = acc->lastLoginAt;
                const auto noted = s.lastLoginNoted.find(name);
                if (noted != s.lastLoginNoted.end())
                    last = last ? std::max(*last, noted->second) : noted->second;
                due = !last || wall - *last >= kLastLoginEveryMs;
                if (due) s.lastLoginNoted[name] = wall;
            }
            if (due) s.o.noteLogin(name, wall);
        }
        res.status = LoginStatus::Ok;
        res.user = name;
        res.role = role;
        return res;
    }

    std::optional<DistributedAttack> attack;
    {
        std::lock_guard<std::mutex> l(s.mu);
        attack = s.guard.noteFailure(key, guardIp, s.mono());
    }
    AuditEvent failed(reauth ? AuditAction::AuthReauth : AuditAction::AuthLogin,
                      AuditResult::Failed, channel, source);
    failed.code = "AUTH_FAILED";
    nlohmann::json detail = nlohmann::json::object();
    typedUser(failed, name, nameValid, detail);
    setDetail(failed, detail);
    bool audited = s.audit(failed);
    if (lockedNow.pair || lockedNow.source) {
        AuditEvent lockout(AuditAction::AuthLockout, AuditResult::Denied, channel, source);
        lockout.code = "AUTH_LOCKED";
        nlohmann::json d = nlohmann::json::object();
        nlohmann::json by = nlohmann::json::array();
        if (lockedNow.pair) by.push_back("pair");
        if (lockedNow.source) by.push_back("source");
        d["by"] = by;
        typedUser(lockout, name, nameValid, d);
        setDetail(lockout, d);
        audited = s.audit(lockout) && audited;
    }
    if (attack) {  // FR-016: on record, nobody locked
        AuditEvent e(AuditAction::AuthDistributedAttack, AuditResult::Denied, AuditChannel::System,
                     "system");
        e.user = key;
        e.detail = jsonText({{"failures", attack->failures},
                             {"sources", attack->sources},
                             {"windowS", kDistributedWindowMs / 1000}});
        s.audit(e);
        s.log("distributed sign-in attack on account name " + key + ": " +
              std::to_string(attack->failures) + " failures from " +
              std::to_string(attack->sources) + " addresses within 10 minutes");
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
            a.groups = acc->groups;
            a.accountRev = acc->rev;
            a.usersRev = s.accounts.fileRev();
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

WebAccess AuthService::authorizeWeb(std::string_view token, const ClientAddress& from, Role minRole,
                                    bool refresh) {
    Impl& s = *impl_;
    WebAccess a;
    std::vector<AuditEvent> pending;
    {
        std::lock_guard<std::mutex> l(s.mu);
        const int64_t now = s.mono();
        s.refreshLocked(now, pending);
        const SessionCheck c = s.sessions.check(
            token, normalizedIp(from.ip), now, [&](const std::string& u) { return s.revOf(u); },
            SessionKind::Web);
        a.user = c.user;
        const Account* acc = c.status == SessionStatus::Ok ? s.accounts.find(c.user) : nullptr;
        if (c.status == SessionStatus::Expired) {
            a.status = AccessStatus::SessionExpired;
        } else if (!acc) {
            a.status = AccessStatus::SessionInvalid;
        } else {
            a.role = acc->role;  // read from users.json at every request (research R10)
            a.groups = acc->groups;
            a.accountRev = acc->rev;
            a.usersRev = s.accounts.fileRev();
            a.csrf = c.csrf;
            a.idleTimeoutS = c.idleLimitS;
            a.maxSessionS = c.maxLimitS;
            if (!roleAtLeast(acc->role, minRole)) {
                a.status = AccessStatus::Forbidden;
            } else {
                a.status = AccessStatus::Ok;
                if (refresh) s.sessions.touch(token, now, SessionKind::Web);
                a.idleRemainingS = refresh ? c.idleLimitS : c.idleRemainingS;
                a.lifetimeRemainingS = c.lifetimeRemainingS;
            }
        }
    }
    s.auditAll(pending);
    return a;
}

bool AuthService::touchWeb(std::string_view token) {
    Impl& s = *impl_;
    std::lock_guard<std::mutex> l(s.mu);
    return s.sessions.touch(token, s.mono(), SessionKind::Web);
}

AccessStatus AuthService::logoutWeb(std::string_view token, const ClientAddress& from) {
    Impl& s = *impl_;
    std::vector<AuditEvent> pending;
    AccessStatus status = AccessStatus::SessionExpired;
    std::string user;
    Role role = Role::Viewer;
    {
        std::lock_guard<std::mutex> l(s.mu);
        const int64_t now = s.mono();
        s.refreshLocked(now, pending);
        const SessionCheck c = s.sessions.check(
            token, normalizedIp(from.ip), now, [&](const std::string& u) { return s.revOf(u); },
            SessionKind::Web);
        const Account* acc = c.status == SessionStatus::Ok ? s.accounts.find(c.user) : nullptr;
        if (c.status == SessionStatus::Expired) {
            status = AccessStatus::SessionExpired;
        } else if (!acc) {
            status = AccessStatus::SessionInvalid;
        } else {
            s.sessions.remove(token, SessionKind::Web);
            status = AccessStatus::Ok;
            user = c.user;
            role = acc->role;
        }
    }
    s.auditAll(pending);
    if (status == AccessStatus::Ok) {
        AuditEvent e(AuditAction::AuthLogout, AuditResult::Ok, AuditChannel::Web, from.text());
        e.user = user;
        e.role = roleName(role);
        s.audit(e);
    }
    return status;
}

std::optional<SessionPrincipal> AuthService::principalOf(std::string_view token,
                                                         const ClientAddress& from,
                                                         SessionKind kind) {
    Impl& s = *impl_;
    std::vector<AuditEvent> pending;
    std::optional<SessionPrincipal> out;
    {
        std::lock_guard<std::mutex> l(s.mu);
        const int64_t now = s.mono();
        s.refreshLocked(now, pending);
        const std::string ip = kind == SessionKind::Web ? normalizedIp(from.ip) : from.ip;
        const SessionCheck c = s.sessions.check(
            token, ip, now, [&](const std::string& u) { return s.revOf(u); }, kind);
        const Account* acc = c.status == SessionStatus::Ok ? s.accounts.find(c.user) : nullptr;
        if (acc && acc->enabled) {
            SessionPrincipal p;
            p.user = acc->name;
            p.role = acc->role;
            p.groups = acc->groups;
            p.accountRev = acc->rev;
            p.usersRev = s.accounts.fileRev();
            out = std::move(p);
        }
    }
    s.auditAll(pending);
    return out;
}

std::vector<std::pair<std::string, size_t>> AuthService::reloadAccounts(
    const std::optional<KeepSession>& keep) {
    Impl& s = *impl_;
    std::vector<AuditEvent> pending;
    std::vector<std::pair<std::string, size_t>> ended;
    {
        std::lock_guard<std::mutex> l(s.mu);
        s.accounts.recheckNow();
        s.refreshLocked(s.mono(), pending, keep, &ended);
    }
    s.auditAll(pending);
    return ended;
}

std::vector<AccountSummary> AuthService::accountSummaries() {
    Impl& s = *impl_;
    std::vector<AuditEvent> pending;
    std::vector<AccountSummary> out;
    {
        std::lock_guard<std::mutex> l(s.mu);
        const int64_t now = s.mono();
        s.refreshLocked(now, pending);
        const int64_t wall = s.o.wallMs ? s.o.wallMs()
                                        : std::chrono::duration_cast<std::chrono::milliseconds>(
                                              std::chrono::system_clock::now().time_since_epoch())
                                              .count();
        for (const std::string& name : s.accounts.names()) {
            const Account* a = s.accounts.find(name);
            if (!a) continue;
            AccountSummary sum;
            sum.name = a->name;
            sum.role = a->role;
            sum.groups = a->groups;
            sum.enabled = a->enabled;
            sum.lastLoginAt = a->lastLoginAt;
            sum.createdAt = a->createdAt;
            sum.updatedAt = a->updatedAt;
            sum.sessions = s.sessions.userCount(a->name, now);
            const int64_t until = s.guard.lockedUntilMono(guardName(a->name), now);
            if (until > now) sum.lockedUntilMs = wall + (until - now);
            out.push_back(std::move(sum));
        }
    }
    s.auditAll(pending);
    return out;
}

int64_t AuthService::usersRev() {
    Impl& s = *impl_;
    std::vector<AuditEvent> pending;
    int64_t rev = 0;
    {
        std::lock_guard<std::mutex> l(s.mu);
        s.refreshLocked(s.mono(), pending);
        rev = s.accounts.fileRev();
    }
    s.auditAll(pending);
    return rev;
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

void AuthService::flushBusy(bool force) {
    Impl& s = *impl_;
    std::vector<AuditEvent> pending;
    std::string line;
    {
        std::lock_guard<std::mutex> l(s.mu);
        s.takeBusyReportLocked(s.mono(), force, pending, line);
    }
    s.auditAll(pending);
    if (!line.empty()) s.log(line);
}

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
    std::vector<AuditEvent> pending;
    {
        std::lock_guard<std::mutex> l(s.mu);
        const int64_t now = s.mono();
        AuthState st = readAuthState(path, boot, now, &why);
        s.sessions.restore(std::move(st.sessions), now);
        s.guard.restore(std::move(st.guard));
        s.checkUnlockRequest(now, pending, true);  // at start (FR-017)
    }
    s.auditAll(pending);
    if (!why.empty() && why != "missing") s.log(path + " not used: " + why);
}

}  // namespace mat
