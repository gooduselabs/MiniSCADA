// T046 (feature 005; contracts/device-config.md §4, research R5, FR-009): the certificate commands
// of the device (server/cli/cert).
//  - --cert-fingerprint prints "SHA256 Fingerprint=AB:CD:…", the same line as
//    `openssl x509 -noout -fingerprint -sha256`; root or the service user; it only reads.
//  - --regen-cert (root): cert.regenerate `started` first, then a child process switched to the
//    service user writes the new key, then `ok` with both fingerprints; the new fingerprint is
//    printed; `systemctl try-restart mat-runtime` runs (injected here). No audit record: exit code
//    5 and the certificate keeps every byte.
// The tests run as root in the toolchain container; `daemon` (uid 1) stands for `matscada`.
#include <gtest/gtest.h>
#include <pwd.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#include <algorithm>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <sstream>
#include <string>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "nlohmann/json.hpp"
#include "server/cli/cert.hpp"
#include "server/tls/server_cert.hpp"

using namespace mat;

namespace {

constexpr const char* kServiceUser = "daemon";

class TempDir {
   public:
    TempDir() {
        char tmpl[] = "/tmp/mat-certcli-XXXXXX";
        if (::mkdtemp(tmpl) != nullptr) path = tmpl;
        ::chmod(path.c_str(), 0755);
    }
    ~TempDir() {
        std::error_code ec;
        if (!path.empty()) std::filesystem::remove_all(path, ec);
    }
    TempDir(const TempDir&) = delete;
    TempDir& operator=(const TempDir&) = delete;
    std::string path;
};

bool exists(const std::string& path) {
    struct stat st {};
    return ::lstat(path.c_str(), &st) == 0;
}

std::string readFile(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(f), {});
}

void writeFile(const std::string& path, const std::string& text, mode_t mode) {
    std::ofstream(path, std::ios::binary | std::ios::trunc) << text;
    ::chmod(path.c_str(), mode);
}

// stdout of a shell command; nullopt-like "" when it fails.
std::string shell(const std::string& cmd) {
    std::string out;
    if (FILE* p = ::popen(cmd.c_str(), "r")) {
        char buf[512];
        size_t n;
        while ((n = std::fread(buf, 1, sizeof buf, p)) > 0) out.append(buf, n);
        if (::pclose(p) != 0) out.clear();
    }
    return out;
}

struct Outcome {
    int code = -1;
    std::string out;
    std::string err;
};

}  // namespace

class CertCli : public ::testing::Test {
   protected:
    void SetUp() override {
        if (::geteuid() != 0) GTEST_SKIP() << "needs root, as in the toolchain container";
        const passwd* pw = ::getpwnam(kServiceUser);
        if (!pw) GTEST_SKIP() << "no user " << kServiceUser;
        svcUid = pw->pw_uid;
        svcGid = pw->pw_gid;
        ASSERT_FALSE(dir.path.empty());
        data = dir.path + "/data";
        ASSERT_EQ(::mkdir(data.c_str(), 0700), 0);
        ASSERT_EQ(::chown(data.c_str(), svcUid, svcGid), 0);  // as systemd's StateDirectory
    }

    DeviceCliEnv env(bool root) {
        DeviceCliEnv e;
        e.isRoot = root;
        e.serviceUser = kServiceUser;
        e.nowIso = [] { return std::string("2026-10-20T03:00:00Z"); };
        e.hostname = [] { return std::string("bl335-test"); };
        e.ipv4Addresses = [this] { return cardIps; };
        e.runCommand = [this](const std::vector<std::string>& argv) {
            commands.push_back(argv);
            return commandStatus;
        };
        return e;
    }

    Outcome run(std::vector<std::string> args, bool root = true) {
        args.insert(args.begin(), "mat-runtime");
        args.insert(args.end(), {"--data-dir", data});
        std::vector<char*> argv;
        for (auto& a : args) argv.push_back(&a[0]);
        std::ostringstream out, err;
        Outcome r;
        r.code = runCertCli(static_cast<int>(argv.size()), argv.data(), env(root), out, err);
        r.out = out.str();
        r.err = err.str();
        return r;
    }

    // The same command in a child process that really runs as the service user.
    Outcome runAsTheServiceUser(std::vector<std::string> args) {
        int p[2];
        if (::pipe(p) != 0) return {};
        const pid_t child = ::fork();
        if (child == 0) {
            ::close(p[0]);
            if (::setgid(svcGid) != 0 || ::setuid(svcUid) != 0) ::_exit(99);
            const Outcome r = run(std::move(args), /*root=*/false);
            const std::string text = r.out + '\0' + r.err;
            if (::write(p[1], text.data(), text.size()) < 0) ::_exit(98);
            ::_exit(r.code);
        }
        ::close(p[1]);
        std::string text;
        char buf[512];
        ssize_t n;
        while ((n = ::read(p[0], buf, sizeof buf)) > 0) text.append(buf, static_cast<size_t>(n));
        ::close(p[0]);
        int status = 0;
        ::waitpid(child, &status, 0);
        Outcome r;
        r.code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
        const size_t nul = text.find('\0');
        r.out = text.substr(0, nul);
        if (nul != std::string::npos) r.err = text.substr(nul + 1);
        return r;
    }

