// The serial port transport on a pseudo-terminal pair (feature 006 T159; FR-035; research R13).
// The master side stands for the line: what the master writes arrives at the port, what the port
// writes the master reads.
#include "drivers/sdk/serial_port.hpp"

#include <fcntl.h>
#include <gtest/gtest.h>
#include <poll.h>
#include <stdlib.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <unistd.h>

#include <chrono>
#include <cstring>
#include <string>
#include <thread>

using namespace mat::drv;

namespace {

int64_t nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

// A pty pair: `master` is ours, `slave` is the path of the port.
struct Pty {
    int master = -1;
    std::string slave;
    Pty() {
        master = ::posix_openpt(O_RDWR | O_NOCTTY | O_CLOEXEC);
        EXPECT_GE(master, 0);
        EXPECT_EQ(::grantpt(master), 0);
        EXPECT_EQ(::unlockpt(master), 0);
        char buf[128];
        EXPECT_EQ(::ptsname_r(master, buf, sizeof buf), 0);
        slave = buf;
        // the master side stays raw too, or its line discipline would edit the bytes
        termios t{};
        ::tcgetattr(master, &t);
        ::cfmakeraw(&t);
        ::tcsetattr(master, TCSANOW, &t);
    }
    ~Pty() {
        if (master >= 0) ::close(master);
    }
    void write(const std::string& s) {
        ASSERT_EQ(::write(master, s.data(), s.size()), static_cast<ssize_t>(s.size()));
    }
    std::string readAll(int timeoutMs = 200) {
        std::string out;
        pollfd p{master, POLLIN, 0};
        while (::poll(&p, 1, timeoutMs) > 0 && (p.revents & POLLIN)) {
            char b[256];
            const ssize_t n = ::read(master, b, sizeof b);
            if (n <= 0) break;
            out.append(b, static_cast<size_t>(n));
            timeoutMs = 50;
        }
        return out;
    }
};

SerialParams params(int baud, int dataBits, char parity, int stopBits, bool rs485 = false) {
    SerialParams p;
    p.baud = baud;
    p.dataBits = dataBits;
    p.parity = parity;
    p.stopBits = stopBits;
    p.rs485 = rs485;
    return p;
}

}  // namespace

// The frame itself: a pty forces its slave to 8 data bits and no parity, so what the port computes
// is read from the function it applies, on a termios that no tty has touched.
TEST(SerialPort, TheFrameOfTheTermios) {
    struct Case {
        int baud, dataBits;
        char parity;
        int stopBits;
        speed_t speed;
    };
    const Case cases[] = {{9600, 8, 'E', 1, B9600},     {19200, 8, 'N', 2, B19200},
                          {115200, 7, 'O', 1, B115200}, {1200, 8, 'N', 1, B1200},
                          {38400, 7, 'E', 2, B38400},   {4800, 8, 'O', 2, B4800},
                          {2400, 7, 'N', 1, B2400},     {57600, 8, 'E', 1, B57600}};
    for (const Case& c : cases) {
        termios t{};
        ASSERT_TRUE(serialApplyParams(params(c.baud, c.dataBits, c.parity, c.stopBits), t));
        EXPECT_EQ(t.c_cflag & CSIZE, static_cast<tcflag_t>(c.dataBits == 7 ? CS7 : CS8)) << c.baud;
        EXPECT_EQ((t.c_cflag & PARENB) != 0, c.parity != 'N') << c.baud;
        EXPECT_EQ((t.c_cflag & PARODD) != 0, c.parity == 'O') << c.baud;
        EXPECT_EQ((t.c_cflag & CSTOPB) != 0, c.stopBits == 2) << c.baud;
        EXPECT_TRUE(t.c_cflag & CLOCAL);
        EXPECT_TRUE(t.c_cflag & CREAD);
        EXPECT_FALSE(t.c_cflag & CRTSCTS);
        EXPECT_EQ(::cfgetospeed(&t), c.speed);
        EXPECT_EQ(::cfgetispeed(&t), c.speed);
        EXPECT_FALSE(t.c_lflag & (ICANON | ECHO | ISIG | IEXTEN));
        EXPECT_FALSE(t.c_iflag & (ICRNL | INLCR | IGNCR | IXON | IXOFF | IXANY));
        EXPECT_FALSE(t.c_oflag & OPOST);
        EXPECT_EQ(t.c_cc[VMIN], 0);
        EXPECT_EQ(t.c_cc[VTIME], 0);
    }
    termios t{};
    EXPECT_FALSE(serialApplyParams(params(12345, 8, 'E', 1), t));
    EXPECT_FALSE(serialApplyParams(params(9600, 9, 'E', 1), t));
    EXPECT_FALSE(serialApplyParams(params(9600, 8, 'X', 1), t));
    EXPECT_FALSE(serialApplyParams(params(9600, 8, 'E', 3), t));
}

