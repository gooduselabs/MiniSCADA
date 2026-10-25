// The JSON of a tag write (device-api-1.1 §3) shared by POST /api/v1/tags/write (tags_api.cpp) and
// POST /api/v1/data/write of the data API (feature 025, data_api.cpp).
#pragma once
#include <string>
#include <vector>

#include "core/tag-engine/write_coordinator.hpp"
#include "nlohmann/json.hpp"

namespace mat {

// 8-4-4-4-12 lower-case hex, version 4, variant 8, 9, a or b.
bool isWriteRequestId(const std::string& s);
// The strict reading of {"requests": [...]}: 1-16 requests, each with a UUID v4, a Tag and a
// value; `expect`, `pulseMs`, `context` as device-api-1.2 §6. false: the whole batch is refused.
bool parseWriteRequests(const nlohmann::json& body, std::vector<WriteRequest>& out);
// The element of `results` for a view (device-api-1.1 §3.1, §3.2).
nlohmann::json writeViewJson(const WriteView& v);
// A value of a request as the client wrote it; nullopt for a kind that is no value.
std::optional<WriteValue> writeValueOf(const nlohmann::json& v);
// A TagScalar as JSON, 64-bit integers beyond 2^53 as decimal strings, NaN and infinities null.
nlohmann::json tagScalarJson(const TagScalar& v);
// 2026-10-20T03:12:00.123Z
std::string isoUtcMsText(int64_t ms);

}  // namespace mat
