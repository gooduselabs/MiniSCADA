// T091 (feature 005, specs/005-device-online/contracts/matscada-package.md §7, §8a): the device's
// stored writer. Deterministic bytes (DOS time 0x0000, date 0x0021, flags bit 11, version made by
// 20, attributes 0, no extra field, comment or data descriptor), manifest first and files sorted
// by path bytes, two writes give the same bytes, the reader reads it back, generator
// "mat-runtime 0.4.0". T094: the golden vector tests/package-vectors/valid-device-tank-demo/ is
// projects/tank-demo packed by this writer; packing again gives the same bytes. After a change of
// the writer or of projects/tank-demo, regenerate it with MAT_WRITE_GOLDEN=1 (the test then
// writes package.matscada and expected.json instead of comparing).
#include "core/package/zip_writer.hpp"

#include <fcntl.h>
#include <gtest/gtest.h>
#include <unistd.h>

#include <iostream>

#include "core/package/package_check.hpp"
#include "core/package/tests/package_test_support.hpp"
#include "core/project-manager/project_validator.hpp"

using namespace mat;
using namespace mat::test;

namespace {

const std::string kGoldenDir = kVectorDir + "/valid-device-tank-demo";
const std::string kCreatedAt = "2026-10-11T00:00:00Z";

std::vector<PackageInput> inputs(const Files& files) {
    std::vector<PackageInput> out;
    for (const auto& [path, content] : files) out.push_back(memoryInput(path, content));
    return out;
}

PackageWriteOptions options() {
    PackageWriteOptions o;
    o.createdAt = kCreatedAt;
    return o;
}

PackageWriteResult write(const Files& files, std::string& bytes,
                         PackageWriteOptions o = options()) {
    StringSink sink;
    const PackageWriteResult r = writeStoredPackage(inputs(files), o, sink);
    bytes = sink.bytes;
    return r;
}

// A minimal reader of the bytes, independent of the code under test.
struct Raw {
    struct Entry {
        uint16_t madeBy, versionNeeded, flags, method, time, date, nameLen, extraLen, commentLen,
            disk, internalAttrs;
        uint32_t crc, csize, usize, externalAttrs, offset;
        std::string name;
        // local header
        uint16_t lVersion, lFlags, lMethod, lTime, lDate, lNameLen, lExtraLen;
        uint32_t lCrc, lCsize, lUsize;
        std::string lName, data;
    };
    std::vector<Entry> entries;
    uint16_t count = 0;
    uint32_t cdSize = 0, cdOffset = 0;
    uint16_t commentLen = 0;
};

Raw parseRaw(const std::string& z) {
    Raw r;
    const size_t eocd = z.size() - 22;
    EXPECT_EQ(le32(z, eocd), kSigEocd);
    r.count = le16(z, eocd + 10);
    EXPECT_EQ(le16(z, eocd + 8), r.count);
    EXPECT_EQ(le16(z, eocd + 4), 0);
    EXPECT_EQ(le16(z, eocd + 6), 0);
    r.cdSize = le32(z, eocd + 12);
    r.cdOffset = le32(z, eocd + 16);
    r.commentLen = le16(z, eocd + 20);
    size_t p = r.cdOffset;
    for (int i = 0; i < r.count; ++i) {
        Raw::Entry e{};
        EXPECT_EQ(le32(z, p), kSigCentral);
        e.madeBy = le16(z, p + 4);
        e.versionNeeded = le16(z, p + 6);
        e.flags = le16(z, p + 8);
        e.method = le16(z, p + 10);
        e.time = le16(z, p + 12);
        e.date = le16(z, p + 14);
        e.crc = le32(z, p + 16);
        e.csize = le32(z, p + 20);
        e.usize = le32(z, p + 24);
        e.nameLen = le16(z, p + 28);
        e.extraLen = le16(z, p + 30);
        e.commentLen = le16(z, p + 32);
        e.disk = le16(z, p + 34);
        e.internalAttrs = le16(z, p + 36);
        e.externalAttrs = le32(z, p + 38);
        e.offset = le32(z, p + 42);
        e.name = z.substr(p + 46, e.nameLen);
        p += 46 + e.nameLen + e.extraLen + e.commentLen;
        const size_t l = e.offset;
        EXPECT_EQ(le32(z, l), kSigLocal);
        e.lVersion = le16(z, l + 4);
        e.lFlags = le16(z, l + 6);
        e.lMethod = le16(z, l + 8);
        e.lTime = le16(z, l + 10);
        e.lDate = le16(z, l + 12);
        e.lCrc = le32(z, l + 14);
        e.lCsize = le32(z, l + 18);
        e.lUsize = le32(z, l + 22);
        e.lNameLen = le16(z, l + 26);
        e.lExtraLen = le16(z, l + 28);
        e.lName = z.substr(l + 30, e.lNameLen);
        e.data = z.substr(l + 30 + e.lNameLen + e.lExtraLen, e.csize);
        r.entries.push_back(e);
    }
    EXPECT_EQ(p, eocd);
    return r;
}

Files tankDemo() {
    const std::string dir = kSourceDir + "/projects/tank-demo";
    const ProjectValidation v = validateProject(dir, kSchemasDir);
    if (!v.valid) throw std::runtime_error("projects/tank-demo is not valid");
    Files f;
    for (const auto& rel : v.project->files()) f[rel] = readFile(dir + "/" + rel);
    return f;
}

std::vector<PackageInput> tankDemoInputs() {
    const std::string dir = kSourceDir + "/projects/tank-demo";
    std::vector<PackageInput> out;
    for (const auto& [rel, content] : tankDemo()) out.push_back(fileInput(rel, dir + "/" + rel));
    return out;
}

}  // namespace

