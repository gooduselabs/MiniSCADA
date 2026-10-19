// The access of each session at run time (feature 013, contracts/access-model.md §4 to §6, SC-006):
// the catalog of the running project (fixed for the life of the process: a deploy starts it again),
// the view of access.json (read again when it changes, or at once after the admin API wrote it),
// and the answers of computeAccess kept per (account, its rev, rev of users.json, rev of
// access.json), with the store indexes of the live Tags so that the live hub looks a Tag up in a
// hash set. Thread-safe.
#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_set>
#include <vector>

#include "core/auth/access_model.hpp"
#include "core/auth/access_store.hpp"
#include "core/auth/auth_service.hpp"

namespace mat {

struct SessionAccess {
    EffectiveAccess access;
    std::unordered_set<size_t> liveIdx;  // store indexes of access.liveTags (unless admin)
    // Of what the person may see (§5 without the revisions, and the Tag sets): equal means the
    // live hub has nothing to tell the page.
    std::string fingerprint;

    bool all() const { return access.admin; }
    bool liveIndex(size_t i) const { return all() || liveIdx.count(i) > 0; }
};
using SessionAccessPtr = std::shared_ptr<const SessionAccess>;

struct AccessServiceOptions {
    ResourceCatalog catalog;
    std::string accessFile;  // <dataDir>/auth/access.json
    std::string projectHash;
    std::function<std::optional<size_t>(const std::string& tag)> tagIndex;  // TagStore::indexOf
    std::function<int64_t()> monoMs;                                        // empty: bootTimeMs
    AuthLogFn log;                                                          // empty: stderr
    AuditFn audit;  // access.store-invalid, once per new problem
};

class AccessService {
   public:
    explicit AccessService(AccessServiceOptions options);
    AccessService(const AccessService&) = delete;
    AccessService& operator=(const AccessService&) = delete;

    SessionAccessPtr forPrincipal(const Principal& p, int64_t accountRev, int64_t usersRev);
    // The account of a request the gate let through (Access Ok or Forbidden with a role).
    SessionAccessPtr forAccess(const Access& a);
    SessionAccessPtr forSession(const SessionPrincipal& p);
    SessionAccessPtr anonymous();  // viewerLogin off, no sign-in

    // access.json was written in this process: read it at the next call.
    void reloadNow();
    AccessFileState storeState();
    std::string storeError();
    AccessFile store();  // empty when not Ok
    const ResourceCatalog& catalog() const { return o_.catalog; }
    const std::string& projectHash() const { return o_.projectHash; }

   private:
    void refreshLocked();
    SessionAccessPtr computeLocked(const Principal& p, int64_t usersRev);

    AccessServiceOptions o_;
    AuthLogFn log_;
    std::function<int64_t()> mono_;
    std::mutex mu_;
    AccessStoreView view_;
    int64_t seenLoads_ = -1;
    std::string lastProblem_;
    std::map<std::string, SessionAccessPtr> cache_;
};

}  // namespace mat
