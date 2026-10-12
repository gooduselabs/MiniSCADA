// The discovery packets of the device (feature 005; contracts/discovery.md §2–§5a, research R2):
// pure functions and fixed tables, with no socket and no clock of their own, so that they run on
// tests/discovery-vectors, which the Studio's Rust code runs too. server/discovery adds the UDP
// socket and the thread.
//
// - Query: exactly 1024 bytes: "MATD", version 1, type 1, flags 0, 16-byte nonce, 1000 zeros.
// - Only a source on a subnet of the interface that received the query gets a reply, from port
//   1024 or above, within the rate limits. Any other datagram is dropped without a word (no reply,
//   no log line) and counted by reason.
// - Reply: the same 24-byte header (type 2, the query's nonce), then compact JSON UTF-8 of at most
//   1000 bytes, so a reply is never longer than its query (no amplification). DeviceInfo has no
//   field for a secret (Constitution V).
// - Nothing here allocates per datagram: the responder has fixed tables, the reply is written into
//   the caller's buffer.
#pragma once
#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>

#include "core/discovery/iface_table.hpp"

namespace mat::discovery {

constexpr size_t kQuerySize = 1024;
constexpr size_t kHeaderSize = 24;
constexpr size_t kMaxJson = kQuerySize - kHeaderSize;  // 1000
constexpr uint8_t kVersion = 1;
constexpr uint8_t kTypeQuery = 1;
constexpr uint8_t kTypeReply = 2;
constexpr uint16_t kFlagTruncated = 0x0001;  // bit 0 of the reply flags
constexpr int kDefaultPort = 8446;           // discoveryPort
constexpr size_t kMaxNameBytes = 32;         // name and model (contract §3)
constexpr size_t kMaxProjectNameChars = 64;  // project.name (contract §3, §5a)

using Nonce = std::array<uint8_t, 16>;
using Packet = std::array<uint8_t, kQuerySize>;

// Contract §2: true for a well-formed query, whose nonce goes to `nonce`.
bool parseQuery(const uint8_t* data, size_t size, Nonce& nonce);

// Contract §2, §5a: the address of `iface` whose subnet holds `source` (the longest prefix when
// several do), or none when the source gets no reply: 0.0.0.0, 255.255.255.255, multicast,
// loopback, the directed broadcast of a subnet of the interface, or on none of its subnets.
std::optional<Ipv4Net> replyAddress(uint32_t source, const Iface& iface);

// Token buckets of contract §4 and §5a: per source 1 reply/s with a burst of 3; in all 20 replies/s
// with a burst of 20; 64 sources, the one seen least recently is forgotten first.
class RateLimiter {
   public:
    static constexpr int64_t kSourceBurst = 3;
    static constexpr int64_t kSourcePerSecond = 1;
    static constexpr int64_t kTotalBurst = 20;
    static constexpr int64_t kTotalPerSecond = 20;
    static constexpr size_t kSources = 64;

    // True, taking one token of `source` and one of the total, when both have one at `nowMs`
    // (monotonic); otherwise false, taking none.
    bool allow(uint32_t source, int64_t nowMs);

   private:
    // Tokens in thousandths: a bucket refilled r tokens per second gains r per millisecond.
    struct Bucket {
        int64_t milli = 0;
        int64_t atMs = 0;
    };
    struct Source {
        uint32_t ip = 0;
        Bucket bucket;
        int64_t seenMs = 0;
    };
    static void refill(Bucket& b, int64_t nowMs, int64_t burst, int64_t perSecond);

    std::array<Source, kSources> sources_{};
    size_t used_ = 0;
    Bucket total_;
    bool totalStarted_ = false;
};

enum class Drop { None, Format, Subnet, Port, Rate };

// Counters since start: block "discovery" of GET /api/v1/diagnostics (device-api §6).
struct Counters {
    uint64_t replies = 0;
    uint64_t subnet = 0;
    uint64_t format = 0;
    uint64_t rate = 0;
    uint64_t port = 0;
};

// One received datagram.
struct Datagram {
    const uint8_t* data = nullptr;
    size_t size = 0;
    bool cut = false;     // longer than the receive buffer (MSG_TRUNC)
    uint32_t source = 0;  // host byte order
    uint16_t sourcePort = 0;
    const Iface* iface = nullptr;  // the receiving interface (IP_PKTINFO); null when unknown
};

struct Decision {
    Drop drop = Drop::Format;
    Nonce nonce{};  // when drop == None
    Ipv4Net local;  // when drop == None: the interface address to answer from
};

// The checks of contract §2 and §4, in this order: format, source, port, rate. Counts each drop;
// only a datagram that passed the other checks takes rate tokens. One thread calls check() and
// countReply(); any thread may call counters().
class Responder {
   public:
    Decision check(const Datagram& d, int64_t nowMs);
    // A reply was sent.
    void countReply();
    Counters counters() const;

   private:
    void count(Drop drop);

    RateLimiter limiter_;
    std::atomic<uint64_t> replies_{0};
    std::atomic<uint64_t> subnet_{0};
    std::atomic<uint64_t> format_{0};
    std::atomic<uint64_t> rate_{0};
    std::atomic<uint64_t> port_{0};
};

enum class DeviceStatus { Running, NoProject, ProjectError, Activating };
// "running", "no-project", "project-error", "activating"
const char* statusName(DeviceStatus status);

struct ProjectInfo {
    std::string id;
    std::string name;  // at most kMaxProjectNameChars go out
    std::string version;
    std::optional<std::string> digest;  // "sha256:<64 hex>"; null until the runtime knows it
};

// What the device tells about itself (contract §3). There is no field for a password, a key, a
// token, an account, project content or a path on the device (Constitution V).
struct DeviceInfo {
    std::string deviceId;  // <dataDir>/device-id (UUID)
    std::string name;      // deviceName; at most kMaxNameBytes go out
    std::string model;     // deviceModel; at most kMaxNameBytes go out
    std::string runtime;   // runtime version (SemVer)
    std::string api;       // device API version (SemVer)
    DeviceStatus status = DeviceStatus::NoProject;
    std::optional<ProjectInfo> project;  // none: no project
    int httpsPort = 0;                   // 0: HTTPS off or certificate error
    int httpPort = 0;
    std::optional<std::string> fingerprint;  // SHA-256 of the certificate, 64 lowercase hex
};

// The receiving interface's part of the reply: "ip" and "prefix" of `net`, "mac".
struct LocalAddress {
    Ipv4Net net;
    std::optional<Mac> mac;
};

// Writes the reply to the query with `nonce` into `out` and returns its size (header and JSON),
// at most kQuerySize; 0 when no reply can be made to fit.
// - JSON: compact, keys in the order of contract §3, strings escaped as nlohmann::json::dump()
//   escapes them; invalid UTF-8 becomes U+FFFD as with its error_handler_t::replace. Absent
//   optional values are null.
// - name and model: at most 32 bytes; project.name: at most 64 characters; cut on character
//   boundaries.
// - "https" is httpsPort and "fp" the fingerprint only when both are good (port 1–65535, 64
//   lowercase hex); otherwise "https" is 0 and "fp" null.
// - JSON over 1000 bytes (contract §5a): (1) project.name goes; (2) name is cut to its longest
//   prefix that fits; (3) still too long, the project block goes and name gets the room back.
// Every cut sets the `truncated` flag.
size_t buildReply(const Nonce& nonce, const DeviceInfo& info, const LocalAddress& local,
                  Packet& out);

}  // namespace mat::discovery
