// computeAccess and access.json (feature 013, contracts/access-model.md §1.2, §3 to §5), on cases
// written here; the shared vectors run in access_vectors_test.cpp.
#include "core/auth/access_model.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <string>
#include <vector>

namespace mat {
namespace {

using nlohmann::json;
using Strings = std::vector<std::string>;

CatalogItem item(const std::string& id, bool operable, Strings tags, Role view = Role::Viewer,
                 Role operate = Role::Operator) {
    CatalogItem i;
    i.id = id;
    i.operable = operable;
    i.tags = std::move(tags);
    i.view = view;
    i.operate = operate;
    return i;
}

// tong-quan (chay-bom: control, chi-phi: display), bao-tri (only Tag M1, and P1 shared with
// tong-quan), popup bom-1; a logging group, a report, three alarms (one without a Tag).
ResourceCatalog demo() {
    ResourceCatalog c;
    CatalogScreen tq;
    tq.id = "tong-quan";
    tq.items = {item("chay-bom", true, {"PUMP01.RUN_CMD"}), item("chi-phi", false, {"E1.COST"}),
                item("ap-suat", false, {"P1"})};
    CatalogScreen bt;
    bt.id = "bao-tri";
    bt.items = {item("may", false, {"M1", "P1"})};
    CatalogScreen popup;
    popup.id = "bom-1";
    popup.popup = true;
    popup.items = {item("sw", true, {"PUMP01.RUN_CMD"})};
    c.screens = {tq, bt, popup};
    c.historyGroups = {{"ap-suat", {"P1", "P2"}, ""}};
    c.reports = {{"dien-ngay", {"E1.KWH"}, ""}};
    c.alarms = {{"P1_HIGH", "P1"}, {"M1_FAULT", "M1"}, {"PLC1_LINK", ""}};
    return c;
}

Principal who(std::optional<std::string> user, Role role, Strings groups = {}) {
    Principal p;
    p.user = std::move(user);
    p.role = role;
    p.groups = std::move(groups);
    return p;
}

AccessRule rule(const std::string& resource, AccessLevel level, Strings grantees) {
    AccessRule r;
    r.resource = resource;
    r.level = level;
    r.grantees = std::move(grantees);
    return r;
}

AccessFile store(std::vector<AccessRule> rules, std::vector<AccessGroup> groups = {}) {
    AccessFile f;
    f.rev = 7;
    f.groups = std::move(groups);
    f.rules = std::move(rules);
    return f;
}

bool has(const Strings& v, const std::string& s) {
    return std::find(v.begin(), v.end(), s) != v.end();
}

TEST(AccessModel, DefaultsLetEveryAccountSeeAndOnlyOperatorsOperate) {
    const ResourceCatalog c = demo();
    const EffectiveAccess v = computeAccess(c, store({}), who("vh1", Role::Viewer));
    EXPECT_EQ(v.screens, (Strings{"tong-quan", "bao-tri", "bom-1"}));
    EXPECT_TRUE(v.hiddenItems.empty());
    // a viewer sees the control but may not operate it
    ASSERT_EQ(v.lockedItems.count("tong-quan"), 1u);
    EXPECT_EQ(v.lockedItems.at("tong-quan"), Strings{"chay-bom"});
    EXPECT_EQ(v.lockedItems.at("bom-1"), Strings{"sw"});
    EXPECT_FALSE(v.canOperate("tong-quan", "chay-bom"));
    // page:watch is the operator's by default (§3)
    EXPECT_EQ(v.pages, (Strings{"alarms", "history", "reports"}));
    EXPECT_FALSE(v.admin);

    const EffectiveAccess op = computeAccess(c, store({}), who("vh2", Role::Operator));
    EXPECT_TRUE(op.lockedItems.empty());
    EXPECT_TRUE(op.canOperate("tong-quan", "chay-bom"));
    EXPECT_EQ(op.pages, (Strings{"alarms", "history", "reports", "watch"}));
    EXPECT_EQ(op.liveTags, (Strings{"E1.COST", "M1", "P1", "PUMP01.RUN_CMD"}));
}

TEST(AccessModel, ProjectDefaultsAreMinimumRoles) {
    ResourceCatalog c = demo();
    c.screens[1].view = Role::Engineer;              // bao-tri: engineers and up
    c.screens[0].items[1].view = Role::Operator;     // chi-phi: operators and up
    c.screens[0].items[0].operate = Role::Engineer;  // chay-bom: engineers operate
    const EffectiveAccess op = computeAccess(c, store({}), who("vh2", Role::Operator));
    EXPECT_FALSE(op.canViewScreen("bao-tri"));
    EXPECT_FALSE(op.liveTag("M1"));
    EXPECT_TRUE(op.liveTag("P1"));  // also on tong-quan
    EXPECT_TRUE(op.canViewItem("tong-quan", "chi-phi"));
    EXPECT_EQ(op.lockedItems.at("tong-quan"), Strings{"chay-bom"});
    const EffectiveAccess vw = computeAccess(c, store({}), who("vh1", Role::Viewer));
    EXPECT_EQ(vw.hiddenItems.at("tong-quan"), Strings{"chi-phi"});
    EXPECT_FALSE(vw.liveTag("E1.COST"));
}

TEST(AccessModel, GroupRuleOnAScreenNarrowsItToTheGroup) {
    const ResourceCatalog c = demo();
    const AccessFile s = store({rule("screen:bao-tri", AccessLevel::View, {"group:bao-tri"})},
                               {{"bao-tri", "Bảo trì"}, {"ca-a", "Ca A"}});
    const EffectiveAccess out = computeAccess(c, s, who("vh1", Role::Operator, {"ca-a"}));
    EXPECT_FALSE(out.canViewScreen("bao-tri"));
    EXPECT_FALSE(has(out.screens, "bao-tri"));
    EXPECT_FALSE(out.liveTag("M1"));
    EXPECT_TRUE(out.liveTag("P1"));  // used on tong-quan too (edge case of the spec)
    EXPECT_FALSE(out.canViewItem("bao-tri", "may"));
    EXPECT_EQ(out.hiddenItems.count("bao-tri"), 0u);  // only screens that are viewed
    const EffectiveAccess in = computeAccess(c, s, who("vh3", Role::Viewer, {"ca-a", "bao-tri"}));
    EXPECT_TRUE(in.canViewScreen("bao-tri"));
    EXPECT_TRUE(in.liveTag("M1"));
}

TEST(AccessModel, EveryKindOfGranteeMatches) {
    const Principal p = who("vh1", Role::Engineer, {"ca-a"});
    EXPECT_TRUE(granteeMatches(p, "*"));
    EXPECT_TRUE(granteeMatches(p, "user:vh1"));
    EXPECT_FALSE(granteeMatches(p, "user:vh2"));
    EXPECT_TRUE(granteeMatches(p, "group:ca-a"));
    EXPECT_FALSE(granteeMatches(p, "group:ca-b"));
    EXPECT_TRUE(granteeMatches(p, "role:viewer"));
    EXPECT_TRUE(granteeMatches(p, "role:engineer"));
    EXPECT_FALSE(granteeMatches(p, "role:administrator"));
    EXPECT_FALSE(granteeMatches(p, "role:nobody"));
    EXPECT_FALSE(granteeMatches(p, "group:"));
    const Principal anon = who(std::nullopt, Role::Viewer);
    EXPECT_FALSE(granteeMatches(anon, "*"));  // "*" is everybody signed in
    EXPECT_TRUE(granteeMatches(anon, "role:viewer"));
}

TEST(AccessModel, ARuleNeverGoesAboveTheRole) {
    const ResourceCatalog c = demo();
    const AccessFile s =
        store({rule("item:tong-quan/chay-bom", AccessLevel::Operate, {"user:vh1", "*"})});
    // a viewer named in an operate rule still cannot operate (FR-022, US3 7)
    EXPECT_FALSE(computeAccess(c, s, who("vh1", Role::Viewer)).canOperate("tong-quan", "chay-bom"));
    EXPECT_TRUE(
        computeAccess(c, s, who("vh1", Role::Operator)).canOperate("tong-quan", "chay-bom"));
    // nor above the project's default
    ResourceCatalog high = demo();
    high.screens[0].items[0].operate = Role::Engineer;
    EXPECT_FALSE(
        computeAccess(high, s, who("vh1", Role::Operator)).canOperate("tong-quan", "chay-bom"));
    EXPECT_TRUE(
        computeAccess(high, s, who("vh1", Role::Engineer)).canOperate("tong-quan", "chay-bom"));
}

TEST(AccessModel, AnItemNeedsItsScreenAndOperateNeedsView) {
    const ResourceCatalog c = demo();
    // operate granted, view refused: no operate either
    const AccessFile s =
        store({rule("item:tong-quan/chay-bom", AccessLevel::View, {"user:quan-doc"}),
               rule("item:tong-quan/chay-bom", AccessLevel::Operate, {"*"})});
    const EffectiveAccess v = computeAccess(c, s, who("vh1", Role::Operator));
    EXPECT_FALSE(v.canViewItem("tong-quan", "chay-bom"));
    EXPECT_FALSE(v.canOperate("tong-quan", "chay-bom"));
    EXPECT_EQ(v.hiddenItems.at("tong-quan"), Strings{"chay-bom"});
    EXPECT_EQ(v.lockedItems.count("tong-quan"), 0u);  // hidden, not locked
    EXPECT_TRUE(v.liveTag("PUMP01.RUN_CMD"));         // the popup still shows the Tag
    // the screen refused: the items go with it, even with a rule of their own
    const AccessFile s2 = store({rule("screen:tong-quan", AccessLevel::View, {}),
                                 rule("item:tong-quan/ap-suat", AccessLevel::View, {"*"})});
    const EffectiveAccess v2 = computeAccess(c, s2, who("vh1", Role::Operator));
    EXPECT_FALSE(v2.canViewItem("tong-quan", "ap-suat"));
    EXPECT_FALSE(v2.liveTag("E1.COST"));
    EXPECT_TRUE(v2.liveTag("P1"));  // bao-tri uses it
}

TEST(AccessModel, EmptyGranteesMeanNobodyButAdministrators) {
    const ResourceCatalog c = demo();
    const AccessFile s = store({rule("page:alarms", AccessLevel::View, {})});
    EXPECT_FALSE(computeAccess(c, s, who("vh1", Role::Engineer)).canViewPage("alarms"));
    const EffectiveAccess a = computeAccess(c, s, who("admin", Role::Administrator));
    EXPECT_TRUE(a.canViewPage("alarms"));
    EXPECT_TRUE(a.admin);
}

TEST(AccessModel, OrphanRulesAreListedAndGiveNothing) {
    const ResourceCatalog c = demo();
    const AccessFile s = store({
        rule("screen:da-xoa", AccessLevel::View, {"*"}),
        rule("item:tong-quan/chay-bom-1", AccessLevel::View, {"*"}),
        rule("item:tong-quan/chi-phi", AccessLevel::Operate, {"*"}),  // display only
        rule("history:khong-co", AccessLevel::View, {}),
        rule("page:alarms", AccessLevel::Operate, {}),
        rule("screen:bao-tri", AccessLevel::View, {"*"}),
    });
    const std::vector<ResourceLevel> o = orphanRules(c, s);
    ASSERT_EQ(o.size(), 5u);
    EXPECT_EQ(o[0].resource, "history:khong-co");
    EXPECT_EQ(o[1].resource, "item:tong-quan/chay-bom-1");
    EXPECT_EQ(o[2].resource, "item:tong-quan/chi-phi");
    EXPECT_EQ(o[2].level, AccessLevel::Operate);
    EXPECT_EQ(o[3].resource, "page:alarms");
    EXPECT_EQ(o[4].resource, "screen:da-xoa");
    const EffectiveAccess v = computeAccess(c, s, who("vh1", Role::Operator));
    EXPECT_EQ(v.orphans, o);
    EXPECT_TRUE(v.canViewPage("alarms"));  // the orphan of level operate does not apply to view
    EXPECT_TRUE(v.canViewItem("tong-quan", "chi-phi"));
}

TEST(AccessModel, AnonymousIsAViewerWithoutAName) {
    const ResourceCatalog c = demo();
    const AccessFile s = store({rule("screen:bao-tri", AccessLevel::View, {"*"}),
                                rule("screen:tong-quan", AccessLevel::View, {"role:viewer"})});
    const EffectiveAccess v = computeAccess(c, s, who(std::nullopt, Role::Viewer));
    EXPECT_TRUE(v.anonymous);
    EXPECT_FALSE(v.canViewScreen("bao-tri"));
    EXPECT_TRUE(v.canViewScreen("tong-quan"));
    const json j = effectiveAccessJson(v);
    EXPECT_TRUE(j["user"].is_null());
    EXPECT_EQ(j["anonymous"], true);
}

TEST(AccessModel, AdministratorSeesEverything) {
    ResourceCatalog c = demo();
    c.screens[1].view = Role::Administrator;
    const AccessFile s = store({rule("screen:tong-quan", AccessLevel::View, {}),
                                rule("item:bom-1/sw", AccessLevel::Operate, {})});
    const EffectiveAccess a = computeAccess(c, s, who("admin", Role::Administrator));
    EXPECT_EQ(a.screens, (Strings{"tong-quan", "bao-tri", "bom-1"}));
    EXPECT_TRUE(a.hiddenItems.empty());
    EXPECT_TRUE(a.lockedItems.empty());
    EXPECT_EQ(a.pages, (Strings{"alarms", "history", "reports", "watch"}));
    EXPECT_TRUE(a.canOperate("bom-1", "sw"));
    EXPECT_EQ(a.alarms, (Strings{"M1_FAULT", "P1_HIGH", "PLC1_LINK"}));
    EXPECT_TRUE(a.historyTag("P2"));
    EXPECT_TRUE(a.historyTag("E1.KWH"));
}

TEST(AccessModel, HistoryAndReportsNeedTheirPage) {
    const ResourceCatalog c = demo();
    const EffectiveAccess v = computeAccess(c, store({}), who("vh1", Role::Viewer));
    EXPECT_EQ(v.historyTags, (Strings{"E1.COST", "E1.KWH", "M1", "P1", "P2", "PUMP01.RUN_CMD"}));
    EXPECT_FALSE(v.liveTag("P2"));  // history only
    const AccessFile s = store({rule("page:history", AccessLevel::View, {"group:x"}),
                                rule("report:dien-ngay", AccessLevel::View, {"group:x"})},
                               {{"x", "X"}});
    const EffectiveAccess w = computeAccess(c, s, who("vh1", Role::Viewer));
    EXPECT_FALSE(w.historyTag("P2"));
    EXPECT_FALSE(w.historyTag("E1.KWH"));
    EXPECT_TRUE(w.historyTag("P1"));  // live Tags are always history Tags
    EXPECT_EQ(w.pages, (Strings{"alarms", "reports"}));
    const EffectiveAccess x = computeAccess(c, s, who("vh1", Role::Viewer, {"x"}));
    EXPECT_TRUE(x.historyTag("P2"));
    EXPECT_TRUE(x.historyTag("E1.KWH"));
}

TEST(AccessModel, AlarmsFollowTheLiveTags) {
    const ResourceCatalog c = demo();
    const AccessFile s = store({rule("screen:bao-tri", AccessLevel::View, {})});
    const EffectiveAccess v = computeAccess(c, s, who("vh1", Role::Operator));
    EXPECT_EQ(v.alarms, (Strings{"P1_HIGH", "PLC1_LINK"}));
    EXPECT_TRUE(v.alarmAllowed("P1_HIGH.HH"));
    EXPECT_FALSE(v.alarmAllowed("M1_FAULT"));
    // an alarm without a Tag goes with the page of the alarms
    const AccessFile s2 = store({rule("page:alarms", AccessLevel::View, {})});
    const EffectiveAccess w = computeAccess(c, s2, who("vh1", Role::Operator));
    EXPECT_FALSE(w.alarmAllowed("PLC1_LINK"));
    EXPECT_TRUE(w.alarmAllowed("M1_FAULT"));
}

TEST(AccessModel, ADamagedStoreLetsOnlyAdministratorsIn) {
    const ResourceCatalog c = demo();
    const EffectiveAccess v = computeAccess(c, store({}), who("vh1", Role::Engineer), false);
    EXPECT_TRUE(v.screens.empty());
    EXPECT_TRUE(v.pages.empty());
    EXPECT_TRUE(v.liveTags.empty());
    EXPECT_TRUE(v.alarms.empty());
    EXPECT_FALSE(v.storeValid);
    const EffectiveAccess a = computeAccess(c, store({}), who("ad", Role::Administrator), false);
    EXPECT_EQ(a.screens.size(), 3u);
}

TEST(AccessModel, JsonOfTheAnswer) {
    const ResourceCatalog c = demo();
    const AccessFile s = store({rule("item:tong-quan/chi-phi", AccessLevel::View, {"group:qd"})},
                               {{"qd", "Quản đốc"}});
    EffectiveAccess v = computeAccess(c, s, who("vh1", Role::Viewer, {"ca-a"}));
    v.usersRev = 12;
    v.projectHash = "sha256:ab";
    const json j = effectiveAccessJson(v);
    EXPECT_EQ(j["user"], "vh1");
    EXPECT_EQ(j["role"], "viewer");
    EXPECT_EQ(j["groups"], json::array({"ca-a"}));
    EXPECT_EQ(j["anonymous"], false);
    EXPECT_EQ(j["storeRev"], 7);
    EXPECT_EQ(j["usersRev"], 12);
    EXPECT_EQ(j["projectHash"], "sha256:ab");
    EXPECT_EQ(j["screens"], json::array({"tong-quan", "bao-tri", "bom-1"}));
    EXPECT_EQ(j["hiddenItems"], json({{"tong-quan", {"chi-phi"}}}));
    EXPECT_EQ(j["lockedItems"], json({{"bom-1", {"sw"}}, {"tong-quan", {"chay-bom"}}}));
    EXPECT_EQ(j["pages"], json::array({"alarms", "history", "reports"}));
    EXPECT_EQ(j["admin"], false);
    EXPECT_FALSE(j.contains("liveTags"));  // §5: no Tag list for the page
    const json vj = effectiveAccessVectorJson(v);
    EXPECT_EQ(vj["liveTags"], json::array({"M1", "P1", "PUMP01.RUN_CMD"}));
    EXPECT_EQ(vj["orphans"], json::array());
}

TEST(AccessFileText, ReadsAndWritesTheFormat) {
    const std::string text = R"({"schemaVersion":"1.0.0","rev":7,
      "groups":[{"id":"ca-a","name":"Vận hành ca A"},{"id":"bao-tri","name":"Bảo trì"}],
      "rules":[{"resource":"screen:bao-tri","level":"view","grantees":["group:bao-tri","role:engineer"]},
               {"resource":"item:tong-quan/chay-bom","level":"operate","grantees":[]}]})";
    const AccessParse p = parseAccessFile(text);
    ASSERT_TRUE(p.ok) << p.error;
    EXPECT_EQ(p.file.rev, 7);
    ASSERT_EQ(p.file.groups.size(), 2u);
    EXPECT_EQ(p.file.groups[0].name, "Vận hành ca A");
    ASSERT_NE(p.file.rule("item:tong-quan/chay-bom", AccessLevel::Operate), nullptr);
    EXPECT_EQ(p.file.rule("item:tong-quan/chay-bom", AccessLevel::View), nullptr);
    const AccessParse again = parseAccessFile(accessFileJson(p.file));
    ASSERT_TRUE(again.ok) << again.error;
    EXPECT_EQ(accessFileJson(again.file), accessFileJson(p.file));
}