TEST(SerialPort, OpensRawAndAppliesTheFrame) {
    struct Case {
        int baud, dataBits;
        char parity;
        int stopBits;
        speed_t speed;
    };
    const Case cases[] = {{9600, 8, 'E', 1, B9600},
                          {19200, 8, 'N', 2, B19200},
                          {115200, 7, 'O', 1, B115200},
                          {1200, 8, 'N', 1, B1200},
                          {38400, 7, 'E', 2, B38400}};
    for (const Case& c : cases) {
        Pty pty;
        SerialPort port(params(c.baud, c.dataBits, c.parity, c.stopBits));
        ASSERT_EQ(port.connect(pty.slave, 0, 1000), ConnectCode::Ok) << c.baud;
        EXPECT_EQ(port.openStatus(), SerialOpen::Ok);
        EXPECT_TRUE(port.isOpen());
        termios t{};
        ASSERT_EQ(::tcgetattr(port.fd(), &t), 0);
        // (a pty forces the slave to CS8 and no parity; speed, stop bits and raw mode stay)
        EXPECT_EQ((t.c_cflag & CSTOPB) != 0, c.stopBits == 2);
        EXPECT_TRUE(t.c_cflag & CLOCAL);
        EXPECT_TRUE(t.c_cflag & CREAD);
        EXPECT_EQ(::cfgetospeed(&t), c.speed);
        EXPECT_EQ(::cfgetispeed(&t), c.speed);
        // raw: no line editing, no echo, no translation, no signals
        EXPECT_FALSE(t.c_lflag & (ICANON | ECHO | ISIG | IEXTEN));
        EXPECT_FALSE(t.c_iflag & (ICRNL | INLCR | IGNCR | IXON | IXOFF));
        EXPECT_FALSE(t.c_oflag & OPOST);
        EXPECT_EQ(t.c_cc[VMIN], 0);
        EXPECT_EQ(t.c_cc[VTIME], 0);
    }
}

TEST(SerialPort, RefusesParametersItCannotApply) {
    Pty pty;
    SerialPort port(params(12345, 8, 'E', 1));
    EXPECT_EQ(port.connect(pty.slave, 0, 1000), ConnectCode::PortError);
    EXPECT_EQ(port.openStatus(), SerialOpen::Error);
    EXPECT_FALSE(serialBaudSupported(12345));
    EXPECT_TRUE(serialBaudSupported(115200));
    EXPECT_TRUE(serialBaudSupported(1200));
}

TEST(SerialPort, SecondOpenIsBusyAndSaysWhy) {
    Pty pty;
    SerialPort first(params(9600, 8, 'E', 1));
    ASSERT_EQ(first.connect(pty.slave, 0, 1000), ConnectCode::Ok);
    SerialPort second(params(9600, 8, 'E', 1));
    EXPECT_EQ(second.connect(pty.slave, 0, 1000), ConnectCode::PortBusy);
    EXPECT_EQ(second.openStatus(), SerialOpen::Busy);
    EXPECT_NE(second.openReason().find("cổng đang được chương trình khác dùng"), std::string::npos);
    EXPECT_STREQ(connectCodeName(ConnectCode::PortBusy), "PORT_BUSY");
    EXPECT_FALSE(second.isOpen());
    EXPECT_TRUE(first.isOpen());  // the port was not taken from the first
    // a plain open() with the exclusive mode on is refused as well (TIOCEXCL) unless root
    // closing the first releases the lock
    first.close();
    EXPECT_EQ(second.connect(pty.slave, 0, 1000), ConnectCode::Ok) << second.openReason();
}

TEST(SerialPort, Rs485AskedOnAPtyIsAWarningNotAnError) {
    Pty pty;
    SerialPort port(params(9600, 8, 'E', 1, /*rs485=*/true));
    ASSERT_EQ(port.connect(pty.slave, 0, 1000), ConnectCode::Ok);
    EXPECT_FALSE(port.rs485Active());
    const auto w = port.takeWarnings();
    ASSERT_EQ(w.size(), 1u);
    EXPECT_EQ(w[0], "RS485_UNSUPPORTED");
    EXPECT_TRUE(port.takeWarnings().empty());  // handed over once
    // the port works in the plain mode
    ASSERT_TRUE(port.writeAll(reinterpret_cast<const uint8_t*>("AB"), 2, 500));
    EXPECT_EQ(pty.readAll(), "AB");

    SerialPort plain(params(9600, 8, 'E', 1, /*rs485=*/false));
    Pty pty2;
    ASSERT_EQ(plain.connect(pty2.slave, 0, 1000), ConnectCode::Ok);
    EXPECT_TRUE(plain.takeWarnings().empty());
}

TEST(SerialPort, MissingPortIsAnError) {
    SerialPort port(params(9600, 8, 'E', 1));
    EXPECT_EQ(port.connect("/dev/does-not-exist-ttyAS9", 0, 1000), ConnectCode::PortError);
    EXPECT_EQ(port.openStatus(), SerialOpen::NotFound);
    EXPECT_FALSE(port.openReason().empty());
}

