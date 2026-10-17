// The alarm engine (contracts/alarm-engine.md, data-model §4-§5, tests/alarm-vectors/README.md).
#include "core/alarm/alarm_engine.hpp"

#include <algorithm>
#include <cmath>
#include <map>
#include <mutex>

#include "core/alarm/alarm_text.hpp"

namespace mat::alarm {

namespace {

struct ShelveState {
    int64_t untilMono = 0, untilEpoch = 0;
    bool clockOk = true;
    std::string user, reason;
    bool system = false;
};

struct Inst {
    InstanceDef def;
    int classIdx = -1;
    AlarmState state = AlarmState::Normal;
    bool rawCond = false, cond = false;
    int64_t pendingSince = -1;
    bool pendingIsStartup = false;
    bool evaluated = false;  // had a valid evaluation since load
    bool inputBad = false;
    bool hasShelve = false;
    ShelveState shelve;
    bool disabled = false;
    int64_t occurrence = 0;  // open occurrence; 0 = none or ghost
    bool ghost = false;      // the open "occurrence" is a ghost of a self-shelve episode
    bool hasRow = false;     // inst.row is the open row
    OccurrenceRow row;
    std::vector<int64_t> ring;
    int ghostCount = 0;
    bool episode = false;  // inside a self-shelve episode
    bool hasSummary = false;
    OccurrenceRow summary;  // the row that triggered the episode
    int64_t rev = 0;
};

using Callback = std::function<void(const CommandResult&)>;

}  // namespace

struct AlarmEngine::Impl {
    AlarmOptions opt;
    std::vector<ClassDef> classes;
    std::map<std::string, int> classIndex;
    std::map<std::string, std::string> areaNames;
    std::vector<std::string> tagIds;
    std::vector<AlarmTagInfo> tagInfo;
    std::vector<Inst> inst;
    std::map<std::string, size_t> index;
    int64_t revision = 0;
    int64_t nextOcc = 1;
    bool processStartLoad = true;
    std::vector<AlarmEvent> events;
    std::mutex mailMu;
    std::vector<std::pair<Command, Callback>> mailbox, cmdBuf;
    std::vector<std::pair<CommandResult, Callback>> results;
    mutable std::mutex viewMu;
    std::shared_ptr<const AlarmView> view = std::make_shared<AlarmView>();
    bool viewDirty = false;
    int64_t nowMono = 0, nowEpoch = 0;
    int64_t lastMono = -1, lastEpoch = 0;
    bool clockJump = false;
    bool haveLast = false;

    bool clockOk() const { return nowEpoch >= opt.clockOkFromMs; }
    const ClassDef& cls(const Inst& i) const {
        static const ClassDef fallback;
        return i.classIdx >= 0 ? classes[static_cast<size_t>(i.classIdx)] : fallback;
    }
    bool requiresAck(const Inst& i) const { return cls(i).requiresAck; }
    bool ackReturn(const Inst& i) const { return cls(i).requiresAck && cls(i).ackReturn; }
    std::string areaName(const Inst& i) const {
        auto it = areaNames.find(i.def.areaId);
        return it == areaNames.end() ? std::string("Chung") : it->second;
    }

    AlarmEvent& emit(AlarmEvent::Kind k, Inst* i) {
        events.emplace_back();
        AlarmEvent& e = events.back();
        e.kind = k;
        e.tMono = nowMono;
        e.tEpoch = nowEpoch;
        e.clockOk = clockOk();
        if (i) e.instance = i->def.id;
        if (k != AlarmEvent::Kind::Command && k != AlarmEvent::Kind::Resync) {
            ++revision;
            if (i) i->rev = revision;
            viewDirty = true;
        }
        e.revision = revision;
        return e;
    }
    void attachRow(AlarmEvent& e, Inst& i) {
        e.row = i.row;
        if (i.hasSummary && i.summary.id == i.row.id) i.summary = i.row;
    }
    void setInputBad(Inst& i, bool bad) {
        if (i.inputBad == bad) return;
        i.inputBad = bad;
        ++revision;
        i.rev = revision;
        viewDirty = true;
    }

