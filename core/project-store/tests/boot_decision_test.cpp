// What runs at start (specs/005-device-online T097): one test per row of the table "Quyết định lúc
// khởi động" of data-model §9 on the pure decideBoot(), then startStore() on a real store: the
// state the decision needs (bootAttempts + 1) is written and synced before anything runs, a
// rollback that fails too ends in the "no valid project" mode, an incomplete version never runs.
#include "core/project-store/boot_decision.hpp"

#include <gtest/gtest.h>

#include "core/project-store/tests/store_test_support.hpp"

using namespace mat;
using namespace storetest;

namespace {

ProjectVersion ver(int64_t seq) { return makeVersion(seq); }

// Store with versions 1 (backup) and 2 (running), complete.
BootInput running() {
    BootInput in;
    in.status = StateStatus::Ok;
    in.state.active = 2;
    in.state.nextSeq = 4;
    in.state.versions = {ver(2), ver(1)};
    in.complete = {1, 2};
    return in;
}

// A deploy of version 3 over 2, in `phase` with `attempts` starts.
BootInput pending(PendingPhase phase, int attempts) {
    BootInput in = running();
    PendingOperation p;
    p.opId = kOp1;
    p.from = 2;
    p.to = 3;
    p.phase = phase;
    p.bootAttempts = attempts;
    p.user = "kysu1";
    p.source = "192.168.1.20";
    p.startedAt = "2026-10-20T03:11:52Z";
    in.state.pending = p;
    in.complete.insert(3);
    return in;
}

}  // namespace

// --- no state.json ---

TEST(BootDecision, NoStateValidLegacyProjectIsAdopted) {
    BootInput in;
    in.legacy = LegacyStatus::Valid;
    const BootDecision d = decideBoot(in);
    EXPECT_EQ(d.action, BootAction::Adopt);
    EXPECT_FALSE(d.write.has_value());
    EXPECT_FALSE(d.healthCheck);
}

TEST(BootDecision, NoStateInvalidOrEmptyLegacyProjectRunsAsBefore) {
    for (LegacyStatus l : {LegacyStatus::Invalid, LegacyStatus::Empty}) {
        BootInput in;
        in.legacy = l;
        const BootDecision d = decideBoot(in);
        EXPECT_EQ(d.action, BootAction::RunLegacy);
        EXPECT_FALSE(d.runSeq.has_value());
        EXPECT_FALSE(d.write.has_value());
    }
}

TEST(BootDecision, DamagedStateRunsNothingAndWritesNothing) {
    BootInput in;
    in.status = StateStatus::Corrupt;
    in.stateError = "JSON lỗi";
    in.legacy = LegacyStatus::Valid;  // never adopted over a damaged store
    const BootDecision d = decideBoot(in);
    EXPECT_EQ(d.action, BootAction::NoValidProject);
    EXPECT_FALSE(d.runSeq.has_value());
    EXPECT_FALSE(d.write.has_value());
    EXPECT_NE(d.reason.find("state.json"), std::string::npos) << d.reason;
}

// --- pending = null ---

TEST(BootDecision, NoPendingRunsTheActiveVersion) {
    const BootDecision d = decideBoot(running());
    EXPECT_EQ(d.action, BootAction::RunActive);
    EXPECT_EQ(d.runSeq, 2);
    EXPECT_FALSE(d.healthCheck);
    EXPECT_FALSE(d.write.has_value());
}

TEST(BootDecision, NoPendingAndNoActiveRunsNoProject) {
    BootInput in = running();
    in.state.active.reset();
    const BootDecision d = decideBoot(in);
    EXPECT_EQ(d.action, BootAction::NoProject);
    EXPECT_FALSE(d.runSeq.has_value());
    EXPECT_FALSE(d.write.has_value());
}

TEST(BootDecision, AnIncompleteActiveVersionIsNeverRun) {
    BootInput in = running();
    in.complete = {1};
    const BootDecision d = decideBoot(in);
    EXPECT_EQ(d.action, BootAction::NoValidProject);
    EXPECT_FALSE(d.runSeq.has_value());
}

// --- pending activating / health ---

