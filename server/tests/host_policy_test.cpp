// T032 (feature 011; contracts/device-api-011.md §1, research R4, FR-011 to FR-013, SC-002): the
// check of `Host` against DNS rebinding.
// - The decision table on its own (HostPolicy::check): IPv4 and IPv6 literals, localhost, the
//   device's host name and <name>.local, allowedHosts, other names, ports, case, the trailing dot,
//   a missing Host (HTTP/1.1, HTTP/1.0 from loopback or not), two Host headers, control characters,
//   more than 255 bytes; hostCheck off, its warning, device/identity.acceptedHosts.
// - The two listeners of mat-runtime in process (WebContexts with the policy, HttpApi and the
//   engineering API, a WebSocket route): the check runs before anything else on HTTP, HTTPS and the
//   WebSocket upgrade, /device.crt included; 421 HOST_NOT_ALLOWED with the body of the contract and
//   nothing else; access.denied coalesced per 60 s with detail.host cut at 64 bytes.
#include "server/host_policy.hpp"

#include <gtest/gtest.h>

#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"
#include "server/http/http_api.hpp"
#include "server/system_warnings.hpp"
#include "server/tests/api_rig.hpp"
#include "server/tests/civet_test_support.hpp"

using namespace mat;
using json = nlohmann::json;
using test::ApiRig;
using test::HttpResult;

namespace {

HostPolicy policy(std::vector<std::string> allowed = {}, bool enabled = true,
                  HostPolicy::Audit audit = {}) {
    HostPolicyOptions o;
    o.enabled = enabled;
    o.hostname = "BL335-A";  // as gethostname() may give it: the policy compares in lower case
    o.allowedHosts = std::move(allowed);
    return HostPolicy(o, std::move(audit));
}

HostVerdict check(const HostPolicy& p, std::vector<std::string> hosts, bool http10 = false,
                  bool loopback = false) {
    HostRequest r;
    r.hosts = std::move(hosts);
    r.http10 = http10;
    r.loopback = loopback;
    return p.check(r);
}

HostVerdict one(const HostPolicy& p, const std::string& host) { return check(p, {host}); }

constexpr HostVerdict kAccept = HostVerdict::Accept;
constexpr HostVerdict k421 = HostVerdict::NotAllowed;
constexpr HostVerdict k400 = HostVerdict::BadRequest;

}  // namespace

// --- The decision table ---------------------------------------------------------------------

TEST(HostPolicy, AnyValidIpv4LiteralIsAccepted) {
    const HostPolicy p = policy();
    for (const char* h : {"192.168.1.110", "10.0.0.1:8080", "0.0.0.0", "255.255.255.255:8443",
                          "127.0.0.1", "203.0.113.7:1"})
        EXPECT_EQ(one(p, h), kAccept) << h;
    // Not an IPv4 literal: a name, which nobody declared.
    for (const char* h : {"256.1.1.1", "1.2.3", "1.2.3.4.5", "01.2.3.4", "1.2.3.4a", "-1.2.3.4"})
        EXPECT_EQ(one(p, h), k421) << h;
}

TEST(HostPolicy, AnyValidIpv6LiteralInBracketsIsAccepted) {
    const HostPolicy p = policy();
    for (const char* h : {"[::1]", "[::1]:8080", "[fe80::1]:8443", "[2001:DB8::1]",
                          "[::ffff:192.168.1.110]", "[::1]:"})
        EXPECT_EQ(one(p, h), kAccept) << h;
    // Not an address in the brackets, no closing bracket, something after it but a port, or an
    // address without brackets: malformed.
    for (const char* h : {"[zz::1]", "[::1", "[::1]x", "[::1]:x", "::1", "[]"})
        EXPECT_EQ(one(p, h), k400) << h;
}

TEST(HostPolicy, LocalhostIsAccepted) {
    const HostPolicy p = policy();
    for (const char* h : {"localhost", "localhost:8080", "LOCALHOST", "localhost."})
        EXPECT_EQ(one(p, h), kAccept) << h;
    EXPECT_EQ(one(p, "evil.localhost"), k421);
    EXPECT_EQ(one(p, "localhost.evil.example"), k421);
}

