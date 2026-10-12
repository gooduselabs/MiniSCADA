// The list of serial ports (feature 006 T162; research R13; data-model §11): read from /sys and
// /proc only; nothing is opened, except by `probe`. The roots are injected so that a test builds a
// fake tree in a temporary directory.
#pragma once
#include <functional>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"

namespace mat::drv {

struct SerialPortInfo {
    std::string name;  // ttyAS2
    std::string path;  // /dev/ttyAS2
    std::string byId;  // /dev/serial/by-id/... or ""
    std::string kind;  // onboard | usb | unknown
    std::string driver;
    bool hasUsb = false;
    std::string vid, pid, product, serial;  // with hasUsb
    bool allowed = false;                   // in `serialPorts`, and not a console
    bool console = false;
    std::string inUseBy;            // console | getty | channel | lock | "" (free)
    std::string inUseDetail;        // text for the engineer
    std::string rs485 = "unknown";  // enabled | supported | unsupported | unknown
};

struct SerialPortsEnv {
    std::string root;                        // prefix of /sys, /proc, /etc, /dev, /run ("" = real)
    std::vector<std::string> allowPatterns;  // serialPorts of runtime.json
    // Ports (a name or a path) the channels of the runtime hold; null: none
    std::function<std::vector<std::string>()> channelPorts;
    // RS485 state of a port by device path; `probe` says the caller asked to ask the port. Null:
    // queryRs485() (which opens nothing unless probing).
    std::function<std::string(const std::string& devicePath, bool probe)> rs485;
};

// Ports sorted by name. `probe` is passed to env.rs485 only for an allowed port that is free.
std::vector<SerialPortInfo> listSerialPorts(const SerialPortsEnv& env, bool probe = false);

// {"ports": [...]} of GET /api/v1/serial/ports and of --list-serial (device-api-1.1 §6): name,
// path, byId (when there is one), kind, driver, usb {vid, pid, product, serial} (a USB port),
// allowed, inUse (null or {by, detail}), rs485.
nlohmann::json serialPortsJson(const std::vector<SerialPortInfo>& ports);

// The console of the system: /proc/consoles and /sys/class/tty/console/active name it. `name` is
// "ttyS0" (no /dev/).
bool isConsolePort(const std::string& root, const std::string& name);
// A getty is enabled on the port (serial-getty@<name>.service).
bool hasGetty(const std::string& root, const std::string& name);
// UUCP lock file /run/lock/LCK..<name>.
bool hasLockFile(const std::string& root, const std::string& name);

// The device path a project's `serial.port` stands for: "ttyAS2" -> "/dev/ttyAS2"; a
// /dev/serial/by-id path stays as it is.
std::string serialDevicePath(const std::string& port);

}  // namespace mat::drv
