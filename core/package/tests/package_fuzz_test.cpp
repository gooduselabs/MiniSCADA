// T092 (feature 005, specs/005-device-online/contracts/matscada-package.md): 10,000 mutations of
// the valid vectors with a fixed seed (bit flips, truncation, length/offset/count fields set to
// edge values, bytes inserted or removed, regions copied over others, manifest and file bytes
// changed with their CRC fixed so the later stages run). Every variant must give a valid
// package or an E_PKG_* code: no crash, no read outside the package (MemorySource refuses it,
// which would show as STORE_IO), and every tenth variant is also extracted, with nothing written
// outside the staging area and nothing left behind on error. Run it under ASan/UBSan too
// (feature 005 ADR-012, T092 notes).
#include <gtest/gtest.h>

#include <iostream>
#include <map>

#include "core/common/tests/fuzz_util.hpp"
#include "core/package/extract.hpp"
#include "core/package/tests/package_test_support.hpp"

using namespace mat;
using namespace mat::test;

namespace {

// splitmix64: the same sequence on every platform (std:: distributions are not portable).
struct Rng {
    uint64_t s;
    uint64_t next() {
        uint64_t z = (s += 0x9e3779b97f4a7c15ull);
        z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ull;
        z = (z ^ (z >> 27)) * 0x94d049bb133111ebull;
        return z ^ (z >> 31);
    }
    size_t below(size_t n) { return n == 0 ? 0 : static_cast<size_t>(next() % n); }
};

struct Field {
    size_t at;
    int width;
};

struct StoredData {
    size_t at, len;               // data of a stored entry
    size_t crcCentral, crcLocal;  // offsets of its two CRC fields
};

struct Seed {
    std::string name;
    std::string bytes;
    std::vector<Field> fields;       // length, offset, count, size, CRC, method, flags… fields
    std::vector<StoredData> stored;  // stored entries (index 0: the manifest)
};

Seed seedOf(const std::string& vector) {
    Seed s;
    s.name = vector;
    s.bytes = readFile(vectorNamed(vector).file);
    const std::string& z = s.bytes;
    const size_t eocd = z.size() - 22;
    for (auto [at, w] : std::vector<std::pair<size_t, int>>{
             {4, 2}, {6, 2}, {8, 2}, {10, 2}, {12, 4}, {16, 4}, {20, 2}})
        s.fields.push_back({eocd + at, w});
    const uint16_t count = le16(z, eocd + 10);
    size_t p = le32(z, eocd + 16);
    for (int i = 0; i < count; ++i) {
        for (auto [at, w] : std::vector<std::pair<size_t, int>>{{4, 2},
                                                                {6, 2},
                                                                {8, 2},
                                                                {10, 2},
                                                                {16, 4},
                                                                {20, 4},
                                                                {24, 4},
                                                                {28, 2},
                                                                {30, 2},
                                                                {32, 2},
                                                                {34, 2},
                                                                {38, 4},
                                                                {42, 4}})
            s.fields.push_back({p + at, w});
        const size_t local = le32(z, p + 42);
        for (auto [at, w] : std::vector<std::pair<size_t, int>>{
                 {4, 2}, {6, 2}, {8, 2}, {14, 4}, {18, 4}, {22, 4}, {26, 2}, {28, 2}})
            s.fields.push_back({local + at, w});
        const uint16_t nlen = le16(z, p + 28);
        if (le16(z, p + 10) == 0)
            s.stored.push_back({local + 30 + nlen, le32(z, p + 24), p + 16, local + 14});
        p += 46 + nlen + le16(z, p + 30) + le16(z, p + 32);
    }
    return s;
}

uint64_t interesting(Rng& rng, uint64_t original, int width, size_t size) {
    const uint64_t max = width == 2 ? 0xFFFFull : 0xFFFFFFFFull;
    const uint64_t pick[] = {0,
                             1,
                             2,
                             max,
                             max - 1,
                             width == 2 ? 0x8000ull : 0x80000000ull,
                             original + 1,
                             original - 1,
                             original * 2,
                             original / 2,
                             size,
                             size - 22,
                             size + 1,
                             1024,
                             1025,
                             rng.next()};
    return pick[rng.below(sizeof pick / sizeof pick[0])] & max;
}

std::string mutate(const Seed& s, Rng& rng, std::string& kind) {
    std::string z = s.bytes;
    switch (rng.below(7)) {
        case 0: {  // flip 1–8 bits
            kind = "bits";
            for (size_t n = 1 + rng.below(8); n > 0; --n)
                z[rng.below(z.size())] ^= static_cast<char>(1u << rng.below(8));
            break;
        }
        case 1:  // cut
            kind = "truncate";
            z.resize(rng.below(z.size()));
            break;
        case 2: {  // a header field
            kind = "field";
            for (size_t n = 1 + rng.below(2); n > 0; --n) {
                const Field& f = s.fields[rng.below(s.fields.size())];
                const uint64_t v = f.width == 2 ? le16(z, f.at) : le32(z, f.at);
                setLe(z, f.at, interesting(rng, v, f.width, z.size()), f.width);
            }
            break;
        }
        case 3: {  // insert or remove bytes
            kind = "splice";
            const size_t at = rng.below(z.size());
            const size_t n = 1 + rng.below(16);
            if (rng.below(2)) {
                std::string junk;
                for (size_t i = 0; i < n; ++i) junk += static_cast<char>(rng.next());
                z.insert(at, junk);
            } else {
                z.erase(at, n);
            }
            break;
        }
        case 4: {  // copy a region over another one (overlapping entries, duplicated headers)
            kind = "copy";
            const size_t len = 1 + rng.below(64);
            const size_t from = rng.below(z.size()), to = rng.below(z.size());
            for (size_t i = 0; i < len && from + i < z.size() && to + i < z.size(); ++i)
                z[to + i] = s.bytes[from + i];
            break;
        }
        default: {  // bytes of the manifest (case 5) or of a stored file (6), CRC fixed
            const bool manifest = rng.below(2) == 0 || s.stored.size() < 2;
            kind = manifest ? "manifest" : "content";
            if (s.stored.empty()) break;
            const StoredData& d =
                manifest ? s.stored[0] : s.stored[1 + rng.below(s.stored.size() - 1)];
            if (d.len == 0) break;
            static const char kChars[] = "{}[],:\"\\0123456789.-eEtrufalsn \n\x7f\xc3\xff";
            for (size_t n = 1 + rng.below(3); n > 0; --n) {
                const size_t at = d.at + rng.below(d.len);
                z[at] = rng.below(2) ? kChars[rng.below(sizeof kChars - 1)]
                                     : static_cast<char>(rng.next());
            }
            const uint32_t crc = crc32(std::string_view(z).substr(d.at, d.len));
            setLe(z, d.crcCentral, crc, 4);
            setLe(z, d.crcLocal, crc, 4);
            break;
        }
    }
    return z;
}

}  // namespace

