// Project store of the device (specs/005-device-online T096: data-model §9, research R13):
// state.json and meta.json, layout and modes, atomic writes, cleanup at start, pruning only after a
// commit, operation records, adoption of the project installed the old way (FR-027).
#include "core/project-store/store.hpp"

#include <gtest/gtest.h>
#include <sys/stat.h>

#include <regex>

#include "core/project-store/boot_decision.hpp"
#include "core/project-store/tests/store_test_support.hpp"
#include "nlohmann/json.hpp"

using namespace mat;
using namespace storetest;

namespace {

constexpr int64_t kT0 = 1792465200000;  // 2026-10-20T03:00:00Z

struct Fixture {
    std::string data = tempDir();
    std::string dir = data + "/projects";
    FsyncRecorder fsyncs;
    int64_t wall = kT0;
    bool synced = true;
    std::unique_ptr<ProjectStore> store;

    Fixture() { reopen(); }
    StoreOptions opts(int backups = 3) {
        StoreOptions o;
        o.dir = dir;
        o.projectBackups = backups;
        o.wallMs = [this] { return wall; };
        o.clockSynced = [this](int64_t) { return synced; };
        fsyncs.storeDir = dir;
        o.fsync = fsyncs.hook();
        o.log = [](const std::string&) {};
        return o;
    }
    void reopen(int backups = 3) {
        store = std::make_unique<ProjectStore>(opts(backups));
        std::string err;
        EXPECT_TRUE(store->open(err)) << err;
        store->load();
    }
    std::string state() const { return readFile(dir + "/state.json"); }
};

StoreState sampleState() {
    StoreState s;
    s.active = 7;
    s.nextSeq = 9;
    ProjectVersion a = makeVersion(7, "1.3.0");
    ProjectVersion b = makeVersion(6, "1.2.0");
    b.deployedBy.reset();
    b.deployedFrom.reset();
    b.source = VersionSource::RuntimePackage;
    b.clockOk = false;
    s.versions = {a, b};
    PendingOperation p;
    p.opId = kOp1;
    p.kind = OpKind::Deploy;
    p.from = 7;
    p.to = 8;
    p.phase = PendingPhase::Health;
    p.bootAttempts = 1;
    p.user = "kysu1";
    p.source = "192.168.1.20";
    p.startedAt = "2026-10-20T03:11:52Z";
    s.pending = p;
    return s;
}

// A complete version made through the store, as step backup makes it.
int64_t stage(ProjectStore& store, const std::string& opId, const std::string& tag) {
    std::string err;
    const int fd = store.createStaging(opId, err);
    EXPECT_GE(fd, 0) << err;
    if (fd >= 0) {
        const std::string bytes = "package " + tag;
        EXPECT_EQ(::write(fd, bytes.data(), bytes.size()), static_cast<ssize_t>(bytes.size()));
        ::close(fd);
    }
    writeFile(store.stagingDir(opId) + "/project/project.json", "{\"v\":\"" + tag + "\"}");
    ProjectVersion meta = makeVersion(0, tag);
    meta.activatedAt.reset();
    const auto seq = store.commitStaging(opId, meta, err);
    EXPECT_TRUE(seq.has_value()) << err;
    return seq.value_or(-1);
}

// A whole operation at the store level: backup, activation, commit.
int64_t deployThrough(ProjectStore& store, const std::string& opId, const std::string& tag) {
    const int64_t seq = stage(store, opId, tag);
    PendingOperation p;
    p.opId = opId;
    p.from = store.state().active;
    p.to = seq;
    p.user = "kysu1";
    p.source = "192.168.1.20";
    p.startedAt = "2026-10-20T03:11:52Z";
    std::string err;
    EXPECT_TRUE(store.beginActivation(p, err)) << err;
    const auto meta = store.readMeta(seq);
    EXPECT_TRUE(meta.has_value());
    ProjectVersion entry = meta.value_or(ProjectVersion{});
    entry.seq = seq;
    entry.activatedAt = "2026-10-20T03:12:00Z";
    EXPECT_TRUE(store.commitPending(entry, err)) << err;
    return seq;
}

// Distinct UUID v4 texts for many operations.
std::string opIdN(int n) {
    char buf[40];
    std::snprintf(buf, sizeof buf, "%08x-0000-4000-8000-%012x", n, n);
    return buf;
}

}  // namespace

// ---------- state.json ----------

TEST(StoreState, JsonRoundTripKeepsEveryField) {
    const StoreState s = sampleState();
    const std::string text = storeStateJson(s);
    EXPECT_EQ(text.back(), '\n');
    const auto j = nlohmann::json::parse(text);
    EXPECT_EQ(j["schemaVersion"], "1.0.0");
    EXPECT_EQ(j["active"], 7);
    EXPECT_EQ(j["nextSeq"], 9);
    ASSERT_EQ(j["versions"].size(), 2u);
    for (const char* k :
         {"seq", "digest", "projectId", "projectName", "projectVersion", "minRuntimeVersion",
          "size", "activatedAt", "clockOk", "deployedBy", "deployedFrom", "source"})
        EXPECT_TRUE(j["versions"][0].contains(k)) << k;
    EXPECT_EQ(j["versions"][1]["source"], "runtime-package");
    EXPECT_TRUE(j["versions"][1]["deployedBy"].is_null());
    for (const char* k :
         {"opId", "kind", "from", "to", "phase", "bootAttempts", "user", "source", "startedAt"})
        EXPECT_TRUE(j["pending"].contains(k)) << k;
    EXPECT_EQ(j["pending"]["phase"], "health");
    EXPECT_EQ(j["pending"]["kind"], "deploy");

    std::string err;
    const auto back = parseStoreState(text, err);
    ASSERT_TRUE(back.has_value()) << err;
    EXPECT_EQ(storeStateJson(*back), text);
}

TEST(StoreState, EmptyStoreHasNullActiveAndPending) {
    const auto j = nlohmann::json::parse(storeStateJson(StoreState{}));
    EXPECT_TRUE(j["active"].is_null());
    EXPECT_TRUE(j["pending"].is_null());
    EXPECT_EQ(j["nextSeq"], 1);
    EXPECT_TRUE(j["versions"].is_array());
}

