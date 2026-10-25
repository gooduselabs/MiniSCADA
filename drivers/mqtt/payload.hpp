// MQTT payloads <-> Tag values (feature 022, specs/022-driver-mqtt/spec.md "Giá trị"). Pure.
//   - in: the raw text (trimmed) or the node at a JSON path, decoded by the raw type of the Tag;
//   - out: the value as text (BOOL 1/0), or a JSON object built along the path;
//   - a group: {"ts":<ms>,"values":{"<id>":<v>|null},"quality":{"<id>":"GOOD"|...}}.
#pragma once
#include <string>
#include <utility>
#include <vector>

#include "core/tag-engine/tag_store.hpp"
#include "drivers/mqtt/address.hpp"

namespace mat::mqtt {

constexpr size_t kMaxPayload = 64 * 1024;  // a larger message is dropped (counted)

struct Decoded {
    bool ok = false;
    TagScalar value;
};

// `steps` empty and `json` false: the payload is the value as text. `stringLength` > 0 cuts a
// STRING at that many bytes (on a UTF-8 boundary).
Decoded decodePayload(const std::string& payload, bool json, const std::vector<PathStep>& steps,
                      TagType rawType, int stringLength = 0);

// The text of a raw value as a Tag decodes it (no JSON); also the value of a node.
Decoded decodeText(const std::string& text, TagType rawType, int stringLength = 0);

std::string encodePayload(const TagScalar& value, TagType rawType, bool json,
                          const std::vector<PathStep>& steps);

struct GroupEntry {
    std::string id;
    TagValue value;
};
std::string encodeGroup(int64_t tsMs, const std::vector<GroupEntry>& entries);

}  // namespace mat::mqtt
