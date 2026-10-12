// T047 (feature 005; research R7, ADR-011, task T055): `mat-runtime --auth-bench [--m <KiB>]
// [--t <n>]` (server/cli/auth_bench) times the Argon2id hash of the runtime: median, minimum and
// maximum of kAuthBenchRuns hashes, peak RSS, the parameters, a line for ADR-011. It only
// computes: no file anywhere, and the hash memory goes back after each hash.
#include "server/cli/auth_bench.hpp"

#include <gtest/gtest.h>
#include <unistd.h>

#include <filesystem>
#include <regex>
#include <sstream>
#include <string>
#include <vector>

#include "core/auth/password_hash.hpp"

using namespace mat;

namespace {

struct Outcome {
    int code = -1;
    std::string out;
    std::string err;
};

Outcome run(std::vector<std::string> args) {
    args.insert(args.begin(), "mat-runtime");
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(&a[0]);
    std::ostringstream out, err;
    Outcome r;
    r.code = runAuthBenchCli(static_cast<int>(argv.size()), argv.data(), out, err);
    r.out = out.str();
    r.err = err.str();
    return r;
}

double number(const std::string& text, const std::string& label) {
    const std::regex re(label + " ([0-9]+\\.[0-9]+)");
    std::smatch m;
    if (!std::regex_search(text, m, re)) {
        ADD_FAILURE() << "no '" << label << "' in:\n" << text;
        return -1;
    }
    return std::stod(m[1]);
}

}  // namespace

TEST(AuthBenchCli, PrintsTimesPeakRssAndParameters) {
    const Outcome r = run({"--auth-bench", "--m", "8192", "--t", "1"});
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_NE(r.out.find("Argon2id m=8192 KiB, t=1, p=1"), std::string::npos) << r.out;
    EXPECT_NE(r.out.find(std::to_string(kAuthBenchRuns) + " lần"), std::string::npos) << r.out;
    const double median = number(r.out, "trung vị");
    const double low = number(r.out, "min");
    const double high = number(r.out, "max");
    EXPECT_GT(low, 0);
    EXPECT_LE(low, median);
    EXPECT_LE(median, high);
    EXPECT_NE(r.out.find("RSS"), std::string::npos) << r.out;
    EXPECT_NE(r.out.find("bộ nhớ băm 8192 KiB"), std::string::npos) << r.out;
    // the line for the measurements of ADR-011 (decimal comma, as the ADR writes numbers)
    EXPECT_NE(r.out.find("| Argon2id m = 8192, t = 1, p = 1"), std::string::npos) << r.out;
}

TEST(AuthBenchCli, DefaultsAreTheParametersOfNewHashes) {
    const Outcome r = run({"--auth-bench"});
    ASSERT_EQ(r.code, 0) << r.err;
    const std::string params = "Argon2id m=" + std::to_string(kArgon2Default.mKiB) +
                               " KiB, t=" + std::to_string(kArgon2Default.t) +
                               ", p=" + std::to_string(kArgon2Default.p);
    EXPECT_NE(r.out.find(params), std::string::npos) << r.out;
}

// No file in the working directory, and every mmap of the hash memory has its munmap.
TEST(AuthBenchCli, WritesNothingAndGivesTheMemoryBack) {
    char tmpl[] = "/tmp/mat-bench-XXXXXX";
    ASSERT_NE(::mkdtemp(tmpl), nullptr);
    const std::string dir = tmpl;
    const auto cwd = std::filesystem::current_path();
    std::filesystem::current_path(dir);
    const auto before = detail::argon2MemoryStats();
    const Outcome r = run({"--auth-bench", "--m", "8192", "--t", "1"});
    const auto after = detail::argon2MemoryStats();
    std::filesystem::current_path(cwd);
    EXPECT_EQ(r.code, 0) << r.err;
    EXPECT_TRUE(std::filesystem::is_empty(dir));
    std::filesystem::remove_all(dir);
    EXPECT_EQ(after.maps - before.maps, static_cast<uint64_t>(kAuthBenchRuns + 1));  // + warm-up
    EXPECT_EQ(after.maps - before.maps, after.unmaps - before.unmaps);
    EXPECT_EQ(after.liveBytes, before.liveBytes);
}

TEST(AuthBenchCli, RefusesParametersOutsideTheBounds) {
    for (const auto& args : std::vector<std::vector<std::string>>{{"--auth-bench", "--m", "8191"},
                                                                  {"--auth-bench", "--m", "65537"},
                                                                  {"--auth-bench", "--m", "19456k"},
                                                                  {"--auth-bench", "--m"},
                                                                  {"--auth-bench", "--t", "0"},
                                                                  {"--auth-bench", "--t", "11"},
                                                                  {"--auth-bench", "--t", "-1"},
                                                                  {"--auth-bench", "--p", "2"},
                                                                  {"--auth-bench", "extra"}}) {
        const Outcome r = run(args);
        EXPECT_EQ(r.code, 2) << args[1];
        EXPECT_FALSE(r.err.empty());
        EXPECT_TRUE(r.out.empty());
    }
}
