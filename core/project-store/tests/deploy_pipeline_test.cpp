// Deploy and restore state machine (specs/005-device-online T098: data-model §10, device-api §4–5,
// research R13). The steps are fakes; the store is real, in a temporary directory. A "process" is
// one ProjectStore + startStore() + DeployPipeline; restart() returning Replaced stands for execv,
// after which the test starts a new process on the same directory.
#include "core/project-store/deploy_pipeline.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <map>
#include <thread>

#include "core/project-store/tests/store_test_support.hpp"
#include "nlohmann/json.hpp"

using namespace mat;
using namespace storetest;

namespace {

constexpr int64_t kT0 = 1792465200000;  // 2026-10-20T03:00:00Z
const std::string kNewBytes = "PK new package bytes";

struct Device {
    std::string data = tempDir();
    std::string dir = data + "/projects";
    std::string legacyDir = data + "/legacy";
    LegacyProject legacy = makeLegacy(legacyDir);
    int64_t wall = kT0;
    int64_t mono = 100000;
    FsyncRecorder fsyncs;
    FakeAudit audit;
    FakePack pack;
    std::vector<std::string> events;    // hook calls and audit rows, in order
    std::function<void()> quiesceHook;  // feature 006: set before boot() to have the hook

    // Behaviour of the fake steps.
    VerifyOutcome verifyResult;  // ok = false and code set: fail with it
    bool verifyFails = false;
    ValidateOutcome validateResult{true, {}};
    RestartOutcome restartResult = RestartOutcome::Replaced;
    uint64_t freeBytes = 10ULL << 30;
    std::string stopBefore;  // beforeStep: the process dies before this step
    std::string lastValidated;
    std::string lastPackage;

    std::unique_ptr<ProjectStore> store;
    StoreStartup startup;
    std::unique_ptr<DeployPipeline> pipe;
    int opCounter = 0;

    Device() {
        audit.onAppend = [this](const AuditEvent& e) {
            events.push_back(std::string("audit:") + auditActionName(e.action) + ":" +
                             auditResultName(e.result));
        };
        boot();
        EXPECT_EQ(startup.decision.action, BootAction::Adopt);
        events.clear();
        audit.rows.clear();
    }

    // A new process on the same directory (the old objects are dropped without cleanup, as a
    // process that died or was replaced).
    void boot() {
        pipe.release();   // NOLINT: a dead process runs no destructor
        store.release();  // NOLINT
        StoreOptions o;
        o.dir = dir;
        o.wallMs = [this] { return wall; };
        o.clockSynced = [](int64_t) { return true; };
        fsyncs.storeDir = dir;
        o.fsync = fsyncs.hook();
        o.log = [](const std::string&) {};
        store = std::make_unique<ProjectStore>(o);
        BootHooks bh;
        bh.legacy = [this] { return legacy; };
        bh.pack = pack.fn();
        bh.audit = audit.fn();
        bh.monoMs = [this] { return mono; };
        startup = startStore(*store, bh);
        pipe = std::make_unique<DeployPipeline>(*store, hooks(), options());
        pipe->resume(startup);
    }

    DeployHooks hooks() {
        DeployHooks h;
        h.verifyPackage = [this](const VerifyRequest& r) {
            events.push_back("verify");
            lastPackage = readFile(r.packagePath);
            if (verifyFails) return verifyResult;
            writeFile(r.projectDir + "/project.json", "{\"from\":\"" + lastPackage + "\"}");
            VerifyOutcome v;
            v.ok = true;
            v.digest = fakeDigest(lastPackage);
            v.projectId = "tank-demo";
            v.projectName = "Tank demo";
            v.projectVersion = "2.0.0";
            v.minRuntimeVersion = "0.4.0";
            return v;
        };
        h.validate = [this](const std::string& d) {
            events.push_back("validate");
            lastValidated = d;
            return validateResult;
        };
        if (quiesceHook) h.quiesce = quiesceHook;
        h.notifyClients = [this] {
            events.push_back("notify");
            return 4;
        };
        h.restart = [this](std::string& err) {
            events.push_back("restart");
            if (restartResult == RestartOutcome::Failed) err = "execv: ENOENT";
            return restartResult;
        };
        h.freeBytes = [this](const std::string&, uint64_t& out) {
            out = freeBytes;
            return true;
        };
        h.beforeStep = [this](const std::string& id) { return id != stopBefore; };
        return h;
    }

    DeployOptions options() {
        DeployOptions o;
        o.minFreeBytes = 500ULL << 20;
        o.audit = audit.fn();
        o.wallMs = [this] { return wall; };
        o.monoMs = [this] { return mono; };
        o.newOpId = [this] { return opIdN(++opCounter); };
        o.log = [](const std::string&) {};
        return o;
    }

    static std::string opIdN(int n) {
        char buf[40];
        std::snprintf(buf, sizeof buf, "%08x-0000-4000-8000-%012x", n, n);
        return buf;
    }

    std::string activeDigest() {
        const StoreState s = store->state();
        if (!s.active) return "none";
        const ProjectVersion* v = s.find(*s.active);
        return v ? v->digest : "<missing>";
    }

    BeginResult beginDeploy(const std::string& user = "kysu1",
                            const std::string& ip = "192.168.1.20",
                            std::optional<std::string> base = std::nullopt,
                            const std::string& bytes = kNewBytes) {
        BeginRequest r;
        r.kind = OpKind::Deploy;
        r.who = {user, "engineer", ip, ip + ":50123"};
        r.baseDigest = base.value_or(activeDigest());
        r.packageDigest = fakeDigest(bytes);
        r.contentLength = bytes.size();
        return pipe->begin(r);
    }
    BeginResult beginRestore(int64_t seq, const std::string& user = "kysu2") {
        BeginRequest r;
        r.kind = OpKind::Restore;
        r.who = {user, "engineer", "192.168.1.30", "192.168.1.30:40000"};
        r.baseDigest = activeDigest();
        r.seq = seq;
        return pipe->begin(r);
    }
    // begin + whole body + run.
    RunOutcome deploy(std::string* opId = nullptr, const std::string& bytes = kNewBytes) {
        const BeginResult b = beginDeploy("kysu1", "192.168.1.20", std::nullopt, bytes);
        EXPECT_EQ(b.status, BeginStatus::Started) << b.message;
        if (opId) *opId = b.opId;
        EXPECT_EQ(pipe->receive(b.opId, bytes.data(), 5), ReceiveStatus::Ok);
        EXPECT_EQ(pipe->receive(b.opId, bytes.data() + 5, bytes.size() - 5), ReceiveStatus::Ok);
        EXPECT_EQ(pipe->receiveEnd(b.opId, true), ReceiveStatus::Ok);
        return pipe->run(b.opId);
    }

