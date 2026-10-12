// The project routes of the engineering API (specs/005-device-online contracts/device-api.md §4,
// §5, §8; research R13): versions, manifest, package (upload to the Studio), deployments (download
// to the device), operation, restore. Every request has passed the gate (role engineer, HTTPS).
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cctype>
#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <optional>
#include <string>
#include <vector>

#include "civetweb.h"
#include "core/audit/audit_log.hpp"
#include "core/common/json_limits.hpp"
#include "core/common/json_text.hpp"
#include "core/package/package_rules.hpp"
#include "core/package/zip_reader.hpp"
#include "core/project-store/deploy_pipeline.hpp"
#include "core/project-store/store.hpp"
#include "nlohmann/json.hpp"
#include "server/http/engineering_api.hpp"
#include "server/http/engineering_api_internal.hpp"

namespace mat {

namespace {

using eapi::readBody;
using eapi::send;
using eapi::sendError;
using nlohmann::json;

constexpr const char* kVersionsPath = "/api/v1/project/versions";
constexpr const char* kManifestPath = "/api/v1/project/manifest";
constexpr const char* kPackagePath = "/api/v1/project/package";
constexpr const char* kDeployPath = "/api/v1/project/deployments";
constexpr const char* kOperationPathPattern = "/api/v1/project/deployments/{opId}";
constexpr const char* kOperationBase = "/api/v1/project/deployments/";
constexpr const char* kLatestOperationPath = "/api/v1/project/operation";
constexpr const char* kRestorePath = "/api/v1/project/restore";
constexpr int kMaxBodyDepth = 8;
constexpr size_t kUploadChunk = 64 * 1024;

// "sha256:" and 64 lower-case hex digits.
bool isDigest(const std::string& s) {
    if (s.size() != 7 + 64 || s.compare(0, 7, "sha256:") != 0) return false;
    for (size_t i = 7; i < s.size(); ++i)
        if (!((s[i] >= '0' && s[i] <= '9') || (s[i] >= 'a' && s[i] <= 'f'))) return false;
    return true;
}

// The media type of a Content-Type header without its parameters, in lower case.
std::string mediaType(const char* header) {
    std::string t = header ? header : "";
    const size_t semi = t.find(';');
    if (semi != std::string::npos) t.resize(semi);
    while (!t.empty() && (t.back() == ' ' || t.back() == '\t')) t.pop_back();
    size_t start = 0;
    while (start < t.size() && (t[start] == ' ' || t[start] == '\t')) ++start;
    t.erase(0, start);
    for (auto& c : t) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return t;
}

// `seq` of the query string: absent, a number, or malformed (empty, signed, not digits, too big).
struct SeqParam {
    bool present = false;
    bool bad = false;
    int64_t value = 0;
};
SeqParam seqParam(const char* query) {
    SeqParam out;
    if (!query) return out;
    const std::string q = query;
    size_t at = 0;
    while (at <= q.size()) {
        size_t end = q.find('&', at);
        if (end == std::string::npos) end = q.size();
        const std::string part = q.substr(at, end - at);
        if (part.compare(0, 4, "seq=") == 0) {
            out.present = true;
            const std::string v = part.substr(4);
            if (v.empty() || v.size() > 18) {
                out.bad = true;
                return out;
            }
            for (char c : v)
                if (c < '0' || c > '9') {
                    out.bad = true;
                    return out;
                }
            out.value = std::strtoll(v.c_str(), nullptr, 10);
            return out;
        }
        at = end + 1;
    }
    return out;
}

json optText(const std::optional<std::string>& s) { return s ? json(*s) : json(nullptr); }

json versionJson(const VersionView& view) {
    const ProjectVersion& v = view.version;
    json j = {{"seq", v.seq},
              {"state", view.active ? "active" : "backup"},
              {"digest", v.digest},
              {"projectId", v.projectId},
              {"projectName", v.projectName},
              {"projectVersion", v.projectVersion},
              {"minRuntimeVersion", v.minRuntimeVersion},
              {"size", v.size},
              {"activatedAt", optText(v.activatedAt)},
              {"clockOk", v.clockOk},
              {"deployedBy", optText(v.deployedBy)},
              {"deployedFrom", optText(v.deployedFrom)},
              {"source", versionSourceName(v.source)}};
    if (!view.active) j["restorable"] = view.restorable;
    return j;
}

// The file name of a download: the project's id and version, nothing that could end the header.
std::string fileNamePart(const std::string& s) {
    std::string out;
    for (char c : s)
        out += (std::isalnum(static_cast<unsigned char>(c)) || c == '.' || c == '-' || c == '_')
                   ? c
                   : '_';
    return out.empty() ? "project" : out;
}

int statusOf(const std::string& code) {
    if (code == "NO_SPACE") return 507;
    if (code == "RECEIVE_TIMEOUT") return 408;
    if (code == "STORE_IO") return 500;
    return 400;
}

// The answer to a refusal of DeployPipeline::begin (device-api §4).
int beginRefused(mg_connection* c, const BeginResult& r, bool close) {
    const std::string code = beginErrorCode(r.status);
    int status = 500;
    json more = json::object();
    switch (r.status) {
        case BeginStatus::Busy:
            status = 409;
            if (r.busy) more = json::parse(busyInfoJson(*r.busy));
            break;
        case BeginStatus::BaseChanged:
        case BeginStatus::AlreadyActive:
        case BeginStatus::NoBaseProject:
            status = 409;
            break;
        case BeginStatus::NoSuchVersion:
            status = 404;
            break;
        case BeginStatus::NoSpace:
            status = 507;
            break;
        case BeginStatus::AuditUnavailable:
            status = 503;
            break;
        case BeginStatus::StoreError:
        case BeginStatus::Started:
            break;
    }
    if (!r.message.empty() && r.status != BeginStatus::AuditUnavailable)
        more["message"] = r.message;
    return sendError(c, status, code, close, "", more);
}

std::string acceptedBody(const std::string& opId) {
    return jsonText({{"opId", opId}, {"status", std::string(kOperationBase) + opId}});
}

}  // namespace

int EngineeringApi::projectRoute(mg_connection* c, const GateRequest& r, const GateDecision& d,
                                 bool close) {
    if (!project_.store || !project_.pipeline) return sendError(c, 501, "NOT_IMPLEMENTED", close);
    const std::string path = d.rule->path;
    if (path == kVersionsPath) return versions(c, close);
    if (path == kManifestPath) return manifest(c, close);
    if (path == kPackagePath) return package(c, r, d, close);
    if (path == kDeployPath) return deploy(c, r, d);
    if (path == kOperationPathPattern)
        return operation(c, r.path.substr(std::strlen(kOperationBase)), close);
    if (path == kLatestOperationPath) return operation(c, "", close);
    if (path == kRestorePath) return restore(c, r, d, close);
    return sendError(c, 501, "NOT_IMPLEMENTED", close);
}

// ---------- GET /project/versions, manifest, package ----------

int EngineeringApi::versions(mg_connection* c, bool close) {
    const StoreState s = project_.store->state();
    json list = json::array();
    for (const auto& v : project_.store->versionList()) list.push_back(versionJson(v));
    const json body = {{"active", s.active ? json(*s.active) : json(nullptr)},
                       {"backupsMax", project_.store->projectBackups()},
                       {"versions", list}};
    return send(c, 200, jsonText(body), close);
}

namespace {

// The version a request names (`seq`, or the running one) and the refusal when there is none.
struct Pick {
    bool ok = false;
    ProjectVersion version;
    int status = 0;
    std::string code;
    std::string message;
};

Pick pickVersion(ProjectStore& store, const char* query) {
    Pick p;
    const SeqParam q = seqParam(query);
    if (q.bad) {
        p.status = 400;
        p.code = "BAD_REQUEST";
        return p;
    }
    const StoreState s = store.state();
    int64_t seq = 0;
    if (q.present) {
        seq = q.value;
    } else if (s.active) {
        seq = *s.active;
    } else {
        p.status = 404;
        p.code = "NO_PROJECT_PACKAGE";
        p.message = store.noPackageReason();
        return p;
    }
    const ProjectVersion* v = s.find(seq);
    if (!v || !store.isComplete(seq)) {
        if (s.versions.empty()) {
            p.status = 404;
            p.code = "NO_PROJECT_PACKAGE";
            p.message = store.noPackageReason();
        } else {
            p.status = 404;
            p.code = "NO_SUCH_VERSION";
        }
        return p;
    }
    p.ok = true;
    p.version = *v;
    return p;
}

int sendPick(mg_connection* c, const Pick& p, bool close) {
    json more = json::object();
    if (!p.message.empty()) more["message"] = p.message;
    return sendError(c, p.status, p.code, close, "", more);
}

}  // namespace

int EngineeringApi::manifest(mg_connection* c, bool close) {
    const Pick p = pickVersion(*project_.store, mg_get_request_info(c)->query_string);
    if (!p.ok) return sendPick(c, p, close);
    // The bytes of matscada.json as stored: the first entry of the package.
    std::string error;
    const auto src = FileSource::open(project_.store->packagePath(p.version.seq), error);
    std::vector<ZipEntry> entries;
    std::string text;
    if (!src || readZipDirectory(*src, entries) || entries.empty() ||
        entries[0].name != "matscada.json" || readZipEntry(*src, entries[0], text))
        return sendError(c, 500, "STORE_IO", close);
    return send(c, 200, text, close);
}

int EngineeringApi::package(mg_connection* c, const GateRequest& r, const GateDecision& d,
                            bool close) {
    const Pick p = pickVersion(*project_.store, mg_get_request_info(c)->query_string);
    if (!p.ok) return sendPick(c, p, close);
    const std::string path = project_.store->packagePath(p.version.seq);
    const int fd = ::open(path.c_str(), O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) return sendError(c, 500, "STORE_IO", close);
    struct Closer {
        int fd;
        ~Closer() { ::close(fd); }
    } closer{fd};
    struct stat st {};
    if (::fstat(fd, &st) != 0 || !S_ISREG(st.st_mode)) return sendError(c, 500, "STORE_IO", close);

    // The record first: a package leaves the device only with its audit row (Constitution V).
    AuditEvent e(AuditAction::ProjectRead, AuditResult::Ok, AuditChannel::Https, r.from.text());
    e.user = d.access.user;
    if (d.access.role) e.role = roleName(*d.access.role);
    e.target = p.version.digest;
    try {
        audit_.append(e);
    } catch (const std::exception&) {
        return sendError(c, 503, "AUDIT_UNAVAILABLE", close);
    }

    const std::string name = fileNamePart(p.version.projectId) + "-" +
                             fileNamePart(p.version.projectVersion) + ".matscada";
    mg_printf(
        c,
        "HTTP/1.1 200 OK\r\nContent-Type: application/zip\r\nContent-Length: %lld\r\n"
        "Content-Disposition: attachment; filename=\"%s\"\r\nX-Mat-Digest: %s\r\n"
        "ETag: \"%s\"\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n%s\r\n",
        static_cast<long long>(st.st_size), name.c_str(), p.version.digest.c_str(),
        p.version.digest.c_str(), close ? "Connection: close\r\n" : "");
    std::vector<char> buf(kUploadChunk);
    long long left = st.st_size;
    while (left > 0) {
        const ssize_t n = ::read(fd, buf.data(), std::min<long long>(left, buf.size()));
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) {  // the file shrank: the length is already promised, so end the connection
            mg_disable_connection_keep_alive(c);
            break;
        }
        if (mg_write(c, buf.data(), static_cast<size_t>(n)) <= 0) break;
        left -= n;
    }
    return 200;
}

