// mat-opcua-sim: the OPC UA test server of the integration rig (feature 019,
// tests/driver-it-opcua).
//   mat-opcua-sim [--port 4840] [--secure] [--cert-dir DIR] [--user NAME:PASSWORD]...
//                 [--no-anonymous] [--bench N] [--change-ms MS] [--max-subscriptions N]
// Prints "ready <port> sha256=<hex>" when it listens; with --cert-dir also writes
// DIR/server-cert.sha256. Stops on SIGTERM or SIGINT. x64 test tool, never in the device package.
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <thread>

#include "tools/opcua-sim/sim_server.hpp"

namespace {
volatile std::sig_atomic_t g_stop = 0;
void onSignal(int) { g_stop = 1; }
}  // namespace

int main(int argc, char** argv) {
    mat::opcuasim::SimOptions o;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        auto next = [&]() -> std::string { return i + 1 < argc ? argv[++i] : ""; };
        if (a == "--port")
            o.port = static_cast<uint16_t>(std::atoi(next().c_str()));
        else if (a == "--secure")
            o.secure = true;
        else if (a == "--cert-dir")
            o.certDir = next();
        else if (a == "--user") {
            const std::string up = next();
            const size_t c = up.find(':');
            if (c == std::string::npos) {
                std::fprintf(stderr, "--user NAME:PASSWORD\n");
                return 2;
            }
            o.users.emplace_back(up.substr(0, c), up.substr(c + 1));
        } else if (a == "--no-anonymous")
            o.allowAnonymous = false;
        else if (a == "--bench")
            o.benchNodes = std::atoi(next().c_str());
        else if (a == "--change-ms")
            o.changeMs = std::atoi(next().c_str());
        else if (a == "--max-subscriptions")
            o.maxSubscriptions = static_cast<uint32_t>(std::atoi(next().c_str()));
        else {
            std::fprintf(stderr, "unknown argument %s\n", a.c_str());
            return 2;
        }
    }
    std::signal(SIGTERM, onSignal);
    std::signal(SIGINT, onSignal);
    mat::opcuasim::SimServer s(o);
    if (!s.start()) {
        std::fprintf(stderr, "mat-opcua-sim: %s\n", s.error().c_str());
        return 1;
    }
    if (!o.certDir.empty() && o.secure)
        std::ofstream(o.certDir + "/server-cert.sha256") << s.certSha256() << "\n";
    std::printf("ready %u sha256=%s\n", o.port, s.certSha256().c_str());
    std::fflush(stdout);
    while (!g_stop) std::this_thread::sleep_for(std::chrono::milliseconds(100));
    s.stop();
    return 0;
}
