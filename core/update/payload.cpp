#include "core/update/payload.hpp"

#include <algorithm>
#include <array>
#include <cstring>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>

#include "core/update/paths.hpp"
#include "mbedtls/sha256.h"
#include "miniz.h"

namespace mat::update {

namespace {

std::string hexOf(const unsigned char* p, size_t n) {
    static const char* d = "0123456789abcdef";
    std::string s;
    for (size_t i = 0; i < n; ++i) {
        s.push_back(d[p[i] >> 4]);
        s.push_back(d[p[i] & 15]);
    }
    return s;
}

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
    return any ? v : -1;
}

// gzip (RFC 1952) member: header, raw deflate, CRC-32 and size trailer. Only one member; FEXTRA,
// FNAME, FCOMMENT and FHCRC are skipped as the RFC says. The output goes to a sink in pieces.
class Gunzip {
   public:
    // Feed compressed bytes; `out` gets the inflated bytes. Returns "" or an error.
    std::string feed(const uint8_t* p, size_t n,
                     const std::function<std::string(const uint8_t*, size_t)>& out) {
        size_t i = 0;
        while (i < n) {
            if (state_ == State::Header) {
                header_.push_back(p[i++]);
                const std::string e = parseHeader();
                if (!e.empty()) return e;
            } else if (state_ == State::Body) {
                size_t inBytes = n - i;
                size_t outBytes = window_.size() - (outPos_ & (window_.size() - 1));
                uint8_t* dst = window_.data() + (outPos_ & (window_.size() - 1));
                const tinfl_status st =
                    tinfl_decompress(inflater_.get(), p + i, &inBytes, window_.data(), dst,
                                     &outBytes, TINFL_FLAG_HAS_MORE_INPUT);
                i += inBytes;
                if (outBytes) {
                    crc_ = static_cast<uint32_t>(mz_crc32(crc_, dst, outBytes));
                    total_ += outBytes;
                    outPos_ += outBytes;
                    const std::string e = out(dst, outBytes);
                    if (!e.empty()) return e;
                }
                if (st == TINFL_STATUS_DONE) {
                    state_ = State::Trailer;
                } else if (st < 0) {
                    return "deflate";
                } else if (st == TINFL_STATUS_NEEDS_MORE_INPUT && inBytes == 0 && outBytes == 0 &&
                           i == n) {
                    break;
                }
            } else if (state_ == State::Trailer) {
                trailer_.push_back(p[i++]);
                if (trailer_.size() == 8) {
                    const uint32_t crc = rd32(&trailer_[0]), isize = rd32(&trailer_[4]);
                    if (crc != crc_) return "gzip crc";
                    if (isize != static_cast<uint32_t>(total_)) return "gzip size";
                    state_ = State::Done;
                }
            } else {
                return "data after the gzip member";
            }
        }
        return "";
    }
    bool done() const { return state_ == State::Done; }

   private:
    enum class State { Header, Body, Trailer, Done };
    static uint32_t rd32(const uint8_t* p) {
        return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24;
    }
    // Called after each header byte: moves to Body once the header is complete.
    std::string parseHeader() {
        const auto& h = header_;
        if (h.size() > 4096) return "gzip header too long";
        if (h.size() < 10) return "";
        if (h[0] != 0x1f || h[1] != 0x8b || h[2] != 8) return "not gzip";
        const uint8_t flg = h[3];
        if (flg & 0xe0) return "gzip flags";
        size_t pos = 10;
        if (flg & 4) {  // FEXTRA
            if (h.size() < pos + 2) return "";
            const size_t xlen = h[pos] | (h[pos + 1] << 8);
            pos += 2 + xlen;
            if (h.size() < pos) return "";
        }
        for (uint8_t bit : {uint8_t(8), uint8_t(16)}) {  // FNAME, FCOMMENT: NUL-terminated
            if (!(flg & bit)) continue;
            while (pos < h.size() && h[pos] != 0) ++pos;
            if (pos >= h.size()) return "";
            ++pos;
        }
        if (flg & 2) pos += 2;  // FHCRC
        if (h.size() < pos) return "";
        if (h.size() > pos) return "gzip header";
        state_ = State::Body;
        inflater_ = std::make_unique<tinfl_decompressor>();
        tinfl_init(inflater_.get());
        return "";
    }

