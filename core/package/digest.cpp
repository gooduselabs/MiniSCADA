#include "core/package/digest.hpp"

#include <algorithm>
#include <stdexcept>

#include "core/common/utf8.hpp"
#include "core/crypto/hex.hpp"
#include "core/crypto/sha256.hpp"

namespace mat {

namespace {

bool isLowerHex64(const std::string& s) {
    return s.size() == 64 && std::all_of(s.begin(), s.end(), [](char c) {
               return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
           });
}

// Same rules as checkFile() of package-digest.ts: a path with a control character (C0, DEL)
// could pass for two lines; one that is not UTF-8 has no text in the other implementations.
void checkFile(const PackageFile& f) {
    const bool control = std::any_of(f.path.begin(), f.path.end(), [](char c) {
        const auto u = static_cast<unsigned char>(c);
        return u < 0x20 || u == 0x7f;
    });
    if (f.path.empty() || control || !isValidUtf8(f.path))
        throw std::invalid_argument("path not usable in a package digest: '" + f.path + "'");
    if (f.size < 0)
        throw std::invalid_argument("negative size of '" + f.path + "': " + std::to_string(f.size));
    if (!isLowerHex64(f.sha256))
        throw std::invalid_argument("sha256 of '" + f.path + "' is not 64 lowercase hex");
}

}  // namespace

// std::string_view::compare goes through char_traits<char>::compare, which compares as unsigned
// char ([char.traits.specializations.char]): byte order, not the sign of char.
int compareUtf8(std::string_view a, std::string_view b) { return a.compare(b); }

std::string digestText(std::vector<PackageFile> files) {
    for (const auto& f : files) checkFile(f);
    std::sort(files.begin(), files.end(), [](const PackageFile& a, const PackageFile& b) {
        return compareUtf8(a.path, b.path) < 0;
    });
    std::string text;
    for (size_t i = 0; i < files.size(); ++i) {
        if (i > 0 && files[i].path == files[i - 1].path)
            throw std::invalid_argument("duplicate path in a package digest: '" + files[i].path +
                                        "'");
        text += files[i].sha256 + " " + std::to_string(files[i].size) + " " + files[i].path + "\n";
    }
    return text;
}

std::string packageDigest(const std::vector<PackageFile>& files) {
    return "sha256:" + toHex(sha256(digestText(files)));
}

PackageFile packageFile(std::string path, std::string_view content) {
    return {std::move(path), static_cast<int64_t>(content.size()), toHex(sha256(content))};
}

}  // namespace mat
