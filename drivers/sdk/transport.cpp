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
    }
    return "ERROR";
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