    // ---- occurrences
    void openOccurrence(Inst& i, const TagSample* tags, bool startup, bool recordRing = true) {
        const AlarmState from = i.state;
        const AlarmState to = requiresAck(i) ? AlarmState::ActiveUnack : AlarmState::ActiveAck;
        // value, quality, reason of the moment
        std::optional<double> value;
        std::string quality = "GOOD", reason;
        if (i.def.tagSlot >= 0) {
            const TagSample& s = tags[i.def.tagSlot];
            value = s.value;
            quality = s.quality == TagSample::Quality::Bad
                          ? "BAD"
                          : s.quality == TagSample::Quality::Uncertain ? "UNCERTAIN" : "GOOD";
            reason = std::string(s.reason);
        } else {
            for (int slot : i.def.deviceSlots) {
                const TagSample& s = tags[slot];
                if (reason.empty() && !s.reason.empty()) reason = std::string(s.reason);
            }
            if (!i.def.deviceSlots.empty()) {
                const TagSample& s = tags[i.def.deviceSlots.front()];
                quality = s.quality == TagSample::Quality::Bad
                              ? "BAD"
                              : s.quality == TagSample::Quality::Uncertain ? "UNCERTAIN" : "GOOD";
            }
        }
        const bool ghost = i.hasShelve && i.shelve.system && i.episode;
        i.state = to;
        if (ghost) {
            i.ghost = true;
            i.occurrence = 0;
            i.hasRow = false;
            ++i.ghostCount;
            AlarmEvent& e = emit(AlarmEvent::Kind::State, &i);
            e.from = from;
            e.to = to;
            e.occurrence = 0;
            e.value = value;
            e.quality = quality;
            e.reason = reason;
            return;
        }
        // text
        TextContext tc;
        tc.kind = i.def.kind;
        tc.name = i.def.name;
        tc.tag = i.def.deviceId.empty() ? i.def.tagId : i.def.deviceId;
        tc.limitName = i.def.limitName;
        tc.area = areaNames.count(i.def.areaId) ? areaNames.at(i.def.areaId) : "";
        tc.reason = reason;
        tc.value = value;
        if (i.def.kind == AlarmKind::Limit) tc.limit = i.def.threshold;
        if (i.def.tagSlot >= 0) {
            const AlarmTagInfo& ti = tagInfo[static_cast<size_t>(i.def.tagSlot)];
            tc.unit = ti.unit;
            tc.isBool = ti.isBool;
            if (!ti.labels.empty()) tc.labels = &ti.labels;
        }
        OccurrenceRow& r = i.row;
        r = OccurrenceRow{};
        r.id = nextOcc++;
        r.alarmId = i.def.id;
        r.fingerprint = i.def.fingerprint;
        r.tsActiveMs = nowEpoch;
        r.clockOk = clockOk();
        r.priority = static_cast<int>(cls(i).priority);
        r.classId = i.def.classId;
        if (!i.def.areaId.empty()) r.area = i.def.areaId;
        r.text = formatAlarmText(i.def.text, tc);
        r.textFold = foldText(r.text + " " + i.def.id + " " + areaName(i));
        if (!i.def.deviceId.empty())
            r.valueActive.reset();
        else
            r.valueActive = value;
        r.qualityActive = quality;
        if (!reason.empty()) r.reason = reason;
        r.flags = startup ? 1 : 0;
        r.repeatCount = 1;
        i.hasRow = true;
        i.ghost = false;
        i.occurrence = r.id;
        // chattering
        const int limit = cls(i).chatterLimit;
        bool selfShelve = false;
        if (limit > 0 && recordRing) {
            const int64_t cutoff = nowMono - static_cast<int64_t>(opt.chatterWindowS) * 1000;
            size_t keep = 0;
            for (size_t k = 0; k < i.ring.size(); ++k)
                if (i.ring[k] >= cutoff) i.ring[keep++] = i.ring[k];
            i.ring.resize(keep);
            i.ring.push_back(nowMono);
            if (static_cast<int>(i.ring.size()) >= limit && !i.hasShelve) {
                selfShelve = true;
                r.repeatCount = static_cast<int>(i.ring.size());
            }
        }
        AlarmEvent& e = emit(AlarmEvent::Kind::State, &i);
        e.from = from;
        e.to = to;
        e.occurrence = r.id;
        e.text = r.text;
        e.value = value;
        e.quality = quality;
        e.reason = reason;
        e.startup = startup;
        attachRow(e, i);
        if (selfShelve) {
            i.hasShelve = true;
            i.shelve = ShelveState{};
            i.shelve.untilMono = nowMono + static_cast<int64_t>(opt.chatterShelveS) * 1000;
            i.shelve.untilEpoch = nowEpoch + static_cast<int64_t>(opt.chatterShelveS) * 1000;
            i.shelve.clockOk = clockOk();
            i.shelve.user = "system";
            i.shelve.reason = "chatter";
            i.shelve.system = true;
            i.episode = true;
            i.ghostCount = 0;
            i.hasSummary = true;
            i.summary = i.row;
            AlarmEvent& s = emit(AlarmEvent::Kind::Shelve, &i);
            s.user = "system";
            s.reason = "chatter";
            s.system = true;
            s.untilEpochMs = i.shelve.untilEpoch;
            s.count = static_cast<int>(i.ring.size());
            s.occurrence = r.id;
            AlarmEvent& c = emit(AlarmEvent::Kind::Chatter, &i);
            c.count = static_cast<int>(i.ring.size());
            c.occurrence = r.id;
            attachRow(c, i);
        }
    }

