#include "core/package/package_check.hpp"

#include <unordered_map>

#include "core/crypto/hex.hpp"
#include "core/crypto/sha256.hpp"
#include "miniz.h"

namespace mat {

namespace {

constexpr const char* kProjectJson = "project.json";

// What stage 5 learns about an entry for the later stages.
struct EntryFacts {
    uint32_t crc32 = 0;
    std::string sha256;
    std::optional<std::string> secret;
};

EntryFacts factsOf(const std::string& path, std::string_view bytes) {
    EntryFacts f;
    f.crc32 = static_cast<uint32_t>(mz_crc32(
        MZ_CRC32_INIT, reinterpret_cast<const unsigned char*>(bytes.data()), bytes.size()));
    f.sha256 = toHex(sha256(bytes));
    f.secret = findPackageSecret(path, bytes);
    return f;
}

PackageCheck failed(PackageCheck& r, PackageError e) {
    r.ok = false;
    r.error = std::move(e);
    r.manifest = PackageManifest{};
    r.unpackedBytes = 0;
    return std::move(r);
}

bool sameIdentity(const PackageManifest& m, const ProjectIdentity& id) {
    return id.projectId == m.projectId && id.projectName == m.projectName &&
           id.projectVersion == m.projectVersion && id.minRuntimeVersion == m.minRuntimeVersion;
}

}  // namespace

PackageCheck checkPackage(PackageSource& src, const PackageSchema& schema,
                          const PackageCheckOptions& options, PackageEntrySink* sink) {
    PackageCheck r;
    r.packageBytes = src.size();

    // 1–3. Size, end of central directory, entries.
    std::vector<ZipEntry> entries;
    if (auto e = readZipDirectory(src, entries)) return failed(r, std::move(*e));

    // 4. Manifest.
    const ZipEntry& first = entries[0];
    if (first.name != kPackageManifestName)
        return failed(r, {"E_PKG_MANIFEST", "", "Entry đầu không phải manifest matscada.json"});
    if (first.method != 0)
        return failed(r, {"E_PKG_MANIFEST", "", "Manifest phải ở dạng stored (không nén)"});
    if (first.size > kPackageMaxManifestBytes)
        return failed(r, {"E_PKG_MANIFEST", "", "Manifest lớn hơn 256 KiB"});
    std::string text;
    if (auto e = readZipEntry(src, first, text)) return failed(r, std::move(*e));
    std::vector<EntryFacts> facts(entries.size());
    facts[0] = factsOf(first.name, text);
    PackageManifest manifest;
    if (auto e = parseManifest(std::move(text), schema, manifest)) return failed(r, std::move(*e));

    // 5a. Declared sizes and ratio of every entry, before any decompression.
    uint64_t total = 0;
    for (size_t i = 0; i < entries.size(); ++i) {
        const ZipEntry& e = entries[i];
        if (auto err = packageEntryLimitError(e.name, e.size, e.compressedSize, i == 0))
            return failed(r, std::move(*err));
        total += e.size;
        if (total > kPackageMaxTotalBytes)
            return failed(r, {"E_PKG_SIZE", e.name, "Tổng sau giải nén lớn hơn 200 MiB"});
    }

    // 5b. Every project file, one at a time, counting real bytes.
    std::optional<ProjectIdentity> identity;
    std::string bytes;
    for (size_t i = 1; i < entries.size(); ++i) {
        const ZipEntry& e = entries[i];
        if (auto err = readZipEntry(src, e, bytes)) return failed(r, std::move(*err));
        facts[i] = factsOf(e.name, bytes);
        if (e.name == kProjectJson) identity = readProjectIdentity(bytes);
        if (sink) {
            PackageError err;
            if (!sink->onFile(e.name, bytes, err)) return failed(r, std::move(err));
        }
    }

    // 6. Checksums: CRC-32 of every entry, then size and SHA-256 against files[].
    std::unordered_map<std::string, const PackageFile*> listed;
    for (const auto& f : manifest.files) listed[f.path] = &f;
    for (size_t i = 0; i < entries.size(); ++i) {
        const ZipEntry& e = entries[i];
        if (facts[i].crc32 != e.crc32)
            return failed(r, {"E_PKG_CHECKSUM", e.name, "CRC-32 không khớp"});
        if (i == 0) continue;
        const auto it = listed.find(e.name);
        if (it == listed.end()) continue;  // stage 7
        if (it->second->size != static_cast<int64_t>(e.size))
            return failed(r, {"E_PKG_CHECKSUM", e.name, "Kích thước khác manifest"});
        if (it->second->sha256 != facts[i].sha256)
            return failed(r, {"E_PKG_CHECKSUM", e.name, "SHA-256 khác manifest"});
    }

    // 7. File set.
    std::unordered_map<std::string, size_t> present;
    for (size_t i = 1; i < entries.size(); ++i) {
        if (!listed.count(entries[i].name))
            return failed(r, {"E_PKG_UNLISTED", entries[i].name, "File không có trong manifest"});
        present[entries[i].name] = i;
    }
    for (const auto& f : manifest.files)
        if (!present.count(f.path))
            return failed(r, {"E_PKG_MISSING", f.path, "Manifest liệt kê file không có trong gói"});

    // 8. Digest, identity, formatVersion.
    std::string digest;
    try {
        digest = packageDigest(manifest.files);
    } catch (const std::exception& e) {  // paths passed §5: not expected
        return failed(r, {"E_PKG_MANIFEST", "", std::string("files của manifest: ") + e.what()});
    }
    if (digest != manifest.digest)
        return failed(r, {"E_PKG_DIGEST", "", "Digest của manifest khác giá trị tính lại"});
    if (!options.expectedDigest.empty() && options.expectedDigest != manifest.digest)
        return failed(r, {"E_PKG_DIGEST", "", "Digest của gói khác digest mong đợi"});
    if (!identity || !sameIdentity(manifest, *identity))
        return failed(r, {"E_PKG_IDENTITY", "",
                          "Mã, tên, phiên bản hoặc runtime tối thiểu của manifest khác "
                          "project.json"});
    if (!packageFormatMajorIsSupported(manifest.formatVersion))
        return failed(r, {"E_PKG_FORMAT_VERSION", "",
                          "Định dạng gói " + manifest.formatVersion + " không hỗ trợ (cần 1.x)"});

    // 9. Secrets: the manifest, then every entry.
    for (size_t i = 0; i < entries.size(); ++i)
        if (facts[i].secret)
            return failed(r, {"E_PKG_SECRET", entries[i].name,
                              "Gói chứa thứ giống bí mật: " + *facts[i].secret});

    r.ok = true;
    r.unpackedBytes = total;
    r.manifest = std::move(manifest);
    return r;
}

}  // namespace mat
