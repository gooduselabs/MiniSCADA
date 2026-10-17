#include "server/write_subsystem.hpp"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <cstdio>
#include <cstring>

#include "core/common/json_text.hpp"
#include "nlohmann/json.hpp"

namespace mat {

namespace {
constexpr int64_t kMaintainEveryMs = 10 * 60 * 1000;

// "all", or a request id as the runtime makes them (a UUID; at most 64 letters, digits, '-', '_').
bool validAckTarget(const std::string& t) {
    if (t == "all") return true;
    if (t.empty() || t.size() > 64) return false;
    for (const char c : t)
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
              c == '-' || c == '_'))
            return false;
    return true;
}
}  // namespace

bool applyPulseAckRequest(const std::string& path, uid_t uid, AuditLog& audit,
                          const std::function<std::vector<PulseArm>(
                              const std::string& rid, std::vector<std::string>& errors)>& close,
                          const std::function<void(const std::string&)>& log) {
    if (path.empty()) return false;
    // opened without following a link; what it is is asked of the descriptor (no race with lstat)
    const int fd = ::open(path.c_str(), O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) {
        if (errno != ENOENT) {
            ::unlink(path.c_str());  // a link (ELOOP) or anything else: removed, never followed
            log("pulse ack: " + path + " không mở được (" + std::strerror(errno) +
                "): đã xóa, bỏ qua");
        }
        return false;
    }
    struct stat st {};
    std::string text;
    const bool ok =
        ::fstat(fd, &st) == 0 && S_ISREG(st.st_mode) && st.st_uid == uid && (st.st_mode & 077) == 0;
    if (ok) {
        char buf[256];
        const ssize_t n = ::read(fd, buf, sizeof buf);
        if (n > 0) text.assign(buf, static_cast<size_t>(n));
    }
    ::close(fd);
    if (!ok) {
        ::unlink(path.c_str());
        log("pulse ack: " + path + " không phải tệp thường của root, quyền 0600: đã xóa, bỏ qua");
        return false;
    }
    // "pulse-ack <rid|all> <time>"
    std::string word, target;
    {
        const std::string line = text.substr(0, text.find('\n'));
        const size_t a = line.find(' ');
        word = line.substr(0, a);
        if (a != std::string::npos) {
            const size_t b = line.find(' ', a + 1);
            target = line.substr(a + 1, b == std::string::npos ? std::string::npos : b - a - 1);
        }
    }
    if (word != "pulse-ack" || !validAckTarget(target)) {
        ::unlink(path.c_str());
        log("pulse ack: " + path + " không đọc được: đã xóa, bỏ qua");
        return false;
    }
    AuditEvent e(AuditAction::PulseAck, AuditResult::Started, AuditChannel::System, "system");
    e.user = "system";
    e.target = target;
    e.detail = jsonText(nlohmann::json{{"source", "cli"}});
    try {  // durably before anything changes; without it the request stays, tried again
        audit.append(e);
    } catch (const std::exception& ex) {
        log(std::string("pulse ack: audit pulse.ack không ghi được (") + ex.what() +
            "): chưa đóng mục nào, thử lại sau");
        return false;
    }
    std::vector<std::string> errors;
    const std::vector<PulseArm> closed = close(target, errors);
    nlohmann::json list = nlohmann::json::array();
    for (const PulseArm& a : closed) {
        if (list.size() >= 16) break;  // the row stays small; "closed" counts them all
        list.push_back({{"rid", a.rid}, {"tag", a.tag}});
    }
    e.result = errors.empty() ? AuditResult::Ok : AuditResult::Failed;
    nlohmann::json d = {{"source", "cli"}, {"closed", closed.size()}, {"entries", list}};
    if (!errors.empty()) {
        e.code = "PULSE_JOURNAL_FAILED";
        d["notClosed"] = errors.size();
    }
    e.detail = jsonText(d);
    try {
        audit.append(e);
    } catch (const std::exception& ex) {
        log(std::string("pulse ack: audit pulse.ack (kết quả) không ghi được: ") + ex.what());
    }
    ::unlink(path.c_str());
    log("pulse ack: root xác nhận " + target + ": đóng " + std::to_string(closed.size()) +
        " mục PULSE_STUCK của pulse.journal" +
        (errors.empty() ? "" : ", " + std::to_string(errors.size()) + " mục không ghi được done"));
    return true;
}