TEST(HostPolicy, TheDeviceHostNameAndItsDotLocalAreAccepted) {
    const HostPolicy p = policy();
    for (const char* h :
         {"bl335-a", "BL335-A:8443", "bl335-a.local", "Bl335-A.Local:8080", "bl335-a.local."})
        EXPECT_EQ(one(p, h), kAccept) << h;
    EXPECT_EQ(one(p, "bl335-a.lan"), k421);
    EXPECT_EQ(one(p, "x.bl335-a.local"), k421);
    // Without a host name only the other rows count.
    HostPolicyOptions o;
    const HostPolicy none(o);
    EXPECT_EQ(one(none, "local"), k421);
    EXPECT_EQ(one(none, ".local"), k421);
    EXPECT_EQ(one(none, "localhost"), kAccept);
}

TEST(HostPolicy, AllowedHostsMatchExactlyWithoutWildcards) {
    const HostPolicy p = policy({"scada.nhamay.vn", "SCADA2.NhaMay.VN.", "*.nhamay.vn"});
    for (const char* h : {"scada.nhamay.vn", "scada.nhamay.vn:8443", "Scada.NhaMay.Vn",
                          "scada.nhamay.vn.", "scada2.nhamay.vn"})
        EXPECT_EQ(one(p, h), kAccept) << h;
    // `*` is not a wildcard: only the literal text, which no browser sends.
    for (const char* h : {"x.scada.nhamay.vn", "nhamay.vn", "a.nhamay.vn", "scada.nhamay.vn.evil"})
        EXPECT_EQ(one(p, h), k421) << h;
}

TEST(HostPolicy, AnyOtherNameIs421) {
    const HostPolicy p = policy({"scada.nhamay.vn"});
    for (const char* h : {"evil.example", "evil.example:8080", "rebind.attacker.test:8443",
                          "192.168.1.110.nip.io", "bl335", "xn--scada-9ya.vn"})
        EXPECT_EQ(one(p, h), k421) << h;
}

TEST(HostPolicy, PortIsSplitOffAndMustBeANumber) {
    const HostPolicy p = policy();
    for (const char* h : {"localhost:1", "localhost:65535", "localhost:"})
        EXPECT_EQ(one(p, h), kAccept) << h;  // an empty port is allowed by RFC 3986
    for (const char* h : {"localhost:65536", "localhost:abc", "localhost:80:80", "localhost:-1",
                          "localhost:123456", ":8080", "a b"})
        EXPECT_EQ(one(p, h), k400) << h;
}

TEST(HostPolicy, SpacesAroundAreTrimmedAndOnlyOneTrailingDotIsDropped) {
    const HostPolicy p = policy();
    EXPECT_EQ(one(p, "  localhost:8080 \t"), kAccept);
    EXPECT_EQ(one(p, "localhost.."), k421);  // "localhost." is not localhost
    EXPECT_EQ(one(p, "."), k400);
    EXPECT_EQ(one(p, "   "), k400);  // nothing once trimmed: as a missing Host
}

TEST(HostPolicy, MissingHostIs400ExceptHttp10FromLoopback) {
    const HostPolicy p = policy();
    EXPECT_EQ(check(p, {}, false, false), k400);     // HTTP/1.1
    EXPECT_EQ(check(p, {}, false, true), k400);      // HTTP/1.1 from loopback too
    EXPECT_EQ(check(p, {}, true, true), kAccept);    // HTTP/1.0 from loopback: a local tool
    EXPECT_EQ(check(p, {}, true, false), k400);      // HTTP/1.0 from the LAN
    EXPECT_EQ(check(p, {""}, true, true), kAccept);  // an empty Host counts as missing
}

TEST(HostPolicy, TwoHostHeadersAre400EvenWhenBothAreGood) {
    const HostPolicy p = policy();
    EXPECT_EQ(check(p, {"localhost", "localhost"}), k400);
    EXPECT_EQ(check(p, {"192.168.1.110", "evil.example"}), k400);
}

TEST(HostPolicy, ControlCharactersAre400) {
    const HostPolicy p = policy();
    for (const std::string h :
         {std::string("local\x01host"), std::string("localhost\x7f"), std::string("local\thost"),
          std::string("localhost\r"), std::string("local\0host", 10)})
        EXPECT_EQ(one(p, h), k400) << json(h).dump();
}

TEST(HostPolicy, MoreThan255BytesIs400) {
    const HostPolicy p = policy({std::string(255, 'a')});
    EXPECT_EQ(one(p, std::string(255, 'a')), kAccept);
    EXPECT_EQ(one(p, std::string(255, 'b')), k421);
    EXPECT_EQ(one(p, std::string(256, 'a')), k400);
    EXPECT_EQ(one(p, std::string(251, 'a') + ":8080"), k400);  // the whole header value counts
}

