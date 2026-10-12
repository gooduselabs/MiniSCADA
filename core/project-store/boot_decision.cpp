#include "core/project-store/boot_decision.hpp"

namespace mat {

const char* bootActionName(BootAction a) {
    switch (a) {
        case BootAction::Adopt:
            return "adopt";
        case BootAction::RunLegacy:
            return "run-legacy";
        case BootAction::RunActive:
            return "run-active";
        case BootAction::TryNew:
            return "try-new";
        case BootAction::RollBack:
            return "roll-back";
        case BootAction::ContinueRollBack:
            return "continue-roll-back";
        case BootAction::NoProject:
            return "no-project";
        case BootAction::NoValidProject:
            return "no-valid-project";
    }
    return "";
}

namespace {

// The rolled-back-to version cannot run: the operation ends, nothing runs (active = null, the
// backups stay listed so a person can restore one).
BootDecision rollbackFailed(const StoreState& s, BootDecision d, const char* code,
                            const std::string& why) {
    d.action = BootAction::NoValidProject;
    d.runSeq.reset();
    d.healthCheck = false;
    d.rollbackCode = code;
    d.opEnded = true;
    d.write = stateEnded(s, false);
    d.reason = "quay về bản trước cũng lỗi (" + why + "): không có project hợp lệ";
    return d;
}

// The new version failed at start (`code`): back to `from`.
BootDecision rollBack(const BootInput& in, const char* code) {
    const StoreState& s = in.state;
    const PendingOperation& p = *s.pending;
    BootDecision d;
    d.healthCode = code;
    if (!p.from) {
        d.action = BootAction::NoProject;
        d.opEnded = true;
        d.write = stateEnded(s, false);
        d.reason = "bản mới lỗi, không có bản trước để quay về";
        return d;
    }
    if (!in.complete.count(*p.from))
        return rollbackFailed(s, d, "HEALTH_PROJECT",
                              "bản " + std::to_string(*p.from) + " thiếu file");
    d.action = BootAction::RollBack;
    d.runSeq = p.from;
    d.healthCheck = true;
    d.write = stateRollingBack(s, 1);  // this start runs the old version
    return d;
}

}  // namespace

BootDecision decideBoot(const BootInput& in) {
    BootDecision d;
    if (in.status == StateStatus::Corrupt) {
        d.action = BootAction::NoValidProject;
        d.reason = "state.json hỏng: " + in.stateError;
        return d;
    }
    if (in.status == StateStatus::Missing) {
        d.action = in.legacy == LegacyStatus::Valid ? BootAction::Adopt : BootAction::RunLegacy;
        return d;
    }
    const StoreState& s = in.state;
    if (!s.pending) {
        if (!s.active) {
            d.action = BootAction::NoProject;
            d.reason = "chưa có project trong kho";
        } else if (!in.complete.count(*s.active)) {
            d.action = BootAction::NoValidProject;
            d.reason = "bản " + std::to_string(*s.active) + " thiếu file";
        } else {
            d.action = BootAction::RunActive;
            d.runSeq = s.active;
        }
        return d;
    }
    const PendingOperation& p = *s.pending;
    if (p.phase == PendingPhase::RollingBack) {
        if (!p.from) {
            d.action = BootAction::NoProject;
            d.opEnded = true;
            d.write = stateEnded(s, false);
            d.reason = "chưa có project trong kho";
            return d;
        }
        if (!in.complete.count(*p.from))
            return rollbackFailed(s, d, "HEALTH_PROJECT",
                                  "bản " + std::to_string(*p.from) + " thiếu file");
        if (p.bootAttempts >= kBootAttemptsMax)
            return rollbackFailed(s, d, "HEALTH_CRASH", "runtime dừng 2 lần");
        d.action = BootAction::ContinueRollBack;
        d.runSeq = p.from;
        d.healthCheck = true;
        StoreState w = s;
        w.pending->bootAttempts = p.bootAttempts + 1;
        d.write = std::move(w);
        return d;
    }
    // activating, health
    if (!in.complete.count(p.to)) return rollBack(in, "HEALTH_PROJECT");
    if (p.bootAttempts >= kBootAttemptsMax) return rollBack(in, "HEALTH_CRASH");
    d.action = BootAction::TryNew;
    d.runSeq = p.to;
    d.healthCheck = true;
    StoreState w = s;
    w.pending->bootAttempts = p.bootAttempts + 1;
    w.pending->phase = PendingPhase::Health;
    d.write = std::move(w);
    return d;
}

StoreStartup startStore(ProjectStore& store, const BootHooks& hooks) {
    StoreStartup st;
    std::string err;
    if (!store.open(err)) {
        st.status = StateStatus::Corrupt;
        st.error = err;
        st.decision.reason = "không mở được kho project: " + err;
        store.setNoPackageReason(st.decision.reason);
        return st;
    }
    store.setBaseBlockReason("");
    std::string stateError;
    st.status = store.load(&stateError);
    st.stateReadMonoMs = hooks.monoMs ? hooks.monoMs() : systemMonoMs();
    if (st.status == StateStatus::Corrupt) {
        // T100a: set the damaged file aside and rebuild state.json from the versions on disk.
        const RecoverResult rr = store.recoverState(st.stateReadMonoMs, hooks.audit);
        if (rr.ok) {
            st.recovered = true;
            st.corruptFile = rr.corruptFile;
        } else {
            st.error = "không dựng lại được state.json: " + rr.error;
        }
    }
    st.stagingRemoved = store.cleanup();

    BootInput in;
    in.status = store.stateStatus();
    in.state = store.state();
    in.stateError = stateError;
    in.complete = store.completeVersions();
    if (in.status == StateStatus::Ok) st.pending = in.state.pending;
    LegacyProject legacy;
    if (in.status == StateStatus::Missing) {
        if (hooks.legacy) legacy = hooks.legacy();
        in.legacy = legacy.status;
    }
    BootDecision d = decideBoot(in);
    std::string reason = d.reason;
    if (in.status == StateStatus::Corrupt && !st.error.empty()) reason += " (" + st.error + ")";

    if (d.action == BootAction::Adopt) {
        const AdoptResult r = store.adopt(legacy, hooks.pack, hooks.audit);
        if (r.ok) {
            d.runSeq = r.seq;
            reason.clear();
        } else {
            st.error = r.error;
            d.action = BootAction::RunLegacy;
            reason = "chưa nhận được project cài theo cách cũ vào kho: " + r.error;
            // T100a: a deploy over it would lose it; refused until it is taken (next start).
            store.setBaseBlockReason(reason);
        }
    } else if (d.action == BootAction::RunLegacy) {
        reason = (legacy.status == LegacyStatus::Invalid ? "project cài theo cách cũ đang lỗi: "
                                                         : "thiết bị chưa có project: ") +
                 legacy.reason;
    } else if (d.write) {
        if (store.writeState(*d.write, err)) {
            store.removeUnreferenced();
        } else {
            // Never run a version whose start is not counted on disk.
            st.error = "không ghi được state.json: " + err;
            d.action = BootAction::NoValidProject;
            d.runSeq.reset();
            d.healthCheck = false;
            d.opEnded = false;
            reason = st.error;
        }
    }
    if (d.action == BootAction::RunLegacy)
        st.runDir = legacy.dir;
    else if (d.runSeq)
        st.runDir = store.projectDir(*d.runSeq);
    if (d.action == BootAction::NoProject && reason.empty()) reason = "chưa có project trong kho";
    st.decision = d;
    st.decision.reason = reason;
    store.setNoPackageReason(reason);
    return st;
}

}  // namespace mat
