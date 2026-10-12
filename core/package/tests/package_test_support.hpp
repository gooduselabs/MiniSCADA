// Helpers of the core/package tests (feature 005, T088–T092, T094): a ZIP builder that can break
// every rule of specs/005-device-online/contracts/matscada-package.md §2, raw deflate encoders
// (the build has no compressor: mat_miniz is inflate only), a CRC-32 that does not use miniz,
// packages built like tests/package-vectors/generate.mjs does, the shared vectors, temporary
// directories.
#pragma once
#include <dirent.h>
#include <fcntl.h>
#include <gtest/gtest.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include "core/crypto/hex.hpp"
#include "core/crypto/sha256.hpp"
#include "core/package/digest.hpp"
#include "core/package/manifest.hpp"
#include "nlohmann/json.hpp"

namespace mat::test {

inline const std::string kSourceDir = MAT_SOURCE_DIR;
inline const std::string kVectorDir = kSourceDir + "/tests/package-vectors";
inline const std::string kSchemasDir = kSourceDir + "/schemas";
inline const std::string kGenerateCommand = "node tests/package-vectors/generate.mjs --out";

// ---- Bytes

inline std::string readFile(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("cannot read " + path);
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

inline void writeFile(const std::string& path, std::string_view bytes) {
    std::ofstream f(path, std::ios::binary | std::ios::trunc);
    f.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    if (!f) throw std::runtime_error("cannot write " + path);
}

inline bool exists(const std::string& path) {
    struct stat st {};
    return ::lstat(path.c_str(), &st) == 0;
}

inline std::string sha256Hex(std::string_view bytes) { return toHex(sha256(bytes)); }

// CRC-32 of ZIP (IEEE 802.3, reflected 0xEDB88320), bit by bit: independent of mz_crc32.
inline uint32_t crc32(std::string_view data) {
    uint32_t c = 0xFFFFFFFFu;
    for (unsigned char b : data) {
        c ^= b;
        for (int k = 0; k < 8; ++k) c = (c >> 1) ^ (0xEDB88320u & (0u - (c & 1u)));
    }
    return ~c;
}

inline void putLe(std::string& out, uint64_t v, int bytes) {
    for (int i = 0; i < bytes; ++i) out += static_cast<char>((v >> (8 * i)) & 0xff);
}
inline uint16_t le16(std::string_view s, size_t at) {
    return static_cast<uint16_t>(static_cast<unsigned char>(s[at]) |
                                 static_cast<unsigned char>(s[at + 1]) << 8);
}
inline uint32_t le32(std::string_view s, size_t at) {
    return static_cast<uint32_t>(le16(s, at)) | static_cast<uint32_t>(le16(s, at + 2)) << 16;
}
inline void setLe(std::string& s, size_t at, uint64_t v, int bytes) {
    for (int i = 0; i < bytes; ++i) s[at + i] = static_cast<char>((v >> (8 * i)) & 0xff);
}

// ---- Raw deflate (RFC 1951)

// Stored blocks only (BTYPE 00, at most 65535 bytes each): no compression, any inflater reads it.
inline std::string deflateStored(std::string_view data) {
    std::string out;
    size_t pos = 0;
    do {
        const size_t n = std::min<size_t>(65535, data.size() - pos);
        out += static_cast<char>(pos + n == data.size() ? 1 : 0);  // BFINAL, BTYPE 00
        putLe(out, n, 2);
        putLe(out, ~n & 0xffff, 2);
        out.append(data.substr(pos, n));
        pos += n;
    } while (pos < data.size());
    return out;
}

// Bits LSB first; Huffman codes MSB first (RFC 1951 §3.1.1).
class BitWriter {
   public:
    void bits(uint32_t v, int n) {
        for (int i = 0; i < n; ++i) bit((v >> i) & 1);
    }
    void code(uint32_t c, int n) {
        for (int i = n - 1; i >= 0; --i) bit((c >> i) & 1);
    }
    std::string finish() {
        if (count_) out_ += static_cast<char>(acc_);
        acc_ = 0;
        count_ = 0;
        return out_;
    }

   private:
    void bit(uint32_t b) {
        acc_ |= b << count_;
        if (++count_ == 8) {
            out_ += static_cast<char>(acc_);
            acc_ = 0;
            count_ = 0;
        }
    }
    std::string out_;
    uint32_t acc_ = 0;
    int count_ = 0;
};

// One fixed-Huffman block holding `count` copies of `byte`: one literal, then matches of length
// 258 at distance 1 (13 bits for 258 bytes, about 150 times smaller), then literals.
inline std::string deflateRun(unsigned char byte, size_t count) {
    BitWriter w;
    w.bits(1, 1);  // BFINAL
    w.bits(1, 2);  // BTYPE 01: fixed codes
    auto literal = [&](unsigned v) {
        if (v < 144)
            w.code(0x30 + v, 8);
        else
            w.code(0x190 + v - 144, 9);
    };
    if (count > 0) {
        literal(byte);
        size_t left = count - 1;
        for (; left >= 258; left -= 258) {
            w.code(0xC5, 8);  // symbol 285: length 258
            w.code(0, 5);     // distance code 0: distance 1
        }
        while (left-- > 0) literal(byte);
    }
    w.code(0, 7);  // symbol 256: end of block
    return w.finish();
}

// ---- ZIP builder

constexpr uint32_t kSigLocal = 0x04034b50;
constexpr uint32_t kSigCentral = 0x02014b50;
constexpr uint32_t kSigEocd = 0x06054b50;

struct ZEntry {
    std::string name;
    std::string body;  // bytes as stored in the archive (compressed for method 8)
    uint16_t method = 0;
    uint16_t flags = 0x0800;
    uint16_t versionNeeded = 20;
    uint16_t madeBy = 20;
    uint32_t crc = 0;
    uint32_t csize = 0;
    uint32_t usize = 0;
    std::string extra;
    std::string comment;
    uint16_t diskStart = 0;
    uint32_t attrs = 0;
    // Local header fields that differ from the central directory.
    std::optional<uint16_t> localVersion, localFlags, localMethod;
    std::optional<uint32_t> localCrc, localCsize, localUsize;
    std::optional<std::string> localName, localExtra;
    std::optional<uint32_t> localSignature;
    std::string after;               // bytes right after the data (a gap, a data descriptor)
    std::optional<uint32_t> offset;  // offset in the central directory when not the real one
    bool centralOnly = false;        // no local header nor data (an overlapping entry)
};

inline ZEntry storedEntry(std::string name, std::string_view content) {
    ZEntry e;
    e.name = std::move(name);
    e.body = std::string(content);
    e.crc = crc32(content);
    e.csize = e.usize = static_cast<uint32_t>(content.size());
    return e;
}

// Method 8; `body` is the raw deflate data (deflateStored(content) when empty).
inline ZEntry deflateEntry(std::string name, std::string_view content,
                           std::optional<std::string> body = std::nullopt) {
    ZEntry e = storedEntry(std::move(name), content);
    e.method = 8;
    e.body = body ? *body : deflateStored(content);
    e.csize = static_cast<uint32_t>(e.body.size());
    return e;
}

struct ZipOptions {
    std::string before;  // bytes before the first entry (offsets stay right)
    std::string after;   // bytes after the end of central directory record
    std::string comment;
    std::string beforeEocd;  // bytes between the central directory and the EOCD record
    std::optional<uint16_t> count, countOnDisk, disk, cdDisk, commentLength;
    std::optional<uint32_t> cdOffset, cdSize;
};

inline std::string buildZip(const std::vector<ZEntry>& entries, const ZipOptions& o = {}) {
    std::string out = o.before;
    std::vector<uint32_t> offsets;
    for (const auto& e : entries) {
        offsets.push_back(e.offset.value_or(static_cast<uint32_t>(out.size())));
        if (e.centralOnly) continue;
        const std::string& name = e.localName ? *e.localName : e.name;
        const std::string& extra = e.localExtra ? *e.localExtra : e.extra;
        putLe(out, e.localSignature.value_or(kSigLocal), 4);
        putLe(out, e.localVersion.value_or(e.versionNeeded), 2);
        putLe(out, e.localFlags.value_or(e.flags), 2);
        putLe(out, e.localMethod.value_or(e.method), 2);
        putLe(out, 0x0000, 2);  // DOS time
        putLe(out, 0x0021, 2);  // DOS date 1980-01-01
        putLe(out, e.localCrc.value_or(e.crc), 4);
        putLe(out, e.localCsize.value_or(e.csize), 4);
        putLe(out, e.localUsize.value_or(e.usize), 4);
        putLe(out, name.size(), 2);
        putLe(out, extra.size(), 2);
        out += name;
        out += extra;
        out += e.body;
        out += e.after;
    }
    const size_t cdOffset = out.size();
    for (size_t i = 0; i < entries.size(); ++i) {
        const ZEntry& e = entries[i];
        putLe(out, kSigCentral, 4);
        putLe(out, e.madeBy, 2);
        putLe(out, e.versionNeeded, 2);
        putLe(out, e.flags, 2);
        putLe(out, e.method, 2);
        putLe(out, 0x0000, 2);
        putLe(out, 0x0021, 2);
        putLe(out, e.crc, 4);
        putLe(out, e.csize, 4);
        putLe(out, e.usize, 4);
        putLe(out, e.name.size(), 2);
        putLe(out, e.extra.size(), 2);
        putLe(out, e.comment.size(), 2);
        putLe(out, e.diskStart, 2);
        putLe(out, 0, 2);  // internal attributes
        putLe(out, e.attrs, 4);
        putLe(out, offsets[i], 4);
        out += e.name;
        out += e.extra;
        out += e.comment;
    }
    const size_t cdSize = out.size() - cdOffset;
    out += o.beforeEocd;
    putLe(out, kSigEocd, 4);
    putLe(out, o.disk.value_or(0), 2);
    putLe(out, o.cdDisk.value_or(0), 2);
    putLe(out, o.countOnDisk.value_or(o.count.value_or(entries.size())), 2);
    putLe(out, o.count.value_or(entries.size()), 2);
    putLe(out, o.cdSize.value_or(static_cast<uint32_t>(cdSize)), 4);
    putLe(out, o.cdOffset.value_or(static_cast<uint32_t>(cdOffset)), 4);
    putLe(out, o.commentLength.value_or(o.comment.size()), 2);
    out += o.comment;
    out += o.after;
    return out;
}

// ---- Packages built like generate.mjs (pack, manifestFor, base)

using Files = std::map<std::string, std::string>;  // path → content, ordered by bytes
using ojson = nlohmann::ordered_json;

inline std::string jsonText(const ojson& v) { return v.dump(2) + "\n"; }

inline const char* kSvg =
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\">\n"
    "  <rect data-mat-uid=\"el_aaa\" x=\"10\" y=\"10\" width=\"30\" height=\"80\" "
    "fill=\"#38bdf8\"/>\n"
    "  <text data-mat-uid=\"el_bbb\" x=\"50\" y=\"50\">--</text>\n"
    "</svg>\n";

inline ojson projectJson() {
    return ojson{{"format", "matscada-project"}, {"schemaVersion", "0.1.0"},
                 {"projectId", "vector"},        {"projectName", "Vector"},
                 {"projectVersion", "0.1.0"},    {"minRuntimeVersion", "0.3.0"},
                 {"entryScreen", "main"},        {"screens", {"main"}},
                 {"tagFile", "tags.json"},       {"maxClients", 10}};
}

inline ojson tagsJson() {
    return ojson{{"schemaVersion", "0.1.0"},
                 {"tags",
                  {{{"id", "T.LEVEL"},
                    {"type", "FLOAT32"},
                    {"min", 0},
                    {"max", 100},
                    {"source", {{"kind", "mock"}, {"signal", "tank.level"}}}},
                   {{"id", "T.NAME"},
                    {"type", "STRING"},
                    {"source", {{"kind", "mock"}, {"signal", "x.name"}}}}}}};
}

// project.json, tags.json and one screen: the small valid project of generate.mjs (base()).
inline Files baseProject() {
    ojson screen = {{"schemaVersion", "0.1.0"},
                    {"id", "main"},
                    {"name", "Main"},
                    {"svgFile", "screens/main.svg"},
                    {"viewBox", {0, 0, 100, 100}},
                    {"fitMode", "contain"},
                    {"bindingFile", "screens/main.bindings.json"},
                    {"elements", {{{"elementUid", "el_aaa"}}, {{"elementUid", "el_bbb"}}}}};
    ojson bindings = {{"schemaVersion", "0.1.0"},
                      {"screenId", "main"},
                      {"elements",
                       {{{"elementUid", "el_aaa"},
                         {"bindings",
                          {{{"id", "b1"},
                            {"target", "geometry.levelPercent"},
                            {"source", {{"type", "tag"}, {"tagId", "T.LEVEL"}}},
                            {"transform", {{"kind", "direct"}}}}}}}}}};
    return Files{{"project.json", jsonText(projectJson())},
                 {"tags.json", jsonText(tagsJson())},
                 {"screens/main.screen.json", jsonText(screen)},
                 {"screens/main.bindings.json", jsonText(bindings)},
                 {"screens/main.svg", kSvg}};
}

inline ojson fileEntryJson(const std::string& path, std::string_view content) {
    return ojson{{"path", path}, {"size", content.size()}, {"sha256", sha256Hex(content)}};
}

// The digest of files[] of a manifest (contract §4).
inline std::string digestOfFiles(const ojson& files) {
    std::vector<PackageFile> list;
    for (const auto& f : files)  // at(): a missing key throws (operator[] const would not)
        list.push_back({f.at("path").get<std::string>(), f.at("size").get<int64_t>(),
                        f.at("sha256").get<std::string>()});
    return packageDigest(list);
}

// A manifest that matches `files` (manifestFor() of generate.mjs); identity from project.json
// when it parses.
inline ojson manifestFor(const Files& files) {
    ojson project = {{"projectId", "vector"},
                     {"projectName", "Vector"},
                     {"projectVersion", "0.1.0"},
                     {"minRuntimeVersion", "0.3.0"}};
    const auto pj = files.find("project.json");
    if (pj != files.end()) {
        const auto p = nlohmann::json::parse(pj->second, nullptr, false);
        if (p.is_object())
            for (const char* k :
                 {"projectId", "projectName", "projectVersion", "minRuntimeVersion"})
                if (p.contains(k)) project[k] = p[k];
    }
    ojson list = ojson::array();
    for (const auto& [path, content] : files) list.push_back(fileEntryJson(path, content));
    return ojson{{"format", "matscada-package"},
                 {"formatVersion", "1.0.0"},
                 {"project", project},
                 {"createdAt", "2026-10-11T00:00:00Z"},
                 {"generator", {{"name", "mAT package tests"}, {"version", "1.0.0"}}},
                 {"files", list},
                 {"digest", digestOfFiles(list)}};
}

struct PackOptions {
    // Edits the manifest object before it is written; `digest` is recomputed from files[] when
    // `recomputeDigest` (as generate.mjs does after editing files[]).
    std::function<void(ojson&)> manifest;
    bool recomputeDigest = true;
    // Replaces the manifest bytes.
    std::function<std::string(const ojson&)> manifestBytes;
    std::map<std::string, int> methods;  // path → 0 or 8 (8: deflateStored)
    // Edits the entries (entry 0 is the manifest) before the archive is built.
    std::function<void(std::vector<ZEntry>&)> entries;
    ZipOptions zip;
};

inline ZEntry& findEntry(std::vector<ZEntry>& list, const std::string& name) {
    for (auto& e : list)
        if (e.name == name) return e;
    throw std::runtime_error("no entry " + name);
}

// Manifest (stored) then the files sorted by path bytes: generate.mjs's pack().
inline std::string pack(const Files& files, const PackOptions& o = {}) {
    ojson m = manifestFor(files);
    if (o.manifest) {
        o.manifest(m);
        if (o.recomputeDigest && m.contains("files") && m["files"].is_array()) {
            try {
                m["digest"] = digestOfFiles(m["files"]);
            } catch (const std::exception&) {
                // files[] made invalid on purpose: the digest stays as it was
            }
        }
    }
    const std::string mbytes = o.manifestBytes ? o.manifestBytes(m) : jsonText(m);
    std::vector<ZEntry> list{storedEntry(kPackageManifestName, mbytes)};
    for (const auto& [path, content] : files) {
        const auto it = o.methods.find(path);
        list.push_back(it != o.methods.end() && it->second == 8 ? deflateEntry(path, content)
                                                                : storedEntry(path, content));
    }
    if (o.entries) o.entries(list);
    return buildZip(list, o.zip);
}

// Inserts `e` after the manifest at its place in path byte order.
inline void insertSorted(std::vector<ZEntry>& list, ZEntry e) {
    auto it = std::find_if(list.begin() + 1, list.end(),
                           [&](const ZEntry& x) { return x.name > e.name; });
    list.insert(it, std::move(e));
}

// ---- Shared vectors (tests/package-vectors)

struct Vector {
    std::string name;
    nlohmann::json expected;
    std::string file;  // the package: <name>/package.matscada or the generated file of out/
    bool generated = false;
};

inline std::vector<std::string> vectorDirNames() {
    std::vector<std::string> out;
    DIR* d = ::opendir(kVectorDir.c_str());
    if (!d) return out;
    while (const dirent* e = ::readdir(d)) {
        const std::string n = e->d_name;
        if (n != "." && n != ".." && exists(kVectorDir + "/" + n + "/expected.json"))
            out.push_back(n);
    }
    ::closedir(d);
    std::sort(out.begin(), out.end());
    return out;
}

inline Vector vectorNamed(const std::string& name) {
    Vector v;
    v.name = name;
    v.expected = nlohmann::json::parse(readFile(kVectorDir + "/" + name + "/expected.json"));
    if (v.expected.contains("generated")) {
        v.generated = true;
        v.file = kVectorDir + "/" + v.expected["generated"].get<std::string>();
    } else {
        v.file = kVectorDir + "/" + name + "/package.matscada";
    }
    return v;
}

// Vectors of whole packages: `ok` or `code` in expected.json (digest-* vectors have neither).
inline std::vector<std::string> packageVectorNames() {
    std::vector<std::string> out;
    for (const auto& n : vectorDirNames()) {
        const Vector v = vectorNamed(n);
        if (v.expected.contains("ok") || v.expected.contains("code")) out.push_back(n);
    }
    return out;
}

inline std::string paramName(const ::testing::TestParamInfo<std::string>& i) {
    std::string n = i.param;
    std::replace(n.begin(), n.end(), '-', '_');
    return n;
}

inline const PackageSchema& schema() {
    static const std::unique_ptr<PackageSchema> s = [] {
        std::string error;
        auto p = PackageSchema::loadFromDir(kSchemasDir, error);
        if (!p) throw std::runtime_error("package schema: " + error);
        return p;
    }();
    return *s;
}

// ---- Assertions on results (PackageCheck comes from package_check.hpp, included by the tests)

template <typename Check>
std::string describe(const Check& r) {
    return r.ok ? "ok " + r.manifest.digest
                : r.error.code + " '" + r.error.path + "' " + r.error.message;
}

template <typename Check>
::testing::AssertionResult isPkgError(const Check& r, const std::string& code,
                                      const std::string& path) {
    if (!r.ok && r.error.code == code && r.error.path == path) return ::testing::AssertionSuccess();
    return ::testing::AssertionFailure()
           << "want " << code << " '" << path << "', got " << describe(r);
}

template <typename Check>
::testing::AssertionResult isPkgOk(const Check& r) {
    if (r.ok) return ::testing::AssertionSuccess();
    return ::testing::AssertionFailure() << "want ok, got " << describe(r);
}

#define EXPECT_PKG_ERROR(result, code, path) \
    EXPECT_TRUE(::mat::test::isPkgError((result), (code), (path)))
#define EXPECT_PKG_OK(result) EXPECT_TRUE(::mat::test::isPkgOk(result))

// ---- Temporary directories

inline void removeTree(const std::string& p) {
    struct stat st {};
    if (::lstat(p.c_str(), &st) != 0) return;
    if (S_ISDIR(st.st_mode)) {
        ::chmod(p.c_str(), 0700);
        if (DIR* d = ::opendir(p.c_str())) {
            std::vector<std::string> names;
            while (const dirent* e = ::readdir(d)) {
                const std::string n = e->d_name;
                if (n != "." && n != "..") names.push_back(n);
            }
            ::closedir(d);
            for (const auto& n : names) removeTree(p + "/" + n);
        }
        ::rmdir(p.c_str());
    } else {
        ::unlink(p.c_str());
    }
}

class TempDir {
   public:
    TempDir() {
        char tmpl[] = "/tmp/mat-package-test-XXXXXX";
        if (!::mkdtemp(tmpl)) throw std::runtime_error("mkdtemp");
        path_ = tmpl;
    }
    ~TempDir() { removeTree(path_); }
    TempDir(const TempDir&) = delete;
    TempDir& operator=(const TempDir&) = delete;

    const std::string& path() const { return path_; }
    std::string operator/(const std::string& name) const { return path_ + "/" + name; }

   private:
    std::string path_;
};

// Every path under `root` (relative, sorted; directories end with '/'), without following
// symlinks.
inline std::vector<std::string> listTree(const std::string& root, const std::string& rel = "") {
    std::vector<std::string> out;
    DIR* d = ::opendir((root + (rel.empty() ? "" : "/" + rel)).c_str());
    if (!d) return out;
    std::vector<std::string> names;
    while (const dirent* e = ::readdir(d)) {
        const std::string n = e->d_name;
        if (n != "." && n != "..") names.push_back(n);
    }
    ::closedir(d);
    for (const auto& n : names) {
        const std::string r = rel.empty() ? n : rel + "/" + n;
        struct stat st {};
        ::lstat((root + "/" + r).c_str(), &st);
        if (S_ISDIR(st.st_mode)) {
            out.push_back(r + "/");
            for (auto& x : listTree(root, r)) out.push_back(std::move(x));
        } else {
            out.push_back(r);
        }
    }
    std::sort(out.begin(), out.end());
    return out;
}

}  // namespace mat::test
