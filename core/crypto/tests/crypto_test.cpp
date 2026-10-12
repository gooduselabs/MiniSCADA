// T016 (feature 005; research R4, R7, R9; data-model §3): the helpers of core/crypto.
// - SHA-256: NIST examples (FIPS 180-2 appendix B: "abc", the 448- and 896-bit messages, one
//   million 'a'), one-shot and streamed; 1 MiB streamed against OpenSSL's value.
// - randomBytes: the real getrandom, and the retry loop over a scripted one.
// - base64url: RFC 4648 §10 vectors without padding; hex; the two fingerprint forms.
// Expected digests are parsed by a local helper, not by toHex/fromHex under test.
#include <gtest/gtest.h>

#include <algorithm>
#include <array>
#include <cerrno>
#include <cstdio>
#include <optional>
#include <regex>
#include <set>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

#include "core/crypto/base64url.hpp"
#include "core/crypto/ct_compare.hpp"
#include "core/crypto/hex.hpp"
#include "core/crypto/random.hpp"
#include "core/crypto/sha256.hpp"

using namespace mat;

namespace {

Sha256Digest digest(const std::string& hex) {
    Sha256Digest d{};
    if (hex.size() != 2 * d.size()) ADD_FAILURE() << "bad expected digest " << hex;
    for (size_t i = 0; i < d.size() && 2 * i + 1 < hex.size(); ++i)
        d[i] = static_cast<uint8_t>(std::stoul(hex.substr(2 * i, 2), nullptr, 16));
    return d;
}

const std::string kEmpty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const std::string kAbc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

}  // namespace

// --- SHA-256

TEST(Sha256, NistMessages) {
    EXPECT_EQ(sha256(""), digest(kEmpty));
    EXPECT_EQ(sha256(std::string()), digest(kEmpty));
    EXPECT_EQ(sha256("abc"), digest(kAbc));
    EXPECT_EQ(sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
              digest("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"));
    EXPECT_EQ(sha256("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklm"
                     "nopqklmnopqrlmnopqrsmnopqrstnopqrstu"),
              digest("cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1"));
}

TEST(Sha256, PointerAndStringFormsAgree) {
    const std::string s("a\0b", 3);  // a NUL byte is data like any other
    EXPECT_EQ(sha256(s.data(), s.size()), sha256(s));
    EXPECT_NE(sha256(s), sha256("a"));
    EXPECT_EQ(sha256("abc", 3), digest(kAbc));
}

// NIST long message: one million 'a', fed in irregular pieces across the 64-byte blocks.
TEST(Sha256, StreamingMillionA) {
    const std::string block(1000, 'a');
    Sha256 h;
    size_t done = 0;
    for (size_t step = 1; done < 1000000; step = step * 3 % 997 + 1) {
        const size_t n = std::min({step, block.size(), size_t{1000000} - done});
        h.update(block.data(), n);
        done += n;
    }
    EXPECT_EQ(h.finish(),
              digest("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"));
}

// 1 MiB, one-shot and streamed; the value is OpenSSL's (node:crypto).
TEST(Sha256, StreamingOneMebibyte) {
    const std::string data(1 << 20, 'a');
    const Sha256Digest expected =
        digest("9bc1b2a288b26af7257a36277ae3816a7d4f16e89c1e7e77d0a5c48bad62b360");
    EXPECT_EQ(sha256(data), expected);
    Sha256 h;
    for (size_t off = 0, n = 1; off < data.size(); off += n, n = n * 7 % 4093 + 1)
        h.update(std::string_view(data).substr(off, n));
    EXPECT_EQ(h.finish(), expected);
}

TEST(Sha256, FinishStartsOver) {
    Sha256 h;
    EXPECT_EQ(h.finish(), digest(kEmpty));  // nothing passed
    h.update("ab").update("c");
    EXPECT_EQ(h.finish(), digest(kAbc));
    h.update("abc");  // a new stream after finish()
    EXPECT_EQ(h.finish(), digest(kAbc));
}

