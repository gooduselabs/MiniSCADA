// The manifest matscada.json of a .matscada package (specs/005-device-online/contracts/
// matscada-package.md §3, §8a): JSON Schema check with valijson against
// schemas/package-manifest.schema.json, then the rules outside the schema.
#pragma once
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "core/package/digest.hpp"
#include "core/package/package_rules.hpp"

namespace mat {

// A manifest that passed parseManifest().
struct PackageManifest {
    std::string text;  // the bytes of matscada.json as in the package
    std::string formatVersion;
    std::string projectId;
    std::string projectName;
    std::string projectVersion;
    std::string minRuntimeVersion;
    std::string createdAt;
    std::string generatorName;
    std::string generatorVersion;
    std::vector<PackageFile> files;  // sorted by path bytes, no duplicates
    std::string digest;              // "sha256:" + 64 lowercase hex
};

constexpr const char* kPackageManifestSchemaFile = "package-manifest.schema.json";

// schemas/package-manifest.schema.json, parsed once; valijson stays behind this class. Read-only
// after load: one schema serves every thread.
class PackageSchema {
   public:
    // nullptr and `error` set when the file cannot be read or is not a usable draft-07 schema.
    static std::unique_ptr<PackageSchema> load(const std::string& schemaFile, std::string& error);
    // load(schemasDir + "/package-manifest.schema.json")
    static std::unique_ptr<PackageSchema> loadFromDir(const std::string& schemasDir,
                                                      std::string& error);
    ~PackageSchema();
    PackageSchema(const PackageSchema&) = delete;
    PackageSchema& operator=(const PackageSchema&) = delete;

    struct Impl;
    const Impl& impl() const { return *impl_; }

   private:
    explicit PackageSchema(std::unique_ptr<Impl> impl);
    std::unique_ptr<Impl> impl_;
};

// Stage 4 of the check order (§8a) on the bytes of the first entry, first error wins:
// UTF-8 without BOM, JSON, nesting ≤ 64, the schema (E_PKG_MANIFEST); files[] sorted by UTF-8
// bytes without duplicates (E_PKG_MANIFEST); no matscada.json in files[] (E_PKG_MANIFEST); then
// every files[].path in order: rules 1–5 and 7 of §5 (E_PKG_PATH), rule 6 (E_PKG_TYPE), with
// that path. formatVersion only has to be SemVer here: its MAJOR is checked at stage 8
// (packageFormatMajorIsSupported). The entry's name, method and size are the caller's.
std::optional<PackageError> parseManifest(std::string text, const PackageSchema& schema,
                                          PackageManifest& out);

// MAJOR of a SemVer formatVersion is 1 (contract §3); MINOR and PATCH may be anything.
bool packageFormatMajorIsSupported(const std::string& formatVersion);

}  // namespace mat
