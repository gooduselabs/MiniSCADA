// Password hashes (specs/005-device-online research R7, data-model §4, ADR-011): Argon2id through
// phc-winner-argon2, stored as a PHC string "$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>"
// (standard base64 without padding). The 19 MiB of every hash come from mmap and go back with
// munmap at once, so the peak never stays in the heap (Constitution III). PasswordHasher runs one
// hash at a time on its own thread at nice +10.
#pragma once
#include <cstddef>
#include <cstdint>
#include <functional>
#include <future>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

#include "core/auth/auth_log.hpp"

namespace mat {

struct Argon2Params {
    uint32_t mKiB = 0;  // memory, KiB
    uint32_t t = 0;     // passes
    uint32_t p = 0;     // lanes
};
inline bool operator==(const Argon2Params& a, const Argon2Params& b) {
    return a.mKiB == b.mKiB && a.t == b.t && a.p == b.p;
}
inline bool operator!=(const Argon2Params& a, const Argon2Params& b) { return !(a == b); }

// Parameters of new hashes: the OWASP minimum m = 19 MiB, t = 2, p = 1. T055 measures them on the
// BL335 and may lower t to 1 here. Hashes stored with other parameters still verify; needsRehash()
// tells which ones.
inline constexpr Argon2Params kArgon2Default{19456, 2, 1};
constexpr size_t kSaltBytes = 16;
constexpr size_t kHashBytes = 32;

// Bounds of a hash read from users.json. Outside them the account record counts as damaged: a file
// edited by hand cannot make a sign-in allocate or compute without limit.
constexpr uint32_t kArgon2MinMKiB = 8192;
constexpr uint32_t kArgon2MaxMKiB = 65536;
constexpr uint32_t kArgon2MinT = 1;
constexpr uint32_t kArgon2MaxT = 10;
constexpr size_t kSaltMinBytes = 16;
constexpr size_t kSaltMaxBytes = 64;

struct PasswordHash {
    Argon2Params params = kArgon2Default;
    std::string salt;  // raw bytes
    std::string hash;  // raw bytes, kHashBytes
};

// Strict PHC parse: "$argon2id$v=19$m=<m>,t=<t>,p=<p>$<salt>$<hash>" in this order, decimal numbers
// without sign or leading zero, canonical base64 without padding, and the bounds above (p = 1).
// Anything else: nullopt, and `why` says what is wrong without quoting the text.
std::optional<PasswordHash> parsePhc(std::string_view text, std::string* why = nullptr);
std::string formatPhc(const PasswordHash& h);

// Raw Argon2id hash (kHashBytes) of `password`, memory through mmap. Throws std::runtime_error when
// the library fails (out of memory, parameters it refuses).
std::string argon2idHash(std::string_view password, std::string_view salt,
                         const Argon2Params& params);
// A new PHC string for `password`: fresh random salt of kSaltBytes, the given parameters.
std::string hashPassword(std::string_view password, const Argon2Params& params = kArgon2Default);
// Recomputes with the parameters and salt of `stored`; compares all kHashBytes in constant time.
// Throws like argon2idHash. (The runtime verifies through PasswordHasher and AuthService.)
bool verifyPassword(std::string_view password, const PasswordHash& stored);
// The stored hash uses other parameters than `current`. The runtime cannot write users.json: it
// only logs it; setting the password again (--user-passwd) upgrades the hash.
bool needsRehash(const PasswordHash& stored, const Argon2Params& current = kArgon2Default);
// Target of the hash run for a name that cannot sign in (no such account, account disabled or
// damaged, no account at all): same parameters, random salt and hash. One per process, made at
// start, so a refused sign-in costs what a real one costs and the time does not tell the cases
// apart.
PasswordHash dummyPasswordHash(const Argon2Params& params = kArgon2Default);

// Rules for a new password (research R8, NIST SP 800-63B-4): valid UTF-8, 15–128 characters, at
// most 512 bytes, not the account name (ASCII case ignored). Sign-in does not apply them.
constexpr size_t kPasswordMinChars = 15;
constexpr size_t kPasswordMaxChars = 128;
constexpr size_t kPasswordMaxBytes = 512;
enum class PasswordProblem { None, NotUtf8, TooShort, TooLong, SameAsName };
PasswordProblem checkNewPassword(std::string_view password, std::string_view accountName);

// Overwrites memory with stores the compiler cannot drop. The string form wipes the bytes, then
// clears the string.
void secureZero(void* data, size_t len);
void secureZero(std::string& s);

namespace detail {
// The mmap allocator of the hashes, totals since the process started: for tests and the bench.
struct Argon2MemoryStats {
    uint64_t maps = 0;
    uint64_t unmaps = 0;
    uint64_t liveBytes = 0;
    uint64_t peakBytes = 0;
};
Argon2MemoryStats argon2MemoryStats();
// Argon2id with every input of RFC 9106 (secret, associated data, lanes), for its test vector;
// passwords never use the extra inputs.
std::string argon2idHashFull(std::string_view password, std::string_view salt,
                             std::string_view secret, std::string_view ad, uint32_t mKiB,
                             uint32_t t, uint32_t lanes, size_t outLen);
}  // namespace detail

// One hash at a time, on one thread at nice +10 (research R7, like the forwarder of 003). At most
// `maxWaiting` requests wait behind the one in progress; beyond that submit() refuses at once
// (AUTH_BUSY), so a burst of sign-ins piles up neither CPU time nor 19 MiB buffers.
constexpr size_t kHashMaxWaiting = 4;

class PasswordHasher {
   public:
    // Raw hash of `password` with the parameters and salt of `ref` (ref.hash is not used).
    using HashFn = std::function<std::string(std::string_view password, const PasswordHash& ref)>;

    // `hash` empty: argon2idHash. `log` gets a failure to lower the thread priority.
    explicit PasswordHasher(HashFn hash = {}, AuthLogFn log = {},
                            size_t maxWaiting = kHashMaxWaiting);
    // Lets the hash in progress finish; the waiting ones fail (their future throws).
    ~PasswordHasher();
    PasswordHasher(const PasswordHasher&) = delete;
    PasswordHasher& operator=(const PasswordHasher&) = delete;

    // Queues one hash: nullopt when `maxWaiting` already wait. The password is copied into the job
    // and the copy is wiped right after the hash. The future gives the raw hash, or throws what the
    // hash function threw.
    std::optional<std::future<std::string>> submit(std::string_view password,
                                                   const PasswordHash& ref);
    size_t waiting() const;  // queued, not started

   private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace mat
