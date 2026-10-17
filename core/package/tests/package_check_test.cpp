// T089 (feature 005, specs/005-device-online/contracts/matscada-package.md §3–§6, §8a): the
// content of a package. The manifest (first entry, stored, ≤ 256 KiB, UTF-8 without BOM, schema
// through valijson, formatVersion, files[] sorted without duplicates), identity against
// project.json, the file set, checksums, the digest (recomputed and expected, as X-Mat-Digest),
// secrets, and the path rules 1–8 of §5. Strings that look like secrets are built at run time so
// that this file holds none.
#include "core/package/package_check.hpp"

#include <gtest/gtest.h>

#include <chrono>

#include "core/package/tests/package_test_support.hpp"
#include "core/project-manager/project_validator.hpp"

using namespace mat;
using namespace mat::test;

namespace {

PackageCheck check(const std::string& bytes, const PackageCheckOptions& o = {}) {
    MemorySource src(bytes);
    return checkPackage(src, schema(), o);
}

PackageCheck withManifest(std::function<void(ojson&)> edit, Files f = baseProject()) {
    PackOptions o;
    o.manifest = std::move(edit);
    return check(pack(f, o));
}

PackageCheck withManifestBytes(std::function<std::string(const ojson&)> bytes) {
    PackOptions o;
    o.manifestBytes = std::move(bytes);
    return check(pack(baseProject(), o));
}

// files[] entry for a path that has no entry in the archive, kept in byte order.
void listFile(ojson& m, const std::string& path, const std::string& content = "{}\n") {
    ojson& files = m["files"];
    ojson entry = fileEntryJson(path, content);
    auto it = files.begin();
    while (it != files.end() && (*it)["path"].get<std::string>() < path) ++it;
    files.insert(it, entry);
}

Files withFile(const std::string& path, const std::string& content) {
    Files f = baseProject();
    f[path] = content;
    return f;
}

// "-----BEGIN " + kind + " KEY-----": built here so that the source holds no key block.
std::string pemBegin(const std::string& kind) {
    return std::string(5, '-') + "BEGIN " + kind + " KEY" + std::string(5, '-');
}
std::string secretWord(const char* a, const char* b) { return std::string(a) + b; }

}  // namespace

// ---- Manifest (§3)

TEST(Manifest, FirstEntryStoredAtMost256KiB) {
    PackOptions deflated;
    deflated.entries = [](std::vector<ZEntry>& l) {
        l[0] = deflateEntry(kPackageManifestName, l[0].body);
    };
    EXPECT_PKG_ERROR(check(pack(baseProject(), deflated)), "E_PKG_MANIFEST", "");
    auto padded = [](size_t total) {
        return [total](const ojson& m) {
            std::string t = jsonText(m);
            return t + std::string(total - t.size(), ' ');
        };
    };
    EXPECT_PKG_OK(withManifestBytes(padded(kPackageMaxManifestBytes)));
    EXPECT_PKG_ERROR(withManifestBytes(padded(kPackageMaxManifestBytes + 1)), "E_PKG_MANIFEST", "");
}

TEST(Manifest, Utf8WithoutBom) {
    EXPECT_PKG_ERROR(withManifestBytes([](const ojson& m) { return "\xEF\xBB\xBF" + jsonText(m); }),
                     "E_PKG_MANIFEST", "");
    EXPECT_PKG_ERROR(withManifestBytes([](const ojson& m) {
                         std::string t = jsonText(m);
                         const size_t at = t.find("2026-10-11");
                         t[at] = '\xff';  // inside the createdAt string
                         return t;
                     }),
                     "E_PKG_MANIFEST", "");
}

TEST(Manifest, JsonObject) {
    EXPECT_PKG_ERROR(withManifestBytes([](const ojson&) { return std::string("{\"format\":"); }),
                     "E_PKG_MANIFEST", "");
    EXPECT_PKG_ERROR(withManifestBytes([](const ojson&) { return std::string("[]"); }),
                     "E_PKG_MANIFEST", "");
    EXPECT_PKG_ERROR(withManifestBytes([](const ojson&) { return std::string(""); }),
                     "E_PKG_MANIFEST", "");
    EXPECT_PKG_ERROR(withManifestBytes([](const ojson& m) {
                         std::string t = jsonText(m);
                         t.insert(t.size() - 2,
                                  ",\"deep\":" + std::string(70, '[') + std::string(70, ']'));
                         return t;
                     }),
                     "E_PKG_MANIFEST", "");
    EXPECT_PKG_ERROR(withManifestBytes([](const ojson& m) { return jsonText(m) + "{}"; }),
                     "E_PKG_MANIFEST", "");
}

