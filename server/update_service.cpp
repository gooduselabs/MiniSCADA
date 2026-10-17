#include "server/update_service.hpp"

#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <fstream>
#include <iostream>
#include <map>
#include <regex>
#include <sstream>

#include "core/crypto/hex.hpp"
#include "core/crypto/random.hpp"
#include "server/system_warnings.hpp"

namespace mat {

using nlohmann::json;

namespace {

constexpr int kEstimatedDowntimeS = 25;  // stop ≤ 5 s, start ≤ 10 s, health ≥ 5 s (research R18)

std::string readText(const std::string& path, size_t max = 1 << 20) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return {};
    std::string s;
    s.resize(max);
    in.read(&s[0], static_cast<std::streamsize>(max));
    s.resize(static_cast<size_t>(in.gcount()));
    return s;
}

bool fsyncDir(const std::string& dir) {
    const int fd = ::open(dir.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (fd < 0) return false;
    const bool ok = ::fsync(fd) == 0;
    ::close(fd);
    return ok;
}

// Written to <path>.tmp, synced, renamed, directory synced (contract §4: before each step).
bool writeAtomic(const std::string& path, const std::string& text, mode_t mode = 0600) {
    const std::string tmp = path + ".tmp";
    const int fd = ::open(tmp.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW | O_CLOEXEC, mode);
    if (fd < 0) return false;
    bool ok = ::write(fd, text.data(), text.size()) == static_cast<ssize_t>(text.size()) &&
              ::fchmod(fd, mode) == 0 && ::fsync(fd) == 0;
    ok = ::close(fd) == 0 && ok;
    if (!ok || ::rename(tmp.c_str(), path.c_str()) != 0) {
        ::unlink(tmp.c_str());
        return false;
    }
    const size_t slash = path.rfind('/');
    return fsyncDir(slash == std::string::npos ? "." : path.substr(0, slash));
}

void removeFilesIn(const std::string& dir, const std::string& keep = {}) {
    if (DIR* d = ::opendir(dir.c_str())) {
        while (dirent* e = ::readdir(d)) {
            const std::string n = e->d_name;
            if (n == "." || n == ".." || n == keep) continue;
            ::unlink((dir + "/" + n).c_str());
        }
        ::closedir(d);
    }
}

int64_t updBootMs() {
    timespec ts{};
    ::clock_gettime(CLOCK_BOOTTIME, &ts);
    return int64_t(ts.tv_sec) * 1000 + ts.tv_nsec / 1000000;
}

int64_t updWallMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

std::string updIsoUtc(int64_t ms) {
    const time_t t = static_cast<time_t>(ms / 1000);
    tm g{};
    ::gmtime_r(&t, &g);
    char b[32];
    std::strftime(b, sizeof b, "%Y-%m-%dT%H:%M:%SZ", &g);
    return b;
}

const std::regex& idPattern() {
    static const std::regex r("^upd_[0-9a-f]{16}$");
    return r;
}

}  // namespace

BuildInfo readBuildInfo(const std::string& installRoot) {
    BuildInfo b;
    const json j =
        json::parse(readText(installRoot + "/build-info.json", 64 * 1024), nullptr, false);
    if (!j.is_object()) return b;
    if (j.contains("version") && j["version"].is_string()) b.version = j["version"];
    if (j.contains("releaseSeq") && j["releaseSeq"].is_number_integer() &&
        j["releaseSeq"].get<int64_t>() > 0)
        b.releaseSeq = j["releaseSeq"].get<int64_t>();
    if (j.contains("arch") && j["arch"].is_string()) b.arch = j["arch"];
    return b;
}

struct UpdateService::Impl {
    enum class State { Idle, Receiving, Verified, Applying };
    std::mutex mu;
    State state = State::Idle;
    std::string id;
    UpdateCaller who;
    int fd = -1;
    uint64_t expected = 0, received = 0;
    int64_t startMono = 0, startWall = 0, verifiedMono = 0;
    bool aborted = false;
    std::string abortReason;
    update::Verified verified;
    json plan;
    std::string op;  // "apply" or "rollback" while Applying
    update::KeySet keys;
    // what busy() returns: its own mutex, never held while calling out
    mutable std::mutex busyMu;
    std::optional<BusyInfo> busyInfo;
};

UpdateService::UpdateService(UpdateServiceOptions options)
    : o_(std::move(options)), impl_(std::make_unique<Impl>()) {
    if (!o_.wallMs) o_.wallMs = updWallMs;
    if (!o_.monoMs) o_.monoMs = updBootMs;
    if (!o_.receiveMonoMs) o_.receiveMonoMs = updBootMs;
    if (!o_.newId) o_.newId = [] { return "upd_" + toHex(randomBytes(8)); };
    if (!o_.freeBytes)
        o_.freeBytes = [](const std::string& p) -> uint64_t {
            struct statvfs s {};
            if (::statvfs(p.c_str(), &s) != 0) return 0;
            return static_cast<uint64_t>(s.f_bavail) * s.f_frsize;
        };
    if (!o_.log) o_.log = [](const std::string& l) { std::cerr << "update: " << l << "\n"; };
    releaseSeq_ = readBuildInfo(o_.installRoot).releaseSeq;
}

UpdateService::~UpdateService() {
    if (impl_->fd >= 0) ::close(impl_->fd);
}

namespace {

struct Paths {
    std::string root, incoming, ready, ops, request, last;
    explicit Paths(const std::string& dataDir)
        : root(dataDir + "/update"),
          incoming(root + "/incoming"),
          ready(root + "/ready"),
          ops(root + "/ops"),
          request(root + "/request.json"),
          last(root + "/last.json") {}
};

UpdateReply errorReply(int status, const std::string& code, const std::string& message,
                       json detail = nullptr) {
    UpdateReply r;
    r.status = status;
    r.code = code;
    r.body = {{"error", code}, {"message", message}};
    if (!detail.is_null()) r.body["detail"] = std::move(detail);
    return r;
}

std::string messageOf(const std::string& code) {
    static const std::map<std::string, std::string> kText = {
        {"UPDATE_DISABLED", "Cập nhật qua mạng đang tắt (update.enabled trong runtime.json)."},
        {"UPDATE_KEYS_MISSING", "Thiết bị chưa có khóa tin cậy: chưa nhận gói cập nhật."},
        {"UPDATE_TOO_LARGE", "Gói lớn hơn giới hạn update.maxPackageMiB."},
        {"UPDATE_PACKAGE_INVALID", "Gói cập nhật không hợp lệ."},
        {"UPDATE_SIGNATURE_INVALID",
         "Chữ ký của gói không đúng với khóa tin cậy nào của thiết bị."},
        {"UPDATE_KEY_UNKNOWN", "Gói được ký bằng khóa thiết bị không tin cậy."},
        {"UPDATE_DOWNGRADE", "Gói không mới hơn bản đang chạy (releaseSeq)."},
        {"UPDATE_PROJECT_INCOMPATIBLE", "Bản mới không chạy được định dạng của project đang chạy."},
        {"UPDATE_ARCH_MISMATCH", "Gói dành cho kiến trúc khác."},
        {"UPDATER_MANUAL_ONLY", "Gói cần cập nhật mat-updater: cài thủ công bằng deploy.sh."},
        {"INSUFFICIENT_SPACE", "Không đủ chỗ trống để nhận gói."},
        {"UPDATE_RECEIVE_ABORTED", "Nhận gói bị dừng giữa chừng: gửi lại."},
        {"DEVICE_BUSY", "Thiết bị đang bận với thao tác khác."},
        {"UPDATE_NOT_FOUND", "Không có gói đã kiểm với mã này (hết hạn sau 30 phút)."},
        {"UPDATE_NO_PREVIOUS", "Không có bản trước để quay về."},
        {"AUDIT_UNAVAILABLE", "Nhật ký audit không ghi được: thao tác bị từ chối."},
        {"PERSIST_FAILED", "Không ghi được trạng thái cập nhật."},
    };
    auto it = kText.find(code);
    return it != kText.end() ? it->second : code;
}

}  // namespace

void UpdateService::start() {
    const Paths p(o_.dataDir);
    for (const std::string& d : {p.root, p.incoming, p.ready, p.ops}) {
        ::mkdir(d.c_str(), 0700);
        ::chmod(d.c_str(), 0700);
    }
    Impl& m = *impl_;
    m.keys = update::loadTrustedKeys(o_.trustedKeysDir);
    if (o_.warnings) {
        if (o_.enabled && m.keys.keys.empty())
            o_.warnings->set("UPDATE_KEYS_MISSING", {{"dir", o_.trustedKeysDir}});
        else
            o_.warnings->clear("UPDATE_KEYS_MISSING");
    }
    // A request not taken yet by mat-updater: it is still applying. Anything else of S1–S3 from a
    // run before is gone (contract §4: interrupted at S1 to S3).
    std::string pendingId;
    if (const json req = json::parse(readText(p.request, 4096), nullptr, false); req.is_object()) {
        if (req.contains("updateId") && req["updateId"].is_string())
            pendingId = req["updateId"].get<std::string>();
    }
    removeFilesIn(p.incoming);
    removeFilesIn(p.ready, pendingId.empty() ? std::string() : pendingId + ".matupdate");
    if (!pendingId.empty()) {
        m.state = Impl::State::Applying;
        m.id = pendingId;
        m.op = "apply";
        claimed_ = true;
        BusyInfo b;
        b.opId = pendingId;
        b.kind = OpKind::Update;
        b.since = o_.wallMs();
        std::lock_guard<std::mutex> l(m.busyMu);
        m.busyInfo = b;
    }
    // last.json (written by mat-updater): audit its result once (FR-063)
    json last = json::parse(readText(p.last, 64 * 1024), nullptr, false);
    bool keysetAudited = false;
    if (last.is_object()) startLast(last, keysetAudited);
    // the trusted keys against the set seen at the previous start: a change made with
    // --trust-key (or a keyset) is audited once (device-api-011 §7)
    const std::string seenPath = p.root + "/keys-seen.json";
    json now = json::array();
    for (const auto& k : m.keys.keys) now.push_back(k.keyId());
    std::sort(now.begin(), now.end());
    const json seen = json::parse(readText(seenPath, 64 * 1024), nullptr, false);
    if (seen.is_array() && seen != now) {
        json added = json::array(), removed = json::array();
        for (const auto& k : now)
            if (std::find(seen.begin(), seen.end(), k) == seen.end()) added.push_back(k);
        for (const auto& k : seen)
            if (std::find(now.begin(), now.end(), k) == now.end()) removed.push_back(k);
        bool ok = keysetAudited;
        if (!ok) {
            AuditEvent e(AuditAction::KeysUpdated, AuditResult::Ok, AuditChannel::System, "system");
            e.target = o_.trustedKeysDir;
            e.detail = json{{"added", added}, {"removed", removed}, {"keys", now.size()}}.dump();
            ok = o_.audit && o_.audit(e);
        }
        if (ok) writeAtomic(seenPath, now.dump() + "\n", 0600);
    } else if (!seen.is_array()) {
        writeAtomic(seenPath, now.dump() + "\n", 0600);
    }
}

void UpdateService::startLast(json& last, bool& keysetAudited) {
    const Paths p(o_.dataDir);
    const std::string result = last.value("result", "");
    const std::string op = last.value("op", "apply");
    if (!last.value("audited", true)) {
        AuditAction action = AuditAction::UpdateCommitted;
        AuditResult res = AuditResult::Ok;
        if (op == "rollback") {
            action = AuditAction::UpdateManualRollback;
            res = result == "committed" ? AuditResult::Ok : AuditResult::Failed;
        } else if (op == "keyset") {
            action = AuditAction::KeysUpdated;
            res = result == "committed" ? AuditResult::Ok : AuditResult::Failed;
        } else if (result == "rolled-back") {
            action = AuditAction::UpdateRolledBack;
            res = AuditResult::RolledBack;
        } else if (result != "committed") {
            action = AuditAction::UpdateRejected;
            res = AuditResult::Failed;
        }
        AuditEvent e(action, res, AuditChannel::System, "system");
        if (last.contains("user") && last["user"].is_string())
            e.user = last["user"].get<std::string>();
        e.target = last.value("updateId", "");
        if (last.contains("code") && last["code"].is_string())
            e.code = last["code"].get<std::string>();
        json d = {{"from", last.value("from", "")}, {"to", last.value("to", "")}};
        if (last.contains("reason") && last["reason"].is_string()) d["reason"] = last["reason"];
        if (last.contains("planned") && last["planned"].is_string()) d["planned"] = last["planned"];
        e.detail = d.dump();
        if (o_.audit && o_.audit(e)) {
            keysetAudited = action == AuditAction::KeysUpdated;
            last["audited"] = true;
            if (!writeAtomic(p.last, last.dump(2) + "\n", 0644))
                o_.log("cannot mark last.json audited");
        } else {
            o_.log("cannot audit the result of the last update (audit log down)");
        }
    }
    // the warning UPDATE_ROLLED_BACK: 30 days after the rollback
    if (o_.warnings && result == "rolled-back" && op == "apply") {
        const int64_t at = last.value("finishedAtMs", int64_t(0));
        if (at == 0 || o_.wallMs() - at < o_.rolledBackWarningMs)
            o_.warnings->set("UPDATE_ROLLED_BACK", {{"updateId", last.value("updateId", "")},
                                                    {"from", last.value("from", "")},
                                                    {"to", last.value("to", "")},
                                                    {"reason", last.value("reason", "")}});
    }
}

std::optional<BusyInfo> UpdateService::busy() const {
    if (!claimed_.load()) return std::nullopt;
    std::lock_guard<std::mutex> l(impl_->busyMu);
    if (impl_->busyInfo) return impl_->busyInfo;
    BusyInfo b;  // claimed, the details not written yet
    b.kind = OpKind::Update;
    return b;
}

json UpdateService::infoBlock() const {
    std::lock_guard<std::mutex> l(impl_->mu);
    return {{"enabled", o_.enabled}, {"supported", true}, {"keys", impl_->keys.keys.size()}};
}

UpdateReply UpdateService::begin(const UpdateCaller& who, uint64_t contentLength, std::string& id) {
    if (!o_.enabled) return errorReply(404, "UPDATE_DISABLED", messageOf("UPDATE_DISABLED"));
    expire();
    Impl& m = *impl_;
    auto audit = [&](AuditAction a, AuditResult r, const std::string& code, json detail) {
        AuditEvent e(a, r, AuditChannel::Https, who.source);
        e.user = who.user;
        e.role = who.role;
        e.target = "/api/v1/system/update";
        if (!code.empty()) e.code = code;
        if (!detail.is_null()) e.detail = detail.dump();
        return o_.audit && o_.audit(e);
    };
    {
        std::lock_guard<std::mutex> l(m.mu);
        m.keys = update::loadTrustedKeys(o_.trustedKeysDir);
        if (o_.warnings) {
            if (m.keys.keys.empty())
                o_.warnings->set("UPDATE_KEYS_MISSING", {{"dir", o_.trustedKeysDir}});
            else
                o_.warnings->clear("UPDATE_KEYS_MISSING");
        }
        if (m.keys.keys.empty())
            return errorReply(503, "UPDATE_KEYS_MISSING", messageOf("UPDATE_KEYS_MISSING"));
    }
    if (contentLength > o_.maxPackageBytes) {
        audit(AuditAction::UpdateRejected, AuditResult::Failed, "UPDATE_TOO_LARGE",
              {{"bytes", contentLength}, {"maxBytes", o_.maxPackageBytes}});
        return errorReply(413, "UPDATE_TOO_LARGE", messageOf("UPDATE_TOO_LARGE"));
    }
    // the device: ours first (claimed before the deployment is asked: research of DEVICE_BUSY)
    if (claimed_.exchange(true)) {
        UpdateReply r = errorReply(409, "DEVICE_BUSY", messageOf("DEVICE_BUSY"));
        if (auto b = busy()) r.body["busy"] = json::parse(busyInfoJson(*b), nullptr, false);
        return r;
    }
    auto release = [&] {
        {
            std::lock_guard<std::mutex> l(m.busyMu);
            m.busyInfo.reset();
        }
        claimed_ = false;
    };
    if (o_.deployBusy) {
        if (auto b = o_.deployBusy()) {
            release();
            UpdateReply r = errorReply(409, "DEVICE_BUSY", messageOf("DEVICE_BUSY"));
            r.body["busy"] = json::parse(busyInfoJson(*b), nullptr, false);
            return r;
        }
    }
    const Paths p(o_.dataDir);
    if (o_.freeBytes(p.root) < 3 * contentLength) {
        release();
        audit(AuditAction::UpdateRejected, AuditResult::Failed, "INSUFFICIENT_SPACE",
              {{"bytes", contentLength}});
        return errorReply(507, "INSUFFICIENT_SPACE", messageOf("INSUFFICIENT_SPACE"));
    }
    id = o_.newId();
    // FULL audit before the first byte is read (FR-059)
    if (!audit(AuditAction::UpdateAccepted, AuditResult::Started, "",
               {{"updateId", id}, {"bytes", contentLength}})) {
        release();
        return errorReply(503, "AUDIT_UNAVAILABLE", messageOf("AUDIT_UNAVAILABLE"));
    }
    std::lock_guard<std::mutex> l(m.mu);
    const std::string part = p.incoming + "/" + id + ".part";
    m.fd = ::open(part.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    const json op = {{"updateId", id},      {"step", 1},
                     {"name", "receiving"}, {"at", updIsoUtc(o_.wallMs())},
                     {"from", o_.version},  {"to", nullptr},
                     {"result", nullptr}};
    if (m.fd < 0 || !writeAtomic(p.ops + "/" + id + ".json", op.dump() + "\n")) {
        if (m.fd >= 0) ::close(m.fd);
        m.fd = -1;
        ::unlink(part.c_str());
        release();
        audit(AuditAction::UpdateRejected, AuditResult::Failed, "PERSIST_FAILED",
              {{"updateId", id}});
        return errorReply(500, "PERSIST_FAILED", messageOf("PERSIST_FAILED"));
    }
    m.state = Impl::State::Receiving;
    m.id = id;
    m.who = who;
    m.expected = contentLength;
    m.received = 0;
    m.aborted = false;
    m.abortReason.clear();
    m.startMono = o_.receiveMonoMs();
    m.startWall = o_.wallMs();
    {
        BusyInfo b;
        b.opId = id;
        b.kind = OpKind::Update;
        b.user = who.user;
        b.source = who.source;
        b.since = m.startWall;
        std::lock_guard<std::mutex> lb(m.busyMu);
        m.busyInfo = b;
    }
    UpdateReply ok;
    ok.status = 100;  // go on: read the body
    return ok;
}

bool UpdateService::receive(const std::string& id, const void* data, size_t n) {
    Impl& m = *impl_;
    std::lock_guard<std::mutex> l(m.mu);
    if (m.state != Impl::State::Receiving || m.id != id || m.fd < 0 || m.aborted) return false;
    const int64_t elapsed = o_.receiveMonoMs() - m.startMono;
    auto abort = [&](const std::string& why) {
        m.aborted = true;
        m.abortReason = why;
        return false;
    };
    if (elapsed > o_.receiveTotalMs) return abort("total time");
    if (m.received + n > m.expected) return abort("more than Content-Length");
    const char* p = static_cast<const char*>(data);
    size_t off = 0;
    while (off < n) {
        const ssize_t w = ::write(m.fd, p + off, n - off);
        if (w < 0 && errno == EINTR) continue;
        if (w <= 0) return abort(std::string("write: ") + std::strerror(errno));
        off += static_cast<size_t>(w);
    }
    m.received += n;
    if (elapsed > o_.rateGraceMs &&
        m.received * 1000 < o_.minRateBytesPerS * static_cast<uint64_t>(elapsed))
        return abort("slower than the minimum rate");
    return true;
}

UpdateReply UpdateService::finish(const std::string& id, bool complete, const UpdateCaller& who) {
    Impl& m = *impl_;
    const Paths p(o_.dataDir);
    std::unique_lock<std::mutex> l(m.mu);
    if (m.state != Impl::State::Receiving || m.id != id)
        return errorReply(409, "DEVICE_BUSY", messageOf("DEVICE_BUSY"));
    const std::string part = p.incoming + "/" + id + ".part";
    const bool full = complete && !m.aborted && m.received == m.expected;
    bool synced = false;
    if (m.fd >= 0) {
        synced = full && ::fsync(m.fd) == 0;
        ::close(m.fd);
        m.fd = -1;
    }
    auto reject = [&](const update::Error& e) {
        ::unlink(part.c_str());
        ::unlink((p.ops + "/" + id + ".json").c_str());
        m.state = Impl::State::Idle;
        m.id.clear();
        l.unlock();
        AuditEvent a(AuditAction::UpdateRejected, AuditResult::Failed, AuditChannel::Https,
                     who.source);
        a.user = who.user;
        a.role = who.role;
        a.target = id;
        a.code = e.code;
        json d = {{"updateId", id}};
        if (!e.detailCode.empty()) d["detailCode"] = e.detailCode;
        if (!e.detail.empty()) d["detail"] = e.detail.substr(0, 200);
        a.detail = d.dump();
        if (o_.audit) o_.audit(a);
        {
            std::lock_guard<std::mutex> lb(m.busyMu);
            m.busyInfo.reset();
        }
        claimed_ = false;
        json detail = nullptr;
        if (!e.detailCode.empty()) detail = {{"code", e.detailCode}};
        return errorReply(e.http, e.code, messageOf(e.code), detail);
    };
    if (!full) {
        update::Error e{"UPDATE_RECEIVE_ABORTED", "", m.aborted ? m.abortReason : "body cut short",
                        408, update::kExitInvalid};
        return reject(e);
    }
    if (!synced)
        return reject(update::Error{"PERSIST_FAILED", "", "fsync", 500, update::kExitInvalid});
    // S2: the whole check (FR-061)
    update::DeviceContext dev;
    dev.maxPackageBytes = o_.maxPackageBytes;
    dev.arch = o_.arch;
    dev.version = o_.version;
    dev.releaseSeq = releaseSeq_;
    if (o_.projectFormat) dev.projectFormat = o_.projectFormat();
    update::Verified v;
    if (auto e = update::verifyPackageFile(part, m.keys, dev, v)) return reject(*e);
    const std::string ready = p.ready + "/" + id + ".matupdate";
    if (::rename(part.c_str(), ready.c_str()) != 0 || !fsyncDir(p.ready) || !fsyncDir(p.incoming))
        return reject(update::Error{"PERSIST_FAILED", "", "rename", 500, update::kExitInvalid});
    const json op = {{"updateId", id},
                     {"step", 2},
                     {"name", "verified"},
                     {"at", updIsoUtc(o_.wallMs())},
                     {"from", o_.version},
                     {"to", v.manifest.version},
                     {"sha256", v.packageSha256},
                     {"result", nullptr}};
    if (!writeAtomic(p.ops + "/" + id + ".json", op.dump() + "\n")) {
        ::unlink(ready.c_str());
        return reject(update::Error{"PERSIST_FAILED", "", "ops", 500, update::kExitInvalid});
    }
    m.state = Impl::State::Verified;
    m.verified = v;
    m.verifiedMono = o_.monoMs();
    const bool runtime = v.manifest.kind == "runtime";
    m.plan = {{"kind", v.manifest.kind},
              {"from", o_.version},
              {"to", v.manifest.version},
              {"releaseSeq", v.manifest.releaseSeq},
              {"signer", {{"keyId", v.signerKeyId}, {"label", v.signerLabel}}},
              {"projectCompatible", true},
              {"estimatedDowntimeS", runtime ? kEstimatedDowntimeS : 0},
              {"restartRequired", runtime},
              {"notes", v.manifest.notes},
              {"files", v.manifest.files.size()},
              {"size", v.packageSize},
              {"expiresInS", o_.verifiedTtlMs / 1000}};
    if (!runtime)
        m.plan["keyset"] = {{"add", v.manifest.keysetAdd.size()},
                            {"remove", v.manifest.keysetRemove}};
    UpdateReply r;
    r.status = 201;
    r.body = {{"updateId", id}, {"state", "verified"}, {"plan", m.plan}};
    return r;
}

void UpdateService::expire() {
    Impl& m = *impl_;
    std::string gone;
    {
        std::lock_guard<std::mutex> l(m.mu);
        if (m.state != Impl::State::Verified || o_.monoMs() - m.verifiedMono <= o_.verifiedTtlMs)
            return;
        const Paths p(o_.dataDir);
        ::unlink((p.ready + "/" + m.id + ".matupdate").c_str());
        ::unlink((p.ops + "/" + m.id + ".json").c_str());
        gone = m.id;
        m.state = Impl::State::Idle;
        m.id.clear();
    }
    {
        std::lock_guard<std::mutex> lb(m.busyMu);
        m.busyInfo.reset();
    }
    claimed_ = false;
    AuditEvent e(AuditAction::UpdateCancelled, AuditResult::Ok, AuditChannel::System, "system");
    e.target = gone;
    e.detail = json{{"reason", "expired"}}.dump();
    if (o_.audit) o_.audit(e);
}

json UpdateService::status() {
    expire();
    Impl& m = *impl_;
    const Paths p(o_.dataDir);
    json s = {{"enabled", o_.enabled}, {"supported", true}};
    {
        std::lock_guard<std::mutex> l(m.mu);
        static const char* kNames[] = {"idle", "receiving", "verified", "applying"};
        s["state"] = kNames[static_cast<int>(m.state)];
        s["updateId"] = m.state == Impl::State::Idle ? json(nullptr) : json(m.id);
        s["plan"] = m.state == Impl::State::Verified || m.state == Impl::State::Applying
                        ? m.plan
                        : json(nullptr);
        s["sha256"] = m.state == Impl::State::Verified || m.state == Impl::State::Applying
                          ? json(m.verified.packageSha256)
                          : json(nullptr);
        s["op"] = m.state == Impl::State::Applying ? json(m.op) : json(nullptr);
        s["startedAt"] =
            m.state == Impl::State::Idle ? json(nullptr) : json(updIsoUtc(m.startWall));
        s["keys"] = m.keys.keys.size();
    }
    // the step mat-updater has reached (its copy of ops/<id>.json), and the last result
    s["step"] = nullptr;
    if (s["updateId"].is_string()) {
        const json op = json::parse(
            readText(p.ops + "/" + s["updateId"].get<std::string>() + ".json", 64 * 1024), nullptr,
            false);
        if (op.is_object() && op.contains("name")) s["step"] = op["name"];
    }
    const json last = json::parse(readText(p.last, 64 * 1024), nullptr, false);
    if (last.is_object()) {
        json l = json::object();
        for (const char* k : {"updateId", "op", "result", "from", "to", "finishedAt", "reason"})
            l[k] = last.contains(k) ? last[k] : json(nullptr);
        s["last"] = l;
        // a finished apply of this updateId: its result is the state
        if (s["state"] == "applying" &&
            last.value("updateId", "") == s["updateId"].get<std::string>()) {
            const std::string result = last.value("result", "");
            if (result == "committed" || result == "rolled-back") s["state"] = result;
            if (result == "failed") s["state"] = "failed";
        }
    } else {
        s["last"] = nullptr;
    }
    const BuildInfo prev = readBuildInfo(o_.installRoot + ".prev");
    struct stat st {};
    const bool prevOk = ::stat((o_.installRoot + ".prev/bin/mat-runtime").c_str(), &st) == 0;
    s["previous"] =
        prevOk ? json{{"version", prev.version.empty() ? json(nullptr) : json(prev.version)},
                      {"releaseSeq", prev.releaseSeq},
                      {"available", true}}
               : json(nullptr);
    s["current"] = {{"version", o_.version}, {"releaseSeq", releaseSeq_}, {"arch", o_.arch}};
    return s;
}

UpdateReply UpdateService::apply(const std::string& updateId, const UpdateCaller& who) {
    if (!o_.enabled) return errorReply(404, "UPDATE_DISABLED", messageOf("UPDATE_DISABLED"));
    expire();
    Impl& m = *impl_;
    const Paths p(o_.dataDir);
    std::lock_guard<std::mutex> l(m.mu);
    if (m.id == updateId && (m.state == Impl::State::Applying || m.state == Impl::State::Receiving))
        return errorReply(409, "DEVICE_BUSY", messageOf("DEVICE_BUSY"));
    if (m.state != Impl::State::Verified || m.id != updateId ||
        !std::regex_match(updateId, idPattern()))
        return errorReply(404, "UPDATE_NOT_FOUND", messageOf("UPDATE_NOT_FOUND"));
    AuditEvent e(AuditAction::UpdateApplying, AuditResult::Started, AuditChannel::Https,
                 who.source);
    e.user = who.user;
    e.role = who.role;
    e.target = updateId;
    e.detail = json{{"from", o_.version},
                    {"to", m.verified.manifest.version},
                    {"releaseSeq", m.verified.manifest.releaseSeq},
                    {"kind", m.verified.manifest.kind},
                    {"signer", m.verified.signerKeyId}}
                   .dump();
    if (!o_.audit || !o_.audit(e))
        return errorReply(503, "AUDIT_UNAVAILABLE", messageOf("AUDIT_UNAVAILABLE"));
    const json op = {{"updateId", updateId},
                     {"step", 3},
                     {"name", "requested"},
                     {"at", updIsoUtc(o_.wallMs())},
                     {"from", o_.version},
                     {"to", m.verified.manifest.version},
                     {"sha256", m.verified.packageSha256},
                     {"result", nullptr}};
    const json req = {{"updateId", updateId},
                      {"op", m.verified.manifest.kind == "keyset" ? "keyset" : "apply"},
                      {"sha256", m.verified.packageSha256},
                      {"user", who.user},
                      {"at", updIsoUtc(o_.wallMs())}};
    if (!writeAtomic(p.ops + "/" + updateId + ".json", op.dump() + "\n") ||
        !writeAtomic(p.request, req.dump() + "\n"))
        return errorReply(500, "PERSIST_FAILED", messageOf("PERSIST_FAILED"));
    m.state = Impl::State::Applying;
    m.op = req["op"];
    m.startWall = o_.wallMs();
    UpdateReply r;
    r.status = 202;
    r.body = {{"state", "applying"}, {"updateId", updateId}};
    return r;
}

UpdateReply UpdateService::cancel(const std::string& updateId, const UpdateCaller& who) {
    if (!o_.enabled) return errorReply(404, "UPDATE_DISABLED", messageOf("UPDATE_DISABLED"));
    expire();
    Impl& m = *impl_;
    const Paths p(o_.dataDir);
    {
        std::lock_guard<std::mutex> l(m.mu);
        if (m.id == updateId && m.state == Impl::State::Applying)
            return errorReply(409, "DEVICE_BUSY", messageOf("DEVICE_BUSY"));
        if (m.state != Impl::State::Verified || m.id != updateId)
            return errorReply(404, "UPDATE_NOT_FOUND", messageOf("UPDATE_NOT_FOUND"));
        ::unlink((p.ready + "/" + updateId + ".matupdate").c_str());
        ::unlink((p.ops + "/" + updateId + ".json").c_str());
        m.state = Impl::State::Idle;
        m.id.clear();
    }
    {
        std::lock_guard<std::mutex> lb(m.busyMu);
        m.busyInfo.reset();
    }
    claimed_ = false;
    AuditEvent e(AuditAction::UpdateCancelled, AuditResult::Ok, AuditChannel::Https, who.source);
    e.user = who.user;
    e.role = who.role;
    e.target = updateId;
    if (o_.audit) o_.audit(e);
    UpdateReply r;
    r.body = {{"state", "idle"}};
    return r;
}

UpdateReply UpdateService::rollback(const UpdateCaller& who) {
    if (!o_.enabled) return errorReply(404, "UPDATE_DISABLED", messageOf("UPDATE_DISABLED"));
    expire();
    Impl& m = *impl_;
    const Paths p(o_.dataDir);
    struct stat st {};
    if (::stat((o_.installRoot + ".prev/bin/mat-runtime").c_str(), &st) != 0)
        return errorReply(409, "UPDATE_NO_PREVIOUS", messageOf("UPDATE_NO_PREVIOUS"));
    if (claimed_.exchange(true)) return errorReply(409, "DEVICE_BUSY", messageOf("DEVICE_BUSY"));
    auto release = [&] {
        {
            std::lock_guard<std::mutex> lb(m.busyMu);
            m.busyInfo.reset();
        }
        claimed_ = false;
    };
    if (o_.deployBusy && o_.deployBusy()) {
        release();
        return errorReply(409, "DEVICE_BUSY", messageOf("DEVICE_BUSY"));
    }
    const std::string id = o_.newId();
    const BuildInfo prev = readBuildInfo(o_.installRoot + ".prev");
    AuditEvent e(AuditAction::UpdateManualRollback, AuditResult::Started, AuditChannel::Https,
                 who.source);
    e.user = who.user;
    e.role = who.role;
    e.target = id;
    e.detail = json{{"from", o_.version}, {"to", prev.version}}.dump();
    if (!o_.audit || !o_.audit(e)) {
        release();
        return errorReply(503, "AUDIT_UNAVAILABLE", messageOf("AUDIT_UNAVAILABLE"));
    }
    const json req = {{"updateId", id},
                      {"op", "rollback"},
                      {"sha256", ""},
                      {"user", who.user},
                      {"at", updIsoUtc(o_.wallMs())}};
    if (!writeAtomic(p.request, req.dump() + "\n")) {
        release();
        return errorReply(500, "PERSIST_FAILED", messageOf("PERSIST_FAILED"));
    }
    {
        std::lock_guard<std::mutex> l(m.mu);
        m.state = Impl::State::Applying;
        m.id = id;
        m.op = "rollback";
        m.plan = {{"kind", "rollback"}, {"from", o_.version}, {"to", prev.version}};
        m.startWall = o_.wallMs();
    }
    {
        BusyInfo b;
        b.opId = id;
        b.kind = OpKind::Update;
        b.user = who.user;
        b.source = who.source;
        b.since = o_.wallMs();
        std::lock_guard<std::mutex> lb(m.busyMu);
        m.busyInfo = b;
    }
    UpdateReply r;
    r.status = 202;
    r.body = {{"state", "applying"}, {"updateId", id}};
    return r;
}

}  // namespace mat
