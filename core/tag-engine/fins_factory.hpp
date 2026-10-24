// The Omron FINS drivers of a project (feature 018): one driver per `fins` channel of the model,
// enabled or not, with its field devices and its external Tags resolved as the driver wants them
// (drivers/fins/fins_driver.hpp). The index of a Tag is its index in the model, which is its index
// in the TagStore.
#pragma once
#include <memory>
#include <vector>

#include "core/tag-engine/tag_model.hpp"
#include "drivers/fins/fins_driver.hpp"

namespace mat {

// The configuration of channel `channel` (an index in model.channels, a fins one).
drv::FinsConfig finsConfigOf(const ProjectModel& model, size_t channel,
                             int writeQueueCapacity = 16);

struct FinsChannelDriver {
    size_t channel = 0;  // index in model.channels
    std::unique_ptr<drv::FinsDriver> driver;
};

std::vector<FinsChannelDriver> makeFinsDrivers(const ProjectModel& model,
                                               int writeQueueCapacity = 16,
                                               const drv::FinsEnv& env = {});

}  // namespace mat
