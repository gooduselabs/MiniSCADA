#include "core/tag-engine/engine.hpp"

#include <algorithm>
#include <cmath>
#include <unordered_map>

namespace mat {

void addModelTagsToStore(const ProjectModel& model, TagStore& store) {
    for (const auto& t : model.tags) {
        std::string signal;
        if (t.sim && t.sim->kind == sim::SimKind::Legacy) signal = t.sim->signal;
        store.add({t.id, t.type, signal});
    }
}

namespace {

bool isIntegerType(TagType t) {
    return t == TagType::INT16 || t == TagType::UINT16 || t == TagType::INT32 ||
           t == TagType::UINT32 || t == TagType::INT64 || t == TagType::UINT64;
}

bool numberOf(const TagScalar& v, double& out) {
    if (const double* d = std::get_if<double>(&v)) {
        out = *d;
        return true;
    }
    if (const int64_t* i = std::get_if<int64_t>(&v)) {
        out = static_cast<double>(*i);
        return true;
    }
    if (const uint64_t* u = std::get_if<uint64_t>(&v)) {
        out = static_cast<double>(*u);
        return true;
    }
    if (const bool* b = std::get_if<bool>(&v)) {
        out = *b ? 1.0 : 0.0;
        return true;
    }
    return false;
}

std::string mapReason(const std::string& r) {
    if (r == "NOT_A_NUMBER" || r == "OVERFLOW") return "INVALID_VALUE";
    return r;
}

// Raw value of a driver to the type of the Tag. false + reason on failure.
bool convertToType(const TagScalar& raw, TagType type, TagScalar& out, std::string& reason) {
    if (type == TagType::BOOL) {
        if (const bool* b = std::get_if<bool>(&raw)) {
            out = *b;
            return true;
        }
        double x;
        if (!numberOf(raw, x)) {
            reason = "INVALID_VALUE";
            return false;
        }
        out = x != 0;
        return true;
    }
    if (type == TagType::STRING) {
        if (const std::string* s = std::get_if<std::string>(&raw)) {
            out = *s;
            return true;
        }
        reason = "INVALID_VALUE";
        return false;
    }
    if (isIntegerType(type) &&
        (std::holds_alternative<int64_t>(raw) || std::holds_alternative<uint64_t>(raw))) {
        // exact range check, never through a double (no 128-bit integer on the 32-bit build)
        const bool neg = std::holds_alternative<int64_t>(raw) && std::get<int64_t>(raw) < 0;
        const int64_t sv = std::holds_alternative<int64_t>(raw) ? std::get<int64_t>(raw) : 0;
        const uint64_t uv = std::holds_alternative<uint64_t>(raw) ? std::get<uint64_t>(raw)
                                                                  : static_cast<uint64_t>(sv);
        const bool unsignedBig =
            std::holds_alternative<uint64_t>(raw) && uv > static_cast<uint64_t>(INT64_MAX);
        int64_t lo = 0, hi = 0;
        uint64_t uhi = 0;
        const bool signedTarget =
            type == TagType::INT16 || type == TagType::INT32 || type == TagType::INT64;
        switch (type) {
            case TagType::INT16:
                lo = -32768, hi = 32767;
                break;
            case TagType::UINT16:
                uhi = 65535;
                break;
            case TagType::INT32:
                lo = -2147483648LL, hi = 2147483647LL;
                break;
            case TagType::UINT32:
                uhi = 4294967295ULL;
                break;
            case TagType::INT64:
                lo = INT64_MIN, hi = INT64_MAX;
                break;
            default:
                uhi = UINT64_MAX;
                break;
        }
        if (signedTarget) {
            if (unsignedBig ||
                (!std::holds_alternative<uint64_t>(raw) ? (sv < lo || sv > hi)
                                                        : uv > static_cast<uint64_t>(hi))) {
                reason = "OUT_OF_RANGE";
                return false;
            }
            out = std::holds_alternative<uint64_t>(raw) ? static_cast<int64_t>(uv) : sv;
        } else {
            if (neg || uv > uhi) {
                reason = "OUT_OF_RANGE";
                return false;
            }
            out = uv;
        }
        return true;
    }
    double x;
    if (!numberOf(raw, x)) {
        reason = "INVALID_VALUE";
        return false;
    }
    const expr::Assigned a = expr::assignNumber(type, x);
    if (!a.ok) {
        reason = mapReason(a.reason);
        return false;
    }
    out = a.value;
    return true;
}

}  // namespace

bool Engine::numeric(const TagScalar& v, double& out) {
    if (std::holds_alternative<bool>(v)) return false;  // a deadband only applies to numbers
    return numberOf(v, out);
}

bool Engine::sameValue(const TagScalar& a, const TagScalar& b) { return a == b; }

Engine::Engine(TagStore& store, const ProjectModel& model) : store_(store), model_(model) {
    const size_t n = model.tags.size();
    state_.resize(n);
    changed_.assign(n, 0);
    inBatch_.assign(n, 0);
    for (size_t i = 0; i < n; ++i) {
        const TagModel& t = model.tags[i];
        State& s = state_[i];
        switch (t.kind) {
            case TagKind::Internal:
                s.value = t.initial;
                s.quality = Quality::GOOD;
                s.reason.clear();
                if (t.retain) retained_.push_back(i);
                break;
            case TagKind::External:
                if (t.disabled) s.reason = "DISABLED";
                break;
            default:
                break;  // BAD NO_VALUE until the first value
        }
    }

    // Calculated Tags: compile, order by dependency.
    std::unordered_map<std::string, size_t> byId;
    for (size_t i = 0; i < n; ++i) byId.emplace(model.tags[i].id, i);
    std::vector<CalcInput> graphInput;
    std::vector<Calc> compiled;
    std::vector<size_t> calcTagOf;
    for (size_t i = 0; i < n; ++i) {
        const TagModel& t = model.tags[i];
        if (t.kind != TagKind::Calculated) continue;
        expr::CompileEnv env;
        env.target = t.type;
        env.tagType = [&](const std::string& id) -> std::optional<TagType> {
            auto it = byId.find(id);
            if (it == byId.end()) return std::nullopt;
            return model.tags[it->second].type;
        };
        env.hasTable = [&](const std::string& name) { return model.tables.count(name) > 0; };
        const expr::CompileResult r = expr::compile(t.expression, env);
        Calc c;
        c.tag = i;
        CalcInput in{t.id, {}};
        if (!r.ok) {
            compileErrors_.push_back(t.id + ": " + r.errors[0].code);
        } else {
            c.program = r.program;
            for (const auto& id : r.program.inputs) c.inputs.push_back(byId.at(id));
            in.inputs = r.program.inputs;
        }
        graphInput.push_back(std::move(in));
        compiled.push_back(std::move(c));
    }
    const CalcGraph graph(graphInput);
    for (size_t pos : graph.orderIndex())
        if (!compiled[pos].program.ops.empty()) calcs_.push_back(std::move(compiled[pos]));
}

void Engine::applyRetained(const std::map<size_t, TagScalar>& values, bool lost) {
    for (size_t i : retained_) {
        State& s = state_[i];
        if (lost) {
            s.quality = Quality::UNCERTAIN;
            s.reason = "RETAIN_LOST";
            continue;
        }
        auto it = values.find(i);
        if (it == values.end()) continue;
        TagScalar v;
        std::string why;
        if (convertToType(it->second, model_.tags[i].type, v, why)) s.value = v;
    }
}

void Engine::publish(std::vector<drv::TagUpdate>&& updates) {
    std::lock_guard<std::mutex> g(inboxMu_);
    for (auto& u : updates) inboxUpdates_.push_back(std::move(u));
}

void Engine::writeDone(drv::WriteResult&& result) {
    std::lock_guard<std::mutex> g(inboxMu_);
    inboxResults_.push_back(std::move(result));
}

void Engine::setInternal(size_t tag, TagScalar value, uint64_t writeId) {
    std::lock_guard<std::mutex> g(inboxMu_);
    inboxSets_.push_back({tag, std::move(value), writeId});
}

void Engine::commit(size_t i, Candidate c, int64_t now) {
    (void)now;
    State& cur = state_[i];
    if (c.quality == Quality::BAD && std::holds_alternative<std::monostate>(c.value))
        c.value = cur.value;
    if (c.quality == Quality::GOOD) c.reason.clear();
    bool valueChanged = !sameValue(cur.value, c.value);
    const bool statusChanged = cur.quality != c.quality || cur.reason != c.reason;
    const TagModel& t = model_.tags[i];
    if (valueChanged && !statusChanged && !c.force && t.deadband && *t.deadband > 0) {
        double a, b;
        if (numeric(cur.value, a) && numeric(c.value, b) && std::fabs(b - a) <= *t.deadband)
            valueChanged = false;
    }
    if (!valueChanged && !statusChanged) return;
    cur.value = std::move(c.value);
    cur.quality = c.quality;
    cur.reason = std::move(c.reason);
    cur.sourceTs = c.sourceTs;
    changed_[i] = 1;
}

void Engine::applyUpdate(const drv::TagUpdate& u, int64_t now) {
    if (u.tag >= model_.tags.size()) return;
    const TagModel& t = model_.tags[u.tag];
    if (t.kind != TagKind::External && t.kind != TagKind::Simulation) return;
    if (t.disabled) return;
    Candidate c;
    c.sourceTs = u.sourceTs ? u.sourceTs : now;
    c.force = u.afterWrite;
    c.reason = u.reason;
    if (u.quality == Quality::BAD) {
        c.value = u.value;  // monostate keeps the last value
        c.quality = Quality::BAD;
        if (c.reason.empty()) c.reason = "NO_VALUE";
        commit(u.tag, std::move(c), now);
        return;
    }
    if (std::holds_alternative<std::monostate>(u.value)) {
        c.quality = Quality::BAD;
        c.reason = "NO_VALUE";
        commit(u.tag, std::move(c), now);
        return;
    }
    c.quality = u.quality;
    if (t.kind == TagKind::External && t.scaling) {
        double raw;
        if (!numberOf(u.value, raw) || !std::isfinite(raw)) {
            c.quality = Quality::BAD;
            c.reason = "INVALID_VALUE";
            commit(u.tag, std::move(c), now);
            return;
        }
        const ScaleReadResult r = scaleRead(raw, *t.scaling, t.type);
        if (!std::isfinite(r.value)) {
            c.quality = Quality::BAD;
            c.reason = "INVALID_VALUE";
        } else {
            c.value = r.value;
            if (r.quality == Quality::UNCERTAIN) {
                c.quality = Quality::UNCERTAIN;
                c.reason = r.reason;
            }
        }
        commit(u.tag, std::move(c), now);
        return;
    }
    // no scaling: the raw value to the type of the Tag; NaN and infinities are BAD INVALID_VALUE
    if (const double* d = std::get_if<double>(&u.value); d && !std::isfinite(*d)) {
        c.quality = Quality::BAD;
        c.reason = "INVALID_VALUE";
        commit(u.tag, std::move(c), now);
        return;
    }
    if (t.kind == TagKind::Simulation) {
        // The generators already give the type of the Tag; the legacy mock keeps its doubles as
        // runtime 0.4 did (a FLOAT32 Tag shows 50.01, not 50.0099983).
        c.value = u.value;
        commit(u.tag, std::move(c), now);
        return;
    }
    std::string why;
    if (!convertToType(u.value, t.type, c.value, why)) {
        c.value = TagScalar{};
        c.quality = Quality::BAD;
        c.reason = why;
    }
    commit(u.tag, std::move(c), now);
}

void Engine::evaluate(const Calc& calc, int64_t now) {
    const expr::EvalResult r = expr::evaluate(
        calc.program,
        [&](size_t k) {
            const State& in = state_[calc.inputs[k]];
            expr::InputValue iv;
            iv.value = in.value;
            iv.quality = in.quality;
            iv.reason = in.reason;
            return iv;
        },
        model_.tables);
    Candidate c;
    c.value = r.value;  // monostate when BAD: keep the last value
    c.quality = r.quality;
    c.reason = r.reason;
    c.sourceTs = now;
    commit(calc.tag, std::move(c), now);
}

// The view of a round given to the logic hook (feature 011).
class Engine::Round : public EngineRound {
   public:
    Round(Engine& e, int64_t now) : e_(e), now_(now) {}
    expr::InputValue read(size_t tag) const override {
        expr::InputValue v;
        if (tag >= e_.state_.size()) {
            v.quality = Quality::BAD;
            v.reason = "NO_VALUE";
            return v;
        }
        const State& s = e_.state_[tag];
        v.value = s.value;
        v.quality = s.quality;
        v.reason = s.reason;
        return v;
    }
    void publish(size_t tag, TagScalar value, Quality quality, const std::string& reason) override {
        if (tag >= e_.state_.size()) return;
        const uint8_t before = e_.changed_[tag];
        e_.changed_[tag] = 0;
        Candidate c;
        c.value = std::move(value);
        c.quality = quality;
        c.reason = reason;
        c.sourceTs = now_;
        e_.commit(tag, std::move(c), now_);
        if (e_.changed_[tag]) touched.push_back(tag);
        e_.changed_[tag] = static_cast<uint8_t>(e_.changed_[tag] | before);
    }
    void setInternal(size_t tag, TagScalar value) override {
        e_.setInternal(tag, std::move(value));
    }
    int64_t now() const override { return now_; }
    std::vector<size_t> touched;  // logic Tags whose value or quality changed in this round

