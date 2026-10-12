// T088 (feature 005, specs/005-device-online/contracts/matscada-package.md §2, §6, §8a): the
// reader on every shared vector of tests/package-vectors (generated ones included: run
// `node tests/package-vectors/generate.mjs --out` first, a missing file fails), then the ZIP
// subset rule by rule, decompression that counts real bytes, the limits of §6, and "first error
// wins: nothing is decompressed after it".
#include <gtest/gtest.h>

#include <chrono>
#include <cstring>

#include "core/package/package_check.hpp"
#include "core/package/tests/package_test_support.hpp"

using namespace mat;
using namespace mat::test;

namespace {

PackageCheck check(const std::string& bytes, const PackageCheckOptions& o = {},
                   PackageEntrySink* sink = nullptr) {
    MemorySource src(bytes);
    return checkPackage(src, schema(), o, sink);
}

// Records what reaches the sink (stage 5).
struct RecordingSink : PackageEntrySink {
    std::vector<std::string> paths;
    bool onFile(const std::string& path, std::string_view, PackageError&) override {
        paths.push_back(path);
        return true;
    }
};

// A source of `size` zero bytes that holds no memory.
struct ZeroSource : PackageSource {
    explicit ZeroSource(uint64_t n) : n_(n) {}
    uint64_t size() const override { return n_; }
    bool readAt(uint64_t offset, void* out, size_t n) override {
        if (offset > n_ || n > n_ - offset) return false;
        std::memset(out, 0, n);
        return true;
    }
    uint64_t n_;
};

nlohmann::json filesJson(const std::vector<PackageFile>& files) {
    nlohmann::json a = nlohmann::json::array();
    for (const auto& f : files)
        a.push_back({{"path", f.path}, {"size", f.size}, {"sha256", f.sha256}});
    return a;
}

}  // namespace

// ---- Shared vectors

class PackageVector : public ::testing::TestWithParam<std::string> {};

TEST_P(PackageVector, GivesTheExpectedCodeAndPath) {
    const Vector v = vectorNamed(GetParam());
    ASSERT_TRUE(exists(v.file)) << v.file << " is missing: run `" << kGenerateCommand
                                << "` in the repository first";
    std::string error;
    auto src = FileSource::open(v.file, error);
    ASSERT_NE(src, nullptr) << error;
    const PackageCheck r = checkPackage(*src, schema());
    EXPECT_EQ(r.packageBytes, src->size());
    if (v.expected.value("ok", false)) {
        ASSERT_TRUE(r.ok) << describe(r);
        EXPECT_EQ(r.manifest.digest, v.expected["digest"].get<std::string>());
        if (v.expected.contains("files")) {
            EXPECT_EQ(filesJson(r.manifest.files), v.expected["files"]);
        }
        EXPECT_GT(r.unpackedBytes, 0u);
    } else {
        EXPECT_FALSE(r.ok);
        EXPECT_EQ(r.error.code, v.expected["code"].get<std::string>()) << describe(r);
        if (v.expected.contains("path")) {
            EXPECT_EQ(r.error.path, v.expected["path"].get<std::string>()) << describe(r);
        }
        EXPECT_FALSE(r.error.message.empty());
    }
}

// The same bytes through a memory source give the same answer.
TEST_P(PackageVector, MemorySourceGivesTheSameAnswer) {
    const Vector v = vectorNamed(GetParam());
    ASSERT_TRUE(exists(v.file)) << v.file << " is missing: run `" << kGenerateCommand << "`";
    std::string error;
    auto file = FileSource::open(v.file, error);
    ASSERT_NE(file, nullptr) << error;
    const std::string bytes = readFile(v.file);
    const PackageCheck a = checkPackage(*file, schema());
    const PackageCheck b = check(bytes);
    EXPECT_EQ(a.ok, b.ok);
    EXPECT_EQ(a.error.code, b.error.code);
    EXPECT_EQ(a.error.path, b.error.path);
    EXPECT_EQ(a.manifest.digest, b.manifest.digest);
}

INSTANTIATE_TEST_SUITE_P(Vectors, PackageVector, ::testing::ValuesIn(packageVectorNames()),
                         paramName);