TEST(BootDecision, ActivatingOrHealthBelowTwoStartsTriesTheNewVersion) {
    for (PendingPhase ph : {PendingPhase::Activating, PendingPhase::Health}) {
        for (int attempts : {0, 1}) {
            const BootDecision d = decideBoot(pending(ph, attempts));
            EXPECT_EQ(d.action, BootAction::TryNew);
            EXPECT_EQ(d.runSeq, 3);
            EXPECT_TRUE(d.healthCheck);
            ASSERT_TRUE(d.write.has_value());
            ASSERT_TRUE(d.write->pending.has_value());
            EXPECT_EQ(d.write->pending->bootAttempts, attempts + 1);
            EXPECT_EQ(d.write->pending->phase, PendingPhase::Health);
            EXPECT_EQ(d.write->active, 2);  // not committed yet
            EXPECT_FALSE(d.opEnded);
        }
    }
}

TEST(BootDecision, ActivatingOrHealthAfterTwoDeathsRollsBack) {
    for (PendingPhase ph : {PendingPhase::Activating, PendingPhase::Health}) {
        for (int attempts : {2, 3}) {
            const BootDecision d = decideBoot(pending(ph, attempts));
            EXPECT_EQ(d.action, BootAction::RollBack);
            EXPECT_EQ(d.runSeq, 2);
            EXPECT_TRUE(d.healthCheck);
            EXPECT_EQ(d.healthCode, "HEALTH_CRASH");
            ASSERT_TRUE(d.write.has_value());
            EXPECT_EQ(d.write->active, 2);
            ASSERT_TRUE(d.write->pending.has_value());
            EXPECT_EQ(d.write->pending->phase, PendingPhase::RollingBack);
            EXPECT_EQ(d.write->pending->bootAttempts, 1);  // this start runs the old version
            EXPECT_FALSE(d.opEnded);
        }
    }
}

TEST(BootDecision, AnIncompleteNewVersionIsRolledBackAtOnce) {
    BootInput in = pending(PendingPhase::Activating, 0);
    in.complete.erase(3);
    const BootDecision d = decideBoot(in);
    EXPECT_EQ(d.action, BootAction::RollBack);
    EXPECT_EQ(d.runSeq, 2);
    EXPECT_EQ(d.healthCode, "HEALTH_PROJECT");
}

TEST(BootDecision, RollbackWithNothingBeforeEndsWithNoProject) {
    BootInput in = pending(PendingPhase::Health, 2);
    in.state.pending->from.reset();
    in.state.active.reset();
    const BootDecision d = decideBoot(in);
    EXPECT_EQ(d.action, BootAction::NoProject);
    EXPECT_FALSE(d.runSeq.has_value());
    EXPECT_TRUE(d.opEnded);
    EXPECT_EQ(d.healthCode, "HEALTH_CRASH");
    EXPECT_TRUE(d.rollbackCode.empty());
    ASSERT_TRUE(d.write.has_value());
    EXPECT_FALSE(d.write->pending.has_value());
    EXPECT_FALSE(d.write->active.has_value());
}

TEST(BootDecision, RollbackToAnIncompleteVersionFailsToNoValidProject) {
    BootInput in = pending(PendingPhase::Health, 2);
    in.complete.erase(2);
    const BootDecision d = decideBoot(in);
    EXPECT_EQ(d.action, BootAction::NoValidProject);
    EXPECT_FALSE(d.runSeq.has_value());
    EXPECT_TRUE(d.opEnded);
    EXPECT_EQ(d.healthCode, "HEALTH_CRASH");
    EXPECT_EQ(d.rollbackCode, "HEALTH_PROJECT");
    ASSERT_TRUE(d.write.has_value());
    EXPECT_FALSE(d.write->pending.has_value());
    EXPECT_FALSE(d.write->active.has_value());
    EXPECT_EQ(d.write->versions.size(), 2u);  // backups stay restorable by hand
}

// --- pending rolling-back ---

TEST(BootDecision, RollingBackRunsTheOldVersionAndChecksIt) {
    for (int attempts : {0, 1}) {
        const BootDecision d = decideBoot(pending(PendingPhase::RollingBack, attempts));
        EXPECT_EQ(d.action, BootAction::ContinueRollBack);
        EXPECT_EQ(d.runSeq, 2);
        EXPECT_TRUE(d.healthCheck);
        ASSERT_TRUE(d.write.has_value());
        EXPECT_EQ(d.write->pending->bootAttempts, attempts + 1);
        EXPECT_EQ(d.write->pending->phase, PendingPhase::RollingBack);
        EXPECT_FALSE(d.opEnded);
    }
}