TEST(ZipWriter, StoredDeterministicLayout) {
    Files f = baseProject();
    f["Z.json"] = "{}\n";
    f["màn hình/Tổng quan.svg"] = kSvg;
    std::string z;
    const PackageWriteResult w = write(f, z);
    ASSERT_TRUE(w.ok) << w.error.code << " " << w.error.message;
    EXPECT_EQ(w.bytes, z.size());
    const Raw raw = parseRaw(z);
    ASSERT_EQ(raw.count, f.size() + 1);
    EXPECT_EQ(raw.commentLen, 0);
    EXPECT_EQ(raw.cdOffset + raw.cdSize, z.size() - 22);
    std::vector<std::string> names;
    size_t expectOffset = 0;
    for (const auto& e : raw.entries) {
        names.push_back(e.name);
        EXPECT_EQ(e.method, 0) << e.name;
        EXPECT_EQ(e.flags, 0x0800) << e.name;
        EXPECT_EQ(e.versionNeeded, 20) << e.name;
        EXPECT_EQ(e.madeBy, 20) << e.name;
        EXPECT_EQ(e.time, 0x0000) << e.name;
        EXPECT_EQ(e.date, 0x0021) << e.name;
        EXPECT_EQ(e.extraLen, 0) << e.name;
        EXPECT_EQ(e.commentLen, 0) << e.name;
        EXPECT_EQ(e.disk, 0) << e.name;
        EXPECT_EQ(e.internalAttrs, 0) << e.name;
        EXPECT_EQ(e.externalAttrs, 0u) << e.name;
        EXPECT_EQ(e.csize, e.usize) << e.name;
        EXPECT_EQ(e.crc, crc32(e.data)) << e.name;
        // local header = central
        EXPECT_EQ(e.offset, expectOffset) << e.name;
        EXPECT_EQ(e.lVersion, 20);
        EXPECT_EQ(e.lFlags, 0x0800);
        EXPECT_EQ(e.lMethod, 0);
        EXPECT_EQ(e.lTime, 0x0000);
        EXPECT_EQ(e.lDate, 0x0021);
        EXPECT_EQ(e.lCrc, e.crc);
        EXPECT_EQ(e.lCsize, e.csize);
        EXPECT_EQ(e.lUsize, e.usize);
        EXPECT_EQ(e.lExtraLen, 0);
        EXPECT_EQ(e.lName, e.name);
        expectOffset = e.offset + 30 + e.nameLen + e.csize;  // no data descriptor
    }
    EXPECT_EQ(expectOffset, raw.cdOffset);
    std::vector<std::string> want{"matscada.json"};
    for (const auto& [path, content] : f) want.push_back(path);  // std::map: byte order
    EXPECT_EQ(names, want);
    for (size_t i = 1; i < raw.entries.size(); ++i)
        EXPECT_EQ(raw.entries[i].data, f.at(raw.entries[i].name));
}

