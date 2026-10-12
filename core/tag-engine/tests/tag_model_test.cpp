// Tag model: Tag v1 from a validated project (data-model §1-§5; FR-002, FR-009), defaults, field
// devices resolved, a 0.1 project read as `legacy` simulation Tags with its files unchanged.
#include "core/tag-engine/tag_model.hpp"

#include <gtest/gtest.h>

using nlohmann::json;
using namespace mat;

namespace {

LoadedProject projectOf(const json& tags, const json& connections = json(),
                        const json& tables = json::object()) {
    LoadedProject p;
    p.project = {{"schemaVersion", "0.2.0"}, {"tagFile", "tags.json"}, {"screens", json::array()}};
    p.tags = {{"schemaVersion", "0.2.0"}, {"tags", tags}};
    p.connections = connections;
    for (auto it = tables.begin(); it != tables.end(); ++it) p.valueTables[it.key()] = it.value();
    return p;
}

const json kConnections = json::parse(R"({
  "schemaVersion": "0.2.0",
  "scanGroups": { "fast": 200, "normal": 1500, "slow": 7000 },
  "channels": [
    { "id": "plc1", "name": "PLC", "kind": "modbus-tcp", "tcp": { "host": "10.0.0.5" },
      "devices": [ { "id": "plc1", "name": "PLC 1", "unitId": 3, "addressBase": 1, "byteOrder": "CDAB",
                     "write": { "registerBit": "mask", "singleRegister": "fc16" } },
                   { "id": "off", "name": "Tắt", "enabled": false } ] },
    { "id": "rs1", "name": "RS485", "kind": "modbus-rtu", "enabled": false,
      "serial": { "port": "ttyAS2", "baud": 19200 },
      "devices": [ { "id": "meter1", "name": "Đồng hồ", "slave": 7, "addressBase": 1 } ] }
  ]
})");

}  // namespace

TEST(TagModel, ExternalTagDefaults) {
    const auto p = projectOf(json::parse(R"([
      {"id":"A","kind":"external","type":"FLOAT32","source":{"device":"plc1","address":"HR100"}}
    ])"),
                             kConnections);
    std::string err;
    const auto m = buildProjectModel(p, &err);
    ASSERT_TRUE(m) << err;
    ASSERT_EQ(m->tags.size(), 1u);
    const TagModel& t = m->tags[0];
    EXPECT_EQ(t.kind, TagKind::External);
    EXPECT_FALSE(t.writable);                                // access R
    EXPECT_EQ(t.source.group, drv::ScanGroup::Normal);       // scanGroup normal
    EXPECT_EQ(t.source.rawType, TagType::FLOAT32);           // rawType = type
    EXPECT_EQ(t.source.byteOrder, modbus::ByteOrder::CDAB);  // the device's
    EXPECT_TRUE(t.source.readback);
    EXPECT_FALSE(t.retain);
    EXPECT_EQ(t.source.stringOrder, modbus::StringByteOrder::AB);
    EXPECT_FALSE(t.disabled);
}

TEST(TagModel, AddressResolvedWithTheDeviceAddressBase) {
    const auto p = projectOf(json::parse(R"([
      {"id":"A","kind":"external","type":"FLOAT32","source":{"device":"plc1","address":"HR100"}},
      {"id":"B","kind":"external","type":"INT16","access":"RW","source":{"device":"plc1","address":"40001"}},
      {"id":"C","kind":"external","type":"BOOL","source":{"device":"plc1","address":"HR12.3"}},
      {"id":"D","kind":"external","type":"STRING","source":{"device":"meter1","address":"HR300","stringLength":16}}
    ])"),
                             kConnections);
    const auto m = buildProjectModel(p);
    ASSERT_TRUE(m);
    EXPECT_EQ(m->tags[0].source.addr.offset, 99);  // addressBase 1
    EXPECT_EQ(m->tags[0].source.addr.registers, 2);
    EXPECT_EQ(m->tags[0].source.addr.fcRead, 3);
    EXPECT_EQ(m->tags[1].source.addr.offset, 0);
    EXPECT_TRUE(m->tags[1].writable);
    EXPECT_EQ(m->tags[1].source.addr.fcWrite, (std::vector<int>{6, 16}));
    EXPECT_EQ(m->tags[2].source.addr.bit, 3);
    EXPECT_EQ(m->tags[3].source.addr.registers, 8);
    // devices and channels
    EXPECT_EQ(m->tags[0].device, 0u);
    EXPECT_EQ(m->devices[0].unitId, 3);
    EXPECT_TRUE(m->devices[0].singleRegisterFc16);
    EXPECT_EQ(m->devices[0].bitWrite, drv::BitWrite::Mask);
    EXPECT_EQ(m->devices[0].retries, 0);  // TCP
    EXPECT_EQ(m->devices[2].unitId, 7);   // RTU slave
    EXPECT_EQ(m->devices[2].retries, 1);  // RTU
    EXPECT_EQ(m->channels[1].baud, 19200);
    EXPECT_EQ(m->channels[1].parity, "even");
    EXPECT_TRUE(m->channels[1].rtu);
}

