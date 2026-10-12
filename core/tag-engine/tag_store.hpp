// Current value of every Tag (Master Plan 8.1, 12.3). Providers/drivers write through set();
// the live hub reads snapshots and collects changed indexes with takeDirty(). Thread-safe.
#pragma once
#include <cstddef>
#include <cstdint>
#include <deque>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <variant>
#include <vector>

namespace mat {

enum class TagType { BOOL, INT16, UINT16, INT32, UINT32, INT64, UINT64, FLOAT32, FLOAT64, STRING };
enum class Quality { GOOD, BAD, UNCERTAIN };

using TagScalar = std::variant<std::monostate, bool, int64_t, uint64_t, double, std::string>;

std::optional<TagType> parseTagType(const std::string& s);
const char* qualityName(Quality q);
bool isNumericType(TagType t);

struct TagDef {
    std::string id;
    TagType type = TagType::FLOAT64;
    std::string signal;  // provider-specific source key (mock: "tank.level", ...)
};

struct TagValue {
    TagScalar value;
    Quality quality = Quality::BAD;
    std::string
        reason;  // reason code of a quality other than GOOD (data-model §6); empty when GOOD
    int64_t sourceTs = 0;  // epoch ms UTC
    int64_t serverTs = 0;  // epoch ms UTC
    uint64_t revision = 0;
};

class TagStore {
   public:
    // Returns the new index; throws std::invalid_argument on a duplicate id.
    size_t add(TagDef def);
    std::optional<size_t> indexOf(const std::string& id) const;
    size_t size() const;
    const TagDef& def(size_t i) const;  // defs are immutable once added

    // Returns true (and marks dirty, bumps revision) when value, quality or reason changed.
    // The reason is kept only for a quality other than GOOD.
    bool set(size_t i, TagScalar v, Quality q, int64_t sourceTs, int64_t serverTs);
    bool set(size_t i, TagScalar v, Quality q, std::string reason, int64_t sourceTs,
             int64_t serverTs);

    // One Tag of an engine round (specs/006 T043): the whole round is applied under one lock, so
    // the live hub and the historian never see a half-applied round.
    struct Update {
        size_t index = 0;
        TagScalar value;
        Quality quality = Quality::BAD;
        std::string reason;
        int64_t sourceTs = 0;
        int64_t serverTs = 0;
    };
    // Returns how many Tags changed. Throws std::out_of_range on a bad index (nothing applied).
    size_t applyBatch(std::vector<Update> updates);
    TagValue get(size_t i) const;
    // Values of `indices` (in that order) under one lock, for the historian. Leaves the dirty set
    // of the live hub untouched. Throws std::out_of_range on a bad index.
    void snapshot(const std::vector<size_t>& indices, std::vector<TagValue>& out) const;
    std::vector<size_t> takeDirty();  // ascending, each index once

    // JSON of the value only, per contract: bool, number, INT64/UINT64 as string, null.
    void appendValueJson(std::string& out, size_t i) const;
    // {"id","value","quality"[,"reason"],"sourceTimestamp","serverTimestamp","revision"}; reason
    // only when quality is not GOOD and a reason is known (live protocol 1.2.0)
    void appendSnapshotJson(std::string& out, size_t i) const;
    // [index,value,"QUALITY"[,"REASON"]] with the caller-provided index
    void appendDeltaEntryJson(std::string& out, size_t position, size_t i) const;

   private:
    void valueJsonLocked(std::string& out, size_t i) const;
    bool setLocked(size_t i, TagScalar v, Quality q, std::string reason, int64_t sourceTs,
                   int64_t serverTs);

    mutable std::mutex mu_;
    std::deque<TagDef> defs_;  // deque: def() references stay valid across add()
    std::vector<TagValue> values_;
    std::vector<uint8_t> dirtyFlag_;
    std::vector<size_t> dirty_;
    std::unordered_map<std::string, size_t> byId_;
};

void appendJsonString(std::string& out, const std::string& s);

}  // namespace mat
