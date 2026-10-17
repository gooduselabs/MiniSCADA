// mat-update-verify (feature 011 T096; FR-069; device-api-011 §7; contracts/update-package.md,
// release-signing.md §5): the stand-alone checker of a .matupdate package or of a signed
// SHA256SUMS. Used by mat-updater (root, S4: on its own copy), deploy.sh and release.ps1. Depends
// on nothing of the runtime; reads only with fixed limits (core/update).
//
//   mat-update-verify <package.matupdate> [--keys <dir>] [--installed <root>] [--arch <a>]
//                     [--project-format <v>] [--max-mib <n>] [--extract-keyset <dir>] [--json]
//                     [--bench <n>]
//   mat-update-verify --key-id <key.pem>
//   mat-update-verify <SHA256SUMS> --sig <SHA256SUMS.sig> [--keys <dir>] [--sig-only] [--json]
//
// Exit: 0 valid, 2 usage, 3 signature (UPDATE_SIGNATURE_INVALID), 4 no trusted key
// (UPDATE_KEYS_MISSING), 5 package or SHA256SUMS invalid, 6 refused for the installed tree
// (UPDATE_DOWNGRADE, UPDATE_ARCH_MISMATCH, FROM_VERSION, UPDATE_PROJECT_INCOMPATIBLE,
// UPDATER_MANUAL_ONLY).
// Output (text, one item per line, TAB separated): "ok <keyId> <label>", "meta <name> <value>",
// "file <path> <sha256> <mode> <size>", "keyset-add <keyId> <file>", "keyset-remove <keyId>";
// on failure "error <CODE> <detailCode> <detail>". --json prints one JSON object instead.
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include "core/update/signature.hpp"
#include "core/update/verify.hpp"
#include "nlohmann/json.hpp"

using namespace mat::update;
using nlohmann::json;

namespace {

int usage() {
    std::fprintf(stderr,
                 "usage: mat-update-verify <package.matupdate> [--keys DIR] [--installed ROOT] "
                 "[--arch A] [--project-format V] [--max-mib N] [--extract-keyset DIR] [--json] "
                 "[--bench N]\n"
                 "       mat-update-verify <SHA256SUMS> --sig <SHA256SUMS.sig> [--keys DIR] "
                 "[--json]\n");
    return kExitUsage;
}

std::string modeText(int mode) {
    char b[8];
    std::snprintf(b, sizeof b, "%04o", mode);
    return b;
}

// build-info.json of the installed tree: version and releaseSeq (absent: 0.0.0 and 0).
void readInstalled(const std::string& root, DeviceContext& d) {
    std::string text;
    readFileLimited(root + "/build-info.json", 64 * 1024, text);
    const json j = json::parse(text, nullptr, false);
    d.version = "0.0.0";
    d.releaseSeq = 0;
    if (j.is_object()) {
        if (j.contains("version") && j["version"].is_string()) d.version = j["version"];
        if (j.contains("releaseSeq") && j["releaseSeq"].is_number_integer())
            d.releaseSeq = j["releaseSeq"].get<int64_t>();
    }
}

int fail(const Error& e, bool asJson) {
    if (asJson) {
        json j = {
            {"ok", false},
            {"error", {{"code", e.code}, {"detailCode", e.detailCode}, {"detail", e.detail}}}};
        std::printf("%s\n", j.dump().c_str());
    } else {
        std::printf("error\t%s\t%s\t%s\n", e.code.c_str(), e.detailCode.c_str(), e.detail.c_str());
    }
    return e.exit;
}

// Writes the keys a keyset adds as <dir>/<hex of keyId>.pem (0644, written then renamed).
bool extractKeys(const Manifest& m, const std::string& dir, json& added, bool asJson) {
    for (const std::string& pem : m.keysetAdd) {
        const std::string id = keyIdOfPem(pem);
        const std::string file = dir + "/" + id.substr(7) + ".pem";
        const std::string tmp = file + ".tmp";
        const int fd =
            ::open(tmp.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW | O_CLOEXEC, 0644);
        if (fd < 0) return false;
        const bool ok = ::write(fd, pem.data(), pem.size()) == static_cast<ssize_t>(pem.size()) &&
                        ::fchmod(fd, 0644) == 0 && ::fsync(fd) == 0;
        ::close(fd);
        if (!ok || ::rename(tmp.c_str(), file.c_str()) != 0) {
            ::unlink(tmp.c_str());
            return false;
        }
        if (asJson)
            added.push_back({{"keyId", id}, {"file", file}});
        else
            std::printf("keyset-add\t%s\t%s\n", id.c_str(), file.c_str());
    }
    return true;
}

}  // namespace

