// mat-mqtt-sim (feature 022): the broker of the driver-it rig (tests/driver-it-mqtt). Never in the
// device package.
//   mat-mqtt-sim [--bind 0.0.0.0] [--port 1883] [--tls-port 8883] [--control-port 1880]
//                [--user U --password P] [--deny <prefix>] [--cert-out <file>]
// The control port takes one command per line and answers one line (RECEIVED: lines, then END):
//   PUB <qos> <retain 0|1> <topic> <payload...>   CLEAR   RECEIVED   KICK   CLIENTS   CERT
//   NOACK 0|1   DOWN (the brokers stop listening and drop every client)   UP
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"
#include "tools/mqtt-sim/broker.hpp"

using mat::mqttsim::Broker;
using mat::mqttsim::BrokerOptions;

namespace {

std::string arg(int argc, char** argv, const char* name, const char* def = "") {
    for (int i = 1; i + 1 < argc; ++i)
        if (std::strcmp(argv[i], name) == 0) return argv[i + 1];
    return def;
}

std::string handle(const std::string& line, std::vector<std::unique_ptr<Broker>>& brokers) {
    std::istringstream in(line);
    std::string cmd;
    in >> cmd;
    if (cmd == "PUB") {
        int qos = 0, retain = 0;
        std::string topic;
        in >> qos >> retain >> topic;
        std::string payload;
        std::getline(in, payload);
        if (!payload.empty() && payload[0] == ' ') payload.erase(0, 1);
        if (topic.empty()) return "ERR topic";
        for (auto& x : brokers) x->publish(topic, payload, qos, retain != 0);  // plain and TLS
        return "OK";
    }
    if (cmd == "CLEAR") {
        for (auto& x : brokers) x->clearReceived();
        return "OK";
    }
    if (cmd == "RECEIVED") {
        std::string out;
        for (auto& x : brokers)
            for (const auto& m : x->received()) {
                nlohmann::json j = {{"topic", m.topic},
                                    {"payload", m.payload},
                                    {"qos", m.qos},
                                    {"retain", m.retain}};
                out += j.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace) + "\n";
            }
        return out + "END";
    }
    if (cmd == "KICK") {
        for (auto& x : brokers) x->kickAll();
        return "OK";
    }
    if (cmd == "CLIENTS") {
        size_t n = 0;
        for (auto& x : brokers) n += x->clients();
        return std::to_string(n);
    }
    if (cmd == "CERT") return brokers.size() > 1 ? brokers[1]->certSha256() : "none";
    if (cmd == "NOACK") {
        int v = 0;
        in >> v;
        for (auto& x : brokers) x->setAckPublish(v == 0);
        return "OK";
    }
    if (cmd == "DOWN") {
        for (auto& x : brokers) x->stop();
        return "OK";
    }
    if (cmd == "UP") {
        for (auto& x : brokers)
            if (!x->start()) return "ERR start";
        return "OK";
    }
    return "ERR command";
}

}  // namespace

int main(int argc, char** argv) {
    std::signal(SIGPIPE, SIG_IGN);
    BrokerOptions o;
    o.bind = arg(argc, argv, "--bind", "0.0.0.0");
    o.port = std::atoi(arg(argc, argv, "--port", "1883").c_str());
    o.username = arg(argc, argv, "--user");
    o.password = arg(argc, argv, "--password");
    o.denyPrefix = arg(argc, argv, "--deny");
    std::vector<std::unique_ptr<Broker>> brokers;
    brokers.push_back(std::make_unique<Broker>(o));
    const std::string tlsPort = arg(argc, argv, "--tls-port");
    if (!tlsPort.empty()) {
        BrokerOptions t = o;
        t.port = std::atoi(tlsPort.c_str());
        t.tls = true;
        brokers.push_back(std::make_unique<Broker>(t));
    }
    for (auto& b : brokers)
        if (!b->start()) {
            std::fprintf(stderr, "mat-mqtt-sim: cannot listen\n");
            return 1;
        }
    const std::string certOut = arg(argc, argv, "--cert-out");
    if (brokers.size() > 1 && !certOut.empty()) std::ofstream(certOut) << brokers[1]->certPem();
    // tools/driver-it-mqtt.ps1 reads the certificate SHA-256 of this line to pin it in its projects
    const std::string tlsText = brokers.size() > 1 ? " tls " + std::to_string(brokers[1]->port()) +
                                                         " cert " + brokers[1]->certSha256()
                                                   : "";
    std::printf("mat-mqtt-sim: port %d%s\n", brokers[0]->port(), tlsText.c_str());
    std::fflush(stdout);

    const int control = std::atoi(arg(argc, argv, "--control-port", "1880").c_str());
    const int lfd = ::socket(AF_INET, SOCK_STREAM, 0);
    int one = 1;
    ::setsockopt(lfd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_port = htons(static_cast<uint16_t>(control));
    ::inet_pton(AF_INET, o.bind.c_str(), &a.sin_addr);
    if (::bind(lfd, reinterpret_cast<sockaddr*>(&a), sizeof a) != 0 || ::listen(lfd, 4) != 0) {
        std::fprintf(stderr, "mat-mqtt-sim: cannot listen on the control port\n");
        return 1;
    }
    while (true) {
        const int fd = ::accept(lfd, nullptr, nullptr);
        if (fd < 0) continue;
        std::string pending;
        char buf[4096];
        ssize_t n = 0;
        while ((n = ::recv(fd, buf, sizeof buf, 0)) > 0) {
            pending.append(buf, static_cast<size_t>(n));
            size_t nl = 0;
            while ((nl = pending.find('\n')) != std::string::npos) {
                std::string line = pending.substr(0, nl);
                pending.erase(0, nl + 1);
                if (!line.empty() && line.back() == '\r') line.pop_back();
                const std::string reply = handle(line, brokers) + "\n";
                ::send(fd, reply.data(), reply.size(), MSG_NOSIGNAL);
            }
        }
        ::close(fd);
    }
}