    // What the runtime makes on its first start (as the service user).
    ServerCert makeCert() {
        const ServerCert c = loadOrCreateServerCert({data, "BL335 thử", "bl335-test"});
        EXPECT_TRUE(c.ok) << c.error;
        for (const std::string& p : {data + "/tls", c.pemPath})
            EXPECT_EQ(::chown(p.c_str(), svcUid, svcGid), 0) << p;
        return c;
    }

    // Oldest first; none when audit.db is not there.
    std::vector<AuditRecord> auditRows() {
        if (!exists(data + "/audit.db")) return {};
        AuditOptions o;
        o.dataDir = data;
        AuditLog log(o);
        std::string e;
        if (!log.open(e)) {
            ADD_FAILURE() << e;
            return {};
        }
        AuditQuery q;
        q.limit = kAuditQueryMaxLimit;
        auto rows = log.query(q).records;
        std::reverse(rows.begin(), rows.end());
        return rows;
    }

    TempDir dir;
    std::string data;
    uid_t svcUid = 0;
    gid_t svcGid = 0;
    std::vector<std::vector<std::string>> commands;
    int commandStatus = 0;
    std::vector<std::string> cardIps;
};

TEST_F(CertCli, TheFingerprintLineIsTheOneOfOpenssl) {
    const ServerCert c = makeCert();
    ASSERT_TRUE(c.ok);
    const std::string line = "SHA256 Fingerprint=" + c.fingerprintColons + "\n";
    const Outcome r = run({"--cert-fingerprint"});
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_EQ(r.out, line);
    // the service user may run it too (the file is its own, 0600)
    const Outcome s = runAsTheServiceUser({"--cert-fingerprint"});
    EXPECT_EQ(s.code, 0) << s.err;
    EXPECT_EQ(s.out, line);
    const std::string openssl =
        shell("openssl x509 -in '" + c.pemPath + "' -noout -fingerprint -sha256 2>/dev/null");
    if (openssl.empty()) GTEST_SKIP() << "no openssl in the image";
    EXPECT_EQ(r.out, openssl);
}

// No certificate yet, or a damaged one: exit code 6 and a reason; nothing is written.
TEST_F(CertCli, AMissingOrDamagedCertificateGivesNoFingerprint) {
    Outcome r = run({"--cert-fingerprint"});
    EXPECT_EQ(r.code, 6) << r.out;
    EXPECT_TRUE(r.out.empty());
    EXPECT_FALSE(r.err.empty());
    EXPECT_FALSE(exists(data + "/tls"));
    EXPECT_FALSE(exists(data + "/audit.db"));

    const ServerCert c = makeCert();
    std::string pem = readFile(c.pemPath);
    // a character in the middle of the second base64 line of the certificate (every bit counts)
    const std::string begin = "-----BEGIN CERTIFICATE-----\n";
    const size_t at = pem.find(begin) + begin.size() + 65 + 30;
    ASSERT_LT(at, pem.size());
    pem[at] = pem[at] == 'A' ? 'B' : 'A';
    writeFile(c.pemPath, pem, 0600);
    r = run({"--cert-fingerprint"});
    EXPECT_EQ(r.code, 6) << r.out;
    EXPECT_EQ(r.out.find("Fingerprint="), std::string::npos);
    EXPECT_EQ(readFile(c.pemPath), pem);
}

