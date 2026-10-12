// Calculated Tag dependency graph: the same cases as packages/expression graph.test.ts (T030).
#include "core/tag-engine/calc_graph.hpp"

#include <gtest/gtest.h>

using namespace mat;
using Ids = std::vector<std::string>;

namespace {
CalcInput c(const std::string& id, std::vector<std::string> inputs = {}) {
    return {id, std::move(inputs)};
}
std::vector<CalcInput> chain(int n) {
    std::vector<CalcInput> v;
    for (int i = 0; i < n; ++i)
        v.push_back(i == 0 ? c("T1", {"RAW"})
                           : c("T" + std::to_string(i + 1), {"T" + std::to_string(i)}));
    return v;
}
}  // namespace

TEST(CalcGraph, KahnTiesGoInTagsJsonOrder) {
    const CalcGraph g({c("C", {"B"}), c("B", {"A"}), c("D", {"X"}), c("E", {"X", "Y"})});
    EXPECT_TRUE(g.issues().empty());
    EXPECT_EQ(g.order(), (Ids{"B", "C", "D", "E"}));
}

TEST(CalcGraph, DeterministicOrder) {
    const std::vector<CalcInput> calcs = {c("K3", {"K1", "K2"}), c("K1", {"P"}), c("K2", {"K1"}),
                                          c("K4", {"P"})};
    EXPECT_EQ(CalcGraph(calcs).order(), CalcGraph(calcs).order());
    EXPECT_EQ(CalcGraph(calcs).order(), (Ids{"K1", "K2", "K3", "K4"}));
}

TEST(CalcGraph, IgnoresNonCalculatedAndDuplicateInputs) {
    const CalcGraph g({c("A", {"X", "X"}), c("B", {"A", "A"})});
    EXPECT_EQ(g.order(), (Ids{"A", "B"}));
}

TEST(CalcGraph, SelfReference) {
    const CalcGraph g({c("A", {"A"})});
    ASSERT_EQ(g.issues().size(), 1u);
    EXPECT_EQ(g.issues()[0].code, "E_EXPR_CYCLE");
    EXPECT_EQ(g.issues()[0].id, "A");
    EXPECT_EQ(g.issues()[0].message, "circular reference: A -> A");
    EXPECT_EQ(g.issues()[0].cycle, (Ids{"A", "A"}));
    EXPECT_TRUE(g.order().empty());
}

TEST(CalcGraph, TwoTagCycleIsReportedAtBothWithThePath) {
    const CalcGraph g({c("A", {"B"}), c("B", {"A"})});
    ASSERT_EQ(g.issues().size(), 2u);
    EXPECT_EQ(g.issues()[0].id, "A");
    EXPECT_EQ(g.issues()[1].id, "B");
    EXPECT_EQ(g.issues()[0].cycle, (Ids{"A", "B", "A"}));
    EXPECT_EQ(g.issues()[1].cycle, (Ids{"A", "B", "A"}));
    EXPECT_EQ(g.issues()[0].message, "circular reference: A -> B -> A");
}

TEST(CalcGraph, IndirectCycleOfThreeIsReportedAtEveryTag) {
    const CalcGraph g({c("X", {"Z"}), c("Y", {"X"}), c("Z", {"Y"}), c("OK", {"P"})});
    ASSERT_EQ(g.issues().size(), 3u);
    EXPECT_EQ(g.issues()[0].id, "X");
    EXPECT_EQ(g.issues()[1].id, "Y");
    EXPECT_EQ(g.issues()[2].id, "Z");
    EXPECT_EQ(g.issues()[0].cycle, (Ids{"X", "Z", "Y", "X"}));
    EXPECT_EQ(g.order(), (Ids{"OK"}));
}

TEST(CalcGraph, ATagThatMerelyDependsOnACycleIsNotReported) {
    const CalcGraph g({c("A", {"B"}), c("B", {"A"}), c("D", {"A"})});
    ASSERT_EQ(g.issues().size(), 2u);
    EXPECT_EQ(g.issues()[0].id, "A");
    EXPECT_EQ(g.issues()[1].id, "B");
}

TEST(CalcGraph, TwoSeparateCycles) {
    const CalcGraph g({c("A", {"B"}), c("B", {"A"}), c("M", {"N"}), c("N", {"M"})});
    ASSERT_EQ(g.issues().size(), 4u);
    EXPECT_EQ(g.issues()[0].id, "A");
    EXPECT_EQ(g.issues()[3].id, "N");
    EXPECT_EQ(g.issues()[2].cycle, (Ids{"M", "N", "M"}));
}

TEST(CalcGraph, SixteenLevelsAreValid) {
    const CalcGraph g(chain(16));
    EXPECT_TRUE(g.issues().empty());
    EXPECT_EQ(g.level("T1"), 1);
    EXPECT_EQ(g.level("T16"), 16);
}

TEST(CalcGraph, SeventeenLevelsIsDepthErrorAtTheSeventeenthTag) {
    const CalcGraph g(chain(17));
    ASSERT_EQ(g.issues().size(), 1u);
    EXPECT_EQ(g.issues()[0].code, "E_EXPR_DEPTH");
    EXPECT_EQ(g.issues()[0].id, "T17");
}

TEST(CalcGraph, LevelIsOnePlusTheDeepestCalculatedInput) {
    const CalcGraph g({c("A", {"RAW"}), c("B", {"A"}), c("C", {"A", "B"})});
    EXPECT_EQ(g.level("A"), 1);
    EXPECT_EQ(g.level("B"), 2);
    EXPECT_EQ(g.level("C"), 3);
    EXPECT_EQ(g.level("NOPE"), 0);
}

TEST(CalcGraph, DownstreamInCalculationOrder) {
    const CalcGraph g({c("B", {"A"}), c("C", {"B"}), c("D", {"A", "C"}), c("E", {"Z"})});
    EXPECT_EQ(g.downstream("A"), (Ids{"B", "C", "D"}));
    EXPECT_EQ(g.downstream("B"), (Ids{"C", "D"}));
    EXPECT_EQ(g.downstream("Z"), (Ids{"E"}));
    EXPECT_TRUE(g.downstream("D").empty());
    EXPECT_TRUE(g.downstream("NOPE").empty());
    EXPECT_EQ(g.downstreamIndex("A"), (std::vector<size_t>{0, 1, 2}));
}
