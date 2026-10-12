#include "drivers/sdk/transport.hpp"

#include <chrono>

namespace mat::drv {

const char* connectCodeName(ConnectCode c) {
    switch (c) {
        case ConnectCode::Ok:
            return "OK";
        case ConnectCode::Refused:
            return "REFUSED";
        case ConnectCode::Timeout:
            return "TIMEOUT";
        case ConnectCode::Unreachable:
            return "UNREACHABLE";
        case ConnectCode::Dns:
            return "DNS";
        case ConnectCode::Interrupted:
            return "INTERRUPTED";
        case ConnectCode::Error:
            return "ERROR";
        case ConnectCode::PortBusy:
            return "PORT_BUSY";
        case ConnectCode::PortError:
            return "PORT_ERROR";
    }
    return "ERROR";
}

size_t waitLineQuiet(Transport& t, int silenceMs) {
    size_t thrown = 0;
    uint8_t buf[256];
    for (int i = 0; i < 200; ++i) {
        const ReadResult r = t.read(buf, sizeof buf, silenceMs);
        if (r.code != ReadCode::Data) break;
        thrown += r.n;
    }
    return thrown + t.discardInput();
}

int64_t SystemClock::monoMs() const {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

int64_t SystemClock::wallMs() const {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

}  // namespace mat::drv
