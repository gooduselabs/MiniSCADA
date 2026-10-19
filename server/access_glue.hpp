// The access control of feature 013 at run time (contracts/access-model.md, admin-api.md §6):
// the person of a request of the page or of a live connection (the token or the cookie it
// carries, over HTTPS), their access, the grant the live hub filters with, the project files of
// SVG items, and the store's first start (users.json from the seed, account.migrate).
#pragma once
#include <map>
#include <string>
#include <utility>
#include <vector>

#include "core/auth/access_service.hpp"
#include "core/auth/access_store.hpp"
#include "core/auth/auth_service.hpp"
#include "server/http/viewer_gate.hpp"
#include "server/websocket/live_hub.hpp"

namespace mat {

struct LoadedProject;

// The access of a request: the account of a Bearer token or of the cookie of a web session that
// checks out (HTTPS only), else the anonymous viewer (only served when viewerLogin is off: the
// source filter refuses it otherwise).
SessionAccessPtr accessOfOrigin(AuthService& auth, AccessService& access, const RequestOrigin& o);

// The grant of a live connection opened with `o` (asked again by the hub every second): the Tags
// of live(P) as store indexes and the alarms of P; a session that ended gives nothing.
LiveGrantFn liveGrantOf(AuthService& auth, AccessService& access, const RequestOrigin& o);
LiveGrantPtr liveGrantFrom(const SessionAccessPtr& a);

// The owners (screen, item) of every file of an SVG item; for a project before 0.3 the screen of
// its SVG file, item "svg".
std::map<std::string, std::vector<std::pair<std::string, std::string>>> projectItemFiles(
    const LoadedProject& p);

// The store at start: the directory, users.json from the seed (audit account.migrate, system).
// Returns the users.json the runtime reads: the store's, or the seed when the store cannot be used
// (as before 013) or the seed is damaged and nothing was copied (nobody signs in, as before).
std::string prepareAuthStore(AuthStore& store, const std::string& seed, const AuditFn& audit,
                             const AuthLogFn& log);

// lastLoginAt of `user` (users.json, rev kept).
void noteLastLogin(AuthStore& store, const std::string& user, int64_t wallMs, const AuthLogFn& log);

}  // namespace mat
