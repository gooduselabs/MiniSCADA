#include "drivers/sdk/serial_port.hpp"

#include <fcntl.h>
#include <linux/serial.h>
#include <poll.h>
#include <sys/file.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstring>

namespace mat::drv {

namespace {

int64_t monoMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

void closeFd(int& fd) {
    if (fd >= 0) ::close(fd);
    fd = -1;
}

speed_t speedOf(int baud) {
    switch (baud) {
        case 1200:
            return B1200;
        case 2400:
            return B2400;
        case 4800:
            return B4800;
        case 9600:
            return B9600;
        case 19200:
            return B19200;
        case 38400:
            return B38400;
        case 57600:
            return B57600;
        case 115200:
            return B115200;
        default:
            return 0;
    }
}

}  // namespace

bool serialBaudSupported(int baud) { return speedOf(baud) != 0; }

bool serialApplyParams(const SerialParams& p, termios& tio) {
    const speed_t speed = speedOf(p.baud);
    if (speed == 0 || (p.dataBits != 7 && p.dataBits != 8) ||
        (p.stopBits != 1 && p.stopBits != 2) ||
        (p.parity != 'N' && p.parity != 'E' && p.parity != 'O'))
        return false;
    ::cfmakeraw(&tio);
    tio.c_cflag &= ~static_cast<tcflag_t>(CSIZE | PARENB | PARODD | CSTOPB | CRTSCTS);
    tio.c_cflag |= CLOCAL | CREAD | (p.dataBits == 7 ? CS7 : CS8);
    if (p.parity != 'N') tio.c_cflag |= PARENB;
    if (p.parity == 'O') tio.c_cflag |= PARODD;
    if (p.stopBits == 2) tio.c_cflag |= CSTOPB;
    tio.c_iflag &= ~static_cast<tcflag_t>(IXON | IXOFF | IXANY);
    tio.c_cc[VMIN] = 0;
    tio.c_cc[VTIME] = 0;
    ::cfsetispeed(&tio, speed);
    ::cfsetospeed(&tio, speed);
    return true;
}

const char* rs485StateName(Rs485State s) {
    switch (s) {
        case Rs485State::Enabled:
            return "enabled";
        case Rs485State::Supported:
            return "supported";
        case Rs485State::Unsupported:
            return "unsupported";
        case Rs485State::Unknown:
            break;
    }
    return "unknown";
}

Rs485State queryRs485(const std::string& devicePath, bool probe) {
    if (!probe) return Rs485State::Unknown;  // the list of ports opens nothing
    const int fd = ::open(devicePath.c_str(), O_RDWR | O_NOCTTY | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) return Rs485State::Unknown;
    Rs485State result = Rs485State::Unknown;
    serial_rs485 rs{};
    if (::ioctl(fd, TIOCGRS485, &rs) == 0) {
        if (rs.flags & SER_RS485_ENABLED) {
            result = Rs485State::Enabled;
        } else if (::ioctl(fd, TIOCSRS485, &rs) == 0) {  // the settings it has, put back
            result = Rs485State::Supported;
        } else {
            result = errno == ENOTTY ? Rs485State::Unsupported : Rs485State::Unknown;
        }
    } else if (errno == ENOTTY) {
        result = Rs485State::Unsupported;
    }
    ::close(fd);
    return result;
}

SerialPort::SerialPort(SerialParams params) : params_(params) {
    if (::pipe2(wake_, O_CLOEXEC | O_NONBLOCK) != 0) wake_[0] = wake_[1] = -1;
}

SerialPort::~SerialPort() {
    close();
    closeFd(wake_[0]);
    closeFd(wake_[1]);
}

void SerialPort::close() {
    if (fd_ >= 0) {
        ::ioctl(fd_, TIOCNXCL);  // the exclusive mode would outlive the descriptor on some ttys
        ::flock(fd_, LOCK_UN);   // the lock goes with the descriptor anyway
        closeFd(fd_);
    }
}

void SerialPort::interrupt() {
    interrupted_ = true;
    if (wake_[1] >= 0) {
        const char b = 1;
        const ssize_t n = ::write(wake_[1], &b, 1);
        (void)n;
    }
}

void SerialPort::clearInterrupt() {
    interrupted_ = false;
    if (wake_[0] < 0) return;
    char buf[16];
    while (::read(wake_[0], buf, sizeof buf) > 0) {
    }
}

int SerialPort::waitFor(short events, int timeoutMs) {
    const int64_t end = monoMs() + std::max(0, timeoutMs);
    for (;;) {
        if (interrupted_) return -1;
        pollfd p[2] = {{fd_, events, 0}, {wake_[0], POLLIN, 0}};
        const int64_t left = end - monoMs();
        const int r =
            ::poll(p, wake_[0] >= 0 ? 2 : 1, static_cast<int>(std::max<int64_t>(0, left)));
        if (r < 0) {
            if (errno == EINTR) continue;
            return -2;
        }
        if (r == 0) return 0;
        if (interrupted_ || (wake_[0] >= 0 && (p[1].revents & POLLIN))) return -1;
        if (p[0].revents & (POLLERR | POLLNVAL)) return -2;
        if (p[0].revents & POLLHUP && !(p[0].revents & events)) return -2;
        return 1;
    }
}

ConnectCode SerialPort::connect(const std::string& host, int /*port*/, int /*timeoutMs*/) {
    close();
    warnings_.clear();
    rs485Active_ = false;
    reason_.clear();
    status_ = SerialOpen::None;
    if (interrupted_) return ConnectCode::Interrupted;
    termios tio{};
    if (!serialApplyParams(params_, tio)) {
        status_ = SerialOpen::Error;
        reason_ = "tham số cổng serial không hợp lệ";
        return ConnectCode::PortError;
    }
    // A pseudo-terminal (the tests, never a device) takes no data bits or parity: its slave is
    // forced to 8 bits, no parity, and a second set of parity bits on it is refused (EINVAL).
    if (host.compare(0, 9, "/dev/pts/") == 0) {
        SerialParams plain = params_;
        plain.dataBits = 8;
        plain.parity = 'N';
        serialApplyParams(plain, tio);
    }

    const int fd = ::open(host.c_str(), O_RDWR | O_NOCTTY | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) {
        const int err = errno;
        if (err == EBUSY) {
            status_ = SerialOpen::Busy;
            reason_ = "cổng đang được chương trình khác dùng";
            return ConnectCode::PortBusy;
        }
        if (err == ENOENT || err == ENODEV || err == ENXIO) {
            status_ = SerialOpen::NotFound;
            reason_ = "không có cổng này";
        } else if (err == EACCES || err == EPERM) {
            status_ = SerialOpen::Denied;
            reason_ = "không có quyền mở cổng";
        } else {
            status_ = SerialOpen::Error;
            reason_ = std::string("không mở được cổng: ") + std::strerror(err);
        }
        return ConnectCode::PortError;
    }
    // An advisory lock keeps two channels, or a channel and a test, off the same port; it is taken
    // first so that a port another program holds is not made exclusive by us. Then exclusive: once
    // we have the port nobody else opens it.
    if (::flock(fd, LOCK_EX | LOCK_NB) != 0) {
        const bool busy = errno == EWOULDBLOCK;
        ::close(fd);
        status_ = busy ? SerialOpen::Busy : SerialOpen::Error;
        reason_ = busy ? "cổng đang được chương trình khác dùng" : "không khóa được cổng";
        return busy ? ConnectCode::PortBusy : ConnectCode::PortError;
    }
    if (::ioctl(fd, TIOCEXCL) != 0 && errno == EBUSY) {
        ::close(fd);
        status_ = SerialOpen::Busy;
        reason_ = "cổng đang được chương trình khác dùng";
        return ConnectCode::PortBusy;
    }

    if (!::isatty(fd)) {
        ::close(fd);
        status_ = SerialOpen::Error;
        reason_ = "đây không phải cổng serial";
        return ConnectCode::PortError;
    }
    // The termios is made whole from the parameters, not from what the port had: a port that was
    // used before (a pty, a USB adapter) keeps flags that make an old struct refused.
    if (::tcsetattr(fd, TCSANOW, &tio) != 0) {
        const int err = errno;
        ::close(fd);
        status_ = SerialOpen::Error;
        reason_ = std::string("không đặt được tham số cổng: ") + std::strerror(err);
        return ConnectCode::PortError;
    }
    if (params_.rs485) {
        serial_rs485 rs{};
        if (::ioctl(fd, TIOCGRS485, &rs) != 0) std::memset(&rs, 0, sizeof rs);
        rs.flags |= SER_RS485_ENABLED | SER_RS485_RTS_ON_SEND;
        rs.flags &= ~static_cast<__u32>(SER_RS485_RTS_AFTER_SEND);
        if (::ioctl(fd, TIOCSRS485, &rs) == 0)
            rs485Active_ = true;
        else
            warnings_.push_back("RS485_UNSUPPORTED");  // the plain mode goes on
    }
    ::tcflush(fd, TCIOFLUSH);
    fd_ = fd;
    status_ = SerialOpen::Ok;
    return ConnectCode::Ok;
}

bool SerialPort::peerClosed() {
    if (fd_ < 0) return true;
    pollfd p{fd_, 0, 0};
    if (::poll(&p, 1, 0) <= 0) return false;
    return (p.revents & (POLLERR | POLLHUP | POLLNVAL)) != 0;
}

size_t SerialPort::discardInput() {
    if (fd_ < 0) return 0;
    int waiting = 0;
    if (::ioctl(fd_, TIOCINQ, &waiting) != 0) waiting = 0;
    ::tcflush(fd_, TCIFLUSH);
    return waiting > 0 ? static_cast<size_t>(waiting) : 0;
}

bool SerialPort::writeAll(const uint8_t* data, size_t n, int timeoutMs) {
    if (fd_ < 0) return false;
    const int64_t end = monoMs() + std::max(0, timeoutMs);
    size_t done = 0;
    while (done < n) {
        const ssize_t w = ::write(fd_, data + done, n - done);
        if (w > 0) {
            done += static_cast<size_t>(w);
            sent_ += static_cast<uint64_t>(w);
            continue;
        }
        if (w < 0 && errno == EINTR) continue;
        if (w < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            const int r = waitFor(POLLOUT, static_cast<int>(std::max<int64_t>(0, end - monoMs())));
            if (r > 0) continue;
        }
        return false;
    }
    // Until the bytes left the output queue (tcdrain has no time limit, so the queue is polled).
    for (;;) {
        int pending = 0;
        if (::ioctl(fd_, TIOCOUTQ, &pending) != 0 || pending <= 0) break;
        const int64_t left = end - monoMs();
        if (left <= 0) return false;
        if (waitFor(0, 1) == -1) return false;  // 1 ms, or interrupted
    }
    return true;
}

ReadResult SerialPort::read(uint8_t* buf, size_t max, int timeoutMs) {
    ReadResult out;
    if (fd_ < 0) {
        out.code = ReadCode::Closed;
        return out;
    }
    const int64_t end = monoMs() + std::max(0, timeoutMs);
    for (;;) {
        const int w = waitFor(POLLIN, static_cast<int>(std::max<int64_t>(0, end - monoMs())));
        if (w == 0) {
            out.code = ReadCode::Timeout;
            return out;
        }
        if (w == -1) {
            out.code = ReadCode::Interrupted;
            return out;
        }
        if (w < 0) {
            out.code = ReadCode::Closed;  // the device went away (POLLERR, POLLHUP)
            return out;
        }
        const ssize_t n = ::read(fd_, buf, max);
        if (n > 0) {
            received_ += static_cast<uint64_t>(n);
            out.code = ReadCode::Data;
            out.n = static_cast<size_t>(n);
            return out;
        }
        if (n == 0) continue;  // VMIN = 0: nothing there after all
        if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) continue;
        out.code = errno == EIO ? ReadCode::Closed : ReadCode::Error;
        return out;
    }
}

std::vector<std::string> SerialPort::takeWarnings() {
    std::vector<std::string> w;
    w.swap(warnings_);
    return w;
}

}  // namespace mat::drv
