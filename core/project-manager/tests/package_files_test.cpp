// Extra files of a project (feature 011 T022, T023; contract project-format-1.0 §6, research R9):
// the shared vectors of tests/package-vectors whose expected.json says `"stage": "project"` are
// valid packages; once extracted and validated, their file set differs from the files the project
// references (LoadedProject::files()) and projectExtraFiles() names every extra file, sorted by
// UTF-8 bytes. The digest of a project directory and of its package are then computed on the same
// set: a valid package gives the same digest both ways (no HEALTH_TIMEOUT after a deploy).
#include <gtest/gtest.h>
#include <sys/stat.h>

#include "core/package/extract.hpp"
#include "core/package/package_check.hpp"
#include "core/package/project_digest.hpp"
#include "core/package/tests/package_test_support.hpp"
#include "core/project-manager/project_validator.hpp"

using namespace mat;
using namespace mat::test;

namespace {

std::vector<std::string> projectStageVectors() {
    std::vector<std::string> out;
    for (const auto& n : vectorDirNames())
        if (vectorNamed(n).expected.value("stage", "") == "project") out.push_back(n);
    return out;
}

// Extracts the vector's package into `dir` (a valid package by definition).
void extractVector(const Vector& v, const std::string& dir) {
    ASSERT_TRUE(exists(v.file)) << v.file << " is missing: run `" << kGenerateCommand << "`";
    std::string error;
    auto src = FileSource::open(v.file, error);
    ASSERT_NE(src, nullptr) << error;
    const PackageCheck r = extractPackage(*src, schema(), dir);
    ASSERT_TRUE(r.ok) << describe(r);
}

}  // namespace

class ProjectStageVector : public ::testing::TestWithParam<std::string> {};

TEST_P(ProjectStageVector, ExtraFilesAreNamedAfterValidation) {
    const Vector v = vectorNamed(GetParam());
    TempDir tmp;
    const std::string dir = tmp / "project";
    extractVector(v, dir);
    if (HasFatalFailure()) return;
    const ProjectValidation val = validateProject(dir, kSchemasDir);
    ASSERT_TRUE(val.valid) << resultJson(val);
    std::string error;
    const auto extra = projectExtraFiles(dir, val.project->files(), &error);
    ASSERT_TRUE(extra.has_value()) << error;
    EXPECT_EQ(nlohmann::json(*extra), v.expected["extra"]);
    ASSERT_FALSE(extra->empty());
    EXPECT_EQ(extra->front(), v.expected["path"].get<std::string>());
    EXPECT_EQ(v.expected["code"], "E_PACKAGE_EXTRA_FILE");
}

INSTANTIATE_TEST_SUITE_P(Vectors, ProjectStageVector, ::testing::ValuesIn(projectStageVectors()),
                         paramName);

TEST(ProjectExtraFiles, AtLeastSevenProjectStageVectors) {
    EXPECT_GE(projectStageVectors().size(), 7u);
}

// A valid package has no extra file, and the digest of its extracted directory over the project's
// files is the package digest.
TEST(ProjectExtraFiles, ValidPackagesHaveNoneAndTheSameDigest) {
    for (const char* name : {"valid-tank-demo-deflate", "valid-tank-demo-stored",
                             "valid-vietnamese-names", "valid-manifest-extensions"}) {
        const Vector v = vectorNamed(name);
        TempDir tmp;
        const std::string dir = tmp / "project";
        extractVector(v, dir);
        if (HasFatalFailure()) return;
        const ProjectValidation val = validateProject(dir, kSchemasDir);
        ASSERT_TRUE(val.valid) << name << " " << resultJson(val);
        const auto files = val.project->files();
        const auto extra = projectExtraFiles(dir, files);
        ASSERT_TRUE(extra.has_value()) << name;
        EXPECT_TRUE(extra->empty()) << name << ": " << nlohmann::json(*extra).dump();
        EXPECT_EQ(projectDirDigest(dir, files).value_or(""), v.expected["digest"]) << name;
    }
}

// On disk (a directory, not a package): an empty directory, a symlink and a nested excluded
// directory are extra too; directories end with '/'.
TEST(ProjectExtraFiles, EmptyDirectoriesAndLinksOnDisk) {
    const Vector v = vectorNamed("valid-tank-demo-stored");
    TempDir tmp;
    const std::string dir = tmp / "project";
    extractVector(v, dir);
    if (HasFatalFailure()) return;
    ASSERT_EQ(::mkdir((dir + "/empty").c_str(), 0700), 0);
    ASSERT_EQ(::mkdir((dir + "/.mat-editor").c_str(), 0700), 0);
    writeFile(dir + "/.mat-editor/state.json", "{}");
    ASSERT_EQ(::symlink("project.json", (dir + "/link.json").c_str()), 0);
    const ProjectValidation val = validateProject(dir, kSchemasDir);
    ASSERT_TRUE(val.valid) << resultJson(val);
    const auto extra = projectExtraFiles(dir, val.project->files());
    ASSERT_TRUE(extra.has_value());
    EXPECT_EQ(*extra, (std::vector<std::string>{".mat-editor/state.json", "empty/", "link.json"}));
}

TEST(ProjectExtraFiles, UnreadableDirectoryIsAnError) {
    std::string error;
    EXPECT_FALSE(projectExtraFiles("/nonexistent/mat-project", {"project.json"}, &error));
    EXPECT_FALSE(error.empty());
}
