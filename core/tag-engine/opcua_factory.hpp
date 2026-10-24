// The OPC UA drivers of a project (feature 019): one driver per `opcua` channel of the model, with
// its server and its external Tags resolved as the driver wants them
// (drivers/opcua/opcua_driver.hpp). The index of a Tag is its index in the model, which is its
// index in the TagStore.
#pragma once
#include <memory>
#include <vector>

#include "core/tag-engine/tag_model.hpp"
#include "drivers/opcua/opcua_driver.hpp"

namespace mat {

// The configuration of channel `channel` (an index in model.channels, kind opcua).
drv::OpcUaConfig opcuaConfigOf(const ProjectModel& model, size_t channel,
                               int writeQueueCapacity = 16);

struct OpcUaChannelDriver {
    size_t channel = 0;  // index in model.channels
    std::unique_ptr<drv::OpcUaDriver> driver;
};

std::vector<OpcUaChannelDriver> makeOpcUaDrivers(const ProjectModel& model,
                                                 int writeQueueCapacity = 16,
                                                 const drv::OpcUaEnv& env = {});

}  // namespace mat
