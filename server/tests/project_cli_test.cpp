// T107 (feature 005; contracts/device-config.md §4): the project commands of the device.
// - --project-status: the running version, the backups and the pending operation from state.json;
//   it writes nothing (not even a directory), and shows what is not there (no store, a damaged
//   state.json, a version without meta.json);
// - --check-project --project-store <dir>: validates the project that runs in the store with this
//   binary: exit 0 or 1, the validator's JSON on stdout; 6 when the store cannot be read;
// - the old --check-project (projectDir) is not this command.
#include <gtest/gtest.h>

#include <sstream>

#include "core/project-store/tests/store_test_support.hpp"
#include "nlohmann/json.hpp"
#include "server/cli/project.hpp"

using namespace mat;
using nlohmann::json;
using namespace storetest;

namespace {

const std::string kVectors = std::string(MAT_SOURCE_DIR) + "/tests/project-vectors";
const std::string kSchemas = std::string(MAT_SOURCE_DIR) + "/schemas";

struct CliRun {
    int code;
    std::string out;
    std::string err;
};

CliRun run(std::vector<std::string> args, const std::string& schemas = kSchemas) {
    args.insert(args.begin(), "mat-runtime");
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(&a[0]);
    std::ostringstream out, err;
    const int code = runProjectCli(static_cast<int>(argv.size()), argv.data(), DeviceCliEnv{}, out,
                                   err, schemas);
    return {code, out.str(), err.str()};
}

bool is(std::vector<std::string> args) {
    args.insert(args.begin(), "mat-runtime");
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(&a[0]);
    return isProjectCommand(static_cast<int>(argv.size()), argv.data());
}

void copyTree(const std::string& from, const std::string& to) {
    const std::string cmd = "mkdir -p '" + to + "' && cp -r '" + from + "'/. '" + to + "'/";
    ASSERT_EQ(std::system(cmd.c_str()), 0);
}

// Lists every path under `dir` with its size: what a command that must not write compares.
std::string snapshot(const std::string& dir) {
    const std::string cmd =
        "find '" + dir + "' -printf '%p %s %T@\\n' | sort > '" + dir + ".snapshot'";
    std::system(cmd.c_str());
    const std::string text = readFile(dir + ".snapshot");
    ::unlink((dir + ".snapshot").c_str());
    return text;
}

struct Store {
    std::string root = tempDir();
    std::string dir = root + "/projects";

    void state(const StoreState& s) { writeFile(dir + "/state.json", storeStateJson(s)); }
    // v/<seq>/project from a project vector; meta.json unless `incomplete`.
    void version(const ProjectVersion& v, const std::string& vector, bool incomplete = false) {
        copyTree(kVectors + "/" + vector, dir + "/v/" + std::to_string(v.seq) + "/project");
        if (!incomplete)
            writeFile(dir + "/v/" + std::to_string(v.seq) + "/meta.json", versionMetaJson(v));
    }
    ~Store() {
        const std::string cmd = "rm -rf '" + root + "'";
        std::system(cmd.c_str());
    }
};

ProjectVersion running() {
    ProjectVersion v = makeVersion(7, "1.3.0");
    v.projectId = "tank-demo";
    return v;
}

// Version 7 running, 6 and 5 as backups (5 without meta.json), no pending operation.
StoreState twoBackups() {
    StoreState s;
    s.active = 7;
    s.nextSeq = 8;
    ProjectVersion b6 = makeVersion(6, "1.2.0");
    b6.source = VersionSource::RuntimePackage;
    b6.deployedBy.reset();
    b6.deployedFrom.reset();
    s.versions = {running(), b6, makeVersion(5, "1.1.0")};
    return s;
}

}  // namespace

// ---------- isProjectCommand ----------

TEST(ProjectCommand, RecognisesTheTwoCommands) {
    EXPECT_TRUE(is({"--project-status"}));
    EXPECT_TRUE(is({"--check-project", "--project-store", "/x"}));
    EXPECT_FALSE(is({"--check-project"}));  // the older check of projectDir
    EXPECT_FALSE(is({"--check-project", "--project-dir", "/x"}));
    EXPECT_FALSE(is({"--project-store", "/x"}));
    EXPECT_FALSE(is({"--config", "/etc/x.json"}));
}