   private:
    Engine& e_;
    int64_t now_;
};

void Engine::step(int64_t now) {
    for (drv::Driver* d : stepped_) d->step(now);

    std::vector<drv::TagUpdate> updates;
    std::vector<drv::WriteResult> results;
    std::vector<SetCommand> sets;
    {
        std::lock_guard<std::mutex> g(inboxMu_);
        updates.swap(inboxUpdates_);
        results.swap(inboxResults_);
        sets.swap(inboxSets_);
    }
    std::fill(changed_.begin(), changed_.end(), 0);
    if (first_) std::fill(changed_.begin(), changed_.end(), 1);

    for (const auto& u : updates) applyUpdate(u, now);
    for (auto& s : sets) {
        drv::WriteResult wr;
        wr.id = s.writeId;
        wr.status = drv::WriteStatus::Failed;
        wr.code = "INVALID_VALUE";
        if (s.tag < model_.tags.size() && model_.tags[s.tag].kind == TagKind::Internal) {
            Candidate c;
            std::string why;
            if (convertToType(s.value, model_.tags[s.tag].type, c.value, why)) {
                c.quality = Quality::GOOD;
                c.sourceTs = now;
                commit(s.tag, std::move(c), now);
                wr.status = drv::WriteStatus::Confirmed;
                wr.code = "APPLIED";
            }
        }
        if (s.writeId != 0) results.push_back(std::move(wr));
    }
    for (const Calc& calc : calcs_) {
        bool any = first_;
        for (size_t in : calc.inputs)
            if (changed_[in]) any = true;
        if (any) evaluate(calc, now);
    }
    if (roundHook_) {
        Round round(*this, now);
        roundHook_(round);
        // calculated Tags that read a logic Tag the hook changed, in calculation order (a Tag
        // they change in turn counts for the ones after them)
        if (!round.touched.empty()) {
            std::vector<uint8_t> again(changed_.size(), 0);
            for (size_t t : round.touched) again[t] = 1;
            for (const Calc& calc : calcs_) {
                bool any = false;
                for (size_t in : calc.inputs)
                    if (again[in]) any = true;
                if (!any) continue;
                const uint8_t before = changed_[calc.tag];
                changed_[calc.tag] = 0;
                evaluate(calc, now);
                if (changed_[calc.tag]) again[calc.tag] = 1;
                changed_[calc.tag] = static_cast<uint8_t>(changed_[calc.tag] | before);
            }
        }
    }

    // everything that changed, in one lock
    std::vector<TagStore::Update> batch;
    for (size_t i = 0; i < changed_.size(); ++i) {
        if (!changed_[i]) continue;
        const State& s = state_[i];
        batch.push_back({i, s.value, s.quality, s.reason, s.sourceTs ? s.sourceTs : now, now});
    }
    if (!batch.empty()) store_.applyBatch(std::move(batch));
    first_ = false;

    if (retainObserver_)
        for (size_t i : retained_)
            if (changed_[i]) retainObserver_(i, state_[i].value);
    if (writeHandler_)
        for (const auto& r : results) writeHandler_(r);
}

}  // namespace mat