TEST(StoreState, ReaderRefusesWhatIsWrongAndIgnoresUnknownKeys) {
    const auto base = nlohmann::json::parse(storeStateJson(sampleState()));
    auto refused = [&](const std::function<void(nlohmann::json&)>& edit, const char* what) {
        nlohmann::json j = base;
        edit(j);
        std::string err;
        EXPECT_FALSE(parseStoreState(j.dump(), err).has_value()) << what;
        EXPECT_FALSE(err.empty()) << what;
    };
    refused([](auto& j) { j["schemaVersion"] = "2.0.0"; }, "major 2");
    refused([](auto& j) { j.erase("nextSeq"); }, "missing nextSeq");
    refused([](auto& j) { j["active"] = 5; }, "active not listed");
    refused([](auto& j) { j["versions"][1]["seq"] = 7; }, "duplicate seq");
    refused([](auto& j) { j["nextSeq"] = 7; }, "seq not below nextSeq");
    refused([](auto& j) { j["pending"]["to"] = 9; }, "pending.to not below nextSeq");
    refused([](auto& j) { j["pending"]["phase"] = "done"; }, "phase");
    refused([](auto& j) { j["pending"]["opId"] = "../../etc"; }, "opId");
    refused([](auto& j) { j["versions"][0]["digest"] = "md5:00"; }, "digest");
    refused([](auto& j) { j["versions"][0]["source"] = "usb"; }, "source");
    refused([](auto& j) { j["versions"][0]["size"] = "big"; }, "size type");
    refused([](auto& j) { j["pending"]["bootAttempts"] = -1; }, "bootAttempts");
    std::string err;
    EXPECT_FALSE(parseStoreState("{not json", err).has_value());
    EXPECT_FALSE(parseStoreState("[]", err).has_value());

    nlohmann::json j = base;
    j["later"] = {{"x", 1}};
    j["versions"][0]["later"] = true;
    j["schemaVersion"] = "1.4.0";
    EXPECT_TRUE(parseStoreState(j.dump(), err).has_value()) << err;
}

TEST(StoreState, MetaJsonRoundTrip) {
    ProjectVersion v = makeVersion(4);
    v.activatedAt.reset();
    std::string err;
    const auto back = parseVersionMeta(versionMetaJson(v), err);
    ASSERT_TRUE(back.has_value()) << err;
    EXPECT_EQ(back->seq, 4);
    EXPECT_EQ(back->digest, v.digest);
    EXPECT_FALSE(back->activatedAt.has_value());
    EXPECT_EQ(back->deployedBy, v.deployedBy);
    EXPECT_FALSE(parseVersionMeta("{}", err).has_value());
}

TEST(StoreState, PureChanges) {
    StoreState s = sampleState();
    s.pending->phase = PendingPhase::Activating;
    s.versions.push_back(makeVersion(5));
    s.versions.push_back(makeVersion(4));
    s.versions.push_back(makeVersion(3));

    std::vector<int64_t> dropped;
    const StoreState c = stateCommitted(s, makeVersion(8, "1.4.0"), 3, &dropped);
    EXPECT_EQ(c.active, 8);
    EXPECT_FALSE(c.pending.has_value());
    ASSERT_EQ(c.versions.size(), 4u);  // running + 3 backups
    EXPECT_EQ(c.versions[0].seq, 8);
    EXPECT_EQ(c.versions[1].seq, 7);
    EXPECT_EQ(dropped, (std::vector<int64_t>{4, 3}));

    // A restore moves its entry to the front.
    StoreState r = s;
    r.pending->kind = OpKind::Restore;
    r.pending->to = 5;
    const StoreState rc = stateCommitted(r, makeVersion(5), 3, nullptr);
    EXPECT_EQ(rc.active, 5);
    EXPECT_EQ(rc.versions[0].seq, 5);
    EXPECT_EQ(rc.versions[1].seq, 7);
    EXPECT_EQ(rc.versions.size(), 4u);

    const StoreState rb = stateRollingBack(s, 0);
    EXPECT_EQ(rb.pending->phase, PendingPhase::RollingBack);
    EXPECT_EQ(rb.pending->bootAttempts, 0);
    EXPECT_EQ(rb.active, 7);
    EXPECT_EQ(rb.versions.size(), s.versions.size());

    EXPECT_EQ(stateEnded(s, true).active, 7);
    EXPECT_FALSE(stateEnded(s, true).pending.has_value());
    EXPECT_FALSE(stateEnded(s, false).active.has_value());
    EXPECT_EQ(stateEnded(s, false).versions.size(), s.versions.size());
}

TEST(StoreState, OpIdsAndTimes) {
    EXPECT_TRUE(validOpId(kOp1));
    EXPECT_FALSE(validOpId("0F8FAD5B-D9CB-469F-A165-70867728950E"));
    EXPECT_FALSE(validOpId("../0f8fad5b-d9cb-469f-a165-70867728950e"));
    EXPECT_FALSE(validOpId(""));
    const std::string id = newOpId();
    EXPECT_TRUE(validOpId(id)) << id;
    EXPECT_NE(id, newOpId());
    EXPECT_EQ(isoUtc(1792465200000), "2026-10-20T03:00:00Z");
    EXPECT_EQ(isoUtc(0), "1970-01-01T00:00:00Z");
    EXPECT_EQ(isoUtc(951782400999), "2000-02-29T00:00:00Z");
    EXPECT_GT(systemWallMs(), 1700000000000);
    EXPECT_GT(systemMonoMs(), 0);
}

// ---------- layout and writes ----------

