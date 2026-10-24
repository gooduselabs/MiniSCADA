// Diagnostics counters of a driver (FR-029, contracts/modbus-driver.md §9, data-model §7). Counted
// since the runtime started and never reset (D28). Any thread may take a snapshot while the driver
// thread counts: one mutex guards the numbers, the snapshot is a consistent copy.
#pragma once
#include <cstdint>
#include <map>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

namespace mat::drv {

struct BadFrameCounts {
    uint64_t crc = 0, format = 0, tid = 0, unit = 0, length = 0, echo = 0;
};

struct WriteCounts {
    uint64_t confirmed = 0, failed = 0, timeout = 0, rejected = 0;
};

struct GroupDiag {
    std::string name;  // fast | normal | slow
    int64_t periodMs = 0;
    double actualAvgMs = 0;  // actual period: between two round starts, last 60 s
    int64_t actualMaxMs = 0;
    uint64_t overruns = 0;
    bool overloaded = false;  // average > 110 % of the set period
};

struct DeviceDiag {
    std::string id;
    std::string state;  // active | suspended | error | disabled
    uint64_t requestsOk = 0;
    uint64_t timeouts = 0;
    std::map<int, uint64_t> exceptions;  // by exception code
    BadFrameCounts badFrames;
    double responseAvgMs = 0;   // EWMA
    int64_t responseMaxMs = 0;  // largest in the last 60 s
    WriteCounts writes;
    std::vector<GroupDiag> groups;
};

struct ChannelDiag {
    std::string id;
    std::string state;  // disabled | connecting | connected | error | opening
    std::string lastErrorCode;
    int64_t lastErrorAt = 0;      // UTC ms
    std::string lastErrorDevice;  // the field device the error came from, "" when it is the channel
    uint64_t reconnects = 0;
    std::vector<std::string> warnings;  // RS485_UNSUPPORTED ...
    // Driver specific facts of the connection, shown as they are (feature 016: the PDU size and the
    // TSAPs of an S7 connection). Empty for Modbus.
    std::vector<std::pair<std::string, std::string>> details;
};

struct DriverDiag {
    ChannelDiag channel;
    std::vector<DeviceDiag> devices;
};

enum class BadFrameKind { Crc, Format, Tid, Unit, Length, Echo };
enum class WriteOutcome { Confirmed, Failed, Timeout, Rejected };

class DiagCounters {
   public:
    // `devices`: field device ids in a fixed order (the index is the device number of the driver).
    DiagCounters(std::string channelId, std::vector<std::string> devices);

    void setChannelState(const std::string& state);
    void setLastError(const std::string& code, int64_t atMs, const std::string& device = "");
    void onReconnect();
    void addWarning(const std::string& code);
    void setDetails(std::vector<std::pair<std::string, std::string>> details);

    void setDeviceState(size_t device, const std::string& state);
    void onRequestOk(size_t device, int64_t responseMs, int64_t nowMs);
    void onTimeout(size_t device);
    void onException(size_t device, int code);
    void onBadFrame(size_t device, BadFrameKind kind);
    void onWrite(size_t device, WriteOutcome outcome);

    // Consistent copy; the caller fills `groups` from the scheduler.
    DriverDiag snapshot(int64_t nowMs) const;

   private:
    struct Dev {
        DeviceDiag d;
        bool haveAvg = false;
        // largest response per second of the last 60 s: (second, max)
        int64_t bucketSec[60] = {0};
        int64_t bucketMax[60] = {0};
    };
    mutable std::mutex mu_;
    ChannelDiag channel_;
    std::vector<Dev> devs_;
};

}  // namespace mat::drv
