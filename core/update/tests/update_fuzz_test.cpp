// Fuzz of the update package reader (feature 011 T118; FR-029; contracts/update-package.md §7):
// deterministic mutations (seeded, reproducible) of the packages of tests/update-vectors through
//   envelope  verifyPackage on the whole package (bit flips, byte values, cuts, insertions, header
//             fields rewritten with a right checksum so the reader goes deeper, member sizes)
//   manifest  parseManifest + checkFileList on mutated update.json text (no signature in the way)
//   payload   scanPayload on mutated payload.tar.gz against the manifest of the valid package
// Invariants: never a crash, a hang or a sanitizer report (the ASan + UBSan build of
// tools/fuzz/update-envelope.ps1); an accepted mutation carries the manifest of its seed (a change
// of the signed bytes is never accepted). MAT_FUZZ_SECONDS (default 20, split over the three
// targets), MAT_FUZZ_SEED. The corpus is tests/update-vectors (valid, keyset and bad packages).
#include <dirent.h>
#include <gtest/gtest.h>

#include <chrono>
#include <cstdlib>
#include <cstring>
#include <random>
#include <set>
#include <string>
#include <vector>

#include "core/update/envelope.hpp"
#include "core/update/manifest.hpp"
#include "core/update/payload.hpp"
#include "core/update/tests/update_test_support.hpp"
#include "core/update/verify.hpp"

