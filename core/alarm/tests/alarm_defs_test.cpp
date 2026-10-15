// T027: compileAlarms (FR-002..FR-008): instances from the JSON of project 0.5, ids, order, class
// per threshold, enabled, watched Tags, devices, fingerprint, the 500 instance limit.
#include "core/alarm/alarm_defs.hpp"

#include <gtest/gtest.h>

#include <fstream>

#include "core/alarm/tests/alarm_test_support.hpp"

using namespace mat::alarm;
using nlohmann::json;

namespace {
uint64_t fnv1a(const std::string& s) {
    uint64_t h = 14695981039346656037ULL;
    for (unsigned char c : s) {
        h ^= c;
        h *= 1099511628211ULL;
    }
    return h;
}
std::string hex16(uint64_t v) {
    char b[17];
    snprintf(b, sizeof b, "%016llx", static_cast<unsigned long long>(v));
    return b;
}

json classes() { return test::classesJson(); }

json sampleAlarms() {
    return json::parse(R"J([
      {"id":"TANK_B1_LEVEL","type":"limit","name":"Mức bồn B1","area":"bon","tag":"TANK01.LEVEL",
       "limits":{"LL":{"value":5,"class":"critical"},"L":{"value":15,"class":"minor"},
                 "H":{"value":80,"class":"minor","text":"cao {value}"},
                 "HH":{"value":90,"class":"critical","text":"{name} rất cao"}},
       "deadband":2,"onDelayMs":3000,"offDelayMs":1000},
      {"id":"PUMP1_FAULT","type":"digital","name":"Bơm 1 lỗi","area":"bom","tag":"PUMP01.FAULT",
       "trigger":true,"class":"critical","text":"Bơm 1 báo lỗi ({tag})","onDelayMs":500},
      {"id":"PUMP1_RUN_OFF","type":"digital","name":"Bơm 1 dừng","tag":"PUMP01.RUN","trigger":false,
       "class":"minor","enabled":false},
      {"id":"PLC1_LINK","type":"quality","name":"Mất kết nối PLC1","device":"plc1","class":"minor",
       "onDelayMs":5000},
      {"id":"METER3_SIGNAL","type":"quality","name":"Đồng hồ 3","tag":"METER3.P","on":"notGood",
       "class":"minor"}
    ])J");
}
}  // namespace

TEST(AlarmDefs, InstancesIdsAndOrder) {
    ProjectView p;
    p.alarms = {{"areas", json::parse(R"([{"id":"bon","name":"Bồn"},{"id":"bom","name":"Bơm"}])")},
                {"alarms", sampleAlarms()}};
    p.classes = classes();
    p.tags = {{"TANK01.LEVEL", AlarmTagInfo{"%", {}, false}},
              {"PUMP01.FAULT", AlarmTagInfo{"", {}, true}}};
    p.devices = {{"plc1", {"PLC1.A", "PLC1.B"}}};
    CompileResult r = compileAlarms(p);
    ASSERT_TRUE(r.ok()) << r.errors.front();
    std::vector<std::string> ids;
    for (const auto& i : r.defs.instances) ids.push_back(i.id);
    // limit alarm in the order HH, H, L, LL; the disabled alarm makes no instance
    EXPECT_EQ(ids, (std::vector<std::string>{"TANK_B1_LEVEL.HH", "TANK_B1_LEVEL.H",
                                             "TANK_B1_LEVEL.L", "TANK_B1_LEVEL.LL", "PUMP1_FAULT",
                                             "PLC1_LINK", "METER3_SIGNAL"}));
    const auto& hh = r.defs.instances[0];
    EXPECT_EQ(hh.defId, "TANK_B1_LEVEL");
    EXPECT_EQ(hh.limitName, "HH");
    EXPECT_EQ(hh.kind, AlarmKind::Limit);
    EXPECT_EQ(hh.threshold, 90);
    EXPECT_EQ(hh.deadband, 2);
    EXPECT_EQ(hh.classId, "critical");
    EXPECT_EQ(hh.text, "{name} rất cao");  // threshold text
    EXPECT_EQ(hh.onDelayMs, 3000);
    EXPECT_EQ(hh.offDelayMs, 1000);
    EXPECT_EQ(hh.areaId, "bon");
    EXPECT_EQ(r.defs.instances[1].classId, "minor");  // class per threshold
    EXPECT_EQ(r.defs.instances[1].text, "cao {value}");
    EXPECT_EQ(r.defs.instances[2].text, "");  // none: default
    EXPECT_EQ(r.defs.instances[3].classId, "critical");
    EXPECT_EQ(r.defs.instances[4].kind, AlarmKind::Digital);
    EXPECT_TRUE(r.defs.instances[4].trigger);
    EXPECT_EQ(r.defs.instances[4].text, "Bơm 1 báo lỗi ({tag})");
    EXPECT_EQ(r.defs.instances[5].kind, AlarmKind::Quality);
    EXPECT_EQ(r.defs.instances[5].deviceId, "plc1");
    EXPECT_EQ(r.defs.instances[6].on, QualityOn::NotGood);
    EXPECT_EQ(r.defs.instances[5].on, QualityOn::Bad);
    EXPECT_EQ(r.defs.classes.size(), 2u);
    EXPECT_EQ(r.defs.areas.size(), 2u);
}

