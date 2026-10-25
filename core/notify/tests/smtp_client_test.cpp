// Feature 023 (specs/023-alarm-email FR-001..FR-003, FR-011): the SMTP client against a fake SMTP
// server in this process (core/notify/tests/fake_smtp.hpp): plain, STARTTLS and SMTPS with a
// self-signed test certificate, CA check and pinning, AUTH PLAIN/LOGIN, refusals, timeouts; then
// the email service end to end: alarm notices -> one batched email, the server down -> retried
// with backoff, a restart in between -> still delivered from the disk outbox.
#include "core/notify/smtp_client.hpp"

#include <gtest/gtest.h>
#include <stdlib.h>

#include <atomic>
#include <chrono>
#include <filesystem>
#include <thread>

#include "core/notify/email_message.hpp"
#include "core/notify/email_service.hpp"
#include "core/notify/tests/fake_smtp.hpp"

using namespace mat::notify;
using mat::test::FakeSmtp;
using mat::test::FakeTls;
namespace fs = std::filesystem;

namespace {

struct Tmp {
    std::string path;
    Tmp() {
        std::string t = (fs::temp_directory_path() / "mat-smtp-XXXXXX").string();
        path = ::mkdtemp(t.data());
    }
    ~Tmp() { fs::remove_all(path); }
};

std::string message() {
    RenderedEmail b;
    b.subject = "Thử";
    b.text = "Xin chào\r\n.dot line\r\n";
    b.html = "<p>Xin chào</p>";
    MimeEnvelope e;
    e.from = "scada@example.com";
    e.to = {"a@example.com"};
    e.messageId = "1@mat-scada";
    e.boundary = "=_mat_1";
    return smtpData(buildMime(e, b));
}

SmtpOptions opts(FakeSmtp& s, SmtpSecurity sec) {
    SmtpOptions o;
    o.host = "localhost";
    o.port = s.port();
    o.security = sec;
    o.username = s.user;
    o.password = s.pass;
    o.caPem = s.certPem();
    o.timeoutMs = 3000;
    return o;
}

}  // namespace

class Smtp : public ::testing::Test {
   protected:
    Tmp dir;
    FakeSmtp server{dir.path};
    void SetUp() override { ASSERT_TRUE(server.certOk()); }
};

TEST_F(Smtp, StartTlsWithCaCheckAndAuthPlain) {
    ASSERT_TRUE(server.start());
    const auto r = smtpSend(opts(server, SmtpSecurity::StartTls), "scada@example.com",
                            {"a@example.com", "b@example.com"}, message());
    ASSERT_TRUE(r.ok) << r.error << " " << r.message;
    const auto m = server.mails();
    ASSERT_EQ(m.size(), 1u);
    EXPECT_TRUE(m[0].tls);
    EXPECT_EQ(m[0].authMech, "PLAIN");
    EXPECT_EQ(m[0].from, "scada@example.com");
    EXPECT_EQ(m[0].to.size(), 2u);
    EXPECT_NE(m[0].data.find("Content-Type: multipart/alternative"), std::string::npos);
    EXPECT_EQ(r.peerSha256, server.fingerprint());
}

TEST_F(Smtp, ImplicitTlsAndAuthLogin) {
    server.mode = FakeTls::Implicit;
    server.authMechs = "LOGIN";
    ASSERT_TRUE(server.start());
    const auto r = smtpSend(opts(server, SmtpSecurity::Smtps), "scada@example.com",
                            {"a@example.com"}, message());
    ASSERT_TRUE(r.ok) << r.error << " " << r.message;
    EXPECT_EQ(server.mails().at(0).authMech, "LOGIN");
    EXPECT_TRUE(server.mails().at(0).tls);
}