TEST(PackageVectors, EveryRequiredVectorIsThere) {
    const auto names = packageVectorNames();
    for (const char* n : {"valid-tank-demo-deflate",
                          "valid-tank-demo-stored",
                          "valid-vietnamese-names",
                          "valid-manifest-extensions",
                          "valid-entries-1024",
                          "valid-device-tank-demo",
                          "bomb-ratio",
                          "bomb-total-size",
                          "bomb-overlap",
                          "bomb-declared-size",
                          "path-dotdot",
                          "path-absolute",
                          "path-backslash",
                          "path-drive",
                          "path-device-name",
                          "path-trailing-dot",
                          "path-case-duplicate",
                          "path-symlink",
                          "path-directory",
                          "path-depth-9",
                          "type-js",
                          "struct-zip64",
                          "struct-encrypted",
                          "struct-data-descriptor",
                          "struct-extra-field",
                          "struct-archive-comment",
                          "struct-entry-comment",
                          "struct-junk-before",
                          "struct-junk-after",
                          "struct-local-name",
                          "content-crc",
                          "content-size",
                          "content-sha256",
                          "content-unlisted",
                          "content-missing",
                          "content-digest",
                          "content-identity",
                          "content-format-version",
                          "secret-password-key",
                          "secret-pem-svg",
                          "size-too-large",
                          "size-entries-1025"})
        EXPECT_NE(std::find(names.begin(), names.end(), n), names.end()) << n;
    EXPECT_GE(names.size(), 59u);
}

TEST(PackageVectors, GeneratedPackagesArePresent) {
    for (const auto& n : packageVectorNames()) {
        const Vector v = vectorNamed(n);
        if (v.generated) {
            EXPECT_TRUE(exists(v.file))
                << v.file << " is missing: run `" << kGenerateCommand << "` first";
        }
    }
}

// ---- Whole file (§2)

TEST(ZipSubset, SizeIsCheckedFirstAndExactly) {
    ZeroSource limit(kPackageMaxBytes), over(kPackageMaxBytes + 1);
    // 50 MiB of zeros: past the size rule, refused by the EOCD rule.
    EXPECT_EQ(checkPackage(limit, schema()).error.code, "E_PKG_FORMAT");
    EXPECT_EQ(checkPackage(over, schema()).error.code, "E_PKG_TOO_LARGE");
    ZeroSource huge(uint64_t{1} << 40);  // 1 TiB: refused before any read
    EXPECT_EQ(checkPackage(huge, schema()).error.code, "E_PKG_TOO_LARGE");
}

TEST(ZipSubset, TooShortToBeAZip) {
    EXPECT_PKG_ERROR(check(""), "E_PKG_FORMAT", "");
    EXPECT_PKG_ERROR(check(std::string(21, '\0')), "E_PKG_FORMAT", "");
}

TEST(ZipSubset, EndOfCentralDirectoryIsExactlyTheLast22Bytes) {
    const Files f = baseProject();
    EXPECT_PKG_OK(check(pack(f)));
    PackOptions o;
    o.zip.after = "x";
    EXPECT_PKG_ERROR(check(pack(f, o)), "E_PKG_FORMAT", "");
    PackOptions c;
    c.zip.comment = "mAT";
    EXPECT_PKG_ERROR(check(pack(f, c)), "E_PKG_FORMAT", "");
    // A comment length that points past the end, with the record still in the last 22 bytes.
    PackOptions l;
    l.zip.commentLength = 1;
    EXPECT_PKG_ERROR(check(pack(f, l)), "E_PKG_FORMAT", "");
}

TEST(ZipSubset, OneDiskOnly) {
    const Files f = baseProject();
    PackOptions a, b, c;
    a.zip.disk = 1;
    b.zip.cdDisk = 1;
    c.zip.countOnDisk = 1;  // entries on this disk differ from the total
    EXPECT_PKG_ERROR(check(pack(f, a)), "E_PKG_FORMAT", "");
    EXPECT_PKG_ERROR(check(pack(f, b)), "E_PKG_FORMAT", "");
    EXPECT_PKG_ERROR(check(pack(f, c)), "E_PKG_FORMAT", "");
}