TEST(PackageFuzz, TenThousandMutationsGiveAValidPackageOrAnEPkgCode) {
    std::vector<Seed> seeds;
    for (const char* v :
         {"valid-tank-demo-deflate", "valid-tank-demo-stored", "valid-vietnamese-names",
          "valid-manifest-extensions", "valid-device-tank-demo"}) {
        ASSERT_TRUE(exists(vectorNamed(v).file)) << v;
        seeds.push_back(seedOf(v));
        ASSERT_GT(seeds.back().fields.size(), 50u) << v;
    }
    Rng rng{0x6d61742d70616b67ull};  // fixed seed: "mat-pakg"
    TempDir tmp;
    const std::string sandbox = tmp / "l1/l2/l3";
    ASSERT_EQ(::mkdir((tmp / "l1").c_str(), 0700), 0);
    ASSERT_EQ(::mkdir((tmp / "l1/l2").c_str(), 0700), 0);
    ASSERT_EQ(::mkdir(sandbox.c_str(), 0700), 0);
    const std::vector<std::string> emptyTree{"l1/", "l1/l2/", "l1/l2/l3/"};
    ExtractOptions noSync;
    noSync.fsync = [](int) { return 0; };  // fsync is tested in extract_test

    std::map<std::string, int> byCode, byKind;
    int variants = 0, extractions = 0, ok = 0;
    for (int i = 0; i < 10000; ++i) {
        const Seed& s = seeds[static_cast<size_t>(i) % seeds.size()];
        std::string kind;
        const std::string bytes = mutate(s, rng, kind);
        MemorySource src(bytes);
        const PackageCheck r = checkPackage(src, schema());
        ++variants;
        ++byKind[kind];
        ++byCode[r.ok ? "ok" : r.error.code];
        ASSERT_TRUE(r.ok || r.error.code.rfind("E_PKG_", 0) == 0)
            << "variant " << i << " (" << kind << " of " << s.name << "): " << r.error.code << " "
            << r.error.message;
        if (r.ok) {
            ++ok;
            ASSERT_EQ(r.manifest.digest.size(), 71u);
            ASSERT_FALSE(r.manifest.files.empty());
        } else {
            ASSERT_FALSE(r.error.message.empty());
        }
        if (i % 10 == 0) {
            const std::string dest = sandbox + "/x" + std::to_string(i);
            MemorySource again(bytes);
            const PackageCheck e = extractPackage(again, schema(), dest, noSync);
            ++extractions;
            ASSERT_EQ(e.ok, r.ok) << i;
            ASSERT_EQ(e.error.code, r.error.code) << i;
            if (e.ok) {
                size_t files = 0;
                for (const auto& p : listTree(dest))
                    if (p.back() != '/') ++files;
                ASSERT_EQ(files, e.manifest.files.size()) << i;
                removeTree(dest);
            }
            ASSERT_EQ(listTree(tmp.path()), emptyTree) << "variant " << i << " left files";
        }
    }
    EXPECT_EQ(variants, 10000);
    EXPECT_EQ(extractions, 1000);
    std::cout << "[ fuzz     ] " << variants << " variants, " << ok << " valid, " << extractions
              << " extracted\n[ fuzz     ]";
    for (const auto& [code, n] : byCode) std::cout << " " << code << "=" << n;
    std::cout << "\n[ fuzz     ]";
    for (const auto& [k, n] : byKind) std::cout << " " << k << "=" << n;
    std::cout << "\n";
    // The mutations reach the later stages, not only the ZIP structure.
    EXPECT_GT(byCode["E_PKG_FORMAT"], 0);
    EXPECT_GT(byCode["E_PKG_MANIFEST"], 0);
    EXPECT_GT(byCode["E_PKG_CHECKSUM"], 0);
}

