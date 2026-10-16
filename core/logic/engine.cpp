#include "core/logic/engine.hpp"

#include <stdexcept>

#include "core/logic/counters.hpp"
#include "core/logic/runhours.hpp"
#include "core/logic/schedule.hpp"
#include "core/logic/timers.hpp"
#include "core/logic/totalizer.hpp"

namespace mat::logic {

using nlohmann::json;

namespace {

bool isExprValue(const json* v) {
    return v && v->is_object() && v->contains("expr") && (*v)["expr"].is_string();
}

std::vector<const json*> arrayOf(const json& doc, const char* key) {
    std::vector<const json*> out;
    const json* a = member(doc, key);
    if (!a || !a->is_array()) return out;
    for (const json& x : *a)
        if (x.is_object()) out.push_back(&x);
    return out;
}

}  // namespace

Engine::Engine(const json& doc, const EngineOptions& opt)
    : config_(opt.config), retainLost_(opt.retainLost) {
    tables_ = opt.tables ? opt.tables : &noTables_;
    const RetainMap* store = opt.retainLost ? nullptr : opt.retain;
    for (const LogicOutput& o : logicOutputs(doc))
        if (!outputDefs_.count(o.tag)) outputDefs_[o.tag] = o;
    const TagInfoMap& tags = opt.tags;
    LogicEnv env;
    env.tagType = [this, &tags](const std::string& id) -> std::optional<TagType> {
        const auto t = tags.find(id);
        if (t != tags.end()) return t->second.type;
        const auto o = outputDefs_.find(id);
        if (o != outputDefs_.end()) return o->second.type;
        return std::nullopt;
    };
    env.hasTable = [this](const std::string& name) { return tables_->count(name) > 0; };
    const auto ex = [&](const std::string& src, TagType t, const std::string& where) {
        return Expr(src, t, env, where);
    };
    const auto exOpt = [&](const json& b, const char* field,
                           const std::string& where) -> std::optional<Expr> {
        const auto s = stringOf(b, field);
        if (!s) return std::nullopt;
        return Expr(*s, TagType::BOOL, env, where);
    };

    std::map<std::string, WriteGate*> gates;
    for (const json* w : arrayOf(doc, "writes")) {
        gates_.push_back(std::make_unique<WriteGate>(*w));
        gates.emplace(gates_.back()->id(), gates_.back().get());
    }
    bucket_ = std::make_unique<Bucket>(config_.maxWritesPerMin);
    RuleEnv ruleEnv;
    ruleEnv.tables = tables_;
    ruleEnv.config = &config_;
    ruleEnv.bucket = bucket_.get();
    const auto compileActions = [&](const json& rule, const char* edge) {
        std::vector<CompiledAction> out;
        const json* list = member(rule, edge);
        if (!list || !list->is_array()) return out;
        for (size_t i = 0; i < list->size(); ++i) {
            const json& a = (*list)[i];
            const std::string where = blockId(rule) + "." + edge + "[" + std::to_string(i) + "]";
            CompiledAction c;
            c.doName = stringOf(a, "do").value_or("");
            WriteGate* gate = nullptr;
            if (const auto w = stringOf(a, "write")) {
                const auto g = gates.find(*w);
                if (g != gates.end()) gate = g->second;
            }
            if ((c.doName == "write" || c.doName == "pulse") && !gate)
                throw std::invalid_argument("logic: " + where + ": writes '" +
                                            stringOf(a, "write").value_or("") + "' không có");
            c.tag = gate ? gate->tag() : stringOf(a, "tag").value_or("");
            const auto t = tags.find(c.tag);
            if (t == tags.end())
                throw std::invalid_argument("logic: " + where + ": Tag '" + c.tag + "' không có");
            c.write = gate;
            if (const auto ms = numberOf(a, "ms")) c.ms = static_cast<int64_t>(*ms);
            const json* v = member(a, "value");
            if (isExprValue(v)) {
                c.expr.emplace((*v)["expr"].get<std::string>(), t->second.type, env, where);
            } else if (v) {
                c.hasValue = true;
                c.value = scalarOfJson(*v);
            }
            out.push_back(std::move(c));
        }
        return out;
    };

    const auto add = [&](std::unique_ptr<Block> b) {
        const std::string id = b->id();
        if (blocks_.count(id)) throw std::invalid_argument("logic: id '" + id + "' trùng");
        blocks_[id] = std::move(b);
    };
    for (const json* r : arrayOf(doc, "rules")) {
        const std::string id = blockId(*r);
        add(std::make_unique<RuleBlock>(
            *r, ex(stringOf(*r, "when").value_or(""), TagType::BOOL, id + ".when"),
            compileActions(*r, "onRise"), compileActions(*r, "onFall"), ruleEnv, store));
    }
    for (const json* t : arrayOf(doc, "timers")) {
        const std::string id = blockId(*t);
        add(std::make_unique<TimerBlock>(
            *t, ex(stringOf(*t, "in").value_or(""), TagType::BOOL, id + ".in"), config_.scanMs));
    }
    for (const json* c : arrayOf(doc, "counters")) {
        const std::string id = blockId(*c);
        add(std::make_unique<CounterBlock>(
            *c, ex(stringOf(*c, "up").value_or(""), TagType::BOOL, id + ".up"),
            exOpt(*c, "down", id + ".down"), exOpt(*c, "reset", id + ".reset"), store));
    }
    for (const json* z : arrayOf(doc, "totalizers")) {
        const std::string id = blockId(*z);
        add(std::make_unique<TotalizerBlock>(
            *z, ex(stringOf(*z, "source").value_or(""), TagType::FLOAT64, id + ".source"),
            exOpt(*z, "reset", id + ".reset"), store));
    }
    for (const json* h : arrayOf(doc, "runhours")) {
        const std::string id = blockId(*h);
        add(std::make_unique<RunhoursBlock>(
            *h, ex(stringOf(*h, "run").value_or(""), TagType::BOOL, id + ".run"),
            exOpt(*h, "reset", id + ".reset"), store));
    }
    for (const json* s : arrayOf(doc, "schedules")) add(std::make_unique<ScheduleBlock>(*s));

    const LogicGraph g = logicGraph(doc, env, outputDefs_);
    if (!g.cycles.empty()) {
        std::string what;
        for (const auto& c : g.cycles) {
            if (!what.empty()) what += "; ";
            for (size_t i = 0; i < c.size(); ++i) what += (i ? ", " : "") + c[i];
        }
        throw std::invalid_argument("logic: vòng phụ thuộc " + what);
    }
    for (const std::string& id : g.order) order_.push_back(blocks_.at(id).get());
    const SetOut init = [this](const std::string& tag, TagScalar v, const std::string& bad) {
        setOut(tag, std::move(v), bad);
    };
    for (Block* b : order_) b->init(init);
}

Engine::~Engine() = default;

void Engine::setOut(const std::string& tag, TagScalar value, const std::string& bad) {
    Output& o = outputs_[tag];
    o.value = std::move(value);
    o.good = bad.empty();
    o.reason = bad;
}

std::vector<ActionOut> Engine::step(int64_t now, const ReadTag& read, const WallClock& wall) {
    now_ = now;
    std::vector<ActionOut> actions;
    ScanCtx ctx;
    ctx.now = now;
    ctx.wall = &wall;
    ctx.tables = tables_;
    ctx.config = &config_;
    ctx.read = [this, &read](const std::string& id) -> expr::InputValue {
        const auto o = outputs_.find(id);
        if (o == outputs_.end()) return read(id);
        expr::InputValue v;
        v.value = o->second.value;
        v.quality = o->second.good ? Quality::GOOD : Quality::BAD;
        v.reason = o->second.reason;
        return v;
    };
    ctx.setOut = [this](const std::string& tag, TagScalar v, const std::string& bad) {
        setOut(tag, std::move(v), bad);
    };
    ctx.emit = [&actions](ActionOut&& a) { actions.push_back(std::move(a)); };
    for (Block* b : order_) b->step(ctx);
    return actions;
}

const Output* Engine::output(const std::string& tag) const {
    const auto it = outputs_.find(tag);
    return it == outputs_.end() ? nullptr : &it->second;
}

std::optional<BlockState> Engine::state(const std::string& id) const {
    const auto it = blocks_.find(id);
    if (it == blocks_.end()) return std::nullopt;
    return it->second->state(now_);
}

std::vector<std::string> Engine::blockIds() const {
    std::vector<std::string> out;
    for (const Block* b : order_) out.push_back(b->id());
    return out;
}

void Engine::writeResult(const std::string& rule, const std::string& result) {
    const auto it = blocks_.find(rule);
    if (it == blocks_.end()) return;
    if (auto* r = dynamic_cast<RuleBlock*>(it->second.get())) r->writeResult(result);
}

RetainMap Engine::retainSnapshot() const {
    RetainMap out;
    for (const Block* b : order_) b->retain(out);
    return out;
}

std::vector<std::string> Engine::inputsOf(const std::string& rule) const {
    const auto it = blocks_.find(rule);
    if (it == blocks_.end()) return {};
    if (const auto* r = dynamic_cast<const RuleBlock*>(it->second.get())) return r->when().inputs();
    return {};
}

bool Engine::reset(const std::string& id, double value) {
    const auto it = blocks_.find(id);
    if (it == blocks_.end()) return false;
    const SetOut so = [this](const std::string& tag, TagScalar v, const std::string& bad) {
        setOut(tag, std::move(v), bad);
    };
    return it->second->reset(value, so);
}

}  // namespace mat::logic
