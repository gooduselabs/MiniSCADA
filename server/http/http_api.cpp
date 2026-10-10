#include "server/http/http_api.hpp"

#include <dirent.h>
#include <sys/stat.h>

#include <cstdio>
#include <cstring>

#include "civetweb.h"

namespace mat {

const char* const kCspRuntime =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' "
    "data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; "
    "form-action 'none'";
const char* const kCspProject =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";

namespace {

bool isGetOrHead(mg_connection* c) {
    const char* m = mg_get_request_info(c)->request_method;
    return std::strcmp(m, "GET") == 0 || std::strcmp(m, "HEAD") == 0;
}

bool isHead(mg_connection* c) {
    return std::strcmp(mg_get_request_info(c)->request_method, "HEAD") == 0;
}

int methodNotAllowed(mg_connection* c) {
    mg_printf(c,
              "HTTP/1.1 405 Method Not Allowed\r\nAllow: GET, HEAD\r\nContent-Length: 0\r\n"
              "X-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n");
    return 405;
}

int sendJson(mg_connection* c, int status, const std::string& body, const std::string& extra) {
    mg_printf(
        c,
        "HTTP/1.1 %d %s\r\nContent-Type: application/json; charset=utf-8\r\n"
        "Content-Length: %zu\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n"
        "%sConnection: close\r\n\r\n",
        status, status == 200 ? "OK" : "Service Unavailable", body.size(), extra.c_str());
    if (!isHead(c)) mg_write(c, body.data(), body.size());
    return status;
}

int notFound(mg_connection* c) {
    const char* body = "Not found";
    mg_printf(c,
              "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: %zu\r\n"
              "X-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n%s",
              std::strlen(body), body);
    return 404;
}

}  // namespace

int serveFile(mg_connection* c, const std::string& path, const char* contentType,
              const std::string& extraHeaders, bool allowGzip) {
    std::string file = path;
    bool gz = false;
    if (allowGzip) {
        const char* ae = mg_get_header(c, "Accept-Encoding");
        struct stat gst {};
        if (ae && std::strstr(ae, "gzip") && stat((path + ".gz").c_str(), &gst) == 0) {
            file = path + ".gz";
            gz = true;
        }
    }
    struct stat st {};
    if (stat(file.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) return notFound(c);
    char etag[64];
    std::snprintf(etag, sizeof etag, "\"%lx-%lx%s\"", static_cast<unsigned long>(st.st_size),
                  static_cast<unsigned long>(st.st_mtime), gz ? "-gz" : "");
    const std::string common = std::string("ETag: ") + etag + "\r\nVary: Accept-Encoding\r\n" +
                               "X-Content-Type-Options: nosniff\r\n" + extraHeaders;
    const char* inm = mg_get_header(c, "If-None-Match");
    if (inm && std::strcmp(inm, etag) == 0) {
        mg_printf(c, "HTTP/1.1 304 Not Modified\r\n%sContent-Length: 0\r\n\r\n", common.c_str());
        return 304;
    }
    std::FILE* in = std::fopen(file.c_str(), "rb");
    if (!in) return notFound(c);
    mg_printf(c, "HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %llu\r\n%s%s\r\n",
              contentType, static_cast<unsigned long long>(st.st_size),
              gz ? "Content-Encoding: gzip\r\n" : "", common.c_str());
    if (!isHead(c)) {
        // Stream in chunks: memory per request stays small whatever the file size (review m-3).
        char buf[16384];
        size_t n;
        while ((n = std::fread(buf, 1, sizeof buf, in)) > 0)
            if (mg_write(c, buf, n) <= 0) break;
    }
    std::fclose(in);
    return 200;
}

HttpApi::HttpApi(Options opt, InfoProvider info) : opt_(std::move(opt)), info_(std::move(info)) {
    // Allowlist of the static assets produced by the web build (hashed names, no sub-folders).
    // CivetWeb is built with NO_FILES: it never maps URLs to files itself (security review H1).
    if (DIR* d = opendir((opt_.docroot + "/assets").c_str())) {
        while (dirent* e = readdir(d)) {
            const std::string name = e->d_name;
            struct stat st {};
            const bool gz = name.size() > 3 && name.compare(name.size() - 3, 3, ".gz") == 0;
            if (!name.empty() && name[0] != '.' && name.size() <= 128 && !gz &&
                stat((opt_.docroot + "/assets/" + name).c_str(), &st) == 0 && S_ISREG(st.st_mode))
                assets_.insert(name);
        }
        closedir(d);
    }
}

void HttpApi::install(mg_context* ctx) {
    mg_set_request_handler(ctx, "/$", onIndex, this);
    mg_set_request_handler(ctx, "/index.html$", onIndex, this);
    mg_set_request_handler(ctx, "/assets/", onAsset, this);
    mg_set_request_handler(ctx, "/api/v1/system/info$", onInfo, this);
    mg_set_request_handler(ctx, "/api/v1/projects/active$", onActive, this);
    mg_set_request_handler(ctx, "/project/", onProjectFile, this);
}

int HttpApi::onIndex(mg_connection* c, void* self) {
    auto* api = static_cast<HttpApi*>(self);
    if (!isGetOrHead(c)) return methodNotAllowed(c);
    const std::string extra =
        std::string("Content-Security-Policy: ") + kCspRuntime + "\r\nCache-Control: no-cache\r\n";
    return serveFile(c, api->opt_.docroot + "/index.html", "text/html; charset=utf-8", extra, true);
}

int HttpApi::onInfo(mg_connection* c, void* self) {
    auto* api = static_cast<HttpApi*>(self);
    if (!isGetOrHead(c)) return methodNotAllowed(c);
    std::string extra = "Vary: Origin\r\n";
    if (const char* origin = mg_get_header(c, "Origin"))
        for (const auto& a : api->opt_.allowedOrigins)
            if (a == origin) extra += "Access-Control-Allow-Origin: " + a + "\r\n";
    return sendJson(c, 200, api->info_().dump(), extra);
}

int HttpApi::onActive(mg_connection* c, void* self) {
    auto* api = static_cast<HttpApi*>(self);
    if (!isGetOrHead(c)) return methodNotAllowed(c);
    if (api->opt_.activeProjectJson.empty()) {
        nlohmann::json body = {{"error", "NO_VALID_PROJECT"}, {"errors", api->opt_.projectErrors}};
        return sendJson(c, 503, body.dump(), "");
    }
    return sendJson(c, 200, api->opt_.activeProjectJson, "");
}

namespace {
const char* assetType(const std::string& name) {
    auto ends = [&](const char* ext) {
        const size_t n = std::strlen(ext);
        return name.size() > n && name.compare(name.size() - n, n, ext) == 0;
    };
    if (ends(".js")) return "text/javascript; charset=utf-8";
    if (ends(".css")) return "text/css; charset=utf-8";
    if (ends(".svg")) return "image/svg+xml";
    if (ends(".png")) return "image/png";
    if (ends(".woff2")) return "font/woff2";
    return "application/octet-stream";
}
}  // namespace

int HttpApi::onAsset(mg_connection* c, void* self) {
    auto* api = static_cast<HttpApi*>(self);
    if (!isGetOrHead(c)) return methodNotAllowed(c);
    const char* uri = mg_get_request_info(c)->local_uri;
    const std::string prefix = "/assets/";
    if (!uri || std::strncmp(uri, prefix.c_str(), prefix.size()) != 0) return notFound(c);
    const std::string name = uri + prefix.size();
    if (!api->assets_.count(name)) return notFound(c);  // allowlist built at startup
    return serveFile(c, api->opt_.docroot + "/assets/" + name, assetType(name),
                     "Cache-Control: public, max-age=31536000, immutable\r\n", true);
}

int HttpApi::onProjectFile(mg_connection* c, void* self) {
    auto* api = static_cast<HttpApi*>(self);
    if (!isGetOrHead(c)) return methodNotAllowed(c);
    const char* uri = mg_get_request_info(c)->local_uri;
    const std::string prefix = "/project/";
    if (!uri || std::strncmp(uri, prefix.c_str(), prefix.size()) != 0) return notFound(c);
    const std::string rel = uri + prefix.size();
    // Only files listed by the validated project are served: no traversal, no directory listing.
    if (!api->opt_.projectAllowlist.count(rel)) return notFound(c);
    const std::string extra =
        std::string("Content-Security-Policy: ") + kCspProject + "\r\nCache-Control: no-cache\r\n";
    return serveFile(c, api->opt_.projectDir + "/" + rel, "image/svg+xml", extra, false);
}

}  // namespace mat
