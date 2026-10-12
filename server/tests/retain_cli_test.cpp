// T176 (feature 006, US4; contracts/device-config.md §4; FR-018): `mat-runtime --retain-dump`
// prints what the store of the retained Tags holds: the values, the generation, the file in use and
// the state (ok | fallback | lost). Read only: not a byte of the directory changes, not even when
// the store is damaged (the runtime renames a damaged file, this command never does). Exit codes as
// the other device commands: 0 ok (also: nothing stored yet), 1 the store is lost, 2 bad arguments
// or configuration.
#include <gtest/gtest.h>
#include <sys/stat.h>

#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>

#include "core/tag-engine/retain_store.hpp"
#include "nlohmann/json.hpp"
#include "server/cli/retain.hpp"

namespace fs = std::filesystem;
using namespace mat;
using nlohmann::json;

namespace {

struct Dir {
    fs::path root;
    Dir() {
        char tmpl[] = "/tmp/mat-retaincli-XXXXXX";
        root = ::mkdtemp(tmpl);
    }
    ~Dir() {
        std::error_code ec;
        fs::remove_all(root, ec);
    }
    std::string retain() const { return (root / "retain").string(); }
    // What is in a directory, with sizes and a hash of the content: a read-only command keeps it.
    std::string snapshot() const {
        std::ostringstream s;
        std::error_code ec;
        for (const auto& e : fs::recursive_directory_iterator(root, ec)) {
            s << e.path().string();
            if (e.is_regular_file()) {
                std::ifstream f(e.path(), std::ios::binary);
                std::string body((std::istreambuf_iterator<char>(f)),
                                 std::istreambuf_iterator<char>());
                size_t h = std::hash<std::string>{}(body);
                s << " " << body.size() << " " << h;
            }
            s << "\n";
        }
        return s.str();
    }
};

// A store with a few values saved, as the runtime would leave it.
void makeStore(const std::string& dir, int saves = 1) {
    PosixRetainIo io(dir);
    RetainStore store(io, 0);
    store.open();
    for (int i = 0; i < saves; ++i) {
        store.set("A.SET", TagType::FLOAT32, 85.5 + i);
        store.set("B.NAME", TagType::STRING, std::string("Bơm số ") + std::to_string(i));
        store.set("C.FLAG", TagType::BOOL, true);
        store.set("D.BIG", TagType::INT64, int64_t{-9007199254740993LL});
        store.set("E.COUNT", TagType::UINT16, uint64_t{7});
        store.flushNow(1000 + i);
    }
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
        runRetainCli(static_cast<int>(argv.size()), argv.data(), DeviceCliEnv{}, out, err);
    return {code, out.str(), err.str()};
}

bool is(std::vector<std::string> args) {
    args.insert(args.begin(), "mat-runtime");
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(&a[0]);
    return isRetainCommand(static_cast<int>(argv.size()), argv.data());
}

const json* tagOf(const json& j, const std::string& id) {
    for (const json& t : j["tags"])
        if (t["id"] == id) return &t;
    return nullptr;
}

void corrupt(const std::string& file, size_t offset = 10) {
    std::fstream f(file, std::ios::in | std::ios::out | std::ios::binary);
    f.seekp(static_cast<std::streamoff>(offset));
    const char junk[8] = {'\x5A', '\x5A', '\x5A', '\x5A', '\x5A', '\x5A', '\x5A', '\x5A'};
    f.write(junk, sizeof junk);
}

}  // namespace

TEST(RetainCli, RecognisesItsFlag) {
    EXPECT_TRUE(is({"--retain-dump"}));
    EXPECT_TRUE(is({"--retain-dump", "--retain-dir", "/x"}));
    EXPECT_FALSE(is({"--list-serial"}));
    EXPECT_FALSE(is({}));
}

TEST(RetainCli, PrintsTheValuesTheGenerationTheFileAndTheState) {
    Dir d;
    makeStore(d.retain());
    const CliRun r = run({"--retain-dump", "--retain-dir", d.retain()});
    ASSERT_EQ(r.code, 0) << r.err;
    const json j = json::parse(r.out, nullptr, false);
    ASSERT_TRUE(j.is_object()) << r.out;
    EXPECT_EQ(j["state"], "ok");
    EXPECT_TRUE(j["file"] == "retain-a.bin" || j["file"] == "retain-b.bin");
    EXPECT_GE(j["generation"].get<uint64_t>(), 1u);
    EXPECT_EQ(j["entries"], 5);
    ASSERT_EQ(j["tags"].size(), 5u);
    EXPECT_EQ((*tagOf(j, "A.SET"))["type"], "FLOAT32");
    EXPECT_DOUBLE_EQ((*tagOf(j, "A.SET"))["value"].get<double>(), 85.5);
    EXPECT_EQ((*tagOf(j, "B.NAME"))["value"], "Bơm số 0");
    EXPECT_EQ((*tagOf(j, "C.FLAG"))["value"], true);
    EXPECT_EQ((*tagOf(j, "E.COUNT"))["value"], 7);
    // 64-bit integers go out as text, as in the live protocol (a number would lose digits)
    EXPECT_EQ((*tagOf(j, "D.BIG"))["type"], "INT64");
    EXPECT_EQ((*tagOf(j, "D.BIG"))["value"], "-9007199254740993");
}