// ---------- POST /project/deployments ----------

int EngineeringApi::deploy(mg_connection* c, const GateRequest& r, const GateDecision& d) {
    const mg_request_info* ri = mg_get_request_info(c);
    // Whatever refuses a request before its body is read ends the connection: the rest of the
    // body is not drained (it may be 50 MiB).
    auto refuse = [&](int status, const char* code) {
        mg_disable_connection_keep_alive(c);
        return sendError(c, status, code, true);
    };
    if (mediaType(mg_get_header(c, "Content-Type")) != "application/zip")
        return refuse(415, "UNSUPPORTED_MEDIA_TYPE");
    if (mg_get_header(c, "Transfer-Encoding") != nullptr || ri->content_length < 0)
        return refuse(411, "LENGTH_REQUIRED");
    if (static_cast<unsigned long long>(ri->content_length) > kPackageMaxBytes)
        return refuse(413, "PACKAGE_TOO_LARGE");
    const char* digestHeader = mg_get_header(c, "X-Mat-Digest");
    const char* baseHeader = mg_get_header(c, "X-Mat-Base-Digest");
    const std::string digest = digestHeader ? digestHeader : "";
    const std::string base = baseHeader ? baseHeader : "";
    if (!isDigest(digest) || !(isDigest(base) || base == "none")) return refuse(400, "BAD_REQUEST");

    BeginRequest b;
    b.kind = OpKind::Deploy;
    b.who = {d.access.user, d.access.role ? roleName(*d.access.role) : "", r.from.ip,
             r.from.text()};
    b.baseDigest = base;
    b.packageDigest = digest;
    b.contentLength = static_cast<uint64_t>(ri->content_length);
    DeployPipeline& pipeline = *project_.pipeline;
    const BeginResult started = pipeline.begin(b);
    if (started.status != BeginStatus::Started) {
        mg_disable_connection_keep_alive(c);
        return beginRefused(c, started, true);
    }

    // The body goes to staging/<opId>/package.matscada as it arrives.
    const std::string opId = started.opId;
    std::vector<char> buf(kUploadChunk);
    long long left = ri->content_length;
    while (left > 0) {
        const int n =
            mg_read(c, buf.data(), static_cast<size_t>(std::min<long long>(left, buf.size())));
        if (n <= 0) {  // the network dropped (or the client went silent past request_timeout_ms)
            pipeline.receiveEnd(opId, false);
            mg_disable_connection_keep_alive(c);
            return 400;
        }
        if (pipeline.receive(opId, buf.data(), static_cast<size_t>(n)) != ReceiveStatus::Ok) {
            const auto op = pipeline.find(opId);
            const std::string code = op && op->error ? op->error->code : "RECEIVE_ABORTED";
            json more = json::object();
            if (op && op->error) more["message"] = op->error->message;
            mg_disable_connection_keep_alive(c);
            return sendError(c, statusOf(code), code, true, "", more);
        }
        left -= n;
    }
    if (pipeline.receiveEnd(opId, true) != ReceiveStatus::Ok) {
        const auto op = pipeline.find(opId);
        const std::string code = op && op->error ? op->error->code : "RECEIVE_ABORTED";
        mg_disable_connection_keep_alive(c);
        return sendError(c, statusOf(code), code, true);
    }
    const int status = send(c, 202, acceptedBody(opId), false);
    runInBackground(opId);
    return status;
}

