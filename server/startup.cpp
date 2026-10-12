#include "server/startup.hpp"

#include <algorithm>

#include "core/session-manager/session_manager.hpp"
#include "core/tag-engine/engine.hpp"
#include "core/tag-engine/sim_factory.hpp"

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
                              const std::optional<std::string>& digest, bool simLoad) {
    ActiveProject a;
    a.maxClients = configMaxClients;
    a.errors = issuesJson(v.errors);
    a.info = {
        {"status", v.valid ? "active" : "invalid"}, {"errors", a.errors}, {"digest", nullptr}};
    // The load Tags of `--sim-load` are served even when no project is active (Sprint 1 behaviour).
    auto simLoadOnly = [&] {
        if (!simLoad) return;
        ProjectModel m;
        addSimLoadTags(m);
        addModelTagsToStore(m, store);
        a.model = std::make_shared<const ProjectModel>(std::move(m));
    };
    if (!v.valid) {
        if (!v.errors.empty() && v.errors[0].code == "E_FILE_MISSING" &&
            v.errors[0].file == "project.json")
            a.info["status"] = "missing";
        simLoadOnly();
        return a;
    }
    const LoadedProject& p = *v.project;
    std::string modelError;
    auto model = buildProjectModel(p, &modelError);
    if (!model) {  // a document the validator let through but the model refuses: not activated
        a.info["status"] = "invalid";
        a.errors.push_back(
            {{"code", "E_MODEL"}, {"file", ""}, {"path", ""}, {"message", modelError}});
        a.info["errors"] = a.errors;
        simLoadOnly();
        return a;
    }
    if (simLoad) addSimLoadTags(*model);
    addModelTagsToStore(*model, store);
    a.model = std::make_shared<const ProjectModel>(std::move(*model));
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
    a.activeJson = p.activeJson();
    if (!a.model->legacy01) {
        // Feature 006 (project-format-0.2 §11): the channels by id, name and kind; never an
        // address, a port or a serial parameter (a page anyone on the network may read).
        nlohmann::json conns = nlohmann::json::array();
        for (const ChannelModel& ch : a.model->channels)
            conns.push_back(
                {{"id", ch.id}, {"name", ch.name}, {"kind", ch.rtu ? "modbus-rtu" : "modbus-tcp"}});
        a.activeJson = withKey(a.activeJson, "connections", conns);
    }
    a.activeJson = withKey(a.activeJson, "digest", d);
    a.info["projectId"] = p.project["projectId"];
    a.info["projectVersion"] = p.project["projectVersion"];
    a.info["digest"] = d;
    return a;
}

}  // namespace mat
