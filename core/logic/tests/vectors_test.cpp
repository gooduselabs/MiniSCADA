// The shared vectors of logic v2 (tests/logic-vectors, T125; SC-024, FR-092, FR-093): for every
// case the C++ validator (core/project-manager/rules_logic) gives the set of codes of the case, and
// the engine (core/logic) gives every `expect` of its steps, exactly as the TypeScript runner
// (packages/logic-engine/src/vectors.test.ts) does: the same actions in the same order, the same
// edgeId and result, the same outputs (doubles compared bit for bit), states and retained values.
#include <gtest/gtest.h>

#include <map>
#include <set>

#include "core/logic/tests/vector_runner.hpp"

using namespace mat::logic::test;
using nlohmann::json;

namespace {

const std::string kDir = std::string(MAT_SOURCE_DIR) + "/tests/logic-vectors";

const std::vector<std::pair<std::string, json>>& all() {
    static const auto v = loadVectors(kDir);
    return v;
}

std::vector<size_t> indexes() {
    std::vector<size_t> out;
    for (size_t i = 0; i < all().size(); ++i) out.push_back(i);
    return out;
}

}  // namespace

TEST(LogicVectors, AtLeast200CasesWithTheMinimumOfEachGroupAndUniqueIds) {
    const std::map<std::string, size_t> kMin = {
        {"rules", 40},     {"timers", 30}, {"counters", 25}, {"totalizers", 25}, {"runhours", 15},
        {"schedules", 40}, {"writes", 15}, {"static", 30},   {"retain", 10}};
    std::map<std::string, size_t> n;
    std::set<std::string> ids;
    for (const auto& [g, c] : all()) {
        ++n[g];
        EXPECT_TRUE(ids.insert(c["id"].get<std::string>()).second) << c["id"];
    }
    for (const auto& [g, min] : kMin) EXPECT_GE(n[g], min) << g;
    EXPECT_GE(all().size(), 200u);
    EXPECT_EQ(all().size(), 279u) << "the TS runner has 279 cases";
}

TEST(LogicVectors, EveryErrorCodeHasAFailingCaseAndEveryWarningACase) {
    std::set<std::string> errs, warns;
    for (const auto& [g, c] : all()) {
        for (const auto& e : c["expectErrors"]) errs.insert(e.get<std::string>());
        if (c.contains("expectWarnings"))
            for (const auto& w : c["expectWarnings"]) warns.insert(w.get<std::string>());
    }
    for (const char* code :
         {"E_LOGIC_LIMIT", "E_LOGIC_ID", "E_LOGIC_TAG_REF", "E_LOGIC_TYPE", "E_LOGIC_EXPR",
          "E_LOGIC_TAG_COLLISION", "E_LOGIC_CYCLE", "E_LOGIC_SELF_TRIGGER",
          "E_LOGIC_WRITE_UNDECLARED", "E_LOGIC_WRITE_TARGET", "E_LOGIC_WRITE_VALUE",
          "E_LOGIC_ACTION", "E_LOGIC_TIMER", "E_LOGIC_COUNTER", "E_LOGIC_TOTALIZER",
          "E_LOGIC_SCHEDULE", "E_LOGIC_VERSION"})
        EXPECT_TRUE(errs.count(code)) << code;
    for (const char* code : {"W_LOGIC_PT_ROUNDED", "W_LOGIC_WRITE_CONFLICT", "W_LOGIC_RETAIN_IO",
                             "W_LOGIC_WRITES_OFF", "W_LOGIC_NO_HOLD", "W_LOGIC_DISABLED"})
        EXPECT_TRUE(warns.count(code)) << code;
}

class LogicVector : public ::testing::TestWithParam<size_t> {};

TEST_P(LogicVector, SameAsTypeScript) {
    const auto& [group, c] = all()[GetParam()];
    const std::vector<std::string> errs = runCase(c);
    std::string text;
    for (const auto& e : errs) text += "\n  " + e;
    EXPECT_TRUE(errs.empty()) << group << "/" << c["id"].get<std::string>() << text;
}

INSTANTIATE_TEST_SUITE_P(All, LogicVector, ::testing::ValuesIn(indexes()),
                         [](const ::testing::TestParamInfo<size_t>& i) {
                             std::string n = all()[i.param].first + "_" +
                                             all()[i.param].second["id"].get<std::string>();
                             for (char& ch : n)
                                 if (!isalnum(static_cast<unsigned char>(ch))) ch = '_';
                             return n;
                         });

TEST(LogicVectors, WallClockParser) {
    EXPECT_EQ(parseWall("1970-01-01T00:00:00Z"), 0);
    EXPECT_EQ(parseWall("1970-01-01T07:00:00+07:00"), 0);
    EXPECT_EQ(parseWall("2026-10-19T05:59:00.5+07:00"), parseWall("2026-10-18T22:59:00.500Z"));
    EXPECT_THROW(parseWall("2026-10-19 05:59"), std::invalid_argument);
}