TEST(HostPolicy, HostCheckOffAcceptsEverythingAndRaisesTheWarning) {
    const HostPolicy off = policy({}, false);
    EXPECT_FALSE(off.enabled());
    EXPECT_EQ(one(off, "evil.example"), kAccept);
    EXPECT_EQ(check(off, {}), kAccept);
    EXPECT_EQ(check(off, {"a", "b"}), kAccept);
    EXPECT_EQ(one(off, std::string(300, 'a')), kAccept);

    SystemWarnings w([] { return int64_t{1000}; });
    off.publishWarning(w);
    ASSERT_EQ(w.list().size(), 1u);
    EXPECT_EQ(w.list()[0].code, "HOST_CHECK_OFF");
    const HostPolicy strict = policy();
    EXPECT_TRUE(strict.enabled());
    strict.publishWarning(w);  // strict clears it
    EXPECT_TRUE(w.list().empty());
}

TEST(HostPolicy, AcceptedHostsListsTheNamesAndAnyIp) {
    const json a = policy({"scada.nhamay.vn"}).acceptedHosts();
    EXPECT_EQ(a["ips"], json::array({"*"}));
    EXPECT_EQ(a["names"],
              json::array({"localhost", "bl335-a", "bl335-a.local", "scada.nhamay.vn"}));
    const json off = policy({}, false).acceptedHosts();
    EXPECT_EQ(off["names"], json::array({"*"}));  // every name while the check is off
    EXPECT_EQ(off["ips"], json::array({"*"}));
}

TEST(HostPolicy, TheRefusalIsAuditedWithTheHostCutAt64Bytes) {
    std::vector<AuditEvent> events;
    const HostPolicy p = policy({}, true, [&](const AuditEvent& e) { events.push_back(e); });
    HostRequest r;
    r.hosts = {std::string(80, 'x') + ".example"};
    ASSERT_EQ(p.check(r), k421);
    p.recordDenied(k421, r, "/api/v1/system/info", "192.168.1.31:40100", false);
    r.hosts = {"a\x01" + std::string(100, 'b')};
    p.recordDenied(k400, r, "/", "[fe80::2]:5000", true);
    ASSERT_EQ(events.size(), 2u);
    const AuditEvent& e = events[0];
    EXPECT_EQ(e.action, AuditAction::AccessDenied);
    EXPECT_EQ(e.result, AuditResult::Denied);
    EXPECT_EQ(e.channel, AuditChannel::Http);
    EXPECT_EQ(e.source, "192.168.1.31:40100");
    EXPECT_EQ(e.target.value_or(""), "/api/v1/system/info");
    EXPECT_EQ(e.code.value_or(""), "HOST_NOT_ALLOWED");
    const json d = json::parse(e.detail);
    EXPECT_EQ(d["reason"], "host");
    EXPECT_EQ(d["host"], std::string(64, 'x'));
    EXPECT_EQ(events[1].channel, AuditChannel::Https);
    EXPECT_EQ(events[1].code.value_or(""), "BAD_REQUEST");
    const json d1 = json::parse(events[1].detail);  // a control character is not stored as is
    EXPECT_EQ(d1["host"].get<std::string>().size(), 64u);
    EXPECT_EQ(d1["host"].get<std::string>().find('\x01'), std::string::npos);
    // An audit log that throws does not change the refusal.
    const HostPolicy failing =
        policy({}, true, [](const AuditEvent&) { throw AuditUnavailable("disk full"); });
    EXPECT_NO_THROW(failing.recordDenied(k421, r, "/", "192.168.1.31:1", false));
}