TEST(BootDecision, RollbackThatDiesTwiceEndsWithNoValidProject) {
    const BootDecision d = decideBoot(pending(PendingPhase::RollingBack, 2));
    EXPECT_EQ(d.action, BootAction::NoValidProject);
    EXPECT_FALSE(d.runSeq.has_value());
    EXPECT_TRUE(d.opEnded);
    EXPECT_EQ(d.rollbackCode, "HEALTH_CRASH");
    ASSERT_TRUE(d.write.has_value());
    EXPECT_FALSE(d.write->pending.has_value());
    EXPECT_FALSE(d.write->active.has_value());
}

TEST(BootDecision, RollingBackToAnIncompleteVersionEndsWithNoValidProject) {
    BootInput in = pending(PendingPhase::RollingBack, 0);
    in.complete.erase(2);
    const BootDecision d = decideBoot(in);
    EXPECT_EQ(d.action, BootAction::NoValidProject);
    EXPECT_FALSE(d.runSeq.has_value());
    EXPECT_EQ(d.rollbackCode, "HEALTH_PROJECT");
    EXPECT_TRUE(d.opEnded);
}

// Every combination: the version to run is always complete, and a pending version runs only with
// its start counted in the state to write.
TEST(BootDecision, NeverRunsAnIncompleteVersionNorAnUncountedStart) {
    for (PendingPhase ph :
         {PendingPhase::Activating, PendingPhase::Health, PendingPhase::RollingBack}) {
        for (int attempts = 0; attempts <= 3; ++attempts) {
            for (int mask = 0; mask < 8; ++mask) {
                BootInput in = pending(ph, attempts);
                in.complete.clear();
                for (int s = 1; s <= 3; ++s)
                    if (mask & (1 << (s - 1))) in.complete.insert(s);
                const BootDecision d = decideBoot(in);
                if (d.runSeq) {
                    EXPECT_TRUE(in.complete.count(*d.runSeq)) << attempts << " " << mask;
                    ASSERT_TRUE(d.write.has_value());
                    ASSERT_TRUE(d.write->pending.has_value());
                    EXPECT_LE(d.write->pending->bootAttempts, kBootAttemptsMax);
                    EXPECT_GT(d.write->pending->bootAttempts, 0);
                }
            }
        }
    }
}

TEST(BootDecision, ActionNames) {
    EXPECT_STREQ(bootActionName(BootAction::TryNew), "try-new");
    EXPECT_STREQ(bootActionName(BootAction::NoValidProject), "no-valid-project");
}

// ---------- startStore() on a real store ----------

namespace {

struct Boot {
    std::string dir = tempDir() + "/projects";
    FsyncRecorder fsyncs;
    int64_t mono = 5000;
    std::unique_ptr<ProjectStore> store;
    FakeAudit audit;

    Boot() { reopen(); }
    void reopen() {
        StoreOptions o;
        o.dir = dir;
        o.wallMs = [] { return int64_t{1792465200000}; };
        o.clockSynced = [](int64_t) { return true; };
        fsyncs.storeDir = dir;
        o.fsync = fsyncs.hook();
        o.log = [](const std::string&) {};
        store = std::make_unique<ProjectStore>(o);
    }
    BootHooks hooks() {
        BootHooks h;
        h.legacy = [] {
            ADD_FAILURE() << "projectDir looked at although state.json exists";
            return LegacyProject{};
        };
        h.audit = audit.fn();
        h.monoMs = [this] { return mono; };
        return h;
    }
    // Versions 1 and 2 (running), complete; pending deploy of 3 when `withPending`.
    void seed(std::optional<PendingPhase> phase, int attempts = 0) {
        for (int s = 1; s <= 3; ++s) {
            writeFile(dir + "/v/" + std::to_string(s) + "/project/project.json", "{}");
            writeFile(dir + "/v/" + std::to_string(s) + "/package.matscada", "PK");
            ProjectVersion m = ver(s);
            m.activatedAt.reset();
            writeFile(dir + "/v/" + std::to_string(s) + "/meta.json", versionMetaJson(m));
        }
        BootInput in = phase ? pending(*phase, attempts) : running();
        writeFile(dir + "/state.json", storeStateJson(in.state));
        reopen();
    }
    StoreState onDisk() {
        std::string err;
        return parseStoreState(readFile(dir + "/state.json"), err).value_or(StoreState{});
    }
};

}  // namespace

