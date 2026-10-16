// T114 (feature 009, US6 scenarios 5 and 6; FR-041, FR-043): what the runtime does when its files
// fail. A damaged alarm.db at start-up is renamed and a new one made (audit alarm.purged), and the
// alarms are evaluated afresh from the conditions; a disk nearly full pauses the LOG (logState
// paused) and not the display or the acknowledgements, and the log goes on when there is room;
// audit.db that cannot be written means no acknowledgement (503) and no change.
#include <dirent.h>
#include <gtest/gtest.h>

#include <atomic>
#include <fstream>

#include "server/tests/alarm_rig.hpp"

using namespace mat;
using namespace mat::test;
using nlohmann::json;

namespace {

std::vector<std::string> corruptFiles(const std::string& dir) {
    std::vector<std::string> out;
    if (DIR* d = opendir(dir.c_str())) {
        while (dirent* e = readdir(d)) {
            const std::string n = e->d_name;
            if (n.rfind("alarm.db.corrupt-", 0) == 0) out.push_back(n);
        }
        closedir(d);
    }
    return out;
}

struct Fx : AlarmRig {
    explicit Fx(AlarmWorldOptions o) : AlarmRig(o) { servePage(); }
    HttpResult ack(const std::string& user, const json& body) {
        return postAs(user, "/api/v1/alarms/ack", body.dump());
    }
    // as a signed-in viewer: a guest does not see the account names (M1)
    json history() { return bodyJson(getAs("xem1", "/api/v1/alarms/history?limit=50")); }
    json info() { return world->glue->infoJson(); }
};

}  // namespace

