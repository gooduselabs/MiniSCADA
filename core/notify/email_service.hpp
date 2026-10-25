// The alarm email service of the runtime (specs/023-alarm-email; ADR-051): one thread takes the
// alarm notices of the tick thread (short lock, never waits for the network), runs EmailRules,
// writes each email to the durable outbox and sends the outbox with backoff. The configuration is
// <dir>/email.json; the password comes from the device secrets through `password`. Audit, clocks
// and the group lookup are injected (no HTTP, no audit library here).
#pragma once
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "core/notify/email_config.hpp"
#include "core/notify/email_outbox.hpp"
#include "core/notify/email_rules.hpp"
#include "core/notify/smtp_client.hpp"
#include "nlohmann/json.hpp"

namespace mat::notify {

struct EmailAuditRecord {
    std::string action;  // email.sent, email.failed, email.dropped
    bool ok = true;
    std::string target;                                // outbox id
    std::string code;                                  // error word (failed, dropped)
    nlohmann::json detail = nlohmann::json::object();  // never addresses' passwords or bodies
};

using SendFn =
    std::function<SmtpResult(const SmtpOptions&, const std::string& from,
                             const std::vector<std::string>& to, const std::string& data)>;

struct EmailServiceOptions {
    std::string dir;                          // <dataDir>/notify (email.json, outbox/)
    std::function<int64_t()> epochMs;         // default: system clock
    std::function<int64_t()> monoMs;          // default: steady clock
    std::function<int(int64_t)> tzOffsetMin;  // minutes east of UTC at an epoch ms; default: TZ
    std::function<std::optional<std::string>()> password;  // the "smtp" secret; nullopt = none
    std::function<std::vector<std::string>(const std::string&)> groupEmails;
    std::function<void(const EmailAuditRecord&)> audit;
    SendFn send;        // default: smtpSend
    std::string caPem;  // tests: CA certificates as PEM
    size_t outboxMax = 100;
    int64_t outboxBytes = 4 << 20;
    int64_t expireMs = 24LL * 3600 * 1000;
    std::vector<int> backoffS{30, 60, 120, 300, 600, 900};
    size_t inboxMax = 2000;  // notices waiting for the thread
};

enum class SaveStatus { Ok, Conflict, Invalid, IoError };

class EmailService {
   public:
    explicit EmailService(EmailServiceOptions opt);
    ~EmailService();
    EmailService(const EmailService&) = delete;
    EmailService& operator=(const EmailService&) = delete;

    // Reads email.json and opens the outbox; `thread` false: the caller drives cycle() (tests).
    // A damaged email.json is reported in `err` and leaves email off (the file is not replaced).
    bool start(std::string& err, bool thread = true);
    void stop();

    // Tick thread: the notices of one alarm round. Drops (and counts) beyond inboxMax.
    void push(std::vector<AlarmNotice> notices);

    // One round of the thread: notices -> rules -> outbox -> send what is due.
    void cycle();

    EmailConfig config() const;
    // `expectedRev` must be the rev of the file now (else Conflict and `newRev` = the current).
    SaveStatus saveConfig(EmailConfig cfg, int64_t expectedRev, int64_t& newRev, std::string& err);
    // Sends a test email now (not queued) with the saved settings.
    SmtpResult sendTest(const std::string& to);
    bool passwordSet() const;
    nlohmann::json statusJson() const;
    std::string configError() const;

   private:
    void loop();
    void sendDue(int64_t mono, int64_t epoch);
    void queueDigest(const EmailDigest& d, const EmailConfig& cfg, int64_t epoch);
    void auditDropped();
    SmtpOptions options(const EmailConfig& cfg, const std::string& password) const;
    int tz(int64_t epoch) const;
    int minuteOfDay(int64_t epoch) const;

    EmailServiceOptions opt_;
    EmailRules rules_;
    EmailOutbox outbox_;
    std::thread thread_;
    mutable std::mutex mu_;  // cfg_, inbox_, status fields
    std::condition_variable cv_;
    std::mutex sendMu_;  // one SMTP session at a time
    EmailConfig cfg_;
    bool cfgChanged_ = false;
    std::string cfgError_;
    std::vector<AlarmNotice> inbox_;
    bool stop_ = false;
    bool started_ = false;
    uint64_t inboxDropped_ = 0;
    int failures_ = 0;
    int64_t nextAttemptMono_ = 0;
    int64_t lastOkEpoch_ = 0;
    nlohmann::json lastError_;  // null or {at, stage, error, code, message}
    uint64_t sent_ = 0, failed_ = 0, dropped_ = 0;
    size_t queueCount_ = 0;
    int64_t queueBytes_ = 0;
    size_t pendingEvents_ = 0, reminders_ = 0;
    EmailRuleStats ruleStats_;
    int64_t nextAttemptInMs_ = 0;
};

}  // namespace mat::notify
