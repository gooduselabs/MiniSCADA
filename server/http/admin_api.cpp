#include "server/http/admin_api.hpp"

#include <algorithm>
#include <chrono>
#include <cstring>
#include <ctime>
#include <deque>
#include <set>
#include <utility>

#include "civetweb.h"
#include "core/auth/password_hash.hpp"
#include "core/common/json_limits.hpp"
#include "core/common/json_text.hpp"
#include "core/crypto/hex.hpp"
#include "core/crypto/random.hpp"
#include "core/crypto/sha256.hpp"
#include "server/http/auth_gate.hpp"
#include "server/http/engineering_api_internal.hpp"

namespace mat {

namespace {

using nlohmann::json;

constexpr int kMaxBodyDepth = 8;
constexpr int64_t kAdminReadQuietMs = 60000;  // admin.read: not again within 60 s
constexpr size_t kMaxSetItems = 500;

std::string isoNow() {
    const time_t t = std::time(nullptr);
    tm tmv{};
    ::gmtime_r(&t, &tmv);
    char buf[32];
    std::strftime(buf, sizeof buf, "%Y-%m-%dT%H:%M:%SZ", &tmv);
    return buf;
}

// "2026-10-20T03:00:00Z" → UTC ms; nullopt for another text.
std::optional<int64_t> isoMs(const std::string& s) {
    tm t{};
    if (s.size() < 20 || !::strptime(s.c_str(), "%Y-%m-%dT%H:%M:%S", &t)) return std::nullopt;
    return static_cast<int64_t>(::timegm(&t)) * 1000;
}

json msOrNull(const std::string& iso) {
    const auto ms = isoMs(iso);
    return ms ? json(*ms) : json(nullptr);
}

AdminReply reply(int status, json body = json::object()) {
    AdminReply r;
    r.status = status;
    r.body = std::move(body);
    return r;
}

AdminReply error(int status, const std::string& code, json more = json::object()) {
    more["error"] = code;
    if (!more.contains("message")) {
        const char* m = gateMessage(code);
        more["message"] = *m ? m : code;
    }
    return reply(status, std::move(more));
}

bool isRev(const json& j) {
    return (j.is_number_integer() || j.is_number_unsigned()) && j.get<int64_t>() >= 0;
}

const char* problemReason(PasswordProblem p) {
    switch (p) {
        case PasswordProblem::None:
            return "";
        case PasswordProblem::NotUtf8:
            return "COMMON";  // not UTF-8: the nearest of the four codes the page knows
        case PasswordProblem::TooShort:
            return "TOO_SHORT";
        case PasswordProblem::TooLong:
            return "TOO_LONG";
        case PasswordProblem::SameAsName:
            return "CONTAINS_NAME";
    }
    return "invalid";
}

const char* problemMessage(PasswordProblem p) {
    switch (p) {
        case PasswordProblem::TooShort:
            return "Mật khẩu cần ít nhất 15 ký tự.";
        case PasswordProblem::TooLong:
            return "Mật khẩu tối đa 128 ký tự.";
        case PasswordProblem::SameAsName:
            return "Mật khẩu không được trùng tên tài khoản.";
        case PasswordProblem::NotUtf8:
            return "Mật khẩu không phải văn bản UTF-8.";
        case PasswordProblem::None:
            break;
    }
    return "Mật khẩu không hợp lệ.";
}

// 20 characters of letters, digits and symbols (no look-alikes), at least one of each kind.
std::string randomPassword20() {
    static const char kLower[] = "abcdefghijkmnopqrstuvwxyz";
    static const char kUpper[] = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    static const char kDigit[] = "23456789";
    static const char kSym[] = "#%+=@!?*";
    static const std::string all = std::string(kLower) + kUpper + kDigit + kSym;
    const std::string bytes = randomBytes(24);
    std::string out;
    out += kUpper[static_cast<unsigned char>(bytes[0]) % (sizeof kUpper - 1)];
    out += kLower[static_cast<unsigned char>(bytes[1]) % (sizeof kLower - 1)];
    out += kDigit[static_cast<unsigned char>(bytes[2]) % (sizeof kDigit - 1)];
    out += kSym[static_cast<unsigned char>(bytes[3]) % (sizeof kSym - 1)];
    for (size_t i = 4; i < 20; ++i) out += all[static_cast<unsigned char>(bytes[i]) % all.size()];
    return out;
}

// The prefix after "/api/v1/admin/<what>/" up to the next '/', and the rest.
bool splitTail(const std::string& path, const std::string& prefix, std::string& id,
               std::string& rest) {
    if (path.rfind(prefix, 0) != 0) return false;
    const std::string tail = path.substr(prefix.size());
    const size_t slash = tail.find('/');
    id = slash == std::string::npos ? tail : tail.substr(0, slash);
    rest = slash == std::string::npos ? "" : tail.substr(slash);
    return !id.empty();
}

const char* pageTitle(const std::string& p) {
    if (p == "alarms") return "Alarm";
    if (p == "history") return "Lịch sử";
    if (p == "reports") return "Báo cáo";
    if (p == "watch") return "Bảng theo dõi";
    return "";
}

json strings(const std::vector<std::string>& v) { return json(v); }

}  // namespace

struct AdminApi::Impl {
    AdminBackend b;
    std::function<int64_t()> mono;
    std::mutex mu;  // the two maps below
    std::map<std::string, std::deque<int64_t>> changes;
    std::map<std::string, int64_t> lastRead;
    std::mutex hashMu;  // one password hash of the admin API at a time

    std::string now() { return b.nowIso ? b.nowIso() : isoNow(); }

    AuditEvent event(AuditAction a, AuditResult r, const AdminCaller& who) {
        AuditEvent e(a, r, who.viaCookie ? AuditChannel::Web : AuditChannel::Https,
                     who.from.text());
        if (!who.user.empty()) {
            e.user = who.user;
            e.role = roleName(who.role);
        }
        return e;
    }

    // Commits the record; false when it cannot.
    bool audit(const AuditEvent& e) {
        if (!b.audit) return false;
        try {
            b.audit(e);
            return true;
        } catch (const std::exception&) {
            return false;
        }
    }

    // A refusal, on record (best effort: the answer does not depend on it).
    AdminReply deny(AuditAction a, const AdminCaller& who, const std::string& target, int status,
                    const std::string& code, json more = json::object()) {
        AuditEvent e = event(a, AuditResult::Denied, who);
        if (!target.empty()) e.target = target;
        e.code = code;
        audit(e);
        return error(status, code, std::move(more));
    }

    bool rateOk(const AdminCaller& who) {
        const int64_t t = mono();
        std::lock_guard<std::mutex> l(mu);
        auto& q = changes[who.sessionKey.empty() ? who.user : who.sessionKey];
        while (!q.empty() && t - q.front() >= 60000) q.pop_front();
        if (static_cast<int>(q.size()) >= kAdminChangesPerMinute) return false;
        q.push_back(t);
        if (changes.size() > 256)
            for (auto it = changes.begin(); it != changes.end();)
                it = it->second.empty() || t - it->second.back() >= 60000 ? changes.erase(it)
                                                                          : std::next(it);
        return true;
    }

    std::string hashOf(const std::string& pw) {
        std::lock_guard<std::mutex> l(hashMu);
        return b.hash ? b.hash(pw) : hashPassword(pw);
    }

