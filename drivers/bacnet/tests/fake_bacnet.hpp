// An in-memory BACnet/IP network for the driver tests (feature 020): a DatagramPort whose
// datagrams reach fake BACnet devices on a fake clock. A device answers ReadProperty,
// ReadPropertyMultiple, WriteProperty (with a priority array) and Who-Is from its object table;
// faults are switched on per device (drop, no RPM, a small max APDU, errors, wrong frames).
#pragma once
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "drivers/bacnet/address.hpp"
#include "drivers/bacnet/codec.hpp"
#include "drivers/bacnet/udp_port.hpp"
#include "drivers/sdk/transport.hpp"

namespace mat::bacnet::fake {

class FakeClock : public drv::Clock {
   public:
    int64_t monoMs() const override { return now; }
    int64_t wallMs() const override { return 1700000000000 + now; }
    int64_t now = 1000;
};

struct Object {
    ObjectId id;
    std::map<uint32_t, Value> props;
    // commandable present-value: 16 slots (nullopt: NULL) and the relinquish default
    bool commandable = false;
    std::optional<Value> priority[16];
    Value relinquishDefault;
};

struct Device {
    uint32_t instance = 1001;
    uint32_t ip = 0x0A000032;  // 10.0.0.50
    uint16_t port = kDefaultPort;
    int network = 0;  // behind a router: the answers carry SNET/SADR
    Bytes mac;
    std::map<uint32_t, Object> objects;  // by ObjectId::raw()
    // faults
    int dropNext = 0;  // requests not answered
    bool dropAll = false;
    bool noRpm = false;       // Reject unrecognized-service
    int maxApdu = 1476;       // a bigger answer is an Abort segmentation-not-supported
    int forceErrorCode = -1;  // every confirmed request answers Error (class 2) with this code
    bool segmentedObjectList = false;  // object-list without index: a segmented answer
    int latencyMs = 5;
    std::vector<uint8_t> invokeIds;  // of every confirmed request received
    std::vector<uint8_t> services;
    std::vector<Bytes> wpValues;  // the value data of each WriteProperty
    std::vector<int> wpPriorities;

    Object& add(uint32_t type, uint32_t instance, const Value& pv, bool commandable = false) {
        Object o;
        o.id = {type, instance};
        o.props[kPropPresentValue] = pv;
        o.props[kPropObjectName] =
            Value::charString(std::string(typeName(type)) + "-" + std::to_string(instance));
        Value flags;
        flags.tag = kTagBitString;
        flags.bitCount = 4;
        o.props[kPropStatusFlags] = flags;
        o.props[kPropOutOfService] = Value::boolean(false);
        if (isAnalog(type)) o.props[kPropUnits] = Value::enumerated(62);  // degrees-celsius
        o.commandable = commandable;
        o.relinquishDefault = pv;
        auto& slot = objects[o.id.raw()];
        slot = std::move(o);
        return slot;
    }
    void setFlags(uint32_t type, uint32_t instance, uint32_t bits) {
        objects[ObjectId{type, instance}.raw()].props[kPropStatusFlags].bits = bits;
    }
};

class Network {
   public:
    FakeClock clock;
    std::vector<std::shared_ptr<Device>> devices;
    std::deque<std::pair<int64_t, std::pair<Bytes, std::pair<uint32_t, uint16_t>>>> inbox;
    std::vector<Bytes> sent;
    int portsOpened = 0;
    bool portBusy = false;
    // extra datagrams delivered before the next answer (wrong frames)
    std::vector<std::pair<Bytes, std::pair<uint32_t, uint16_t>>> inject;

    std::shared_ptr<Device> add(uint32_t instance, uint32_t ip) {
        auto d = std::make_shared<Device>();
        d->instance = instance;
        d->ip = ip;
        Object dev;
        dev.id = {kDevice, instance};
        dev.props[kPropObjectName] = Value::charString("Device " + std::to_string(instance));
        d->objects[dev.id.raw()] = dev;
        devices.push_back(d);
        return d;
    }

    void deliver(const Bytes& b, uint32_t ip, uint16_t port, int latency) {
        inbox.push_back({clock.now + latency, {b, {ip, port}}});
    }