TEST(ZipWriter, SameInputSameBytes) {
    std::string a, b;
    ASSERT_TRUE(write(baseProject(), a).ok);
    // Inputs in another order give the same package.
    StringSink sink;
    std::vector<PackageInput> in = inputs(baseProject());
    std::reverse(in.begin(), in.end());
    ASSERT_TRUE(writeStoredPackage(std::move(in), options(), sink).ok);
    b = sink.bytes;
    EXPECT_EQ(a, b);
    EXPECT_FALSE(a.empty());
}

TEST(ZipWriter, ReaderReadsItBack) {
    std::string z;
    const PackageWriteResult w = write(baseProject(), z);
    ASSERT_TRUE(w.ok);
    MemorySource src(z);
    const PackageCheck r = checkPackage(src, schema());
    ASSERT_TRUE(r.ok) << describe(r);
    EXPECT_EQ(r.manifest.digest, w.digest);
    EXPECT_EQ(w.digest, digestOfFiles(manifestFor(baseProject())["files"]));
    EXPECT_EQ(r.manifest.generatorName, "mat-runtime");
    EXPECT_EQ(r.manifest.generatorVersion, "0.4.0");
    EXPECT_EQ(r.manifest.generatorVersion, kRuntimeVersion);
    EXPECT_EQ(r.manifest.createdAt, kCreatedAt);
    EXPECT_EQ(r.manifest.formatVersion, "1.0.0");
    EXPECT_EQ(r.manifest.projectId, "vector");
    EXPECT_EQ(r.manifest.minRuntimeVersion, "0.3.0");
}

TEST(ZipWriter, ManifestTextHasAFixedForm) {
    std::string z;
    ASSERT_TRUE(write(baseProject(), z).ok);
    const Raw raw = parseRaw(z);
    const std::string& m = raw.entries[0].data;
    const ojson want = [] {
        ojson x = manifestFor(baseProject());
        x["generator"] = {{"name", "mat-runtime"}, {"version", "0.4.0"}};
        return x;
    }();
    EXPECT_EQ(m, jsonText(want));  // keys in the order of contract §3, two-space indent, "\n"
}

TEST(ZipWriter, GeneratorAndTimeAreOptions) {
    PackageWriteOptions o = options();
    o.generatorName = "mat-runtime-test";
    o.generatorVersion = "9.9.9";
    o.createdAt = "2027-01-01T00:00:00Z";
    std::string a, b;
    ASSERT_TRUE(write(baseProject(), a).ok);
    const PackageWriteResult w = write(baseProject(), b, o);
    ASSERT_TRUE(w.ok);
    EXPECT_NE(a, b);  // other bytes …
    MemorySource src(b);
    const PackageCheck r = checkPackage(src, schema());
    ASSERT_TRUE(r.ok);
    EXPECT_EQ(r.manifest.generatorName, "mat-runtime-test");
    EXPECT_EQ(r.manifest.generatorVersion, "9.9.9");
    EXPECT_EQ(r.manifest.digest,
              digestOfFiles(manifestFor(baseProject())["files"]));  // … same digest
}

