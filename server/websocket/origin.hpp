// Origin check for the live WebSocket (T058 / research R7): blocks cross-site WebSocket hijacking
// from pages on other origins. Requests without Origin (non-browser clients) are allowed.
#pragma once
#include <string>
#include <vector>

namespace mat {

bool isOriginAllowed(const char* origin, const char* hostHeader,
                     const std::vector<std::string>& allowed);

}  // namespace mat
