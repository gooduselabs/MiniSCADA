// Which alarm events become which emails (specs/023-alarm-email FR-004..FR-007): rule matching,
// the batch window, reminders of unacknowledged alarms, quiet hours and the hourly limit. Pure:
// the caller gives the clocks and the group lookup; no thread, no I/O.
#pragma once
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "core/notify/email_config.hpp"
#include "core/notify/email_message.hpp"

namespace mat::notify {

constexpr size_t kMaxPendingEvents = 1000;
constexpr size_t kMaxListedEvents = 50;

// One alarm event as the alarm glue hands it over (tick thread), engine independent.
struct AlarmNotice {
    enum class Kind { State, Gone };  // Gone: removed, disabled or shelved: no more reminders
    Kind kind = Kind::State;
    int64_t tEpochMs = 0;
    std::string instance;
    int64_t occurrence = 0;
    std::string from, to;  // state names (NORMAL, ACTIVE_UNACK, ACTIVE_ACK, RTN_UNACK)
    bool startup = false;  // restored at start: never sent again
    int priority = 3;
    std::string classId, className, areaId, areaName;  // areaId "" = Chung
    std::string name, tag, text;
    std::optional<double> value;
};

// One email to build: its recipients and its events.
struct EmailDigest {
    std::vector<std::string> to;   // sorted, lowercase, unique
    std::vector<EmailItem> items;  // at most kMaxListedEvents, by priority then time
    size_t more = 0;
    size_t suppressed = 0;
};

struct EmailRuleStats {
    uint64_t matched = 0;      // events taken into the pending list
    uint64_t quiet = 0;        // dropped by quiet hours
    uint64_t overflow = 0;     // dropped: pending list full
    uint64_t noRecipient = 0;  // matched rules gave no address (empty group, no email)
    uint64_t digests = 0;      // emails produced
};

class EmailRules {
   public:
    using GroupLookup = std::function<std::vector<std::string>(const std::string& groupId)>;

    // A new configuration: pending events are kept with the recipients they already have;
    // reminders restart from the new rules.
    void configure(const EmailConfig& cfg);

    // `nowMono` steady ms, `minuteOfDay` device local time (quiet hours).
    void onNotice(const AlarmNotice& n, int64_t nowMono, int minuteOfDay);

    // The emails due now (batch window over, under the hourly limit). Group ids are resolved
    // here, once per call.
    std::vector<EmailDigest> poll(int64_t nowMono, int minuteOfDay, const GroupLookup& groups);

    // ms until poll may produce something (for the caller's wait); -1 = nothing pending.
    int64_t nextDueInMs(int64_t nowMono) const;
    size_t pending() const { return pending_.size(); }
    size_t reminders() const { return remind_.size(); }
    const EmailRuleStats& stats() const { return stats_; }

   private:
    struct Pending {
        EmailItem item;
        std::set<std::string> to, groups;  // from the matching rules
        bool resolved = false;
        std::set<std::string> remaining;  // addresses still to send to (after resolve)
    };
    struct Remind {
        int64_t occurrence = 0;
        int64_t sinceMono = 0;
        int sent = 0;
        AlarmNotice notice;  // for the text of the reminder
    };
    bool matches(const EmailRule& r, const AlarmNotice& n) const;
    void add(const AlarmNotice& n, EmailEvent ev, const std::vector<const EmailRule*>& rules,
             int64_t nowMono, int minuteOfDay);

    EmailConfig cfg_;
    std::deque<Pending> pending_;
    int64_t windowStart_ = -1;
    std::deque<int64_t> sentMono_;  // digests produced in the last hour
    // (instance, rule id) -> reminder state
    std::map<std::pair<std::string, std::string>, Remind> remind_;
    size_t suppressedCarry_ = 0;
    std::map<std::string, int64_t>
        startupOcc_;  // instance -> occurrence active at start (not told)
    EmailRuleStats stats_;
};

}  // namespace mat::notify
