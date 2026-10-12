// Builds the simulation driver of a project: every Tag of kind simulation, with the `legacy` Tags
// of a 0.1 project (Sprint 1 mock signals) and the SIM.* load Tags (signal "sim.load") (specs/006
// T056).
#pragma once
#include <memory>

#include "core/tag-engine/tag_model.hpp"
#include "drivers/simulation/simulation_driver.hpp"

namespace mat {

std::unique_ptr<SimulationDriver> makeSimulationDriver(const ProjectModel& model);

// Appends SIM.T0001..SIM.T0500 (FLOAT32, simulation, signal "sim.load") to the model: the load
// tags of `--sim-load` (FR-018(b)).
void addSimLoadTags(ProjectModel& model);

}  // namespace mat
