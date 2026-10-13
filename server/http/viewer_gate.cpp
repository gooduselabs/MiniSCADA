#include "server/http/viewer_gate.hpp"

#include <cctype>
#include <chrono>

#include "civetweb.h"

namespace mat {

ViewerGate::ViewerGate(ViewerAccess access, SessionPeek peek, Hooks hooks, EpochMs epoch)
    : access_(access), peek_(std::move(peek)), hooks_(std::move(hooks)), epoch_(std::move(epoch)) {
    if (!epoch_)
        epoch_ = [] {
            return std::chrono::duration_cast<std::chrono::milliseconds>(
                       std::chrono::system_clock::now().time_since_epoch())
                .count();
        };
}

RequestOrigin ViewerGate::originOf(const mg_connection* c) const {
    const mg_request_info* ri = mg_get_request_info(c);
    RequestOrigin o;
    o.ip = ri->remote_addr;
    o.port = ri->remote_port;
    o.tls = ri->is_ssl != 0;
    if (const char* a = mg_get_header(c, "Authorization")) o.authorization = a;
    if (const char* v = mg_get_header(c, "Cookie")) o.cookie = v;
    if (const char* v = mg_get_header(c, "Origin")) o.origin = v;
    if (const char* v = mg_get_header(c, "Host")) o.host = v;
    if (hooks_.remoteIp) o.ip = hooks_.remoteIp(o.ip);
    if (hooks_.tls) o.tls = hooks_.tls(o.tls);
    return o;
}

std::optional<std::string> ViewerGate::bearerOf(const RequestOrigin& o) {
    if (!o.authorization) return std::nullopt;
    const std::string& h = *o.authorization;
    size_t i = 0;
    while (i < h.size() && std::isspace(static_cast<unsigned char>(h[i]))) ++i;
    static const char kScheme[] = "bearer";
    size_t k = 0;
    while (k < 6 && i + k < h.size() &&
           std::tolower(static_cast<unsigned char>(h[i + k])) == kScheme[k])
        ++k;
    if (k != 6) return std::nullopt;
    i += 6;
    if (i >= h.size() || !std::isspace(static_cast<unsigned char>(h[i]))) return std::nullopt;
    while (i < h.size() && std::isspace(static_cast<unsigned char>(h[i]))) ++i;
    size_t end = h.size();
    while (end > i && std::isspace(static_cast<unsigned char>(h[end - 1]))) --end;
    if (end == i) return std::nullopt;
    return h.substr(i, end - i);
}

bool ViewerGate::validSession(const RequestOrigin& o) const {
    if (!o.tls || !peek_) return false;
    const auto token = bearerOf(o);
    return token && peek_(*token, o.ip, o.port);
}

bool ViewerGate::validWebSession(const RequestOrigin& o) const {
    if (!o.tls || !webPeek_ || o.authorization) return false;
    const std::optional<std::string> token = sessionCookieToken(o.cookie);
    return token && webPeek_(*token, o.ip, o.port);
}

FilterDecision ViewerGate::check(FilteredPath path, const RequestOrigin& o) {
    FilterInput in;
    in.access = access_;
    in.path = path;
    in.remote = o.ip;
    in.tls = o.tls;
    in.hasAuthorization = o.authorization.has_value();
    in.validSession = in.hasAuthorization && o.tls ? validSession(o) : false;
    in.validWebSession = !in.validSession && validWebSession(o);
    in.viewerLogin = viewerLogin_;
    const FilterDecision d = decideFilter(in);
    if (!d.allow && d.outcome == FilterOutcome::Refuse) {  // sources turned away, not the sign-in
        ++blocked_;
        lastBlockedAt_ = epoch_();
    }
    return d;
}

bool ViewerGate::wouldBeRefusedWithoutSession(FilteredPath path, const RequestOrigin& o) const {
    FilterInput in;
    in.access = access_;
    in.path = path;
    in.remote = o.ip;
    in.tls = o.tls;
    in.hasAuthorization = false;
    in.validSession = false;
    in.validWebSession = false;
    in.viewerLogin = viewerLogin_;
    return !decideFilter(in).allow;
}

}  // namespace mat
