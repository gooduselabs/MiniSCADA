// Lockout after failed sign-ins (feature 011: spec FR-014 to FR-016, research R5, ADR-036,
// contracts/device-api-011.md §2; replaces the per-name lockout of 005):
// - Pair (account name, source IP): 5 failures in a row lock that pair for 5 minutes; a lock again
//   within 24 hours of the last one doubles, up to 60 minutes. Never for good. The same name from
//   another address is not locked, so nobody can lock an engineer out from elsewhere (S-M1).
// - Source IP: 20 failures (any names) within 10 minutes lock every sign-in from that address for
//   5 minutes.
// - A right password clears its own pair only: not the address counter, not another pair. It takes
//   back the failure its own attempt was counted as before the hash (AuthService counts first, so
//   attempts in parallel cannot pass a limit), so signing in often never locks an address.
// - Distributed attack: 50 failures within 10 minutes on one name from at least 5 addresses is
//   reported (audit auth.distributed_attack), at most once per 10 minutes per name; it locks
//   nobody.
// - At most 4,096 pairs and 1,024 addresses (LRU: a full table first drops its least recently used
//   entry that is not locked, so a flood cannot lift a lock); 256 names watched for a distributed
//   attack. Times are CLOCK_BOOTTIME ms (monotonic: a change of the wall clock moves no lock).
// Keys are account names as AuthService passes them: only names an account could have
// (validAccountName: ASCII, so already in NFC form); anything else is "" and counts for the address
// only. Not thread-safe: AuthService holds its lock.
#pragma once
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mat {

constexpr int kPairMaxFailures = 5;
constexpr int64_t kPairLockMs = 5LL * 60 * 1000;
constexpr int64_t kPairLockMaxMs = 60LL * 60 * 1000;
constexpr int64_t kPairRepeatWindowMs = 24LL * 3600 * 1000;  // a lock within it doubles
constexpr int kSourceMaxFailures = 20;
constexpr int64_t kSourceWindowMs = 10LL * 60 * 1000;
constexpr int64_t kSourceLockMs = 5LL * 60 * 1000;
constexpr int kDistributedMinFailures = 50;
constexpr size_t kDistributedMinSources = 5;
constexpr int64_t kDistributedWindowMs = 10LL * 60 * 1000;  // and the time between two reports
constexpr size_t kPairTableSize = 4096;
constexpr size_t kSourceTableSize = 1024;
constexpr size_t kWatchTableSize = 256;
// 005 names, kept for the callers that still use them.
constexpr int kLoginMaxFailures = kPairMaxFailures;
constexpr int64_t kLockoutMs = kPairLockMs;

// The name the lockout counts under: `typed` when an account could have it (validAccountName),
// else "" (the address only). Account names are lower-case ASCII, so their NFC form is themselves;
// a typed name in another form (decomposed or precomposed letters, upper case) cannot be an
// account and is never kept.
std::string guardName(std::string_view typed);

// rev and unlockSeq of an account, as seen with its counter. When the account's are different now
// (--user-unlock, a new password, role or enabled flag, even across an execv), its pairs are gone.
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
    bool pair = false;
    bool source = false;
    int64_t pairLockMs = 0;  // pair: how long
};

struct DistributedAttack {  // auth.distributed_attack
    int failures = 0;       // on the name within the last 10 minutes (at least 50)
    size_t sources = 0;     // different addresses among them (at least 5)
};

struct PairEntry {
    std::string user;
    std::string ip;
    int failures = 0;             // in a row, since the last lock or success
    int64_t lockedUntilMono = 0;  // 0: not locked
    int lockCount = 0;            // locks within kPairRepeatWindowMs of each other
    int64_t lastLockMono = 0;
    std::optional<AccountGeneration> generation;  // nullopt: no such account
};

struct SourceEntry {
    std::string ip;
    std::vector<int64_t> failuresMono;  // within the last kSourceWindowMs, oldest first; kept
                                        // while locked, cleared when the lock has ended
    int64_t lockedUntilMono = 0;
    int64_t lockedByMono = 0;  // the attempt whose failure locked it (taken back on its success)
};

struct GuardState {  // least recently used first
    std::vector<PairEntry> pairs;
    std::vector<SourceEntry> sources;
};

class LoginGuard {
   public:
    // `generation`: of the account named `user` now; nullopt when there is none.
    GuardDecision check(const std::string& user, const std::string& sourceIp, int64_t nowMono,
                        const std::optional<AccountGeneration>& generation);
    // One more failure for the pair and the address, counted before the hash (`nowMono` names the
    // attempt for recordSuccess).
    LockoutNow recordFailure(const std::string& user, const std::string& sourceIp, int64_t nowMono,
                             const std::optional<AccountGeneration>& generation);
    // A right password for the attempt counted at `attemptMono`: its pair is gone, and the
    // failure the attempt added to the address is taken back (with the lock it may have set).
    void recordSuccess(const std::string& user, const std::string& sourceIp, int64_t attemptMono);
    // The hash said no: watch the name for a distributed attack. A report when one is due.
    std::optional<DistributedAttack> noteFailure(const std::string& user,
                                                 const std::string& sourceIp, int64_t nowMono);
    void clearUser(const std::string& user);  // every pair of the name (--user-unlock)
    void clearAll();                          // every pair and address (--user-unlock-all)

    GuardState state() const;
    void restore(GuardState state);  // keeps the last entries up to the table sizes

   private:
    struct Watch {
        std::string user;
        std::vector<std::pair<int64_t, uint32_t>> failures;  // (mono, hash of the address)
        int64_t lastReportMono = 0;
        bool reported = false;
    };
    std::vector<PairEntry> pairs_;  // least recently used first
    std::vector<SourceEntry> sources_;
    std::vector<Watch> watch_;
};

}  // namespace mat
