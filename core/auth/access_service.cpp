#include "core/auth/access_service.hpp"

#include <utility>

#include "core/common/json_text.hpp"

namespace mat {

namespace {

constexpr size_t kMaxCached = 256;

std::string fingerprintOf(const EffectiveAccess& a) {
    nlohmann::json j = effectiveAccessJson(a);
    j.erase("storeRev");
    j.erase("usersRev");
    j["liveTags"] = a.liveTags;
    j["historyTags"] = a.historyTags;
    j["alarms"] = a.alarms;
    j["storeValid"] = a.storeValid;
    return j.dump();
}

}  // namespace

AccessService::AccessService(AccessServiceOptions options)
    : o_(std::move(options)),
      log_(authLogOrStderr(o_.log)),
      mono_(o_.monoMs ? o_.monoMs : bootTimeMs),
      view_(o_.accessFile) {}

void AccessService::refreshLocked() {
    view_.refresh(mono_());
    if (view_.loads() == seenLoads_) return;
    seenLoads_ = view_.loads();
    cache_.clear();
    const std::string problem = view_.state() == AccessFileState::Invalid ? view_.error() : "";
    if (problem == lastProblem_) return;
    lastProblem_ = problem;
    if (problem.empty()) return;
    log_(problem + "; every rule refuses everybody but the administrators until it is restored");
    if (!o_.audit) return;
    AuditEvent e(AuditAction::AccessStoreInvalid, AuditResult::Failed, AuditChannel::System,
                 "system");
    e.target = "access.json";
    e.detail = jsonText({{"error", problem}});
    try {
        o_.audit(e);
    } catch (const std::exception& ex) {
        log_(std::string("audit access.store-invalid not written: ") + ex.what());
    }
}

SessionAccessPtr AccessService::computeLocked(const Principal& p, int64_t usersRev, bool tool) {
    auto out = std::make_shared<SessionAccess>();
    const bool valid = view_.state() != AccessFileState::Invalid;
    out->access = computeAccess(o_.catalog, view_.file(), p, valid);
    out->access.usersRev = usersRev;
    out->access.projectHash = o_.projectHash;
    out->tool = tool;
    if (!out->all() && o_.tagIndex)
        for (const std::string& t : out->access.liveTags)
            if (const auto i = o_.tagIndex(t)) out->liveIdx.insert(*i);
    out->fingerprint = fingerprintOf(out->access);
    if (tool) out->fingerprint += "#tool";
    return out;
}

SessionAccessPtr AccessService::forPrincipal(const Principal& p, int64_t accountRev,
                                             int64_t usersRev, bool bearer) {
    // §4: the engineer's tools are not filtered (they can read the whole package anyway).
    const bool tool = bearer && p.user && roleAtLeast(p.role, Role::Engineer);
    std::lock_guard<std::mutex> l(mu_);
    refreshLocked();
    std::string key = p.user ? *p.user : std::string();
    key += '\n';
    key += roleName(p.role);
    for (const auto& g : p.groups) key += "\n" + g;
    key += "\n#" + std::to_string(accountRev) + "#" + std::to_string(usersRev);
    if (tool) key += "#tool";
    if (const auto it = cache_.find(key); it != cache_.end()) return it->second;
    if (cache_.size() >= kMaxCached) cache_.clear();
    SessionAccessPtr a = computeLocked(p, usersRev, tool);
    cache_.emplace(std::move(key), a);
    return a;
}

SessionAccessPtr AccessService::forAccess(const Access& a, bool viaCookie) {
    Principal p;
    p.user = a.user;
    p.role = a.role.value_or(Role::Viewer);
    p.groups = a.groups;
    return forPrincipal(p, a.accountRev, a.usersRev, !viaCookie && a.role.has_value());
}

SessionAccessPtr AccessService::forSession(const SessionPrincipal& s, SessionKind kind) {
    Principal p;
    p.user = s.user;
    p.role = s.role;
    p.groups = s.groups;
    return forPrincipal(p, s.accountRev, s.usersRev, kind == SessionKind::Bearer);
}

SessionAccessPtr AccessService::anonymous() { return forPrincipal(Principal{}, 0, 0); }

void AccessService::reloadNow() {
    std::lock_guard<std::mutex> l(mu_);
    view_.recheckNow();
    refreshLocked();
}

AccessFileState AccessService::storeState() {
    std::lock_guard<std::mutex> l(mu_);
    refreshLocked();
    return view_.state();
}

std::string AccessService::storeError() {
    std::lock_guard<std::mutex> l(mu_);
    refreshLocked();
    return view_.error();
}

AccessFile AccessService::store() {
    std::lock_guard<std::mutex> l(mu_);
    refreshLocked();
    return view_.file();
}

}  // namespace mat
