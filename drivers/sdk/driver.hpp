// Driver SDK (ADR-014, contracts/modbus-driver.md §1, research R7). Declarations only.
//
// Boundary (Constitution II, FR-023): a driver only calls EngineSink::publish(TagUpdate...) and
// EngineSink::writeDone(WriteResult). It writes no database, sends nothing to a client and does not
// know TagStore. Values it publishes are decoded to the raw type; scaling and deadband are the
// engine's work. One Driver per channel, one thread per channel (the simulation driver has no
// thread: the engine calls step(now) on every round, and it still publishes only through the sink).
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "core/tag-engine/tag_store.hpp"
#include "drivers/modbus/address.hpp"
#include "drivers/modbus/codec.hpp"
#include "drivers/sdk/diag.hpp"

namespace mat::drv {

enum class ScanGroup { Fast = 0, Normal = 1, Slow = 2 };

// How a bit inside a holding register is written (field device `write.registerBit`).
enum class BitWrite { None, Mask, ReadModifyWrite };

// A Tag of a field device as the driver needs it (data-model §1, §2): resolved by the engine.
struct TagBinding {
    size_t tag = 0;       // index in the TagStore
    uint32_t device = 0;  // field device number inside the driver
    modbus::Area area = modbus::Area::HR;
    int offset = 0;  // offset sent on the wire (addressBase already subtracted)
    int count = 1;   // registers (HR, IR) or bits (C, DI) taken
    int bit = -1;    // bit inside the register (0-15), -1 none
    TagType rawType = TagType::UINT16;
    modbus::ByteOrder byteOrder = modbus::ByteOrder::ABCD;
    modbus::StringByteOrder stringOrder = modbus::StringByteOrder::AB;
    int stringLength = 0;
    ScanGroup group = ScanGroup::Normal;
    bool readback = true;
    BitWrite bitWrite = BitWrite::None;
    bool writeSingleRegisterFc16 = false;  // device `write.singleRegister` = fc16
    bool writeSingleCoilFc15 = false;      // device `write.singleCoil` = fc15
};

struct TagUpdate {
    size_t tag = 0;
    // Raw value decoded by `rawType` (int64_t, uint64_t, double, bool, string); monostate: no value
    // (a BAD update: the engine keeps the Tag's last value).
    TagScalar value;
    Quality quality = Quality::GOOD;
    std::string reason;    // for a quality other than GOOD (data-model §6)
    int64_t sourceTs = 0;  // when the response arrived (UTC ms)
    // The value read back after a write: the engine publishes it whatever the deadband (FR-038).
    bool afterWrite = false;
};

struct WriteCommand {
    uint64_t id = 0;  // internal id (not the client's request id)
    size_t tag = 0;
    TagScalar raw;              // after inverse scaling, range checked
    int64_t deadlineMs = 5000;  // how long the command may wait in the queue
    bool readback = true;
};

enum class WriteStatus { Confirmed, NoReadback, Failed, Timeout };

struct WriteResult {
    uint64_t id = 0;
    WriteStatus status = WriteStatus::Failed;
    // APPLIED (simulation, internal), CONFIRMED, NO_READBACK, NOT_SENT_*, WRITE_TIMEOUT,
    // DEVICE_EXCEPTION, READBACK_MISMATCH, READBACK_ERROR, READBACK_TIMEOUT
    std::string code;
    TagScalar readback;  // raw value read back, when there is one
    int exception = -1;  // Modbus exception code, when there is one
};

class EngineSink {
   public:
    virtual ~EngineSink() = default;
    virtual void publish(std::vector<TagUpdate>&& updates) = 0;
    virtual void writeDone(WriteResult&& result) = 0;
};

enum class ChannelState { Disabled, Connecting, Opening, Connected, Error };
enum class DeviceState { Active, Suspended, Error, Disabled };

// Read atomically from an HTTP thread (FR-037 step 5).
struct LinkState {
    ChannelState channel = ChannelState::Disabled;
    DeviceState device = DeviceState::Disabled;
};

struct TestRequest {
    std::string channelId;  // empty: a temporary connection described by the fields below
    std::string host;
    int port = 502;
    std::string serialPort;
    int unit = 1;
    // optional read of one address (1-4 registers or 1-16 bits)
    bool read = false;
    std::string address;
    int count = 1;
};

struct TestOutcome {
    std::string code;  // OK, REFUSED, TIMEOUT, UNREACHABLE, DNS, PORT_BUSY, PORT_CONSOLE, ...
    int64_t elapsedMs = 0;
    int exception = -1;
    std::vector<uint8_t> requestFrame;
    std::vector<uint8_t> responseFrame;
    std::vector<uint16_t> registers;
    std::vector<uint8_t> bits;
};

class Driver {
   public:
    virtual ~Driver() = default;
    // Starts the channel thread (none for the simulation driver). The sink outlives the driver.
    virtual void start(EngineSink& sink) = 0;
    // Stops and joins; after it returns nothing more is published or written.
    virtual void stop() = 0;
    // Called by the engine on every round by drivers without a thread (simulation); others ignore
    // it.
    virtual void step(int64_t /*nowMs*/) {}
    // false: the queue is full (the caller answers QUEUE_FULL).
    virtual bool enqueueWrite(WriteCommand cmd) = 0;
    virtual LinkState linkState(uint32_t device) const = 0;
    virtual void diagnostics(DriverDiag& out, int64_t nowMs) const = 0;
    virtual TestOutcome test(const TestRequest& req) = 0;
};

}  // namespace mat::drv
