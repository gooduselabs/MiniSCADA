// Rules of the 0.4 validator (feature 008, contracts/project-format-0.4.md §5-§6) on small
// projects built from the vector v04-valid-full: one change per test, the codes and paths that the
// TypeScript twin reports (packages/project-schema/src/rules-04.test.ts). The shared vectors
// (vectors_04_test.cpp) cover the same rules case by case.
#include <gtest/gtest.h>

#include <filesystem>
#include <fstream>
#include <set>

#include "core/project-manager/project_validator.hpp"
#include "nlohmann/json.hpp"

using namespace mat;
using nlohmann::json;
namespace fs = std::filesystem;

namespace {

const std::string kRoot = std::string(MAT_SOURCE_DIR);
const std::string kSchemas = kRoot + "/schemas";
const char* const kBinding = "screens/main.svg1.bindings.json";

json readJson(const fs::path& p) {
    std::ifstream in(p, std::ios::binary);
    return json::parse(in);
}

class Project04 : public ::testing::Test {
   protected:
    void SetUp() override {
        dir_ = fs::temp_directory_path() / ("mat-rules04-" + std::to_string(counter_++));
        fs::remove_all(dir_);
        fs::copy(kRoot + "/tests/project-vectors/v04-valid-full", dir_,
                 fs::copy_options::recursive);
    }
    void TearDown() override { fs::remove_all(dir_); }

    json bindings() const { return readJson(dir_ / kBinding); }
    void setBindings(const json& b) const {
        std::ofstream(dir_ / kBinding, std::ios::binary | std::ios::trunc) << b.dump(2);
    }
    // Replace the elements of the binding file by one element el_aaa.
    void setElement(json element) const {
        json b = bindings();
        element["elementUid"] = "el_aaa";
        b["elements"] = json::array({std::move(element)});
        setBindings(b);
    }
    void setBinding(json binding) const {
        setElement({{"bindings", json::array({std::move(binding)})}});
    }
    void setEvent(const json& click) const { setElement({{"events", {{"click", click}}}}); }

    ProjectValidation run(const std::string& runtime = kRuntimeVersion) const {
        return validateProject(dir_.string(), kSchemas, runtime);
    }
    static std::set<std::string> codes(const std::vector<ProjectIssue>& l) {
        std::set<std::string> s;
        for (const auto& i : l) s.insert(i.code);
        return s;
    }
    static bool has(const std::vector<ProjectIssue>& l, const std::string& code,
                    const std::string& path) {
        for (const auto& i : l)
            if (i.code == code && i.path == path) return true;
        return false;
    }

    static json bind(const std::string& id, const std::string& target, const std::string& tag,
                     json transform, json extra = json::object()) {
        json b = {{"id", id},
                  {"target", target},
                  {"source", {{"type", "tag"}, {"tagId", tag}}},
                  {"transform", std::move(transform)}};
        for (auto it = extra.begin(); it != extra.end(); ++it) b[it.key()] = it.value();
        return b;
    }
    static json direct() { return {{"kind", "direct"}}; }

    fs::path dir_;
    static inline int counter_ = 0;
};

}  // namespace

TEST_F(Project04, FullVectorIsValidAndIsFormat04) {
    const auto r = run();
    ASSERT_TRUE(r.valid) << resultJson(r);
    EXPECT_TRUE(r.project->is02());
    EXPECT_TRUE(r.project->is03());
    EXPECT_STREQ(kRuntimeVersion, "0.7.0");
}

TEST_F(Project04, MinRuntimeBelow07IsE_MIN_RUNTIME) {
    json p = readJson(dir_ / "project.json");
    p["minRuntimeVersion"] = "0.6.0";
    std::ofstream(dir_ / "project.json", std::ios::binary | std::ios::trunc) << p.dump(2);
    const auto r = run();
    EXPECT_TRUE(has(r.errors, "E_MIN_RUNTIME", "/minRuntimeVersion")) << resultJson(r);
}

