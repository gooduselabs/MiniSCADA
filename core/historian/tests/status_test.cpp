// Block `historian` of GET /api/v1/system/info (specs/003-data-logging/contracts/system-info.md).
// The page is public (no login yet): it must never carry a host, user, database, URL or secret.
#include "core/historian/status.hpp"

#include <gtest/gtest.h>
#include <stdlib.h>

#include "core/historian/historian.hpp"

using namespace mat;
using nlohmann::json;

namespace {

constexpr int64_t kT0 = 1791594000000;

HistorianInfoInput enabledInput() {
    HistorianInfoInput in;
    in.enabled = true;
    in.groups = 2;
    in.commitMs = 5000;
    in.warnings = {"W_LOG_SIZE_CAP"};
    return in;
}

// Every string value of a JSON document (keys included).
void strings(const json& j, std::vector<std::string>& out) {
    if (j.is_string()) out.push_back(j.get<std::string>());
    if (j.is_object())
        for (auto it = j.begin(); it != j.end(); ++it) {
            out.push_back(it.key());
            strings(it.value(), out);
        }
    if (j.is_array())
        for (const auto& v : j) strings(v, out);
}

}  // namespace

TEST(HistorianInfo, DisabledIsOneField) {
    EXPECT_EQ(historianInfoJson(HistorianInfoInput{}, HistorianStatus{}),
              json({{"enabled", false}}));
}

TEST(HistorianInfo, FieldsAndTypesOfTheContract) {
    HistorianStatus s;
    s.rowsWritten = 15234;
    s.dbBytes = 12582912;
    s.dbMaxBytes = 2147483648LL;
    s.freeBytes = 5368709120LL;
    s.lastCommitAt = 1791601205000;
    s.lastRetentionAt = 1791601200000;
    s.lastRetentionRows = 120;
    DestStatus ok;
    ok.id = "mysql-office";
    ok.type = "mysql";
    ok.state = DestState::Ok;
    ok.sentRows = 15100;
    ok.outOfRangeValues = 2;
    ok.lastOkAt = 1791601205100;
    DestStatus bad;
    bad.id = "influx";
    bad.type = "influxdb";
    bad.state = DestState::Error;
    bad.pendingRows = 1834;
    bad.lagS = 1830;
    bad.lastError = ErrorClass::Connect;
    bad.lastErrorAt = 1791601204000;
    s.destinations = {ok, bad};

    const json j = historianInfoJson(enabledInput(), s);
    EXPECT_EQ(j["enabled"], true);
    EXPECT_EQ(j["state"], "running");
    EXPECT_EQ(j["clock"], "ok");
    EXPECT_EQ(j["clockJumps"], 0);
    EXPECT_EQ(j["groups"], 2);
    EXPECT_EQ(j["rowsWritten"], 15234);
    EXPECT_EQ(j["rowsDropped"], 0);
    EXPECT_EQ(j["stringsTruncated"], 0);
    EXPECT_EQ(j["dbBytes"], 12582912);
    EXPECT_EQ(j["dbMaxBytes"], 2147483648LL);
    EXPECT_EQ(j["freeBytes"], 5368709120LL);
    EXPECT_EQ(j["commitMs"], 5000);
    EXPECT_EQ(j["lastCommitAt"], 1791601205000);
    EXPECT_EQ(j["lastRetention"], json({{"at", 1791601200000}, {"rowsDeleted", 120}}));
    EXPECT_EQ(j["capPurges"], 0);
    EXPECT_EQ(j["capRowsDeleted"], 0);
    EXPECT_EQ(j["warnings"], json({"W_LOG_SIZE_CAP"}));
    EXPECT_TRUE(j["lastError"].is_null());
    ASSERT_EQ(j["destinations"].size(), 2u);
    EXPECT_EQ(j["destinations"][0], json({{"id", "mysql-office"},
                                          {"type", "mysql"},
                                          {"state", "ok"},
                                          {"pendingRows", 0},
                                          {"lagS", 0},
                                          {"sentRows", 15100},
                                          {"lostRows", 0},
                                          {"outOfRangeValues", 2},
                                          {"rejectedRows", 0},
                                          {"lastOkAt", 1791601205100},
                                          {"lastError", nullptr}}));
    const json& e = j["destinations"][1];
    EXPECT_EQ(e["state"], "error");
    EXPECT_TRUE(e["lastOkAt"].is_null());
    EXPECT_EQ(e["lastError"], json({{"code", "connect"},
                                    {"dbCode", nullptr},
                                    {"message", "Không kết nối được máy chủ"},
                                    {"at", 1791601204000}}));
}