TEST_F(Smtp, PinnedCertificateInsteadOfCa) {
    server.mode = FakeTls::Implicit;
    ASSERT_TRUE(server.start());
    SmtpOptions o = opts(server, SmtpSecurity::Smtps);
    o.caPem.clear();
    o.caFile = "/nonexistent";
    o.host = "127.0.0.1";
    o.pinSha256 = server.fingerprint();
    auto r = smtpSend(o, "scada@example.com", {"a@example.com"}, message());
    EXPECT_TRUE(r.ok) << r.error << " " << r.message;
    o.pinSha256 = std::string(64, '0');
    r = smtpSend(o, "scada@example.com", {"a@example.com"}, message());
    EXPECT_FALSE(r.ok);
    EXPECT_EQ(r.error, "PIN");
    EXPECT_EQ(server.mails().size(), 1u);
}

TEST_F(Smtp, UntrustedCertificateOrWrongNameIsRefusedBeforeAuth) {
    ASSERT_TRUE(server.start());
    Tmp other;
    FakeSmtp stranger(other.path);  // another self-signed certificate as "CA"
    SmtpOptions o = opts(server, SmtpSecurity::StartTls);
    o.caPem = stranger.certPem();
    auto r = smtpSend(o, "scada@example.com", {"a@example.com"}, message());
    EXPECT_FALSE(r.ok);
    EXPECT_EQ(r.error, "CERT");
    EXPECT_EQ(r.stage, "tls");
    o = opts(server, SmtpSecurity::StartTls);
    o.host = "127.0.0.2";  // not in the certificate (SAN localhost, 127.0.0.1)
    r = smtpSend(o, "scada@example.com", {"a@example.com"}, message());
    EXPECT_FALSE(r.ok);
    EXPECT_TRUE(r.error == "CERT" || r.error == "CONNECT") << r.error;
    for (const auto& m : server.mails()) EXPECT_TRUE(m.authUser.empty());
}

TEST_F(Smtp, NoStartTlsNoPasswordInClear) {
    server.advertiseStartTls = false;
    ASSERT_TRUE(server.start());
    auto r = smtpSend(opts(server, SmtpSecurity::StartTls), "scada@example.com", {"a@example.com"},
                      message());
    EXPECT_FALSE(r.ok);
    EXPECT_EQ(r.error, "STARTTLS_UNSUPPORTED");
    r = smtpSend(opts(server, SmtpSecurity::None), "scada@example.com", {"a@example.com"},
                 message());
    EXPECT_FALSE(r.ok);
    EXPECT_EQ(r.error, "AUTH_INSECURE");
    SmtpOptions relay = opts(server, SmtpSecurity::None);
    relay.username.clear();
    r = smtpSend(relay, "scada@example.com", {"a@example.com"}, message());
    EXPECT_TRUE(r.ok) << "a LAN relay without AUTH: " << r.message;
    for (const auto& m : server.mails()) EXPECT_TRUE(m.authPass.empty());
}

TEST_F(Smtp, InjectedTextAfterStartTlsIsRefused) {
    server.injectAfterStartTls = true;
    ASSERT_TRUE(server.start());
    const auto r = smtpSend(opts(server, SmtpSecurity::StartTls), "scada@example.com",
                            {"a@example.com"}, message());
    EXPECT_FALSE(r.ok);
    EXPECT_EQ(r.stage, "starttls");
}

TEST_F(Smtp, WrongPasswordAndRefusedRecipients) {
    ASSERT_TRUE(server.start());
    SmtpOptions o = opts(server, SmtpSecurity::StartTls);
    o.password = "wrong";
    auto r = smtpSend(o, "scada@example.com", {"a@example.com"}, message());
    EXPECT_FALSE(r.ok);
    EXPECT_EQ(r.error, "AUTH");
    EXPECT_EQ(r.code, 535);
    EXPECT_FALSE(r.permanent);
    EXPECT_EQ(r.message.find("wrong"), std::string::npos) << "never the password";

    server.rejectRcpt = {"x@example.com"};
    r = smtpSend(opts(server, SmtpSecurity::StartTls), "scada@example.com",
                 {"a@example.com", "x@example.com"}, message());
    EXPECT_TRUE(r.ok);
    EXPECT_EQ(r.rejected, std::vector<std::string>{"x@example.com"});
    r = smtpSend(opts(server, SmtpSecurity::StartTls), "scada@example.com", {"x@example.com"},
                 message());
    EXPECT_FALSE(r.ok);
    EXPECT_TRUE(r.permanent);
    server.rejectRcpt.clear();
    server.rcptTempCode = 451;
    r = smtpSend(opts(server, SmtpSecurity::StartTls), "scada@example.com", {"a@example.com"},
                 message());
    EXPECT_FALSE(r.ok);
    EXPECT_FALSE(r.permanent);
    server.rcptTempCode = 0;
    server.dataCode = 554;
    r = smtpSend(opts(server, SmtpSecurity::StartTls), "scada@example.com", {"a@example.com"},
                 message());
    EXPECT_FALSE(r.ok);
    EXPECT_TRUE(r.permanent);
    EXPECT_EQ(r.stage, "data");
}