// --- randomBytes

TEST(RandomBytes, RequestedLengthAndTwoCallsDiffer) {
    const std::string a = randomBytes(32), b = randomBytes(32);
    EXPECT_EQ(a.size(), 32u);
    EXPECT_EQ(b.size(), 32u);
    EXPECT_NE(a, b);
    unsigned char x[64] = {0}, y[64] = {0};
    randomBytes(x, sizeof x);
    randomBytes(y, sizeof y);
    EXPECT_NE(std::string(reinterpret_cast<char*>(x), sizeof x),
              std::string(reinterpret_cast<char*>(y), sizeof y));
    EXPECT_EQ(randomBytes(0), "");
}

// The whole buffer is filled, not only a prefix: the last 4 KiB of 1 MiB show (almost) every
// byte value (missing more than 56 of 256 has probability far below 1e-20).
TEST(RandomBytes, LargeRequestIsFilledToTheEnd) {
    const std::string r = randomBytes(1 << 20);
    ASSERT_EQ(r.size(), size_t{1} << 20);
    const std::set<char> seen(r.end() - 4096, r.end());
    EXPECT_GE(seen.size(), 200u);
}

namespace {

// A scripted getrandom: each call takes the next step, either an error (-1 and errno) or up to
// `bytes` bytes of the sequence 1, 2, 3, … so the test sees where every byte landed.
struct FakeKernel {
    std::vector<std::pair<long, int>> script;  // {bytes, 0} or {-1, errno}
    size_t calls = 0;
    std::vector<unsigned> flags;
    unsigned char next = 1;

    detail::GetrandomFn fn() {
        return [this](void* buf, size_t len, unsigned int f) -> ssize_t {
            flags.push_back(f);
            if (calls >= script.size()) {
                ADD_FAILURE() << "unexpected getrandom call " << calls;
                errno = EIO;
                return -1;
            }
            const auto step = script[calls++];
            if (step.first < 0) {
                errno = step.second;
                return -1;
            }
            const size_t give = std::min(static_cast<size_t>(step.first), len);
            for (size_t i = 0; i < give; ++i) static_cast<unsigned char*>(buf)[i] = next++;
            return static_cast<ssize_t>(give);
        };
    }
};

}  // namespace

TEST(RandomBytes, RetriesOnEintrAndShortReads) {
    FakeKernel k;
    k.script = {{-1, EINTR}, {5, 0}, {-1, EINTR}, {3, 0}, {100, 0}};
    unsigned char buf[20] = {0};
    detail::randomBytesWith(k.fn(), buf, sizeof buf);
    EXPECT_EQ(k.calls, 5u);
    for (size_t i = 0; i < sizeof buf; ++i) EXPECT_EQ(buf[i], i + 1) << i;
    EXPECT_EQ(k.flags, std::vector<unsigned>(5, 0u));  // blocking pool, never GRND_NONBLOCK
}

TEST(RandomBytes, OtherErrorsThrow) {
    for (const int err : {ENOSYS, EFAULT, EINVAL, EAGAIN, EPERM, EIO}) {
        FakeKernel k;
        k.script = {{3, 0}, {-1, err}};
        unsigned char buf[16] = {0};
        try {
            detail::randomBytesWith(k.fn(), buf, sizeof buf);
            ADD_FAILURE() << "no exception for errno " << err;
        } catch (const std::system_error& e) {
            EXPECT_EQ(e.code().value(), err);
            EXPECT_NE(std::string(e.what()).find("getrandom"), std::string::npos) << e.what();
        }
        EXPECT_EQ(k.calls, 2u);
    }
}

TEST(RandomBytes, NoProgressIsAnErrorNotALoop) {
    FakeKernel k;
    k.script = {{0, 0}};
    unsigned char buf[8] = {0};
    EXPECT_THROW(detail::randomBytesWith(k.fn(), buf, sizeof buf), std::system_error);
    EXPECT_EQ(k.calls, 1u);
}

