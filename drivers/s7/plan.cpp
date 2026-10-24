#include "drivers/s7/plan.hpp"

#include <algorithm>
#include <map>
#include <tuple>

#include "drivers/sdk/merge_planner.hpp"

namespace mat::s7 {

namespace {

const PlanTag* findTag(const std::vector<PlanTag>& tags, size_t key) {
    for (const PlanTag& t : tags)
        if (t.key == key) return &t;
    return nullptr;
}

}  // namespace

std::vector<ReadItem> mergeItems(const std::vector<PlanTag>& tags, int maxGap, int maxLen) {
    std::map<std::pair<int, int>, std::vector<const PlanTag*>> byArea;  // (area, db)
    for (const PlanTag& t : tags) byArea[{static_cast<int>(t.area), t.db}].push_back(&t);
    std::vector<ReadItem> out;
    for (auto& [key, list] : byArea) {
        std::vector<drv::PlanItem> items;
        for (const PlanTag* t : list) items.push_back({t->key, t->byte, t->byte + t->size});
        std::sort(items.begin(), items.end(), [](const drv::PlanItem& a, const drv::PlanItem& b) {
            return std::tie(a.start, a.end, a.tag) < std::tie(b.start, b.end, b.tag);
        });
        for (const drv::Block& b : drv::planBlocks(items, maxGap, maxLen)) {
            ReadItem it;
            it.item.area = static_cast<Area>(key.first);
            it.item.db = key.second;
            it.item.byte = b.start;
            it.item.size = b.end - b.start;
            for (size_t i : b.items) it.keys.push_back(items[i].tag);
            out.push_back(std::move(it));
        }
    }
    return out;
}

int requestBytes(const ReadRequest& r) { return 12 + 12 * static_cast<int>(r.items.size()); }

int answerBytes(const ReadRequest& r) {
    int n = 14;
    for (size_t i = 0; i < r.items.size(); ++i) {
        const int s = r.items[i].item.size;
        n += 4 + s + ((s & 1) && i + 1 < r.items.size() ? 1 : 0);
    }
    return n;
}

std::vector<ReadRequest> packRequests(const std::vector<ReadItem>& items, int pdu) {
    std::vector<ReadRequest> out;
    ReadRequest cur;
    int answer = 14;  // with a fill byte counted after every odd item
    for (const ReadItem& it : items) {
        const int add = 4 + it.item.size + (it.item.size & 1);
        const bool fits = static_cast<int>(cur.items.size()) < kMaxItems &&
                          12 + 12 * static_cast<int>(cur.items.size() + 1) <= pdu &&
                          answer + add <= pdu + (it.item.size & 1);
        if (!cur.items.empty() && !fits) {
            out.push_back(std::move(cur));
            cur = ReadRequest();
            answer = 14;
        }
        cur.items.push_back(it);
        answer += add;
    }
    if (!cur.items.empty()) out.push_back(std::move(cur));
    return out;
}

bool splitItem(const ReadItem& item, const std::vector<PlanTag>& tags, ReadItem& first,
               ReadItem& second) {
    if (item.keys.size() < 2) return false;
    std::vector<drv::PlanItem> items;
    drv::Block whole;
    whole.start = item.item.byte;
    whole.end = item.item.byte + item.item.size;
    for (size_t k = 0; k < item.keys.size(); ++k) {
        const PlanTag* t = findTag(tags, item.keys[k]);
        if (!t) return false;
        items.push_back({t->key, t->byte, t->byte + t->size});
        whole.items.push_back(k);
    }
    drv::Block a, b;
    if (!drv::splitBlock(items, whole, a, b)) return false;
    auto make = [&](const drv::Block& blk) {
        ReadItem r;
        r.item = item.item;
        r.item.byte = blk.start;
        r.item.size = blk.end - blk.start;
        for (size_t i : blk.items) r.keys.push_back(items[i].tag);
        return r;
    };
    first = make(a);
    second = make(b);
    return true;
}

}  // namespace mat::s7