TEST(StartStore, CountsTheStartAndSyncsItBeforeTheNewVersionRuns) {
    Boot b;
    b.seed(PendingPhase::Activating, 0);
    b.mono = 777;
    const StoreStartup st = startStore(*b.store, b.hooks());
    EXPECT_EQ(st.decision.action, BootAction::TryNew);
    EXPECT_EQ(st.runDir, b.store->projectDir(3));
    EXPECT_EQ(st.stateReadMonoMs, 777);
    ASSERT_TRUE(st.pending.has_value());
    EXPECT_EQ(st.pending->bootAttempts, 0);  // as read
    // On disk, synced, when startStore returns.
    const StoreState s = b.onDisk();
    ASSERT_TRUE(s.pending.has_value());
    EXPECT_EQ(s.pending->bootAttempts, 1);
    EXPECT_EQ(s.pending->phase, PendingPhase::Health);
    EXPECT_EQ(b.fsyncs.count(
                  [&](const std::string& p) { return p.find(b.dir + "/state.json.tmp") == 0; }),
              1u);
    ASSERT_FALSE(b.fsyncs.calls.empty());
    EXPECT_EQ(b.fsyncs.calls.back().path, b.dir);
}

TEST(StartStore, AFailedWriteNeverLetsThePendingVersionRun) {
    Boot b;
    b.seed(PendingPhase::Health, 1);
    b.fsyncs.fail = [](const std::string& p) {
        return p.find("state.json.tmp") != std::string::npos;
    };
    const StoreStartup st = startStore(*b.store, b.hooks());
    EXPECT_EQ(st.decision.action, BootAction::NoValidProject);
    EXPECT_EQ(st.runDir, "");
    EXPECT_FALSE(st.error.empty());
    ASSERT_TRUE(b.onDisk().pending.has_value());
    EXPECT_EQ(b.onDisk().pending->bootAttempts, 1);  // unchanged
}

TEST(StartStore, ThreeStartsWithoutHealthEndInARollback) {
    Boot b;
    b.seed(PendingPhase::Activating, 0);
    StoreStartup st = startStore(*b.store, b.hooks());  // 1st start of 3: dies
    EXPECT_EQ(st.decision.action, BootAction::TryNew);
    b.reopen();
    st = startStore(*b.store, b.hooks());  // 2nd: dies
    EXPECT_EQ(st.decision.action, BootAction::TryNew);
    b.reopen();
    st = startStore(*b.store, b.hooks());
    EXPECT_EQ(st.decision.action, BootAction::RollBack);
    EXPECT_EQ(st.decision.healthCode, "HEALTH_CRASH");
    EXPECT_EQ(st.runDir, b.store->projectDir(2));
    const StoreState s = b.onDisk();
    EXPECT_EQ(s.active, 2);
    ASSERT_TRUE(s.pending.has_value());
    EXPECT_EQ(s.pending->phase, PendingPhase::RollingBack);
    // The old version dies twice as well: no valid project, nothing runs, nothing pending.
    b.reopen();
    st = startStore(*b.store, b.hooks());
    EXPECT_EQ(st.decision.action, BootAction::ContinueRollBack);
    b.reopen();
    st = startStore(*b.store, b.hooks());
    EXPECT_EQ(st.decision.action, BootAction::NoValidProject);
    EXPECT_EQ(st.runDir, "");
    EXPECT_FALSE(b.onDisk().pending.has_value());
    EXPECT_FALSE(b.onDisk().active.has_value());
    b.reopen();
    st = startStore(*b.store, b.hooks());
    EXPECT_EQ(st.decision.action, BootAction::NoProject);
    EXPECT_EQ(st.runDir, "");
    EXPECT_FALSE(b.store->noPackageReason().empty());
}

TEST(StartStore, RunsTheActiveVersionAndRemovesLeftovers) {
    Boot b;
    b.seed(std::nullopt);  // 3 complete but not referenced
    writeFile(b.dir + "/staging/" + std::string(kOp2) + "/package.matscada", "half");
    const StoreStartup st = startStore(*b.store, b.hooks());
    EXPECT_EQ(st.decision.action, BootAction::RunActive);
    EXPECT_EQ(st.runDir, b.store->projectDir(2));
    EXPECT_EQ(st.stagingRemoved, (std::vector<std::string>{kOp2}));
    EXPECT_FALSE(exists(b.store->versionDir(3)));
    EXPECT_TRUE(b.store->isComplete(1));
    EXPECT_TRUE(b.fsyncs.calls.empty());  // nothing to write
    EXPECT_EQ(b.store->noPackageReason(), "");
}

