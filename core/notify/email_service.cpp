#include "core/notify/email_service.hpp"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <ctime>

#include "core/crypto/hex.hpp"
#include "core/crypto/random.hpp"

namespace mat::notify {

namespace {

int64_t sysMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}
int64_t steadyMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}
int localOffsetMin(int64_t epochMs) {
    const time_t t = static_cast<time_t>(epochMs / 1000);
    tm v{};
    ::localtime_r(&t, &v);
    return static_cast<int>(v.tm_gmtoff / 60);
}

}  // namespace

EmailService::EmailService(EmailServiceOptions opt) : opt_(std::move(opt)) {
    if (!opt_.epochMs) opt_.epochMs = sysMs;
    if (!opt_.monoMs) opt_.monoMs = steadyMs;
    if (!opt_.tzOffsetMin) opt_.tzOffsetMin = localOffsetMin;
    if (!opt_.send) opt_.send = smtpSend;
    if (opt_.backoffS.empty()) opt_.backoffS = {30};
}

EmailService::~EmailService() { stop(); }

int EmailService::tz(int64_t epoch) const { return opt_.tzOffsetMin(epoch); }

int EmailService::minuteOfDay(int64_t epoch) const {
    int64_t m = (epoch / 60000 + tz(epoch)) % 1440;
    if (m < 0) m += 1440;
    return static_cast<int>(m);
}

bool EmailService::start(std::string& err, bool thread) {
    EmailConfig cfg;
    std::string cerr;
    if (!readEmailConfigFile(opt_.dir + "/email.json", cfg, cerr)) {
        cfg = EmailConfig{};
        cfg.enabled = false;
        std::lock_guard<std::mutex> l(mu_);
        cfgError_ = cerr;
        err = cerr;
    }
    std::string oerr;
    if (!ensurePrivateDir(opt_.dir)) {
        err = "không tạo được thư mục " + opt_.dir;
        return false;
    }
    if (!outbox_.open(opt_.dir + "/outbox", opt_.outboxMax, opt_.outboxBytes, oerr)) {
        err = oerr;
        return false;
    }
    rules_.configure(cfg);
    {
        std::lock_guard<std::mutex> l(mu_);
        cfg_ = cfg;
        queueCount_ = outbox_.count();
        queueBytes_ = outbox_.bytes();
        started_ = true;
    }
    auditDropped();
    if (thread) thread_ = std::thread([this] { loop(); });
    return true;
}

void EmailService::stop() {
    {
        std::lock_guard<std::mutex> l(mu_);
        stop_ = true;
    }
    cv_.notify_all();
    if (thread_.joinable()) thread_.join();
}

void EmailService::push(std::vector<AlarmNotice> notices) {
    if (notices.empty()) return;
    {
        std::lock_guard<std::mutex> l(mu_);
        if (!cfg_.enabled) return;
        for (auto& n : notices) {
            if (inbox_.size() >= opt_.inboxMax) {
                ++inboxDropped_;
                continue;
            }
            inbox_.push_back(std::move(n));
        }
    }
    cv_.notify_all();
}

void EmailService::loop() {
    for (;;) {
        {
            std::unique_lock<std::mutex> l(mu_);
            int64_t wait = 1000;
            const int64_t due = rules_.nextDueInMs(opt_.monoMs());
            if (due >= 0) wait = std::clamp<int64_t>(due, 50, 1000);
            if (queueCount_ && nextAttemptMono_ > 0)
                wait = std::min<int64_t>(wait,
                                         std::max<int64_t>(50, nextAttemptMono_ - opt_.monoMs()));
            cv_.wait_for(l, std::chrono::milliseconds(wait),
                         [&] { return stop_ || !inbox_.empty() || cfgChanged_; });
            if (stop_) return;
        }
        cycle();
    }
}

void EmailService::cycle() {
    std::vector<AlarmNotice> notices;
    EmailConfig cfg;
    bool changed = false;
    {
        std::lock_guard<std::mutex> l(mu_);
        notices.swap(inbox_);
        cfg = cfg_;
        changed = cfgChanged_;
        cfgChanged_ = false;
    }
    if (changed) {
        rules_.configure(cfg);
        nextAttemptMono_ = 0;  // a new configuration is tried at once
        failures_ = 0;
    }
    const int64_t mono = opt_.monoMs();
    const int64_t epoch = opt_.epochMs();
    const int minute = minuteOfDay(epoch);
    for (const auto& n : notices) rules_.onNotice(n, mono, minute);
    const auto digests = rules_.poll(mono, minute, opt_.groupEmails);
    for (const auto& d : digests) queueDigest(d, cfg, epoch);
    if (cfg.enabled) sendDue(mono, epoch);
    std::lock_guard<std::mutex> l(mu_);
    queueCount_ = outbox_.count();
    queueBytes_ = outbox_.bytes();
    pendingEvents_ = rules_.pending();
    reminders_ = rules_.reminders();
    ruleStats_ = rules_.stats();
    nextAttemptInMs_ = nextAttemptMono_ > mono ? nextAttemptMono_ - mono : 0;
}

