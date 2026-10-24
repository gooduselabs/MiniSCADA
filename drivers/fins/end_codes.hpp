// FINS end codes (MRES SRES, W342 §5-1-3) -> the reason of a BAD quality and the text of the
// diagnostics (feature 018, spec FR-008). The relay error bit of MRES and the PLC error bits of
// SRES are masked off before (Response::endCode).
#pragma once
#include <cstdint>
#include <string>

namespace mat::fins {

// "" for 0000 (normal completion); otherwise one of FINS_CANCELED, FINS_ROUTING,
// FINS_UNSUPPORTED, FINS_FORMAT, FINS_ADDRESS, FINS_READ_DENIED, FINS_WRITE_DENIED, FINS_MODE,
// FINS_UNIT_ERROR, FINS_ACCESS, FINS_OTHER.
const char* endCodeReason(uint16_t code);
// "1103"
std::string endCodeHex(uint16_t code);
// Vietnamese text of the main code (and of the sub codes the manual lists), for the diagnostics.
const char* endCodeMeaning(uint16_t code);
// A read of several Tags that ended with this code is split (an address out of the area, a
// response too long): 1103, 1104, 110B.
bool endCodeSplits(uint16_t code);
// The destination did not get the command (routing, the node, the unit): the device is
// unreachable, like a timeout.
bool endCodeUnreachable(uint16_t code);

}  // namespace mat::fins
