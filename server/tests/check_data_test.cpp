// T066 (feature 011, US2; FR-040, contracts/device-api-011.md §7, test-protocols §4 step 5):
// `mat-runtime --check-data [--json]` on a data directory made the way the runtime leaves it:
// clean data gives 0; a cut history.db gives 2; a -wal that still holds frames gives 1; a project
// whose files no longer match the digest of state.json gives 2; a damaged retained store gives 2;
// an armed pulse.journal gives 1; a logic-state.json that is not JSON gives 2. It only reads: no
// file is made (no -wal, no -shm), none changes size, content or mtime. A database of tens of MB
// is checked well inside the 30 s; a budget too small for it says "warning", never "ok". The JSON
// follows the schema of the header (server/cli/check_data.hpp).
#include "server/cli/check_data.hpp"

#include <gtest/gtest.h>
#include <sqlite3.h>
#include <stdlib.h>
#include <sys/stat.h>

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include "core/package/project_digest.hpp"
#include "core/project-store/store.hpp"
#include "core/tag-engine/pulse_journal.hpp"
#include "core/tag-engine/retain_store.hpp"
#include "nlohmann/json.hpp"

namespace fs = std::filesystem;
using namespace mat;
using nlohmann::json;

namespace {

struct Dir {
    fs::path root;
    Dir() {
        std::string t = (fs::temp_directory_path() / "mat-checkdata-XXXXXX").string();
        root = ::mkdtemp(t.data());
    }
    ~Dir() {
        std::error_code ec;
        fs::remove_all(root, ec);
    }
    std::string data() const { return (root / "data").string(); }
    // Every path with its size, content hash and mtime (ns): a read-only command keeps it.
    std::string snapshot() const {
        std::ostringstream s;
        std::error_code ec;
        for (const auto& e : fs::recursive_directory_iterator(root, ec)) {
            s << e.path().string();
            struct stat st {};
            ::stat(e.path().c_str(), &st);
            if (e.is_regular_file()) {
                std::ifstream f(e.path(), std::ios::binary);
                std::string body((std::istreambuf_iterator<char>(f)),
                                 std::istreambuf_iterator<char>());
                s << " " << body.size() << " " << std::hash<std::string>{}(body) << " "
                  << st.st_mtim.tv_sec << "." << st.st_mtim.tv_nsec;
            }
            s << "\n";
        }
        return s.str();
    }
};

void exec(sqlite3* db, const char* sql) {
    char* msg = nullptr;
    ASSERT_EQ(sqlite3_exec(db, sql, nullptr, nullptr, &msg), SQLITE_OK) << (msg ? msg : "");
}

// A WAL database with `rows` rows of about `rowBytes`, closed cleanly (no -wal, no -shm left).
void makeDb(const std::string& path, int rows = 50, int rowBytes = 100) {
    fs::remove(path);  // a fresh file each time
    sqlite3* db = nullptr;
    ASSERT_EQ(sqlite3_open(path.c_str(), &db), SQLITE_OK);
    exec(db, "PRAGMA journal_mode=WAL");
    exec(db, "CREATE TABLE t(id INTEGER PRIMARY KEY, v BLOB)");
    exec(db, "BEGIN");
    sqlite3_stmt* st = nullptr;
    ASSERT_EQ(sqlite3_prepare_v2(db, "INSERT INTO t(v) VALUES(randomblob(?))", -1, &st, nullptr),
              SQLITE_OK);
    for (int i = 0; i < rows; ++i) {
        sqlite3_bind_int(st, 1, rowBytes);
        ASSERT_EQ(sqlite3_step(st), SQLITE_DONE);
        sqlite3_reset(st);
    }
    sqlite3_finalize(st);
    exec(db, "COMMIT");
    sqlite3_close(db);
}

void writeFile(const std::string& path, const std::string& text) {
    std::ofstream f(path, std::ios::binary | std::ios::trunc);
    f << text;
}

// A store with one running version whose digest matches its files.
void makeProjectStore(const std::string& storeDir) {
    const std::string proj = storeDir + "/v/1/project";
    fs::create_directories(proj + "/screens");
    writeFile(proj + "/project.json", R"({"schemaVersion":"1.0.0","projectId":"demo"})");
    writeFile(proj + "/tags.json", R"({"tags":[]})");
    writeFile(proj + "/screens/main.screen.json", R"({"id":"main"})");
    const auto digest =
        projectDirDigest(proj, {"project.json", "screens/main.screen.json", "tags.json"});
    ASSERT_TRUE(digest.has_value());
    StoreState s;
    s.active = 1;
    s.nextSeq = 2;
    ProjectVersion v;
    v.seq = 1;
    v.digest = *digest;
    v.projectId = "demo";
    v.projectName = "Demo";
    v.projectVersion = "1.0.0";
    v.minRuntimeVersion = "1.0.0";
    v.size = 1234;
    v.activatedAt = "2026-10-17T03:00:00Z";
    s.versions.push_back(v);
    writeFile(storeDir + "/state.json", storeStateJson(s));
}

void makeRetain(const std::string& dir) {
    PosixRetainIo io(dir);
    ASSERT_TRUE(io.ensureDir());
    RetainStore store(io, 0);
    store.open();
    store.set("A.SET", TagType::FLOAT32, 85.5);
    store.flushNow(1000);
}

// The data directory of a runtime that stopped cleanly.
void makeClean(const Dir& d) {
    fs::create_directories(d.data());
    makeDb(d.data() + "/history.db");
    makeDb(d.data() + "/audit.db");
    makeDb(d.data() + "/alarm.db");
    makeProjectStore(d.data() + "/projects");
    makeRetain(d.data() + "/retain");
    writeFile(d.data() + "/pulse.journal", "");
}

CheckDataOptions optionsOf(const Dir& d) {
    CheckDataOptions o;
    o.dataDir = d.data();
    return o;
}

const CheckItem* itemOf(const CheckDataResult& r, const std::string& name) {
    for (const CheckItem& c : r.checks)
        if (c.name == name) return &c;
    return nullptr;
}

std::string detailOf(const CheckDataResult& r, const std::string& name) {
    const CheckItem* c = itemOf(r, name);
    return c ? c->detail : "<absent>";
}

std::string statusOf(const CheckDataResult& r, const std::string& name) {
    const CheckItem* c = itemOf(r, name);
    return c ? c->status : "<absent>";
}

struct CliRun {
    int code;
    std::string out, err;
};

CliRun run(std::vector<std::string> args) {
    args.insert(args.begin(), "mat-runtime");
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(&a[0]);
    std::ostringstream out, err;
    const int code =
        runCheckDataCli(static_cast<int>(argv.size()), argv.data(), DeviceCliEnv{}, out, err);
    return {code, out.str(), err.str()};
}

}  // namespace