WriteSubsystem::WriteSubsystem(RuntimeEngine& runtime, TagStore& store, AuditLog& audit,
                               CoordinatorOptions options, PulseOptions pulse)
    : runtime_(runtime),
      audit_(audit),
      adapter_(audit),
      backend_(runtime),
      pulse_(std::move(pulse)) {
    // Feature 011 (FR-018): the journal of pulses, read before any command is taken.
    if (!pulse_.journalPath.empty()) {
        journal_ = std::make_unique<PulseJournal>(pulse_.journalPath);
        std::string error;
        armedAtStart_ = journal_->load(&error);
        if (!error.empty())
            std::fprintf(stderr, "pulse journal: cannot compact %s: %s\n",
                         pulse_.journalPath.c_str(), error.c_str());
        if (journal_->badLines() > 0)
            std::fprintf(stderr, "pulse journal: %zu unreadable line(s) skipped\n",
                         journal_->badLines());
        options.pulseLog = journal_.get();
    }
    if (pulse_.warnings != nullptr && !options.pulseStuck) {
        SystemWarnings* w = pulse_.warnings;
        const std::string mode = pulse_.recovery ? "on" : "off";
        options.pulseStuck = [w, mode](const std::vector<std::string>& tags) {
            if (tags.empty())
                w->clear("PULSE_STUCK");
            else
                w->set("PULSE_STUCK", {{"tags", tags}, {"pulseRecovery", mode}});
        };
    }
    coordinator_ = std::make_unique<WriteCoordinator>(*runtime.model(), store, backend_, adapter_,
                                                      std::move(options));
    // the results of the drivers and of the internal Tags come back through the engine's round
    if (runtime.engine()) {
        WriteCoordinator* c = coordinator_.get();
        runtime.engine()->setWriteResultHandler(
            [c](const drv::WriteResult& r) { c->onDriverResult(r); });
    }
}

WriteSubsystem::~WriteSubsystem() {
    if (runtime_.engine()) runtime_.engine()->setWriteResultHandler(nullptr);
}

bool WriteSubsystem::recover() {
    try {
        const size_t n = audit_.recoverTagWrites();
        if (n > 0)
            std::printf(
                "tag writes: %zu command(s) of the last run have no known result (interrupted)\n",
                n);
        recovered_ = true;
    } catch (const std::exception& e) {
        std::fprintf(stderr,
                     "tag writes: cannot recover the open commands: %s; every write is refused\n",
                     e.what());
        recovered_ = false;
    }
    return recovered_;
}

size_t WriteSubsystem::recoverPulses() {
    const size_t n = armedAtStart_.size();
    if (n == 0) return 0;
    std::printf("pulse journal: %zu pulse(s) of the last run were not released: %s\n", n,
                pulse_.recovery ? "the release values are written as the channels connect"
                                : "pulseRecovery is off, nothing is written (PULSE_STUCK)");
    coordinator_->recoverPulses(armedAtStart_, pulse_.recovery);
    armedAtStart_.clear();
    return n;
}

WriteCoordinator::QuiesceReport WriteSubsystem::beforeRestart() {
    const WriteCoordinator::QuiesceReport rep =
        coordinator_->quiesce();  // 1. no new command, the ones in flight end
    runtime_.stop();              // 2. retained values, 3. drivers
    return rep;
}

bool WriteSubsystem::applyPulseAck() {
    WriteCoordinator* c = coordinator_.get();
    return applyPulseAckRequest(
        pulse_.ackRequestPath, pulse_.ackUid, audit_,
        [c](const std::string& rid, std::vector<std::string>& errors) {
            return c->ackStuck(rid, &errors);
        },
        [](const std::string& line) { std::fprintf(stderr, "%s\n", line.c_str()); });
}

void WriteSubsystem::maintain(int64_t monoMs) {
    if (!pulse_.ackRequestPath.empty() && monoMs >= nextAckPollMs_) {  // --pulse-ack (root)
        nextAckPollMs_ = monoMs + kPulseAckPollMs;
        applyPulseAck();
    }
    if (monoMs < nextMaintainMs_) return;
    nextMaintainMs_ = monoMs + kMaintainEveryMs;
    try {
        audit_.pruneTagWrites();
    } catch (const std::exception&) {
    }
}

}  // namespace mat