TEST_F(Smtp, TimeoutAndConnectionRefused) {
    server.silent = true;
    ASSERT_TRUE(server.start());
    SmtpOptions o = opts(server, SmtpSecurity::StartTls);
    o.timeoutMs = 500;
    const auto t0 = std::chrono::steady_clock::now();
    auto r = smtpSend(o, "scada@example.com", {"a@example.com"}, message());
    EXPECT_FALSE(r.ok);
    EXPECT_EQ(r.error, "TIMEOUT");
    EXPECT_LT(std::chrono::steady_clock::now() - t0, std::chrono::seconds(3));
    const int port = server.port();
    server.stop();
    o.port = port;
    r = smtpSend(o, "scada@example.com", {"a@example.com"}, message());
    EXPECT_FALSE(r.ok);
    EXPECT_EQ(r.error, "CONNECT");
}

// ---- the service, end to end

namespace {

AlarmNotice active(const std::string& id, int64_t epoch) {
    AlarmNotice n;
    n.tEpochMs = epoch;
    n.instance = id;
    n.occurrence = 1;
    n.from = "NORMAL";
    n.to = "ACTIVE_UNACK";
    n.priority = 1;
    n.name = "Mức bể " + id;
    n.tag = "LEVEL";
    n.text = "Cao";
    n.value = 9.5;
    return n;
}

struct Clock {
    std::atomic<int64_t> mono{1000000}, epoch{1761375600000};
};

}  // namespace