TEST(HistorianInfo, NothingYetIsNullAndErrorsHaveFixedSentences) {
    HistorianStatus s;
    s.freeBytes = -1;
    s.state = HistorianState::PausedLowDisk;
    s.lastErrorCode = "disk_full";
    s.lastErrorMessage = "database or disk is full: /var/lib/mat-runtime/history.db";
    s.lastErrorAt = kT0;
    const json j = historianInfoJson(enabledInput(), s);
    EXPECT_EQ(j["state"], "paused_low_disk");
    EXPECT_TRUE(j["freeBytes"].is_null());
    EXPECT_TRUE(j["lastCommitAt"].is_null());
    EXPECT_TRUE(j["lastRetention"].is_null());
    EXPECT_EQ(j["lastError"], json({{"code", "disk_full"},
                                    {"message", "Hết dung lượng khi ghi dữ liệu lưu trữ"},
                                    {"at", kT0}}));
    // the start failed (directory, history.db): state error, lastError io
    HistorianInfoInput in = enabledInput();
    in.startError = "không tạo được thư mục dữ liệu /var/lib/mat-runtime";
    const json f = historianInfoJson(in, HistorianStatus{});
    EXPECT_EQ(f["state"], "error");
    EXPECT_EQ(f["lastError"]["code"], "io");
    EXPECT_EQ(f.dump().find("/var/lib"), std::string::npos);
}

// End to end: a historian with a connection whose server rejects us, with the host, user,
// database, URL and the secret in the raw error. None of them reaches the JSON (SC-010).
TEST(HistorianInfo, NoConnectionDetailOrSecretLeaks) {
    char tmpl[] = "/tmp/mat-status-XXXXXX";
    const std::string dir = mkdtemp(tmpl);
    TagStore tags;
    tags.add({"T.V", TagType::FLOAT64, ""});
    LoggingModel m;
    LoggingGroupModel g;
    g.id = "g";
    g.name = "G";
    g.table = "g";
    g.periodMs = 1000;
    g.retentionDays = 7;
    g.destinations = {"office"};
    g.columns.push_back({"T.V", 0, TagType::FLOAT64, "V", 0, 255});
    m.groups.push_back(g);
    ConnectionModel c;
    c.id = "office";
    c.type = DbType::MySql;
    c.host = "db-secret-host.example";
    c.user = "scada_writer_x";
    c.database = "plant_secret_db";
    c.url = "https://influx-secret.example:8086";
    m.connections.push_back(c);

    class Rejecting : public Destination {
       public:
        bool transactional() const override { return true; }
        size_t batchRows(const DestTable&) const override { return 10; }
        bool connect(const std::string& secret, DestError& err) override {
            err.cls = ErrorClass::Auth;
            err.dbCode = "1045";
            err.detail =
                "Access denied for user 'scada_writer_x'@'db-secret-host.example' to "
                "database 'plant_secret_db' at https://influx-secret.example:8086 using " +
                secret;
            return false;
        }
        bool syncSchema(const std::string&, const std::vector<DestTable>&, DestError&) override {
            return true;
        }
        bool readCursor(const std::string&, const std::string&, int64_t&, DestError&) override {
            return true;
        }
        bool writeBatch(const std::string&, const DestTable&, const std::vector<StoredRow>&,
                        int64_t, int64_t, DestError&) override {
            return true;
        }
        void close() override {}
    };

    HistorianOptions o;
    o.dataDir = dir;
    o.clockFloorMs = kT0 - 86400000;
    o.secret = [](const std::string&) {
        SecretResult r;
        r.ok = true;
        r.secret = "S3cr3t-Pw-123";
        return r;
    };
    o.makeDestination = [](const ConnectionModel&) -> std::unique_ptr<Destination> {
        return std::make_unique<Rejecting>();
    };
    int64_t wall = kT0, mono = 0;
    Historian h(
        m, tags, o, [&] { return wall; }, [&] { return mono; });
    std::string err;
    ASSERT_TRUE(h.open(err)) << err;
    h.forwardersForTest()[0]->runOnce();

    HistorianInfoInput in = enabledInput();
    const json j = historianInfoJson(in, h.status());
    ASSERT_EQ(j["destinations"].size(), 1u);
    EXPECT_EQ(j["destinations"][0]["lastError"]["code"], "auth");
    EXPECT_EQ(j["destinations"][0]["lastError"]["dbCode"], "1045");
    std::vector<std::string> all;
    strings(j, all);
    for (const auto& v : all)
        for (const char* secret : {"db-secret-host", "scada_writer_x", "plant_secret_db",
                                   "influx-secret", "S3cr3t-Pw-123", "Access denied"})
            EXPECT_EQ(v.find(secret), std::string::npos) << "'" << secret << "' in '" << v << "'";
}

