#include "core/auth/api_keys.hpp"

#include <arpa/inet.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <limits>
#include <set>

#include "core/auth/access_model.hpp"
#include "core/auth/access_store.hpp"
#include "core/auth/session_store.hpp"
#include "core/crypto/base64url.hpp"
#include "core/crypto/hex.hpp"
#include "core/crypto/random.hpp"
#include "core/crypto/sha256.hpp"

namespace mat {

namespace {

using nlohmann::json;

bool isBase64UrlChar(char c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' ||
           c == '_';
}

bool isLowerHex(std::string_view s, size_t n) {
    if (s.size() != n) return false;
    for (char c : s)
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    return true;
}

// The address as 16 bytes; IPv4 as ::ffff:a.b.c.d. `v4` says which.
bool parseAddress(const std::string& s, uint8_t out[16], bool& v4) {
    in_addr a4{};
    if (::inet_pton(AF_INET, s.c_str(), &a4) == 1) {
        std::memset(out, 0, 16);
        out[10] = out[11] = 0xff;
        std::memcpy(out + 12, &a4, 4);
        v4 = true;
        return true;
    }
    in6_addr a6{};
    if (::inet_pton(AF_INET6, s.c_str(), &a6) == 1) {
        std::memcpy(out, &a6, 16);
        static const uint8_t mapped[12] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff};
        v4 = std::memcmp(out, mapped, 12) == 0;
        return true;
    }
    return false;
}

std::string randomHexId() { return toHex(randomBytes(6)); }

}  // namespace

std::string newApiKeyToken() {
    uint8_t raw[32];
    randomBytes(raw, sizeof raw);
    std::string t = std::string(kApiKeyPrefix) + base64urlEncode(raw, sizeof raw);
    std::memset(raw, 0, sizeof raw);
    return t;
}

bool isApiKeyFormat(std::string_view token) {
    if (token.size() != kApiKeyTokenLength || token.rfind(kApiKeyPrefix, 0) != 0) return false;
    for (size_t i = 5; i < token.size(); ++i)
        if (!isBase64UrlChar(token[i])) return false;
    return true;
}

std::string newApiKeyId() { return randomHexId(); }

std::string apiKeyHash(std::string_view token) { return toHex(sha256(token)); }

std::optional<IpNet> parseIpNet(std::string_view text) {
    if (text.empty() || text.size() > 64) return std::nullopt;
    const size_t slash = text.find('/');
    const std::string addr(text.substr(0, slash));
    IpNet n;
    bool v4 = false;
    if (!parseAddress(addr, n.addr, v4)) return std::nullopt;
    n.v6 = !v4 || addr.find(':') != std::string::npos;
    const int maxPrefix = n.v6 ? 128 : 32;
    if (slash == std::string_view::npos) {
        n.prefix = maxPrefix;
    } else {
        const std::string_view p = text.substr(slash + 1);
        if (p.empty() || p.size() > 3) return std::nullopt;
        int v = 0;
        for (char c : p) {
            if (c < '0' || c > '9') return std::nullopt;
            v = v * 10 + (c - '0');
        }
        if (v > maxPrefix) return std::nullopt;
        n.prefix = v;
    }
    return n;
}

bool ipInNet(std::string_view ip, const IpNet& net) {
    uint8_t a[16];
    bool v4 = false;
    if (!parseAddress(std::string(ip), a, v4)) return false;
    // an IPv4 network: compare the last 4 bytes of an IPv4 address (also ::ffff: mapped)
    int bits = net.prefix;
    size_t from = 0;
    if (!net.v6) {
        if (!v4) return false;
        from = 12;
    }
    for (size_t i = from; i < 16 && bits > 0; ++i, bits -= 8) {
        const uint8_t mask = bits >= 8 ? 0xff : static_cast<uint8_t>(0xff << (8 - bits));
        if ((a[i] & mask) != (net.addr[i] & mask)) return false;
    }
    return true;
}