TEST(RetainCli, TheLastSavedValuesAreTheOnesShown) {
    Dir d;
    makeStore(d.retain(), 4);  // four saves: the values of the last
    const json j = json::parse(run({"--retain-dump", "--retain-dir", d.retain()}).out);
    EXPECT_DOUBLE_EQ((*tagOf(j, "A.SET"))["value"].get<double>(), 88.5);
    EXPECT_EQ((*tagOf(j, "B.NAME"))["value"], "Bơm số 3");
}

TEST(RetainCli, ReadsOnlyEvenWhenTheStoreIsDamaged) {
    Dir d;
    makeStore(d.retain());
    const std::string before = d.snapshot();
    EXPECT_EQ(run({"--retain-dump", "--retain-dir", d.retain()}).code, 0);
    EXPECT_EQ(d.snapshot(), before) << "a healthy store is not touched";

    // both files damaged: lost, exit 1, and nothing renamed or made (the runtime does that)
    corrupt(d.retain() + "/retain-a.bin", 0);
    corrupt(d.retain() + "/retain-b.bin", 0);
    corrupt(d.retain() + "/retain-a.bin", 80);
    const std::string damaged = d.snapshot();
    const CliRun r = run({"--retain-dump", "--retain-dir", d.retain()});
    EXPECT_EQ(r.code, 1) << r.out << r.err;
    const json j = json::parse(r.out, nullptr, false);
    ASSERT_TRUE(j.is_object()) << r.out;
    EXPECT_EQ(j["state"], "lost");
    EXPECT_EQ(j["tags"].size(), 0u);
    EXPECT_EQ(d.snapshot(), damaged) << "no .corrupt file, no new file";
}

TEST(RetainCli, AnOlderFileInUseIsFallbackAndStillExit0) {
    Dir d;
    // enough saves that the first file is full and the second holds the newest generation; then the
    // newest header is damaged: the older file gives the values
    makeStore(d.retain());
    {
        PosixRetainIo io(d.retain());
        RetainStore s(io, 0);
        s.open();
        // fill the file with records until the store moves to the other one
        for (int i = 0; i < 3000 && s.diag().compactions == 0; ++i) {
            s.set("A.SET", TagType::FLOAT32, 1.0 + i);
            s.set("B.NAME", TagType::STRING, std::string(200, 'x') + std::to_string(i));
            s.flushNow(2000 + i);
        }
        ASSERT_GE(s.diag().compactions, 1u);
    }
    // damage the header of the file in use now
    const json before = json::parse(run({"--retain-dump", "--retain-dir", d.retain()}).out);
    const std::string current = before["file"];
    corrupt(d.retain() + "/" + current, 0);
    const CliRun r = run({"--retain-dump", "--retain-dir", d.retain()});
    EXPECT_EQ(r.code, 0) << r.out << r.err;
    const json j = json::parse(r.out, nullptr, false);
    ASSERT_TRUE(j.is_object()) << r.out;
    EXPECT_EQ(j["state"], "fallback");
    EXPECT_NE(j["file"], current);
    EXPECT_GE(j["tags"].size(), 1u);
}

TEST(RetainCli, NothingStoredYetIsAnEmptyListAndNoDirectoryIsMade) {
    Dir d;
    const CliRun r = run({"--retain-dump", "--retain-dir", d.retain()});
    EXPECT_EQ(r.code, 0) << r.err;
    const json j = json::parse(r.out, nullptr, false);
    ASSERT_TRUE(j.is_object()) << r.out;
    EXPECT_EQ(j["state"], "fresh");
    EXPECT_EQ(j["tags"], json::array());
    EXPECT_FALSE(fs::exists(d.retain()));
}

TEST(RetainCli, TheDirectoryComesFromTheConfiguration) {
    Dir d;
    makeStore(d.retain());
    const std::string cfg = (d.root / "runtime.json").string();
    std::ofstream(cfg) << json{{"retainDir", d.retain()}}.dump();
    const CliRun r = run({"--retain-dump", "--config", cfg});
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_EQ(json::parse(r.out)["entries"], 5);
    // the data directory gives <dataDir>/retain
    const std::string cfg2 = (d.root / "runtime2.json").string();
    std::ofstream(cfg2) << json{{"dataDir", d.root.string()}}.dump();
    EXPECT_EQ(json::parse(run({"--retain-dump", "--config", cfg2}).out)["entries"], 5);
    EXPECT_EQ(json::parse(run({"--retain-dump", "--data-dir", d.root.string()}).out)["entries"], 5);
}

TEST(RetainCli, BadArgumentsAndBadConfigurationAreExit2) {
    Dir d;
    EXPECT_EQ(run({"--retain-dump", "--bogus"}).code, 2);
    EXPECT_EQ(run({"--retain-dump", "--retain-dir"}).code, 2);
    EXPECT_EQ(run({"--retain-dump", "--config"}).code, 2);
    const std::string cfg = (d.root / "bad.json").string();
    std::ofstream(cfg) << R"({"retainWindowS": 0})";
    const CliRun r = run({"--retain-dump", "--config", cfg});
    EXPECT_EQ(r.code, 2);
    EXPECT_FALSE(r.err.empty());
}
