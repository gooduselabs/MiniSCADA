// The S7 driver on a fake PLC and clock (feature 016 T012; contracts/s7-driver.md): connection and
// PDU negotiation, every type, multi-item requests within the PDU, item and header errors,
// splitting, timeouts and reconnection, stale and fragmented answers, writes with readback, and the
// standard driver suite of the SDK.
#include "drivers/s7/s7_driver.hpp"

#include <gtest/gtest.h>

#include <cstring>

#include "drivers/s7/tests/fake_s7.hpp"
#include "drivers/sdk/tests/driver_conformance.hpp"

using namespace mat;
using namespace mat::testing;
using drv::S7Config;
using drv::S7Driver;
using drv::S7TagBinding;

namespace {

S7TagBinding bind(size_t tag, const std::string& address, TagType raw, int stringLength = 0,
                  drv::ScanGroup group = drv::ScanGroup::Normal, bool rw = false) {
    S7TagBinding b;
    b.tag = tag;
    s7::AddressOptions o;
    o.rawType = raw;
    o.stringLength = stringLength;
    o.rw = rw;
    b.addr = s7::parseAddress(address, o);
    EXPECT_TRUE(b.addr.ok) << address << " " << b.addr.error;
    b.stringLength = stringLength;
    b.group = group;
    return b;
}

S7Config baseConfig() {
    S7Config c;
    c.channelId = "s7-1";
    c.host = "127.0.0.1";
    c.deviceId = "cpu1";
    c.timeoutMs = 500;
    return c;
}

s7fake::Bytes be(uint64_t v, int n) {
    s7fake::Bytes b;
    for (int i = n - 1; i >= 0; --i) b.push_back(static_cast<uint8_t>(v >> (8 * i)));
    return b;
}

s7fake::Bytes realBytes(float f) {
    uint32_t u;
    std::memcpy(&u, &f, 4);
    return be(u, 4);
}

s7fake::Bytes lrealBytes(double d) {
    uint64_t u;
    std::memcpy(&u, &d, 8);
    return be(u, 8);
}

// The all-types memory of the simulator map (tools/s7-sim/maps/all-types.json).
void fillAllTypes(s7fake::Plc& plc) {
    plc.mem["DB1"] = s7fake::Bytes(512, 0);
    plc.mem["DB2"] = s7fake::Bytes(64, 0);
    plc.mem["DB3"] = s7fake::Bytes(16, 0);
    plc.mem["M"] = s7fake::Bytes(256, 0);
    plc.mem["I"] = s7fake::Bytes(16, 0);
    plc.mem["Q"] = s7fake::Bytes(16, 0);
    plc.denied.insert("DB3");
    plc.set("DB1", 0, {0x01});
    plc.set("DB1", 1, {200});
    plc.set("DB1", 2, be(static_cast<uint16_t>(-1234), 2));
    plc.set("DB1", 4, be(64302, 2));
    plc.set("DB1", 6, be(static_cast<uint32_t>(-100000), 4));
    plc.set("DB1", 10, be(4000000000u, 4));
    plc.set("DB1", 14, realBytes(123.456f));
    plc.set("DB1", 18, lrealBytes(3.141592653589793));
    plc.set("DB1", 26, {'A', 'O', 'K', 0, 0});
    plc.set("DB1", 32, {20, 5, 'B', 'o', 'm', ' ', '1'});
    plc.set("DB1", 70, {10, 0});
    plc.set("DB2", 0, be(42, 2));
    plc.set("M", 0, {0x02});
    plc.set("M", 10, be(4660, 2));
    plc.set("M", 20, realBytes(-1.5f));
    plc.set("I", 0, {0x02});
    plc.set("I", 2, be(100, 2));
    plc.set("Q", 0, {0x01});
    plc.set("Q", 1, {7});
}

std::vector<S7TagBinding> allTypes() {
    return {
        bind(0, "DB1.DBX0.0", TagType::BOOL),      bind(1, "DB1.DBX0.5", TagType::BOOL),
        bind(2, "DB1.DBB1", TagType::UINT16),      bind(3, "DB1.DBW2", TagType::INT16),
        bind(4, "DB1.DBW4", TagType::UINT16),      bind(5, "DB1.DBD6", TagType::INT32),
        bind(6, "DB1.DBD10", TagType::UINT32),     bind(7, "DB1.DBD14", TagType::FLOAT32),
        bind(8, "DB1.LREAL18", TagType::FLOAT64),  bind(9, "DB1.DBB26", TagType::STRING, 1),
        bind(10, "DB1.DBB27", TagType::STRING, 4), bind(11, "DB1.STRING32", TagType::STRING, 20),
        bind(12, "DB2.DBW0", TagType::INT16),      bind(13, "M0.1", TagType::BOOL),
        bind(14, "MW10", TagType::UINT16),         bind(15, "MD20", TagType::FLOAT32),
        bind(16, "E0.1", TagType::BOOL),           bind(17, "IW2", TagType::INT16),
        bind(18, "Q0.0", TagType::BOOL),           bind(19, "AB1", TagType::UINT16),
    };
}

const std::vector<TagScalar> kAllTypesValues = {
    true,
    false,
    uint64_t{200},
    int64_t{-1234},
    uint64_t{64302},
    int64_t{-100000},
    uint64_t{4000000000u},
    static_cast<double>(123.456f),
    3.141592653589793,
    std::string("A"),
    std::string("OK"),
    std::string("Bom 1"),
    int64_t{42},
    true,
    uint64_t{4660},
    -1.5,
    true,
    int64_t{100},
    true,
    uint64_t{7},
};

struct Rig {
    explicit Rig(S7Config c) : cfg(std::move(c)) {
        drv::S7Env env;
        env.manual = true;
        env.clock = &clock;
        env.uniform = [] { return 0.0; };
        env.firstRef = [] { return static_cast<uint16_t>(100); };
        env.sleep = [this](int64_t t) { clock.set(t); };
        env.makeTransport = [this] {
            return std::unique_ptr<drv::Transport>(new s7fake::Transport(plc, clock));
        };
        drv = std::make_unique<S7Driver>(cfg, env);
    }
    ~Rig() { drv->stop(); }
    void start() { drv->start(sink); }
    void run(int64_t ms) { drv->pump(clock.monoMs() + ms); }
    drv::DriverDiag diag() const {
        drv::DriverDiag d;
        drv->diagnostics(d, clock.monoMs());
        return d;
    }
    std::optional<drv::TagUpdate> last(size_t t) { return sink.last(t); }
    std::string reason(size_t t) {
        auto u = last(t);
        return u ? u->reason : "<none>";
    }
    bool good(size_t t) {
        auto u = last(t);
        return u && u->quality == Quality::GOOD;
    }
    drv::WriteResult write(size_t tag, TagScalar raw, bool readback = true) {
        drv::WriteCommand c;
        c.id = ++ids;
        c.tag = tag;
        c.raw = std::move(raw);
        c.readback = readback;
        const size_t before = sink.resultCount();
        EXPECT_TRUE(drv->enqueueWrite(c));
        run(500);
        auto rs = sink.takeResults();
        EXPECT_EQ(rs.size(), before + 1);
        return rs.empty() ? drv::WriteResult{} : rs.back();
    }

