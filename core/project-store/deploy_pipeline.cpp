#include "core/project-store/deploy_pipeline.hpp"

#include <fcntl.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <mutex>

#include "core/common/json_text.hpp"
#include "nlohmann/json.hpp"

namespace mat {

namespace {

using Json = nlohmann::json;
using OJson = nlohmann::ordered_json;

const char* const kStepIds[] = {kStepReceive, kStepVerify,   kStepValidate,
                                kStepBackup,  kStepActivate, kStepHealth};

OJson issueArray(const std::vector<ProjectIssue>& issues) {
    OJson a = OJson::array();
    for (const auto& i : issues)
        a.push_back({{"code", i.code}, {"file", i.file}, {"path", i.path}, {"message", i.message}});
    return a;
}

std::vector<ProjectIssue> readIssues(const Json& j) {
    std::vector<ProjectIssue> out;
    if (!j.is_array()) return out;
    for (const auto& i : j)
        if (i.is_object())
            out.push_back({i.value("code", ""), i.value("file", ""), i.value("path", ""),
                           i.value("message", "")});
    return out;
}

OJson optText(const std::optional<std::string>& s) { return s ? OJson(*s) : OJson(nullptr); }

OJson operationObject(const DeployOperation& op) {
    OJson j;
    j["opId"] = op.opId;
    j["kind"] = opKindName(op.kind);
    j["user"] = op.user;
    j["role"] = op.role;
    j["source"] = op.source;
    j["startedAt"] = op.startedAt;
    j["endedAt"] = optText(op.endedAt);
    j["clockOk"] = op.clockOk;
    j["result"] = deployResultName(op.result);
    if (op.from)
        j["from"] = {{"seq", op.from->seq},
                     {"digest", op.from->digest},
                     {"projectVersion", op.from->projectVersion}};
    else
        j["from"] = nullptr;
    OJson to;
    if (op.to.seq) to["seq"] = *op.to.seq;
    to["digest"] = op.to.digest;
    to["projectId"] = op.to.projectId;
    to["projectVersion"] = op.to.projectVersion;
    j["to"] = std::move(to);
    j["steps"] = OJson::array();
    for (const auto& s : op.steps) {
        OJson sj;
        sj["id"] = s.id;
        sj["state"] = stepStateName(s.state);
        sj["startedAt"] = optText(s.startedAt);
        sj["endedAt"] = optText(s.endedAt);
        if (!s.code.empty()) sj["code"] = s.code;
        if (!s.message.empty()) sj["message"] = s.message;
        if (!s.issues.empty()) sj["issues"] = issueArray(s.issues);
        j["steps"].push_back(std::move(sj));
    }
    if (op.error) {
        OJson e;
        e["code"] = op.error->code;
        e["message"] = op.error->message;
        if (!op.error->issues.empty()) e["issues"] = issueArray(op.error->issues);
        j["error"] = std::move(e);
    } else {
        j["error"] = nullptr;
    }
    j["clientsNotified"] = op.clientsNotified;
    return j;
}

std::optional<StepState> parseStepState(const std::string& s) {
    for (StepState v : {StepState::Pending, StepState::Running, StepState::Ok, StepState::Failed,
                        StepState::Skipped})
        if (s == stepStateName(v)) return v;
    return std::nullopt;
}

std::optional<DeployResult> parseResult(const std::string& s) {
    for (DeployResult v : {DeployResult::Running, DeployResult::Committed, DeployResult::Failed,
                           DeployResult::RolledBack, DeployResult::Interrupted})
        if (s == deployResultName(v)) return v;
    return std::nullopt;
}

std::optional<std::string> readOptText(const Json& j, const char* key) {
    if (j.contains(key) && j[key].is_string()) return j[key].get<std::string>();
    return std::nullopt;
}

const char* stepMessage(const std::string& code) {
    if (code == "RECEIVE_ABORTED") return "Mất kết nối khi nhận gói";
    if (code == "RECEIVE_TIMEOUT") return "Không nhận xong gói trong 10 phút";
    if (code == "NO_SPACE") return "Không đủ chỗ trống trên thiết bị";
    if (code == "E_VALIDATION") return "Project không hợp lệ";
    if (code == "STORE_IO") return "Lỗi ghi kho project";
    if (code == "EXEC_FAILED") return "Không khởi động lại được runtime";
    if (code == "HEALTH_TIMEOUT") return "Runtime không đạt kiểm tra sức khỏe trong 15 s";
    if (code == "HEALTH_CRASH") return "Runtime dừng 2 lần khi chạy bản này";
    if (code == "HEALTH_PROJECT") return "Project không kích hoạt được";
    if (code == "HEALTH_HTTPS") return "Không mở được HTTPS";
    if (code == "INTERRUPTED") return "Thao tác bị ngắt (mất điện hoặc tiến trình dừng)";
    return "";
}

}  // namespace

const char* stepStateName(StepState s) {
    switch (s) {
        case StepState::Pending:
            return "pending";
        case StepState::Running:
            return "running";
        case StepState::Ok:
            return "ok";
        case StepState::Failed:
            return "failed";
        case StepState::Skipped:
            return "skipped";
    }
    return "";
}

const char* deployResultName(DeployResult r) {
    switch (r) {
        case DeployResult::Running:
            return "running";
        case DeployResult::Committed:
            return "committed";
        case DeployResult::Failed:
            return "failed";
        case DeployResult::RolledBack:
            return "rolled-back";
        case DeployResult::Interrupted:
            return "interrupted";
    }
    return "";
}

DeployStep* DeployOperation::step(std::string_view id) {
    for (auto& s : steps)
        if (s.id == id) return &s;
    return nullptr;
}
const DeployStep* DeployOperation::step(std::string_view id) const {
    for (const auto& s : steps)
        if (s.id == id) return &s;
    return nullptr;
}
std::string DeployOperation::runningStep() const {
    for (const auto& s : steps)
        if (s.state == StepState::Running) return s.id;
    return "";
}

std::string deployOperationJson(const DeployOperation& op) {
    return operationObject(op).dump(-1, ' ', false, OJson::error_handler_t::replace);
}

std::string deployRecordJson(const DeployOperation& op) {
    OJson j = operationObject(op);
    j["serial"] = op.serial;
    j["auditSource"] = op.auditSource;
    j["startedMs"] = op.startedMs;
    return j.dump(2, ' ', false, OJson::error_handler_t::replace) + "\n";
}

std::optional<DeployOperation> parseDeployRecord(std::string_view text, std::string& error) {
    const Json j = Json::parse(text.begin(), text.end(), nullptr, false);
    if (j.is_discarded() || !j.is_object()) {
        error = "bản ghi thao tác không phải JSON object";
        return std::nullopt;
    }
    try {
        DeployOperation op;
        op.opId = j.at("opId").get<std::string>();
        const auto kind = parseOpKind(j.at("kind").get<std::string>());
        const auto result = parseResult(j.at("result").get<std::string>());
        if (!validOpId(op.opId) || !kind || !result) {
            error = "opId, kind hoặc result không hợp lệ";
            return std::nullopt;
        }
        op.kind = *kind;
        op.result = *result;
        op.user = j.value("user", "");
        op.role = j.value("role", "");
        op.source = j.value("source", "");
        op.auditSource = j.value("auditSource", "");
        op.serial = j.value("serial", int64_t{0});
        op.startedMs = j.value("startedMs", int64_t{0});
        op.startedAt = j.value("startedAt", "");
        op.endedAt = readOptText(j, "endedAt");
        op.clockOk = j.value("clockOk", false);
        op.clientsNotified = j.value("clientsNotified", 0);
        if (j.contains("from") && j["from"].is_object()) {
            const Json& f = j["from"];
            op.from = DeployFrom{f.value("seq", int64_t{0}), f.value("digest", ""),
                                 f.value("projectVersion", "")};
        }
        if (j.contains("to") && j["to"].is_object()) {
            const Json& t = j["to"];
            if (t.contains("seq") && t["seq"].is_number_integer())
                op.to.seq = t["seq"].get<int64_t>();
            op.to.digest = t.value("digest", "");
            op.to.projectId = t.value("projectId", "");
            op.to.projectVersion = t.value("projectVersion", "");
        }
        for (const auto& sj : j.at("steps")) {
            DeployStep s;
            s.id = sj.at("id").get<std::string>();
            const auto st = parseStepState(sj.at("state").get<std::string>());
            if (!st) {
                error = "steps: state không hợp lệ";
                return std::nullopt;
            }
            s.state = *st;
            s.startedAt = readOptText(sj, "startedAt");
            s.endedAt = readOptText(sj, "endedAt");
            s.code = sj.value("code", "");
            s.message = sj.value("message", "");
            if (sj.contains("issues")) s.issues = readIssues(sj["issues"]);
            op.steps.push_back(std::move(s));
        }
        if (j.contains("error") && j["error"].is_object()) {
            const Json& e = j["error"];
            op.error = DeployError{
                e.value("code", ""), e.value("message", ""),
                e.contains("issues") ? readIssues(e["issues"]) : std::vector<ProjectIssue>{}};
        }
        return op;
    } catch (const std::exception& e) {
        error = std::string("bản ghi thao tác sai dạng: ") + e.what();
        return std::nullopt;
    }
}

std::string busyInfoJson(const BusyInfo& b) {
    OJson j;
    j["opId"] = b.opId;
    j["kind"] = opKindName(b.kind);
    j["user"] = b.user;
    j["source"] = b.source;
    j["since"] = b.since;
    return j.dump(-1, ' ', false, OJson::error_handler_t::replace);
}

const char* beginErrorCode(BeginStatus s) {
    switch (s) {
        case BeginStatus::Started:
            return "";
        case BeginStatus::Busy:
            return "DEVICE_BUSY";
        case BeginStatus::BaseChanged:
            return "BASE_CHANGED";
        case BeginStatus::NoSuchVersion:
            return "NO_SUCH_VERSION";
        case BeginStatus::AlreadyActive:
            return "ALREADY_ACTIVE";
        case BeginStatus::NoSpace:
            return "NO_SPACE";
        case BeginStatus::NoBaseProject:
            return "NO_BASE_PROJECT";
        case BeginStatus::AuditUnavailable:
            return "AUDIT_UNAVAILABLE";
        case BeginStatus::StoreError:
            return "STORE_IO";
        case BeginStatus::PersistFailed:
            return "PERSIST_FAILED";
    }
    return "";
}

RecordWriter::Ticket RecordWriter::take(const std::string& id, std::string text) {
    Ticket t;
    t.id = id;
    const size_t h = std::hash<std::string>{}(text);
    t.text = std::move(text);
    std::lock_guard<std::mutex> g(mu_);
    t.seq = ++seq_;
    const auto it = written_.find(id);
    t.unchanged = it != written_.end() && it->second.any && it->second.hash == h;
    return t;
}

bool RecordWriter::write(const Ticket& t, std::string& err) {
    if (t.unchanged) return true;
    std::lock_guard<std::mutex> io(io_);
    {
        std::lock_guard<std::mutex> g(mu_);
        const auto it = written_.find(t.id);
        if (it != written_.end() && it->second.seq > t.seq) return true;  // a newer one is there
    }
    if (!write_(t.id, t.text, err)) return false;
    std::lock_guard<std::mutex> g(mu_);
    Written& w = written_[t.id];
    w.seq = t.seq;
    w.hash = std::hash<std::string>{}(t.text);
    w.any = true;
    return true;
}

void RecordWriter::forget(const std::string& id) {
    std::lock_guard<std::mutex> g(mu_);
    written_.erase(id);
}

// ---------- DeployPipeline ----------

struct DeployPipeline::Impl {
    // Writing: a record is being written with the mutex released (persist()); every call that
    // changes the operation finds a phase it does not act on and leaves it alone meanwhile.
    enum class Phase { None, Receiving, Ready, Running, Health, RollingBack, Writing };

