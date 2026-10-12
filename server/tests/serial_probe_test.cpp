// What the runtime does for the connection test of an RTU channel and for the list of ports
// (feature 006 T164, T168; contracts/modbus-driver.md §10; device-api-1.1 §6): the order of the
// refusals (console, list), a free port opened for the test, a port that a channel holds used
// through that channel when the frame is the same and PORT_BUSY when it is not, the list showing
// the channel. The ports are a fake tree and a pty; the channel is the driver on the fake line.
#include "server/serial_probe.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <thread>

#include "drivers/modbus/tests/rtu_harness.hpp"
#include "drivers/sdk/serial_port.hpp"

namespace fs = std::filesystem;

// rtu_harness.hpp brings in the standard driver suite, which this file does not instantiate
using namespace mat::drv::conformance;
GTEST_ALLOW_UNINSTANTIATED_PARAMETERIZED_TEST(DriverConformance);
using namespace mat;
using namespace mat::testing;
using nlohmann::json;

namespace {

struct Tree {
    std::string root;
    Tree() {
        char tmpl[] = "/tmp/mat-serialprobe-XXXXXX";
        root = ::mkdtemp(tmpl);
    }
    ~Tree() {
        std::error_code ec;
        fs::remove_all(root, ec);
    }
    void port(const std::string& name) {
        fs::create_directories(root + "/sys/class/tty/" + name);
        fs::create_directories(root + "/sys/devices/platform/soc/" + name + ".serial");
        fs::create_symlink(root + "/sys/devices/platform/soc/" + name + ".serial",
                           root + "/sys/class/tty/" + name + "/device");
    }
    void file(const std::string& rel, const std::string& text) {
        fs::create_directories(fs::path(root + rel).parent_path());
        std::ofstream(root + rel) << text;
    }
};

drv::RtuProbeRequest request(const std::string& path) {
    drv::RtuProbeRequest r;
    r.devicePath = path;
    r.unit = 1;
    r.timeoutMs = 300;
    r.rs485 = false;
    r.read = true;
    r.area = modbus::Area::HR;
    r.offset = 4;
    r.count = 2;
    return r;
}

}  // namespace

TEST(SerialProbe, TheConsoleAndPortsOutOfTheListAreNotOpened) {
    Tree t;
    t.port("ttyAS0");
    t.port("ttyAS2");
    t.file("/proc/consoles", "ttyAS0 -W- (EC p a) 4:64\n");
    SerialDeviceEnv env;
    env.root = t.root;
    env.allowPatterns = {"ttyAS*"};
    // the console wins over the pattern
    EXPECT_EQ(probeSerialOnDevice(env, "ttyAS0", request("/dev/ttyAS0")).code, "PORT_CONSOLE");
    // a getty is the console for this purpose
    t.file("/etc/systemd/system/getty.target.wants/serial-getty@ttyAS3.service", "");
    EXPECT_EQ(probeSerialOnDevice(env, "ttyAS3", request("/dev/ttyAS3")).code, "PORT_CONSOLE");
    // not in the list
    env.allowPatterns = {"ttyUSB*"};
    EXPECT_EQ(probeSerialOnDevice(env, "ttyAS2", request("/dev/ttyAS2")).code, "PORT_NOT_ALLOWED");
    env.allowPatterns = {};
    EXPECT_EQ(probeSerialOnDevice(env, "ttyAS2", request("/dev/ttyAS2")).code, "PORT_NOT_ALLOWED");
}

TEST(SerialProbe, APortThatIsAllowedAndFreeIsOpenedForTheTestAndClosed) {
    FakePlc plc;
    plc.setRegs(1, modbus::Area::HR, 4, {0x1111, 0x2222});
    PtyBridge bridge(plc);
    SerialDeviceEnv env;
    env.root = "/nonexistent-root";       // no console there
    env.allowPatterns = {bridge.path()};  // an exact path
    const drv::TestOutcome o = probeSerialOnDevice(env, bridge.path(), request(bridge.path()));
    EXPECT_EQ(o.code, "OK");
    ASSERT_EQ(o.registers.size(), 2u);
    EXPECT_EQ(o.registers[0], 0x1111);
    // closed: it opens again
    drv::SerialPort again(drv::SerialParams{});
    EXPECT_EQ(again.connect(bridge.path(), 0, 500), drv::ConnectCode::Ok);
}