    // The re-entered password of the caller: nullopt when right, else the refusal.
    std::optional<AdminReply> reauth(const json& body, const AdminCaller& who, AuditAction action,
                                     const std::string& target, const char* field = "reauth") {
        if (!body.contains(field) || !body[field].is_string() ||
            body[field].get<std::string>().empty())
            return deny(action, who, target, 403, "REAUTH_REQUIRED");
        std::string pw = body[field].get<std::string>();
        if (pw.size() > kPasswordMaxBytes) {
            secureZero(pw);
            return deny(action, who, target, 403, "REAUTH_REQUIRED");
        }
        const LoginResult r = b.auth->reauthenticate(who.user, pw, who.from);  // wipes pw
        switch (r.status) {
            case LoginStatus::Ok:
                return std::nullopt;
            case LoginStatus::Locked:
                return deny(action, who, target, 429, "AUTH_LOCKED",
                            {{"retryAfterS", r.retryAfterS}});
            case LoginStatus::Busy:
                return error(429, "LOGIN_BUSY");
            case LoginStatus::AuditUnavailable:
                return error(503, "AUDIT_UNAVAILABLE");
            case LoginStatus::Error:
                return error(500, "INTERNAL_ERROR");
            case LoginStatus::Failed:
                break;
        }
        return deny(action, who, target, 403, "REAUTH_REQUIRED");
    }

    // password / generate of a request: the new password, or the refusal.
    std::optional<AdminReply> newPassword(const json& body, const std::string& name,
                                          const AdminCaller& who, AuditAction action,
                                          std::string& pw, bool& generated) {
        const bool hasPw = body.contains("password");
        const bool gen = body.contains("generate");
        if (hasPw == gen ||
            (gen && !(body["generate"].is_boolean() && body["generate"].get<bool>())) ||
            (hasPw && !body["password"].is_string()))
            return error(400, "BAD_REQUEST",
                         {{"message", "Cần đúng một trong password hoặc generate: true."}});
        generated = gen;
        pw = gen ? (b.generatePassword ? b.generatePassword() : randomPassword20())
                 : body["password"].get<std::string>();
        const PasswordProblem p = checkNewPassword(pw, name);
        if (p != PasswordProblem::None) {
            secureZero(pw);
            return deny(action, who, name, 400, "WEAK_PASSWORD",
                        {{"reason", problemReason(p)}, {"message", problemMessage(p)}});
        }
        return std::nullopt;
    }

    // Runs `edit` in a transaction of the store. A failed write after the audit record: logged
    // in the audit as failed, 503 STORE_IO.
    template <class F>
    std::optional<AdminReply> transact(F&& edit, AuditAction action, const AdminCaller& who,
                                       const std::string& target) {
        std::string err;
        std::optional<AdminReply> refused;
        const TxnStatus s = b.store->transact(
            [&](AuthTxn& t) {
                refused = edit(t);
                return !refused.has_value();
            },
            err);
        if (s == TxnStatus::Aborted) return refused;
        if (s == TxnStatus::Failed) {
            AuditEvent e = event(action, AuditResult::Failed, who);
            if (!target.empty()) e.target = target;
            e.code = "STORE_IO";
            e.detail = jsonText({{"error", err}});
            audit(e);
            return error(503, "STORE_IO", {{"message", "Không ghi được kho tài khoản: " + err}});
        }
        return std::nullopt;
    }

    // ---- page routes

    AdminReply webAccess(const AdminCaller& who, bool anonymousOk) {
        if (who.signedIn()) {
            Principal p;
            p.user = who.user;
            p.role = who.role;
            p.groups = who.groups;
            return reply(200, effectiveAccessJson(
                                  b.access->forPrincipal(p, who.accountRev, who.usersRev)->access));
        }
        if (b.viewerLogin == "off" && anonymousOk)
            return reply(200, effectiveAccessJson(b.access->anonymous()->access));
        return error(401, "AUTH_REQUIRED");
    }

    AdminReply webPassword(const json& body, const AdminCaller& who) {
        if (!who.signedIn()) return error(401, "AUTH_REQUIRED");
        if (!body.contains("old") || !body["old"].is_string() || !body.contains("new") ||
            !body["new"].is_string())
            return error(400, "BAD_REQUEST");
        if (auto refused = reauth(body, who, AuditAction::AccountPassword, who.user, "old"))
            return *refused;
        std::string pw = body["new"].get<std::string>();
        const PasswordProblem p = checkNewPassword(pw, who.user);
        if (p != PasswordProblem::None) {
            secureZero(pw);
            return deny(AuditAction::AccountPassword, who, who.user, 400, "WEAK_PASSWORD",
                        {{"reason", problemReason(p)}, {"message", problemMessage(p)}});
        }
        const std::string phc = hashOf(pw);
        secureZero(pw);
        const std::string nowIso = now();
        auto refused = transact(
            [&](AuthTxn& t) -> std::optional<AdminReply> {
                if (t.before.users.status != UsersStatus::Ok) return error(503, "STORE_INVALID");
                if (setAccountPassword(t.users, who.user, phc, nowIso) != AccountEditError::None)
                    return error(404, "NOT_FOUND");
                AuditEvent e = event(AuditAction::AccountPassword, AuditResult::Ok, who);
                e.target = who.user;
                e.detail = jsonText({{"self", true}});
                if (!audit(e)) return error(503, "AUDIT_UNAVAILABLE");
                t.usersChanged = true;
                return std::nullopt;
            },
            AuditAction::AccountPassword, who, who.user);
        if (refused) return *refused;
        std::optional<KeepSession> keep;
        if (who.viaCookie && !who.webToken.empty())
            keep = KeepSession{who.user, who.webToken, SessionKind::Web};
        b.auth->reloadAccounts(keep);
        return reply(204);
    }

    // ---- users

    AdminReply usersList(const AdminCaller& who) {
        const std::vector<AccountSummary> list = b.auth->accountSummaries();
        const AuthFiles f = b.store->read();
        json users = json::array();
        for (const AccountSummary& a : list) {
            // feature 023: the email address of the account (alarm email to its groups)
            const Account* acc =
                f.users.status == UsersStatus::Ok ? f.users.file.find(a.name) : nullptr;
            users.push_back(
                {{"name", a.name},
                 {"email", acc && !acc->email.empty() ? json(acc->email) : json(nullptr)},
                 {"role", roleName(a.role)},
                 {"groups", a.groups},
                 {"enabled", a.enabled},
                 {"locked", a.lockedUntilMs ? json({{"until", *a.lockedUntilMs}}) : json(nullptr)},
                 {"lastLoginAt", a.lastLoginAt ? json(*a.lastLoginAt) : json(nullptr)},
                 {"createdAt", msOrNull(a.createdAt)},
                 {"updatedAt", msOrNull(a.updatedAt)},
                 {"sessions", a.sessions}});
        }
        bool write = false;
        {
            const int64_t t = mono();
            std::lock_guard<std::mutex> l(mu);
            const std::string key = who.sessionKey.empty() ? who.user : who.sessionKey;
            const auto it = lastRead.find(key);
            write = it == lastRead.end() || t - it->second >= kAdminReadQuietMs;
            if (write) lastRead[key] = t;
            if (lastRead.size() > 256) lastRead.clear();
        }
        if (write) {
            AuditEvent e = event(AuditAction::AdminRead, AuditResult::Ok, who);
            e.target = "/api/v1/admin/users";
            audit(e);
        }
        json body = {{"rev", f.users.status == UsersStatus::Ok ? f.users.file.rev : 0},
                     {"users", users}};
        if (f.users.status == UsersStatus::Error) body["storeState"] = "invalid";
        return reply(200, std::move(body));
    }

