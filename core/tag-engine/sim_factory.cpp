#include "core/tag-engine/sim_factory.hpp"

#include <cstdio>

namespace mat {

std::unique_ptr<SimulationDriver> makeSimulationDriver(const ProjectModel& model) {
    std::vector<SimulationDriver::Item> items;
    std::vector<LegacyMock::Bound> legacy;
    std::vector<size_t> load;
    for (size_t i = 0; i < model.tags.size(); ++i) {
        const TagModel& t = model.tags[i];
        if (t.kind != TagKind::Simulation || !t.sim) continue;
        if (t.sim->kind == sim::SimKind::Legacy) {
            if (t.sim->signal == "sim.load")
                load.push_back(i);
            else
                legacy.push_back({i, t.sim->signal});
        } else {
            items.push_back({i, t.type, *t.sim});
        }
    }
    return std::make_unique<SimulationDriver>(std::move(items), std::move(legacy), std::move(load));
}

void addSimLoadTags(ProjectModel& model) {
    char id[16];
    for (size_t k = 1; k <= LegacyMock::kSimTagCount; ++k) {
        std::snprintf(id, sizeof id, "SIM.T%04zu", k);
        if (model.tagIndex(id)) continue;
        TagModel t;
        t.id = id;
        t.kind = TagKind::Simulation;
        t.type = TagType::FLOAT32;
        sim::SimConfig c;
        c.kind = sim::SimKind::Legacy;
        c.signal = "sim.load";
        t.sim = c;
        model.tags.push_back(std::move(t));
    }
}

}  // namespace mat