TEST(Manifest, SchemaRequiredKeysAndTypes) {
    const std::vector<std::pair<const char*, std::function<void(ojson&)>>> edits = {
        {"no format", [](ojson& m) { m.erase("format"); }},
        {"format", [](ojson& m) { m["format"] = "matscada-project"; }},
        {"no formatVersion", [](ojson& m) { m.erase("formatVersion"); }},
        {"formatVersion 1.0", [](ojson& m) { m["formatVersion"] = "1.0"; }},
        {"formatVersion 01.0.0", [](ojson& m) { m["formatVersion"] = "01.0.0"; }},
        {"formatVersion number", [](ojson& m) { m["formatVersion"] = 1; }},
        {"no project", [](ojson& m) { m.erase("project"); }},
        {"project string", [](ojson& m) { m["project"] = "vector"; }},
        {"no projectId", [](ojson& m) { m["project"].erase("projectId"); }},
        {"no projectName", [](ojson& m) { m["project"].erase("projectName"); }},
        {"no projectVersion", [](ojson& m) { m["project"].erase("projectVersion"); }},
        {"no minRuntimeVersion", [](ojson& m) { m["project"].erase("minRuntimeVersion"); }},
        {"projectId number", [](ojson& m) { m["project"]["projectId"] = 7; }},
        {"no createdAt", [](ojson& m) { m.erase("createdAt"); }},
        {"createdAt number", [](ojson& m) { m["createdAt"] = 0; }},
        {"no generator", [](ojson& m) { m.erase("generator"); }},
        {"no generator.name", [](ojson& m) { m["generator"].erase("name"); }},
        {"no generator.version", [](ojson& m) { m["generator"].erase("version"); }},
        {"generator array", [](ojson& m) { m["generator"] = ojson::array(); }},
        {"no files", [](ojson& m) { m.erase("files"); }},
        {"files empty", [](ojson& m) { m["files"] = ojson::array(); }},
        {"files object", [](ojson& m) { m["files"] = ojson::object(); }},
        {"file no path", [](ojson& m) { m["files"][0].erase("path"); }},
        {"file no size", [](ojson& m) { m["files"][0].erase("size"); }},
        {"file no sha256", [](ojson& m) { m["files"][0].erase("sha256"); }},
        {"file extra key", [](ojson& m) { m["files"][0]["mode"] = 420; }},
        {"file path number", [](ojson& m) { m["files"][0]["path"] = 1; }},
        {"size negative", [](ojson& m) { m["files"][0]["size"] = -1; }},
        {"size fraction", [](ojson& m) { m["files"][0]["size"] = 1.5; }},
        {"size float", [](ojson& m) { m["files"][0]["size"] = 449.0; }},
        {"size string", [](ojson& m) { m["files"][0]["size"] = "449"; }},
        {"sha256 upper",
         [](ojson& m) {
             std::string s = m["files"][0]["sha256"];
             for (char& c : s) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
             m["files"][0]["sha256"] = s;
         }},
        {"sha256 63", [](ojson& m) { m["files"][0]["sha256"] = std::string(63, 'a'); }},
        {"sha256 65", [](ojson& m) { m["files"][0]["sha256"] = std::string(65, 'a'); }},
        {"no digest", [](ojson& m) { m.erase("digest"); }},
        {"digest without prefix",
         [](ojson& m) { m["digest"] = m["digest"].get<std::string>().substr(7); }},
        {"digest sha512", [](ojson& m) { m["digest"] = "sha512:" + std::string(64, 'a'); }},
    };
    for (const auto& [name, edit] : edits) {
        PackOptions o;
        o.manifest = edit;
        o.recomputeDigest = std::string(name).find("digest") == std::string::npos;
        EXPECT_PKG_ERROR(check(pack(baseProject(), o)), "E_PKG_MANIFEST", "") << name;
    }
}

