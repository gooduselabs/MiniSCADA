#include "core/auth/password_hash.hpp"
#include "core/common/thread_name.hpp"

#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <cerrno>
#include <climits>
#include <condition_variable>
#include <cstring>
#include <deque>
#include <exception>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <utility>

#include "argon2.h"
#include "core/common/utf8.hpp"
#include "core/crypto/ct_compare.hpp"
#include "core/crypto/random.hpp"

namespace mat {

namespace {

// --- Standard base64 without padding: the PHC string format.

constexpr char kB64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

int b64Value(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}

std::string b64Encode(std::string_view bytes) {
    std::string out;
    out.reserve((bytes.size() * 4 + 2) / 3);
    uint32_t acc = 0;
    int bits = 0;
    for (const char c : bytes) {
        acc = (acc << 8 | static_cast<uint8_t>(c)) & 0xFFFF;
        bits += 8;
        while (bits >= 6) {
            bits -= 6;
            out += kB64[acc >> bits & 63];
        }
    }
    if (bits > 0) out += kB64[acc << (6 - bits) & 63];
    return out;
}

// Canonical text only: no padding, no other character, the unused low bits of the last character
// zero. Every value then has exactly one text.
std::optional<std::string> b64Decode(std::string_view text) {
    if (text.size() % 4 == 1) return std::nullopt;
    std::string out;
    out.reserve(text.size() * 3 / 4);
    uint32_t acc = 0;
    int bits = 0;
    for (const char c : text) {
        const int v = b64Value(c);
        if (v < 0) return std::nullopt;
        acc = (acc << 6 | static_cast<uint32_t>(v)) & 0xFFFFFF;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out += static_cast<char>(acc >> bits & 0xFF);
        }
    }
    if ((acc & ((1u << bits) - 1)) != 0) return std::nullopt;
    return out;
}

// --- PHC parsing

bool takeLiteral(std::string_view& s, std::string_view literal) {
    if (s.substr(0, literal.size()) != literal) return false;
    s.remove_prefix(literal.size());
    return true;
}

// 1–10 decimal digits, no leading zero, at most UINT32_MAX.
bool takeNumber(std::string_view& s, uint32_t& out) {
    size_t n = 0;
    uint64_t v = 0;
    while (n < s.size() && s[n] >= '0' && s[n] <= '9') {
        if (n == 10) return false;
        v = v * 10 + static_cast<uint64_t>(s[n] - '0');
        ++n;
    }
    if (n == 0 || (n > 1 && s[0] == '0') || v > UINT32_MAX) return false;
    out = static_cast<uint32_t>(v);
    s.remove_prefix(n);
    return true;
}

// --- Hash memory: mmap per hash, munmap right after (research R7, Constitution III). With malloc,
// glibc keeps a freed 19 MiB block in the heap after it has raised its mmap threshold, so the
// peak of one sign-in would stay in the RSS.

std::atomic<uint64_t> gMaps{0}, gUnmaps{0}, gLive{0}, gPeak{0};

int mmapAllocate(uint8_t** memory, size_t bytes) {
    void* p = ::mmap(nullptr, bytes, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (p == MAP_FAILED) {
        *memory = nullptr;  // the library checks the pointer, not this return value
        return ARGON2_MEMORY_ALLOCATION_ERROR;
    }
#ifdef MADV_DONTDUMP
    ::madvise(p, bytes, MADV_DONTDUMP);  // blocks derived from a password stay out of core dumps
#endif
    ++gMaps;
    const uint64_t live = gLive += bytes;
    uint64_t peak = gPeak.load();
    while (live > peak && !gPeak.compare_exchange_weak(peak, live)) {
    }
    *memory = static_cast<uint8_t*>(p);
    return ARGON2_OK;
}

// The library wipes the blocks before it calls this.
void mmapFree(uint8_t* memory, size_t bytes) {
    if (!memory) return;
    ::munmap(memory, bytes);
    ++gUnmaps;
    gLive -= bytes;
}

uint8_t* bytesOf(std::string_view s) {
    // The library takes non-const pointers; without the ARGON2_FLAG_CLEAR_* flags it only reads.
    return s.empty() ? nullptr : reinterpret_cast<uint8_t*>(const_cast<char*>(s.data()));
}

bool asciiEqualIgnoringCase(std::string_view a, std::string_view b) {
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i) {
        char x = a[i], y = b[i];
        if (x >= 'A' && x <= 'Z') x = static_cast<char>(x - 'A' + 'a');
        if (y >= 'A' && y <= 'Z') y = static_cast<char>(y - 'A' + 'a');
        if (x != y) return false;
    }
    return true;
}

}  // namespace