TEST(RandomBytes, ZeroLengthAsksNothing) {
    FakeKernel k;
    unsigned char buf[1] = {0};
    detail::randomBytesWith(k.fn(), buf, 0);
    EXPECT_EQ(k.calls, 0u);
}

// --- constant-time comparison

TEST(ConstantTimeEqual, EqualAndDifferent) {
    EXPECT_TRUE(constantTimeEqual("", ""));
    EXPECT_TRUE(constantTimeEqual("token-hash", "token-hash"));
    EXPECT_FALSE(constantTimeEqual("Xoken-hash", "token-hash"));  // first byte
    EXPECT_FALSE(constantTimeEqual("token-hasX", "token-hash"));  // last byte
    const std::string a("a\0b", 3), b("a\0c", 3);
    EXPECT_FALSE(constantTimeEqual(a, b));  // after a NUL byte
    EXPECT_TRUE(constantTimeEqual(a, std::string("a\0b", 3)));
}

TEST(ConstantTimeEqual, DifferentLengthsAreUnequal) {
    EXPECT_FALSE(constantTimeEqual("abc", "abcd"));
    EXPECT_FALSE(constantTimeEqual("abcd", "abc"));
    EXPECT_FALSE(constantTimeEqual("", "a"));
    const unsigned char x[4] = {1, 2, 3, 4}, y[3] = {1, 2, 3};
    EXPECT_FALSE(constantTimeEqual(x, 4, y, 3));
    EXPECT_TRUE(constantTimeEqual(x, 3, y, 3));
    EXPECT_FALSE(constantTimeEqual(x, 0, y, 1));
}

// --- base64url

namespace {
// RFC 4648 §10, without the padding.
const std::vector<std::pair<std::string, std::string>> kRfc4648 = {
    {"", ""},           {"f", "Zg"},          {"fo", "Zm8"},         {"foo", "Zm9v"},
    {"foob", "Zm9vYg"}, {"fooba", "Zm9vYmE"}, {"foobar", "Zm9vYmFy"}};
}  // namespace

TEST(Base64url, Rfc4648VectorsWithoutPadding) {
    for (const auto& v : kRfc4648) {
        EXPECT_EQ(base64urlEncode(v.first), v.second) << v.first;
        EXPECT_EQ(base64urlEncode(v.first.data(), v.first.size()), v.second) << v.first;
        EXPECT_EQ(base64urlDecode(v.second), std::optional<std::string>(v.first)) << v.second;
    }
}

TEST(Base64url, UrlAlphabet) {
    const std::string b1("\xfb\xff\xbf", 3), b2("\xff\xef", 2);
    EXPECT_EQ(base64urlEncode(b1), "-_-_");  // base64: "+/+/"
    EXPECT_EQ(base64urlEncode(b2), "_-8");   // base64: "/+8="
    EXPECT_EQ(base64urlDecode("-_-_"), std::optional<std::string>(b1));
    EXPECT_EQ(base64urlDecode("_-8"), std::optional<std::string>(b2));
}

// Session token (research R9): "mats_" + 43 characters for 32 random bytes.
TEST(Base64url, SessionTokenForm) {
    EXPECT_EQ(base64urlEncode(std::string(32, '\0')), std::string(43, 'A'));
    const std::string token = "mats_" + base64urlEncode(randomBytes(32));
    EXPECT_TRUE(std::regex_match(token, std::regex("mats_[A-Za-z0-9_-]{43}"))) << token;
    const auto back = base64urlDecode(token.substr(5));
    ASSERT_TRUE(back.has_value());
    EXPECT_EQ(back->size(), 32u);
}

