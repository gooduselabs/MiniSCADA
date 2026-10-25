#include "core/recipe/recipe_store.hpp"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <fstream>
#include <sstream>

namespace mat::recipe {

using nlohmann::json;

namespace {

std::string dirOf(const std::string& path) {
    const size_t slash = path.rfind('/');
    return slash == std::string::npos ? "." : path.substr(0, slash);
}

bool makeDirs(const std::string& dir) {
    std::string cur;
    std::stringstream ss(dir);
    std::string part;
    if (!dir.empty() && dir[0] == '/') cur = "/";
    while (std::getline(ss, part, '/')) {
        if (part.empty()) continue;
        cur += part + "/";
        if (::mkdir(cur.c_str(), 0700) != 0 && errno != EEXIST) return false;
    }
    return true;
}

json recipeJson(const StoredRecipe& r) {
    return {{"id", r.id},
            {"name", r.name},
            {"values", r.values},
            {"updatedAt", r.updatedAt},
            {"updatedBy", r.updatedBy}};
}

bool parseRecipe(const json& j, StoredRecipe& out) {
    if (!j.is_object() || !j.contains("id") || !j["id"].is_string() || !j.contains("name") ||
        !j["name"].is_string() || !j.contains("values") || !j["values"].is_object())
        return false;
    out.id = j["id"].get<std::string>();
    out.name = j["name"].get<std::string>();
    out.values = j["values"];
    if (j.contains("updatedAt") && j["updatedAt"].is_string())
        out.updatedAt = j["updatedAt"].get<std::string>();
    if (j.contains("updatedBy") && j["updatedBy"].is_string())
        out.updatedBy = j["updatedBy"].get<std::string>();
    return true;
}

const std::vector<StoredRecipe> kEmpty;

}  // namespace

bool RecipeStore::load(std::string& err) {
    err.clear();
    rev_ = 0;
    types_.clear();
    if (!makeDirs(dirOf(path_))) {
        err = "không tạo được thư mục " + dirOf(path_) + ": " + std::strerror(errno);
        return false;
    }
    struct stat st {};
    if (::stat(path_.c_str(), &st) != 0) return true;  // no file yet
    auto damaged = [&](const std::string& why) {
        err = path_ + " hỏng (" + why + "), giữ ở " + path_ + ".bad";
        ::rename(path_.c_str(), (path_ + ".bad").c_str());
        rev_ = 0;
        types_.clear();
        return true;
    };
    if (!S_ISREG(st.st_mode) || static_cast<size_t>(st.st_size) > kStoreMaxBytes)
        return damaged("không phải tệp hoặc quá lớn");
    std::ifstream in(path_, std::ios::binary);
    std::stringstream ss;
    ss << in.rdbuf();
    const json doc = json::parse(ss.str(), nullptr, false);
    if (doc.is_discarded() || !doc.is_object() || !doc.contains("rev") ||
        !doc["rev"].is_number_integer() || !doc.contains("types") || !doc["types"].is_object())
        return damaged("không đúng định dạng");
    for (auto it = doc["types"].begin(); it != doc["types"].end(); ++it) {
        if (!it->is_array()) return damaged("không đúng định dạng");
        std::vector<StoredRecipe> list;
        for (const auto& j : *it) {
            StoredRecipe r;
            if (!parseRecipe(j, r)) return damaged("không đúng định dạng");
            list.push_back(std::move(r));
        }
        types_[it.key()] = std::move(list);
    }
    rev_ = doc["rev"].get<int64_t>();
    return true;
}

const std::vector<StoredRecipe>& RecipeStore::list(const std::string& type) const {
    const auto it = types_.find(type);
    return it == types_.end() ? kEmpty : it->second;
}

const StoredRecipe* RecipeStore::find(const std::string& type, const std::string& id) const {
    for (const auto& r : list(type))
        if (r.id == id) return &r;
    return nullptr;
}

RecipeStore::Status RecipeStore::put(const std::string& type, const StoredRecipe& r,
                                     int64_t expectRev, std::string& err) {
    if (expectRev != rev_) return Status::Conflict;
    auto next = types_;
    auto& list = next[type];
    bool replaced = false;
    for (auto& x : list)
        if (x.id == r.id) {
            x = r;
            replaced = true;
        }
    if (!replaced) list.push_back(r);
    if (!write(next, rev_ + 1, err)) return Status::IoError;
    types_ = std::move(next);
    ++rev_;
    return Status::Ok;
}

RecipeStore::Status RecipeStore::remove(const std::string& type, const std::string& id,
                                        int64_t expectRev, std::string& err) {
    if (expectRev != rev_) return Status::Conflict;
    if (!find(type, id)) return Status::NotFound;
    auto next = types_;
    auto& list = next[type];
    for (auto it = list.begin(); it != list.end(); ++it)
        if (it->id == id) {
            list.erase(it);
            break;
        }
    if (list.empty()) next.erase(type);
    if (!write(next, rev_ + 1, err)) return Status::IoError;
    types_ = std::move(next);
    ++rev_;
    return Status::Ok;
}

bool RecipeStore::write(const std::map<std::string, std::vector<StoredRecipe>>& types, int64_t rev,
                        std::string& err) {
    json doc = {{"schemaVersion", "1.0.0"}, {"rev", rev}, {"types", json::object()}};
    for (const auto& [type, list] : types) {
        json arr = json::array();
        for (const auto& r : list) arr.push_back(recipeJson(r));
        doc["types"][type] = std::move(arr);
    }
    const std::string text = doc.dump(1) + "\n";
    if (text.size() > kStoreMaxBytes) {
        err = "tệp recipe vượt 1 MiB";
        return false;
    }
    const std::string tmp = path_ + ".tmp";
    const int fd = ::open(tmp.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    if (fd < 0) {
        err = "không mở được " + tmp + ": " + std::strerror(errno);
        return false;
    }
    size_t done = 0;
    while (done < text.size()) {
        const ssize_t n = ::write(fd, text.data() + done, text.size() - done);
        if (n < 0) {
            if (errno == EINTR) continue;
            err = std::string("không ghi được: ") + std::strerror(errno);
            ::close(fd);
            ::unlink(tmp.c_str());
            return false;
        }
        done += static_cast<size_t>(n);
    }
    if (::fsync(fd) != 0 || ::close(fd) != 0) {
        err = std::string("không fsync được: ") + std::strerror(errno);
        ::unlink(tmp.c_str());
        return false;
    }
    if (::rename(tmp.c_str(), path_.c_str()) != 0) {
        err = std::string("không đổi tên được: ") + std::strerror(errno);
        ::unlink(tmp.c_str());
        return false;
    }
    const int dfd = ::open(dirOf(path_).c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dfd >= 0) {
        ::fsync(dfd);
        ::close(dfd);
    }
    return true;
}

}  // namespace mat::recipe