    std::string state() { return readFile(dir + "/state.json"); }
    StoreState disk() {
        std::string err;
        return parseStoreState(state(), err).value_or(StoreState{});
    }
    DeployOperation record(const std::string& opId) {
        std::string err;
        auto op = parseDeployRecord(readFile(dir + "/ops/" + opId + ".json"), err);
        EXPECT_TRUE(op.has_value()) << err;
        return op.value_or(DeployOperation{});
    }
    std::vector<std::string> versionDirs() { return listDir(dir + "/v"); }
};

std::string stepStates(const DeployOperation& op) {
    std::string s;
    for (const auto& st : op.steps) s += st.id + "=" + stepStateName(st.state) + " ";
    return s;
}

// Safe views of an operation: a missing step or error fails the assertion, not the process.
DeployStep stepOf(const DeployOperation& op, const std::string& id) {
    if (const DeployStep* s = op.step(id)) return *s;
    DeployStep missing;
    missing.id = "<missing>";
    missing.state = StepState::Skipped;
    missing.code = "<missing>";
    return missing;
}
FakeAudit::Row lastRow(const FakeAudit& a) {
    return a.rows.empty() ? FakeAudit::Row{} : a.rows.back();
}
std::string errCode(const DeployOperation& op) { return op.error ? op.error->code : "<none>"; }
std::string curStep(const DeployPipeline& p) {
    const auto c = p.current();
    return c ? c->runningStep() : "<no current>";
}
std::string latestId(const DeployPipeline& p) {
    const auto l = p.latest();
    return l ? l->opId : "<none>";
}

}  // namespace

// ---------- the normal path ----------

TEST(DeployPipeline, DeployRunsTheStepsInOrderAndCommitsAfterTheHealthCheck) {
    Device d;
    const std::string before = d.activeDigest();
    std::string opId;
    ASSERT_EQ(d.deploy(&opId), RunOutcome::Restarted);
    EXPECT_EQ(d.lastPackage, kNewBytes);
    EXPECT_EQ(d.events, (std::vector<std::string>{"audit:project.deploy:started", "verify",
                                                  "validate", "notify", "restart"}));
    // Before execv: pending activating, the record says activate running with 4 clients.
    StoreState s = d.disk();
    ASSERT_TRUE(s.pending.has_value());
    EXPECT_EQ(s.pending->phase, PendingPhase::Activating);
    EXPECT_EQ(s.pending->opId, opId);
    EXPECT_EQ(s.pending->from, 1);
    EXPECT_EQ(s.pending->to, 2);
    EXPECT_EQ(s.pending->user, "kysu1");
    EXPECT_EQ(s.pending->source, "192.168.1.20");
    EXPECT_EQ(s.active, 1);
    DeployOperation rec = d.record(opId);
    EXPECT_EQ(stepStates(rec),
              "receive=ok verify-package=ok validate=ok backup=ok activate=running "
              "health=pending ");
    EXPECT_EQ(rec.clientsNotified, 4);
    EXPECT_EQ(d.lastValidated, d.store->stagingDir(opId) + "/project");

    // The new process: health check running, the device busy.
    d.mono += 3000;
    d.boot();
    EXPECT_EQ(d.startup.decision.action, BootAction::TryNew);
    auto cur = d.pipe->current();
    ASSERT_TRUE(cur.has_value());
    EXPECT_EQ(cur->opId, opId);
    EXPECT_EQ(cur->runningStep(), "health");
    EXPECT_EQ(d.pipe->healthDeadlineMs(), std::optional<int64_t>(d.mono + kHealthTimeoutMs));
    EXPECT_EQ(d.pipe->healthPassed(), RunOutcome::Done);

    s = d.disk();
    EXPECT_EQ(s.active, 2);
    EXPECT_FALSE(s.pending.has_value());
    ASSERT_EQ(s.versions.size(), 2u);
    EXPECT_EQ(s.versions[0].seq, 2);
    EXPECT_EQ(s.versions[0].digest, fakeDigest(kNewBytes));
    EXPECT_EQ(s.versions[0].deployedBy, std::optional<std::string>("kysu1"));
    EXPECT_EQ(s.versions[0].deployedFrom, std::optional<std::string>("192.168.1.20"));
    EXPECT_EQ(s.versions[0].source, VersionSource::Studio);
    EXPECT_EQ(s.versions[0].projectVersion, "2.0.0");
    EXPECT_EQ(readFile(d.store->packagePath(2)), kNewBytes);

    rec = d.record(opId);
    EXPECT_EQ(rec.result, DeployResult::Committed);
    EXPECT_EQ(stepStates(rec),
              "receive=ok verify-package=ok validate=ok backup=ok activate=ok health=ok ");
    EXPECT_TRUE(rec.endedAt.has_value());
    EXPECT_EQ(rec.to.seq, 2);
    EXPECT_FALSE(rec.error.has_value());
    EXPECT_FALSE(d.pipe->current().has_value());
    EXPECT_EQ(latestId(*d.pipe), opId);

    ASSERT_EQ(d.audit.rows.size(), 2u);
    for (const auto& row : d.audit.rows) {
        EXPECT_EQ(row.action, "project.deploy");
        EXPECT_EQ(row.user, "kysu1");
        EXPECT_EQ(row.role, "engineer");
        EXPECT_EQ(row.source, "192.168.1.20:50123");
        EXPECT_EQ(row.channel, "https");
        EXPECT_EQ(row.target, fakeDigest(kNewBytes));
        const auto det = nlohmann::json::parse(row.detail);
        EXPECT_EQ(det["from"], before);
        EXPECT_EQ(det["to"], fakeDigest(kNewBytes));
        EXPECT_EQ(det["opId"], opId);
    }
    EXPECT_EQ(d.audit.rows[0].result, "started");
    EXPECT_EQ(d.audit.rows[1].result, "ok");
}

