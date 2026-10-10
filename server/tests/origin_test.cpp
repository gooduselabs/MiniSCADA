#include "server/websocket/origin.hpp"

#include <gtest/gtest.h>

using mat::isOriginAllowed;

namespace {
const std::vector<std::string> kAllowed{"http://tauri.localhost", "tauri://localhost"};
}

TEST(Origin, MissingOriginIsAllowed) {
    EXPECT_TRUE(isOriginAllowed(nullptr, "192.168.1.110:8080", kAllowed));
    EXPECT_TRUE(isOriginAllowed("", "192.168.1.110:8080", kAllowed));
}

TEST(Origin, SameOriginIncludingPort) {
    EXPECT_TRUE(isOriginAllowed("http://192.168.1.110:8080", "192.168.1.110:8080", kAllowed));
    EXPECT_TRUE(isOriginAllowed("http://localhost:8080", "localhost:8080", kAllowed));
    EXPECT_TRUE(isOriginAllowed("http://Device.Local:8080", "device.local:8080", kAllowed));
    EXPECT_FALSE(isOriginAllowed("http://192.168.1.110:9090", "192.168.1.110:8080", kAllowed));
    EXPECT_FALSE(isOriginAllowed("https://192.168.1.110:8080", "192.168.1.110:8080", kAllowed));
}

TEST(Origin, ConfiguredOriginsAreAllowed) {
    EXPECT_TRUE(isOriginAllowed("http://tauri.localhost", "192.168.1.110:8080", kAllowed));
    EXPECT_TRUE(isOriginAllowed("tauri://localhost", "192.168.1.110:8080", kAllowed));
    EXPECT_FALSE(isOriginAllowed("http://tauri.localhost", "192.168.1.110:8080", {}));
}

TEST(Origin, ForeignOriginsAreRejected) {
    EXPECT_FALSE(isOriginAllowed("http://evil.example", "192.168.1.110:8080", kAllowed));
    EXPECT_FALSE(isOriginAllowed("null", "192.168.1.110:8080", kAllowed));
    EXPECT_FALSE(
        isOriginAllowed("http://192.168.1.110.evil.example", "192.168.1.110:8080", kAllowed));
    EXPECT_FALSE(
        isOriginAllowed("http://192.168.1.110:8080.evil.example", "192.168.1.110:8080", kAllowed));
    EXPECT_FALSE(isOriginAllowed("http://evil.example", nullptr, kAllowed));
    EXPECT_FALSE(isOriginAllowed("http://tauri.localhost.evil", "x:1", kAllowed));
}