TEST(AlarmDefs, WatchedTagsAreDeduplicatedInOrderOfFirstAppearance) {
    ProjectView p;
    p.alarms = {{"alarms", sampleAlarms()}};
    p.classes = classes();
    p.devices = {{"plc1", {"PLC1.A", "TANK01.LEVEL", "PLC1.B"}}};
    CompileResult r = compileAlarms(p);
    ASSERT_TRUE(r.ok());
    EXPECT_EQ(r.defs.tagIds, (std::vector<std::string>{"TANK01.LEVEL", "PUMP01.FAULT", "PLC1.A",
                                                       "PLC1.B", "METER3.P"}));
    EXPECT_EQ(r.defs.deviceTags.at("plc1"), (std::vector<int>{2, 0, 3}));
    EXPECT_EQ(r.defs.instances[0].tagSlot, 0);   // TANK_B1_LEVEL.HH
    EXPECT_EQ(r.defs.instances[4].tagSlot, 1);   // PUMP1_FAULT
    EXPECT_EQ(r.defs.instances[5].tagSlot, -1);  // device alarm
    EXPECT_EQ(r.defs.instances[5].deviceSlots, (std::vector<int>{2, 0, 3}));
    EXPECT_EQ(r.defs.instances[6].tagSlot, 4);
    EXPECT_EQ(r.defs.tagInfo.size(), r.defs.tagIds.size());
}

TEST(AlarmDefs, TagInfoComesFromTheProject) {
    ProjectView p;
    p.alarms = {{"alarms", sampleAlarms()}};
    p.classes = classes();
    p.tags = {{"TANK01.LEVEL", AlarmTagInfo{"%", {{"0", "Thấp"}}, false}}};
    CompileResult r = compileAlarms(p);
    ASSERT_TRUE(r.ok());
    EXPECT_EQ(r.defs.tagInfo[0].unit, "%");
    EXPECT_EQ(r.defs.tagInfo[0].labels.at("0"), "Thấp");
}

TEST(AlarmDefs, ClassFlagsAndDefaults) {
    ProjectView p;
    p.alarms = {{"alarms", json::array()}};
    p.classes = json::parse(R"({"classes":[
      {"id":"critical","name":"Khẩn cấp","priority":"critical","color":"red","blink":true,"sound":"siren"},
      {"id":"advisory","name":"Lưu ý","priority":"advisory","color":"blue","requiresAck":false}]})");
    CompileResult r = compileAlarms(p);
    ASSERT_TRUE(r.ok());
    const ClassDef& c = r.defs.classes[0];
    EXPECT_EQ(c.priority, Priority::Critical);
    EXPECT_TRUE(c.blink);
    EXPECT_TRUE(c.requiresAck);  // defaults
    EXPECT_FALSE(c.ackReturn);
    EXPECT_EQ(c.chatterLimit, 5);
    EXPECT_EQ(c.sound, "siren");
    EXPECT_FALSE(r.defs.classes[1].requiresAck);
    EXPECT_EQ(r.defs.classes[1].sound, "none");
}

