#include "core/tag-engine/opcua_factory.hpp"

namespace mat {

drv::OpcUaConfig opcuaConfigOf(const ProjectModel& model, size_t channel, int writeQueueCapacity) {
    const ChannelModel& ch = model.channels[channel];
    drv::OpcUaConfig c;
    c.channelId = ch.id;
    c.enabled = ch.enabled;
    c.endpointUrl = ch.opcuaEndpoint;
    c.securityMode = ch.opcuaSecurityMode == "Sign" ? drv::OpcUaSecurityMode::Sign
                                                    : ch.opcuaSecurityMode == "SignAndEncrypt"
                                                          ? drv::OpcUaSecurityMode::SignAndEncrypt
                                                          : drv::OpcUaSecurityMode::None;
    c.basic256Sha256 = ch.opcuaSecurityPolicy == "Basic256Sha256";
    c.serverCertSha256 = ch.opcuaServerCertSha256;
    c.authUsername = ch.opcuaAuthUsername;
    c.username = ch.opcuaUsername;
    c.secretId = ch.opcuaSecretId;
    c.poll = ch.opcuaPoll;
    c.sessionTimeoutMs = ch.opcuaSessionTimeoutMs;
    c.connectTimeoutMs = ch.connectTimeoutMs;
    c.reconnectMaxS = ch.reconnectMaxS;
    for (size_t g = 0; g < 3; ++g) c.scanMs[g] = model.scanGroupMs[g];
    c.writeQueueCapacity = writeQueueCapacity;
    c.hasDevice = !ch.devices.empty();
    if (c.hasDevice) {
        const DeviceModel& d = model.devices[ch.devices[0]];
        c.deviceId = d.id;
        c.deviceEnabled = d.enabled;
        c.timeoutMs = d.timeoutMs;
    }
    for (size_t i = 0; i < model.tags.size(); ++i) {
        const TagModel& t = model.tags[i];
        if (t.kind != TagKind::External || t.channel != channel || !c.hasDevice ||
            t.device != ch.devices[0])
            continue;
        drv::OpcUaTagBinding b;
        b.tag = i;
        b.nodeId = t.source.nodeId.normalized;
        b.rawType = t.source.rawType;
        b.group = t.source.group;
        b.readback = t.source.readback;
        c.tags.push_back(std::move(b));
    }
    return c;
}

std::vector<OpcUaChannelDriver> makeOpcUaDrivers(const ProjectModel& model, int writeQueueCapacity,
                                                 const drv::OpcUaEnv& env) {
    std::vector<OpcUaChannelDriver> out;
    for (size_t ch = 0; ch < model.channels.size(); ++ch) {
        if (model.channels[ch].kind != "opcua") continue;
        OpcUaChannelDriver d;
        d.channel = ch;
        d.driver =
            std::make_unique<drv::OpcUaDriver>(opcuaConfigOf(model, ch, writeQueueCapacity), env);
        out.push_back(std::move(d));
    }
    return out;
}

}  // namespace mat
