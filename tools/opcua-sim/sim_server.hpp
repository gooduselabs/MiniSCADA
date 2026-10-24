// A small OPC UA server for tests (feature 019, spec D13): the open62541 server of
// third_party/open62541 with the nodes of tools/opcua-sim/README.md. Used in process by the
// driver tests (drivers/opcua/tests) and as the binary mat-opcua-sim of the integration rig
// (tests/driver-it-opcua). Never part of the device package.
//
// Namespace 2 (urn:mat:opcua-sim):
//   ns=2;s=<Type> and ns=2;i=<1001..>: Boolean, SByte, Byte, Int16, UInt16, Int32, UInt32, Int64,
//     UInt64, Float, Double, String, DateTime (writable; the i= nodes in the same order)
//   ns=2;s=ReadOnly (Double, not writable), ns=2;s=Counter (UInt32, +1 every changeMs),
//   ns=2;s=Array (Int32[3]: not a scalar), ns=2;s=Bench.<k> (Double, k + tick every changeMs)
//   folders Objects/Sim, Objects/Sim/Numeric, Objects/Bench.
#pragma once
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace mat::opcuasim {

struct SimOptions {
    uint16_t port = 4840;
    // Endpoints with security (None stays): the server makes or loads its certificate
    // (certDir/server-cert.der, server-key.der; certDir "" in memory) and accepts any client
    // certificate.
    bool secure = false;
    std::string certDir;
    bool allowAnonymous = true;
    std::vector<std::pair<std::string, std::string>> users;  // user, password
    uint32_t maxSubscriptions = 0;                           // 0: no limit
    int benchNodes = 0;
    int changeMs = 1000;  // Counter and Bench.*
};

class SimServer {
   public:
    explicit SimServer(SimOptions options);
    ~SimServer();
    SimServer(const SimServer&) = delete;
    SimServer& operator=(const SimServer&) = delete;

    // Starts the server thread; false when the port cannot be opened (`error()` says why).
    bool start();
    void stop();
    bool running() const;
    const std::string& error() const;

    // SHA-256 (hex) of the server certificate; "" without security.
    std::string certSha256() const;

    // Sets / reads the value of a node of namespace 2 by its string form ("ns=2;s=Int16") in
    // the server thread. The value is given as text in the node's type ("12", "true", "abc",
    // ISO date for DateTime). false when the node or the value does not fit.
    bool set(const std::string& nodeId, const std::string& text);
    // "" when the node has no value; the text form of set().
    std::string get(const std::string& nodeId);

    // A free TCP port of localhost (tests).
    static uint16_t freePort();

   private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace mat::opcuasim
