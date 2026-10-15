#include "server/alarm_glue.hpp"

#include <sys/stat.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <future>

#include "core/alarm/alarm_text.hpp"
#include "core/common/json_text.hpp"

namespace mat {

using nlohmann::json;
using namespace mat::alarm;

namespace {

constexpr size_t kNone = static_cast<size_t>(-1);

double steadyMs() {
    return std::chrono::duration<double, std::milli>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

bool fileExists(const std::string& p) {
    struct stat st {};
    return ::stat(p.c_str(), &st) == 0;
}

const char* kindText(AlarmKind k) { return kindName(k); }

// The project as the compiler of the definitions wants it: the two files, the Tags with their
// unit, BOOL type and value table labels, the Tags read from each device.
ProjectView viewOf(const LoadedProject& p) {
    ProjectView v;
    v.alarms = p.alarms;
    v.classes = p.alarmClasses;
    if (p.tags.is_object() && p.tags.contains("tags") && p.tags["tags"].is_array()) {
        for (const json& t : p.tags["tags"]) {
            if (!t.is_object() || !t.contains("id") || !t["id"].is_string()) continue;
            const std::string id = t["id"];
            AlarmTagInfo info;
            info.unit = t.value("unit", "");
            info.isBool = t.value("type", "") == "BOOL";
            const std::string table = t.value("valueTable", "");
            if (!table.empty()) {
                auto it = p.valueTables.find(table);
                if (it != p.valueTables.end() && it->second.contains("entries") &&
                    it->second["entries"].is_array()) {
                    for (const json& e : it->second["entries"]) {
                        // single values only: a range has no one label
                        if (e.is_object() && e.contains("value") &&
                            e["value"].is_number_integer() && e.contains("text") &&
                            e["text"].is_string())
                            info.labels[std::to_string(e["value"].get<int64_t>())] =
                                e["text"].get<std::string>();
                    }
                }
            }
            v.tags[id] = std::move(info);
            if (t.contains("source") && t["source"].is_object() && t["source"].contains("device") &&
                t["source"]["device"].is_string())
                v.devices[t["source"]["device"].get<std::string>()].push_back(id);
        }
    }
    return v;
}

TagSample::Quality qualityOf(Quality q) {
    switch (q) {
        case Quality::GOOD:
            return TagSample::Quality::Good;
        case Quality::UNCERTAIN:
            return TagSample::Quality::Uncertain;
        default:
            return TagSample::Quality::Bad;
    }
}

double numberOf(const TagScalar& v) {
    if (const bool* b = std::get_if<bool>(&v)) return *b ? 1.0 : 0.0;
    if (const int64_t* i = std::get_if<int64_t>(&v)) return static_cast<double>(*i);
    if (const uint64_t* u = std::get_if<uint64_t>(&v)) return static_cast<double>(*u);
    if (const double* d = std::get_if<double>(&v)) return *d;
    return std::nan("");  // a text or no value: the engine holds the state (inputBad)
}

std::string trim(const std::string& s) {
    size_t a = 0, b = s.size();
    while (a < b && (s[a] == ' ' || s[a] == '\t')) ++a;
    while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t')) --b;
    return s.substr(a, b - a);
}

// 1..120 characters after trimming, no control character.
bool validReason(const std::string& trimmed) {
    if (trimmed.empty() || utf8Length(trimmed) > 120) return false;
    for (unsigned char c : trimmed)
        if (c < 0x20 || c == 0x7f) return false;
    return true;
}

std::string joined(const std::vector<std::string>& v) {
    std::string out;
    for (const auto& s : v) {
        if (!out.empty()) out += ',';
        out += s;
    }
    return out;
}

}  // namespace

struct AlarmGlue::Waiter {
    std::mutex mu;
    std::condition_variable cv;
    std::vector<CommandResult> results;
    size_t expected = 0;
};

AlarmGlue::AlarmGlue(AlarmGlueOptions opt) : opt_(std::move(opt)), engine_(opt_.engine) {
    if (!opt_.epochMs)
        opt_.epochMs = [] {
            return std::chrono::duration_cast<std::chrono::milliseconds>(
                       std::chrono::system_clock::now().time_since_epoch())
                .count();
        };
    if (!opt_.monoMs)
        opt_.monoMs = [] {
            return std::chrono::duration_cast<std::chrono::milliseconds>(
                       std::chrono::steady_clock::now().time_since_epoch())
                .count();
        };
    if (!opt_.clockOk) opt_.clockOk = [](int64_t) { return true; };
    dbDir_ = opt_.dataDir;
}

AlarmGlue::~AlarmGlue() { stop(); }

std::string AlarmGlue::dbPath() const {
    return dbDir_ + (dbDir_.empty() || dbDir_.back() == '/' ? "" : "/") + "alarm.db";
}

bool AlarmGlue::start(const LoadedProject* project, TagStore& store, std::string& err) {
    store_ = &store;
    CompileResult compiled;
    if (project && !project->alarms.is_null()) {
        compiled = compileAlarms(viewOf(*project));
        if (!compiled.ok()) {
            err = compiled.errors.front();
            return false;
        }
        defs_ = std::move(compiled.defs);
    }
    hasAlarms_ = !defs_.instances.empty();
    for (const InstanceDef& i : defs_.instances) byId_[i.id] = &i;
    for (const AreaDef& a : defs_.areas) areaName_[a.id] = a.name;

    reader_ = std::make_unique<AlarmHistoryReader>(dbPath(), opt_.history);

    // The log is opened for a project with alarms, and for any project when an alarm.db is there:
    // its open occurrences belong to a project that is gone and the reconcile closes them.
    const bool openLog = hasAlarms_ || fileExists(dbPath());
    if (openLog) {
        ServiceOptions so = opt_.service;
        so.dir = opt_.dataDir;
        so.nowEpochMs = opt_.epochMs;
        so.clockOk = opt_.clockOk;
        if (opt_.minFreeBytes > 0) so.minFreeBytes = opt_.minFreeBytes;
        so.audit = [this](const SystemAudit& a) {
            std::optional<AuditAction> act = parseAuditAction(a.action);
            if (!act || !opt_.audit) return;
            AuditEvent e(*act, AuditResult::Ok, AuditChannel::System, "system");
            e.target = a.target;
            if (!a.code.empty()) e.code = a.code;
            e.detail = a.detail;
            try {
                opt_.audit(e);  // a failure only costs this line (alarm-store §5)
            } catch (const std::exception&) {
            }
        };
        service_ = std::make_unique<AlarmService>(so);
        std::string e2;
        if (!service_->start(e2))
            std::fprintf(stderr, "alarm.db: %s (the engine runs in RAM)\n", e2.c_str());
    }

    const int64_t mono = opt_.monoMs(), epoch = opt_.epochMs();
    LoadContext ctx;
    if (service_)
        ctx = service_->loadContext(mono, epoch, opt_.clockOk(epoch), true);
    else {
        ctx.nowMonoMs = mono;
        ctx.nowEpochMs = epoch;
        ctx.clockOk = opt_.clockOk(epoch);
    }
    const LoadReport rep = engine_.load(defs_, ctx);
    if (service_) service_->applyLoadReport(rep);

    // Index of every watched Tag in the store.
    const auto& watched = engine_.watchedTags();
    tagIdx_.assign(watched.size(), kNone);
    for (size_t i = 0; i < watched.size(); ++i)
        if (auto k = store.indexOf(watched[i])) tagIdx_[i] = *k;
    samples_.resize(watched.size());
    tick();  // the first round: the state is rebuilt from the conditions now (FR-022)
    return true;
}

void AlarmGlue::stop() {
    if (stopped_.exchange(true)) return;
    if (service_) service_->stop();
}

void AlarmGlue::afterEvents(const std::vector<AlarmEvent>& events) {
    if (events.empty()) return;
    if (service_) service_->push(events);
    std::lock_guard<std::mutex> l(liveMu_);
    for (const AlarmEvent& e : events)
        if (!e.instance.empty() && e.kind != AlarmEvent::Kind::Command)
            changedIds_.insert(e.instance);
}

void AlarmGlue::tick() {
    if (stopped_) return;
    const double t0 = steadyMs();
    values_.clear();
    std::vector<size_t> idx;
    idx.reserve(tagIdx_.size());
    for (size_t k : tagIdx_)
        if (k != kNone) idx.push_back(k);
    if (store_ && !idx.empty()) store_->snapshot(idx, values_);  // ONE lock for the whole round
    size_t v = 0;
    for (size_t i = 0; i < tagIdx_.size(); ++i) {
        TagSample& s = samples_[i];
        if (tagIdx_[i] == kNone) {
            s.known = false;
            s.value = 0;
            s.quality = TagSample::Quality::Bad;
            s.reason = "NO_DATA";
            continue;
        }
        const TagValue& tv = values_[v++];
        s.known = tv.revision != 0;
        s.value = numberOf(tv.value);
        s.quality = qualityOf(tv.quality);
        s.reason = tv.quality == Quality::GOOD ? std::string_view() : std::string_view(tv.reason);
    }
    engine_.step(opt_.monoMs(), opt_.epochMs(), samples_.data(), samples_.size());
    eventBuf_.clear();
    engine_.takeEvents(eventBuf_);
    afterEvents(eventBuf_);
    const double ms = steadyMs() - t0;
    {
        std::lock_guard<std::mutex> l(evalMu_);
        const int64_t now = opt_.monoMs();
        evalRing_.emplace_back(now, ms);
        while (!evalRing_.empty() && now - evalRing_.front().first > 60000) evalRing_.pop_front();
    }
    ticked_ = true;
}

double AlarmGlue::evalMaxMs() const {
    std::lock_guard<std::mutex> l(evalMu_);
    double m = 0;
    for (const auto& e : evalRing_) m = std::max(m, e.second);
    return m;
}

// ---------------------------------------------------------------------------------------------
// JSON

json AlarmGlue::countsJson(const Counts& c) const {
    json by = json::object();
    for (int p = 1; p <= 4; ++p)
        by[priorityName(static_cast<Priority>(p))] = {{"active", c.activeByPriority[p - 1]},
                                                      {"unack", c.unackedByPriority[p - 1]}};
    return {{"active", c.active},   {"unack", c.unacked},     {"rtnUnack", c.rtnUnack},
            {"shelved", c.shelved}, {"disabled", c.disabled}, {"byPriority", by}};
}

json AlarmGlue::classesJson() const {
    json a = json::array();
    for (const ClassDef& c : defs_.classes)
        a.push_back({{"id", c.id},
                     {"name", c.name},
                     {"priority", priorityName(c.priority)},
                     {"color", c.color},
                     {"blink", c.blink},
                     {"requiresAck", c.requiresAck},
                     {"ackReturn", c.ackReturn},
                     {"sound", c.sound},
                     {"chatterLimit", c.chatterLimit}});
    return a;
}

json AlarmGlue::areasJson() const {
    json a = json::array();
    for (const AreaDef& d : defs_.areas) a.push_back({{"id", d.id}, {"name", d.name}});
    return a;
}

json AlarmGlue::itemJson(const AlarmItem& it) const {
    const auto def = byId_.find(it.id);
    const AlarmKind kind = def != byId_.end() ? def->second->kind : AlarmKind::Digital;
    json j = {{"id", it.id},
              {"alarmId", it.defId},
              {"name", it.name},
              {"type", kindText(kind)},
              {"occurrence", it.occurrence},
              {"rev", it.rev},
              {"state", stateName(it.state)},
              {"class", it.classId},
              {"priority", priorityName(static_cast<Priority>(std::clamp(it.priority, 1, 4)))},
              {"area", it.areaId.empty() ? json(nullptr) : json(it.areaId)},
              {"text", it.text},
              {"qualityActive", it.quality.empty() ? "GOOD" : it.quality},
              {"tsActive", it.tsActiveMs.value_or(0)},
              {"clockOk", it.clockOk},
              {"disabled", it.disabled},
              {"inputBad", it.inputBad},
              {"startup", it.startup}};
    if (!it.limit.empty()) j["limit"] = it.limit;
    if (it.value && std::isfinite(*it.value))
        j["valueActive"] = kind == AlarmKind::Digital ? json(*it.value != 0) : json(*it.value);
    else
        j["valueActive"] = nullptr;
    if (!it.reason.empty()) j["reason"] = it.reason;
    if (it.tsAckMs) j["tsAck"] = *it.tsAckMs;
    if (!it.ackUser.empty()) j["ackUser"] = it.ackUser;
    if (it.tsReturnMs) j["tsReturn"] = *it.tsReturnMs;
    if (it.repeat > 1) j["repeat"] = it.repeat;
    if (it.shelve)
        j["shelved"] = {{"until", it.shelve->untilEpochMs},
                        {"remainingMs", static_cast<int64_t>(it.shelve->remainingS) * 1000},
                        {"reason", it.shelve->reason},
                        {"user", it.shelve->user},
                        {"system", it.shelve->system}};
    return j;
}

AlarmView AlarmGlue::currentView() const {
    auto v = engine_.view();
    return v ? *v : AlarmView{};
}

json AlarmGlue::listJson() {
    auto v = engine_.view();
    json items = json::array();
    int64_t rev = 0;
    Counts counts;
    if (v) {
        for (const AlarmItem& it : v->items) items.push_back(itemJson(it));
        rev = v->revision;
        counts = v->counts;
    }
    return {{"ts", opt_.epochMs()},     {"revision", rev},      {"instances", items},
            {"classes", classesJson()}, {"areas", areasJson()}, {"counts", countsJson(counts)}};
}

AlarmLiveSnapshot AlarmGlue::snapshot() {
    AlarmLiveSnapshot s;
    s.ready = !hasAlarms_ || ticked_.load();
    auto v = engine_.view();
    Counts counts;
    if (v) {
        s.revision = v->revision;
        counts = v->counts;
        for (const AlarmItem& it : v->items) s.instances.push_back(itemJson(it).dump());
    }
    s.counts = countsJson(counts).dump();
    s.classes = classesJson().dump();
    s.areas = areasJson().dump();
    return s;
}

AlarmLiveBatch AlarmGlue::takeChanges() {
    AlarmLiveBatch b;
    std::set<std::string> ids;
    {
        std::lock_guard<std::mutex> l(liveMu_);
        ids.swap(changedIds_);
    }
    if (ids.empty()) return b;
    auto v = engine_.view();
    if (!v) return b;
    b.revision = v->revision;
    b.counts = countsJson(v->counts).dump();
    for (const std::string& id : ids) {
        const AlarmItem* it = v->find(id);
        b.changes.push_back({id, it ? itemJson(*it).dump() : std::string()});
    }
    return b;
}

// ---------------------------------------------------------------------------------------------
// Commands

AlarmApiResult AlarmGlue::auditDown() const {
    return {503,
            {{"error", "AUDIT_UNAVAILABLE"},
             {"message", "Thiết bị không ghi được nhật ký kiểm toán nên chưa thực hiện"}}};
}

AlarmApiResult AlarmGlue::notFound(const std::string& id) const {
    return {404,
            {{"error", "ALARM_NOT_FOUND"},
             {"message", "Không có alarm này trong project đang chạy"},
             {"id", id}}};
}

AlarmApiResult AlarmGlue::timeout() const {
    return {503,
            {{"error", "ALARM_TIMEOUT"},
             {"message", "Động cơ alarm chưa áp dụng kịp. Hãy tải lại danh sách rồi kiểm tra."}}};
}

bool AlarmGlue::writeAudit(AuditAction action, const AlarmActor& who, const std::string& target,
                           const json& detail) {
    if (!opt_.audit) return false;
    AuditEvent e(action, AuditResult::Ok, who.channel, who.source);
    e.user = who.user;
    e.role = who.role;
    e.target = target.substr(0, 120);
    e.detail = jsonText(detail);
    try {
        opt_.audit(e);
        return true;
    } catch (const std::exception&) {
        return false;
    }
}

bool AlarmGlue::runCommands(std::vector<Command> cmds, std::vector<CommandResult>& out) {
    auto w = std::make_shared<Waiter>();
    w->expected = cmds.size();
    for (Command& c : cmds) {
        engine_.submit(std::move(c), [w](const CommandResult& r) {
            std::lock_guard<std::mutex> l(w->mu);
            w->results.push_back(r);
            w->cv.notify_all();
        });
    }
    std::unique_lock<std::mutex> l(w->mu);
    const bool done = w->cv.wait_for(l, std::chrono::milliseconds(opt_.commandWaitMs),
                                     [&] { return w->results.size() >= w->expected; });
    out = w->results;
    return done;
}

json AlarmGlue::stateBody(const std::string& id) const {
    auto v = engine_.view();
    json b = json::object();
    b["revision"] = v ? v->revision : 0;
    b["counts"] = countsJson(v ? v->counts : Counts{});
    const AlarmItem* it = v ? v->find(id) : nullptr;
    b["state"] = it ? stateName(it->state) : "NORMAL";
    b["occurrence"] = it ? it->occurrence : 0;
    return b;
}

size_t AlarmGlue::reservations() const {
    std::lock_guard<std::mutex> l(resMu_);
    return reserved_.size();
}

// --- ack ---

AlarmApiResult AlarmGlue::ack(const AckSpec& spec, const AlarmActor& who) {
    auto v = engine_.view();
    const AlarmView empty;
    if (!v) v = std::make_shared<AlarmView>();
    AckRequest req;
    int skippedNewer = 0;
    std::string filterText;
    std::map<std::string, std::string> fromState;
    if (!spec.all) {
        req.items = spec.items;
    } else {
        // The instances the user saw when pressing: the filter (AND of the keys present), not
        // shelved, waiting for acknowledgement, and not newer than the revision the page showed.
        const std::string qf = spec.q.empty() ? std::string() : foldText(spec.q);
        for (const AlarmItem& it : v->items) {
            if (it.shelve || it.disabled) continue;
            if (it.state != AlarmState::ActiveUnack && it.state != AlarmState::RtnUnack) continue;
            if (!spec.states.empty() && std::find(spec.states.begin(), spec.states.end(),
                                                  stateName(it.state)) == spec.states.end())
                continue;
            if (!spec.areas.empty()) {
                const std::string key = it.areaId.empty() ? "-" : it.areaId;
                if (std::find(spec.areas.begin(), spec.areas.end(), key) == spec.areas.end())
                    continue;
            }
            if (!spec.classes.empty() && std::find(spec.classes.begin(), spec.classes.end(),
                                                   it.classId) == spec.classes.end())
                continue;
            if (!spec.priorities.empty() &&
                std::find(spec.priorities.begin(), spec.priorities.end(), it.priority) ==
                    spec.priorities.end())
                continue;
            if (!qf.empty() && it.textFold.find(qf) == std::string::npos &&
                foldText(it.name).find(qf) == std::string::npos)
                continue;
            if (it.rev > spec.upToRevision) {
                ++skippedNewer;
                continue;
            }
            req.items.push_back({it.id, it.occurrence});
        }
        filterText = "all";
        if (!spec.areas.empty()) filterText += " area=" + joined(spec.areas);
        if (!spec.classes.empty()) filterText += " class=" + joined(spec.classes);
        if (!spec.priorities.empty()) {
            std::vector<std::string> p;
            for (int x : spec.priorities) p.push_back(priorityName(static_cast<Priority>(x)));
            filterText += " priority=" + joined(p);
        }
        if (!spec.states.empty()) filterText += " state=" + joined(spec.states);
        if (!spec.q.empty()) filterText += " q=" + spec.q;
        if (filterText.size() > 120) filterText.resize(120);
    }
    for (const auto& it : req.items)
        if (const AlarmItem* x = v->find(it.id)) fromState[it.id] = stateName(x->state);

    std::vector<AckTarget> plan = engine_.previewAck(req);

    // Phase 1: reserve what takes effect. A pair another request holds is "already acknowledged".
    std::vector<size_t> effective;
    {
        std::lock_guard<std::mutex> l(resMu_);
        for (size_t i = 0; i < plan.size(); ++i) {
            if (plan[i].result != "ACKED") continue;
            if (!reserved_.insert({plan[i].id, plan[i].occurrence}).second)
                plan[i].result = "ALREADY_ACKED";
            else
                effective.push_back(i);
        }
    }
    auto release = [&] {
        std::lock_guard<std::mutex> l(resMu_);
        for (size_t i : effective) reserved_.erase({plan[i].id, plan[i].occurrence});
    };

    json results = json::array();
    int acked = 0;
    if (!effective.empty()) {
        // Phase 2: ONE audit record for the batch, committed before anything changes.
        json detail;
        std::string target;
        if (effective.size() == 1) {
            const AckTarget& t = plan[effective[0]];
            target = t.id;
            detail = {{"occurrence", t.occurrence}, {"from", fromState[t.id]}};
        } else {
            json ids = json::array();
            for (size_t k = 0; k < effective.size() && k < 10; ++k)
                ids.push_back(plan[effective[k]].id);
            detail = {{"count", effective.size()}, {"ids", ids}};
            if (spec.all) detail["upToRevision"] = spec.upToRevision;
            target = spec.all ? filterText : "items " + std::to_string(effective.size());
        }
        if (!writeAudit(AuditAction::AlarmAck, who, target, detail)) {
            release();
            return auditDown();
        }
        // Phase 3: the engine applies them at the start of its next round.
        std::vector<Command> cmds;
        for (size_t i : effective) {
            Command c;
            c.kind = CommandKind::Ack;
            c.id = plan[i].id;
            c.occurrence = plan[i].occurrence;
            c.user = who.user;
            cmds.push_back(std::move(c));
        }
        std::vector<CommandResult> got;
        const bool done = runCommands(std::move(cmds), got);
        release();
        if (!done) return timeout();
        std::map<std::string, std::string> byId;
        for (const CommandResult& r : got) byId[r.id] = r.result;
        for (size_t i : effective) {
            auto it = byId.find(plan[i].id);
            if (it != byId.end()) plan[i].result = it->second;
        }
    }
    for (const AckTarget& t : plan) {
        if (t.result == "ACKED") ++acked;
        results.push_back({{"id", t.id}, {"occurrence", t.occurrence}, {"result", t.result}});
    }
    auto after = engine_.view();
    json body = {{"mode", spec.all ? "all" : "items"},
                 {"results", results},
                 {"acked", acked},
                 {"skippedNewer", skippedNewer},
                 {"revision", after ? after->revision : 0},
                 {"counts", countsJson(after ? after->counts : Counts{})}};
    return {200, body};
}

// --- shelve and the rest: one instance each ---

AlarmApiResult AlarmGlue::shelve(const std::string& id, const std::string& reasonIn,
                                 int64_t durationS, const AlarmActor& who) {
    if (!byId_.count(id)) return notFound(id);
    auto v = engine_.view();
    const AlarmItem* it = v ? v->find(id) : nullptr;
    if (it && it->disabled)
        return {
            409,
            {{"error", "ALARM_DISABLED"}, {"message", "Alarm đang bị vô hiệu, không tạm ẩn được"}}};
    const std::string reason = trim(reasonIn);
    auto range = [&](const char* field, const char* message) {
        return AlarmApiResult{422,
                              {{"error", "SHELVE_RANGE"}, {"field", field}, {"message", message}}};
    };
    if (!validReason(reason)) return range("reason", "Lý do phải từ 1 đến 120 ký tự");
    if (durationS < 60 || durationS > 28800)
        return range("durationS", "Thời gian phải từ 60 đến 28.800 giây");
    const bool replacing = it && it->shelve;
    if (!replacing && v) {
        int n = 0;
        for (const AlarmItem& x : v->items)
            if (x.shelve && !x.shelve->system) ++n;
        if (n >= opt_.engine.maxShelved) return range("limit", "Đã có tối đa 50 alarm đang tạm ẩn");
    }
    const int64_t until = opt_.epochMs() + durationS * 1000;
    if (!writeAudit(AuditAction::AlarmShelve, who, id,
                    {{"reason", reason},
                     {"durationS", durationS},
                     {"until", until},
                     {"replaced", replacing}}))
        return auditDown();
    Command c;
    c.kind = CommandKind::Shelve;
    c.id = id;
    c.user = who.user;
    c.reason = reason;
    c.durationS = static_cast<int>(durationS);
    std::vector<CommandResult> got;
    if (!runCommands({c}, got)) return timeout();
    const CommandResult& r = got.front();
    if (r.result == "SHELVE_RANGE") return range("limit", "Đã có tối đa 50 alarm đang tạm ẩn");
    if (r.result == "NOT_FOUND") return notFound(id);
    json body = stateBody(id);
    body["id"] = id;
    body["shelved"] = {{"until", r.untilEpochMs ? r.untilEpochMs : until},
                       {"durationS", durationS},
                       {"reason", reason},
                       {"user", who.user},
                       {"system", false}};
    body["changed"] = true;
    return {200, body};
}

AlarmApiResult AlarmGlue::unshelve(const std::string& id, const AlarmActor& who) {
    if (!byId_.count(id)) return notFound(id);
    auto v = engine_.view();
    const AlarmItem* it = v ? v->find(id) : nullptr;
    if (!it || !it->shelve) {
        json body = stateBody(id);
        body["id"] = id;
        body["shelved"] = nullptr;
        body["changed"] = false;
        return {200, body};
    }
    if (!writeAudit(AuditAction::AlarmUnshelve, who, id,
                    {{"cause", "manual"}, {"remainingS", it->shelve->remainingS}}))
        return auditDown();
    Command c;
    c.kind = CommandKind::Unshelve;
    c.id = id;
    c.user = who.user;
    std::vector<CommandResult> got;
    if (!runCommands({c}, got)) return timeout();
    json body = stateBody(id);
    body["id"] = id;
    body["shelved"] = nullptr;
    body["changed"] = got.front().result == "OK";
    return {200, body};
}

AlarmApiResult AlarmGlue::disable(const std::string& id, const std::string& reasonIn,
                                  const AlarmActor& who) {
    if (!byId_.count(id)) return notFound(id);
    auto v = engine_.view();
    const AlarmItem* it = v ? v->find(id) : nullptr;
    if (it && it->disabled) {
        json body = stateBody(id);
        body["id"] = id;
        body["disabled"] = true;
        body["changed"] = false;
        return {200, body};
    }
    const std::string reason = trim(reasonIn);
    json detail = {{"reason", reason}};
    if (it && it->state != AlarmState::Normal && it->occurrence > 0)
        detail["closedOccurrence"] = it->occurrence;
    if (!writeAudit(AuditAction::AlarmDisable, who, id, detail)) return auditDown();
    Command c;
    c.kind = CommandKind::Disable;
    c.id = id;
    c.user = who.user;
    c.reason = reason;
    std::vector<CommandResult> got;
    if (!runCommands({c}, got)) return timeout();
    json body = stateBody(id);
    body["id"] = id;
    body["disabled"] = true;
    body["changed"] = got.front().result == "OK";
    return {200, body};
}

AlarmApiResult AlarmGlue::enable(const std::string& id, const AlarmActor& who) {
    if (!byId_.count(id)) return notFound(id);
    auto v = engine_.view();
    const AlarmItem* it = v ? v->find(id) : nullptr;
    if (!it || !it->disabled) {
        json body = stateBody(id);
        body["id"] = id;
        body["disabled"] = false;
        body["changed"] = false;
        return {200, body};
    }
    if (!writeAudit(AuditAction::AlarmEnable, who, id, json::object())) return auditDown();
    Command c;
    c.kind = CommandKind::Enable;
    c.id = id;
    c.user = who.user;
    std::vector<CommandResult> got;
    if (!runCommands({c}, got)) return timeout();
    json body = stateBody(id);
    body["id"] = id;
    body["disabled"] = false;
    body["changed"] = got.front().result == "OK";
    return {200, body};
}

// ---------------------------------------------------------------------------------------------
// History and info

AlarmApiResult AlarmGlue::history(const HistoryQuery& q) {
    HistoryResult r =
        reader_ ? reader_->query(q) : HistoryResult{HistoryStatus::Unavailable, {}, {}, {}};
    if (r.status == HistoryStatus::Unavailable && !hasAlarms_ && !fileExists(dbPath())) {
        r.status = HistoryStatus::Ok;  // a project without alarms and no log: an empty history
    }
    switch (r.status) {
        case HistoryStatus::BadQuery:
            return {400, {{"error", "BAD_QUERY"}, {"field", r.field}, {"message", r.message}}};
        case HistoryStatus::Busy:
            return {
                503,
                {{"error", "ALARM_HISTORY_BUSY"}, {"message", r.message}, {"retryAfterMs", 2000}}};
        case HistoryStatus::Unavailable:
            return {503,
                    {{"error", "ALARM_LOG_UNAVAILABLE"},
                     {"message", "Không đọc được lịch sử alarm của thiết bị"}}};
        case HistoryStatus::Ok:
            break;
    }
    json items = json::array();
    for (const OccurrenceRow& row : r.page.rows) {
        const auto d = [&]() -> const InstanceDef* {
            auto it = byId_.find(row.alarmId);
            return it == byId_.end() ? nullptr : it->second;
        }();
        json j = {
            {"id", row.id},
            {"alarmId", row.alarmId},
            {"name", d ? d->name : row.alarmId},
            {"class", row.classId},
            {"priority", priorityName(static_cast<Priority>(std::clamp(row.priority, 1, 4)))},
            {"area", row.area ? json(*row.area) : json(nullptr)},
            {"text", row.text},
            {"valueActive", row.valueActive ? json(*row.valueActive) : json(nullptr)},
            {"qualityActive", row.qualityActive},
            {"reason", row.reason ? json(*row.reason) : json(nullptr)},
            {"tsActive", row.tsActiveMs},
            {"clockOk", row.clockOk},
            {"tsAck", row.tsAckMs ? json(*row.tsAckMs) : json(nullptr)},
            {"ackUser", row.ackUser ? json(*row.ackUser) : json(nullptr)},
            {"tsReturn", row.tsReturnMs ? json(*row.tsReturnMs) : json(nullptr)},
            {"tsReturnAck", row.tsReturnAckMs ? json(*row.tsReturnAckMs) : json(nullptr)},
            {"returnAckUser", row.returnAckUser ? json(*row.returnAckUser) : json(nullptr)},
            {"flags", {{"startup", (row.flags & 1) != 0}, {"inputBad", (row.flags & 2) != 0}}},
            {"closedBy", row.closed && row.closedBy != ClosedBy::None
                             ? json(closedByName(row.closedBy))
                             : json(nullptr)},
            {"state", row.closed ? "closed" : "active"}};
        if (row.repeatCount > 1) j["repeat"] = row.repeatCount;
        items.push_back(std::move(j));
    }
    json body = {{"items", items},
                 {"limit", q.limit},
                 {"hasMore", r.page.hasMore},
                 {"nextBeforeId", r.page.nextBeforeId ? json(*r.page.nextBeforeId) : json(nullptr)},
                 {"ts", opt_.epochMs()}};
    return {200, body};
}

json AlarmGlue::infoJson() {
    auto v = engine_.view();
    const Counts c = v ? v->counts : Counts{};
    const LogState st = service_ ? service_->logState() : LogState::Running;
    json j = {{"instances", engine_.instanceCount()},
              {"active", c.active},
              {"unacked", c.unacked},
              {"shelved", c.shelved},
              {"disabled", c.disabled},
              {"logState", logStateName(st)},
              {"droppedChanges", service_ ? service_->droppedChanges() : 0},
              {"dbBytes", service_ ? service_->dbBytes() : 0},
              {"evalMaxMs", std::round(evalMaxMs() * 100) / 100},
              {"evalWindowS", 60}};
    if (service_ && service_->recovered()) j["recovered"] = true;
    return j;
}

std::vector<std::string> AlarmGlue::warnings() {
    std::vector<std::string> w;
    if (!service_) return w;
    const LogState st = service_->logState();
    if (st == LogState::Paused) w.emplace_back("ALARM_LOG_PAUSED");
    if (st == LogState::Error) w.emplace_back("ALARM_LOG_ERROR");
    if (service_->droppedChanges() > 0) w.emplace_back("ALARM_DROPPED");
    return w;
}

}  // namespace mat