    s7fake::Clock clock;
    s7fake::Plc plc;
    drv::conformance::RecordingSink sink;
    S7Config cfg;
    std::unique_ptr<S7Driver> drv;
    uint64_t ids = 0;
};

S7Config allTypesConfig() {
    S7Config c = baseConfig();
    c.tags = allTypes();
    return c;
}

}  // namespace

TEST(S7Driver, ConnectsNegotiatesAndReadsEveryType) {
    Rig r(allTypesConfig());
    fillAllTypes(r.plc);
    r.start();
    r.run(1500);
    EXPECT_EQ(r.plc.connections, 1);
    EXPECT_EQ(r.drv->negotiatedPdu(), 480);
    for (size_t t = 0; t < kAllTypesValues.size(); ++t) {
        auto u = r.last(t);
        ASSERT_TRUE(u.has_value()) << t;
        EXPECT_EQ(u->quality, Quality::GOOD) << t << " " << u->reason;
        EXPECT_EQ(u->value, kAllTypesValues[t]) << t;
    }
    // DB1, DB2, M, I, Q: five items in one request per round
    ASSERT_GE(r.plc.count(0x04), 1);
    for (const auto& q : r.plc.requests)
        if (q.fn == 0x04) EXPECT_EQ(q.items, 5);
    const auto d = r.diag();
    EXPECT_EQ(d.channel.state, "connected");
    ASSERT_EQ(d.channel.details.size(), 3u);
    EXPECT_EQ(d.channel.details[0], std::make_pair(std::string("pduSize"), std::string("480")));
    EXPECT_EQ(d.channel.details[2].second, "0101");
    EXPECT_GT(d.devices[0].requestsOk, 0u);
}

