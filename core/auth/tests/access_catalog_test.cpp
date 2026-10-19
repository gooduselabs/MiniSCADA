// The catalog of resources built from a loaded project (feature 013, contracts/access-model.md §2,
// §3): the demo projects of the repository, as the runtime validates them.
#include "core/auth/access_catalog.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <memory>
#include <string>

#include "core/project-manager/project_validator.hpp"
#include "core/project-manager/widget_catalog.hpp"

namespace mat {
namespace {

using Strings = std::vector<std::string>;

struct Loaded {
    ProjectValidation v;
    std::unique_ptr<WidgetCatalog> widgets;
    ResourceCatalog catalog;
};

Loaded load(const std::string& name) {
    Loaded l;
    const std::string src = MAT_SOURCE_DIR;
    l.v = validateProject(src + "/projects/" + name, src + "/schemas");
    std::string error;
    l.widgets = WidgetCatalog::loadFromDir(src + "/schemas", error);
    if (l.v.valid && l.v.project) l.catalog = catalogFromProject(*l.v.project, l.widgets.get());
    return l;
}

bool has(const Strings& v, const std::string& s) {
    return std::find(v.begin(), v.end(), s) != v.end();
}

TEST(AccessCatalog, ScreensItemsAndDefaultsOfAGridProject) {
    const Loaded l = load("grid-demo");
    ASSERT_TRUE(l.v.valid);
    ASSERT_TRUE(l.widgets);
    const ResourceCatalog& c = l.catalog;
    ASSERT_EQ(c.screens.size(), 7u);
    EXPECT_EQ(c.screens[0].id, "bang-dieu-khien");
    EXPECT_EQ(c.screens[0].title, "Bảng điều khiển");
    const CatalogItem* start = c.item("tong-quan", "btn_start");
    ASSERT_NE(start, nullptr);
    EXPECT_TRUE(start->operable);
    EXPECT_EQ(start->tags, Strings{"PUMP01.RUN_CMD"});
    EXPECT_EQ(start->operate, Role::Operator);
    const CatalogItem* toggle = c.item("tong-quan", "btn_toggle");
    ASSERT_NE(toggle, nullptr);
    EXPECT_EQ(toggle->operate, Role::Engineer);  // security.minRole is the operate default
    const CatalogItem* card = c.item("tong-quan", "card_level");
    ASSERT_NE(card, nullptr);
    EXPECT_FALSE(card->operable);
    EXPECT_EQ(card->widget, "card");
    const CatalogItem* svg = c.item("tong-quan", "svg1");
    ASSERT_NE(svg, nullptr);
    EXPECT_EQ(svg->widget, "svg");
    EXPECT_TRUE(has(svg->tags, "TANK01.LEVEL"));
    EXPECT_TRUE(has(svg->tags, "PUMP01.FAULT"));
    EXPECT_EQ(itemOfWrite(c, "tong-quan", "el_pump"), svg);
    EXPECT_EQ(itemOfWrite(c, "tong-quan", "btn_start"), start);
    EXPECT_EQ(itemOfWrite(c, "tong-quan", "nope"), nullptr);
    EXPECT_EQ(itemOfWrite(c, "nope", "btn_start"), nullptr);
}

TEST(AccessCatalog, APopupGetsTheTagsOfEveryOpener) {
    const Loaded l = load("grid-demo");
    ASSERT_TRUE(l.v.valid);
    const CatalogScreen* popup = l.catalog.screen("bom-chi-tiet");
    ASSERT_NE(popup, nullptr);
    EXPECT_TRUE(popup->popup);
    const CatalogItem* sw = l.catalog.item("bom-chi-tiet", "run_sw");
    ASSERT_NE(sw, nullptr);
    EXPECT_TRUE(sw->operable);
    EXPECT_TRUE(has(sw->tags, "PUMP01.RUN_CMD"));
    EXPECT_TRUE(has(sw->tags, "PUMP11.RUN_CMD"));
    for (const auto& t : sw->tags) EXPECT_EQ(t.find('{'), std::string::npos) << t;
}

TEST(AccessCatalog, AnOldProjectHasOneDrawingPerScreen) {
    const Loaded l = load("tank-demo");
    ASSERT_TRUE(l.v.valid);
    ASSERT_EQ(l.catalog.screens.size(), 1u);
    ASSERT_EQ(l.catalog.screens[0].items.size(), 1u);
    EXPECT_EQ(l.catalog.screens[0].items[0].id, "svg");
    EXPECT_FALSE(l.catalog.screens[0].items[0].tags.empty());
}

TEST(AccessCatalog, LoggingGroupsReportsAndAlarms) {
    const Loaded h = load("history-demo");
    ASSERT_TRUE(h.v.valid);
    ASSERT_EQ(h.catalog.historyGroups.size(), 4u);
    EXPECT_EQ(h.catalog.historyGroups[0].id, "ap-suat");
    EXPECT_EQ(h.catalog.historyGroups[0].tags, (Strings{"PROC.PRESSURE", "PROC.TEMP"}));
    ASSERT_EQ(h.catalog.reports.size(), 3u);
    EXPECT_EQ(h.catalog.reports[0].tags, (Strings{"METER1.KW", "METER1.KWH"}));
    const Loaded a = load("alarm-demo");
    ASSERT_TRUE(a.v.valid);
    ASSERT_FALSE(a.catalog.alarms.empty());
    const auto link = std::find_if(a.catalog.alarms.begin(), a.catalog.alarms.end(),
                                   [](const CatalogAlarm& x) { return x.id == "PLC1_LINK"; });
    ASSERT_NE(link, a.catalog.alarms.end());
    EXPECT_TRUE(link->tag.empty());
    EXPECT_EQ(a.catalog.alarms[0].tag, "TANK1.LEVEL");
}

}  // namespace
}  // namespace mat