// Feature 006 T146 (FR-042): before the activation the tag write coordinator is quiesced; the chain
// goes on only when the hook has returned.
TEST(DeployPipeline, TheQuiesceHookRunsBeforeTheActivationAndTheChainWaitsForIt) {
    Device d;
    d.quiesceHook = [&d] {
        d.events.push_back("quiesce:begin");
        // nothing of the activation has begun: no pending operation on disk, nobody notified
        EXPECT_FALSE(d.disk().pending.has_value());
        std::this_thread::sleep_for(std::chrono::milliseconds(60));
        d.events.push_back("quiesce:end");
    };
    d.boot();
    d.events.clear();
    ASSERT_EQ(d.deploy(), RunOutcome::Restarted);
    EXPECT_EQ(d.events,
              (std::vector<std::string>{"audit:project.deploy:started", "verify", "validate",
                                        "quiesce:begin", "quiesce:end", "notify", "restart"}));
    ASSERT_TRUE(d.disk().pending.has_value()) << "the activation began after the hook";
}

TEST(DeployPipeline, TheQuiesceHookIsNotCalledWhenTheOperationFailsBeforeTheActivation) {
    Device d;
    int calls = 0;
    d.quiesceHook = [&calls] { ++calls; };
    d.boot();
    d.verifyFails = true;
    d.verifyResult.ok = false;
    d.verifyResult.code = "E_PKG_FORMAT";
    d.verifyResult.message = "x";
    d.deploy();
    EXPECT_EQ(calls, 0);
}

TEST(DeployPipeline, RestoreSkipsReceiveAndVerifyAndActivatesTheStoredVersion) {
    Device d;
    ASSERT_EQ(d.deploy(), RunOutcome::Restarted);
    d.boot();
    ASSERT_EQ(d.pipe->healthPassed(), RunOutcome::Done);
    d.events.clear();
    d.audit.rows.clear();

    const BeginResult b = d.beginRestore(1);
    ASSERT_EQ(b.status, BeginStatus::Started) << b.message;
    EXPECT_FALSE(exists(d.store->stagingDir(b.opId)));
    EXPECT_EQ(d.pipe->receive(b.opId, "x", 1), ReceiveStatus::Gone);
    ASSERT_EQ(d.pipe->run(b.opId), RunOutcome::Restarted);
    EXPECT_EQ(d.events, (std::vector<std::string>{"audit:project.restore:started", "validate",
                                                  "notify", "restart"}));
    EXPECT_EQ(d.lastValidated, d.store->projectDir(1));
    DeployOperation rec = d.record(b.opId);
    EXPECT_EQ(rec.kind, OpKind::Restore);
    EXPECT_EQ(stepStates(rec),
              "receive=skipped verify-package=skipped validate=ok backup=ok activate=running "
              "health=pending ");
    EXPECT_EQ(rec.to.seq, 1);
    ASSERT_TRUE(rec.from.has_value());
    EXPECT_EQ(rec.from->seq, 2);
    d.boot();
    ASSERT_EQ(d.pipe->healthPassed(), RunOutcome::Done);
    const StoreState s = d.disk();
    EXPECT_EQ(s.active, 1);
    ASSERT_EQ(s.versions.size(), 2u);
    EXPECT_EQ(s.versions[0].seq, 1);
    EXPECT_EQ(s.versions[0].source, VersionSource::Restore);
    EXPECT_EQ(s.versions[0].deployedBy, std::optional<std::string>("kysu2"));
    EXPECT_EQ(s.versions[1].seq, 2);
    EXPECT_EQ(d.versionDirs(), (std::vector<std::string>{"1", "2"}));
    EXPECT_EQ(lastRow(d.audit).action, "project.restore");
    EXPECT_EQ(lastRow(d.audit).result, "ok");
    EXPECT_EQ(lastRow(d.audit).user, "kysu2");
}

// ---------- failures before activation ----------

