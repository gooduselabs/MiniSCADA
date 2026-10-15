// Helpers shared by the alarm tests: a rig that owns an engine, a set of Tag samples and a virtual
// clock (mono = t, epoch = kEpoch0 + t), and a builder of defs from the JSON of project 0.5.
#pragma once
#include <cstdint>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

#include "core/alarm/alarm_defs.hpp"
#include "core/alarm/alarm_engine.hpp"
#include "nlohmann/json.hpp"

namespace mat::alarm::test {

inline constexpr int64_t kEpoch0 = 1791600000000LL;  // 2026-10-10, a valid clock

inline nlohmann::json classesJson(bool requiresAck = true, bool ackReturn = false,
                                  int chatter = 5) {
    using nlohmann::json;
    json c = {{"id", "minor"},
              {"name", "Nhỏ"},
              {"priority", "minor"},
              {"color", "amber"},
              {"requiresAck", requiresAck},
              {"ackReturn", ackReturn},
              {"sound", "beep"},
              {"blink", false},
              {"chatterLimit", chatter}};
    json crit = {{"id", "critical"}, {"name", "Khẩn cấp"},  {"priority", "critical"},
                 {"color", "red"},   {"requiresAck", true}, {"ackReturn", false},
                 {"sound", "siren"}, {"blink", true},       {"chatterLimit", chatter}};
    return {{"classes", json::array({c, crit})}};
}

inline AlarmDefs makeDefs(const nlohmann::json& alarms, const nlohmann::json& classes,
                          std::map<std::string, AlarmTagInfo> tags = {},
                          std::map<std::string, std::vector<std::string>> devices = {},
                          const nlohmann::json& areas = nlohmann::json::array()) {
    ProjectView p;
    p.alarms = {{"areas", areas}, {"alarms", alarms}};
    p.classes = classes;
    p.tags = std::move(tags);
    p.devices = std::move(devices);
    CompileResult r = compileAlarms(p);
    if (!r.ok()) throw std::runtime_error("compileAlarms: " + r.errors.front());
    return r.defs;
}

class Rig {
   public:
    explicit Rig(AlarmDefs d, AlarmOptions opt = {}) : eng(opt), defs(std::move(d)) {
        samples.resize(defs.tagIds.size());
        for (auto& s : samples) {
            s.known = false;
            s.quality = TagSample::Quality::Bad;
            reasons.emplace_back("NO_DATA");
        }
        for (size_t i = 0; i < samples.size(); ++i) samples[i].reason = reasons[i];
        LoadContext ctx;
        ctx.nowMonoMs = 0;
        ctx.nowEpochMs = kEpoch0;
        ctx.processStart = true;
        eng.load(defs, ctx);
        drain();
        events.clear();  // the resync of the first load
    }

    size_t slot(const std::string& tag) const {
        for (size_t i = 0; i < defs.tagIds.size(); ++i)
            if (defs.tagIds[i] == tag) return i;
        throw std::runtime_error("no tag " + tag);
    }
    void set(const std::string& tag, double v, TagSample::Quality q = TagSample::Quality::Good,
             const std::string& reason = "") {
        const size_t i = slot(tag);
        samples[i].known = true;
        samples[i].value = v;
        samples[i].quality = q;
        reasons[i] = reason;
        samples[i].reason = reasons[i];
    }
    void unknown(const std::string& tag) {
        const size_t i = slot(tag);
        samples[i].known = false;
        samples[i].quality = TagSample::Quality::Bad;
    }
    // One step at `mono` (after this call mono is advanced by tickMs).
    void tick() {
        eng.step(mono, kEpoch0 + mono, samples.data(), samples.size());
        drain();
        mono += tickMs;
    }
    void run(int64_t ms) {
        const int64_t end = mono + ms;
        while (mono < end) tick();
    }
    void drain() {
        std::vector<AlarmEvent> ev;
        eng.takeEvents(ev);
        for (auto& e : ev) events.push_back(std::move(e));
    }
    // Submits a command and steps once; returns its result.
    CommandResult cmd(Command c) {
        CommandResult out;
        bool got = false;
        eng.submit(std::move(c), [&](const CommandResult& r) {
            out = r;
            got = true;
        });
        tick();
        if (!got) throw std::runtime_error("no result");
        return out;
    }
    CommandResult ack(const std::string& id, int64_t occ, const std::string& user = "op1") {
        Command c;
        c.kind = CommandKind::Ack;
        c.id = id;
        c.occurrence = occ;
        c.user = user;
        return cmd(c);
    }
    CommandResult shelve(const std::string& id, int durationS = 600,
                         const std::string& reason = "test") {
        Command c;
        c.kind = CommandKind::Shelve;
        c.id = id;
        c.reason = reason;
        c.durationS = durationS;
        c.user = "op1";
        return cmd(c);
    }
    CommandResult simple(CommandKind k, const std::string& id) {
        Command c;
        c.kind = k;
        c.id = id;
        c.user = "op1";
        c.reason = "r";
        return cmd(c);
    }
    AlarmState state(const std::string& id) const {
        auto v = eng.view();
        const AlarmItem* it = v->find(id);
        return it ? it->state : AlarmState::Normal;
    }
    int64_t occurrence(const std::string& id) const {
        auto v = eng.view();
        const AlarmItem* it = v->find(id);
        return it ? it->occurrence : 0;
    }
    // Events of kind State/etc. for one instance.
    std::vector<AlarmEvent> of(const std::string& id,
                               AlarmEvent::Kind k = AlarmEvent::Kind::State) const {
        std::vector<AlarmEvent> r;
        for (const auto& e : events)
            if (e.instance == id && e.kind == k) r.push_back(e);
        return r;
    }

    AlarmEngine eng;
    AlarmDefs defs;
    std::vector<TagSample> samples;
    std::vector<std::string> reasons;
    std::vector<AlarmEvent> events;
    int64_t mono = 0;
    int64_t tickMs = 250;
};

// A project with one digital alarm D (tag "T.D", trigger true).
inline AlarmDefs digitalDefs(bool requiresAck = true, bool ackReturn = false, int onDelay = 0,
                             int offDelay = 0, int chatter = 5) {
    nlohmann::json a = nlohmann::json::array({{{"id", "D"},
                                               {"type", "digital"},
                                               {"name", "Cảnh báo D"},
                                               {"tag", "T.D"},
                                               {"trigger", true},
                                               {"class", "minor"},
                                               {"onDelayMs", onDelay},
                                               {"offDelayMs", offDelay}}});
    return makeDefs(a, classesJson(requiresAck, ackReturn, chatter),
                    {{"T.D", AlarmTagInfo{"", {}, true}}});
}

// One limit alarm L on tag "T.L": H = 80 (class minor), deadband.
inline AlarmDefs limitDefs(double deadband = 2, int onDelay = 0, int offDelay = 0,
                           bool withHH = false) {
    using nlohmann::json;
    json limits = {{"H", {{"value", 80}, {"class", "minor"}}}};
    if (withHH) limits["HH"] = {{"value", 90}, {"class", "critical"}};
    json a = json::array({{{"id", "L"},
                           {"type", "limit"},
                           {"name", "Mức"},
                           {"tag", "T.L"},
                           {"limits", limits},
                           {"deadband", deadband},
                           {"onDelayMs", onDelay},
                           {"offDelayMs", offDelay}}});
    return makeDefs(a, classesJson(), {{"T.L", AlarmTagInfo{"%", {}, false}}});
}

}  // namespace mat::alarm::test