TEST(AccessFileText, RefusesWhatTheContractForbids) {
    const auto bad = [](const std::string& groups, const std::string& rules,
                        const std::string& version = "1.0.0") {
        return parseAccessFile(R"({"schemaVersion":")" + version + R"(","rev":1,"groups":)" +
                               groups + R"(,"rules":)" + rules + "}");
    };
    EXPECT_TRUE(bad("[]", "[]").ok);
    EXPECT_FALSE(bad("[]", "[]", "2.0.0").ok);
    EXPECT_FALSE(parseAccessFile("{").ok);
    EXPECT_FALSE(parseAccessFile(R"({"schemaVersion":"1.0.0","groups":[],"rules":[]})").ok);
    EXPECT_FALSE(bad(R"([{"id":"A","name":"x"}])", "[]").ok);         // id pattern
    EXPECT_FALSE(bad(R"([{"id":"a","name":"x"}])", "[]").ok);         // too short
    EXPECT_FALSE(bad(R"([{"id":"ab","name":""}])", "[]").ok);         // empty name
    EXPECT_FALSE(bad(R"([{"id":"ab","name":"a\u0007"}])", "[]").ok);  // control
    EXPECT_FALSE(bad(R"([{"id":"ab","name":"x"},{"id":"ab","name":"y"}])", "[]").ok);
    // what the project or the accounts cannot give is no damage: such rules match nobody or are
    // orphans (tests/access-vectors README rules 2 and 5)
    EXPECT_TRUE(
        bad("[]", R"([{"resource":"screen:a","level":"view","grantees":["group:zz"]}])").ok);
    EXPECT_TRUE(bad("[]", R"([{"resource":"screen:a","level":"view","grantees":["boss"]}])").ok);
    EXPECT_TRUE(bad("[]", R"([{"resource":"page:admin","level":"view","grantees":[]}])").ok);
    EXPECT_TRUE(bad("[]", R"([{"resource":"lạ:x","level":"view","grantees":[]}])").ok);
    EXPECT_FALSE(bad("[]", R"([{"resource":"","level":"view","grantees":[]}])").ok);
    EXPECT_FALSE(bad("[]", R"([{"resource":"screen:a","level":"view","grantees":[""]}])").ok);
    EXPECT_FALSE(bad("[]", R"([{"resource":"screen:a","level":"edit","grantees":[]}])").ok);
    EXPECT_FALSE(bad("[]", R"([{"resource":"screen:a","level":"view","grantees":["*","*"]}])").ok);
    EXPECT_FALSE(bad("[]", R"([{"resource":"screen:a","level":"view","grantees":[]},
                               {"resource":"screen:a","level":"view","grantees":["*"]}])")
                     .ok);
    std::string many = "[";
    for (int i = 0; i < 51; ++i)
        many += std::string(i ? "," : "") + R"({"id":"g)" + std::to_string(100 + i) +
                R"(","name":"n"})";
    EXPECT_FALSE(bad(many + "]", "[]").ok);
}

TEST(AccessFileText, Grantees) {
    EXPECT_TRUE(validGrantee("*"));
    EXPECT_TRUE(validGrantee("user:vh1"));
    EXPECT_TRUE(validGrantee("group:ca-a"));
    EXPECT_TRUE(validGrantee("role:operator"));
    EXPECT_FALSE(validGrantee("user:A"));
    EXPECT_FALSE(validGrantee("role:boss"));
    EXPECT_FALSE(validGrantee("group:"));
    EXPECT_FALSE(validGrantee(""));
    EXPECT_TRUE(validGroupId("ca-a"));
    EXPECT_FALSE(validGroupId("1ab"));
    EXPECT_FALSE(validGroupId(std::string(33, 'a')));
}

TEST(AccessCatalogJson, RoundTrip) {
    const ResourceCatalog c = demo();
    const json j = catalogJson(c);
    EXPECT_EQ(j["screens"][0]["items"][0]["operate"], "operator");
    std::string error;
    const auto back = catalogFromJson(j, error);
    ASSERT_TRUE(back) << error;
    EXPECT_EQ(catalogJson(*back), j);
    EXPECT_FALSE(catalogFromJson(json::parse(R"({"screens":[{"id":1}]})"), error));
}

}  // namespace
}  // namespace mat