void EmailService::queueDigest(const EmailDigest& d, const EmailConfig& cfg, int64_t epoch) {
    EmailContent c;
    c.siteName = cfg.siteName;
    c.baseUrl = cfg.baseUrl;
    c.items = d.items;
    c.more = d.more;
    c.suppressed = d.suppressed;
    c.tzOffsetMin = tz(epoch);
    const RenderedEmail body = renderAlarmEmail(c);
    MimeEnvelope env;
    env.from = cfg.smtp.from;
    env.fromName = cfg.smtp.fromName;
    env.to = d.to;
    env.dateEpochMs = epoch;
    env.tzOffsetMin = c.tzOffsetMin;
    const std::string rnd = toHex(randomBytes(8));
    env.messageId = std::to_string(epoch) + "." + rnd + "@mat-scada";
    env.boundary = "=_mat_" + rnd;
    OutboxEntry e;
    e.kind = "alarm";
    e.from = cfg.smtp.from;
    e.to = d.to;
    e.data = buildMime(env, body);
    e.createdEpochMs = epoch;
    e.items = static_cast<int>(d.items.size() + d.more);
    std::string err;
    if (!outbox_.add(e, err)) {
        EmailAuditRecord r;
        r.action = "email.dropped";
        r.ok = false;
        r.code = "OUTBOX_IO";
        r.detail = {{"recipients", d.to.size()}, {"events", e.items}, {"error", err}};
        std::lock_guard<std::mutex> l(mu_);
        ++dropped_;
        if (opt_.audit) opt_.audit(r);
    }
    auditDropped();
}

void EmailService::auditDropped() {
    for (const auto& d : outbox_.takeDropped()) {
        EmailAuditRecord r;
        r.action = "email.dropped";
        r.ok = false;
        r.target = d.id;
        r.code = d.reason == "full" ? "OUTBOX_FULL" : "OUTBOX_DAMAGED";
        r.detail = {{"recipients", d.recipients}};
        {
            std::lock_guard<std::mutex> l(mu_);
            ++dropped_;
        }
        if (opt_.audit) opt_.audit(r);
    }
}

SmtpOptions EmailService::options(const EmailConfig& cfg, const std::string& password) const {
    SmtpOptions o = smtpOptionsOf(cfg.smtp, password);
    o.caPem = opt_.caPem;
    return o;
}

void EmailService::sendDue(int64_t mono, int64_t epoch) {
    if (outbox_.count() == 0 || (nextAttemptMono_ > 0 && mono < nextAttemptMono_)) return;
    EmailConfig cfg;
    {
        std::lock_guard<std::mutex> l(mu_);
        cfg = cfg_;
    }
    std::string password;
    if (!cfg.smtp.username.empty() && opt_.password)
        if (auto p = opt_.password()) password = *p;
    std::lock_guard<std::mutex> send(sendMu_);
    for (const std::string& id : outbox_.ids()) {
        auto e = outbox_.load(id);
        if (!e) {
            outbox_.remove(id);
            continue;
        }
        if (epoch - e->createdEpochMs > opt_.expireMs) {
            outbox_.remove(id);
            EmailAuditRecord r;
            r.action = "email.dropped";
            r.ok = false;
            r.target = id;
            r.code = "EXPIRED";
            r.detail = {{"recipients", e->to.size()}, {"events", e->items}};
            {
                std::lock_guard<std::mutex> l(mu_);
                ++dropped_;
            }
            if (opt_.audit) opt_.audit(r);
            continue;
        }
        const SmtpResult res =
            opt_.send(options(cfg, password), e->from.empty() ? cfg.smtp.from : e->from, e->to,
                      smtpData(e->data));
        EmailAuditRecord r;
        r.target = id;
        r.detail = {{"recipients", e->to.size()}, {"events", e->items}, {"kind", e->kind}};
        if (res.ok) {
            outbox_.remove(id);
            r.action = "email.sent";
            r.ok = true;
            if (!res.rejected.empty()) r.detail["rejected"] = res.rejected.size();
            {
                std::lock_guard<std::mutex> l(mu_);
                ++sent_;
                lastOkEpoch_ = epoch;
                failures_ = 0;
                nextAttemptMono_ = 0;
            }
            if (opt_.audit) opt_.audit(r);
            continue;
        }
        r.action = "email.failed";
        r.ok = false;
        r.code = res.error;
        r.detail["stage"] = res.stage;
        r.detail["smtpCode"] = res.code;
        r.detail["permanent"] = res.permanent;
        {
            std::lock_guard<std::mutex> l(mu_);
            ++failed_;
            lastError_ = {{"at", epoch},
                          {"stage", res.stage},
                          {"error", res.error},
                          {"code", res.code},
                          {"message", res.message}};
        }
        if (res.permanent) {
            outbox_.remove(id);
            if (opt_.audit) opt_.audit(r);
            continue;
        }
        const size_t i = std::min<size_t>(static_cast<size_t>(failures_), opt_.backoffS.size() - 1);
        ++failures_;
        nextAttemptMono_ = mono + opt_.backoffS[i] * 1000LL;
        r.detail["retryInS"] = opt_.backoffS[i];
        if (opt_.audit) opt_.audit(r);
        break;  // the server is not usable now: the others wait too
    }
}

