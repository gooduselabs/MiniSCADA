// The Mitsubishi MC drivers of a project (feature 017): one McDriver per channel of kind "mc" of
// the model, with its field devices and its external Tags resolved as the driver wants them
// (drivers/mc/mc_driver.hpp). The index of a Tag is its index in the model and in the TagStore.
#pragma once
#include <memory>
#include <vector>

#include "core/tag-engine/tag_model.hpp"
#include "drivers/mc/mc_driver.hpp"

namespace mat {

// The configuration of channel `channel` (an index in model.channels, kind "mc").
drv::McConfig mcConfigOf(const ProjectModel& model, size_t channel, int writeQueueCapacity = 16);

struct McChannelDriver {
    size_t channel = 0;  // index in model.channels
    std::unique_ptr<drv::McDriver> driver;
};

std::vector<McChannelDriver> makeMcDrivers(const ProjectModel& model, int writeQueueCapacity = 16,
                                           const drv::McEnv& env = {});

}  // namespace mat
