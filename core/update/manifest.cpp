#include "core/update/manifest.hpp"

#include <set>

#include "core/update/paths.hpp"
#include "core/update/signature.hpp"
#include "nlohmann/json.hpp"

namespace mat::update {

namespace {

using nlohmann::json;

struct SemVer {
    uint64_t major = 0, minor = 0, patch = 0;
    std::vector<std::string> pre;
};

bool parseNumber(std::string_view s, uint64_t& v) {
    if (s.empty() || s.size() > 9 || (s.size() > 1 && s[0] == '0')) return false;
    v = 0;
    for (char c : s) {
        if (c < '0' || c > '9') return false;
        v = v * 10 + static_cast<uint64_t>(c - '0');
    }
    return true;
}

bool parseSemVer(std::string_view s, SemVer& out) {
    if (s.size() > 64) return false;
    const size_t dash = s.find('-');
    std::string_view core = s.substr(0, dash);
    uint64_t* parts[3] = {&out.major, &out.minor, &out.patch};
    for (int i = 0; i < 3; ++i) {
        const size_t dot = core.find('.');
        if ((i < 2) == (dot == std::string_view::npos)) return false;
        if (!parseNumber(core.substr(0, dot), *parts[i])) return false;
        core = dot == std::string_view::npos ? std::string_view() : core.substr(dot + 1);
    }
    out.pre.clear();
    if (dash != std::string_view::npos) {
        std::string_view pre = s.substr(dash + 1);
        if (pre.empty()) return false;
        size_t start = 0;
        while (start <= pre.size()) {
            size_t end = pre.find('.', start);
            if (end == std::string_view::npos) end = pre.size();
            const std::string_view id = pre.substr(start, end - start);
            if (id.empty()) return false;
            for (char c : id)
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                      c == '-'))
                    return false;
            out.pre.emplace_back(id);
            start = end + 1;
        }
    }
    return true;
}

bool numeric(const std::string& s) {
    return !s.empty() && s.find_first_not_of("0123456789") == std::string::npos;
}

bool hex64(const std::string& s) {
    if (s.size() != 64) return false;
    for (char c : s)
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    return true;
}

bool getString(const json& j, const char* k, std::string& out, size_t maxBytes = 256) {
    const auto it = j.find(k);
    if (it == j.end() || !it->is_string()) return false;
    out = it->get<std::string>();
    return out.size() <= maxBytes;
}

bool getUint(const json& j, const char* k, uint64_t& out) {
    const auto it = j.find(k);
    if (it == j.end() || !it->is_number_integer() || it->get<int64_t>() < 0) return false;
    out = it->get<uint64_t>();
    return out <= (uint64_t(1) << 53);
}

// "0644" → 0644; anything that is not 3 or 4 octal digits → -1
int parseMode(const std::string& s) {
    if (s.size() < 3 || s.size() > 4) return -1;
    int v = 0;
    for (char c : s) {
        if (c < '0' || c > '7') return -1;
        v = v * 8 + (c - '0');
    }
    return v;
}

Error bad(const std::string& why) { return invalid("MANIFEST", why); }

}  // namespace

bool validVersion(std::string_view v) {
    SemVer s;
    return parseSemVer(v, s);
}

int compareVersions(std::string_view a, std::string_view b) {
    SemVer x, y;
    if (!parseSemVer(a, x)) x = SemVer{};
    if (!parseSemVer(b, y)) y = SemVer{};
    auto cmp = [](uint64_t p, uint64_t q) { return p < q ? -1 : (p > q ? 1 : 0); };
    if (int c = cmp(x.major, y.major)) return c;
    if (int c = cmp(x.minor, y.minor)) return c;
    if (int c = cmp(x.patch, y.patch)) return c;
    if (x.pre.empty() || y.pre.empty())
        return x.pre.empty() == y.pre.empty() ? 0 : (x.pre.empty() ? 1 : -1);
    for (size_t i = 0; i < x.pre.size() && i < y.pre.size(); ++i) {
        const std::string &p = x.pre[i], &q = y.pre[i];
        if (p == q) continue;
        const bool np = numeric(p), nq = numeric(q);
        if (np && nq) {
            if (p.size() != q.size()) return p.size() < q.size() ? -1 : 1;
            return p < q ? -1 : 1;
        }
        if (np != nq) return np ? -1 : 1;
        return p < q ? -1 : 1;
    }
    return cmp(x.pre.size(), y.pre.size());
}