TEST(CheckData, CleanDataIsZeroAndEveryCheckIsNamed) {
    Dir d;
    makeClean(d);
    const CheckDataResult r = checkData(optionsOf(d));
    EXPECT_EQ(r.exitCode, 0);
    for (const char* name : {"history.db", "audit.db", "alarm.db", "project", "retain"})
        EXPECT_EQ(statusOf(r, name), "ok") << name << ": " << detailOf(r, name);
    EXPECT_EQ(statusOf(r, "pulse.journal"), "ok");
    EXPECT_EQ(statusOf(r, "logic-state"), "missing");  // no logic yet: not an error
}

TEST(CheckData, AnEmptyDataDirectoryIsMissingEverywhereAndZero) {
    Dir d;
    fs::create_directories(d.data());
    const CheckDataResult r = checkData(optionsOf(d));
    EXPECT_EQ(r.exitCode, 0);
    for (const char* name : {"history.db", "audit.db", "alarm.db", "project", "retain",
                             "pulse.journal", "logic-state"})
        EXPECT_EQ(statusOf(r, name), "missing") << name;
}

TEST(CheckData, OnlyReadsNoFileMadeNoMtimeChanged) {
    Dir d;
    makeClean(d);
    const std::string before = d.snapshot();
    checkData(optionsOf(d));
    run({"--check-data", "--json", "--data-dir", d.data()});
    EXPECT_EQ(d.snapshot(), before);
    EXPECT_FALSE(fs::exists(d.data() + "/history.db-shm"));
    EXPECT_FALSE(fs::exists(d.data() + "/history.db-wal"));
}