    // Closes the open row (if real) with `by`; the state goes to NORMAL. Emits one state event.
    void closeOccurrence(Inst& i, ClosedBy by, bool setReturn) {
        const AlarmState from = i.state;
        i.state = AlarmState::Normal;
        AlarmEvent& e = emit(AlarmEvent::Kind::State, &i);
        e.from = from;
        e.to = AlarmState::Normal;
        e.occurrence = i.occurrence;
        e.closedBy = by;
        if (i.hasRow) {
            if (setReturn && !i.row.tsReturnMs) i.row.tsReturnMs = nowEpoch;
            i.row.closed = true;
            i.row.closedBy = by;
            attachRow(e, i);
        }
        i.hasRow = false;
        i.ghost = false;
        i.occurrence = 0;
    }

    void onCondition(Inst& i, const TagSample* tags, bool startup) {
        if (i.state == AlarmState::RtnUnack) closeOccurrence(i, ClosedBy::Return, false);
        openOccurrence(i, tags, startup);
    }

    void offCondition(Inst& i) {
        if (i.state == AlarmState::ActiveUnack) {
            i.state = AlarmState::RtnUnack;
            if (i.hasRow) i.row.tsReturnMs = nowEpoch;
            AlarmEvent& e = emit(AlarmEvent::Kind::State, &i);
            e.from = AlarmState::ActiveUnack;
            e.to = AlarmState::RtnUnack;
            e.occurrence = i.occurrence;
            if (i.hasRow) attachRow(e, i);
        } else if (i.state == AlarmState::ActiveAck) {
            if (ackReturn(i)) {
                i.state = AlarmState::RtnUnack;
                if (i.hasRow) i.row.tsReturnMs = nowEpoch;
                AlarmEvent& e = emit(AlarmEvent::Kind::State, &i);
                e.from = AlarmState::ActiveAck;
                e.to = AlarmState::RtnUnack;
                e.occurrence = i.occurrence;
                if (i.hasRow) attachRow(e, i);
            } else {
                closeOccurrence(i, ClosedBy::Return, true);
            }
        }
    }

    // ---- shelving
    int shelvedUsers() const {
        int n = 0;
        for (const Inst& i : inst)
            if (i.hasShelve && !i.shelve.system) ++n;
        return n;
    }

    void endEpisodeAndRearm(Inst& i, const TagSample* tags) {
        if (i.episode) {
            const int count = static_cast<int>(i.ring.size()) + i.ghostCount;
            if (i.hasSummary) {
                i.summary.repeatCount = count;
                if (i.hasRow && i.row.id == i.summary.id) i.row.repeatCount = count;
            }
            AlarmEvent& c = emit(AlarmEvent::Kind::Chatter, &i);
            c.count = count;
            c.occurrence = i.hasSummary ? i.summary.id : 0;
            if (i.hasSummary) c.row = i.summary;
            i.ring.clear();
            i.ghostCount = 0;
            i.episode = false;
            i.hasSummary = false;
            if (i.cond && i.ghost && tags) {
                openOccurrence(i, tags, false, false);  // the ring was cleared and stays so
                return;
            }
        }
        if (i.state == AlarmState::ActiveAck && requiresAck(i) && i.cond) {
            i.state = AlarmState::ActiveUnack;
            AlarmEvent& e = emit(AlarmEvent::Kind::State, &i);
            e.from = AlarmState::ActiveAck;
            e.to = AlarmState::ActiveUnack;
            e.occurrence = i.occurrence;
            if (i.hasRow) attachRow(e, i);
        }
    }

    void unshelve(Inst& i, const char* reason, const std::string& user, bool system,
                  const TagSample* tags) {
        i.hasShelve = false;
        AlarmEvent& e = emit(AlarmEvent::Kind::Unshelve, &i);
        e.reason = reason;
        e.user = user;
        e.system = system;
        e.occurrence = i.occurrence;
        endEpisodeAndRearm(i, tags);
    }

