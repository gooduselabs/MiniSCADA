#include "core/update/envelope.hpp"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <cerrno>
#include <cstring>

namespace mat::update {

bool readFileLimited(const std::string& path, size_t maxBytes, std::string& out) {
    out.clear();
    const int fd = ::open(path.c_str(), O_RDONLY | O_CLOEXEC);
    if (fd < 0) return false;
    struct stat st {};
    bool ok = ::fstat(fd, &st) == 0 && S_ISREG(st.st_mode) &&
              static_cast<uint64_t>(st.st_size) <= maxBytes;
    if (ok) {
        out.resize(static_cast<size_t>(st.st_size));
        size_t got = 0;
        while (got < out.size()) {
            const ssize_t r = ::read(fd, &out[got], out.size() - got);
            if (r < 0 && errno == EINTR) continue;
            if (r <= 0) break;
            got += static_cast<size_t>(r);
        }
        out.resize(got);
    }
    ::close(fd);
    return ok;
}

size_t MemorySource::read(uint8_t* p, size_t n) {
    const size_t k = std::min(n, size_ - pos_);
    if (k) std::memcpy(p, data_ + pos_, k);
    pos_ += k;
    return k;
}

bool MemorySource::seek(uint64_t offset) {
    if (offset > size_) return false;
    pos_ = static_cast<size_t>(offset);
    return true;
}

FileSource::~FileSource() {
    if (fd_ >= 0) ::close(fd_);
}

bool FileSource::open(const std::string& path, std::string& err) {
    if (fd_ >= 0) ::close(fd_);
    fd_ = ::open(path.c_str(), O_RDONLY | O_CLOEXEC);
    if (fd_ < 0) {
        err = std::string("cannot open: ") + std::strerror(errno);
        return false;
    }
    struct stat st {};
    if (::fstat(fd_, &st) != 0 || !S_ISREG(st.st_mode)) {
        err = "not a regular file";
        ::close(fd_);
        fd_ = -1;
        return false;
    }
    size_ = static_cast<uint64_t>(st.st_size);
    return true;
}

size_t FileSource::read(uint8_t* p, size_t n) {
    size_t got = 0;
    while (got < n && fd_ >= 0) {
        const ssize_t r = ::read(fd_, p + got, n - got);
        if (r < 0 && errno == EINTR) continue;
        if (r <= 0) break;
        got += static_cast<size_t>(r);
    }
    return got;
}

bool FileSource::seek(uint64_t offset) {
    return fd_ >= 0 &&
           ::lseek(fd_, static_cast<off_t>(offset), SEEK_SET) == static_cast<off_t>(offset);
}

namespace {

// An octal field of a ustar header (leading spaces, then digits, then NUL or space); -1 when it is
// not one or above 2^36 (64 GiB: no member of ours comes near).
int64_t octalField(const uint8_t* p, size_t n) {
    size_t i = 0;
    while (i < n && p[i] == ' ') ++i;
    int64_t v = 0;
    bool any = false;
    for (; i < n && p[i] != 0 && p[i] != ' '; ++i) {
        if (p[i] < '0' || p[i] > '7') return -1;
        v = v * 8 + (p[i] - '0');
        if (v > (int64_t(1) << 36)) return -1;
        any = true;
    }
    for (; i < n; ++i)  // only terminators may follow
        if (p[i] != 0 && p[i] != ' ') return -1;
    return any ? v : -1;
}

bool allZero(const uint8_t* b, size_t n) {
    for (size_t i = 0; i < n; ++i)
        if (b[i]) return false;
    return true;
}

uint64_t padded(uint64_t n) { return (n + kTarBlock - 1) / kTarBlock * kTarBlock; }

}  // namespace

std::optional<Error> checkMemberHeader(const uint8_t* h, const char* wantName, uint64_t maxSize,
                                       uint64_t& size) {
    const int64_t stored = octalField(h + 148, 8);
    uint64_t sum = 0;
    for (size_t i = 0; i < kTarBlock; ++i) sum += (i >= 148 && i < 156) ? ' ' : h[i];
    if (stored < 0 || static_cast<uint64_t>(stored) != sum)
        return invalid("ENVELOPE_HEADER", "checksum");
    if (std::memcmp(h + 257, "ustar", 5) != 0) return invalid("ENVELOPE_HEADER", "magic");
    const char t = static_cast<char>(h[156]);
    if (t != '0' && t != '\0')
        return invalid("ENVELOPE_HEADER", std::string("type ") + (t ? t : '0'));
    if (h[345] != 0) return invalid("ENVELOPE_HEADER", "prefix");
    char name[101] = {0};
    std::memcpy(name, h, 100);
    if (std::strcmp(name, wantName) != 0) return invalid("ENVELOPE_ORDER", name);
    const int64_t s = octalField(h + 124, 12);
    if (s < 0) return invalid("ENVELOPE_HEADER", "size field");
    if (static_cast<uint64_t>(s) > maxSize) return invalid("ENVELOPE_SIZE", wantName);
    size = static_cast<uint64_t>(s);
    return std::nullopt;
}

std::optional<Error> readHead(Source& in, EnvelopeHead& head) {
    std::array<uint8_t, kTarBlock> h{};
    uint64_t size = 0;
    head.end = 0;
    // member 1: update.json
    if (in.read(h.data(), kTarBlock) != kTarBlock) return invalid("ENVELOPE_TRUNCATED", "header 1");
    if (auto e = checkMemberHeader(h.data(), "update.json", kManifestMaxBytes, size)) return e;
    std::string manifest(padded(size), '\0');
    if (!manifest.empty() &&
        in.read(reinterpret_cast<uint8_t*>(&manifest[0]), manifest.size()) != manifest.size())
        return invalid("ENVELOPE_TRUNCATED", "update.json");
    manifest.resize(size);
    head.end += kTarBlock + padded(size);
    // member 2: update.sig
    if (in.read(h.data(), kTarBlock) != kTarBlock) return invalid("ENVELOPE_TRUNCATED", "header 2");
    if (auto e = checkMemberHeader(h.data(), "update.sig", kSigMaxBytes, size)) return e;
    std::vector<uint8_t> sig(padded(size));
    if (!sig.empty() && in.read(sig.data(), sig.size()) != sig.size())
        return invalid("ENVELOPE_TRUNCATED", "update.sig");
    sig.resize(size);
    head.end += kTarBlock + padded(size);
    head.manifest = std::move(manifest);
    head.sig = std::move(sig);
    return std::nullopt;
}

std::optional<Error> readPayload(Source& in, uint64_t maxSize, const EnvelopeHead& head,
                                 PayloadInfo& info,
                                 const std::function<void(const uint8_t*, size_t)>& sink) {
    std::array<uint8_t, kTarBlock> h{};
    if (in.read(h.data(), kTarBlock) != kTarBlock) return invalid("ENVELOPE_TRUNCATED", "header 3");
    uint64_t size = 0;
    if (auto e = checkMemberHeader(h.data(), "payload.tar.gz", maxSize, size)) return e;
    info.offset = head.end + kTarBlock;
    info.size = size;
    std::vector<uint8_t> buf(64 * 1024);
    uint64_t left = padded(size), data = size;
    while (left) {
        const size_t n = static_cast<size_t>(std::min<uint64_t>(left, buf.size()));
        if (in.read(buf.data(), n) != n) return invalid("ENVELOPE_TRUNCATED", "payload");
        const size_t use = static_cast<size_t>(std::min<uint64_t>(data, n));
        if (use && sink) sink(buf.data(), use);
        data -= use;
        left -= n;
    }
    // the end of the archive: two zero blocks, then nothing that is not zero
    for (int i = 0; i < 2; ++i) {
        if (in.read(h.data(), kTarBlock) != kTarBlock)
            return invalid("ENVELOPE_TRUNCATED", "end of archive");
        if (!allZero(h.data(), kTarBlock)) return invalid("ENVELOPE_EXTRA_MEMBER", "fourth member");
    }
    // tar pads archives to a record (10 KiB with GNU tar): only zero bytes may follow
    for (;;) {
        const size_t n = in.read(buf.data(), buf.size());
        if (!allZero(buf.data(), n)) return invalid("ENVELOPE_EXTRA_MEMBER", "data after the end");
        if (n < buf.size()) break;
    }
    return std::nullopt;
}

}  // namespace mat::update
