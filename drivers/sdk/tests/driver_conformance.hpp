// Conformance suite for drivers (FR-023, SC-020; contract modbus-driver §11). Every driver runs
// the same typed tests against a backend that the harness controls:
//   1 NO_VALUE before the first read, 2 values match the backend, 3 a dead backend gives BAD with a
//   reason within 2 cycles and recovers without restart, 4 every write result of data-model §8,
//   5 a disabled channel gives DISABLED and 0 bytes on the wire, 6 after stop() nothing is
//   published and the thread is joined, 7 the diagnostics counters match the injected faults.
// A driver that cannot offer an item (the simulation driver has no wire) says so in its harness and
// the test passes trivially; the Modbus drivers run them all.
#pragma once
#include <gtest/gtest.h>

#include <memory>
#include <mutex>
#include <vector>

#include "drivers/sdk/driver.hpp"

namespace mat::drv::conformance {

// Records everything the driver publishes.
class RecordingSink : public EngineSink {
   public:
    void publish(std::vector<TagUpdate>&& updates) override {
        std::lock_guard<std::mutex> g(mu);
        for (auto& u : updates) all.push_back(std::move(u));
    }
    void writeDone(WriteResult&& r) override {
        std::lock_guard<std::mutex> g(mu);
        results.push_back(std::move(r));
    }
    // The last update of a Tag (nullopt: none yet).
    std::optional<TagUpdate> last(size_t tag) {
        std::lock_guard<std::mutex> g(mu);
        for (auto it = all.rbegin(); it != all.rend(); ++it)
            if (it->tag == tag) return *it;
        return std::nullopt;
    }
    size_t count() {
        std::lock_guard<std::mutex> g(mu);
        return all.size();
    }
    size_t resultCount() {
        std::lock_guard<std::mutex> g(mu);
        return results.size();
    }
    std::vector<WriteResult> takeResults() {
        std::lock_guard<std::mutex> g(mu);
        auto r = results;
        return r;
    }

    std::mutex mu;
    std::vector<TagUpdate> all;
    std::vector<WriteResult> results;
};

// One driver with a fake backend. Tags are numbered 0..tagCount()-1 and are the Tag indexes the
// driver publishes with.
class Harness {
   public:
    virtual ~Harness() = default;
    virtual Driver& driver() = 0;
    virtual size_t tagCount() const = 0;
    virtual TagType tagType(size_t tag) const = 0;
    // The raw value the backend holds for `tag` (what a read returns).
    virtual TagScalar backendValue(size_t tag) const = 0;
    // Lets `ms` of (fake or real) time pass and runs what is due.
    virtual void advance(int64_t ms) = 0;
    // One scan cycle of the default configuration, in ms.
    virtual int64_t cycleMs() const = 0;

