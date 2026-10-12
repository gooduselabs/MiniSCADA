#include "drivers/sdk/serial_ports.hpp"

#include <dirent.h>
#include <limits.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <fstream>
#include <set>
#include <sstream>

#include "core/common/serial_match.hpp"
#include "drivers/sdk/serial_port.hpp"

namespace mat::drv {

namespace {

std::string readFile(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return {};
    std::ostringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

std::string trim(std::string s) {
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) s.pop_back();
    size_t i = 0;
    while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) ++i;
    return s.substr(i);
}

// lstat: a link counts even when its target is not there (a getty link of systemd)
bool exists(const std::string& path) {
    struct stat st;
    return ::lstat(path.c_str(), &st) == 0;
}

std::vector<std::string> listDir(const std::string& path) {
    std::vector<std::string> out;
    DIR* d = ::opendir(path.c_str());
    if (!d) return out;
    while (const dirent* e = ::readdir(d)) {
        const std::string n = e->d_name;
        if (n != "." && n != "..") out.push_back(n);
    }
    ::closedir(d);
    std::sort(out.begin(), out.end());
    return out;
}

std::string linkTarget(const std::string& path) {
    char buf[PATH_MAX];
    const ssize_t n = ::readlink(path.c_str(), buf, sizeof buf - 1);
    return n > 0 ? std::string(buf, static_cast<size_t>(n)) : std::string();
}

std::string realPath(const std::string& path) {
    char buf[PATH_MAX];
    return ::realpath(path.c_str(), buf) ? std::string(buf) : std::string();
}

std::string baseName(const std::string& p) {
    const size_t s = p.find_last_of('/');
    return s == std::string::npos ? p : p.substr(s + 1);
}

std::string parentOf(const std::string& p) {
    const size_t s = p.find_last_of('/');
    return s == std::string::npos || s == 0 ? std::string() : p.substr(0, s);
}

// ttyAS2, ttyUSB0, ttyACM1: "tty", letters, digits (ttyN is a virtual console)
bool ttyNameOk(const std::string& n) {
    if (n.compare(0, 3, "tty") != 0) return false;
    size_t i = 3, letters = 0, digits = 0;
    while (i < n.size() && std::isalpha(static_cast<unsigned char>(n[i]))) ++i, ++letters;
    while (i < n.size() && std::isdigit(static_cast<unsigned char>(n[i]))) ++i, ++digits;
    return i == n.size() && letters >= 1 && digits >= 1;
}

std::set<std::string> consoleNames(const std::string& root) {
    std::set<std::string> out;
    std::istringstream consoles(readFile(root + "/proc/consoles"));
    std::string line;
    while (std::getline(consoles, line)) {
        std::istringstream ls(line);
        std::string first;
        if (ls >> first) out.insert(first);
    }
    std::istringstream active(readFile(root + "/sys/class/tty/console/active"));
    std::string tok;
    while (active >> tok) out.insert(tok);
    return out;
}

std::string withoutRoot(const std::string& path, const std::string& root) {
    const std::string r = root.empty() ? std::string() : realPath(root);
    if (!r.empty() && path.compare(0, r.size(), r) == 0) return path.substr(r.size());
    return path;
}

}  // namespace

bool isConsolePort(const std::string& root, const std::string& name) {
    return consoleNames(root).count(name) != 0;
}

bool hasGetty(const std::string& root, const std::string& name) {
    return exists(root + "/etc/systemd/system/getty.target.wants/serial-getty@" + name +
                  ".service");
}

bool hasLockFile(const std::string& root, const std::string& name) {
    return exists(root + "/run/lock/LCK.." + name);
}

std::string serialDevicePath(const std::string& port) {
    if (!port.empty() && port.front() == '/') return port;
    return "/dev/" + port;
}

