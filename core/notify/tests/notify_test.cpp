// Feature 023 (specs/023-alarm-email): the pure parts of the alarm email: the message (RFC 2047,
// MIME, HTML escape, dot-stuffing), the configuration (strict check, file), the rules (match,
// batch, reminders, quiet hours, hourly limit, startup) and the durable outbox.
#include <gtest/gtest.h>
#include <stdlib.h>
#include <sys/stat.h>

#include <filesystem>
#include <fstream>
#include <map>
#include <string>

#include "core/notify/email_config.hpp"
#include "core/notify/email_message.hpp"
#include "core/notify/email_outbox.hpp"
#include "core/notify/email_rules.hpp"

using namespace mat::notify;
namespace fs = std::filesystem;

namespace {

struct Tmp {
    std::string path;
    Tmp() {
        std::string t = (fs::temp_directory_path() / "mat-notify-XXXXXX").string();
        path = ::mkdtemp(t.data());
    }
    ~Tmp() { fs::remove_all(path); }
};

std::string unb64(const std::string& s) {
    static const std::string k = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    int val = 0, bits = -8;
    for (char c : s) {
        const size_t p = k.find(c);
        if (p == std::string::npos) continue;
        val = (val << 6) + static_cast<int>(p);
        bits += 6;
        if (bits >= 0) {
            out += static_cast<char>((val >> bits) & 0xFF);
            bits -= 8;
        }
    }
    return out;
}

// Decodes every =?UTF-8?B?..?= word of a header value and joins them.
std::string decodeHeader(const std::string& h) {
    std::string out;
    size_t at = 0;
    while ((at = h.find("=?UTF-8?B?", at)) != std::string::npos) {
        const size_t end = h.find("?=", at + 10);
        out += unb64(h.substr(at + 10, end - at - 10));
        at = end + 2;
    }
    return out;
}

AlarmNotice notice(const std::string& id, const std::string& from, const std::string& to,
                   int priority = 1, int64_t occ = 1) {
    AlarmNotice n;
    n.tEpochMs = 1761375600000;  // 2025-10-25 07:00:00 UTC
    n.instance = id;
    n.occurrence = occ;
    n.from = from;
    n.to = to;
    n.priority = priority;
    n.classId = "process";
    n.className = "Quá trình";
    n.areaId = "bom";
    n.areaName = "Trạm bơm";
    n.name = "Mức bể " + id;
    n.tag = "TANK_LEVEL";
    n.text = "Mức bể cao: 9.5 m";
    n.value = 9.5;
    return n;
}

EmailConfig baseConfig() {
    EmailConfig c;
    c.enabled = true;
    c.smtp.host = "smtp.example.com";
    c.smtp.from = "scada@example.com";
    c.batchSeconds = 30;
    c.maxPerHour = 20;
    EmailRule r;
    r.id = "khan";
    r.priorities = {1, 2};
    r.to = {"Truc.Ca@example.com"};
    c.rules.push_back(r);
    return c;
}

}  // namespace

// ---- message

TEST(EmailMessage, SubjectIsEncodedWordsThatDecodeBack) {
    const std::string s =
        "[Trạm bơm số 1] Khẩn cấp: Mức bể nước thải vượt ngưỡng cao cao HH ở khu xử lý";
    const std::string h = encodeHeader(s);
    EXPECT_EQ(h.find('\n') != std::string::npos, true) << "long subjects are folded";
    std::string line;
    for (size_t at = 0; at < h.size();) {
        size_t nl = h.find("\r\n", at);
        if (nl == std::string::npos) nl = h.size();
        EXPECT_LE(nl - at, 76u) << "each encoded word line stays short";
        at = nl + 2;
    }
    EXPECT_EQ(decodeHeader(h), s) << "never splits a UTF-8 sequence";
    EXPECT_EQ(encodeHeader("Plain subject"), "Plain subject");
    EXPECT_NE(encodeHeader("a=?b"), "a=?b");
    EXPECT_NE(encodeHeader("Bad\r\nBcc: x@example.com").find("=?UTF-8?B?"), std::string::npos)
        << "CR LF never reaches a header raw";
}