    // Optional items (see the header).
    virtual bool supportsFaults() const { return false; }
    virtual void setBackendResponding(bool) {}
    virtual bool supportsDisabled() const { return false; }
    virtual std::unique_ptr<Harness> makeDisabled() { return nullptr; }
    virtual uint64_t bytesOnWire() const { return 0; }
    virtual bool supportsDiagnostics() const { return false; }
    virtual void injectTimeouts(int /*count*/) {}
    // Tags that take writes (data-model §8): every status must be reachable.
    virtual std::vector<size_t> writableTags() const { return {}; }
    // A raw value valid for a write of `tag`.
    virtual TagScalar writeValue(size_t) const { return TagScalar{}; }
};

// Typed test fixture: Traits::make() returns a fresh Harness.
template <typename Traits>
class DriverConformance : public ::testing::Test {
   protected:
    void SetUp() override {
        harness_ = Traits::make();
        harness_->driver().start(sink_);
    }
    void TearDown() override {
        if (harness_) harness_->driver().stop();
    }
    RecordingSink sink_;
    std::unique_ptr<Harness> harness_;
};

TYPED_TEST_SUITE_P(DriverConformance);

// 1
TYPED_TEST_P(DriverConformance, NoValueBeforeTheFirstRead) {
    EXPECT_EQ(this->sink_.count(), 0u) << "a driver publishes nothing before its first read";
}

// 2
TYPED_TEST_P(DriverConformance, ValuesMatchTheBackend) {
    this->harness_->advance(this->harness_->cycleMs() * 2);
    for (size_t t = 0; t < this->harness_->tagCount(); ++t) {
        const auto u = this->sink_.last(t);
        ASSERT_TRUE(u.has_value()) << "tag " << t;
        EXPECT_EQ(u->quality, Quality::GOOD) << "tag " << t << " " << u->reason;
        EXPECT_EQ(u->value, this->harness_->backendValue(t)) << "tag " << t;
    }
}

// 3
TYPED_TEST_P(DriverConformance, DeadBackendGivesBadWithReasonThenRecovers) {
    if (!this->harness_->supportsFaults()) return;
    this->harness_->advance(this->harness_->cycleMs() * 2);
    this->harness_->setBackendResponding(false);
    this->harness_->advance(this->harness_->cycleMs() * 2 + 2000);
    for (size_t t = 0; t < this->harness_->tagCount(); ++t) {
        const auto u = this->sink_.last(t);
        ASSERT_TRUE(u.has_value());
        EXPECT_EQ(u->quality, Quality::BAD) << "tag " << t;
        EXPECT_FALSE(u->reason.empty()) << "tag " << t;
    }
    this->harness_->setBackendResponding(true);
    this->harness_->advance(this->harness_->cycleMs() * 4 + 12000);  // reconnect backoff included
    for (size_t t = 0; t < this->harness_->tagCount(); ++t) {
        const auto u = this->sink_.last(t);
        ASSERT_TRUE(u.has_value());
        EXPECT_EQ(u->quality, Quality::GOOD) << "tag " << t << " " << u->reason;
    }
}

// 4
TYPED_TEST_P(DriverConformance, WritesEndInAResult) {
    const auto tags = this->harness_->writableTags();
    if (tags.empty()) return;
    this->harness_->advance(this->harness_->cycleMs());
    uint64_t id = 100;
    for (size_t t : tags) {
        WriteCommand c;
        c.id = ++id;
        c.tag = t;
        c.raw = this->harness_->writeValue(t);
        ASSERT_TRUE(this->harness_->driver().enqueueWrite(c)) << "tag " << t;
    }
    this->harness_->advance(this->harness_->cycleMs() * 2 + 2000);
    const auto results = this->sink_.takeResults();
    ASSERT_EQ(results.size(), tags.size());
    for (const auto& r : results) {
        EXPECT_TRUE(r.status == WriteStatus::Confirmed || r.status == WriteStatus::NoReadback)
            << r.code;
        EXPECT_FALSE(r.code.empty());
    }
    // a command is never resent: advancing further adds no result
    this->harness_->advance(this->harness_->cycleMs() * 3);
    EXPECT_EQ(this->sink_.resultCount(), tags.size());
}

// 5
TYPED_TEST_P(DriverConformance, DisabledChannelHasNoTraffic) {
    if (!this->harness_->supportsDisabled()) return;
    auto h = this->harness_->makeDisabled();
    ASSERT_TRUE(h != nullptr);
    RecordingSink sink;
    h->driver().start(sink);
    h->advance(h->cycleMs() * 3);
    EXPECT_EQ(h->bytesOnWire(), 0u);
    for (size_t t = 0; t < h->tagCount(); ++t) {
        const auto u = sink.last(t);
        if (u) {
            EXPECT_EQ(u->quality, Quality::BAD);
            EXPECT_EQ(u->reason, "DISABLED");
        }
    }
    h->driver().stop();
}

// 6
TYPED_TEST_P(DriverConformance, NothingIsPublishedAfterStop) {
    this->harness_->advance(this->harness_->cycleMs() * 2);
    this->harness_->driver().stop();
    const size_t before = this->sink_.count();
    const size_t resultsBefore = this->sink_.resultCount();
    this->harness_->advance(this->harness_->cycleMs() * 4);
    EXPECT_EQ(this->sink_.count(), before);
    EXPECT_EQ(this->sink_.resultCount(), resultsBefore);
}

// 7
TYPED_TEST_P(DriverConformance, DiagnosticsMatchTheInjectedFaults) {
    if (!this->harness_->supportsDiagnostics()) return;
    this->harness_->advance(this->harness_->cycleMs() * 2);
    DriverDiag before;
    this->harness_->driver().diagnostics(before, 0);
    this->harness_->injectTimeouts(3);
    this->harness_->advance(this->harness_->cycleMs() * 8 + 12000);
    DriverDiag after;
    this->harness_->driver().diagnostics(after, 0);
    ASSERT_FALSE(after.devices.empty());
    EXPECT_EQ(after.devices[0].timeouts - before.devices[0].timeouts, 3u);
}

REGISTER_TYPED_TEST_SUITE_P(DriverConformance, NoValueBeforeTheFirstRead, ValuesMatchTheBackend,
                            DeadBackendGivesBadWithReasonThenRecovers, WritesEndInAResult,
                            DisabledChannelHasNoTraffic, NothingIsPublishedAfterStop,
                            DiagnosticsMatchTheInjectedFaults);

}  // namespace mat::drv::conformance