    ProjectStore& store;
    DeployHooks h;
    DeployOptions o;
    mutable std::mutex mu;
    std::optional<DeployOperation> cur;
    Phase phase = Phase::None;
    int pkgFd = -1;
    uint64_t received = 0;
    uint64_t contentLength = 0;
    std::string expectedDigest;
    int64_t receiveDeadline = 0;
    std::optional<int64_t> healthDeadline;
    std::string toName, toMinRuntime;                    // from verify-package, for meta.json
    std::vector<std::pair<int64_t, std::string>> index;  // (serial, opId) of the records
    int64_t maxSerial = 0;
    bool dead = false;  // the process was replaced (tests) or stopped by beforeStep
    RecordWriter records;

    Impl(ProjectStore& s, DeployHooks hooks, DeployOptions options)
        : store(s),
          h(std::move(hooks)),
          o(std::move(options)),
          records([this](const std::string& id, const std::string& text, std::string& err) {
              return store.writeOp(id, text, err);
          }) {}

    void log(const std::string& line) const {
        if (o.log)
            o.log(line);
        else
            std::fprintf(stderr, "deploy: %s\n", line.c_str());
    }
    int64_t wall() const { return o.wallMs ? o.wallMs() : store.wallMs(); }
    int64_t mono() const { return o.monoMs ? o.monoMs() : systemMonoMs(); }
    std::string now() const { return isoUtc(wall()); }
    bool freeBytes(uint64_t& out) const {
        return h.freeBytes ? h.freeBytes(store.dir(), out) : statvfsFreeBytes(store.dir(), out);
    }