    State state_ = State::Header;
    std::vector<uint8_t> header_;
    std::vector<uint8_t> trailer_;
    std::unique_ptr<tinfl_decompressor> inflater_;
    std::array<uint8_t, TINFL_LZ_DICT_SIZE> window_{};
    uint64_t outPos_ = 0;
    uint64_t total_ = 0;
    uint32_t crc_ = 0;
};

// The tar stream read from the inflated bytes: headers, regular files hashed as they pass.
class TarScan {
   public:
    explicit TarScan(const Manifest& m) {
        for (size_t i = 0; i < m.files.size(); ++i) want_.emplace(m.files[i].path, &m.files[i]);
    }
    // "" to go on, else stop with err_ set
    std::string feed(const uint8_t* p, size_t n) {
        size_t i = 0;
        while (i < n) {
            if (ended_) {
                // after the two zero blocks: only zero padding
                if (p[i++] != 0) return fail("PAYLOAD_FORMAT", "data after the end of the tar");
                continue;
            }
            if (left_ == 0 && padLeft_ == 0) {
                const size_t k = std::min(n - i, kTarBlock - hdrFill_);
                std::memcpy(hdr_.data() + hdrFill_, p + i, k);
                hdrFill_ += k;
                i += k;
                if (hdrFill_ == kTarBlock) {
                    hdrFill_ = 0;
                    const std::string e = header();
                    if (!e.empty()) return e;
                }
                continue;
            }
            if (left_ > 0) {
                const size_t k = static_cast<size_t>(std::min<uint64_t>(n - i, left_));
                if (hashing_) mbedtls_sha256_update(&sha_, p + i, k);
                left_ -= k;
                i += k;
                if (left_ == 0) {
                    const std::string e = endFile();
                    if (!e.empty()) return e;
                }
                continue;
            }
            const size_t k = static_cast<size_t>(std::min<uint64_t>(n - i, padLeft_));
            padLeft_ -= k;
            i += k;
        }
        return "";
    }
    std::optional<Error> finish() {
        if (err_) return err_;
        if (!ended_ || left_ || padLeft_ || hdrFill_)
            return invalid("PAYLOAD_FORMAT", "tar cut short");
        for (const auto& kv : want_)
            if (!seen_.count(kv.first)) return invalid("FILE_MISSING", kv.first);
        return std::nullopt;
    }
    std::optional<Error> error() const { return err_; }
    uint64_t unpacked() const { return unpacked_; }