TEST(Manifest, AtMost1023Files) {
    Files f = baseProject();
    for (int i = 0; f.size() < 1023; ++i) f["d/" + std::to_string(10000 + i) + ".json"] = "{}";
    EXPECT_PKG_OK(check(pack(f)));
    // 1024 files[] items with 1024 entries (1025 with the manifest): the count of the archive is
    // refused first; with 1023 entries and one more item listed, the schema refuses the manifest.
    PackOptions o;
    o.manifest = [](ojson& m) { listFile(m, "zz.json"); };
    EXPECT_PKG_ERROR(check(pack(f, o)), "E_PKG_MANIFEST", "");
}

// libstdc++ std::regex recurses per character: the strings that meet a pattern are refused
// on their length first (a long one could overflow the stack).
TEST(Manifest, LongPatternStringsAreRefusedQuickly) {
    const auto start = std::chrono::steady_clock::now();
    EXPECT_PKG_ERROR(
        withManifest([](ojson& m) { m["formatVersion"] = "1.0.0-" + std::string(200000, 'a'); }),
        "E_PKG_MANIFEST", "");
    PackOptions d;
    d.recomputeDigest = false;
    d.manifest = [](ojson& m) { m["digest"] = "sha256:" + std::string(200000, 'a'); };
    EXPECT_PKG_ERROR(check(pack(baseProject(), d)), "E_PKG_MANIFEST", "");
    PackOptions o;
    o.recomputeDigest = false;
    o.manifest = [](ojson& m) { m["files"][0]["sha256"] = std::string(200000, 'a'); };
    EXPECT_PKG_ERROR(check(pack(baseProject(), o)), "E_PKG_MANIFEST", "");
    EXPECT_LT(std::chrono::steady_clock::now() - start, std::chrono::seconds(5));
}

TEST(Manifest, UnknownKeysAreIgnored) {
    EXPECT_PKG_OK(withManifest([](ojson& m) {
        m["formatVersion"] = "1.4.2";
        m["project"]["description"] = "khóa của bản MINOR sau";
        m["generator"]["build"] = "ci-42";
        m["extensions"] = {{"note", "x"}, {"list", {1, 2, {{"a", nullptr}}}}};
    }));
}

TEST(Manifest, FormatVersionMajorMustBe1) {
    EXPECT_PKG_OK(withManifest([](ojson& m) { m["formatVersion"] = "1.9.0"; }));
    EXPECT_PKG_OK(withManifest([](ojson& m) { m["formatVersion"] = "1.0.0-rc.1"; }));
    for (const char* v : {"2.0.0", "0.9.0", "10.0.0", "11.1.1"})
        EXPECT_PKG_ERROR(withManifest([v](ojson& m) { m["formatVersion"] = v; }),
                         "E_PKG_FORMAT_VERSION", "")
            << v;
    EXPECT_TRUE(packageFormatMajorIsSupported("1.0.0"));
    EXPECT_TRUE(packageFormatMajorIsSupported("1.23.4-beta"));
    EXPECT_FALSE(packageFormatMajorIsSupported("2.0.0"));
    EXPECT_FALSE(packageFormatMajorIsSupported("12.0.0"));
}

TEST(Manifest, FilesSortedByBytesWithoutDuplicates) {
    EXPECT_PKG_ERROR(
        withManifest([](ojson& m) { std::reverse(m["files"].begin(), m["files"].end()); }),
        "E_PKG_MANIFEST", "");
    EXPECT_PKG_ERROR(
        withManifest([](ojson& m) { m["files"].insert(m["files"].begin(), m["files"][0]); }),
        "E_PKG_MANIFEST", "");
    // Byte order: "Z.json" (0x5A) before "a.json" (0x61); locale order would differ.
    Files f = baseProject();
    f["Z.json"] = "{}";
    f["a.json"] = "{}";
    EXPECT_PKG_OK(check(pack(f)));
}

TEST(Manifest, NoManifestInFiles) {
    EXPECT_PKG_ERROR(withManifest([](ojson& m) { listFile(m, "matscada.json"); }), "E_PKG_MANIFEST",
                     "");
}