    void startStep(DeployOperation& op, const char* id) {
        if (DeployStep* s = op.step(id)) {
            s->state = StepState::Running;
            s->startedAt = now();
        }
    }
    void okStep(DeployOperation& op, const char* id) {
        if (DeployStep* s = op.step(id)) {
            if (!s->startedAt) s->startedAt = now();
            s->state = StepState::Ok;
            s->endedAt = now();
        }
    }
    void failStep(DeployOperation& op, const char* id, const std::string& code,
                  const std::string& message, std::vector<ProjectIssue> issues = {}) {
        DeployStep* s = op.step(id);
        if (!s) {
            op.steps.push_back(DeployStep{});
            s = &op.steps.back();
            s->id = id;
        }
        if (!s->startedAt) s->startedAt = now();
        s->state = StepState::Failed;
        s->endedAt = now();
        s->code = code;
        s->message = message.empty() ? stepMessage(code) : message;
        s->issues = issues;
        if (!op.error) op.error = DeployError{code, s->message, std::move(issues)};
    }
    void startRollback(DeployOperation& op) {
        if (!op.step(kStepRollback)) {
            DeployStep s;
            s.id = kStepRollback;
            op.steps.push_back(s);
        }
        startStep(op, kStepRollback);
    }

    // Writes ops/<opId>.json (atomic); a new record is indexed and the oldest beyond 20 removed.
    // Feature 011 (FR-023, research R8): the text is taken under the mutex, then written and
    // synced with the mutex released, so the readers of the operation never wait for the eMMC; a
    // text that did not change is not written again. false: the record is not on disk (before the
    // activation the caller fails the operation with PERSIST_FAILED).
    bool persist(std::unique_lock<std::mutex>& lock, const DeployOperation& op) {
        indexRecord(op);
        const RecordWriter::Ticket t = records.take(op.opId, deployRecordJson(op));
        if (t.unchanged) return true;
        const Phase was = phase;
        phase = Phase::Writing;
        lock.unlock();
        std::string err;
        const bool ok = records.write(t, err);
        lock.lock();
        phase = was;
        if (!ok) log("record " + t.id + ": " + err);
        return ok;
    }
    void indexRecord(const DeployOperation& op) {
        const bool known = std::any_of(index.begin(), index.end(),
                                       [&](const auto& e) { return e.second == op.opId; });
        if (!known) index.emplace_back(op.serial, op.opId);
        std::sort(index.begin(), index.end());
        while (index.size() > kStoreOpsKept) {
            const auto victim = std::find_if(index.begin(), index.end(), [&](const auto& e) {
                return !cur || e.second != cur->opId;
            });
            if (victim == index.end()) break;
            store.removeOp(victim->second);
            records.forget(victim->second);
            index.erase(victim);
        }
    }

