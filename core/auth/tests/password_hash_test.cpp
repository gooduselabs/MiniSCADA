// T026 (feature 005; research R7, R8; data-model §4; ADR-011): password hashes.
// - Argon2id: the RFC 9106 vector; the PHC text, byte for byte the same as the library's own
//   encoder; strict parsing with the bounds that keep a hand-edited users.json from costing
//   without limit.
// - Verification with the stored parameters, every byte compared; "needs rehash"; the dummy target
//   of refused names.
// - Memory: mmap per hash, unmapped right after, RSS back where it was.
// - The hash thread: one at a time, at most 4 waiting, nice +10; tested with an injected hash
//   function that waits on the test, not on time.
// - Rules for a new password: 15–128 characters of UTF-8, not the account name.
#include "core/auth/password_hash.hpp"

#include <gtest/gtest.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <condition_variable>
#include <fstream>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#include "argon2.h"
#include "core/auth/tests/auth_test_support.hpp"
#include "core/crypto/random.hpp"

using namespace mat;
using mat::test::b64;
using mat::test::phcText;

namespace {

// Small parameters inside the bounds, for tests where the cost does not matter.
constexpr Argon2Params kFast{8192, 1, 1};

std::string bytesOf(const std::string& hex) {
    std::string out;
    for (size_t i = 0; i + 1 < hex.size(); i += 2)
        out += static_cast<char>(std::stoul(hex.substr(i, 2), nullptr, 16));
    return out;
}

long rssKiB() {
    std::ifstream in("/proc/self/status");
    std::string line;
    while (std::getline(in, line))
        if (line.rfind("VmRSS:", 0) == 0) return std::stol(line.substr(6));
    return -1;
}

int threadNice() {
    errno = 0;
    return ::getpriority(PRIO_PROCESS, static_cast<id_t>(::syscall(SYS_gettid)));
}

// Holds the injected hash function until the test opens it; counts who came in.
struct Gate {
    std::mutex mu;
    std::condition_variable cv;
    bool open = false;
    int entered = 0;

    void pass() {
        std::unique_lock<std::mutex> l(mu);
        ++entered;
        cv.notify_all();
        cv.wait(l, [&] { return open; });
    }
    bool waitEntered(int n) {
        std::unique_lock<std::mutex> l(mu);
        return cv.wait_for(l, std::chrono::seconds(10), [&] { return entered >= n; });
    }
    void release() {
        {
            std::lock_guard<std::mutex> l(mu);
            open = true;
        }
        cv.notify_all();
    }
};

// Opens the gate when the test ends early, so the hasher's destructor does not wait forever.
// Declared after the hasher: destroyed before it.
struct ReleaseOnExit {
    Gate& gate;
    ~ReleaseOnExit() { gate.release(); }
};

PasswordHash refWithSalt(const std::string& salt) {
    PasswordHash r;
    r.salt = salt;
    return r;
}

}  // namespace

// --- Argon2id

TEST(Argon2id, Rfc9106Vector) {
    // RFC 9106 §5.3: Argon2id v=0x13, m = 32 KiB, t = 3, 4 lanes, with secret and associated data.
    const auto before = detail::argon2MemoryStats();
    const std::string tag =
        detail::argon2idHashFull(std::string(32, '\x01'), std::string(16, '\x02'),
                                 std::string(8, '\x03'), std::string(12, '\x04'), 32, 3, 4, 32);
    EXPECT_EQ(tag, bytesOf("0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659"));
    const auto after = detail::argon2MemoryStats();
    EXPECT_EQ(after.maps - before.maps, 1u);  // through the mmap allocator too
    EXPECT_EQ(after.unmaps - before.unmaps, 1u);
}

TEST(Argon2id, HashOfAPasswordIs32Bytes) {
    const std::string h = argon2idHash("correct horse battery staple", "0123456789abcdef", kFast);
    EXPECT_EQ(h.size(), kHashBytes);
    EXPECT_NE(h, std::string(kHashBytes, '\0'));
    EXPECT_EQ(h, argon2idHash("correct horse battery staple", "0123456789abcdef", kFast));
    EXPECT_NE(h, argon2idHash("correct horse battery staplE", "0123456789abcdef", kFast));
    EXPECT_NE(h, argon2idHash("correct horse battery staple", "0123456789abcdeF", kFast));
}