TEST(TagModel, ScanGroupsFromTheConnectionsFile) {
    const auto m = buildProjectModel(projectOf(json::array(), kConnections));
    ASSERT_TRUE(m);
    EXPECT_EQ(m->scanGroupMs, (std::array<int, 3>{200, 1500, 7000}));
    const auto d = buildProjectModel(projectOf(json::array()));
    EXPECT_EQ(d->scanGroupMs, (std::array<int, 3>{250, 1000, 5000}));
}

TEST(TagModel, DisabledChannelOrDeviceMarksItsTags) {
    const auto p = projectOf(json::parse(R"([
      {"id":"A","kind":"external","type":"INT16","source":{"device":"off","address":"HR1"}},
      {"id":"B","kind":"external","type":"INT16","source":{"device":"meter1","address":"HR1"}},
      {"id":"C","kind":"external","type":"INT16","source":{"device":"plc1","address":"HR1"}}
    ])"),
                             kConnections);
    const auto m = buildProjectModel(p);
    ASSERT_TRUE(m);
    EXPECT_TRUE(m->tags[0].disabled);  // device enabled: false
    EXPECT_TRUE(m->tags[1].disabled);  // channel enabled: false
    EXPECT_FALSE(m->tags[2].disabled);
}

TEST(TagModel, InternalCalculatedAndSimulationTags) {
    const auto p = projectOf(
        json::parse(R"([
      {"id":"I1","kind":"internal","type":"FLOAT32","initial":85,"retain":true,"access":"RW","limits":{"min":0,"max":100}},
      {"id":"I2","kind":"internal","type":"BOOL"},
      {"id":"I3","kind":"internal","type":"STRING"},
      {"id":"I4","kind":"internal","type":"UINT16","initial":7},
      {"id":"C1","kind":"calculated","type":"FLOAT32","expression":"I1 * 2","deadband":0.5,"valueTable":"T"},
      {"id":"S1","kind":"simulation","type":"FLOAT64","sim":{"kind":"sine","center":50,"amplitude":25,"periodMs":20000}},
      {"id":"S2","kind":"simulation","type":"INT16","access":"RW","sim":{"kind":"manual","initial":4}}
    ])"),
        json(), {{"T", {{"schemaVersion", "0.2.0"}, {"name", "T"}, {"entries", json::array()}}}});
    const auto m = buildProjectModel(p);
    ASSERT_TRUE(m);
    EXPECT_EQ(std::get<double>(m->tags[0].initial), 85.0);
    EXPECT_TRUE(m->tags[0].retain);
    EXPECT_TRUE(m->tags[0].writable);
    EXPECT_EQ(*m->tags[0].limits.max, 100.0);
    EXPECT_EQ(std::get<bool>(m->tags[1].initial), false);  // default initial
    EXPECT_EQ(std::get<std::string>(m->tags[2].initial), "");
    EXPECT_EQ(std::get<uint64_t>(m->tags[3].initial), 7u);
    EXPECT_EQ(m->tags[4].kind, TagKind::Calculated);
    EXPECT_EQ(m->tags[4].expression, "I1 * 2");
    EXPECT_EQ(*m->tags[4].deadband, 0.5);
    EXPECT_EQ(m->tags[4].valueTable, "T");
    EXPECT_FALSE(m->tags[4].writable);
    ASSERT_TRUE(m->tags[5].sim);
    EXPECT_EQ(m->tags[5].sim->kind, sim::SimKind::Sine);
    EXPECT_EQ(m->tags[6].sim->kind, sim::SimKind::Manual);
    EXPECT_TRUE(m->tags[6].writable);
    EXPECT_EQ(m->tables.count("T"), 1u);
    EXPECT_EQ(*m->tagIndex("C1"), 4u);
    EXPECT_FALSE(m->tagIndex("nope"));
}