TEST(ZipSubset, OneTo1024Entries) {
    // An empty archive: just the record.
    EXPECT_PKG_ERROR(check(buildZip({})), "E_PKG_ENTRIES", "");
    PackOptions o;
    o.zip.count = 1025;  // checked before the central directory is read
    EXPECT_PKG_ERROR(check(pack(baseProject(), o)), "E_PKG_ENTRIES", "");
}

TEST(ZipSubset, CentralDirectoryRightBeforeTheRecord) {
    const Files f = baseProject();
    PackOptions a, b;
    a.zip.beforeEocd = "ZIP64";  // room for a ZIP64 record
    EXPECT_PKG_ERROR(check(pack(f, a)), "E_PKG_FORMAT", "");
    b.zip.cdSize = 0;
    EXPECT_PKG_ERROR(check(pack(f, b)), "E_PKG_FORMAT", "");
}

TEST(ZipSubset, EntriesFollowEachOtherFromOffsetZero) {
    const Files f = baseProject();
    PackOptions before, gap, overlap, tail;
    before.zip.before = "JUNK";
    EXPECT_PKG_ERROR(check(pack(f, before)), "E_PKG_FORMAT", "");
    gap.entries = [](std::vector<ZEntry>& l) {
        findEntry(l, "project.json").after = std::string(4, '\0');
    };
    EXPECT_PKG_ERROR(check(pack(f, gap)), "E_PKG_FORMAT", "");
    // tags.json points at the local header of project.json: same bytes read twice.
    overlap.entries = [](std::vector<ZEntry>& l) {
        ZEntry& t = findEntry(l, "tags.json");
        t.offset = 0;
    };
    EXPECT_PKG_ERROR(check(pack(f, overlap)), "E_PKG_FORMAT", "");
    // Bytes between the data of the last entry and the central directory.
    tail.entries = [](std::vector<ZEntry>& l) { l.back().after = "x"; };
    EXPECT_PKG_ERROR(check(pack(f, tail)), "E_PKG_FORMAT", "");
}

TEST(ZipSubset, CentralRecordsAreBounded) {
    // The last record runs past the end of central directory record.
    std::string zip = pack(baseProject());
    const size_t eocd = zip.size() - 22;
    const uint32_t cdOffset = le32(zip, eocd + 16);
    // The first record's name runs past the end of the central directory.
    setLe(zip, cdOffset + 28, 0xFFFF, 2);
    EXPECT_PKG_ERROR(check(zip), "E_PKG_FORMAT", "");
    std::string sig = pack(baseProject());
    setLe(sig, le32(sig, sig.size() - 22 + 16), 0x12345678, 4);
    EXPECT_PKG_ERROR(check(sig), "E_PKG_FORMAT", "");
}

// ---- Every entry (§2)

TEST(ZipSubset, MethodStoredOrDeflateOnly) {
    const Files f = baseProject();
    PackOptions deflate;
    deflate.methods = {{"tags.json", 8}, {"screens/main.svg", 8}};
    EXPECT_PKG_OK(check(pack(f, deflate)));
    for (uint16_t m : {1, 6, 9, 12, 14, 93, 99}) {
        PackOptions o;
        o.entries = [m](std::vector<ZEntry>& l) { findEntry(l, "tags.json").method = m; };
        EXPECT_PKG_ERROR(check(pack(f, o)), "E_PKG_FORMAT", "tags.json") << m;
    }
}

TEST(ZipSubset, OnlyTheUtf8FlagAndDeflateOptions) {
    const Files f = baseProject();
    auto withFlags = [&](uint16_t flags, int method) {
        PackOptions o;
        o.methods = {{"tags.json", method}};
        o.entries = [flags](std::vector<ZEntry>& l) { findEntry(l, "tags.json").flags = flags; };
        return check(pack(f, o));
    };
    EXPECT_PKG_OK(withFlags(0x0000, 0));  // bit 11 is allowed, not required
    EXPECT_PKG_OK(withFlags(0x0800, 8));
    EXPECT_PKG_OK(withFlags(0x0806, 8));  // bits 1–2: deflate options
    EXPECT_PKG_ERROR(withFlags(0x0802, 0), "E_PKG_FORMAT", "tags.json");  // not with stored
    for (uint16_t bit : {0, 3, 4, 5, 6, 12, 13, 14, 15})
        EXPECT_PKG_ERROR(withFlags(static_cast<uint16_t>(0x0800 | (1u << bit)), 8), "E_PKG_FORMAT",
                         "tags.json")
            << bit;
}

