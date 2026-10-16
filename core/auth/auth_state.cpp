#include "core/auth/auth_state.hpp"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <fstream>
#include <utility>

#include "core/auth/account_store.hpp"
#include "core/crypto/hex.hpp"
#include "nlohmann/json.hpp"

namespace mat {

namespace {

// 1.1.0 (feature 011): the lockouts are pairs and addresses; a file without them (1.0.x) keeps
// its sessions and no lockout.
constexpr const char* kAuthStateVersion = "1.1.0";
constexpr size_t kMaxKeyBytes = 64;   // typed names are at most 64 bytes, addresses less
constexpr size_t kMaxEntries = 1024;  // sessions

bool nonNegativeInt(const nlohmann::json& o, const char* key, int64_t& out) {
    const auto it = o.find(key);
    if (it == o.end()) return false;
    if (it->is_number_unsigned()) {
        const uint64_t v = it->get<uint64_t>();
        if (v > static_cast<uint64_t>(INT64_MAX)) return false;
        out = static_cast<int64_t>(v);
        return true;
    }
    if (it->is_number_integer() && it->get<int64_t>() >= 0) {
        out = it->get<int64_t>();
        return true;
    }
    return false;
}

bool text(const nlohmann::json& o, const char* key, size_t maxBytes, std::string& out) {
    const auto it = o.find(key);
    if (it == o.end() || !it->is_string()) return false;
    out = it->get<std::string>();
    return !out.empty() && out.size() <= maxBytes;
}

bool majorOne(const nlohmann::json& doc) {
    const auto it = doc.find("schemaVersion");
    if (it == doc.end() || !it->is_string()) return false;
    const std::string v = it->get<std::string>();
    return v.compare(0, 2, "1.") == 0;
}

nlohmann::json pairsJson(const std::vector<PairEntry>& entries) {
    nlohmann::json out = nlohmann::json::array();
    for (const auto& e : entries) {
        nlohmann::json j = {{"user", e.user},           {"ip", e.ip},
                            {"failures", e.failures},   {"lockedUntilMono", e.lockedUntilMono},
                            {"lockCount", e.lockCount}, {"lastLockMono", e.lastLockMono}};
        if (e.generation) {
            j["rev"] = e.generation->rev;
            j["unlockSeq"] = e.generation->unlockSeq;
        }
        out.push_back(std::move(j));
    }
    return out;
}

nlohmann::json sourcesJson(const std::vector<SourceEntry>& entries) {
    nlohmann::json out = nlohmann::json::array();
    for (const auto& e : entries)
        out.push_back({{"ip", e.ip},
                       {"failuresMono", e.failuresMono},
                       {"lockedUntilMono", e.lockedUntilMono},
                       {"lockedByMono", e.lockedByMono}});
    return out;
}

bool readPairs(const nlohmann::json& lockouts, int64_t nowMono, std::vector<PairEntry>& out,
               std::string& why) {
    const auto it = lockouts.find("pairs");
    if (it == lockouts.end()) return true;
    if (!it->is_array() || it->size() > kPairTableSize) {
        why = "lockouts.pairs is not a list";
        return false;
    }
    for (const auto& j : *it) {
        PairEntry e;
        int64_t failures = 0, lockCount = 0;
        if (!j.is_object() || !text(j, "user", kMaxKeyBytes, e.user) ||
            !text(j, "ip", kMaxKeyBytes, e.ip) || !nonNegativeInt(j, "failures", failures) ||
            failures >= kPairMaxFailures ||
            !nonNegativeInt(j, "lockedUntilMono", e.lockedUntilMono) ||
            e.lockedUntilMono > nowMono + kPairLockMaxMs ||
            !nonNegativeInt(j, "lockCount", lockCount) || lockCount > 64 ||
            !nonNegativeInt(j, "lastLockMono", e.lastLockMono) || e.lastLockMono > nowMono) {
            why = "an entry of lockouts.pairs is not valid";
            return false;
        }
        e.failures = static_cast<int>(failures);
        e.lockCount = static_cast<int>(lockCount);
        if (j.contains("rev") || j.contains("unlockSeq")) {
            AccountGeneration g;
            if (!nonNegativeInt(j, "rev", g.rev) || !nonNegativeInt(j, "unlockSeq", g.unlockSeq)) {
                why = "an entry of lockouts.pairs has a bad generation";
                return false;
            }
            e.generation = g;
        }
        out.push_back(std::move(e));
    }
    return true;
}

bool readSources(const nlohmann::json& lockouts, int64_t nowMono, std::vector<SourceEntry>& out,
                 std::string& why) {
    const auto it = lockouts.find("sources");
    if (it == lockouts.end()) return true;
    if (!it->is_array() || it->size() > kSourceTableSize) {
        why = "lockouts.sources is not a list";
        return false;
    }
    for (const auto& j : *it) {
        SourceEntry e;
        const auto f = j.is_object() ? j.find("failuresMono") : j.end();
        bool ok = j.is_object() && text(j, "ip", kMaxKeyBytes, e.ip) && f != j.end() &&
                  f->is_array() && f->size() <= static_cast<size_t>(kSourceMaxFailures) &&
                  nonNegativeInt(j, "lockedUntilMono", e.lockedUntilMono) &&
                  e.lockedUntilMono <= nowMono + kSourceLockMs &&
                  nonNegativeInt(j, "lockedByMono", e.lockedByMono);
        if (ok)
            for (const auto& t : *f) {
                if (!t.is_number_integer() || t.get<int64_t>() < 0 || t.get<int64_t>() > nowMono) {
                    ok = false;
                    break;
                }
                e.failuresMono.push_back(t.get<int64_t>());
            }
        if (!ok) {
            why = "an entry of lockouts.sources is not valid";
            return false;
        }
        out.push_back(std::move(e));
    }
    return true;
}

}  // namespace

std::string readBootId(const std::string& path) {
    std::ifstream in(path);
    std::string line;
    if (!std::getline(in, line)) return "";
    while (!line.empty() && (line.back() == '\n' || line.back() == '\r' || line.back() == ' '))
        line.pop_back();
    return line;
}

std::string authStateJson(const AuthState& s) {
    nlohmann::json sessions = nlohmann::json::array();
    for (const auto& x : s.sessions) {
        nlohmann::json j = {{"tokenHash", toHex(x.tokenHash)},
                            {"user", x.user},
                            {"rev", x.rev},
                            {"source", x.source},
                            {"createdMono", x.createdMono},
                            {"lastMono", x.lastMono}};
        // Feature 007: a web session also has its kind, the CSRF token (the page asks for it
        // again after F5; the file is on tmpfs, 0600, and read once) and its limits. A Bearer
        // session is written as 0.5 wrote it.
        if (x.kind == SessionKind::Web) {
            j["kind"] = "web";
            j["csrf"] = x.csrf;
            j["idleLimitMs"] = x.idleLimitMs;
            j["maxLimitMs"] = x.maxLimitMs;
        }
        sessions.push_back(std::move(j));
    }
    nlohmann::json doc = {
        {"schemaVersion", kAuthStateVersion},
        {"bootId", s.bootId},
        {"sessions", std::move(sessions)},
        {"lockouts",
         {{"pairs", pairsJson(s.guard.pairs)}, {"sources", sourcesJson(s.guard.sources)}}}};
    return doc.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace) + "\n";
}

