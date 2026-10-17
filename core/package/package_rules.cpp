#include "core/package/package_rules.hpp"

#include <algorithm>
#include <vector>

#include "core/common/utf8.hpp"
#include "nlohmann/json.hpp"

namespace mat {

namespace {

PackageError pathError(std::string_view path, const char* message) {
    return {"E_PKG_PATH", packageDisplayName(path), message};
}

bool isControl(unsigned char c) { return c < 0x20 || c == 0x7f; }

std::string lowerAscii(std::string_view s) {
    std::string out(s);
    for (char& c : out)
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    return out;
}

// CON, PRN, AUX, NUL, COM1–COM9, LPT1–LPT9 with or without an extension, any case.
bool isWindowsDeviceName(std::string_view segment) {
    const std::string base = lowerAscii(segment.substr(0, segment.find('.')));
    if (base == "con" || base == "prn" || base == "aux" || base == "nul") return true;
    return base.size() == 4 && (base.compare(0, 3, "com") == 0 || base.compare(0, 3, "lpt") == 0) &&
           base[3] >= '1' && base[3] <= '9';
}

bool endsWith(std::string_view s, std::string_view tail) {
    return s.size() >= tail.size() && s.substr(s.size() - tail.size()) == tail;
}

// "-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----" anywhere in the bytes. The run of [A-Z0-9 ] after
// "BEGIN " ends at the first other byte; the pattern matches when the run ends with
// "PRIVATE KEY" and five dashes follow it.
bool hasPemPrivateKey(std::string_view s) {
    static constexpr std::string_view kBegin = "-----BEGIN ";
    static constexpr std::string_view kKey = "PRIVATE KEY";
    for (size_t at = s.find(kBegin); at != std::string_view::npos; at = s.find(kBegin, at + 1)) {
        size_t end = at + kBegin.size();
        while (end < s.size() && ((s[end] >= 'A' && s[end] <= 'Z') ||
                                  (s[end] >= '0' && s[end] <= '9') || s[end] == ' '))
            ++end;
        const std::string_view run = s.substr(at + kBegin.size(), end - at - kBegin.size());
        if (endsWith(run, kKey) && s.substr(end, 5) == "-----") return true;
    }
    return false;
}

bool keyLooksSecret(const std::string& key) {
    static const char* const kWords[] = {"password", "passwd", "pwd",    "secret",
                                         "token",    "apikey", "api_key"};
    const std::string lower = lowerAscii(key);
    for (const char* w : kWords)
        if (lower.find(w) != std::string::npos) return true;
    return false;
}

// The authority of a URL ("user:pass@host:port") holds an account: same rule as
// findUrlCredentials() of the logging check (E_LOG_SECRET).
bool urlHasAccount(const std::string& url) {
    const size_t scheme = url.find("://");
    const std::string rest = scheme == std::string::npos ? url : url.substr(scheme + 3);
    return rest.substr(0, rest.find_first_of("/?#")).find('@') != std::string::npos;
}

// One streaming pass over a JSON document (nlohmann SAX: memory does not grow with the document
// beyond one byte per nesting level). It records the first key that looks like a secret, the
// first connections[i].url with an account, and the identity strings of a top-level object.
// Findings count only when the whole document parses, as with a parsed DOM.
class JsonScan final : public nlohmann::json_sax<nlohmann::json> {
   public:
    std::optional<std::string> secretKey;
    std::optional<std::string> urlAccount;
    bool rootIsObject = false;
    ProjectIdentity identity;

    bool null() override { return value(); }
    bool boolean(bool) override { return value(); }
    bool number_integer(number_integer_t) override { return value(); }
    bool number_unsigned(number_unsigned_t) override { return value(); }
    bool number_float(number_float_t, const string_t&) override { return value(); }
    bool binary(binary_t&) override { return value(); }
    bool string(string_t& s) override {
        if (atRootValue()) setIdentity(&s);
        if (inConnectionObject() && connKey_ == "url" && !urlAccount && urlHasAccount(s))
            urlAccount = "connections[].url";
        return true;
    }
    bool start_object(std::size_t) override {
        value();
        if (kinds_.empty()) rootIsObject = true;
        kinds_.push_back(kObject);
        if (inConnectionObject()) connKey_.clear();
        return true;
    }
    bool end_object() override {
        kinds_.pop_back();
        return true;
    }
    bool start_array(std::size_t) override {
        value();
        kinds_.push_back(kArray);
        return true;
    }
    bool end_array() override {
        kinds_.pop_back();
        return true;
    }
    bool key(string_t& k) override {
        if (!secretKey && keyLooksSecret(k)) secretKey = k;
        if (kinds_.size() == 1) rootKey_ = k;
        if (inConnectionObject()) connKey_ = k;
        return true;
    }
    bool parse_error(std::size_t, const std::string&, const nlohmann::detail::exception&) override {
        return false;
    }

   private:
    static constexpr uint8_t kObject = 0, kArray = 1;

    bool atRootValue() const { return kinds_.size() == 1 && kinds_[0] == kObject; }
    // Inside an object that is an element of the top-level "connections" array.
    bool inConnectionObject() const {
        return kinds_.size() == 3 && kinds_[0] == kObject && rootKey_ == "connections" &&
               kinds_[1] == kArray && kinds_[2] == kObject;
    }
    // Any value: a non-string value of an identity key clears that field.
    bool value() {
        if (atRootValue()) setIdentity(nullptr);
        return true;
    }
    void setIdentity(const std::string* s) {
        std::optional<std::string>* field = rootKey_ == "projectId"
                                                ? &identity.projectId
                                                : rootKey_ == "projectName"
                                                      ? &identity.projectName
                                                      : rootKey_ == "projectVersion"
                                                            ? &identity.projectVersion
                                                            : rootKey_ == "minRuntimeVersion"
                                                                  ? &identity.minRuntimeVersion
                                                                  : nullptr;
        if (!field) return;
        if (s)
            *field = *s;
        else
            field->reset();
    }

