// T095 (feature 005, specs/005-device-online/contracts/device-config.md §4):
// `mat-runtime --check-package <file> [--schemas-dir <dir>]`. A valid package prints its digest
// alone and exits 0; an invalid one prints the E_PKG_* code with the entry path and exits 1;
// bad arguments exit 2; a file or schema that cannot be read exits 6. Read-only, no network.
#include <gtest/gtest.h>

#include <sstream>

#include "core/package/tests/package_test_support.hpp"
#include "server/cli/package.hpp"

using namespace mat;
using namespace mat::test;

namespace {

struct CliRun {
    int code;
    std::string out;
    std::string err;
};

CliRun run(std::vector<std::string> args, const std::string& defaultSchemas = kSchemasDir) {
    args.insert(args.begin(), "mat-runtime");
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(&a[0]);
    std::ostringstream out, err;
    const int code =
        runCheckPackageCli(static_cast<int>(argv.size()), argv.data(), out, err, defaultSchemas);
    return {code, out.str(), err.str()};
}

std::string vectorFile(const std::string& name) { return vectorNamed(name).file; }

}  // namespace

TEST(CheckPackageCli, ValidPackagePrintsItsDigest) {
    const CliRun r = run({"--check-package", vectorFile("valid-tank-demo-stored")});
    EXPECT_EQ(r.code, 0) << r.out << r.err;
    EXPECT_EQ(r.out,
              vectorNamed("valid-tank-demo-stored").expected["digest"].get<std::string>() + "\n");
    EXPECT_EQ(r.err, "");
    const CliRun d = run({"--check-package", vectorFile("valid-tank-demo-deflate")});
    EXPECT_EQ(d.code, 0);
    EXPECT_EQ(d.out, r.out);  // same project, same digest
}

TEST(CheckPackageCli, InvalidPackagePrintsTheCodeAndPath) {
    const CliRun r = run({"--check-package", vectorFile("path-dotdot")});
    EXPECT_EQ(r.code, 1) << r.out << r.err;
    EXPECT_EQ(r.out.rfind("E_PKG_PATH '../x.json': ", 0), 0u) << r.out;
    EXPECT_EQ(r.out.back(), '\n');
    EXPECT_EQ(std::count(r.out.begin(), r.out.end(), '\n'), 1);
    const CliRun w = run({"--check-package", vectorFile("content-digest")});  // no path
    EXPECT_EQ(w.code, 1);
    EXPECT_EQ(w.out.rfind("E_PKG_DIGEST: ", 0), 0u) << w.out;
    for (const char* v : {"bomb-ratio", "struct-zip64", "secret-pem-svg", "content-identity",
                          "manifest-bom", "type-js"}) {
        const CliRun x = run({"--check-package", vectorFile(v)});
        EXPECT_EQ(x.code, 1) << v;
        EXPECT_EQ(x.out.rfind(vectorNamed(v).expected["code"].get<std::string>(), 0), 0u)
            << v << ": " << x.out;
    }
}

TEST(CheckPackageCli, GeneratedPackages) {
    const std::string tooLarge = vectorFile("size-too-large");
    ASSERT_TRUE(exists(tooLarge)) << "run `" << kGenerateCommand << "` first";
    const CliRun r = run({"--check-package", tooLarge});
    EXPECT_EQ(r.code, 1);
    EXPECT_EQ(r.out.rfind("E_PKG_TOO_LARGE: ", 0), 0u) << r.out;
    const CliRun ok = run({"--check-package", vectorFile("valid-entries-1024")});
    EXPECT_EQ(ok.code, 0) << ok.out;
}

TEST(CheckPackageCli, ControlCharactersOfThePathAreEscaped) {
    TempDir tmp;
    PackOptions o;
    o.entries = [](std::vector<ZEntry>& l) {
        insertSorted(l, storedEntry("a\x1b[31mred\x07.json", "{}"));
    };
    writeFile(tmp / "p.matscada", pack(baseProject(), o));
    const CliRun r = run({"--check-package", tmp / "p.matscada"});
    EXPECT_EQ(r.code, 1);
    EXPECT_EQ(r.out.find('\x1b'), std::string::npos) << r.out;
    EXPECT_EQ(r.out.find('\x07'), std::string::npos) << r.out;
    EXPECT_NE(r.out.find("a\\x1b[31mred\\x07.json"), std::string::npos) << r.out;
}

TEST(CheckPackageCli, SchemasDirOption) {
    const std::string file = vectorFile("valid-tank-demo-stored");
    EXPECT_EQ(run({"--check-package", file, "--schemas-dir", kSchemasDir}, "/nonexistent").code, 0);
    EXPECT_EQ(run({"--schemas-dir", kSchemasDir, "--check-package", file}, "/nonexistent").code, 0);
    const CliRun missing = run({"--check-package", file}, "/nonexistent");
    EXPECT_EQ(missing.code, 6);
    EXPECT_NE(missing.err, "");
    EXPECT_EQ(missing.out, "");
}

TEST(CheckPackageCli, BadArgumentsAndUnreadableFiles) {
    EXPECT_EQ(run({"--check-package"}).code, 2);
    EXPECT_EQ(run({"--check-package", "a", "b"}).code, 2);
    EXPECT_EQ(run({"--check-package", "a", "--unknown"}).code, 2);
    EXPECT_EQ(run({"--check-package", "a", "--schemas-dir"}).code, 2);
    const CliRun missing = run({"--check-package", "/nonexistent/p.matscada"});
    EXPECT_EQ(missing.code, 6);
    EXPECT_NE(missing.err.find("/nonexistent/p.matscada"), std::string::npos) << missing.err;
    TempDir tmp;
    EXPECT_EQ(run({"--check-package", tmp.path()}).code, 6);  // a directory
}
