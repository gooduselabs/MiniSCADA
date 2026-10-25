// MQTT rules of format 1.1 (feature 022, specs/022-driver-mqtt/spec.md FR-006), the C++ twin of
// packages/project-schema/src/rules-mqtt.ts. The same codes and paths on tests/project-vectors
// (cases v11-mqtt-*, README-022.md):
//   - channel: format 1.1 (E_DRIVER_VERSION), TLS fields with TLS off (E_MQTT_TLS), TLS without a
//     pin or a CA (W_MQTT_TLS_NOT_PINNED), a user without TLS (W_MQTT_PLAIN_PASSWORD);
//   - publish groups: every Tag id exists (E_MQTT_GROUP_TAG);
//   - Tag: byteOrder / stringByteOrder (E_SCHEMA), the address (drivers/mqtt/address), the
//     direction against the access (E_MQTT_DIRECTION).
#pragma once
#include <functional>
#include <set>
#include <string>

#include "nlohmann/json.hpp"

namespace mat {

using MqttIssueFn = std::function<void(const char* code, const std::string& file,
                                       const std::string& path, const std::string& message)>;

void mqttChannelRules(const nlohmann::json& ch, const std::string& cp,
                      const std::string& schemaVersion, const std::string& connFile,
                      const MqttIssueFn& add, const MqttIssueFn& warn);

// The publish groups of every mqtt channel of `connections` against the Tag ids.
void mqttGroupRules(const nlohmann::json& connections, const std::set<std::string>& tagIds,
                    const std::string& connFile, const MqttIssueFn& add);

void mqttTagRules(const nlohmann::json& tag, const std::string& p, const std::string& tagFile,
                  const MqttIssueFn& add);

}  // namespace mat