    // groups of a request: an array of distinct group ids that exist in `access`.
    std::optional<AdminReply> groupsOf(const json& v, const AccessFile& access,
                                       std::vector<std::string>& out) {
        if (!v.is_array() || v.size() > kMaxAccountGroups)
            return error(400, "BAD_REQUEST", {{"message", "groups: tối đa 16 mã nhóm."}});
        std::set<std::string> seen;
        for (const auto& g : v) {
            if (!g.is_string() || !seen.insert(g.get<std::string>()).second)
                return error(400, "BAD_REQUEST",
                             {{"message", "groups có phần tử sai hoặc trùng."}});
            if (!access.group(g.get<std::string>()))
                return error(400, "NOT_FOUND",
                             {{"group", g.get<std::string>()},
                              {"message", "Không có nhóm " + g.get<std::string>() + "."}});
            out.push_back(g.get<std::string>());
        }
        return std::nullopt;
    }

    AdminReply usersCreate(const json& body, const AdminCaller& who) {
        const AuditAction act = AuditAction::AccountCreate;
        if (!body.contains("rev") || !isRev(body["rev"]) || !body.contains("name") ||
            !body["name"].is_string() || !body.contains("role") || !body["role"].is_string())
            return error(400, "BAD_REQUEST");
        const std::string name = body["name"].get<std::string>();
        if (!validAccountName(name))
            return deny(act, who, "", 400, "BAD_REQUEST",
                        {{"message",
                          "Tên tài khoản 3–32 ký tự a-z, 0-9, '.', '_', '-', bắt "
                          "đầu bằng chữ thường."}});
        const auto role = parseRole(body["role"].get<std::string>());
        if (!role) return error(400, "BAD_REQUEST", {{"message", "role không hợp lệ."}});
        if (body.contains("email") && !body["email"].is_null() &&
            !(body["email"].is_string() && (body["email"].get<std::string>().empty() ||
                                            validAccountEmail(body["email"].get<std::string>()))))
            return error(400, "BAD_REQUEST", {{"message", "email không phải địa chỉ hợp lệ."}});
        std::string pw;
        bool generated = false;
        if (auto refused = newPassword(body, name, who, act, pw, generated)) return *refused;
        const std::string phc = hashOf(pw);
        if (!generated) secureZero(pw);
        const int64_t rev = body["rev"].get<int64_t>();
        const std::string nowIso = now();
        int64_t newRev = 0;
        auto refused = transact(
            [&](AuthTxn& t) -> std::optional<AdminReply> {
                if (t.before.users.status == UsersStatus::Error) return error(503, "STORE_INVALID");
                if (t.before.users.file.rev != rev)
                    return deny(act, who, name, 409, "CONFLICT",
                                {{"rev", t.before.users.file.rev}});
                std::vector<std::string> groups;
                if (body.contains("groups")) {
                    if (t.before.accessState == AccessFileState::Invalid)
                        return error(503, "STORE_INVALID");
                    if (auto bad = groupsOf(body["groups"], t.access, groups)) return bad;
                }
                const AccountEditError e = addAccount(t.users, name, *role, phc, nowIso);
                if (e == AccountEditError::Exists) return deny(act, who, name, 409, "EXISTS");
                if (e == AccountEditError::TooMany)
                    return deny(act, who, name, 400, "BAD_REQUEST",
                                {{"message", "Đã đủ 200 tài khoản."}});
                if (e != AccountEditError::None) return error(400, "BAD_REQUEST");
                t.users.find(name)->groups = groups;
                if (body.contains("email") && body["email"].is_string())
                    t.users.find(name)->email = body["email"].get<std::string>();
                AuditEvent ev = event(act, AuditResult::Ok, who);
                ev.target = name;
                ev.detail = jsonText(
                    {{"after", {{"role", roleName(*role)}, {"groups", groups}, {"enabled", true}}},
                     {"generated", generated}});
                if (!audit(ev)) return error(503, "AUDIT_UNAVAILABLE");
                t.usersChanged = true;
                newRev = t.before.users.file.rev + 1;
                return std::nullopt;
            },
            act, who, name);
        if (refused) {
            secureZero(pw);
            return *refused;
        }
        b.auth->reloadAccounts();
        json out = {{"rev", newRev}};
        if (generated) out["password"] = pw;
        secureZero(pw);
        return reply(201, std::move(out));
    }

    AdminReply usersUpdate(const std::string& name, const json& body, const AdminCaller& who) {
        if (!body.contains("rev") || !isRev(body["rev"])) return error(400, "BAD_REQUEST");
        for (auto it = body.begin(); it != body.end(); ++it)
            if (it.key() != "rev" && it.key() != "role" && it.key() != "groups" &&
                it.key() != "enabled" && it.key() != "unlock" && it.key() != "reauth" &&
                it.key() != "email")
                return error(400, "BAD_REQUEST", {{"message", "Khóa lạ: " + it.key()}});
        std::optional<Role> role;
        if (body.contains("role")) {
            if (!body["role"].is_string()) return error(400, "BAD_REQUEST");
            role = parseRole(body["role"].get<std::string>());
            if (!role) return error(400, "BAD_REQUEST", {{"message", "role không hợp lệ."}});
        }
        if (body.contains("enabled") && !body["enabled"].is_boolean())
            return error(400, "BAD_REQUEST");
        if (body.contains("unlock") && !(body["unlock"].is_boolean() && body["unlock"].get<bool>()))
            return error(400, "BAD_REQUEST");
        std::optional<std::string> email;  // feature 023: "" or null removes it
        if (body.contains("email")) {
            const json& v = body["email"];
            if (v.is_null() || (v.is_string() && v.get<std::string>().empty()))
                email = "";
            else if (v.is_string() && validAccountEmail(v.get<std::string>()))
                email = v.get<std::string>();
            else
                return error(400, "BAD_REQUEST", {{"message", "email không phải địa chỉ hợp lệ."}});
        }
        if (!role && !body.contains("groups") && !body.contains("enabled") &&
            !body.contains("unlock") && !email)
            return error(400, "BAD_REQUEST", {{"message", "Không có gì để đổi."}});
        const int64_t rev = body["rev"].get<int64_t>();
        // The account as it is now decides whether the password is asked again (demotion or
        // disabling); the transaction checks that nothing changed since (rev).
        const AuthFiles now0 = b.store->read();
        const Account* cur =
            now0.users.status == UsersStatus::Ok ? now0.users.file.find(name) : nullptr;
        if (!cur) return deny(AuditAction::AccountRole, who, name, 404, "NOT_FOUND");
        const bool demote = role && static_cast<int>(*role) < static_cast<int>(cur->role);
        const bool disable =
            body.contains("enabled") && !body["enabled"].get<bool>() && cur->enabled;
        if (demote || disable)
            if (auto refused =
                    reauth(body, who,
                           disable ? AuditAction::AccountDisable : AuditAction::AccountRole, name))
                return *refused;
        const std::string nowIso = now();
        int64_t newRev = 0;
        bool selfChanged = false;
        auto refused = transact(
            [&](AuthTxn& t) -> std::optional<AdminReply> {
                if (t.before.users.status != UsersStatus::Ok) return error(503, "STORE_INVALID");
                if (t.before.users.file.rev != rev)
                    return deny(AuditAction::AccountRole, who, name, 409, "CONFLICT",
                                {{"rev", t.before.users.file.rev}});
                const Account* before = t.before.users.file.find(name);
                if (!before) return deny(AuditAction::AccountRole, who, name, 404, "NOT_FOUND");
                std::vector<AuditEvent> rows;
                const auto row = [&](AuditAction a, json detail) {
                    AuditEvent e = event(a, AuditResult::Ok, who);
                    e.target = name;
                    e.detail = jsonText(detail);
                    rows.push_back(std::move(e));
                };
                if (role && *role != before->role) {
                    if (setAccountRole(t.users, name, *role, nowIso) ==
                        AccountEditError::LastAdministrator)
                        return deny(AuditAction::AccountRole, who, name, 409, "LAST_ADMIN");
                    row(AuditAction::AccountRole, {{"before", {{"role", roleName(before->role)}}},
                                                   {"after", {{"role", roleName(*role)}}}});
                }
                if (body.contains("groups")) {
                    if (t.before.accessState == AccessFileState::Invalid)
                        return error(503, "STORE_INVALID");
                    std::vector<std::string> groups;
                    if (auto bad = groupsOf(body["groups"], t.access, groups)) return bad;
                    if (groups != before->groups) {
                        setAccountGroups(t.users, name, groups, nowIso);
                        row(AuditAction::AccountGroups, {{"before", {{"groups", before->groups}}},
                                                         {"after", {{"groups", groups}}}});
                    }
                }
                if (body.contains("enabled") && body["enabled"].get<bool>() != before->enabled) {
                    const bool en = body["enabled"].get<bool>();
                    if (setAccountEnabled(t.users, name, en, nowIso) ==
                        AccountEditError::LastAdministrator)
                        return deny(AuditAction::AccountDisable, who, name, 409, "LAST_ADMIN");
                    row(en ? AuditAction::AccountEnable : AuditAction::AccountDisable,
                        {{"before", {{"enabled", before->enabled}}}, {"after", {{"enabled", en}}}});
                }
                if (body.contains("unlock")) {
                    unlockAccount(t.users, name, nowIso);
                    row(AuditAction::AccountUnlock, {{"scope", "account"}});
                }
                if (email && *email != before->email) {  // rev kept: no sign-out (feature 023)
                    Account* acc = t.users.find(name);
                    acc->email = *email;
                    acc->updatedAt = nowIso;
                    row(AuditAction::AccountEmail,
                        {{"before",
                          {{"email", before->email.empty() ? json(nullptr) : json(before->email)}}},
                         {"after", {{"email", email->empty() ? json(nullptr) : json(*email)}}}});
                }
                if (rows.empty()) return std::nullopt;  // nothing changes: nothing written
                for (const auto& e : rows)
                    if (!audit(e)) return error(503, "AUDIT_UNAVAILABLE");
                t.usersChanged = true;
                newRev = t.before.users.file.rev + 1;
                selfChanged = name == who.user && t.users.find(name)->rev != before->rev;
                return std::nullopt;
            },
            AuditAction::AccountRole, who, name);
        if (refused) return *refused;
        if (newRev == 0) return reply(200, {{"rev", rev}});
        b.auth->reloadAccounts();
        json out = {{"rev", newRev}};
        if (selfChanged) out["signedOut"] = true;
        return reply(200, std::move(out));
    }