TEST(Argon2id, DefaultParametersAreTheMeasuredBl335Choice) {
    EXPECT_EQ(kArgon2Default.mKiB, 19456u);
    EXPECT_EQ(kArgon2Default.t, 1u);
    EXPECT_EQ(kArgon2Default.p, 1u);
    EXPECT_EQ(kSaltBytes, 16u);
    EXPECT_EQ(kHashBytes, 32u);
}

// --- PHC text

TEST(Phc, FormatThenParse) {
    PasswordHash h;
    h.params = kArgon2Default;
    h.salt = randomBytes(kSaltBytes);
    h.hash = randomBytes(kHashBytes);
    const std::string text = formatPhc(h);
    EXPECT_EQ(text.rfind("$argon2id$v=19$m=19456,t=2,p=1$", 0), 0u) << text;
    EXPECT_EQ(text, phcText(19456, 2, 1, h.salt, h.hash));
    const auto back = parsePhc(text);
    ASSERT_TRUE(back.has_value());
    EXPECT_EQ(back->params, kArgon2Default);
    EXPECT_EQ(back->salt, h.salt);
    EXPECT_EQ(back->hash, h.hash);
}

TEST(Phc, SameTextAsTheLibraryEncoder) {
    const std::string password = "Mật khẩu thử: 15+ ký tự";
    const std::string salt = "saltsaltsaltsalt";
    char encoded[256] = {};
    ASSERT_EQ(argon2id_hash_encoded(2, 8192, 1, password.data(), password.size(), salt.data(),
                                    salt.size(), kHashBytes, encoded, sizeof encoded),
              ARGON2_OK);
    PasswordHash h;
    h.params = {8192, 2, 1};
    h.salt = salt;
    h.hash = argon2idHash(password, salt, h.params);
    EXPECT_EQ(formatPhc(h), std::string(encoded));
    const auto back = parsePhc(encoded);
    ASSERT_TRUE(back.has_value());
    EXPECT_EQ(back->hash, h.hash);
    EXPECT_TRUE(verifyPassword(password, *back));
}

TEST(Phc, BoundsAreAccepted) {
    const std::string s16(16, 's'), s64(64, 's'), h32(32, 'h');
    for (const auto& text : {phcText(8192, 1, 1, s16, h32), phcText(65536, 10, 1, s16, h32),
                             phcText(19456, 2, 1, s64, h32), phcText(19456, 2, 1, s16, h32)}) {
        EXPECT_TRUE(parsePhc(text).has_value()) << text;
    }
}

TEST(Phc, RefusesAnythingElse) {
    const std::string s16(16, 's'), h32(32, 'h');
    const std::string salt = b64(s16), hash = b64(h32);
    const std::string ok = phcText(19456, 2, 1, s16, h32);
    std::string nonCanonical = salt;  // 16 bytes: the last character keeps 4 unused bits
    nonCanonical.back() = nonCanonical.back() == 'z' ? 'B' : 'z';
    const std::vector<std::string> bad = {
        "",
        "$argon2i$v=19$m=19456,t=2,p=1$" + salt + "$" + hash,
        "$argon2d$v=19$m=19456,t=2,p=1$" + salt + "$" + hash,
        "$argon2id$v=16$m=19456,t=2,p=1$" + salt + "$" + hash,
        "$argon2id$m=19456,t=2,p=1$" + salt + "$" + hash,  // no version
        phcText(8191, 2, 1, s16, h32),
        phcText(65537, 2, 1, s16, h32),
        phcText(1048576, 2, 1, s16, h32),
        phcText(19456, 0, 1, s16, h32),
        phcText(19456, 11, 1, s16, h32),
        phcText(19456, 2, 0, s16, h32),
        phcText(19456, 2, 2, s16, h32),
        phcText(19456, 2, 1, std::string(15, 's'), h32),
        phcText(19456, 2, 1, std::string(65, 's'), h32),
        phcText(19456, 2, 1, s16, std::string(31, 'h')),
        phcText(19456, 2, 1, s16, std::string(33, 'h')),
        "$argon2id$v=19$m=019456,t=2,p=1$" + salt + "$" + hash,
        "$argon2id$v=19$m=+19456,t=2,p=1$" + salt + "$" + hash,
        "$argon2id$v=19$m=99999999999999999999,t=2,p=1$" + salt + "$" + hash,
        "$argon2id$v=19$t=2,m=19456,p=1$" + salt + "$" + hash,
        "$argon2id$v=19$m=19456,t=2,p=1,keyid=x$" + salt + "$" + hash,
        "$argon2id$v=19$m=19456, t=2,p=1$" + salt + "$" + hash,
        "$argon2id$v=19$m=19456,t=2,p=1$" + salt + "==$" + hash,
        "$argon2id$v=19$m=19456,t=2,p=1$" + nonCanonical + "$" + hash,
        "$argon2id$v=19$m=19456,t=2,p=1$" + salt + "$" + hash + "$",
        "$argon2id$v=19$m=19456,t=2,p=1$" + salt + "$" + hash + "=",
        "$argon2id$v=19$m=19456,t=2,p=1$" + salt + "$" + hash + "\n",
        "$argon2id$v=19$m=19456,t=2,p=1$$" + hash,
        "$argon2id$v=19$m=19456,t=2,p=1$" + salt,
        ok + "AA",
        " " + ok,
    };
    for (const auto& text : bad) {
        std::string why;
        EXPECT_FALSE(parsePhc(text, &why).has_value()) << text;
        EXPECT_FALSE(why.empty()) << text;
        EXPECT_EQ(why.find(hash), std::string::npos) << "the reason quotes the hash: " << why;
    }
    std::string withUrlAlphabet = ok;  // base64url characters are not the PHC alphabet
    std::replace(withUrlAlphabet.begin(), withUrlAlphabet.end(), 'c', '-');
    if (withUrlAlphabet != ok) {
        EXPECT_FALSE(parsePhc(withUrlAlphabet).has_value());
    }
}

