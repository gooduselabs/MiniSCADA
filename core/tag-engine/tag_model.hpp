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
#include "drivers/bacnet/address.hpp"
#include "drivers/fins/address.hpp"
#include "drivers/mc/mc_address.hpp"
#include "drivers/modbus/address.hpp"
#include "drivers/modbus/codec.hpp"
#include "drivers/mqtt/address.hpp"
#include "drivers/opcua/node_id.hpp"
#include "drivers/s7/address.hpp"
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
    s7::Address s7addr;          // feature 016: the address of a Tag of an S7 channel
    // Feature 018: a Tag of an Omron FINS field device (addr is then not used)
    fins::Address finsAddr;
    bool bcd = false;
    mc::McAddress mcAddr;  // feature 017: the address of a Tag of an "mc" channel
    // Feature 020: a Tag of a BACnet device (addr is then not used)
    bacnet::Address bacnetAddr;
    opcua::NodeIdRef nodeId;  // feature 019: the NodeId of a Tag of an OPC UA channel
    mqtt::Address mqttAddr;  // feature 022: topic, JSON path, direction of a Tag of an MQTT channel
};

struct TagModel {
    std::string id;
    TagKind kind = TagKind::Simulation;
    TagType type = TagType::FLOAT64;
    std::string description, unit;
    std::optional<double> min, max;  // display range
    bool writable = false;           // access RW
    // Feature 011 (T209, format 1.0): the least role that may write the Tag ("engineer",
    // "administrator"; "operator" or "" for none: any role that may write at all).
    std::string writeMinRole;
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
    // Feature 011 (logic v2, contract §1): an output of logic.json, declared as an internal Tag
    // that only its block sets; a write through the API is refused OWNED_BY_LOGIC.
    bool logicOwned = false;

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
    int maxGapBytes = 16;  // S7 (feature 016)
    // Feature 018, Omron FINS: the destination (network, node 0 = automatic, unit) and the read
    // plan
    int finsNetwork = 0, finsNode = 0, finsUnit = 0;
    int maxReadWords = 999, maxGapWords = 10;
    bool multiRead = true;
    int maxMultiItems = 64;
    // Mitsubishi MC (feature 017)
    int network = 0, station = 255, moduleIo = 0x03FF, moduleStation = 0;
    bool xyOctal = false;
    int maxBatchWords = 960;  // maxGapWords above, shared (the MC parser sets 16)
    bool randomRead = true;
    int maxRandomPoints = 192;
    // Feature 020, BACnet/IP: the device (instance, IP or name, port, router network and MAC in
    // hex) and how it is read and written
    uint32_t bacnetInstance = 0;
    std::string bacnetHost, bacnetMac;
    int bacnetPort = 47808, bacnetNetwork = 0, bacnetMaxApdu = 1476, bacnetWritePriority = 16;
    bool bacnetUseRpm = true;
    int bacnetMaxRpmProps = 32;
    // Feature 022, MQTT: no message for this long makes a subscribed Tag UNCERTAIN (0: never)
    int64_t mqttStaleAfterMs = 0;
};

// Feature 022: a publish group of an MQTT channel (mqtt.publishGroups[i]).
struct MqttGroupModel {
    std::string topic;
    std::vector<std::string> tags;  // Tag ids
    int64_t intervalMs = 0;
    bool onChange = false;
    int qos = 0;
    bool retain = false;
};

struct ChannelModel {
    std::string id, name;
    std::string kind = "modbus-tcp";  // modbus-tcp | modbus-rtu | s7 (016) | fins (018) | mc (017)
                                      // | bacnet (020) | opcua (019) | mqtt (022)
    bool rtu = false;
    bool isFins = false;  // feature 018: an Omron FINS channel (host, port, the fields below)
    bool finsTcp = false;
    int finsSourceNetwork = 0, finsSourceNode = 0, finsLocalPort = 0;
    // Feature 020: a BACnet/IP channel (port = the local UDP port, the fields below)
    bool isBacnet = false;
    std::string bacnetBindAddress, bacnetBroadcast = "255.255.255.255", bacnetBbmdHost;
    int bacnetBbmdPort = 47808, bacnetBbmdTtlS = 300;
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
    // S7 (feature 016): TSAPs (from rack/slot or given) and the PDU size asked for
    int s7LocalTsap = 0x0100;
    int s7RemoteTsap = 0x0101;
    int s7PduSize = 480;
    // Mitsubishi MC (feature 017): `mc` of the channel
    std::string mcFrame = "3E", mcCode = "binary", mcTransport = "tcp";
    // OPC UA (feature 019, contracts/opcua.md §1); connectTimeoutMs and reconnectMaxS above
    std::string opcuaEndpoint;
    std::string opcuaSecurityMode = "None";    // None | Sign | SignAndEncrypt
    std::string opcuaSecurityPolicy = "None";  // None | Basic256Sha256
    std::string opcuaServerCertSha256;         // pinned, "" none
    bool opcuaAuthUsername = false;
    std::string opcuaUsername, opcuaSecretId;
    bool opcuaPoll = false;  // readMode poll
    int opcuaSessionTimeoutMs = 60000;
    // MQTT (feature 022, specs/022-driver-mqtt/spec.md); host, port, connectTimeoutMs and
    // reconnectMaxS above
    std::string mqttClientId;
    int mqttKeepAliveS = 30;
    bool mqttCleanSession = true;
    bool mqttTls = false;
    std::string mqttServerCertSha256, mqttCaCertPem, mqttServerName;
    bool mqttAuth = false;
    std::string mqttUsername, mqttSecretId;
    bool mqttWill = false;
    std::string mqttWillTopic, mqttWillPayload;
    int mqttWillQos = 0;
    bool mqttWillRetain = false;
    int mqttMaxPublishPerS = 20;
    std::vector<MqttGroupModel> mqttGroups;
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
