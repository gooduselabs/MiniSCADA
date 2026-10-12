// InfluxDB line protocol for wide rows (specs/003-data-logging/contracts/external-schema.md):
// measurement = table, one tag source=<instance_id>, one field per non-empty cell, UTC ms time.
#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "core/historian/local_store.hpp"
#include "core/tag-engine/tag_store.hpp"

namespace mat {

struct InfluxColumn {
    std::string name;
    TagType type = TagType::FLOAT64;
};

std::string influxEscapeMeasurement(const std::string& s);  // comma, space
std::string influxEscapeKey(const std::string& s);          // comma, equals sign, space
// Quoted string field: backslash and double quote escaped; line breaks become spaces (a field
// value cannot hold one).
std::string influxString(const std::string& s);
// A write the server took in part (points older than the bucket keeps, a field of another type),
// read from the "message" of the JSON answer only: InfluxDB 3 repeats the refused line, Tag text
// included. nullopt: not one.
struct InfluxPartial {
    uint64_t dropped = 0;        // at most the lines of the body; 0 when the message does not say
    bool retentionOnly = false;  // only points older than the bucket keeps: nothing to show
};
std::optional<InfluxPartial> influxPartialWrite(long status, const std::string& reply,
                                                size_t lines);

// One point, or "" when no cell has a value the field type can hold (the row is not sent but still
// counts as forwarded).
std::string influxLine(const std::string& measurement, const std::string& sourceId,
                       const std::vector<InfluxColumn>& cols, const StoredRow& row);

struct InfluxBody {
    std::string text;     // points separated by '\n'; may be empty when every row was empty
    int64_t lastSeq = 0;  // seq of the last row this body covers (empty rows included)
    size_t lines = 0;
};

// Rows in seq order cut into request bodies of at most `maxLines` points and `maxBytes` bytes
// (a single longer point gets a body of its own).
std::vector<InfluxBody> influxBodies(const std::string& measurement, const std::string& sourceId,
                                     const std::vector<InfluxColumn>& cols,
                                     const std::vector<StoredRow>& rows, size_t maxLines,
                                     size_t maxBytes);

}  // namespace mat