namespace mat::update {
namespace {

double seconds() {
    const char* e = std::getenv("MAT_FUZZ_SECONDS");
    return e ? std::atof(e) : 20.0;
}
uint64_t baseSeed() {
    const char* e = std::getenv("MAT_FUZZ_SEED");
    return e ? std::strtoull(e, nullptr, 10) : 20261017;
}

std::vector<std::string> corpus() {
    std::vector<std::string> out = {test::readBytes(test::vectorPath("valid.matupdate")),
                                    test::readBytes(test::vectorPath("keyset-add.matupdate"))};
    const std::string bad = test::vectorPath("bad");
    if (DIR* d = ::opendir(bad.c_str())) {
        while (dirent* e = ::readdir(d)) {
            const std::string n = e->d_name;
            if (n.size() > 10 && n.compare(n.size() - 10, 10, ".matupdate") == 0)
                out.push_back(test::readBytes(bad + "/" + n));
        }
        ::closedir(d);
    }
    return out;
}

// Rewrites the checksum of the ustar header at `off` so a mutated header is read further.
void fixChecksum(std::string& b, size_t off) {
    if (off + 512 > b.size()) return;
    unsigned sum = 0;
    for (size_t i = 0; i < 512; ++i)
        sum += (i >= 148 && i < 156) ? ' ' : static_cast<unsigned char>(b[off + i]);
    char f[9];
    std::snprintf(f, sizeof f, "%06o", sum & 0777777);
    std::memcpy(&b[off + 148], f, 6);
    b[off + 154] = '\0';
    b[off + 155] = ' ';
}

std::string mutate(std::string b, std::mt19937_64& rng) {
    auto pick = [&](size_t n) { return n ? static_cast<size_t>(rng() % n) : 0; };
    const int ops = 1 + static_cast<int>(rng() % 4);
    for (int k = 0; k < ops && !b.empty(); ++k) {
        switch (rng() % 9) {
            case 0:  // bit flip
                b[pick(b.size())] ^= static_cast<char>(1u << (rng() % 8));
                break;
            case 1: {  // interesting byte
                static const unsigned char v[] = {0,   0xff, 0x7f, 0x80, '0', '7',
                                                  '8', ' ',  'x',  'L',  '5', '2'};
                b[pick(b.size())] = static_cast<char>(v[rng() % sizeof v]);
                break;
            }
            case 2:  // cut
                b.resize(pick(b.size() + 1));
                break;
            case 3: {  // insert
                const size_t at = pick(b.size() + 1);
                b.insert(at, std::string(1 + rng() % 600, static_cast<char>(rng())));
                break;
            }
            case 4: {  // a header field (size, type, name) with the checksum made right
                const size_t blocks = b.size() / 512;
                const size_t off = 512 * pick(blocks ? blocks : 1);
                if (off + 512 > b.size()) break;
                const int f = static_cast<int>(rng() % 3);
                if (f == 0) {
                    char s[13];
                    std::snprintf(s, sizeof s, "%011llo",
                                  static_cast<unsigned long long>(rng() % (1ULL << 33)));
                    std::memcpy(&b[off + 124], s, 11);
                } else if (f == 1) {
                    b[off + 156] = "0125x gLK3467"[rng() % 13];
                } else {
                    b[off + pick(100)] = static_cast<char>(rng());
                }
                fixChecksum(b, off);
                break;
            }
            case 5: {  // duplicate a block
                const size_t blocks = b.size() / 512;
                if (!blocks) break;
                const size_t from = 512 * pick(blocks);
                b.insert(512 * pick(blocks + 1), b.substr(from, 512));
                break;
            }
            case 6: {  // swap two blocks
                const size_t blocks = b.size() / 512;
                if (blocks < 2) break;
                const size_t x = 512 * pick(blocks), y = 512 * pick(blocks);
                std::string t = b.substr(x, 512);
                b.replace(x, 512, b.substr(y, 512));
                b.replace(y, 512, t);
                break;
            }
            case 7:  // zero a run
                std::memset(&b[pick(b.size())], 0, 1);
                break;
            default:  // append garbage after the end
                b.append(std::string(1 + rng() % 2000, static_cast<char>(rng() % 3 ? 0 : rng())));
        }
    }
    return b;
}

KeySet keys() { return loadTrustedKeys(test::vectorPath("keys-trusted")); }

DeviceContext device() {
    DeviceContext d;
    d.arch = "armhf";
    d.version = "1.0.0";
    d.releaseSeq = 10;
    d.projectFormat = "1.0.0";
    d.maxPackageBytes = 8 << 20;
    return d;
}

TEST(UpdateFuzz, Envelope) {
    const auto seeds = corpus();
    ASSERT_GE(seeds.size(), 30u);
    const KeySet k = keys();
    const DeviceContext dev = device();
    std::mt19937_64 rng(baseSeed());
    const auto end =
        std::chrono::steady_clock::now() + std::chrono::duration<double>(seconds() / 3);
    uint64_t n = 0, accepted = 0;
    // The manifests the trusted key really signed (some bad seeds hold one: a member out of order,
    // a fourth member, a wrong header checksum; a mutation may repair those, and that is right).
    // Whatever is accepted must carry one of them: the signature is never bypassed.
    std::set<std::string> signedManifests;
    for (const std::string& seed : seeds) {
        for (size_t at = 0; at + 1024 <= seed.size(); at += 512) {  // update.json wherever it sits
            if (seed.compare(at, 11, "update.json") != 0) continue;
            uint64_t size = 0;
            if (checkMemberHeader(reinterpret_cast<const uint8_t*>(seed.data() + at), "update.json",
                                  kManifestMaxBytes, size) ||
                at + 512 + size > seed.size())
                continue;
            signedManifests.insert(seed.substr(at + 512, size));
        }
    }
    ASSERT_FALSE(signedManifests.empty());
    while (std::chrono::steady_clock::now() < end) {
        const size_t i = rng() % seeds.size();
        const std::string m = mutate(seeds[i], rng);
        MemorySource src(reinterpret_cast<const uint8_t*>(m.data()), m.size());
        Verified v;
        const auto e = verifyPackage(src, m.size(), k, dev, v);
        if (!e) {
            ++accepted;
            // accepted only with a manifest the key signed, unchanged
            MemorySource again(reinterpret_cast<const uint8_t*>(m.data()), m.size());
            EnvelopeHead head;
            ASSERT_FALSE(readHead(again, head));
            ASSERT_TRUE(signedManifests.count(head.manifest))
                << "mutation " << n << " of seed " << i;
            ASSERT_TRUE(k.verify(reinterpret_cast<const uint8_t*>(head.manifest.data()),
                                 head.manifest.size(), head.sig.data(), head.sig.size()));
        }
        ++n;
    }
    std::printf("fuzz envelope: %llu inputs, %llu accepted (signed manifest intact), seed %llu\n",
                static_cast<unsigned long long>(n), static_cast<unsigned long long>(accepted),
                static_cast<unsigned long long>(baseSeed()));
    EXPECT_GT(n, 100u);
}

TEST(UpdateFuzz, Manifest) {
    const std::string pkg = test::readBytes(test::vectorPath("valid.matupdate"));
    MemorySource in(reinterpret_cast<const uint8_t*>(pkg.data()), pkg.size());
    EnvelopeHead head;
    ASSERT_FALSE(readHead(in, head));
    std::mt19937_64 rng(baseSeed() + 1);
    const auto end =
        std::chrono::steady_clock::now() + std::chrono::duration<double>(seconds() / 3);
    uint64_t n = 0;
    while (std::chrono::steady_clock::now() < end) {
        std::string m = head.manifest;
        const int ops = 1 + static_cast<int>(rng() % 6);
        for (int k = 0; k < ops && !m.empty(); ++k) {
            const size_t at = rng() % m.size();
            switch (rng() % 5) {
                case 0:
                    m[at] = "{}[]\",:0123456789-.eE\\/ ntfu"[rng() % 28];
                    break;
                case 1:
                    m.erase(at, 1 + rng() % 8);
                    break;
                case 2:
                    m.insert(at, std::string(1 + rng() % 4, "\"{[0"[rng() % 4]));
                    break;
                case 3:
                    m.insert(at, "\"../../x\"");
                    break;
                default:
                    m[at] = static_cast<char>(rng());
            }
        }
        Manifest man;
        if (!parseManifest(m, man)) (void)checkFileList(man, "sha256:" + std::string(64, 'a'));
        ++n;
    }
    std::printf("fuzz manifest: %llu inputs\n", static_cast<unsigned long long>(n));
    EXPECT_GT(n, 100u);
}

TEST(UpdateFuzz, Payload) {
    const std::string pkg = test::readBytes(test::vectorPath("valid.matupdate"));
    MemorySource in(reinterpret_cast<const uint8_t*>(pkg.data()), pkg.size());
    EnvelopeHead head;
    ASSERT_FALSE(readHead(in, head));
    Manifest man;
    ASSERT_FALSE(parseManifest(head.manifest, man));
    PayloadInfo info;
    std::string payload;
    ASSERT_FALSE(readPayload(in, 1 << 20, head, info, [&](const uint8_t* p, size_t n) {
        payload.append(reinterpret_cast<const char*>(p), n);
    }));
    {
        MemorySource ok(reinterpret_cast<const uint8_t*>(payload.data()), payload.size());
        ASSERT_FALSE(scanPayload(ok, payload.size(), man));
    }
    std::mt19937_64 rng(baseSeed() + 2);
    const auto end =
        std::chrono::steady_clock::now() + std::chrono::duration<double>(seconds() / 3);
    uint64_t n = 0;
    while (std::chrono::steady_clock::now() < end) {
        const std::string m = mutate(payload, rng);
        MemorySource src(reinterpret_cast<const uint8_t*>(m.data()), m.size());
        (void)scanPayload(src, m.size(), man);
        ++n;
    }
    std::printf("fuzz payload: %llu inputs\n", static_cast<unsigned long long>(n));
    EXPECT_GT(n, 100u);
}

}  // namespace
}  // namespace mat::update
