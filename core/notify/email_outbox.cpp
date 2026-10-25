#include "core/notify/email_outbox.hpp"

#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cstdio>
#include <fstream>
#include <sstream>

#include "core/notify/email_config.hpp"
#include "nlohmann/json.hpp"

namespace mat::notify {

namespace {

constexpr int64_t kMaxFileBytes = 256 * 1024;

bool digits16(const std::string& s) {
    if (s.size() != 16) return false;
    for (char c : s)
        if (c < '0' || c > '9') return false;
    return true;
}

std::optional<OutboxEntry> parseEntry(const std::string& id, const std::string& text) {
    const nlohmann::json j = nlohmann::json::parse(text, nullptr, false);
    if (!j.is_object() || !j.contains("to") || !j["to"].is_array() || j["to"].empty() ||
        !j.contains("data") || !j["data"].is_string() || !j.contains("from") ||
        !j["from"].is_string() || !j.contains("created") || !j["created"].is_number_integer())
        return std::nullopt;
    OutboxEntry e;
    e.id = id;
    e.from = j["from"].get<std::string>();
    for (const auto& t : j["to"]) {
        if (!t.is_string()) return std::nullopt;
        e.to.push_back(t.get<std::string>());
    }
    e.data = j["data"].get<std::string>();
    e.createdEpochMs = j["created"].get<int64_t>();
    if (j.contains("kind") && j["kind"].is_string()) e.kind = j["kind"].get<std::string>();
    if (j.contains("items") && j["items"].is_number_integer()) e.items = j["items"].get<int>();
    return e;
}

}  // namespace

std::string EmailOutbox::path(const std::string& id) const { return dir_ + "/" + id + ".mail"; }

bool EmailOutbox::open(const std::string& dir, size_t maxCount, int64_t maxBytes,
                       std::string& err) {
    dir_ = dir;
    maxCount_ = std::max<size_t>(1, maxCount);
    maxBytes_ = std::max<int64_t>(kMaxFileBytes, maxBytes);
    files_.clear();
    if (!ensurePrivateDir(dir_)) {
        err = "không tạo được thư mục " + dir_;
        return false;
    }
    DIR* d = ::opendir(dir_.c_str());
    if (!d) {
        err = "không đọc được thư mục " + dir_;
        return false;
    }
    std::vector<std::string> names;
    while (dirent* e = ::readdir(d)) names.emplace_back(e->d_name);
    ::closedir(d);
    std::sort(names.begin(), names.end());
    for (const std::string& n : names) {
        if (n == "." || n == "..") continue;
        const std::string full = dir_ + "/" + n;
        const bool mail =
            n.size() == 21 && n.compare(16, 5, ".mail") == 0 && digits16(n.substr(0, 16));
        struct stat st {};
        if (!mail || ::lstat(full.c_str(), &st) != 0 || !S_ISREG(st.st_mode) ||
            st.st_size > kMaxFileBytes) {
            ::unlink(full.c_str());  // a temporary file of a cut write, or a stranger
            if (mail) dropped_.push_back({n.substr(0, 16), "damaged", 0});
            continue;
        }
        const std::string id = n.substr(0, 16);
        auto entry = load(id);
        if (!entry) {
            ::unlink(full.c_str());
            dropped_.push_back({id, "damaged", 0});
            continue;
        }
        files_.push_back({id, static_cast<int64_t>(st.st_size), entry->to.size()});
        nextSeq_ = std::max<uint64_t>(nextSeq_, std::stoull(id) + 1);
    }
    return true;
}

bool EmailOutbox::add(OutboxEntry& e, std::string& err) {
    char id[24];
    std::snprintf(id, sizeof id, "%016llu", static_cast<unsigned long long>(nextSeq_++));
    e.id = id;
    const std::string text = nlohmann::json{{"kind", e.kind},   {"from", e.from},
                                            {"to", e.to},       {"created", e.createdEpochMs},
                                            {"items", e.items}, {"data", e.data}}
                                 .dump();
    if (static_cast<int64_t>(text.size()) > kMaxFileBytes) {
        err = "email quá lớn";
        return false;
    }
    while (!files_.empty() && (files_.size() + 1 > maxCount_ ||
                               bytes() + static_cast<int64_t>(text.size()) > maxBytes_)) {
        dropped_.push_back({files_.front().id, "full", files_.front().recipients});
        ::unlink(path(files_.front().id).c_str());
        files_.erase(files_.begin());
    }
    if (!writeFileAtomic(path(e.id), text, err)) return false;
    files_.push_back({e.id, static_cast<int64_t>(text.size()), e.to.size()});
    return true;
}

std::vector<std::string> EmailOutbox::ids() const {
    std::vector<std::string> v;
    for (const auto& f : files_) v.push_back(f.id);
    return v;
}

std::optional<OutboxEntry> EmailOutbox::load(const std::string& id) {
    std::ifstream f(path(id), std::ios::binary);
    if (!f) return std::nullopt;
    std::stringstream ss;
    ss << f.rdbuf();
    return parseEntry(id, ss.str());
}

void EmailOutbox::remove(const std::string& id) {
    ::unlink(path(id).c_str());
    files_.erase(
        std::remove_if(files_.begin(), files_.end(), [&](const File& f) { return f.id == id; }),
        files_.end());
}

int64_t EmailOutbox::bytes() const {
    int64_t b = 0;
    for (const auto& f : files_) b += f.bytes;
    return b;
}

std::vector<OutboxDropped> EmailOutbox::takeDropped() {
    std::vector<OutboxDropped> d;
    d.swap(dropped_);
    return d;
}

}  // namespace mat::notify
