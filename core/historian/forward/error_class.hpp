// Classes of the errors of external databases (specs/003-data-logging/contracts/system-info.md,
// research R13). system/info shows the class and a fixed Vietnamese message, plus the numeric code
// of the database; the raw client text (user names, host names) only goes to the journal.
#pragma once
#include <string>

namespace mat {

enum class ErrorClass {
    None,
    NoClient,
    NoSecret,
    Connect,
    Auth,
    Tls,
    Timeout,
    Permission,
    SchemaMismatch,
    Sql,
    Http
};

ErrorClass classifyMysql(unsigned int code);  // mysql_errno
ErrorClass classifyMssql(int number);         // server message number or db-lib dberr
// dbopen() failed with db-lib error `number` and no server message. With TLS demanded (require,
// verify-full), SYBEFCON after the TCP connection is how FreeTDS ends a TLS handshake that failed,
// e.g. on a certificate it does not trust: Tls, so that the user looks at the certificate.
ErrorClass classifyMssqlOpen(int number, bool tlsDemanded);
ErrorClass classifyPg(const std::string& sqlstate);  // PG_DIAG_SQLSTATE
// libpq has no SQLSTATE when the connection itself fails: the message decides.
ErrorClass classifyPgConnect(const std::string& message);
ErrorClass classifyHttp(long status);
ErrorClass classifyCurl(int code);  // CURLcode

// The server refused one statement (schema, rights, data): the connection itself is fine.
bool isStatementError(ErrorClass c);
// Five characters 0-9 A-Z (a PostgreSQL SQLSTATE); anything else from the server is not a code.
bool isSqlState(const char* s);

// Text from a server or client library for the journal: control characters as \xNN (no forged
// journal lines), at most 512 bytes.
std::string journalSafe(const std::string& s);

const char* errorClassCode(ErrorClass c);     // "connect", …; "" for None
const char* errorClassMessage(ErrorClass c);  // fixed message; "" for None

}  // namespace mat