TEST(ProjectStore, OpenMakesTheLayoutPrivate) {
    Fixture f;
    EXPECT_EQ(modeOf(f.dir), 0700u);
    for (const char* sub : {"v", "staging", "ops"}) EXPECT_EQ(modeOf(f.dir + "/" + sub), 0700u);
    EXPECT_EQ(f.store->stateStatus(), StateStatus::Missing);
    EXPECT_EQ(f.store->versionDir(3), f.dir + "/v/3");
    EXPECT_EQ(f.store->projectDir(3), f.dir + "/v/3/project");
    EXPECT_EQ(f.store->packagePath(3), f.dir + "/v/3/package.matscada");
    EXPECT_EQ(f.store->stagingDir(kOp1), f.dir + "/staging/" + kOp1);

    // An existing directory with a wider mode is narrowed.
    ::chmod(f.dir.c_str(), 0755);
    f.reopen();
    EXPECT_EQ(modeOf(f.dir), 0700u);

    // A symlink in place of the store is refused.
    const std::string other = tempDir();
    const std::string link = other + "/projects";
    ASSERT_EQ(::symlink(f.dir.c_str(), link.c_str()), 0);
    StoreOptions o = f.opts();
    o.dir = link;
    ProjectStore s(o);
    std::string err;
    EXPECT_FALSE(s.open(err));
    EXPECT_FALSE(err.empty());
}

TEST(ProjectStore, ProjectBackupsIsClamped) {
    Fixture f;
    f.reopen(0);
    EXPECT_EQ(f.store->projectBackups(), 1);
    f.reopen(20);
    EXPECT_EQ(f.store->projectBackups(), 10);
    f.reopen(5);
    EXPECT_EQ(f.store->projectBackups(), 5);
}

TEST(ProjectStore, StateIsWrittenTempFsyncRenameFsyncDir) {
    Fixture f;
    std::string err;
    StoreState s;
    s.active = 1;
    s.nextSeq = 2;
    s.versions = {makeVersion(1)};
    ASSERT_TRUE(f.store->writeState(s, err)) << err;
    const std::string first = f.state();
    ASSERT_EQ(f.fsyncs.calls.size(), 2u);
    // 1: the temporary file, before the rename (state.json not there yet).
    EXPECT_NE(f.fsyncs.calls[0].path.find(f.dir + "/state.json.tmp"), std::string::npos)
        << f.fsyncs.calls[0].path;
    EXPECT_EQ(f.fsyncs.calls[0].stateAtCall, "<missing>");
    // 2: the directory, after the rename.
    EXPECT_EQ(f.fsyncs.calls[1].path, f.dir);
    EXPECT_EQ(f.fsyncs.calls[1].stateAtCall, first);
    EXPECT_EQ(modeOf(f.dir + "/state.json"), 0600u);
    EXPECT_EQ(listDir(f.dir), (std::vector<std::string>{"ops", "staging", "state.json", "v"}));
    EXPECT_EQ(f.store->stateStatus(), StateStatus::Ok);
    EXPECT_EQ(f.store->state().active, 1);

    // Second write: the old file stays in place until the rename.
    f.fsyncs.calls.clear();
    s.nextSeq = 3;
    ASSERT_TRUE(f.store->writeState(s, err)) << err;
    EXPECT_EQ(f.fsyncs.calls[0].stateAtCall, first);
    EXPECT_NE(f.fsyncs.calls[1].stateAtCall, first);
    std::string perr;
    EXPECT_EQ(parseStoreState(f.state(), perr).value_or(StoreState{}).nextSeq, 3);
}

TEST(ProjectStore, FailedWriteKeepsTheOldState) {
    Fixture f;
    std::string err;
    StoreState s;
    ASSERT_TRUE(f.store->writeState(s, err)) << err;
    const std::string before = f.state();
    f.fsyncs.fail = [](const std::string& p) {
        return p.find("state.json.tmp") != std::string::npos;
    };
    s.nextSeq = 5;
    EXPECT_FALSE(f.store->writeState(s, err));
    EXPECT_FALSE(err.empty());
    EXPECT_EQ(f.state(), before);
    EXPECT_EQ(f.store->state().nextSeq, 1);
    EXPECT_EQ(listDir(f.dir), (std::vector<std::string>{"ops", "staging", "state.json", "v"}));
}

TEST(ProjectStore, LoadTellsMissingOkCorrupt) {
    Fixture f;
    EXPECT_EQ(f.store->load(), StateStatus::Missing);
    writeFile(f.dir + "/state.json", storeStateJson(StoreState{}));
    EXPECT_EQ(f.store->load(), StateStatus::Ok);
    writeFile(f.dir + "/state.json", "{\"schemaVersion\":");
    std::string err;
    EXPECT_EQ(f.store->load(&err), StateStatus::Corrupt);
    EXPECT_FALSE(err.empty());
    EXPECT_EQ(f.store->stateStatus(), StateStatus::Corrupt);
}

// ---------- versions ----------

TEST(ProjectStore, BackupMovesStagingIntoVersionsWithMetaLast) {
    Fixture f;
    std::string err;
    const int fd = f.store->createStaging(kOp1, err);
    ASSERT_GE(fd, 0) << err;
    EXPECT_EQ(modeOf(f.store->stagingDir(kOp1)), 0700u);
    EXPECT_EQ(modeOf(f.store->stagingDir(kOp1) + "/package.matscada"), 0600u);
    ASSERT_EQ(::write(fd, "PK", 2), 2);
    ::close(fd);
    writeFile(f.store->stagingDir(kOp1) + "/project/project.json", "{}");
    // A second staging with the same name is refused.
    EXPECT_LT(f.store->createStaging(kOp1, err), 0);

    ProjectVersion meta = makeVersion(0);
    meta.activatedAt.reset();
    f.fsyncs.calls.clear();
    const auto seq = f.store->commitStaging(kOp1, meta, err);
    ASSERT_TRUE(seq.has_value()) << err;
    EXPECT_EQ(*seq, 1);
    EXPECT_FALSE(exists(f.store->stagingDir(kOp1)));
    EXPECT_EQ(readFile(f.store->packagePath(1)), "PK");
    EXPECT_EQ(readFile(f.store->projectDir(1) + "/project.json"), "{}");
    EXPECT_EQ(modeOf(f.store->versionDir(1) + "/meta.json"), 0600u);
    const auto m = f.store->readMeta(1);
    ASSERT_TRUE(m.has_value());
    EXPECT_EQ(m->seq, 1);
    EXPECT_FALSE(m->activatedAt.has_value());
    EXPECT_TRUE(f.store->isComplete(1));
    // fsync: v/ after the rename, then meta.json's temporary file, then v/1.
    ASSERT_EQ(f.fsyncs.calls.size(), 3u);
    EXPECT_EQ(f.fsyncs.calls[0].path, f.dir + "/v");
    EXPECT_NE(f.fsyncs.calls[1].path.find(f.dir + "/v/1/meta.json.tmp"), std::string::npos);
    EXPECT_EQ(f.fsyncs.calls[2].path, f.dir + "/v/1");
    // Nothing changed in state.json: the version is not referenced yet.
    EXPECT_EQ(f.store->stateStatus(), StateStatus::Missing);
}