TEST(DeployPipeline, AFailureInTheFirstFourStepsChangesNothing) {
    struct Case {
        const char* name;
        std::function<void(Device&)> arrange;
        std::function<void(Device&, const std::string& opId)> act;  // after begin
        const char* code;
        const char* failedStep;
    };
    auto receiveAll = [](Device& d, const std::string& id) {
        ASSERT_EQ(d.pipe->receive(id, kNewBytes.data(), kNewBytes.size()), ReceiveStatus::Ok);
        ASSERT_EQ(d.pipe->receiveEnd(id, true), ReceiveStatus::Ok);
        EXPECT_EQ(d.pipe->run(id), RunOutcome::Failed);
    };
    const std::vector<Case> cases = {
        {"network dropped", nullptr,
         [](Device& d, const std::string& id) {
             ASSERT_EQ(d.pipe->receive(id, kNewBytes.data(), 4), ReceiveStatus::Ok);
             EXPECT_EQ(d.pipe->receiveEnd(id, false), ReceiveStatus::Failed);
         },
         "RECEIVE_ABORTED", "receive"},
        {"body shorter than Content-Length", nullptr,
         [](Device& d, const std::string& id) {
             ASSERT_EQ(d.pipe->receive(id, kNewBytes.data(), 4), ReceiveStatus::Ok);
             EXPECT_EQ(d.pipe->receiveEnd(id, true), ReceiveStatus::Failed);
         },
         "RECEIVE_ABORTED", "receive"},
        {"body longer than Content-Length", nullptr,
         [](Device& d, const std::string& id) {
             const std::string more = kNewBytes + "x";
             EXPECT_EQ(d.pipe->receive(id, more.data(), more.size()), ReceiveStatus::Failed);
         },
         "RECEIVE_ABORTED", "receive"},
        {"disk filling while receiving", nullptr,
         [](Device& d, const std::string& id) {
             ASSERT_EQ(d.pipe->receive(id, kNewBytes.data(), 4), ReceiveStatus::Ok);
             d.freeBytes = (500ULL << 20) + 2;
             EXPECT_EQ(d.pipe->receive(id, kNewBytes.data() + 4, 8), ReceiveStatus::Failed);
         },
         "NO_SPACE", "receive"},
        {"bad package",
         [](Device& d) {
             d.verifyFails = true;
             d.verifyResult.code = "E_PKG_CHECKSUM";
             d.verifyResult.path = "tags.json";
             d.verifyResult.message = "SHA-256 không khớp";
         },
         receiveAll, "E_PKG_CHECKSUM", "verify-package"},
        {"disk full while extracting",
         [](Device& d) {
             d.verifyFails = true;
             d.verifyResult.code = "NO_SPACE";
         },
         receiveAll, "NO_SPACE", "verify-package"},
        {"invalid project",
         [](Device& d) {
             d.validateResult.ok = false;
             d.validateResult.issues = {{"E_TAG_RANGE", "tags.json", "/tags/3", "min > max"}};
         },
         receiveAll, "E_VALIDATION", "validate"},
        {"backup cannot write",
         [](Device& d) {
             d.fsyncs.fail = [](const std::string& p) {
                 return p.find("meta.json") != std::string::npos;
             };
         },
         receiveAll, "STORE_IO", "backup"},
    };
    for (const Case& c : cases) {
        SCOPED_TRACE(c.name);
        Device d;
        const std::string stateBefore = d.state();
        if (c.arrange) c.arrange(d);
        const BeginResult b = d.beginDeploy();
        ASSERT_EQ(b.status, BeginStatus::Started);
        c.act(d, b.opId);
        d.fsyncs.fail = nullptr;
        d.freeBytes = 10ULL << 30;

        EXPECT_EQ(d.state(), stateBefore);
        EXPECT_EQ(d.versionDirs(), (std::vector<std::string>{"1"}));
        EXPECT_TRUE(listDir(d.dir + "/staging").empty());
        EXPECT_FALSE(d.pipe->current().has_value());
        const DeployOperation rec = d.record(b.opId);
        EXPECT_EQ(rec.result, DeployResult::Failed);
        ASSERT_TRUE(rec.error.has_value());
        EXPECT_EQ(errCode(rec), c.code);
        ASSERT_NE(rec.step(c.failedStep), nullptr);
        EXPECT_EQ(stepOf(rec, c.failedStep).state, StepState::Failed);
        EXPECT_EQ(stepOf(rec, c.failedStep).code, c.code);
        EXPECT_EQ(stepOf(rec, "activate").state, StepState::Pending);
        if (std::string(c.code) == "E_VALIDATION") {
            ASSERT_EQ(rec.error->issues.size(), 1u);
            EXPECT_EQ(rec.error->issues[0].code, "E_TAG_RANGE");
            EXPECT_EQ(stepOf(rec, "validate").issues.size(), 1u);
        }
        if (std::string(c.code) == "E_PKG_CHECKSUM") {
            ASSERT_EQ(rec.error->issues.size(), 1u);
            EXPECT_EQ(rec.error->issues[0].file, "tags.json");
        }
        ASSERT_EQ(d.audit.rows.size(), 2u);
        EXPECT_EQ(d.audit.rows[1].result, "failed");
        EXPECT_EQ(d.audit.rows[1].code, c.code);
        EXPECT_EQ(d.audit.rows[1].user, "kysu1");
        // The lock is free again.
        EXPECT_EQ(d.beginDeploy().status, BeginStatus::Started);
    }
}

TEST(DeployPipeline, ReceiveNotDoneInTenMinutesTimesOut) {
    Device d;
    const std::string stateBefore = d.state();
    const BeginResult b = d.beginDeploy();
    ASSERT_EQ(d.pipe->receive(b.opId, kNewBytes.data(), 3), ReceiveStatus::Ok);
    d.mono += kReceiveTimeoutMs - 1;
    d.pipe->poll();
    EXPECT_TRUE(d.pipe->current().has_value());
    d.mono += 1;
    d.pipe->poll();
    EXPECT_FALSE(d.pipe->current().has_value());
    EXPECT_EQ(d.pipe->receive(b.opId, kNewBytes.data(), 3), ReceiveStatus::Gone);
    EXPECT_EQ(d.pipe->receiveEnd(b.opId, true), ReceiveStatus::Gone);
    EXPECT_TRUE(listDir(d.dir + "/staging").empty());
    EXPECT_EQ(d.state(), stateBefore);
    EXPECT_EQ(errCode(d.record(b.opId)), "RECEIVE_TIMEOUT");
    EXPECT_EQ(lastRow(d.audit).code, "RECEIVE_TIMEOUT");
    EXPECT_EQ(d.beginDeploy().status, BeginStatus::Started);
}

TEST(DeployPipeline, ActivationFailuresGoBackToTheRunningVersion) {
    {
        Device d;  // state.json cannot be written
        d.fsyncs.fail = [](const std::string& p) {
            return p.find("state.json.tmp") != std::string::npos;
        };
        std::string opId;
        EXPECT_EQ(d.deploy(&opId), RunOutcome::Failed);
        d.fsyncs.fail = nullptr;
        EXPECT_EQ(errCode(d.record(opId)), "STORE_IO");
        EXPECT_EQ(stepOf(d.record(opId), "activate").state, StepState::Failed);
        EXPECT_EQ(d.disk().active, 1);
        EXPECT_FALSE(d.disk().pending.has_value());
        EXPECT_EQ(d.versionDirs(), (std::vector<std::string>{"1"}));
        EXPECT_EQ(std::count(d.events.begin(), d.events.end(), "restart"), 0);
    }
    {
        Device d;  // execv fails
        d.restartResult = RestartOutcome::Failed;
        std::string opId;
        EXPECT_EQ(d.deploy(&opId), RunOutcome::Failed);
        const DeployOperation rec = d.record(opId);
        EXPECT_EQ(rec.result, DeployResult::Failed);
        EXPECT_EQ(errCode(rec), "EXEC_FAILED");
        EXPECT_EQ(d.disk().active, 1);
        EXPECT_FALSE(d.disk().pending.has_value());
        EXPECT_EQ(d.versionDirs(), (std::vector<std::string>{"1"}));
        EXPECT_EQ(lastRow(d.audit).code, "EXEC_FAILED");
        EXPECT_FALSE(d.pipe->current().has_value());
    }
}