TEST(AlarmDefs, FingerprintIsFnv1aOverTheCondition) {
    ProjectView p;
    p.alarms = {{"alarms", sampleAlarms()}};
    p.classes = classes();
    p.devices = {{"plc1", {"PLC1.A"}}};
    CompileResult r = compileAlarms(p);
    ASSERT_TRUE(r.ok());
    EXPECT_EQ(r.defs.instances[0].fingerprint, hex16(fnv1a("limit|TANK01.LEVEL|HH|90||")));
    EXPECT_EQ(r.defs.instances[4].fingerprint, hex16(fnv1a("digital|PUMP01.FAULT|||1|")));
    EXPECT_EQ(r.defs.instances[5].fingerprint, hex16(fnv1a("quality|device:plc1||||bad")));
    EXPECT_EQ(r.defs.instances[6].fingerprint, hex16(fnv1a("quality|METER3.P||||notGood")));
    EXPECT_EQ(fingerprintHex(r.defs.instances[0]), r.defs.instances[0].fingerprint);
    EXPECT_EQ(fingerprint(r.defs.instances[0]), fnv1a("limit|TANK01.LEVEL|HH|90||"));
    EXPECT_EQ(r.defs.instances[0].fingerprint.size(), 16u);
}

TEST(AlarmDefs, FingerprintIgnoresClassAreaTextDelaysDeadbandName) {
    auto make = [](const json& a) {
        ProjectView p;
        p.alarms = {{"alarms", json::array({a})}};
        p.classes = classes();
        return compileAlarms(p).defs.instances.at(0).fingerprint;
    };
    json base = {{"id", "A"},
                 {"type", "limit"},
                 {"name", "n"},
                 {"tag", "T"},
                 {"limits", {{"H", {{"value", 80}, {"class", "minor"}}}}},
                 {"deadband", 1}};
    const std::string f0 = make(base);
    json v = base;
    v["limits"]["H"]["class"] = "critical";
    v["limits"]["H"]["text"] = "xx";
    v["name"] = "khác";
    v["deadband"] = 3;
    v["onDelayMs"] = 9000;
    v["offDelayMs"] = 9000;
    v["area"] = "bon";
    EXPECT_EQ(make(v), f0);
    v = base;
    v["limits"]["H"]["value"] = 81;  // the threshold is in the fingerprint
    EXPECT_NE(make(v), f0);
    v = base;
    v["tag"] = "T2";
    EXPECT_NE(make(v), f0);
}

TEST(AlarmDefs, DecimalThresholdFingerprintUsesShortestText) {
    ProjectView p;
    p.alarms = {{"alarms", json::parse(R"([{"id":"A","type":"limit","name":"n","tag":"T",
      "limits":{"H":{"value":80.5,"class":"minor"}}}])")}};
    p.classes = classes();
    CompileResult r = compileAlarms(p);
    ASSERT_TRUE(r.ok());
    EXPECT_EQ(r.defs.instances[0].fingerprint, hex16(fnv1a("limit|T|H|80.5||")));
}

