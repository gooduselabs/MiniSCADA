#include "drivers/fins/address.hpp"

#include <cctype>

namespace mat::fins {

namespace {

struct AreaInfo {
    Area area;
    int max;
    uint8_t wordCode;
    uint8_t bitCode;
};

AreaInfo infoOf(Area a, int bank) {
    switch (a) {
        case Area::CIO:
            return {a, 6143, 0xB0, 0x30};
        case Area::W:
            return {a, 511, 0xB1, 0x31};
        case Area::H:
            return {a, 1535, 0xB2, 0x32};
        case Area::A:
            return {a, 1471, 0xB3, 0x33};
        case Area::D:
            return {a, 32767, 0x82, 0x02};
        case Area::E:
            return {a, 32767, static_cast<uint8_t>(0xA0 + bank), static_cast<uint8_t>(0x20 + bank)};
        case Area::T:
        case Area::C:
            return {a, 4095, 0x89, 0x09};
    }
    return {a, 0, 0, 0};
}

constexpr int kAreaReadOnlyBelow = 448;  // A0-A447 are read only

Address fail(const char* code) {
    Address r;
    r.error = code;
    return r;
}

bool digits(const std::string& s, size_t from, size_t to, int minN, int maxN, int& out) {
    const size_t n = to - from;
    if (static_cast<int>(n) < minN || static_cast<int>(n) > maxN) return false;
    int v = 0;
    for (size_t i = from; i < to; ++i) {
        if (s[i] < '0' || s[i] > '9') return false;
        v = v * 10 + (s[i] - '0');
    }
    out = v;
    return true;
}

}  // namespace

const char* areaName(Area a) {
    switch (a) {
        case Area::CIO:
            return "CIO";
        case Area::W:
            return "W";
        case Area::H:
            return "H";
        case Area::A:
            return "A";
        case Area::D:
            return "D";
        case Area::E:
            return "E";
        case Area::T:
            return "T";
        case Area::C:
            return "C";
    }
    return "D";
}

int wordCount(TagType rawType, int stringLength) {
    switch (rawType) {
        case TagType::BOOL:
        case TagType::INT16:
        case TagType::UINT16:
            return 1;
        case TagType::INT32:
        case TagType::UINT32:
        case TagType::FLOAT32:
            return 2;
        case TagType::INT64:
        case TagType::UINT64:
        case TagType::FLOAT64:
            return 4;
        case TagType::STRING:
            return (stringLength + 1) / 2;
    }
    return 1;
}

int areaMax(Area a) { return infoOf(a, 0).max; }

Address parseAddress(const std::string& address, const AddressOptions& opts) {
    std::string up = address;
    for (char& ch : up) ch = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));

    // the area prefix
    Area area;
    int bank = -1;
    size_t pos = 0;
    if (up.compare(0, 3, "CIO") == 0) {
        area = Area::CIO;
        pos = 3;
    } else if (!up.empty() && up[0] == 'E') {
        if (up.size() < 3 || up[2] != '_') return fail("E_ADDR_SYNTAX");
        const char b = up[1];
        if (b >= '0' && b <= '9')
            bank = b - '0';
        else if (b >= 'A' && b <= 'C')
            bank = 10 + (b - 'A');
        else
            return fail("E_ADDR_SYNTAX");
        area = Area::E;
        pos = 3;
    } else if (!up.empty()) {
        switch (up[0]) {
            case 'W':
                area = Area::W;
                break;
            case 'H':
                area = Area::H;
                break;
            case 'A':
                area = Area::A;
                break;
            case 'D':
                area = Area::D;
                break;
            case 'T':
                area = Area::T;
                break;
            case 'C':
                area = Area::C;
                break;
            default:
                return fail("E_ADDR_SYNTAX");
        }
        pos = 1;
    } else {
        return fail("E_ADDR_SYNTAX");
    }

    // the number and the bit
    const size_t dot = up.find('.', pos);
    const size_t numEnd = dot == std::string::npos ? up.size() : dot;
    int number = 0;
    if (!digits(up, pos, numEnd, 1, 5, number)) return fail("E_ADDR_SYNTAX");
    int bit = -1;
    if (dot != std::string::npos) {
        if (!digits(up, dot + 1, up.size(), 1, 2, bit) || bit > 15) return fail("E_ADDR_SYNTAX");
    }

    const bool timerCounter = area == Area::T || area == Area::C;
    const TagType t = opts.rawType;
    bool flag = false;
    if (bit >= 0) {
        if (timerCounter || t != TagType::BOOL) return fail("E_ADDR_AREA");
    } else if (timerCounter) {
        if (t == TagType::BOOL)
            flag = true;
        else if (t != TagType::INT16 && t != TagType::UINT16)
            return fail("E_ADDR_AREA");
    } else if (t == TagType::BOOL) {
        return fail("E_ADDR_AREA");
    }
    if (opts.rw && (flag || (area == Area::A && number < kAreaReadOnlyBelow)))
        return fail("E_ADDR_AREA");

    const AreaInfo info = infoOf(area, bank < 0 ? 0 : bank);
    const int words = (flag || bit >= 0) ? 1 : wordCount(t, opts.stringLength);
    if (number > info.max || number + words - 1 > info.max) return fail("E_ADDR_RANGE");

    Address r;
    r.ok = true;
    r.normalized = up;
    r.area = area;
    r.bank = bank;
    r.offset = number;
    r.wire = area == Area::C ? 0x8000 + number : number;
    r.bit = bit;
    r.words = words;
    r.flag = flag;
    r.wordCode = info.wordCode;
    r.bitCode = info.bitCode;
    r.writable = !flag && !(area == Area::A && number < kAreaReadOnlyBelow);
    return r;
}

}  // namespace mat::fins
