// The address of a Tag of an MQTT channel (feature 022, specs/022-driver-mqtt/spec.md):
//   [sub:|pub:|both:]<topic>[|<jsonPath>][;qos=0|1][;retain]
// Direction sub by default; a topic of pub or both has no wildcard and does not start with `$`.
// The JSON path is `$` followed by `.name` or `[index]` steps. Pure: the project validator uses it.
// Same rules as packages/tag-codec/src/mqtt-address.ts, shared vectors
// tests/mqtt-vectors/address.json.
#pragma once
#include <string>
#include <vector>

namespace mat::mqtt {

enum class Direction { Subscribe, Publish, Both };

struct PathStep {
    bool index = false;  // [n] when true, .name otherwise
    std::string name;
    int n = 0;
};

struct Address {
    bool ok = false;
    std::string error;  // E_ADDR_SYNTAX, E_ADDR_RANGE
    Direction dir = Direction::Subscribe;
    std::string topic;  // the topic, or the topic filter of a sub Tag
    bool hasPath = false;
    std::string path;  // as written, "" without one
    std::vector<PathStep> steps;
    int qos = 0;
    bool retain = false;
    bool wildcard = false;  // the topic has + or #
};

Address parseAddress(const std::string& address);

// "sub", "pub", "both"
const char* directionName(Direction d);

// MQTT 3.1.1 §4.7: does `topic` (no wildcard) match `filter`? A filter that starts with a wildcard
// does not match a topic that starts with `$`.
bool topicMatches(const std::string& filter, const std::string& topic);

// Feature 025: a name pattern of a publish group (tagPatterns): "*" any characters (also none),
// "?" exactly one character (a UTF-8 character, not a byte), anything else itself; case matters.
bool tagPatternMatches(const std::string& pattern, const std::string& tag);

// A topic of a publish (a group, the will): non empty, no wildcard, no NUL.
bool validPublishTopic(const std::string& topic);

}  // namespace mat::mqtt
