// MQTT Tag addresses and topic filters on the shared vectors (tests/mqtt-vectors/address.json)
// with TypeScript (packages/tag-codec/src/mqtt-address.test.ts), feature 022.
#include <gtest/gtest.h>

#include <fstream>
#include <set>

#include "drivers/mqtt/address.hpp"
#include "nlohmann/json.hpp"

using nlohmann::json;
using namespace mat;

namespace {
json vectors() {
    std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/mqtt-vectors/address.json",
                    std::ios::binary);
    return json::parse(f);
}
}  // namespace

// Feature 025: the name patterns of a publish group (tagPatterns).
TEST(MqttAddress, TagPatternsOfTheSharedVectors) {
    const json all = vectors()["tagPatterns"];
    ASSERT_GE(all.size(), 15u);
    for (const auto& c : all)
        EXPECT_EQ(mqtt::tagPatternMatches(c["pattern"], c["tag"]), c["expect"].get<bool>())
            << c.dump();
}

TEST(MqttAddress, SharedVectors) {
    const json all = vectors()["cases"];
    ASSERT_GE(all.size(), 50u);
    std::set<std::string> codes, dirs;
    for (const auto& c : all) {
        const std::string name = c["name"];
        const mqtt::Address r = mqtt::parseAddress(c["address"].get<std::string>());
        const json& e = c["expect"];
        if (e.contains("error")) {
            codes.insert(e["error"].get<std::string>());
            EXPECT_FALSE(r.ok) << name;
            EXPECT_EQ(r.error, e["error"].get<std::string>()) << name;
            continue;
        }
        ASSERT_TRUE(r.ok) << name << " " << r.error;
        dirs.insert(mqtt::directionName(r.dir));
        EXPECT_EQ(mqtt::directionName(r.dir), e["dir"].get<std::string>()) << name;
        EXPECT_EQ(r.topic, e["topic"].get<std::string>()) << name;
        EXPECT_EQ(r.hasPath, e.contains("path")) << name;
        if (e.contains("path")) {
            EXPECT_EQ(r.path, e["path"].get<std::string>()) << name;
        }
        EXPECT_EQ(r.qos, e["qos"].get<int>()) << name;
        EXPECT_EQ(r.retain, e["retain"].get<bool>()) << name;
        EXPECT_EQ(r.wildcard, e["wildcard"].get<bool>()) << name;
    }
    EXPECT_EQ(codes, (std::set<std::string>{"E_ADDR_RANGE", "E_ADDR_SYNTAX"}));
    EXPECT_EQ(dirs, (std::set<std::string>{"both", "pub", "sub"}));
}

TEST(MqttAddress, TopicMatchVectors) {
    for (const auto& m : vectors()["match"]) {
        EXPECT_EQ(mqtt::topicMatches(m["filter"].get<std::string>(), m["topic"].get<std::string>()),
                  m["expect"].get<bool>())
            << m.dump();
    }
}

TEST(MqttAddress, PathSteps) {
    const mqtt::Address a = mqtt::parseAddress("t|$.values[3].v");
    ASSERT_TRUE(a.ok);
    ASSERT_EQ(a.steps.size(), 3u);
    EXPECT_EQ(a.steps[0].name, "values");
    EXPECT_TRUE(a.steps[1].index);
    EXPECT_EQ(a.steps[1].n, 3);
    EXPECT_EQ(a.steps[2].name, "v");
}

TEST(MqttAddress, PublishTopic) {
    EXPECT_TRUE(mqtt::validPublishTopic("plant/state"));
    EXPECT_FALSE(mqtt::validPublishTopic(""));
    EXPECT_FALSE(mqtt::validPublishTopic("a/+"));
    EXPECT_FALSE(mqtt::validPublishTopic("a/#"));
}
