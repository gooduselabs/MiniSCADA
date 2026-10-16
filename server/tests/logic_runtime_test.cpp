// Logic in the runtime's Tag Engine and its retained state (T130 Tag part, T131; FR-076, FR-084,
// FR-090, FR-091; contracts/logic-engine.md §9, §10): a real 1.0 project with logic.json activated
// as mat-runtime does it, the RuntimeEngine over the real retained store in a temporary directory.
// - the outputs are internal read-only Tags of the store (owner logic), updated in the engine's own
//   round, and a calculated Tag that reads one sees the value of the same round;
// - the retained values are written every flushS when they changed and at stop, never when they
//   did not; they come back at the next start; a deploy keeps a block by id, a new id starts at 0,
//   a removed id leaves the store; a damaged store starts at 0 with LOGIC_RETAIN_LOST.
#include <gtest/gtest.h>

#include <algorithm>
#include <atomic>
#include <filesystem>
#include <fstream>
#include <thread>

#include "server/runtime_engine.hpp"
#include "server/startup.hpp"

using nlohmann::json;
using namespace mat;
namespace fs = std::filesystem;

namespace {

const std::string kSchemas = std::string(MAT_SOURCE_DIR) + "/schemas";
const std::string kBase = std::string(MAT_SOURCE_DIR) + "/tests/project-vectors/v10-valid-no-logic";
constexpr int64_t kT0 = 1791594000000;

struct TempDir {
    fs::path path;
    explicit TempDir(const std::string& name)
        : path(fs::temp_directory_path() / ("mat-logic-rt-" + name)) {
        fs::remove_all(path);
        fs::create_directories(path);
    }
    ~TempDir() { fs::remove_all(path); }
};

json readJson(const fs::path& p) {
    std::ifstream f(p);
    return json::parse(f);
}
void writeJson(const fs::path& p, const json& j) { std::ofstream(p, std::ios::trunc) << j.dump(2); }

json counterDoc(const std::vector<std::string>& ids) {
    json counters = json::array();
    for (const auto& id : ids)
        counters.push_back({{"id", id}, {"up", "PUMP01.RUN"}, {"value", "LOGIC." + id}});
    return {{"schemaVersion", "1.0.0"},
            {"counters", counters},
            {"runhours", json::array({{{"id", "h_pump"},
                                       {"run", "PUMP01.RUN"},
                                       {"hours", "LOGIC.HOURS"},
                                       {"starts", "LOGIC.STARTS"}}})}};
}

// The vector without logic, with a logic.json and a calculated Tag that reads a logic Tag.
fs::path project(const TempDir& dir, const json& logic, const std::string& name = "p") {
    const fs::path p = dir.path / name;
    fs::copy(kBase, p, fs::copy_options::recursive);
    json pj = readJson(p / "project.json");
    pj["logic"] = "logic.json";
    writeJson(p / "project.json", pj);
    writeJson(p / "logic.json", logic);
    json tags = readJson(p / "tags.json");
    bool hasRun = false;
    for (const auto& t : tags["tags"])
        if (t["id"] == "PUMP01.RUN") hasRun = true;
    if (!hasRun)
        tags["tags"].push_back(
            {{"id", "PUMP01.RUN"}, {"kind", "internal"}, {"type", "BOOL"}, {"initial", false}});
    if (logic.contains("counters") && !logic["counters"].empty())
        tags["tags"].push_back(
            {{"id", "CALC.TWICE"},
             {"kind", "calculated"},
             {"type", "FLOAT64"},
             {"expression", "LOGIC." + logic["counters"][0]["id"].get<std::string>() + " * 2"}});
    writeJson(p / "tags.json", tags);
    return p;
}

struct Rig {
    ProjectValidation validation;
    TagStore store;
    ActiveProject active;
    std::unique_ptr<RuntimeEngine> rt;
    std::atomic<int64_t> mono{1000};
    SystemWarnings warnings{[] { return kT0; }};
    std::vector<std::string> audits;
    int64_t now = kT0;

