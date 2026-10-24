#include "drivers/fins/bcd.hpp"

namespace mat::fins {

bool bcdDecode(const std::vector<uint16_t>& regs, int words, uint64_t& out) {
    if (words < 1 || words > 2 || regs.size() < static_cast<size_t>(words)) return false;
    uint64_t v = 0;
    for (int w = words - 1; w >= 0; --w) {  // the high word holds the high digits
        const uint16_t r = regs[static_cast<size_t>(w)];
        for (int shift = 12; shift >= 0; shift -= 4) {
            const unsigned digit = (r >> shift) & 0xF;
            if (digit > 9) return false;
            v = v * 10 + digit;
        }
    }
    out = v;
    return true;
}

bool bcdEncode(uint64_t value, int words, std::vector<uint16_t>& out) {
    if (words < 1 || words > 2) return false;
    const uint64_t limit = words == 1 ? 10000ULL : 100000000ULL;
    if (value >= limit) return false;
    out.assign(static_cast<size_t>(words), 0);
    for (int w = 0; w < words; ++w) {
        uint16_t r = 0;
        for (int d = 0; d < 4; ++d) {
            r = static_cast<uint16_t>(r | ((value % 10) << (4 * d)));
            value /= 10;
        }
        out[static_cast<size_t>(w)] = r;
    }
    return true;
}

}  // namespace mat::fins