std::vector<SerialPortInfo> listSerialPorts(const SerialPortsEnv& env, bool probe) {
    std::vector<SerialPortInfo> out;
    const std::string ttyDir = env.root + "/sys/class/tty";
    const std::set<std::string> consoles = consoleNames(env.root);
    std::vector<std::string> channelPorts;
    if (env.channelPorts) channelPorts = env.channelPorts();

    // /dev/serial/by-id: link name by the tty it points to
    std::vector<std::pair<std::string, std::string>> byIds;  // (tty name, path)
    for (const std::string& e : listDir(env.root + "/dev/serial/by-id")) {
        const std::string target = linkTarget(env.root + "/dev/serial/by-id/" + e);
        if (!target.empty()) byIds.emplace_back(baseName(target), "/dev/serial/by-id/" + e);
    }

    for (const std::string& name : listDir(ttyDir)) {
        if (!ttyNameOk(name)) continue;
        const std::string dir = ttyDir + "/" + name;
        // an 8250 port with no hardware reports type 0
        const std::string type = trim(readFile(dir + "/type"));
        if (type == "0") continue;

        SerialPortInfo p;
        p.name = name;
        p.path = "/dev/" + name;
        for (const auto& [tty, path] : byIds)
            if (tty == name) {
                p.byId = path;
                break;
            }
        p.kind = "unknown";
        const std::string real = realPath(dir + "/device");
        if (!real.empty()) {
            const std::string rel = withoutRoot(real, env.root);
            p.kind = rel.find("/usb") != std::string::npos ? "usb" : "onboard";
            if (p.kind == "usb") {
                for (std::string d = real; !d.empty(); d = parentOf(d)) {
                    if (exists(d + "/idVendor")) {
                        p.hasUsb = true;
                        p.vid = trim(readFile(d + "/idVendor"));
                        p.pid = trim(readFile(d + "/idProduct"));
                        p.product = trim(readFile(d + "/product"));
                        p.serial = trim(readFile(d + "/serial"));
                        break;
                    }
                }
            }
            const std::string drv = linkTarget(dir + "/device/driver");
            if (!drv.empty()) {
                std::string b = baseName(drv);
                if (b.compare(0, 3, "tty") == 0) b = baseName(parentOf(drv));
                p.driver = b;
            }
        }
        p.console = consoles.count(name) != 0;
        p.allowed =
            !p.console && (serialPortInList(env.allowPatterns, name) ||
                           (!p.byId.empty() && serialPortInList(env.allowPatterns, p.byId)));
        if (p.console) {
            p.inUseBy = "console";
            p.inUseDetail = "console của hệ điều hành";
        } else if (hasGetty(env.root, name)) {
            p.inUseBy = "getty";
            p.inUseDetail = "serial-getty@" + name + ".service";
        } else {
            for (const std::string& cp : channelPorts)
                if (cp == name || cp == p.path || (!p.byId.empty() && cp == p.byId)) {
                    p.inUseBy = "channel";
                    p.inUseDetail = "kênh của runtime";
                    break;
                }
            if (p.inUseBy.empty() && hasLockFile(env.root, name)) {
                p.inUseBy = "lock";
                p.inUseDetail = "/run/lock/LCK.." + name;
            }
        }
        const bool probeThis = probe && p.allowed && p.inUseBy.empty();
        if (env.rs485)
            p.rs485 = env.rs485(p.path, probeThis);
        else
            p.rs485 = rs485StateName(queryRs485(p.path, probeThis));
        out.push_back(std::move(p));
    }
    return out;
}

nlohmann::json serialPortsJson(const std::vector<SerialPortInfo>& ports) {
    using nlohmann::json;
    json list = json::array();
    for (const SerialPortInfo& p : ports) {
        json j = {{"name", p.name},
                  {"path", p.path},
                  {"kind", p.kind},
                  {"driver", p.driver},
                  {"allowed", p.allowed}};
        if (!p.byId.empty()) j["byId"] = p.byId;
        if (p.hasUsb) {
            json u = {{"vid", p.vid}, {"pid", p.pid}};
            if (!p.product.empty()) u["product"] = p.product;
            if (!p.serial.empty()) u["serial"] = p.serial;
            j["usb"] = u;
        }
        j["inUse"] =
            p.inUseBy.empty() ? json(nullptr) : json{{"by", p.inUseBy}, {"detail", p.inUseDetail}};
        j["rs485"] = p.rs485;
        list.push_back(std::move(j));
    }
    return json{{"ports", list}};
}

}  // namespace mat::drv
