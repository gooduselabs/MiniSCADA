#include "drivers/modbus/address.hpp"

#include <cctype>

namespace mat::modbus {

const char* areaName(Area a) {
    switch (a) {
        case Area::C:
            return "C";
        case Area::DI:
            return "DI";
        case Area::IR:
            return "IR";
        default:
            return "HR";
    }
}

int registerCount(TagType rawType, int stringLength) {
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

namespace {

bool isDigit(char c) { return c >= '0' && c <= '9'; }

// digits [lo, hi] starting at i; advances i
bool digits(const std::string& s, size_t& i, size_t lo, size_t hi, long& value) {
    size_t n = 0;
    value = 0;
    while (i < s.size() && isDigit(s[i])) {
        value = value * 10 + (s[i] - '0');
        ++i;
        if (++n > hi) return false;
    }
    return n >= lo;
}

// ["." bit] then end of string
bool tail(const std::string& s, size_t i, int& bit) {
    bit = -1;
    if (i == s.size()) return true;
    if (s[i] != '.') return false;
    ++i;
    long b;
    if (!digits(s, i, 1, 2, b)) return false;
    if (i != s.size()) return false;
    bit = static_cast<int>(b);
    return true;
}

struct AreaInfo {
    int fcRead;
    std::vector<int> fcWrite;
};
AreaInfo infoOf(Area a) {
    switch (a) {
        case Area::C:
            return {1, {5, 15}};
        case Area::DI:
            return {2, {}};
        case Area::IR:
            return {4, {}};
        default:
            return {3, {6, 16}};
    }
}

AddressResult fail(const char* code) {
    AddressResult r;
    r.error = code;
    return r;
}

}  // namespace

AddressResult parseAddress(const std::string& address, const AddressOptions& opts) {
    std::string up;
    for (char c : address) up += static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    Area area = Area::HR;
    long number = 0;
    int bit = -1;
    bool modicon = false;
    bool matched = false;
    {
        size_t i = 0;
        bool areaOk = true;
        if (up.compare(0, 2, "DI") == 0) {
            area = Area::DI;
            i = 2;
        } else if (up.compare(0, 2, "IR") == 0) {
            area = Area::IR;
            i = 2;
        } else if (up.compare(0, 2, "HR") == 0) {
            area = Area::HR;
            i = 2;
        } else if (!up.empty() && up[0] == 'C') {
            area = Area::C;
            i = 1;
        } else {
            areaOk = false;
        }
        if (areaOk && digits(up, i, 1, 5, number) && tail(up, i, bit)) matched = true;
    }
    if (!matched) {
        size_t i = 0;
        if (up.empty() || (up[0] != '0' && up[0] != '1' && up[0] != '3' && up[0] != '4'))
            return fail("E_ADDR_SYNTAX");
        const char lead = up[0];
        i = 1;
        if (!digits(up, i, 4, 5, number) || !tail(up, i, bit)) return fail("E_ADDR_SYNTAX");
        area = lead == '0' ? Area::C : lead == '1' ? Area::DI : lead == '3' ? Area::IR : Area::HR;
        modicon = true;
    }
    if (bit > 15) return fail("E_ADDR_SYNTAX");

    const TagType rawType = opts.rawType;
    const bool bitArea = area == Area::IR || area == Area::HR;
    if (bit >= 0) {
        if (!bitArea || rawType != TagType::BOOL) return fail("E_ADDR_AREA");
    } else if (area == Area::C || area == Area::DI) {
        if (rawType != TagType::BOOL) return fail("E_ADDR_AREA");
    } else if (rawType == TagType::BOOL) {
        return fail("E_ADDR_AREA");
    }
    if (opts.rw && (area == Area::DI || area == Area::IR)) return fail("E_ADDR_AREA");

    const long offset = number - opts.addressBase;
    const int registers =
        (area == Area::C || area == Area::DI) ? 1 : registerCount(rawType, opts.stringLength);
    if (offset < 0 || offset > 65535 || offset + registers > 65536) return fail("E_ADDR_RANGE");

    AddressResult r;
    r.ok = true;
    r.normalized = up;
    r.area = area;
    const AreaInfo info = infoOf(area);
    r.fcRead = info.fcRead;
    r.fcWrite = info.fcWrite;
    r.offset = static_cast<int>(offset);
    r.registers = registers;
    r.bit = bit;
    if (modicon && opts.addressBase == 0) r.warnings.push_back("W_ADDR_MODICON_BASE0");
    return r;
}

}  // namespace mat::modbus
