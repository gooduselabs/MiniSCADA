// Helpers of the unit tests of core/logic (the C++ halves of T126, T127): a harness from inline
// JSON, and the values of Tags as JSON (so that an expectation reads like the TS test it mirrors).
#pragma once
#include <memory>
#include <string>

#include "core/logic/harness.hpp"
#include "nlohmann/json.hpp"

namespace mat::logic::test {

using nlohmann::json;

inline TagInfo tagInfo(TagType t, const std::string& kind = "external", bool rw = false) {
    TagInfo i;
    i.type = t;
    i.kind = kind;
    i.rw = rw;
    return i;
}

inline std::unique_ptr<Harness> makeHarness(const json& doc, const TagInfoMap& tags,
                                            Config cfg = {}, const RetainMap* retain = nullptr,
                                            bool lost = false) {
    EngineOptions o;
    o.tags = tags;
    o.config = cfg;
    o.retain = retain;
    o.retainLost = lost;
    return std::make_unique<Harness>(doc, o);
}

inline json scalarJson(const TagScalar& v) {
    if (const bool* b = std::get_if<bool>(&v)) return *b;
    if (const int64_t* i = std::get_if<int64_t>(&v)) return *i;
    if (const uint64_t* u = std::get_if<uint64_t>(&v)) return *u;
    if (const double* d = std::get_if<double>(&v)) return *d;
    if (const std::string* s = std::get_if<std::string>(&v)) return *s;
    return nullptr;
}

// The value of a logic Tag, or of a stored Tag; "undefined" when neither.
inline json value(Harness& h, const std::string& tag) {
    if (const Output* o = h.output(tag)) return scalarJson(o->value);
    if (const auto* s = h.stored(tag)) return scalarJson(s->value);
    return "undefined";
}

inline void setB(Harness& h, const std::string& tag, bool v) { h.setGood(tag, TagScalar{v}); }
inline void setN(Harness& h, const std::string& tag, double v) { h.setGood(tag, TagScalar{v}); }
inline void setBad(Harness& h, const std::string& tag, TagScalar v = {}) {
    expr::InputValue iv;
    iv.value = std::move(v);
    iv.quality = Quality::BAD;
    iv.reason = "COMM";
    h.set(tag, iv);
}

}  // namespace mat::logic::test