    AdminReply usersPassword(const std::string& name, const json& body, const AdminCaller& who) {
        const AuditAction act = AuditAction::AccountPassword;
        if (!body.contains("rev") || !isRev(body["rev"])) return error(400, "BAD_REQUEST");
        if (auto refused = reauth(body, who, act, name)) return *refused;
        std::string pw;
        bool generated = false;
        if (auto refused = newPassword(body, name, who, act, pw, generated)) return *refused;
        const std::string phc = hashOf(pw);
        if (!generated) secureZero(pw);
        const int64_t rev = body["rev"].get<int64_t>();
        const std::string nowIso = now();
        int64_t newRev = 0;
        auto refused = transact(
            [&](AuthTxn& t) -> std::optional<AdminReply> {
                if (t.before.users.status != UsersStatus::Ok) return error(503, "STORE_INVALID");
                if (t.before.users.file.rev != rev)
                    return deny(act, who, name, 409, "CONFLICT",
                                {{"rev", t.before.users.file.rev}});
                if (setAccountPassword(t.users, name, phc, nowIso) != AccountEditError::None)
                    return deny(act, who, name, 404, "NOT_FOUND");
                AuditEvent e = event(act, AuditResult::Ok, who);
                e.target = name;
                e.detail = jsonText({{"generated", generated}});
                if (!audit(e)) return error(503, "AUDIT_UNAVAILABLE");
                t.usersChanged = true;
                newRev = t.before.users.file.rev + 1;
                return std::nullopt;
            },
            act, who, name);
        if (refused) {
            secureZero(pw);
            return *refused;
        }
        b.auth->reloadAccounts();
        json out = {{"rev", newRev}};
        if (generated) out["password"] = pw;
        if (name == who.user) out["signedOut"] = true;
        secureZero(pw);
        return reply(200, std::move(out));
    }

    AdminReply usersDelete(const std::string& name, const json& body, const AdminCaller& who) {
        const AuditAction act = AuditAction::AccountDelete;
        if (!body.contains("rev") || !isRev(body["rev"])) return error(400, "BAD_REQUEST");
        if (auto refused = reauth(body, who, act, name)) return *refused;
        const int64_t rev = body["rev"].get<int64_t>();
        int64_t newRev = 0, accessRev = 0;
        auto refused = transact(
            [&](AuthTxn& t) -> std::optional<AdminReply> {
                if (t.before.users.status != UsersStatus::Ok) return error(503, "STORE_INVALID");
                if (t.before.accessState == AccessFileState::Invalid)
                    return error(503, "STORE_INVALID");
                if (t.before.users.file.rev != rev)
                    return deny(act, who, name, 409, "CONFLICT",
                                {{"rev", t.before.users.file.rev}});
                const Account* before = t.before.users.file.find(name);
                if (!before) return deny(act, who, name, 404, "NOT_FOUND");
                if (removeAccount(t.users, name) == AccountEditError::LastAdministrator)
                    return deny(act, who, name, 409, "LAST_ADMIN");
                const std::string grantee = "user:" + name;
                size_t fromRules = 0;
                for (auto& r : t.access.rules) {
                    const auto it = std::find(r.grantees.begin(), r.grantees.end(), grantee);
                    if (it == r.grantees.end()) continue;
                    r.grantees.erase(it);
                    ++fromRules;
                }
                AuditEvent e = event(act, AuditResult::Ok, who);
                e.target = name;
                e.detail = jsonText(
                    {{"before", {{"role", roleName(before->role)}, {"groups", before->groups}}},
                     {"removedFromRules", fromRules}});
                if (!audit(e)) return error(503, "AUDIT_UNAVAILABLE");
                t.usersChanged = true;
                newRev = t.before.users.file.rev + 1;
                accessRev = t.before.access.rev;
                if (fromRules > 0) {
                    t.accessChanged = true;
                    accessRev += 1;
                }
                return std::nullopt;
            },
            act, who, name);
        if (refused) return *refused;
        b.auth->reloadAccounts();
        b.access->reloadNow();
        json out = {{"rev", newRev}, {"accessRev", accessRev}};
        if (name == who.user) out["signedOut"] = true;
        return reply(200, std::move(out));
    }

    // ---- groups

    AdminReply groupsList() {
        const AuthFiles f = b.store->read();
        if (f.accessState == AccessFileState::Invalid)
            return error(503, "STORE_INVALID", {{"detail", f.accessError}});
        json groups = json::array();
        for (const AccessGroup& g : f.access.groups) {
            json members = json::array();
            if (f.users.status == UsersStatus::Ok)
                for (const Account& a : f.users.file.users)
                    if (std::find(a.groups.begin(), a.groups.end(), g.id) != a.groups.end())
                        members.push_back(a.name);
            size_t rules = 0;
            for (const AccessRule& r : f.access.rules)
                if (std::find(r.grantees.begin(), r.grantees.end(), "group:" + g.id) !=
                    r.grantees.end())
                    ++rules;
            groups.push_back(
                {{"id", g.id}, {"name", g.name}, {"members", members}, {"rules", rules}});
        }
        return reply(200, {{"rev", f.access.rev}, {"groups", groups}});
    }