TEST_F(Smtp, ServiceBatchesRetriesWithBackoffAndSurvivesARestart) {
    ASSERT_TRUE(server.start());
    const int port = server.port();
    Clock clk;
    std::vector<EmailAuditRecord> audit;
    auto make = [&]() {
        EmailServiceOptions o;
        o.dir = dir.path + "/notify";
        o.monoMs = [&] { return clk.mono.load(); };
        o.epochMs = [&] { return clk.epoch.load(); };
        o.tzOffsetMin = [](int64_t) { return 420; };
        o.password = [&]() -> std::optional<std::string> { return server.pass; };
        o.groupEmails = [](const std::string&) {
            return std::vector<std::string>{"g@example.com"};
        };
        o.audit = [&](const EmailAuditRecord& r) { audit.push_back(r); };
        o.caPem = server.certPem();
        o.backoffS = {30, 60};
        return std::make_unique<EmailService>(o);
    };
    auto svc = make();
    std::string err;
    ASSERT_TRUE(svc->start(err, false)) << err;
    EmailConfig c;
    c.enabled = true;
    c.siteName = "Trạm thử";
    c.smtp.host = "localhost";
    c.smtp.port = port;
    c.smtp.username = server.user;
    c.smtp.from = "scada@example.com";
    c.smtp.timeoutS = 5;
    EmailRule r;
    r.id = "all";
    r.to = {"a@example.com"};
    r.groups = {"ca"};
    c.rules = {r};
    int64_t rev = 0;
    ASSERT_EQ(svc->saveConfig(c, 0, rev, err), SaveStatus::Ok) << err;
    EXPECT_EQ(rev, 1);
    EXPECT_EQ(svc->saveConfig(c, 0, rev, err), SaveStatus::Conflict);
    svc->cycle();

    svc->push({active("A", clk.epoch), active("B", clk.epoch), active("C", clk.epoch)});
    svc->cycle();
    EXPECT_TRUE(server.mails().empty()) << "batch window open";
    clk.mono += 30000;
    svc->cycle();
    auto mails = server.mails();
    ASSERT_EQ(mails.size(), 1u) << svc->statusJson().dump();
    EXPECT_EQ(mails[0].to, (std::vector<std::string>{"a@example.com", "g@example.com"}));
    EXPECT_NE(mails[0].data.find("Subject: =?UTF-8?B?"), std::string::npos);
    ASSERT_FALSE(audit.empty());
    EXPECT_EQ(audit.back().action, "email.sent");
    EXPECT_EQ(audit.back().detail["events"], 3);

    // Server down: queued on disk, retried with backoff.
    server.stop();
    svc->push({active("D", clk.epoch)});
    svc->cycle();
    clk.mono += 30000;
    svc->cycle();
    EXPECT_EQ(audit.back().action, "email.failed");
    EXPECT_EQ(audit.back().code, "CONNECT");
    EXPECT_EQ(svc->statusJson()["queue"]["count"], 1);
    const size_t fails = audit.size();
    clk.mono += 10000;
    svc->cycle();
    EXPECT_EQ(audit.size(), fails) << "within the backoff: no new attempt";

    // Restart of the runtime while the server is down; then the server comes back.
    svc.reset();
    svc = make();
    ASSERT_TRUE(svc->start(err, false)) << err;
    EXPECT_EQ(svc->statusJson()["queue"]["count"], 1) << "the outbox survived";
    FakeSmtp again(dir.path);
    again.setFixedPort(port);
    ASSERT_TRUE(again.start());
    svc->cycle();
    ASSERT_EQ(again.mails().size(), 1u) << svc->statusJson().dump();
    EXPECT_EQ(svc->statusJson()["queue"]["count"], 0);
    EXPECT_EQ(audit.back().action, "email.sent");

    // Test email.
    const auto t = svc->sendTest("t@example.com");
    EXPECT_TRUE(t.ok) << t.message;
    EXPECT_EQ(again.mails().size(), 2u);
    for (const auto& a : audit) EXPECT_EQ(a.detail.dump().find(server.pass), std::string::npos);
}

TEST_F(Smtp, ServiceDropsExpiredAndPermanentFailures) {
    ASSERT_TRUE(server.start());
    server.rejectRcpt = {"a@example.com"};
    Clock clk;
    std::vector<EmailAuditRecord> audit;
    EmailServiceOptions o;
    o.dir = dir.path + "/n2";
    o.monoMs = [&] { return clk.mono.load(); };
    o.epochMs = [&] { return clk.epoch.load(); };
    o.audit = [&](const EmailAuditRecord& r) { audit.push_back(r); };
    o.caPem = server.certPem();
    o.password = [&]() -> std::optional<std::string> { return server.pass; };
    EmailService svc(o);
    std::string err;
    ASSERT_TRUE(svc.start(err, false));
    EmailConfig c;
    c.enabled = true;
    c.smtp.host = "localhost";
    c.smtp.port = server.port();
    c.smtp.username = server.user;
    c.smtp.from = "scada@example.com";
    EmailRule r;
    r.id = "all";
    r.to = {"a@example.com"};
    c.rules = {r};
    int64_t rev = 0;
    ASSERT_EQ(svc.saveConfig(c, 0, rev, err), SaveStatus::Ok);
    svc.cycle();
    svc.push({active("A", clk.epoch)});
    svc.cycle();
    clk.mono += 30000;
    svc.cycle();
    ASSERT_FALSE(audit.empty());
    EXPECT_EQ(audit.back().action, "email.failed");
    EXPECT_EQ(audit.back().detail["permanent"], true);
    EXPECT_EQ(svc.statusJson()["queue"]["count"], 0) << "a permanent refusal is not retried";
}