TEST(SerialPort, WriteAndReadThroughTheLine) {
    Pty pty;
    SerialPort port(params(9600, 8, 'N', 1));
    ASSERT_EQ(port.connect(pty.slave, 0, 1000), ConnectCode::Ok);
    const uint8_t out[] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x0A, 0xC5, 0xCD};
    ASSERT_TRUE(port.writeAll(out, sizeof out, 1000));
    EXPECT_EQ(pty.readAll(), std::string(reinterpret_cast<const char*>(out), sizeof out));
    EXPECT_EQ(port.bytesSent(), sizeof out);

    pty.write(std::string("\x01\x03\x02\x00\x01", 5));
    uint8_t in[64];
    const ReadResult r = port.read(in, sizeof in, 500);
    ASSERT_EQ(r.code, ReadCode::Data);
    EXPECT_EQ(r.n, 5u);
    EXPECT_EQ(in[0], 0x01);
    EXPECT_EQ(port.bytesReceived(), 5u);

    const int64_t t0 = nowMs();
    EXPECT_EQ(port.read(in, sizeof in, 80).code, ReadCode::Timeout);
    EXPECT_GE(nowMs() - t0, 70);
}

TEST(SerialPort, DiscardInputThrowsAwayWhatWaits) {
    Pty pty;
    SerialPort port(params(9600, 8, 'N', 1));
    ASSERT_EQ(port.connect(pty.slave, 0, 1000), ConnectCode::Ok);
    pty.write("stale bytes");
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
    EXPECT_EQ(port.discardInput(), 11u);
    uint8_t b[16];
    EXPECT_EQ(port.read(b, sizeof b, 30).code, ReadCode::Timeout);
}

TEST(SerialPort, WaitsForTheSilenceThenFlushesBeforeASend) {
    Pty pty;
    SerialPort port(params(9600, 8, 'N', 1));
    ASSERT_EQ(port.connect(pty.slave, 0, 1000), ConnectCode::Ok);
    // a late answer of the last request keeps arriving for ~30 ms
    std::thread noise([&] {
        pty.write("xx");
        std::this_thread::sleep_for(std::chrono::milliseconds(15));
        pty.write("yy");
    });
    const int64_t t0 = nowMs();
    const size_t thrown = waitLineQuiet(port, 25);
    const int64_t took = nowMs() - t0;
    noise.join();
    EXPECT_EQ(thrown, 4u);
    EXPECT_GE(took, 15 + 20);  // the second burst restarted the silence
    uint8_t b[16];
    EXPECT_EQ(port.read(b, sizeof b, 20).code, ReadCode::Timeout);
}

TEST(SerialPort, InterruptEndsAWaitAtOnce) {
    Pty pty;
    SerialPort port(params(9600, 8, 'N', 1));
    ASSERT_EQ(port.connect(pty.slave, 0, 1000), ConnectCode::Ok);
    std::thread t([&] {
        std::this_thread::sleep_for(std::chrono::milliseconds(30));
        port.interrupt();
    });
    uint8_t b[16];
    const int64_t t0 = nowMs();
    EXPECT_EQ(port.read(b, sizeof b, 5000).code, ReadCode::Interrupted);
    EXPECT_LT(nowMs() - t0, 1000);
    t.join();
    port.clearInterrupt();
    EXPECT_EQ(port.read(b, sizeof b, 20).code, ReadCode::Timeout);
}

TEST(SerialPort, LostDeviceShowsAsClosed) {
    Pty pty;
    SerialPort port(params(9600, 8, 'N', 1));
    ASSERT_EQ(port.connect(pty.slave, 0, 1000), ConnectCode::Ok);
    EXPECT_FALSE(port.peerClosed());
    ::close(pty.master);
    pty.master = -1;
    EXPECT_TRUE(port.peerClosed());
    uint8_t b[16];
    EXPECT_EQ(port.read(b, sizeof b, 200).code, ReadCode::Closed);
}

TEST(SerialPort, CloseReleasesTheLock) {
    Pty pty;
    {
        SerialPort a(params(9600, 8, 'N', 1));
        ASSERT_EQ(a.connect(pty.slave, 0, 1000), ConnectCode::Ok);
        a.close();
        EXPECT_FALSE(a.isOpen());
    }
    SerialPort b(params(9600, 8, 'N', 1));
    EXPECT_EQ(b.connect(pty.slave, 0, 1000), ConnectCode::Ok);
}

TEST(SerialPort, Rs485QueryOpensNothingUnlessProbing) {
    Pty pty;
    EXPECT_EQ(queryRs485(pty.slave, false), Rs485State::Unknown);
    // a pty has no RS485: the probe says so
    // (under qemu-user the ioctl is not emulated and the answer is "unknown")
    const Rs485State probed = queryRs485(pty.slave, true);
    EXPECT_TRUE(probed == Rs485State::Unsupported || probed == Rs485State::Unknown);
    EXPECT_STREQ(rs485StateName(Rs485State::Unsupported), "unsupported");
    // the probe does not hold the port
    SerialPort port(params(9600, 8, 'N', 1));
    EXPECT_EQ(port.connect(pty.slave, 0, 1000), ConnectCode::Ok);
}
