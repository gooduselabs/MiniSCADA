// HTTP part of mat-runtime (specs/002-vertical-slice/contracts/http-api.md): runtime page with CSP,
// read-only API, and project files restricted to the validated allowlist.
#pragma once
#include <functional>
#include <set>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"

struct mg_connection;
struct mg_context;

namespace mat {

extern const char* const kCspRuntime;
extern const char* const kCspProject;

class HttpApi {
   public:
    struct Options {
        std::string docroot;
        std::string projectDir;
        std::vector<std::string> allowedOrigins;
        std::set<std::string> projectAllowlist;  // empty when the project is not active
        std::string activeProjectJson;           // empty when the project is not active
        nlohmann::json projectErrors = nlohmann::json::array();
    };
    using InfoProvider = std::function<nlohmann::json()>;

    HttpApi(Options opt, InfoProvider info);
    void install(mg_context* ctx);

   private:
    static int onIndex(mg_connection* c, void* self);
    static int onAsset(mg_connection* c, void* self);
    static int onInfo(mg_connection* c, void* self);
    static int onActive(mg_connection* c, void* self);
    static int onProjectFile(mg_connection* c, void* self);

    Options opt_;
    InfoProvider info_;
    std::set<std::string> assets_;  // file names under docroot/assets
};

// Serves one regular file with ETag/304, optional pre-compressed .gz, and extra headers.
// Returns the HTTP status sent.
int serveFile(mg_connection* c, const std::string& path, const char* contentType,
              const std::string& extraHeaders, bool allowGzip);

}  // namespace mat