TEST_F(CertCli, RegenMakesANewKeyAsTheServiceUserAndRestartsTheRuntime) {
    const ServerCert old = makeCert();
    ASSERT_TRUE(old.ok);
    const Outcome r = run({"--regen-cert"});
    ASSERT_EQ(r.code, 0) << r.err;
    const ServerCert now = readServerCert(data);
    ASSERT_TRUE(now.ok) << now.error;
    EXPECT_NE(now.fingerprint, old.fingerprint);
    EXPECT_NE(r.out.find("SHA256 Fingerprint=" + now.fingerprintColons + "\n"), std::string::npos)
        << r.out;
    EXPECT_NE(r.out.find("ghim"), std::string::npos) << r.out;  // Studios that pinned the old one

    // the new file is the service user's, 0600 in a 0700 directory
    struct stat st {};
    ASSERT_EQ(::stat(now.pemPath.c_str(), &st), 0);
    EXPECT_EQ(st.st_uid, svcUid);
    EXPECT_EQ(st.st_mode & 07777, 0600u);
    ASSERT_EQ(::stat((data + "/tls").c_str(), &st), 0);
    EXPECT_EQ(st.st_uid, svcUid);
    EXPECT_EQ(st.st_mode & 07777, 0700u);
    ASSERT_EQ(::stat((data + "/audit.db").c_str(), &st), 0);
    EXPECT_EQ(st.st_uid, svcUid);

    ASSERT_EQ(commands.size(), 1u);
    EXPECT_EQ(commands[0], (std::vector<std::string>{"systemctl", "try-restart", "mat-runtime"}));

    const auto rows = auditRows();
    ASSERT_EQ(rows.size(), 2u);
    EXPECT_EQ(rows[0].action, "cert.regenerate");
    EXPECT_EQ(rows[0].result, "started");
    EXPECT_EQ(rows[1].action, "cert.regenerate");
    EXPECT_EQ(rows[1].result, "ok");
    for (const auto& row : rows) {
        EXPECT_EQ(row.channel, "cli");
        EXPECT_EQ(row.source, "cli");
    }
    const auto detail = nlohmann::json::parse(rows[1].detail.value_or("{}"));
    EXPECT_EQ(detail.value("from", ""), old.fingerprint);
    EXPECT_EQ(detail.value("to", ""), now.fingerprint);
}

// The audit record cannot be written (audit.db is root's): exit code 5, the certificate keeps
// every byte, nothing is restarted.
TEST_F(CertCli, RegenWithoutAnAuditRecordChangesNothing) {
    const ServerCert old = makeCert();
    const std::string before = readFile(old.pemPath);
    writeFile(data + "/audit.db", "", 0600);  // root's: the service user cannot open it
    const Outcome r = run({"--regen-cert"});
    EXPECT_EQ(r.code, 5) << r.err;
    EXPECT_NE(r.err.find("audit"), std::string::npos) << r.err;
    EXPECT_EQ(readFile(old.pemPath), before);
    EXPECT_EQ(r.out.find("Fingerprint="), std::string::npos);
    EXPECT_TRUE(commands.empty());
}

TEST_F(CertCli, RegenNeedsRoot) {
    const ServerCert old = makeCert();
    const std::string before = readFile(old.pemPath);
    const Outcome r = run({"--regen-cert"}, /*root=*/false);
    EXPECT_EQ(r.code, 4);
    EXPECT_EQ(readFile(old.pemPath), before);
    EXPECT_FALSE(exists(data + "/audit.db"));
    EXPECT_TRUE(commands.empty());
}

// --regen-cert is the way out of cert-error (research R5): a damaged file is replaced too.
TEST_F(CertCli, RegenReplacesADamagedCertificate) {
    const ServerCert old = makeCert();
    writeFile(old.pemPath, "-----BEGIN damaged", 0600);
    ASSERT_FALSE(readServerCert(data).ok);
    const Outcome r = run({"--regen-cert"});
    ASSERT_EQ(r.code, 0) << r.err;
    const ServerCert now = readServerCert(data);
    EXPECT_TRUE(now.ok) << now.error;
    const auto rows = auditRows();
    ASSERT_EQ(rows.size(), 2u);
    EXPECT_EQ(rows[1].result, "ok");
}

// The service user cannot write the certificate directory: exit code 4, `failed` after
// `started`, nothing restarted.
TEST_F(CertCli, ACertificateThatCannotBeWrittenIsRecordedAsFailed) {
    ASSERT_EQ(::mkdir((data + "/tls").c_str(), 0700), 0);  // root's
    const Outcome r = run({"--regen-cert"});
    EXPECT_EQ(r.code, 4) << r.err;
    EXPECT_TRUE(commands.empty());
    const auto rows = auditRows();
    ASSERT_EQ(rows.size(), 2u);
    EXPECT_EQ(rows[0].result, "started");
    EXPECT_EQ(rows[1].result, "failed");
    EXPECT_TRUE(rows[1].code.has_value());
}

// The new certificate is in place even when the restart fails: exit code 0 and a warning that
// says what to run.
TEST_F(CertCli, ARestartThatFailsOnlyWarns) {
    makeCert();
    commandStatus = 1;
    const Outcome r = run({"--regen-cert"});
    EXPECT_EQ(r.code, 0) << r.err;
    EXPECT_NE(r.err.find("systemctl restart mat-runtime"), std::string::npos) << r.err;
    EXPECT_EQ(commands.size(), 1u);
    EXPECT_TRUE(readServerCert(data).ok);
}