// L1 of the security review of 011: one refusal of a (source address, code) is written per
// minute, the others of that minute are counted in memory; the count goes out in one summary row
// when the minute is over (the next refusal, or flushDenied from the runtime's loop). A flood of
// requests with a wrong Host costs one row a minute, not one per request.
TEST(HostPolicy, RefusalsOfOneSourceAndCodeAreAuditedOncePerMinuteWithACount) {
    std::vector<AuditEvent> events;
    int64_t now = 1000;
    HostPolicyOptions o;
    o.hostname = "bl335-a";
    o.monoMs = [&] { return now; };
    const HostPolicy p(o, [&](const AuditEvent& e) { events.push_back(e); });
    HostRequest r;
    r.hosts = {"evil.example"};
    for (int i = 0; i < 50; ++i)
        p.recordDenied(k421, r, "/p" + std::to_string(i),
                       "192.168.1.31:" + std::to_string(40000 + i), i % 2 == 0);
    ASSERT_EQ(events.size(), 1u) << "the first one only";
    EXPECT_EQ(events[0].target.value_or(""), "/p0");
    EXPECT_EQ(events[0].source, "192.168.1.31:40000");
    p.recordDenied(k400, r, "/", "192.168.1.31:1", false);  // another code: its own first row
    p.recordDenied(k421, r, "/", "[fe80::2]:5000", true);   // another source: its own first row
    ASSERT_EQ(events.size(), 3u);
    EXPECT_EQ(events[1].code.value_or(""), "BAD_REQUEST");
    EXPECT_EQ(events[2].source, "[fe80::2]:5000");
    now += 30000;
    p.flushDenied();  // the minute is not over
    EXPECT_EQ(events.size(), 3u);
    now += 31000;
    p.flushDenied();
    ASSERT_EQ(events.size(), 4u) << "one summary: the other windows had no repeat";
    const AuditEvent& sum = events[3];
    EXPECT_EQ(sum.action, AuditAction::AccessDenied);
    EXPECT_EQ(sum.result, AuditResult::Denied);
    EXPECT_EQ(sum.code.value_or(""), "HOST_NOT_ALLOWED");
    EXPECT_EQ(sum.source, "192.168.1.31");
    EXPECT_EQ(sum.target.value_or(""), "*");
    const json d = json::parse(sum.detail);
    EXPECT_EQ(d["reason"], "host");
    EXPECT_EQ(d["repeated"], 49);
    EXPECT_EQ(d["windowS"], 60);
    EXPECT_EQ(d["host"], "evil.example");
    // The next refusal opens a new minute: written at once again.
    p.recordDenied(k421, r, "/again", "192.168.1.31:2", false);
    ASSERT_EQ(events.size(), 5u);
    EXPECT_EQ(events[4].target.value_or(""), "/again");
    // Without flushDenied, the summary goes out with the first refusal after the minute.
    p.recordDenied(k421, r, "/x", "192.168.1.31:3", false);
    p.recordDenied(k421, r, "/x", "192.168.1.31:4", false);
    now += 61000;
    p.recordDenied(k421, r, "/y", "192.168.1.31:5", false);
    ASSERT_EQ(events.size(), 7u);
    EXPECT_EQ(json::parse(events[5].detail)["repeated"], 2);
    EXPECT_EQ(events[6].target.value_or(""), "/y");
}

// The windows are bounded: past kHostDeniedWindows sources the oldest windows go, their counts
// written first, so no count is lost.
TEST(HostPolicy, TheRefusalWindowsAreBounded) {
    std::vector<AuditEvent> events;
    int64_t now = 1000;
    HostPolicyOptions o;
    o.monoMs = [&] { return now; };
    const HostPolicy p(o, [&](const AuditEvent& e) { events.push_back(e); });
    HostRequest r;
    r.hosts = {"evil.example"};
    for (int i = 0; i < 1000; ++i) {
        const std::string src = "10.0." + std::to_string(i / 250) + "." + std::to_string(i % 250);
        p.recordDenied(k421, r, "/", src + ":1", false);
        p.recordDenied(k421, r, "/", src + ":2", false);
    }
    EXPECT_LE(p.deniedWindows(), kHostDeniedWindows);
    p.flushDenied(true);
    int64_t repeated = 0;
    for (const auto& e : events)
        if (e.target.value_or("") == "*")
            repeated += json::parse(e.detail)["repeated"].get<int64_t>();
    EXPECT_EQ(repeated, 1000) << "no count is lost";
    EXPECT_EQ(p.deniedWindows(), 0u);
}

TEST(HostPolicy, TheBodyOf421IsTheContractsAndNothingElse) {
    EXPECT_EQ(HostPolicy::status(k421), 421);
    EXPECT_EQ(HostPolicy::status(k400), 400);
    EXPECT_EQ(HostPolicy::status(kAccept), 0);
    const json b = json::parse(HostPolicy::body(k421));
    EXPECT_EQ(
        b,
        json::parse(
            R"({"error":{"code":"HOST_NOT_ALLOWED","message":"Tên này chưa được phép. Quản trị viên: thêm vào allowedHosts của runtime.json."}})"));
    EXPECT_EQ(json::parse(HostPolicy::body(k400))["error"]["code"], "BAD_REQUEST");
}

