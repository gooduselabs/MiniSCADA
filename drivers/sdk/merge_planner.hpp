// Merging of read requests and splitting on exception 02/03 (contracts/modbus-driver.md §7,
// research R8). Pure code; the same algorithm estimates the RTU scan time in the validator.
//
// Every item is a half-open span [start, end) in registers (HR, IR) or bits (C, DI) of one
// (field device, area, scan group); `tag` is the caller's key. A Tag is never cut: it is a span.
#pragma once
#include <cstddef>
#include <cstdint>
#include <optional>
#include <vector>

namespace mat::drv {

struct PlanItem {
    size_t tag = 0;
    int start = 0;
    int end = 0;  // exclusive
};

struct Block {
    int start = 0;
    int end = 0;                // exclusive
    std::vector<size_t> items;  // indexes into the item list given to planBlocks
    int size() const { return end - start; }
};

// Items sorted by (start, end); the greedy rule of §7: extend the block while the gap to the next
// span <= maxGap and the block stays <= maxLen. Overlapping or equal spans always join the same
// block (a span longer than maxLen is rejected by the validator, E_ADDR_READ_LIMIT, so a block
// longer than maxLen only appears if the caller did not check). maxGap 0: only touching spans.
std::vector<Block> planBlocks(const std::vector<PlanItem>& items, int maxGap, int maxLen);

// Cuts a block of >= 2 independent Tags in two, for exception 02/03:
// at the largest gap between two neighbouring Tags (ties: the gap nearest the middle of the
// block); with no gap, at the Tag boundary nearest the middle. Returns false when the block
// cannot be cut (one Tag, or every Tag overlaps another).
bool splitBlock(const std::vector<PlanItem>& items, const Block& block, Block& first,
                Block& second);

}  // namespace mat::drv