    AuditEvent event(const DeployOperation& op, AuditResult result, const std::string& code) {
        const std::string src =
            !op.auditSource.empty() ? op.auditSource : !op.source.empty() ? op.source : "system";
        AuditEvent e(
            op.kind == OpKind::Restore ? AuditAction::ProjectRestore : AuditAction::ProjectDeploy,
            result, AuditChannel::Https, src);
        if (!op.user.empty()) e.user = op.user;
        if (!op.role.empty()) e.role = op.role;
        if (!op.to.digest.empty()) e.target = op.to.digest;
        if (!code.empty()) e.code = code;
        Json d;
        d["opId"] = op.opId;
        d["from"] = op.from ? Json(op.from->digest) : Json(nullptr);
        d["to"] = op.to.digest;
        if (op.kind == OpKind::Restore && op.to.seq) d["seq"] = *op.to.seq;
        e.detail = jsonText(d);
        return e;
    }
    // Result rows: best effort (the operation cannot be undone any more).
    void auditResult(const DeployOperation& op, AuditResult result) {
        if (!o.audit) return;
        try {
            o.audit(event(op, result, op.error ? op.error->code : ""));
        } catch (const std::exception& e) {
            log("audit of " + op.opId + " not written: " + e.what());
        }
    }

    void closePackage() {
        if (pkgFd >= 0) ::close(pkgFd);
        pkgFd = -1;
    }
    void release() {
        closePackage();
        cur.reset();
        phase = Phase::None;
        healthDeadline.reset();
    }

    // A failure before activation: the record, then the cleanup, then the audit row.
    void failBeforeActivation(std::unique_lock<std::mutex>& lock, const char* stepId,
                              const std::string& code, const std::string& message,
                              std::vector<ProjectIssue> issues = {}) {
        DeployOperation& op = *cur;
        failStep(op, stepId, code, message, std::move(issues));
        op.result = DeployResult::Failed;
        op.endedAt = now();
        persist(lock, op);
        closePackage();
        store.removeStaging(op.opId);
        if (op.kind == OpKind::Deploy && op.to.seq) {
            store.removeVersion(*op.to.seq);
            op.to.seq.reset();
        }
        auditResult(op, AuditResult::Failed);
        log(op.opId + " failed at " + stepId + ": " + code);
        release();
    }

    BusyInfo busyInfo() const {
        return BusyInfo{cur->opId, cur->kind, cur->user, cur->source, cur->startedMs};
    }

    void refuse(const BeginRequest& r, const char* code) {
        if (!o.audit) return;
        AuditEvent e(
            r.kind == OpKind::Restore ? AuditAction::ProjectRestore : AuditAction::ProjectDeploy,
            AuditResult::Failed, AuditChannel::Https,
            r.who.auditSource.empty() ? r.who.ip : r.who.auditSource);
        if (e.source.empty()) e.source = "system";
        if (!r.who.user.empty()) e.user = r.who.user;
        if (!r.who.role.empty()) e.role = r.who.role;
        if (r.kind == OpKind::Deploy && !r.packageDigest.empty()) e.target = r.packageDigest;
        if (r.kind == OpKind::Restore) e.target = std::to_string(r.seq);
        e.code = code;
        try {
            o.audit(e);
        } catch (const std::exception&) {
        }
    }