   private:
    std::string fail(const char* code, const std::string& detail) {
        if (!err_) err_ = invalid(code, detail);
        return code;
    }
    std::string header() {
        const uint8_t* h = hdr_.data();
        bool zero = true;
        for (size_t k = 0; k < kTarBlock; ++k)
            if (h[k]) zero = false;
        if (zero) {
            if (++zeros_ == 2) ended_ = true;
            return "";
        }
        if (zeros_) return fail("PAYLOAD_FORMAT", "zero block inside the tar");
        const int64_t stored = octalField(h + 148, 8);
        uint64_t sum = 0;
        for (size_t k = 0; k < kTarBlock; ++k) sum += (k >= 148 && k < 156) ? ' ' : h[k];
        if (stored < 0 || static_cast<uint64_t>(stored) != sum)
            return fail("PAYLOAD_FORMAT", "tar header checksum");
        std::string name(reinterpret_cast<const char*>(h),
                         strnlen(reinterpret_cast<const char*>(h), 100));
        if (std::memcmp(h + 257, "ustar", 5) == 0 && h[345]) {
            const std::string prefix(reinterpret_cast<const char*>(h + 345),
                                     strnlen(reinterpret_cast<const char*>(h + 345), 155));
            name = prefix + "/" + name;
        }
        const char t = static_cast<char>(h[156]);
        const int64_t size = octalField(h + 124, 12);
        if (size < 0) return fail("PAYLOAD_FORMAT", "tar size field");
        if (t == '1' || t == '2') return fail("LINK_FORBIDDEN", name);
        if (t == '3' || t == '4' || t == '6' || t == '7') return fail("SPECIAL_FORBIDDEN", name);
        if (t == '5') {
            if (size != 0 || !allowedDirectory(name)) return fail("PATH_INVALID", name);
            return "";
        }
        if (t != '0' && t != '\0') return fail("PATH_INVALID", name);  // x, g, L, K, others
        const auto it = want_.find(name);
        if (it == want_.end() || seen_.count(name)) return fail("FILE_EXTRA", name);
        seen_.insert(name);
        unpacked_ += static_cast<uint64_t>(size);
        if (unpacked_ > kUnpackedMaxBytes) return fail("UNPACKED_TOO_LARGE", name);
        if (static_cast<uint64_t>(size) != it->second->size) return fail("FILE_DIGEST", name);
        current_ = it->second;
        left_ = static_cast<uint64_t>(size);
        padLeft_ = (kTarBlock - left_ % kTarBlock) % kTarBlock;
        hashing_ = true;
        mbedtls_sha256_init(&sha_);
        mbedtls_sha256_starts(&sha_, 0);
        if (left_ == 0) return endFile();
        return "";
    }
    std::string endFile() {
        unsigned char d[32];
        mbedtls_sha256_finish(&sha_, d);
        mbedtls_sha256_free(&sha_);
        hashing_ = false;
        if (hexOf(d, 32) != current_->sha256) return fail("FILE_DIGEST", current_->path);
        return "";
    }

    std::map<std::string, const FileEntry*> want_;
    std::set<std::string> seen_;
    std::array<uint8_t, kTarBlock> hdr_{};
    size_t hdrFill_ = 0;
    uint64_t left_ = 0, padLeft_ = 0, unpacked_ = 0;
    int zeros_ = 0;
    bool ended_ = false;
    bool hashing_ = false;
    mbedtls_sha256_context sha_{};
    const FileEntry* current_ = nullptr;
    std::optional<Error> err_;
};

}  // namespace

std::optional<Error> scanPayload(Source& in, uint64_t size, const Manifest& m) {
    Gunzip gz;
    TarScan tar(m);
    std::vector<uint8_t> buf(64 * 1024);
    uint64_t left = size;
    std::string gzErr;
    uint64_t inflated = 0;
    // the files (≤ 128 MiB), their headers and padding, the end blocks and a tar record
    const uint64_t kInflatedMaxBytes =
        kUnpackedMaxBytes + 1024ULL * (m.files.size() + 64) + (10 << 20);
    while (left) {
        const size_t n = static_cast<size_t>(std::min<uint64_t>(left, buf.size()));
        if (in.read(buf.data(), n) != n) return invalid("ENVELOPE_TRUNCATED", "payload");
        left -= n;
        gzErr = gz.feed(buf.data(), n, [&](const uint8_t* p, size_t k) {
            // zero blocks after the end of the tar cost CPU too: the inflated stream is bounded
            inflated += k;
            if (inflated > kInflatedMaxBytes) return std::string("UNPACKED_TOO_LARGE");
            return tar.feed(p, k);
        });
        if (!gzErr.empty()) break;
    }
    if (auto e = tar.error()) return e;
    if (gzErr == "UNPACKED_TOO_LARGE") return invalid("UNPACKED_TOO_LARGE", "inflated stream");
    if (!gzErr.empty()) return invalid("PAYLOAD_FORMAT", gzErr);
    if (!gz.done()) return invalid("PAYLOAD_FORMAT", "gzip cut short");
    return tar.finish();
}

}  // namespace mat::update