TEST(DeployPipeline, KilledBeforeActivationIsInterruptedAtTheNextStart) {
    for (const std::string step : {"receive", "verify-package", "validate", "backup", "activate"}) {
        SCOPED_TRACE(step);
        Device d;
        const std::string stateBefore = d.state();
        const BeginResult b = d.beginDeploy();
        ASSERT_EQ(b.status, BeginStatus::Started);
        if (step != "receive") {
            d.stopBefore = step;
            ASSERT_EQ(d.pipe->receive(b.opId, kNewBytes.data(), kNewBytes.size()),
                      ReceiveStatus::Ok);
            ASSERT_EQ(d.pipe->receiveEnd(b.opId, true), ReceiveStatus::Ok);
            EXPECT_EQ(d.pipe->run(b.opId), RunOutcome::Stopped);
        } else {
            ASSERT_EQ(d.pipe->receive(b.opId, kNewBytes.data(), 3), ReceiveStatus::Ok);
        }
        d.stopBefore.clear();
        d.audit.rows.clear();
        d.boot();
        EXPECT_EQ(d.startup.decision.action, BootAction::RunActive);
        EXPECT_EQ(d.state(), stateBefore);
        EXPECT_EQ(d.versionDirs(), (std::vector<std::string>{"1"}));
        EXPECT_TRUE(listDir(d.dir + "/staging").empty());
        const DeployOperation rec = d.record(b.opId);
        EXPECT_EQ(rec.result, DeployResult::Interrupted);
        EXPECT_EQ(errCode(rec), "INTERRUPTED");
        // The step that shows as interrupted is the one the process was killed at.
        std::string failedStep;
        for (const auto& s : rec.steps)
            if (s.state == StepState::Failed) failedStep = s.id;
        EXPECT_EQ(failedStep, step);
        ASSERT_EQ(d.audit.rows.size(), 1u);
        EXPECT_EQ(d.audit.rows[0].result, "interrupted");
        EXPECT_EQ(d.audit.rows[0].code, "INTERRUPTED");
        EXPECT_EQ(d.audit.rows[0].user, "kysu1");
        EXPECT_FALSE(d.pipe->current().has_value());
        EXPECT_EQ(d.beginDeploy().status, BeginStatus::Started);
    }
}

// ---------- health check and rollback ----------

TEST(DeployPipeline, AFailedHealthCheckRollsBack) {
    for (const std::string code : {"HEALTH_PROJECT", "HEALTH_HTTPS", "HEALTH_TIMEOUT"}) {
        SCOPED_TRACE(code);
        Device d;
        std::string opId;
        ASSERT_EQ(d.deploy(&opId), RunOutcome::Restarted);
        d.boot();
        d.events.clear();
        if (code == "HEALTH_TIMEOUT") {
            d.mono += kHealthTimeoutMs - 1;
            EXPECT_EQ(d.pipe->poll(), RunOutcome::Done);
            EXPECT_TRUE(d.events.empty());
            d.mono += 1;
            EXPECT_EQ(d.pipe->poll(), RunOutcome::Restarted);
        } else {
            EXPECT_EQ(d.pipe->healthFailed(code), RunOutcome::Restarted);
        }
        EXPECT_EQ(d.events, (std::vector<std::string>{"restart"}));
        StoreState s = d.disk();
        EXPECT_EQ(s.active, 1);
        ASSERT_TRUE(s.pending.has_value());
        EXPECT_EQ(s.pending->phase, PendingPhase::RollingBack);
        DeployOperation rec = d.record(opId);
        EXPECT_EQ(stepOf(rec, "health").state, StepState::Failed);
        EXPECT_EQ(stepOf(rec, "health").code, code);
        ASSERT_NE(rec.step("rollback"), nullptr);
        EXPECT_EQ(stepOf(rec, "rollback").state, StepState::Running);

        d.boot();
        EXPECT_EQ(d.startup.decision.action, BootAction::ContinueRollBack);
        EXPECT_EQ(d.startup.runDir, d.store->projectDir(1));
        EXPECT_EQ(curStep(*d.pipe), "rollback");
        EXPECT_EQ(d.pipe->healthPassed(), RunOutcome::Done);
        s = d.disk();
        EXPECT_EQ(s.active, 1);
        EXPECT_FALSE(s.pending.has_value());
        EXPECT_EQ(s.versions.size(), 1u);
        EXPECT_EQ(d.versionDirs(), (std::vector<std::string>{"1"}));
        rec = d.record(opId);
        EXPECT_EQ(rec.result, DeployResult::RolledBack);
        EXPECT_EQ(errCode(rec), code);
        EXPECT_EQ(stepOf(rec, "rollback").state, StepState::Ok);
        EXPECT_EQ(lastRow(d.audit).result, "rolled-back");
        EXPECT_EQ(lastRow(d.audit).code, code);
        EXPECT_EQ(lastRow(d.audit).user, "kysu1");
        EXPECT_FALSE(d.pipe->current().has_value());
    }
}