// The same mutations for a time budget (feature 011 T058; FR-029): MAT_FUZZ_SECONDS (default 5
// under ctest; tools/fuzz/cpp/run.sh runs it for an hour under ASan + UBSan), seed MAT_FUZZ_SEED.
// A structured mutation, half the time byte mutations on top, every tenth variant extracted. Same
// invariants.
TEST(PackageFuzz, TimedMutationsGiveAValidPackageOrAnEPkgCode) {
    std::vector<Seed> seeds;
    for (const char* v :
         {"valid-tank-demo-deflate", "valid-tank-demo-stored", "valid-vietnamese-names",
          "valid-manifest-extensions", "valid-device-tank-demo"}) {
        ASSERT_TRUE(exists(vectorNamed(v).file)) << v;
        seeds.push_back(seedOf(v));
    }
    const double budget = fuzz::budgetSeconds(5);
    const uint64_t seed = fuzz::baseSeed();
    Rng rng{seed ^ 0x6d61742d70616b67ull};
    mat::fuzz::Rng frng{seed};
    TempDir tmp;
    const std::string sandbox = tmp / "l1/l2/l3";
    ASSERT_EQ(::mkdir((tmp / "l1").c_str(), 0700), 0);
    ASSERT_EQ(::mkdir((tmp / "l1/l2").c_str(), 0700), 0);
    ASSERT_EQ(::mkdir(sandbox.c_str(), 0700), 0);
    const std::vector<std::string> emptyTree{"l1/", "l1/l2/", "l1/l2/l3/"};
    ExtractOptions noSync;
    noSync.fsync = [](int) { return 0; };
    std::map<std::string, int64_t> byCode;
    int64_t variants = 0, extractions = 0;
    fuzz::Deadline deadline(budget);
    while (!deadline.passed()) {
        const Seed& base = seeds[rng.below(seeds.size())];
        std::string kind;
        // one structured mutation (field offsets are those of the seed), then sometimes byte
        // mutations on top (bounds-checked, any offset)
        std::string bytes = mutate(base, rng, kind);
        if (rng.below(2)) bytes = mat::fuzz::mutateText(bytes, frng, {});
        MemorySource src(bytes);
        const PackageCheck r = checkPackage(src, schema());
        ++variants;
        ++byCode[r.ok ? "ok" : r.error.code];
        ASSERT_TRUE(r.ok || r.error.code.rfind("E_PKG_", 0) == 0)
            << "variant " << variants << " seed " << seed << ": " << r.error.code << " "
            << r.error.message;
        if (r.ok) {
            ASSERT_FALSE(r.manifest.files.empty());
        }
        if (variants % 10 == 0) {
            const std::string dest = sandbox + "/x";
            MemorySource again(bytes);
            const PackageCheck e = extractPackage(again, schema(), dest, noSync);
            ++extractions;
            ASSERT_EQ(e.ok, r.ok) << variants;
            ASSERT_EQ(e.error.code, r.error.code) << variants;
            if (e.ok) removeTree(dest);
            ASSERT_EQ(listTree(tmp.path()), emptyTree) << "variant " << variants << " left files";
        }
    }
    std::cout << "fuzz package: " << variants << " inputs, " << extractions << " extracted, seed "
              << seed << ", " << budget << " s\n[ fuzz     ]";
    for (const auto& [code, n] : byCode) std::cout << " " << code << "=" << n;
    std::cout << "\n";
    EXPECT_GT(variants, 0);
}