TEST(ZipSubset, VersionNeededAtMost20) {
    const Files f = baseProject();
    for (uint16_t v : {10, 20, 21, 45, 63}) {
        PackOptions o;
        o.entries = [v](std::vector<ZEntry>& l) { findEntry(l, "tags.json").versionNeeded = v; };
        if (v <= 20)
            EXPECT_PKG_OK(check(pack(f, o))) << v;
        else
            EXPECT_PKG_ERROR(check(pack(f, o)), "E_PKG_FORMAT", "tags.json") << v;
    }
}

TEST(ZipSubset, NoExtraFieldCommentOrOtherDisk) {
    const Files f = baseProject();
    PackOptions extra, localExtra, comment, disk;
    extra.entries = [](std::vector<ZEntry>& l) { findEntry(l, "tags.json").extra = "UT\1\0x"; };
    localExtra.entries = [](std::vector<ZEntry>& l) {
        findEntry(l, "tags.json").localExtra = std::string("UT\1\0x", 5);
    };
    comment.entries = [](std::vector<ZEntry>& l) { findEntry(l, "tags.json").comment = "c"; };
    disk.entries = [](std::vector<ZEntry>& l) { findEntry(l, "tags.json").diskStart = 1; };
    EXPECT_PKG_ERROR(check(pack(f, extra)), "E_PKG_FORMAT", "tags.json");
    EXPECT_PKG_ERROR(check(pack(f, localExtra)), "E_PKG_FORMAT", "tags.json");
    EXPECT_PKG_ERROR(check(pack(f, comment)), "E_PKG_FORMAT", "tags.json");
    EXPECT_PKG_ERROR(check(pack(f, disk)), "E_PKG_FORMAT", "tags.json");
}

TEST(ZipSubset, LocalHeaderEqualsTheCentralOne) {
    const Files f = baseProject();
    const std::vector<std::function<void(ZEntry&)>> edits = {
        [](ZEntry& e) { e.localVersion = 10; },
        [](ZEntry& e) { e.localFlags = 0; },
        [](ZEntry& e) { e.localMethod = 8; },
        [](ZEntry& e) { e.localCrc = e.crc ^ 1; },
        [](ZEntry& e) { e.localCsize = e.csize + 1; },
        [](ZEntry& e) { e.localUsize = e.usize - 1; },
        [](ZEntry& e) { e.localName = "tagz.json"; },
        [](ZEntry& e) { e.localName = "TAGS.json"; },
        [](ZEntry& e) { e.localSignature = 0x04034b51; },
    };
    for (size_t i = 0; i < edits.size(); ++i) {
        PackOptions o;
        o.entries = [&, i](std::vector<ZEntry>& l) { edits[i](findEntry(l, "tags.json")); };
        EXPECT_PKG_ERROR(check(pack(f, o)), "E_PKG_FORMAT", "tags.json") << i;
    }
}

TEST(ZipSubset, StoredDataIsAsLongAsDeclared) {
    PackOptions o;
    o.entries = [](std::vector<ZEntry>& l) {
        ZEntry& e = findEntry(l, "tags.json");
        e.usize -= 1;  // csize stays: stored data longer than its declared size
    };
    EXPECT_PKG_ERROR(check(pack(baseProject(), o)), "E_PKG_FORMAT", "tags.json");
}