TEST(DeployPipeline, DyingTwiceRollsBackWithHealthCrash) {
    Device d;
    std::string opId;
    ASSERT_EQ(d.deploy(&opId), RunOutcome::Restarted);
    d.boot();  // 1st start of the new version: dies
    d.boot();  // 2nd: dies
    d.boot();
    EXPECT_EQ(d.startup.decision.action, BootAction::RollBack);
    EXPECT_EQ(d.startup.runDir, d.store->projectDir(1));
    DeployOperation rec = d.record(opId);
    EXPECT_EQ(stepOf(rec, "health").code, "HEALTH_CRASH");
    EXPECT_EQ(d.pipe->healthPassed(), RunOutcome::Done);
    rec = d.record(opId);
    EXPECT_EQ(rec.result, DeployResult::RolledBack);
    EXPECT_EQ(errCode(rec), "HEALTH_CRASH");
    EXPECT_EQ(d.disk().active, 1);
}

TEST(DeployPipeline, ARollbackThatFailsTooLeavesNoValidProject) {
    Device d;
    std::string opId;
    ASSERT_EQ(d.deploy(&opId), RunOutcome::Restarted);
    d.boot();
    ASSERT_EQ(d.pipe->healthFailed("HEALTH_PROJECT"), RunOutcome::Restarted);
    d.boot();
    d.events.clear();
    EXPECT_EQ(d.pipe->healthFailed("HEALTH_PROJECT"), RunOutcome::Restarted);
    EXPECT_EQ(d.events, (std::vector<std::string>{"audit:project.deploy:failed", "restart"}));
    const StoreState s = d.disk();
    EXPECT_FALSE(s.pending.has_value());
    EXPECT_FALSE(s.active.has_value());
    const DeployOperation rec = d.record(opId);
    EXPECT_EQ(rec.result, DeployResult::Failed);
    EXPECT_EQ(errCode(rec), "HEALTH_PROJECT");
    EXPECT_EQ(stepOf(rec, "rollback").state, StepState::Failed);
    EXPECT_EQ(lastRow(d.audit).result, "failed");
    d.boot();
    EXPECT_EQ(d.startup.decision.action, BootAction::NoProject);
    EXPECT_EQ(d.startup.runDir, "");
    // A backup can still be restored by hand.
    EXPECT_EQ(d.beginRestore(1).status, BeginStatus::Started);
}

// ---------- lock, base digest, space, audit ----------

TEST(DeployPipeline, OnlyOneOperationAtATime) {
    Device d;
    d.wall = kT0 + 5000;
    const BeginResult first = d.beginDeploy();
    ASSERT_EQ(first.status, BeginStatus::Started);
    const BeginResult second = d.beginDeploy("kysu2", "192.168.1.30");
    EXPECT_EQ(second.status, BeginStatus::Busy);
    EXPECT_STREQ(beginErrorCode(second.status), "DEVICE_BUSY");
    ASSERT_TRUE(second.busy.has_value());
    EXPECT_EQ(second.busy->opId, first.opId);
    EXPECT_EQ(second.busy->kind, OpKind::Deploy);
    EXPECT_EQ(second.busy->user, "kysu1");
    EXPECT_EQ(second.busy->source, "192.168.1.20");
    EXPECT_EQ(second.busy->since, kT0 + 5000);
    const auto j = nlohmann::json::parse(busyInfoJson(*second.busy));
    EXPECT_EQ(j["opId"], first.opId);
    EXPECT_EQ(j["kind"], "deploy");
    EXPECT_EQ(j["user"], "kysu1");
    EXPECT_EQ(j["source"], "192.168.1.20");
    EXPECT_EQ(j["since"], kT0 + 5000);
    EXPECT_EQ(d.beginRestore(1).status, BeginStatus::Busy);
    // The refusals are audited under who asked; the running one is untouched.
    EXPECT_EQ(lastRow(d.audit).user, "kysu2");
    EXPECT_EQ(lastRow(d.audit).code, "DEVICE_BUSY");

    // Still busy in the new process, until the health check ends.
    ASSERT_EQ(d.pipe->receive(first.opId, kNewBytes.data(), kNewBytes.size()), ReceiveStatus::Ok);
    ASSERT_EQ(d.pipe->receiveEnd(first.opId, true), ReceiveStatus::Ok);
    ASSERT_EQ(d.pipe->run(first.opId), RunOutcome::Restarted);
    d.boot();
    const BeginResult third = d.beginDeploy("kysu2", "192.168.1.30");
    EXPECT_EQ(third.status, BeginStatus::Busy);
    ASSERT_TRUE(third.busy.has_value());
    EXPECT_EQ(third.busy->opId, first.opId);
    EXPECT_EQ(third.busy->user, "kysu1");
    ASSERT_EQ(d.pipe->healthPassed(), RunOutcome::Done);
    EXPECT_EQ(d.beginDeploy("kysu2", "192.168.1.30").status, BeginStatus::Started);
}

TEST(DeployPipeline, TheBaseDigestMustBeTheRunningOne) {
    Device d;
    const std::string stateBefore = d.state();
    BeginResult r = d.beginDeploy("kysu1", "192.168.1.20", fakeDigest("something else"));
    EXPECT_EQ(r.status, BeginStatus::BaseChanged);
    EXPECT_STREQ(beginErrorCode(r.status), "BASE_CHANGED");
    r = d.beginDeploy("kysu1", "192.168.1.20", std::string("none"));
    EXPECT_EQ(r.status, BeginStatus::BaseChanged);
    EXPECT_EQ(d.state(), stateBefore);
    EXPECT_FALSE(d.pipe->current().has_value());
    EXPECT_EQ(lastRow(d.audit).code, "BASE_CHANGED");
    EXPECT_EQ(d.beginDeploy().status, BeginStatus::Started);
}

TEST(DeployPipeline, AnEmptyStoreTakesBaseNone) {
    Device d;
    d.legacy.status = LegacyStatus::Invalid;
    d.legacy.reason = "E_SCHEMA";
    // A fresh device: no state.json, legacy project invalid.
    const std::string other = tempDir() + "/projects";
    d.dir = other;
    d.boot();
    EXPECT_EQ(d.startup.decision.action, BootAction::RunLegacy);
    std::string opId;
    ASSERT_EQ(d.deploy(&opId), RunOutcome::Restarted);
    EXPECT_FALSE(d.record(opId).from.has_value());
    d.boot();
    ASSERT_EQ(d.pipe->healthPassed(), RunOutcome::Done);
    EXPECT_EQ(d.disk().active, 1);
}