std::optional<Error> parseManifest(std::string_view text, Manifest& m) {
    if (text.size() >= 3 && static_cast<unsigned char>(text[0]) == 0xef) return bad("BOM");
    const json j = json::parse(text.begin(), text.end(), nullptr, false);
    if (j.is_discarded() || !j.is_object()) return bad("not a JSON object");
    // the format first: a later format may lay out the rest differently
    if (!getString(j, "format", m.format) || !validVersion(m.format)) return bad("format");
    if (compareVersions(m.format, "1.0.0") < 0 || compareVersions(m.format, "2.0.0-0") >= 0)
        return invalid("FORMAT_UNSUPPORTED", m.format);
    if (!getString(j, "kind", m.kind) || (m.kind != "runtime" && m.kind != "keyset"))
        return bad("kind");
    if (!getString(j, "product", m.product)) return bad("product");
    if (!getString(j, "version", m.version) || !validVersion(m.version)) return bad("version");
    uint64_t u = 0;
    if (!getUint(j, "releaseSeq", u) || u == 0) return bad("releaseSeq");
    m.releaseSeq = static_cast<int64_t>(u);
    if (!getString(j, "arch", m.arch, 32) || m.arch.empty()) return bad("arch");
    if (!getString(j, "minFromVersion", m.minFromVersion) || !validVersion(m.minFromVersion))
        return bad("minFromVersion");
    if (!getString(j, "projectFormatMax", m.projectFormatMax) || !validVersion(m.projectFormatMax))
        return bad("projectFormatMax");
    if (!getUint(j, "updaterRequired", u) || u == 0 || u > 1000) return bad("updaterRequired");
    m.updaterRequired = static_cast<int>(u);
    if (!getString(j, "createdAt", m.createdAt, 64)) return bad("createdAt");
    if (!getString(j, "payloadSha256", m.payloadSha256) || !hex64(m.payloadSha256))
        return bad("payloadSha256");
    if (!getUint(j, "payloadSize", m.payloadSize)) return bad("payloadSize");
    if (j.contains("notes") && !j["notes"].is_null()) {
        if (!getString(j, "notes", m.notes, 8192)) return bad("notes");
    }
    const auto files = j.find("files");
    if (files == j.end() || !files->is_array() || files->size() > kMaxFiles) return bad("files");
    m.files.clear();
    m.files.reserve(files->size());
    for (const json& f : *files) {
        if (!f.is_object()) return bad("files[]");
        FileEntry e;
        std::string mode;
        if (!getString(f, "path", e.path, 1024) || !getString(f, "sha256", e.sha256) ||
            !hex64(e.sha256) || !getUint(f, "size", e.size) || !getString(f, "mode", mode, 8))
            return bad("files[]");
        e.mode = parseMode(mode);
        if (e.mode < 0) return invalid("MODE_FORBIDDEN", e.path);
        m.files.push_back(std::move(e));
    }
    m.keysetAdd.clear();
    m.keysetRemove.clear();
    const auto ks = j.find("keyset");
    if (ks != j.end() && !ks->is_null()) {
        if (!ks->is_object()) return bad("keyset");
        for (const char* k : {"add", "remove"}) {
            const auto a = ks->find(k);
            if (a == ks->end()) continue;
            if (!a->is_array() || a->size() > 16) return bad(std::string("keyset.") + k);
            for (const json& x : *a) {
                if (!x.is_string() || x.get_ref<const std::string&>().size() > 4096)
                    return bad(std::string("keyset.") + k);
                (std::string(k) == "add" ? m.keysetAdd : m.keysetRemove)
                    .push_back(x.get<std::string>());
            }
        }
        if (m.kind != "keyset") return bad("keyset in a runtime package");
    }
    return std::nullopt;
}

std::optional<Error> checkFileList(const Manifest& m, const std::string& signerKeyId) {
    if (m.kind == "keyset") {
        if (!m.files.empty()) return bad("files in a keyset package");
        if (m.keysetAdd.empty() && m.keysetRemove.empty()) return bad("empty keyset");
        if (m.keysetAdd.size() > kKeysetMaxAdd) return invalid("KEYSET_KEY", "more than 4 keys");
        for (const std::string& pem : m.keysetAdd)
            if (keyIdOfPem(pem).empty())
                return invalid("KEYSET_KEY", "a key to add does not parse");
        for (const std::string& id : m.keysetRemove) {
            if (id.size() != 71 || id.compare(0, 7, "sha256:") != 0 || !hex64(id.substr(7)))
                return invalid("KEYSET_KEY", id);
            if (id == signerKeyId) return invalid("KEYSET_SELF_REVOKE", id);
        }
        return std::nullopt;
    }
    if (m.files.empty()) return bad("no files");
    uint64_t total = 0;
    std::set<std::string> folded;
    bool runtime = false;
    for (const FileEntry& f : m.files) {
        const std::string why = checkPath(f.path);
        if (why == "UPDATER") return refused("UPDATER_MANUAL_ONLY", 422, f.path);
        if (!why.empty()) return invalid(why.c_str(), f.path);
        if (f.mode != 0644 && f.mode != 0755) return invalid("MODE_FORBIDDEN", f.path);
        if (!folded.insert(foldCase(f.path)).second) return invalid("PATH_DUPLICATE", f.path);
        if (f.path == "bin/mat-runtime") runtime = true;
        total += f.size;
        if (total > kUnpackedMaxBytes) return invalid("UNPACKED_TOO_LARGE", f.path);
    }
    // a file that is also the directory of another ("web/a" and "web/a/b")
    for (const std::string& p : folded) {
        auto it = folded.upper_bound(p + "/");
        if (it != folded.end() && it->compare(0, p.size() + 1, p + "/") == 0)
            return invalid("PATH_DUPLICATE", p);
    }
    if (!runtime) return bad("no bin/mat-runtime");
    if (total > kMaxRatio * m.payloadSize) return invalid("RATIO_TOO_HIGH");
    return std::nullopt;
}

}  // namespace mat::update