TEST(ProjectStore, BackupTakesASeqAboveEveryDirectory) {
    Fixture f;
    std::string err;
    StoreState s;
    s.nextSeq = 4;
    ASSERT_TRUE(f.store->writeState(s, err));
    writeFile(f.dir + "/v/6/meta.json", "left over");
    EXPECT_EQ(stage(*f.store, kOp1, "a"), 7);
    StoreState t;
    t.nextSeq = 9;
    ASSERT_TRUE(f.store->writeState(t, err));
    EXPECT_EQ(stage(*f.store, kOp2, "b"), 9);
}

TEST(ProjectStore, FailedBackupLeavesNoVersion) {
    Fixture f;
    std::string err;
    ASSERT_GE(f.store->createStaging(kOp1, err), 0);
    f.fsyncs.fail = [](const std::string& p) { return p.find("meta.json") != std::string::npos; };
    ProjectVersion meta = makeVersion(0);
    EXPECT_FALSE(f.store->commitStaging(kOp1, meta, err).has_value());
    EXPECT_FALSE(err.empty());
    EXPECT_FALSE(f.store->isComplete(1));
    EXPECT_FALSE(exists(f.dir + "/v/1"));
    f.store->removeStaging(kOp1);
    EXPECT_TRUE(listDir(f.dir + "/staging").empty());
}

TEST(ProjectStore, CleanupAtStart) {
    Fixture f;
    const int64_t a = deployThrough(*f.store, opIdN(1), "a");  // active 1
    const int64_t b = stage(*f.store, opIdN(2), "b");          // 2: complete, not referenced
    writeFile(f.dir + "/v/9/project/x.json", "{}");            // 9: no meta.json
    std::string err;
    ASSERT_GE(f.store->createStaging(opIdN(3), err), 0);  // staging left by a kill
    writeFile(f.dir + "/staging/" + opIdN(3) + "/project/a/b.json", "{}");
    // A symlink in staging is removed, its target is not.
    const std::string outside = tempDir() + "/keep.txt";
    writeFile(outside, "keep");
    ASSERT_EQ(::symlink(outside.c_str(), (f.dir + "/staging/link").c_str()), 0);

    f.reopen();
    const auto removed = f.store->cleanup();
    EXPECT_EQ(removed.size(), 2u);
    EXPECT_TRUE(listDir(f.dir + "/staging").empty());
    EXPECT_EQ(readFile(outside), "keep");
    EXPECT_TRUE(f.store->isComplete(a));
    EXPECT_FALSE(exists(f.store->versionDir(b)));
    EXPECT_FALSE(exists(f.dir + "/v/9"));
    EXPECT_EQ(f.store->completeVersions(), (std::set<int64_t>{a}));
}

TEST(ProjectStore, CleanupKeepsTheVersionsOfThePendingOperation) {
    Fixture f;
    const int64_t a = deployThrough(*f.store, opIdN(1), "a");
    const int64_t b = stage(*f.store, opIdN(2), "b");
    PendingOperation p;
    p.opId = opIdN(2);
    p.from = a;
    p.to = b;
    p.startedAt = "2026-10-20T03:11:52Z";
    std::string err;
    ASSERT_TRUE(f.store->beginActivation(p, err)) << err;
    f.reopen();
    f.store->cleanup();
    EXPECT_EQ(f.store->completeVersions(), (std::set<int64_t>{a, b}));
}

TEST(ProjectStore, CleanupWithoutStateRemovesEveryVersionAndWithDamagedStateNone) {
    Fixture f;
    stage(*f.store, opIdN(1), "a");  // backup done, killed before activate: no state.json
    f.reopen();
    f.store->cleanup();
    EXPECT_TRUE(listDir(f.dir + "/v").empty());

    const int64_t s = stage(*f.store, opIdN(2), "b");
    writeFile(f.dir + "/state.json", "garbage");
    f.reopen();
    EXPECT_EQ(f.store->stateStatus(), StateStatus::Corrupt);
    f.store->cleanup();
    EXPECT_TRUE(f.store->isComplete(s));
}

TEST(ProjectStore, OldVersionsGoOnlyAfterACommit) {
    Fixture f;  // projectBackups 3
    for (int i = 1; i <= 4; ++i) deployThrough(*f.store, opIdN(i), "v" + std::to_string(i));
    EXPECT_EQ(f.store->state().versions.size(), 4u);
    EXPECT_TRUE(f.store->isComplete(1));

    // Fifth: backup and activation keep v/1 ...
    const int64_t five = stage(*f.store, opIdN(5), "v5");
    PendingOperation p;
    p.opId = opIdN(5);
    p.from = 4;
    p.to = five;
    p.startedAt = "2026-10-20T03:11:52Z";
    std::string err;
    ASSERT_TRUE(f.store->beginActivation(p, err)) << err;
    EXPECT_TRUE(f.store->isComplete(1));
    EXPECT_EQ(f.store->state().nextSeq, 6);
    EXPECT_EQ(f.store->state().active, 4);
    EXPECT_EQ(f.store->state().versions.size(), 4u);
    // ... the commit drops it.
    const auto meta = f.store->readMeta(five);
    ASSERT_TRUE(meta.has_value());
    ProjectVersion entry = *meta;
    entry.activatedAt = "2026-10-20T04:00:00Z";
    ASSERT_TRUE(f.store->commitPending(entry, err)) << err;
    const StoreState s = f.store->state();
    EXPECT_EQ(s.active, 5);
    ASSERT_EQ(s.versions.size(), 4u);
    EXPECT_EQ(s.versions[0].seq, 5);
    EXPECT_EQ(s.versions[3].seq, 2);
    EXPECT_FALSE(exists(f.store->versionDir(1)));
    EXPECT_TRUE(f.store->isComplete(2));
    std::string perr;
    EXPECT_EQ(parseStoreState(f.state(), perr).value_or(StoreState{}).active, 5);
}

