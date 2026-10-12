// T167 (feature 006, US3; contracts/device-config.md §4): `mat-runtime --list-serial` prints the
// same list as GET /api/v1/serial/ports, opens no port, and ends with the exit codes of the other
// device commands (0 ok, 2 bad arguments or configuration).
#include <gtest/gtest.h>
#include <unistd.h>

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>

#include "drivers/sdk/serial_ports.hpp"
#include "nlohmann/json.hpp"
#include "server/cli/serial.hpp"

namespace fs = std::filesystem;
using namespace mat;
using nlohmann::json;

namespace {

struct Tree {
    std::string root;
    Tree() {
        char tmpl[] = "/tmp/mat-serialcli-XXXXXX";
        root = ::mkdtemp(tmpl);
    }
    ~Tree() {
        std::error_code ec;
        fs::remove_all(root, ec);
    }
    void file(const std::string& rel, const std::string& text) {
        fs::create_directories(fs::path(root + rel).parent_path());
        std::ofstream(root + rel) << text;
    }
    void port(const std::string& name, const std::string& type = "") {
        fs::create_directories(root + "/sys/class/tty/" + name);
        fs::create_directories(root + "/sys/devices/platform/soc/" + name + ".serial");
        fs::create_symlink(root + "/sys/devices/platform/soc/" + name + ".serial",
                           root + "/sys/class/tty/" + name + "/device");
        if (!type.empty()) file("/sys/class/tty/" + name + "/type", type + "\n");
    }
    // ttyAS0 console, ttyAS2 free, ttyAS5 locked, ttyS0 without hardware
    void standard() {
        port("ttyAS0");
        port("ttyAS2");
        port("ttyAS5");
        port("ttyS0", "0");
        file("/proc/consoles", "ttyAS0 -W- (EC p a) 4:64\n");
        file("/sys/class/tty/console/active", "ttyAS0\n");
        file("/run/lock/LCK..ttyAS5", "123\n");
    }
};

struct CliRun {
    int code;
    std::string out, err;
};

CliRun run(std::vector<std::string> args) {
    args.insert(args.begin(), "mat-runtime");
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(&a[0]);
    std::ostringstream out, err;
    const int code =
        runSerialCli(static_cast<int>(argv.size()), argv.data(), DeviceCliEnv{}, out, err);
    return {code, out.str(), err.str()};
}

bool is(std::vector<std::string> args) {
    args.insert(args.begin(), "mat-runtime");
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(&a[0]);
    return isSerialCommand(static_cast<int>(argv.size()), argv.data());
}

const json* findPort(const json& j, const std::string& name) {
    for (const json& p : j["ports"])
        if (p["name"] == name) return &p;
    return nullptr;
}

}  // namespace

TEST(SerialCli, RecognisesItsFlag) {
    EXPECT_TRUE(is({"--list-serial"}));
    EXPECT_TRUE(is({"--list-serial", "--serial-ports", "ttyAS*"}));
    EXPECT_FALSE(is({"--project-status"}));
    EXPECT_FALSE(is({}));
}

TEST(SerialCli, PrintsTheSameListAsTheApi) {
    Tree t;
    t.standard();
    const CliRun r = run({"--list-serial", "--serial-ports", "ttyAS*", "--sys-root", t.root});
    ASSERT_EQ(r.code, 0) << r.err;
    const json printed = json::parse(r.out, nullptr, false);
    ASSERT_TRUE(printed.is_object()) << r.out;
    drv::SerialPortsEnv env;
    env.root = t.root;
    env.allowPatterns = {"ttyAS*"};
    EXPECT_EQ(printed, drv::serialPortsJson(drv::listSerialPorts(env)));
    ASSERT_NE(findPort(printed, "ttyAS2"), nullptr);
    EXPECT_TRUE((*findPort(printed, "ttyAS2"))["allowed"].get<bool>());
    EXPECT_TRUE((*findPort(printed, "ttyAS2"))["inUse"].is_null());
    EXPECT_FALSE((*findPort(printed, "ttyAS0"))["allowed"].get<bool>()) << "the console is out";
    EXPECT_EQ((*findPort(printed, "ttyAS0"))["inUse"]["by"], "console");
    EXPECT_EQ((*findPort(printed, "ttyAS5"))["inUse"]["by"], "lock");
    EXPECT_EQ(findPort(printed, "ttyS0"), nullptr) << "no hardware";
}

TEST(SerialCli, OpensNoPort) {
    Tree t;
    t.standard();
    const json j =
        json::parse(run({"--list-serial", "--serial-ports", "ttyAS*", "--sys-root", t.root}).out);
    for (const json& p : j["ports"]) EXPECT_EQ(p["rs485"], "unknown") << p["name"];
}

TEST(SerialCli, TheListOfAllowedPortsComesFromTheConfiguration) {
    Tree t;
    t.standard();
    t.file("/runtime.json", R"({"serialPorts": ["ttyAS5"]})");
    json j = json::parse(
        run({"--list-serial", "--config", t.root + "/runtime.json", "--sys-root", t.root}).out);
    EXPECT_TRUE((*findPort(j, "ttyAS5"))["allowed"].get<bool>());
    EXPECT_FALSE((*findPort(j, "ttyAS2"))["allowed"].get<bool>());
    // the command line wins over the file, as for the runtime
    j = json::parse(run({"--list-serial", "--config", t.root + "/runtime.json", "--serial-ports",
                         "ttyAS2", "--sys-root", t.root})
                        .out);
    EXPECT_TRUE((*findPort(j, "ttyAS2"))["allowed"].get<bool>());
    EXPECT_FALSE((*findPort(j, "ttyAS5"))["allowed"].get<bool>());
}

TEST(SerialCli, ADefaultListIsTtyAsStar) {
    Tree t;
    t.standard();
    const json j = json::parse(run({"--list-serial", "--sys-root", t.root}).out);
    EXPECT_TRUE((*findPort(j, "ttyAS2"))["allowed"].get<bool>());
    EXPECT_FALSE((*findPort(j, "ttyAS0"))["allowed"].get<bool>());
}

TEST(SerialCli, NoPortsIsAnEmptyListAndExit0) {
    Tree t;
    const CliRun r = run({"--list-serial", "--sys-root", t.root});
    EXPECT_EQ(r.code, 0) << r.err;
    EXPECT_EQ(json::parse(r.out), (json{{"ports", json::array()}}));
}

TEST(SerialCli, BadArgumentsAndBadConfigurationAreExit2) {
    Tree t;
    EXPECT_EQ(run({"--list-serial", "--bogus"}).code, 2);
    EXPECT_EQ(run({"--list-serial", "--serial-ports"}).code, 2);
    EXPECT_EQ(run({"--list-serial", "--sys-root"}).code, 2);
    EXPECT_EQ(run({"--list-serial", "--serial-ports", "COM3"}).code, 2);
    t.file("/bad.json", R"({"serialPorts": "ttyAS*"})");
    const CliRun r = run({"--list-serial", "--config", t.root + "/bad.json"});
    EXPECT_EQ(r.code, 2);
    EXPECT_FALSE(r.err.empty());
}

TEST(SerialCli, WritesNothing) {
    Tree t;
    t.standard();
    auto snap = [&] {
        std::string s;
        for (const auto& e : fs::recursive_directory_iterator(t.root))
            s += e.path().string() + "\n";
        return s;
    };
    const std::string before = snap();
    run({"--list-serial", "--serial-ports", "ttyAS*", "--sys-root", t.root});
    EXPECT_EQ(snap(), before);
}
