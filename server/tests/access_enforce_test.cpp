// T019, T024 (feature 013, contracts/admin-api.md §6): what the server gives a person who may not
// see everything: projects/active and the menu, a screen file without its hidden items and grid
// cells, the report templates, the tag write of the page (context, operate, the Tag of the item),
// the live hub (denied Tags without a value, access-changed and the Tags lost within a second,
// the alarms), the grants and the files of SVG items as the runtime builds them.
#include <gtest/gtest.h>

#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "core/auth/access_catalog.hpp"
#include "core/auth/access_model.hpp"
#include "core/auth/access_service.hpp"
#include "core/project-manager/project_validator.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "nlohmann/json.hpp"
#include "server/access_glue.hpp"
#include "server/http/access_filter.hpp"
#include "server/websocket/live_hub.hpp"

namespace mat {
namespace {

using nlohmann::json;
using Strings = std::vector<std::string>;

ResourceCatalog demo() {
    ResourceCatalog c;
    CatalogScreen tq;
    tq.id = "tong-quan";
    CatalogItem run;
    run.id = "chay-bom";
    run.operable = true;
    run.tags = {"PUMP01.RUN_CMD"};
    CatalogItem cost;
    cost.id = "chi-phi";
    cost.tags = {"E1.COST"};
    CatalogItem svg;
    svg.id = "svg1";
    svg.widget = "svg";
    svg.operable = true;
    svg.tags = {"PUMP01.FAULT", "R.PULSE"};
    svg.elementUids = {"el_pump"};
    tq.items = {run, cost, svg};
    CatalogScreen bt;
    bt.id = "bao-tri";
    CatalogItem m;
    m.id = "may";
    m.tags = {"M1"};
    bt.items = {m};
    c.screens = {tq, bt};
    c.reports = {{"dien-ngay", {"E1.KWH"}, ""}, {"chi-phi", {"E1.COST"}, ""}};
    c.alarms = {{"M1_FAULT", "M1"}, {"COST_HIGH", "E1.COST"}};
    return c;
}

SessionAccess accessOf(const ResourceCatalog& c, const AccessFile& f, Role role,
                       Strings groups = {}) {
    Principal p;
    p.user = "vh1";
    p.role = role;
    p.groups = std::move(groups);
    SessionAccess a;
    a.access = computeAccess(c, f, p);
    a.fingerprint = std::to_string(f.rev);
    return a;
}

AccessFile rules() {
    AccessFile f;
    f.rev = 3;
    f.groups = {{"quan-doc", "Quản đốc"}};
    f.rules = {{"screen:bao-tri", AccessLevel::View, {"group:quan-doc"}},
               {"item:tong-quan/chi-phi", AccessLevel::View, {"group:quan-doc"}},
               {"item:tong-quan/chay-bom", AccessLevel::Operate, {"group:quan-doc"}},
               {"report:chi-phi", AccessLevel::View, {"group:quan-doc"}}};
    return f;
}

TEST(AccessEnforce, ProjectsActiveHasOnlyWhatIsViewed) {
    const SessionAccess a = accessOf(demo(), rules(), Role::Operator);
    const json doc = json::parse(R"({
      "project": {"screens": ["tong-quan", "bao-tri"], "entryScreen": "bao-tri",
                  "navigation": {"items": [{"label": "A", "screen": "tong-quan"},
                                           {"label": "G", "items": [{"label": "B", "screen": "bao-tri"}]},
                                           {"label": "Alarm", "page": "alarms"}]}},
      "tags": {"tags": [{"id": "PUMP01.RUN_CMD"}, {"id": "E1.COST"}, {"id": "M1"}, {"id": "E1.KWH"}]},
      "navigation": {"items": []},
      "screens": [{"id": "tong-quan"}, {"id": "bao-tri"}]})");
    const json f = filteredActive(doc, a);
    EXPECT_EQ(f["project"]["screens"], json::array({"tong-quan"}));
    EXPECT_EQ(f["project"]["entryScreen"], "tong-quan");
    ASSERT_EQ(f["project"]["navigation"]["items"].size(), 2u) << "the empty group goes";
    EXPECT_EQ(f["project"]["navigation"]["items"][1]["page"], "alarms");
    EXPECT_EQ(f["navigation"], f["project"]["navigation"]);
    EXPECT_EQ(f["screens"], json::array({{{"id", "tong-quan"}}}));
    // the Tags of the components viewed and of the reports viewed (E1.KWH), not E1.COST, not M1
    EXPECT_EQ(f["tags"]["tags"], json::array({{{"id", "PUMP01.RUN_CMD"}}, {{"id", "E1.KWH"}}}));
    // before format 0.3 the screens are an object
    const json legacy = json::parse(R"({"screens": {"tong-quan": {}, "bao-tri": {}}})");
    EXPECT_EQ(filteredActive(legacy, a)["screens"], json({{"tong-quan", json::object()}}));
}

TEST(AccessEnforce, AScreenWithoutItsHiddenItemsAndTheirCells) {
    const json screen = json::parse(R"({"id": "tong-quan",
      "layout": {"mode": "grid", "rows": [{"cells": [{"id": "c1", "item": "chay-bom"},
                                                      {"id": "c2", "item": "chi-phi"}]}]},
      "items": [{"id": "chay-bom"}, {"id": "chi-phi"}, {"id": "svg1"}]})");
    const json f = filteredScreen(screen, {"chi-phi"});
    EXPECT_EQ(f["items"], json::array({{{"id", "chay-bom"}}, {{"id", "svg1"}}}));
    EXPECT_EQ(f["layout"]["rows"][0]["cells"][0]["item"], "chay-bom");
    EXPECT_FALSE(f["layout"]["rows"][0]["cells"][1].contains("item")) << "the cell stays empty";
    EXPECT_EQ(f["layout"]["rows"][0]["cells"][1]["id"], "c2");
    const json r =
        filteredReports(json::parse(R"({"reports": [{"id": "dien-ngay"}, {"id": "chi-phi"}]})"),
                        accessOf(demo(), rules(), Role::Operator));
    EXPECT_EQ(r["reports"], json::array({{{"id", "dien-ngay"}}}));
}