// §8a: files[].path is not a schema matter: §5 gives E_PKG_PATH / E_PKG_TYPE with that path,
// even with no entry of that name.
TEST(Manifest, FilesPathsFollowThePathRules) {
    EXPECT_PKG_ERROR(withManifest([](ojson& m) { listFile(m, "../x.json"); }), "E_PKG_PATH",
                     "../x.json");
    EXPECT_PKG_ERROR(withManifest([](ojson& m) { listFile(m, "a\\b.json"); }), "E_PKG_PATH",
                     "a\\b.json");
    EXPECT_PKG_ERROR(withManifest([](ojson& m) { listFile(m, "x.js"); }), "E_PKG_TYPE", "x.js");
    EXPECT_PKG_ERROR(withManifest([](ojson& m) {
                         listFile(m, "A.json");
                         listFile(m, "a.json");
                     }),
                     "E_PKG_PATH", "a.json");
    EXPECT_PKG_ERROR(withManifest([](ojson& m) { listFile(m, std::string("a\nb.json")); }),
                     "E_PKG_PATH", "a\nb.json");
}

// ---- Identity (§3)

TEST(Identity, ManifestFieldsEqualProjectJson) {
    for (const char* k : {"projectId", "projectName", "projectVersion", "minRuntimeVersion"})
        EXPECT_PKG_ERROR(withManifest([k](ojson& m) { m["project"][k] = "0.9.9"; }),
                         "E_PKG_IDENTITY", "")
            << k;
}

TEST(Identity, ProjectJsonMustBeThereAndReadable) {
    Files none = baseProject();
    none.erase("project.json");
    EXPECT_PKG_ERROR(check(pack(none)), "E_PKG_IDENTITY", "");
    Files bad = baseProject();
    bad["project.json"] = "{\"projectId\":";
    EXPECT_PKG_ERROR(check(pack(bad)), "E_PKG_IDENTITY", "");
    Files array = baseProject();
    array["project.json"] = "[]";
    EXPECT_PKG_ERROR(check(pack(array)), "E_PKG_IDENTITY", "");
    Files number = baseProject();
    ojson p = projectJson();
    p["projectVersion"] = 1;
    number["project.json"] = jsonText(p);
    PackOptions o;  // the manifest keeps the string form
    o.manifest = [](ojson& m) { m["project"]["projectVersion"] = "1"; };
    EXPECT_PKG_ERROR(check(pack(number, o)), "E_PKG_IDENTITY", "");
}

TEST(Identity, RepeatedKeyKeepsTheLastValue) {
    Files f = baseProject();
    std::string pj = jsonText(projectJson());
    pj.insert(1, "\"projectId\":\"other\",");
    f["project.json"] = pj;
    EXPECT_PKG_OK(check(pack(f)));
}

TEST(Identity, ReadProjectIdentity) {
    const auto id = readProjectIdentity(jsonText(projectJson()));
    ASSERT_TRUE(id);
    EXPECT_EQ(id->projectId, "vector");
    EXPECT_EQ(id->projectName, "Vector");
    EXPECT_EQ(id->projectVersion, "0.1.0");
    EXPECT_EQ(id->minRuntimeVersion, "0.3.0");
    const auto partial = readProjectIdentity(R"({"projectId":1,"x":{"projectName":"n"}})");
    ASSERT_TRUE(partial);
    EXPECT_FALSE(partial->projectId);
    EXPECT_FALSE(partial->projectName);
    EXPECT_FALSE(readProjectIdentity("[1]"));
    EXPECT_FALSE(readProjectIdentity("{"));
    EXPECT_FALSE(readProjectIdentity(""));
}

// ---- Checksums and file set (§5, §6)

TEST(Checksum, ManifestCrcToo) {
    PackOptions o;
    o.entries = [](std::vector<ZEntry>& l) { l[0].crc ^= 4; };
    EXPECT_PKG_ERROR(check(pack(baseProject(), o)), "E_PKG_CHECKSUM", "matscada.json");
}

TEST(Checksum, SizeAgainstTheManifest) {
    PackOptions o;
    o.recomputeDigest = false;
    o.manifest = [](ojson& m) { m["files"][1]["size"] = UINT64_MAX; };
    EXPECT_PKG_ERROR(check(pack(baseProject(), o)), "E_PKG_CHECKSUM", "screens/main.bindings.json");
}

