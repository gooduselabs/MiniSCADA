#include "core/project-manager/rules_fins.hpp"

#include <algorithm>

#include "core/project-manager/rules_11.hpp"
#include "drivers/fins/address.hpp"

namespace mat {

using nlohmann::json;

namespace {

bool bcdType(const std::string& t) {
    return t == "INT16" || t == "UINT16" || t == "INT32" || t == "UINT32";
}

void add(std::vector<ProjectIssue>& out, const char* code, const std::string& file,
         const std::string& path, const std::string& msg) {
    out.push_back({code, file, path, msg});
}

}  // namespace

bool finsSourceRules(const json& t, const std::string& p, const json& dev,
                     const std::string& tagFile, std::vector<ProjectIssue>& errors) {
    const json& src = t["source"];
    const std::string type = t["type"];
    const std::string rawType = src.contains("rawType") && src["rawType"].is_string()
                                    ? src["rawType"].get<std::string>()
                                    : type;
    if (src.contains("bcd") && src["bcd"].is_boolean() && src["bcd"].get<bool>() &&
        !bcdType(rawType))
        add(errors, "E_SCHEMA", tagFile, p + "/source/bcd",
            "bcd applies to INT16, UINT16, INT32, UINT32");
    fins::AddressOptions o;
    o.rawType = parseTagType(rawType).value_or(TagType::UINT16);
    o.stringLength = src.contains("stringLength") && src["stringLength"].is_number()
                         ? static_cast<int>(src["stringLength"].get<double>())
                         : 0;
    o.rw = t.value("access", "R") == "RW";
    const std::string address = src["address"];
    const fins::Address r = fins::parseAddress(address, o);
    if (!r.ok) {
        add(errors, r.error.c_str(), tagFile, p + "/source/address",
            "address '" + address + "': " + r.error);
        return false;
    }
    const int maxRead =
        std::min(kFinsMaxReadWords, static_cast<int>(dev.value("maxReadWords", 999.0)));
    if (r.words > maxRead)
        add(errors, "E_ADDR_READ_LIMIT", tagFile, p + "/source",
            "the tag needs " + std::to_string(r.words) + " words, more than one read allows (" +
                std::to_string(maxRead) + ")");
    if (o.rw && r.words > kFinsMaxWriteWords)
        add(errors, "E_ADDR_WRITE_LIMIT", tagFile, p + "/source",
            "the tag needs " + std::to_string(r.words) + " words, more than one write allows (" +
                std::to_string(kFinsMaxWriteWords) + ")");
    return true;
}

void bcdOutsideFins(const json& t, const std::string& p, const std::string& tagFile,
                    std::vector<ProjectIssue>& errors) {
    if (t["source"].contains("bcd"))
        add(errors, "E_SCHEMA", tagFile, p + "/source/bcd",
            "bcd only applies to Omron FINS devices");
}

void finsVersionRules(const json& project, const json* connections, const json* tags,
                      std::vector<ProjectIssue>& errors) {
    if (isSchema11(project.value("schemaVersion", std::string()))) return;
    if (connections && connections->contains("channels")) {
        const std::string connFile =
            project.value("connectionFile", std::string("connections.json"));
        const json& chans = (*connections)["channels"];
        for (size_t i = 0; i < chans.size(); ++i)
            if (chans[i].value("kind", "") == "fins")
                add(errors, "E_CHANNEL_VERSION", connFile,
                    "/channels/" + std::to_string(i) + "/kind",
                    "an Omron FINS channel needs project format 1.1");
    }
    if (tags && tags->contains("tags")) {
        const std::string tagFile = project.value("tagFile", std::string("tags.json"));
        const json& list = (*tags)["tags"];
        for (size_t i = 0; i < list.size(); ++i)
            if (list[i].contains("source") && list[i]["source"].is_object() &&
                list[i]["source"].contains("bcd"))
                add(errors, "E_CHANNEL_VERSION", tagFile,
                    "/tags/" + std::to_string(i) + "/source/bcd",
                    "source.bcd needs project format 1.1");
    }
}

}  // namespace mat