TEST_F(CertCli, BadArguments) {
    makeCert();
    for (const auto& args :
         std::vector<std::vector<std::string>>{{"--cert-fingerprint", "--frobnicate"},
                                               {"--cert-fingerprint", "extra"},
                                               {"--regen-cert", "now"},
                                               {"--cert-fingerprint", "--regen-cert"},
                                               {"--regen-cert", "--config"}}) {
        const Outcome r = run(args);
        EXPECT_EQ(r.code, 2) << args[0] << " " << args[1];
    }
    EXPECT_TRUE(commands.empty());
    EXPECT_FALSE(exists(data + "/audit.db"));
}

TEST(CertCliCommand, RecognisesTheCertificateCommands) {
    auto is = [](std::vector<std::string> args) {
        args.insert(args.begin(), "mat-runtime");
        std::vector<char*> argv;
        for (auto& a : args) argv.push_back(&a[0]);
        return isCertCommand(static_cast<int>(argv.size()), argv.data());
    };
    EXPECT_TRUE(is({"--cert-fingerprint"}));
    EXPECT_TRUE(is({"--regen-cert", "--data-dir", "/tmp"}));
    EXPECT_FALSE(is({"--data-dir", "/tmp"}));
    EXPECT_FALSE(is({}));
}

// ---------------------------------------------------------------------------------------------
// Feature 007 (T088; contracts/device-config-007.md §2): --cert-info, --make-csr, --import-cert,
// --san. The CA of these tests is `openssl` of the toolchain image.
// ---------------------------------------------------------------------------------------------

namespace {

bool haveOpenssl() { return !shell("openssl version 2>/dev/null").empty(); }

// A directory with a CA (ca.crt, ca.key) that signs certificate requests the way a customer's CA
// would: the SAN comes from the CA's own file, not from the request.
struct TestCa {
    explicit TestCa(const std::string& dir) : dir(dir) {
        shell("cd '" + dir +
              "' && openssl ecparam -name prime256v1 -genkey -noout -out ca.key 2>&1 && "
              "openssl req -new -x509 -key ca.key -subj '/CN=Test CA' -days 3650 -out ca.crt 2>&1 "
              "&& echo ok");
    }
    // The certificate (PEM) for the CSR text; "" when openssl fails.
    std::string sign(const std::string& csrPem, const std::string& san) const {
        writeFile(dir + "/req.pem", csrPem, 0644);
        writeFile(dir + "/ext.cnf",
                  "subjectAltName=" + san +
                      "\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature\n"
                      "extendedKeyUsage=serverAuth\n",
                  0644);
        return shell("cd '" + dir +
                     "' && openssl x509 -req -in req.pem -CA ca.crt -CAkey ca.key "
                     "-CAcreateserial -days 3650 -extfile ext.cnf -out leaf.crt 2>&1 && "
                     "cat leaf.crt");
    }
    std::string ca() const { return readFile(dir + "/ca.crt"); }
    std::string dir;
};

// The certificate blocks of what `openssl x509 -req` printed (it also prints "Signature ok", ...).
std::string pemOnly(const std::string& text) {
    const size_t at = text.find("-----BEGIN CERTIFICATE-----");
    return at == std::string::npos ? "" : text.substr(at);
}

}  // namespace

TEST_F(CertCli, CertInfoPrintsTheFieldsAndNeverTheKey) {
    const ServerCert c = loadOrCreateServerCert(
        {data, "BL335 thử", "bl335-test", {"192.168.1.110"}, {{false, "scada.example.vn"}}});
    ASSERT_TRUE(c.ok) << c.error;
    for (const std::string& p : {data + "/tls", c.pemPath})
        ASSERT_EQ(::chown(p.c_str(), svcUid, svcGid), 0);
    const Outcome r = run({"--cert-info"});
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_NE(r.out.find("CN=mAT BL335 thử"), std::string::npos) << r.out;
    EXPECT_NE(r.out.find("tự ký"), std::string::npos) << r.out;
    EXPECT_NE(r.out.find("DNS:bl335-test"), std::string::npos) << r.out;
    EXPECT_NE(r.out.find("IP:192.168.1.110"), std::string::npos) << r.out;
    EXPECT_NE(r.out.find("DNS:scada.example.vn"), std::string::npos) << r.out;
    EXPECT_NE(r.out.find("9999-12-31"), std::string::npos) << r.out;
    EXPECT_NE(r.out.find("SHA256 Fingerprint=" + c.fingerprintColons + "\n"), std::string::npos)
        << r.out;
    EXPECT_EQ(r.out.find("PRIVATE KEY"), std::string::npos);
    EXPECT_EQ(r.out.find("BEGIN"), std::string::npos);
    // The service user may run it too; --cert-fingerprint keeps its one line.
    EXPECT_EQ(runAsTheServiceUser({"--cert-info"}).out, r.out);
    EXPECT_EQ(run({"--cert-fingerprint"}).out, "SHA256 Fingerprint=" + c.fingerprintColons + "\n");
    EXPECT_FALSE(exists(data + "/audit.db"));  // reading is not audited
}