TEST(EmailMessage, HtmlEscapesEveryValue) {
    EXPECT_EQ(htmlEscape("<script>\"x\"&'y'</script>"),
              "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
    EmailContent c;
    c.siteName = "<b>Trạm</b>";
    c.baseUrl = "https://192.0.2.10:8443";
    EmailItem i;
    i.priority = 1;
    i.alarmId = "A1";
    i.name = "<img src=x onerror=alert(1)>";
    i.text = "a & b";
    i.state = "ACTIVE_UNACK";
    c.items = {i};
    const RenderedEmail r = renderAlarmEmail(c);
    EXPECT_EQ(r.html.find("<img"), std::string::npos);
    EXPECT_EQ(r.html.find("<b>Trạm</b>"), std::string::npos);
    EXPECT_NE(r.html.find("&lt;img src=x"), std::string::npos);
    EXPECT_NE(r.html.find("href=\"https://192.0.2.10:8443/alarms\""), std::string::npos);
    EXPECT_NE(r.text.find("https://192.0.2.10:8443/alarms"), std::string::npos);
}

TEST(EmailMessage, ContentHasStationTimePriorityTagValueTextState) {
    EmailContent c;
    c.siteName = "Trạm bơm số 1";
    c.tzOffsetMin = 7 * 60;
    EmailItem i;
    i.event = EmailEvent::Active;
    i.tsEpochMs = 1761375600000;
    i.priority = 1;
    i.alarmId = "TANK.HH";
    i.name = "Mức bể";
    i.tag = "TANK_LEVEL";
    i.value = 9.5;
    i.text = "Mức bể cao";
    i.state = "ACTIVE_UNACK";
    c.items = {i};
    const RenderedEmail r = renderAlarmEmail(c);
    EXPECT_EQ(r.subject, "[Trạm bơm số 1] Khẩn cấp: Mức bể");
    for (const char* s : {"Trạm bơm số 1", "2025-10-25 14:00:00 (UTC+07:00)", "Khẩn cấp",
                          "TANK_LEVEL = 9.5", "Mức bể cao", "Đang có, chưa xác nhận", "Xuất hiện"})
        EXPECT_NE(r.text.find(s), std::string::npos) << s;

    c.items.push_back(i);
    c.items.back().priority = 2;
    c.more = 3;
    const RenderedEmail many = renderAlarmEmail(c);
    EXPECT_EQ(many.subject, "[Trạm bơm số 1] 5 sự kiện alarm (1 Khẩn cấp, 1 Quan trọng)");
    EXPECT_NE(many.text.find("và 3 sự kiện khác"), std::string::npos);
}

TEST(EmailMessage, MimeIsUtf8MultipartWithBase64Parts) {
    RenderedEmail b;
    b.subject = "Thử tiếng Việt";
    b.text = "Nội dung\r\n.dòng bắt đầu bằng chấm\r\n";
    b.html = "<p>Nội dung</p>";
    MimeEnvelope e;
    e.from = "scada@example.com";
    e.fromName = "Trạm 1";
    e.to = {"a@example.com", "b@example.com"};
    e.dateEpochMs = 1761375600000;
    e.tzOffsetMin = 420;
    e.messageId = "1.abc@mat-scada";
    e.boundary = "=_mat_abc";
    const std::string m = buildMime(e, b);
    EXPECT_NE(m.find("Date: Sat, 25 Oct 2025 14:00:00 +0700\r\n"), std::string::npos);
    EXPECT_NE(m.find("Content-Type: multipart/alternative; boundary=\"=_mat_abc\""),
              std::string::npos);
    EXPECT_NE(m.find("Content-Type: text/plain; charset=UTF-8"), std::string::npos);
    EXPECT_NE(m.find("Content-Type: text/html; charset=UTF-8"), std::string::npos);
    EXPECT_NE(m.find("To: a@example.com,\r\n b@example.com\r\n"), std::string::npos);
    EXPECT_NE(m.find("Message-ID: <1.abc@mat-scada>"), std::string::npos);
    const size_t subj = m.find("Subject: ");
    EXPECT_EQ(decodeHeader(m.substr(subj, m.find("\r\nDate") - subj)), "Thử tiếng Việt");
    for (size_t at = 0; at < m.size();) {
        const size_t nl = m.find("\r\n", at);
        ASSERT_NE(nl, std::string::npos);
        EXPECT_LE(nl - at, 998u);
        for (size_t i = at; i < nl; ++i)
            EXPECT_LT(static_cast<unsigned char>(m[i]), 0x80) << "7-bit only";
        at = nl + 2;
    }
    const std::string d = smtpData("a\r\n.b\n..c\r\nend");
    EXPECT_EQ(d, "a\r\n..b\r\n...c\r\nend\r\n.\r\n");
}

// ---- configuration

TEST(EmailConfig, StrictCheckAndRoundTrip) {
    const auto j = nlohmann::json::parse(R"({
      "enabled": true, "siteName": "Trạm 1", "baseUrl": "https://192.0.2.10:8443/",
      "smtp": {"host": "smtp.example.com", "port": 465, "security": "smtps", "username": "u",
               "from": "scada@example.com", "pinSha256": "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89"},
      "rules": [{"id": "r1", "priorities": [1], "events": ["active", "reminder"], "reminderMin": 15,
                 "to": ["a@example.com"], "groups": ["ca-truc"]}],
      "quietHours": {"enabled": true, "from": "22:00", "to": "06:00", "minPriority": 1},
      "batchSeconds": 60, "maxPerHour": 10})");
    EmailConfig c;
    std::string err;
    ASSERT_TRUE(parseEmailConfig(j, c, err)) << err;
    EXPECT_EQ(c.baseUrl, "https://192.0.2.10:8443");
    EXPECT_EQ(c.smtp.security, SmtpSecurity::Smtps);
    EXPECT_EQ(c.smtp.pinSha256.size(), 64u);
    EXPECT_EQ(c.smtp.pinSha256.substr(0, 4), "abcd");
    EXPECT_TRUE(c.rules[0].onReminder);
    EXPECT_FALSE(c.rules[0].onReturn);
    EXPECT_TRUE(c.quiet.contains(23 * 60));
    EXPECT_TRUE(c.quiet.contains(5 * 60));
    EXPECT_FALSE(c.quiet.contains(12 * 60));
    EmailConfig back;
    ASSERT_TRUE(parseEmailConfig(emailConfigJson(c), back, err)) << err;
    EXPECT_EQ(emailConfigJson(back), emailConfigJson(c));

    const char* bad[] = {
        R"({"password": "x"})",
        R"({"smtp": {"password": "x"}})",
        R"({"smtp": {"security": "tls"}})",
        R"({"smtp": {"host": "a b"}})",
        R"({"smtp": {"from": "not-an-address"}})",
        R"({"smtp": {"pinSha256": "zz"}})",
        R"({"smtp": {"caFile": "relative.pem"}})",
        R"x({"baseUrl": "javascript:alert(1)"})x",
        R"({"rules": [{"id": "r", "to": []}]})",
        R"({"rules": [{"id": "R!", "to": ["a@example.com"]}]})",
        R"({"rules": [{"id": "r", "to": ["a@example.com"]}, {"id": "r", "to": ["a@example.com"]}]})",
        R"({"rules": [{"id": "r", "to": ["a@example.com\r\nBcc: b@example.com"]}]})",
        R"({"rules": [{"id": "r", "priorities": [5], "to": ["a@example.com"]}]})",
        R"({"rules": [{"id": "r", "events": ["ack"], "to": ["a@example.com"]}]})",
        R"({"quietHours": {"from": "25:00"}})",
        R"({"batchSeconds": 1})",
        R"({"maxPerHour": 1000})",
        R"({"enabled": true})",
        R"({"siteName": "a\nb"})",
    };
    for (const char* b : bad) {
        EmailConfig x;
        EXPECT_FALSE(parseEmailConfig(nlohmann::json::parse(b), x, err)) << b;
        EXPECT_FALSE(err.empty());
    }
}