    std::vector<uint8_t> kinds_;
    std::string rootKey_;
    std::string connKey_;
};

bool scanJson(std::string_view text, JsonScan& scan) {
    return nlohmann::json::sax_parse(text.begin(), text.end(), &scan);
}

}  // namespace

std::optional<PackageError> packagePathError(std::string_view path) {
    if (path.empty() || path.size() > kPackageMaxPathBytes)
        return pathError(path, "Đường dẫn phải dài 1–128 byte");
    if (!isValidUtf8(std::string(path)))
        return pathError(path, "Đường dẫn không phải UTF-8 hợp lệ");
    if (path[0] == '/') return pathError(path, "Đường dẫn tuyệt đối (bắt đầu bằng '/')");
    for (unsigned char c : path) {
        if (c == '\\' || c == ':') return pathError(path, "Đường dẫn có ký tự '\\' hoặc ':'");
        if (isControl(c)) return pathError(path, "Đường dẫn có ký tự điều khiển");
        if (c == '<' || c == '>' || c == '"' || c == '|' || c == '?' || c == '*')
            return pathError(path, "Đường dẫn có ký tự Windows không nhận (< > \" | ? *)");
    }
    size_t segments = 0;
    size_t start = 0;
    while (true) {
        const size_t end = std::min(path.find('/', start), path.size());
        const std::string_view seg = path.substr(start, end - start);
        ++segments;
        if (seg.empty() || seg == "." || seg == "..")
            return pathError(path, "Đường dẫn có đoạn rỗng, '.' hoặc '..'");
        if (seg.back() == '.' || seg.back() == ' ')
            return pathError(path,
                             "Một đoạn của đường dẫn kết thúc bằng dấu chấm hoặc khoảng trắng");
        if (isWindowsDeviceName(seg))
            return pathError(path,
                             "Một đoạn của đường dẫn là tên thiết bị của Windows (CON, PRN, "
                             "AUX, NUL, COM1–9, LPT1–9)");
        if (end == path.size()) break;
        start = end + 1;
    }
    if (segments > kPackageMaxPathDepth) return pathError(path, "Đường dẫn sâu hơn 8 cấp");
    return std::nullopt;
}

std::optional<PackageError> packageTypeError(std::string_view path) {
    if (endsWith(path, ".json") || endsWith(path, ".svg")) return std::nullopt;
    return PackageError{"E_PKG_TYPE", packageDisplayName(path),
                        "Gói chỉ chứa file .json và .svg (đuôi chữ thường)"};
}

bool packageExcludedPath(std::string_view path) {
    size_t start = 0;
    std::string_view name = path;
    while (true) {
        const size_t end = std::min(path.find('/', start), path.size());
        const std::string_view seg = path.substr(start, end - start);
        if ((!seg.empty() && seg[0] == '.') || seg == "node_modules") return true;
        name = seg;
        if (end == path.size()) break;
        start = end + 1;
    }
    const std::string lower = lowerAscii(name);
    return lower == "thumbs.db" || lower == "desktop.ini" || (!name.empty() && name[0] == '~') ||
           endsWith(lower, ".tmp");
}

std::string packagePathKey(std::string_view path) { return lowerAscii(path); }

std::optional<PackageError> packageEntryLimitError(std::string_view path, uint64_t size,
                                                   uint64_t compressedSize, bool manifest) {
    if (!manifest && endsWith(path, ".json") && size > kPackageMaxJsonBytes)
        return PackageError{"E_PKG_SIZE", packageDisplayName(path),
                            "File JSON lớn hơn 1 MiB sau giải nén"};
    if (!manifest && endsWith(path, ".svg") && size > kPackageMaxSvgBytes)
        return PackageError{"E_PKG_SIZE", packageDisplayName(path),
                            "File SVG lớn hơn 5 MiB sau giải nén"};
    // compressedSize comes from a 32-bit field: the product cannot overflow.
    if (size > kPackageRatioMinBytes && size > compressedSize * kPackageMaxRatio)
        return PackageError{"E_PKG_RATIO", packageDisplayName(path),
                            "Tỉ lệ nén lớn hơn 100 (nghi ZIP bomb)"};
    return std::nullopt;
}

std::optional<std::string> findPackageSecret(std::string_view path, std::string_view content) {
    if (hasPemPrivateKey(content)) return std::string("khối khóa riêng PEM (PRIVATE KEY)");
    if (!endsWith(path, ".json")) return std::nullopt;
    JsonScan scan;
    if (!scanJson(content, scan)) return std::nullopt;
    if (scan.secretKey) return "khóa JSON giống bí mật '" + *scan.secretKey + "'";
    if (scan.urlAccount) return std::string("URL kết nối có tài khoản (connections[].url)");
    return std::nullopt;
}

std::optional<ProjectIdentity> readProjectIdentity(std::string_view projectJson) {
    JsonScan scan;
    if (!scanJson(projectJson, scan) || !scan.rootIsObject) return std::nullopt;
    return scan.identity;
}

std::string packageDisplayName(std::string_view name) {
    std::string s = sanitizeUtf8(std::string(name));
    if (s.size() <= kPackageMaxPathBytes) return s;
    size_t cut = kPackageMaxPathBytes;
    while (cut > 0 && (static_cast<unsigned char>(s[cut]) & 0xC0) == 0x80) --cut;
    return s.substr(0, cut) + "…";
}

}  // namespace mat