EmailConfig EmailService::config() const {
    std::lock_guard<std::mutex> l(mu_);
    return cfg_;
}

std::string EmailService::configError() const {
    std::lock_guard<std::mutex> l(mu_);
    return cfgError_;
}

SaveStatus EmailService::saveConfig(EmailConfig cfg, int64_t expectedRev, int64_t& newRev,
                                    std::string& err) {
    std::lock_guard<std::mutex> l(mu_);
    if (expectedRev != cfg_.rev) {
        newRev = cfg_.rev;
        return SaveStatus::Conflict;
    }
    cfg.rev = cfg_.rev + 1;
    if (!writeEmailConfigFile(opt_.dir + "/email.json", cfg, err)) return SaveStatus::IoError;
    cfg_ = cfg;
    cfgError_.clear();
    cfgChanged_ = true;
    newRev = cfg.rev;
    cv_.notify_all();
    return SaveStatus::Ok;
}

SmtpResult EmailService::sendTest(const std::string& to) {
    const EmailConfig cfg = config();
    std::string password;
    if (!cfg.smtp.username.empty() && opt_.password)
        if (auto p = opt_.password()) password = *p;
    if (!cfg.smtp.username.empty() && password.empty()) {
        SmtpResult r;
        r.stage = "auth";
        r.error = "NO_PASSWORD";
        r.message = "Chưa đặt mật khẩu SMTP trên thiết bị: sudo mat-runtime --set-secret smtp.";
        return r;
    }
    const int64_t epoch = opt_.epochMs();
    const RenderedEmail body = renderTestEmail(cfg.siteName, cfg.baseUrl, epoch, tz(epoch));
    MimeEnvelope env;
    env.from = cfg.smtp.from;
    env.fromName = cfg.smtp.fromName;
    env.to = {to};
    env.dateEpochMs = epoch;
    env.tzOffsetMin = tz(epoch);
    const std::string rnd = toHex(randomBytes(8));
    env.messageId = std::to_string(epoch) + "." + rnd + "@mat-scada";
    env.boundary = "=_mat_" + rnd;
    std::lock_guard<std::mutex> send(sendMu_);
    SmtpResult r =
        opt_.send(options(cfg, password), cfg.smtp.from, {to}, smtpData(buildMime(env, body)));
    std::fill(password.begin(), password.end(), '\0');
    std::lock_guard<std::mutex> l(mu_);
    if (r.ok)
        lastOkEpoch_ = epoch;
    else
        lastError_ = {{"at", epoch},
                      {"stage", r.stage},
                      {"error", r.error},
                      {"code", r.code},
                      {"message", r.message}};
    return r;
}

bool EmailService::passwordSet() const {
    if (!opt_.password) return false;
    auto p = opt_.password();
    const bool set = p && !p->empty();
    if (p) std::fill(p->begin(), p->end(), '\0');
    return set;
}

nlohmann::json EmailService::statusJson() const {
    std::lock_guard<std::mutex> l(mu_);
    return {
        {"enabled", cfg_.enabled},
        {"queue", {{"count", queueCount_}, {"bytes", queueBytes_}}},
        {"pendingEvents", pendingEvents_},
        {"reminders", reminders_},
        {"lastOkAt", lastOkEpoch_ ? nlohmann::json(lastOkEpoch_) : nlohmann::json(nullptr)},
        {"lastError", lastError_},
        {"nextAttemptInS", (nextAttemptInMs_ + 999) / 1000},
        {"sent", sent_},
        {"failed", failed_},
        {"dropped", dropped_ + inboxDropped_ + ruleStats_.overflow},
        {"quietSkipped", ruleStats_.quiet},
        {"noRecipient", ruleStats_.noRecipient},
        {"configError", cfgError_.empty() ? nlohmann::json(nullptr) : nlohmann::json(cfgError_)}};
}

}  // namespace mat::notify
