#include "core/tag-engine/fins_factory.hpp"

namespace mat {

drv::FinsConfig finsConfigOf(const ProjectModel& model, size_t channel, int writeQueueCapacity) {
    const ChannelModel& ch = model.channels[channel];
    drv::FinsConfig c;
    c.channelId = ch.id;
    c.enabled = ch.enabled;
    c.host = ch.host;
    c.port = ch.port;
    c.tcp = ch.finsTcp;
    c.sourceNetwork = ch.finsSourceNetwork;
    c.sourceNode = ch.finsSourceNode;
    c.localPort = ch.finsLocalPort;
    c.connectTimeoutMs = ch.connectTimeoutMs;
    c.reconnectMaxS = ch.reconnectMaxS;
    c.requestGapMs = ch.requestGapMs;
    for (size_t g = 0; g < 3; ++g) c.scanMs[g] = model.scanGroupMs[g];
    c.writeQueueCapacity = writeQueueCapacity;
    for (size_t deviceIndex : ch.devices) {
        const DeviceModel& d = model.devices[deviceIndex];
        drv::FinsDeviceConfig dc;
        dc.id = d.id;
        dc.enabled = d.enabled;
        dc.network = d.finsNetwork;
        dc.node = d.finsNode;
        dc.unit = d.finsUnit;
        dc.timeoutMs = d.timeoutMs;
        dc.retries = d.retries;
        dc.writeDeadlineMs = d.writeDeadlineMs;
        dc.maxReadWords = d.maxReadWords;
        dc.maxGapWords = d.maxGapWords;
        dc.multiRead = d.multiRead;
        dc.maxMultiItems = d.maxMultiItems;
        c.devices.push_back(std::move(dc));
    }
    for (size_t i = 0; i < model.tags.size(); ++i) {
        const TagModel& t = model.tags[i];
        if (t.kind != TagKind::External || t.channel != channel || !t.source.finsAddr.ok) continue;
        size_t local = 0;
        bool found = false;
        for (size_t k = 0; k < ch.devices.size(); ++k)
            if (ch.devices[k] == t.device) {
                local = k;
                found = true;
            }
        if (!found) continue;
        drv::FinsTagBinding b;
        b.tag = i;
        b.device = static_cast<uint32_t>(local);
        b.addr = t.source.finsAddr;
        b.rawType = t.source.rawType;
        b.byteOrder = t.source.byteOrder;
        b.stringOrder = t.source.stringOrder;
        b.stringLength = t.source.stringLength;
        b.bcd = t.source.bcd;
        b.group = t.source.group;
        b.readback = t.source.readback;
        c.tags.push_back(std::move(b));
    }
    return c;
}

std::vector<FinsChannelDriver> makeFinsDrivers(const ProjectModel& model, int writeQueueCapacity,
                                               const drv::FinsEnv& env) {
    std::vector<FinsChannelDriver> out;
    for (size_t ch = 0; ch < model.channels.size(); ++ch) {
        if (!model.channels[ch].isFins) continue;
        FinsChannelDriver d;
        d.channel = ch;
        d.driver =
            std::make_unique<drv::FinsDriver>(finsConfigOf(model, ch, writeQueueCapacity), env);
        out.push_back(std::move(d));
    }
    return out;
}

}  // namespace mat
