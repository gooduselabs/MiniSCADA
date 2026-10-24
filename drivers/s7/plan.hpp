// Read plan of an S7 connection (feature 016, contracts/s7-driver.md §4). Pure code.
//
// The Tags of one scan group are merged into byte ranges per (area, DB) by the SDK's planBlocks
// (gap <= maxGapBytes, length <= PDU - 18); each range is one item read as bytes (a bit Tag reads
// its byte). Items are then packed in order into Read Var requests of at most 20 items whose
// request and answer both fit the negotiated PDU.
#pragma once
#include <cstddef>
#include <vector>

#include "drivers/s7/frames.hpp"

namespace mat::s7 {

struct PlanTag {
    size_t key = 0;  // the caller's index of the Tag
    Area area = Area::DB;
    int db = 0;
    int byte = 0;
    int size = 1;  // bytes (a bit: 1)
};

struct ReadItem {
    Item item;                 // bit -1: bytes [item.byte, item.byte + item.size)
    std::vector<size_t> keys;  // the Tags it holds
};

struct ReadRequest {
    std::vector<ReadItem> items;
};

// The largest item one answer can carry for a PDU.
inline int maxItemBytes(int pdu) { return pdu - kReadOverhead; }

// Merges the Tags (one scan group) into items, sorted by area, DB and byte.
std::vector<ReadItem> mergeItems(const std::vector<PlanTag>& tags, int maxGap, int maxLen);
// Packs items in order into requests that fit `pdu`.
std::vector<ReadRequest> packRequests(const std::vector<ReadItem>& items, int pdu);
// Bytes of the S7 PDU of the request and of its answer.
int requestBytes(const ReadRequest& r);
int answerBytes(const ReadRequest& r);

// Cuts an item of >= 2 Tags in two (SDK splitBlock: at the largest gap, else near the middle).
bool splitItem(const ReadItem& item, const std::vector<PlanTag>& tags, ReadItem& first,
               ReadItem& second);

}  // namespace mat::s7
