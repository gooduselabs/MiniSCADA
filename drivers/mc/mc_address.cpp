#include "drivers/mc/mc_address.hpp"

#include <cctype>

namespace mat::mc {

namespace {

// contracts/mc-protocol.md §1. Two-letter names first: they are matched before one letter.
const McDeviceInfo kDevices[] = {
    {Device::SM, "SM", "SM", 0x91, true, 10, 10},  {Device::SD, "SD", "SD", 0xA9, false, 10, 10},
    {Device::TN, "TN", "TN", 0xC2, false, 10, 10}, {Device::CN, "CN", "CN", 0xC5, false, 10, 10},
    {Device::ZR, "ZR", "ZR", 0xB0, false, 10, 16}, {Device::X, "X", "X*", 0x9C, true, 16, 16},
    {Device::Y, "Y", "Y*", 0x9D, true, 16, 16},    {Device::M, "M", "M*", 0x90, true, 10, 10},
    {Device::L, "L", "L*", 0x92, true, 10, 10},    {Device::B, "B", "B*", 0xA0, true, 16, 16},
    {Device::D, "D", "D*", 0xA8, false, 10, 10},   {Device::W, "W", "W*", 0xB4, false, 16, 16},
    {Device::R, "R", "R*", 0xAF, false, 10, 10},
};

int digitValue(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

McAddress fail(const char* code) {
    McAddress r;
    r.error = code;
    return r;
}

}  // namespace

const McDeviceInfo& deviceInfo(Device d) {
    for (const auto& i : kDevices)
        if (i.device == d) return i;
    return kDevices[0];
}

const char* deviceName(Device d) { return deviceInfo(d).name; }

const McDeviceInfo* deviceByName(const std::string& name) {
    for (const auto& i : kDevices)
        if (name == i.name) return &i;
    return nullptr;
}

const McDeviceInfo* deviceByCode(uint8_t code) {
    for (const auto& i : kDevices)
        if (i.code == code) return &i;
    return nullptr;
}

int mcWordCount(TagType rawType, int stringLength) {
    switch (rawType) {
        case TagType::STRING:
            return (stringLength + 1) / 2;
        case TagType::BOOL:
        case TagType::INT16:
        case TagType::UINT16:
            return 1;
        case TagType::INT32:
        case TagType::UINT32:
        case TagType::FLOAT32:
            return 2;
        default:
            return 4;
    }
}

McAddress parseMcAddress(const std::string& address, const McAddressOptions& opts) {
    std::string up = address;
    for (char& c : up) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    const McDeviceInfo* info = nullptr;
    size_t i = 0;
    for (const auto& d : kDevices) {
        const std::string n = d.name;
        if (up.compare(0, n.size(), n) == 0) {
            info = &d;
            i = n.size();
            break;
        }
    }
    if (!info) return fail("E_ADDR_SYNTAX");
    // the number: the hex digits the device may hold, then the radix decides
    const size_t start = i;
    while (i < up.size() && digitValue(up[i]) >= 0) ++i;
    const size_t n = i - start;
    const bool octal = opts.xyOctal && (info->device == Device::X || info->device == Device::Y);
    const int radix = octal ? 8 : info->radix;
    const size_t maxDigits = radix == 16 ? 6 : 8;
    if (n == 0 || n > maxDigits) return fail("E_ADDR_SYNTAX");
    uint64_t number = 0;
    for (size_t k = start; k < i; ++k) {
        const int v = digitValue(up[k]);
        if (v >= radix) return fail("E_ADDR_SYNTAX");
        number = number * static_cast<uint64_t>(radix) + static_cast<uint64_t>(v);
    }
    int bit = -1;
    if (i < up.size()) {
        if (up[i] != '.' || i + 2 != up.size()) return fail("E_ADDR_SYNTAX");
        bit = digitValue(up[i + 1]);
        if (bit < 0) return fail("E_ADDR_SYNTAX");
    }

    const bool isBool = opts.rawType == TagType::BOOL;
    if (info->bit) {
        if (bit >= 0 || !isBool) return fail("E_ADDR_AREA");
    } else if (bit >= 0) {
        if (!isBool) return fail("E_ADDR_AREA");
    } else if (isBool) {
        return fail("E_ADDR_AREA");
    }
    if (opts.rw && info->device == Device::X) return fail("E_ADDR_AREA");

    const int words = (info->bit || bit >= 0) ? 1 : mcWordCount(opts.rawType, opts.stringLength);
    if (number + static_cast<uint64_t>(words) > kNumberLimit) return fail("E_ADDR_RANGE");

    McAddress r;
    r.ok = true;
    r.normalized = up;
    r.device = info->device;
    r.code = info->code;
    r.bitDevice = info->bit;
    r.number = static_cast<uint32_t>(number);
    r.words = words;
    r.bit = bit;
    return r;
}

}  // namespace mat::mc