TEST(CheckData, ACutHistoryDbIsDamaged) {
    Dir d;
    makeClean(d);
    makeDb(d.data() + "/history.db", 2000, 400);  // about 1 MB: many pages
    const std::string path = d.data() + "/history.db";
    fs::resize_file(path, fs::file_size(path) / 2);
    const CheckDataResult r = checkData(optionsOf(d));
    EXPECT_EQ(r.exitCode, 2);
    EXPECT_EQ(statusOf(r, "history.db"), "damaged");
    EXPECT_EQ(statusOf(r, "audit.db"), "ok");
}

TEST(CheckData, NotADatabaseIsDamaged) {
    Dir d;
    makeClean(d);
    writeFile(d.data() + "/audit.db", std::string(8192, 'x'));
    const CheckDataResult r = checkData(optionsOf(d));
    EXPECT_EQ(r.exitCode, 2);
    EXPECT_EQ(statusOf(r, "audit.db"), "damaged");
}

TEST(CheckData, AWalStillHoldingFramesIsAWarningAndMakesNoShm) {
    Dir d;
    makeClean(d);
    // The runtime wrote in WAL mode and the power went: the -wal is there, not checkpointed.
    const std::string live = (d.root / "live.db").string();
    makeDb(live);
    sqlite3* db = nullptr;
    ASSERT_EQ(sqlite3_open(live.c_str(), &db), SQLITE_OK);
    exec(db, "PRAGMA wal_autocheckpoint=0");
    exec(db, "INSERT INTO t(v) VALUES(randomblob(5000))");
    fs::copy_file(live, d.data() + "/history.db", fs::copy_options::overwrite_existing);
    fs::copy_file(live + "-wal", d.data() + "/history.db-wal");
    sqlite3_close(db);
    const std::string before = d.snapshot();
    const CheckDataResult r = checkData(optionsOf(d));
    EXPECT_EQ(r.exitCode, 1);
    EXPECT_EQ(statusOf(r, "history.db"), "warning");
    EXPECT_NE(detailOf(r, "history.db").find("wal"), std::string::npos);
    EXPECT_FALSE(fs::exists(d.data() + "/history.db-shm"));
    EXPECT_EQ(d.snapshot(), before);
}

TEST(CheckData, AProjectThatNoLongerMatchesItsDigestIsDamaged) {
    Dir d;
    makeClean(d);
    writeFile(d.data() + "/projects/v/1/project/tags.json", R"({"tags":[{"id":"X"}]})");
    CheckDataResult r = checkData(optionsOf(d));
    EXPECT_EQ(r.exitCode, 2);
    EXPECT_EQ(statusOf(r, "project"), "damaged");
    // state.json that cannot be read is damaged too
    writeFile(d.data() + "/projects/state.json", "{");
    r = checkData(optionsOf(d));
    EXPECT_EQ(statusOf(r, "project"), "damaged");
}

TEST(CheckData, ALostRetainedStoreIsDamaged) {
    Dir d;
    makeClean(d);
    for (const char* f : {RetainStore::kFileA, RetainStore::kFileB})
        writeFile(d.data() + "/retain/" + f, std::string(RetainStore::kFileSize, '\x5a'));
    const CheckDataResult r = checkData(optionsOf(d));
    EXPECT_EQ(r.exitCode, 2);
    EXPECT_EQ(statusOf(r, "retain"), "damaged");
}

TEST(CheckData, AnArmedPulseIsAWarning) {
    Dir d;
    makeClean(d);
    PulseArm a;
    a.rid = "r-1";
    a.tag = "PUMP.START";
    a.rel = false;
    a.dueWallMs = 1792195200000LL;
    a.seq = 1;
    PulseArm b = a;
    b.rid = "r-2";
    b.seq = 2;
    writeFile(d.data() + "/pulse.journal", PulseJournal::armLine(a) + PulseJournal::armLine(b) +
                                               PulseJournal::doneLine("r-2", 3) +
                                               "{\"v\":1,\"op\":\"ar");  // a line cut at the end
    const CheckDataResult r = checkData(optionsOf(d));
    EXPECT_EQ(r.exitCode, 1);
    EXPECT_EQ(statusOf(r, "pulse.journal"), "warning");
    EXPECT_NE(detailOf(r, "pulse.journal").find("PUMP.START"), std::string::npos);
}

