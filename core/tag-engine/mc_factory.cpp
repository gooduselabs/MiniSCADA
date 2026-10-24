#include "core/tag-engine/mc_factory.hpp"

#include <algorithm>

namespace mat {

drv::McConfig mcConfigOf(const ProjectModel& model, size_t channel, int writeQueueCapacity) {
    const ChannelModel& ch = model.channels[channel];
    drv::McConfig c;
    c.channelId = ch.id;
    c.enabled = ch.enabled;
    c.host = ch.host;
    c.port = ch.port;
    c.frame = ch.mcFrame == "4E" ? mc::FrameType::E4 : mc::FrameType::E3;
    c.code = ch.mcCode == "ascii" ? mc::CodeType::Ascii : mc::CodeType::Binary;
    c.udp = ch.mcTransport == "udp";
    c.connectTimeoutMs = ch.connectTimeoutMs;
    c.reconnectMaxS = ch.reconnectMaxS;
    c.requestGapMs = ch.requestGapMs;
    for (size_t g = 0; g < 3; ++g) c.scanMs[g] = model.scanGroupMs[g];
    c.writeQueueCapacity = writeQueueCapacity;

    for (size_t deviceIndex : ch.devices) {
        const DeviceModel& d = model.devices[deviceIndex];
        drv::McDeviceConfig dc;
        dc.id = d.id;
        dc.enabled = d.enabled;
        dc.route.network = static_cast<uint8_t>(d.network);
        dc.route.station = static_cast<uint8_t>(d.station);
        dc.route.moduleIo = static_cast<uint16_t>(d.moduleIo);
        dc.route.moduleStation = static_cast<uint8_t>(d.moduleStation);
        dc.xyOctal = d.xyOctal;
        dc.timeoutMs = d.timeoutMs;
        dc.retries = d.retries;
        dc.writeDeadlineMs = d.writeDeadlineMs;
        dc.maxBatchWords = d.maxBatchWords;
        dc.maxGapWords = d.maxGapWords;
        dc.randomRead = d.randomRead;
        dc.maxRandomPoints = d.maxRandomPoints;
        dc.bitRmw = d.bitWrite == drv::BitWrite::ReadModifyWrite;
        c.devices.push_back(std::move(dc));
    }

    for (size_t i = 0; i < model.tags.size(); ++i) {
        const TagModel& t = model.tags[i];
        if (t.kind != TagKind::External || t.channel != channel || !t.source.mcAddr.ok) continue;
        const auto it = std::find(ch.devices.begin(), ch.devices.end(), t.device);
        if (it == ch.devices.end()) continue;
        const mc::McAddress& a = t.source.mcAddr;
        drv::McTagBinding b;
        b.tag = i;
        b.device = static_cast<uint32_t>(it - ch.devices.begin());
        b.dev = a.device;
        b.number = a.number;
        b.bitDevice = a.bitDevice;
        b.words = a.words;
        b.bit = a.bit;
        b.rawType = t.source.rawType;
        b.byteOrder = t.source.byteOrder;
        b.stringOrder = t.source.stringOrder;
        b.stringLength = t.source.stringLength;
        b.group = t.source.group;
        b.readback = t.source.readback;
        c.tags.push_back(std::move(b));
    }
    return c;
}

std::vector<McChannelDriver> makeMcDrivers(const ProjectModel& model, int writeQueueCapacity,
                                           const drv::McEnv& env) {
    std::vector<McChannelDriver> out;
    for (size_t ch = 0; ch < model.channels.size(); ++ch) {
        if (model.channels[ch].kind != "mc") continue;
        McChannelDriver d;
        d.channel = ch;
        d.driver = std::make_unique<drv::McDriver>(mcConfigOf(model, ch, writeQueueCapacity), env);
        out.push_back(std::move(d));
    }
    return out;
}

}  // namespace mat