TEST(S7Driver, UsesTheSmallerPduOfThePlc) {
    S7Config c = baseConfig();
    c.pduSize = 960;
    // 60 Tags of 8 bytes, 40 bytes apart: one item each, many items per request
    for (size_t i = 0; i < 60; ++i)
        c.tags.push_back(bind(i, "DB1.LREAL" + std::to_string(i * 40), TagType::FLOAT64));
    Rig r(c);
    r.plc.mem["DB1"] = s7fake::Bytes(4096, 0);
    r.plc.pduMax = 240;
    r.start();
    r.run(1500);
    EXPECT_EQ(r.drv->negotiatedPdu(), 240);
    for (size_t t = 0; t < 60; ++t) EXPECT_TRUE(r.good(t)) << t << " " << r.reason(t);
    EXPECT_LE(r.plc.maxRequestPdu, 240u);
    EXPECT_LE(r.plc.maxResponsePdu, 240u);
    EXPECT_GT(r.plc.count(0x04), 1);
}

TEST(S7Driver, TwentyItemsAtMostPerRequest) {
    S7Config c = baseConfig();
    c.maxGapBytes = 0;
    for (size_t i = 0; i < 45; ++i)
        c.tags.push_back(bind(i, "DB1.DBW" + std::to_string(i * 10), TagType::INT16));
    Rig r(c);
    r.plc.mem["DB1"] = s7fake::Bytes(1024, 0);
    r.start();
    r.run(900);
    int reads = 0;
    for (const auto& q : r.plc.requests)
        if (q.fn == 0x04) {
            EXPECT_LE(q.items, 20);
            ++reads;
        }
    EXPECT_EQ(reads, 3);  // 20 + 20 + 5
}

TEST(S7Driver, ItemErrorsOnlyHitTheirTags) {
    S7Config c = allTypesConfig();
    c.tags.push_back(bind(20, "DB3.DBW0", TagType::INT16));
    c.tags.push_back(bind(21, "DB9.DBW0", TagType::INT16));
    c.tags.push_back(bind(22, "DB2.DBW100", TagType::INT16));
    Rig r(c);
    fillAllTypes(r.plc);
    r.start();
    r.run(2500);
    EXPECT_EQ(r.reason(20), "S7_ACCESS_DENIED");
    EXPECT_EQ(r.reason(21), "S7_OBJECT_NOT_FOUND");
    EXPECT_EQ(r.reason(22), "S7_ADDRESS_OUT_OF_RANGE");
    for (size_t t = 0; t < kAllTypesValues.size(); ++t) EXPECT_TRUE(r.good(t)) << t;
    const auto d = r.diag();
    EXPECT_GT(d.devices[0].exceptions.at(0x03), 0u);
    EXPECT_GT(d.devices[0].exceptions.at(0x0A), 0u);
    EXPECT_EQ(r.plc.connections, 1);  // an item error keeps the connection
}

