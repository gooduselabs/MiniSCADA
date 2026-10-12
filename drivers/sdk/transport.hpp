// Transport and clock of the drivers (feature 006 T098, ADR-014). A driver talks to its device
// through a Transport and reads time from a Clock, so that the tests run it on a fake network and a
// fake clock (reconnect waits, timeouts) without sleeping, and the real TcpSocket (and, later, the
// serial port) plug in the same way. All blocking calls have a time limit and `interrupt()` wakes
// them from another thread (stop()).
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>

namespace mat::drv {

enum class ConnectCode { Ok, Refused, Timeout, Unreachable, Dns, Interrupted, Error };
// "OK", "REFUSED", "TIMEOUT", "UNREACHABLE", "DNS", "INTERRUPTED", "ERROR": the codes of the
// diagnostics and of the connection test.
const char* connectCodeName(ConnectCode c);

enum class ReadCode { Data, Timeout, Closed, Interrupted, Error };
struct ReadResult {
    ReadCode code = ReadCode::Error;
    size_t n = 0;  // bytes read, with Data
};

class Transport {
   public:
    virtual ~Transport() = default;
    // Opens the connection, waiting at most `timeoutMs`. The object can connect again after
    // close().
    virtual ConnectCode connect(const std::string& host, int port, int timeoutMs) = 0;
    virtual bool isOpen() const = 0;
    virtual void close() = 0;
    // While nothing is being exchanged: the other side closed the connection or it failed. Bytes
    // that are waiting are not a close.
    virtual bool peerClosed() = 0;
    // Throws away what is waiting to be read; returns how many bytes.
    virtual size_t discardInput() = 0;
    // Sends all `n` bytes within `timeoutMs`; false when the connection failed.
    virtual bool writeAll(const uint8_t* data, size_t n, int timeoutMs) = 0;
    // Waits up to `timeoutMs` for at least one byte and reads at most `max`.
    virtual ReadResult read(uint8_t* buf, size_t max, int timeoutMs) = 0;
    // Any thread: blocking calls return Interrupted until clearInterrupt().
    virtual void interrupt() = 0;
    virtual void clearInterrupt() = 0;
    virtual uint64_t bytesSent() const = 0;
    virtual uint64_t bytesReceived() const = 0;
};

class Clock {
   public:
    virtual ~Clock() = default;
    virtual int64_t monoMs() const = 0;  // never goes back
    virtual int64_t wallMs() const = 0;  // UTC, epoch ms
};

class SystemClock : public Clock {
   public:
    int64_t monoMs() const override;
    int64_t wallMs() const override;
};

}  // namespace mat::drv
