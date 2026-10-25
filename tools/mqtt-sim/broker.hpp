// mat-mqtt-sim (feature 022): a small MQTT 3.1.1 broker for the driver tests and the driver-it rig.
// Never in the device package. QoS 0/1, retained messages, wills, + and # filters, a user and
// password check, TLS (Mbed TLS server, a self-signed P-256 certificate made at start), refused
// filters (`denyPrefix`) and hooks to misbehave (no PUBACK, kick every client). One thread
// accepts, one thread per client.
#pragma once
#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "drivers/mqtt/packet.hpp"

namespace mat::mqttsim {

struct BrokerOptions {
    std::string bind = "127.0.0.1";
    int port = 0;  // 0: any free port
    bool tls = false;
    std::string username, password;  // empty username: anyone may connect
    std::string denyPrefix;          // SUBSCRIBE of a filter starting with it: 0x80
};

class Broker {
   public:
    explicit Broker(BrokerOptions o);
    ~Broker();
    Broker(const Broker&) = delete;
    Broker& operator=(const Broker&) = delete;

    bool start();  // listens; false when the port cannot be bound
    void stop();   // closes the listener and every client
    int port() const { return port_; }

    // Publishes as if a client had (to the subscribers; kept when retain).
    void publish(const std::string& topic, const std::string& payload, int qos = 0,
                 bool retain = false);
    // What clients published, in order (wills included).
    std::vector<mqtt::Publish> received() const;
    void clearReceived();
    size_t clients() const;
    size_t connects() const { return connects_.load(); }
    mqtt::ConnectOptions lastConnect() const;
    // Every subscription filter clients asked for (SUBSCRIBE order).
    std::vector<std::string> subscriptions() const;
    void setAckPublish(bool ack) { ackPublish_ = ack; }
    void kickAll();  // closes every client connection (no will is lost: they had no DISCONNECT)
    const std::string& certPem() const { return certPem_; }
    const std::string& certSha256() const { return certSha_; }

   private:
    struct Client;
    void acceptLoop();
    void serve(std::shared_ptr<Client> c);
    void route(const mqtt::Publish& m);

    BrokerOptions o_;
    int listenFd_ = -1;
    int port_ = 0;
    std::atomic<bool> running_{false};
    std::thread acceptThread_;
    mutable std::mutex mu_;
    std::vector<std::shared_ptr<Client>> clients_;
    std::vector<std::thread> threads_;
    std::vector<mqtt::Publish> retained_;
    std::vector<mqtt::Publish> received_;
    std::vector<std::string> subscriptions_;
    mqtt::ConnectOptions lastConnect_;
    std::atomic<size_t> connects_{0};
    std::atomic<bool> ackPublish_{true};
    std::string certPem_, keyPem_, certSha_;
    struct TlsShared;
    std::unique_ptr<TlsShared> tls_;
};

}  // namespace mat::mqttsim