TEST(S7Driver, OutOfRangeSplitsAMergedItem) {
    S7Config c = baseConfig();
    c.maxGapBytes = 200;
    c.tags = {bind(0, "DB2.DBW0", TagType::INT16), bind(1, "DB2.DBW100", TagType::INT16)};
    Rig r(c);
    r.plc.mem["DB2"] = s7fake::Bytes(64, 0);
    r.plc.set("DB2", 0, be(42, 2));
    r.start();
    r.run(3500);
    EXPECT_TRUE(r.good(0)) << r.reason(0);
    EXPECT_EQ(r.last(0)->value, TagScalar(int64_t{42}));
    EXPECT_EQ(r.reason(1), "S7_ADDRESS_OUT_OF_RANGE");
}

TEST(S7Driver, PutGetDisabledIsAHeaderError) {
    Rig r(allTypesConfig());
    fillAllTypes(r.plc);
    r.plc.putGetDisabled = true;
    r.start();
    r.run(1500);
    for (size_t t = 0; t < kAllTypesValues.size(); ++t)
        EXPECT_EQ(r.reason(t), "S7_FUNCTION_NOT_AVAILABLE") << t;
    const auto d = r.diag();
    EXPECT_EQ(d.channel.lastErrorCode, "S7_FUNCTION_NOT_AVAILABLE");
    EXPECT_GT(d.devices[0].exceptions.at(0x8104), 0u);
    r.plc.putGetDisabled = false;
    r.run(1000);
    for (size_t t = 0; t < kAllTypesValues.size(); ++t) EXPECT_TRUE(r.good(t)) << t;
}

TEST(S7Driver, RejectedConnectionAndRefusal) {
    Rig r(allTypesConfig());
    fillAllTypes(r.plc);
    r.plc.rejectCr = true;
    r.start();
    r.run(500);
    EXPECT_EQ(r.reason(0), "S7_CONNECT_REJECTED");
    EXPECT_EQ(r.diag().channel.lastErrorCode, "S7_CONNECT_REJECTED");
    EXPECT_EQ(r.drv->linkState(0).channel, drv::ChannelState::Error);
    r.plc.rejectCr = false;
    r.plc.refuse = true;
    r.run(3000);
    EXPECT_EQ(r.reason(0), "REFUSED");
    r.plc.refuse = false;
    r.run(15000);
    EXPECT_TRUE(r.good(0)) << r.reason(0);
}

TEST(S7Driver, TimeoutClosesAndReconnects) {
    Rig r(allTypesConfig());
    fillAllTypes(r.plc);
    r.start();
    r.run(1500);
    r.plc.silent = 1;
    r.run(1000);
    EXPECT_EQ(r.reason(0), "TIMEOUT");
    EXPECT_EQ(r.diag().devices[0].timeouts, 1u);
    r.run(3000);
    EXPECT_TRUE(r.good(0)) << r.reason(0);
    EXPECT_EQ(r.plc.connections, 2);
    EXPECT_EQ(r.diag().channel.reconnects, 1u);
}

TEST(S7Driver, RetriesBeforeGivingUp) {
    S7Config c = allTypesConfig();
    c.retries = 1;
    Rig r(c);
    fillAllTypes(r.plc);
    r.start();
    r.run(1500);
    r.plc.silent = 1;  // the second try answers
    r.run(2000);
    EXPECT_TRUE(r.good(0)) << r.reason(0);
    EXPECT_EQ(r.plc.connections, 1);
    EXPECT_EQ(r.diag().devices[0].timeouts, 1u);
}