bool writeAuthState(const std::string& path, const AuthState& s, std::string& err) {
    const std::string body = authStateJson(s);
    std::string tmp = path + ".tmp-XXXXXX";
    const int fd = ::mkostemp(&tmp[0], O_CLOEXEC);  // mode 0600
    if (fd < 0) {
        err = "cannot create a file next to " + path + ": " + std::strerror(errno);
        return false;
    }
    size_t done = 0;
    while (done < body.size()) {
        const ssize_t n = ::write(fd, body.data() + done, body.size() - done);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) {
            err = "cannot write " + tmp + ": " + std::strerror(errno);
            ::close(fd);
            ::unlink(tmp.c_str());
            return false;
        }
        done += static_cast<size_t>(n);
    }
    // tmpfs: it only has to outlive the execv, not a power cut, so no fsync.
    if (::fchmod(fd, 0600) != 0 || ::close(fd) != 0 || ::rename(tmp.c_str(), path.c_str()) != 0) {
        err = "cannot put " + path + " in place: " + std::strerror(errno);
        ::unlink(tmp.c_str());
        return false;
    }
    return true;
}

AuthState readAuthState(const std::string& path, const std::string& bootId, int64_t nowMono,
                        std::string* why) {
    auto empty = [why](const std::string& reason) {
        if (why) *why = reason;
        return AuthState{};
    };
    const int fd = ::open(path.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
    if (fd < 0) {
        if (errno == ENOENT) return empty("missing");
        const std::string reason = std::strerror(errno);
        ::unlink(path.c_str());  // a symbolic link (ELOOP) or anything else: gone too
        return empty("cannot open: " + reason);
    }
    ::unlink(path.c_str());  // read once, whatever it holds; the open descriptor still reads it
    struct stat st {};
    std::string body;
    if (::fstat(fd, &st) != 0 || !S_ISREG(st.st_mode)) {
        ::close(fd);
        return empty("not a regular file");
    }
    if ((st.st_mode & 0077) != 0) {
        ::close(fd);
        return empty("group or others may read it");
    }
    if (st.st_size > static_cast<off_t>(kAuthStateMaxBytes)) {
        ::close(fd);
        return empty("too big");
    }
    char buf[4096];
    ssize_t n;
    while ((n = ::read(fd, buf, sizeof buf)) != 0) {
        if (n < 0) {
            if (errno == EINTR) continue;
            break;
        }
        body.append(buf, static_cast<size_t>(n));
        if (body.size() > kAuthStateMaxBytes) break;
    }
    ::close(fd);
    if (n < 0 || body.size() > kAuthStateMaxBytes) return empty("cannot be read");

    const auto doc = nlohmann::json::parse(body, nullptr, false);
    if (doc.is_discarded() || !doc.is_object()) return empty("not a JSON object");
    if (!majorOne(doc)) return empty("schemaVersion is not 1.x");
    std::string fileBoot;
    if (bootId.empty() || !text(doc, "bootId", 64, fileBoot) || fileBoot != bootId)
        return empty("written in another boot");
    AuthState st2;
    st2.bootId = fileBoot;
    const auto sessions = doc.find("sessions");
    if (sessions == doc.end() || !sessions->is_array() || sessions->size() > kMaxEntries)
        return empty("sessions is not a list");
    for (const auto& j : *sessions) {
        Session s;
        std::string hash;
        if (!j.is_object() || !text(j, "tokenHash", 64, hash) || hash.size() != 64)
            return empty("a session has no token hash");
        const auto raw = fromHex(hash);
        if (!raw || raw->size() != s.tokenHash.size()) return empty("a token hash is not hex");
        std::copy(raw->begin(), raw->end(), s.tokenHash.begin());
        if (!text(j, "user", 32, s.user) || !validAccountName(s.user) ||
            !nonNegativeInt(j, "rev", s.rev) || !text(j, "source", kMaxKeyBytes, s.source) ||
            !nonNegativeInt(j, "createdMono", s.createdMono) ||
            !nonNegativeInt(j, "lastMono", s.lastMono) || s.createdMono > s.lastMono ||
            s.lastMono > nowMono)
            return empty("a session is not valid");
        if (const auto kind = j.find("kind"); kind != j.end()) {
            if (!kind->is_string() ||
                (kind->get<std::string>() != "web" && kind->get<std::string>() != "bearer"))
                return empty("a session has an unknown kind");
            if (kind->get<std::string>() == "web") {
                s.kind = SessionKind::Web;
                std::string csrf;
                if (!text(j, "csrf", kCsrfLength, csrf) || !isCsrfFormat(csrf))
                    return empty("a web session has no valid CSRF token");
                s.csrf = csrf;
                if (!nonNegativeInt(j, "idleLimitMs", s.idleLimitMs) || s.idleLimitMs < 1000 ||
                    s.idleLimitMs > 24LL * 3600 * 1000 ||
                    !nonNegativeInt(j, "maxLimitMs", s.maxLimitMs) || s.maxLimitMs < 1000 ||
                    s.maxLimitMs > 7LL * 24 * 3600 * 1000)
                    return empty("a web session has no valid limits");
            }
        }
        st2.sessions.push_back(std::move(s));
    }
    const auto lockouts = doc.find("lockouts");
    if (lockouts == doc.end() || !lockouts->is_object()) return empty("no lockouts");
    std::string reason;
    if (!readPairs(*lockouts, nowMono, st2.guard.pairs, reason) ||
        !readSources(*lockouts, nowMono, st2.guard.sources, reason))
        return empty(reason);
    if (why) why->clear();
    return st2;
}

}  // namespace mat