std::optional<PasswordHash> parsePhc(std::string_view text, std::string* why) {
    auto fail = [why](const char* reason) -> std::optional<PasswordHash> {
        if (why) *why = reason;
        return std::nullopt;
    };
    std::string_view s = text;
    if (!takeLiteral(s, "$argon2id$")) return fail("not an Argon2id hash");
    if (!takeLiteral(s, "v=19$")) return fail("not Argon2 version 19");
    PasswordHash h;
    if (!takeLiteral(s, "m=") || !takeNumber(s, h.params.mKiB) || !takeLiteral(s, ",t=") ||
        !takeNumber(s, h.params.t) || !takeLiteral(s, ",p=") || !takeNumber(s, h.params.p) ||
        !takeLiteral(s, "$"))
        return fail("parameters are not m=<KiB>,t=<passes>,p=<lanes>");
    if (h.params.mKiB < kArgon2MinMKiB || h.params.mKiB > kArgon2MaxMKiB)
        return fail("m outside 8192-65536 KiB");
    if (h.params.t < kArgon2MinT || h.params.t > kArgon2MaxT) return fail("t outside 1-10");
    if (h.params.p != 1) return fail("p is not 1");
    const size_t dollar = s.find('$');
    if (dollar == std::string_view::npos) return fail("no hash after the salt");
    auto salt = b64Decode(s.substr(0, dollar));
    auto hash = b64Decode(s.substr(dollar + 1));
    if (!salt || !hash) return fail("salt or hash is not canonical base64 without padding");
    if (salt->size() < kSaltMinBytes || salt->size() > kSaltMaxBytes)
        return fail("salt is not 16-64 bytes");
    if (hash->size() != kHashBytes) return fail("hash is not 32 bytes");
    h.salt = std::move(*salt);
    h.hash = std::move(*hash);
    return h;
}

std::string formatPhc(const PasswordHash& h) {
    return "$argon2id$v=19$m=" + std::to_string(h.params.mKiB) +
           ",t=" + std::to_string(h.params.t) + ",p=" + std::to_string(h.params.p) + "$" +
           b64Encode(h.salt) + "$" + b64Encode(h.hash);
}

std::string detail::argon2idHashFull(std::string_view password, std::string_view salt,
                                     std::string_view secret, std::string_view ad, uint32_t mKiB,
                                     uint32_t t, uint32_t lanes, size_t outLen) {
    if (password.size() > UINT32_MAX || salt.size() > UINT32_MAX || secret.size() > UINT32_MAX ||
        ad.size() > UINT32_MAX || outLen > UINT32_MAX)
        throw std::invalid_argument("argon2id: input too long");
    std::string out(outLen, '\0');
    argon2_context ctx{};
    ctx.out = reinterpret_cast<uint8_t*>(&out[0]);
    ctx.outlen = static_cast<uint32_t>(outLen);
    ctx.pwd = bytesOf(password);
    ctx.pwdlen = static_cast<uint32_t>(password.size());
    ctx.salt = bytesOf(salt);
    ctx.saltlen = static_cast<uint32_t>(salt.size());
    ctx.secret = bytesOf(secret);
    ctx.secretlen = static_cast<uint32_t>(secret.size());
    ctx.ad = bytesOf(ad);
    ctx.adlen = static_cast<uint32_t>(ad.size());
    ctx.t_cost = t;
    ctx.m_cost = mKiB;
    ctx.lanes = lanes;
    ctx.threads = lanes;  // built with ARGON2_NO_THREADS: the lanes run one after the other
    ctx.version = ARGON2_VERSION_13;
    ctx.allocate_cbk = mmapAllocate;
    ctx.free_cbk = mmapFree;
    ctx.flags = ARGON2_DEFAULT_FLAGS;
    const int rc = argon2_ctx(&ctx, Argon2_id);
    if (rc != ARGON2_OK) {
        secureZero(out);
        throw std::runtime_error(std::string("argon2id: ") + argon2_error_message(rc));
    }
    return out;
}

detail::Argon2MemoryStats detail::argon2MemoryStats() {
    Argon2MemoryStats s;
    s.maps = gMaps.load();
    s.unmaps = gUnmaps.load();
    s.liveBytes = gLive.load();
    s.peakBytes = gPeak.load();
    return s;
}

std::string argon2idHash(std::string_view password, std::string_view salt,
                         const Argon2Params& params) {
    return detail::argon2idHashFull(password, salt, {}, {}, params.mKiB, params.t, params.p,
                                    kHashBytes);
}

std::string hashPassword(std::string_view password, const Argon2Params& params) {
    PasswordHash h;
    h.params = params;
    h.salt = randomBytes(kSaltBytes);
    h.hash = argon2idHash(password, h.salt, params);
    return formatPhc(h);
}

bool verifyPassword(std::string_view password, const PasswordHash& stored) {
    std::string computed = argon2idHash(password, stored.salt, stored.params);
    const bool equal = constantTimeEqual(computed, stored.hash);
    secureZero(computed);
    return equal;
}

bool needsRehash(const PasswordHash& stored, const Argon2Params& current) {
    return stored.params != current;
}