TEST(SerialProbe, APortThatAnotherProgramHoldsIsBusyAndAMissingOneIsAnError) {
    FakePlc plc;
    PtyBridge bridge(plc);
    drv::SerialPort other(drv::SerialParams{});
    ASSERT_EQ(other.connect(bridge.path(), 0, 500), drv::ConnectCode::Ok);
    SerialDeviceEnv env;
    env.root = "/nonexistent-root";
    env.allowPatterns = {bridge.path(), "/dev/pts/9999"};
    EXPECT_EQ(probeSerialOnDevice(env, bridge.path(), request(bridge.path())).code, "PORT_BUSY");
    EXPECT_EQ(probeSerialOnDevice(env, "/dev/pts/9999", request("/dev/pts/9999")).code,
              "PORT_ERROR");
}

TEST(SerialProbe, AChannelThatHoldsThePortTakesTheTestWhenTheFrameIsTheSameAndNotOtherwise) {
    auto c = rtuConfig();
    c.tags = {bind(0, 0, modbus::Area::HR, 0, TagType::UINT16)};
    c.serial->baud = 19200;
    c.serial->parity = 'N';
    RtuRig r(c);
    r.plc.set(1, modbus::Area::HR, 0, 1);
    r.plc.setRegs(1, modbus::Area::HR, 4, {0x0A0B, 0x0C0D});
    r.start();
    r.run(500);
    ASSERT_EQ(r.diag().channel.state, "connected");

    Tree t;
    t.port("ttyAS2");
    SerialDeviceEnv env;
    env.root = t.root;
    env.allowPatterns = {"ttyAS*"};
    env.channels = [&] { return std::vector<drv::ModbusTcpDriver*>{r.drv.get()}; };

    // another speed or parity: the channel keeps the port, the test is busy
    drv::RtuProbeRequest other = request("/dev/ttyAS2");
    other.baud = 9600;
    other.parity = 'N';
    EXPECT_EQ(probeSerialOnDevice(env, "ttyAS2", other).code, "PORT_BUSY");
    other.baud = 19200;
    other.parity = 'E';
    EXPECT_EQ(probeSerialOnDevice(env, "ttyAS2", other).code, "PORT_BUSY");

    // the same frame: through the queue of the channel, with the pump of the fake clock running
    drv::RtuProbeRequest same = request("/dev/ttyAS2");
    same.baud = 19200;
    same.parity = 'N';
    const size_t connects = static_cast<size_t>(r.plc.connectAttempts);
    std::atomic<bool> done{false};
    drv::TestOutcome out;
    std::thread th([&] {
        out = probeSerialOnDevice(env, "ttyAS2", same);
        done = true;
    });
    for (int i = 0; i < 400 && !done; ++i) {
        r.run(50);
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    th.join();
    EXPECT_EQ(out.code, "OK");
    ASSERT_EQ(out.registers.size(), 2u);
    EXPECT_EQ(out.registers[0], 0x0A0B);
    EXPECT_EQ(static_cast<size_t>(r.plc.connectAttempts), connects)
        << "the port was not opened again";

    // without a read there is nothing to send: the channel has the port, that is the answer
    same.read = false;
    EXPECT_EQ(probeSerialOnDevice(env, "ttyAS2", same).code, "OK");
}

TEST(SerialProbe, TheListShowsAPortThatAChannelHoldsAndItsRs485) {
    auto c = rtuConfig();
    c.tags = {bind(0, 0, modbus::Area::HR, 0, TagType::UINT16)};
    RtuRig r(c);
    r.plc.set(1, modbus::Area::HR, 0, 1);
    r.start();
    r.run(500);
    Tree t;
    t.port("ttyAS2");
    t.port("ttyAS3");
    SerialDeviceEnv env;
    env.root = t.root;
    env.allowPatterns = {"ttyAS*"};
    env.channels = [&] { return std::vector<drv::ModbusTcpDriver*>{r.drv.get()}; };

    std::vector<std::string> probed;
    json j = serialPortsOnDevice(env, false, probed);
    EXPECT_TRUE(probed.empty());
    ASSERT_EQ(j["ports"].size(), 2u);
    EXPECT_EQ(j["ports"][0]["name"], "ttyAS2");
    EXPECT_EQ(j["ports"][0]["inUse"]["by"], "channel");
    EXPECT_EQ(j["ports"][0]["rs485"], "enabled");
    EXPECT_TRUE(j["ports"][1]["inUse"].is_null());
    EXPECT_EQ(j["ports"][1]["rs485"], "unknown");

    // a channel whose kernel has no RS485 says so
    RtuRig r2(c);
    r2.plc.set(1, modbus::Area::HR, 0, 1);
    r2.setup = [](FakeRtuTransport& tr) { tr.warningsOnOpen = {"RS485_UNSUPPORTED"}; };
    r2.start();
    r2.run(500);
    env.channels = [&] { return std::vector<drv::ModbusTcpDriver*>{r2.drv.get()}; };
    j = serialPortsOnDevice(env, false, probed);
    EXPECT_EQ(j["ports"][0]["rs485"], "unsupported");
}