// ---------- --project-status ----------

TEST(ProjectStatus, ShowsRunningVersionBackupsAndNoPending) {
    Store st;
    st.state(twoBackups());
    st.version(running(), "valid-minimal");
    st.version(makeVersion(6, "1.2.0"), "valid-minimal");
    st.version(makeVersion(5, "1.1.0"), "valid-minimal", /*incomplete=*/true);
    const CliRun r = run({"--project-status", "--project-store-dir", st.dir});
    EXPECT_EQ(r.code, 0) << r.err;
    EXPECT_EQ(r.err, "");
    EXPECT_NE(r.out.find("seq 7"), std::string::npos) << r.out;
    EXPECT_NE(r.out.find("tank-demo 1.3.0"), std::string::npos);
    EXPECT_NE(r.out.find(makeVersion(7).digest), std::string::npos);
    EXPECT_NE(r.out.find("kysu1"), std::string::npos);         // deployedBy of the running one
    EXPECT_NE(r.out.find("192.168.1.20"), std::string::npos);  // deployedFrom
    EXPECT_NE(r.out.find("studio"), std::string::npos);
    EXPECT_NE(r.out.find("seq 6"), std::string::npos);
    EXPECT_NE(r.out.find("1.2.0"), std::string::npos);
    EXPECT_NE(r.out.find("runtime-package"), std::string::npos);  // the adopted backup
    EXPECT_NE(r.out.find("seq 5"), std::string::npos);
    EXPECT_NE(r.out.find("thiếu file"), std::string::npos);  // 5 has no meta.json
    EXPECT_NE(r.out.find("Thao tác dở dang: không"), std::string::npos);
}

TEST(ProjectStatus, ShowsThePendingOperation) {
    Store st;
    StoreState s = twoBackups();
    PendingOperation p;
    p.opId = kOp1;
    p.kind = OpKind::Deploy;
    p.from = 7;
    p.to = 8;
    p.phase = PendingPhase::Health;
    p.bootAttempts = 1;
    p.user = "kysu2";
    p.source = "192.168.1.31";
    p.startedAt = "2026-10-21T08:00:00Z";
    s.nextSeq = 9;
    s.pending = p;
    ProjectVersion v8 = makeVersion(8, "1.4.0");
    s.versions.insert(s.versions.begin() + 1, v8);
    st.state(s);
    const CliRun r = run({"--project-status", "--project-store-dir", st.dir});
    EXPECT_EQ(r.code, 0) << r.err;
    EXPECT_NE(r.out.find("Thao tác dở dang"), std::string::npos);
    EXPECT_NE(r.out.find(kOp1), std::string::npos);
    EXPECT_NE(r.out.find("deploy"), std::string::npos);
    EXPECT_NE(r.out.find("health"), std::string::npos);
    EXPECT_NE(r.out.find("kysu2"), std::string::npos);
    EXPECT_NE(r.out.find("192.168.1.31"), std::string::npos);
    EXPECT_NE(r.out.find("2026-10-21T08:00:00Z"), std::string::npos);
    EXPECT_EQ(r.out.find("Thao tác dở dang: không"), std::string::npos);
}

TEST(ProjectStatus, EmptyStoreAndMissingStoreAreNotErrors) {
    Store st;
    StoreState s;
    st.state(s);
    const CliRun r = run({"--project-status", "--project-store-dir", st.dir});
    EXPECT_EQ(r.code, 0) << r.err;
    EXPECT_NE(r.out.find("chưa có project"), std::string::npos) << r.out;
    Store none;  // no state.json at all
    const CliRun m = run({"--project-status", "--project-store-dir", none.dir});
    EXPECT_EQ(m.code, 0) << m.err;
    EXPECT_NE(m.out.find("chưa có state.json"), std::string::npos) << m.out;
}

TEST(ProjectStatus, DamagedStateIsExit6) {
    Store st;
    writeFile(st.dir + "/state.json", "{ not json");
    const CliRun r = run({"--project-status", "--project-store-dir", st.dir});
    EXPECT_EQ(r.code, 6);
    EXPECT_NE(r.err.find("state.json"), std::string::npos) << r.err;
    EXPECT_EQ(r.out, "");
}

