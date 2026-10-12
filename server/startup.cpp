#include "server/startup.hpp"

#include <algorithm>

#include "core/session-manager/session_manager.hpp"

namespace mat {

namespace {

// `object` with one more key at its end, without parsing it again (activeJson() can be large).
std::string withKey(const std::string& object, const char* key, const nlohmann::json& value) {
    if (object.size() < 2 || object.back() != '}') return object;
    std::string out = object.substr(0, object.size() - 1);
    if (out.size() > 1) out += ',';
    out += nlohmann::json(key).dump() + ':' + value.dump() + '}';
    return out;
}

}  // namespace

size_t effectiveMaxClients(size_t configMax, size_t projectMax) {
    return SessionManager::clampMax(std::min(configMax, projectMax));
}

ActiveProject activateProject(const ProjectValidation& v, size_t configMaxClients, TagStore& store,
                              const std::optional<std::string>& digest) {
    ActiveProject a;
    a.maxClients = configMaxClients;
    a.errors = issuesJson(v.errors);
    a.info = {
        {"status", v.valid ? "active" : "invalid"}, {"errors", a.errors}, {"digest", nullptr}};
    if (!v.valid) {
        if (!v.errors.empty() && v.errors[0].code == "E_FILE_MISSING" &&
            v.errors[0].file == "project.json")
            a.info["status"] = "missing";
        return a;
    }
    const LoadedProject& p = *v.project;
    for (const auto& t : p.tags["tags"]) {
        const auto type = parseTagType(t["type"].get<std::string>());
        store.add({t["id"].get<std::string>(), type ? *type : TagType::FLOAT64,
                   t["source"]["signal"].get<std::string>()});
    }
    a.active = true;
    // Read as double: an integral float such as 1e1 stays a float in the loaded document.
    a.maxClients = effectiveMaxClients(configMaxClients,
                                       static_cast<size_t>(p.project["maxClients"].get<double>()));
    a.digest = digest;
    // Protocol 1.1.0: the key is there even when the digest is unknown (null), so a client does not
    // take this runtime for a 1.0.0 one.
    const nlohmann::json d = digest ? nlohmann::json(*digest) : nlohmann::json(nullptr);
    a.helloJson = withKey(p.helloJson(), "digest", d);
    a.allowlist = p.allowlist();
    a.activeJson = withKey(p.activeJson(), "digest", d);
    a.info["projectId"] = p.project["projectId"];
    a.info["projectVersion"] = p.project["projectVersion"];
    a.info["digest"] = d;
    return a;
}

}  // namespace mat