    // ---- commands
    CommandResult apply(const Command& c, const TagSample* tags) {
        CommandResult r;
        r.id = c.id;
        auto it = index.find(c.id);
        Inst* ip = it == index.end() ? nullptr : &inst[it->second];
        auto finish = [&](const char* res) {
            r.result = res;
            r.revision = revision;
            if (ip) r.occurrence = ip->occurrence;
            return r;
        };
        if (!ip) {
            AlarmEvent& e = emit(AlarmEvent::Kind::Command, nullptr);
            e.instance = c.id;
            e.result = "NOT_FOUND";
            e.user = c.user;
            return finish("NOT_FOUND");
        }
        Inst& i = *ip;
        const char* res = "OK";
        switch (c.kind) {
            case CommandKind::Ack: {
                if (c.occurrence != i.occurrence)
                    res = i.state == AlarmState::Normal ? "NOT_ACTIVE" : "STALE";
                else if (i.hasShelve)
                    res = "SHELVED";
                else if (i.state == AlarmState::Normal)
                    res = "NOT_ACTIVE";
                else if (i.state == AlarmState::ActiveAck)
                    res = "ALREADY_ACKED";
                else
                    res = "ACKED";
                AlarmEvent& e = emit(AlarmEvent::Kind::Command, &i);
                e.result = res;
                e.user = c.user;
                e.occurrence = c.occurrence;
                if (std::string_view(res) != "ACKED") break;
                if (i.state == AlarmState::ActiveUnack) {
                    i.state = AlarmState::ActiveAck;
                    if (i.hasRow) {
                        i.row.tsAckMs = nowEpoch;
                        i.row.ackUser = c.user;
                    }
                    AlarmEvent& s = emit(AlarmEvent::Kind::State, &i);
                    s.from = AlarmState::ActiveUnack;
                    s.to = AlarmState::ActiveAck;
                    s.occurrence = i.occurrence;
                    s.user = c.user;
                    if (i.hasRow) attachRow(s, i);
                } else {  // RTN_UNACK
                    if (i.hasRow) {
                        i.row.tsReturnAckMs = nowEpoch;
                        i.row.returnAckUser = c.user;
                        if (!i.row.tsAckMs) {
                            i.row.tsAckMs = nowEpoch;
                            i.row.ackUser = c.user;
                        }
                    }
                    closeOccurrence(i, ClosedBy::Return, false);
                    events.back().user = c.user;
                }
                break;
            }
            case CommandKind::Shelve: {
                const bool rangeBad = c.durationS < 60 || c.durationS > 28800 || c.reason.empty() ||
                                      utf8Length(c.reason) > 120;
                const bool limitBad = !c.system && !(i.hasShelve && !i.shelve.system) &&
                                      shelvedUsers() >= opt.maxShelved;
                res = rangeBad || limitBad ? "SHELVE_RANGE" : "OK";
                AlarmEvent& e = emit(AlarmEvent::Kind::Command, &i);
                e.result = res;
                e.user = c.user;
                if (std::string_view(res) != "OK") break;
                i.hasShelve = true;
                i.shelve.untilMono = nowMono + static_cast<int64_t>(c.durationS) * 1000;
                i.shelve.untilEpoch = nowEpoch + static_cast<int64_t>(c.durationS) * 1000;
                i.shelve.clockOk = clockOk();
                i.shelve.user = c.user;
                i.shelve.reason = c.reason;
                i.shelve.system = c.system;
                r.untilEpochMs = i.shelve.untilEpoch;
                AlarmEvent& s = emit(AlarmEvent::Kind::Shelve, &i);
                s.user = c.user;
                s.reason = c.reason;
                s.system = c.system;
                s.untilEpochMs = i.shelve.untilEpoch;
                s.occurrence = i.occurrence;
                break;
            }
            case CommandKind::Unshelve: {
                res = i.hasShelve ? "OK" : "NOT_SHELVED";
                AlarmEvent& e = emit(AlarmEvent::Kind::Command, &i);
                e.result = res;
                e.user = c.user;
                if (i.hasShelve) unshelve(i, "user", c.user, false, tags);
                break;
            }
            case CommandKind::Disable: {
                res = i.disabled ? "ALREADY_DISABLED" : "OK";
                AlarmEvent& e = emit(AlarmEvent::Kind::Command, &i);
                e.result = res;
                e.user = c.user;
                if (i.disabled) break;
                i.disabled = true;
                AlarmEvent& d = emit(AlarmEvent::Kind::Disable, &i);
                d.user = c.user;
                d.reason = c.reason;
                d.occurrence = i.occurrence;
                if (i.hasShelve) {
                    i.hasShelve = false;
                    AlarmEvent& u = emit(AlarmEvent::Kind::Unshelve, &i);
                    u.reason = "disabled";
                    u.user = c.user;
                    if (i.episode) {
                        const int count = static_cast<int>(i.ring.size()) + i.ghostCount;
                        if (i.hasSummary) i.summary.repeatCount = count;
                        AlarmEvent& ch = emit(AlarmEvent::Kind::Chatter, &i);
                        ch.count = count;
                        if (i.hasSummary) ch.row = i.summary;
                    }
                }
                if (i.state != AlarmState::Normal) closeOccurrence(i, ClosedBy::Disabled, false);
                i.rawCond = i.cond = false;
                i.pendingSince = -1;
                i.ring.clear();
                i.ghostCount = 0;
                i.episode = false;
                i.hasSummary = false;
                setInputBad(i, false);
                break;
            }
            case CommandKind::Enable: {
                res = i.disabled ? "OK" : "NOT_DISABLED";
                AlarmEvent& e = emit(AlarmEvent::Kind::Command, &i);
                e.result = res;
                e.user = c.user;
                if (!i.disabled) break;
                i.disabled = false;
                i.evaluated = true;  // no startup flag after enable
                AlarmEvent& en = emit(AlarmEvent::Kind::Enable, &i);
                en.user = c.user;
                break;
            }
        }
        return finish(res);
    }