TEST(CheckData, ALogicStateThatIsNotJsonIsDamagedAndAGoodOneOk) {
    Dir d;
    makeClean(d);
    writeFile(d.data() + "/logic-state.json", R"({"schemaVersion":"1.0.0","blocks":{}})");
    EXPECT_EQ(statusOf(checkData(optionsOf(d)), "logic-state"), "ok");
    writeFile(d.data() + "/logic-state.json", R"({"schemaVersion":"1.0.0","blo)");
    const CheckDataResult r = checkData(optionsOf(d));
    EXPECT_EQ(r.exitCode, 2);
    EXPECT_EQ(statusOf(r, "logic-state"), "damaged");
}

TEST(CheckData, ALargeDatabaseInsideTheTimeAndATooSmallBudgetIsNeverOk) {
    // MAT_CHECK_DATA_BIG_MB=500 runs the size of FR-040 (minutes to build in a container).
    const char* env = std::getenv("MAT_CHECK_DATA_BIG_MB");
    const int mb = env ? std::atoi(env) : 32;
    Dir d;
    makeClean(d);
    makeDb(d.data() + "/history.db", mb * 256, 4000);  // about `mb` MiB
    const auto t0 = std::chrono::steady_clock::now();
    CheckDataResult r = checkData(optionsOf(d));
    const auto ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0)
            .count();
    EXPECT_EQ(r.exitCode, 0);
    EXPECT_LT(ms, 30000);
    std::printf("check-data: %d MiB history.db in %lld ms (durationMs %lld)\n", mb,
                static_cast<long long>(ms), static_cast<long long>(r.durationMs));
    CheckDataOptions tight = optionsOf(d);
    tight.budgetMs = 1;
    r = checkData(tight);
    EXPECT_EQ(statusOf(r, "history.db"), "warning");
    EXPECT_NE(detailOf(r, "history.db").find("chưa kiểm hết"), std::string::npos);
    EXPECT_GE(r.exitCode, 1);
}

TEST(CheckDataCli, JsonFollowsTheSchemaAndTheExitCodeIsTheResult) {
    Dir d;
    makeClean(d);
    writeFile(d.data() + "/logic-state.json", "nope");
    const CliRun c = run({"--check-data", "--json", "--data-dir", d.data()});
    EXPECT_EQ(c.code, 2) << c.err;
    const json j = json::parse(c.out, nullptr, false);
    ASSERT_TRUE(j.is_object()) << c.out;
    EXPECT_EQ(j["schema"], "mat-check-data/1");
    EXPECT_EQ(j["result"], "damaged");
    EXPECT_EQ(j["exitCode"], 2);
    EXPECT_TRUE(j["durationMs"].is_number_integer());
    ASSERT_TRUE(j["checks"].is_array());
    EXPECT_EQ(j["checks"].size(), 7u);
    for (const json& c2 : j["checks"]) {
        EXPECT_TRUE(c2["name"].is_string());
        const std::string s = c2["status"].get<std::string>();
        EXPECT_TRUE(s == "ok" || s == "warning" || s == "damaged" || s == "missing") << s;
        EXPECT_TRUE(c2["detail"].is_string());
    }
    // without --json: Vietnamese text, same exit code
    const CliRun t = run({"--check-data", "--data-dir", d.data()});
    EXPECT_EQ(t.code, 2);
    EXPECT_NE(t.out.find("logic-state"), std::string::npos);
    EXPECT_NE(t.out.find("hỏng"), std::string::npos);
}

TEST(CheckDataCli, RecognisedAndBadArgumentsAreThree) {
    std::vector<std::string> a = {"mat-runtime", "--check-data"};
    std::vector<char*> argv;
    for (auto& s : a) argv.push_back(&s[0]);
    EXPECT_TRUE(isCheckDataCommand(2, argv.data()));
    EXPECT_EQ(run({"--check-data", "--nope"}).code, 3);
    EXPECT_EQ(run({"--check-data", "--data-dir"}).code, 3);
    EXPECT_EQ(run({"--check-data", "--budget-s", "0"}).code, 3);
}
