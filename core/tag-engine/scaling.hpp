// Raw <-> engineering scaling (research R6, contracts/modbus-driver.md §6). 64-bit doubles; the
// raw range of an integer type is compared as an exact integer (INT64/UINT64 never go through a
// double). Same vectors as packages/tag-codec (tests/codec-vectors/scaling.json).
#pragma once
#include <string>

#include "core/tag-engine/tag_store.hpp"

namespace mat {

struct Scaling {
    double rawMin = 0, rawMax = 0, engMin = 0, engMax = 0;
    bool clamp = false;
};

struct ScaleReadResult {
    double value = 0;
    Quality quality = Quality::GOOD;  // GOOD or UNCERTAIN
    std::string reason;               // CLAMPED when clamped
};

// eng = engMin + ((raw - rawMin) * (engMax - engMin)) / (rawMax - rawMin). With `clamp` and raw
// outside the raw range: the matching engineering bound, UNCERTAIN CLAMPED. -0 becomes 0.
ScaleReadResult scaleRead(double raw, const Scaling& sc, TagType tagType);

struct ScaleWriteResult {
    bool ok = false;
    TagScalar raw;      // int64_t, uint64_t or double (as the raw type holds it)
    std::string error;  // OUT_OF_RAW_RANGE | NOT_FINITE
};

// Inverse; integer raw types round half away from zero, then must fit the TYPE range (not
// rawMin/rawMax: FR-011).
ScaleWriteResult scaleWrite(double eng, const Scaling& sc, TagType rawType);

}  // namespace mat