TEST(AccessEnforce, AWriteOfThePageNeedsItsComponentOperatedAndItsTag) {
    const ResourceCatalog c = demo();
    const SessionAccess op = accessOf(c, rules(), Role::Operator);
    const SessionAccess qd = accessOf(c, rules(), Role::Operator, {"quan-doc"});
    EXPECT_FALSE(pageWriteRefusal(c, op, "", "", "PUMP01.RUN_CMD").empty()) << "no context";
    EXPECT_FALSE(pageWriteRefusal(c, op, "tong-quan", "chay-bom", "PUMP01.RUN_CMD").empty())
        << "no operate";
    EXPECT_EQ(pageWriteRefusal(c, qd, "tong-quan", "chay-bom", "PUMP01.RUN_CMD"), "");
    EXPECT_FALSE(pageWriteRefusal(c, qd, "tong-quan", "chay-bom", "M1").empty())
        << "a Tag the component does not write";
    EXPECT_FALSE(pageWriteRefusal(c, qd, "tong-quan", "nope", "PUMP01.RUN_CMD").empty());
    // an SVG element names its item
    EXPECT_EQ(pageWriteRefusal(c, op, "tong-quan", "el_pump", "R.PULSE"), "");
    const SessionAccess viewer = accessOf(c, AccessFile{}, Role::Viewer);
    EXPECT_FALSE(pageWriteRefusal(c, viewer, "tong-quan", "el_pump", "R.PULSE").empty());
}

TEST(AccessEnforce, TheFilesOfSvgItemsBelongToTheirItems) {
    const std::string src = MAT_SOURCE_DIR;
    const ProjectValidation v = validateProject(src + "/projects/grid-demo", src + "/schemas");
    ASSERT_TRUE(v.valid);
    const auto files = projectItemFiles(*v.project);
    const auto svg = files.find("screens/tong-quan.svg");
    ASSERT_NE(svg, files.end());
    EXPECT_EQ(svg->second,
              (std::vector<std::pair<std::string, std::string>>{{"tong-quan", "svg1"}}));
    EXPECT_EQ(files.count("screens/tong-quan.bindings.json"), 1u);
    const ProjectValidation old = validateProject(src + "/projects/tank-demo", src + "/schemas");
    ASSERT_TRUE(old.valid);
    const auto oldFiles = projectItemFiles(*old.project);
    ASSERT_EQ(oldFiles.count("screens/tank-motor.svg"), 1u);
    EXPECT_EQ(oldFiles.at("screens/tank-motor.svg")[0].second, "svg");
}