void EngineeringApi::runInBackground(const std::string& opId) {
    std::lock_guard<std::mutex> l(workerMu_);
    if (worker_.joinable()) worker_.join();  // the previous operation is over: one at a time
    DeployPipeline* pipeline = project_.pipeline;
    worker_ = std::thread([pipeline, opId] {
        try {
            pipeline->run(opId);
        } catch (const std::exception&) {  // the pipeline records its own failures
        }
    });
}

// ---------- GET deployments/{opId}, GET operation ----------

int EngineeringApi::operation(mg_connection* c, const std::string& opId, bool close) {
    if (opId.empty()) {
        const auto op = project_.pipeline->latest();
        return send(c, 200, op ? deployOperationJson(*op) : "null", close);
    }
    const auto op = validOpId(opId) ? project_.pipeline->find(opId) : std::nullopt;
    if (!op) return sendError(c, 404, "NO_SUCH_OPERATION", close);
    return send(c, 200, deployOperationJson(*op), close);
}

// ---------- POST /project/restore ----------

int EngineeringApi::restore(mg_connection* c, const GateRequest& r, const GateDecision& d,
                            bool close) {
    std::string body;
    if (!readBody(c, body)) {
        mg_disable_connection_keep_alive(c);
        return sendError(c, 400, "BAD_REQUEST", true);
    }
    if (jsonNestingDepth(body.data(), body.size()) > kMaxBodyDepth)
        return sendError(c, 400, "BAD_REQUEST", close);
    const json j = json::parse(body, nullptr, false);
    if (!j.is_object() || !j.contains("seq") || !j["seq"].is_number_integer() ||
        !j.contains("baseDigest") || !j["baseDigest"].is_string())
        return sendError(c, 400, "BAD_REQUEST", close);
    const int64_t seq = j["seq"].get<int64_t>();
    const std::string base = j["baseDigest"].get<std::string>();
    if (seq < 1 || !(isDigest(base) || base == "none"))
        return sendError(c, 400, "BAD_REQUEST", close);

    BeginRequest b;
    b.kind = OpKind::Restore;
    b.who = {d.access.user, d.access.role ? roleName(*d.access.role) : "", r.from.ip,
             r.from.text()};
    b.baseDigest = base;
    b.seq = seq;
    const BeginResult started = project_.pipeline->begin(b);
    if (started.status != BeginStatus::Started) return beginRefused(c, started, close);
    const int status = send(c, 202, acceptedBody(started.opId), close);
    runInBackground(started.opId);
    return status;
}

}  // namespace mat