TEST_F(CertCli, CertInfoWithoutACertificateIsExitCode6) {
    const Outcome r = run({"--cert-info"});
    EXPECT_EQ(r.code, 6);
    EXPECT_TRUE(r.out.empty());
    EXPECT_FALSE(r.err.empty());
}

TEST_F(CertCli, RegenPutsTheCardAddressesAndTheSanOptionInTheSan) {
    makeCert();
    cardIps = {"192.168.1.110", "10.0.0.5"};
    const Outcome r = run({"--regen-cert", "--san", "172.16.1.1,scada.example.vn"});
    ASSERT_EQ(r.code, 0) << r.err;
    const ServerCert now = readServerCert(data);
    ASSERT_TRUE(now.ok) << now.error;
    EXPECT_EQ(now.cert.sanIps,
              (std::vector<std::string>{"192.168.1.110", "10.0.0.5", "172.16.1.1"}));
    EXPECT_EQ(now.cert.sanDns, (std::vector<std::string>{"bl335-test", "scada.example.vn"}));
}

TEST_F(CertCli, ABadSanIsExitCode2AndChangesNothing) {
    const ServerCert old = makeCert();
    const std::string before = readFile(old.pemPath);
    for (const char* san : {"::1", "*.example.vn", "10.0.0.256", "", "a,,b"}) {
        SCOPED_TRACE(san);
        for (const char* cmd : {"--regen-cert", "--make-csr"}) {
            const Outcome r = run({cmd, "--san", san});
            EXPECT_EQ(r.code, 2) << r.err;
            EXPECT_FALSE(r.err.empty());
        }
    }
    EXPECT_EQ(readFile(old.pemPath), before);
    EXPECT_FALSE(exists(data + "/audit.db"));
    EXPECT_FALSE(exists(data + "/tls/pending-key.pem"));
    EXPECT_TRUE(commands.empty());
}

