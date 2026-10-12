// Fakes of the tag write tests (feature 006 T138, T144): the model of a small project (one channel,
// two field devices, a Tag of every shape), a fake backend (the drivers) and a fake audit.
#pragma once
#include <future>
#include <map>
#include <mutex>
#include <string>
#include <vector>

#include "core/tag-engine/engine.hpp"
#include "core/tag-engine/write_coordinator.hpp"

namespace mat::testing {

inline const std::string kId1 = "6f1c2a8e-4b7d-4c1e-9a3f-1a2b3c4d5e6f";

inline std::string idN(int n) {
    char b[64];
    std::snprintf(b, sizeof b, "00000000-0000-4000-8000-%012d", n);
    return b;
}

// ---- the model: one channel, two field devices, Tags of every shape ----

enum Tg : size_t {
    SP,
    LEVEL_R,
    RUN,
    CNT,
    BIG,
    UBIG,
    NAME,
    SCALED,
    CALC,
    INT_SET,
    SIM_MAN,
    SIM_RAMP,
    OFF,
    NOREAD,
    FLT32,
    STR_LIM,
    DEV2
};

inline ProjectModel makeModel() {
    ProjectModel m;
    ChannelModel ch;
    ch.id = "plc1";
    ch.devices = {0, 1};
    m.channels.push_back(ch);
    for (int i = 0; i < 2; ++i) {
        DeviceModel d;
        d.id = i == 0 ? "d1" : "d2";
        d.channel = 0;
        d.unitId = i + 1;
        d.timeoutMs = 1000;
        d.writeDeadlineMs = 5000;
        m.devices.push_back(d);
    }
    auto ext = [&](const char* id, TagType type, bool rw, size_t dev = 0) {
        TagModel t;
        t.id = id;
        t.kind = TagKind::External;
        t.type = type;
        t.writable = rw;
        t.channel = 0;
        t.device = dev;
        t.source.device = dev == 0 ? "d1" : "d2";
        t.source.rawType = type;
        t.source.readback = true;
        m.tags.push_back(t);
        return &m.tags.back();
    };
    ext("SP", TagType::FLOAT32, true)->limits = {0.0, 90.0, std::nullopt};
    ext("LEVEL_R", TagType::FLOAT32, false);
    ext("RUN", TagType::BOOL, true);
    ext("CNT", TagType::INT16, true);
    ext("BIG", TagType::INT64, true);
    ext("UBIG", TagType::UINT64, true);
    {
        TagModel* t = ext("NAME", TagType::STRING, true);
        t->source.stringLength = 8;
    }
    {
        TagModel* t = ext("SCALED", TagType::FLOAT32, true);
        t->source.rawType = TagType::INT16;
        Scaling s;
        s.rawMin = 0;
        s.rawMax = 27648;
        s.engMin = 0;
        s.engMax = 100;
        t->scaling = s;
    }
    {
        TagModel t;
        t.id = "CALC";
        t.kind = TagKind::Calculated;
        t.type = TagType::FLOAT32;
        t.expression = "SP * 2";
        m.tags.push_back(t);
    }
    {
        TagModel t;
        t.id = "INT_SET";
        t.kind = TagKind::Internal;
        t.type = TagType::FLOAT32;
        t.writable = true;
        t.limits = {0.0, 100.0, std::nullopt};
        t.initial = 5.0;
        m.tags.push_back(t);
    }
    {
        TagModel t;
        t.id = "SIM_MAN";
        t.kind = TagKind::Simulation;
        t.type = TagType::INT16;
        t.writable = true;
        m.tags.push_back(t);
    }
    {
        TagModel t;
        t.id = "SIM_RAMP";
        t.kind = TagKind::Simulation;
        t.type = TagType::FLOAT32;
        t.writable = false;
        m.tags.push_back(t);
    }
    ext("OFF", TagType::FLOAT32, true)->disabled = true;
    ext("NOREAD", TagType::BOOL, true)->source.readback = false;
    ext("FLT32", TagType::FLOAT32, true);
    {
        TagModel t;
        t.id = "STR_LIM";
        t.kind = TagKind::Internal;
        t.type = TagType::STRING;
        t.writable = true;
        t.limits = {std::nullopt, std::nullopt, 4};
        m.tags.push_back(t);
    }
    ext("DEV2", TagType::INT16, true, 1);
    return m;
}

// ---- fakes ----

struct Events {
    std::mutex mu;
    std::vector<std::string> log;
    void add(const std::string& e) {
        std::lock_guard<std::mutex> g(mu);
        log.push_back(e);
    }
    std::vector<std::string> get() {
        std::lock_guard<std::mutex> g(mu);
        return log;
    }
    int indexOf(const std::string& prefix) {
        std::lock_guard<std::mutex> g(mu);
        for (size_t i = 0; i < log.size(); ++i)
            if (log[i].rfind(prefix, 0) == 0) return static_cast<int>(i);
        return -1;
    }
};

struct FakeBackend : WriteBackend {
    explicit FakeBackend(Events& e) : ev(e) {}
    drv::LinkState link(size_t) override { return state; }
    bool submit(size_t tag, drv::WriteCommand cmd) override {
        std::lock_guard<std::mutex> g(mu);
        ev.add("submit:" + std::to_string(tag));
        if (full) return false;
        sent.push_back({tag, cmd});
        return true;
    }
    std::vector<uint64_t> cancelUnsent() override {
        std::lock_guard<std::mutex> g(mu);
        auto out = unsent;
        unsent.clear();
        return out;
    }
    int64_t maxTimeoutMs() override { return maxTimeout; }
    size_t count() {
        std::lock_guard<std::mutex> g(mu);
        return sent.size();
    }
    drv::WriteCommand cmd(size_t i) {
        std::lock_guard<std::mutex> g(mu);
        return sent.at(i).second;
    }
    std::mutex mu;
    Events& ev;
    drv::LinkState state{drv::ChannelState::Connected, drv::DeviceState::Active};
    bool full = false;
    int64_t maxTimeout = 100;
    std::vector<std::pair<size_t, drv::WriteCommand>> sent;
    std::vector<uint64_t> unsent;
};

struct FakeAudit : WriteAudit {
    explicit FakeAudit(Events& e) : ev(e) {}
    bool available() override { return up; }
    void started(const WriteRecord& r) override {
        if (!up) throw std::runtime_error("audit down");
        ev.add("started:" + r.requestId);
        std::lock_guard<std::mutex> g(mu);
        startedRecs.push_back(r);
    }
    void finished(const WriteRecord& r, const WriteOutcome& o) override {
        if (gate) gate->get_future().wait();
        ev.add("finished:" + r.requestId + ":" + o.code);
        std::lock_guard<std::mutex> g(mu);
        finishedRecs.push_back({r, o});
    }
    void denied(const WriteCaller& who, const std::string& id, const std::string& tag,
                const std::string& valueJson, const std::string& code) override {
        ev.add("denied:" + tag + ":" + code);
        std::lock_guard<std::mutex> g(mu);
        deniedRecs.push_back({who.user, id, tag, valueJson, code});
    }
    std::optional<StoredWrite> find(const std::string& id) override {
        std::lock_guard<std::mutex> g(mu);
        auto it = stored.find(id);
        if (it == stored.end()) return std::nullopt;
        return it->second;
    }
    std::mutex mu;
    Events& ev;
    bool up = true;
    std::shared_ptr<std::promise<void>> gate;  // finished() waits for it
    std::vector<WriteRecord> startedRecs;
    std::vector<std::pair<WriteRecord, WriteOutcome>> finishedRecs;
    struct Denied {
        std::string user, id, tag, value, code;
    };
    std::vector<Denied> deniedRecs;
    std::map<std::string, StoredWrite> stored;
};

}  // namespace mat::testing
