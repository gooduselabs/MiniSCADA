#include "core/tag-engine/modbus_factory.hpp"

#include <algorithm>

#include "drivers/modbus/modbus_rtu_driver.hpp"

namespace mat {

drv::ModbusTcpConfig modbusTcpConfigOf(const ProjectModel& model, size_t channel,
                                       const ModbusFactoryOptions& options) {
    const ChannelModel& ch = model.channels[channel];
    drv::ModbusTcpConfig c;
    c.channelId = ch.id;
    c.enabled = ch.enabled;
    c.host = ch.host;
    c.port = ch.port;
    if (ch.rtu) {
        drv::SerialLink s;
        s.port = ch.serialPort;
        s.baud = ch.baud;
        s.dataBits = ch.dataBits;
        s.parity = ch.parity == "none" ? 'N' : (ch.parity == "odd" ? 'O' : 'E');
        s.stopBits = ch.stopBits;
        s.rs485 = ch.rs485;
        s.dropEcho = ch.dropEcho;
        s.silenceMs = ch.silenceMs;
        c.serial = s;
    }
    c.connectTimeoutMs = ch.connectTimeoutMs;
    c.reconnectMaxS = ch.reconnectMaxS;
    c.requestGapMs = ch.requestGapMs;
    for (size_t g = 0; g < 3; ++g) c.scanMs[g] = model.scanGroupMs[g];
    c.writeQueueCapacity = options.writeQueueCapacity;

    for (size_t deviceIndex : ch.devices) {
        const DeviceModel& d = model.devices[deviceIndex];
        drv::ModbusDeviceConfig dc;
        dc.id = d.id;
        dc.unit = d.unitId;
        dc.enabled = d.enabled;
        dc.timeoutMs = d.timeoutMs;
        dc.retries = d.retries;
        dc.writeDeadlineMs = d.writeDeadlineMs;
        dc.maxReadRegisters = d.maxReadRegisters;
        dc.maxReadBits = d.maxReadBits;
        dc.maxGapRegisters = d.maxGapRegisters;
        dc.maxGapBits = d.maxGapBits;
        c.devices.push_back(std::move(dc));
    }

    for (size_t i = 0; i < model.tags.size(); ++i) {
        const TagModel& t = model.tags[i];
        if (t.kind != TagKind::External || t.channel != channel) continue;
        // the field device of the Tag, as its position in this channel
        size_t local = 0;
        bool found = false;
        for (size_t k = 0; k < ch.devices.size(); ++k)
            if (ch.devices[k] == t.device) {
                local = k;
                found = true;
            }
        if (!found) continue;
        const DeviceModel& d = model.devices[t.device];
        drv::TagBinding b;
        b.tag = i;
        b.device = static_cast<uint32_t>(local);
        b.area = t.source.addr.area;
        b.offset = t.source.addr.offset;
        b.count = std::max(1, t.source.addr.registers);
        b.bit = t.source.addr.bit;
        b.rawType = t.source.rawType;
        b.byteOrder = t.source.byteOrder;
        b.stringOrder = t.source.stringOrder;
        b.stringLength = t.source.stringLength;
        b.group = t.source.group;
        b.readback = t.source.readback;
        b.bitWrite = d.bitWrite;
        b.writeSingleRegisterFc16 = d.singleRegisterFc16;
        b.writeSingleCoilFc15 = d.singleCoilFc15;
        c.tags.push_back(std::move(b));
    }
    return c;
}

std::vector<ModbusChannelDriver> makeModbusTcpDrivers(const ProjectModel& model,
                                                      const ModbusFactoryOptions& options,
                                                      const drv::DriverEnv& env) {
    std::vector<ModbusChannelDriver> out;
    for (size_t ch = 0; ch < model.channels.size(); ++ch) {
        ModbusChannelDriver d;
        d.channel = ch;
        drv::DriverEnv e = env;
        if (model.channels[ch].rtu && !e.checkPort) e.checkPort = options.checkPort;
        if (model.channels[ch].rtu)
            d.driver = std::make_unique<drv::ModbusRtuDriver>(modbusTcpConfigOf(model, ch, options),
                                                              std::move(e));
        else
            d.driver = std::make_unique<drv::ModbusTcpDriver>(modbusTcpConfigOf(model, ch, options),
                                                              std::move(e));
        out.push_back(std::move(d));
    }
    return out;
}

}  // namespace mat