TEST_F(CertCli, MakeCsrWritesAPendingKeyAndARequestAndKeepsTheCertificate) {
    if (!haveOpenssl()) GTEST_SKIP() << "no openssl in the image";
    const ServerCert old = makeCert();
    const std::string before = readFile(old.pemPath);
    cardIps = {"192.168.1.110"};
    const Outcome r = run({"--make-csr", "--san", "192.168.1.110,scada.example.vn"});
    ASSERT_EQ(r.code, 0) << r.err;

    // The request is on stdout, the key never is.
    EXPECT_NE(r.out.find("-----BEGIN CERTIFICATE REQUEST-----\n"), std::string::npos) << r.out;
    EXPECT_EQ(r.out.find("PRIVATE KEY"), std::string::npos);
    const std::string csrPath = data + "/tls/csr-20261020T030000Z.pem";
    ASSERT_TRUE(exists(csrPath));
    EXPECT_NE(r.out.find(readFile(csrPath)), std::string::npos);
    struct stat st {};
    ASSERT_EQ(::stat(csrPath.c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 07777, 0644u);
    EXPECT_EQ(st.st_uid, svcUid);
    const std::string keyPath = data + "/tls/pending-key.pem";
    ASSERT_EQ(::stat(keyPath.c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 07777, 0600u);
    EXPECT_EQ(st.st_uid, svcUid);
    EXPECT_EQ(readFile(old.pemPath), before) << "the certificate in use is not touched";

    // A valid PKCS#10 for the key in pending-key.pem, with the SAN asked for.
    const std::string text = shell("openssl req -in '" + csrPath + "' -noout -verify -text 2>&1");
    EXPECT_NE(text.find("CN = mAT bl335-test"), std::string::npos) << text;
    EXPECT_NE(text.find("IP Address:192.168.1.110"), std::string::npos) << text;
    EXPECT_NE(text.find("DNS:scada.example.vn"), std::string::npos) << text;
    EXPECT_EQ(text.find("DNS:bl335-test"), std::string::npos) << "--san replaces the default";
    EXPECT_NE(text.find("Digital Signature"), std::string::npos) << text;
    EXPECT_NE(text.find("TLS Web Server Authentication"), std::string::npos) << text;
    EXPECT_NE(text.find("prime256v1"), std::string::npos) << text;
    EXPECT_EQ(shell("openssl req -in '" + csrPath + "' -noout -pubkey"),
              shell("openssl ec -in '" + keyPath + "' -pubout 2>/dev/null"));

    const auto rows = auditRows();
    ASSERT_EQ(rows.size(), 2u);
    EXPECT_EQ(rows[0].action, "tls.csr");
    EXPECT_EQ(rows[0].result, "started");
    EXPECT_EQ(rows[1].action, "tls.csr");
    EXPECT_EQ(rows[1].result, "ok");
    EXPECT_TRUE(commands.empty());  // nothing restarts: the certificate did not change
}

TEST_F(CertCli, MakeCsrDefaultsToTheHostNameAndTheCardsAndCanWriteToAFile) {
    if (!haveOpenssl()) GTEST_SKIP() << "no openssl in the image";
    makeCert();
    cardIps = {"192.168.1.110", "10.0.0.5"};
    const std::string out = dir.path + "/request.pem";
    const Outcome r = run({"--make-csr", "--out", out});
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_EQ(r.out.find("BEGIN CERTIFICATE REQUEST"), std::string::npos) << "not on stdout";
    EXPECT_NE(r.out.find(out), std::string::npos) << r.out;
    const std::string text = shell("openssl req -in '" + out + "' -noout -text 2>&1");
    EXPECT_NE(text.find("DNS:bl335-test"), std::string::npos) << text;
    EXPECT_NE(text.find("IP Address:192.168.1.110"), std::string::npos) << text;
    EXPECT_NE(text.find("IP Address:10.0.0.5"), std::string::npos) << text;
}

TEST_F(CertCli, MakeCsrNeedsRoot) {
    makeCert();
    const Outcome r = run({"--make-csr"}, /*root=*/false);
    EXPECT_EQ(r.code, 4);
    EXPECT_FALSE(exists(data + "/tls/pending-key.pem"));
    EXPECT_FALSE(exists(data + "/audit.db"));
}

// The whole way: request, the customer's CA signs it, import, the certificate of the file is the
// CA's and the old file is kept as server.pem.prev.
TEST_F(CertCli, ImportTakesTheCertificateOfACaAndKeepsTheOldFile) {
    if (!haveOpenssl()) GTEST_SKIP() << "no openssl in the image";
    const ServerCert old = makeCert();
    const std::string before = readFile(old.pemPath);
    cardIps = {"192.168.1.110"};
    const Outcome csr = run({"--make-csr"});
    ASSERT_EQ(csr.code, 0) << csr.err;
    TestCa ca(dir.path);
    const std::string leaf = pemOnly(ca.sign(csr.out, "IP:192.168.1.110,DNS:bl335-test"));
    ASSERT_FALSE(leaf.empty());
    writeFile(dir.path + "/chain.pem", leaf + ca.ca(), 0644);
    commands.clear();

    const Outcome r = run({"--import-cert", dir.path + "/chain.pem"});
    ASSERT_EQ(r.code, 0) << r.err << r.out;
    const ServerCert now = readServerCert(data);
    ASSERT_TRUE(now.ok) << now.error;
    EXPECT_NE(now.fingerprint, old.fingerprint);
    EXPECT_NE(r.out.find("SHA256 Fingerprint=" + now.fingerprintColons + "\n"), std::string::npos)
        << r.out;
    EXPECT_NE(r.out.find("systemctl restart mat-runtime"), std::string::npos) << r.out;
    EXPECT_FALSE(now.cert.selfSigned);
    EXPECT_EQ(now.cert.issuer, "CN=Test CA");
    EXPECT_EQ(now.cert.chainLength, 2);
    EXPECT_EQ(now.cert.sanIps, std::vector<std::string>{"192.168.1.110"});
    EXPECT_TRUE(r.err.empty()) << r.err;  // SAN covers the card: no warning

    EXPECT_EQ(readFile(data + "/tls/server.pem.prev"), before);
    EXPECT_FALSE(exists(data + "/tls/pending-key.pem"));
    EXPECT_FALSE(exists(data + "/tls/server.pem.new"));
    struct stat st {};
    ASSERT_EQ(::stat((data + "/tls/server.pem").c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 07777, 0600u);
    EXPECT_EQ(st.st_uid, svcUid);
    // The file holds the key, the certificate and the CA, and nothing else.
    const std::string pem = readFile(data + "/tls/server.pem");
    // marker line, then the key, then the certificates
    EXPECT_EQ(pem.find("# mat-runtime: certificate imported"), 0u) << pem;
    EXPECT_EQ(pem.find("-----BEGIN EC PRIVATE KEY-----"), pem.find("\n") + 1) << pem;
    size_t certs = 0;
    for (size_t at = pem.find("BEGIN CERTIFICATE"); at != std::string::npos;
         at = pem.find("BEGIN CERTIFICATE", at + 1))
        ++certs;
    EXPECT_EQ(certs, 2u);
    // openssl sees a key that fits the certificate.
    EXPECT_EQ(shell("openssl x509 -in '" + data + "/tls/server.pem' -noout -pubkey"),
              shell("openssl ec -in '" + data + "/tls/server.pem' -pubout 2>/dev/null"));

    const auto rows = auditRows();
    ASSERT_EQ(rows.size(), 4u) << "tls.csr, then tls.import";
    EXPECT_EQ(rows[2].action, "tls.import");
    EXPECT_EQ(rows[2].result, "started");
    EXPECT_EQ(rows[3].result, "ok");
    const auto detail = nlohmann::json::parse(rows[3].detail.value_or("{}"));
    EXPECT_EQ(detail.value("from", ""), old.fingerprint);
    EXPECT_EQ(detail.value("to", ""), now.fingerprint);
    EXPECT_TRUE(commands.empty()) << "the command only reminds of the restart";
}

TEST_F(CertCli, ImportForTheCurrentKeyWithoutARequestWorks) {
    if (!haveOpenssl()) GTEST_SKIP() << "no openssl in the image";
    const ServerCert old = makeCert();
    // A CA signs a request made from the key of server.pem itself.
    TestCa ca(dir.path);
    const std::string csr =
        shell("openssl req -new -key '" + old.pemPath + "' -subj '/CN=mAT x' 2>/dev/null");
    ASSERT_FALSE(csr.empty());
    const std::string leaf = pemOnly(ca.sign(csr, "IP:192.168.1.110"));
    ASSERT_FALSE(leaf.empty());
    writeFile(dir.path + "/leaf.pem", leaf, 0644);
    cardIps = {"192.168.1.110"};
    const Outcome r = run({"--import-cert", dir.path + "/leaf.pem"});
    ASSERT_EQ(r.code, 0) << r.err;
    EXPECT_EQ(readServerCert(data).cert.chainLength, 1);
}

TEST_F(CertCli, ImportRefusesACertificateThatDoesNotFitAnyKeyOfTheDevice) {
    if (!haveOpenssl()) GTEST_SKIP() << "no openssl in the image";
    const ServerCert old = makeCert();
    const std::string before = readFile(old.pemPath);
    ASSERT_EQ(run({"--make-csr"}).code, 0);
    const std::string pendingBefore = readFile(data + "/tls/pending-key.pem");
    TestCa ca(dir.path);
    // a request for some other key
    const std::string other =
        shell("cd '" + dir.path +
              "' && openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes "
              "-keyout other.key -subj /CN=x 2>/dev/null");
    ASSERT_FALSE(other.empty());
    const std::string leaf = pemOnly(ca.sign(other, "IP:192.168.1.110"));
    ASSERT_FALSE(leaf.empty());
    writeFile(dir.path + "/leaf.pem", leaf, 0644);
    const Outcome r = run({"--import-cert", dir.path + "/leaf.pem"});
    EXPECT_EQ(r.code, 3) << r.err;
    EXPECT_FALSE(r.err.empty());
    EXPECT_EQ(readFile(old.pemPath), before);
    EXPECT_EQ(readFile(data + "/tls/pending-key.pem"), pendingBefore);
    EXPECT_FALSE(exists(data + "/tls/server.pem.prev"));
    EXPECT_FALSE(exists(data + "/tls/server.pem.new"));
    const auto rows = auditRows();
    ASSERT_FALSE(rows.empty());
    EXPECT_EQ(rows.back().action, "tls.import");
    EXPECT_EQ(rows.back().result, "failed");
}

TEST_F(CertCli, ImportRefusesAFileThatHoldsAPrivateKey) {
    const ServerCert old = makeCert();
    const std::string before = readFile(old.pemPath);
    // server.pem itself holds a key and a certificate: never accepted as the file to import
    writeFile(dir.path + "/with-key.pem", before, 0644);
    Outcome r = run({"--import-cert", dir.path + "/with-key.pem"});
    EXPECT_EQ(r.code, 2);
    EXPECT_NE(r.err.find("khóa riêng"), std::string::npos) << r.err;
    for (const char* kind :
         {"PRIVATE KEY", "EC PRIVATE KEY", "RSA PRIVATE KEY", "ENCRYPTED PRIVATE KEY"}) {
        const std::string cert = before.substr(before.find("-----BEGIN CERTIFICATE-----"));
        writeFile(dir.path + "/k.pem",
                  cert + "-----BEGIN " + kind + "-----\nAAAA\n-----END " + kind + "-----\n", 0644);
        r = run({"--import-cert", dir.path + "/k.pem"});
        EXPECT_EQ(r.code, 2) << kind;
    }
    EXPECT_EQ(readFile(old.pemPath), before);
    EXPECT_FALSE(exists(data + "/tls/server.pem.prev"));
}

TEST_F(CertCli, ImportRefusesWhatIsNotACertificateFile) {
    const ServerCert old = makeCert();
    const std::string before = readFile(old.pemPath);
    writeFile(dir.path + "/empty.pem", "", 0644);
    writeFile(dir.path + "/junk.pem", "hello\n-----BEGIN CERTIFICATE-----\nAAAA\n", 0644);
    writeFile(dir.path + "/damaged.pem",
              "-----BEGIN CERTIFICATE-----\nMIIBaaaa\n-----END CERTIFICATE-----\n", 0644);
    for (const std::string& f : {dir.path + "/empty.pem", dir.path + "/junk.pem",
                                 dir.path + "/damaged.pem", dir.path + "/missing.pem"}) {
        SCOPED_TRACE(f);
        const Outcome r = run({"--import-cert", f});
        EXPECT_EQ(r.code, 2) << r.err;
        EXPECT_FALSE(r.err.empty());
    }
    EXPECT_EQ(run({"--import-cert"}).code, 2);
    EXPECT_EQ(readFile(old.pemPath), before);
}

TEST_F(CertCli, ASanThatMissesTheCardsOnlyWarns) {
    if (!haveOpenssl()) GTEST_SKIP() << "no openssl in the image";
    makeCert();
    cardIps = {"192.168.1.110"};
    const Outcome csr = run({"--make-csr"});
    ASSERT_EQ(csr.code, 0) << csr.err;
    TestCa ca(dir.path);
    const std::string leaf = pemOnly(ca.sign(csr.out, "IP:10.99.99.99"));
    ASSERT_FALSE(leaf.empty());
    writeFile(dir.path + "/leaf.pem", leaf, 0644);
    const Outcome r = run({"--import-cert", dir.path + "/leaf.pem"});
    EXPECT_EQ(r.code, 0) << r.err;
    EXPECT_NE(r.err.find("cảnh báo"), std::string::npos) << r.err;
    EXPECT_NE(r.err.find("SAN"), std::string::npos) << r.err;
    EXPECT_TRUE(readServerCert(data).ok);
}

TEST_F(CertCli, ImportNeedsRoot) {
    makeCert();
    writeFile(dir.path + "/x.pem", "-----BEGIN CERTIFICATE-----\n", 0644);
    const Outcome r = run({"--import-cert", dir.path + "/x.pem"}, /*root=*/false);
    EXPECT_EQ(r.code, 4);
    EXPECT_FALSE(exists(data + "/audit.db"));
}

// A power cut after server.pem.new was written, or after the old file was linked to
// server.pem.prev: server.pem is still complete, and a later import cleans up and goes through.
TEST_F(CertCli, APowerCutDuringTheImportLeavesAUsableServerPem) {
    if (!haveOpenssl()) GTEST_SKIP() << "no openssl in the image";
    const ServerCert old = makeCert();
    cardIps = {"192.168.1.110"};
    const Outcome csr = run({"--make-csr"});
    ASSERT_EQ(csr.code, 0) << csr.err;
    TestCa ca(dir.path);
    const std::string leaf = pemOnly(ca.sign(csr.out, "IP:192.168.1.110"));
    ASSERT_FALSE(leaf.empty());
    const std::string before = readFile(old.pemPath);
    // the library runs as the service user, as the command's child does
    const ChildResult child = runAsServiceUser(env(true), [&](std::string& message) {
        for (const char* stopAt : {"new-written", "prev-linked"}) {
            ImportOptions o;
            o.dataDir = data;
            o.hostname = "bl335-test";
            o.ipAddresses = {"192.168.1.110"};
            o.afterStep = [&](const char* step) { return std::string(step) != stopAt; };
            const ImportResult cut = importServerCert(o, leaf);
            const ServerCert still = readServerCert(data);
            if (cut.code != 4 || !still.ok || still.fingerprint != old.fingerprint) {
                message = std::string("cut at ") + stopAt + ": " + cut.error + still.error;
                return 1;
            }
        }
        return 0;
    });
    ASSERT_EQ(child.status, 0) << child.message;
    EXPECT_EQ(readFile(old.pemPath), before);
    // the next import finds leftovers (server.pem.new, server.pem.prev) and finishes
    writeFile(dir.path + "/leaf.pem", leaf, 0644);
    const Outcome done = run({"--import-cert", dir.path + "/leaf.pem"});
    EXPECT_EQ(done.code, 0) << done.err;
    const ServerCert now = readServerCert(data);
    ASSERT_TRUE(now.ok) << now.error;
    EXPECT_NE(now.fingerprint, old.fingerprint);
    EXPECT_EQ(readFile(data + "/tls/server.pem.prev"), before);
    EXPECT_FALSE(exists(data + "/tls/server.pem.new"));
}

TEST(CertCliCommand, RecognisesTheNewCertificateCommands) {
    auto is = [](std::vector<std::string> args) {
        args.insert(args.begin(), "mat-runtime");
        std::vector<char*> argv;
        for (auto& a : args) argv.push_back(&a[0]);
        return isCertCommand(static_cast<int>(argv.size()), argv.data());
    };
    EXPECT_TRUE(is({"--cert-info"}));
    EXPECT_TRUE(is({"--make-csr", "--san", "10.0.0.1"}));
    EXPECT_TRUE(is({"--import-cert", "/tmp/x.pem"}));
}
