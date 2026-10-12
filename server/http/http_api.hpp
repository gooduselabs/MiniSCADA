// HTTP part of mat-runtime (specs/002-vertical-slice/contracts/http-api.md): runtime page with CSP,
// read-only API, and project files restricted to the validated allowlist. Installed on both
// listeners (feature 005, device-api §1.1): on HTTP every response closes its connection as in
// 0.3.0; on HTTPS the connection may stay open for the next request.
#pragma once
#include <functional>
#include <set>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"

struct mg_connection;
struct mg_context;

namespace mat {

class DeviceState;
class ViewerGate;

class HttpApi {
   public:
    struct Options {
        std::string docroot;
        std::string projectDir;
        std::vector<std::string> allowedOrigins;
        std::set<std::string> projectAllowlist;  // empty when the project is not active
        std::string activeProjectJson;           // empty when the project is not active
        nlohmann::json projectErrors = nlohmann::json::array();
        // Feature 005 (device-api §2): system/info gets the block "device" from it, and
        // "operation" (null unless the info provider gives one). Must outlive the contexts.
        const DeviceState* device = nullptr;
        // Feature 006 (FR-055a): the source filter of the page, the assets, the project files,
        // system/info and projects/active. Null: no filter (tests of the other features).
        ViewerGate* gate = nullptr;
    };
    using InfoProvider = std::function<nlohmann::json()>;

    HttpApi(Options opt, InfoProvider info);
    void install(mg_context* ctx);

   private:
    // 0: go on; otherwise the 403 was sent and this is the status to return.
    int filtered(mg_connection* c) const;
    static int onIndex(mg_connection* c, void* self);
    static int onAsset(mg_connection* c, void* self);
    static int onInfo(mg_connection* c, void* self);
    static int onActive(mg_connection* c, void* self);
    static int onProjectFile(mg_connection* c, void* self);

    Options opt_;
    InfoProvider info_;
    std::set<std::string> assets_;  // file names under docroot/assets
};

}  // namespace mat
