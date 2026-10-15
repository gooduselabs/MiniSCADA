// Source filter of the part that needs no sign-in (feature 006 FR-055a, ADR-018, research R19,
// contracts/device-api-1.1.md §1.2). Pure functions: no CivetWeb, no clock.
//
// The runtime page, its assets and project files, GET system/info, GET projects/active and the live
// channel are served by default only to the private networks (and the loopback). A request that
// carries a valid session over HTTPS is never filtered. `viewerAccess` of runtime.json:
//
//   private  private networks and loopback are served, any other source gets 403 SOURCE_NOT_ALLOWED
//   any      every source is served (the system info carries the warning VIEWER_PUBLIC)
//   off      page, assets, project files, projects/active and live get 403 VIEWER_OFF, except from
//            the loopback; system/info is served as in `private` (the deploy script and the health
//            check call it through 127.0.0.1)
//
// A request with an Authorization header over HTTP is refused 403 HTTPS_REQUIRED: a token must not
// travel in clear.
#pragma once
#include <optional>
#include <string>

namespace mat {

// 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10, 169.254.0.0/16, 127.0.0.0/8,
// fc00::/7, fe80::/10, ::1; an IPv4-mapped address (::ffff:a.b.c.d) counts as the IPv4 one. A text
// that is no address (also an address with a port or brackets) is not private. A zone suffix of an
// IPv6 address (fe80::1%eth0) is ignored.
bool isPrivateSource(const std::string& addr);
// 127.0.0.0/8, ::1 and ::ffff:127.x.x.x
bool isLoopbackSource(const std::string& addr);

enum class ViewerAccess { Private, Any, Off };
std::optional<ViewerAccess> parseViewerAccess(const std::string& s);
const char* viewerAccessName(ViewerAccess a);

// The paths the filter applies to; everything else (device/identity, auth/*, the engineering API)
// is None.
// Login, LoginAsset and DeviceCert (feature 007) are never filtered: the page that signs a person
// in, its own bundle (/assets/login-*) and the public certificate must open from any source.
enum class FilteredPath {
    None,
    Page,
    Asset,
    Project,
    SystemInfo,
    ProjectsActive,
    Live,
    Login,
    LoginAsset,
    DeviceCert,
    Alarms  // feature 009: GET /api/v1/alarms and /api/v1/alarms/history (like projects/active)
};
// `localUri`: the decoded path without the query string.
FilteredPath classifyPath(const std::string& localUri);

struct FilterInput {
    ViewerAccess access = ViewerAccess::Private;
    FilteredPath path = FilteredPath::None;
    std::string remote;             // the source address, no port
    bool tls = false;               // came over the HTTPS listener
    bool hasAuthorization = false;  // the request has an Authorization header
    bool validSession =
        false;  // HTTPS + bearer token + session alive and from the signed-in address
    // Feature 007 (device-api-1.2 §7): the cookie session of the page, valid over HTTPS; and
    // viewerLogin = required (no page and no data without a session).
    bool validWebSession = false;
    bool viewerLogin = false;
};

// What the handler does with the request. Serve: as usual. MinimalInfo: system/info is served
// without a session, in its small form (viewerLogin required). Everything else is not served:
// Refuse (403), LoginRedirect (302 to /login: the page over HTTPS), HttpGuide (a short page that
// names the HTTPS address: a cookie never travels over HTTP), Unauthorized (401 AUTH_REQUIRED).
enum class FilterOutcome { Serve, MinimalInfo, Refuse, LoginRedirect, HttpGuide, Unauthorized };

struct FilterDecision {
    bool allow = true;
    int status = 200;   // 403 when refused; 302, 200 (guide page), 401 for the outcomes above
    std::string error;  // SOURCE_NOT_ALLOWED | VIEWER_OFF | HTTPS_REQUIRED | AUTH_REQUIRED
    FilterOutcome outcome = FilterOutcome::Serve;
};

FilterDecision decideFilter(const FilterInput& in);

// The Vietnamese sentence of the refusal (for the HTML page and the JSON message).
const char* filterMessage(const std::string& error);
// Short HTML page (UTF-8; served with CSP default-src 'none').
std::string blockedPageHtml(const std::string& error);
// { "error": code, "message": "..." }
std::string blockedJson(const std::string& error);
// The page of FilterOutcome::HttpGuide: "open https://…" (`httpsUrl` is shown as text, escaped).
std::string httpGuidePageHtml(const std::string& httpsUrl);

}  // namespace mat