TEST(TagModel, ScalingAndExplicitRawTypeAndByteOrder) {
    const auto p = projectOf(json::parse(R"([
      {"id":"L","kind":"external","type":"FLOAT32","source":{"device":"plc1","address":"HR100","rawType":"INT16","byteOrder":"ABCD"},
       "scaling":{"rawMin":0,"rawMax":27648,"engMin":0,"engMax":100,"clamp":true}}
    ])"),
                             kConnections);
    const auto m = buildProjectModel(p);
    ASSERT_TRUE(m);
    EXPECT_EQ(m->tags[0].source.rawType, TagType::INT16);
    EXPECT_EQ(m->tags[0].source.byteOrder, modbus::ByteOrder::ABCD);  // the Tag's own
    EXPECT_EQ(m->tags[0].source.addr.registers, 1);
    ASSERT_TRUE(m->tags[0].scaling);
    EXPECT_EQ(m->tags[0].scaling->rawMax, 27648.0);
    EXPECT_TRUE(m->tags[0].scaling->clamp);
}

TEST(TagModel, ADocumentTheValidatorWouldRefuseGivesAnError) {
    const auto p = projectOf(json::parse(R"([
      {"id":"A","kind":"external","type":"INT16","source":{"device":"ghost","address":"HR1"}}
    ])"),
                             kConnections);
    std::string err;
    EXPECT_FALSE(buildProjectModel(p, &err));
    EXPECT_NE(err.find("ghost"), std::string::npos);
}

// project 0.1: every Tag is a `legacy` simulation Tag; nothing about the files changes
TEST(TagModel, Project01BecomesLegacySimulationTags) {
    const std::string schemas = std::string(MAT_SOURCE_DIR) + "/schemas";
    const auto v = validateProject(std::string(MAT_SOURCE_DIR) + "/projects/tank-demo", schemas);
    ASSERT_TRUE(v.valid);
    const auto filesBefore = v.project->files();
    const json tagsBefore = v.project->tags;
    const auto m = buildProjectModel(*v.project);
    ASSERT_TRUE(m);
    EXPECT_TRUE(m->legacy01);
    ASSERT_EQ(m->tags.size(), 5u);
    for (size_t i = 0; i < m->tags.size(); ++i) {
        EXPECT_EQ(m->tags[i].kind, TagKind::Simulation);
        ASSERT_TRUE(m->tags[i].sim);
        EXPECT_EQ(m->tags[i].sim->kind, sim::SimKind::Legacy);
        EXPECT_EQ(m->tags[i].sim->signal,
                  v.project->tags["tags"][i]["source"]["signal"].get<std::string>());
        EXPECT_EQ(m->tags[i].id, v.project->tags["tags"][i]["id"].get<std::string>());
    }
    EXPECT_EQ(v.project->files(), filesBefore);  // files and digest do not change
    EXPECT_EQ(v.project->tags, tagsBefore);
    EXPECT_EQ(*m->tags[0].min, 0.0);
    EXPECT_EQ(m->tags[0].unit, "%");
}

TEST(TagModel, FullDemoVectorLoads) {
    const std::string schemas = std::string(MAT_SOURCE_DIR) + "/schemas";
    const auto v = validateProject(
        std::string(MAT_SOURCE_DIR) + "/tests/project-vectors/v02-valid-full", schemas);
    ASSERT_TRUE(v.valid);
    std::string err;
    const auto m = buildProjectModel(*v.project, &err);
    ASSERT_TRUE(m) << err;
    EXPECT_FALSE(m->legacy01);
    EXPECT_GE(m->tags.size(), 8u);
    bool external = false, calculated = false, internal = false, simulation = false;
    for (const auto& t : m->tags) {
        external |= t.kind == TagKind::External;
        calculated |= t.kind == TagKind::Calculated;
        internal |= t.kind == TagKind::Internal;
        simulation |= t.kind == TagKind::Simulation;
    }
    EXPECT_TRUE(external && calculated && internal && simulation);
}