TEST(FileSet, UnlistedBeforeMissing) {
    PackOptions o;
    o.manifest = [](ojson& m) { listFile(m, "listed.json"); };
    o.entries = [](std::vector<ZEntry>& l) { insertSorted(l, storedEntry("extra.json", "{}\n")); };
    EXPECT_PKG_ERROR(check(pack(baseProject(), o)), "E_PKG_UNLISTED", "extra.json");
    PackOptions m;
    m.manifest = [](ojson& x) { listFile(x, "listed.json"); };
    EXPECT_PKG_ERROR(check(pack(baseProject(), m)), "E_PKG_MISSING", "listed.json");
}

// Feature 011 (contract project-format-1.0 §6, FR-024): what the Studio never packs and the
// runtime refuses even when listed: E_PACKAGE_EXTRA_FILE, after the checksums, before
// E_PKG_UNLISTED.
TEST(FileSet, ExcludedPathsAreExtraFiles) {
    for (const char* p : {".mat-editor/state.json", ".mat-backup/1/project.json", "a/.git/x.json",
                          ".vs/x.json", "node_modules/x/package.json", "screens/.hidden.json",
                          ".x.svg", "Thumbs.db", "screens/THUMBS.DB", "desktop.ini", "~$tags.json",
                          "screens/~main.svg", "a.tmp", "screens/b.TMP"})
        EXPECT_TRUE(packageExcludedPath(p)) << p;
    for (const char* p : {"project.json", "screens/main.svg", "a.b/c.json", "tags~.json",
                          "tmp.json", "screens/x.tmp.svg", "node_modules.json", "git/x.json"})
        EXPECT_FALSE(packageExcludedPath(p)) << p;

    auto files = baseProject();
    files[".mat-editor/state.json"] = "{}\n";
    EXPECT_PKG_ERROR(check(pack(files)), "E_PACKAGE_EXTRA_FILE", ".mat-editor/state.json");
    // Listed or not, the excluded file is named first.
    PackOptions o;
    o.entries = [](std::vector<ZEntry>& l) { insertSorted(l, storedEntry("~x.json", "{}\n")); };
    EXPECT_PKG_ERROR(check(pack(baseProject(), o)), "E_PACKAGE_EXTRA_FILE", "~x.json");
}

// ---- Digest (§4, §6)

TEST(Digest, RecomputedFromFilesThenAgainstTheExpectedOne) {
    const std::string bytes = pack(baseProject());
    const PackageCheck ok = check(bytes);
    ASSERT_TRUE(ok.ok) << describe(ok);
    EXPECT_EQ(ok.manifest.digest, digestOfFiles(manifestFor(baseProject())["files"]));
    PackageCheckOptions same{ok.manifest.digest};
    EXPECT_PKG_OK(check(bytes, same));
    PackageCheckOptions other{"sha256:" + std::string(64, '0')};
    EXPECT_PKG_ERROR(check(bytes, other), "E_PKG_DIGEST", "");
    PackageCheckOptions junk{"abc"};
    EXPECT_PKG_ERROR(check(bytes, junk), "E_PKG_DIGEST", "");
    PackOptions wrong;
    wrong.recomputeDigest = false;
    wrong.manifest = [](ojson& m) { m["digest"] = "sha256:" + std::string(64, 'a'); };
    EXPECT_PKG_ERROR(check(pack(baseProject(), wrong)), "E_PKG_DIGEST", "");
}

TEST(Digest, OrderOfTheLastStages) {
    // digest before identity before formatVersion before secrets (§8a).
    auto build = [](bool digest, bool identity, bool version, bool secret) {
        Files f = baseProject();
        if (secret) {
            ojson t = tagsJson();
            t["tags"][0]["source"][secretWord("pass", "word")] = "not-a-real-one";
            f["tags.json"] = jsonText(t);
        }
        PackOptions o;
        o.recomputeDigest = !digest;
        o.manifest = [=](ojson& m) {
            if (digest) m["digest"] = "sha256:" + std::string(64, 'b');
            if (identity) m["project"]["projectId"] = "other";
            if (version) m["formatVersion"] = "2.0.0";
        };
        return check(pack(f, o));
    };
    EXPECT_EQ(build(true, true, true, true).error.code, "E_PKG_DIGEST");
    EXPECT_EQ(build(false, true, true, true).error.code, "E_PKG_IDENTITY");
    EXPECT_EQ(build(false, false, true, true).error.code, "E_PKG_FORMAT_VERSION");
    EXPECT_EQ(build(false, false, false, true).error.code, "E_PKG_SECRET");
    EXPECT_TRUE(build(false, false, false, false).ok);
}