TEST(ProjectStore, RollbackAndEndOfPendingKeepVersions) {
    Fixture f;
    const int64_t a = deployThrough(*f.store, opIdN(1), "a");
    const int64_t b = stage(*f.store, opIdN(2), "b");
    PendingOperation p;
    p.opId = opIdN(2);
    p.from = a;
    p.to = b;
    p.startedAt = "2026-10-20T03:11:52Z";
    std::string err;
    ASSERT_TRUE(f.store->beginActivation(p, err));
    ASSERT_TRUE(f.store->rollBackPending(err));
    ASSERT_TRUE(f.store->state().pending.has_value());
    EXPECT_EQ(f.store->state().pending->phase, PendingPhase::RollingBack);
    EXPECT_EQ(f.store->state().active, a);
    ASSERT_TRUE(f.store->endPending(true, err));
    EXPECT_FALSE(f.store->state().pending.has_value());
    EXPECT_EQ(f.store->state().active, a);
    f.store->removeUnreferenced();
    EXPECT_FALSE(exists(f.store->versionDir(b)));  // the failed deploy is gone
    EXPECT_TRUE(f.store->isComplete(a));
}

TEST(ProjectStore, VersionListTellsActiveAndRestorable) {
    Fixture f;
    deployThrough(*f.store, opIdN(1), "a");
    deployThrough(*f.store, opIdN(2), "b");
    const auto list = f.store->versionList();
    ASSERT_EQ(list.size(), 2u);
    EXPECT_EQ(list[0].version.seq, 2);
    EXPECT_TRUE(list[0].active);
    EXPECT_FALSE(list[1].active);
    EXPECT_TRUE(list[1].restorable);
    ::unlink((f.store->versionDir(1) + "/meta.json").c_str());
    EXPECT_FALSE(f.store->versionList()[1].restorable);
}

// ---------- operation records ----------

TEST(ProjectStore, OperationRecords) {
    Fixture f;
    std::string err;
    ASSERT_TRUE(f.store->writeOp(kOp1, "{\"a\":1}", err)) << err;
    ASSERT_TRUE(f.store->writeOp(kOp2, "{\"b\":2}", err)) << err;
    EXPECT_EQ(readFile(f.dir + "/ops/" + std::string(kOp1) + ".json"), "{\"a\":1}");
    EXPECT_EQ(modeOf(f.dir + "/ops/" + std::string(kOp1) + ".json"), 0600u);
    EXPECT_EQ(f.store->readOp(kOp1), std::optional<std::string>("{\"a\":1}"));
    auto ids = f.store->opIds();
    std::sort(ids.begin(), ids.end());
    EXPECT_EQ(ids, (std::vector<std::string>{kOp1, kOp2}));
    // Names that are not UUIDs never reach the file system.
    EXPECT_FALSE(f.store->writeOp("../state", "{}", err));
    EXPECT_FALSE(f.store->readOp("../state").has_value());
    writeFile(f.dir + "/ops/junk.txt", "x");
    EXPECT_EQ(f.store->opIds().size(), 2u);
    f.store->removeOp(kOp1);
    EXPECT_FALSE(f.store->readOp(kOp1).has_value());
}

// ---------- adoption of the project installed the old way (FR-027) ----------

struct AdoptFixture : Fixture {
    std::string legacyDir = tempDir() + "/project";
    LegacyProject legacy = makeLegacy(legacyDir);
    FakePack pack;
    FakeAudit audit;
};

TEST(ProjectStore, AdoptTakesTheLegacyProjectAsVersionOne) {
    AdoptFixture f;
    bool stateExistedAtAudit = true;
    f.audit.onAppend = [&](const AuditEvent&) {
        stateExistedAtAudit = exists(f.dir + "/state.json");
    };
    const AdoptResult r = f.store->adopt(f.legacy, f.pack.fn(), f.audit.fn());
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_EQ(r.seq, 1);
    // Packed from the copy in the store, not from projectDir.
    EXPECT_EQ(f.pack.lastDir.find(f.dir + "/staging/"), 0u) << f.pack.lastDir;
    EXPECT_EQ(listDir(f.store->projectDir(1)),
              (std::vector<std::string>{"project.json", "screens", "tags.json"}));
    EXPECT_EQ(readFile(f.store->projectDir(1) + "/screens/overview.screen.json"),
              readFile(f.legacyDir + "/screens/overview.screen.json"));
    EXPECT_EQ(modeOf(f.store->projectDir(1) + "/tags.json"), 0600u);
    EXPECT_EQ(modeOf(f.store->projectDir(1) + "/screens"), 0700u);
    const std::string pkg = readFile(f.store->packagePath(1));
    EXPECT_EQ(pkg.rfind("PACK\n", 0), 0u);

    const StoreState s = f.store->state();
    EXPECT_EQ(s.active, 1);
    EXPECT_EQ(s.nextSeq, 2);
    ASSERT_EQ(s.versions.size(), 1u);
    const ProjectVersion& v = s.versions[0];
    EXPECT_EQ(v.source, VersionSource::RuntimePackage);
    EXPECT_EQ(v.digest, fakeDigest(pkg));
    EXPECT_EQ(v.size, static_cast<int64_t>(pkg.size()));
    EXPECT_EQ(v.projectId, "tank-demo");
    EXPECT_EQ(v.projectVersion, "1.0.0");
    EXPECT_FALSE(v.deployedBy.has_value());
    EXPECT_EQ(v.activatedAt, std::optional<std::string>("2026-10-20T03:00:00Z"));
    EXPECT_TRUE(f.store->isComplete(1));
    EXPECT_TRUE(listDir(f.dir + "/staging").empty());

    ASSERT_EQ(f.audit.rows.size(), 1u);
    const auto& row = f.audit.rows[0];
    EXPECT_EQ(row.action, "project.adopt");
    EXPECT_EQ(row.result, "ok");
    EXPECT_EQ(row.channel, "system");
    EXPECT_EQ(row.source, "system");
    EXPECT_EQ(row.target, v.digest);
    EXPECT_FALSE(stateExistedAtAudit);  // the audit row comes before the change
    EXPECT_EQ(f.store->noPackageReason(), "");
}

