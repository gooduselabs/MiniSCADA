// API keys for machines (feature 025, specs/025-data-api, ADR-053): ERP, MES, BI and scripts call
// /api/v1/data/* with "Authorization: Bearer matk_…". A key is a principal of the access model of
// feature 013 (role viewer or operator, groups of access.json), with an optional list of source
// addresses, an expiry and a rate limit. The device keeps only the SHA-256 of the token (like the
// sessions: the token carries 256 random bits, so a fast hash is enough) and its first 12
// characters, to tell keys apart on the admin page.
//
// The store is <dataDir>/auth/api-keys.json (0600, `rev` of the whole file, written through a
// temporary file with a .bak, at most 32 keys). Only the runtime writes it (the admin API). A file
// that cannot be read refuses every key (APIKEY_STORE) until an administrator saves the list again.
// When each key was last used and how many calls it made live in memory only: nothing is written to
// the eMMC per call (ADR-039).
#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "core/auth/roles.hpp"
#include "nlohmann/json.hpp"

namespace mat {

constexpr const char* kApiKeyPrefix = "matk_";
constexpr const char* kApiKeysFileName = "api-keys.json";
constexpr const char* kApiKeysSchemaVersion = "1.0.0";
constexpr size_t kApiKeyTokenLength = 5 + 43;  // "matk_" + base64url of 32 bytes
constexpr size_t kApiKeyShownPrefix = 12;      // "matk_" + 7 characters
constexpr size_t kMaxApiKeys = 32;
constexpr size_t kMaxApiKeyAllowFrom = 16;
constexpr size_t kMaxApiKeyGroups = 16;
constexpr int kApiKeyRateMin = 10;  // calls a minute
constexpr int kApiKeyRateMax = 6000;
constexpr int kApiKeyRateDefault = 600;
constexpr size_t kApiKeysFileMaxBytes = 256 * 1024;
// A source that sent this many unknown keys in a minute is refused (APIKEY_THROTTLED) until the
// minute is over, without looking at what it sends.
constexpr int kApiKeyFailuresPerMinute = 20;

// "matk_" + base64url without padding of 32 bytes from getrandom.
std::string newApiKeyToken();
// Shape only: the prefix and 43 base64url characters.
bool isApiKeyFormat(std::string_view token);
// SHA-256 of the token, lower-case hex.
std::string apiKeyHash(std::string_view token);

// An address or a network: "192.0.2.7", "192.0.2.0/24", "2001:db8::/32". An IPv4 address seen as
// IPv6 (::ffff:192.0.2.7) matches the IPv4 networks.
struct IpNet {
    bool v6 = false;
    uint8_t addr[16] = {};
    int prefix = 0;
};
std::optional<IpNet> parseIpNet(std::string_view text);
bool ipInNet(std::string_view ip, const IpNet& net);

struct ApiKey {
    std::string id;            // 12 lower-case hex characters
    std::string name;          // 1 to 64 characters, no control character
    std::string hash;          // apiKeyHash of the token
    std::string prefix;        // the first kApiKeyShownPrefix characters of the token
    Role role = Role::Viewer;  // viewer | operator
    std::vector<std::string> groups;
    bool readOnly = true;
    std::vector<std::string> allowFrom;  // IP or CIDR; empty: any source
    std::optional<int64_t> expiresAtMs;  // UTC ms; nullopt: never
    int ratePerMin = kApiKeyRateDefault;
    std::string createdAt;  // ISO 8601 UTC
    std::string createdBy;
    std::string updatedAt;
    int64_t rev = 1;  // of this key: changes with its rights (the cache of the access model)