// --- Verification

TEST(Password, HashThenVerify) {
    const std::string pw = mat::test::randomPassword();
    const std::string a = hashPassword(pw, kFast), b = hashPassword(pw, kFast);
    EXPECT_NE(a, b) << "a fresh salt for every hash";
    for (const auto& text : {a, b}) {
        const auto h = parsePhc(text);
        ASSERT_TRUE(h.has_value()) << text;
        EXPECT_EQ(h->salt.size(), kSaltBytes);
        EXPECT_EQ(h->hash.size(), kHashBytes);
        EXPECT_EQ(h->params, kFast);
        EXPECT_TRUE(verifyPassword(pw, *h));
        EXPECT_FALSE(verifyPassword(pw + "x", *h));
        EXPECT_FALSE(verifyPassword("", *h));
    }
    const auto d = parsePhc(hashPassword(pw));  // default parameters
    ASSERT_TRUE(d.has_value());
    EXPECT_EQ(d->params, kArgon2Default);
    EXPECT_TRUE(verifyPassword(pw, *d));
}

TEST(Password, VerifyUsesTheStoredParameters) {
    const std::string pw = mat::test::randomPassword();
    const auto h = parsePhc(hashPassword(pw, {8192, 3, 1}));
    ASSERT_TRUE(h.has_value());
    EXPECT_EQ(h->params, (Argon2Params{8192, 3, 1}));
    EXPECT_TRUE(verifyPassword(pw, *h));
    PasswordHash other = *h;
    other.params.t = 1;  // the same salt and hash under other parameters: no match
    EXPECT_FALSE(verifyPassword(pw, other));
}

TEST(Password, EveryByteOfTheHashIsCompared) {
    const std::string pw = mat::test::randomPassword();
    const auto h = parsePhc(hashPassword(pw, kFast));
    ASSERT_TRUE(h.has_value());
    ASSERT_TRUE(verifyPassword(pw, *h));
    for (size_t i : {size_t(0), kHashBytes / 2, kHashBytes - 1}) {
        PasswordHash flipped = *h;
        flipped.hash[i] = static_cast<char>(flipped.hash[i] ^ 0x01);
        EXPECT_FALSE(verifyPassword(pw, flipped)) << "byte " << i;
    }
    PasswordHash shorter = *h;
    shorter.hash.pop_back();
    EXPECT_FALSE(verifyPassword(pw, shorter));
}