TEST_F(Project04, MinRuntimeAboveTheRuntimeIsTooOld) {
    const auto r = run("0.6.0");
    EXPECT_TRUE(codes(r.errors).count("E_RUNTIME_TOO_OLD")) << resultJson(r);
}

TEST_F(Project04, TransformNotAllowedForTheTarget) {
    setBinding(bind("b1", "style.fill", "TANK01.LEVEL",
                    {{"kind", "linearScale"}, {"inMin", 0}, {"inMax", 100}, {"outMin", 0},
                     {"outMax", 1}}));
    const auto r = run();
    EXPECT_TRUE(has(r.errors, "E_BIND_TRANSFORM", "/elements/0/bindings/0/transform/kind"))
        << resultJson(r);
}

TEST_F(Project04, ParameterOfAnotherTargetIsE_BIND_PARAM) {
    setBinding(bind("b1", "style.opacity", "TANK01.LEVEL", direct(), {{"period", 1000}}));
    const auto r = run();
    EXPECT_TRUE(has(r.errors, "E_BIND_PARAM", "/elements/0/bindings/0/period")) << resultJson(r);
}

TEST_F(Project04, ParameterBoundaries) {
    auto blink = [&](json extra) {
        setElement({{"bindings",
                     json::array({bind("b1", "effect.blink", "PUMP01.FAULT", direct(), extra),
                                  bind("b2", "text.content", "PUMP01.FAULT", direct())})}});
        return run();
    };
    EXPECT_TRUE(blink({{"period", 400}}).valid);
    EXPECT_TRUE(blink({{"period", 5000}}).valid);
    EXPECT_TRUE(has(blink({{"period", 399}}).errors, "E_BIND_PARAM", "/elements/0/bindings/0/period"));
    EXPECT_TRUE(has(blink({{"period", 5001}}).errors, "E_BIND_PARAM", "/elements/0/bindings/0/period"));
    EXPECT_TRUE(blink({{"minOpacity", 0.9}}).valid);
    EXPECT_FALSE(blink({{"minOpacity", 0.91}}).valid);
    // fill/stroke mode needs a color
    EXPECT_TRUE(has(blink({{"mode", "fill"}}).errors, "E_BIND_PARAM", "/elements/0/bindings/0/color"));
    EXPECT_TRUE(blink({{"mode", "fill"}, {"color", "#ff0000"}}).valid);
    EXPECT_FALSE(blink({{"mode", "fill"}, {"color", "red;x"}}).valid);
}

TEST_F(Project04, DashAndSpeedOfFlow) {
    auto flow = [&](json extra) {
        setBinding(bind("b1", "effect.flow", "PUMP01.RUN_CMD", direct(), extra));
        return run();
    };
    EXPECT_TRUE(flow({{"dash", "12 8"}, {"speed", 300}}).valid);
    EXPECT_FALSE(flow({{"speed", 301}}).valid);
    EXPECT_FALSE(flow({{"dash", "0 0"}}).valid);
    EXPECT_FALSE(flow({{"dash", "4,4"}}).valid);
    EXPECT_FALSE(flow({{"dash", "1 2 3 4 5 6 7 8 9"}}).valid);
    EXPECT_TRUE(flow({{"dash", "1 2 3 4 5 6 7 8"}}).valid);
}

TEST_F(Project04, ReverseOfRotateNeedsSpin) {
    setBinding(bind("b1", "transform.rotate", "TANK01.LEVEL", direct(), {{"reverse", true}}));
    EXPECT_TRUE(has(run().errors, "E_BIND_PARAM", "/elements/0/bindings/0/reverse"));
    setBinding(bind("b1", "transform.rotate", "TANK01.LEVEL", direct(),
                    {{"reverse", true}, {"animation", "spin"}}));
    EXPECT_TRUE(run().valid);
}