TEST(ZipWriter, RefusesWhatTheReaderWouldRefuse) {
    auto codeOf = [](Files f) {
        std::string z;
        const PackageWriteResult w = write(f, z);
        EXPECT_FALSE(w.ok);
        return w.error.code + " " + w.error.path;
    };
    auto with = [](const std::string& path, const std::string& content) {
        Files f = baseProject();
        f[path] = content;
        return f;
    };
    EXPECT_EQ(codeOf(with("../x.json", "{}")), "E_PKG_PATH ../x.json");
    EXPECT_EQ(codeOf(with("CON.json", "{}")), "E_PKG_PATH CON.json");
    EXPECT_EQ(codeOf(with("a.js", "x")), "E_PKG_TYPE a.js");
    EXPECT_EQ(codeOf(with("matscada.json", "{}")), "E_PKG_PATH matscada.json");
    Files dup = with("A.json", "{}");
    dup["a.json"] = "{}";
    EXPECT_EQ(codeOf(dup), "E_PKG_PATH a.json");
    EXPECT_EQ(codeOf(with("big.json", std::string(kPackageMaxJsonBytes + 1, ' '))),
              "E_PKG_SIZE big.json");
    const std::string pw = std::string("pass") + "word";
    EXPECT_EQ(codeOf(with("x.json", "{\"" + pw + "\":\"x\"}")), "E_PKG_SECRET x.json");
    Files noProject = baseProject();
    noProject.erase("project.json");
    EXPECT_EQ(codeOf(noProject), "E_PKG_IDENTITY project.json");
    Files badProject = baseProject();
    badProject["project.json"] = "{\"projectId\": 1}";
    EXPECT_EQ(codeOf(badProject), "E_PKG_IDENTITY project.json");
    Files many = baseProject();
    for (int i = 0; many.size() < 1024; ++i)
        many["d/" + std::to_string(10000 + i) + ".json"] = "{}";
    EXPECT_EQ(codeOf(many), "E_PKG_ENTRIES ");
    StringSink none;
    EXPECT_EQ(writeStoredPackage({}, options(), none).error.code, "E_PKG_ENTRIES");
    // 11 SVG files of 5 MiB: each one is allowed, the package would pass 50 MiB. The bytes are
    // made when read, one file at a time.
    std::vector<PackageInput> big = inputs(baseProject());
    for (int i = 0; i < 11; ++i)
        big.push_back(
            {"screens/big-" + std::to_string(i) + ".svg", [](std::string& b, std::string&) {
                 b.assign(kPackageMaxSvgBytes, ' ');
                 return true;
             }});
    StringSink bigSink;
    const PackageWriteResult tooLarge = writeStoredPackage(std::move(big), options(), bigSink);
    EXPECT_EQ(tooLarge.error.code, "E_PKG_TOO_LARGE");
    EXPECT_TRUE(bigSink.bytes.empty());  // refused before writing anything
}

TEST(ZipWriter, InputAndSinkFailures) {
    StringSink sink;
    std::vector<PackageInput> in = inputs(baseProject());
    in.push_back({"broken.json", [](std::string&, std::string& e) {
                      e = "gone";
                      return false;
                  }});
    PackageWriteResult r = writeStoredPackage(std::move(in), options(), sink);
    EXPECT_EQ(r.error.code, "STORE_IO");
    EXPECT_EQ(r.error.path, "broken.json");
    // A file that changes between the two reads.
    int calls = 0;
    std::vector<PackageInput> changing = inputs(baseProject());
    changing.push_back({"changing.json", [&](std::string& b, std::string&) {
                            b = ++calls == 1 ? "{}" : "[]";
                            return true;
                        }});
    StringSink s2;
    r = writeStoredPackage(std::move(changing), options(), s2);
    EXPECT_EQ(r.error.code, "STORE_IO");
    EXPECT_EQ(r.error.path, "changing.json");
    // The sink fails.
    struct FailingSink : PackageSink {
        bool write(const void*, size_t) override { return false; }
    } failing;
    r = writeStoredPackage(inputs(baseProject()), options(), failing);
    EXPECT_EQ(r.error.code, "STORE_IO");
}