    DeployOperation reconstruct(const PendingOperation& p) {
        const StoreState s = store.state();
        DeployOperation op;
        op.opId = p.opId;
        op.kind = p.kind;
        op.user = p.user;
        op.source = p.source;
        op.startedAt = p.startedAt;
        op.startedMs = wall();
        op.serial = ++maxSerial;
        if (p.from)
            if (const ProjectVersion* v = s.find(*p.from))
                op.from = DeployFrom{v->seq, v->digest, v->projectVersion};
        op.to.seq = p.to;
        if (const auto m = store.readMeta(p.to)) {
            op.to.digest = m->digest;
            op.to.projectId = m->projectId;
            op.to.projectVersion = m->projectVersion;
        }
        for (const char* id : kStepIds) {
            DeployStep st;
            st.id = id;
            const bool skipped =
                p.kind == OpKind::Restore && (st.id == kStepReceive || st.id == kStepVerify);
            st.state = skipped ? StepState::Skipped
                               : st.id == kStepActivate
                                     ? StepState::Running
                                     : st.id == kStepHealth ? StepState::Pending : StepState::Ok;
            op.steps.push_back(st);
        }
        return op;
    }
};

DeployPipeline::DeployPipeline(ProjectStore& store, DeployHooks hooks, DeployOptions options)
    : impl_(new Impl(store, std::move(hooks), std::move(options))) {}

DeployPipeline::~DeployPipeline() { impl_->closePackage(); }

void DeployPipeline::resume(const StoreStartup& st) {
    std::unique_lock<std::mutex> lock(impl_->mu);
    Impl& m = *impl_;
    std::vector<DeployOperation> records;
    for (const auto& id : m.store.opIds()) {
        std::string err;
        const auto text = m.store.readOp(id);
        auto op = text ? parseDeployRecord(*text, err) : std::nullopt;
        if (!op) {
            m.log("record " + id + " unreadable: " + err);
            continue;
        }
        m.index.emplace_back(op->serial, op->opId);
        m.maxSerial = std::max(m.maxSerial, op->serial);
        records.push_back(std::move(*op));
    }
    std::sort(m.index.begin(), m.index.end());
    const std::string pendingId = st.pending ? st.pending->opId : "";

    // Killed before activation: the record still runs and state.json has no pending for it.
    for (auto& op : records) {
        if (op.result != DeployResult::Running || op.opId == pendingId) continue;
        std::string stepId = op.runningStep();
        if (stepId.empty())
            for (const auto& s : op.steps)
                if (s.state == StepState::Pending) {
                    stepId = s.id;
                    break;
                }
        m.failStep(op, stepId.empty() ? kStepActivate : stepId.c_str(), "INTERRUPTED", "");
        op.result = DeployResult::Interrupted;
        op.endedAt = m.now();
        m.persist(lock, op);
        m.store.removeStaging(op.opId);
        m.auditResult(op, AuditResult::Interrupted);
    }

    if (!st.pending) return;
    DeployOperation op;
    const auto rec = std::find_if(records.begin(), records.end(),
                                  [&](const DeployOperation& r) { return r.opId == pendingId; });
    if (rec != records.end()) {
        op = *rec;
    } else {
        op = m.reconstruct(*st.pending);
        m.persist(lock, op);
    }
    op.result = DeployResult::Running;
    op.endedAt.reset();
    const BootDecision& d = st.decision;
    switch (d.action) {
        case BootAction::TryNew:
            m.okStep(op, kStepActivate);
            m.startStep(op, kStepHealth);
            m.cur = op;
            m.phase = Impl::Phase::Health;
            m.healthDeadline = st.stateReadMonoMs + kHealthTimeoutMs;
            return;
        case BootAction::RollBack:
            m.okStep(op, kStepActivate);
            m.failStep(op, kStepHealth, d.healthCode, "");
            m.startRollback(op);
            m.persist(lock, op);
            m.cur = op;
            m.phase = Impl::Phase::RollingBack;
            m.healthDeadline = st.stateReadMonoMs + kHealthTimeoutMs;
            return;
        case BootAction::ContinueRollBack:
            if (op.step(kStepRollback) == nullptr ||
                op.step(kStepRollback)->state != StepState::Running)
                m.startRollback(op);
            m.cur = op;
            m.phase = Impl::Phase::RollingBack;
            m.healthDeadline = st.stateReadMonoMs + kHealthTimeoutMs;
            return;
        default:
            break;
    }
    if (!d.opEnded) return;  // state.json could not be written: the operation stays pending
    if (!d.healthCode.empty()) {
        m.okStep(op, kStepActivate);
        m.failStep(op, kStepHealth, d.healthCode, "");
    }
    if (!op.step(kStepRollback)) m.startRollback(op);
    if (!d.rollbackCode.empty()) {
        m.failStep(op, kStepRollback, d.rollbackCode, "");
        op.result = DeployResult::Failed;
    } else {
        m.okStep(op, kStepRollback);
        op.result = DeployResult::RolledBack;
    }
    op.endedAt = m.now();
    m.persist(lock, op);
    m.auditResult(
        op, op.result == DeployResult::Failed ? AuditResult::Failed : AuditResult::RolledBack);
}

BeginResult DeployPipeline::begin(const BeginRequest& r) {
    std::unique_lock<std::mutex> lock(impl_->mu);
    Impl& m = *impl_;
    BeginResult out;
    auto refuse = [&](BeginStatus s, const std::string& message) {
        out.status = s;
        out.message = message;
        if (s != BeginStatus::AuditUnavailable) m.refuse(r, beginErrorCode(s));
        return out;
    };
    if (m.dead) return refuse(BeginStatus::StoreError, "runtime đang khởi động lại");
    if (m.cur) {
        out.busy = m.busyInfo();
        return refuse(BeginStatus::Busy, "Thiết bị đang bận với thao tác khác");
    }
    if (const std::string why = m.store.baseBlockReason(); !why.empty())
        return refuse(BeginStatus::NoBaseProject, why);
    if (m.store.stateStatus() == StateStatus::Corrupt)
        return refuse(BeginStatus::StoreError, "state.json hỏng");
    const StoreState s = m.store.state();
    if (s.pending) return refuse(BeginStatus::StoreError, "Kho project còn thao tác dở");
    const ProjectVersion* active = s.active ? s.find(*s.active) : nullptr;
    std::string running = "none";
    if (m.o.runningDigest) {
        running = m.o.runningDigest().value_or("none");
    } else if (active) {
        running = active->digest;
    }
    if (r.baseDigest != running)
        return refuse(BeginStatus::BaseChanged, "Project trên thiết bị đã đổi sau lúc xem trước");
    const ProjectVersion* target = nullptr;
    if (r.kind == OpKind::Restore) {
        target = s.find(r.seq);
        if (!target || !m.store.isComplete(r.seq))
            return refuse(BeginStatus::NoSuchVersion, "Không có bản lưu này");
        if (s.active == r.seq) return refuse(BeginStatus::AlreadyActive, "Bản này đang chạy");
    } else {
        uint64_t free = 0;
        if (!m.freeBytes(free)) return refuse(BeginStatus::StoreError, "Không đọc được chỗ trống");
        if (free < m.o.minFreeBytes || free - m.o.minFreeBytes < r.contentLength)
            return refuse(BeginStatus::NoSpace, "Không đủ chỗ trống cho gói");
    }

    DeployOperation op;
    op.opId = m.o.newOpId ? m.o.newOpId() : newOpId();
    op.kind = r.kind;
    op.user = r.who.user;
    op.role = r.who.role;
    op.source = r.who.ip;
    op.auditSource = r.who.auditSource;
    op.startedMs = m.wall();
    op.startedAt = isoUtc(op.startedMs);
    op.clockOk = m.store.clockSynced(op.startedMs);
    if (active) op.from = DeployFrom{active->seq, active->digest, active->projectVersion};
    if (target) {
        op.to.seq = target->seq;
        op.to.digest = target->digest;
        op.to.projectId = target->projectId;
        op.to.projectVersion = target->projectVersion;
    } else {
        op.to.digest = r.packageDigest;
    }
    for (const char* id : kStepIds) {
        DeployStep st;
        st.id = id;
        if (r.kind == OpKind::Restore && (st.id == kStepReceive || st.id == kStepVerify))
            st.state = StepState::Skipped;
        op.steps.push_back(st);
    }
    if (r.kind == OpKind::Deploy) m.startStep(op, kStepReceive);
    if (!validOpId(op.opId)) return refuse(BeginStatus::StoreError, "opId không hợp lệ");

    // Audit `started` before anything changes.
    if (!m.o.audit) return refuse(BeginStatus::AuditUnavailable, "Không ghi được audit");
    try {
        m.o.audit(m.event(op, AuditResult::Started, ""));
    } catch (const std::exception&) {
        return refuse(BeginStatus::AuditUnavailable, "Không ghi được audit");
    }
    op.serial = ++m.maxSerial;
    m.cur = op;
    if (!m.persist(lock, *m.cur)) {
        m.failBeforeActivation(lock, r.kind == OpKind::Deploy ? kStepReceive : kStepValidate,
                               "PERSIST_FAILED", "");
        out.status = BeginStatus::PersistFailed;
        out.message = "Không ghi được bản ghi thao tác";
        return out;
    }
    if (r.kind == OpKind::Deploy) {
        std::string err;
        m.pkgFd = m.store.createStaging(op.opId, err);
        if (m.pkgFd < 0) {
            m.failBeforeActivation(lock, kStepReceive, "STORE_IO", err);
            out.status = BeginStatus::StoreError;
            out.message = err;
            return out;
        }
        m.received = 0;
        m.contentLength = r.contentLength;
        m.expectedDigest = r.packageDigest;
        m.receiveDeadline = m.mono() + kReceiveTimeoutMs;
        m.phase = Impl::Phase::Receiving;
    } else {
        m.phase = Impl::Phase::Ready;
    }
    out.status = BeginStatus::Started;
    out.opId = op.opId;
    return out;
}

ReceiveStatus DeployPipeline::receive(const std::string& opId, const void* data, size_t n) {
    std::unique_lock<std::mutex> lock(impl_->mu);
    Impl& m = *impl_;
    if (m.dead || !m.cur || m.cur->opId != opId || m.phase != Impl::Phase::Receiving)
        return ReceiveStatus::Gone;
    if (m.mono() >= m.receiveDeadline) {
        m.failBeforeActivation(lock, kStepReceive, "RECEIVE_TIMEOUT", "");
        return ReceiveStatus::Gone;
    }
    if (n > m.contentLength - m.received) {
        m.failBeforeActivation(lock, kStepReceive, "RECEIVE_ABORTED", "Gói dài hơn Content-Length");
        return ReceiveStatus::Failed;
    }
    uint64_t free = 0;
    if (!m.freeBytes(free) || free < m.o.minFreeBytes || free - m.o.minFreeBytes < n) {
        m.failBeforeActivation(lock, kStepReceive, "NO_SPACE", "");
        return ReceiveStatus::Failed;
    }
    const char* p = static_cast<const char*>(data);
    size_t done = 0;
    while (done < n) {
        const ssize_t w = ::write(m.pkgFd, p + done, n - done);
        if (w < 0 && errno == EINTR) continue;
        if (w <= 0) {
            const bool full = errno == ENOSPC || errno == EDQUOT;
            m.failBeforeActivation(lock, kStepReceive, full ? "NO_SPACE" : "STORE_IO",
                                   full ? "" : std::string("ghi gói lỗi: ") + std::strerror(errno));
            return ReceiveStatus::Failed;
        }
        done += static_cast<size_t>(w);
    }
    m.received += n;
    return ReceiveStatus::Ok;
}

ReceiveStatus DeployPipeline::receiveEnd(const std::string& opId, bool complete) {
    std::unique_lock<std::mutex> lock(impl_->mu);
    Impl& m = *impl_;
    if (m.dead || !m.cur || m.cur->opId != opId || m.phase != Impl::Phase::Receiving)
        return ReceiveStatus::Gone;
    if (!complete || m.received != m.contentLength) {
        m.failBeforeActivation(lock, kStepReceive, "RECEIVE_ABORTED", "");
        return ReceiveStatus::Failed;
    }
    if (::fsync(m.pkgFd) != 0) {
        m.failBeforeActivation(lock, kStepReceive, "STORE_IO",
                               std::string("fsync gói lỗi: ") + std::strerror(errno));
        return ReceiveStatus::Failed;
    }
    m.closePackage();
    m.okStep(*m.cur, kStepReceive);
    m.phase = Impl::Phase::Ready;
    return ReceiveStatus::Ok;
}

RunOutcome DeployPipeline::run(const std::string& opId) {
    Impl& m = *impl_;
    std::unique_lock<std::mutex> lock(m.mu);
    if (m.dead || !m.cur || m.cur->opId != opId || m.phase != Impl::Phase::Ready)
        return RunOutcome::Ignored;
    m.phase = Impl::Phase::Running;
    const OpKind kind = m.cur->kind;
    const std::string staging = m.store.stagingDir(opId);
    // Stopped: the test hook stopped the process here (nothing more is touched). Failed: the
    // record could not be written (PERSIST_FAILED, feature 011); the operation failed at this step.
    // The record is written before each step, so a process killed there is shown as interrupted at
    // that step (not at the one the record was started with).
    enum class Next { Go, Stopped, Failed };
    auto proceed = [&](const char* stepId) {
        if (!m.persist(lock, *m.cur)) {
            m.failBeforeActivation(lock, stepId, "PERSIST_FAILED", "");
            return Next::Failed;
        }
        if (!m.h.beforeStep) return Next::Go;
        lock.unlock();
        const bool go = m.h.beforeStep(stepId);
        lock.lock();
        if (!go) m.dead = true;
        return go ? Next::Go : Next::Stopped;
    };
    auto outcome = [](Next n) {
        return n == Next::Failed ? RunOutcome::Failed : RunOutcome::Stopped;
    };

    if (kind == OpKind::Deploy) {
        if (const Next n = proceed(kStepVerify); n != Next::Go) return outcome(n);
        m.startStep(*m.cur, kStepVerify);
        VerifyRequest req{opId, staging + "/" + kStorePackageFile, staging + "/" + kStoreProjectDir,
                          m.expectedDigest, m.o.minFreeBytes};
        lock.unlock();
        VerifyOutcome v;
        if (m.h.verifyPackage)
            v = m.h.verifyPackage(req);
        else
            v.code = "STORE_IO";
        lock.lock();
        if (!v.ok) {
            std::vector<ProjectIssue> issues;
            if (!v.path.empty()) issues.push_back({v.code, v.path, "", v.message});
            m.failBeforeActivation(lock, kStepVerify, v.code.empty() ? "STORE_IO" : v.code,
                                   v.message, issues);
            return RunOutcome::Failed;
        }
        m.cur->to.digest = v.digest;
        m.cur->to.projectId = v.projectId;
        m.cur->to.projectVersion = v.projectVersion;
        m.toName = v.projectName;
        m.toMinRuntime = v.minRuntimeVersion;
        m.okStep(*m.cur, kStepVerify);
    }

    if (const Next n = proceed(kStepValidate); n != Next::Go) return outcome(n);
    m.startStep(*m.cur, kStepValidate);
    const std::string dir = kind == OpKind::Deploy ? staging + "/" + kStoreProjectDir
                                                   : m.store.projectDir(*m.cur->to.seq);
    lock.unlock();
    ValidateOutcome val;
    if (m.h.validate) val = m.h.validate(dir);
    lock.lock();
    if (!val.ok) {
        m.failBeforeActivation(lock, kStepValidate, "E_VALIDATION", "", val.issues);
        return RunOutcome::Failed;
    }
    m.okStep(*m.cur, kStepValidate);

    if (const Next n = proceed(kStepBackup); n != Next::Go) return outcome(n);
    m.startStep(*m.cur, kStepBackup);
    if (kind == OpKind::Deploy) {
        ProjectVersion meta;
        meta.digest = m.cur->to.digest;
        meta.projectId = m.cur->to.projectId;
        meta.projectName = m.toName;
        meta.projectVersion = m.cur->to.projectVersion;
        meta.minRuntimeVersion = m.toMinRuntime;
        meta.size = static_cast<int64_t>(m.contentLength);
        meta.clockOk = m.cur->clockOk;
        meta.deployedBy = m.cur->user;
        meta.deployedFrom = m.cur->source;
        meta.source = VersionSource::Studio;
        std::string err;
        const auto seq = m.store.commitStaging(opId, meta, err);
        if (!seq) {
            m.failBeforeActivation(lock, kStepBackup, "STORE_IO", err);
            return RunOutcome::Failed;
        }
        m.cur->to.seq = *seq;
    } else if (!m.store.isComplete(*m.cur->to.seq)) {
        m.failBeforeActivation(lock, kStepBackup, "STORE_IO", "Bản lưu thiếu file");
        return RunOutcome::Failed;
    }
    m.okStep(*m.cur, kStepBackup);

    if (const Next n = proceed(kStepActivate); n != Next::Go) return outcome(n);
    if (m.h.quiesce) {  // feature 006: the writes in flight end before the project changes
        lock.unlock();
        m.h.quiesce();
        lock.lock();
    }
    m.startStep(*m.cur, kStepActivate);
    PendingOperation p;
    p.opId = opId;
    p.kind = kind;
    if (m.cur->from) p.from = m.cur->from->seq;
    p.to = *m.cur->to.seq;
    p.user = m.cur->user;
    p.source = m.cur->source;
    p.startedAt = m.cur->startedAt;
    std::string err;
    if (!m.store.beginActivation(p, err)) {
        m.failBeforeActivation(lock, kStepActivate, "STORE_IO", err);
        return RunOutcome::Failed;
    }
    lock.unlock();
    const int clients = m.h.notifyClients ? m.h.notifyClients() : 0;
    lock.lock();
    m.cur->clientsNotified = clients;
    // The record must say "activate running" before execv (a process killed during the restart is
    // then taken over at the next start); not written (feature 011): the activation is cancelled.
    std::string failCode = "PERSIST_FAILED";
    std::string restartError = "Không ghi được bản ghi thao tác";
    if (m.persist(lock, *m.cur)) {
        lock.unlock();
        restartError = "không có hàm khởi động lại";
        const RestartOutcome ro = m.h.restart ? m.h.restart(restartError) : RestartOutcome::Failed;
        lock.lock();
        if (ro == RestartOutcome::Replaced) {
            m.dead = true;
            return RunOutcome::Restarted;
        }
        failCode = "EXEC_FAILED";
    }
    // execv failed (or the record was not written): back to the running version.
    DeployOperation& op = *m.cur;
    m.failStep(op, kStepActivate, failCode, restartError);
    op.result = DeployResult::Failed;
    op.endedAt = m.now();
    m.persist(lock, op);
    if (!m.store.endPending(true, err)) m.log("cancel of activation not written: " + err);
    m.store.removeUnreferenced();
    m.auditResult(op, AuditResult::Failed);
    m.release();
    return RunOutcome::Failed;
}

RunOutcome DeployPipeline::healthPassed() {
    std::unique_lock<std::mutex> lock(impl_->mu);
    Impl& m = *impl_;
    if (m.dead || !m.cur || (m.phase != Impl::Phase::Health && m.phase != Impl::Phase::RollingBack))
        return RunOutcome::Ignored;
    DeployOperation& op = *m.cur;
    std::string err;
    if (m.phase == Impl::Phase::Health) {
        const StoreState s = m.store.state();
        const int64_t seq = op.to.seq.value_or(0);
        ProjectVersion entry;
        if (const ProjectVersion* v = s.find(seq))
            entry = *v;
        else if (const auto meta = m.store.readMeta(seq))
            entry = *meta;
        const int64_t now = m.wall();
        entry.seq = seq;
        entry.activatedAt = isoUtc(now);
        entry.clockOk = m.store.clockSynced(now);
        entry.deployedBy = op.user;
        entry.deployedFrom = op.source;
        if (op.kind == OpKind::Restore) entry.source = VersionSource::Restore;
        const DeployOperation before = op;
        m.okStep(op, kStepHealth);
        op.result = DeployResult::Committed;
        op.endedAt = m.now();
        m.persist(lock, op);
        if (!m.store.commitPending(entry, err)) {
            m.log("commit of " + op.opId + " not written: " + err);
            op = before;
            m.persist(lock, op);
            return RunOutcome::Failed;
        }
        m.auditResult(op, AuditResult::Ok);
    } else {
        const DeployOperation before = op;
        m.okStep(op, kStepRollback);
        op.result = DeployResult::RolledBack;
        op.endedAt = m.now();
        m.persist(lock, op);
        if (!m.store.endPending(true, err)) {
            m.log("end of rollback of " + op.opId + " not written: " + err);
            op = before;
            m.persist(lock, op);
            return RunOutcome::Failed;
        }
        m.store.removeUnreferenced();
        m.auditResult(op, AuditResult::RolledBack);
    }
    m.release();
    return RunOutcome::Done;
}

RunOutcome DeployPipeline::healthFailed(const std::string& code) {
    Impl& m = *impl_;
    std::unique_lock<std::mutex> lock(m.mu);
    if (m.dead || !m.cur || (m.phase != Impl::Phase::Health && m.phase != Impl::Phase::RollingBack))
        return RunOutcome::Ignored;
    DeployOperation& op = *m.cur;
    std::string err;
    if (m.phase == Impl::Phase::Health && op.from) {
        // Back to the version that ran before: state.json says rolling-back, then execv.
        m.failStep(op, kStepHealth, code, "");
        m.startRollback(op);
        m.persist(lock, op);
        if (!m.store.rollBackPending(err)) {
            m.log("rollback of " + op.opId + " not written: " + err);
            return RunOutcome::Failed;
        }
        m.healthDeadline.reset();
    } else {
        // Nothing to go back to, or the old version failed too: no project runs.
        const bool toNothing = m.phase == Impl::Phase::Health;
        if (toNothing) {
            m.failStep(op, kStepHealth, code, "");
            m.startRollback(op);
            m.okStep(op, kStepRollback);
            op.result = DeployResult::RolledBack;
        } else {
            m.failStep(op, kStepRollback, code, "");
            op.result = DeployResult::Failed;
        }
        op.endedAt = m.now();
        m.persist(lock, op);
        if (!m.store.endPending(false, err)) m.log("end of " + op.opId + " not written: " + err);
        m.store.removeUnreferenced();
        m.auditResult(op, toNothing ? AuditResult::RolledBack : AuditResult::Failed);
        m.release();
    }
    m.dead = true;  // the runtime restarts now
    lock.unlock();
    std::string restartError;
    const RestartOutcome ro = m.h.restart ? m.h.restart(restartError) : RestartOutcome::Failed;
    if (ro == RestartOutcome::Replaced) return RunOutcome::Restarted;
    m.log("restart failed: " + restartError);
    return RunOutcome::Failed;
}

RunOutcome DeployPipeline::poll() {
    Impl& m = *impl_;
    std::unique_lock<std::mutex> lock(m.mu);
    if (m.dead) return RunOutcome::Ignored;
    if (m.cur && m.phase == Impl::Phase::Receiving && m.mono() >= m.receiveDeadline) {
        m.failBeforeActivation(lock, kStepReceive, "RECEIVE_TIMEOUT", "");
        return RunOutcome::Failed;
    }
    if (m.cur && m.healthDeadline && m.mono() >= *m.healthDeadline &&
        (m.phase == Impl::Phase::Health || m.phase == Impl::Phase::RollingBack)) {
        lock.unlock();
        return healthFailed("HEALTH_TIMEOUT");
    }
    return RunOutcome::Done;
}

std::optional<DeployOperation> DeployPipeline::current() const {
    std::lock_guard<std::mutex> lock(impl_->mu);
    return impl_->cur;
}

std::optional<DeployOperation> DeployPipeline::find(const std::string& opId) const {
    std::lock_guard<std::mutex> lock(impl_->mu);
    if (impl_->cur && impl_->cur->opId == opId) return impl_->cur;
    const auto text = impl_->store.readOp(opId);
    if (!text) return std::nullopt;
    std::string err;
    return parseDeployRecord(*text, err);
}

std::optional<DeployOperation> DeployPipeline::latest() const {
    std::string id;
    {
        std::lock_guard<std::mutex> lock(impl_->mu);
        if (impl_->cur) return impl_->cur;
        if (impl_->index.empty()) return std::nullopt;
        id = impl_->index.back().second;
    }
    return find(id);
}

std::optional<int64_t> DeployPipeline::healthDeadlineMs() const {
    std::lock_guard<std::mutex> lock(impl_->mu);
    return impl_->healthDeadline;
}

}  // namespace mat
