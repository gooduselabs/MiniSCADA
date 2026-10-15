// The alarm engine (specs/009-alarms contracts/alarm-engine.md): ISA-18.2 state machine, delays,
// hysteresis, shelving, self-shelving of chattering alarms, restart reconciliation. Pure: no I/O,
// no clock, no network; time is a parameter. One tick thread calls load() and step(); other
// threads call submit() and view().
#pragma once
#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "core/alarm/alarm_defs.hpp"
#include "core/alarm/alarm_types.hpp"

namespace mat::alarm {

// Result of a state-table lookup (data-model §5), for the table test.
enum class TableEvent : uint8_t {
    On,
    Off,
    Ack,
    AckReturn,
    Shelve,
    Unshelve,
    Disable,
    Enable,
    ConfigRemoved,
    RestartReconcile
};

class AlarmEngine {
   public:
    explicit AlarmEngine(AlarmOptions opt = {});
    ~AlarmEngine();
    AlarmEngine(const AlarmEngine&) = delete;
    AlarmEngine& operator=(const AlarmEngine&) = delete;

    // At start and on every project activation. Tick thread. Events (closings, expiries, resync)
    // are queued for takeEvents().
    LoadReport load(const AlarmDefs& defs, const LoadContext& ctx);

    // Tags that step() reads; the caller builds `tags` in this order.
    const std::vector<std::string>& watchedTags() const;

    // One round. count must equal watchedTags().size(). No allocation when nothing changes.
    // (C++17: pointer and count; the vector overload is the same call.)
    void step(int64_t nowMonoMs, int64_t nowEpochMs, const TagSample* tags, size_t count);
    void step(int64_t nowMonoMs, int64_t nowEpochMs, const std::vector<TagSample>& tags) {
        step(nowMonoMs, nowEpochMs, tags.data(), tags.size());
    }

    // Any thread (short lock). `onResult` runs on the tick thread at the end of the next step, or
    // with NOT_FOUND when the project is replaced before that.
    void submit(Command cmd, std::function<void(const CommandResult&)> onResult = {});

    // Events of load() and of the steps since the last call, in order.
    void takeEvents(std::vector<AlarmEvent>& out);

    // Immutable snapshot; any thread.
    std::shared_ptr<const AlarmView> view() const;

    // Which commands would be ACKED, on the snapshot. Does not change anything.
    std::vector<AckTarget> previewAck(const AckRequest& req) const;

    // Instances and their index, for tests and the glue.
    size_t instanceCount() const;

    // The state table (data-model §5): the state after `ev` from `from`; nullopt = impossible.
    // `requiresAck` and `ackReturn` are the flags of the class; `condTrue` matters for Unshelve.
    static std::optional<AlarmState> transition(AlarmState from, TableEvent ev, bool requiresAck,
                                                bool ackReturn, bool condTrue = true);

   private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace mat::alarm