// --- The two listeners --------------------------------------------------------------------------

namespace {

struct Dirs {
    std::filesystem::path root;
    Dirs() {
        std::string t = (std::filesystem::temp_directory_path() / "mat-host-XXXXXX").string();
        root = mkdtemp(t.data());
        std::filesystem::create_directories(root / "docroot" / "assets");
        std::filesystem::create_directories(root / "project");
        std::ofstream(root / "docroot" / "index.html") << "<!doctype html><title>mAT</title>";
    }
    ~Dirs() { std::filesystem::remove_all(root); }
};

int wsConnect(const mg_connection*, void*) { return 0; }
void wsReady(mg_connection*, void*) {}
int wsData(mg_connection*, int, char*, size_t, void*) { return 1; }
void wsClose(const mg_connection*, void*) {}

// The listeners as main opens them, with the policy in front, HttpApi (page, /device.crt,
// system/info), the engineering API (device/identity) and a WebSocket route on /api/v1/live.
struct Listeners {
    Dirs dirs;
    SystemWarnings warnings{[] { return int64_t{1792000000000}; }};
    std::unique_ptr<HostPolicy> host;
    std::unique_ptr<HttpApi> api;  // before the rig: destroyed after its contexts stopped
    std::unique_ptr<ApiRig> rig;

    explicit Listeners(bool enabled = true) {
        HttpApi::Options o;
        o.docroot = (dirs.root / "docroot").string();
        o.projectDir = (dirs.root / "project").string();
        o.deviceCertPem = "-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----\n";
        o.systemWarnings = &warnings;
        api = std::make_unique<HttpApi>(o, [] { return json{{"runtimeVersion", "1.0.0"}}; });
        rig = std::make_unique<ApiRig>([this, enabled](ApiRig& r) {
            HostPolicyOptions ho;
            ho.enabled = enabled;
            ho.hostname = "bl335-a";
            ho.allowedHosts = {"scada.nhamay.vn"};
            host =
                std::make_unique<HostPolicy>(ho, [&r](const AuditEvent& e) { r.audit->append(e); });
            host->publishWarning(warnings);
            r.hostPolicy = host.get();
            EngineeringApi::Options eo;
            eo.hostPolicy = host.get();
            r.eng = std::make_unique<EngineeringApi>(eo, *r.device, *r.auth, *r.audit);
        });
        for (mg_context* ctx : {rig->web.http(), rig->web.https()}) {
            api->install(ctx);
            mg_set_websocket_handler(ctx, "/api/v1/live", wsConnect, wsReady, wsData, wsClose,
                                     nullptr);
        }
    }
    ~Listeners() { rig.reset(); }

    // HTTPS through libcurl with the given Host ("" removes the header).
    HttpResult https(const std::string& path, const std::string& hostHeader,
                     std::vector<std::string> extra = {}) {
        extra.push_back("Host:" + (hostHeader.empty() ? "" : " " + hostHeader));
        return rig->call(test::getReq(path, extra));
    }
    int httpPort() const { return rig->web.httpPort(); }
};

struct Raw {
    int status = 0;
    std::string head, body;
};

// A raw request on the HTTP listener, read until the server closes.
Raw raw(int port, const std::string& request) {
    Raw r;
    const int fd = test::connectLocal(port);
    if (fd < 0) return r;
    test::sendAll(fd, request);
    std::string all;
    char buf[4096];
    ssize_t n;
    while ((n = test::recvSome(fd, buf, sizeof buf, 5000)) > 0)
        all.append(buf, static_cast<size_t>(n));
    ::close(fd);
    if (all.compare(0, 5, "HTTP/") == 0 && all.size() > 12) r.status = std::atoi(all.c_str() + 9);
    const size_t end = all.find("\r\n\r\n");
    r.head = all.substr(0, end);
    if (end != std::string::npos) r.body = all.substr(end + 4);
    return r;
}

Raw rawGet(int port, const std::string& path, const std::string& headers,
           const std::string& version = "1.1") {
    return raw(port,
               "GET " + path + " HTTP/" + version + "\r\n" + headers + "Connection: close\r\n\r\n");
}

std::string wsHeaders() {
    return "Upgrade: websocket\r\nConnection: Upgrade\r\n"
           "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n";
}

// The status line and headers of a WebSocket upgrade on the HTTP listener (no Connection: close).
Raw rawUpgrade(int port, const std::string& host) {
    Raw r;
    const int fd = test::connectLocal(port);
    if (fd < 0) return r;
    test::sendAll(fd, "GET /api/v1/live HTTP/1.1\r\nHost: " + host + "\r\n" + wsHeaders() + "\r\n");
    std::string all;
    char buf[4096];
    ssize_t n;
    while (all.find("\r\n\r\n") == std::string::npos &&
           (n = test::recvSome(fd, buf, sizeof buf, 3000)) > 0)
        all.append(buf, static_cast<size_t>(n));
    ::close(fd);
    if (all.compare(0, 5, "HTTP/") == 0 && all.size() > 12) r.status = std::atoi(all.c_str() + 9);
    r.head = all;
    return r;
}

}  // namespace