    // ---- evaluation
    void evaluate(Inst& i, const TagSample* tags) {
        if (i.disabled) return;
        bool raw = false;
        if (i.def.kind == AlarmKind::Quality) {
            auto pred = [&](const TagSample& s) {
                return i.def.on == QualityOn::Bad ? s.quality == TagSample::Quality::Bad
                                                  : s.quality != TagSample::Quality::Good;
            };
            if (i.def.tagSlot >= 0) {
                const TagSample& s = tags[i.def.tagSlot];
                if (!s.known) return;
                raw = pred(s);
            } else {
                for (int slot : i.def.deviceSlots)
                    if (!tags[slot].known) return;
                raw = !i.def.deviceSlots.empty();
                for (int slot : i.def.deviceSlots)
                    if (!pred(tags[slot])) raw = false;
            }
        } else {
            const TagSample& s = tags[i.def.tagSlot];
            const bool bad =
                !s.known || s.quality == TagSample::Quality::Bad || !std::isfinite(s.value);
            if (bad) {
                setInputBad(i, true);
                i.pendingSince = -1;
                i.pendingIsStartup = false;
                return;
            }
            setInputBad(i, false);
            if (i.def.kind == AlarmKind::Digital) {
                raw = (s.value != 0) == i.def.trigger;
            } else {
                const double v = s.value, th = i.def.threshold, db = i.def.deadband;
                if (i.def.isHigh())
                    raw = i.rawCond ? !(v < th - db) : v >= th;
                else
                    raw = i.rawCond ? !(v > th + db) : v <= th;
            }
        }
        const bool first = !i.evaluated;
        i.evaluated = true;
        i.rawCond = raw;
        if (raw == i.cond) {
            i.pendingSince = -1;
            i.pendingIsStartup = false;
            return;
        }
        if (i.pendingSince < 0) {
            i.pendingSince = nowMono;
            i.pendingIsStartup = first && processStartLoad;
        }
        const int64_t delay = raw ? i.def.onDelayMs : i.def.offDelayMs;
        if (nowMono - i.pendingSince >= delay) {
            i.cond = raw;
            i.pendingSince = -1;
            const bool startup = i.pendingIsStartup;
            i.pendingIsStartup = false;
            if (raw)
                onCondition(i, tags, startup);
            else
                offCondition(i);
        }
    }

    // ---- view
    void publish() {
        auto v = std::make_shared<AlarmView>();
        v->revision = revision;
        v->tsMs = nowEpoch;
        v->clockOk = clockOk();
        v->clockJumpWhileOpen = clockJump;
        for (const Inst& i : inst) {
            const bool shown = i.state != AlarmState::Normal || i.hasShelve || i.disabled;
            if (!i.hasShelve) {
                const int p = static_cast<int>(cls(i).priority) - 1;
                if (i.state != AlarmState::Normal) {
                    ++v->counts.active;
                    ++v->counts.activeByPriority[static_cast<size_t>(p)];
                }
                if (i.state == AlarmState::ActiveUnack || i.state == AlarmState::RtnUnack) {
                    ++v->counts.unacked;
                    ++v->counts.unackedByPriority[static_cast<size_t>(p)];
                }
                if (i.state == AlarmState::RtnUnack) ++v->counts.rtnUnack;
            } else {
                ++v->counts.shelved;
            }
            if (i.disabled) ++v->counts.disabled;
            if (!shown) continue;
            AlarmItem it;
            it.id = i.def.id;
            it.defId = i.def.defId;
            it.limit = i.def.limitName;
            it.name = i.def.name;
            it.classId = i.def.classId;
            it.areaId = i.def.areaId;
            it.priority = static_cast<int>(cls(i).priority);
            it.state = i.state;
            if (i.hasShelve) {
                ShelveInfo s;
                s.user = i.shelve.user;
                s.reason = i.shelve.reason;
                s.untilEpochMs = i.shelve.untilEpoch;
                s.remainingS = static_cast<int>(
                    std::max<int64_t>(0, i.shelve.untilMono - nowMono + 999) / 1000);
                s.system = i.shelve.system;
                it.shelve = s;
            }
            it.disabled = i.disabled;
            it.inputBad = i.inputBad;
            it.occurrence = i.occurrence;
            it.rev = i.rev;
            if (i.hasRow) {
                it.tsActiveMs = i.row.tsActiveMs;
                it.clockOk = i.row.clockOk;
                it.tsAckMs = i.row.tsAckMs;
                if (i.row.ackUser) it.ackUser = *i.row.ackUser;
                it.tsReturnMs = i.row.tsReturnMs;
                it.value = i.row.valueActive;
                it.quality = i.row.qualityActive;
                if (i.row.reason) it.reason = *i.row.reason;
                it.text = i.row.text;
                it.textFold = i.row.textFold;
                it.startup = (i.row.flags & 1) != 0;
                it.repeat = i.row.repeatCount;
            }
            v->index[it.id] = v->items.size();
            v->items.push_back(std::move(it));
        }
        std::lock_guard<std::mutex> l(viewMu);
        view = std::move(v);
        viewDirty = false;
    }

    void failMailbox() {
        std::vector<std::pair<Command, Callback>> pending;
        {
            std::lock_guard<std::mutex> l(mailMu);
            pending.swap(mailbox);
        }
        for (auto& p : pending) {
            if (!p.second) continue;
            CommandResult r;
            r.id = p.first.id;
            r.result = "NOT_FOUND";
            r.revision = revision;
            p.second(r);
        }
    }

