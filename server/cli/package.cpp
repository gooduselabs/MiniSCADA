#include "server/cli/package.hpp"

#include <cstdio>
#include <memory>

#include "core/common/utf8.hpp"
#include "core/package/package_check.hpp"

namespace mat {

namespace {

// A path as the terminal shows it: control characters (C0, DEL, C1) and the characters that
// rearrange a line (bidi marks, overrides, isolates) become \xNN or \uXXXX, so a crafted entry
// name cannot drive the terminal or hide itself.
std::string shown(const std::string& path) {
    const std::string s = sanitizeUtf8(path);
    std::string out;
    char hex[12];
    for (size_t i = 0; i < s.size(); ++i) {
        const auto c = static_cast<unsigned char>(s[i]);
        size_t controlLen = 0;
        const unsigned control = layoutControlAt(s, i, controlLen);
        if (c < 0x20 || c == 0x7f) {
            std::snprintf(hex, sizeof hex, "\\x%02x", c);
            out += hex;
        } else if (c == 0xc2 && i + 1 < s.size() && static_cast<unsigned char>(s[i + 1]) >= 0x80 &&
                   static_cast<unsigned char>(s[i + 1]) < 0xa0) {
            std::snprintf(hex, sizeof hex, "\\u%04x", static_cast<unsigned char>(s[i + 1]));
            out += hex;
            ++i;
        } else if (control != 0) {
            std::snprintf(hex, sizeof hex, "\\u%04x", control);
            out += hex;
            i += controlLen - 1;
        } else {
            out += static_cast<char>(c);
        }
    }
    return out;
}

}  // namespace

int runCheckPackageCli(int argc, char** argv, std::ostream& out, std::ostream& err,
                       const std::string& defaultSchemasDir) {
    std::string file, schemasDir = defaultSchemasDir;
    bool haveFile = false;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--check-package" || a == "--schemas-dir") {
            if (i + 1 >= argc) {
                err << a << " cần một giá trị\n";
                return 2;
            }
            if (a == "--check-package") {
                file = argv[++i];
                haveFile = true;
            } else {
                schemasDir = argv[++i];
            }
        } else {
            err << "tham số không hỗ trợ: " << a << "\n";
            return 2;
        }
    }
    if (!haveFile || file.empty()) {
        err << "cần đường dẫn gói: --check-package <file>\n";
        return 2;
    }
    std::string error;
    const auto schema = PackageSchema::loadFromDir(schemasDir, error);
    if (!schema) {
        err << "không nạp được schema của gói: " << error << "\n";
        return 6;
    }
    const auto src = FileSource::open(file, error);
    if (!src) {
        err << "không đọc được " << file << ": " << error << "\n";
        return 6;
    }
    const PackageCheck r = checkPackage(*src, *schema);
    if (r.ok) {
        out << r.manifest.digest << "\n";
        return 0;
    }
    if (r.error.code == "STORE_IO") {
        err << "không đọc được " << file << ": " << r.error.message << "\n";
        return 6;
    }
    out << r.error.code;
    if (!r.error.path.empty()) out << " '" << shown(r.error.path) << "'";
    out << ": " << r.error.message << "\n";
    return 1;
}

}  // namespace mat
