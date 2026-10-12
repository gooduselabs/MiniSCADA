#include "server/cli/serial.hpp"

#include <cstring>
#include <ostream>
#include <vector>

#include "drivers/sdk/serial_ports.hpp"

namespace mat {

namespace {
bool hasFlag(int argc, char** argv, const char* flag) {
    for (int i = 1; i < argc; ++i)
        if (std::strcmp(argv[i], flag) == 0) return true;
    return false;
}
}  // namespace

bool isSerialCommand(int argc, char** argv) { return hasFlag(argc, argv, "--list-serial"); }

int runSerialCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
                 std::ostream& err) {
    std::vector<std::string> overrides;  // --config, --serial-ports
    std::string root;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--list-serial") continue;
        if (a == "--config" || a == "--serial-ports" || a == "--sys-root") {
            if (i + 1 >= argc || *argv[i + 1] == '\0') {
                err << a << " cần một giá trị\n";
                return 2;
            }
            const std::string value = argv[++i];
            if (a == "--sys-root") {
                root = value;
            } else {
                overrides.push_back(a);
                overrides.push_back(value);
            }
        } else {
            err << "tham số không hỗ trợ: " << a << "\n";
            return 2;
        }
    }
    RuntimeConfig cfg;
    std::string error;
    if (!loadDeviceCliConfig(overrides, env, cfg, error)) {
        err << "cấu hình: " << error << "\n";
        return 2;
    }
    drv::SerialPortsEnv e;
    e.root = root;
    e.allowPatterns = cfg.serialPorts;
    out << drv::serialPortsJson(drv::listSerialPorts(e)).dump(2) << "\n";
    return 0;
}

}  // namespace mat