// T100a: a damaged state.json is set aside and rebuilt from the versions on disk.
TEST(StartStore, ADamagedStateIsRebuiltFromTheVersionsOnDisk) {
    Boot b;
    b.seed(std::nullopt);
    // 2 was activated last; 3 is the version of an operation that never committed.
    for (int s = 1; s <= 2; ++s) {
        ProjectVersion m = ver(s);
        m.activatedAt = s == 2 ? "2026-10-20T03:20:00Z" : "2026-10-20T03:10:00Z";
        writeFile(b.dir + "/v/" + std::to_string(s) + "/meta.json", versionMetaJson(m));
    }
    writeFile(b.dir + "/state.json", "{");
    b.reopen();
    b.mono = 5000;
    const StoreStartup st = startStore(*b.store, b.hooks());  // hooks().legacy fails the test
    EXPECT_EQ(st.status, StateStatus::Corrupt);               // as read
    EXPECT_TRUE(st.recovered);
    EXPECT_EQ(st.corruptFile, "state.json.corrupt-5000");
    EXPECT_EQ(readFile(b.dir + "/state.json.corrupt-5000"), "{");
    EXPECT_EQ(st.decision.action, BootAction::RunActive);
    EXPECT_EQ(st.runDir, b.store->projectDir(2));
    EXPECT_EQ(b.onDisk().active, std::optional<int64_t>(2));
    EXPECT_EQ(b.onDisk().versions.size(), 3u);
    EXPECT_TRUE(b.store->isComplete(3));  // listed as a backup: kept
    EXPECT_EQ(b.store->noPackageReason(), "");
    ASSERT_EQ(b.audit.rows.size(), 1u);
    EXPECT_EQ(b.audit.rows[0].action, "project.adopt");
    EXPECT_NE(b.audit.rows[0].detail.find("state-corrupt"), std::string::npos);
    // The next start finds a sound store.
    b.reopen();
    const StoreStartup next = startStore(*b.store, b.hooks());
    EXPECT_FALSE(next.recovered);
    EXPECT_EQ(next.decision.action, BootAction::RunActive);
    EXPECT_EQ(b.audit.rows.size(), 1u);
}

TEST(StartStore, ADamagedStateWithNoVersionLeftIsAnEmptyStoreThatTakesADeploy) {
    Boot b;
    b.seed(std::nullopt);
    for (int s = 1; s <= 3; ++s)
        ::unlink((b.dir + "/v/" + std::to_string(s) + "/meta.json").c_str());
    writeFile(b.dir + "/state.json", "{");
    b.reopen();
    const StoreStartup st = startStore(*b.store, b.hooks());
    EXPECT_TRUE(st.recovered);
    EXPECT_EQ(st.decision.action, BootAction::NoProject);
    EXPECT_EQ(st.runDir, "");
    EXPECT_EQ(b.store->stateStatus(), StateStatus::Ok);
    EXPECT_FALSE(b.onDisk().active.has_value());
    EXPECT_FALSE(b.store->noPackageReason().empty());
    EXPECT_EQ(b.store->baseBlockReason(), "");
}

TEST(StartStore, ADamagedStateThatCannotBeRebuiltRunsNothing) {
    Boot b;
    b.seed(std::nullopt);
    writeFile(b.dir + "/state.json", "{");
    b.reopen();
    b.audit.fail = true;  // project.adopt cannot be written
    const StoreStartup st = startStore(*b.store, b.hooks());
    EXPECT_EQ(st.status, StateStatus::Corrupt);
    EXPECT_FALSE(st.recovered);
    EXPECT_EQ(st.decision.action, BootAction::NoValidProject);
    EXPECT_EQ(st.runDir, "");
    EXPECT_FALSE(st.error.empty());
    EXPECT_TRUE(b.store->isComplete(2));  // kept for a person to look at
    EXPECT_EQ(readFile(b.dir + "/state.json"), "{");
}
