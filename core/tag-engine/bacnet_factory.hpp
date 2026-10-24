// The BACnet/IP drivers of a project (feature 020): one driver per `bacnet` channel of the model,
// enabled or not, with its devices and its external Tags resolved as the driver wants them
// (drivers/bacnet/bacnet_driver.hpp). The index of a Tag is its index in the model, which is its
// index in the TagStore.
#pragma once
#include <memory>
#include <vector>

#include "core/tag-engine/tag_model.hpp"
#include "drivers/bacnet/bacnet_driver.hpp"

namespace mat {

// The configuration of channel `channel` (an index in model.channels, a bacnet one).
drv::BacnetConfig bacnetConfigOf(const ProjectModel& model, size_t channel,
                                 int writeQueueCapacity = 16);

struct BacnetChannelDriver {
    size_t channel = 0;  // index in model.channels
    std::unique_ptr<drv::BacnetDriver> driver;
};

std::vector<BacnetChannelDriver> makeBacnetDrivers(const ProjectModel& model,
                                                   int writeQueueCapacity = 16,
                                                   const drv::BacnetEnv& env = {});

}  // namespace mat