TEST_F(Project04, RangeMapOverlapAndCount) {
    json ranges = json::array({{{"from", 0}, {"to", 10}, {"value", "a"}},
                               {{"from", 5}, {"to", 15}, {"value", "b"}}});
    setBinding(bind("b1", "text.content", "TANK01.LEVEL",
                    {{"kind", "rangeMap"}, {"ranges", ranges}}));
    auto r = run();
    EXPECT_TRUE(has(r.errors, "E_RANGE", "/elements/0/bindings/0/transform/ranges/1"))
        << resultJson(r);
    ranges = json::array({{{"from", 5}, {"to", 5}, {"value", "a"}}});
    setBinding(bind("b1", "text.content", "TANK01.LEVEL",
                    {{"kind", "rangeMap"}, {"ranges", ranges}}));
    EXPECT_TRUE(has(run().errors, "E_RANGE", "/elements/0/bindings/0/transform/ranges/0"));
    ranges = json::array();
    for (int i = 0; i < 65; ++i)
        ranges.push_back({{"from", i}, {"to", i + 1}, {"value", "v"}});
    setBinding(bind("b1", "text.content", "TANK01.LEVEL",
                    {{"kind", "rangeMap"}, {"ranges", ranges}}));
    EXPECT_TRUE(has(run().errors, "E_RANGE", "/elements/0/bindings/0/transform/ranges"));
    ranges.erase(ranges.size() - 1);
    setBinding(bind("b1", "text.content", "TANK01.LEVEL",
                    {{"kind", "rangeMap"}, {"ranges", ranges}}));
    EXPECT_TRUE(run().valid);
}

TEST_F(Project04, TwoBindingsOfTheSameGroupOnOneElement) {
    setElement({{"bindings", json::array({bind("b1", "geometry.levelPercent", "TANK01.LEVEL",
                                                direct()),
                                          bind("b2", "geometry.clipLevel", "TANK01.LEVEL",
                                               direct())})}});
    EXPECT_TRUE(has(run().errors, "E_DUP_BINDING", "/elements/0/bindings/1/target"));
}

TEST_F(Project04, TagTypeAgainstTheTarget) {
    setBinding(bind("b1", "style.opacity", "PUMP01.NAME",
                    {{"kind", "discreteMap"}, {"cases", json::array({{{"equals", "a"}, {"value", 1}}})}}));
    EXPECT_TRUE(has(run().errors, "E_TYPE_MISMATCH", "/elements/0/bindings/0/source/tagId"));
    setBinding(bind("b1", "style.visibility", "TANK01.LEVEL", direct()));
    EXPECT_TRUE(has(run().errors, "E_TYPE_MISMATCH", "/elements/0/bindings/0/source/tagId"));
    setBinding(bind("b1", "style.visibility", "PUMP01.FAULT", direct()));
    EXPECT_TRUE(run().valid);
}

TEST_F(Project04, BlinkAloneWarns) {
    setBinding(bind("b1", "effect.blink", "PUMP01.FAULT", direct()));
    const auto r = run();
    ASSERT_TRUE(r.valid) << resultJson(r);
    EXPECT_TRUE(has(r.warnings, "W_BLINK_ONLY", "/elements/0/bindings/0"));
}

TEST_F(Project04, ElementWithOnlyEventsIsValid) {
    setEvent({{"action", "closePopup"}});
    EXPECT_TRUE(run().valid);
}

TEST_F(Project04, EventActionShape) {
    setEvent({{"action", "toggle"}});
    EXPECT_TRUE(has(run().errors, "E_EVENT_ACTION", "/elements/0/events/click"));
    setEvent({{"action", "navigate"}, {"screen", "main"}, {"tag", "PUMP01.RUN_CMD"}});
    EXPECT_TRUE(has(run().errors, "E_EVENT_ACTION", "/elements/0/events/click/tag"));
    setEvent({{"action", "pulse"}, {"tag", "PUMP01.RUN_CMD"}, {"value", true},
              {"durationMs", 99}});
    EXPECT_TRUE(has(run().errors, "E_EVENT_ACTION", "/elements/0/events/click/durationMs"));
    setEvent({{"action", "pulse"}, {"tag", "PUMP01.RUN_CMD"}, {"value", true},
              {"durationMs", 100}});
    EXPECT_TRUE(run().valid);
}

