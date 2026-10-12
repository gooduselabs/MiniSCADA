#include "core/package/zip_reader.hpp"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <set>

#include "core/common/utf8.hpp"
#include "miniz.h"

namespace mat {

namespace {

constexpr uint32_t kSigLocal = 0x04034b50;
constexpr uint32_t kSigCentral = 0x02014b50;
constexpr uint32_t kSigEocd = 0x06054b50;
constexpr size_t kLocalHeaderBytes = 30;
constexpr size_t kCentralHeaderBytes = 46;
constexpr size_t kEocdBytes = 22;
constexpr uint16_t kFlagUtf8 = 0x0800;
constexpr uint16_t kFlagsDeflateOptions = 0x0006;
constexpr uint16_t kMaxVersionNeeded = 20;
constexpr uint8_t kHostMsDos = 0;
constexpr uint8_t kHostUnix = 3;
constexpr uint32_t kUnixTypeMask = 0170000;
constexpr uint32_t kUnixRegular = 0100000;
constexpr uint32_t kUnixDirectory = 0040000;
constexpr uint32_t kUnixSymlink = 0120000;
constexpr uint32_t kDosDirectory = 0x10;
constexpr size_t kInputChunk = 64 * 1024;

uint16_t le16(const uint8_t* p) { return static_cast<uint16_t>(p[0] | p[1] << 8); }
uint32_t le32(const uint8_t* p) {
    return static_cast<uint32_t>(p[0]) | static_cast<uint32_t>(p[1]) << 8 |
           static_cast<uint32_t>(p[2]) << 16 | static_cast<uint32_t>(p[3]) << 24;
}

PackageError format(const std::string& path, const char* message) {
    return {"E_PKG_FORMAT", path, message};
}
PackageError layout(const char* message) { return {"E_PKG_FORMAT", "", message}; }
PackageError io(const std::string& path) {
    return {"STORE_IO", path, "Không đọc được gói (lỗi vào/ra)"};
}

// Rules of one central directory record that do not need the local header (stage 3).
std::optional<PackageError> recordError(const uint8_t* h, const std::string& name) {
    const uint16_t madeBy = le16(h + 4), needed = le16(h + 6), flags = le16(h + 8),
                   method = le16(h + 10);
    if (needed > kMaxVersionNeeded)
        return format(name, "Version needed lớn hơn 2.0 (ZIP64 hoặc tính năng không hỗ trợ)");
    if (method != 0 && method != 8)
        return format(name, "Phương thức nén không hỗ trợ (chỉ stored và deflate)");
    const uint16_t allowed = kFlagUtf8 | (method == 8 ? kFlagsDeflateOptions : 0);
    if (flags & ~allowed) return format(name, "Cờ không hỗ trợ (mã hóa, data descriptor, patch…)");
    if (le16(h + 30) != 0) return format(name, "Entry có extra field");
    if (le16(h + 32) != 0) return format(name, "Entry có comment");
    if (le16(h + 34) != 0) return format(name, "Entry nằm trên đĩa khác");
    const uint8_t host = static_cast<uint8_t>(madeBy >> 8);
    const uint32_t attrs = le32(h + 38);
    if (host != kHostMsDos && host != kHostUnix)
        return format(name, "Hệ tạo gói không hỗ trợ (chỉ MS-DOS và Unix)");
    if (host == kHostUnix) {
        const uint32_t type = (attrs >> 16) & kUnixTypeMask;
        if (type == kUnixSymlink) return PackageError{"E_PKG_PATH", name, "Entry là symlink"};
        if (type == kUnixDirectory) return PackageError{"E_PKG_PATH", name, "Entry là thư mục"};
        if (type != 0 && type != kUnixRegular)
            return format(name, "Entry không phải file thường (FIFO, thiết bị, socket…)");
    }
    if (attrs & kDosDirectory) return PackageError{"E_PKG_PATH", name, "Entry là thư mục"};
    return std::nullopt;
}

}  // namespace

bool MemorySource::readAt(uint64_t offset, void* out, size_t n) {
    if (offset > bytes_.size() || n > bytes_.size() - offset) return false;
    if (n > 0) std::memcpy(out, bytes_.data() + offset, n);
    return true;
}

std::unique_ptr<FileSource> FileSource::open(const std::string& path, std::string& error) {
    const int fd = ::open64(path.c_str(), O_RDONLY | O_CLOEXEC);
    if (fd < 0) {
        error = std::strerror(errno);
        return nullptr;
    }
    struct stat64 st {};
    if (::fstat64(fd, &st) != 0) {
        error = std::strerror(errno);
        ::close(fd);
        return nullptr;
    }
    if (!S_ISREG(st.st_mode)) {
        error = "không phải file thường";
        ::close(fd);
        return nullptr;
    }
    return std::unique_ptr<FileSource>(new FileSource(fd, static_cast<uint64_t>(st.st_size)));
}

FileSource::~FileSource() { ::close(fd_); }

bool FileSource::readAt(uint64_t offset, void* out, size_t n) {
    if (offset > size_ || n > size_ - offset) return false;
    auto* p = static_cast<uint8_t*>(out);
    while (n > 0) {
        const ssize_t got = ::pread64(fd_, p, n, static_cast<off64_t>(offset));
        if (got < 0 && errno == EINTR) continue;
        if (got <= 0) return false;  // error, or the file shrank
        p += got;
        offset += static_cast<uint64_t>(got);
        n -= static_cast<size_t>(got);
    }
    return true;
}

std::optional<PackageError> readZipDirectory(PackageSource& src, std::vector<ZipEntry>& entries) {
    entries.clear();
    // 1. Size, before anything is read.
    const uint64_t size = src.size();
    if (size > kPackageMaxBytes)
        return PackageError{"E_PKG_TOO_LARGE", "", "Gói lớn hơn 50 MiB (52.428.800 byte)"};
    // 2. End of central directory.
    if (size < kEocdBytes) return layout("Không phải gói ZIP: ngắn hơn bản ghi kết thúc");
    uint8_t e[kEocdBytes];
    const uint64_t eocdPos = size - kEocdBytes;
    if (!src.readAt(eocdPos, e, kEocdBytes)) return io("");
    if (le32(e) != kSigEocd)
        return layout(
            "Bản ghi kết thúc (EOCD) không nằm đúng 22 byte cuối: dữ liệu thừa sau gói "
            "hoặc comment");
    if (le16(e + 20) != 0) return layout("Gói có comment");
    const uint16_t total = le16(e + 10);
    if (le16(e + 4) != 0 || le16(e + 6) != 0 || le16(e + 8) != total)
        return layout("Gói chia nhiều đĩa");
    if (total == 0 || total > kPackageMaxEntries)
        return PackageError{"E_PKG_ENTRIES", "", "Gói phải có 1–1024 entry (gồm manifest)"};
    const uint64_t cdSize = le32(e + 12), cdOffset = le32(e + 16);
    if (cdOffset + cdSize != eocdPos)
        return layout("Central directory không nằm liền trước bản ghi kết thúc (ZIP64?)");

    // 3. Every entry, in central directory order.
    entries.reserve(total);
    std::set<std::string> keys;
    uint64_t p = cdOffset;
    uint64_t expected = 0;  // where the next local header must start
    for (uint32_t i = 0; i < total; ++i) {
        uint8_t h[kCentralHeaderBytes];
        if (p + kCentralHeaderBytes > eocdPos) return layout("Central directory bị cắt");
        if (!src.readAt(p, h, kCentralHeaderBytes)) return io("");
        if (le32(h) != kSigCentral) return layout("Central directory hỏng");
        const uint16_t nameLen = le16(h + 28);
        const uint64_t next = p + kCentralHeaderBytes + nameLen + le16(h + 30) + le16(h + 32);
        if (next > eocdPos) return layout("Central directory bị cắt");

        // Name: 1–128 bytes of UTF-8. A longer one is read up to 129 bytes, enough to show it.
        std::string name(std::min<size_t>(nameLen, kPackageMaxPathBytes + 1), '\0');
        if (!src.readAt(p + kCentralHeaderBytes, &name[0], name.size())) return io("");
        if (nameLen == 0) return PackageError{"E_PKG_PATH", "", "Entry không có tên"};
        if (nameLen > kPackageMaxPathBytes)
            return PackageError{"E_PKG_PATH", packageDisplayName(name),
                                "Tên entry dài hơn 128 byte"};
        if (!isValidUtf8(name))
            return PackageError{"E_PKG_PATH", packageDisplayName(name),
                                "Tên entry không phải UTF-8 hợp lệ"};

        if (auto err = recordError(h, name)) return err;

        // Path rules 1–5, 8, 7, then 6 (§8a).
        if (auto err = packagePathError(name)) return err;
        if (i > 0 && name == kPackageManifestName)
            return PackageError{"E_PKG_PATH", name,
                                "Chỉ manifest (entry đầu) được tên matscada.json"};
        if (!keys.insert(packagePathKey(name)).second)
            return PackageError{"E_PKG_PATH", name,
                                "Trùng tên với entry khác khi không phân biệt hoa thường"};
        if (auto err = packageTypeError(name)) return err;

        // Layout: entries follow each other from offset 0, without gaps or overlaps.
        const uint64_t offset = le32(h + 42);
        if (offset != expected)
            return layout(
                "Entry không liền nhau (khoảng trống, chồng lấn hoặc dữ liệu thừa ở đầu)");
        if (offset + kLocalHeaderBytes + nameLen > cdOffset)
            return layout("Header cục bộ chồng lên central directory");
        uint8_t l[kLocalHeaderBytes];
        if (!src.readAt(offset, l, kLocalHeaderBytes)) return io(name);
        if (le32(l) != kSigLocal) return format(name, "Header cục bộ hỏng");
        if (le16(l + 4) != le16(h + 6) || le16(l + 6) != le16(h + 8) ||
            le16(l + 8) != le16(h + 10) || le32(l + 14) != le32(h + 16) ||
            le32(l + 18) != le32(h + 20) || le32(l + 22) != le32(h + 24) ||
            le16(l + 26) != nameLen || le16(l + 28) != 0)
            return format(name, "Header cục bộ khác central directory");
        std::string localName(nameLen, '\0');
        if (!src.readAt(offset + kLocalHeaderBytes, &localName[0], nameLen)) return io(name);
        if (localName != name) return format(name, "Tên ở header cục bộ khác central directory");

        ZipEntry entry;
        entry.name = std::move(name);
        entry.method = le16(h + 10);
        entry.crc32 = le32(h + 16);
        entry.compressedSize = le32(h + 20);
        entry.size = le32(h + 24);
        entry.dataOffset = offset + kLocalHeaderBytes + nameLen;
        if (entry.dataOffset + entry.compressedSize > cdOffset)
            return layout("Dữ liệu entry chồng lên central directory");
        if (entry.method == 0 && entry.compressedSize != entry.size)
            return format(entry.name, "Entry stored có kích thước nén khác kích thước gốc");
        expected = entry.dataOffset + entry.compressedSize;
        entries.push_back(std::move(entry));
        p = next;
    }
    if (p != eocdPos) return layout("Central directory có dữ liệu thừa");
    if (expected != cdOffset) return layout("Dữ liệu thừa giữa entry cuối và central directory");
    return std::nullopt;
}

std::optional<PackageError> readZipEntry(PackageSource& src, const ZipEntry& entry,
                                         std::string& out) {
    out.resize(entry.size);
    if (entry.method == 0) {
        if (!src.readAt(entry.dataOffset, &out[0], entry.size)) return io(entry.name);
        return std::nullopt;
    }
    // Raw deflate into exactly entry.size bytes: tinfl stops with HAS_MORE_OUTPUT as soon as the
    // data would pass the declared size. The compressed data is read 64 KiB at a time.
    auto inflater = std::make_unique<tinfl_decompressor>();
    tinfl_init(inflater.get());
    std::vector<uint8_t> in(
        std::min<size_t>(kInputChunk, std::max<uint32_t>(entry.compressedSize, 1)));
    uint8_t* const outStart = reinterpret_cast<uint8_t*>(&out[0]);
    uint64_t inOffset = entry.dataOffset;
    uint64_t inLeft = entry.compressedSize;  // not read from the source yet
    size_t inPos = 0, inAvail = 0, outPos = 0;
    for (;;) {
        if (inAvail == 0 && inLeft > 0) {
            const size_t n = static_cast<size_t>(std::min<uint64_t>(in.size(), inLeft));
            if (!src.readAt(inOffset, in.data(), n)) return io(entry.name);
            inOffset += n;
            inLeft -= n;
            inPos = 0;
            inAvail = n;
        }
        size_t inBytes = inAvail;
        size_t outBytes = entry.size - outPos;
        const mz_uint32 flags =
            TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF | (inLeft > 0 ? TINFL_FLAG_HAS_MORE_INPUT : 0);
        const tinfl_status status = tinfl_decompress(inflater.get(), in.data() + inPos, &inBytes,
                                                     outStart, outStart + outPos, &outBytes, flags);
        inPos += inBytes;
        inAvail -= inBytes;
        outPos += outBytes;
        if (status == TINFL_STATUS_DONE) {
            if (inAvail > 0 || inLeft > 0)
                return format(entry.name, "Dòng deflate kết thúc trước khi hết dữ liệu nén");
            if (outPos != entry.size)
                return format(entry.name, "Dữ liệu giải nén ngắn hơn kích thước khai báo");
            return std::nullopt;
        }
        if (status == TINFL_STATUS_HAS_MORE_OUTPUT)
            return format(entry.name, "Dữ liệu giải nén dài hơn kích thước khai báo");
        if (status != TINFL_STATUS_NEEDS_MORE_INPUT ||
            (inAvail > 0 && inBytes == 0 && outBytes == 0) || (inAvail == 0 && inLeft == 0))
            return format(entry.name, "Dữ liệu deflate hỏng");
    }
}

}  // namespace mat