TEST(S7Driver, ClosedAndGarbageReconnect) {
    Rig r(allTypesConfig());
    fillAllTypes(r.plc);
    r.start();
    r.run(1500);
    r.plc.closeNext = 1;
    r.run(1000);
    EXPECT_EQ(r.reason(0), "DISCONNECTED");
    r.run(3000);
    EXPECT_TRUE(r.good(0));
    r.plc.garbageNext = 1;
    r.run(1000);
    EXPECT_EQ(r.reason(0), "BAD_FRAME");
    EXPECT_EQ(r.diag().channel.lastErrorCode, "BAD_FRAME");
    r.run(5000);
    EXPECT_TRUE(r.good(0));
    EXPECT_EQ(r.plc.connections, 3);
}

TEST(S7Driver, StaleAndFragmentedAnswers) {
    Rig r(allTypesConfig());
    fillAllTypes(r.plc);
    r.plc.staleNext = 2;
    r.plc.fragmentNext = 2;
    r.start();
    r.run(2500);
    for (size_t t = 0; t < kAllTypesValues.size(); ++t) EXPECT_TRUE(r.good(t)) << t;
    EXPECT_EQ(r.diag().devices[0].badFrames.tid, 2u);
    EXPECT_EQ(r.plc.connections, 1);
}

TEST(S7Driver, TagLargerThanTheNegotiatedPdu) {
    S7Config c = baseConfig();
    c.pduSize = 480;
    c.tags = {bind(0, "DB1.STRING0", TagType::STRING, 240), bind(1, "DB1.DBW300", TagType::INT16)};
    Rig r(c);
    r.plc.mem["DB1"] = s7fake::Bytes(512, 0);
    r.plc.pduMax = 240;
    r.start();
    r.run(1500);
    EXPECT_EQ(r.reason(0), "S7_PDU_TOO_SMALL");
    EXPECT_TRUE(r.good(1));
}

TEST(S7Driver, DisabledChannelHasNoTraffic) {
    S7Config c = allTypesConfig();
    c.enabled = false;
    Rig r(c);
    r.start();
    r.run(3000);
    EXPECT_EQ(r.plc.connectAttempts, 0);
    EXPECT_EQ(r.reason(0), "DISABLED");
    S7Config d = allTypesConfig();
    d.deviceEnabled = false;
    Rig r2(d);
    r2.start();
    r2.run(3000);
    EXPECT_EQ(r2.plc.connectAttempts, 0);
    EXPECT_EQ(r2.reason(5), "DISABLED");
}

TEST(S7Driver, WritesEveryTypeWithReadback) {
    S7Config c = baseConfig();
    c.tags = {
        bind(0, "DB1.DBX60.0", TagType::BOOL, 0, drv::ScanGroup::Normal, true),
        bind(1, "DB1.DBW62", TagType::INT16, 0, drv::ScanGroup::Normal, true),
        bind(2, "DB1.DBD64", TagType::FLOAT32, 0, drv::ScanGroup::Normal, true),
        bind(3, "DB1.STRING70", TagType::STRING, 10, drv::ScanGroup::Normal, true),
        bind(4, "DB1.DBB84", TagType::UINT16, 0, drv::ScanGroup::Normal, true),
        bind(5, "DB1.LREAL90", TagType::FLOAT64, 0, drv::ScanGroup::Normal, true),
        bind(6, "DB1.DBB100", TagType::STRING, 3, drv::ScanGroup::Normal, true),
        bind(7, "Q0.3", TagType::BOOL, 0, drv::ScanGroup::Normal, true),
        bind(8, "MD8", TagType::UINT32, 0, drv::ScanGroup::Normal, true),
    };
    Rig r(c);
    fillAllTypes(r.plc);
    r.plc.set("DB1", 70, {10, 0});
    r.start();
    r.run(1500);
    auto ok = [&](size_t t, TagScalar v) {
        const auto res = r.write(t, v);
        EXPECT_EQ(res.code, "CONFIRMED") << t;
        EXPECT_EQ(res.status, drv::WriteStatus::Confirmed) << t;
        EXPECT_EQ(res.readback, v) << t;
        bool after = false;  // the readback is published as such (a later round may follow it)
        {
            std::lock_guard<std::mutex> g(r.sink.mu);
            for (const auto& u : r.sink.all)
                if (u.tag == t && u.afterWrite && u.value == v) after = true;
        }
        EXPECT_TRUE(after) << t;
    };
    ok(0, true);
    EXPECT_EQ(r.plc.get("DB1", 60, 1)[0], 0x01);
    ok(1, int64_t{-2});
    EXPECT_EQ(r.plc.get("DB1", 62, 2), (s7fake::Bytes{0xFF, 0xFE}));
    ok(2, 1.5);
    EXPECT_EQ(r.plc.get("DB1", 64, 4), realBytes(1.5f));
    ok(3, std::string("Van 2"));
    EXPECT_EQ(r.plc.get("DB1", 70, 7), (s7fake::Bytes{10, 5, 'V', 'a', 'n', ' ', '2'}));
    ok(4, uint64_t{255});
    ok(5, 2.5);
    ok(6, std::string("ab"));
    EXPECT_EQ(r.plc.get("DB1", 100, 3), (s7fake::Bytes{'a', 'b', 0}));
    ok(7, true);
    EXPECT_EQ(r.plc.get("Q", 0, 1)[0], 0x09);  // Q0.0 stays on, Q0.3 set
    ok(8, uint64_t{4000000000u});
    const auto d = r.diag();
    EXPECT_EQ(d.devices[0].writes.confirmed, 9u);
}