TEST(HostPolicyListeners, HttpAndHttpsRefuseAnUnknownNameBeforeAnyHandler) {
    Listeners l;
    for (const char* path : {"/", "/index.html", "/device.crt", "/api/v1/system/info",
                             "/api/v1/device/identity", "/assets/none.js", "/no/such/path"}) {
        const Raw h = rawGet(l.httpPort(), path, "Host: evil.example:8080\r\n");
        EXPECT_EQ(h.status, 421) << path << "\n" << h.head;
        EXPECT_EQ(json::parse(h.body, nullptr, false), json::parse(HostPolicy::body(k421)))
            << path << " " << h.body;
        const HttpResult s = l.https(path, "evil.example:8443");
        EXPECT_EQ(s.status, 421) << path << " " << s.body;
        EXPECT_EQ(json::parse(s.body, nullptr, false), json::parse(HostPolicy::body(k421))) << path;
        // Nothing of the page or the device in the answer.
        EXPECT_EQ(s.body.find("doctype"), std::string::npos);
        EXPECT_EQ(s.body.find("CERTIFICATE"), std::string::npos);
        EXPECT_EQ(s.headers.find("Set-Cookie"), std::string::npos);
    }
    // The same paths with an IP literal, a declared name, the host name: served.
    EXPECT_EQ(rawGet(l.httpPort(), "/", "Host: 192.168.1.110:8080\r\n").status, 200);
    EXPECT_EQ(l.https("/device.crt", "bl335-a.local:8443").status, 200);
    // Over HTTP the handler answers as before (404: the certificate is served over HTTPS only).
    EXPECT_EQ(rawGet(l.httpPort(), "/device.crt", "Host: bl335-a:8080\r\n").status, 404);
    EXPECT_EQ(l.https("/api/v1/system/info", "scada.nhamay.vn:8443").status, 200);
    EXPECT_EQ(l.https("/api/v1/device/identity", "[::1]:8443").status, 200);
}

TEST(HostPolicyListeners, MalformedHostIs400OnBothListeners) {
    Listeners l;
    EXPECT_EQ(rawGet(l.httpPort(), "/", "").status, 400);                        // HTTP/1.1
    EXPECT_EQ(rawGet(l.httpPort(), "/", "", "1.0").status, 200);                 // loopback 1.0
    EXPECT_EQ(rawGet(l.httpPort(), "/", "Host: a\r\nHost: a\r\n").status, 400);  // two
    EXPECT_EQ(rawGet(l.httpPort(), "/", "Host: " + std::string(256, 'a') + "\r\n").status, 400);
    EXPECT_EQ(rawGet(l.httpPort(), "/", "Host: local\x01host\r\n").status, 400);
    EXPECT_EQ(rawGet(l.httpPort(), "/", "Host: localhost:99999\r\n").status, 400);
    EXPECT_EQ(l.https("/api/v1/system/info", "").status, 400);  // no Host over HTTPS
}

TEST(HostPolicyListeners, WebSocketUpgradeIsCheckedBeforeTheHandshake) {
    Listeners l;
    const Raw bad = rawUpgrade(l.httpPort(), "evil.example:8080");
    EXPECT_EQ(bad.status, 421) << bad.head;
    const Raw good = rawUpgrade(l.httpPort(), "127.0.0.1:8080");
    EXPECT_EQ(good.status, 101) << good.head;
    // Over HTTPS: the upgrade request through libcurl gets the 421 instead of 101.
    const HttpResult s =
        l.https("/api/v1/live", "evil.example:8443",
                {"Upgrade: websocket", "Connection: Upgrade",
                 "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version: 13"});
    EXPECT_EQ(s.status, 421) << s.headers;
}

