// Fakes of the logic tests of the runtime (feature 011 T129, T130): the model of write_fakes with
// logic Tags, and one round of the Tag Engine as the logic subsystem sees it.
#pragma once
#include <string>
#include <utility>
#include <vector>

#include "core/tag-engine/engine.hpp"
#include "core/tag-engine/tests/write_fakes.hpp"

namespace mat::testing {

// The model of write_fakes (SP FLOAT32 RW 0..90, LEVEL_R, RUN BOOL RW, ...) plus the logic Tags.
inline ProjectModel logicModel(std::vector<std::pair<std::string, TagType>> logicTags = {
                                   {"L.T", TagType::BOOL}}) {
    ProjectModel m = makeModel();
    for (const auto& [id, type] : logicTags) {
        TagModel t;
        t.id = id;
        t.kind = TagKind::Internal;
        t.type = type;
        t.writable = false;
        t.logicOwned = true;
        m.tags.push_back(t);
    }
    return m;
}

// One round of the engine: values by model index, what logic publishes and sets.
struct FakeRound : EngineRound {
    explicit FakeRound(const ProjectModel& m) : vals(m.tags.size()) {
        for (auto& v : vals) {
            v.quality = Quality::BAD;
            v.reason = "NO_VALUE";
        }
    }
    expr::InputValue read(size_t tag) const override { return vals.at(tag); }
    void publish(size_t tag, TagScalar value, Quality q, const std::string& reason) override {
        vals.at(tag).value = std::move(value);
        vals.at(tag).quality = q;
        vals.at(tag).reason = reason;
        ++published;
    }
    void setInternal(size_t tag, TagScalar value) override { sets.emplace_back(tag, value); }
    int64_t now() const override { return t; }
    void good(size_t tag, TagScalar v) {
        vals.at(tag).value = std::move(v);
        vals.at(tag).quality = Quality::GOOD;
        vals.at(tag).reason.clear();
    }
    std::vector<expr::InputValue> vals;
    std::vector<std::pair<size_t, TagScalar>> sets;
    int published = 0;
    int64_t t = 0;
};

}  // namespace mat::testing