TEST(S7Driver, WriteResults) {
    S7Config c = baseConfig();
    c.tags = {bind(0, "DB1.DBW62", TagType::INT16, 0, drv::ScanGroup::Normal, true),
              bind(1, "DB3.DBW0", TagType::INT16, 0, drv::ScanGroup::Normal, true),
              bind(2, "DB1.STRING70", TagType::STRING, 10, drv::ScanGroup::Normal, true)};
    Rig r(c);
    fillAllTypes(r.plc);
    r.start();
    r.run(1500);
    auto res = r.write(1, int64_t{5});
    EXPECT_EQ(res.code, "DEVICE_EXCEPTION");
    EXPECT_EQ(res.exception, 3);
    res = r.write(2, std::string("Bơm"));  // not Latin-1
    EXPECT_EQ(res.code, "NOT_SENT_UNSUPPORTED");
    res = r.write(0, int64_t{40000});  // outside INT
    EXPECT_EQ(res.code, "NOT_SENT_UNSUPPORTED");
    res = r.write(0, int64_t{7}, false);
    EXPECT_EQ(res.code, "NO_READBACK");
    r.plc.writeError = 0x05;
    res = r.write(0, int64_t{8});
    EXPECT_EQ(res.code, "DEVICE_EXCEPTION");
    EXPECT_EQ(res.exception, 5);
    r.plc.writeError = 0;
    r.plc.putGetDisabled = true;
    res = r.write(0, int64_t{9});
    EXPECT_EQ(res.code, "DEVICE_EXCEPTION");
    EXPECT_EQ(res.exception, 0x8104);
    r.plc.putGetDisabled = false;
    r.plc.silent = 1;
    res = r.write(0, int64_t{10});
    EXPECT_EQ(res.code, "WRITE_TIMEOUT");
    EXPECT_EQ(res.status, drv::WriteStatus::Timeout);
    r.run(3000);
    r.plc.silent = 0;
    res = r.write(0, int64_t{11});
    EXPECT_EQ(res.code, "CONFIRMED");
}

