#include "core/package/manifest.hpp"

#include <cstdint>
#include <fstream>
#include <set>
#include <sstream>

#include "core/common/json_limits.hpp"
#include "core/common/utf8.hpp"
#include "nlohmann/json.hpp"
#include "valijson/adapters/nlohmann_json_adapter.hpp"
#include "valijson/schema.hpp"
#include "valijson/schema_parser.hpp"
#include "valijson/validation_results.hpp"
#include "valijson/validator.hpp"

namespace mat {

using nlohmann::json;

struct PackageSchema::Impl {
    valijson::Schema schema;
};

namespace {

constexpr int kMaxManifestDepth = 64;

PackageError manifestError(const std::string& message) { return {"E_PKG_MANIFEST", "", message}; }

// What valijson sees: integers above INT64_MAX become INT64_MAX (valijson reads integers as
// int64 and would see a negative number). Such a size passes the schema and then differs from the
// real size (E_PKG_CHECKSUM), as in the Studio's reader. Floats stay floats: "size": 1.0 is not
// an integer for the schema (nor for serde).
json schemaView(const json& v) {
    switch (v.type()) {
        case json::value_t::number_unsigned:
            return v.get<uint64_t>() > static_cast<uint64_t>(INT64_MAX) ? json(INT64_MAX) : v;
        case json::value_t::array: {
            json out = json::array();
            for (const auto& x : v) out.push_back(schemaView(x));
            return out;
        }
        case json::value_t::object: {
            json out = json::object();
            for (auto it = v.begin(); it != v.end(); ++it) out[it.key()] = schemaView(it.value());
            return out;
        }
        default:
            return v;
    }
}

std::string contextToPointer(const std::vector<std::string>& ctx) {
    std::string p;
    for (const auto& c : ctx) {
        if (c == "<root>") continue;
        std::string s = c;
        if (s.size() >= 2 && s.front() == '[' && s.back() == ']') s = s.substr(1, s.size() - 2);
        if (s.size() >= 2 && s.front() == '"' && s.back() == '"') s = s.substr(1, s.size() - 2);
        p += "/" + s;
    }
    return p;
}

// libstdc++ std::regex recurses per character: a string that meets a "pattern" of the schema is
// refused on its length before valijson runs (security review M3 of the project validator).
std::optional<std::string> tooLongForPattern(const json& doc) {
    auto longString = [](const json& v, size_t max) {
        return v.is_string() && v.get_ref<const std::string&>().size() > max;
    };
    if (doc.contains("formatVersion") && longString(doc["formatVersion"], 64))
        return "/formatVersion";
    if (doc.contains("digest") && longString(doc["digest"], 71)) return "/digest";
    if (doc.contains("files") && doc["files"].is_array()) {
        const json& files = doc["files"];
        for (size_t i = 0; i < files.size(); ++i)
            if (files[i].is_object() && files[i].contains("sha256") &&
                longString(files[i]["sha256"], 64))
                return "/files/" + std::to_string(i) + "/sha256";
    }
    return std::nullopt;
}

int64_t sizeOf(const json& v) {
    if (v.is_number_unsigned()) {
        const uint64_t u = v.get<uint64_t>();
        return u > static_cast<uint64_t>(INT64_MAX) ? INT64_MAX : static_cast<int64_t>(u);
    }
    return v.get<int64_t>();
}

}  // namespace

PackageSchema::PackageSchema(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}
PackageSchema::~PackageSchema() = default;

std::unique_ptr<PackageSchema> PackageSchema::load(const std::string& schemaFile,
                                                   std::string& error) {
    std::ifstream f(schemaFile, std::ios::binary);
    if (!f) {
        error = "không đọc được " + schemaFile;
        return nullptr;
    }
    std::stringstream ss;
    ss << f.rdbuf();
    const json doc = json::parse(ss.str(), nullptr, false);
    if (doc.is_discarded() || !doc.is_object()) {
        error = "schema hỏng: " + schemaFile;
        return nullptr;
    }
    auto impl = std::make_unique<Impl>();
    try {
        valijson::SchemaParser parser(valijson::SchemaParser::kDraft7);
        valijson::adapters::NlohmannJsonAdapter adapter(doc);
        parser.populateSchema(adapter, impl->schema);
    } catch (const std::exception& e) {
        error = "schema " + schemaFile + ": " + e.what();
        return nullptr;
    }
    return std::unique_ptr<PackageSchema>(new PackageSchema(std::move(impl)));
}

std::unique_ptr<PackageSchema> PackageSchema::loadFromDir(const std::string& schemasDir,
                                                          std::string& error) {
    return load(schemasDir + "/" + kPackageManifestSchemaFile, error);
}

std::optional<PackageError> parseManifest(std::string text, const PackageSchema& schema,
                                          PackageManifest& out) {
    if (text.size() >= 3 && text.compare(0, 3, "\xEF\xBB\xBF") == 0)
        return manifestError("Manifest có BOM (phải là UTF-8 không BOM)");
    if (!isValidUtf8(text)) return manifestError("Manifest không phải UTF-8 hợp lệ");
    if (jsonNestingDepth(text.data(), text.size()) > kMaxManifestDepth)
        return manifestError("Manifest lồng quá sâu");
    const json doc = json::parse(text, nullptr, false);
    if (doc.is_discarded()) return manifestError("Manifest không phải JSON hợp lệ");
    if (!doc.is_object()) return manifestError("Manifest phải là một object JSON");
    if (auto p = tooLongForPattern(doc)) return manifestError("Manifest sai schema tại " + *p);

    valijson::Validator validator;
    valijson::ValidationResults results;
    try {
        const json view = schemaView(doc);
        valijson::adapters::NlohmannJsonAdapter target(view);
        if (!validator.validate(schema.impl().schema, target, &results)) {
            valijson::ValidationResults::Error e;
            std::string where = "/";
            std::string what;
            if (results.popError(e)) {
                const std::string p = contextToPointer(e.context);
                where = p.empty() ? "/" : p;
                what = e.description;
            }
            return manifestError("Manifest sai schema tại " + where + ": " + what);
        }
    } catch (const std::exception& e) {
        return manifestError(std::string("Manifest sai schema: ") + e.what());
    }

    PackageManifest m;
    m.formatVersion = doc["formatVersion"];
    const json& project = doc["project"];
    m.projectId = project["projectId"];
    m.projectName = project["projectName"];
    m.projectVersion = project["projectVersion"];
    m.minRuntimeVersion = project["minRuntimeVersion"];
    m.createdAt = doc["createdAt"];
    m.generatorName = doc["generator"]["name"];
    m.generatorVersion = doc["generator"]["version"];
    m.digest = doc["digest"];
    for (const auto& f : doc["files"])
        m.files.push_back(
            {f["path"].get<std::string>(), sizeOf(f["size"]), f["sha256"].get<std::string>()});

    // files[]: strictly increasing by UTF-8 bytes (sorted, no duplicates).
    for (size_t i = 1; i < m.files.size(); ++i)
        if (compareUtf8(m.files[i - 1].path, m.files[i].path) >= 0)
            return manifestError("files của manifest trùng hoặc chưa sắp theo byte UTF-8 của path");
    for (const auto& f : m.files)
        if (f.path == kPackageManifestName)
            return manifestError("files của manifest không được có matscada.json");
    // Every files[].path: rules 1–5 and 7 (E_PKG_PATH), then 6 (E_PKG_TYPE) (§5, §8a).
    std::set<std::string> keys;
    for (const auto& f : m.files) {
        if (auto e = packagePathError(f.path)) return e;
        if (!keys.insert(packagePathKey(f.path)).second)
            return PackageError{"E_PKG_PATH", packageDisplayName(f.path),
                                "Trùng tên với file khác của manifest khi không phân biệt hoa "
                                "thường"};
        if (auto e = packageTypeError(f.path)) return e;
    }
    m.text = std::move(text);
    out = std::move(m);
    return std::nullopt;
}

bool packageFormatMajorIsSupported(const std::string& formatVersion) {
    return formatVersion.compare(0, 2, "1.") == 0;
}

}  // namespace mat