TEST(AlarmDefs, AtMost500Instances) {
    auto build = [](int n) {
        json a = json::array();
        for (int i = 0; i < n; ++i)
            a.push_back({{"id", "A" + std::to_string(i)},
                         {"type", "digital"},
                         {"name", "n"},
                         {"tag", "T" + std::to_string(i)},
                         {"trigger", true},
                         {"class", "minor"}});
        ProjectView p;
        p.alarms = {{"alarms", a}};
        p.classes = classes();
        return compileAlarms(p);
    };
    EXPECT_TRUE(build(500).ok());
    EXPECT_EQ(build(500).defs.instances.size(), 500u);
    CompileResult r = build(501);
    EXPECT_FALSE(r.ok());
    // a limit alarm with 4 thresholds counts 4
    json a = json::array();
    for (int i = 0; i < 126; ++i)
        a.push_back({{"id", "L" + std::to_string(i)},
                     {"type", "limit"},
                     {"name", "n"},
                     {"tag", "T"},
                     {"limits",
                      {{"LL", {{"value", 1}, {"class", "minor"}}},
                       {"L", {{"value", 2}, {"class", "minor"}}},
                       {"H", {{"value", 3}, {"class", "minor"}}},
                       {"HH", {{"value", 4}, {"class", "minor"}}}}}});
    ProjectView p;
    p.alarms = {{"alarms", a}};
    p.classes = classes();
    EXPECT_FALSE(compileAlarms(p).ok());  // 504
    a.erase(a.size() - 1);
    p.alarms = {{"alarms", a}};
    EXPECT_TRUE(compileAlarms(p).ok());  // 500
}

TEST(AlarmDefs, DisabledAlarmsDoNotCountAgainstTheLimit) {
    json a = json::array();
    for (int i = 0; i < 520; ++i)
        a.push_back({{"id", "A" + std::to_string(i)},
                     {"type", "digital"},
                     {"name", "n"},
                     {"tag", "T"},
                     {"trigger", true},
                     {"class", "minor"},
                     {"enabled", i < 500}});
    ProjectView p;
    p.alarms = {{"alarms", a}};
    p.classes = classes();
    CompileResult r = compileAlarms(p);
    EXPECT_TRUE(r.ok());
    EXPECT_EQ(r.defs.instances.size(), 500u);
}

TEST(AlarmDefs, UnknownClassIsReported) {
    ProjectView p;
    p.alarms = {
        {"alarms",
         json::parse(
             R"([{"id":"A","type":"digital","name":"n","tag":"T","trigger":true,"class":"nope"}])")}};
    p.classes = classes();
    CompileResult r = compileAlarms(p);
    EXPECT_FALSE(r.ok());
}

TEST(AlarmDefs, NoAlarmsFileMeansNoInstances) {
    ProjectView p;  // both null
    CompileResult r = compileAlarms(p);
    EXPECT_TRUE(r.ok());
    EXPECT_TRUE(r.defs.instances.empty());
    EXPECT_TRUE(r.defs.tagIds.empty());
}

TEST(AlarmDefs, InstanceCountsOfTheBundledExample) {
    // 4 + 1 + 1 + 1 enabled instances, the disabled one makes none (project-format-0.5 §3).
    ProjectView p;
    p.alarms = {{"alarms", sampleAlarms()}};
    p.classes = classes();
    CompileResult r = compileAlarms(p);
    ASSERT_TRUE(r.ok());
    EXPECT_EQ(r.defs.instances.size(), 7u);
}

TEST(AlarmDefs, FingerprintVectorsOfTheSharedFile) {
    std::ifstream in(std::string(MAT_SOURCE_DIR) + "/tests/alarm-vectors/fingerprint.json");
    json j = json::parse(in, nullptr, false);
    ASSERT_FALSE(j.is_discarded());
    for (const auto& r : j["raw"])
        EXPECT_EQ(hex16(fnv1a64(r["input"].get<std::string>())), r["hex"]) << r["input"];
    int n = 0;
    for (const auto& c : j["cases"]) {
        const json& d = c["def"];
        InstanceDef def;
        const std::string kind = d["kind"];
        def.kind = kind == "digital" ? AlarmKind::Digital
                                     : kind == "limit" ? AlarmKind::Limit : AlarmKind::Quality;
        def.tagId = d.value("tag", "");
        def.deviceId = d.value("device", "");
        def.limitName = d.value("limit", "");
        if (d.contains("threshold")) def.threshold = d["threshold"].get<double>();
        def.trigger = d.value("trigger", true);
        def.on = d.value("on", "bad") == "notGood" ? QualityOn::NotGood : QualityOn::Bad;
        EXPECT_EQ(fingerprintHex(def), c["hex"].get<std::string>())
            << c["name"] << " " << c["canonical"];
        ++n;
    }
    EXPECT_GE(n, 5);
}