TEST(DeployPipeline, SpaceIsCheckedBeforeTheBody) {
    Device d;
    d.freeBytes = (500ULL << 20) + kNewBytes.size() - 1;
    BeginResult r = d.beginDeploy();
    EXPECT_EQ(r.status, BeginStatus::NoSpace);
    EXPECT_STREQ(beginErrorCode(r.status), "NO_SPACE");
    EXPECT_TRUE(listDir(d.dir + "/staging").empty());
    d.freeBytes += 1;
    EXPECT_EQ(d.beginDeploy().status, BeginStatus::Started);
}

TEST(DeployPipeline, StartedIsAuditedFirstAndWithoutAuditNothingStarts) {
    Device d;
    bool stagingAtAudit = true;
    d.audit.onAppend = [&](const AuditEvent& e) {
        if (e.result == AuditResult::Started) stagingAtAudit = !listDir(d.dir + "/staging").empty();
    };
    ASSERT_EQ(d.beginDeploy().status, BeginStatus::Started);
    EXPECT_FALSE(stagingAtAudit);

    Device e;
    e.audit.fail = true;
    const std::string stateBefore = e.state();
    const BeginResult r = e.beginDeploy();
    EXPECT_EQ(r.status, BeginStatus::AuditUnavailable);
    EXPECT_STREQ(beginErrorCode(r.status), "AUDIT_UNAVAILABLE");
    EXPECT_TRUE(listDir(e.dir + "/staging").empty());
    EXPECT_TRUE(listDir(e.dir + "/ops").empty());
    EXPECT_EQ(e.state(), stateBefore);
    EXPECT_FALSE(e.pipe->current().has_value());
}

TEST(DeployPipeline, ResultsAreWrittenUnderTheAccountThatStarted) {
    Device d;
    std::string opId;
    ASSERT_EQ(d.deploy(&opId), RunOutcome::Restarted);
    d.boot();
    // Someone else is refused meanwhile; the result still goes under kysu1.
    EXPECT_EQ(d.beginRestore(1, "admin").status, BeginStatus::Busy);
    ASSERT_EQ(d.pipe->healthPassed(), RunOutcome::Done);
    EXPECT_EQ(lastRow(d.audit).result, "ok");
    EXPECT_EQ(lastRow(d.audit).user, "kysu1");
    EXPECT_EQ(lastRow(d.audit).role, "engineer");
    EXPECT_EQ(lastRow(d.audit).source, "192.168.1.20:50123");
}

TEST(DeployPipeline, RestoreRefusesUnknownOrRunningVersions) {
    Device d;
    BeginResult r = d.beginRestore(9);
    EXPECT_EQ(r.status, BeginStatus::NoSuchVersion);
    EXPECT_STREQ(beginErrorCode(r.status), "NO_SUCH_VERSION");
    r = d.beginRestore(1);
    EXPECT_EQ(r.status, BeginStatus::AlreadyActive);
    EXPECT_STREQ(beginErrorCode(r.status), "ALREADY_ACTIVE");
    EXPECT_FALSE(d.pipe->current().has_value());
}

// ---------- records ----------

TEST(DeployPipeline, OperationJsonHasTheContractShape) {
    Device d;
    d.validateResult.ok = false;
    d.validateResult.issues = {{"E_TAG_RANGE", "tags.json", "/tags/3", "min > max"}};
    std::string opId;
    EXPECT_EQ(d.deploy(&opId), RunOutcome::Failed);
    const auto op = d.pipe->find(opId);
    ASSERT_TRUE(op.has_value());
    const auto j = nlohmann::json::parse(deployOperationJson(*op));
    for (const char* k : {"opId", "kind", "user", "role", "source", "startedAt", "endedAt",
                          "clockOk", "result", "from", "to", "steps", "error", "clientsNotified"})
        EXPECT_TRUE(j.contains(k)) << k;
    EXPECT_FALSE(j.contains("auditSource"));
    EXPECT_FALSE(j.contains("serial"));
    EXPECT_EQ(j["kind"], "deploy");
    EXPECT_EQ(j["result"], "failed");
    EXPECT_EQ(j["startedAt"], "2026-10-20T03:00:00Z");
    EXPECT_EQ(j["from"]["seq"], 1);
    EXPECT_TRUE(j["from"].contains("digest"));
    EXPECT_TRUE(j["from"].contains("projectVersion"));
    EXPECT_EQ(j["to"]["digest"], fakeDigest(kNewBytes));
    EXPECT_EQ(j["to"]["projectId"], "tank-demo");
    ASSERT_EQ(j["steps"].size(), 6u);
    const std::vector<std::string> ids = {"receive", "verify-package", "validate",
                                          "backup",  "activate",       "health"};
    for (size_t i = 0; i < ids.size(); ++i) EXPECT_EQ(j["steps"][i]["id"], ids[i]);
    EXPECT_EQ(j["steps"][0]["state"], "ok");
    EXPECT_TRUE(j["steps"][0]["startedAt"].is_string());
    EXPECT_TRUE(j["steps"][0]["endedAt"].is_string());
    EXPECT_EQ(j["steps"][2]["state"], "failed");
    EXPECT_EQ(j["steps"][2]["code"], "E_VALIDATION");
    EXPECT_EQ(j["steps"][2]["issues"][0]["code"], "E_TAG_RANGE");
    EXPECT_EQ(j["steps"][2]["issues"][0]["file"], "tags.json");
    EXPECT_EQ(j["steps"][2]["issues"][0]["path"], "/tags/3");
    EXPECT_EQ(j["steps"][3]["state"], "pending");
    EXPECT_TRUE(j["steps"][3]["startedAt"].is_null());
    EXPECT_EQ(j["error"]["code"], "E_VALIDATION");
    EXPECT_EQ(j["clientsNotified"], 0);

    // The record keeps what the API leaves out, and reads back.
    std::string err;
    const auto back = parseDeployRecord(deployRecordJson(*op), err);
    ASSERT_TRUE(back.has_value()) << err;
    EXPECT_EQ(back->auditSource, "192.168.1.20:50123");
    EXPECT_EQ(back->serial, op->serial);
    EXPECT_EQ(deployOperationJson(*back), deployOperationJson(*op));
}