// ---- Secrets (§6)

TEST(Secret, KeysThatLookLikeSecretsInAnyJsonFile) {
    const std::vector<std::string> keys = {
        secretWord("pass", "word"),     secretWord("pass", "wd"),   secretWord("p", "wd"),
        secretWord("sec", "ret"),       secretWord("to", "ken"),    secretWord("api", "key"),
        secretWord("api", "_key"),      secretWord("Pass", "word"), secretWord("userPass", "word"),
        secretWord("API", "_KEY"),      secretWord("api", "Key"),   secretWord("access", "Token"),
        secretWord("client", "Secret"), secretWord("P", "WD")};
    for (const auto& k : keys) {
        ojson t = tagsJson();
        t["tags"][1]["source"]["deep"] = {{"list", {1, {{k, "x"}}}}};
        EXPECT_PKG_ERROR(check(pack(withFile("tags.json", jsonText(t)))), "E_PKG_SECRET",
                         "tags.json")
            << k;
        ojson screen = {{"elements", {{{k, 1}}}}};
        EXPECT_PKG_ERROR(check(pack(withFile("screens/other.screen.json", jsonText(screen)))),
                         "E_PKG_SECRET", "screens/other.screen.json")
            << k;
    }
    for (const char* k : {"pass", "key", "auth", "user", "secrecy", "pw", "tok", "api"}) {
        ojson t = tagsJson();
        t["tags"][1]["source"][k] = "x";
        EXPECT_PKG_OK(check(pack(withFile("tags.json", jsonText(t))))) << k;
    }
    // A word in a value, or in an SVG, is not a key of a JSON file.
    ojson t = tagsJson();
    t["tags"][1]["source"]["signal"] = secretWord("pass", "word");
    EXPECT_PKG_OK(check(pack(withFile("tags.json", jsonText(t)))));
    EXPECT_PKG_OK(
        check(pack(withFile("screens/main.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\" " +
                                                    secretWord("pass", "word") + "=\"x\"/>"))));
    // A file that does not parse as JSON is left to the project check.
    EXPECT_PKG_OK(check(pack(withFile("x.json", "{\"" + secretWord("pass", "word") + "\": 1,"))));
}

TEST(Secret, InTheManifestToo) {
    EXPECT_PKG_ERROR(
        withManifest([](ojson& m) { m["generator"][secretWord("api", "Token")] = "x"; }),
        "E_PKG_SECRET", "matscada.json");
    EXPECT_PKG_ERROR(withManifest([](ojson& m) { m["createdAt"] = pemBegin("RSA PRIVATE"); }),
                     "E_PKG_SECRET", "matscada.json");
}

TEST(Secret, ConnectionUrlWithAnAccount) {
    auto logging = [](const std::string& url) {
        Files f = baseProject();
        ojson l = {{"schemaVersion", "0.1.0"},
                   {"connections", {{{"id", "in1"}, {"type", "influxdb"}, {"url", url}}}}};
        f["logging.json"] = jsonText(l);
        return check(pack(f));
    };
    EXPECT_PKG_ERROR(logging("https://writer:" + secretWord("not-a-real-", "pw") + "@influx.local"),
                     "E_PKG_SECRET", "logging.json");
    EXPECT_PKG_ERROR(logging("http://writer@influx.local:8086/x"), "E_PKG_SECRET", "logging.json");
    EXPECT_PKG_ERROR(logging("writer:x@influx.local"), "E_PKG_SECRET", "logging.json");
    EXPECT_PKG_OK(logging("https://influx.local:8086/api@v2"));
    EXPECT_PKG_OK(logging("https://influx.local:8086/?q=a@b"));
    EXPECT_PKG_OK(logging("https://influx.local#a@b"));
    // Only connections[].url of the top-level object, as E_LOG_SECRET.
    Files f = baseProject();
    f["a.json"] = jsonText(ojson{{"url", "https://u:p@h"}});
    f["b.json"] = jsonText(ojson{{"x", {{"connections", {{{"url", "https://u:p@h"}}}}}}});
    f["c.json"] = jsonText(ojson{{"connections", {{"url", "https://u:p@h"}}}});
    EXPECT_PKG_OK(check(pack(f)));
}

