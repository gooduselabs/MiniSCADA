// T109 (feature 011; FR-066; device-api-011 §7; contracts/update-package.md §4 S5): `mat-runtime
// --self-check --config <file>`, which mat-updater runs as matscada with the NEW binary before the
// switch: the configuration loads, the data is readable (the read-only check of --check-data), and
// the running project passes the validator and schemas of the new tree. It opens no port and
// writes nothing (every file of the data directory keeps its size, content and mtime). Exit 0
// good, 1 refused (damaged data, invalid project), 2 bad configuration.
#include "server/cli/self_check.hpp"

#include <gtest/gtest.h>
#include <stdlib.h>
#include <sys/stat.h>

#include <filesystem>
#include <fstream>
#include <sstream>

#include "nlohmann/json.hpp"

namespace fs = std::filesystem;
using namespace mat;

namespace {

struct Dir {
    fs::path root;
    Dir() {
        std::string t = (fs::temp_directory_path() / "mat-selfcheck-XXXXXX").string();
        root = ::mkdtemp(t.data());
        fs::create_directories(root / "data");
    }
    ~Dir() {
        std::error_code ec;
        fs::remove_all(root, ec);
    }
    std::string data() const { return (root / "data").string(); }
    std::string snapshot() const {
        std::ostringstream s;
        std::error_code ec;
        for (const auto& e : fs::recursive_directory_iterator(root, ec)) {
            struct stat st {};
            ::stat(e.path().c_str(), &st);
            s << e.path().string() << " " << st.st_size << " " << st.st_mtim.tv_sec << "."
              << st.st_mtim.tv_nsec << "\n";
        }
        return s.str();
    }
    std::string config(const std::string& projectDir, const std::string& extra = "") const {
        const std::string p = (root / "runtime.json").string();
        std::ofstream(p) << "{\"dataDir\": \"" << data() << "\", \"projectDir\": \"" << projectDir
                         << "\", \"port\": 18080, \"httpsPort\": 0" << extra << "}";
        return p;
    }
};

const std::string kSchemas = std::string(MAT_SOURCE_DIR) + "/schemas";
const std::string kDemo = std::string(MAT_SOURCE_DIR) + "/projects/tank-demo";

int run(const std::vector<std::string>& args, std::string& out, std::string& schemas) {
    std::vector<std::string> all = {"mat-runtime", "--self-check"};
    all.insert(all.end(), args.begin(), args.end());
    std::vector<char*> argv;
    for (auto& a : all) argv.push_back(a.data());
    std::ostringstream o, e;
    DeviceCliEnv env;
    env.isRoot = false;
    const int rc = runSelfCheckCli(static_cast<int>(argv.size()), argv.data(), env, schemas, o, e);
    out = o.str() + e.str();
    return rc;
}

TEST(SelfCheck, IsTheCommand) {
    std::vector<std::string> a = {"mat-runtime", "--self-check", "--config", "x"};
    std::vector<char*> argv;
    for (auto& s : a) argv.push_back(s.data());
    EXPECT_TRUE(isSelfCheckCommand(static_cast<int>(argv.size()), argv.data()));
    std::vector<std::string> b = {"mat-runtime", "--check-data"};
    std::vector<char*> argv2;
    for (auto& s : b) argv2.push_back(s.data());
    EXPECT_FALSE(isSelfCheckCommand(static_cast<int>(argv2.size()), argv2.data()));
}

TEST(SelfCheck, AGoodDeviceAndProjectPassWithoutWritingAnything) {
    Dir d;
    const std::string cfg = d.config(kDemo);
    const std::string before = d.snapshot();
    std::string out, schemas = kSchemas;
    EXPECT_EQ(run({"--config", cfg}, out, schemas), 0) << out;
    EXPECT_EQ(d.snapshot(), before) << "self-check wrote something";
    // --json: one object with the checks
    EXPECT_EQ(run({"--config", cfg, "--json"}, out, schemas), 0) << out;
    const auto j = nlohmann::json::parse(out.substr(0, out.find('\n')), nullptr, false);
    ASSERT_TRUE(j.is_object()) << out;
    EXPECT_EQ(j["result"], "ok");
    bool project = false;
    for (const auto& c : j["checks"])
        if (c["name"] == "project-valid") project = c["status"] == "ok";
    EXPECT_TRUE(project) << out;
}

TEST(SelfCheck, AnInvalidProjectIsRefused) {
    Dir d;
    const fs::path proj = d.root / "proj";
    fs::copy(kDemo, proj, fs::copy_options::recursive);
    std::ofstream(proj / "project.json") << "{\"schemaVersion\": \"9.9.9\"}";
    std::string out, schemas = kSchemas;
    EXPECT_EQ(run({"--config", d.config(proj.string())}, out, schemas), 1) << out;
}

TEST(SelfCheck, SchemasThatCannotReadTheProjectAreRefused) {
    // a new tree without the schemas of the running format: the validator of the new binary fails
    Dir d;
    std::string out, schemas = (d.root / "no-schemas").string();
    fs::create_directories(schemas);
    EXPECT_EQ(run({"--config", d.config(kDemo)}, out, schemas), 1) << out;
}

TEST(SelfCheck, DamagedDataIsRefused) {
    Dir d;
    fs::create_directories(d.root / "data" / "projects");
    std::ofstream(d.root / "data" / "projects" / "state.json") << "{ broken";
    std::string out, schemas = kSchemas;
    EXPECT_EQ(run({"--config", d.config(kDemo)}, out, schemas), 1) << out;
}

TEST(SelfCheck, BadConfigurationIs2) {
    Dir d;
    std::string out, schemas = kSchemas;
    EXPECT_EQ(run({"--config", (d.root / "missing.json").string()}, out, schemas), 2) << out;
    const std::string bad = (d.root / "bad.json").string();
    std::ofstream(bad) << "{\"maxConcurrentLogins\": 99}";
    EXPECT_EQ(run({"--config", bad}, out, schemas), 2) << out;
}

}  // namespace
