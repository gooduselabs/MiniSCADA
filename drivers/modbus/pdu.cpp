#include "drivers/modbus/pdu.hpp"

#include <algorithm>

#include "drivers/modbus/codec.hpp"

namespace mat::modbus {

namespace {

void put16(Bytes& b, uint16_t v) {
    b.push_back(static_cast<uint8_t>(v >> 8));
    b.push_back(static_cast<uint8_t>(v & 0xFF));
}

int get16(const Bytes& b, size_t at) { return (b[at] << 8) | b[at + 1]; }

bool validAddress(int a) { return a >= 0 && a <= 0xFFFF; }

}  // namespace

bool validQuantity(int fc, int qty) {
    switch (fc) {
        case 1:
        case 2:
            return qty >= 1 && qty <= kMaxReadBits;
        case 3:
        case 4:
            return qty >= 1 && qty <= kMaxReadRegisters;
        case 15:
            return qty >= 1 && qty <= kMaxWriteCoils;
        case 16:
            return qty >= 1 && qty <= kMaxWriteRegisters;
    }
    return false;
}

Bytes readRequest(int fc, int address, int quantity) {
    if (fc < 1 || fc > 4 || !validAddress(address) || !validQuantity(fc, quantity)) return {};
    Bytes b{static_cast<uint8_t>(fc)};
    put16(b, static_cast<uint16_t>(address));
    put16(b, static_cast<uint16_t>(quantity));
    return b;
}

Bytes writeSingleCoil(int address, bool on) {
    if (!validAddress(address)) return {};
    Bytes b{5};
    put16(b, static_cast<uint16_t>(address));
    put16(b, on ? 0xFF00 : 0x0000);
    return b;
}

Bytes writeSingleRegister(int address, uint16_t value) {
    if (!validAddress(address)) return {};
    Bytes b{6};
    put16(b, static_cast<uint16_t>(address));
    put16(b, value);
    return b;
}

Bytes writeMultipleCoils(int address, const std::vector<uint8_t>& bits) {
    if (!validAddress(address) || !validQuantity(15, static_cast<int>(bits.size()))) return {};
    const Bytes packed = packBits(bits);
    Bytes b{15};
    put16(b, static_cast<uint16_t>(address));
    put16(b, static_cast<uint16_t>(bits.size()));
    b.push_back(static_cast<uint8_t>(packed.size()));
    b.insert(b.end(), packed.begin(), packed.end());
    return b;
}

Bytes writeMultipleRegisters(int address, const std::vector<uint16_t>& registers) {
    if (!validAddress(address) || !validQuantity(16, static_cast<int>(registers.size()))) return {};
    Bytes b{16};
    put16(b, static_cast<uint16_t>(address));
    put16(b, static_cast<uint16_t>(registers.size()));
    b.push_back(static_cast<uint8_t>(registers.size() * 2));
    for (uint16_t r : registers) put16(b, r);
    return b;
}

Bytes maskWriteRegister(int address, uint16_t andMask, uint16_t orMask) {
    if (!validAddress(address)) return {};
    Bytes b{22};
    put16(b, static_cast<uint16_t>(address));
    put16(b, andMask);
    put16(b, orMask);
    return b;
}

PduCheck checkResponsePdu(const Bytes& request, const uint8_t* pdu, size_t size) {
    PduCheck out;
    if (request.empty() || size < 2) return out;  // Format
    const int fc = request[0];
    if (pdu[0] == (fc | 0x80)) {
        if (size != 2) return out;
        out.kind = ResponseKind::Exception;
        out.exception = pdu[1];
        return out;
    }
    if (pdu[0] != fc) {
        out.kind = ResponseKind::Function;
        return out;
    }
    switch (fc) {
        case 1:
        case 2:
        case 3:
        case 4: {
            if (request.size() < 5) return out;
            const int qty = get16(request, 3);
            const size_t n =
                (fc <= 2) ? static_cast<size_t>((qty + 7) / 8) : static_cast<size_t>(qty) * 2;
            if (pdu[1] != n || size != 2 + n) {
                out.kind = ResponseKind::ByteCount;
                return out;
            }
            out.kind = ResponseKind::Ok;
            return out;
        }
        case 5:
        case 6:
        case 22:
            if (size == request.size() && std::equal(request.begin(), request.end(), pdu))
                out.kind = ResponseKind::Ok;
            return out;
        case 15:
        case 16:
            if (size == 5 && request.size() >= 5 &&
                std::equal(request.begin(), request.begin() + 5, pdu))
                out.kind = ResponseKind::Ok;
            return out;
    }
    return out;
}

std::vector<uint16_t> responseRegisters(const Bytes& response) {
    std::vector<uint16_t> r;
    if (response.size() < 2) return r;
    const size_t n = std::min<size_t>(response[1], response.size() - 2) / 2;
    for (size_t i = 0; i < n; ++i) r.push_back(static_cast<uint16_t>(get16(response, 2 + 2 * i)));
    return r;
}

std::vector<uint8_t> responseBits(const Bytes& response, size_t quantity) {
    if (response.size() < 2) return {};
    const Bytes data(response.begin() + 2, response.end());
    return unpackBits(data, std::min(quantity, data.size() * 8));
}

}  // namespace mat::modbus