TEST(ZipSubset, FileTypeFromTheExternalAttributes) {
    const Files f = baseProject();
    auto withAttrs = [&](uint16_t madeBy, uint32_t attrs) {
        PackOptions o;
        o.entries = [=](std::vector<ZEntry>& l) {
            ZEntry& e = findEntry(l, "tags.json");
            e.madeBy = madeBy;
            e.attrs = attrs;
        };
        return check(pack(f, o));
    };
    const uint16_t unix = (3 << 8) | 20, dos = 20;
    EXPECT_PKG_OK(withAttrs(unix, 0100644u << 16));  // regular file
    EXPECT_PKG_OK(withAttrs(unix, 0));               // no type
    EXPECT_PKG_OK(withAttrs(dos, 0x20));             // MS-DOS archive bit
    EXPECT_PKG_ERROR(withAttrs(unix, 0120777u << 16), "E_PKG_PATH", "tags.json");  // symlink
    EXPECT_PKG_ERROR(withAttrs(unix, 0040755u << 16), "E_PKG_PATH", "tags.json");  // directory
    EXPECT_PKG_ERROR(withAttrs(unix, (0100644u << 16) | 0x10), "E_PKG_PATH", "tags.json");
    EXPECT_PKG_ERROR(withAttrs(dos, 0x10), "E_PKG_PATH", "tags.json");
    for (uint32_t type : {0010000u, 0020000u, 0060000u, 0140000u, 0170000u})  // fifo, chr, blk,
        EXPECT_PKG_ERROR(withAttrs(unix, (type | 0644u) << 16), "E_PKG_FORMAT", "tags.json")
            << std::oct << type;
    for (uint16_t host : {1, 2, 7, 10, 19, 30})  // Amiga, VMS, Macintosh, NTFS, OS X, …
        EXPECT_PKG_ERROR(withAttrs(static_cast<uint16_t>(host << 8 | 20), 0), "E_PKG_FORMAT",
                         "tags.json")
            << host;
}

TEST(ZipSubset, NamesAreOneTo128BytesOfUtf8) {
    const std::string name128 = "screens/" + std::string(128 - 8 - 4, 'a') + ".svg";
    ASSERT_EQ(name128.size(), 128u);
    Files ok = baseProject();
    ok[name128] = kSvg;
    EXPECT_PKG_OK(check(pack(ok)));
    Files over = baseProject();
    const std::string name129 = "screens/" + std::string(129 - 8 - 4, 'a') + ".svg";
    over[name129] = kSvg;
    const PackageCheck r = check(pack(over));
    EXPECT_EQ(r.error.code, "E_PKG_PATH");
    EXPECT_EQ(r.error.path.size(), 128 + std::string("…").size()) << r.error.path;
    // Empty name.
    PackOptions empty;
    empty.entries = [](std::vector<ZEntry>& l) { insertSorted(l, storedEntry("", "")); };
    EXPECT_PKG_ERROR(check(pack(baseProject(), empty)), "E_PKG_PATH", "");
    // Not UTF-8: reported with U+FFFD.
    PackOptions bad;
    bad.entries = [](std::vector<ZEntry>& l) { insertSorted(l, storedEntry("a\xff.json", "{}")); };
    EXPECT_PKG_ERROR(check(pack(baseProject(), bad)), "E_PKG_PATH", "a\xEF\xBF\xBD.json");
}

TEST(ZipSubset, PathRulesBeforeTheTypeRule) {
    // "screens/" breaks rule 1 (empty segment) and rule 6 (type): E_PKG_PATH (§8a).
    PackOptions o;
    o.entries = [](std::vector<ZEntry>& l) { insertSorted(l, storedEntry("screens/", "")); };
    EXPECT_PKG_ERROR(check(pack(baseProject(), o)), "E_PKG_PATH", "screens/");
    // "a.JSON" duplicates "A.json" (rule 7) and has an upper case extension (rule 6): E_PKG_PATH.
    PackOptions d;
    d.entries = [](std::vector<ZEntry>& l) {
        insertSorted(l, storedEntry("A.json", "{}"));
        insertSorted(l, storedEntry("a.JSON", "{}"));
    };
    EXPECT_PKG_ERROR(check(pack(baseProject(), d)), "E_PKG_PATH", "a.JSON");
}

TEST(ZipSubset, OnlyTheFirstEntryMayBeTheManifest) {
    PackOptions o;
    o.entries = [](std::vector<ZEntry>& l) { l.push_back(storedEntry("matscada.json", "{}")); };
    EXPECT_PKG_ERROR(check(pack(baseProject(), o)), "E_PKG_PATH", "matscada.json");
    PackOptions c;  // same name with other case: duplicate of the manifest (rule 7)
    c.entries = [](std::vector<ZEntry>& l) { insertSorted(l, storedEntry("MATSCADA.json", "{}")); };
    EXPECT_PKG_ERROR(check(pack(baseProject(), c)), "E_PKG_PATH", "MATSCADA.json");
}

