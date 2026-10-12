// Lockout after failed sign-ins (specs/005-device-online data-model §5, research R9, FR-013): 5
// failures in a row lock for 5 minutes, counted per typed account name (names that do not exist
// too, so the lockout does not tell which names are real) and per source address, each in a table
// of 256 entries. A full table drops its least recently used entry that is not locked, so a flood
// of new names or addresses cannot lift a lock. Times are CLOCK_BOOTTIME ms. Not thread-safe:
// AuthService holds its lock.
#pragma once
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace mat {

constexpr int kLoginMaxFailures = 5;
constexpr int64_t kLockoutMs = 5LL * 60 * 1000;
constexpr size_t kGuardTableSize = 256;

// rev and unlockSeq of an account, as seen with its counter. When the account's are different now
// (--user-unlock, a new password, role or enabled flag, even across an execv), its counter and lock
// are gone.
struct AccountGeneration {
    int64_t rev = 0;
    int64_t unlockSeq = 0;
};
inline bool operator==(const AccountGeneration& a, const AccountGeneration& b) {
    return a.rev == b.rev && a.unlockSeq == b.unlockSeq;
}
inline bool operator!=(const AccountGeneration& a, const AccountGeneration& b) { return !(a == b); }

struct GuardDecision {
    bool locked = false;
    int64_t retryAfterS = 0;  // locked: the longer of the two remaining locks, whole seconds up
};

struct LockoutNow {  // which counter the failure has just locked (audit auth.lockout)
    bool user = false;
    bool source = false;
};

struct GuardEntry {
    std::string key;  // typed name, or IP address
    int failures = 0;
    int64_t lockedUntilMono = 0;                  // 0: not locked
    std::optional<AccountGeneration> generation;  // name table; nullopt: no such account
};

struct GuardState {  // least recently used first
    std::vector<GuardEntry> byUser;
    std::vector<GuardEntry> bySource;
};

// An empty `user` counts for the address only: AuthService passes "" for a typed name that cannot
// be an account (validAccountName), which may well be a password typed in the wrong field and must
// not be kept, nor written to auth-state.json.
class LoginGuard {
   public:
    // `generation`: of the account named `user` now; nullopt when there is none.
    GuardDecision check(const std::string& user, const std::string& sourceIp, int64_t nowMono,
                        const std::optional<AccountGeneration>& generation);
    // One more failure for the name and for the address; the 5th locks for 5 minutes and starts
    // the count again.
    LockoutNow recordFailure(const std::string& user, const std::string& sourceIp, int64_t nowMono,
                             const std::optional<AccountGeneration>& generation);
    // A right password: the counters (and locks) of this name and this address are gone.
    void recordSuccess(const std::string& user, const std::string& sourceIp);
    void clearUser(const std::string& user);

    GuardState state() const;
    void restore(GuardState state);  // keeps the last kGuardTableSize entries of each table

   private:
    std::vector<GuardEntry> byUser_;  // least recently used first
    std::vector<GuardEntry> bySource_;
};

}  // namespace mat
