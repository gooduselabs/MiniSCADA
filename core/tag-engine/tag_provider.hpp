// Boundary between data sources (drivers, simulation) and the Tag Engine (Constitution II:
// drivers only publish updates; they never talk to clients or write elsewhere).
#pragma once
#include <cstdint>

namespace mat {

class TagProvider {
   public:
    virtual ~TagProvider() = default;
    // Advance to `nowMs` (epoch ms) and write changed values into the TagStore.
    virtual void step(int64_t nowMs) = 0;
};

}  // namespace mat
