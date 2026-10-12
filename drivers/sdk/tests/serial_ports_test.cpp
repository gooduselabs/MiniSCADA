// The list of serial ports from a fake /sys, /proc, /etc, /dev and /run tree (feature 006 T161;
// research R13; data-model §11). Nothing in the list opens a port.
#include "drivers/sdk/serial_ports.hpp"

#include <gtest/gtest.h>
#include <unistd.h>

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <map>
#include <string>

#include "core/common/serial_match.hpp"

namespace fs = std::filesystem;
using namespace mat::drv;

namespace {

class Tree {
   public:
    Tree() {
        char tmpl[] = "/tmp/mat-serial-XXXXXX";
        const char* d = ::mkdtemp(tmpl);
        root_ = d ? d : "";
    }
    ~Tree() {
        std::error_code ec;
        fs::remove_all(root_, ec);
    }
    const std::string& root() const { return root_; }
    void file(const std::string& rel, const std::string& text) {
        fs::create_directories(fs::path(root_ + rel).parent_path());
        std::ofstream(root_ + rel) << text;
    }
    void dir(const std::string& rel) { fs::create_directories(root_ + rel); }
    void link(const std::string& rel, const std::string& target) {
        fs::create_directories(fs::path(root_ + rel).parent_path());
        fs::create_symlink(target, root_ + rel);
    }
    // /sys/class/tty/<name> with a `device` that is a directory of the platform bus
    void onboard(const std::string& name, const std::string& hw, const std::string& driver,
                 const std::string& type = "") {
        dir("/sys/devices/platform/soc/" + hw);
        link("/sys/devices/platform/soc/" + hw + "/driver",
             "../../../../bus/platform/drivers/" + driver);
        dir("/sys/class/tty/" + name);
        link("/sys/class/tty/" + name + "/device", root_ + "/sys/devices/platform/soc/" + hw);
        if (!type.empty()) file("/sys/class/tty/" + name + "/type", type + "\n");
    }
    void usb(const std::string& name, const std::string& vid, const std::string& pid,
             const std::string& product, const std::string& serial, const std::string& driver) {
        const std::string dev = "/sys/devices/platform/soc/usb1/1-1/1-1.2";
        dir(dev + "/1-1.2:1.0/" + name);
        file(dev + "/idVendor", vid + "\n");
        file(dev + "/idProduct", pid + "\n");
        file(dev + "/product", product + "\n");
        if (!serial.empty()) file(dev + "/serial", serial + "\n");
        link(dev + "/1-1.2:1.0/driver", "../../../../../../../bus/usb/drivers/" + driver);
        dir("/sys/class/tty/" + name);
        link("/sys/class/tty/" + name + "/device", root_ + dev + "/1-1.2:1.0");
    }

   private:
    std::string root_;
};

const SerialPortInfo* find(const std::vector<SerialPortInfo>& v, const std::string& name) {
    for (const auto& p : v)
        if (p.name == name) return &p;
    return nullptr;
}

// ttyAS0 console, ttyAS2 free, ttyAS3 getty, ttyAS4 a channel of the runtime, ttyAS5 locked by
// another program, ttyS0 with no hardware, ttyS1 8250 with hardware, one USB bridge, virtual tty0.
void build(Tree& t) {
    t.onboard("ttyAS0", "1c28000.serial", "sunxi-uart", "");
    t.onboard("ttyAS2", "1c28800.serial", "sunxi-uart", "");
    t.onboard("ttyAS3", "1c28c00.serial", "sunxi-uart", "");
    t.onboard("ttyAS4", "1c29000.serial", "sunxi-uart", "");
    t.onboard("ttyAS5", "1c29400.serial", "sunxi-uart", "");
    t.onboard("ttyS0", "serial8250-0", "serial8250", "0");
    t.onboard("ttyS1", "serial8250-1", "serial8250", "4");
    t.dir("/sys/class/tty/tty0");
    t.dir("/sys/class/tty/tty12");
    t.dir("/sys/class/tty/console");
    t.dir("/sys/class/tty/ptmx");
    t.usb("ttyUSB0", "1a86", "7523", "USB Serial", "A1B2", "ch341-uart");
    t.link("/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0", "../../ttyUSB0");
    t.file("/proc/consoles", "ttyAS0               -W- (EC p a)    4:64\n");
    t.file("/sys/class/tty/console/active", "ttyAS0\n");
    t.link("/etc/systemd/system/getty.target.wants/serial-getty@ttyAS3.service",
           "/lib/systemd/system/serial-getty@.service");
    t.file("/run/lock/LCK..ttyAS5", "      123 root\n");
}

}  // namespace