TEST(Password, NeedsRehashWhenTheParametersDiffer) {
    const auto old = parsePhc(phcText(8192, 1, 1, std::string(16, 's'), std::string(32, 'h')));
    const auto cur = parsePhc(phcText(19456, 2, 1, std::string(16, 's'), std::string(32, 'h')));
    ASSERT_TRUE(old.has_value());
    ASSERT_TRUE(cur.has_value());
    EXPECT_TRUE(needsRehash(*old));
    EXPECT_FALSE(needsRehash(*cur));
    EXPECT_TRUE(needsRehash(*cur, {19456, 1, 1}));  // T055 may lower t: old hashes then differ
    EXPECT_FALSE(needsRehash(*old, kFast));
}

TEST(Password, DummyTargetHasTheDefaultParameters) {
    const PasswordHash a = dummyPasswordHash(), b = dummyPasswordHash();
    EXPECT_EQ(a.params, kArgon2Default);
    EXPECT_EQ(a.salt.size(), kSaltBytes);
    EXPECT_EQ(a.hash.size(), kHashBytes);
    EXPECT_NE(a.salt, b.salt);
    EXPECT_NE(a.hash, b.hash);
    const PasswordHash fast = dummyPasswordHash(kFast);
    EXPECT_EQ(fast.params, kFast);
    EXPECT_FALSE(verifyPassword("", fast));
    EXPECT_FALSE(verifyPassword(mat::test::randomPassword(), fast));
}

// --- Memory

TEST(Argon2Memory, BuffersComeFromMmapAndGoBackAtOnce) {
    const auto before = detail::argon2MemoryStats();
    const long rss0 = rssKiB();
    ASSERT_GT(rss0, 0);
    for (uint64_t i = 1; i <= 3; ++i) {
        const std::string h = argon2idHash("password", "0123456789abcdef", kArgon2Default);
        ASSERT_EQ(h.size(), kHashBytes);
        const auto s = detail::argon2MemoryStats();
        EXPECT_EQ(s.maps - before.maps, i);
        EXPECT_EQ(s.unmaps - before.unmaps, i);
        EXPECT_EQ(s.liveBytes, 0u);
        // glibc's malloc would keep a freed 19 MiB block in the heap from the second hash on.
        EXPECT_LE(rssKiB(), rss0 + 4096) << "hash memory still resident after hash " << i;
    }
    EXPECT_GE(detail::argon2MemoryStats().peakBytes, uint64_t{19456} * 1024);
}

// --- Rules for a new password

TEST(PasswordRules, LengthInCharactersOfUtf8) {
    const std::string name = "kysu1";
    EXPECT_EQ(checkNewPassword(std::string(14, 'a'), name), PasswordProblem::TooShort);
    EXPECT_EQ(checkNewPassword(std::string(15, 'a'), name), PasswordProblem::None);
    EXPECT_EQ(checkNewPassword(std::string(128, 'a'), name), PasswordProblem::None);
    EXPECT_EQ(checkNewPassword(std::string(129, 'a'), name), PasswordProblem::TooLong);
    std::string e14, e15, emoji128;
    for (int i = 0; i < 14; ++i) e14 += "\xE1\xBB\x87";  // U+1EC7: 3 bytes, one character
    e15 = e14 + "\xE1\xBB\x87";
    for (int i = 0; i < 128; ++i) emoji128 += "\xF0\x9F\x98\x80";  // U+1F600: 4 bytes
    EXPECT_EQ(checkNewPassword(e14, name), PasswordProblem::TooShort);
    EXPECT_EQ(checkNewPassword(e15, name), PasswordProblem::None);
    EXPECT_EQ(emoji128.size(), kPasswordMaxBytes);
    EXPECT_EQ(checkNewPassword(emoji128, name), PasswordProblem::None);
    EXPECT_EQ(checkNewPassword(emoji128 + "a", name), PasswordProblem::TooLong);
}

TEST(PasswordRules, Utf8AndAccountName) {
    EXPECT_EQ(checkNewPassword(std::string(20, 'a') + "\xC3", "kysu1"), PasswordProblem::NotUtf8);
    EXPECT_EQ(checkNewPassword(std::string(20, 'a') + "\xED\xA0\x80", "kysu1"),
              PasswordProblem::NotUtf8);  // a surrogate
    EXPECT_EQ(checkNewPassword("operator.account", "operator.account"),
              PasswordProblem::SameAsName);
    EXPECT_EQ(checkNewPassword("Operator.Account", "operator.account"),
              PasswordProblem::SameAsName);
    EXPECT_EQ(checkNewPassword("operator.account2", "operator.account"), PasswordProblem::None);
    EXPECT_EQ(kPasswordMinChars, 15u);  // NIST SP 800-63B-4, plan question 5
    EXPECT_EQ(kPasswordMaxChars, 128u);
}

