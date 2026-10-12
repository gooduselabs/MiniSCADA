#include "core/historian/forward/dyn_lib.hpp"

#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <climits>
#include <cstdlib>
#include <cstring>
#include <mutex>

#include "core/historian/forward/curl_api.hpp"
#include "core/historian/forward/freetds_api.hpp"
#include "core/historian/forward/libpq_api.hpp"
#include "core/historian/forward/mysql_api.hpp"

namespace mat {

namespace {
// One lock for every library: their global initializers (mysql_server_init, dbinit,
// curl_global_init) must not run concurrently with each other.
std::mutex& loadMutex() {
    static std::mutex mu;
    return mu;
}

std::string missingSymbol(const char* soname, const SymbolTable& s) {
    return std::string(soname) + " không có hàm " + s.missing() + " (phiên bản không hỗ trợ)";
}
}  // namespace

// Code loaded into the runtime reads its secrets: only from a place nobody but root (or the user
// running the runtime) can change (security review hardening 3).
bool ownedByRootOnly(const std::string& path, std::string& why) {
    struct stat st {};
    if (::lstat(path.c_str(), &st) != 0) {
        why = path + ": " + std::strerror(errno);
        return false;
    }
    if (st.st_uid != 0) {
        why = path + " không thuộc root";
        return false;
    }
    if ((st.st_mode & (S_IWGRP | S_IWOTH)) != 0) {
        why = path + " ghi được bởi người khác";
        return false;
    }
    return true;
}

// The real file (links followed) and every directory above it: anyone who can write to one of
// them could put another library in its place.
bool trusted(const std::string& path, std::string& real, std::string& why) {
    char buf[PATH_MAX];
    if (!::realpath(path.c_str(), buf)) {
        why = path + ": " + std::strerror(errno);
        return false;
    }
    real = buf;
    struct stat st {};
    if (::stat(real.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) {
        why = real + " không phải file";
        return false;
    }
    for (std::string p = real; !p.empty(); p = p.substr(0, p.rfind('/'))) {
        if (!ownedByRootOnly(p, why)) return false;
        if (p.rfind('/') == 0) return ownedByRootOnly("/", why);
    }
    return true;
}

void* openClientLib(const std::string& dir, const char* soname, std::string& err) {
    std::string first;
    if (!dir.empty()) {
        const std::string path = dir + "/" + soname;
        std::string why;
        if (dir[0] != '/') {
            first = path + ": bỏ qua, thư mục không phải đường dẫn tuyệt đối";
        } else if (::access(path.c_str(), F_OK) != 0) {
            // the shipped copy is optional
        } else if (std::string real; !trusted(path, real, why)) {
            first = path + ": bỏ qua, " + why;
        } else if (void* h = ::dlopen(real.c_str(), RTLD_NOW | RTLD_LOCAL)) {
            return h;
        } else {
            const char* e = ::dlerror();
            first = e ? e : path;
        }
    }
    if (void* h = ::dlopen(soname, RTLD_NOW | RTLD_LOCAL)) return h;
    const char* e = ::dlerror();
    const std::string sys = e ? e : std::string(soname) + ": cannot open";
    err = first.empty() ? sys : first + "; " + sys;
    return nullptr;
}

namespace capi {

const MysqlApi* loadMysqlApi(const std::string& libDir, std::string& err) {
    static MysqlApi api;
    static bool ready = false;
    std::lock_guard<std::mutex> g(loadMutex());
    if (ready) return &api;
    const char* so = "libmariadb.so.3";
    void* h = openClientLib(libDir, so, err);
    if (!h) return nullptr;
    SymbolTable s(h);
    MysqlFns::ServerInit serverInit = nullptr;
    s.get(serverInit, "mysql_server_init");
    s.get(api.init, "mysql_init");
    s.get(api.options, "mysql_options");
    s.get(api.realConnect, "mysql_real_connect");
    s.get(api.realQuery, "mysql_real_query");
    s.get(api.storeResult, "mysql_store_result");
    s.get(api.fetchRow, "mysql_fetch_row");
    s.get(api.freeResult, "mysql_free_result");
    s.get(api.affectedRows, "mysql_affected_rows");
    s.get(api.errNo, "mysql_errno");
    s.get(api.error, "mysql_error");
    s.get(api.realEscapeString, "mysql_real_escape_string");
    s.get(api.close, "mysql_close");
    s.get(api.useResult, "mysql_use_result");
    s.get(api.fetchLengths, "mysql_fetch_lengths");
    s.get(api.setCharacterSet, "mysql_set_character_set");
    s.get(api.getSocket, "mysql_get_socket");
    if (!s.ok()) {
        err = missingSymbol(so, s);
        return nullptr;
    }
    if (serverInit(0, nullptr, nullptr) != 0) {  // mysql_library_init is a macro of this
        err = "mysql_server_init failed";
        return nullptr;
    }
    ready = true;
    return &api;
}

const SybdbApi* loadSybdbApi(const std::string& libDir, SybdbFns::ErrHandler errHandler,
                             SybdbFns::MsgHandler msgHandler, std::string& err) {
    static SybdbApi api;
    static bool ready = false;
    std::lock_guard<std::mutex> g(loadMutex());
    if (ready) return &api;
    const char* so = "libsybdb.so.5";
    void* h = openClientLib(libDir, so, err);
    if (!h) return nullptr;
    SymbolTable s(h);
    SybdbFns::Init init = nullptr;
    SybdbFns::ErrHandle errHandle = nullptr;
    SybdbFns::MsgHandle msgHandle = nullptr;
    SybdbFns::SetLoginTime setLoginTime = nullptr;
    SybdbFns::SetTime setTime = nullptr;
    s.get(init, "dbinit");
    s.get(errHandle, "dberrhandle");
    s.get(msgHandle, "dbmsghandle");
    s.get(setLoginTime, "dbsetlogintime");
    s.get(setTime, "dbsettime");
    s.get(api.login, "dblogin");
    s.get(api.loginFree, "dbloginfree");
    s.get(api.setLName, "dbsetlname");
    s.get(api.setLVersion, "dbsetlversion");
    s.get(api.open, "tdsdbopen");
    s.get(api.use, "dbuse");
    s.get(api.cmd, "dbcmd");
    s.get(api.sqlExec, "dbsqlexec");
    s.get(api.results, "dbresults");
    s.get(api.nextRow, "dbnextrow");
    s.get(api.count, "dbcount");
    s.get(api.data, "dbdata");
    s.get(api.datLen, "dbdatlen");
    s.get(api.colType, "dbcoltype");
    s.get(api.convert, "dbconvert");
    s.get(api.cancel, "dbcancel");
    s.get(api.close, "dbclose");
    s.get(api.dead, "dbdead");
    if (!s.ok()) {
        err = missingSymbol(so, s);
        return nullptr;
    }
    if (init() != kSucceed) {
        err = "dbinit failed";
        return nullptr;
    }
    // Process-wide settings of db-lib (research R12): handlers, login 5 s, queries 30 s.
    if (errHandler) errHandle(errHandler);
    if (msgHandler) msgHandle(msgHandler);
    setLoginTime(5);
    setTime(30);
    ready = true;
    return &api;
}

const PqApi* loadPqApi(const std::string& libDir, std::string& err) {
    static PqApi api;
    static bool ready = false;
    std::lock_guard<std::mutex> g(loadMutex());
    if (ready) return &api;
    const char* so = "libpq.so.5";
    void* h = openClientLib(libDir, so, err);
    if (!h) return nullptr;
    SymbolTable s(h);
    s.get(api.connectdbParams, "PQconnectdbParams");
    s.get(api.status, "PQstatus");
    s.get(api.errorMessage, "PQerrorMessage");
    s.get(api.finish, "PQfinish");
    s.get(api.exec, "PQexec");
    s.get(api.resultStatus, "PQresultStatus");
    s.get(api.resultErrorField, "PQresultErrorField");
    s.get(api.ntuples, "PQntuples");
    s.get(api.getValue, "PQgetvalue");
    s.get(api.getIsNull, "PQgetisnull");
    s.get(api.clear, "PQclear");
    s.get(api.escapeLiteral, "PQescapeLiteral");
    s.get(api.freeMem, "PQfreemem");
    s.get(api.setNoticeProcessor, "PQsetNoticeProcessor");
    s.get(api.connectStartParams, "PQconnectStartParams");
    s.get(api.connectPoll, "PQconnectPoll");
    s.get(api.socket, "PQsocket");
    s.get(api.sendQuery, "PQsendQuery");
    s.get(api.setSingleRowMode, "PQsetSingleRowMode");
    s.get(api.getResult, "PQgetResult");
    s.get(api.isBusy, "PQisBusy");
    s.get(api.consumeInput, "PQconsumeInput");
    s.get(api.parameterStatus, "PQparameterStatus");
    s.get(api.sslInUse, "PQsslInUse");
    s.get(api.getLength, "PQgetlength");
    s.get(api.setNonblocking, "PQsetnonblocking");
    s.get(api.flush, "PQflush");
    if (!s.ok()) {
        err = missingSymbol(so, s);
        return nullptr;
    }
    ready = true;
    return &api;
}

const CurlApi* loadCurlApi(const std::string& libDir, std::string& err) {
    static CurlApi api;
    static bool ready = false;
    std::lock_guard<std::mutex> g(loadMutex());
    if (ready) return &api;
    const char* so = "libcurl.so.4";
    void* h = openClientLib(libDir, so, err);
    if (!h) return nullptr;
    SymbolTable s(h);
    CurlFns::GlobalInit globalInit = nullptr;
    s.get(globalInit, "curl_global_init");
    s.get(api.easyInit, "curl_easy_init");
    s.get(api.easySetopt, "curl_easy_setopt");
    s.get(api.easyPerform, "curl_easy_perform");
    s.get(api.easyGetinfo, "curl_easy_getinfo");
    s.get(api.easyCleanup, "curl_easy_cleanup");
    s.get(api.easyStrerror, "curl_easy_strerror");
    s.get(api.slistAppend, "curl_slist_append");
    s.get(api.slistFreeAll, "curl_slist_free_all");
    s.get(api.easyEscape, "curl_easy_escape");
    s.get(api.free, "curl_free");
    if (!s.ok()) {
        err = missingSymbol(so, s);
        return nullptr;
    }
    if (globalInit(kCurlGlobalDefault) != kCurleOk) {
        err = "curl_global_init failed";
        return nullptr;
    }
    ready = true;
    return &api;
}

}  // namespace capi
}  // namespace mat