TEST_F(Project04, EventTagMustBeWritable) {
    setEvent({{"action", "toggle"}, {"tag", "PUMP01.FAULT"}});
    EXPECT_TRUE(has(run().errors, "E_EVENT_TAG", "/elements/0/events/click/tag"));
    setEvent({{"action", "write"}, {"tag", "TANK01.SP"}, {"value", 90.5}});
    EXPECT_TRUE(has(run().errors, "E_EVENT_TAG", "/elements/0/events/click/value"));
    setEvent({{"action", "write"}, {"tag", "TANK01.SP"}, {"value", 90}});
    EXPECT_TRUE(run().valid);
}

TEST_F(Project04, EventTargetScreenAndKind) {
    setEvent({{"action", "popup"}, {"screen", "main"}});
    EXPECT_TRUE(has(run().errors, "E_EVENT_TARGET", "/elements/0/events/click/screen"));
    setEvent({{"action", "navigate"}, {"screen", "nowhere"}});
    EXPECT_TRUE(has(run().errors, "E_EVENT_TARGET", "/elements/0/events/click/screen"));
    setEvent({{"action", "popup"}, {"screen", "pump"}});
    EXPECT_TRUE(run().valid);
}

TEST_F(Project04, EventConfirmAndMinRole) {
    setEvent({{"action", "write"}, {"tag", "TANK01.SP"}, {"value", 10}, {"confirm", "none"}});
    EXPECT_TRUE(has(run().errors, "E_EVENT_CONFIRM", "/elements/0/events/click/confirm"));
    setEvent({{"action", "toggle"}, {"tag", "PUMP01.RUN_CMD"}, {"confirm", "none"}});
    auto r = run();
    ASSERT_TRUE(r.valid) << resultJson(r);
    EXPECT_TRUE(has(r.warnings, "W_EVENT_CONFIRM_NONE", "/elements/0/events/click/confirm"));
    setEvent({{"action", "toggle"}, {"tag", "PUMP01.RUN_CMD"}, {"minRole", "viewer"}});
    EXPECT_TRUE(has(run().errors, "E_EVENT_MINROLE", "/elements/0/events/click/minRole"));
}

TEST_F(Project04, PulseOnATagThatReadsBackWarns) {
    setEvent({{"action", "pulse"}, {"tag", "PUMP02.CMD"}, {"value", true}, {"durationMs", 500}});
    const auto r = run();
    ASSERT_TRUE(r.valid) << resultJson(r);
    EXPECT_TRUE(has(r.warnings, "W_EVENT_PULSE_READBACK", "/elements/0/events/click"));
}

TEST_F(Project04, EventOnAnUnknownElementIsE_REF_UID) {
    json b = bindings();
    b["elements"] = json::array({{{"elementUid", "el_zzz"},
                                  {"events", {{"click", {{"action", "closePopup"}}}}}}});
    setBindings(b);
    EXPECT_TRUE(has(run().errors, "E_REF_UID", "/elements/0/elementUid"));
}

TEST_F(Project04, SvgItemLimitIs64) {
    json s = readJson(dir_ / "screens/main.screen.json");
    json svg = s["items"][0];
    json items = json::array({svg});
    for (int i = 1; i < 65; ++i) {
        json it = svg;
        it["id"] = "svg" + std::to_string(i + 1);
        it["bindingFile"] = "screens/main.svg" + std::to_string(i + 1) + ".bindings.json";
        items.push_back(it);
        json b = bindings();
        b["itemId"] = it["id"];
        std::ofstream(dir_ / it["bindingFile"].get<std::string>(), std::ios::binary) << b.dump(2);
    }
    s["items"] = items;
    std::ofstream(dir_ / "screens/main.screen.json", std::ios::binary | std::ios::trunc) << s.dump(2);
    EXPECT_TRUE(has(run().errors, "E_LIMIT", "/items"));
    items.erase(items.size() - 1);
    s["items"] = items;
    std::ofstream(dir_ / "screens/main.screen.json", std::ios::binary | std::ios::trunc) << s.dump(2);
    const auto r = run();
    EXPECT_FALSE(has(r.errors, "E_LIMIT", "/items")) << resultJson(r);
}