std::optional<int64_t> parseIsoUtcMs(std::string_view s) {
    // YYYY-MM-DDTHH:MM:SS[.fff]Z
    if (s.size() < 20 || s.back() != 'Z') return std::nullopt;
    auto num = [&](size_t at, size_t n, int& out) {
        out = 0;
        for (size_t i = at; i < at + n; ++i) {
            if (s[i] < '0' || s[i] > '9') return false;
            out = out * 10 + (s[i] - '0');
        }
        return true;
    };
    int y, mo, d, h, mi, se;
    if (!num(0, 4, y) || s[4] != '-' || !num(5, 2, mo) || s[7] != '-' || !num(8, 2, d) ||
        s[10] != 'T' || !num(11, 2, h) || s[13] != ':' || !num(14, 2, mi) || s[16] != ':' ||
        !num(17, 2, se))
        return std::nullopt;
    int ms = 0;
    if (s.size() > 20) {
        if (s[19] != '.' || s.size() < 22 || s.size() > 24) return std::nullopt;
        const size_t digits = s.size() - 21;
        if (!num(20, digits, ms)) return std::nullopt;
        for (size_t i = digits; i < 3; ++i) ms *= 10;
    } else if (s.size() != 20) {
        return std::nullopt;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return std::nullopt;
    std::tm tm{};
    tm.tm_year = y - 1900;
    tm.tm_mon = mo - 1;
    tm.tm_mday = d;
    tm.tm_hour = h;
    tm.tm_min = mi;
    tm.tm_sec = se;
    const time_t t = ::timegm(&tm);
    std::tm back{};
    ::gmtime_r(&t, &back);
    if (back.tm_mday != d) return std::nullopt;  // 31 of a short month
    return static_cast<int64_t>(t) * 1000 + ms;
}

std::string isoUtcText(int64_t ms) {
    const time_t secs = static_cast<time_t>(ms / 1000);
    int rem = static_cast<int>(ms % 1000);
    if (rem < 0) rem += 1000;
    std::tm tm{};
    ::gmtime_r(&secs, &tm);
    char buf[40];
    std::snprintf(buf, sizeof buf, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", tm.tm_year + 1900,
                  tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec, rem);
    return buf;
}

std::string apiKeySettingsProblem(const ApiKey& k, int64_t nowMs) {
    if (!validGroupName(k.name)) return "Tên key cần 1 đến 64 ký tự, không có ký tự điều khiển.";
    if (k.role != Role::Viewer && k.role != Role::Operator)
        return "Vai trò của key chỉ là viewer hoặc operator.";
    if (k.groups.size() > kMaxApiKeyGroups) return "Tối đa 16 nhóm.";
    std::set<std::string> seen;
    for (const auto& g : k.groups) {
        if (!validGroupId(g)) return "Mã nhóm không hợp lệ: " + g + ".";
        if (!seen.insert(g).second) return "Nhóm " + g + " có hai lần.";
    }
    if (k.allowFrom.size() > kMaxApiKeyAllowFrom) return "Tối đa 16 địa chỉ hoặc mạng cho phép.";
    for (const auto& a : k.allowFrom)
        if (!parseIpNet(a)) return "Địa chỉ hoặc mạng không hợp lệ: " + a + ".";
    if (k.ratePerMin < kApiKeyRateMin || k.ratePerMin > kApiKeyRateMax)
        return "Giới hạn gọi mỗi phút từ 10 đến 6000.";
    if (k.expiresAtMs && *k.expiresAtMs <= nowMs) return "Hạn của key phải ở tương lai.";
    return "";
}

ApiKeysParse parseApiKeysFile(std::string_view text) {
    ApiKeysParse out;
    auto fail = [&](const std::string& why) {
        out.ok = false;
        out.error = why;
        return out;
    };
    const json doc = json::parse(text, nullptr, false);
    if (!doc.is_object()) return fail("not a JSON object");
    for (auto it = doc.begin(); it != doc.end(); ++it)
        if (it.key() != "schemaVersion" && it.key() != "rev" && it.key() != "keys")
            return fail("unknown key " + it.key());
    if (!doc.contains("schemaVersion") || doc["schemaVersion"] != kApiKeysSchemaVersion)
        return fail("schemaVersion is not 1.0.0");
    if (!doc.contains("rev") || !doc["rev"].is_number_integer() || doc["rev"].get<int64_t>() < 0)
        return fail("rev is not an integer >= 0");
    if (!doc.contains("keys") || !doc["keys"].is_array()) return fail("keys is not a list");
    if (doc["keys"].size() > kMaxApiKeys) return fail("more than 32 keys");
    out.file.rev = doc["rev"].get<int64_t>();
    std::set<std::string> ids, hashes;
    for (const json& k : doc["keys"]) {
        if (!k.is_object()) return fail("a key is not an object");
        auto str = [&](const char* name, std::string& to) {
            if (!k.contains(name) || !k[name].is_string()) return false;
            to = k[name].get<std::string>();
            return true;
        };
        ApiKey a;
        std::string role;
        if (!str("id", a.id) || !isLowerHex(a.id, 12)) return fail("a key has no valid id");
        const std::string at = "key " + a.id;
        if (!str("name", a.name) || !str("hash", a.hash) || !isLowerHex(a.hash, 64) ||
            !str("prefix", a.prefix) || a.prefix.size() != kApiKeyShownPrefix ||
            a.prefix.rfind(kApiKeyPrefix, 0) != 0 || !str("role", role) ||
            !str("createdAt", a.createdAt) || !str("createdBy", a.createdBy))
            return fail(at + ": a field is missing or wrong");
        const auto r = parseRole(role);
        if (!r) return fail(at + ": unknown role");
        a.role = *r;
        if (k.contains("updatedAt") && !str("updatedAt", a.updatedAt))
            return fail(at + ": updatedAt");
        if (!k.contains("readOnly") || !k["readOnly"].is_boolean()) return fail(at + ": readOnly");
        a.readOnly = k["readOnly"].get<bool>();
        if (!k.contains("ratePerMin") || !k["ratePerMin"].is_number_integer())
            return fail(at + ": ratePerMin");
        a.ratePerMin = k["ratePerMin"].get<int>();
        if (!k.contains("rev") || !k["rev"].is_number_integer() || k["rev"].get<int64_t>() < 1)
            return fail(at + ": rev");
        a.rev = k["rev"].get<int64_t>();
        for (const char* list : {"groups", "allowFrom"}) {
            if (!k.contains(list) || !k[list].is_array()) return fail(at + ": " + list);
            for (const json& v : k[list]) {
                if (!v.is_string()) return fail(at + ": " + list);
                (std::string(list) == "groups" ? a.groups : a.allowFrom)
                    .push_back(v.get<std::string>());
            }
        }
        if (k.contains("expiresAt") && !k["expiresAt"].is_null()) {
            if (!k["expiresAt"].is_string()) return fail(at + ": expiresAt");
            a.expiresAtMs = parseIsoUtcMs(k["expiresAt"].get<std::string>());
            if (!a.expiresAtMs) return fail(at + ": expiresAt");
        }
        // the expiry may be over by now: that is the key's state, not damage of the file
        if (const std::string p = apiKeySettingsProblem(a, std::numeric_limits<int64_t>::min());
            !p.empty())
            return fail(at + ": " + p);
        if (!ids.insert(a.id).second) return fail(at + " is there twice");
        if (!hashes.insert(a.hash).second) return fail(at + ": the hash of another key");
        out.file.keys.push_back(std::move(a));
    }
    out.ok = true;
    return out;
}

std::string apiKeysFileJson(const ApiKeysFile& f) {
    json keys = json::array();
    for (const ApiKey& k : f.keys) {
        json j = {{"id", k.id},
                  {"name", k.name},
                  {"hash", k.hash},
                  {"prefix", k.prefix},
                  {"role", roleName(k.role)},
                  {"groups", k.groups},
                  {"readOnly", k.readOnly},
                  {"allowFrom", k.allowFrom},
                  {"expiresAt", k.expiresAtMs ? json(isoUtcText(*k.expiresAtMs)) : json(nullptr)},
                  {"ratePerMin", k.ratePerMin},
                  {"rev", k.rev},
                  {"createdAt", k.createdAt},
                  {"createdBy", k.createdBy}};
        if (!k.updatedAt.empty()) j["updatedAt"] = k.updatedAt;
        keys.push_back(std::move(j));
    }
    const json doc = {{"schemaVersion", f.schemaVersion}, {"rev", f.rev}, {"keys", keys}};
    return doc.dump(2) + "\n";
}

const char* apiKeyAuthCode(ApiKeyAuthStatus s) {
    switch (s) {
        case ApiKeyAuthStatus::Ok:
            return "";
        case ApiKeyAuthStatus::Missing:
            return "AUTH_REQUIRED";
        case ApiKeyAuthStatus::Invalid:
            return "APIKEY_INVALID";
        case ApiKeyAuthStatus::Expired:
            return "APIKEY_EXPIRED";
        case ApiKeyAuthStatus::Source:
            return "APIKEY_SOURCE";
        case ApiKeyAuthStatus::RateLimited:
            return "RATE_LIMITED";
        case ApiKeyAuthStatus::Throttled:
            return "APIKEY_THROTTLED";
        case ApiKeyAuthStatus::Store:
            return "APIKEY_STORE";
    }
    return "";
}

int apiKeyAuthHttp(ApiKeyAuthStatus s) {
    switch (s) {
        case ApiKeyAuthStatus::Ok:
            return 200;
        case ApiKeyAuthStatus::Missing:
        case ApiKeyAuthStatus::Invalid:
        case ApiKeyAuthStatus::Expired:
            return 401;
        case ApiKeyAuthStatus::Source:
            return 403;
        case ApiKeyAuthStatus::RateLimited:
        case ApiKeyAuthStatus::Throttled:
            return 429;
        case ApiKeyAuthStatus::Store:
            return 503;
    }
    return 500;
}

ApiKeyService::ApiKeyService(Options options) : o_(std::move(options)) {}

int64_t ApiKeyService::wall() const {
    if (o_.wallMs) return o_.wallMs();
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

int64_t ApiKeyService::mono() const { return o_.monoMs ? o_.monoMs() : bootTimeMs(); }

bool ApiKeyService::load(std::string& err) {
    std::string text, error;
    bool missing = false;
    const std::string path = o_.dir + "/" + kApiKeysFileName;
    std::lock_guard<std::mutex> l(mu_);
    byHash_.clear();
    file_ = ApiKeysFile{};
    if (!readAuthPrivateFile(path, kApiKeysFileMaxBytes, text, missing, error)) {
        if (missing) {
            ok_ = true;
            error_.clear();
            return true;
        }
        ok_ = false;
        error_ = path + ": " + error;
        err = error_;
        return false;
    }
    ApiKeysParse p = parseApiKeysFile(text);
    if (!p.ok) {
        ok_ = false;
        error_ = path + ": " + p.error;
        err = error_;
        return false;
    }
    ok_ = true;
    error_.clear();
    file_ = std::move(p.file);
    for (size_t i = 0; i < file_.keys.size(); ++i) byHash_[file_.keys[i].hash] = i;
    return true;
}

bool ApiKeyService::storeOk() const {
    std::lock_guard<std::mutex> l(mu_);
    return ok_;
}

std::string ApiKeyService::storeError() const {
    std::lock_guard<std::mutex> l(mu_);
    return error_;
}

ApiKeyAuth ApiKeyService::authenticate(std::string_view token, const std::string& ip) {
    ApiKeyAuth out;
    if (!isApiKeyFormat(token)) {
        out.status = ApiKeyAuthStatus::Missing;
        return out;
    }
    const std::string hash = apiKeyHash(token);  // outside the lock
    const int64_t now = mono();
    std::lock_guard<std::mutex> l(mu_);
    out.storeRev = file_.rev;
    if (!ok_) {
        out.status = ApiKeyAuthStatus::Store;
        return out;
    }
    if (auto f = failures_.find(ip); f != failures_.end()) {
        if (now - f->second.windowStart >= 60000) {
            failures_.erase(f);
        } else if (f->second.count >= kApiKeyFailuresPerMinute) {
            out.status = ApiKeyAuthStatus::Throttled;
            out.retryAfterMs = 60000 - (now - f->second.windowStart);
            return out;
        }
    }
    const auto it = byHash_.find(hash);
    if (it == byHash_.end()) {
        if (failures_.size() > 256)
            for (auto f = failures_.begin(); f != failures_.end();)
                f = now - f->second.windowStart >= 60000 ? failures_.erase(f) : std::next(f);
        Failures& f = failures_[ip];
        if (f.count == 0) f.windowStart = now;
        ++f.count;
        out.status = ApiKeyAuthStatus::Invalid;
        return out;
    }
    const ApiKey& k = file_.keys[it->second];
    out.key = k;
    ApiKeyUsage& u = usage_[k.id];
    if (k.expiresAtMs && wall() >= *k.expiresAtMs) {
        ++u.denied;
        out.status = ApiKeyAuthStatus::Expired;
        return out;
    }
    if (!k.allowFrom.empty()) {
        bool inside = false;
        for (const auto& a : k.allowFrom)
            if (const auto n = parseIpNet(a); n && ipInNet(ip, *n)) {
                inside = true;
                break;
            }
        if (!inside) {
            ++u.denied;
            out.status = ApiKeyAuthStatus::Source;
            return out;
        }
    }
    // token bucket: ratePerMin a minute, a burst of a tenth of it (at least 10)
    const double perMs = k.ratePerMin / 60000.0;
    const double cap = std::max(10.0, k.ratePerMin / 10.0);
    Bucket& b = buckets_[k.id];
    if (b.lastMs == 0) {
        b.tokens = cap;
    } else {
        b.tokens = std::min(cap, b.tokens + (now - b.lastMs) * perMs);
    }
    b.lastMs = now;
    if (b.tokens < 1.0) {
        ++u.denied;
        out.status = ApiKeyAuthStatus::RateLimited;
        out.retryAfterMs =
            std::max<int64_t>(1, static_cast<int64_t>(std::ceil((1.0 - b.tokens) / perMs)));
        return out;
    }
    b.tokens -= 1.0;
    ++u.calls;
    u.lastUsedMs = wall();
    u.lastFrom = ip;
    out.status = ApiKeyAuthStatus::Ok;
    return out;
}

std::optional<ApiKey> ApiKeyService::find(const std::string& id) const {
    std::lock_guard<std::mutex> l(mu_);
    for (const ApiKey& k : file_.keys)
        if (k.id == id) return k;
    return std::nullopt;
}

ApiKeysFile ApiKeyService::list() const {
    std::lock_guard<std::mutex> l(mu_);
    return file_;
}

std::map<std::string, ApiKeyUsage> ApiKeyService::usage() const {
    std::lock_guard<std::mutex> l(mu_);
    return usage_;
}

bool ApiKeyService::saveLocked(const ApiKeysFile& next, std::string& err) {
    if (!writeAuthPrivateFile(o_.dir, kApiKeysFileName, apiKeysFileJson(next), o_.ownerUser, err))
        return false;
    file_ = next;
    byHash_.clear();
    for (size_t i = 0; i < file_.keys.size(); ++i) byHash_[file_.keys[i].hash] = i;
    return true;
}

ApiKeyChange ApiKeyService::create(int64_t rev, ApiKey draft, const std::string& by,
                                   std::string& token, ApiKey& made, int64_t& newRev,
                                   std::string& err) {
    std::lock_guard<std::mutex> l(mu_);
    newRev = file_.rev;
    if (!ok_) return ApiKeyChange::Store;
    if (rev != file_.rev) return ApiKeyChange::Conflict;
    if (file_.keys.size() >= kMaxApiKeys) return ApiKeyChange::Full;
    if (std::string p = apiKeySettingsProblem(draft, wall()); !p.empty()) {
        err = p;
        return ApiKeyChange::Invalid;
    }
    std::string t = o_.newToken ? o_.newToken() : newApiKeyToken();
    ApiKey k = std::move(draft);
    const auto taken = [&](const std::string& id) {
        return std::any_of(file_.keys.begin(), file_.keys.end(),
                           [&](const ApiKey& x) { return x.id == id; });
    };
    if (!k.id.empty()) {  // chosen by the caller (the admin API audits it first)
        if (!isLowerHex(k.id, 12) || taken(k.id)) {
            err = "Mã key không hợp lệ.";
            return ApiKeyChange::Invalid;
        }
    } else {
        do {
            k.id = o_.newId ? o_.newId() : randomHexId();
        } while (taken(k.id));
    }
    k.hash = apiKeyHash(t);
    k.prefix = t.substr(0, kApiKeyShownPrefix);
    k.createdAt = isoUtcText(wall());
    k.createdBy = by;
    k.updatedAt.clear();
    k.rev = 1;
    ApiKeysFile next = file_;
    next.rev += 1;
    next.keys.push_back(k);
    if (!saveLocked(next, err)) {
        std::fill(t.begin(), t.end(), '\0');
        return ApiKeyChange::IoError;
    }
    token = std::move(t);
    made = k;
    newRev = next.rev;
    return ApiKeyChange::Ok;
}

ApiKeyChange ApiKeyService::update(int64_t rev, const std::string& id,
                                   const std::function<void(ApiKey&)>& edit, ApiKey& after,
                                   int64_t& newRev, std::string& err) {
    std::lock_guard<std::mutex> l(mu_);
    newRev = file_.rev;
    if (!ok_) return ApiKeyChange::Store;
    if (rev != file_.rev) return ApiKeyChange::Conflict;
    ApiKeysFile next = file_;
    auto it = std::find_if(next.keys.begin(), next.keys.end(),
                           [&](const ApiKey& k) { return k.id == id; });
    if (it == next.keys.end()) return ApiKeyChange::NotFound;
    const ApiKey before = *it;
    edit(*it);
    // what the edit may not change
    it->id = before.id;
    it->hash = before.hash;
    it->prefix = before.prefix;
    it->createdAt = before.createdAt;
    it->createdBy = before.createdBy;
    if (std::string p = apiKeySettingsProblem(*it, wall()); !p.empty()) {
        err = p;
        return ApiKeyChange::Invalid;
    }
    it->rev = before.rev + 1;
    it->updatedAt = isoUtcText(wall());
    next.rev += 1;
    if (!saveLocked(next, err)) return ApiKeyChange::IoError;
    after = *std::find_if(file_.keys.begin(), file_.keys.end(),
                          [&](const ApiKey& k) { return k.id == id; });
    buckets_.erase(id);  // a new rate starts full
    newRev = next.rev;
    return ApiKeyChange::Ok;
}

ApiKeyChange ApiKeyService::revoke(int64_t rev, const std::string& id, ApiKey& gone,
                                   int64_t& newRev, std::string& err) {
    std::lock_guard<std::mutex> l(mu_);
    newRev = file_.rev;
    if (!ok_) return ApiKeyChange::Store;
    if (rev != file_.rev) return ApiKeyChange::Conflict;
    ApiKeysFile next = file_;
    auto it = std::find_if(next.keys.begin(), next.keys.end(),
                           [&](const ApiKey& k) { return k.id == id; });
    if (it == next.keys.end()) return ApiKeyChange::NotFound;
    gone = *it;
    next.keys.erase(it);
    next.rev += 1;
    if (!saveLocked(next, err)) return ApiKeyChange::IoError;
    usage_.erase(id);
    buckets_.erase(id);
    newRev = next.rev;
    return ApiKeyChange::Ok;
}

}  // namespace mat
