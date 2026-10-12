// The serial ports a project may use on this device (feature 006 T166, T168; research R13), from
// `serialPorts` of the configuration and the console of the system. One place for the validator
// (E_SERIAL_NOT_ALLOWED), the channel drivers (PORT_CONSOLE, PORT_NOT_ALLOWED) and the API.
#pragma once
#include <limits.h>
#include <stdlib.h>

#include <string>
#include <vector>

#include "core/common/serial_match.hpp"
#include "core/project-manager/project_validator.hpp"
#include "drivers/sdk/serial_ports.hpp"

namespace mat {

// The console of the system holds `port` ("ttyAS2", or a /dev/serial path that points to it).
// `root`: prefix of /proc and /sys ("" = the real ones; a test gives a fake tree).
inline bool serialPortIsConsole(const std::string& port, const std::string& root = "") {
    std::string name = serialShortName(port);
    if (name.empty()) {  // by-id / by-path: the tty it points to
        char buf[PATH_MAX];
        const std::string path = root + port;
        if (::realpath(path.c_str(), buf) == nullptr) return false;
        const std::string real = buf;
        const size_t s = real.find_last_of('/');
        name = s == std::string::npos ? real : real.substr(s + 1);
    }
    return !name.empty() && drv::isConsolePort(root, name);
}

inline SerialPolicy serialPolicyOf(const std::vector<std::string>& patterns,
                                   const std::string& root = "") {
    SerialPolicy p;
    p.allowPatterns = patterns;
    p.isConsole = [root](const std::string& port) { return serialPortIsConsole(port, root); };
    return p;
}

// What a channel driver asks before it opens a port: "" (go on), PORT_CONSOLE (the console or a
// getty holds it) or PORT_NOT_ALLOWED (not in `serialPorts`). The console wins over the list.
inline std::string serialPortRefusal(const std::vector<std::string>& patterns,
                                     const std::string& port, const std::string& root = "") {
    const std::string name = serialShortName(port);
    if (serialPortIsConsole(port, root)) return "PORT_CONSOLE";
    if (!name.empty() && drv::hasGetty(root, name)) return "PORT_CONSOLE";
    if (!serialPortInList(patterns, port)) return "PORT_NOT_ALLOWED";
    return "";
}

}  // namespace mat
