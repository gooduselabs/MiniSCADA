// The pieces of the cookie session that the gate of the engineering API and the viewer gate both
// need (feature 007, device-api-1.2 §1.3, ADR-021): the cookie name, finding it in a Cookie header,
// and the comparison of Origin with Host. No CivetWeb, no session store.
#pragma once
#include <optional>
#include <string>
#include <string_view>

namespace mat {

// The name of the session cookie: the "__Host-" prefix makes the browser refuse it without Secure,
// with a Domain or with a Path other than "/".
constexpr const char* kSessionCookieName = "__Host-mat_sid";
constexpr const char* kWebTokenPrefixText = "matw_";

// The value of cookie `name` in a Cookie header ("a=b; c=d"); nullopt when it is absent or given
// twice (a second value is how a cookie fixation looks).
std::optional<std::string> cookieValue(std::string_view header, std::string_view name);

// Origin = "https://" + Host, compared without regard to case; "null", an empty or missing value
// and any other scheme or port do not match.
bool originMatchesHost(const std::optional<std::string>& origin,
                       const std::optional<std::string>& host);

// The token of the session cookie of a request, when it is one of ours: the cookie is there once
// and its value starts with "matw_". nullopt otherwise (another name, a Bearer token, a duplicate).
std::optional<std::string> sessionCookieToken(const std::optional<std::string>& cookieHeader);

}  // namespace mat
