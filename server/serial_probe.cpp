#include "server/serial_probe.hpp"

#include "core/common/serial_match.hpp"
#include "drivers/modbus/test_probe.hpp"
#include "drivers/sdk/serial_port.hpp"
#include "drivers/sdk/serial_ports.hpp"
#include "server/serial_policy.hpp"

namespace mat {

namespace {

std::vector<drv::ModbusTcpDriver*> rtuChannels(const SerialDeviceEnv& env) {
    std::vector<drv::ModbusTcpDriver*> out;
    if (!env.channels) return out;
    for (drv::ModbusTcpDriver* d : env.channels())
        if (d && d->isRtu()) out.push_back(d);
    return out;
}

bool holdsPort(const drv::ModbusTcpDriver& d) {
    return d.linkState(0).channel == drv::ChannelState::Connected;
}

}  // namespace

drv::TestOutcome probeSerialOnDevice(const SerialDeviceEnv& env, const std::string& port,
                                     const drv::RtuProbeRequest& request) {
    drv::TestOutcome out;
    const std::string refusal = serialPortRefusal(env.allowPatterns, port, env.root);
    if (!refusal.empty()) {
        out.code = refusal;
        return out;
    }
    const std::string path = drv::serialDevicePath(port);
    drv::SerialLink link;
    link.port = port;
    link.baud = request.baud;
    link.dataBits = request.dataBits;
    link.parity = request.parity;
    link.stopBits = request.stopBits;
    for (drv::ModbusTcpDriver* d : rtuChannels(env)) {
        const drv::SerialLink& mine = *d->config().serial;
        if (drv::serialDevicePath(mine.port) != path || !holdsPort(*d)) continue;
        // a channel holds the port: only its own frame may be used
        if (!d->sameSerialFrame(link)) {
            out.code = "PORT_BUSY";
            return out;
        }
        if (!request.read) {  // nothing to send: the channel has the port open
            out.code = "OK";
            return out;
        }
        return d->probeThroughQueue(request, request.connectTimeoutMs + request.timeoutMs + 2000);
    }
    return drv::probeModbusRtu(request);
}

nlohmann::json serialPortsOnDevice(const SerialDeviceEnv& env, bool probe,
                                   std::vector<std::string>& probed) {
    drv::SerialPortsEnv e;
    e.root = env.root;
    e.allowPatterns = env.allowPatterns;
    const auto channels = rtuChannels(env);
    e.channelPorts = [&channels] {
        std::vector<std::string> held;
        for (const drv::ModbusTcpDriver* d : channels)
            if (holdsPort(*d)) held.push_back(d->config().serial->port);
        return held;
    };
    e.rs485 = [&](const std::string& devicePath, bool probeThis) {
        for (const drv::ModbusTcpDriver* d : channels) {
            if (!holdsPort(*d) || drv::serialDevicePath(d->config().serial->port) != devicePath)
                continue;
            if (!d->config().serial->rs485) return std::string("unknown");
            drv::DriverDiag diag;
            d->diagnostics(diag, 0);
            for (const std::string& w : diag.channel.warnings)
                if (w == "RS485_UNSUPPORTED") return std::string("unsupported");
            return std::string("enabled");
        }
        if (!probeThis) return std::string("unknown");
        probed.push_back(devicePath.compare(0, 5, "/dev/") == 0 ? devicePath.substr(5)
                                                                : devicePath);
        return std::string(drv::rs485StateName(drv::queryRs485(devicePath, true)));
    };
    return drv::serialPortsJson(drv::listSerialPorts(e, probe));
}

}  // namespace mat