TEST(Secret, PemPrivateKeyInAnyFile) {
    for (const std::string& kind : {"RSA PRIVATE", "EC PRIVATE", "PRIVATE", "ENCRYPTED PRIVATE",
                                    "OPENSSH PRIVATE", "DSA PRIVATE"}) {
        EXPECT_PKG_ERROR(check(pack(withFile("screens/main.svg", "<svg><!-- " + pemBegin(kind) +
                                                                     "\nTUFU\n --></svg>"))),
                         "E_PKG_SECRET", "screens/main.svg")
            << kind;
        ojson t = tagsJson();
        t["tags"][1]["source"]["signal"] = pemBegin(kind);
        EXPECT_PKG_ERROR(check(pack(withFile("tags.json", jsonText(t)))), "E_PKG_SECRET",
                         "tags.json")
            << kind;
    }
    for (const std::string& text :
         {pemBegin("PUBLIC"), std::string(5, '-') + "BEGIN CERTIFICATE" + std::string(5, '-'),
          std::string(5, '-') + "begin private key" + std::string(5, '-'),
          std::string(5, '-') + "BEGIN PRIVATE KEYS" + std::string(5, '-'),
          std::string(5, '-') + "BEGIN PRIVATE KEY" + std::string(4, '-')})
        EXPECT_PKG_OK(check(pack(withFile("screens/main.svg", "<svg>" + text + "</svg>")))) << text;
    // Found after a false start.
    EXPECT_PKG_ERROR(check(pack(withFile("screens/main.svg",
                                         std::string(5, '-') + "BEGIN " + pemBegin("EC PRIVATE")))),
                     "E_PKG_SECRET", "screens/main.svg");
}

TEST(Secret, FindPackageSecretStreamsDeepJson) {
    const std::string key = "\"" + secretWord("to", "ken") + "\":1";
    const std::string deep = std::string(200000, '[') + "{" + key + "}" + std::string(200000, ']');
    EXPECT_TRUE(findPackageSecret("a.json", deep));
    EXPECT_FALSE(findPackageSecret("a.svg", deep));  // keys only in JSON files
    EXPECT_FALSE(findPackageSecret("a.json", deep.substr(0, deep.size() - 1)));  // not JSON
    EXPECT_FALSE(findPackageSecret("a.json", "{}"));
    EXPECT_TRUE(findPackageSecret("a.svg", "x" + pemBegin("PRIVATE") + "y"));
}

// ---- Path rules (§5)

