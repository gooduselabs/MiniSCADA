// OPC UA NodeIds on the shared vectors (tests/opcua-vectors/nodeid.json) with TypeScript
// (packages/tag-codec/src/opcua-node-id.test.ts), feature 019.
#include <gtest/gtest.h>

#include <fstream>
#include <set>

#include "drivers/opcua/node_id.hpp"
#include "nlohmann/json.hpp"

using nlohmann::json;
using namespace mat;

TEST(OpcUaNodeId, SharedVectors) {
    std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/opcua-vectors/nodeid.json",
                    std::ios::binary);
    const json all = json::parse(f)["cases"];
    ASSERT_GE(all.size(), 60u);
    std::set<std::string> codes, kinds;
    for (const auto& c : all) {
        const std::string name = c["name"];
        const opcua::NodeIdRef r = opcua::parseNodeId(c["address"].get<std::string>());
        const json& e = c["expect"];
        if (e.contains("error")) {
            codes.insert(e["error"].get<std::string>());
            EXPECT_FALSE(r.ok) << name;
            EXPECT_EQ(r.error, e["error"].get<std::string>()) << name;
            continue;
        }
        ASSERT_TRUE(r.ok) << name << " " << r.error;
        kinds.insert(opcua::idTypeName(r.type));
        EXPECT_EQ(r.ns, e["ns"].get<int>()) << name;
        EXPECT_EQ(opcua::idTypeName(r.type), e["idType"].get<std::string>()) << name;
        EXPECT_EQ(r.id, e["id"].get<std::string>()) << name;
        EXPECT_EQ(r.normalized, e["normalized"].get<std::string>()) << name;
        if (r.type == opcua::IdType::Numeric) EXPECT_EQ(std::to_string(r.numeric), r.id) << name;
    }
    EXPECT_EQ(codes, (std::set<std::string>{"E_ADDR_RANGE", "E_ADDR_SYNTAX"}));
    EXPECT_EQ(kinds, (std::set<std::string>{"b", "g", "i", "s"}));
}
