// Source filter (FR-055a, ADR-018, research R19): isPrivateSource at the edges of every range, the
// decision table viewerAccess x path x session x listener x loopback, the 403 bodies.
#include "server/http/source_filter.hpp"

#include <gtest/gtest.h>

#include "nlohmann/json.hpp"

using namespace mat;

TEST(IsPrivateSource, RangesAndTheirEdges) {
    const struct {
        const char* addr;
        bool priv;
    } cases[] = {
        {"10.0.0.0", true},
        {"10.255.255.255", true},
        {"9.255.255.255", false},
        {"11.0.0.0", false},
        {"172.15.255.255", false},
        {"172.16.0.0", true},
        {"172.31.255.255", true},
        {"172.32.0.0", false},
        {"192.168.0.0", true},
        {"192.168.255.255", true},
        {"192.167.255.255", false},
        {"192.169.0.0", false},
        {"100.63.255.255", false},
        {"100.64.0.0", true},
        {"100.127.255.255", true},
        {"100.128.0.0", false},
        {"169.254.0.1", true},
        {"169.253.255.255", false},
        {"169.255.0.0", false},
        {"127.0.0.1", true},
        {"127.255.255.255", true},
        {"126.255.255.255", false},
        {"128.0.0.0", false},
        {"8.8.8.8", false},
        {"203.0.113.9", false},
        {"0.0.0.0", false},
        {"255.255.255.255", false},
        // IPv6
        {"fc00::", true},
        {"fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", true},
        {"fbff::1", false},
        {"fe00::1", false},
        {"fe80::1", true},
        {"febf::1", true},
        {"fec0::1", false},
        {"::1", true},
        {"::", false},
        {"::2", false},
        {"2001:db8::1", false},
        {"2606:4700::1111", false},
    };
    for (const auto& c : cases) EXPECT_EQ(isPrivateSource(c.addr), c.priv) << c.addr;
}

TEST(IsPrivateSource, MappedIpv4IsJudgedAsIpv4) {
    EXPECT_TRUE(isPrivateSource("::ffff:10.1.2.3"));
    EXPECT_TRUE(isPrivateSource("::ffff:192.168.1.1"));
    EXPECT_TRUE(isPrivateSource("::ffff:127.0.0.1"));
    EXPECT_FALSE(isPrivateSource("::ffff:8.8.8.8"));
    EXPECT_FALSE(isPrivateSource("::ffff:172.32.0.1"));
    EXPECT_TRUE(isPrivateSource("::FFFF:172.16.0.1"));
}

TEST(IsPrivateSource, TextThatIsNoAddressIsNotPrivate) {
    for (const char* bad :
         {"", "localhost", "10.0.0", "10.0.0.256", "10.0.0.1.1", "10.0.0.1:80", "[::1]",
          "[fe80::1]:80", " 10.0.0.1", "10.0.0.1 ", "010.0.0.1", "0x0a.0.0.1", "10.0.0.-1",
          "fe80::g", "::1::", "192.168.1.1/24", "https://10.0.0.1", "１０.0.0.1"})
        EXPECT_FALSE(isPrivateSource(bad)) << "[" << bad << "]";
}

TEST(IsPrivateSource, AZoneSuffixOfALinkLocalAddressIsIgnored) {
    EXPECT_TRUE(isPrivateSource("fe80::1%eth0"));
    EXPECT_FALSE(isPrivateSource("2001:db8::1%eth0"));
}

TEST(IsLoopbackSource, OnlyTheLoopback) {
    EXPECT_TRUE(isLoopbackSource("127.0.0.1"));
    EXPECT_TRUE(isLoopbackSource("127.1.2.3"));
    EXPECT_TRUE(isLoopbackSource("::1"));
    EXPECT_TRUE(isLoopbackSource("::ffff:127.0.0.1"));
    EXPECT_FALSE(isLoopbackSource("192.168.1.1"));
    EXPECT_FALSE(isLoopbackSource("fe80::1"));
    EXPECT_FALSE(isLoopbackSource("nonsense"));
}

TEST(ViewerAccess, ParseAndName) {
    EXPECT_EQ(parseViewerAccess("private"), ViewerAccess::Private);
    EXPECT_EQ(parseViewerAccess("any"), ViewerAccess::Any);
    EXPECT_EQ(parseViewerAccess("off"), ViewerAccess::Off);
    EXPECT_FALSE(parseViewerAccess("Private"));
    EXPECT_FALSE(parseViewerAccess(""));
    EXPECT_STREQ(viewerAccessName(ViewerAccess::Off), "off");
}

TEST(ClassifyPath, TheFilteredPathsAndOnlyThose) {
    EXPECT_EQ(classifyPath("/"), FilteredPath::Page);
    EXPECT_EQ(classifyPath("/index.html"), FilteredPath::Page);
    EXPECT_EQ(classifyPath("/assets/main-abc.js"), FilteredPath::Asset);
    EXPECT_EQ(classifyPath("/project/screens/main.svg"), FilteredPath::Project);
    EXPECT_EQ(classifyPath("/api/v1/system/info"), FilteredPath::SystemInfo);
    EXPECT_EQ(classifyPath("/api/v1/projects/active"), FilteredPath::ProjectsActive);
    EXPECT_EQ(classifyPath("/api/v1/live"), FilteredPath::Live);
    for (const char* none :
         {"/api/v1/device/identity", "/api/v1/auth/login", "/api/v1/auth/logout",
          "/api/v1/projects", "/api/v1/diagnostics", "/api/v1/audit", "/api/v1/tags/write",
          "/api/v1/live/x", "/api/v1/system/info/x", "/index.htm", "/assetsx", "/projects/"})
        EXPECT_EQ(classifyPath(none), FilteredPath::None) << none;
}

