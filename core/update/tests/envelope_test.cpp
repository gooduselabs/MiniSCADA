// The envelope reader of .matupdate (feature 011 T090; contracts/update-package.md §1; FR-057,
// FR-061, FR-069): three members in order, headers checked (checksum, magic, type, name, size),
// no extension header, no fourth member, truncation at any byte, fixed-size reads only (the ASan
// build sees any read past a buffer). Then every vector of tests/update-vectors against the full
// check (verifyPackageFile) with the device of cases.json.
#include "core/update/envelope.hpp"

#include <gtest/gtest.h>

#include <string>
#include <vector>

#include "core/update/manifest.hpp"
#include "core/update/tests/update_test_support.hpp"
#include "core/update/verify.hpp"

namespace mat::update {
namespace {

using test::tarEnd;
using test::tarHeader;
using test::tarMember;

std::string envelopeOf(const std::string& manifest, const std::string& sig,
                       const std::string& payload) {
    return tarMember("update.json", manifest) + tarMember("update.sig", sig) +
           tarMember("payload.tar.gz", payload) + tarEnd();
}

struct Read {
    std::optional<Error> err;
    EnvelopeHead head;
    PayloadInfo info;
    std::string payload;
};

Read readAll(const std::string& bytes, uint64_t maxPayload = 1 << 20) {
    Read r;
    MemorySource in(reinterpret_cast<const uint8_t*>(bytes.data()), bytes.size());
    r.err = readHead(in, r.head);
    if (r.err) return r;
    r.err = readPayload(in, maxPayload, r.head, r.info, [&](const uint8_t* p, size_t n) {
        r.payload.append(reinterpret_cast<const char*>(p), n);
    });
    return r;
}

std::string detailOf(const Read& r) { return r.err ? r.err->detailCode : "ok"; }

TEST(UpdateEnvelope, ThreeMembersInOrderAreRead) {
    const std::string pkg = envelopeOf("{\"format\":\"1.0.0\"}", std::string(71, 'S'), "payload!");
    const Read r = readAll(pkg);
    ASSERT_FALSE(r.err) << r.err->detailCode << " " << r.err->detail;
    EXPECT_EQ(r.head.manifest, "{\"format\":\"1.0.0\"}");
    EXPECT_EQ(r.head.sig.size(), 71u);
    EXPECT_EQ(r.payload, "payload!");
    EXPECT_EQ(r.info.size, 8u);
    EXPECT_EQ(r.head.end, 4u * 512);     // h1 m h2 s
    EXPECT_EQ(r.info.offset, 5u * 512);  // h1 m h2 s h3
}

TEST(UpdateEnvelope, EmptyPayloadIsAllowed) {  // a keyset package
    const Read r = readAll(envelopeOf("{}", "sig", ""));
    ASSERT_FALSE(r.err);
    EXPECT_EQ(r.info.size, 0u);
}

TEST(UpdateEnvelope, ExtensionAndSpecialHeadersAreRefused) {
    for (char t : {'x', 'g', 'L', 'K', '1', '2', '5', '6'}) {
        const std::string pkg = tarHeader("update.json", 2, t) + std::string("{}") +
                                std::string(510, '\0') + tarMember("update.sig", "s") +
                                tarMember("payload.tar.gz", "p") + tarEnd();
        EXPECT_EQ(detailOf(readAll(pkg)), "ENVELOPE_HEADER") << "typeflag " << t;
    }
    // a NUL typeflag (old tar) is a regular file
    const std::string nul = tarHeader("update.json", 2, '\0') + std::string("{}") +
                            std::string(510, '\0') + tarMember("update.sig", "s") +
                            tarMember("payload.tar.gz", "p") + tarEnd();
    EXPECT_EQ(detailOf(readAll(nul)), "ok");
}

TEST(UpdateEnvelope, ChecksumAndMagicAreChecked) {
    std::string bad = tarHeader("update.json", 2, '0', 1) + std::string("{}") +
                      std::string(510, '\0') + tarMember("update.sig", "s") +
                      tarMember("payload.tar.gz", "p") + tarEnd();
    EXPECT_EQ(detailOf(readAll(bad)), "ENVELOPE_HEADER");
    std::string magic = tarHeader("update.json", 2, '0', 0, "pkzip") + std::string("{}") +
                        std::string(510, '\0') + tarMember("update.sig", "s") +
                        tarMember("payload.tar.gz", "p") + tarEnd();
    EXPECT_EQ(detailOf(readAll(magic)), "ENVELOPE_HEADER");
    // a size field that is not octal
    std::string size = tarHeader("update.json", 2);
    size[124] = '9';
    EXPECT_EQ(detailOf(readAll(size + std::string(512, '\0') + tarEnd())), "ENVELOPE_HEADER");
}

TEST(UpdateEnvelope, OrderAndNamesAreFixed) {
    EXPECT_EQ(detailOf(readAll(tarMember("update.sig", "s") + tarMember("update.json", "{}") +
                               tarMember("payload.tar.gz", "p") + tarEnd())),
              "ENVELOPE_ORDER");
    EXPECT_EQ(detailOf(readAll(tarMember("update.json", "{}") + tarMember("payload.tar.gz", "p") +
                               tarMember("update.sig", "s") + tarEnd())),
              "ENVELOPE_ORDER");
    EXPECT_EQ(detailOf(readAll(tarMember("./update.json", "{}") + tarMember("update.sig", "s") +
                               tarMember("payload.tar.gz", "p") + tarEnd())),
              "ENVELOPE_ORDER");
}

TEST(UpdateEnvelope, SizesOverTheLimitsAreRefusedBeforeReading) {
    // manifest > 256 KiB and signature > 128 B: refused from the header, no data needed
    EXPECT_EQ(detailOf(readAll(tarHeader("update.json", 256 * 1024 + 1))), "ENVELOPE_SIZE");
    EXPECT_EQ(detailOf(readAll(tarMember("update.json", "{}") + tarHeader("update.sig", 129))),
              "ENVELOPE_SIZE");
    // payload over the package limit
    const Read r = readAll(envelopeOf("{}", "s", std::string(2000, 'p')), 1000);
    EXPECT_EQ(detailOf(r), "ENVELOPE_SIZE");
    // a size of 8 GiB with nothing behind it: refused from the header, nothing allocated
    EXPECT_EQ(detailOf(readAll(tarHeader("update.json", 077777777777ULL))), "ENVELOPE_SIZE");
}

TEST(UpdateEnvelope, AFourthMemberOrGarbageAfterThePayloadIsRefused) {
    const std::string three = tarMember("update.json", "{}") + tarMember("update.sig", "s") +
                              tarMember("payload.tar.gz", "p");
    EXPECT_EQ(detailOf(readAll(three + tarMember("extra", "x") + tarEnd())),
              "ENVELOPE_EXTRA_MEMBER");
    EXPECT_EQ(detailOf(readAll(three + std::string(511, '\0') + "x" + std::string(512, '\0'))),
              "ENVELOPE_EXTRA_MEMBER");
    // only one zero block: truncated end of archive
    EXPECT_EQ(detailOf(readAll(three + std::string(512, '\0'))), "ENVELOPE_TRUNCATED");
}

TEST(UpdateEnvelope, EveryTruncationIsRefusedWithoutReadingPastTheEnd) {
    const std::string pkg =
        envelopeOf(std::string(700, 'm'), std::string(72, 's'), std::string(1500, 'p'));
    ASSERT_EQ(detailOf(readAll(pkg)), "ok");
    for (size_t n = 0; n < pkg.size(); ++n) {
        // a copy of exactly n bytes: ASan sees a read past it
        const std::string cut = pkg.substr(0, n);
        const Read r = readAll(cut);
        ASSERT_TRUE(r.err) << "truncated at " << n;
        EXPECT_EQ(r.err->detailCode, "ENVELOPE_TRUNCATED") << "at " << n;
    }
}

TEST(UpdateEnvelope, FileSourceReadsAndSeeks) {
    test::UpdTempDir d;
    const std::string pkg = envelopeOf("{}", "s", "abcdef");
    test::writeBytes(d.file("p"), pkg);
    FileSource f;
    std::string err;
    ASSERT_TRUE(f.open(d.file("p"), err)) << err;
    EXPECT_EQ(f.size(), pkg.size());
    EnvelopeHead head;
    ASSERT_FALSE(readHead(f, head));
    PayloadInfo info;
    std::string got;
    ASSERT_FALSE(readPayload(f, 100, head, info,
                             [&](const uint8_t* p, size_t n) { got.append((const char*)p, n); }));
    EXPECT_EQ(got, "abcdef");
    ASSERT_TRUE(f.seek(info.offset));
    char c[3] = {};
    EXPECT_EQ(f.read(reinterpret_cast<uint8_t*>(c), 3), 3u);
    EXPECT_EQ(std::string(c, 3), "abc");
    FileSource none;
    EXPECT_FALSE(none.open(d.file("missing"), err));
}

// ---------------------------------------------------------------- the shared vectors

KeySet trusted() { return loadTrustedKeys(test::vectorPath("keys-trusted")); }

DeviceContext deviceOf(const nlohmann::json& d, const nlohmann::json& patch) {
    DeviceContext c;
    nlohmann::json m = d;
    if (patch.is_object()) m.update(patch);
    c.arch = m.at("arch").get<std::string>();
    c.version = m.at("version").get<std::string>();
    c.releaseSeq = m.at("releaseSeq").get<int64_t>();
    c.projectFormat = m.at("projectFormat").get<std::string>();
    c.maxPackageBytes = m.at("maxPackageBytes").get<uint64_t>();
    return c;
}

TEST(UpdateVectors, TheValidPackagePasses) {
    const auto meta = test::vectorCases();
    const KeySet keys = trusted();
    ASSERT_EQ(keys.keys.size(), 1u);
    Verified v;
    const auto err = verifyPackageFile(test::vectorPath(meta["valid"]["file"]), keys,
                                       deviceOf(meta["device"], nullptr), v);
    ASSERT_FALSE(err) << err->code << " " << err->detailCode << " " << err->detail;
    EXPECT_EQ(v.signerKeyId, meta["valid"]["keyId"].get<std::string>());
    EXPECT_EQ(v.signerLabel, "test-ec-p256");
    EXPECT_EQ(v.manifest.version, "1.0.1");
    EXPECT_EQ(v.manifest.releaseSeq, 11);
    ASSERT_EQ(v.manifest.files.size(), meta["valid"]["files"].size());
    for (size_t i = 0; i < v.manifest.files.size(); ++i) {
        EXPECT_EQ(v.manifest.files[i].path, meta["valid"]["files"][i]["path"]);
        EXPECT_EQ(v.manifest.files[i].sha256, meta["valid"]["files"][i]["sha256"]);
    }
    EXPECT_EQ(v.packageSize, test::readBytes(test::vectorPath("valid.matupdate")).size());
    EXPECT_EQ(v.packageSha256.size(), 64u);
}

TEST(UpdateVectors, EveryBadPackageIsRefusedWithItsCode) {
    const auto meta = test::vectorCases();
    const KeySet keys = trusted();
    int checked = 0;
    for (const auto& c : meta["cases"]) {
        if (c.contains("api")) continue;  // a request, not a package: update_api_test
        const std::string path = test::vectorPath(c["file"]);
        if (c.value("generated", false))
            ASSERT_TRUE(test::exists(path))
                << path << " missing: run node tools/release/make-update.mjs --vectors --out";
        Verified v;
        const auto err = verifyPackageFile(
            path, keys, deviceOf(meta["device"], c.value("device", nlohmann::json())), v);
        const auto& e = c["expect"];
        ASSERT_TRUE(err) << c["name"] << " accepted";
        EXPECT_EQ(err->code, e["code"].get<std::string>()) << c["name"] << " " << err->detail;
        EXPECT_EQ(err->detailCode, e.value("detailCode", "")) << c["name"] << " " << err->detail;
        EXPECT_EQ(err->http, e["http"].get<int>()) << c["name"];
        EXPECT_EQ(err->exit, e["exit"].get<int>()) << c["name"];
        ++checked;
    }
    EXPECT_GE(checked, 28);
}

TEST(UpdateVectors, NoTrustedKeyIsKeysMissing) {
    test::UpdTempDir d;
    Verified v;
    const auto err =
        verifyPackageFile(test::vectorPath("valid.matupdate"), loadTrustedKeys(d.path()), {}, v);
    ASSERT_TRUE(err);
    EXPECT_EQ(err->code, "UPDATE_KEYS_MISSING");
    EXPECT_EQ(err->exit, kExitKeys);
}

TEST(UpdateVectors, WithoutADeviceOnlyThePackageIsChecked) {
    // releaseSeq 10 is a downgrade for the vector device, not for "no device"
    Verified v;
    EXPECT_FALSE(
        verifyPackageFile(test::vectorPath("bad/16-downgrade.matupdate"), trusted(), {}, v));
    EXPECT_FALSE(verifyPackageFile(test::vectorPath("bad/15-arch.matupdate"), trusted(), {}, v));
    // the package's own faults stay
    EXPECT_TRUE(
        verifyPackageFile(test::vectorPath("bad/08-path-traversal.matupdate"), trusted(), {}, v));
}

// mat-updater runs `chmod <mode>` (as root) with the mode of files[]: only 0644 and 0755 may pass
// (review 011, T062); setuid, setgid, sticky, group or world writable, unreadable all refused.
TEST(UpdateManifest, OnlyModes0644And0755PassTheFileList) {
    auto withMode = [](int mode) {
        Manifest m;
        m.kind = "runtime";
        m.payloadSize = 1000;
        FileEntry bin{"bin/mat-runtime", std::string(64, 'a'), 10, 0755};
        FileEntry web{"web/index.html", std::string(64, 'b'), 10, mode};
        m.files = {bin, web};
        return checkFileList(m, "");
    };
    EXPECT_FALSE(withMode(0644));
    EXPECT_FALSE(withMode(0755));
    for (int mode : {0, 0400, 0444, 0555, 0600, 0640, 0664, 0666, 0700, 0750, 0775, 0777, 01755,
                     02755, 04755, 06755, 07777, 0645, 0754}) {
        const auto err = withMode(mode);
        ASSERT_TRUE(err) << std::oct << mode;
        EXPECT_EQ(err->detailCode, "MODE_FORBIDDEN") << std::oct << mode;
    }
    // the mode as text: 3 or 4 octal digits, else refused while parsing
    auto parsed = [](const std::string& mode) {
        const std::string json =
            R"({"format":"1.0.0","kind":"runtime","product":"mat-runtime","version":"1.0.1",)"
            R"("releaseSeq":11,"arch":"armhf","minFromVersion":"1.0.0","projectFormatMax":"1.0.0",)"
            R"("updaterRequired":1,"createdAt":"2026-10-17T00:00:00Z","payloadSha256":")" +
            std::string(64, 'c') +
            R"(","payloadSize":1000,"files":[{"path":"bin/mat-runtime","sha256":")" +
            std::string(64, 'a') + R"(","size":10,"mode":")" + mode + R"("}]})";
        Manifest m;
        auto err = parseManifest(json, m);
        if (!err) err = checkFileList(m, "");
        return err;
    };
    EXPECT_FALSE(parsed("0755"));
    EXPECT_FALSE(parsed("755"));
    for (const char* bad : {"75", "07555", "0758", "-755", "0x1ed", "u+s", "a+rwx", "+0755", " 755",
                            "0755 ", "4755", "0777"}) {
        const auto err = parsed(bad);
        ASSERT_TRUE(err) << bad;
        EXPECT_EQ(err->detailCode, "MODE_FORBIDDEN") << bad;
    }
}

}  // namespace
}  // namespace mat::update