TEST(SerialPorts, ListsNameKindDriverAndUsbDetails) {
    Tree t;
    build(t);
    SerialPortsEnv env;
    env.root = t.root();
    env.allowPatterns = {"ttyAS*"};
    const auto ports = listSerialPorts(env);
    const SerialPortInfo* as2 = find(ports, "ttyAS2");
    ASSERT_NE(as2, nullptr);
    EXPECT_EQ(as2->path, "/dev/ttyAS2");
    EXPECT_EQ(as2->kind, "onboard");
    EXPECT_EQ(as2->driver, "sunxi-uart");
    EXPECT_FALSE(as2->hasUsb);
    EXPECT_TRUE(as2->byId.empty());

    const SerialPortInfo* usb = find(ports, "ttyUSB0");
    ASSERT_NE(usb, nullptr);
    EXPECT_EQ(usb->kind, "usb");
    EXPECT_EQ(usb->driver, "ch341-uart");
    ASSERT_TRUE(usb->hasUsb);
    EXPECT_EQ(usb->vid, "1a86");
    EXPECT_EQ(usb->pid, "7523");
    EXPECT_EQ(usb->product, "USB Serial");
    EXPECT_EQ(usb->serial, "A1B2");
    EXPECT_EQ(usb->byId, "/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0");
}

TEST(SerialPorts, HidesPortsWithoutHardwareAndVirtualConsoles) {
    Tree t;
    build(t);
    SerialPortsEnv env;
    env.root = t.root();
    const auto ports = listSerialPorts(env);
    EXPECT_EQ(find(ports, "ttyS0"), nullptr);  // 8250 `type` = 0
    EXPECT_NE(find(ports, "ttyS1"), nullptr);  // `type` = 4
    EXPECT_EQ(find(ports, "tty0"), nullptr);
    EXPECT_EQ(find(ports, "tty12"), nullptr);
    EXPECT_EQ(find(ports, "console"), nullptr);
    EXPECT_EQ(find(ports, "ptmx"), nullptr);
    // sorted by name
    for (size_t i = 1; i < ports.size(); ++i) EXPECT_LT(ports[i - 1].name, ports[i].name);
}

TEST(SerialPorts, SaysWhoUsesAPort) {
    Tree t;
    build(t);
    SerialPortsEnv env;
    env.root = t.root();
    env.allowPatterns = {"ttyAS*"};
    env.channelPorts = [] { return std::vector<std::string>{"ttyAS4"}; };
    const auto ports = listSerialPorts(env);
    EXPECT_EQ(find(ports, "ttyAS0")->inUseBy, "console");
    EXPECT_EQ(find(ports, "ttyAS2")->inUseBy, "");
    EXPECT_EQ(find(ports, "ttyAS3")->inUseBy, "getty");
    EXPECT_EQ(find(ports, "ttyAS4")->inUseBy, "channel");
    EXPECT_EQ(find(ports, "ttyAS5")->inUseBy, "lock");
    EXPECT_FALSE(find(ports, "ttyAS5")->inUseDetail.empty());
    EXPECT_TRUE(isConsolePort(t.root(), "ttyAS0"));
    EXPECT_FALSE(isConsolePort(t.root(), "ttyAS2"));
    EXPECT_TRUE(hasGetty(t.root(), "ttyAS3"));
    EXPECT_TRUE(hasLockFile(t.root(), "ttyAS5"));
}

TEST(SerialPorts, ConsoleNamedOnlyByTheActiveFileIsStillAConsole) {
    Tree t;
    build(t);
    t.file("/proc/consoles", "");
    t.file("/sys/class/tty/console/active", "tty0 ttyAS2\n");
    SerialPortsEnv env;
    env.root = t.root();
    EXPECT_TRUE(find(listSerialPorts(env), "ttyAS2")->console);
}

TEST(SerialPorts, AllowedFollowsTheListAndNeverTheConsole) {
    Tree t;
    build(t);
    SerialPortsEnv env;
    env.root = t.root();
    env.allowPatterns = {"ttyAS*"};
    auto ports = listSerialPorts(env);
    EXPECT_TRUE(find(ports, "ttyAS2")->allowed);
    EXPECT_FALSE(find(ports, "ttyAS0")->allowed) << "the console matches the pattern and is out";
    EXPECT_TRUE(find(ports, "ttyAS0")->console);
    EXPECT_FALSE(find(ports, "ttyUSB0")->allowed);
    EXPECT_FALSE(find(ports, "ttyS1")->allowed);

    // a by-id path is allowed by its exact name only
    env.allowPatterns = {"/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0"};
    ports = listSerialPorts(env);
    EXPECT_TRUE(find(ports, "ttyUSB0")->allowed);
    EXPECT_FALSE(find(ports, "ttyAS2")->allowed);
    env.allowPatterns = {"/dev/serial/by-id/usb-1a86_USB_Serial-if00-port1"};
    EXPECT_FALSE(find(listSerialPorts(env), "ttyUSB0")->allowed);

    // a tty name without the star
    env.allowPatterns = {"ttyAS2", "ttyUSB*"};
    ports = listSerialPorts(env);
    EXPECT_TRUE(find(ports, "ttyAS2")->allowed);
    EXPECT_FALSE(find(ports, "ttyAS4")->allowed);
    EXPECT_TRUE(find(ports, "ttyUSB0")->allowed);
}

