#include "core/project-manager/rules_bacnet.hpp"

#include "core/project-manager/rules_11.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "drivers/bacnet/address.hpp"

namespace mat {

using nlohmann::json;

bool bacnetSourceRules(const json& t, const std::string& p, const std::string& tagFile,
                       std::vector<ProjectIssue>& errors) {
    const json& src = t["source"];
    const std::string type = t["type"];
    const std::string rawTypeName = src.contains("rawType") && src["rawType"].is_string()
                                        ? src["rawType"].get<std::string>()
                                        : type;
    bacnet::AddressOptions o;
    o.rawType = parseTagType(rawTypeName).value_or(TagType::FLOAT32);
    o.rw = t.value("access", "R") == "RW";
    const std::string address = src["address"];
    const bacnet::Address a = bacnet::parseAddress(address, o);
    if (!a.ok) {
        errors.push_back(
            {a.error, tagFile, p + "/source/address", "address '" + address + "': " + a.error});
        return false;
    }
    return true;
}

void bacnetVersionRules(const json& project, const json* connections,
                        std::vector<ProjectIssue>& errors) {
    if (!connections || isSchema11(project.value("schemaVersion", ""))) return;
    const std::string connFile = project.value("connectionFile", "connections.json");
    if (!connections->contains("channels") || !(*connections)["channels"].is_array()) return;
    const json& chs = (*connections)["channels"];
    for (size_t i = 0; i < chs.size(); ++i)
        if (chs[i].is_object() && chs[i].value("kind", "") == "bacnet")
            errors.push_back({"E_CHANNEL_VERSION", connFile,
                              "/channels/" + std::to_string(i) + "/kind",
                              "a BACnet/IP channel needs project format 1.1"});
}

}  // namespace mat