// --- the live hub

struct FakeTransport : LiveTransport {
    std::mutex mu;
    std::map<uint64_t, std::vector<std::string>> sent;
    SendQueue::PushResult push(uint64_t sid, std::string text) override {
        std::lock_guard<std::mutex> g(mu);
        sent[sid].push_back(std::move(text));
        return SendQueue::PushResult::Ok;
    }
    void close(uint64_t, int, const std::string&) override {}
    std::vector<json> ofType(uint64_t sid, const std::string& t) {
        std::lock_guard<std::mutex> g(mu);
        std::vector<json> v;
        for (auto& s : sent[sid]) {
            json m = json::parse(s);
            if (m["type"] == t) v.push_back(m);
        }
        return v;
    }
};

struct FakeAlarms : AlarmLiveSource {
    bool hasAlarms() const override { return true; }
    AlarmLiveSnapshot snapshot(bool) override {
        AlarmLiveSnapshot s;
        s.instances = {R"({"id":"M1_FAULT"})", R"({"id":"COST_HIGH.H"})"};
        s.ids = {"M1_FAULT", "COST_HIGH.H"};
        return s;
    }
    AlarmLiveBatch takeChanges() override {
        AlarmLiveBatch b;
        b.revision = 2;
        b.changes = std::move(next);
        next.clear();
        return b;
    }
    std::vector<AlarmLiveChange> next;
};

struct HubRig {
    TagStore store;
    FakeTransport tx;
    FakeAlarms alarms;
    int64_t now = 1000;
    std::unique_ptr<LiveHub> hub;
    LiveGrantPtr grant;
    HubRig() {
        store.add({"A", TagType::FLOAT32, ""});
        store.add({"SECRET", TagType::FLOAT32, ""});
        store.set(0, 1.5, Quality::GOOD, 1, 1);
        store.set(1, 9.5, Quality::GOOD, 1, 1);
        store.takeDirty();
        HubOptions o;
        o.serverVersion = "1.1.0";
        hub = std::make_unique<LiveHub>(store, tx, o, [this] { return now; });
        hub->setAlarmSource(&alarms);
    }
    static LiveGrantPtr only(std::unordered_set<size_t> tags, const std::string& fp,
                             std::function<bool(const std::string&)> alarm = {}) {
        auto g = std::make_shared<LiveGrant>();
        g->all = false;
        g->tags = std::move(tags);
        g->fingerprint = fp;
        g->alarm = std::move(alarm);
        return g;
    }
    void send(uint64_t sid, const std::string& s) { hub->onMessage(sid, s.data(), s.size()); }
};

TEST(AccessEnforce, TheLiveHubSendsNoValueOfADeniedTag) {
    HubRig r;
    r.grant = HubRig::only({0}, "a");
    r.hub->onOpen(1, true, [&r] { return r.grant; });
    r.send(1, R"({"type":"subscribe","requestId":"s1","tags":["A","SECRET","NOPE"]})");
    const auto snap = r.tx.ofType(1, "snapshot");
    ASSERT_EQ(snap.size(), 1u);
    ASSERT_EQ(snap[0]["tags"].size(), 1u);
    EXPECT_EQ(snap[0]["tags"][0]["id"], "A");
    EXPECT_EQ(snap[0]["denied"], json::array({"SECRET"}));
    EXPECT_EQ(snap[0]["unknown"], json::array({"NOPE"}));
    // only denied Tags: a snapshot with no Tag, not NO_VALID_TAGS
    r.send(1, R"({"type":"subscribe","requestId":"s2","tags":["SECRET"]})");
    EXPECT_EQ(r.tx.ofType(1, "snapshot").back()["denied"], json::array({"SECRET"}));
    EXPECT_TRUE(r.tx.ofType(1, "error").empty());
    r.send(1, R"({"type":"subscribe","requestId":"s3","tags":["A","SECRET"]})");
    r.store.set(0, 2.5, Quality::GOOD, 2, 2);
    r.store.set(1, 10.5, Quality::GOOD, 2, 2);
    r.hub->tick();
    const auto deltas = r.tx.ofType(1, "delta");
    ASSERT_EQ(deltas.size(), 1u);
    EXPECT_EQ(deltas[0]["tags"].size(), 1u);
    for (const auto& s : r.tx.sent[1]) EXPECT_EQ(s.find("10.5"), std::string::npos) << s;
}