TEST(ProjectStatus, WritesNothing) {
    Store st;
    st.state(twoBackups());
    st.version(running(), "valid-minimal");
    const std::string before = snapshot(st.dir);
    run({"--project-status", "--project-store-dir", st.dir});
    EXPECT_EQ(snapshot(st.dir), before);
    Store none;  // the directory is not created either
    run({"--project-status", "--project-store-dir", none.dir});
    EXPECT_FALSE(exists(none.dir));
}

TEST(ProjectStatus, TheStoreFollowsTheDataDirWithoutAnOverride) {
    Store st;  // <root>/projects, as <dataDir>/projects
    st.state(twoBackups());
    const CliRun r = run({"--project-status", "--data-dir", st.root, "--config", "/nonexistent"});
    // an explicit --config that cannot be read is an error of the configuration (exit 2)
    EXPECT_EQ(r.code, 2) << r.out;
    const CliRun d = run({"--project-status", "--data-dir", st.root});
    EXPECT_EQ(d.code, 0) << d.err;
    EXPECT_NE(d.out.find("seq 7"), std::string::npos);
}

TEST(ProjectStatus, ControlCharactersOfTheStateAreNotPrinted) {
    Store st;
    StoreState s = twoBackups();
    s.versions[0].deployedBy = std::string("kysu1\x1b[31m\x07");
    st.state(s);
    const CliRun r = run({"--project-status", "--project-store-dir", st.dir});
    EXPECT_EQ(r.code, 0) << r.err;
    EXPECT_EQ(r.out.find('\x1b'), std::string::npos);
    EXPECT_EQ(r.out.find('\x07'), std::string::npos);
    EXPECT_NE(r.out.find("kysu1"), std::string::npos);
}

TEST(ProjectStatus, UnknownArgumentIsExit2) {
    Store st;
    EXPECT_EQ(run({"--project-status", "--bogus"}).code, 2);
    EXPECT_EQ(run({"--project-status", "--project-store-dir"}).code, 2);
}

// ---------- --check-project --project-store ----------

TEST(CheckProjectInStore, ValidRunningProjectIsExit0) {
    Store st;
    st.state(twoBackups());
    st.version(running(), "valid-minimal");
    const CliRun r = run({"--check-project", "--project-store", st.dir});
    EXPECT_EQ(r.code, 0) << r.out << r.err;
    const json j = json::parse(r.out, nullptr, false);
    ASSERT_TRUE(j.is_object()) << r.out;
    EXPECT_TRUE(j["valid"].get<bool>());
    EXPECT_TRUE(j["errors"].empty());
}

TEST(CheckProjectInStore, OnlyTheRunningVersionIsChecked) {
    Store st;
    st.state(twoBackups());
    st.version(running(), "valid-minimal");
    st.version(makeVersion(6, "1.2.0"), "invalid-schema");  // a bad backup does not matter
    EXPECT_EQ(run({"--check-project", "--project-store", st.dir}).code, 0);
}

TEST(CheckProjectInStore, ProjectThatThisBinaryCannotRunIsExit1) {
    Store st;
    st.state(twoBackups());
    st.version(running(), "invalid-runtime-too-old");
    const CliRun r = run({"--check-project", "--project-store", st.dir});
    EXPECT_EQ(r.code, 1) << r.out << r.err;
    const json j = json::parse(r.out, nullptr, false);
    ASSERT_TRUE(j.is_object()) << r.out;
    EXPECT_FALSE(j["valid"].get<bool>());
    EXPECT_EQ(j["errors"][0]["code"], "E_RUNTIME_TOO_OLD");
}

TEST(CheckProjectInStore, RunningVersionWithoutFilesIsExit1) {
    Store st;
    st.state(twoBackups());  // v/7 does not exist
    const CliRun r = run({"--check-project", "--project-store", st.dir});
    EXPECT_EQ(r.code, 1) << r.out << r.err;
    EXPECT_NE(r.out.find("E_FILE_MISSING"), std::string::npos);
}

TEST(CheckProjectInStore, StoreWithoutAProjectIsValid) {
    Store st;
    StoreState s;
    st.state(s);
    const CliRun r = run({"--check-project", "--project-store", st.dir});
    EXPECT_EQ(r.code, 0) << r.out << r.err;
    const json j = json::parse(r.out, nullptr, false);
    ASSERT_TRUE(j.is_object()) << r.out;
    EXPECT_TRUE(j["valid"].get<bool>());
    EXPECT_TRUE(j["project"].is_null());
}