PasswordHash dummyPasswordHash(const Argon2Params& params) {
    PasswordHash h;
    h.params = params;
    h.salt = randomBytes(kSaltBytes);
    h.hash = randomBytes(kHashBytes);
    return h;
}

PasswordProblem checkNewPassword(std::string_view password, std::string_view accountName) {
    std::string copy(password);  // isValidUtf8 takes a string; wiped right after
    const bool utf8 = isValidUtf8(copy);
    secureZero(copy);
    if (!utf8) return PasswordProblem::NotUtf8;
    size_t chars = 0;
    for (const char c : password)
        if ((static_cast<unsigned char>(c) & 0xC0) != 0x80) ++chars;
    if (chars < kPasswordMinChars) return PasswordProblem::TooShort;
    if (chars > kPasswordMaxChars || password.size() > kPasswordMaxBytes)
        return PasswordProblem::TooLong;
    if (asciiEqualIgnoringCase(password, accountName)) return PasswordProblem::SameAsName;
    return PasswordProblem::None;
}

void secureZero(void* data, size_t len) {
    volatile unsigned char* p = static_cast<volatile unsigned char*>(data);
    while (len--) *p++ = 0;
}

void secureZero(std::string& s) {
    s.resize(s.capacity());  // the bytes past the end too; no reallocation
    if (!s.empty()) secureZero(&s[0], s.size());
    s.clear();
}

// --- PasswordHasher

struct PasswordHasher::Impl {
    struct Job {
        std::string password;
        PasswordHash ref;
        std::promise<std::string> result;
    };

    HashFn hash;
    AuthLogFn log;
    size_t maxWaiting;
    mutable std::mutex mu;
    std::condition_variable cv;
    std::deque<std::unique_ptr<Job>> queue;  // pointers: a job never moves, nor does its password
    bool stopping = false;
    std::thread worker;

    // Linux keeps a nice value per thread: only the hashes give way to the runtime (as the
    // forwarder of 003 does).
    void lowerPriority() {
        const auto tid = static_cast<id_t>(::syscall(SYS_gettid));
        errno = 0;
        const int current = ::getpriority(PRIO_PROCESS, tid);
        if (errno != 0 || ::setpriority(PRIO_PROCESS, tid, std::min(19, current + 10)) != 0)
            log(std::string("password hash thread keeps its priority: ") + std::strerror(errno));
    }

    void run() {
        lowerPriority();
        for (;;) {
            std::unique_ptr<Job> job;
            {
                std::unique_lock<std::mutex> l(mu);
                cv.wait(l, [&] { return stopping || !queue.empty(); });
                if (stopping) break;
                job = std::move(queue.front());
                queue.pop_front();
            }
            try {
                std::string out = hash(job->password, job->ref);
                secureZero(job->password);
                job->result.set_value(std::move(out));
            } catch (...) {
                secureZero(job->password);
                job->result.set_exception(std::current_exception());
            }
        }
        std::deque<std::unique_ptr<Job>> rest;
        {
            std::lock_guard<std::mutex> l(mu);
            rest.swap(queue);
        }
        for (auto& job : rest) {
            secureZero(job->password);
            job->result.set_exception(
                std::make_exception_ptr(std::runtime_error("password hasher stopped")));
        }
    }
};

PasswordHasher::PasswordHasher(HashFn hash, AuthLogFn log, size_t maxWaiting) : impl_(new Impl) {
    impl_->hash = hash ? std::move(hash) : [](std::string_view password, const PasswordHash& ref) {
        return argon2idHash(password, ref.salt, ref.params);
    };
    impl_->log = authLogOrStderr(std::move(log));
    impl_->maxWaiting = maxWaiting;
    Impl* p = impl_.get();
    impl_->worker = std::thread([p] {
        setThreadName("mat-argon2");
        p->run();
    });
}

PasswordHasher::~PasswordHasher() {
    {
        std::lock_guard<std::mutex> l(impl_->mu);
        impl_->stopping = true;
    }
    impl_->cv.notify_all();
    if (impl_->worker.joinable()) impl_->worker.join();
}

std::optional<std::future<std::string>> PasswordHasher::submit(std::string_view password,
                                                               const PasswordHash& ref) {
    auto job = std::make_unique<Impl::Job>();
    std::lock_guard<std::mutex> l(impl_->mu);
    if (impl_->stopping || impl_->queue.size() >= impl_->maxWaiting) return std::nullopt;
    job->password.assign(password.data(), password.size());
    job->ref.params = ref.params;
    job->ref.salt = ref.salt;
    std::future<std::string> result = job->result.get_future();
    impl_->queue.push_back(std::move(job));
    impl_->cv.notify_one();
    return result;
}

size_t PasswordHasher::waiting() const {
    std::lock_guard<std::mutex> l(impl_->mu);
    return impl_->queue.size();
}

}  // namespace mat