    bool canWrite() const { return role == Role::Operator && !readOnly; }
};

struct ApiKeysFile {
    std::string schemaVersion = kApiKeysSchemaVersion;
    int64_t rev = 0;
    std::vector<ApiKey> keys;
};

// 12 random lower-case hex characters: the id of a new key.
std::string newApiKeyId();

// The checks of one key's settings (not the hash, the id, the dates of creation); "" when valid,
// else why not (Vietnamese). `nowMs`: an expiry must be later.
std::string apiKeySettingsProblem(const ApiKey& k, int64_t nowMs);

struct ApiKeysParse {
    bool ok = false;
    ApiKeysFile file;
    std::string error;
};
ApiKeysParse parseApiKeysFile(std::string_view text);
std::string apiKeysFileJson(const ApiKeysFile& f);

// "2026-12-31T00:00:00Z" (seconds, optional fraction, Z) to UTC ms and back.
std::optional<int64_t> parseIsoUtcMs(std::string_view s);
std::string isoUtcText(int64_t ms);

enum class ApiKeyAuthStatus {
    Ok,
    Missing,      // no token of the shape of a key: AUTH_REQUIRED
    Invalid,      // no such key: APIKEY_INVALID
    Expired,      // APIKEY_EXPIRED
    Source,       // the address is not in allowFrom: APIKEY_SOURCE
    RateLimited,  // RATE_LIMITED
    Throttled,    // too many unknown keys from this address: APIKEY_THROTTLED
    Store,        // the store cannot be read: APIKEY_STORE
};
const char* apiKeyAuthCode(ApiKeyAuthStatus s);  // the error code of a refusal; "" for Ok
int apiKeyAuthHttp(ApiKeyAuthStatus s);          // its HTTP status

struct ApiKeyAuth {
    ApiKeyAuthStatus status = ApiKeyAuthStatus::Missing;
    ApiKey key;                // Ok, Expired, Source, RateLimited: the key
    int64_t retryAfterMs = 0;  // RateLimited, Throttled
    int64_t storeRev = 0;
};

struct ApiKeyUsage {
    int64_t lastUsedMs = 0;  // UTC
    std::string lastFrom;
    int64_t calls = 0;
    int64_t denied = 0;
};

enum class ApiKeyChange { Ok, Conflict, NotFound, Full, Invalid, Store, IoError };

class ApiKeyService {
   public:
    struct Options {
        std::string dir;                        // <dataDir>/auth
        std::string ownerUser = "matscada";     // run as root: owner of what is written
        std::function<int64_t()> wallMs;        // empty: the system clock
        std::function<int64_t()> monoMs;        // empty: bootTimeMs
        std::function<std::string()> newToken;  // empty: newApiKeyToken
        std::function<std::string()> newId;     // empty: 12 random hex characters
    };

    explicit ApiKeyService(Options options);
    ApiKeyService(const ApiKeyService&) = delete;
    ApiKeyService& operator=(const ApiKeyService&) = delete;

    // Reads api-keys.json (a missing file is an empty list). false + `err` when it cannot be read:
    // every key is refused until the list is saved again.
    bool load(std::string& err);
    bool storeOk() const;
    std::string storeError() const;

    // The key of a bearer token for a request from `ip`: expiry, source, then the rate limit. A
    // call that passes counts in the usage of the key.
    ApiKeyAuth authenticate(std::string_view token, const std::string& ip);
    // A key still there (by id) with its current settings; nullopt when revoked.
    std::optional<ApiKey> find(const std::string& id) const;

    ApiKeysFile list() const;
    std::map<std::string, ApiKeyUsage> usage() const;

    // The changes of the admin API. `rev` is the rev of the file the request was made on (Conflict
    // when it moved, `newRev` then says the current one). create: `draft` holds the settings; the
    // token is made here, returned once in `token`, and only its hash is kept. Invalid + `err` for
    // settings apiKeySettingsProblem refuses. `draft.id` empty: a new id is made here; else it is
    // used (12 lower-case hex characters, not taken: Invalid otherwise).
    ApiKeyChange create(int64_t rev, ApiKey draft, const std::string& by, std::string& token,
                        ApiKey& made, int64_t& newRev, std::string& err);
    ApiKeyChange update(int64_t rev, const std::string& id,
                        const std::function<void(ApiKey&)>& edit, ApiKey& after, int64_t& newRev,
                        std::string& err);
    ApiKeyChange revoke(int64_t rev, const std::string& id, ApiKey& gone, int64_t& newRev,
                        std::string& err);

   private:
    bool saveLocked(const ApiKeysFile& next, std::string& err);
    int64_t wall() const;
    int64_t mono() const;

    Options o_;
    mutable std::mutex mu_;
    bool ok_ = true;
    std::string error_;
    ApiKeysFile file_;
    std::unordered_map<std::string, size_t> byHash_;  // hash -> index in file_.keys
    std::map<std::string, ApiKeyUsage> usage_;        // by key id
    struct Bucket {
        double tokens = 0;
        int64_t lastMs = 0;
    };
    std::map<std::string, Bucket> buckets_;  // by key id
    struct Failures {
        int64_t windowStart = 0;
        int count = 0;
    };
    std::map<std::string, Failures> failures_;  // by source address
};

}  // namespace mat