TEST(AlarmRecovery, ADamagedAlarmDbAtStartIsRenamedAndTheAlarmsAreEvaluatedFromTheConditions) {
    AlarmWorldOptions o;
    o.tagsOn = {"P1.FAULT"};  // the fault is on while the runtime starts
    o.prepare = [](const std::string& dir) {
        std::ofstream f(dir + "/alarm.db", std::ios::binary);
        f << std::string(9000, 'x');  // not a database
    };
    Fx f(o);
    // the runtime runs on, with the alarm evaluated afresh: a new occurrence flagged "startup"
    ASSERT_TRUE(
        AlarmWorld::waitFor([&] { return f.world->stateOf("P1_FAULT") == "ACTIVE_UNACK"; }));
    const json list = bodyJson(f.callHttp(getReq("/api/v1/alarms")));
    ASSERT_EQ(list["instances"].size(), 1u);
    EXPECT_EQ(list["instances"][0]["startup"], true);
    // the damaged file is kept under another name, a new one is in its place
    const auto kept = corruptFiles(f.dataDir);
    ASSERT_EQ(kept.size(), 1u) << "alarm.db.corrupt-<epoch>";
    struct stat st {};
    EXPECT_EQ(::stat((f.dataDir + "/alarm.db").c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 07777, 0600u);
    // the audit says so
    const auto purged = f.records("alarm.purged");
    ASSERT_EQ(purged.size(), 1u);
    EXPECT_EQ(purged[0].channel, "system");
    EXPECT_EQ(purged[0].target, std::optional<std::string>("alarm.db"));
    EXPECT_EQ(purged[0].code, std::optional<std::string>("DB_CORRUPT"));
    const json d = json::parse(purged[0].detail.value_or("{}"));
    EXPECT_EQ(d["reason"], "corrupt");
    EXPECT_EQ(d["renamedTo"], kept[0]);
    // system/info tells, and the new log works: the occurrence reaches the history
    EXPECT_EQ(f.info()["recovered"], true);
    EXPECT_EQ(f.info()["logState"], "running");
    ASSERT_TRUE(f.world->glue->service()->flush(3000));
    const json h = f.history();
    ASSERT_EQ(h["items"].size(), 1u) << h.dump();
    EXPECT_EQ(h["items"][0]["alarmId"], "P1_FAULT");
    EXPECT_EQ(h["items"][0]["flags"]["startup"], true);
}

TEST(AlarmRecovery, ADiskNearlyFullPausesTheLogNotTheDisplayNorTheAcknowledgement) {
    std::atomic<int64_t> freeBytes{10LL * 1024 * 1024 * 1024};
    AlarmWorldOptions o;
    o.minFreeBytes = 500LL * 1024 * 1024;
    o.freeBytes = [&freeBytes] { return freeBytes.load(); };
    Fx f(o);
    ASSERT_TRUE(f.world->raise("P1.FAULT", "P1_FAULT"));
    ASSERT_TRUE(f.world->glue->service()->flush(3000));
    ASSERT_EQ(f.history()["items"].size(), 1u);
    EXPECT_EQ(f.info()["logState"], "running");

    freeBytes = 100LL * 1024 * 1024;                      // below minFreeBytes
    ASSERT_TRUE(f.world->raise("P2.FAULT", "P2_FAULT"));  // a change the log should now hold back
    EXPECT_TRUE(AlarmWorld::waitFor([&] { return f.info()["logState"] == "paused"; }, 4000));
    const json sys = bodyJson(f.callHttp(getReq("/api/v1/system/info")));
    bool warned = false;
    for (const auto& w : sys["warnings"]) warned = warned || w == "ALARM_LOG_PAUSED";
    EXPECT_TRUE(warned) << sys["warnings"].dump();
    // the display and the acknowledgement go on
    const json list = bodyJson(f.callHttp(getReq("/api/v1/alarms")));
    EXPECT_EQ(list["instances"].size(), 2u);
    const int64_t occ = f.world->occurrenceOf("P2_FAULT");
    const HttpResult r =
        f.ack("vh1", {{"items", json::array({{{"id", "P2_FAULT"}, {"occurrence", occ}}})}});
    ASSERT_EQ(r.status, 200) << r.body;
    EXPECT_EQ(bodyJson(r)["results"][0]["result"], "ACKED");
    EXPECT_EQ(f.world->stateOf("P2_FAULT"), "ACTIVE_ACK");
    // ... but the history does not grow
    EXPECT_EQ(f.history()["items"].size(), 1u);

    freeBytes = 10LL * 1024 * 1024 * 1024;  // room again
    EXPECT_TRUE(AlarmWorld::waitFor([&] { return f.info()["logState"] == "running"; }, 15000));
    ASSERT_TRUE(f.world->glue->service()->flush(5000));
    const json h = f.history();
    EXPECT_EQ(h["items"].size(), 2u) << "the log caught up with the open occurrences: " << h.dump();
    bool ackedInLog = false;
    for (const auto& x : h["items"])
        if (x["alarmId"] == "P2_FAULT") ackedInLog = x["ackUser"] == "vh1";
    EXPECT_TRUE(ackedInLog);
}

TEST(AlarmRecovery, AnAuditLogThatCannotBeWrittenMeansNoAcknowledgement) {
    AlarmWorldOptions o;
    Fx f(o);
    ASSERT_TRUE(f.world->raise("P1.FAULT", "P1_FAULT"));
    const json body = {
        {"items",
         json::array({{{"id", "P1_FAULT"}, {"occurrence", f.world->occurrenceOf("P1_FAULT")}}})}};
    // 1. the log closed: the gate refuses the operation before the body is looked at
    const std::string token = f.bearer("vh1");  // the sign-in needs the audit: before it closes
    f.audit->close();
    HttpResult r = f.call(postReq("/api/v1/alarms/ack", body.dump(), {token}));
    EXPECT_EQ(r.status, 503) << r.body;
    EXPECT_EQ(bodyJson(r)["error"], "AUDIT_UNAVAILABLE");
    std::this_thread::sleep_for(std::chrono::milliseconds(150));
    EXPECT_EQ(f.world->stateOf("P1_FAULT"), "ACTIVE_UNACK");
    // 2. the log open but a write that fails (the glue's own audit): 503, nothing changed
    std::string err;
    ASSERT_TRUE(f.audit->open(err)) << err;
    f.world->auditFails = true;
    r = f.postAs("vh1", "/api/v1/alarms/ack", body.dump());
    EXPECT_EQ(r.status, 503) << r.body;
    EXPECT_EQ(bodyJson(r)["error"], "AUDIT_UNAVAILABLE");
    std::this_thread::sleep_for(std::chrono::milliseconds(150));
    EXPECT_EQ(f.world->stateOf("P1_FAULT"), "ACTIVE_UNACK");
    // the display and the list never needed the audit
    EXPECT_EQ(f.callHttp(getReq("/api/v1/alarms")).status, 200);
    // the log back: the acknowledgement goes through, with its record
    f.world->auditFails = false;
    r = f.postAs("vh1", "/api/v1/alarms/ack", body.dump());
    ASSERT_EQ(r.status, 200) << r.body;
    EXPECT_EQ(f.world->stateOf("P1_FAULT"), "ACTIVE_ACK");
    EXPECT_EQ(f.records("alarm.ack").size(), 1u);
}