// ---- Decompression (§2 "Giải nén")

TEST(Inflate, DeflateEntriesOfEveryKind) {
    Files f = baseProject();
    std::string big;  // > 64 KiB of compressed input: several reads of the source
    for (int i = 0; big.size() < 300000; ++i) big += "<!-- " + std::to_string(i * 7919) + " -->\n";
    f["screens/big.svg"] = "<svg xmlns=\"http://www.w3.org/2000/svg\">" + big + "</svg>\n";
    f["screens/empty.json"] = "";
    PackOptions o;
    o.methods = {{"screens/big.svg", 8}, {"screens/empty.json", 8}, {"tags.json", 8}};
    RecordingSink sink;
    const PackageCheck r = check(pack(f, o), {}, &sink);
    EXPECT_PKG_OK(r);
    EXPECT_EQ(sink.paths.size(), f.size());
}

TEST(Inflate, FixedHuffmanRunDecodes) {
    Files f = baseProject();
    const std::string run(60000, ' ');
    f["screens/run.svg"] = run;
    PackOptions o;
    o.entries = [&](std::vector<ZEntry>& l) {
        ZEntry& e = findEntry(l, "screens/run.svg");
        e = deflateEntry("screens/run.svg", run, deflateRun(' ', run.size()));
    };
    EXPECT_PKG_OK(check(pack(f, o)));
}

// Declared 1000 bytes, the data inflates to 1 GiB: the reader stops when its 1000-byte buffer is
// full (it never trusts the header, and never inflates the rest).
TEST(Inflate, StopsAsSoonAsTheDataPassesTheDeclaredSize) {
    Files f = baseProject();
    const std::string declared(1000, 'z');
    f["screens/bomb.svg"] = declared;
    const std::string body = deflateRun('z', size_t{1} << 30);
    PackOptions o;
    o.entries = [&](std::vector<ZEntry>& l) {
        ZEntry& e = findEntry(l, "screens/bomb.svg");
        e = deflateEntry("screens/bomb.svg", declared, body);
    };
    const std::string zip = pack(f, o);
    const auto start = std::chrono::steady_clock::now();
    EXPECT_PKG_ERROR(check(zip), "E_PKG_FORMAT", "screens/bomb.svg");
    EXPECT_LT(std::chrono::steady_clock::now() - start, std::chrono::seconds(2));
}

TEST(Inflate, ShorterThanDeclared) {
    Files f = baseProject();
    f["screens/x.svg"] = std::string(5000, 'q');
    PackOptions o;
    o.entries = [&](std::vector<ZEntry>& l) {
        ZEntry& e = findEntry(l, "screens/x.svg");
        e.body = deflateRun('q', 4999);
        e.csize = static_cast<uint32_t>(e.body.size());
        e.method = 8;
    };
    EXPECT_PKG_ERROR(check(pack(f, o)), "E_PKG_FORMAT", "screens/x.svg");
}

TEST(Inflate, MustEndExactlyAtTheEndOfTheCompressedData) {
    const Files f = baseProject();
    PackOptions trailing, truncated;
    trailing.entries = [&](std::vector<ZEntry>& l) {
        ZEntry& e = findEntry(l, "tags.json");
        e = deflateEntry("tags.json", f.at("tags.json"));
        e.body += "JUNK";
        e.csize += 4;
    };
    EXPECT_PKG_ERROR(check(pack(f, trailing)), "E_PKG_FORMAT", "tags.json");
    truncated.entries = [&](std::vector<ZEntry>& l) {
        ZEntry& e = findEntry(l, "tags.json");
        e = deflateEntry("tags.json", f.at("tags.json"));
        e.body.resize(e.body.size() - 3);
        e.csize -= 3;
    };
    EXPECT_PKG_ERROR(check(pack(f, truncated)), "E_PKG_FORMAT", "tags.json");
}

