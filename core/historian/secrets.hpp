// Passwords and tokens of the external databases, kept on the device only (specs/003-data-logging
// contracts/device.md, research R11): {"schemaVersion":"0.1.0","connections":{"<id>":"<secret>"}},
// owner root:matscada, mode 0640. Nothing here ever logs or returns a secret in an error.
#pragma once
#include <string>

namespace mat {

struct SecretResult {
    bool ok = false;
    std::string secret;
    std::string reason;  // no_entry, missing_file, permissions, invalid, too_big
};

// Connection id pattern of logging.json: ^[a-z0-9][a-z0-9-]{0,47}$.
bool validConnectionId(const std::string& id);

// Reads the secret of one connection. A file that others can read or write (mode & 0007) or that is
// larger than 64 KB is refused.
SecretResult readSecret(const std::string& file, const std::string& connectionId);

// Sets one entry and keeps the others: temporary file, fsync, owner root:matscada when running as
// root and the group exists, mode 0640, rename. A broken existing file is left alone (false).
// `warning` (optional): written, but the service cannot read the file yet (no matscada group).
bool writeSecret(const std::string& file, const std::string& connectionId,
                 const std::string& secret, std::string& err, std::string* warning = nullptr);

}  // namespace mat
