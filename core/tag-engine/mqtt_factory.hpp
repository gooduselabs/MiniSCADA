// The MQTT drivers of a project (feature 022): one driver per `mqtt` channel of the model, with
// its broker and its external Tags resolved as the driver wants them
// (drivers/mqtt/mqtt_driver.hpp), and its publish groups with the Tag ids turned into indexes.
// The index of a Tag is its index in the model, which is its index in the TagStore.
#pragma once
#include <memory>
#include <vector>

#include "core/tag-engine/tag_model.hpp"
#include "drivers/mqtt/mqtt_driver.hpp"

namespace mat {

// The configuration of channel `channel` (an index in model.channels, kind mqtt).
drv::MqttConfig mqttConfigOf(const ProjectModel& model, size_t channel,
                             int writeQueueCapacity = 16);

struct MqttChannelDriver {
    size_t channel = 0;  // index in model.channels
    std::unique_ptr<drv::MqttDriver> driver;
};

std::vector<MqttChannelDriver> makeMqttDrivers(const ProjectModel& model,
                                               int writeQueueCapacity = 16,
                                               const drv::MqttEnv& env = {});

}  // namespace mat
