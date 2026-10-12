// `mat-runtime --check-package <file> [--schemas-dir <dir>]` (specs/005-device-online/contracts/
// device-config.md §4): checks a .matscada package by contracts/matscada-package.md. Read-only, no
// network, any user. A valid package prints its digest ("sha256:…") alone on stdout; an invalid
// one prints "<E_PKG_…> '<entry path>': <message>" (path left out for errors of the whole
// package), control characters of the path shown as \xNN.
// Exit codes: 0 valid; 1 invalid; 2 bad arguments; 6 the file or the schema cannot be read.
// `defaultSchemasDir`: where package-manifest.schema.json is without --schemas-dir (the runtime's
// schemas, <exe>/../schemas).
#pragma once
#include <ostream>
#include <string>

namespace mat {

int runCheckPackageCli(int argc, char** argv, std::ostream& out, std::ostream& err,
                       const std::string& defaultSchemasDir);

}  // namespace mat
