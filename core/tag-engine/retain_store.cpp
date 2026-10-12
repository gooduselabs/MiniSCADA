#include "core/tag-engine/retain_store.hpp"

#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <ctime>
#include <set>

namespace mat {

namespace {

constexpr char kMagic[8] = {'M', 'A', 'T', 'R', 'E', 'T', '0', '1'};
constexpr uint16_t kVersion = 1;
constexpr size_t kRecordMin = 4 + 8 + 1 + 2 + 4;

uint32_t crc32(const uint8_t* p, size_t n) {
    static uint32_t table[256];
    static bool init = false;
    if (!init) {
        for (uint32_t i = 0; i < 256; ++i) {
            uint32_t c = i;
            for (int k = 0; k < 8; ++k) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            table[i] = c;
        }
        init = true;
    }
    uint32_t c = 0xFFFFFFFFu;
    for (size_t i = 0; i < n; ++i) c = table[(c ^ p[i]) & 0xFF] ^ (c >> 8);
    return c ^ 0xFFFFFFFFu;
}

void put16(std::vector<uint8_t>& b, uint16_t v) {
    b.push_back(static_cast<uint8_t>(v));
    b.push_back(static_cast<uint8_t>(v >> 8));
}
void put32(std::vector<uint8_t>& b, uint32_t v) {
    for (int i = 0; i < 4; ++i) b.push_back(static_cast<uint8_t>(v >> (8 * i)));
}
void put64(std::vector<uint8_t>& b, uint64_t v) {
    for (int i = 0; i < 8; ++i) b.push_back(static_cast<uint8_t>(v >> (8 * i)));
}
uint16_t get16(const uint8_t* p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }
uint32_t get32(const uint8_t* p) {
    return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
           (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}
uint64_t get64(const uint8_t* p) {
    return static_cast<uint64_t>(get32(p)) | (static_cast<uint64_t>(get32(p + 4)) << 32);
}

bool isSigned(TagType t) {
    return t == TagType::INT16 || t == TagType::INT32 || t == TagType::INT64;
}

uint8_t typeCode(TagType t) { return static_cast<uint8_t>(t); }

// false when the value cannot be stored (a string that is too long, a value of the wrong kind)
bool putValue(std::vector<uint8_t>& b, TagType type, const TagScalar& v) {
    switch (type) {
        case TagType::BOOL:
            b.push_back(std::holds_alternative<bool>(v) && std::get<bool>(v) ? 1 : 0);
            return true;
        case TagType::FLOAT32: {
            double d = 0;
            if (const double* x = std::get_if<double>(&v)) d = *x;
            const float f = static_cast<float>(d);
            uint32_t u;
            std::memcpy(&u, &f, 4);
            put32(b, u);
            return true;
        }
        case TagType::FLOAT64: {
            double d = 0;
            if (const double* x = std::get_if<double>(&v)) d = *x;
            uint64_t u;
            std::memcpy(&u, &d, 8);
            put64(b, u);
            return true;
        }
        case TagType::STRING: {
            const std::string s =
                std::holds_alternative<std::string>(v) ? std::get<std::string>(v) : std::string();
            if (s.size() > RetainStore::kMaxString) return false;
            put16(b, static_cast<uint16_t>(s.size()));
            b.insert(b.end(), s.begin(), s.end());
            return true;
        }
        default: {
            uint64_t u = 0;
            if (const int64_t* i = std::get_if<int64_t>(&v))
                u = static_cast<uint64_t>(*i);
            else if (const uint64_t* x = std::get_if<uint64_t>(&v))
                u = *x;
            put64(b, u);
            return true;
        }
    }
}

// Parses one value; returns bytes consumed or 0 on a bad record.
size_t getValue(const uint8_t* p, size_t avail, TagType type, TagScalar& out) {
    switch (type) {
        case TagType::BOOL:
            if (avail < 1) return 0;
            out = p[0] != 0;
            return 1;
        case TagType::FLOAT32: {
            if (avail < 4) return 0;
            const uint32_t u = get32(p);
            float f;
            std::memcpy(&f, &u, 4);
            out = static_cast<double>(f);
            return 4;
        }
        case TagType::FLOAT64: {
            if (avail < 8) return 0;
            const uint64_t u = get64(p);
            double d;
            std::memcpy(&d, &u, 8);
            out = d;
            return 8;
        }
        case TagType::STRING: {
            if (avail < 2) return 0;
            const size_t n = get16(p);
            if (n > RetainStore::kMaxString || avail < 2 + n) return 0;
            out = std::string(reinterpret_cast<const char*>(p + 2), n);
            return 2 + n;
        }
        default: {
            if (avail < 8) return 0;
            const uint64_t u = get64(p);
            if (isSigned(type))
                out = static_cast<int64_t>(u);
            else
                out = u;
            return 8;
        }
    }
}

struct Decoded {
    uint64_t seq = 0;
    bool snapshot = false;
    std::vector<std::pair<std::string, RetainValue>> entries;
    size_t length = 0;
};

// false: not a valid record at `p`
bool decodeRecord(const uint8_t* p, size_t avail, Decoded& d) {
    if (avail < kRecordMin) return false;
    const size_t len = get32(p);
    if (len < kRecordMin || len > avail) return false;
    if (crc32(p, len - 4) != get32(p + len - 4)) return false;
    d.seq = get64(p + 4);
    d.snapshot = p[12] == 1;
    if (p[12] > 1) return false;
    const size_t count = get16(p + 13);
    size_t at = 15;
    const size_t end = len - 4;
    d.entries.clear();
    for (size_t i = 0; i < count; ++i) {
        if (at >= end) return false;
        const size_t idLen = p[at++];
        if (at + idLen + 1 > end) return false;
        std::string id(reinterpret_cast<const char*>(p + at), idLen);
        at += idLen;
        const uint8_t code = p[at++];
        if (code > typeCode(TagType::STRING)) return false;
        RetainValue v;
        v.type = static_cast<TagType>(code);
        const size_t used = getValue(p + at, end - at, v.type, v.value);
        if (used == 0) return false;
        at += used;
        d.entries.emplace_back(std::move(id), std::move(v));
    }
    if (at != end) return false;
    d.length = len;
    return true;
}

}  // namespace

const char* retainStatusName(RetainStatus s) {
    switch (s) {
        case RetainStatus::Ok:
            return "ok";
        case RetainStatus::Fresh:
            return "fresh";
        case RetainStatus::Fallback:
            return "fallback";
        default:
            return "lost";
    }
}

// ---- PosixRetainIo ----

PosixRetainIo::PosixRetainIo(std::string dir) : dir_(std::move(dir)) {}

PosixRetainIo::~PosixRetainIo() {
    for (auto& [n, fd] : fds_) ::close(fd);
}

bool PosixRetainIo::fail(const char* what) {
    const int e = errno;
    error_ =
        e == ENOSPC
            ? "ENOSPC"
            : e == EIO ? "EIO" : e == EACCES ? "EACCES" : e == EROFS ? "EROFS" : std::strerror(e);
    (void)what;
    return false;
}

bool PosixRetainIo::ensureDir() {
    // every missing level, 0700 (the data directory exists on the device; tests start from nothing)
    for (size_t at = dir_.find('/', 1);; at = dir_.find('/', at + 1)) {
        const std::string part = dir_.substr(0, at);
        if (::mkdir(part.c_str(), 0700) != 0 && errno != EEXIST) return fail("mkdir");
        if (at == std::string::npos) break;
    }
    ::chmod(dir_.c_str(), 0700);
    return true;
}

int PosixRetainIo::fdOf(const std::string& name) {
    auto it = fds_.find(name);
    if (it != fds_.end()) return it->second;
    const int fd = ::open((dir_ + "/" + name).c_str(), O_RDWR | O_CLOEXEC);
    if (fd < 0) {
        fail("open");
        return -1;
    }
    fds_[name] = fd;
    return fd;
}

void PosixRetainIo::closeFd(const std::string& name) {
    auto it = fds_.find(name);
    if (it == fds_.end()) return;
    ::close(it->second);
    fds_.erase(it);
}

bool PosixRetainIo::exists(const std::string& name) {
    struct stat st {};
    return ::stat((dir_ + "/" + name).c_str(), &st) == 0;
}

int64_t PosixRetainIo::size(const std::string& name) {
    struct stat st {};
    if (::stat((dir_ + "/" + name).c_str(), &st) != 0) return -1;
    return static_cast<int64_t>(st.st_size);
}

bool PosixRetainIo::createZeroed(const std::string& name, size_t size) {
    if (!ensureDir()) return false;
    closeFd(name);
    const std::string path = dir_ + "/" + name;
    const int fd = ::open(path.c_str(), O_RDWR | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    if (fd < 0) return fail("create");
    std::vector<uint8_t> zeros(64 * 1024, 0);
    size_t left = size;
    while (left > 0) {
        const size_t n = std::min(left, zeros.size());
        const ssize_t w = ::write(fd, zeros.data(), n);
        if (w < 0) {
            if (errno == EINTR) continue;
            const bool r = fail("write");
            ::close(fd);
            return r;
        }
        left -= static_cast<size_t>(w);
    }
    if (::fsync(fd) != 0) {
        const bool r = fail("fsync");
        ::close(fd);
        return r;
    }
    fds_[name] = fd;
    const int dfd = ::open(dir_.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dfd >= 0) {
        ::fsync(dfd);
        ::close(dfd);
    }
    return true;
}

bool PosixRetainIo::pread(const std::string& name, size_t offset, void* buf, size_t n) {
    const int fd = fdOf(name);
    if (fd < 0) return false;
    auto* p = static_cast<uint8_t*>(buf);
    while (n > 0) {
        const ssize_t r = ::pread(fd, p, n, static_cast<off_t>(offset));
        if (r < 0) {
            if (errno == EINTR) continue;
            return fail("pread");
        }
        if (r == 0) {
            error_ = "EOF";
            return false;
        }
        p += r;
        offset += static_cast<size_t>(r);
        n -= static_cast<size_t>(r);
    }
    return true;
}

bool PosixRetainIo::pwrite(const std::string& name, size_t offset, const void* buf, size_t n) {
    const int fd = fdOf(name);
    if (fd < 0) return false;
    const auto* p = static_cast<const uint8_t*>(buf);
    while (n > 0) {
        const ssize_t w = ::pwrite(fd, p, n, static_cast<off_t>(offset));
        if (w < 0) {
            if (errno == EINTR) continue;
            return fail("pwrite");
        }
        p += w;
        offset += static_cast<size_t>(w);
        n -= static_cast<size_t>(w);
    }
    return true;
}

bool PosixRetainIo::fdatasync(const std::string& name) {
    const int fd = fdOf(name);
    if (fd < 0) return false;
    if (::fdatasync(fd) != 0) return fail("fdatasync");
    return true;
}

bool PosixRetainIo::rename(const std::string& from, const std::string& to) {
    closeFd(from);
    closeFd(to);
    if (::rename((dir_ + "/" + from).c_str(), (dir_ + "/" + to).c_str()) != 0)
        return fail("rename");
    return true;
}

bool PosixRetainIo::remove(const std::string& name) {
    closeFd(name);
    if (::unlink((dir_ + "/" + name).c_str()) != 0) return fail("unlink");
    return true;
}

std::vector<std::string> PosixRetainIo::list() {
    std::vector<std::string> out;
    DIR* d = ::opendir(dir_.c_str());
    if (!d) return out;
    // readdir64: the 32-bit readdir fails with EOVERFLOW on 64-bit directory offsets (armhf under
    // qemu).
    while (const dirent64* e = ::readdir64(d)) {
        const std::string n = e->d_name;
        if (n != "." && n != "..") out.push_back(n);
    }
    ::closedir(d);
    return out;
}

// ---- RetainStore ----

RetainStore::RetainStore(RetainIo& io, int64_t windowMs, std::function<std::string()> stamp)
    : io_(io), windowMs_(windowMs), stamp_(std::move(stamp)) {
    if (!stamp_) stamp_ = [] { return std::to_string(static_cast<long long>(std::time(nullptr))); };
}

std::vector<uint8_t> RetainStore::encodeRecord(
    uint64_t seq, bool snapshot, const std::vector<std::pair<std::string, RetainValue>>& entries) {
    std::vector<uint8_t> b;
    put32(b, 0);  // length, patched below
    put64(b, seq);
    b.push_back(snapshot ? 1 : 0);
    const size_t countAt = b.size();
    put16(b, 0);
    uint16_t count = 0;
    for (const auto& [id, v] : entries) {
        if (id.size() > 255) continue;
        const size_t mark = b.size();
        b.push_back(static_cast<uint8_t>(id.size()));
        b.insert(b.end(), id.begin(), id.end());
        b.push_back(typeCode(v.type));
        if (!putValue(b, v.type, v.value)) {
            b.resize(mark);
            continue;
        }
        ++count;
    }
    b[countAt] = static_cast<uint8_t>(count);
    b[countAt + 1] = static_cast<uint8_t>(count >> 8);
    const uint32_t len = static_cast<uint32_t>(b.size() + 4);
    for (int i = 0; i < 4; ++i) b[static_cast<size_t>(i)] = static_cast<uint8_t>(len >> (8 * i));
    put32(b, crc32(b.data(), b.size()));
    return b;
}

RetainStore::Header RetainStore::readHeader(const std::string& name) {
    Header h;
    if (io_.size(name) != static_cast<int64_t>(kFileSize)) return h;
    uint8_t buf[kHeaderSize];
    if (!io_.pread(name, 0, buf, sizeof buf)) return h;
    if (std::memcmp(buf, kMagic, 8) != 0) return h;
    if (get16(buf + 8) != kVersion) return h;
    if (crc32(buf, 60) != get32(buf + 60)) return h;
    h.valid = true;
    h.generation = get64(buf + 12);
    h.snapshotLen = get32(buf + 20);
    return h;
}

bool RetainStore::replay(const std::string& name, std::map<std::string, RetainValue>& out,
                         size_t& writePos, uint64_t& lastSeq, size_t& maxRecord) {
    const Header h = readHeader(name);
    if (!h.valid) return false;
    std::vector<uint8_t> buf(kFileSize);
    if (!io_.pread(name, 0, buf.data(), buf.size())) return false;
    size_t pos = kHeaderSize;
    Decoded d;
    if (!decodeRecord(buf.data() + pos, buf.size() - pos, d) || !d.snapshot ||
        d.length != h.snapshotLen)
        return false;
    out.clear();
    for (auto& [id, v] : d.entries) out[id] = v;
    lastSeq = d.seq;
    maxRecord = d.length;
    pos += d.length;
    for (;;) {
        Decoded r;
        if (pos >= buf.size() || !decodeRecord(buf.data() + pos, buf.size() - pos, r)) break;
        if (r.snapshot || r.seq != lastSeq + 1)
            break;  // stale bytes of an older generation end here
        for (auto& [id, v] : r.entries) out[id] = v;
        lastSeq = r.seq;
        maxRecord = std::max(maxRecord, r.length);
        pos += r.length;
    }
    writePos = pos;
    return true;
}

bool RetainStore::writeSnapshotTo(const std::string& name, uint64_t generation) {
    std::vector<std::pair<std::string, RetainValue>> all(values_.begin(), values_.end());
    const std::vector<uint8_t> rec = encodeRecord(seq_ + 1, true, all);
    if (kHeaderSize + rec.size() + 2 * rec.size() > kFileSize) {
        diag_.lastError = "TOO_BIG";
        return false;
    }
    if (!io_.pwrite(name, kHeaderSize, rec.data(), rec.size()) || !io_.fdatasync(name)) {
        diag_.lastError = io_.lastError();
        return false;
    }
    diag_.bytesWritten += rec.size();
    std::vector<uint8_t> h;
    h.insert(h.end(), kMagic, kMagic + 8);
    put16(h, kVersion);
    put16(h, 0);
    put64(h, generation);
    put32(h, static_cast<uint32_t>(rec.size()));
    h.resize(60, 0);
    put32(h, crc32(h.data(), 60));
    if (!io_.pwrite(name, 0, h.data(), h.size()) || !io_.fdatasync(name)) {
        diag_.lastError = io_.lastError();
        return false;
    }
    diag_.bytesWritten += h.size();
    current_ = name;
    generation_ = generation;
    writePos_ = kHeaderSize + rec.size();
    ++seq_;
    maxRecord_ = rec.size();
    return true;
}

bool RetainStore::createFresh() {
    for (const char* name : {kFileA, kFileB})
        if (io_.size(name) != static_cast<int64_t>(kFileSize) &&
            !io_.createZeroed(name, kFileSize)) {
            diag_.lastError = io_.lastError();
            return false;
        }
    return writeSnapshotTo(kFileA, 1);
}

void RetainStore::quarantine() {
    const std::string stamp = stamp_();
    for (const char* name : {kFileA, kFileB})
        if (io_.exists(name)) io_.rename(name, std::string(name) + ".corrupt-" + stamp);
    // keep at most 3 sets
    std::set<std::string> stamps;
    const std::string marker = ".corrupt-";
    for (const auto& n : io_.list()) {
        const size_t at = n.find(marker);
        if (at != std::string::npos) stamps.insert(n.substr(at + marker.size()));
    }
    while (stamps.size() > 3) {
        const std::string oldest = *stamps.begin();
        stamps.erase(stamps.begin());
        for (const char* name : {kFileA, kFileB}) io_.remove(std::string(name) + marker + oldest);
    }
}

RetainStatus RetainStore::open() {
    opened_ = true;
    values_.clear();
    pending_.clear();
    seq_ = 0;
    struct Cand {
        const char* name;
        Header h;
    };
    std::vector<Cand> cands;
    bool anyContent = false;        // a file that holds something, valid or not
    bool anyCorruptHeader = false;  // non-zero header that does not check
    for (const char* name : {kFileA, kFileB}) {
        const int64_t sz = io_.size(name);
        if (sz < 0) continue;
        Header h = readHeader(name);
        if (h.valid) {
            cands.push_back({name, h});
            anyContent = true;
            continue;
        }
        // all-zero header: made in advance, never used
        uint8_t buf[kHeaderSize];
        bool zero = sz == static_cast<int64_t>(kFileSize) && io_.pread(name, 0, buf, sizeof buf);
        if (zero)
            for (uint8_t c : buf)
                if (c) zero = false;
        if (!zero) {
            anyContent = true;
            anyCorruptHeader = true;
        }
    }
    std::sort(cands.begin(), cands.end(),
              [](const Cand& a, const Cand& b) { return a.h.generation > b.h.generation; });
    bool first = true;
    for (const Cand& c : cands) {
        std::map<std::string, RetainValue> vals;
        size_t pos = 0, maxRec = 0;
        uint64_t last = 0;
        if (replay(c.name, vals, pos, last, maxRec)) {
            values_ = std::move(vals);
            current_ = c.name;
            generation_ = c.h.generation;
            writePos_ = pos;
            seq_ = last;
            maxRecord_ = maxRec;
            diag_.status = (first && !anyCorruptHeader) ? RetainStatus::Ok : RetainStatus::Fallback;
            return diag_.status;
        }
        first = false;
    }
    // nothing usable
    if (!anyContent) {
        diag_.status = RetainStatus::Fresh;
        createFresh();
        return diag_.status;
    }
    quarantine();
    diag_.status = RetainStatus::Lost;
    values_.clear();
    createFresh();
    return diag_.status;
}

void RetainStore::configure(const std::vector<std::pair<std::string, TagType>>& tags) {
    std::map<std::string, TagType> want(tags.begin(), tags.end());
    for (auto it = values_.begin(); it != values_.end();) {
        auto w = want.find(it->first);
        if (w == want.end() || w->second != it->second.type) {
            pending_.erase(it->first);
            it = values_.erase(it);
            compactNeeded_ = true;
        } else {
            ++it;
        }
    }
}

void RetainStore::set(const std::string& id, TagType type, const TagScalar& value) {
    RetainValue v;
    v.type = type;
    v.value = value;
    if (type == TagType::STRING && std::holds_alternative<std::string>(value) &&
        std::get<std::string>(value).size() > kMaxString)
        return;  // the validator keeps retained strings within 256 bytes
    values_[id] = v;
    pending_[id] = v;
}

bool RetainStore::save(int64_t monoMs, bool force) {
    (void)force;
    lastSaveMono_ = monoMs;
    if (!opened_ || current_.empty()) return false;
    const std::string other = current_ == kFileA ? kFileB : kFileA;
    auto compact = [&]() {
        if (!writeSnapshotTo(other, generation_ + 1)) return false;
        pending_.clear();
        compactNeeded_ = false;
        ++diag_.compactions;
        ++diag_.saves;
        diag_.lastError.clear();
        return true;
    };
    if (compactNeeded_) return compact();
    if (pending_.empty()) return false;
    std::vector<std::pair<std::string, RetainValue>> ch(pending_.begin(), pending_.end());
    const std::vector<uint8_t> rec = encodeRecord(seq_ + 1, false, ch);
    const size_t biggest = std::max(maxRecord_, rec.size());
    if (writePos_ + rec.size() + 2 * biggest > kFileSize) return compact();
    if (!io_.pwrite(current_, writePos_, rec.data(), rec.size()) || !io_.fdatasync(current_)) {
        diag_.lastError =
            io_.lastError();  // ENOSPC, EIO: the runtime keeps running, the changes wait
        return false;
    }
    diag_.bytesWritten += rec.size();
    writePos_ += rec.size();
    ++seq_;
    maxRecord_ = biggest;
    pending_.clear();
    ++diag_.saves;
    diag_.lastError.clear();
    return true;
}

bool RetainStore::flushIfDue(int64_t monoMs) {
    if (!hasPending()) return false;
    if (monoMs - lastSaveMono_ < windowMs_) return false;
    return save(monoMs, false);
}

bool RetainStore::flushNow(int64_t monoMs) {
    if (!hasPending()) return false;
    return save(monoMs, true);
}

RetainDiag RetainStore::diag() const {
    RetainDiag d = diag_;
    d.file = current_;
    d.generation = generation_;
    d.entries = values_.size();
    return d;
}

}  // namespace mat