    void onSend(uint32_t ip, uint16_t port, const Bytes& b) {
        sent.push_back(b);
        for (auto& x : inject) deliver(x.first, x.second.first, x.second.second, 1);
        inject.clear();
        Frame f;
        if (!parseFrame(b, f)) return;
        if (b[1] == kBvlcRegisterForeignDevice) {
            deliver({0x81, 0x00, 0x00, 0x06, 0x00, 0x00}, ip, port, 1);
            return;
        }
        if (!f.hasApdu) return;
        const bool broadcast = b[1] == kBvlcOriginalBroadcast || b[1] == kBvlcDistributeBroadcast;
        for (auto& d : devices) {
            if (!broadcast && (d->ip != ip || d->port != port)) continue;
            if (f.pduType == kUnconfirmedRequest && f.service == kServiceWhoIs) {
                Bytes data;
                Value id;
                id.tag = kTagObjectId;
                id.obj = {kDevice, d->instance};
                encodeAppValue(data, id);
                encodeAppValue(data, Value::unsignedInt(static_cast<uint64_t>(d->maxApdu)));
                encodeAppValue(data, Value::enumerated(3));
                encodeAppValue(data, Value::unsignedInt(260));
                deliver(withSource(*d, buildUnconfirmed(kServiceIAm, data, kBvlcOriginalBroadcast)),
                        d->ip, d->port, d->latencyMs);
                continue;
            }
            if (f.pduType != kConfirmedRequest) continue;
            d->invokeIds.push_back(f.invokeId);
            d->services.push_back(f.service);
            if (d->dropAll) continue;
            if (d->dropNext > 0) {
                --d->dropNext;
                continue;
            }
            Bytes apdu = answer(*d, f);
            if (apdu.empty()) continue;
            deliver(withSource(*d, wrapApdu(apdu)), d->ip, d->port, d->latencyMs);
        }
    }

    // ---- the device's answers ----
    static Bytes wrapApdu(const Bytes& apdu) {
        Bytes npdu{0x01, 0x00};
        npdu.insert(npdu.end(), apdu.begin(), apdu.end());
        Bytes out{0x81, kBvlcOriginalUnicast, 0, 0};
        out.insert(out.end(), npdu.begin(), npdu.end());
        out[2] = static_cast<uint8_t>(out.size() >> 8);
        out[3] = static_cast<uint8_t>(out.size());
        return out;
    }
    // a device behind a router: the NPDU carries SNET / SADR
    static Bytes withSource(const Device& d, const Bytes& frame) {
        if (!d.network) return frame;
        Bytes out(frame.begin(), frame.begin() + 4);
        out.push_back(0x01);
        out.push_back(static_cast<uint8_t>(frame[5] | 0x08));
        out.push_back(static_cast<uint8_t>(d.network >> 8));
        out.push_back(static_cast<uint8_t>(d.network));
        out.push_back(static_cast<uint8_t>(d.mac.size()));
        out.insert(out.end(), d.mac.begin(), d.mac.end());
        out.insert(out.end(), frame.begin() + 6, frame.end());
        out[2] = static_cast<uint8_t>(out.size() >> 8);
        out[3] = static_cast<uint8_t>(out.size());
        return out;
    }
    static Bytes error(uint8_t invoke, uint8_t service, uint32_t cls, uint32_t code) {
        Bytes a{0x50, invoke, service};
        encodeAppValue(a, Value::enumerated(cls));
        encodeAppValue(a, Value::enumerated(code));
        return a;
    }

    static Value presentValue(const Object& o) {
        if (!o.commandable) return o.props.at(kPropPresentValue);
        for (const auto& p : o.priority)
            if (p) return *p;
        return o.relinquishDefault;
    }

