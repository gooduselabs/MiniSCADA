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
    // NOLINTNEXTLINE(cert-err34-c): written by the runtime (pulse.journal, 0600) (SAST T055)
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
    json j = {{"v", 1},
              {"op", "arm"},
              {"rid", e.rid},
              {"tag", e.tag},
              {"rel", e.rel},
              {"dueMono", e.dueMono},
              {"dueWall", isoUtc(e.dueWallMs)},
              {"src", e.src},
              {"by", e.by},
              {"seq", e.seq}};
    if (e.hasTarget) {
        j["ch"] = e.channel;
        j["dev"] = e.device;
        j["addr"] = e.address;
        if (!e.targetHash.empty()) j["tgt"] = e.targetHash;
    }
    return j.dump() + "\n";
}

std::string PulseJournal::doneLine(const std::string& rid, uint64_t seq) {
    return json{{"v", 1}, {"op", "done"}, {"rid", rid}, {"seq", seq}}.dump() + "\n";
}

PulseJournal::PulseJournal(std::string path) : path_(std::move(path)) {}

PulseJournal::~PulseJournal() {
    if (fd_ >= 0) ::close(fd_);
}

namespace {

// One line of the journal read strictly: every field has its type, or the line is unreadable (a
// value of another type never throws, T062).
enum class LineKind { Bad, Arm, Done };

bool optString(const json& j, const char* key, std::string& out) {
    const auto it = j.find(key);
    if (it == j.end()) return true;
    if (!it->is_string()) return false;
    out = it->get<std::string>();
    return true;
}

LineKind readLine(const std::string& line, PulseArm& a, std::string& rid, uint64_t& seq) {
    const json j = json::parse(line, nullptr, false);
    if (j.is_discarded() || !j.is_object()) return LineKind::Bad;
    const auto v = j.find("v");
    if (v == j.end() || !v->is_number_integer() || v->get<int64_t>() != 1) return LineKind::Bad;
    const auto r = j.find("rid");
    if (r == j.end() || !r->is_string()) return LineKind::Bad;
    rid = r->get<std::string>();
    seq = 0;
    if (const auto s = j.find("seq"); s != j.end()) {
        if (!s->is_number_unsigned()) return LineKind::Bad;  // a negative or fractional seq too
        seq = s->get<uint64_t>();
        if (seq > kPulseMaxSeq) return LineKind::Bad;  // T202: seq + 1 would wrap to 0
    }
    const auto op = j.find("op");
    if (op == j.end() || !op->is_string()) return LineKind::Bad;
    if (*op == "done") return LineKind::Done;
    if (*op != "arm") return LineKind::Bad;
    const auto rel = j.find("rel");
    const auto tag = j.find("tag");
    if (rel == j.end() || !rel->is_boolean() || tag == j.end() || !tag->is_string())
        return LineKind::Bad;
    a.rid = rid;
    a.tag = tag->get<std::string>();
    a.rel = rel->get<bool>();
    a.seq = seq;
    if (const auto d = j.find("dueMono"); d != j.end()) {
        if (!d->is_number_integer()) return LineKind::Bad;
        a.dueMono = d->get<int64_t>();
    }
    std::string dueWall;
    if (!optString(j, "dueWall", dueWall) || !optString(j, "src", a.src) ||
        !optString(j, "by", a.by))
        return LineKind::Bad;
    a.dueWallMs = parseIsoUtc(dueWall);
    // the target of the bit when it was turned on (T062); absent from the lines written before
    const bool hasCh = j.contains("ch"), hasDev = j.contains("dev"), hasAddr = j.contains("addr");
    if (hasCh || hasDev || hasAddr) {
        if (!(hasCh && hasDev && hasAddr) || !optString(j, "ch", a.channel) ||
            !optString(j, "dev", a.device) || !optString(j, "addr", a.address))
            return LineKind::Bad;
        a.hasTarget = true;
        if (!optString(j, "tgt", a.targetHash)) return LineKind::Bad;  // T202 (N-L2)
    } else if (j.contains("tgt")) {
        return LineKind::Bad;
    }
    return LineKind::Arm;
}

}  // namespace

PulseJournal::Parsed PulseJournal::parse(std::istream& in) {
    Parsed r;
    for (std::string line; std::getline(in, line);) {
        if (line.empty()) continue;
        ++r.lines;
        PulseArm a;
        std::string rid;
        uint64_t seq = 0;
        LineKind kind = LineKind::Bad;
        try {
            kind = readLine(line, a, rid, seq);
        } catch (const std::exception&) {  // never std::terminate at start (T062)
            kind = LineKind::Bad;
        }
        if (kind == LineKind::Bad) {
            ++r.bad;
            ++r.dropped;
            continue;
        }
        r.maxSeq = std::max(r.maxSeq, seq);
        const auto before = r.armed.size();
        r.armed.erase(std::remove_if(r.armed.begin(), r.armed.end(),
                                     [&](const PulseArm& x) { return x.rid == rid; }),
                      r.armed.end());
        if (kind == LineKind::Arm) {
            r.armed.push_back(std::move(a));
        } else {
            ++r.dropped;
            r.dropped += before - r.armed.size();
        }
    }
    std::sort(r.armed.begin(), r.armed.end(),
              [](const PulseArm& a, const PulseArm& b) { return a.seq < b.seq; });
    return r;
}

std::vector<PulseArm> PulseJournal::load(std::string* error) {
    std::lock_guard<std::mutex> g(mu_);
    std::ifstream in(path_, std::ios::binary);
    Parsed r = parse(in);
    armed_ = std::move(r.armed);
    lines_ = r.lines;
    bad_ = r.bad;
    seq_ = std::max(seq_, r.maxSeq);
    if (r.dropped > 0) {  // lines a compaction removes (done, closed arms, bad ones)
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
    if (seq_ >= kPulseMaxSeq) {  // never on a real device (2^63 lines); a line read back is valid
        error = "pulse.journal: seq exhausted";
        return false;
    }
    entry.seq = seq_ + 1;
    if (!appendLocked(armLine(entry), error)) return false;
    seq_ = entry.seq;
    armed_.push_back(std::move(entry));
    return true;
}

bool PulseJournal::done(const std::string& rid, std::string& error) {
    std::lock_guard<std::mutex> g(mu_);
    if (seq_ >= kPulseMaxSeq) {
        error = "pulse.journal: seq exhausted";
        return false;
    }
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