TEST(S7Driver, QueuedWritesFailWhenDisconnected) {
    Rig r(allTypesConfig());
    fillAllTypes(r.plc);
    r.plc.refuse = true;
    r.start();
    r.run(100);
    drv::WriteCommand c;
    c.id = 1;
    c.tag = 3;
    c.raw = int64_t{1};
    ASSERT_TRUE(r.drv->enqueueWrite(c));
    r.run(1500);
    const auto rs = r.sink.takeResults();
    ASSERT_EQ(rs.size(), 1u);
    EXPECT_EQ(rs[0].code, "NOT_SENT_DISCONNECTED");
    EXPECT_EQ(r.drv->test({}).code, "NOT_SUPPORTED");
}

// ---- The standard driver suite (drivers/sdk/tests/driver_conformance.hpp) ----------------------

namespace {

class S7Harness : public drv::conformance::Harness {
   public:
    explicit S7Harness(bool enabled = true) {
        S7Config c = baseConfig();
        c.enabled = enabled;
        c.tags = {
            bind(0, "DB1.DBX0.0", TagType::BOOL, 0, drv::ScanGroup::Normal, true),
            bind(1, "DB1.DBW2", TagType::INT16, 0, drv::ScanGroup::Normal, true),
            bind(2, "DB1.DBD10", TagType::UINT32, 0, drv::ScanGroup::Normal, true),
            bind(3, "DB1.DBD14", TagType::FLOAT32, 0, drv::ScanGroup::Normal, true),
            bind(4, "DB1.LREAL18", TagType::FLOAT64, 0, drv::ScanGroup::Normal, true),
            bind(5, "DB1.STRING32", TagType::STRING, 20, drv::ScanGroup::Normal, true),
            bind(6, "M0.1", TagType::BOOL, 0, drv::ScanGroup::Normal, true),
        };
        rig_ = std::make_unique<Rig>(c);
        fillAllTypes(rig_->plc);
    }
    drv::Driver& driver() override { return *rig_->drv; }
    size_t tagCount() const override { return 7; }
    TagType tagType(size_t t) const override { return types_[t]; }
    TagScalar backendValue(size_t t) const override {
        static const std::vector<TagScalar> v = {true,
                                                 int64_t{-1234},
                                                 uint64_t{4000000000u},
                                                 static_cast<double>(123.456f),
                                                 3.141592653589793,
                                                 std::string("Bom 1"),
                                                 true};
        return v[t];
    }
    void advance(int64_t ms) override { rig_->drv->pump(rig_->clock.monoMs() + ms); }
    int64_t cycleMs() const override { return 1000; }
    bool supportsFaults() const override { return true; }
    void setBackendResponding(bool on) override { rig_->plc.responding = on; }
    bool supportsDisabled() const override { return true; }
    std::unique_ptr<drv::conformance::Harness> makeDisabled() override {
        return std::make_unique<S7Harness>(false);
    }
    uint64_t bytesOnWire() const override {
        return rig_->plc.bytesIn + rig_->plc.bytesOut +
               static_cast<uint64_t>(rig_->plc.connectAttempts);
    }
    bool supportsDiagnostics() const override { return true; }
    void injectTimeouts(int count) override { rig_->plc.silent = count; }
    std::vector<size_t> writableTags() const override { return {0, 1, 2, 3, 4, 5, 6}; }
    TagScalar writeValue(size_t t) const override {
        static const std::vector<TagScalar> v = {
            false, int64_t{4321}, uint64_t{123456789}, 1.5, -2.25, std::string("Van 2"), false};
        return v[t];
    }

   private:
    std::unique_ptr<Rig> rig_;
    std::vector<TagType> types_ = {TagType::BOOL,    TagType::INT16,   TagType::UINT32,
                                   TagType::FLOAT32, TagType::FLOAT64, TagType::STRING,
                                   TagType::BOOL};
};

struct S7Traits {
    static std::unique_ptr<drv::conformance::Harness> make() {
        return std::make_unique<S7Harness>();
    }
};

}  // namespace

namespace mat::drv::conformance {
using S7Types = ::testing::Types<S7Traits>;
INSTANTIATE_TYPED_TEST_SUITE_P(S7, DriverConformance, S7Types);
}  // namespace mat::drv::conformance
