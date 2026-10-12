#include "drivers/sdk/merge_planner.hpp"

#include <algorithm>
#include <cstdlib>

namespace mat::drv {

std::vector<Block> planBlocks(const std::vector<PlanItem>& items, int maxGap, int maxLen) {
    std::vector<size_t> order(items.size());
    for (size_t i = 0; i < order.size(); ++i) order[i] = i;
    std::stable_sort(order.begin(), order.end(), [&](size_t a, size_t b) {
        if (items[a].start != items[b].start) return items[a].start < items[b].start;
        return items[a].end < items[b].end;
    });
    std::vector<Block> blocks;
    for (size_t idx : order) {
        const PlanItem& r = items[idx];
        if (!blocks.empty()) {
            Block& last = blocks.back();
            if (r.start - last.end <= maxGap && std::max(last.end, r.end) - last.start <= maxLen) {
                last.end = std::max(last.end, r.end);
                last.items.push_back(idx);
                continue;
            }
        }
        Block b;
        b.start = r.start;
        b.end = r.end;
        b.items.push_back(idx);
        blocks.push_back(std::move(b));
    }
    return blocks;
}

bool splitBlock(const std::vector<PlanItem>& items, const Block& block, Block& first,
                Block& second) {
    if (block.items.size() < 2) return false;
    // Items of the block in (start, end) order, as planBlocks left them.
    std::vector<size_t> order = block.items;
    std::stable_sort(order.begin(), order.end(), [&](size_t a, size_t b) {
        if (items[a].start != items[b].start) return items[a].start < items[b].start;
        return items[a].end < items[b].end;
    });
    // A cut after position i is valid when no earlier span reaches the start of the next one.
    struct Cut {
        size_t after;  // cut between order[after] and order[after + 1]
        int gap;       // free positions between the covered part and the next span
        double pos;    // where the cut lies (middle of the gap; the start of the next span if none)
    };
    std::vector<Cut> cuts;
    int reach = items[order[0]].end;
    for (size_t i = 0; i + 1 < order.size(); ++i) {
        reach = std::max(reach, items[order[i]].end);
        const int next = items[order[i + 1]].start;
        if (reach <= next) cuts.push_back({i, next - reach, (reach + next) / 2.0});
    }
    if (cuts.empty()) return false;
    const double middle = (block.start + block.end) / 2.0;
    const Cut* best = nullptr;
    for (const Cut& c : cuts) {
        if (!best) {
            best = &c;
            continue;
        }
        if (c.gap != best->gap) {
            if (c.gap > best->gap) best = &c;
        } else if (std::abs(c.pos - middle) < std::abs(best->pos - middle)) {
            best = &c;
        }
    }
    first = Block{};
    second = Block{};
    first.start = items[order[0]].start;
    int firstEnd = items[order[0]].end;
    for (size_t i = 0; i <= best->after; ++i) {
        first.items.push_back(order[i]);
        firstEnd = std::max(firstEnd, items[order[i]].end);
    }
    first.end = firstEnd;
    second.start = items[order[best->after + 1]].start;
    int secondEnd = second.start;
    for (size_t i = best->after + 1; i < order.size(); ++i) {
        second.items.push_back(order[i]);
        secondEnd = std::max(secondEnd, items[order[i]].end);
    }
    second.end = secondEnd;
    return true;
}

}  // namespace mat::drv
