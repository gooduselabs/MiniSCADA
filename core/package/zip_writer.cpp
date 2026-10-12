#include "core/package/zip_writer.hpp"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <set>

#include "core/crypto/hex.hpp"
#include "core/crypto/sha256.hpp"
#include "core/package/digest.hpp"
#include "core/project-manager/project_validator.hpp"
#include "miniz.h"
#include "nlohmann/json.hpp"

namespace mat {

namespace {

constexpr uint32_t kSigLocal = 0x04034b50;
constexpr uint32_t kSigCentral = 0x02014b50;
constexpr uint32_t kSigEocd = 0x06054b50;
constexpr uint16_t kVersion = 20;  // needed to extract, and made by (MS-DOS, 2.0)
constexpr uint16_t kFlagUtf8 = 0x0800;
constexpr uint16_t kDosTime = 0x0000;
constexpr uint16_t kDosDate = 0x0021;  // 1980-01-01

uint32_t crcOf(std::string_view b) {
    return static_cast<uint32_t>(
        mz_crc32(MZ_CRC32_INIT, reinterpret_cast<const unsigned char*>(b.data()), b.size()));
}

void put(std::string& out, uint32_t v, int bytes) {
    for (int i = 0; i < bytes; ++i) out += static_cast<char>((v >> (8 * i)) & 0xff);
}

struct Item {
    std::string path;
    uint32_t size = 0;
    uint32_t crc = 0;
    std::string sha256;
    uint32_t offset = 0;
};

std::string localHeader(const Item& it) {
    std::string h;
    put(h, kSigLocal, 4);
    put(h, kVersion, 2);
    put(h, kFlagUtf8, 2);
    put(h, 0, 2);  // stored
    put(h, kDosTime, 2);
    put(h, kDosDate, 2);
    put(h, it.crc, 4);
    put(h, it.size, 4);
    put(h, it.size, 4);
    put(h, static_cast<uint32_t>(it.path.size()), 2);
    put(h, 0, 2);  // no extra field
    return h + it.path;
}

std::string centralHeader(const Item& it) {
    std::string h;
    put(h, kSigCentral, 4);
    put(h, kVersion, 2);  // made by: MS-DOS (0), 2.0
    put(h, kVersion, 2);
    put(h, kFlagUtf8, 2);
    put(h, 0, 2);
    put(h, kDosTime, 2);
    put(h, kDosDate, 2);
    put(h, it.crc, 4);
    put(h, it.size, 4);
    put(h, it.size, 4);
    put(h, static_cast<uint32_t>(it.path.size()), 2);
    put(h, 0, 2);  // extra
    put(h, 0, 2);  // comment
    put(h, 0, 2);  // disk number start
    put(h, 0, 2);  // internal attributes
    put(h, 0, 4);  // external attributes
    put(h, it.offset, 4);
    return h + it.path;
}

PackageWriteResult failure(PackageError e) {
    PackageWriteResult r;
    r.error = std::move(e);
    return r;
}

}  // namespace

bool StringSink::write(const void* data, size_t n) {
    bytes.append(static_cast<const char*>(data), n);
    return true;
}

bool FdSink::write(const void* data, size_t n) {
    const char* p = static_cast<const char*>(data);
    while (n > 0) {
        const ssize_t w = ::write(fd_, p, n);
        if (w < 0 && errno == EINTR) continue;
        if (w <= 0) {
            errno_ = w < 0 ? errno : EIO;
            return false;
        }
        p += w;
        n -= static_cast<size_t>(w);
    }
    return true;
}

PackageInput memoryInput(std::string path, std::string bytes) {
    auto shared = std::make_shared<const std::string>(std::move(bytes));
    return {std::move(path), [shared](std::string& out, std::string&) {
                out = *shared;
                return true;
            }};
}

PackageInput fileInput(std::string path, std::string file) {
    return {std::move(path), [file](std::string& out, std::string& error) {
                const int fd = ::open(file.c_str(), O_RDONLY | O_CLOEXEC);
                if (fd < 0) {
                    error = file + ": " + std::strerror(errno);
                    return false;
                }
                struct stat st {};
                if (::fstat(fd, &st) != 0 || !S_ISREG(st.st_mode)) {
                    error = file + ": không phải file thường";
                    ::close(fd);
                    return false;
                }
                // At most one byte past the largest file a package takes: enough for the size
                // rule to refuse it, never the whole of a big file.
                const size_t cap = kPackageMaxSvgBytes + 1;
                out.resize(cap);
                size_t got = 0;
                while (got < cap) {
                    const ssize_t n = ::read(fd, &out[got], cap - got);
                    if (n < 0 && errno == EINTR) continue;
                    if (n < 0) {
                        error = file + ": " + std::strerror(errno);
                        ::close(fd);
                        return false;
                    }
                    if (n == 0) break;
                    got += static_cast<size_t>(n);
                }
                ::close(fd);
                out.resize(got);
                return true;
            }};
}

PackageWriteResult writeStoredPackage(std::vector<PackageInput> files,
                                      const PackageWriteOptions& options, PackageSink& out) {
    std::sort(files.begin(), files.end(), [](const PackageInput& a, const PackageInput& b) {
        return compareUtf8(a.path, b.path) < 0;
    });
    if (files.empty() || files.size() > kPackageMaxEntries - 1)
        return failure({"E_PKG_ENTRIES", "", "Gói phải có 1–1023 file project"});

    // Pass 1: rules, sizes, checksums, identity; one file in memory at a time.
    std::vector<Item> items;
    std::set<std::string> keys{packagePathKey(kPackageManifestName)};
    std::optional<ProjectIdentity> identity;
    uint64_t total = 0;
    std::string bytes, error;
    for (const auto& f : files) {
        if (f.path == kPackageManifestName)
            return failure({"E_PKG_PATH", f.path, "Chỉ manifest được tên matscada.json"});
        if (auto e = packagePathError(f.path)) return failure(std::move(*e));
        if (!keys.insert(packagePathKey(f.path)).second)
            return failure(
                {"E_PKG_PATH", f.path, "Trùng tên với file khác khi không phân biệt hoa thường"});
        if (auto e = packageTypeError(f.path)) return failure(std::move(*e));
        if (!f.read(bytes, error)) return failure({"STORE_IO", f.path, error});
        if (auto e = packageEntryLimitError(f.path, bytes.size(), bytes.size(), false))
            return failure(std::move(*e));
        if (auto s = findPackageSecret(f.path, bytes))
            return failure({"E_PKG_SECRET", f.path, "File chứa thứ giống bí mật: " + *s});
        if (f.path == "project.json") identity = readProjectIdentity(bytes);
        items.push_back(
            {f.path, static_cast<uint32_t>(bytes.size()), crcOf(bytes), toHex(sha256(bytes)), 0});
        total += bytes.size();
    }
    if (!identity || !identity->projectId || !identity->projectName || !identity->projectVersion ||
        !identity->minRuntimeVersion)
        return failure({"E_PKG_IDENTITY", "project.json",
                        "project.json phải có projectId, projectName, projectVersion, "
                        "minRuntimeVersion dạng chuỗi"});

    // Manifest (contract §3): keys in this order, two-space indent, final newline.
    std::vector<PackageFile> listed;
    nlohmann::ordered_json fileList = nlohmann::ordered_json::array();
    for (const auto& it : items) {
        listed.push_back({it.path, it.size, it.sha256});
        fileList.push_back({{"path", it.path}, {"size", it.size}, {"sha256", it.sha256}});
    }
    const std::string digest = packageDigest(listed);
    const nlohmann::ordered_json manifest = {
        {"format", "matscada-package"},
        {"formatVersion", "1.0.0"},
        {"project",
         {{"projectId", *identity->projectId},
          {"projectName", *identity->projectName},
          {"projectVersion", *identity->projectVersion},
          {"minRuntimeVersion", *identity->minRuntimeVersion}}},
        {"createdAt", options.createdAt},
        {"generator",
         {{"name", options.generatorName},
          {"version", options.generatorVersion.empty() ? std::string(kRuntimeVersion)
                                                       : options.generatorVersion}}},
        {"files", fileList},
        {"digest", digest}};
    // createdAt and generator come from the caller: bytes that are not UTF-8 become U+FFFD.
    const std::string manifestText =
        manifest.dump(2, ' ', false, nlohmann::ordered_json::error_handler_t::replace) + "\n";
    if (manifestText.size() > kPackageMaxManifestBytes)
        return failure({"E_PKG_MANIFEST", "", "Manifest lớn hơn 256 KiB"});
    if (auto s = findPackageSecret(kPackageManifestName, manifestText))
        return failure(
            {"E_PKG_SECRET", kPackageManifestName, "Manifest chứa thứ giống bí mật: " + *s});
    total += manifestText.size();
    if (total > kPackageMaxTotalBytes)
        return failure({"E_PKG_SIZE", "", "Tổng các file lớn hơn 200 MiB"});

    Item head{kPackageManifestName, static_cast<uint32_t>(manifestText.size()), crcOf(manifestText),
              "", 0};
    uint64_t size = 30 + head.path.size() + head.size + 46 + head.path.size() + 22;
    for (const auto& it : items) size += 30 + it.path.size() + it.size + 46 + it.path.size();
    if (size > kPackageMaxBytes)
        return failure({"E_PKG_TOO_LARGE", "", "Gói sẽ lớn hơn 50 MiB (52.428.800 byte)"});

    // Pass 2: write. Every file is read again and must not have changed.
    auto sinkError = [](const std::string& path) {
        return failure({"STORE_IO", path, "Không ghi được gói"});
    };
    uint64_t offset = 0;
    auto emit = [&](const std::string& header, std::string_view data) {
        if (!out.write(header.data(), header.size()) || !out.write(data.data(), data.size()))
            return false;
        offset += header.size() + data.size();
        return true;
    };
    head.offset = 0;
    if (!emit(localHeader(head), manifestText)) return sinkError(kPackageManifestName);
    for (size_t i = 0; i < items.size(); ++i) {
        Item& it = items[i];
        if (!files[i].read(bytes, error)) return failure({"STORE_IO", it.path, error});
        if (bytes.size() != it.size || crcOf(bytes) != it.crc)
            return failure({"STORE_IO", it.path, "File đổi trong lúc đóng gói"});
        it.offset = static_cast<uint32_t>(offset);
        if (!emit(localHeader(it), bytes)) return sinkError(it.path);
    }
    const uint64_t cdOffset = offset;
    std::string cd = centralHeader(head);
    for (const auto& it : items) cd += centralHeader(it);
    std::string eocd;
    put(eocd, kSigEocd, 4);
    put(eocd, 0, 2);
    put(eocd, 0, 2);
    put(eocd, static_cast<uint32_t>(items.size() + 1), 2);
    put(eocd, static_cast<uint32_t>(items.size() + 1), 2);
    put(eocd, static_cast<uint32_t>(cd.size()), 4);
    put(eocd, static_cast<uint32_t>(cdOffset), 4);
    put(eocd, 0, 2);  // no comment
    if (!emit(cd, eocd)) return sinkError("");

    PackageWriteResult r;
    r.ok = true;
    r.digest = digest;
    r.bytes = offset;
    return r;
}

}  // namespace mat