TEST(ProjectStore, AdoptIsRefusedWithoutAudit) {
    AdoptFixture f;
    f.audit.fail = true;
    const AdoptResult r = f.store->adopt(f.legacy, f.pack.fn(), f.audit.fn());
    EXPECT_FALSE(r.ok);
    EXPECT_FALSE(r.error.empty());
    EXPECT_FALSE(exists(f.dir + "/state.json"));
    EXPECT_TRUE(listDir(f.dir + "/v").empty());
    EXPECT_TRUE(listDir(f.dir + "/staging").empty());
}

TEST(ProjectStore, AdoptFailsCleanlyWhenPackingOrCopyingFails) {
    {
        AdoptFixture f;
        f.pack.fail = true;
        const AdoptResult r = f.store->adopt(f.legacy, f.pack.fn(), f.audit.fn());
        EXPECT_FALSE(r.ok);
        EXPECT_NE(r.error.find("E_PKG_SECRET"), std::string::npos) << r.error;
        EXPECT_TRUE(f.audit.rows.empty());
        EXPECT_FALSE(exists(f.dir + "/state.json"));
        EXPECT_TRUE(listDir(f.dir + "/v").empty());
        EXPECT_TRUE(listDir(f.dir + "/staging").empty());
    }
    for (const std::string bad : {"../outside.json", "/etc/passwd", "missing.json", "a//b.json"}) {
        AdoptFixture f;
        f.legacy.files.push_back(bad);
        const AdoptResult r = f.store->adopt(f.legacy, f.pack.fn(), f.audit.fn());
        EXPECT_FALSE(r.ok) << bad;
        EXPECT_EQ(f.pack.calls, 0) << bad;
        EXPECT_TRUE(listDir(f.dir + "/staging").empty()) << bad;
        EXPECT_FALSE(exists(f.dir + "/state.json")) << bad;
    }
    // T062 (S2): names Windows cannot hold (trailing '.'/' ', device names) are refused before the
    // copy, even when the file exists on the device.
    for (const std::string bad : {"nul.json", "con .json", "screens./a.json", "a /b.json"}) {
        AdoptFixture f;
        const std::string path = f.legacyDir + "/" + bad;
        ::mkdir(path.substr(0, path.rfind('/')).c_str(), 0700);
        writeFile(path, "{}");
        f.legacy.files.push_back(bad);
        const AdoptResult r = f.store->adopt(f.legacy, f.pack.fn(), f.audit.fn());
        EXPECT_FALSE(r.ok) << bad;
        EXPECT_NE(r.error.find("không an toàn"), std::string::npos) << r.error;
        EXPECT_EQ(f.pack.calls, 0) << bad;
        EXPECT_TRUE(listDir(f.dir + "/staging").empty()) << bad;
    }
    {
        AdoptFixture f;  // the state write fails: no version stays behind
        f.fsyncs.fail = [](const std::string& p) {
            return p.find("state.json.tmp") != std::string::npos;
        };
        const AdoptResult r = f.store->adopt(f.legacy, f.pack.fn(), f.audit.fn());
        EXPECT_FALSE(r.ok);
        EXPECT_TRUE(listDir(f.dir + "/v").empty());
        EXPECT_FALSE(exists(f.dir + "/state.json"));
        ASSERT_EQ(f.audit.rows.size(), 2u);
        EXPECT_EQ(f.audit.rows[1].result, "failed");
        EXPECT_EQ(f.audit.rows[1].code, "STORE_IO");
    }
}

TEST(ProjectStore, StartAdoptsAValidLegacyProjectOnce) {
    AdoptFixture f;
    int legacyCalls = 0;
    BootHooks h;
    h.legacy = [&] {
        ++legacyCalls;
        return f.legacy;
    };
    h.pack = f.pack.fn();
    h.audit = f.audit.fn();
    StoreStartup st = startStore(*f.store, h);
    EXPECT_EQ(st.decision.action, BootAction::Adopt);
    EXPECT_EQ(st.runDir, f.store->projectDir(1));
    EXPECT_EQ(legacyCalls, 1);
    // Next start: the store is not empty any more, projectDir is not looked at.
    f.reopen();
    st = startStore(*f.store, h);
    EXPECT_EQ(st.decision.action, BootAction::RunActive);
    EXPECT_EQ(st.runDir, f.store->projectDir(1));
    EXPECT_EQ(legacyCalls, 1);
    EXPECT_EQ(f.pack.calls, 1);
}

TEST(ProjectStore, StartDoesNotTakeAnInvalidOrEmptyLegacyProject) {
    for (LegacyStatus status : {LegacyStatus::Invalid, LegacyStatus::Empty}) {
        AdoptFixture f;
        BootHooks h;
        h.legacy = [&] {
            LegacyProject l;
            l.status = status;
            l.dir = f.legacyDir;
            l.reason =
                status == LegacyStatus::Invalid ? "E_SCHEMA project.json" : "không có project.json";
            return l;
        };
        h.pack = f.pack.fn();
        h.audit = f.audit.fn();
        const StoreStartup st = startStore(*f.store, h);
        EXPECT_EQ(st.decision.action, BootAction::RunLegacy);
        EXPECT_EQ(st.runDir, f.legacyDir);
        EXPECT_EQ(f.pack.calls, 0);
        EXPECT_FALSE(exists(f.dir + "/state.json"));
        const std::string why = f.store->noPackageReason();
        EXPECT_NE(why.find(status == LegacyStatus::Invalid ? "E_SCHEMA" : "project.json"),
                  std::string::npos)
            << why;
    }
}

TEST(ProjectStore, StartRunsTheLegacyProjectWhenAdoptionFails) {
    AdoptFixture f;
    f.audit.fail = true;
    BootHooks h;
    h.legacy = [&] { return f.legacy; };
    h.pack = f.pack.fn();
    h.audit = f.audit.fn();
    const StoreStartup st = startStore(*f.store, h);
    EXPECT_EQ(st.decision.action, BootAction::RunLegacy);
    EXPECT_EQ(st.runDir, f.legacyDir);
    EXPECT_FALSE(st.error.empty());
    EXPECT_FALSE(f.store->noPackageReason().empty());
}