TEST(DeployPipeline, KeepsTheTwentyLatestRecords) {
    Device d;
    d.validateResult.ok = false;
    std::vector<std::string> ids;
    for (int i = 0; i < 22; ++i) {
        std::string opId;
        EXPECT_EQ(d.deploy(&opId), RunOutcome::Failed);
        ids.push_back(opId);
    }
    EXPECT_EQ(listDir(d.dir + "/ops").size(), kStoreOpsKept);
    EXPECT_FALSE(d.pipe->find(ids[0]).has_value());
    EXPECT_FALSE(d.pipe->find(ids[1]).has_value());
    EXPECT_TRUE(d.pipe->find(ids[2]).has_value());
    EXPECT_EQ(latestId(*d.pipe), ids.back());
    // Also across a restart: the order survives.
    d.boot();
    EXPECT_EQ(latestId(*d.pipe), ids.back());
    std::string opId;
    EXPECT_EQ(d.deploy(&opId), RunOutcome::Failed);
    EXPECT_FALSE(d.pipe->find(ids[2]).has_value());
    EXPECT_TRUE(d.pipe->find(ids[3]).has_value());
    EXPECT_FALSE(d.pipe->find("../state").has_value());
}

TEST(DeployPipeline, UnknownOperationsAreIgnored) {
    Device d;
    EXPECT_EQ(d.pipe->receive(kOp1, "x", 1), ReceiveStatus::Gone);
    EXPECT_EQ(d.pipe->receiveEnd(kOp1, true), ReceiveStatus::Gone);
    EXPECT_EQ(d.pipe->run(kOp1), RunOutcome::Ignored);
    EXPECT_EQ(d.pipe->healthPassed(), RunOutcome::Ignored);
    EXPECT_EQ(d.pipe->healthFailed("HEALTH_PROJECT"), RunOutcome::Ignored);
    EXPECT_FALSE(d.pipe->healthDeadlineMs().has_value());
    // run() before the body is complete does nothing.
    const BeginResult b = d.beginDeploy();
    EXPECT_EQ(d.pipe->run(b.opId), RunOutcome::Ignored);
    EXPECT_EQ(curStep(*d.pipe), "receive");
}

// eMMC (Constitution III): the store's own syncs for one deploy that commits. Not counted here:
// the fsync of the received package (receiveEnd), the extraction (verify-package, extract.cpp),
// and the two FULL commits of audit.db (started, ok).
TEST(DeployPipeline, SyncsOfACommittedDeploy) {
    Device d;
    d.fsyncs.calls.clear();
    ASSERT_EQ(d.deploy(), RunOutcome::Restarted);
    // record at begin 2, one record before each of the 4 steps up to activate 8, backup 3 (v/,
    // meta.json, v/<seq>), activation 2 + record 2
    EXPECT_EQ(d.fsyncs.calls.size(), 17u);
    d.boot();  // bootAttempts + 1
    EXPECT_EQ(d.fsyncs.calls.size(), 19u);
    ASSERT_EQ(d.pipe->healthPassed(), RunOutcome::Done);  // record 2, meta.json 2, state.json 2
    EXPECT_EQ(d.fsyncs.calls.size(), 25u);
}

// ---------- T100a: the old project must be in the store before a deploy ----------

TEST(DeployPipeline, AnOldProjectThatCouldNotBeTakenRefusesDeployUntilItIsTaken) {
    Device d;
    d.dir = tempDir() + "/projects";  // a device that never ran 0.4: no state.json
    d.pack.fail = true;               // the old project cannot be packed
    d.boot();
    EXPECT_EQ(d.startup.decision.action, BootAction::RunLegacy);
    EXPECT_FALSE(d.store->baseBlockReason().empty());

    d.audit.rows.clear();
    const BeginResult r = d.beginDeploy("kysu1", "192.168.1.20", std::string("none"));
    EXPECT_EQ(r.status, BeginStatus::NoBaseProject);
    EXPECT_STREQ(beginErrorCode(r.status), "NO_BASE_PROJECT");
    EXPECT_NE(r.message.find("E_PKG_SECRET"), std::string::npos) << r.message;  // the reason
    EXPECT_FALSE(d.pipe->current().has_value());
    EXPECT_FALSE(exists(d.dir + "/state.json"));
    EXPECT_TRUE(listDir(d.dir + "/staging").empty());
    EXPECT_EQ(lastRow(d.audit).code, "NO_BASE_PROJECT");
    EXPECT_EQ(lastRow(d.audit).result, "failed");
    // A restore is not possible either: there is nothing in the store.
    EXPECT_NE(d.beginRestore(1).status, BeginStatus::Started);

    // Next start: the old project is taken, the deploy goes on from it.
    d.pack.fail = false;
    d.boot();
    EXPECT_EQ(d.startup.decision.action, BootAction::Adopt);
    EXPECT_TRUE(d.store->baseBlockReason().empty());
    EXPECT_EQ(d.beginDeploy().status, BeginStatus::Started);
}

TEST(DeployPipeline, AnEmptyOrBrokenOldProjectDoesNotBlockTheFirstDeploy) {
    for (LegacyStatus status : {LegacyStatus::Empty, LegacyStatus::Invalid}) {
        Device d;
        d.dir = tempDir() + "/projects";
        d.legacy.status = status;
        d.legacy.reason = "why";
        d.boot();
        EXPECT_EQ(d.startup.decision.action, BootAction::RunLegacy);
        const BeginResult r = d.beginDeploy("kysu1", "192.168.1.20", std::string("none"));
        EXPECT_EQ(r.status, BeginStatus::Started) << r.message;
    }
}