namespace {
FilterDecision decide(ViewerAccess a, FilteredPath p, const std::string& remote, bool tls = false,
                      bool auth = false, bool valid = false) {
    FilterInput in;
    in.access = a;
    in.path = p;
    in.remote = remote;
    in.tls = tls;
    in.hasAuthorization = auth;
    in.validSession = valid;
    return decideFilter(in);
}
const FilteredPath kFiltered[] = {FilteredPath::Page,           FilteredPath::Asset,
                                  FilteredPath::Project,        FilteredPath::SystemInfo,
                                  FilteredPath::ProjectsActive, FilteredPath::Live};
}  // namespace

TEST(DecideFilter, PrivateServesPrivateAndLoopbackRefusesTheRest) {
    for (FilteredPath p : kFiltered) {
        EXPECT_TRUE(decide(ViewerAccess::Private, p, "192.168.1.20").allow);
        EXPECT_TRUE(decide(ViewerAccess::Private, p, "127.0.0.1").allow);
        const auto d = decide(ViewerAccess::Private, p, "203.0.113.9");
        EXPECT_FALSE(d.allow);
        EXPECT_EQ(d.status, 403);
        EXPECT_EQ(d.error, "SOURCE_NOT_ALLOWED");
    }
}

TEST(DecideFilter, AnyServesEverySource) {
    for (FilteredPath p : kFiltered) {
        EXPECT_TRUE(decide(ViewerAccess::Any, p, "203.0.113.9").allow);
        EXPECT_TRUE(decide(ViewerAccess::Any, p, "garbage").allow);
    }
}

TEST(DecideFilter, OffClosesEverythingButTheLoopbackAndTheSystemInfo) {
    for (FilteredPath p : {FilteredPath::Page, FilteredPath::Asset, FilteredPath::Project,
                           FilteredPath::ProjectsActive, FilteredPath::Live}) {
        EXPECT_EQ(decide(ViewerAccess::Off, p, "192.168.1.20").error, "VIEWER_OFF");
        EXPECT_EQ(decide(ViewerAccess::Off, p, "203.0.113.9").error, "VIEWER_OFF");
        EXPECT_TRUE(decide(ViewerAccess::Off, p, "127.0.0.1").allow);
        EXPECT_TRUE(decide(ViewerAccess::Off, p, "::1").allow);
    }
    // system/info as in `private`: the deploy script and the health check read it
    EXPECT_TRUE(decide(ViewerAccess::Off, FilteredPath::SystemInfo, "192.168.1.20").allow);
    EXPECT_TRUE(decide(ViewerAccess::Off, FilteredPath::SystemInfo, "127.0.0.1").allow);
    EXPECT_EQ(decide(ViewerAccess::Off, FilteredPath::SystemInfo, "203.0.113.9").error,
              "SOURCE_NOT_ALLOWED");
}

TEST(DecideFilter, AValidSessionIsNeverFiltered) {
    for (ViewerAccess a : {ViewerAccess::Private, ViewerAccess::Off})
        for (FilteredPath p : kFiltered) {
            EXPECT_TRUE(decide(a, p, "203.0.113.9", true, true, true).allow);
        }
    // a session that did not check out is just a source: filtered
    EXPECT_FALSE(
        decide(ViewerAccess::Private, FilteredPath::Live, "203.0.113.9", true, true, false).allow);
}

TEST(DecideFilter, AnAuthorizationHeaderOverHttpIsHttpsRequiredWhateverTheSource) {
    for (ViewerAccess a : {ViewerAccess::Private, ViewerAccess::Any, ViewerAccess::Off})
        for (const char* src : {"192.168.1.20", "127.0.0.1", "203.0.113.9"}) {
            const auto d = decide(a, FilteredPath::Live, src, false, true, false);
            EXPECT_FALSE(d.allow);
            EXPECT_EQ(d.error, "HTTPS_REQUIRED");
            EXPECT_EQ(d.status, 403);
        }
}

TEST(DecideFilter, TheOtherPathsAreNeverFiltered) {
    for (ViewerAccess a : {ViewerAccess::Private, ViewerAccess::Any, ViewerAccess::Off}) {
        EXPECT_TRUE(decide(a, FilteredPath::None, "203.0.113.9").allow);
        EXPECT_TRUE(decide(a, FilteredPath::None, "203.0.113.9", false, true)
                        .allow);  // device/identity, auth/*
    }
}

TEST(FilterBodies, ShortPageAndJson) {
    const std::string page = blockedPageHtml("SOURCE_NOT_ALLOWED");
    EXPECT_NE(page.find("<meta charset=\"utf-8\">"), std::string::npos);
    EXPECT_NE(page.find("mạng nội bộ"), std::string::npos);
    EXPECT_NE(page.find("VPN"), std::string::npos);
    EXPECT_EQ(page.find("<script"), std::string::npos);  // CSP default-src 'none'
    const auto j = nlohmann::json::parse(blockedJson("VIEWER_OFF"));
    EXPECT_EQ(j["error"], "VIEWER_OFF");
    EXPECT_FALSE(j["message"].get<std::string>().empty());
    EXPECT_EQ(nlohmann::json::parse(blockedJson("SOURCE_NOT_ALLOWED"))["error"],
              "SOURCE_NOT_ALLOWED");
}
