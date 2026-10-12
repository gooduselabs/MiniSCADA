// Serial port transport (feature 006 T160; research R13, R10; contracts/modbus-driver.md §3).
//
// Opening (FR-035): open(O_RDWR | O_NOCTTY | O_NONBLOCK | O_CLOEXEC), then ioctl(TIOCEXCL) and
// flock(LOCK_EX | LOCK_NB): a port another program holds is "busy" and is not taken. Raw termios
// (cfmakeraw, CLOCAL | CREAD, VMIN = VTIME = 0) with the speed and frame asked for; then, when the
// channel wants RS485, TIOCSRS485: ENOTTY (the driver has no RS485) is a warning RS485_UNSUPPORTED
// and the port works in the plain mode. Closing releases the lock.
//
// Every wait is a poll() on the port and on a self-pipe (interrupt()), like the TCP socket.
#pragma once
#include <termios.h>

#include <atomic>
#include <string>
#include <vector>

#include "drivers/sdk/transport.hpp"

namespace mat::drv {

struct SerialParams {
    int baud = 9600;    // 1200 ... 115200
    int dataBits = 8;   // 7 or 8
    char parity = 'E';  // 'N', 'E', 'O'
    int stopBits = 1;   // 1 or 2
    bool rs485 = true;  // ask the kernel for RS485 mode
};

// Raw mode with the speed and the frame of `p` (cfmakeraw, CLOCAL | CREAD, no flow control,
// VMIN = VTIME = 0) written into `tio`. false for a speed or a frame the port does not take. A pty
// forces its slave to 8 data bits and no parity, so the frame is tested on this function.
bool serialApplyParams(const SerialParams& p, termios& tio);

// True for a speed the port takes (the standard ones from 1200 to 115200).
bool serialBaudSupported(int baud);

enum class SerialOpen { None, Ok, Busy, NotFound, Denied, Error };

class SerialPort : public Transport {
   public:
    explicit SerialPort(SerialParams params);
    ~SerialPort() override;
    SerialPort(const SerialPort&) = delete;
    SerialPort& operator=(const SerialPort&) = delete;

    // `host` is the device path; `port` is not used. Busy and Error give ConnectCode::PortBusy and
    // PortError (openStatus() tells which of NotFound, Denied, Error).
    ConnectCode connect(const std::string& host, int port, int timeoutMs) override;
    bool isOpen() const override { return fd_ >= 0; }
    void close() override;
    // A port whose device went away (USB unplugged): POLLERR, POLLHUP or POLLNVAL.
    bool peerClosed() override;
    // tcflush(TCIFLUSH): what the port received and nobody read.
    size_t discardInput() override;
    // Writes everything, then waits until it left the port (tcdrain), within `timeoutMs`.
    bool writeAll(const uint8_t* data, size_t n, int timeoutMs) override;
    ReadResult read(uint8_t* buf, size_t max, int timeoutMs) override;
    void interrupt() override;
    void clearInterrupt() override;
    uint64_t bytesSent() const override { return sent_.load(); }
    uint64_t bytesReceived() const override { return received_.load(); }
    std::vector<std::string> takeWarnings() override;

    SerialOpen openStatus() const { return status_; }
    // Why the last connect() failed, in Vietnamese ("cổng đang được chương trình khác dùng").
    const std::string& openReason() const { return reason_; }
    // true: RS485 mode is on (TIOCSRS485 accepted).
    bool rs485Active() const { return rs485Active_; }
    int fd() const { return fd_; }  // for tests

   private:
    int waitFor(short events, int timeoutMs);

    SerialParams params_;
    int fd_ = -1;
    int wake_[2] = {-1, -1};
    std::atomic<bool> interrupted_{false};
    std::atomic<uint64_t> sent_{0};
    std::atomic<uint64_t> received_{0};
    SerialOpen status_ = SerialOpen::None;
    std::string reason_;
    bool rs485Active_ = false;
    std::vector<std::string> warnings_;
};

// RS485 state of a port, as the list of ports shows it. Opens the port for the length of the call
// (O_NONBLOCK | O_NOCTTY, no TIOCEXCL, no lock) and closes it.
//   enabled: TIOCGRS485 shows the flag on; supported: TIOCSRS485 with the same settings worked
//   (`set` true only); unsupported: ENOTTY; unknown: the port could not be opened or asked.
enum class Rs485State { Unknown, Enabled, Supported, Unsupported };
const char* rs485StateName(Rs485State s);
Rs485State queryRs485(const std::string& devicePath, bool probe);

}  // namespace mat::drv
