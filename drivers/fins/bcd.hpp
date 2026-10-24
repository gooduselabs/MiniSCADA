// BCD words of Omron PLCs (feature 018, spec FR-006): 4 digits in a word, 8 digits in two words
// with the low word first (as the PLC keeps a 2-word BCD number). Pure code.
#pragma once
#include <cstdint>
#include <vector>

namespace mat::fins {

// `words` 1 or 2 of `regs` (low word first). false when a digit is above 9.
bool bcdDecode(const std::vector<uint16_t>& regs, int words, uint64_t& out);
// false when `value` has more digits than `words` hold (9999, 99999999).
bool bcdEncode(uint64_t value, int words, std::vector<uint16_t>& out);

}  // namespace mat::fins