TEST(CheckProjectInStore, UnreadableStoreIsExit6) {
    Store none;  // no state.json: deploy.sh only calls this when there is one
    EXPECT_EQ(run({"--check-project", "--project-store", none.dir}).code, 6);
    Store bad;
    writeFile(bad.dir + "/state.json", "[]");
    const CliRun r = run({"--check-project", "--project-store", bad.dir});
    EXPECT_EQ(r.code, 6);
    EXPECT_NE(r.err.find("state.json"), std::string::npos);
    Store st;
    st.state(twoBackups());
    st.version(running(), "valid-minimal");
    EXPECT_EQ(run({"--check-project", "--project-store", st.dir}, "/nonexistent-schemas").code, 6);
}

TEST(CheckProjectInStore, SchemasDirOverridesTheDefault) {
    Store st;
    st.state(twoBackups());
    st.version(running(), "valid-minimal");
    EXPECT_EQ(run({"--check-project", "--project-store", st.dir, "--schemas-dir", kSchemas},
                  "/nonexistent-schemas")
                  .code,
              0);
    EXPECT_EQ(run({"--check-project", "--project-store", st.dir, "--schemas-dir", "/nowhere"}).code,
              6);
}

TEST(CheckProjectInStore, WritesNothing) {
    Store st;
    st.state(twoBackups());
    st.version(running(), "valid-minimal");
    const std::string before = snapshot(st.dir);
    run({"--check-project", "--project-store", st.dir});
    EXPECT_EQ(snapshot(st.dir), before);
}

TEST(CheckProjectInStore, BadArgumentsAreExit2) {
    EXPECT_EQ(run({"--check-project", "--project-store"}).code, 2);
    EXPECT_EQ(run({"--check-project", "--project-store", "/x", "--bogus"}).code, 2);
    EXPECT_EQ(run({"--check-project", "--project-store", ""}).code, 2);
}

// ---------- --check-project: serialPorts of the configuration (feature 006 T165; device-config §4)

TEST(CheckProjectInStore, SerialPortsOfTheConfigurationDecideE_SERIAL_NOT_ALLOWED) {
    Store st;
    st.state(twoBackups());
    st.version(running(), "v02-valid-full");  // an RTU channel on ttyAS2
    // the default list is ttyAS*
    EXPECT_EQ(run({"--check-project", "--project-store", st.dir}).code, 0);
    // a list from the command line (the test switch of the contract)
    CliRun r = run({"--check-project", "--project-store", st.dir, "--serial-ports", "ttyUSB*"});
    EXPECT_EQ(r.code, 1) << r.out << r.err;
    EXPECT_NE(r.out.find("E_SERIAL_NOT_ALLOWED"), std::string::npos) << r.out;
    EXPECT_EQ(
        run({"--check-project", "--project-store", st.dir, "--serial-ports", "ttyAS2,ttyUSB*"})
            .code,
        0);
    // the file of the configuration
    const std::string cfg = st.root + "/runtime.json";
    writeFile(cfg, R"({"serialPorts": ["ttyUSB*"]})");
    r = run({"--check-project", "--project-store", st.dir, "--config", cfg});
    EXPECT_EQ(r.code, 1) << r.out << r.err;
    EXPECT_NE(r.out.find("E_SERIAL_NOT_ALLOWED"), std::string::npos);
    writeFile(cfg, R"({"serialPorts": ["ttyAS*"]})");
    EXPECT_EQ(run({"--check-project", "--project-store", st.dir, "--config", cfg}).code, 0);
    // a configuration that cannot be read stops the command (exit 2, like the other device
    // commands)
    writeFile(cfg, R"({"serialPorts": "ttyAS*"})");
    EXPECT_EQ(run({"--check-project", "--project-store", st.dir, "--config", cfg}).code, 2);
}

TEST(CheckProjectInStore, AProjectWithoutRtuChannelsIsUnaffectedByTheList) {
    Store st;
    st.state(twoBackups());
    st.version(running(), "valid-minimal");
    EXPECT_EQ(run({"--check-project", "--project-store", st.dir, "--serial-ports", "ttyUSB*"}).code,
              0);
}