TEST(ProjectStore, AdoptRecordsTheActivationInMeta) {
    AdoptFixture f;
    ASSERT_TRUE(f.store->adopt(f.legacy, f.pack.fn(), f.audit.fn()).ok);
    const auto m = f.store->readMeta(1);
    ASSERT_TRUE(m.has_value());
    EXPECT_EQ(m->activatedAt, std::optional<std::string>("2026-10-20T03:00:00Z"));  // as state.json
    EXPECT_EQ(m->source, VersionSource::RuntimePackage);
}

TEST(ProjectStore, StartBlocksDeployOnlyWhenAValidOldProjectCouldNotBeTaken) {
    {
        AdoptFixture f;  // taken: no block, and none once state.json exists
        BootHooks h;
        h.legacy = [&] { return f.legacy; };
        h.pack = f.pack.fn();
        h.audit = f.audit.fn();
        startStore(*f.store, h);
        EXPECT_EQ(f.store->baseBlockReason(), "");
    }
    {
        AdoptFixture f;  // valid but not taken (audit down): blocked, with the reason
        f.audit.fail = true;
        BootHooks h;
        h.legacy = [&] { return f.legacy; };
        h.pack = f.pack.fn();
        h.audit = f.audit.fn();
        startStore(*f.store, h);
        EXPECT_NE(f.store->baseBlockReason().find("audit"), std::string::npos)
            << f.store->baseBlockReason();
    }
    for (LegacyStatus status : {LegacyStatus::Invalid, LegacyStatus::Empty}) {
        AdoptFixture f;  // nothing to take: the store is validly empty
        BootHooks h;
        h.legacy = [&] {
            LegacyProject l;
            l.status = status;
            l.dir = f.legacyDir;
            l.reason = "why";
            return l;
        };
        h.pack = f.pack.fn();
        h.audit = f.audit.fn();
        startStore(*f.store, h);
        EXPECT_EQ(f.store->baseBlockReason(), "");
    }
}

// ---------- state.json damaged: rebuilt from v/ (T100a) ----------

namespace {

struct RecoverFixture : Fixture {
    FakeAudit audit;

    // A complete v/<seq> as step backup leaves it, with `activatedAt` in meta.json.
    void seedVersion(int64_t seq, std::optional<std::string> activatedAt) {
        const std::string v = dir + "/v/" + std::to_string(seq);
        writeFile(v + "/project/project.json", "{}");
        writeFile(v + "/package.matscada", "PK");
        ProjectVersion m = makeVersion(seq, "1." + std::to_string(seq) + ".0");
        m.activatedAt = activatedAt;
        writeFile(v + "/meta.json", versionMetaJson(m));
    }
    void damage(const std::string& text) {
        writeFile(dir + "/state.json", text);
        reopen();
        EXPECT_EQ(store->stateStatus(), StateStatus::Corrupt);
    }
    RecoverResult recover(int64_t mono = 4242) { return store->recoverState(mono, audit.fn()); }
    std::string corruptName(int64_t mono = 4242) const {
        return "state.json.corrupt-" + std::to_string(mono);
    }
    StoreState onDisk() const {
        std::string err;
        return parseStoreState(readFile(dir + "/state.json"), err).value_or(StoreState{});
    }
};

std::vector<std::string> damagedShapes() {
    StoreState unknownActive;
    unknownActive.active = 9;
    unknownActive.nextSeq = 10;
    std::string wrongSchema = storeStateJson(StoreState{});
    wrongSchema.replace(wrongSchema.find("1.0.0"), 5, "2.0.0");
    return {"", "{\"schemaVersion\":", wrongSchema, storeStateJson(unknownActive)};
}

}  // namespace

TEST(ProjectStore, DamagedStateIsRebuiltFromTheVersionsOnDisk) {
    for (const std::string& shape : damagedShapes()) {
        RecoverFixture f;
        f.seedVersion(1, "2026-10-20T03:30:00Z");  // activated last: a restore after 2 and 3
        f.seedVersion(2, "2026-10-20T03:20:00Z");
        f.seedVersion(3, "2026-10-20T03:10:00Z");
        f.seedVersion(4, std::nullopt);                  // stored, never activated
        writeFile(f.dir + "/v/5/project/x.json", "{}");  // no meta.json: not a version
        f.damage(shape);
        bool damagedFileKeptAtAudit = false;
        f.audit.onAppend = [&](const AuditEvent&) {
            damagedFileKeptAtAudit =
                !exists(f.dir + "/" + f.corruptName()) && readFile(f.dir + "/state.json") == shape;
        };

        const RecoverResult r = f.recover();
        ASSERT_TRUE(r.ok) << r.error;
        EXPECT_EQ(r.active, std::optional<int64_t>(1));
        EXPECT_EQ(r.versions, 4u);
        EXPECT_EQ(r.corruptFile, f.corruptName());
        EXPECT_EQ(readFile(f.dir + "/" + f.corruptName()), shape);
        EXPECT_TRUE(damagedFileKeptAtAudit);  // the audit row comes before the change

        EXPECT_EQ(f.store->stateStatus(), StateStatus::Ok);
        const StoreState s = f.onDisk();
        EXPECT_EQ(s.active, std::optional<int64_t>(1));
        EXPECT_EQ(s.nextSeq, 6);  // above every directory of v/, the one without meta.json too
        EXPECT_FALSE(s.pending.has_value());
        std::vector<int64_t> order;
        for (const auto& v : s.versions) order.push_back(v.seq);
        EXPECT_EQ(order, (std::vector<int64_t>{1, 4, 3, 2}));  // running first, then newest seq
        ASSERT_FALSE(s.versions.empty());
        EXPECT_EQ(s.versions[0].activatedAt, std::optional<std::string>("2026-10-20T03:30:00Z"));
        EXPECT_EQ(s.versions[0].projectVersion, "1.1.0");  // the entries are the meta.json files
        EXPECT_EQ(f.store->state().active, std::optional<int64_t>(1));
        EXPECT_EQ(modeOf(f.dir + "/state.json"), 0600u);

        ASSERT_EQ(f.audit.rows.size(), 1u);
        const auto& row = f.audit.rows[0];
        EXPECT_EQ(row.action, "project.adopt");
        EXPECT_EQ(row.result, "ok");
        EXPECT_EQ(row.channel, "system");
        if (!s.versions.empty()) EXPECT_EQ(row.target, s.versions[0].digest);
        const auto detail = nlohmann::json::parse(row.detail, nullptr, false);
        ASSERT_TRUE(detail.is_object()) << row.detail;
        EXPECT_EQ(detail.value("reason", ""), "state-corrupt");
        EXPECT_EQ(detail.value("seq", 0), 1);
    }
}