    // The values of a property, or an error code.
    static int read(const Device& d, ObjectId id, uint32_t prop, int64_t index,
                    std::vector<Value>& out) {
        const auto it = d.objects.find(id.raw());
        if (it == d.objects.end()) return kErrUnknownObject;
        const Object& o = it->second;
        if (prop == kPropPresentValue && o.props.count(kPropPresentValue)) {
            out.push_back(presentValue(o));
            return -1;
        }
        if (prop == kPropPriorityArray && o.commandable) {
            if (index == 0) {
                out.push_back(Value::unsignedInt(16));
            } else if (index >= 1 && index <= 16) {
                const auto& s = o.priority[index - 1];
                out.push_back(s ? *s : Value::null());
            } else if (index < 0) {
                for (const auto& s : o.priority) out.push_back(s ? *s : Value::null());
            } else {
                return kErrInvalidArrayIndex;
            }
            return -1;
        }
        if (prop == kPropObjectList && id.type == kDevice) {
            std::vector<Value> all;
            for (const auto& [raw, ob] : d.objects) {
                Value v;
                v.tag = kTagObjectId;
                v.obj = ob.id;
                all.push_back(v);
            }
            if (index == 0)
                out.push_back(Value::unsignedInt(all.size()));
            else if (index > 0 && static_cast<size_t>(index) <= all.size())
                out.push_back(all[static_cast<size_t>(index - 1)]);
            else if (index < 0)
                out = all;
            else
                return kErrInvalidArrayIndex;
            return -1;
        }
        const auto p = o.props.find(prop);
        if (p == o.props.end()) return kErrUnknownProperty;
        out.push_back(p->second);
        return -1;
    }

