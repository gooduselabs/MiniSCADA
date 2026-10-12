// Tag model of the runtime (feature 006 T045; data-model §1-§5): the Tags, channels, field devices
// and value tables of a validated project, resolved: defaults applied, addresses parsed, devices
// found. A 0.1 project becomes Tags of kind simulation with the `legacy` generator in memory; its
// files and digest do not change (ADR-004, research R3).
#pragma once
#include <array>
#include <optional>
#include <string>
#include <vector>

#include "core/expression/expression.hpp"
#include "core/project-manager/project_validator.hpp"
#include "core/tag-engine/scaling.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "drivers/modbus/address.hpp"
#include "drivers/modbus/codec.hpp"
#include "drivers/sdk/driver.hpp"
#include "drivers/simulation/sim_generators.hpp"

namespace mat {

enum class TagKind { External, Internal, Calculated, Simulation };

struct TagLimits {
    std::optional<double> min, max;
    std::optional<int> maxLength;
};

struct TagSourceModel {
    std::string device;
    std::string address;
    drv::ScanGroup group = drv::ScanGroup::Normal;
    TagType rawType = TagType::FLOAT64;
    modbus::ByteOrder byteOrder = modbus::ByteOrder::ABCD;
    modbus::StringByteOrder stringOrder = modbus::StringByteOrder::AB;
    int stringLength = 0;
    bool readback = true;
    modbus::AddressResult addr;  // parsed with the field device's addressBase
};

struct TagModel {
    std::string id;
    TagKind kind = TagKind::Simulation;
    TagType type = TagType::FLOAT64;
    std::string description, unit;
    std::optional<double> min, max;  // display range
    bool writable = false;           // access RW
    TagLimits limits;
    std::string valueTable;
    std::optional<double> deadband;

    // external
    TagSourceModel source;
    std::optional<Scaling> scaling;
    size_t channel = static_cast<size_t>(-1);  // index in ProjectModel::channels
    size_t device = static_cast<size_t>(-1);   // index in ProjectModel::devices
    bool disabled = false;                     // channel or field device disabled in the project

    // internal
    TagScalar initial;
    bool retain = false;

    // calculated
    std::string expression;

    // simulation
    std::optional<sim::SimConfig> sim;
};

struct DeviceModel {
    std::string id, name;
    size_t channel = 0;
    int unitId = 1;  // unitId (TCP) or slave (RTU)
    bool enabled = true;
    int addressBase = 0;
    int maxReadRegisters = 125, maxReadBits = 2000;
    int maxGapRegisters = 10, maxGapBits = 64;
    modbus::ByteOrder byteOrder = modbus::ByteOrder::ABCD;
    int timeoutMs = 1000;
    int retries = 0;
    int writeDeadlineMs = 5000;
    bool singleRegisterFc16 = false;  // write.singleRegister = fc16
    bool singleCoilFc15 = false;      // write.singleCoil = fc15
    drv::BitWrite bitWrite = drv::BitWrite::None;
};

struct ChannelModel {
    std::string id, name;
    bool rtu = false;
    bool enabled = true;
    std::string host;
    int port = 502;
    int connectTimeoutMs = 3000;
    int reconnectMaxS = 10;
    std::string serialPort;
    int baud = 9600, dataBits = 8, stopBits = 1;
    std::string parity = "even";
    bool rs485 = true, dropEcho = false;
    int silenceMs = 0;  // 0: derive from the speed (t3.5)
    int requestGapMs = 0;
    std::vector<size_t> devices;  // indexes in ProjectModel::devices
};

struct ProjectModel {
    bool legacy01 = false;  // a 0.1 project: every Tag is a `legacy` simulation Tag
    std::vector<TagModel> tags;
    std::vector<ChannelModel> channels;
    std::vector<DeviceModel> devices;
    std::array<int, 3> scanGroupMs = {250, 1000, 5000};  // fast, normal, slow
    expr::TableSet tables;                               // value tables by name

    std::optional<size_t> tagIndex(const std::string& id) const;
};

// Reads the model from a validated project (0.1 or 0.2). nullopt with *error on a document the
// validator would not have let through.
std::optional<ProjectModel> buildProjectModel(const LoadedProject& project,
                                              std::string* error = nullptr);

const char* tagKindName(TagKind k);

}  // namespace mat