TEST(SecureZero, OverwritesTheBytes) {
    char buf[40];
    std::fill(buf, buf + sizeof buf, 'x');
    secureZero(buf, sizeof buf);
    EXPECT_TRUE(std::all_of(buf, buf + sizeof buf, [](char c) { return c == 0; }));
    std::string s(40, 'y');
    const char* data = s.data();
    secureZero(s);
    EXPECT_TRUE(s.empty());
    EXPECT_TRUE(std::all_of(data, data + 40, [](char c) { return c == 0; }));  // same buffer
}

// --- The hash thread

TEST(PasswordHasher, OneAtATimeAndAtMostFourWaiting) {
    Gate gate;
    std::atomic<int> inside{0}, maxInside{0};
    PasswordHasher hasher([&](std::string_view pw, const PasswordHash& ref) {
        const int n = ++inside;
        int seen = maxInside.load();
        while (n > seen && !maxInside.compare_exchange_weak(seen, n)) {
        }
        gate.pass();
        --inside;
        return std::string(pw) + "|" + ref.salt;
    });
    ReleaseOnExit releaseOnExit{gate};
    const PasswordHash ref = refWithSalt("salt");
    auto first = hasher.submit("p0", ref);
    ASSERT_TRUE(first.has_value());
    ASSERT_TRUE(gate.waitEntered(1));
    std::vector<std::future<std::string>> waiting;
    for (int i = 1; i <= 4; ++i) {
        auto f = hasher.submit("p" + std::to_string(i), ref);
        ASSERT_TRUE(f.has_value()) << i;
        waiting.push_back(std::move(*f));
    }
    EXPECT_EQ(hasher.waiting(), 4u);
    EXPECT_FALSE(hasher.submit("p5", ref).has_value()) << "a 5th one waiting: refused at once";
    gate.release();
    EXPECT_EQ(first->get(), "p0|salt");
    for (int i = 1; i <= 4; ++i) EXPECT_EQ(waiting[i - 1].get(), "p" + std::to_string(i) + "|salt");
    EXPECT_EQ(maxInside.load(), 1);
    EXPECT_EQ(hasher.waiting(), 0u);
    auto again = hasher.submit("p6", ref);
    ASSERT_TRUE(again.has_value());
    EXPECT_EQ(again->get(), "p6|salt");
}

TEST(PasswordHasher, RunsAtNicePlusTenOnItsOwnThread) {
    const int base = threadNice();
    std::atomic<int> seen{-100};
    std::atomic<bool> otherThread{false};
    const auto caller = std::this_thread::get_id();
    PasswordHasher hasher([&](std::string_view, const PasswordHash&) {
        seen = threadNice();
        otherThread = std::this_thread::get_id() != caller;
        return std::string(kHashBytes, 'h');
    });
    auto f = hasher.submit("x", refWithSalt("s"));
    ASSERT_TRUE(f.has_value());
    EXPECT_EQ(f->get(), std::string(kHashBytes, 'h'));
    EXPECT_EQ(seen.load(), std::min(19, base + 10));
    EXPECT_TRUE(otherThread.load());
    EXPECT_EQ(threadNice(), base) << "the caller keeps its priority";
}

TEST(PasswordHasher, AFailureReachesItsCallerOnly) {
    PasswordHasher hasher([](std::string_view pw, const PasswordHash&) -> std::string {
        if (pw == "bad") throw std::runtime_error("argon2id: Memory allocation error");
        return std::string(pw);
    });
    auto bad = hasher.submit("bad", refWithSalt("s"));
    auto good = hasher.submit("good", refWithSalt("s"));
    ASSERT_TRUE(bad.has_value());
    ASSERT_TRUE(good.has_value());
    EXPECT_THROW(bad->get(), std::runtime_error);
    EXPECT_EQ(good->get(), "good");
}

TEST(PasswordHasher, DefaultIsArgon2id) {
    PasswordHasher hasher;
    PasswordHash ref;
    ref.params = kFast;
    ref.salt = "0123456789abcdef";
    auto f = hasher.submit("correct horse battery staple", ref);
    ASSERT_TRUE(f.has_value());
    EXPECT_EQ(f->get(), argon2idHash("correct horse battery staple", ref.salt, kFast));
}
