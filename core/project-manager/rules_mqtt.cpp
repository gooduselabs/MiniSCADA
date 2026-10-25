#include "core/project-manager/rules_mqtt.hpp"

#include <set>

#include "core/project-manager/rules_11.hpp"
#include "drivers/mqtt/address.hpp"

namespace mat {

using nlohmann::json;

namespace {
constexpr size_t kMqttGroupMaxTags = 500;  // as maxItems of "tags"
}  // namespace

void mqttChannelRules(const json& ch, const std::string& cp, const std::string& schemaVersion,
                      const std::string& connFile, const MqttIssueFn& add,
                      const MqttIssueFn& warn) {
    if (!isSchema11(schemaVersion))
        add("E_DRIVER_VERSION", connFile, cp + "/kind",
            "channel kind 'mqtt' needs project format 1.1");
    if (!ch.contains("mqtt") || !ch["mqtt"].is_object()) return;
    const json& q = ch["mqtt"];
    const bool tls = q.contains("tls") && q["tls"].value("enabled", false);
    if (q.contains("tls") && !tls) {
        const json& t = q["tls"];
        if (t.contains("serverCertSha256") || t.contains("caCertPem") || t.contains("serverName"))
            add("E_MQTT_TLS", connFile, cp + "/mqtt/tls",
                "serverCertSha256, caCertPem and serverName need tls.enabled true");
    }
    if (tls && !q["tls"].contains("serverCertSha256") && !q["tls"].contains("caCertPem"))
        warn("W_MQTT_TLS_NOT_PINNED", connFile, cp + "/mqtt/tls",
             "the broker certificate is not trusted yet (serverCertSha256 or caCertPem): the "
             "runtime will not connect");
    if (q.contains("auth") && !tls)
        warn("W_MQTT_PLAIN_PASSWORD", connFile, cp + "/mqtt/auth",
             "user and password on a connection without TLS");
}

void mqttGroupRules(const json& connections, const std::set<std::string>& tagIds,
                    const std::string& connFile, const MqttIssueFn& add) {
    if (!connections.contains("channels") || !connections["channels"].is_array()) return;
    const json& chs = connections["channels"];
    for (size_t ci = 0; ci < chs.size(); ++ci) {
        const json& ch = chs[ci];
        if (!ch.is_object() || ch.value("kind", "") != "mqtt" || !ch.contains("mqtt")) continue;
        const json& q = ch["mqtt"];
        if (!q.contains("publishGroups")) continue;
        const json& gs = q["publishGroups"];
        for (size_t g = 0; g < gs.size(); ++g) {
            const std::string gp =
                "/channels/" + std::to_string(ci) + "/mqtt/publishGroups/" + std::to_string(g);
            std::set<std::string> members;
            if (gs[g].contains("tags")) {
                const json& tags = gs[g]["tags"];
                for (size_t k = 0; k < tags.size(); ++k) {
                    const std::string id = tags[k];
                    if (!tagIds.count(id))
                        add("E_MQTT_GROUP_TAG", connFile, gp + "/tags/" + std::to_string(k),
                            "Tag '" + id + "' of the publish group does not exist");
                    else
                        members.insert(id);
                }
            }
            // feature 025: each name pattern matches a Tag; at most 500 Tags once expanded
            if (gs[g].contains("tagPatterns")) {
                const json& pats = gs[g]["tagPatterns"];
                for (size_t k = 0; k < pats.size(); ++k) {
                    const std::string pat = pats[k];
                    bool any = false;
                    for (const std::string& id : tagIds)
                        if (mqtt::tagPatternMatches(pat, id)) {
                            any = true;
                            members.insert(id);
                        }
                    if (!any)
                        add("E_MQTT_GROUP_PATTERN", connFile,
                            gp + "/tagPatterns/" + std::to_string(k),
                            "pattern '" + pat + "' matches no Tag");
                }
            }
            if (members.size() > kMqttGroupMaxTags)
                add("E_MQTT_GROUP_PATTERN", connFile, gp,
                    "the publish group has " + std::to_string(members.size()) +
                        " Tags, more than " + std::to_string(kMqttGroupMaxTags));
        }
    }
}

void mqttTagRules(const json& t, const std::string& p, const std::string& tagFile,
                  const MqttIssueFn& add) {
    const json& src = t["source"];
    if (src.contains("byteOrder"))
        add("E_SCHEMA", tagFile, p + "/source/byteOrder", "byteOrder does not apply to MQTT tags");
    if (src.contains("stringByteOrder"))
        add("E_SCHEMA", tagFile, p + "/source/stringByteOrder",
            "stringByteOrder does not apply to MQTT tags");
    const std::string address = src["address"];
    const mqtt::Address a = mqtt::parseAddress(address);
    if (!a.ok) {
        add(a.error.c_str(), tagFile, p + "/source/address",
            "MQTT address '" + address + "': " + a.error);
        return;
    }
    const bool rw = t.value("access", "R") == "RW";
    if (rw && a.dir == mqtt::Direction::Subscribe)
        add("E_MQTT_DIRECTION", tagFile, p + "/source/address",
            "a writable MQTT tag needs pub: or both: in its address");
    if (!rw && a.dir == mqtt::Direction::Publish)
        add("E_MQTT_DIRECTION", tagFile, p + "/source/address",
            "a pub: MQTT tag only takes values by writes: it needs access RW");
}

}  // namespace mat