TEST(EmailConfig, FileIsPrivateAndMissingMeansDefaults) {
    Tmp t;
    const std::string p = t.path + "/notify/email.json";
    EmailConfig c;
    std::string err;
    ASSERT_TRUE(readEmailConfigFile(p, c, err)) << err;
    EXPECT_FALSE(c.enabled);
    EXPECT_EQ(c.rev, 0);
    c = baseConfig();
    c.rev = 4;
    ASSERT_TRUE(writeEmailConfigFile(p, c, err)) << err;
    struct stat st {};
    ASSERT_EQ(::stat(p.c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 0777, 0600u);
    EmailConfig back;
    ASSERT_TRUE(readEmailConfigFile(p, back, err)) << err;
    EXPECT_EQ(back.rev, 4);
    EXPECT_EQ(back.rules.size(), 1u);
    std::ofstream(p) << "{broken";
    EXPECT_FALSE(readEmailConfigFile(p, back, err));
}

// ---- rules

TEST(EmailRules, MatchesPriorityClassAreaAndBatchesInOneEmail) {
    EmailRules r;
    EmailConfig c = baseConfig();
    c.rules[0].classes = {"process"};
    c.rules[0].areas = {"bom", "-"};
    r.configure(c);
    r.onNotice(notice("A", "NORMAL", "ACTIVE_UNACK", 1), 0, 600);
    r.onNotice(notice("B", "NORMAL", "ACTIVE_UNACK", 3), 100, 600);  // minor: no rule
    AlarmNotice other = notice("C", "NORMAL", "ACTIVE_UNACK", 2);
    other.classId = "safety";  // other class: no rule
    r.onNotice(other, 200, 600);
    AlarmNotice chung = notice("D", "NORMAL", "ACTIVE_UNACK", 2);
    chung.areaId = "";  // "-" = Chung
    r.onNotice(chung, 300, 600);
    EXPECT_EQ(r.pending(), 2u);
    EXPECT_TRUE(r.poll(29999, 600, {}).empty()) << "window of 30 s still open";
    const auto d = r.poll(30000, 600, {});
    ASSERT_EQ(d.size(), 1u);
    EXPECT_EQ(d[0].to, std::vector<std::string>{"truc.ca@example.com"});
    ASSERT_EQ(d[0].items.size(), 2u);
    EXPECT_EQ(d[0].items[0].alarmId, "A");
    EXPECT_EQ(d[0].items[1].alarmId, "D");
    EXPECT_EQ(r.pending(), 0u);
}

TEST(EmailRules, ReturnOnlyWhenAskedAndStartupNeverSent) {
    EmailRules r;
    EmailConfig c = baseConfig();
    r.configure(c);
    r.onNotice(notice("A", "ACTIVE_UNACK", "RTN_UNACK"), 0, 600);
    EXPECT_EQ(r.pending(), 0u) << "the rule has no return event";
    c.rules[0].onReturn = true;
    r.configure(c);
    r.onNotice(notice("A", "ACTIVE_ACK", "NORMAL"), 0, 600);
    EXPECT_EQ(r.pending(), 1u);
    AlarmNotice s = notice("B", "NORMAL", "ACTIVE_UNACK");
    s.startup = true;
    r.onNotice(s, 0, 600);
    EXPECT_EQ(r.pending(), 1u) << "a state restored at start is not sent again";
    auto d = r.poll(30000, 600, {});
    ASSERT_EQ(d.size(), 1u);
    EXPECT_EQ(d[0].items[0].event, EmailEvent::Return);
    // The return of an alarm found at start (a device not connected yet) is not told either; a
    // later occurrence is.
    r.onNotice(notice("B", "ACTIVE_UNACK", "RTN_UNACK", 1, 1), 40000, 600);
    EXPECT_EQ(r.pending(), 0u);
    r.onNotice(notice("B", "RTN_UNACK", "ACTIVE_UNACK", 1, 2), 50000, 600);
    EXPECT_EQ(r.pending(), 1u);
}

TEST(EmailRules, GroupsAndAddressesShareEmailsByIdenticalEvents) {
    EmailRules r;
    EmailConfig c = baseConfig();
    c.rules[0].to = {"a@example.com"};
    c.rules[0].groups = {"ca-truc"};
    EmailRule all;
    all.id = "all";
    all.to = {"b@example.com"};
    c.rules.push_back(all);
    r.configure(c);
    r.onNotice(notice("A", "NORMAL", "ACTIVE_UNACK", 1), 0, 600);  // both rules
    r.onNotice(notice("B", "NORMAL", "ACTIVE_UNACK", 4), 0, 600);  // only "all"
    int lookups = 0;
    const auto d = r.poll(30000, 600, [&](const std::string& g) {
        ++lookups;
        EXPECT_EQ(g, "ca-truc");
        return std::vector<std::string>{"C@example.com", "a@example.com"};
    });
    EXPECT_EQ(lookups, 1);
    ASSERT_EQ(d.size(), 2u);
    std::map<std::vector<std::string>, size_t> got;
    for (const auto& x : d) got[x.to] = x.items.size();
    EXPECT_EQ((got[{"a@example.com", "c@example.com"}]), 1u);
    EXPECT_EQ((got[{"b@example.com"}]), 2u);
}

TEST(EmailRules, ReminderRepeatsUntilAcknowledgedAtMostReminderMax) {
    EmailRules r;
    EmailConfig c = baseConfig();
    c.rules[0].onReminder = true;
    c.rules[0].reminderMin = 10;
    c.reminderMax = 2;
    r.configure(c);
    r.onNotice(notice("A", "NORMAL", "ACTIVE_UNACK"), 0, 600);
    EXPECT_EQ(r.poll(30000, 600, {}).size(), 1u);  // the active email
    EXPECT_TRUE(r.poll(599999, 600, {}).empty());
    r.poll(600000, 600, {});  // reminder 1 joins the batch
    auto d = r.poll(630000, 600, {});
    ASSERT_EQ(d.size(), 1u);
    EXPECT_EQ(d[0].items[0].event, EmailEvent::Reminder);
    r.poll(1200000, 600, {});
    EXPECT_EQ(r.poll(1230000, 600, {}).size(), 1u) << "reminder 2";
    r.poll(1800000, 600, {});
    EXPECT_TRUE(r.poll(1830000, 600, {}).empty()) << "reminderMax reached";

    r.configure(c);
    r.onNotice(notice("B", "NORMAL", "ACTIVE_UNACK"), 0, 600);
    r.poll(30000, 600, {});
    r.onNotice(notice("B", "ACTIVE_UNACK", "ACTIVE_ACK"), 60000, 600);
    EXPECT_EQ(r.reminders(), 0u) << "acknowledged: no reminder";
    r.onNotice(notice("C", "NORMAL", "ACTIVE_UNACK"), 0, 600);
    r.onNotice(notice("C", "ACTIVE_UNACK", "RTN_UNACK"), 1000, 600);
    EXPECT_EQ(r.reminders(), 1u) << "returned but not acknowledged: still reminded";
    AlarmNotice gone;
    gone.kind = AlarmNotice::Kind::Gone;
    gone.instance = "C";
    r.onNotice(gone, 2000, 600);
    EXPECT_EQ(r.reminders(), 0u);
}

TEST(EmailRules, QuietHoursKeepOnlyHighPriorities) {
    EmailRules r;
    EmailConfig c = baseConfig();
    c.quiet.enabled = true;
    c.quiet.fromMin = 22 * 60;
    c.quiet.toMin = 6 * 60;
    c.quiet.minPriority = 1;
    r.configure(c);
    r.onNotice(notice("A", "NORMAL", "ACTIVE_UNACK", 2), 0, 23 * 60);
    r.onNotice(notice("B", "NORMAL", "ACTIVE_UNACK", 1), 0, 23 * 60);
    r.onNotice(notice("C", "NORMAL", "ACTIVE_UNACK", 2), 0, 12 * 60);
    EXPECT_EQ(r.pending(), 2u);
    EXPECT_EQ(r.stats().quiet, 1u);
}

TEST(EmailRules, StormGivesOneEmailAndTheHourlyLimitHoldsTheRest) {
    EmailRules r;
    EmailConfig c = baseConfig();
    c.maxPerHour = 2;
    r.configure(c);
    for (int i = 0; i < 80; ++i)
        r.onNotice(notice("A" + std::to_string(i), "NORMAL", "ACTIVE_UNACK", 1, i + 1), i * 10,
                   600);
    auto d = r.poll(30000, 600, {});
    ASSERT_EQ(d.size(), 1u);
    EXPECT_EQ(d[0].items.size(), kMaxListedEvents);
    EXPECT_EQ(d[0].more, 30u);
    r.onNotice(notice("X", "NORMAL", "ACTIVE_UNACK"), 40000, 600);
    EXPECT_EQ(r.poll(70000, 600, {}).size(), 1u);
    r.onNotice(notice("Y", "NORMAL", "ACTIVE_UNACK"), 80000, 600);
    EXPECT_TRUE(r.poll(120000, 600, {}).empty()) << "2 emails this hour already";
    r.onNotice(notice("Z", "NORMAL", "ACTIVE_UNACK"), 130000, 600);
    EXPECT_EQ(r.pending(), 2u) << "held, not lost";
    d = r.poll(3600000 + 30000, 600, {});
    ASSERT_EQ(d.size(), 1u);
    EXPECT_EQ(d[0].items.size(), 2u);
}

TEST(EmailRules, PendingListIsBoundedAndTheLossIsTold) {
    EmailRules r;
    EmailConfig c = baseConfig();
    r.configure(c);
    for (size_t i = 0; i < kMaxPendingEvents + 5; ++i)
        r.onNotice(notice("A" + std::to_string(i), "NORMAL", "ACTIVE_UNACK"), 0, 600);
    EXPECT_EQ(r.pending(), kMaxPendingEvents);
    const auto d = r.poll(30000, 600, {});
    ASSERT_EQ(d.size(), 1u);
    EXPECT_EQ(d[0].suppressed, 5u);
}

TEST(EmailRules, NoAddressNoEmail) {
    EmailRules r;
    EmailConfig c = baseConfig();
    c.rules[0].to.clear();
    c.rules[0].groups = {"empty"};
    r.configure(c);
    r.onNotice(notice("A", "NORMAL", "ACTIVE_UNACK"), 0, 600);
    EXPECT_TRUE(
        r.poll(30000, 600, [](const std::string&) { return std::vector<std::string>{}; }).empty());
    EXPECT_EQ(r.stats().noRecipient, 1u);
    EXPECT_EQ(r.pending(), 0u);
}

// ---- outbox

TEST(EmailOutbox, SurvivesARestartIsBoundedAndCleansDamage) {
    Tmp t;
    const std::string dir = t.path + "/outbox";
    std::string err;
    {
        EmailOutbox o;
        ASSERT_TRUE(o.open(dir, 3, 1 << 20, err)) << err;
        for (int i = 0; i < 4; ++i) {
            OutboxEntry e;
            e.from = "scada@example.com";
            e.to = {"a@example.com"};
            e.data = "mail " + std::to_string(i);
            e.createdEpochMs = 1000 + i;
            ASSERT_TRUE(o.add(e, err)) << err;
        }
        EXPECT_EQ(o.count(), 3u);
        const auto dropped = o.takeDropped();
        ASSERT_EQ(dropped.size(), 1u);
        EXPECT_EQ(dropped[0].reason, "full");
    }
    std::ofstream(dir + "/0000000000000099.mail") << "{not json";
    std::ofstream(dir + "/0000000000000005.mail.tmp") << "cut";
    EmailOutbox o;
    ASSERT_TRUE(o.open(dir, 3, 1 << 20, err)) << err;
    EXPECT_EQ(o.count(), 3u);
    EXPECT_EQ(o.takeDropped().size(), 1u) << "the damaged one";
    const auto ids = o.ids();
    ASSERT_EQ(ids.size(), 3u);
    const auto first = o.load(ids[0]);
    ASSERT_TRUE(first);
    EXPECT_EQ(first->data, "mail 1");
    struct stat st {};
    ASSERT_EQ(::stat((dir + "/" + ids[0] + ".mail").c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 0777, 0600u);
    o.remove(ids[0]);
    EXPECT_EQ(o.count(), 2u);
    EXPECT_FALSE(fs::exists(dir + "/0000000000000005.mail.tmp"));
    OutboxEntry e;
    e.from = "scada@example.com";
    e.to = {"a@example.com"};
    e.data = "next";
    ASSERT_TRUE(o.add(e, err));
    EXPECT_GT(e.id, ids[2]) << "ids keep growing after a restart";
}
