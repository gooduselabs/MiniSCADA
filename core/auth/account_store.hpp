// Accounts of the device (specs/005-device-online data-model §4, research R8, ADR-011):
// /etc/mat-runtime/users.json, owner root:matscada, mode 0640. The device commands (root) write it;
// the runtime only reads it, and reads it again when it changes. Nothing here logs or returns a
// password hash.
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

constexpr const char* kUsersSchemaVersion = "1.0.0";
constexpr const char* kUsersFileDefault = "/etc/mat-runtime/users.json";
constexpr size_t kMaxAccounts = 64;
constexpr size_t kUsersFileMaxBytes = 256 * 1024;
constexpr int64_t kUsersRecheckMs = 2000;  // the runtime looks at the file at most this often

bool validAccountName(std::string_view name);  // ^[a-z][a-z0-9._-]{2,31}$

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
};

struct UsersFile {
    std::string schemaVersion = kUsersSchemaVersion;
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

// The text of users.json: schemaVersion 1.x.y; at most 64 accounts with valid, unique names, known
// roles, the keys of data-model §4 with their types (unknown keys are ignored: later 1.x versions
// may add some). Any of that wrong: Error, the file gives no account. A hash that parsePhc refuses
// damages only its account.
UsersRead parseUsers(std::string_view text);
// Reads a regular file of at most kUsersFileMaxBytes. `enforceMode`: refuse a file that others may
// read or write (mode & 0007), that its group may write (feature 011) or that root does not own,
// as the runtime must; the device commands read it anyway and write it back root:<group> 0640.
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
    int64_t loads() const;                             // reads of the file so far (tests)
    const std::string& path() const;

   private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace mat