TEST(Inflate, CorruptData) {
    const Files f = baseProject();
    for (const std::string& body :
         {std::string("\x07", 1),                         // BTYPE 11: reserved
          std::string("\x01\x05\x00\x00\x00", 5),         // stored block, LEN ≠ ~NLEN
          std::string("\x03\x00\x00\x00\x00", 5),         // fixed block, then garbage
          std::string(""),                                // no data at all
          std::string("\xff\xff\xff\xff\xff\xff", 6)}) {  // invalid codes
        PackOptions o;
        o.entries = [&](std::vector<ZEntry>& l) {
            ZEntry& e = findEntry(l, "tags.json");
            e = deflateEntry("tags.json", f.at("tags.json"), body);
        };
        EXPECT_PKG_ERROR(check(pack(f, o)), "E_PKG_FORMAT", "tags.json") << toHex(body);
    }
}

TEST(Inflate, CrcOfTheRealBytes) {
    PackOptions o;
    o.methods = {{"tags.json", 8}};
    o.entries = [](std::vector<ZEntry>& l) {
        ZEntry& e = findEntry(l, "tags.json");
        e.crc ^= 0x80000000u;
    };
    EXPECT_PKG_ERROR(check(pack(baseProject(), o)), "E_PKG_CHECKSUM", "tags.json");
}

// ---- Limits (§6)

TEST(Limits, JsonAtMost1MiB) {
    Files ok = baseProject(), over = baseProject();
    const std::string tags = jsonText(tagsJson());
    ok["tags.json"] = tags + std::string(kPackageMaxJsonBytes - tags.size(), ' ');
    over["tags.json"] = tags + std::string(kPackageMaxJsonBytes + 1 - tags.size(), ' ');
    EXPECT_PKG_OK(check(pack(ok)));
    EXPECT_PKG_ERROR(check(pack(over)), "E_PKG_SIZE", "tags.json");
}

TEST(Limits, SvgAtMost5MiB) {
    Files ok = baseProject(), over = baseProject();
    ok["screens/main.svg"] =
        std::string(kSvg) + std::string(kPackageMaxSvgBytes - strlen(kSvg), ' ');
    over["screens/main.svg"] =
        std::string(kSvg) + std::string(kPackageMaxSvgBytes + 1 - strlen(kSvg), ' ');
    EXPECT_PKG_OK(check(pack(ok)));
    EXPECT_PKG_ERROR(check(pack(over)), "E_PKG_SIZE", "screens/main.svg");
}

// 41 entries declaring 5 MiB each (ratio 100, so the ratio rule passes): over 200 MiB in total.
// Refused from the declared sizes, before any byte is inflated (the data is not even deflate).
TEST(Limits, TotalAtMost200MiBCountedFromTheHeaders) {
    Files f = baseProject();
    for (int i = 0; i < 41; ++i) f["screens/big-" + std::to_string(100 + i) + ".svg"] = "x";
    PackOptions o;
    o.entries = [](std::vector<ZEntry>& l) {
        for (auto& e : l)
            if (e.name.rfind("screens/big-", 0) == 0) {
                e.method = 8;
                e.usize = kPackageMaxSvgBytes;
                e.body = std::string(kPackageMaxSvgBytes / kPackageMaxRatio + 1, '\x07');
                e.csize = static_cast<uint32_t>(e.body.size());
            }
    };
    RecordingSink sink;
    const PackageCheck r = check(pack(f, o), {}, &sink);
    EXPECT_EQ(r.error.code, "E_PKG_SIZE") << describe(r);
    EXPECT_TRUE(sink.paths.empty());
}

TEST(Limits, RatioAtMost100AboveJust64KiB) {
    auto withRun = [](size_t n) {
        Files f = baseProject();
        const std::string run(n, ' ');
        f["screens/run.svg"] = run;
        PackOptions o;
        o.entries = [&](std::vector<ZEntry>& l) {
            findEntry(l, "screens/run.svg") =
                deflateEntry("screens/run.svg", run, deflateRun(' ', n));
        };
        return check(pack(f, o));
    };
    EXPECT_PKG_OK(withRun(kPackageRatioMinBytes));  // ratio ~158, but not above 64 KiB
    EXPECT_PKG_ERROR(withRun(kPackageRatioMinBytes + 1), "E_PKG_RATIO", "screens/run.svg");
}

