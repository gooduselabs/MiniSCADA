#include "core/tag-engine/pulse_journal.hpp"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <fstream>

#include "nlohmann/json.hpp"

namespace mat {

namespace {

using nlohmann::json;

std::string errnoText(const char* what) { return std::string(what) + ": " + std::strerror(errno); }

std::string isoUtc(int64_t ms) {
    const time_t s = static_cast<time_t>(ms / 1000);
    std::tm tm{};
    ::gmtime_r(&s, &tm);
    char b[96];
    std::snprintf(b, sizeof b, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", tm.tm_year + 1900,
                  tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec,
                  static_cast<int>(ms % 1000));
    return b;
}

// "YYYY-MM-DDTHH:MM:SS.mmmZ" -> epoch ms; 0 when it does not read.
int64_t parseIsoUtc(const std::string& s) {
    int y = 0, mo = 0, d = 0, h = 0, mi = 0, se = 0, ms = 0;
    if (std::sscanf(s.c_str(), "%d-%d-%dT%d:%d:%d.%dZ", &y, &mo, &d, &h, &mi, &se, &ms) < 6)
        return 0;
    std::tm tm{};
    tm.tm_year = y - 1900;
    tm.tm_mon = mo - 1;
    tm.tm_mday = d;
    tm.tm_hour = h;
    tm.tm_min = mi;
    tm.tm_sec = se;
    return static_cast<int64_t>(::timegm(&tm)) * 1000 + ms;
}

std::string dirOf(const std::string& path) {
    const auto slash = path.rfind('/');
    return slash == std::string::npos ? "." : (slash == 0 ? "/" : path.substr(0, slash));
}

bool writeAll(int fd, const std::string& text) {
    size_t off = 0;
    while (off < text.size()) {
        const ssize_t n = ::write(fd, text.data() + off, text.size() - off);
        if (n < 0) {
            if (errno == EINTR) continue;
            return false;
        }
        off += static_cast<size_t>(n);
    }
    return true;
}

}  // namespace

std::string PulseJournal::armLine(const PulseArm& e) {
    const json j = {{"v", 1},
                    {"op", "arm"},
                    {"rid", e.rid},
                    {"tag", e.tag},
                    {"rel", e.rel},
                    {"dueMono", e.dueMono},
                    {"dueWall", isoUtc(e.dueWallMs)},
                    {"src", e.src},
                    {"by", e.by},
                    {"seq", e.seq}};
    return j.dump() + "\n";
}

std::string PulseJournal::doneLine(const std::string& rid, uint64_t seq) {
    return json{{"v", 1}, {"op", "done"}, {"rid", rid}, {"seq", seq}}.dump() + "\n";
}

PulseJournal::PulseJournal(std::string path) : path_(std::move(path)) {}

PulseJournal::~PulseJournal() {
    if (fd_ >= 0) ::close(fd_);
}

std::vector<PulseArm> PulseJournal::load(std::string* error) {
    std::lock_guard<std::mutex> g(mu_);
    armed_.clear();
    lines_ = 0;
    bad_ = 0;
    size_t dropped = 0;  // lines a compaction would remove (done, closed arms, bad ones)
    std::ifstream in(path_, std::ios::binary);
    for (std::string line; std::getline(in, line);) {
        if (line.empty()) continue;
        ++lines_;
        const json j = json::parse(line, nullptr, false);
        if (j.is_discarded() || !j.is_object() || j.value("v", 0) != 1 || !j.contains("rid") ||
            !j["rid"].is_string()) {
            ++bad_;
            ++dropped;
            continue;
        }
        const std::string op = j.value("op", "");
        const std::string rid = j["rid"].get<std::string>();
        const uint64_t seq = j.value("seq", uint64_t{0});
        seq_ = std::max(seq_, seq);
        if (op == "arm") {
            if (!j.contains("rel") || !j["rel"].is_boolean() || !j.contains("tag") ||
                !j["tag"].is_string()) {
                ++bad_;
                ++dropped;
                continue;
            }
            PulseArm a;
            a.rid = rid;
            a.tag = j["tag"].get<std::string>();
            a.rel = j["rel"].get<bool>();
            a.dueMono = j.value("dueMono", int64_t{0});
            a.dueWallMs = parseIsoUtc(j.value("dueWall", ""));
            a.src = j.value("src", "");
            a.by = j.value("by", "");
            a.seq = seq;
            armed_.erase(std::remove_if(armed_.begin(), armed_.end(),
                                        [&](const PulseArm& x) { return x.rid == rid; }),
                         armed_.end());
            armed_.push_back(std::move(a));
        } else if (op == "done") {
            ++dropped;
            const auto before = armed_.size();
            armed_.erase(std::remove_if(armed_.begin(), armed_.end(),
                                        [&](const PulseArm& x) { return x.rid == rid; }),
                         armed_.end());
            dropped += before - armed_.size();
        } else {
            ++bad_;
            ++dropped;
        }
    }
    std::sort(armed_.begin(), armed_.end(),
              [](const PulseArm& a, const PulseArm& b) { return a.seq < b.seq; });
    if (dropped > 0) {
        std::string err;
        if (!compactLocked(err) && error) *error = err;
    }
    return armed_;
}

bool PulseJournal::openLocked(std::string& error) {
    if (fd_ >= 0) return true;
    fd_ = ::open(path_.c_str(), O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0600);
    if (fd_ < 0) {
        error = errnoText("open pulse.journal");
        return false;
    }
    ::fchmod(fd_, 0600);
    return true;
}

bool PulseJournal::appendLocked(const std::string& line, std::string& error) {
    if (!openLocked(error)) return false;
    if (!writeAll(fd_, line)) {
        error = errnoText("write pulse.journal");
        ::close(fd_);
        fd_ = -1;
        return false;
    }
    if (::fdatasync(fd_) != 0) {
        error = errnoText("fdatasync pulse.journal");
        ::close(fd_);
        fd_ = -1;
        return false;
    }
    ++lines_;
    return true;
}

bool PulseJournal::arm(PulseArm entry, std::string& error) {
    std::lock_guard<std::mutex> g(mu_);
    entry.seq = seq_ + 1;
    if (!appendLocked(armLine(entry), error)) return false;
    seq_ = entry.seq;
    armed_.push_back(std::move(entry));
    return true;
}

bool PulseJournal::done(const std::string& rid, std::string& error) {
    std::lock_guard<std::mutex> g(mu_);
    if (!appendLocked(doneLine(rid, seq_ + 1), error)) return false;
    ++seq_;
    armed_.erase(std::remove_if(armed_.begin(), armed_.end(),
                                [&](const PulseArm& x) { return x.rid == rid; }),
                 armed_.end());
    if (lines_ > kCompactLines) {
        std::string err;
        compactLocked(err);  // a failed compaction leaves a longer, still valid file
    }
    return true;
}

bool PulseJournal::compact(std::string& error) {
    std::lock_guard<std::mutex> g(mu_);
    return compactLocked(error);
}

// Temporary file, fsync, rename over the journal, fsync of the directory: a power cut leaves
// either the old file or the new one, both complete.
bool PulseJournal::compactLocked(std::string& error) {
    const std::string tmp = path_ + ".tmp";
    const int fd = ::open(tmp.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    if (fd < 0) {
        error = errnoText("open pulse.journal.tmp");
        return false;
    }
    std::string text;
    for (const PulseArm& a : armed_) text += armLine(a);
    if (!writeAll(fd, text) || ::fsync(fd) != 0) {
        error = errnoText("write pulse.journal.tmp");
        ::close(fd);
        ::unlink(tmp.c_str());
        return false;
    }
    ::close(fd);
    if (::rename(tmp.c_str(), path_.c_str()) != 0) {
        error = errnoText("rename pulse.journal");
        ::unlink(tmp.c_str());
        return false;
    }
    const int dfd = ::open(dirOf(path_).c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dfd >= 0) {
        ::fsync(dfd);
        ::close(dfd);
    }
    if (fd_ >= 0) {  // the old descriptor points at the replaced file
        ::close(fd_);
        fd_ = -1;
    }
    lines_ = armed_.size();  // badLines() keeps telling what the last load() skipped
    return true;
}

std::vector<PulseArm> PulseJournal::armed() const {
    std::lock_guard<std::mutex> g(mu_);
    return armed_;
}

size_t PulseJournal::lines() const {
    std::lock_guard<std::mutex> g(mu_);
    return lines_;
}

size_t PulseJournal::badLines() const {
    std::lock_guard<std::mutex> g(mu_);
    return bad_;
}

}  // namespace mat
