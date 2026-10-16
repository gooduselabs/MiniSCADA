#include "core/historian/sampler.hpp"

#include <cmath>
#include <cstdint>

#include "core/common/utf8.hpp"
#include "core/historian/clock.hpp"

namespace mat {

namespace {

// Wall and monotonic clocks drifting apart by more than this between two passes = clock jump.
constexpr int64_t kJumpMs = 1000;

std::optional<double> asDouble(const TagScalar& s) {
    if (const auto* b = std::get_if<bool>(&s)) return *b ? 1.0 : 0.0;
    if (const auto* i = std::get_if<int64_t>(&s)) return static_cast<double>(*i);
    if (const auto* u = std::get_if<uint64_t>(&s)) return static_cast<double>(*u);
    if (const auto* d = std::get_if<double>(&s)) return *d;
    return std::nullopt;
}

// Numbers differ by more than the deadband; other types (and empty ↔ value) by any change.
bool differs(const Cell& logged, const Cell& now, double deadband) {
    if (logged.index() != now.index()) return true;
    if (const auto* a = std::get_if<double>(&logged)) {
        const double b = std::get<double>(now);
        return deadband > 0 ? std::fabs(*a - b) > deadband : *a != b;
    }
    if (const auto* a = std::get_if<int64_t>(&logged)) {
        const int64_t b = std::get<int64_t>(now);
        return deadband > 0 ? std::fabs(static_cast<double>(*a) - static_cast<double>(b)) > deadband
                            : *a != b;
    }
    if (const auto* a = std::get_if<uint64_t>(&logged)) {
        const uint64_t b = std::get<uint64_t>(now);
        return deadband > 0 ? std::fabs(static_cast<double>(*a) - static_cast<double>(b)) > deadband
                            : *a != b;
    }
    return logged != now;
}

}  // namespace

// Repaired first: counting only lead bytes of broken text let "A" + any number of stray
// continuation bytes pass as one character (security review M1).
std::string truncateUtf8(const std::string& s, size_t maxChars, bool& truncated) {
    return utf8Prefix(sanitizeUtf8(s), maxChars, truncated);
}

Cell toCell(const TagValue& v, const LoggedColumn& col, SamplerStats& stats) {
    if (v.quality != Quality::GOOD) return {};
    const TagScalar& s = v.value;
    if (std::holds_alternative<std::monostate>(s)) return {};
    switch (col.type) {
        case TagType::BOOL: {
            if (const auto* b = std::get_if<bool>(&s)) return *b;
            const auto d = asDouble(s);
            if (!d || !std::isfinite(*d)) return {};
            return *d != 0.0;
        }
        case TagType::STRING: {
            const auto* text = std::get_if<std::string>(&s);
            if (!text) return {};
            bool cut = false;
            std::string out = truncateUtf8(
                *text, static_cast<size_t>(col.maxLength > 0 ? col.maxLength : 0), cut);
            if (cut) ++stats.stringsTruncated;
            return out;
        }
        case TagType::FLOAT32:
        case TagType::FLOAT64: {
            const auto d = asDouble(s);
            if (!d || !std::isfinite(*d)) return {};
            return *d;
        }
        case TagType::UINT64: {
            if (const auto* u = std::get_if<uint64_t>(&s)) return *u;
            if (const auto* i = std::get_if<int64_t>(&s))
                return *i < 0 ? Cell{} : Cell{static_cast<uint64_t>(*i)};
            const auto d = asDouble(s);
            if (!d || !std::isfinite(*d) || *d < 0 || *d >= 18446744073709551615.0) return {};
            return static_cast<uint64_t>(std::round(*d));
        }
        default: {  // INT16, UINT16, INT32, UINT32, INT64 as signed 64-bit
            if (const auto* i = std::get_if<int64_t>(&s)) return *i;
            if (const auto* u = std::get_if<uint64_t>(&s))
                return *u > static_cast<uint64_t>(INT64_MAX) ? Cell{}
                                                             : Cell{static_cast<int64_t>(*u)};
            const auto d = asDouble(s);
            if (!d || !std::isfinite(*d) || std::fabs(*d) >= 9.2e18) return {};
            return static_cast<int64_t>(std::llround(*d));
        }
    }
}

GroupSampler::GroupSampler(const LoggingGroupModel& group, size_t groupIndex, int offsetMin)
    : g_(group), index_(groupIndex), offsetMin_(offsetMin) {}

LogRow GroupSampler::makeRow(int64_t nowUtc, const std::vector<TagValue>& values,
                             SamplerStats& stats) {
    LogRow r;
    r.group = index_;
    r.tsUtc = nowUtc;
    r.cells.reserve(g_.columns.size());
    for (size_t i = 0; i < g_.columns.size(); ++i)
        r.cells.push_back(toCell(values[i], g_.columns[i], stats));
    if (g_.mode == LogMode::OnChange) {
        logged_ = r.cells;
        seenRevision_.resize(values.size());
        for (size_t i = 0; i < values.size(); ++i) seenRevision_[i] = values[i].revision;
    }
    return r;
}

bool GroupSampler::changed(const std::vector<TagValue>& values) {
    bool any = false;
    SamplerStats scratch;  // truncations are counted when a row is written, not when comparing
    for (size_t i = 0; i < g_.columns.size(); ++i) {
        if (values[i].revision == seenRevision_[i]) continue;
        seenRevision_[i] = values[i].revision;
        if (differs(logged_[i], toCell(values[i], g_.columns[i], scratch), g_.columns[i].deadband))
            any = true;
    }
    return any;
}

// Trigger groups (specs/010-history-reports contracts/logging-config-0.2.md §1, research R1).
std::optional<LogRow> GroupSampler::tickTrigger(int64_t nowUtc, int64_t nowMono,
                                                const std::vector<TagValue>& values,
                                                const TagValue* trigger, SamplerStats& stats) {
    const TriggerEdge edge = g_.trigger ? g_.trigger->edge : TriggerEdge::Rising;
    const double threshold = g_.trigger ? g_.trigger->threshold : 0.0;
    bool known = false;
    bool on = false;
    if (trigger && trigger->quality == Quality::GOOD) {
        if (const auto* b = std::get_if<bool>(&trigger->value)) {
            known = true;
            on = *b;
        } else if (const auto d = asDouble(trigger->value); d && std::isfinite(*d)) {
            known = true;
            on = *d > threshold;
        }
    }
    triggerState_ =
        !known ? TriggerState::Unknown : on ? TriggerState::Active : TriggerState::Inactive;

    if (!started_) {  // no edge at start; `active` rows by period when already on
        started_ = true;
        on_ = on;
        haveRow_ = false;
        edgePending_ = false;
        if (edge == TriggerEdge::Active && on) nextActiveMono_ = nowMono + g_.periodMs;
        return std::nullopt;
    }
    if (!known) {
        on_ = false;  // bad quality = off, without an edge
    } else {
        if (on && !on_) {
            if (edge != TriggerEdge::Falling) edgePending_ = true;
            if (edge == TriggerEdge::Active) nextActiveMono_ = nowMono + g_.periodMs;
        } else if (!on && on_) {
            if (edge == TriggerEdge::Falling || edge == TriggerEdge::Both ||
                edge == TriggerEdge::Active)
                edgePending_ = true;
        }
        on_ = on;
    }
    if (edge == TriggerEdge::Active && on_ && g_.periodMs > 0 && nowMono >= nextActiveMono_) {
        edgePending_ = true;
        nextActiveMono_ = nowMono + g_.periodMs;
    }
    if (edgePending_ && (!haveRow_ || nowMono - lastRowMono_ >= g_.minIntervalMs)) {
        edgePending_ = false;
        haveRow_ = true;
        lastRowMono_ = nowMono;
        return makeRow(nowUtc, values, stats);
    }
    return std::nullopt;
}

std::optional<LogRow> GroupSampler::tick(int64_t nowUtc, int64_t nowMono,
                                         const std::vector<TagValue>& values,
                                         const TagValue* trigger, SamplerStats& stats) {
    bool jumped = false;
    if (started_) {
        const int64_t drift = (nowUtc - lastUtc_) - (nowMono - lastMono_);
        if (drift > kJumpMs || drift < -kJumpMs) {
            jumped = true;
            ++stats.clockJumps;
        }
    }
    lastUtc_ = nowUtc;
    lastMono_ = nowMono;

    if (g_.mode == LogMode::Trigger) return tickTrigger(nowUtc, nowMono, values, trigger, stats);
    if (g_.mode == LogMode::Cyclic) {
        if (!started_) {
            started_ = true;
            anchor_ = nowUtc;
            nextDue_ = alignedNext(nowUtc, g_.periodMs, offsetMin_, anchor_);
            return std::nullopt;
        }
        if (jumped) {
            // At most one row for the jumped-over span, then follow the new clock (research R5).
            const bool due = nowUtc >= nextDue_;
            anchor_ = nowUtc;
            nextDue_ = alignedNext(nowUtc, g_.periodMs, offsetMin_, anchor_);
            if (due) return makeRow(nowUtc, values, stats);
            return std::nullopt;
        }
        if (nowUtc < nextDue_) return std::nullopt;
        nextDue_ = alignedNext(nowUtc, g_.periodMs, offsetMin_, anchor_);
        return makeRow(nowUtc, values, stats);
    }

    // onChange: baseline row first, then changes (≥ minInterval apart) and heartbeat rows.
    if (!started_) {
        started_ = true;
        pending_ = false;
        lastRowMono_ = nowMono;
        return makeRow(nowUtc, values, stats);
    }
    if (changed(values)) pending_ = true;
    const int64_t since = nowMono - lastRowMono_;
    const bool heartbeat = g_.maxIntervalMs > 0 && since >= g_.maxIntervalMs;
    if ((pending_ && since >= g_.minIntervalMs) || heartbeat) {
        pending_ = false;
        lastRowMono_ = nowMono;
        return makeRow(nowUtc, values, stats);
    }
    return std::nullopt;
}

}  // namespace mat