TEST(ProjectStore, TheSameActivationTimeTakesTheHigherSeq) {
    RecoverFixture f;
    f.seedVersion(1, "2026-10-20T03:12:00Z");
    f.seedVersion(2, "2026-10-20T03:12:00Z");
    f.damage("x");
    ASSERT_TRUE(f.recover().ok);
    EXPECT_EQ(f.onDisk().active, std::optional<int64_t>(2));
}

TEST(ProjectStore, DamagedStateWithNoVersionBecomesAnEmptyValidStore) {
    RecoverFixture f;
    writeFile(f.dir + "/v/3/project/x.json", "{}");  // incomplete: ignored, its seq not reused
    f.damage("{");
    const RecoverResult r = f.recover();
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_FALSE(r.active.has_value());
    EXPECT_EQ(r.versions, 0u);
    EXPECT_EQ(f.store->stateStatus(), StateStatus::Ok);
    const StoreState s = f.onDisk();
    EXPECT_FALSE(s.active.has_value());
    EXPECT_TRUE(s.versions.empty());
    EXPECT_EQ(s.nextSeq, 4);
    EXPECT_FALSE(s.pending.has_value());
    EXPECT_EQ(readFile(f.dir + "/" + f.corruptName()), "{");
    ASSERT_EQ(f.audit.rows.size(), 1u);
    EXPECT_EQ(f.audit.rows[0].action, "project.adopt");
    EXPECT_NE(f.audit.rows[0].detail.find("state-corrupt"), std::string::npos);
}

TEST(ProjectStore, WithoutAnyActivationNoVersionRuns) {
    RecoverFixture f;
    f.seedVersion(1, std::nullopt);
    f.seedVersion(2, std::nullopt);
    f.damage("{");
    const RecoverResult r = f.recover();
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_FALSE(r.active.has_value());
    EXPECT_EQ(r.versions, 2u);
    const StoreState s = f.onDisk();
    EXPECT_FALSE(s.active.has_value());
    EXPECT_EQ(s.versions.size(), 2u);
    EXPECT_EQ(s.nextSeq, 3);
}

TEST(ProjectStore, DamagedStateStaysAsItIsWithoutAuditOrWhenTheWriteFails) {
    {
        RecoverFixture f;  // audit down: nothing changes
        f.seedVersion(1, "2026-10-20T03:30:00Z");
        f.damage("{");
        f.audit.fail = true;
        const RecoverResult r = f.recover();
        EXPECT_FALSE(r.ok);
        EXPECT_FALSE(r.error.empty());
        EXPECT_EQ(readFile(f.dir + "/state.json"), "{");
        EXPECT_FALSE(exists(f.dir + "/" + f.corruptName()));
        EXPECT_EQ(f.store->stateStatus(), StateStatus::Corrupt);
    }
    {
        RecoverFixture f;  // the new state.json cannot be written: the old name comes back
        f.seedVersion(1, "2026-10-20T03:30:00Z");
        f.damage("{");
        f.fsyncs.fail = [](const std::string& p) {
            return p.find("state.json.tmp") != std::string::npos;
        };
        const RecoverResult r = f.recover();
        EXPECT_FALSE(r.ok);
        EXPECT_FALSE(r.error.empty());
        EXPECT_EQ(readFile(f.dir + "/state.json"), "{");
        EXPECT_FALSE(exists(f.dir + "/" + f.corruptName()));
        EXPECT_EQ(f.store->stateStatus(), StateStatus::Corrupt);
        EXPECT_EQ(listDir(f.dir), (std::vector<std::string>{"ops", "staging", "state.json", "v"}));
    }
}

TEST(ProjectStore, OnlyADamagedStateIsRecovered) {
    RecoverFixture f;
    EXPECT_FALSE(f.recover().ok);  // Missing
    writeFile(f.dir + "/state.json", storeStateJson(StoreState{}));
    f.reopen();
    const std::string before = readFile(f.dir + "/state.json");
    EXPECT_FALSE(f.recover().ok);  // Ok
    EXPECT_EQ(readFile(f.dir + "/state.json"), before);
    EXPECT_TRUE(f.audit.rows.empty());
    EXPECT_EQ(listDir(f.dir), (std::vector<std::string>{"ops", "staging", "state.json", "v"}));
}

TEST(ProjectStore, ACommitRecordsTheActivationInMetaSoTheStateCanBeRebuilt) {
    RecoverFixture f;
    const int64_t a = deployThrough(*f.store, opIdN(1), "a");
    const int64_t b = deployThrough(*f.store, opIdN(2), "b");
    const auto m = f.store->readMeta(b);
    ASSERT_TRUE(m.has_value());
    EXPECT_EQ(m->activatedAt, std::optional<std::string>("2026-10-20T03:12:00Z"));
    EXPECT_EQ(m->deployedBy, std::optional<std::string>("kysu1"));
    EXPECT_TRUE(f.store->readMeta(a).has_value());

    const StoreState before = f.store->state();
    f.damage("garbage");
    ASSERT_TRUE(f.recover().ok);
    const StoreState after = f.onDisk();
    EXPECT_EQ(after.active, before.active);
    ASSERT_EQ(after.versions.size(), before.versions.size());
    for (size_t i = 0; i < after.versions.size() && i < before.versions.size(); ++i) {
        EXPECT_EQ(after.versions[i].seq, before.versions[i].seq);
        EXPECT_EQ(after.versions[i].digest, before.versions[i].digest);
        EXPECT_EQ(after.versions[i].activatedAt, before.versions[i].activatedAt);
    }
}
