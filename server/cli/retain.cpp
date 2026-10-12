#include "server/cli/retain.hpp"

#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cstring>
#include <ostream>
#include <vector>

#include "core/tag-engine/retain_store.hpp"
#include "nlohmann/json.hpp"

namespace mat {

namespace {

bool hasFlag(int argc, char** argv, const char* flag) {
    for (int i = 1; i < argc; ++i)
        if (std::strcmp(argv[i], flag) == 0) return true;
    return false;
}

// The files of the store, opened for reading only; every call that writes fails, so that
// RetainStore::open() (which makes a fresh store or renames a damaged one) changes nothing.
class ReadOnlyRetainIo : public RetainIo {
   public:
    explicit ReadOnlyRetainIo(std::string dir) : dir_(std::move(dir)) {}
    bool exists(const std::string& name) override {
        struct stat st {};
        return ::stat((dir_ + "/" + name).c_str(), &st) == 0;
    }
    int64_t size(const std::string& name) override {
        struct stat st {};
        return ::stat((dir_ + "/" + name).c_str(), &st) == 0 ? static_cast<int64_t>(st.st_size)
                                                             : -1;
    }
    bool createZeroed(const std::string&, size_t) override { return refuse(); }
    bool pread(const std::string& name, size_t offset, void* buf, size_t n) override {
        const int fd = ::open((dir_ + "/" + name).c_str(), O_RDONLY | O_CLOEXEC);
        if (fd < 0) {
            error_ = std::strerror(errno);
            return false;
        }
        auto* p = static_cast<uint8_t*>(buf);
        bool ok = true;
        while (n > 0) {
            const ssize_t r = ::pread(fd, p, n, static_cast<off_t>(offset));
            if (r < 0 && errno == EINTR) continue;
            if (r <= 0) {
                error_ = r < 0 ? std::strerror(errno) : "EOF";
                ok = false;
                break;
            }
            p += r;
            offset += static_cast<size_t>(r);
            n -= static_cast<size_t>(r);
        }
        ::close(fd);
        return ok;
    }
    bool pwrite(const std::string&, size_t, const void*, size_t) override { return refuse(); }
    bool fdatasync(const std::string&) override { return refuse(); }
    bool rename(const std::string&, const std::string&) override { return refuse(); }
    bool remove(const std::string&) override { return refuse(); }
    std::vector<std::string> list() override {
        std::vector<std::string> out;
        if (DIR* d = ::opendir(dir_.c_str())) {
            while (const dirent* e = ::readdir(d)) {
                const std::string n = e->d_name;
                if (n != "." && n != "..") out.push_back(n);
            }
            ::closedir(d);
        }
        std::sort(out.begin(), out.end());
        return out;
    }
    std::string lastError() const override { return error_; }

   private:
    bool refuse() {
        error_ = "EROFS";
        return false;
    }
    std::string dir_;
    std::string error_;
};

const char* typeName(TagType t) {
    switch (t) {
        case TagType::BOOL:
            return "BOOL";
        case TagType::INT16:
            return "INT16";
        case TagType::UINT16:
            return "UINT16";
        case TagType::INT32:
            return "INT32";
        case TagType::UINT32:
            return "UINT32";
        case TagType::INT64:
            return "INT64";
        case TagType::UINT64:
            return "UINT64";
        case TagType::FLOAT32:
            return "FLOAT32";
        case TagType::FLOAT64:
            return "FLOAT64";
        case TagType::STRING:
            return "STRING";
    }
    return "FLOAT64";
}

nlohmann::json valueJson(const RetainValue& v) {
    using nlohmann::json;
    if (const bool* b = std::get_if<bool>(&v.value)) return *b;
    if (const std::string* s = std::get_if<std::string>(&v.value)) return *s;
    if (const double* d = std::get_if<double>(&v.value)) return *d;
    if (const int64_t* i = std::get_if<int64_t>(&v.value))
        return v.type == TagType::INT64 ? json(std::to_string(*i)) : json(*i);
    if (const uint64_t* u = std::get_if<uint64_t>(&v.value))
        return v.type == TagType::UINT64 ? json(std::to_string(*u)) : json(*u);
    return nullptr;
}

}  // namespace

bool isRetainCommand(int argc, char** argv) { return hasFlag(argc, argv, "--retain-dump"); }

int runRetainCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
                 std::ostream& err) {
    std::vector<std::string> overrides;  // --config, --retain-dir
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--retain-dump") continue;
        if (a == "--config" || a == "--retain-dir" || a == "--data-dir") {
            if (i + 1 >= argc || *argv[i + 1] == '\0') {
                err << a << " cần một giá trị\n";
                return 2;
            }
            overrides.push_back(a);
            overrides.push_back(argv[++i]);
        } else {
            err << "tham số không hỗ trợ: " << a << "\n";
            return 2;
        }
    }
    RuntimeConfig cfg;
    std::string error;
    if (!loadDeviceCliConfig(overrides, env, cfg, error)) {
        err << "cấu hình: " << error << "\n";
        return 2;
    }
    ReadOnlyRetainIo io(cfg.retainDir);
    RetainStore store(io, 0);
    const RetainStatus status = store.open();
    const RetainDiag d = store.diag();
    nlohmann::json tags = nlohmann::json::array();
    for (const auto& [id, v] : store.values())
        tags.push_back({{"id", id}, {"type", typeName(v.type)}, {"value", valueJson(v)}});
    nlohmann::json j = {
        {"state", retainStatusName(status)}, {"entries", store.values().size()}, {"tags", tags}};
    j["file"] = status == RetainStatus::Ok || status == RetainStatus::Fallback
                    ? nlohmann::json(d.file)
                    : nlohmann::json(nullptr);
    j["generation"] = d.generation;
    out << j.dump(2) << "\n";
    return status == RetainStatus::Lost ? 1 : 0;
}

}  // namespace mat