TEST(SerialPorts, PatternRules) {
    using mat::serialPatternMatches;
    EXPECT_TRUE(serialPatternMatches("ttyAS*", "ttyAS2"));
    EXPECT_TRUE(serialPatternMatches("ttyAS*", "ttyAS"));
    EXPECT_FALSE(serialPatternMatches("ttyAS*", "ttyUSB0"));
    EXPECT_TRUE(serialPatternMatches("ttyAS2", "ttyAS2"));
    EXPECT_FALSE(serialPatternMatches("ttyAS2", "ttyAS20"));
    EXPECT_TRUE(serialPatternMatches("/dev/serial/by-id/x", "/dev/serial/by-id/x"));
    EXPECT_FALSE(serialPatternMatches("/dev/serial/by-id/x", "/dev/serial/by-id/xy"));
    EXPECT_FALSE(serialPatternMatches("ttyAS*", "/dev/serial/by-id/x"));
    EXPECT_FALSE(serialPatternMatches("/dev/serial/by-id/x", "ttyAS2"));
    EXPECT_EQ(mat::serialShortName("/dev/ttyAS2"), "ttyAS2");
    EXPECT_EQ(mat::serialShortName("ttyAS2"), "ttyAS2");
    EXPECT_EQ(mat::serialShortName("/dev/serial/by-id/x"), "");
    EXPECT_EQ(serialDevicePath("ttyAS2"), "/dev/ttyAS2");
    EXPECT_EQ(serialDevicePath("/dev/serial/by-id/x"), "/dev/serial/by-id/x");
}

TEST(SerialPorts, Rs485IsAskedOnlyWhenProbingAnAllowedFreePort) {
    Tree t;
    build(t);
    SerialPortsEnv env;
    env.root = t.root();
    env.allowPatterns = {"ttyAS*"};
    env.channelPorts = [] { return std::vector<std::string>{"ttyAS4"}; };
    std::map<std::string, bool> asked;  // path -> probe flag of the last call
    env.rs485 = [&](const std::string& path, bool probe) {
        asked[path] = probe;
        return std::string(path == "/dev/ttyAS4" ? "enabled" : "unknown");
    };
    auto ports = listSerialPorts(env, /*probe=*/false);
    for (const auto& kv : asked) EXPECT_FALSE(kv.second) << kv.first << " probed without ?probe=1";
    EXPECT_EQ(find(ports, "ttyAS4")->rs485, "enabled");  // known from the channel, nothing opened
    EXPECT_EQ(find(ports, "ttyAS2")->rs485, "unknown");

    asked.clear();
    env.rs485 = [&](const std::string& path, bool probe) {
        asked[path] = probe;
        return std::string(probe ? "supported" : "unknown");
    };
    ports = listSerialPorts(env, /*probe=*/true);
    EXPECT_TRUE(asked["/dev/ttyAS2"]);    // allowed and free
    EXPECT_FALSE(asked["/dev/ttyAS0"]);   // the console
    EXPECT_FALSE(asked["/dev/ttyAS3"]);   // a getty
    EXPECT_FALSE(asked["/dev/ttyAS4"]);   // a channel holds it
    EXPECT_FALSE(asked["/dev/ttyAS5"]);   // locked
    EXPECT_FALSE(asked["/dev/ttyUSB0"]);  // not in the list of allowed ports
    EXPECT_EQ(find(ports, "ttyAS2")->rs485, "supported");
    EXPECT_EQ(find(ports, "ttyUSB0")->rs485, "unknown");
}

TEST(SerialPorts, DefaultRs485OpensNothingWithoutProbe) {
    Tree t;
    build(t);
    SerialPortsEnv env;
    env.root = t.root();
    env.allowPatterns = {"ttyAS*"};
    // no hook: no /dev/ttyAS2 exists in the real system of the test, and the list does not care
    const auto ports = listSerialPorts(env);
    for (const auto& p : ports) EXPECT_EQ(p.rs485, "unknown") << p.name;
}

TEST(SerialPorts, EmptyTreeGivesAnEmptyList) {
    Tree t;
    SerialPortsEnv env;
    env.root = t.root();
    EXPECT_TRUE(listSerialPorts(env).empty());
}