    Rig(const fs::path& dir, const std::string& retainDir, int flushS = 10) {
        validation = validateProject(dir.string(), kSchemas, "1.0.0");
        EXPECT_TRUE(validation.valid) << resultJson(validation);
        active = activateProject(validation, 10, store);
        RuntimeEngineOptions o;
        o.retainDir = retainDir;
        o.retainWindowS = 1;
        o.logic = validation.project ? &validation.project->logic : nullptr;
        o.logicOptions.writes = "off";
        o.logicOptions.flushS = flushS;
        o.logicOptions.monoMs = [this] { return mono.load(); };
        o.logicOptions.timeSynced = [] { return true; };
        o.logicOptions.warnings = &warnings;
        o.logicOptions.audit = [this](const AuditEvent& e) {
            audits.push_back(auditActionName(e.action));
        };
        o.logicOptions.log = [](const std::string&) {};
        rt = std::make_unique<RuntimeEngine>(active.model, store, o);
        rt->firstRound(now);
    }
    TagValue get(const std::string& id) const { return store.get(*store.indexOf(id)); }
    void tick() {
        mono += 100;
        now += 100;
        rt->tick(now);
    }
    // n rising edges of PUMP01.RUN (internal: set through the engine, applied in the next round)
    void edges(int n) {
        const size_t run = *active.model->tagIndex("PUMP01.RUN");
        for (int i = 0; i < n; ++i) {
            rt->engine()->setInternal(run, false);
            tick();
            tick();
            rt->engine()->setInternal(run, true);
            tick();
            tick();
        }
    }
    bool warned(const std::string& code) {
        for (const auto& w : warnings.list())
            if (w.code == code) return true;
        return false;
    }
};

int64_t i64(const TagValue& v) { return std::get<int64_t>(v.value); }

}  // namespace

TEST(LogicRuntime, LogicTagsAreInternalReadOnlyTagsOwnedByLogic) {
    TempDir d("model");
    Rig r(project(d, counterDoc({"c_a"})), (d.path / "retain").string());
    ASSERT_TRUE(r.active.active);
    ASSERT_NE(r.rt->logic(), nullptr);
    const auto idx = r.active.model->tagIndex("LOGIC.c_a");
    ASSERT_TRUE(idx.has_value());
    const TagModel& t = r.active.model->tags[*idx];
    EXPECT_EQ(t.kind, TagKind::Internal);
    EXPECT_FALSE(t.writable);
    EXPECT_TRUE(t.logicOwned);
    EXPECT_EQ(t.type, TagType::INT64);
    EXPECT_EQ(r.active.model->tags[*r.active.model->tagIndex("LOGIC.HOURS")].type,
              TagType::FLOAT64);
    EXPECT_TRUE(r.store.indexOf("LOGIC.STARTS").has_value());
    r.rt->stop();
}

TEST(LogicRuntime, TheEngineRoundRunsLogicAndACalculatedTagSeesItInTheSameRound) {
    TempDir d("round");
    Rig r(project(d, counterDoc({"c_a"})), (d.path / "retain").string());
    r.edges(3);
    EXPECT_EQ(r.get("LOGIC.c_a").quality, Quality::GOOD);
    EXPECT_EQ(i64(r.get("LOGIC.c_a")), 3);
    EXPECT_EQ(std::get<double>(r.get("CALC.TWICE").value), 6.0);
    // the counter and the calculated Tag changed in the same batch of the store
    const uint64_t before = r.get("CALC.TWICE").revision;
    r.edges(1);
    EXPECT_EQ(i64(r.get("LOGIC.c_a")), 4);
    EXPECT_EQ(std::get<double>(r.get("CALC.TWICE").value), 8.0);
    EXPECT_GT(r.get("CALC.TWICE").revision, before);
    EXPECT_EQ(i64(r.get("LOGIC.STARTS")), 4);
    r.rt->stop();
}