    // An edit of access.json that needs the request's rev and a usable file.
    template <class F>
    AdminReply accessEdit(const json& body, AuditAction act, const AdminCaller& who,
                          const std::string& target, int okStatus, F&& edit) {
        if (!body.contains("rev") || !isRev(body["rev"])) return error(400, "BAD_REQUEST");
        const int64_t rev = body["rev"].get<int64_t>();
        int64_t newRev = 0;
        json extra = json::object();
        auto refused = transact(
            [&](AuthTxn& t) -> std::optional<AdminReply> {
                if (t.before.accessState == AccessFileState::Invalid)
                    return error(503, "STORE_INVALID");
                if (t.before.access.rev != rev)
                    return deny(act, who, target, 409, "CONFLICT", {{"rev", t.before.access.rev}});
                std::vector<AuditEvent> rows;
                if (auto bad = edit(t, rows, extra)) return bad;
                if (rows.empty()) return std::nullopt;
                for (const auto& e : rows)
                    if (!audit(e)) return error(503, "AUDIT_UNAVAILABLE");
                t.accessChanged = true;
                newRev = t.before.access.rev + 1;
                return std::nullopt;
            },
            act, who, target);
        if (refused) return *refused;
        b.access->reloadNow();
        json out = extra;
        out["rev"] = newRev == 0 ? rev : newRev;
        return reply(okStatus, std::move(out));
    }

    AdminReply groupsCreate(const json& body, const AdminCaller& who) {
        if (!body.contains("id") || !body["id"].is_string() || !body.contains("name") ||
            !body["name"].is_string())
            return error(400, "BAD_REQUEST");
        const std::string id = body["id"].get<std::string>(),
                          name = body["name"].get<std::string>();
        if (!validGroupId(id))
            return error(400, "BAD_REQUEST",
                         {{"message", "Mã nhóm 2–32 ký tự a-z, 0-9, '-', bắt đầu bằng chữ."}});
        if (!validGroupName(name))
            return error(400, "BAD_REQUEST", {{"message", "Tên nhóm 1–64 ký tự."}});
        return accessEdit(
            body, AuditAction::GroupCreate, who, id, 201,
            [&](AuthTxn& t, std::vector<AuditEvent>& rows, json&) -> std::optional<AdminReply> {
                if (t.access.group(id))
                    return deny(AuditAction::GroupCreate, who, id, 409, "EXISTS");
                if (t.access.groups.size() >= kMaxAccessGroups)
                    return error(400, "BAD_REQUEST", {{"message", "Đã đủ 50 nhóm."}});
                t.access.groups.push_back({id, name});
                AuditEvent e = event(AuditAction::GroupCreate, AuditResult::Ok, who);
                e.target = id;
                e.detail = jsonText({{"after", {{"name", name}}}});
                rows.push_back(std::move(e));
                return std::nullopt;
            });
    }

    AdminReply groupsRename(const std::string& id, const json& body, const AdminCaller& who) {
        if (!body.contains("name") || !body["name"].is_string()) return error(400, "BAD_REQUEST");
        const std::string name = body["name"].get<std::string>();
        if (!validGroupName(name))
            return error(400, "BAD_REQUEST", {{"message", "Tên nhóm 1–64 ký tự."}});
        return accessEdit(
            body, AuditAction::GroupRename, who, id, 200,
            [&](AuthTxn& t, std::vector<AuditEvent>& rows, json&) -> std::optional<AdminReply> {
                auto g = std::find_if(t.access.groups.begin(), t.access.groups.end(),
                                      [&](const AccessGroup& x) { return x.id == id; });
                if (g == t.access.groups.end())
                    return deny(AuditAction::GroupRename, who, id, 404, "NOT_FOUND");
                if (g->name == name) return std::nullopt;
                AuditEvent e = event(AuditAction::GroupRename, AuditResult::Ok, who);
                e.target = id;
                e.detail = jsonText({{"before", {{"name", g->name}}}, {"after", {{"name", name}}}});
                g->name = name;
                rows.push_back(std::move(e));
                return std::nullopt;
            });
    }

    AdminReply groupsDelete(const std::string& id, const json& body, const AdminCaller& who) {
        if (!body.contains("rev") || !isRev(body["rev"])) return error(400, "BAD_REQUEST");
        if (auto refused = reauth(body, who, AuditAction::GroupDelete, id)) return *refused;
        return accessEdit(
            body, AuditAction::GroupDelete, who, id, 200,
            [&](AuthTxn& t, std::vector<AuditEvent>& rows, json&) -> std::optional<AdminReply> {
                const AccessGroup* g = t.access.group(id);
                if (!g) return deny(AuditAction::GroupDelete, who, id, 404, "NOT_FOUND");
                json users = json::array(), rules = json::array();
                for (const Account& a : t.users.users)
                    if (std::find(a.groups.begin(), a.groups.end(), id) != a.groups.end())
                        users.push_back(a.name);
                for (const AccessRule& r : t.access.rules)
                    if (std::find(r.grantees.begin(), r.grantees.end(), "group:" + id) !=
                        r.grantees.end())
                        rules.push_back(
                            {{"resource", r.resource}, {"level", accessLevelName(r.level)}});
                if (!users.empty() || !rules.empty())
                    return deny(AuditAction::GroupDelete, who, id, 409, "IN_USE",
                                {{"usedBy", {{"users", users}, {"rules", rules}}}});
                AuditEvent e = event(AuditAction::GroupDelete, AuditResult::Ok, who);
                e.target = id;
                e.detail = jsonText({{"before", {{"name", g->name}}}});
                t.access.groups.erase(
                    std::remove_if(t.access.groups.begin(), t.access.groups.end(),
                                   [&](const AccessGroup& x) { return x.id == id; }),
                    t.access.groups.end());
                rows.push_back(std::move(e));
                return std::nullopt;
            });
    }

    // ---- rules

    json resourcesJson() {
        const ResourceCatalog& c = b.access->catalog();
        json out = json::array();
        for (const CatalogScreen& s : c.screens) {
            out.push_back({{"id", "screen:" + s.id},
                           {"kind", s.popup ? "popup" : "screen"},
                           {"title", s.title.empty() ? s.id : s.title},
                           {"levels", {"view"}},
                           {"defaults", {{"view", roleName(s.view)}}}});
            for (const CatalogItem& i : s.items) {
                json r = {{"id", "item:" + s.id + "/" + i.id},
                          {"kind", "item"},
                          {"title", i.title.empty() ? i.id : i.title},
                          {"screen", s.id},
                          {"widget", i.widget},
                          {"levels", i.operable ? json({"view", "operate"}) : json({"view"})},
                          {"defaults", {{"view", roleName(i.view)}}}};
                if (i.operable) r["defaults"]["operate"] = roleName(i.operate);
                out.push_back(std::move(r));
            }
        }
        for (const std::string& p : systemPages())
            out.push_back({{"id", "page:" + p},
                           {"kind", "page"},
                           {"title", pageTitle(p)},
                           {"levels", {"view"}},
                           {"defaults", {{"view", p == "watch" ? "operator" : "viewer"}}}});
        for (const CatalogTagSet& g : c.historyGroups)
            out.push_back({{"id", "history:" + g.id},
                           {"kind", "history"},
                           {"title", g.title.empty() ? g.id : g.title},
                           {"levels", {"view"}},
                           {"defaults", {{"view", "viewer"}}}});
        for (const CatalogTagSet& r : c.reports)
            out.push_back({{"id", "report:" + r.id},
                           {"kind", "report"},
                           {"title", r.title.empty() ? r.id : r.title},
                           {"levels", {"view"}},
                           {"defaults", {{"view", "viewer"}}}});
        return out;
    }

