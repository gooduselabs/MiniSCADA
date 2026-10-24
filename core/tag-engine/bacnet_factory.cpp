#include "core/tag-engine/bacnet_factory.hpp"

namespace mat {

drv::BacnetConfig bacnetConfigOf(const ProjectModel& model, size_t channel,
                                 int writeQueueCapacity) {
    const ChannelModel& ch = model.channels[channel];
    drv::BacnetConfig c;
    c.channelId = ch.id;
    c.enabled = ch.enabled;
    c.localPort = ch.port;
    c.bindAddress = ch.bacnetBindAddress;
    c.broadcast = ch.bacnetBroadcast;
    c.bbmdHost = ch.bacnetBbmdHost;
    c.bbmdPort = ch.bacnetBbmdPort;
    c.bbmdTtlS = ch.bacnetBbmdTtlS;
    c.reconnectMaxS = ch.reconnectMaxS;
    c.requestGapMs = ch.requestGapMs;
    for (size_t g = 0; g < 3; ++g) c.scanMs[g] = model.scanGroupMs[g];
    c.writeQueueCapacity = writeQueueCapacity;
    for (size_t deviceIndex : ch.devices) {
        const DeviceModel& d = model.devices[deviceIndex];
        drv::BacnetDeviceConfig dc;
        dc.id = d.id;
        dc.enabled = d.enabled;
        dc.deviceInstance = d.bacnetInstance;
        dc.host = d.bacnetHost;
        dc.port = d.bacnetPort;
        dc.network = d.bacnetNetwork;
        dc.mac = bacnet::fromHex(d.bacnetMac);
        dc.maxApdu = d.bacnetMaxApdu;
        dc.timeoutMs = d.timeoutMs;
        dc.retries = d.retries;
        dc.writeDeadlineMs = d.writeDeadlineMs;
        dc.writePriority = d.bacnetWritePriority;
        dc.useRpm = d.bacnetUseRpm;
        dc.maxRpmProps = d.bacnetMaxRpmProps;
        c.devices.push_back(std::move(dc));
    }
    for (size_t i = 0; i < model.tags.size(); ++i) {
        const TagModel& t = model.tags[i];
        if (t.kind != TagKind::External || t.channel != channel || !t.source.bacnetAddr.ok)
            continue;
        size_t local = 0;
        bool found = false;
        for (size_t k = 0; k < ch.devices.size(); ++k)
            if (ch.devices[k] == t.device) {
                local = k;
                found = true;
            }
        if (!found) continue;
        drv::BacnetTagBinding b;
        b.tag = i;
        b.device = static_cast<uint32_t>(local);
        b.addr = t.source.bacnetAddr;
        b.rawType = t.source.rawType;
        b.stringLength = t.source.stringLength;
        b.group = t.source.group;
        b.readback = t.source.readback;
        c.tags.push_back(std::move(b));
    }
    return c;
}

std::vector<BacnetChannelDriver> makeBacnetDrivers(const ProjectModel& model,
                                                   int writeQueueCapacity,
                                                   const drv::BacnetEnv& env) {
    std::vector<BacnetChannelDriver> out;
    for (size_t ch = 0; ch < model.channels.size(); ++ch) {
        if (!model.channels[ch].isBacnet) continue;
        BacnetChannelDriver d;
        d.channel = ch;
        d.driver =
            std::make_unique<drv::BacnetDriver>(bacnetConfigOf(model, ch, writeQueueCapacity), env);
        out.push_back(std::move(d));
    }
    return out;
}

}  // namespace mat