TEST(LogicRuntime, RetainedValuesComeBackAfterARestart) {
    TempDir d("restart");
    const fs::path p = project(d, counterDoc({"c_a"}));
    const std::string retain = (d.path / "retain").string();
    {
        Rig r(p, retain);
        r.edges(5);
        r.rt->stop();  // SIGTERM: what changed is written
    }
    Rig r(p, retain);
    r.tick();
    EXPECT_EQ(i64(r.get("LOGIC.c_a")), 5);
    EXPECT_EQ(i64(r.get("LOGIC.STARTS")), 5);
    EXPECT_FALSE(r.rt->logic()->retainLost());
    EXPECT_FALSE(r.warned("LOGIC_RETAIN_LOST"));
    r.rt->stop();
}

TEST(LogicRuntime, WrittenEveryFlushSWhenChangedNeverWhenUnchanged) {
    TempDir d("flush");
    Rig r(project(d, counterDoc({"c_a"})), (d.path / "retain").string(), 10);
    r.rt->start();
    r.edges(2);
    // the pump stops: its run hours no longer change
    r.rt->engine()->setInternal(*r.active.model->tagIndex("PUMP01.RUN"), false);
    r.tick();
    r.tick();
    const auto saves = [&] { return r.rt->retainDiag().saves; };
    // nothing at all before flushS
    std::this_thread::sleep_for(std::chrono::milliseconds(600));
    const uint64_t s0 = saves();
    r.mono += 10000;  // flushS over
    r.tick();
    std::this_thread::sleep_for(std::chrono::milliseconds(1500));  // the saver's window (1 s)
    const uint64_t s1 = saves();
    EXPECT_GT(s1, s0) << "the changes of the counter are written once flushS is over";
    EXPECT_EQ(r.rt->retainStore()->values().at("logic/c_a/value").value, TagScalar{int64_t{2}});
    r.mono += 10000;  // again flushS, nothing changed
    r.tick();
    std::this_thread::sleep_for(std::chrono::milliseconds(1500));
    EXPECT_EQ(saves(), s1) << "no write when nothing changed";
    r.rt->stop();
}

TEST(LogicRuntime, ADeployKeepsBlocksByIdNewOnesStartAtZeroRemovedOnesLeave) {
    TempDir d("deploy");
    const std::string retain = (d.path / "retain").string();
    {
        Rig r(project(d, counterDoc({"c_keep", "c_gone"}), "one"), retain);
        r.edges(3);
        r.rt->stop();
    }
    Rig r(project(d, counterDoc({"c_keep", "c_new"}), "two"), retain);
    r.tick();
    EXPECT_EQ(i64(r.get("LOGIC.c_keep")), 3);
    EXPECT_EQ(i64(r.get("LOGIC.c_new")), 0);
    r.rt->stop();
    const auto& v = r.rt->retainStore()->values();
    EXPECT_EQ(v.count("logic/c_gone/value"), 0u) << "a removed block leaves the store";
    EXPECT_EQ(v.count("logic/c_keep/value"), 1u);
}

TEST(LogicRuntime, ADamagedStoreStartsAtZeroWithAWarningAndOneAudit) {
    TempDir d("lost");
    const fs::path p = project(d, counterDoc({"c_a"}));
    const std::string retain = (d.path / "retain").string();
    {
        Rig r(p, retain);
        r.edges(2);
        r.rt->stop();
    }
    for (const char* f : {RetainStore::kFileA, RetainStore::kFileB}) {
        std::fstream file(retain + "/" + f, std::ios::in | std::ios::out | std::ios::binary);
        file.seekp(0);
        file.write("XXXXXXXXXXXXXXXX", 16);
    }
    Rig r(p, retain);
    r.tick();
    EXPECT_TRUE(r.rt->logic()->retainLost());
    EXPECT_TRUE(r.warned("LOGIC_RETAIN_LOST"));
    EXPECT_EQ(i64(r.get("LOGIC.c_a")), 0);
    EXPECT_EQ(std::count(r.audits.begin(), r.audits.end(), "logic.retain.lost"), 1);
    r.rt->stop();
}
