#include "server/access_glue.hpp"

#include <memory>
#include <mutex>

#include "core/common/json_text.hpp"
#include "core/project-manager/project_validator.hpp"
#include "server/http/cookie.hpp"

namespace mat {

namespace {

// The session a request carries: a Bearer token wins (and the cookie is then not looked at).
struct Carried {
    std::string token;
    SessionKind kind = SessionKind::Web;
    ClientAddress from;
};

std::optional<Carried> carriedOf(const RequestOrigin& o) {
    if (!o.tls) return std::nullopt;
    Carried c;
    c.from = ClientAddress{o.ip, o.port};
    if (o.authorization) {
        const auto t = ViewerGate::bearerOf(o);
        if (!t) return std::nullopt;
        c.token = *t;
        c.kind = SessionKind::Bearer;
        return c;
    }
    const auto t = sessionCookieToken(o.cookie);
    if (!t) return std::nullopt;
    c.token = *t;
    c.kind = SessionKind::Web;
    return c;
}

}  // namespace

SessionAccessPtr accessOfOrigin(AuthService& auth, AccessService& access, const RequestOrigin& o) {
    if (const auto c = carriedOf(o))
        if (const auto p = auth.principalOf(c->token, c->from, c->kind))
            return access.forSession(*p);
    return access.anonymous();
}

LiveGrantPtr liveGrantFrom(const SessionAccessPtr& a) {
    auto g = std::make_shared<LiveGrant>();
    if (!a) {  // the session ended: nothing (the transport closes it with 4401 soon)
        g->all = false;
        g->alarm = [](const std::string&) { return false; };
        g->fingerprint = "none";
        return g;
    }
    g->all = a->all();
    g->tags = a->liveIdx;
    g->fingerprint = a->fingerprint;
    if (!g->all) g->alarm = [a](const std::string& id) { return a->access.alarmAllowed(id); };
    return g;
}

LiveGrantFn liveGrantOf(AuthService& auth, AccessService& access, const RequestOrigin& o) {
    struct State {
        std::mutex mu;
        SessionAccessPtr last;
        LiveGrantPtr grant;
        bool anonymous = false;
        std::optional<Carried> carried;
    };
    auto st = std::make_shared<State>();
    st->carried = carriedOf(o);
    // A cookie or token that did not check out at the upgrade let the connection in as anonymous
    // (viewerLogin off): it stays anonymous.
    st->anonymous =
        !st->carried || !auth.principalOf(st->carried->token, st->carried->from, st->carried->kind);
    // A connection without a session is anonymous for good; one with a session follows it.
    return [st, &auth, &access]() -> LiveGrantPtr {
        SessionAccessPtr a;
        if (st->anonymous) {
            a = access.anonymous();
        } else if (const auto p =
                       auth.principalOf(st->carried->token, st->carried->from, st->carried->kind)) {
            a = access.forSession(*p);
        }
        std::lock_guard<std::mutex> l(st->mu);
        if (st->grant && a == st->last) return st->grant;
        st->last = a;
        st->grant = liveGrantFrom(a);
        return st->grant;
    };
}

std::map<std::string, std::vector<std::pair<std::string, std::string>>> projectItemFiles(
    const LoadedProject& p) {
    std::map<std::string, std::vector<std::pair<std::string, std::string>>> out;
    for (const auto& s : p.screens) {
        if (!p.is03()) {
            if (s.screen.is_object() && s.screen.contains("svgFile") &&
                s.screen["svgFile"].is_string())
                out[s.screen["svgFile"].get<std::string>()].emplace_back(s.id, "svg");
            continue;
        }
        if (!s.screen.is_object() || !s.screen.contains("items")) continue;
        for (const auto& it : s.screen["items"]) {
            if (!it.is_object() || it.value("type", "") != "svg" || !it.contains("id")) continue;
            const std::string id = it["id"].get<std::string>();
            for (const char* k : {"svgFile", "bindingFile"})
                if (it.contains(k) && it[k].is_string())
                    out[it[k].get<std::string>()].emplace_back(s.id, id);
        }
    }
    return out;
}

std::string prepareAuthStore(AuthStore& store, const std::string& seed, const AuditFn& audit,
                             const AuthLogFn& log) {
    std::string err, seedError;
    bool migrated = false;
    if (!store.prepare(err, &migrated, &seedError)) {
        log("auth store " + store.dir() + " not used: " + err + "; reading " + seed +
            " (no change on the web)");
        return seed;
    }
    if (migrated) {
        log("accounts copied from " + seed + " to " + store.usersPath() +
            " (feature 013): the device commands and the admin page change them there");
        if (audit) {
            AuditEvent e(AuditAction::AccountMigrate, AuditResult::Ok, AuditChannel::System,
                         "system");
            e.target = store.usersPath();
            e.detail = jsonText({{"from", seed}});
            try {
                audit(e);
            } catch (const std::exception& ex) {
                log(std::string("audit account.migrate not written: ") + ex.what());
            }
        }
    }
    if (!seedError.empty() && store.read().users.status == UsersStatus::Missing) {
        log(seedError + "; nobody can sign in until it is repaired (mat-runtime --user-*)");
        return seed;  // the damaged seed: the same refusal as before 013
    }
    return store.usersPath();
}

void noteLastLogin(AuthStore& store, const std::string& user, int64_t wallMs,
                   const AuthLogFn& log) {
    std::string err;
    const TxnStatus s = store.transact(
        [&](AuthTxn& t) {
            Account* a = t.users.find(user);
            if (!a || t.before.users.status != UsersStatus::Ok) return false;
            a->lastLoginAt = wallMs;
            t.usersChanged = true;
            t.keepUsersRev = true;
            return true;
        },
        err);
    if (s == TxnStatus::Failed && log) log("lastLoginAt of " + user + " not written: " + err);
}

}  // namespace mat