TEST(ZipWriter, FileInputAndFdSink) {
    TempDir tmp;
    writeFile(tmp / "tags.json", jsonText(tagsJson()));
    std::string bytes, error;
    ASSERT_TRUE(fileInput("tags.json", tmp / "tags.json").read(bytes, error)) << error;
    EXPECT_EQ(bytes, jsonText(tagsJson()));
    EXPECT_FALSE(fileInput("x.json", tmp / "missing.json").read(bytes, error));
    EXPECT_FALSE(error.empty());
    // A file above 5 MiB is not loaded whole: the size rule refuses it.
    writeFile(tmp / "huge.svg", std::string(kPackageMaxSvgBytes + 4096, ' '));
    ASSERT_TRUE(fileInput("huge.svg", tmp / "huge.svg").read(bytes, error));
    EXPECT_EQ(bytes.size(), kPackageMaxSvgBytes + 1);
    // Package straight into a file.
    const std::string out = tmp / "p.matscada";
    const int fd = ::open(out.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
    ASSERT_GE(fd, 0);
    FdSink sink(fd);
    const PackageWriteResult w = writeStoredPackage(inputs(baseProject()), options(), sink);
    ::close(fd);
    ASSERT_TRUE(w.ok);
    std::string z;
    ASSERT_TRUE(write(baseProject(), z).ok);
    EXPECT_EQ(readFile(out), z);
}

// ---- T094: golden vector of the device writer

TEST(GoldenDeviceTankDemo, PackingTankDemoGivesTheCommittedBytes) {
    StringSink sink;
    PackageWriteOptions o;
    o.createdAt = kCreatedAt;
    o.generatorName = "mat-runtime";
    o.generatorVersion = "0.4.0";  // fixed: a runtime release must not change the golden bytes
    const PackageWriteResult w = writeStoredPackage(tankDemoInputs(), o, sink);
    ASSERT_TRUE(w.ok) << w.error.code << " " << w.error.path << " " << w.error.message;
    MemorySource src(sink.bytes);
    const PackageCheck r = checkPackage(src, schema());
    ASSERT_TRUE(r.ok) << describe(r);
    // Same key order as the vectors of generate.mjs.
    ojson files = ojson::array();
    for (const auto& f : r.manifest.files)
        files.push_back({{"path", f.path}, {"size", f.size}, {"sha256", f.sha256}});
    const ojson expected = {{"ok", true}, {"digest", w.digest}, {"files", files}};
    if (std::getenv("MAT_WRITE_GOLDEN")) {
        ::mkdir(kGoldenDir.c_str(), 0755);
        writeFile(kGoldenDir + "/package.matscada", sink.bytes);
        writeFile(kGoldenDir + "/expected.json", expected.dump(2) + "\n");
        std::cout << "golden vector written to " << kGoldenDir << "\n";
    }
    ASSERT_TRUE(exists(kGoldenDir + "/package.matscada"))
        << "missing golden vector: run this test with MAT_WRITE_GOLDEN=1";
    EXPECT_TRUE(readFile(kGoldenDir + "/package.matscada") == sink.bytes)
        << "projects/tank-demo or the writer changed: regenerate with MAT_WRITE_GOLDEN=1";
    EXPECT_EQ(readFile(kGoldenDir + "/expected.json"), expected.dump(2) + "\n");
}

TEST(GoldenDeviceTankDemo, SameDigestAsTheStudioAndStoredVectors) {
    const auto golden = vectorNamed("valid-device-tank-demo").expected;
    EXPECT_EQ(golden["digest"], vectorNamed("valid-tank-demo-stored").expected["digest"]);
    EXPECT_EQ(golden["digest"], vectorNamed("valid-tank-demo-deflate").expected["digest"]);
    const auto project = nlohmann::json::parse(
        readFile(kSourceDir + "/tests/project-vectors/valid-tank-demo/expected.json"));
    EXPECT_EQ(golden["digest"], project["digest"]);
}