TEST(Base64url, DecodeIsStrict) {
    const std::vector<std::string> bad = {
        "Zg==", "Zm8=",              // padding
        "+/+/", "Zm9v+A", "Zm9v/A",  // base64 alphabet, not base64url
        "Z",    "Zm9vY",             // a length no byte string encodes to
        "Zh",   "Zm-",               // unused low bits not zero ("Zg", "Zm8" are the texts)
        " Zg",  "Zg\n",   "Zg ",    std::string("Z\0g", 3), "Zm9v\xc3\xa9"};
    for (const auto& s : bad) EXPECT_FALSE(base64urlDecode(s).has_value()) << s;
}

// --- hex and fingerprints

TEST(Hex, LowercaseTwoCharactersPerByte) {
    EXPECT_EQ(toHex(std::string("\x00\x01\xab\xff\x7f", 5)), "0001abff7f");
    EXPECT_EQ(toHex(""), "");
    const std::array<uint8_t, 3> a{0xde, 0xad, 0x01};
    EXPECT_EQ(toHex(a), "dead01");
    EXPECT_EQ(toHex(a.data(), 2), "dead");
}

TEST(Hex, EveryByteValue) {
    std::string all;
    for (int i = 0; i < 256; ++i) all.push_back(static_cast<char>(i));
    const std::string hex = toHex(all);
    const std::string colons = toHexColons(all.data(), all.size());
    ASSERT_EQ(hex.size(), 512u);
    ASSERT_EQ(colons.size(), 767u);
    for (int i = 0; i < 256; ++i) {
        char lower[3], upper[3];
        std::snprintf(lower, sizeof lower, "%02x", i);
        std::snprintf(upper, sizeof upper, "%02X", i);
        EXPECT_EQ(hex.substr(2 * i, 2), lower);
        EXPECT_EQ(colons.substr(3 * i, 2), upper);
        if (i < 255) {
            EXPECT_EQ(colons[3 * i + 2], ':') << i;
        }
    }
    EXPECT_EQ(fromHex(hex), std::optional<std::string>(all));
}

TEST(Hex, FromHexTakesLowercasePairsOnly) {
    EXPECT_EQ(fromHex("0001abff7f"),
              std::optional<std::string>(std::string("\0\1\xab\xff\x7f", 5)));
    EXPECT_EQ(fromHex(""), std::optional<std::string>(""));
    for (const char* bad : {"0", "abc", "AB", "aB", "0X", "zz", "g0", " 00", "00 ", "0:0"})
        EXPECT_FALSE(fromHex(bad).has_value()) << bad;
}

// data-model §3: SHA-256 of the certificate DER, printed "AB:CD:…" (95 characters, as
// `openssl x509 -fingerprint -sha256` prints it) and carried as 64 lowercase hex characters.
TEST(Fingerprint, ColonAndHexForms) {
    const Sha256Digest d = digest(kAbc);
    const std::string colons = toHexColons(d);
    EXPECT_EQ(colons,
              "BA:78:16:BF:8F:01:CF:EA:41:41:40:DE:5D:AE:22:23:B0:03:61:A3:96:17:7A:9C:B4:10:FF:"
              "61:F2:00:15:AD");
    EXPECT_EQ(colons.size(), 95u);
    EXPECT_EQ(toHex(d), kAbc);
    EXPECT_EQ(toHexColons(std::array<uint8_t, 1>{0x0a}), "0A");
    EXPECT_EQ(toHexColons(nullptr, 0), "");
}

// The pipeline of the certificate code: DER bytes → SHA-256 → both forms (values from OpenSSL).
TEST(Fingerprint, OfDerBytes) {
    const std::string der("\x30\x03\x02\x01\x05", 5);  // SEQUENCE { INTEGER 5 }
    const Sha256Digest d = sha256(der);
    EXPECT_EQ(toHex(d), "417c7763c4e320a6b747b3cb0c6d22f93741b29a32b48594b8eb4c144fe6d729");
    EXPECT_EQ(toHexColons(d),
              "41:7C:77:63:C4:E3:20:A6:B7:47:B3:CB:0C:6D:22:F9:37:41:B2:9A:32:B4:85:94:B8:EB:4C:"
              "14:4F:E6:D7:29");
}