int main(int argc, char** argv) {
    std::string target, keysDir = "/etc/mat-runtime/trusted-keys", sig, installed, extract;
    bool asJson = false, sigOnly = false;
    int bench = 0;
    DeviceContext dev;
    dev.maxPackageBytes = 256ULL << 20;  // the largest maxPackageMiB; the runtime passes its own
    bool archGiven = false;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        auto next = [&](std::string& v) {
            if (i + 1 >= argc) return false;
            v = argv[++i];
            return true;
        };
        std::string v;
        if (a == "--key-id") {  // the keyId of a PEM public key (mat-updater, keyset removals)
            if (!next(v)) return usage();
            std::string pem;
            const std::string id = readFileLimited(v, 16384, pem) ? keyIdOfPem(pem) : std::string();
            if (id.empty()) return kExitInvalid;
            std::printf("%s\n", id.c_str());
            return kExitOk;
        } else if (a == "--json") {
            asJson = true;
        } else if (a == "--sig-only") {  // deploy.sh: the signature, the files checked by sha256sum
            sigOnly = true;
        } else if (a == "--keys") {
            if (!next(keysDir)) return usage();
        } else if (a == "--sig") {
            if (!next(sig)) return usage();
        } else if (a == "--installed") {
            if (!next(installed)) return usage();
        } else if (a == "--extract-keyset") {
            if (!next(extract)) return usage();
        } else if (a == "--arch") {
            if (!next(dev.arch)) return usage();
            archGiven = true;
        } else if (a == "--project-format") {
            if (!next(dev.projectFormat)) return usage();
        } else if (a == "--max-mib") {
            if (!next(v)) return usage();
            const long n = std::strtol(v.c_str(), nullptr, 10);
            if (n < 1 || n > 1024) return usage();
            dev.maxPackageBytes = static_cast<uint64_t>(n) << 20;
        } else if (a == "--bench") {
            if (!next(v)) return usage();
            bench = std::atoi(v.c_str());
            if (bench < 1 || bench > 10000) return usage();
        } else if (!a.empty() && a[0] != '-' && target.empty()) {
            target = a;
        } else {
            return usage();
        }
    }
    if (target.empty()) return usage();
    const KeySet keys = loadTrustedKeys(keysDir);
    for (const std::string& w : keys.warnings) std::fprintf(stderr, "warning: key %s\n", w.c_str());

    if (!sig.empty()) {  // SHA256SUMS
        std::string signer;
        if (sigOnly) {
            if (keys.keys.empty())
                return fail(Error{"UPDATE_KEYS_MISSING", "", keysDir, 503, kExitKeys}, asJson);
            std::string text, s;
            const PublicKey* k =
                !readFileLimited(target, 1u << 20, text) || !readFileLimited(sig, kSigMaxBytes, s)
                    ? nullptr
                    : keys.verify(reinterpret_cast<const uint8_t*>(text.data()), text.size(),
                                  reinterpret_cast<const uint8_t*>(s.data()), s.size());
            if (!k)
                return fail(Error{"UPDATE_SIGNATURE_INVALID", "", "", 403, kExitSignature}, asJson);
            signer = k->keyId();
        } else if (auto e = verifySums(target, sig, keys, signer)) {
            return fail(*e, asJson);
        }
        if (asJson)
            std::printf("%s\n", json{{"ok", true}, {"signer", signer}}.dump().c_str());
        else
            std::printf("ok\t%s\n", signer.c_str());
        return kExitOk;
    }

    if (!installed.empty()) {
        readInstalled(installed, dev);
        if (!archGiven) dev.arch = buildArch();
    }
    const auto t0 = std::chrono::steady_clock::now();
    Verified v;
    if (auto e = verifyPackageFile(target, keys, dev, v)) return fail(*e, asJson);
    const double ms =
        std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    const Manifest& m = v.manifest;
    if (!extract.empty() && m.kind != "keyset") {
        return fail(invalid("MANIFEST", "--extract-keyset on a runtime package"), asJson);
    }
    json added = json::array();
    if (!extract.empty() && !extractKeys(m, extract, added, asJson))
        return fail(Error{"KEYSET_WRITE_FAILED", "", extract, 500, kExitInvalid}, asJson);

    if (asJson) {
        json files = json::array();
        for (const auto& f : m.files)
            files.push_back({{"path", f.path},
                             {"sha256", f.sha256},
                             {"mode", modeText(f.mode)},
                             {"size", f.size}});
        json j = {{"ok", true},
                  {"signer", {{"keyId", v.signerKeyId}, {"label", v.signerLabel}}},
                  {"packageSha256", v.packageSha256},
                  {"packageSize", v.packageSize},
                  {"manifest",
                   {{"kind", m.kind},
                    {"version", m.version},
                    {"releaseSeq", m.releaseSeq},
                    {"arch", m.arch},
                    {"minFromVersion", m.minFromVersion},
                    {"projectFormatMax", m.projectFormatMax},
                    {"updaterRequired", m.updaterRequired},
                    {"files", files},
                    {"keysetAdd", added},
                    {"keysetRemove", m.keysetRemove}}},
                  {"verifyMs", ms}};
        std::printf("%s\n", j.dump().c_str());
    } else {
        std::printf("ok\t%s\t%s\n", v.signerKeyId.c_str(), v.signerLabel.c_str());
        std::printf("meta\tkind\t%s\n", m.kind.c_str());
        std::printf("meta\tversion\t%s\n", m.version.c_str());
        std::printf("meta\treleaseSeq\t%lld\n", static_cast<long long>(m.releaseSeq));
        std::printf("meta\tarch\t%s\n", m.arch.c_str());
        std::printf("meta\tminFromVersion\t%s\n", m.minFromVersion.c_str());
        std::printf("meta\tprojectFormatMax\t%s\n", m.projectFormatMax.c_str());
        std::printf("meta\tupdaterRequired\t%d\n", m.updaterRequired);
        std::printf("meta\tpackageSha256\t%s\n", v.packageSha256.c_str());
        std::printf("meta\tpackageSize\t%llu\n", static_cast<unsigned long long>(v.packageSize));
        for (const auto& f : m.files)
            std::printf("file\t%s\t%s\t%s\t%llu\n", f.path.c_str(), f.sha256.c_str(),
                        modeText(f.mode).c_str(), static_cast<unsigned long long>(f.size));
        for (const auto& r : m.keysetRemove) std::printf("keyset-remove\t%s\n", r.c_str());
    }
    if (bench > 0) {
        // T122: the time of one signature check on this CPU (--bench 50 on the BL335)
        std::string pkg;
        if (!readFileLimited(target, dev.maxPackageBytes, pkg)) return kExitInvalid;
        MemorySource src(reinterpret_cast<const uint8_t*>(pkg.data()), pkg.size());
        EnvelopeHead head;
        if (readHead(src, head)) return kExitInvalid;
        const auto b0 = std::chrono::steady_clock::now();
        for (int i = 0; i < bench; ++i)
            if (!keys.verify(reinterpret_cast<const uint8_t*>(head.manifest.data()),
                             head.manifest.size(), head.sig.data(), head.sig.size()))
                return kExitSignature;
        const double each =
            std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - b0)
                .count() /
            bench;
        std::fprintf(stderr, "bench: verify %.2f ms (n=%d), whole check %.2f ms\n", each, bench,
                     ms);
    }
    return kExitOk;
}
