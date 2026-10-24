#include "core/tag-engine/s7_factory.hpp"

namespace mat {

drv::S7Config s7ConfigOf(const ProjectModel& model, size_t channel, int writeQueueCapacity) {
    const ChannelModel& ch = model.channels[channel];
    drv::S7Config c;
    c.channelId = ch.id;
    c.enabled = ch.enabled;
    c.host = ch.host;
    c.port = ch.port;
    c.connectTimeoutMs = ch.connectTimeoutMs;
    c.reconnectMaxS = ch.reconnectMaxS;
    c.requestGapMs = ch.requestGapMs;
    c.localTsap = static_cast<uint16_t>(ch.s7LocalTsap);
    c.remoteTsap = static_cast<uint16_t>(ch.s7RemoteTsap);
    c.pduSize = ch.s7PduSize;
    for (size_t g = 0; g < 3; ++g) c.scanMs[g] = model.scanGroupMs[g];
    c.writeQueueCapacity = writeQueueCapacity;
    c.hasDevice = !ch.devices.empty();
    if (c.hasDevice) {
        const DeviceModel& d = model.devices[ch.devices[0]];
        c.deviceId = d.id;
        c.deviceEnabled = d.enabled;
        c.timeoutMs = d.timeoutMs;
        c.retries = d.retries;
        c.maxGapBytes = d.maxGapBytes;
    }
    for (size_t i = 0; i < model.tags.size(); ++i) {
        const TagModel& t = model.tags[i];
        if (t.kind != TagKind::External || t.channel != channel || !c.hasDevice ||
            t.device != ch.devices[0])
            continue;
        drv::S7TagBinding b;
        b.tag = i;
        b.addr = t.source.s7addr;
        b.stringLength = t.source.stringLength;
        b.group = t.source.group;
        b.readback = t.source.readback;
        c.tags.push_back(std::move(b));
    }
    return c;
}

std::vector<S7ChannelDriver> makeS7Drivers(const ProjectModel& model, int writeQueueCapacity,
                                           const drv::S7Env& env) {
    std::vector<S7ChannelDriver> out;
    for (size_t ch = 0; ch < model.channels.size(); ++ch) {
        if (model.channels[ch].kind != "s7") continue;
        S7ChannelDriver d;
        d.channel = ch;
        d.driver = std::make_unique<drv::S7Driver>(s7ConfigOf(model, ch, writeQueueCapacity), env);
        out.push_back(std::move(d));
    }
    return out;
}

}  // namespace mat
