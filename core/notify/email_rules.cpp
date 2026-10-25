#include "core/notify/email_rules.hpp"

#include <algorithm>
#include <cctype>

namespace mat::notify {

namespace {

constexpr int64_t kHourMs = 3600000;

bool isActive(const std::string& s) { return s == "ACTIVE_UNACK" || s == "ACTIVE_ACK"; }
bool isUnacked(const std::string& s) { return s == "ACTIVE_UNACK" || s == "RTN_UNACK"; }

std::string lower(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

template <class C, class V>
bool has(const C& c, const V& v) {
    return std::find(c.begin(), c.end(), v) != c.end();
}

EmailItem itemOf(const AlarmNotice& n, EmailEvent ev) {
    EmailItem i;
    i.event = ev;
    i.tsEpochMs = n.tEpochMs;
    i.priority = n.priority;
    i.alarmId = n.instance;
    i.name = n.name;
    i.tag = n.tag;
    i.area = n.areaName.empty() ? (n.areaId.empty() ? "Chung" : n.areaId) : n.areaName;
    i.className = n.className.empty() ? n.classId : n.className;
    i.value = n.value;
    i.text = n.text;
    i.state = n.to;
    i.occurrence = n.occurrence;
    return i;
}

}  // namespace

void EmailRules::configure(const EmailConfig& cfg) {
    cfg_ = cfg;
    remind_.clear();
    if (!cfg_.enabled) {
        pending_.clear();
        windowStart_ = -1;
    }
}

bool EmailRules::matches(const EmailRule& r, const AlarmNotice& n) const {
    if (!r.enabled) return false;
    if (!r.priorities.empty() && !has(r.priorities, n.priority)) return false;
    if (!r.classes.empty() && !has(r.classes, n.classId)) return false;
    const std::string area = n.areaId.empty() ? "-" : n.areaId;
    if (!r.areas.empty() && !has(r.areas, area)) return false;
    return true;
}

void EmailRules::add(const AlarmNotice& n, EmailEvent ev,
                     const std::vector<const EmailRule*>& rules, int64_t nowMono, int minuteOfDay) {
    if (rules.empty()) return;
    if (cfg_.quiet.contains(minuteOfDay) && n.priority > cfg_.quiet.minPriority) {
        ++stats_.quiet;
        return;
    }
    Pending p;
    p.item = itemOf(n, ev);
    for (const EmailRule* r : rules) {
        for (const auto& a : r->to) p.to.insert(lower(a));
        for (const auto& g : r->groups) p.groups.insert(g);
    }
    if (pending_.size() >= kMaxPendingEvents) {
        pending_.pop_front();
        ++stats_.overflow;
        ++suppressedCarry_;
    }
    pending_.push_back(std::move(p));
    ++stats_.matched;
    if (windowStart_ < 0) windowStart_ = nowMono;
}

void EmailRules::onNotice(const AlarmNotice& n, int64_t nowMono, int minuteOfDay) {
    if (!cfg_.enabled) return;
    if (n.kind == AlarmNotice::Kind::Gone) {
        startupOcc_.erase(n.instance);
        for (auto it = remind_.begin(); it != remind_.end();)
            it = it->first.first == n.instance ? remind_.erase(it) : std::next(it);
        return;
    }
    const bool active = isActive(n.to) && !isActive(n.from);
    const bool ret = isActive(n.from) && !isActive(n.to);
    std::vector<const EmailRule*> onActive, onReturn;
    for (const EmailRule& r : cfg_.rules) {
        if (!matches(r, n)) continue;
        if (r.onActive) onActive.push_back(&r);
        if (r.onReturn) onReturn.push_back(&r);
        if (r.onReminder && active && isUnacked(n.to)) {
            Remind& m = remind_[{n.instance, r.id}];
            m.occurrence = n.occurrence;
            m.sinceMono = nowMono;
            m.sent = 0;
            m.notice = n;
        }
    }
    // Acknowledged (or back to NORMAL): no more reminders for the instance.
    if (!isUnacked(n.to)) {
        for (auto it = remind_.begin(); it != remind_.end();)
            it = it->first.first == n.instance ? remind_.erase(it) : std::next(it);
    } else {
        for (auto& [k, m] : remind_)
            if (k.first == n.instance) {
                m.notice.to = n.to;
                m.notice.value = n.value;
            }
    }
    // A state found at start (startup) is not told: it was told before the restart, or it is the
    // noise of the start itself (a device not connected yet). Its return is not told either.
    if (n.startup) {
        if (active) startupOcc_[n.instance] = n.occurrence;
        return;
    }
    if (ret) {
        const auto s = startupOcc_.find(n.instance);
        if (s != startupOcc_.end() && s->second == n.occurrence) {
            startupOcc_.erase(s);
            return;
        }
    }
    if (active) {
        startupOcc_.erase(n.instance);
        add(n, EmailEvent::Active, onActive, nowMono, minuteOfDay);
    }
    if (ret) add(n, EmailEvent::Return, onReturn, nowMono, minuteOfDay);
}

int64_t EmailRules::nextDueInMs(int64_t nowMono) const {
    int64_t best = -1;
    auto take = [&](int64_t at) {
        const int64_t d = std::max<int64_t>(0, at - nowMono);
        best = best < 0 ? d : std::min(best, d);
    };
    if (!pending_.empty()) take(windowStart_ + cfg_.batchSeconds * 1000LL);
    for (const auto& [k, m] : remind_) {
        const EmailRule* r = nullptr;
        for (const auto& x : cfg_.rules)
            if (x.id == k.second) r = &x;
        if (r) take(m.sinceMono + (m.sent + 1) * r->reminderMin * 60000LL);
    }
    return best;
}

std::vector<EmailDigest> EmailRules::poll(int64_t nowMono, int minuteOfDay,
                                          const GroupLookup& groups) {
    std::vector<EmailDigest> out;
    if (!cfg_.enabled) return out;

    // Reminders that are due join the pending list (and so the batch).
    for (auto it = remind_.begin(); it != remind_.end();) {
        const EmailRule* r = nullptr;
        for (const auto& x : cfg_.rules)
            if (x.id == it->first.second) r = &x;
        Remind& m = it->second;
        if (!r || !r->enabled || !r->onReminder) {
            it = remind_.erase(it);
            continue;
        }
        if (nowMono >= m.sinceMono + (m.sent + 1) * r->reminderMin * 60000LL) {
            ++m.sent;
            AlarmNotice n = m.notice;
            add(n, EmailEvent::Reminder, {r}, nowMono, minuteOfDay);
            if (m.sent >= cfg_.reminderMax) {
                it = remind_.erase(it);
                continue;
            }
        }
        ++it;
    }

    if (pending_.empty()) {
        windowStart_ = -1;
        return out;
    }
    if (nowMono - windowStart_ < cfg_.batchSeconds * 1000LL) return out;
    while (!sentMono_.empty() && nowMono - sentMono_.front() >= kHourMs) sentMono_.pop_front();
    const int slots = cfg_.maxPerHour - static_cast<int>(sentMono_.size());
    if (slots <= 0) return out;  // held: the next free slot sends everything gathered

    std::map<std::string, std::vector<std::string>> groupCache;
    for (Pending& p : pending_) {
        if (p.resolved) continue;
        p.remaining = p.to;
        for (const auto& g : p.groups) {
            auto it = groupCache.find(g);
            if (it == groupCache.end())
                it = groupCache.emplace(g, groups ? groups(g) : std::vector<std::string>{}).first;
            for (const auto& a : it->second) p.remaining.insert(lower(a));
        }
        p.resolved = true;
        if (p.remaining.empty()) ++stats_.noRecipient;
    }
    // address -> indexes of its events; then addresses with the same events share one email.
    std::map<std::string, std::vector<size_t>> byAddr;
    for (size_t i = 0; i < pending_.size(); ++i) {
        if (pending_[i].remaining.empty()) continue;
        for (const auto& a : pending_[i].remaining) byAddr[a].push_back(i);
    }
    std::map<std::vector<size_t>, std::vector<std::string>> groupsOfEvents;
    for (auto& [a, idx] : byAddr) groupsOfEvents[idx].push_back(a);

    int used = 0;
    for (auto& [idx, addrs] : groupsOfEvents) {
        if (used >= slots) break;
        EmailDigest d;
        d.to = addrs;
        std::vector<EmailItem> items;
        for (size_t i : idx) items.push_back(pending_[i].item);
        std::stable_sort(items.begin(), items.end(), [](const EmailItem& a, const EmailItem& b) {
            return a.priority != b.priority ? a.priority < b.priority : a.tsEpochMs < b.tsEpochMs;
        });
        if (items.size() > kMaxListedEvents) {
            d.more = items.size() - kMaxListedEvents;
            items.resize(kMaxListedEvents);
        }
        d.items = std::move(items);
        if (out.empty()) {
            d.suppressed = suppressedCarry_;
            suppressedCarry_ = 0;
        }
        for (size_t i : idx)
            for (const auto& a : addrs) pending_[i].remaining.erase(a);
        out.push_back(std::move(d));
        sentMono_.push_back(nowMono);
        ++stats_.digests;
        ++used;
    }
    std::deque<Pending> keep;
    for (Pending& p : pending_)
        if (!p.remaining.empty()) keep.push_back(std::move(p));
    pending_ = std::move(keep);
    windowStart_ = pending_.empty() ? -1 : windowStart_;
    return out;
}

}  // namespace mat::notify