    static json rulesJson(const AccessFile& f) {
        json rules = json::array();
        for (const AccessRule& r : f.rules)
            rules.push_back({{"resource", r.resource},
                             {"level", accessLevelName(r.level)},
                             {"grantees", r.grantees}});
        return rules;
    }

    AdminReply accessGet() {
        const AuthFiles f = b.store->read();
        json orphans = json::array();
        if (f.accessState != AccessFileState::Invalid)
            for (const ResourceLevel& o : orphanRules(b.access->catalog(), f.access))
                orphans.push_back({{"resource", o.resource}, {"level", accessLevelName(o.level)}});
        json body = {{"rev", f.access.rev},
                     {"viewerLogin", b.viewerLogin},
                     {"storeState", f.accessState == AccessFileState::Invalid ? "invalid" : "ok"},
                     {"resources", resourcesJson()},
                     {"rules", rulesJson(f.access)},
                     {"orphans", orphans}};
        if (f.accessState == AccessFileState::Invalid) body["storeError"] = f.accessError;
        return reply(200, std::move(body));
    }

    AdminReply accessSet(const json& body, const AdminCaller& who) {
        if (!body.contains("set") || !body["set"].is_array() || body["set"].empty() ||
            body["set"].size() > kMaxSetItems)
            return error(400, "BAD_REQUEST", {{"message", "set: 1 đến 500 phần tử."}});
        struct Item {
            std::string resource;
            AccessLevel level;
            std::optional<std::vector<std::string>> grantees;
        };
        std::vector<Item> items;
        std::set<std::pair<std::string, int>> seen;
        const ResourceCatalog& catalog = b.access->catalog();
        for (const auto& s : body["set"]) {
            if (!s.is_object() || !s.contains("resource") || !s["resource"].is_string() ||
                !s.contains("level") || !s["level"].is_string() || !s.contains("grantees"))
                return error(400, "BAD_REQUEST");
            Item it;
            it.resource = s["resource"].get<std::string>();
            const auto level = parseAccessLevel(s["level"].get<std::string>());
            if (!level)
                return error(400, "BAD_REQUEST", {{"message", "level: view hoặc operate."}});
            it.level = *level;
            if (it.resource.rfind("page:admin", 0) == 0)
                return deny(AuditAction::AccessRule, who, it.resource, 400, "BAD_REQUEST",
                            {{"message", "Trang Quản trị chỉ dành cho administrator."}});
            if (!catalog.hasResource(it.resource, it.level))
                return error(400, "NOT_FOUND",
                             {{"resource", it.resource},
                              {"level", accessLevelName(it.level)},
                              {"message", "Project đang chạy không có tài nguyên này ở mức này."}});
            if (!seen.emplace(it.resource, static_cast<int>(it.level)).second)
                return error(400, "BAD_REQUEST", {{"message", "Phần tử trùng: " + it.resource}});
            if (!s["grantees"].is_null()) {
                if (!s["grantees"].is_array() || s["grantees"].size() > kMaxRuleGrantees)
                    return error(400, "BAD_REQUEST", {{"message", "grantees: tối đa 64."}});
                std::vector<std::string> g;
                std::set<std::string> dup;
                for (const auto& x : s["grantees"]) {
                    if (!x.is_string() || !validGrantee(x.get<std::string>()) ||
                        !dup.insert(x.get<std::string>()).second)
                        return error(400, "BAD_REQUEST",
                                     {{"message", "Người nhận sai hoặc trùng."}, {"grantee", x}});
                    g.push_back(x.get<std::string>());
                }
                it.grantees = std::move(g);
            }
            items.push_back(std::move(it));
        }
        return accessEdit(
            body, AuditAction::AccessRule, who, "", 200,
            [&](AuthTxn& t, std::vector<AuditEvent>& rows, json&) -> std::optional<AdminReply> {
                for (const Item& it : items) {
                    if (it.grantees)
                        for (const std::string& g : *it.grantees) {
                            if (g.rfind("group:", 0) == 0 && !t.access.group(g.substr(6)))
                                return error(400, "NOT_FOUND",
                                             {{"grantee", g}, {"message", "Không có nhóm này."}});
                            if (g.rfind("user:", 0) == 0 && !t.users.find(g.substr(5)))
                                return error(
                                    400, "NOT_FOUND",
                                    {{"grantee", g}, {"message", "Không có tài khoản này."}});
                        }
                    auto r = std::find_if(
                        t.access.rules.begin(), t.access.rules.end(), [&](const AccessRule& x) {
                            return x.resource == it.resource && x.level == it.level;
                        });
                    const json before =
                        r == t.access.rules.end() ? json(nullptr) : json(r->grantees);
                    if (!it.grantees) {
                        if (r == t.access.rules.end()) continue;
                        t.access.rules.erase(r);
                    } else if (r == t.access.rules.end()) {
                        if (t.access.rules.size() >= kMaxAccessRules)
                            return error(400, "BAD_REQUEST", {{"message", "Đã đủ 5.000 quy tắc."}});
                        t.access.rules.push_back({it.resource, it.level, *it.grantees});
                    } else {
                        if (r->grantees == *it.grantees) continue;
                        r->grantees = *it.grantees;
                    }
                    AuditEvent e = event(AuditAction::AccessRule, AuditResult::Ok, who);
                    e.target = it.resource;
                    e.detail =
                        jsonText({{"level", accessLevelName(it.level)},
                                  {"before", before},
                                  {"after", it.grantees ? json(*it.grantees) : json(nullptr)}});
                    rows.push_back(std::move(e));
                }
                return std::nullopt;
            });
    }

    AdminReply accessCleanup(const json& body, const AdminCaller& who) {
        return accessEdit(
            body, AuditAction::AccessCleanup, who, "", 200,
            [&](AuthTxn& t, std::vector<AuditEvent>& rows,
                json& extra) -> std::optional<AdminReply> {
                const std::vector<ResourceLevel> o = orphanRules(b.access->catalog(), t.access);
                extra["removed"] = o.size();
                if (o.empty()) return std::nullopt;
                json removed = json::array();
                t.access.rules.erase(
                    std::remove_if(t.access.rules.begin(), t.access.rules.end(),
                                   [&](const AccessRule& r) {
                                       const bool orphan =
                                           std::find(o.begin(), o.end(),
                                                     ResourceLevel{r.resource, r.level}) != o.end();
                                       if (orphan)
                                           removed.push_back({{"resource", r.resource},
                                                              {"level", accessLevelName(r.level)},
                                                              {"grantees", r.grantees}});
                                       return orphan;
                                   }),
                    t.access.rules.end());
                AuditEvent e = event(AuditAction::AccessCleanup, AuditResult::Ok, who);
                e.detail = jsonText({{"removed", removed}});
                rows.push_back(std::move(e));
                return std::nullopt;
            });
    }

    AdminReply accessRestore(const json& body, const AdminCaller& who) {
        if (auto refused = reauth(body, who, AuditAction::AccessRestore, "access.json"))
            return *refused;
        AuditEvent e = event(AuditAction::AccessRestore, AuditResult::Started, who);
        e.target = "access.json";
        if (!audit(e)) return error(503, "AUDIT_UNAVAILABLE");
        std::string err;
        int64_t rev = 0;
        AuditEvent done = e;
        if (!b.store->restoreAccessBackup(err, &rev)) {
            done.result = AuditResult::Failed;
            done.code = "NO_BACKUP";
            done.detail = jsonText({{"error", err}});
            audit(done);
            return error(409, "NO_BACKUP", {{"message", err}});
        }
        done.result = AuditResult::Ok;
        done.detail = jsonText({{"rev", rev}});
        audit(done);
        b.access->reloadNow();
        return reply(200, {{"rev", rev}});
    }