TEST(Limits, EntryLimitRule) {
    auto rule = [](const char* path, uint64_t size, uint64_t csize, bool manifest = false) {
        const auto e = packageEntryLimitError(path, size, csize, manifest);
        return e ? e->code + " " + e->path : std::string("ok");
    };
    EXPECT_EQ(rule("a.svg", 65536, 1), "ok");
    EXPECT_EQ(rule("a.svg", 5242800, 52428), "ok");  // exactly 100
    EXPECT_EQ(rule("a.svg", 5242801, 52428), "E_PKG_RATIO a.svg");
    EXPECT_EQ(rule("a.svg", 6553601, 65536), "E_PKG_SIZE a.svg");
    EXPECT_EQ(rule("a.svg", 65537, 655), "E_PKG_RATIO a.svg");
    EXPECT_EQ(rule("a.svg", 65537, 656), "ok");
    EXPECT_EQ(rule("a.svg", 65537, 0), "E_PKG_RATIO a.svg");
    EXPECT_EQ(rule("a.json", kPackageMaxJsonBytes, 1u << 20), "ok");
    EXPECT_EQ(rule("a.json", kPackageMaxJsonBytes + 1, 1u << 20), "E_PKG_SIZE a.json");
    // The manifest has its own limit (256 KiB, E_PKG_MANIFEST), checked elsewhere.
    EXPECT_EQ(rule("matscada.json", kPackageMaxJsonBytes + 1, 1u << 20, true), "ok");
    EXPECT_EQ(rule("a.svg", kPackageMaxSvgBytes, kPackageMaxSvgBytes), "ok");
    EXPECT_EQ(rule("a.svg", kPackageMaxSvgBytes + 1, 1u << 22), "E_PKG_SIZE a.svg");
}

// ---- First error wins: nothing is inflated after it (§6, §8a)

TEST(FirstError, StopsDecompressingAtTheFirstBadEntry) {
    Files f = baseProject();
    f["a.json"] = "{}\n";
    f["b.json"] = "{}\n";
    f["c.json"] = "{}\n";
    PackOptions o;
    o.entries = [&](std::vector<ZEntry>& l) {
        ZEntry& b = findEntry(l, "b.json");
        b = deflateEntry("b.json", "{}\n", std::string("\x07", 1));
    };
    RecordingSink sink;
    EXPECT_PKG_ERROR(check(pack(f, o), {}, &sink), "E_PKG_FORMAT", "b.json");
    EXPECT_EQ(sink.paths, std::vector<std::string>{"a.json"});
}

TEST(FirstError, DeclaredSizesOfEveryEntryBeforeAnyDecompression) {
    // a.json is corrupt deflate, z.svg breaks the ratio rule: the ratio wins and nothing reaches
    // the sink (stage 5 checks the declared sizes of every entry first).
    Files f = baseProject();
    f["a.json"] = "{}\n";
    const std::string run(100000, ' ');
    f["screens/z.svg"] = run;
    PackOptions o;
    o.entries = [&](std::vector<ZEntry>& l) {
        findEntry(l, "a.json") = deflateEntry("a.json", "{}\n", std::string("\x07", 1));
        findEntry(l, "screens/z.svg") = deflateEntry("screens/z.svg", run, deflateRun(' ', 100000));
    };
    RecordingSink sink;
    EXPECT_PKG_ERROR(check(pack(f, o), {}, &sink), "E_PKG_RATIO", "screens/z.svg");
    EXPECT_TRUE(sink.paths.empty());
}

TEST(FirstError, StagesInTheOrderOfTheContract) {
    // Bad CRC of an early entry and corrupt deflate of a later one: decompression (stage 5)
    // comes before checksums (stage 6).
    Files f = baseProject();
    PackOptions o;
    o.entries = [&](std::vector<ZEntry>& l) {
        findEntry(l, "project.json").crc ^= 1;
        findEntry(l, "tags.json") =
            deflateEntry("tags.json", f.at("tags.json"), std::string("\x07", 1));
    };
    EXPECT_PKG_ERROR(check(pack(f, o)), "E_PKG_FORMAT", "tags.json");
    // A path error of a later entry (stage 3) before a manifest error (stage 4).
    PackOptions p;
    p.manifest = [](ojson& m) { m.erase("digest"); };
    p.entries = [](std::vector<ZEntry>& l) { insertSorted(l, storedEntry("z/../x.json", "{}")); };
    EXPECT_PKG_ERROR(check(pack(f, p)), "E_PKG_PATH", "z/../x.json");
}