    AlarmState derivedState(const OccurrenceRow& r) const {
        if (r.tsReturnMs) return AlarmState::RtnUnack;
        return r.tsAckMs ? AlarmState::ActiveAck : AlarmState::ActiveUnack;
    }

    Inst makeInst(const InstanceDef& d) const {
        Inst i;
        i.def = d;
        auto c = classIndex.find(d.classId);
        i.classIdx = c == classIndex.end() ? -1 : c->second;
        const int limit =
            i.classIdx >= 0 ? classes[static_cast<size_t>(i.classIdx)].chatterLimit : 0;
        i.ring.reserve(static_cast<size_t>(std::max(limit, 1)) + 1);
        return i;
    }

    // Applies the class-change rule to a rebuilt or kept instance (AU -> AA, RU -> N when not R).
    void classRule(Inst& i) {
        if (requiresAck(i)) return;
        if (i.state == AlarmState::ActiveUnack) {
            i.state = AlarmState::ActiveAck;
            AlarmEvent& e = emit(AlarmEvent::Kind::State, &i);
            e.from = AlarmState::ActiveUnack;
            e.to = AlarmState::ActiveAck;
            e.occurrence = i.occurrence;
            if (i.hasRow) attachRow(e, i);
        } else if (i.state == AlarmState::RtnUnack) {
            closeOccurrence(i, ClosedBy::Return, false);
        }
    }
};

AlarmEngine::AlarmEngine(AlarmOptions opt) : impl_(std::make_unique<Impl>()) {
    impl_->opt = opt;
    impl_->cmdBuf.reserve(16);
    impl_->results.reserve(16);
}
AlarmEngine::~AlarmEngine() = default;

const std::vector<std::string>& AlarmEngine::watchedTags() const { return impl_->tagIds; }
size_t AlarmEngine::instanceCount() const { return impl_->inst.size(); }

LoadReport AlarmEngine::load(const AlarmDefs& defs, const LoadContext& ctx) {
    Impl& m = *impl_;
    LoadReport rep;
    m.nowMono = ctx.nowMonoMs;
    m.nowEpoch = ctx.nowEpochMs;
    m.haveLast = false;
    m.failMailbox();
    m.processStartLoad = ctx.processStart;
    // definitions
    std::vector<Inst> old;
    old.swap(m.inst);
    m.classes = defs.classes;
    m.classIndex.clear();
    for (size_t k = 0; k < m.classes.size(); ++k)
        m.classIndex[m.classes[k].id] = static_cast<int>(k);
    m.areaNames.clear();
    for (const auto& a : defs.areas) m.areaNames[a.id] = a.name;
    m.tagIds = defs.tagIds;
    m.tagInfo = defs.tagInfo;
    m.index.clear();
    std::map<std::string, const InstanceDef*> newById;
    for (const auto& d : defs.instances) newById[d.id] = &d;

    if (!ctx.processStart && !old.empty()) {
        // The project is replaced while the process runs: match by id and fingerprint.
        std::map<std::string, Inst> kept;
        for (Inst& o : old) {
            auto it = newById.find(o.def.id);
            if (it == newById.end() || it->second->fingerprint != o.def.fingerprint) {
                if (o.state != AlarmState::Normal) {
                    m.closeOccurrence(o, ClosedBy::Config, false);
                    m.events.back().kind =
                        it == newById.end() ? AlarmEvent::Kind::Removed : AlarmEvent::Kind::State;
                } else if (it == newById.end()) {
                    AlarmEvent& e = m.emit(AlarmEvent::Kind::Removed, &o);
                    e.from = AlarmState::Normal;
                    e.to = AlarmState::Normal;
                }
                if (it == newById.end()) {
                    if (o.hasShelve) rep.staleOverrides.emplace_back(o.def.id, "shelve");
                    continue;
                }
                // a changed condition starts from scratch (the shelve and disable flags stay)
                Inst fresh = m.makeInst(*it->second);
                fresh.hasShelve = o.hasShelve;
                fresh.shelve = o.shelve;
                fresh.disabled = o.disabled;
                fresh.evaluated = true;
                fresh.rev = o.rev;
                kept[o.def.id] = std::move(fresh);
                continue;
            }
            Inst k = std::move(o);
            const InstanceDef& nd = *it->second;
            k.def = nd;
            auto c = m.classIndex.find(nd.classId);
            k.classIdx = c == m.classIndex.end() ? -1 : c->second;
            k.ring.reserve(static_cast<size_t>(std::max(m.cls(k).chatterLimit, 1)) + 1);
            k.evaluated = true;
            m.classRule(k);
            kept[nd.id] = std::move(k);
        }
        for (const auto& d : defs.instances) {
            auto it = kept.find(d.id);
            if (it != kept.end())
                m.inst.push_back(std::move(it->second));
            else {
                Inst fresh = m.makeInst(d);
                fresh.evaluated = true;  // no startup flag for instances added by a reload
                m.inst.push_back(std::move(fresh));
            }
        }
    } else {
        for (const auto& d : defs.instances) m.inst.push_back(m.makeInst(d));
        m.nextOcc = std::max<int64_t>(ctx.nextOccurrence, 1);
        for (size_t k = 0; k < m.inst.size(); ++k) m.index[m.inst[k].def.id] = k;
        // overrides
        for (const auto& o : ctx.overrides) {
            auto it = m.index.find(o.alarmId);
            if (o.kind == "disable") {
                if (it != m.index.end()) m.inst[it->second].disabled = true;
                continue;
            }
            if (it == m.index.end()) {
                rep.staleOverrides.emplace_back(o.alarmId, o.kind);
                continue;
            }
            Inst& i = m.inst[it->second];
            const bool valid = ctx.clockOk && o.clockOk && o.tsEndMs && *o.tsEndMs > ctx.nowEpochMs;
            if (valid) {
                i.hasShelve = true;
                i.shelve.untilEpoch = *o.tsEndMs;
                i.shelve.untilMono = ctx.nowMonoMs + (*o.tsEndMs - ctx.nowEpochMs);
                i.shelve.clockOk = true;
                i.shelve.user = o.user;
                i.shelve.reason = o.reason;
                i.shelve.system = o.system;
                i.episode = o.system;
            } else {
                AlarmEvent& e = m.emit(AlarmEvent::Kind::Unshelve, &i);
                e.reason = "expired";
                e.user = o.user;
                e.system = true;
                rep.staleOverrides.emplace_back(o.alarmId, o.kind);
            }
        }
        // open rows: the newest per alarm wins
        std::map<std::string, int64_t> newest;
        for (const auto& r : ctx.open) {
            auto& n = newest[r.alarmId];
            n = std::max(n, r.id);
            m.nextOcc = std::max(m.nextOcc, r.id + 1);
        }
        for (const auto& r : ctx.open) {
            auto it = m.index.find(r.alarmId);
            Inst tmp;
            Inst* ip = it == m.index.end() ? &tmp : &m.inst[it->second];
            Inst& i = *ip;
            if (ip == &tmp) {
                tmp.def.id = r.alarmId;
            }
            i.row = r;
            i.hasRow = true;
            i.occurrence = r.id;
            i.state = m.derivedState(r);
            ClosedBy by = ClosedBy::None;
            if (ip == &tmp)
                // NOLINTNEXTLINE(bugprone-branch-clone): one outcome, conditions kept apart
                by = ClosedBy::Config;
            else if (i.def.fingerprint != r.fingerprint)
                by = ClosedBy::Config;
            else if (i.disabled)
                by = ClosedBy::Disabled;
            else if (newest[r.alarmId] != r.id)
                by = ClosedBy::RestartLost;
            if (by != ClosedBy::None) {
                m.closeOccurrence(i, by, false);
                if (ip == &tmp) m.events.back().kind = AlarmEvent::Kind::Removed;
                rep.closedByReconcile.push_back(r.alarmId);
                continue;
            }
            i.cond = i.rawCond = !r.tsReturnMs.has_value();
            m.classRule(i);
        }
    }
    m.index.clear();
    for (size_t k = 0; k < m.inst.size(); ++k) m.index[m.inst[k].def.id] = k;
    rep.instances = static_cast<int>(m.inst.size());
    m.emit(AlarmEvent::Kind::Resync, nullptr);
    m.publish();
    return rep;
}

void AlarmEngine::step(int64_t nowMonoMs, int64_t nowEpochMs, const TagSample* tags, size_t count) {
    Impl& m = *impl_;
    (void)count;
    m.nowMono = nowMonoMs;
    m.nowEpoch = nowEpochMs;
    // commands
    {
        std::lock_guard<std::mutex> l(m.mailMu);
        m.cmdBuf.swap(m.mailbox);
    }
    for (auto& p : m.cmdBuf) m.results.emplace_back(m.apply(p.first, tags), std::move(p.second));
    m.cmdBuf.clear();
    // shelve expiry
    for (Inst& i : m.inst) {
        if (i.hasShelve && i.shelve.untilMono <= nowMonoMs) {
            const bool sys = i.shelve.system;
            m.unshelve(i, sys ? "chatter-end" : "expired", "system", true, tags);
        }
    }
    // evaluation
    for (Inst& i : m.inst) m.evaluate(i, tags);
    // clock jump while open
    bool anyOpen = false;
    for (const Inst& i : m.inst)
        if (i.state != AlarmState::Normal) anyOpen = true;
    if (m.haveLast && anyOpen) {
        const int64_t drift = (nowEpochMs - m.lastEpoch) - (nowMonoMs - m.lastMono);
        if (drift > 5000 || drift < -5000) {
            if (!m.clockJump) m.viewDirty = true;
            m.clockJump = true;
        }
    }
    if (!anyOpen && m.clockJump) {
        m.clockJump = false;
        m.viewDirty = true;
    }
    m.lastMono = nowMonoMs;
    m.lastEpoch = nowEpochMs;
    m.haveLast = true;
    if (m.viewDirty) m.publish();
    for (auto& r : m.results)
        if (r.second) r.second(r.first);
    m.results.clear();
}

void AlarmEngine::submit(Command cmd, std::function<void(const CommandResult&)> onResult) {
    std::lock_guard<std::mutex> l(impl_->mailMu);
    impl_->mailbox.emplace_back(std::move(cmd), std::move(onResult));
}

void AlarmEngine::takeEvents(std::vector<AlarmEvent>& out) {
    if (impl_->events.empty()) return;
    if (out.empty()) {
        out.swap(impl_->events);
    } else {
        for (auto& e : impl_->events) out.push_back(std::move(e));
        impl_->events.clear();
    }
}

std::shared_ptr<const AlarmView> AlarmEngine::view() const {
    std::lock_guard<std::mutex> l(impl_->viewMu);
    return impl_->view;
}

std::vector<AckTarget> AlarmEngine::previewAck(const AckRequest& req) const {
    std::shared_ptr<const AlarmView> v = view();
    std::vector<AckTarget> out;
    auto resultOf = [&](const AlarmItem* it, int64_t occ) -> const char* {
        if (!it) return "NOT_FOUND";
        if (occ != it->occurrence) return it->state == AlarmState::Normal ? "NOT_ACTIVE" : "STALE";
        if (it->shelve) return "SHELVED";
        if (it->state == AlarmState::Normal) return "NOT_ACTIVE";
        if (it->state == AlarmState::ActiveAck) return "ALREADY_ACKED";
        return "ACKED";
    };
    if (!req.all) {
        for (const auto& item : req.items) {
            const AlarmItem* it = v->find(item.id);
            if (!it && impl_->index.count(item.id)) {  // a NORMAL instance is not in the view
                out.push_back({item.id, item.occurrence, "NOT_ACTIVE"});
                continue;
            }
            out.push_back({item.id, item.occurrence, resultOf(it, item.occurrence)});
        }
        return out;
    }
    std::string q;
    if (req.filter.q) q = foldText(*req.filter.q);
    for (const AlarmItem& it : v->items) {
        if (it.shelve || it.disabled) continue;
        if (it.state != AlarmState::ActiveUnack && it.state != AlarmState::RtnUnack) continue;
        if (req.upToRevision > 0 && it.rev > req.upToRevision) continue;
        const AckFilter& f = req.filter;
        if (f.area && *f.area != it.areaId) continue;
        if (f.classId && *f.classId != it.classId) continue;
        if (f.priority && it.priority > *f.priority) continue;
        if (f.state) {
            if (*f.state == "unack" && it.state != AlarmState::ActiveUnack) continue;
            if (*f.state == "rtn" && it.state != AlarmState::RtnUnack) continue;
        }
        if (!q.empty() && it.textFold.find(q) == std::string::npos) continue;
        out.push_back({it.id, it.occurrence, "ACKED"});
    }
    return out;
}

std::optional<AlarmState> AlarmEngine::transition(AlarmState from, TableEvent ev, bool requiresAck,
                                                  bool ackReturn, bool condTrue) {
    using S = AlarmState;
    const bool R = requiresAck, AR = requiresAck && ackReturn;
    switch (from) {
        case S::Normal:
            switch (ev) {
                case TableEvent::On:
                    return R ? S::ActiveUnack : S::ActiveAck;
                case TableEvent::Off:
                    return std::nullopt;
                default:
                    return S::Normal;
            }
        case S::ActiveUnack:
            switch (ev) {
                case TableEvent::On:
                case TableEvent::AckReturn:
                case TableEvent::Enable:
                    return std::nullopt;
                case TableEvent::Off:
                    return S::RtnUnack;
                case TableEvent::Ack:
                    return S::ActiveAck;
                case TableEvent::Disable:
                case TableEvent::ConfigRemoved:
                    return S::Normal;
                default:
                    return S::ActiveUnack;
            }
        case S::ActiveAck:
            switch (ev) {
                case TableEvent::On:
                case TableEvent::AckReturn:
                case TableEvent::Enable:
                    return std::nullopt;
                case TableEvent::Off:
                    return AR ? S::RtnUnack : S::Normal;
                case TableEvent::Unshelve:
                    return (R && condTrue) ? S::ActiveUnack : S::ActiveAck;
                case TableEvent::Disable:
                case TableEvent::ConfigRemoved:
                    return S::Normal;
                default:
                    return S::ActiveAck;
            }
        case S::RtnUnack:
            switch (ev) {
                case TableEvent::Off:
                case TableEvent::Ack:
                case TableEvent::Enable:
                    return std::nullopt;
                case TableEvent::On:
                    return S::ActiveUnack;
                case TableEvent::AckReturn:
                case TableEvent::Disable:
                case TableEvent::ConfigRemoved:
                    return S::Normal;
                default:
                    return S::RtnUnack;
            }
    }
    return std::nullopt;
}

}  // namespace mat::alarm
