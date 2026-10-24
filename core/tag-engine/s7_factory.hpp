// The Siemens S7 drivers of a project (feature 016): one driver per `s7` channel of the model, with
// its CPU and its external Tags resolved as the driver wants them (drivers/s7/s7_driver.hpp). The
// index of a Tag is its index in the model, which is its index in the TagStore.
#pragma once
#include <memory>
#include <vector>

#include "core/tag-engine/tag_model.hpp"
#include "drivers/s7/s7_driver.hpp"

namespace mat {

// The configuration of channel `channel` (an index in model.channels, kind s7).
drv::S7Config s7ConfigOf(const ProjectModel& model, size_t channel, int writeQueueCapacity = 16);

struct S7ChannelDriver {
    size_t channel = 0;  // index in model.channels
    std::unique_ptr<drv::S7Driver> driver;
};

std::vector<S7ChannelDriver> makeS7Drivers(const ProjectModel& model, int writeQueueCapacity = 16,
                                           const drv::S7Env& env = {});

}  // namespace mat