// Feature 010 (device-010.md §1): groupsInfo, query, aggregates and io; never a table, path or secret.
TEST(HistorianInfo010, TheNewBlocksAreThereAndCarryNoNamesOfTablesOrPaths) {
    HistorianStatus s;
    s.schema = 2;
    s.aggEnabled = true;
    s.aggGroups = 1;
    s.aggRowsMinute = 288000;
    s.aggRowsHour = 4800;
    s.backfillActive = true;
    s.backfillGroup = "ap-suat";
    s.backfillProgress = 0.25;
    s.capRowsDeletedMinute = 7;
    HistorianStatus::GroupInfo gi;
    gi.id = "ap-suat";
    gi.mode = "onChange";
    gi.rows24h = 18234;
    gi.aggregates = true;
    s.groups.push_back(gi);
    HistorianStatus::GroupInfo tr;
    tr.id = "me-tron";
    tr.mode = "trigger";
    tr.triggerState = "active";
    s.groups.push_back(tr);
    s.io.writeBytes24h = 540000000;
    s.io.coverageS = 86400;
    s.io.bytesPerDay = 540000000;
    HistorianInfoInput in = enabledInput();
    in.estimateBytesPerDay = 565002240;
    HistoryQueryInfo q;
    q.served = 12;
    q.rejectedBusy = 3;
    q.p95Ms = 85;
    q.lastErrorCode = "QUERY_TIMEOUT";
    q.lastErrorAt = 99;
    in.query = q;
    const json j = historianInfoJson(in, s);
    ASSERT_EQ(j["groupsInfo"].size(), 2u);
    EXPECT_EQ(j["groupsInfo"][0]["rows24h"], 18234);
    EXPECT_TRUE(j["groupsInfo"][0]["triggerState"].is_null());
    EXPECT_EQ(j["groupsInfo"][1]["triggerState"], "active");
    EXPECT_EQ(j["aggregates"]["schema"], 2);
    EXPECT_EQ(j["aggregates"]["rows"]["minute"], 288000);
    EXPECT_TRUE(j["aggregates"]["backfill"]["active"].get<bool>());
    EXPECT_EQ(j["aggregates"]["capRowsDeleted"]["minute"], 7);
    EXPECT_EQ(j["query"]["p95Ms"], 85);
    EXPECT_EQ(j["query"]["lastError"]["code"], "QUERY_TIMEOUT");
    EXPECT_EQ(j["io"]["source"], "proc-self-io");
    EXPECT_EQ(j["io"]["bytesPerDay"], 540000000);
    EXPECT_EQ(j["io"]["estimateBytesPerDay"], 565002240);
    EXPECT_EQ(j["io"]["budgetBytesPerDay"], 2147483648LL);
    std::vector<std::string> all;
    strings(j, all);
    for (const auto& t : all)
        for (const char* leak : {"log_", "/var/", "/tmp", "history.db", "mat_agg"})
            EXPECT_EQ(t.find(leak), std::string::npos) << t;
}

TEST(HistorianInfo010, WithoutTheMeterOrTheApiTheKeysAreNullOrAbsent) {
    HistorianStatus s;
    s.io.available = false;
    const json j = historianInfoJson(enabledInput(), s);
    EXPECT_EQ(j["io"]["source"], "unavailable");
    EXPECT_TRUE(j["io"]["writeBytes24h"].is_null());
    EXPECT_TRUE(j["io"]["bytesPerDay"].is_null());
    EXPECT_TRUE(j["io"]["estimateBytesPerDay"].is_null());
    EXPECT_FALSE(j.contains("query"));
    EXPECT_FALSE(j["aggregates"]["enabled"].get<bool>());
    EXPECT_TRUE(j["aggregates"]["rows"]["minute"].is_null());
}