TEST(AccessEnforce, WhenTheAccessChangesTheTagsLostStopWithinASecond) {
    HubRig r;
    r.grant = HubRig::only({0, 1}, "a");
    r.hub->onOpen(1, true, [&r] { return r.grant; });
    r.hub->onOpen(2, true, [&r] { return r.grant; });
    r.send(1, R"({"type":"subscribe","requestId":"s1","tags":["A","SECRET"]})");
    r.grant = HubRig::only({0}, "b");  // a rule took SECRET away
    r.now += 1000;
    r.store.set(1, 11.5, Quality::GOOD, 2, 2);
    r.hub->tick();
    EXPECT_EQ(r.tx.ofType(1, "access-changed").size(), 1u);
    EXPECT_EQ(r.tx.ofType(2, "access-changed").size(), 1u);
    for (const auto& s : r.tx.sent[1]) EXPECT_EQ(s.find("11.5"), std::string::npos) << s;
    r.store.set(0, 3.5, Quality::GOOD, 3, 3);
    r.hub->tick();
    const auto deltas = r.tx.ofType(1, "delta");
    ASSERT_FALSE(deltas.empty());
    EXPECT_EQ(deltas.back()["tags"][0][0], 0) << "position 0 (A) keeps its place";
    // the same fingerprint again: nothing to say
    r.grant = HubRig::only({0}, "b");
    r.now += 1000;
    r.hub->tick();
    EXPECT_EQ(r.tx.ofType(1, "access-changed").size(), 1u);
}

TEST(AccessEnforce, TheAlarmsOfASessionFollowItsGrant) {
    HubRig r;
    r.grant = HubRig::only({0}, "a", [](const std::string& id) { return id == "M1_FAULT"; });
    r.hub->onOpen(1, true, [&r] { return r.grant; });
    r.hub->tick();  // the engine's first round
    r.send(1, R"({"type":"subscribeAlarms","requestId":"a1"})");
    const auto snap = r.tx.ofType(1, "alarmSnapshot");
    ASSERT_EQ(snap.size(), 1u);
    EXPECT_EQ(snap[0]["instances"], json::array({{{"id", "M1_FAULT"}}}));
    r.alarms.next = {{"COST_HIGH.H", R"({"id":"COST_HIGH.H"})", R"({"id":"COST_HIGH.H"})"},
                     {"M1_FAULT", R"({"id":"M1_FAULT","x":1})", R"({"id":"M1_FAULT","x":1})"}};
    r.hub->tick();
    const auto deltas = r.tx.ofType(1, "alarmDelta");
    ASSERT_EQ(deltas.size(), 1u);
    EXPECT_EQ(deltas[0]["changed"].size(), 1u);
    EXPECT_EQ(deltas[0]["changed"][0]["id"], "M1_FAULT");
}

TEST(AccessEnforce, AGrantFromAnAccess) {
    SessionAccess a = accessOf(demo(), rules(), Role::Operator);
    a.liveIdx = {3, 4};
    const SessionAccessPtr p = std::make_shared<SessionAccess>(a);
    const LiveGrantPtr g = liveGrantFrom(p);
    EXPECT_FALSE(g->all);
    EXPECT_TRUE(g->tag(3));
    EXPECT_FALSE(g->tag(5));
    EXPECT_FALSE(g->alarmOk("M1_FAULT"));  // M1 is on bao-tri only
    const LiveGrantPtr none = liveGrantFrom(nullptr);
    EXPECT_FALSE(none->tag(0));
    EXPECT_FALSE(none->alarmOk("X"));
}

}  // namespace
}  // namespace mat