    AdminReply effective(const std::map<std::string, std::string>& q, const AdminCaller& who) {
        // ?users=a,b,c (at most 200): the access of several accounts, for "who sees, who
        // operates"; no admin.view-as row (it is not a view as one person).
        if (const auto many = q.find("users"); many != q.end()) {
            if (q.count("user")) return error(400, "BAD_REQUEST");
            std::vector<std::string> names;
            const std::string& s = many->second;
            size_t at = 0;
            while (!s.empty() && at <= s.size()) {
                size_t end = s.find(',', at);
                if (end == std::string::npos) end = s.size();
                const std::string n = s.substr(at, end - at);
                if (!validAccountName(n)) return error(400, "BAD_REQUEST");
                if (std::find(names.begin(), names.end(), n) == names.end()) names.push_back(n);
                at = end + 1;
            }
            if (names.empty() || names.size() > kMaxAccounts) return error(400, "BAD_REQUEST");
            const AuthFiles f = b.store->read();
            json out = json::object();
            for (const std::string& n : names) {
                const Account* a =
                    f.users.status == UsersStatus::Ok ? f.users.file.find(n) : nullptr;
                if (!a) continue;  // an account gone meanwhile is left out
                Principal p;
                p.user = a->name;
                p.role = a->role;
                p.groups = a->groups;
                json one = effectiveAccessJson(
                    b.access->forPrincipal(p, a->rev, f.users.file.rev)->access);
                one["enabled"] = a->enabled;
                out[n] = std::move(one);
            }
            return reply(200, {{"effective", std::move(out)}});
        }
        const auto it = q.find("user");
        if (it == q.end() || !validAccountName(it->second)) return error(400, "BAD_REQUEST");
        const AuthFiles f = b.store->read();
        const Account* a =
            f.users.status == UsersStatus::Ok ? f.users.file.find(it->second) : nullptr;
        if (!a) return error(404, "NOT_FOUND");
        Principal p;
        p.user = a->name;
        p.role = a->role;
        p.groups = a->groups;
        AuditEvent e = event(AuditAction::AdminViewAs, AuditResult::Ok, who);
        e.target = a->name;
        if (!audit(e)) return error(503, "AUDIT_UNAVAILABLE");
        json out = effectiveAccessJson(b.access->forPrincipal(p, a->rev, f.users.file.rev)->access);
        out["enabled"] = a->enabled;
        return reply(200, std::move(out));
    }

    // ---- alarm email (feature 023, device-api 1.6.0 mở rộng, apiVersion không đổi)

    AdminReply emailGet() {
        const notify::EmailConfig c = b.email->config();
        // The groups of access.json with how many enabled accounts in them have an address.
        const AuthFiles f = b.store->read();
        json groups = json::array();
        for (const auto& g : f.access.groups) {
            int members = 0, withEmail = 0;
            if (f.users.status == UsersStatus::Ok)
                for (const Account& a : f.users.file.users)
                    if (a.enabled &&
                        std::find(a.groups.begin(), a.groups.end(), g.id) != a.groups.end()) {
                        ++members;
                        withEmail += a.email.empty() ? 0 : 1;
                    }
            groups.push_back(
                {{"id", g.id}, {"name", g.name}, {"members", members}, {"withEmail", withEmail}});
        }
        return reply(200, {{"rev", c.rev},
                           {"config", notify::emailConfigJson(c)},
                           {"passwordSet", b.email->passwordSet()},
                           {"status", b.email->statusJson()},
                           {"groups", groups}});
    }

    AdminReply emailSet(const json& body, const AdminCaller& who) {
        const AuditAction act = AuditAction::EmailConfig;
        if (!body.contains("rev") || !isRev(body["rev"]) || !body.contains("config") ||
            !body["config"].is_object())
            return error(400, "BAD_REQUEST", {{"message", "Cần rev và config."}});
        notify::EmailConfig c;
        std::string err;
        json cfg = body["config"];
        cfg.erase("rev");
        if (!notify::parseEmailConfig(cfg, c, err))
            return error(400, "BAD_REQUEST", {{"message", err}});
        const AuthFiles f = b.store->read();
        for (const auto& r : c.rules)
            for (const auto& g : r.groups)
                if (!f.access.group(g))
                    return error(400, "NOT_FOUND",
                                 {{"group", g}, {"message", "Không có nhóm " + g + "."}});
        const int64_t rev = body["rev"].get<int64_t>();
        const notify::EmailConfig before = b.email->config();
        if (before.rev != rev)
            return deny(act, who, "email.json", 409, "CONFLICT", {{"rev", before.rev}});
        const auto summary = [](const notify::EmailConfig& x) {
            return json{{"enabled", x.enabled},
                        {"host", x.smtp.host},
                        {"port", x.smtp.port},
                        {"security", notify::smtpSecurityName(x.smtp.security)},
                        {"username", x.smtp.username},
                        {"from", x.smtp.from},
                        {"pinned", !x.smtp.pinSha256.empty()},
                        {"rules", x.rules.size()},
                        {"maxPerHour", x.maxPerHour}};
        };
        AuditEvent e = event(act, AuditResult::Ok, who);
        e.target = "email.json";
        e.detail = jsonText({{"before", summary(before)}, {"after", summary(c)}});
        if (!audit(e)) return error(503, "AUDIT_UNAVAILABLE");
        int64_t newRev = 0;
        switch (b.email->saveConfig(c, rev, newRev, err)) {
            case notify::SaveStatus::Ok:
                return reply(200, {{"rev", newRev}});
            case notify::SaveStatus::Conflict:
                return deny(act, who, "email.json", 409, "CONFLICT", {{"rev", newRev}});
            case notify::SaveStatus::Invalid:
                return error(400, "BAD_REQUEST", {{"message", err}});
            case notify::SaveStatus::IoError:
                break;
        }
        AuditEvent fe = event(act, AuditResult::Failed, who);
        fe.target = "email.json";
        fe.code = "STORE_IO";
        audit(fe);
        return error(503, "STORE_IO", {{"message", "Không ghi được email.json: " + err}});
    }

