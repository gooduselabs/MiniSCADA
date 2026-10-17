// Signatures and trusted keys of the update path (feature 011 T090; contracts/update-package.md §3,
// release-signing.md §5; FR-057, FR-066, FR-069): ECDSA P-256 DER over SHA-256, keyId of the SPKI,
// the trusted-keys directory (≤ 4 keys, other files skipped), SHA256SUMS and its .sig, the path
// rules of files[] and the version order used against downgrades.
#include "core/update/signature.hpp"

#include <gtest/gtest.h>
#include <sys/stat.h>

#include <string>

#include "core/update/manifest.hpp"
#include "core/update/paths.hpp"
#include "core/update/tests/update_test_support.hpp"
#include "core/update/verify.hpp"

namespace mat::update {
namespace {

std::string pub() { return test::readBytes(test::vectorPath("keys-trusted/test-ec-p256.pem")); }
std::string otherPub() {
    return test::readBytes(test::vectorPath("keys/test-ec-p256-other.pub.pem"));
}

// update.json and update.sig of the valid vector, taken apart with the envelope reader
EnvelopeHead validHead() {
    const std::string pkg = test::readBytes(test::vectorPath("valid.matupdate"));
    MemorySource in(reinterpret_cast<const uint8_t*>(pkg.data()), pkg.size());
    EnvelopeHead h;
    EXPECT_FALSE(readHead(in, h));
    return h;
}

TEST(UpdateSignature, KeyIdIsTheDigestOfTheSpki) {
    PublicKey k;
    std::string err;
    ASSERT_TRUE(k.parsePem(pub(), err)) << err;
    EXPECT_EQ(k.keyId(), test::vectorCases()["valid"]["keyId"].get<std::string>());
    EXPECT_EQ(keyIdOfPem(pub()), k.keyId());
    EXPECT_NE(keyIdOfPem(otherPub()), k.keyId());
    EXPECT_EQ(keyIdOfPem("not a key"), "");
}

TEST(UpdateSignature, OnlyP256PublicKeysParse) {
    PublicKey k;
    std::string err;
    // a private key is not a trusted key
    EXPECT_FALSE(k.parsePem(test::readBytes(test::vectorPath("keys/test-ec-p256.pem")), err));
    EXPECT_FALSE(k.parsePem("-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n", err));
    EXPECT_FALSE(k.parsePem("", err));
    EXPECT_FALSE(k.parsePem(std::string(20000, 'A'), err));
    // an RSA key is refused
    EXPECT_FALSE(k.parsePem(test::readBytes(test::vectorPath("keys/test-rsa.pub.pem")), err));
}

TEST(UpdateSignature, VerifiesTheManifestSignature) {
    const EnvelopeHead h = validHead();
    PublicKey k;
    std::string err;
    ASSERT_TRUE(k.parsePem(pub(), err));
    const auto* data = reinterpret_cast<const uint8_t*>(h.manifest.data());
    EXPECT_TRUE(k.verify(data, h.manifest.size(), h.sig.data(), h.sig.size()));
    // one byte of the signature, one byte of the manifest
    std::vector<uint8_t> sig = h.sig;
    sig[sig.size() / 2] ^= 1;
    EXPECT_FALSE(k.verify(data, h.manifest.size(), sig.data(), sig.size()));
    std::string m = h.manifest;
    m[10] ^= 1;
    EXPECT_FALSE(
        k.verify(reinterpret_cast<const uint8_t*>(m.data()), m.size(), h.sig.data(), h.sig.size()));
    // another key
    PublicKey o;
    ASSERT_TRUE(o.parsePem(otherPub(), err));
    EXPECT_FALSE(o.verify(data, h.manifest.size(), h.sig.data(), h.sig.size()));
    // garbage and empty signatures never verify (and never read past them)
    EXPECT_FALSE(k.verify(data, h.manifest.size(), nullptr, 0));
    const uint8_t junk[3] = {0x30, 0x81, 0xff};
    EXPECT_FALSE(k.verify(data, h.manifest.size(), junk, sizeof junk));
}

TEST(UpdateSignature, TrustedKeysDirectory) {
    test::UpdTempDir d;
    // empty or missing directory: no key
    EXPECT_TRUE(loadTrustedKeys(d.file("missing")).keys.empty());
    EXPECT_TRUE(loadTrustedKeys(d.path()).keys.empty());
    test::writeBytes(d.file("release-primary.pub.pem"), pub());
    test::writeBytes(d.file("other.pem"), otherPub());
    test::writeBytes(d.file("readme.txt"), "not a key");
    test::writeBytes(d.file("broken.pem"), "-----BEGIN PUBLIC KEY-----\n!!\n");
    ::mkdir(d.file("dir.pem").c_str(), 0755);
    const KeySet ks = loadTrustedKeys(d.path());
    ASSERT_EQ(ks.keys.size(), 2u);
    EXPECT_EQ(ks.keys[0].label, "other");  // sorted by file name
    EXPECT_EQ(ks.keys[1].label, "release-primary");
    EXPECT_GE(ks.warnings.size(), 2u);  // broken.pem, dir.pem
    const EnvelopeHead h = validHead();
    const PublicKey* by = ks.verify(reinterpret_cast<const uint8_t*>(h.manifest.data()),
                                    h.manifest.size(), h.sig.data(), h.sig.size());
    ASSERT_NE(by, nullptr);
    EXPECT_EQ(by->label, "release-primary");
}

TEST(UpdateSignature, AtMostFourKeysAreUsed) {
    test::UpdTempDir d;
    for (const char* n : {"a.pem", "b.pem", "c.pem", "d.pem"})
        test::writeBytes(d.file(n), otherPub());
    test::writeBytes(d.file("e.pem"), pub());  // the fifth, never tried
    const KeySet ks = loadTrustedKeys(d.path());
    EXPECT_EQ(ks.keys.size(), kMaxTrustedKeys);
    EXPECT_FALSE(ks.warnings.empty());
    const EnvelopeHead h = validHead();
    EXPECT_EQ(ks.verify(reinterpret_cast<const uint8_t*>(h.manifest.data()), h.manifest.size(),
                        h.sig.data(), h.sig.size()),
              nullptr);
}

TEST(UpdateSignature, Sha256SumsAndItsSignature) {
    const KeySet keys = loadTrustedKeys(test::vectorPath("keys-trusted"));
    std::string signer;
    const std::string sums = test::vectorPath("sums/SHA256SUMS");
    ASSERT_FALSE(verifySums(sums, sums + ".sig", keys, signer));
    EXPECT_EQ(signer, test::vectorCases()["valid"]["keyId"].get<std::string>());

    test::UpdTempDir d;
    for (const char* n : {"a.txt", "b.txt", "SHA256SUMS", "SHA256SUMS.sig"})
        test::writeBytes(d.file(n), test::readBytes(test::vectorPath(std::string("sums/") + n)));
    const std::string s = d.file("SHA256SUMS");
    ASSERT_FALSE(verifySums(s, s + ".sig", keys, signer));
    // a line changed: signature (exit 3)
    std::string text = test::readBytes(s);
    text[3] = text[3] == 'a' ? 'b' : 'a';
    test::writeBytes(s, text);
    auto e = verifySums(s, s + ".sig", keys, signer);
    ASSERT_TRUE(e);
    EXPECT_EQ(e->exit, kExitSignature);
    test::writeBytes(s, test::readBytes(sums));
    // the .sig changed
    std::string sig = test::readBytes(sums + ".sig");
    sig[sig.size() - 3] ^= 1;
    test::writeBytes(s + ".sig", sig);
    e = verifySums(s, s + ".sig", keys, signer);
    ASSERT_TRUE(e);
    EXPECT_EQ(e->code, "UPDATE_SIGNATURE_INVALID");
    test::writeBytes(s + ".sig", test::readBytes(sums + ".sig"));
    // a listed file changed, then missing
    test::writeBytes(d.file("a.txt"), "khác\n");
    e = verifySums(s, s + ".sig", keys, signer);
    ASSERT_TRUE(e);
    EXPECT_EQ(e->detailCode, "FILE_DIGEST");
    ::unlink(d.file("a.txt").c_str());
    e = verifySums(s, s + ".sig", keys, signer);
    ASSERT_TRUE(e);
    EXPECT_EQ(e->detailCode, "FILE_MISSING");
    // no trusted key
    e = verifySums(sums, sums + ".sig", loadTrustedKeys(d.file("none")), signer);
    ASSERT_TRUE(e);
    EXPECT_EQ(e->exit, kExitKeys);
}

TEST(UpdatePaths, RulesOfFilesList) {
    EXPECT_EQ(checkPath("bin/mat-runtime"), "");
    EXPECT_EQ(checkPath("web/assets/app.js"), "");
    EXPECT_EQ(checkPath("schemas/0.5/project.schema.json"), "");
    EXPECT_EQ(checkPath("README-deploy.txt"), "");
    EXPECT_EQ(checkPath("build-info.json"), "");
    EXPECT_EQ(checkPath("/etc/passwd"), "PATH_ABSOLUTE");
    EXPECT_EQ(checkPath("web/../../etc/passwd"), "PATH_TRAVERSAL");
    EXPECT_EQ(checkPath("web/./a"), "PATH_TRAVERSAL");
    EXPECT_EQ(checkPath(".."), "PATH_TRAVERSAL");
    EXPECT_EQ(checkPath("web\\a"), "PATH_INVALID");
    EXPECT_EQ(checkPath("web/a\x07"), "PATH_INVALID");
    EXPECT_EQ(checkPath("web/a\x7f"), "PATH_INVALID");
    EXPECT_EQ(checkPath("web//a"), "PATH_INVALID");
    EXPECT_EQ(checkPath("web/"), "PATH_INVALID");
    EXPECT_EQ(checkPath(""), "PATH_INVALID");
    EXPECT_EQ(checkPath("web/" + std::string(197, 'a')), "PATH_INVALID");  // 201 bytes
    EXPECT_EQ(checkPath("web/" + std::string(196, 'a')), "");
    EXPECT_EQ(checkPath("web/\xc3"), "PATH_INVALID");              // broken UTF-8
    EXPECT_EQ(checkPath("web/t\xc3\xaa\xcc\x81n.txt"), "");        // NFD Vietnamese is UTF-8
    EXPECT_EQ(checkPath("project/project.json"), "PATH_INVALID");  // not an allowed prefix
    EXPECT_EQ(checkPath("deployment/deploy.sh"), "PATH_INVALID");
    EXPECT_EQ(checkPath("binx/a"), "PATH_INVALID");
    EXPECT_EQ(checkPath("updater/mat-updater"), "UPDATER");
    EXPECT_TRUE(allowedDirectory("bin/"));
    EXPECT_TRUE(allowedDirectory("web/assets/"));
    EXPECT_FALSE(allowedDirectory("etc/"));
    EXPECT_FALSE(allowedDirectory("web/../"));
    EXPECT_EQ(foldCase("Web/INDEX.html"), "web/index.html");
}

TEST(UpdateVersions, SemverOrder) {
    EXPECT_EQ(compareVersions("1.0.0", "1.0.0"), 0);
    EXPECT_EQ(compareVersions("1.0.1", "1.0.0"), 1);
    EXPECT_EQ(compareVersions("0.9.10", "0.9.9"), 1);
    EXPECT_EQ(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
    EXPECT_EQ(compareVersions("1.0.0-rc.2", "1.0.0-rc.1"), 1);
    EXPECT_EQ(compareVersions("2.0.0", "10.0.0"), -1);
    EXPECT_TRUE(validVersion("1.0.0-rc.1"));
    EXPECT_FALSE(validVersion("1.0"));
    EXPECT_FALSE(validVersion("01.0.0"));
    EXPECT_FALSE(validVersion("1.0.0 "));
}

}  // namespace
}  // namespace mat::update