TEST(PathRules, OneToEight) {
    for (const std::string& ok : std::vector<std::string>{
             "a.json", "screens/main.svg", "a/b/c/d/e/f/g/h.json", "màn hình/Tổng quan.svg",
             "a b.json", "a-b_c.d.json", ".json", "conx.json", "com0.json", "lpt10.json",
             "CONSOLE.json", "nul-1.json", "x/aux_y.svg", "ｆ.svg", "😀.json",
             std::string(123, 'a') + ".json"}) {
        EXPECT_FALSE(packagePathError(ok)) << ok;
        EXPECT_FALSE(packageTypeError(ok)) << ok;
        EXPECT_TRUE(isSafeRelPath(ok)) << ok;
    }
    for (const std::string& bad : {std::string(""),
                                   std::string(125, 'a') + ".json",
                                   std::string("/a.json"),
                                   std::string("a\\b.json"),
                                   std::string("C:x.json"),
                                   std::string("a:b.json"),
                                   std::string("a\nb.json"),
                                   std::string("a\tb.json"),
                                   std::string("a\x7f.json"),
                                   std::string("a\0.json", 7),
                                   std::string("a//b.json"),
                                   std::string("./a.json"),
                                   std::string("a/./b.json"),
                                   std::string("../a.json"),
                                   std::string("a/../b.json"),
                                   std::string("a/.."),
                                   std::string("a/"),
                                   std::string("a<b.json"),
                                   std::string("a>b.json"),
                                   std::string("a\"b.json"),
                                   std::string("a|b.json"),
                                   std::string("a?b.json"),
                                   std::string("a*b.json"),
                                   std::string("a./b.json"),
                                   std::string("a /b.json"),
                                   std::string("a.json."),
                                   std::string("a.json "),
                                   std::string("CON.json"),
                                   std::string("con.json"),
                                   std::string("Con"),
                                   std::string("nul.svg"),
                                   std::string("aux.tar.json"),
                                   std::string("COM1.json"),
                                   std::string("com9.svg"),
                                   std::string("LPT1.json"),
                                   std::string("lpt9"),
                                   std::string("screens/PRN.svg"),
                                   std::string("con .json"),
                                   std::string("screens/COM1 .svg"),
                                   std::string("a/b/c/d/e/f/g/h/i.json"),
                                   std::string("a\xff.json"),
                                   std::string("a\xC3.json"),
                                   std::string("\xED\xA0\x80.json")}) {
        const auto e = packagePathError(bad);
        ASSERT_TRUE(e) << bad;
        EXPECT_EQ(e->code, "E_PKG_PATH") << bad;
        EXPECT_FALSE(e->message.empty());
    }
    // Rules 1, 3 and 4 are isSafeRelPath of the project validator, plus UTF-8 (T062, S2).
    for (const std::string& p : {"", "/x", "a\\b", "a:b", "a//b", "../a", "a/.", "a\x01",
                                 "a./b.json", "a /b.json", "nul.svg", "con .json", "Com1.json",
                                 "console.json", "com10.json", "auxiliary/x.svg", "a.json"})
        EXPECT_EQ(isSafeRelPath(p), !packagePathError(p)) << p;
    for (const std::string& bad : {"a.js", "a.JSON", "a.Svg", "a", "a.json.bak", "a.svgz", "a.txt",
                                   "screens/main.svg/x", "json", "a.json/"}) {
        const auto e = packageTypeError(bad);
        ASSERT_TRUE(e) << bad;
        EXPECT_EQ(e->code, "E_PKG_TYPE") << bad;
    }
    EXPECT_EQ(packagePathKey("AbC/Đ ÀZ.JSON"), "abc/Đ Àz.json");
}

TEST(PathRules, DisplayNameIsUtf8AndShort) {
    EXPECT_EQ(packageDisplayName("a.json"), "a.json");
    EXPECT_EQ(packageDisplayName("a\xff.json"), "a\xEF\xBF\xBD.json");
    const std::string longName(200, 'x');
    EXPECT_EQ(packageDisplayName(longName), std::string(128, 'x') + "…");
    // Cut on a character boundary: 'ệ' is 3 bytes.
    std::string vi;
    while (vi.size() < 200) vi += "ệ";
    const std::string shown = packageDisplayName(vi);
    EXPECT_LE(shown.size(), 128 + std::string("…").size());
    EXPECT_EQ(shown.substr(shown.size() - 3), "…");
    EXPECT_EQ((shown.size() - 3) % 3, 0u);
}

// ---- A real project

TEST(PackageCheck, TankDemoFromDisk) {
    const std::string dir = kSourceDir + "/projects/tank-demo";
    const ProjectValidation v = validateProject(dir, kSchemasDir);
    ASSERT_TRUE(v.valid);
    Files f;
    for (const auto& rel : v.project->files()) f[rel] = readFile(dir + "/" + rel);
    const PackageCheck r = check(pack(f));
    ASSERT_TRUE(r.ok) << describe(r);
    const auto project = nlohmann::json::parse(
        readFile(kSourceDir + "/tests/project-vectors/valid-tank-demo/expected.json"));
    EXPECT_EQ(r.manifest.digest, project["digest"].get<std::string>());
    EXPECT_EQ(r.manifest.projectId, "tank-demo");
    EXPECT_EQ(r.manifest.formatVersion, "1.0.0");
    EXPECT_EQ(r.manifest.files.size(), f.size());
    EXPECT_EQ(r.manifest.text.substr(0, 1), "{");
    uint64_t total = 0;
    for (const auto& [p, c] : f) total += c.size();
    EXPECT_EQ(r.unpackedBytes, total + r.manifest.text.size());
}
