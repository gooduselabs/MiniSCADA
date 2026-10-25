#include "core/tag-engine/mqtt_factory.hpp"

namespace mat {

drv::MqttConfig mqttConfigOf(const ProjectModel& model, size_t channel, int writeQueueCapacity) {
    const ChannelModel& ch = model.channels[channel];
    drv::MqttConfig c;
    c.channelId = ch.id;
    c.enabled = ch.enabled;
    c.host = ch.host;
    c.port = ch.port;
    c.clientId = ch.mqttClientId;
    c.keepAliveS = ch.mqttKeepAliveS;
    c.cleanSession = ch.mqttCleanSession;
    c.tls.enabled = ch.mqttTls;
    c.tls.serverCertSha256 = ch.mqttServerCertSha256;
    c.tls.caCertPem = ch.mqttCaCertPem;
    c.tls.serverName = ch.mqttServerName;
    c.hasAuth = ch.mqttAuth;
    c.username = ch.mqttUsername;
    c.secretId = ch.mqttSecretId;
    c.hasWill = ch.mqttWill;
    c.willTopic = ch.mqttWillTopic;
    c.willPayload = ch.mqttWillPayload;
    c.willQos = ch.mqttWillQos;
    c.willRetain = ch.mqttWillRetain;
    c.maxPublishPerS = ch.mqttMaxPublishPerS;
    c.connectTimeoutMs = ch.connectTimeoutMs;
    c.reconnectMaxS = ch.reconnectMaxS;
    c.writeQueueCapacity = writeQueueCapacity;
    c.hasDevice = !ch.devices.empty();
    if (c.hasDevice) {
        const DeviceModel& d = model.devices[ch.devices[0]];
        c.deviceId = d.id;
        c.deviceEnabled = d.enabled;
        c.timeoutMs = d.timeoutMs;
        c.staleAfterMs = d.mqttStaleAfterMs;
    }
    for (size_t i = 0; i < model.tags.size(); ++i) {
        const TagModel& t = model.tags[i];
        if (t.kind != TagKind::External || t.channel != channel || !c.hasDevice ||
            t.device != ch.devices[0] || !t.source.mqttAddr.ok)
            continue;
        drv::MqttTagBinding b;
        b.tag = i;
        b.addr = t.source.mqttAddr;
        b.rawType = t.source.rawType;
        b.stringLength = t.source.stringLength;
        c.tags.push_back(std::move(b));
    }
    for (const MqttGroupModel& g : ch.mqttGroups) {
        drv::MqttGroupConfig gc;
        gc.topic = g.topic;
        gc.intervalMs = g.intervalMs;
        gc.onChange = g.onChange;
        gc.qos = g.qos;
        gc.retain = g.retain;
        for (const std::string& id : g.tags)
            if (const auto idx = model.tagIndex(id)) {
                gc.tags.push_back(*idx);
                gc.ids.push_back(id);
            }
        if (!gc.tags.empty()) c.groups.push_back(std::move(gc));
    }
    return c;
}

std::vector<MqttChannelDriver> makeMqttDrivers(const ProjectModel& model, int writeQueueCapacity,
                                               const drv::MqttEnv& env) {
    std::vector<MqttChannelDriver> out;
    for (size_t ch = 0; ch < model.channels.size(); ++ch) {
        if (model.channels[ch].kind != "mqtt") continue;
        MqttChannelDriver d;
        d.channel = ch;
        d.driver =
            std::make_unique<drv::MqttDriver>(mqttConfigOf(model, ch, writeQueueCapacity), env);
        out.push_back(std::move(d));
    }
    return out;
}

}  // namespace mat