// L1 of the security review of 011: the first refusal of a source with a code is written at once,
// the next ones of that minute only count (any path, any listener), and one summary row
// (target "*", detail.repeated) follows when the minute is over (flushDenied).
TEST(HostPolicyListeners, RefusalsAreAuditedOncePerSourceAndCodeThenSummed) {
    Listeners l;
    for (int i = 0; i < 5; ++i)
        EXPECT_EQ(rawGet(l.httpPort(), "/api/v1/system/info",
                         "Host: " + std::string(70, 'r') + ".evil.example\r\n")
                      .status,
                  421);
    EXPECT_EQ(l.https("/", "evil.example").status, 421);
    auto rows = l.rig->records("access.denied");
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].code.value_or(""), "HOST_NOT_ALLOWED");
    EXPECT_EQ(rows[0].result, "denied");
    EXPECT_EQ(rows[0].channel, "http");
    EXPECT_EQ(rows[0].target.value_or(""), "/api/v1/system/info");
    EXPECT_EQ(rows[0].count, 1);
    const json first = json::parse(rows[0].detail.value_or("{}"));
    EXPECT_EQ(first["reason"], "host");
    EXPECT_EQ(first["host"], std::string(64, 'r'));
    l.host->flushDenied(true);  // as at the end of the minute (or when the runtime stops)
    rows = l.rig->records("access.denied");
    ASSERT_EQ(rows.size(), 2u);
    const auto& sum = rows[0].target.value_or("") == "*" ? rows[0] : rows[1];
    EXPECT_EQ(sum.target.value_or(""), "*");
    EXPECT_EQ(sum.code.value_or(""), "HOST_NOT_ALLOWED");
    const json d = json::parse(sum.detail.value_or("{}"));
    EXPECT_EQ(d["reason"], "host");
    EXPECT_EQ(d["repeated"], 5);
    EXPECT_EQ(d["windowS"], 60);
    EXPECT_EQ(d["host"], "evil.example");  // the last one
}

// L6 of the security review of 011: acceptedHosts tells a page of another site which names the
// device answers to; device/identity gives it only to a caller with a session (the Studio reads
// identity again once signed in). The rest of identity stays public.
TEST(HostPolicyListeners, DeviceIdentityListsTheAcceptedHostsOnlyWithASession) {
    Listeners l;
    for (const auto& extra : {std::vector<std::string>{},
                              std::vector<std::string>{"Authorization: Bearer mats_nope"}}) {
        const HttpResult anon = l.https("/api/v1/device/identity", "127.0.0.1", extra);
        ASSERT_EQ(anon.status, 200) << anon.body;
        const json a = json::parse(anon.body);
        EXPECT_FALSE(a.contains("acceptedHosts")) << anon.body;
        EXPECT_TRUE(a.contains("deviceId") && a.contains("features")) << anon.body;
    }
    const HttpResult r = l.https("/api/v1/device/identity", "127.0.0.1", {l.rig->bearer("xem1")});
    ASSERT_EQ(r.status, 200) << r.body;
    const json j = json::parse(r.body);
    EXPECT_EQ(j["acceptedHosts"]["ips"], json::array({"*"}));
    EXPECT_EQ(j["acceptedHosts"]["names"],
              json::array({"localhost", "bl335-a", "bl335-a.local", "scada.nhamay.vn"}));
}

TEST(HostPolicyListeners, HostCheckOffServesEveryNameAndSystemInfoWarns) {
    Listeners l(false);
    EXPECT_EQ(rawGet(l.httpPort(), "/", "Host: evil.example\r\n").status, 200);
    EXPECT_EQ(l.https("/api/v1/device/identity", "evil.example").status, 200);
    const HttpResult r = l.https("/api/v1/system/info", "evil.example");
    ASSERT_EQ(r.status, 200) << r.body;
    const json j = json::parse(r.body);
    EXPECT_NE(std::find(j["warnings"].begin(), j["warnings"].end(), "HOST_CHECK_OFF"),
              j["warnings"].end())
        << j["warnings"].dump();
    EXPECT_TRUE(l.rig->records("access.denied").empty());
}
