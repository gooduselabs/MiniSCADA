// The store of feature 013 on the device (contracts/access-model.md §1, ADR-042): the directory
// <dataDir>/auth (0700, owner matscada) with users.json 1.1.0 and access.json 1.0.0, each 0600.
// The runtime (admin API, last sign-in) and the device commands (root) change them the same way:
// under an exclusive flock on the directory, read again, check the `rev` the request was made on,
// write a temporary file in the directory, fsync, keep the file before as <file>.bak (a hard link,
// so the file is never missing for a reader), rename, fsync the directory. Run as root, the files
// and the directory are given to the service user.
//
// users.json is created once from the seed /etc/mat-runtime/users.json (the file of features 005
// to 012) when it is missing: the caller audits account.migrate. From then on the seed is not
// read again.
#pragma once
#include <sys/types.h>

#include <cstdint>
#include <functional>
#include <memory>
#include <string>

#include "core/auth/access_model.hpp"
#include "core/auth/account_store.hpp"

namespace mat {

constexpr const char* kAuthDirName = "auth";
constexpr const char* kAuthUsersFile = "users.json";
constexpr const char* kAuthAccessFile = "access.json";

struct AuthStoreOptions {
    std::string dir;                     // <dataDir>/auth
    std::string seedUsersFile;           // /etc/mat-runtime/users.json; empty: no seed
    std::string ownerUser = "matscada";  // when root: owner of what is written
    bool deviceCommand = false;          // the device commands (root): see readAuthFiles
};

enum class AccessFileState { Ok, Missing, Invalid };

// One read of the two files.
struct AuthFiles {
    UsersRead users;  // Missing: no account yet
    AccessFileState accessState = AccessFileState::Missing;
    AccessFile access;  // Missing: empty, rev 0
    std::string accessError;
};

// What a change sees and edits; the files it marks changed are written with rev + 1.
struct AuthTxn {
    AuthFiles before;  // as read under the lock
    UsersFile users;   // before.users.file (empty when Missing)
    AccessFile access;
    bool usersChanged = false;
    bool accessChanged = false;
    // lastLoginAt only: users.json is written with the same rev (no 409 for an edit in progress).
    bool keepUsersRev = false;
};

enum class TxnStatus { Ok, Aborted, Failed };

class AuthStore {
   public:
    explicit AuthStore(AuthStoreOptions options);
    ~AuthStore();
    AuthStore(const AuthStore&) = delete;
    AuthStore& operator=(const AuthStore&) = delete;

    const std::string& dir() const;
    std::string usersPath() const;
    std::string accessPath() const;

    // The directory (made 0700 when missing; refused when it is a link, not a directory, or group
    // or others may write it), then users.json from the seed when it is missing and the seed is a
    // valid file. `migrated`: users.json was just made from the seed. false + `err` (Vietnamese
    // for the device commands) when the directory cannot be used or the copy cannot be written; a
    // seed that cannot be read is not an error here (no account, as before).
    bool prepare(std::string& err, bool* migrated = nullptr, std::string* seedError = nullptr);

    // Both files as they are now, without the lock (the runtime's view).
    AuthFiles read() const;

    // Under the lock: prepare, read, call `edit`; when it returns true, write the changed files
    // (rev + 1 unless keepUsersRev). `edit` returning false: nothing written, Aborted. Failed +
    // `err` when the lock, the directory or a write failed (what was written before the failing
    // file stays: users.json first, then access.json).
    TxnStatus transact(const std::function<bool(AuthTxn&)>& edit, std::string& err);

    // access.json.bak back as access.json (rev of the backup + 1 past the damaged file's when it
    // can be read), under the lock. false + `err` when there is no backup or it is not valid.
    bool restoreAccessBackup(std::string& err, int64_t* rev = nullptr);

   private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

// access.json as the runtime reads it: a regular file (not a link) of at most 2 MiB that others
// cannot read or write and its group cannot write.
// `deviceCommand`: the reader is root (mat-runtime --user-*), which owns nothing here but may read
// every file; the mode and owner rules are the runtime's.
AuthFiles readAuthFiles(const std::string& usersPath, const std::string& accessPath,
                        bool deviceCommand = false);

// How often the runtime looks at access.json (one lstat): with the live hub asking about the access
// every second (kLiveGrantCheckMs), a rule the device command changes is in force within 2 s.
constexpr int64_t kAccessRecheckMs = 1000;

// The runtime's view of access.json, read again when the file changes (stat at most every
// kAccessRecheckMs, or at once after recheckNow). Not thread-safe.
class AccessStoreView {
   public:
    explicit AccessStoreView(std::string path);
    // true when the file was read again (its content may have changed).
    bool refresh(int64_t nowMonoMs);
    void recheckNow();
    AccessFileState state() const { return state_; }
    const AccessFile& file() const { return file_; }  // empty when not Ok
    const std::string& error() const { return error_; }
    int64_t loads() const { return loads_; }

   private:
    std::string path_;
    bool checked_ = false;
    int64_t lastCheck_ = 0;
    std::string signature_;
    AccessFileState state_ = AccessFileState::Missing;
    AccessFile file_;
    std::string error_;
    int64_t loads_ = 0;
};

}  // namespace mat