    AdminReply emailTest(const json& body, const AdminCaller& who) {
        if (!body.contains("to") || !body["to"].is_string() ||
            !validAccountEmail(body["to"].get<std::string>()))
            return error(400, "BAD_REQUEST", {{"message", "Địa chỉ nhận thử không hợp lệ."}});
        const std::string to = body["to"].get<std::string>();
        const notify::SmtpResult r = b.email->sendTest(to);
        AuditEvent e =
            event(AuditAction::EmailTest, r.ok ? AuditResult::Ok : AuditResult::Failed, who);
        e.target = to;
        if (!r.ok) e.code = r.error;
        e.detail = jsonText({{"stage", r.stage}, {"smtpCode", r.code}});
        audit(e);
        return reply(200, {{"ok", r.ok},
                           {"stage", r.stage},
                           {"error", r.error},
                           {"code", r.code},
                           {"message", r.message},
                           {"peerSha256", r.peerSha256}});
    }
};

AdminApi::AdminApi(AdminBackend backend) : impl_(std::make_shared<Impl>()) {
    impl_->b = std::move(backend);
    impl_->mono = impl_->b.monoMs ? impl_->b.monoMs : bootTimeMs;
}

AdminCaller AdminApi::callerOf(const GateRequest& r, const GateDecision& d) {
    AdminCaller w;
    if (d.access.status == AccessStatus::Ok) {
        w.user = d.access.user;
        w.role = d.access.role.value_or(Role::Viewer);
        w.groups = d.access.groups;
        w.accountRev = d.access.accountRev;
        w.usersRev = d.access.usersRev;
    }
    w.from = r.from;
    w.viaCookie = d.viaCookie;
    if (d.viaCookie && !d.webToken.empty()) {
        w.webToken = d.webToken;
        w.sessionKey = toHex(sha256(d.webToken));
    } else if (r.authorization) {
        if (const auto t = bearerToken(*r.authorization)) w.sessionKey = toHex(sha256(*t));
    }
    return w;
}

AdminReply AdminApi::call(const std::string& method, const std::string& path,
                          const std::map<std::string, std::string>& query, const std::string& text,
                          const AdminCaller& who) {
    Impl& s = *impl_;
    if (!s.b.auth || !s.b.store || !s.b.access) return error(501, "NOT_IMPLEMENTED");
    if (path == "/api/v1/web/access") return s.webAccess(who, true);
    json body = json::object();
    if (method == "POST") {
        if (text.size() > kAdminBodyMaxBytes) return error(413, "BODY_TOO_LARGE");
        if (jsonNestingDepth(text.data(), text.size()) > kMaxBodyDepth)
            return error(400, "BAD_REQUEST");
        body = json::parse(text, nullptr, false);
        if (!body.is_object()) return error(400, "BAD_REQUEST");
    }
    struct Wipe {
        json& j;
        ~Wipe() {
            for (const char* k : {"password", "reauth", "old", "new"})
                if (j.is_object() && j.contains(k) && j[k].is_string())
                    secureZero(j[k].get_ref<std::string&>());
        }
    } wipe{body};
    if (path == "/api/v1/web/password") return s.webPassword(body, who);

    // /api/v1/admin/*: administrators only (the table says so; checked again here).
    if (!who.signedIn() || who.role != Role::Administrator) return error(403, "FORBIDDEN");
    if (method == "POST" && !s.rateOk(who))
        return error(429, "RATE_LIMITED", {{"message", "Quá 30 thay đổi mỗi phút."}});
    std::string id, rest;
    if (path == "/api/v1/admin/users")
        return method == "GET" ? s.usersList(who) : s.usersCreate(body, who);
    if (splitTail(path, "/api/v1/admin/users/", id, rest)) {
        if (rest.empty()) return s.usersUpdate(id, body, who);
        if (rest == "/password") return s.usersPassword(id, body, who);
        if (rest == "/delete") return s.usersDelete(id, body, who);
    }
    if (path == "/api/v1/admin/groups")
        return method == "GET" ? s.groupsList() : s.groupsCreate(body, who);
    if (splitTail(path, "/api/v1/admin/groups/", id, rest)) {
        if (rest.empty()) return s.groupsRename(id, body, who);
        if (rest == "/delete") return s.groupsDelete(id, body, who);
    }
    if (path == "/api/v1/admin/access")
        return method == "GET" ? s.accessGet() : s.accessSet(body, who);
    if (path == "/api/v1/admin/access/cleanup") return s.accessCleanup(body, who);
    if (path == "/api/v1/admin/access/restore") return s.accessRestore(body, who);
    if (path == "/api/v1/admin/effective") return s.effective(query, who);
    if (path == "/api/v1/admin/email" || path == "/api/v1/admin/email/test") {
        if (!s.b.email) return error(501, "NOT_IMPLEMENTED");
        if (path == "/api/v1/admin/email/test") return s.emailTest(body, who);
        return method == "GET" ? s.emailGet() : s.emailSet(body, who);
    }
    return error(404, "NOT_FOUND");
}

namespace {

int hexValue(char x) {
    if (x >= '0' && x <= '9') return x - '0';
    if (x >= 'a' && x <= 'f') return x - 'a' + 10;
    if (x >= 'A' && x <= 'F') return x - 'A' + 10;
    return -1;
}

bool decodeQuery(const char* q, std::map<std::string, std::string>& out) {
    if (!q || !*q) return true;
    const std::string s = q;
    size_t at = 0;
    while (at <= s.size()) {
        size_t end = s.find('&', at);
        if (end == std::string::npos) end = s.size();
        const std::string part = s.substr(at, end - at);
        const size_t eq = part.find('=');
        if (eq == std::string::npos || eq == 0) return false;
        std::string v;
        for (size_t i = eq + 1; i < part.size(); ++i) {
            if (part[i] == '+') {
                v += ' ';
            } else if (part[i] == '%') {
                if (i + 2 >= part.size()) return false;
                const int hi = hexValue(part[i + 1]), lo = hexValue(part[i + 2]);
                if (hi < 0 || lo < 0) return false;
                v += static_cast<char>(hi * 16 + lo);
                i += 2;
            } else {
                v += part[i];
            }
        }
        if (!out.emplace(part.substr(0, eq), v).second) return false;
        at = end + 1;
    }
    return true;
}

}  // namespace

int AdminApi::handle(mg_connection* c, const GateRequest& r, const GateDecision& d, bool close) {
    std::string body;
    if (r.method == "POST") {
        // JSON only (a form of another site could send text/plain).
        const char* type = mg_get_header(c, "Content-Type");
        std::string t = type ? type : "";
        t = t.substr(0, t.find(';'));
        while (!t.empty() && (t.back() == ' ' || t.back() == '\t')) t.pop_back();
        for (char& ch : t)
            if (ch >= 'A' && ch <= 'Z') ch = static_cast<char>(ch - 'A' + 'a');
        if (t != "application/json") {
            eapi::drain(c);
            return eapi::sendError(c, 415, "UNSUPPORTED_MEDIA_TYPE", close, "",
                                   {{"message", "Chỉ nhận application/json."}});
        }
        if (!eapi::readBody(c, body)) {
            mg_disable_connection_keep_alive(c);
            return eapi::sendError(c, 400, "BAD_REQUEST", true);
        }
    }
    struct Wipe {
        std::string& s;
        ~Wipe() { secureZero(s); }
    } wipe{body};
    std::map<std::string, std::string> query;
    if (!decodeQuery(mg_get_request_info(c)->query_string, query))
        return eapi::sendError(c, 400, "BAD_REQUEST", close);
    AdminCaller who = callerOf(r, d);
    // GET /web/access has no session in the table (anonymous with viewerLogin off): the cookie or
    // the token is read here.
    if (r.path == "/api/v1/web/access" && !who.signedIn()) {
        std::optional<SessionPrincipal> p;
        if (r.tls && r.authorization) {
            if (const auto t = bearerToken(*r.authorization))
                p = impl_->b.auth->principalOf(*t, r.from, SessionKind::Bearer);
        } else if (r.tls) {
            if (const auto t = sessionCookieToken(r.cookie))
                p = impl_->b.auth->principalOf(*t, r.from, SessionKind::Web);
        }
        if (p) {
            who.user = p->user;
            who.role = p->role;
            who.groups = p->groups;
            who.accountRev = p->accountRev;
            who.usersRev = p->usersRev;
        } else {
            const bool ok = !impl_->b.anonymousAllowed || impl_->b.anonymousAllowed(r);
            const AdminReply a = impl_->webAccess(who, ok);
            return eapi::send(c, a.status, jsonText(a.body), close, a.extra);
        }
    }
    AdminReply a = call(r.method, r.path, query, body, who);
    const std::string text = a.status == 204 ? std::string() : jsonText(a.body);
    const int status = eapi::send(c, a.status, text, close, a.extra);
    if (a.body.is_object() && a.body.contains("password") && a.body["password"].is_string())
        secureZero(a.body["password"].get_ref<std::string&>());
    return status;
}

}  // namespace mat