    Bytes answer(Device& d, const Frame& f) {
        if (d.forceErrorCode >= 0)
            return error(f.invokeId, f.service, 2, static_cast<uint32_t>(d.forceErrorCode));
        Reader r(f.data, f.dataLen);
        Bytes ack{0x30, f.invokeId, f.service};
        if (f.service == kServiceReadProperty) {
            ObjectId id;
            uint64_t prop = 0, index = 0;
            bool hasIndex = false;
            if (!r.contextObjectId(0, id) || !r.contextUnsigned(1, prop))
                return {0x60, f.invokeId, 0};
            if (r.isContext(2)) {
                r.contextUnsigned(2, index);
                hasIndex = true;
            }
            if (d.segmentedObjectList && prop == kPropObjectList && !hasIndex)
                return {0x71, f.invokeId, kAbortSegmentationNotSupported};
            std::vector<Value> vals;
            const int err = read(d, id, static_cast<uint32_t>(prop),
                                 hasIndex ? static_cast<int64_t>(index) : -1, vals);
            if (err >= 0)
                return error(f.invokeId, f.service, err == kErrUnknownObject ? 1 : 2,
                             static_cast<uint32_t>(err));
            encodeContextObjectId(ack, 0, id);
            encodeContextUnsigned(ack, 1, prop);
            if (hasIndex) encodeContextUnsigned(ack, 2, index);
            encodeOpening(ack, 3);
            for (const Value& v : vals) encodeAppValue(ack, v);
            encodeClosing(ack, 3);
        } else if (f.service == kServiceReadPropertyMultiple) {
            if (d.noRpm) return {0x60, f.invokeId, kRejectUnrecognizedService};
            while (!r.atEnd()) {
                ObjectId id;
                if (!r.contextObjectId(0, id) || !r.opening(1)) return {0x60, f.invokeId, 0};
                encodeContextObjectId(ack, 0, id);
                encodeOpening(ack, 1);
                while (!r.isClosing(1)) {
                    uint64_t prop = 0, index = 0;
                    bool hasIndex = false;
                    if (!r.contextUnsigned(0, prop)) return {0x60, f.invokeId, 0};
                    if (r.isContext(1)) {
                        r.contextUnsigned(1, index);
                        hasIndex = true;
                    }
                    encodeContextUnsigned(ack, 2, prop);
                    if (hasIndex) encodeContextUnsigned(ack, 3, index);
                    std::vector<Value> vals;
                    const int err = read(d, id, static_cast<uint32_t>(prop),
                                         hasIndex ? static_cast<int64_t>(index) : -1, vals);
                    if (err >= 0) {
                        encodeOpening(ack, 5);
                        encodeAppValue(ack, Value::enumerated(err == kErrUnknownObject ? 1 : 2));
                        encodeAppValue(ack, Value::enumerated(static_cast<uint32_t>(err)));
                        encodeClosing(ack, 5);
                    } else {
                        encodeOpening(ack, 4);
                        for (const Value& v : vals) encodeAppValue(ack, v);
                        encodeClosing(ack, 4);
                    }
                }
                r.closing(1);
                encodeClosing(ack, 1);
            }
        } else if (f.service == kServiceWriteProperty) {
            ObjectId id;
            uint64_t prop = 0;
            if (!r.contextObjectId(0, id) || !r.contextUnsigned(1, prop) || !r.opening(3))
                return {0x60, f.invokeId, 0};
            Value v;
            const size_t start = r.pos();
            if (!r.appValue(v) || !r.closing(3)) return {0x60, f.invokeId, 0};
            d.wpValues.emplace_back(f.data + start, f.data + r.pos() - 1);
            uint64_t prio = 16;
            const bool hasPrio = r.isContext(4);
            if (hasPrio) r.contextUnsigned(4, prio);
            d.wpPriorities.push_back(hasPrio ? static_cast<int>(prio) : -1);
            const auto it = d.objects.find(id.raw());
            if (it == d.objects.end()) return error(f.invokeId, f.service, 1, kErrUnknownObject);
            Object& o = it->second;
            if (prop != kPropPresentValue || !isCommandable(id.type))
                return error(f.invokeId, f.service, 2, kErrWriteAccessDenied);
            const AppTag want =
                isAnalog(id.type) ? kTagReal : isBinary(id.type) ? kTagEnumerated : kTagUnsigned;
            if (v.tag != want && v.tag != kTagNull)
                return error(f.invokeId, f.service, 2, kErrInvalidDataType);
            if (prio < 1 || prio > 16) return error(f.invokeId, f.service, 2, kErrValueOutOfRange);
            if (o.commandable) {
                if (v.tag == kTagNull)
                    o.priority[prio - 1].reset();
                else
                    o.priority[prio - 1] = v;
            } else if (v.tag != kTagNull) {
                o.props[kPropPresentValue] = v;
            }
            return {0x20, f.invokeId, f.service};
        } else {
            return {0x60, f.invokeId, kRejectUnrecognizedService};
        }
        if (static_cast<int>(ack.size()) > d.maxApdu)
            return {0x71, f.invokeId, kAbortSegmentationNotSupported};
        return ack;
    }
};

class Port : public DatagramPort {
   public:
    explicit Port(Network& n) : net_(n) {}
    drv::ConnectCode open(int, const std::string&) override {
        if (net_.portBusy) return drv::ConnectCode::PortBusy;
        ++net_.portsOpened;
        open_ = true;
        return drv::ConnectCode::Ok;
    }
    bool isOpen() const override { return open_; }
    void close() override { open_ = false; }
    bool sendTo(uint32_t ip, uint16_t port, const uint8_t* data, size_t n) override {
        if (!open_) return false;
        sent_ += n;
        net_.onSend(ip, port, Bytes(data, data + n));
        return true;
    }
    drv::ReadCode recvFrom(uint8_t* buf, size_t max, int timeoutMs, size_t& n, uint32_t& ip,
                           uint16_t& port) override {
        if (!open_) return drv::ReadCode::Closed;
        if (interrupted_) return drv::ReadCode::Interrupted;
        const int64_t deadline = net_.clock.now + timeoutMs;
        if (net_.inbox.empty() || net_.inbox.front().first > deadline) {
            net_.clock.now = deadline;
            return drv::ReadCode::Timeout;
        }
        auto item = net_.inbox.front();
        net_.inbox.pop_front();
        net_.clock.now = std::max(net_.clock.now, item.first);
        n = std::min(max, item.second.first.size());
        std::copy(item.second.first.begin(), item.second.first.begin() + static_cast<long>(n), buf);
        ip = item.second.second.first;
        port = item.second.second.second;
        received_ += n;
        return drv::ReadCode::Data;
    }
    void interrupt() override { interrupted_ = true; }
    void clearInterrupt() override { interrupted_ = false; }
    uint64_t bytesSent() const override { return sent_; }
    uint64_t bytesReceived() const override { return received_; }

   private:
    Network& net_;
    bool open_ = false;
    bool interrupted_ = false;
    uint64_t sent_ = 0, received_ = 0;
};

}  // namespace mat::bacnet::fake
