// Accounts of the device (specs/005-device-online data-model §4, research R8, ADR-011). Feature
// 013 (contracts/access-model.md §1, ADR-042): the file is <dataDir>/auth/users.json, owner
// matscada, mode 0600, written by the runtime (the admin API) and by the device commands (root,
// which give it back to matscada) under the lock of core/auth/access_store; /etc/mat-runtime/
// users.json (root:matscada 0640) is only the seed copied there once. The runtime reads it again
// when it changes. Nothing here logs or returns a password hash.
#pragma once
#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "core/auth/auth_log.hpp"
#include "core/auth/password_hash.hpp"
#include "core/auth/roles.hpp"

namespace mat {

constexpr const char* kUsersSchemaVersion = "1.1.0";  // written; 1.x.y is read
constexpr const char* kUsersFileDefault = "/etc/mat-runtime/users.json";
constexpr size_t kMaxAccounts = 200;               // feature 013 (was 64)
constexpr size_t kUsersFileMaxBytes = 512 * 1024;  // feature 013 (was 256 KiB)
constexpr size_t kMaxGroupsPerAccount = 16;
constexpr int64_t kUsersRecheckMs = 2000;  // the runtime looks at the file at most this often

bool validAccountName(std::string_view name);  // ^[a-z][a-z0-9._-]{2,31}$
// Feature 023: an email address as accounts and the email rules keep it: 3..254 bytes, printable
// ASCII without spaces, quotes, angle brackets, commas, semicolons or colons, exactly one '@' with
// text on both sides and a '.' inside the domain part.
bool validAccountEmail(std::string_view email);

struct Account {
    std::string name;
    Role role = Role::Viewer;
    bool enabled = true;
    std::string passwordHash;          // PHC text as stored
    std::optional<PasswordHash> hash;  // nullopt: damaged hash, the account cannot sign in
    int64_t rev = 1;                   // + 1 on a password, role or enabled change
    int64_t unlockSeq = 0;             // + 1 on --user-unlock
    std::string createdAt;             // ISO 8601 UTC
    std::string updatedAt;
    // Feature 013 (users.json 1.1.0): the groups of access.json it belongs to (missing = none), and
    // the last sign-in (UTC ms; the runtime writes it at most once an hour per account).
    std::vector<std::string> groups;
    std::optional<int64_t> lastLoginAt;
    // Feature 023 (alarm email): the address alarm emails of the account's groups go to; "" none.
    // An optional key of users.json 1.1.0 (older 1.x readers ignore it); rev does not change.
    std::string email;
};

struct UsersFile {
    std::string schemaVersion = kUsersSchemaVersion;
    // Feature 013: + 1 on every change a person makes (the admin API answers 409 CONFLICT to a
    // request made on another rev); 0 in a 1.0.0 file. lastLoginAt alone keeps it.
    int64_t rev = 0;
    std::vector<Account> users;

    const Account* find(std::string_view name) const;
    Account* find(std::string_view name);
};

enum class UsersStatus { Ok, Missing, Error };

struct UsersRead {
    UsersStatus status = UsersStatus::Missing;
    UsersFile file;                    // Ok only
    std::string error;                 // Error: why; never a hash
    std::vector<std::string> damaged;  // Ok: "<name>: <why>" of each account with an unusable hash
};

// The text of users.json: schemaVersion 1.x.y; at most 200 accounts with valid, unique names, known
// roles, the keys of data-model §4 with their types (unknown keys are ignored: later 1.x versions
// may add some); 1.1.0: rev, groups (at most 16 valid, unique group ids), lastLoginAt. Any of that
// wrong: Error, the file gives no account. A hash that parsePhc refuses damages only its account.
UsersRead parseUsers(std::string_view text);
// Reads a regular file of at most kUsersFileMaxBytes. `enforceMode`: refuse a file that others may
// read or write (mode & 0007), that its group may write (feature 011) or that neither root nor the
// user of this process owns (feature 013: the runtime owns auth/users.json), as the runtime must;
// the device commands read it anyway.
UsersRead readUsersFile(const std::string& path, bool enforceMode = true);

std::string usersJson(const UsersFile& f);

struct UsersWriteOptions {
    std::string group = "matscada";  // group owner, set when running as root
};
// Temporary file in the same directory, fsync, chown root:<group> (only as root; skipped with a
// `warning` when the group does not exist), chmod 0640, rename, fsync of the directory. `err`
// (and `warning`) in Vietnamese, for the device commands.
bool writeUsersFile(const std::string& path, const UsersFile& f, std::string& err,
                    std::string* warning = nullptr, const UsersWriteOptions& opts = {});

// Changes made by the device commands (contracts/device-config.md §4). `nowIso` becomes updatedAt
// (and createdAt of a new account). Setting a role or enabled flag an account already has changes
// nothing (rev stays). No change may leave the file without an enabled administrator when it had
// one.
enum class AccountEditError {
    None,
    InvalidName,
    Exists,
    NotFound,
    TooMany,
    LastAdministrator,
    BadHash,
};
const char* accountEditMessage(AccountEditError e);  // Vietnamese
AccountEditError addAccount(UsersFile& f, const std::string& name, Role role,
                            const std::string& phc, const std::string& nowIso);
AccountEditError setAccountPassword(UsersFile& f, const std::string& name, const std::string& phc,
                                    const std::string& nowIso);  // rev + 1
AccountEditError setAccountRole(UsersFile& f, const std::string& name, Role role,
                                const std::string& nowIso);  // rev + 1
AccountEditError setAccountEnabled(UsersFile& f, const std::string& name, bool enabled,
                                   const std::string& nowIso);  // rev + 1
AccountEditError unlockAccount(UsersFile& f, const std::string& name,
                               const std::string& nowIso);  // unlockSeq + 1
// Feature 013: the groups of an account (rev + 1: its sessions end, D23). The caller checks that
// the groups exist; the same groups change nothing.
AccountEditError setAccountGroups(UsersFile& f, const std::string& name,
                                  const std::vector<std::string>& groups,
                                  const std::string& nowIso);
AccountEditError removeAccount(UsersFile& f, const std::string& name);
bool hasEnabledAdministrator(const UsersFile& f);

// What a re-read changed, for the sessions and the lockout counters (research R8).
struct AccountChanges {
    std::vector<std::string> revoked;   // rev changed or the account is gone: end its sessions
    std::vector<std::string> unlocked;  // still there, rev or unlockSeq changed: clear its lockout
    bool empty() const { return revoked.empty() && unlocked.empty(); }
};

// The runtime's read-only view of users.json. Not thread-safe: AuthService holds its lock.
class AccountStore {
   public:
    AccountStore(std::string path, AuthLogFn log = {});
    ~AccountStore();
    AccountStore(const AccountStore&) = delete;
    AccountStore& operator=(const AccountStore&) = delete;

    // Looks at the file (stat) at most once per kUsersRecheckMs and reads it again when its
    // inode, size, mode, mtime or ctime changed; the first call always reads. A file that cannot
    // be used counts as no account at all. Logs each new problem once.
    AccountChanges refresh(int64_t nowMonoMs);
    UsersStatus status() const;
    const Account* find(std::string_view name) const;  // nullptr: no such account
    size_t size() const;                               // accounts usable now
    std::vector<std::string> names() const;            // feature 013: in file order
    int64_t loads() const;                             // reads of the file so far (tests)
    const std::string& path() const;
    // Feature 013: rev of the file (0 while it cannot be used), and a re-read at the next refresh
    // whatever the time since the last look (after the admin API wrote the file).
    int64_t fileRev() const;
    void recheckNow();

   private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace mat
