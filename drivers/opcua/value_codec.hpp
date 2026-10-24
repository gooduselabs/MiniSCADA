// OPC UA values <-> raw Tag values (feature 019, contracts/opcua.md §2). A value read becomes the
// raw type of the Tag when it fits (no clamping); a value written is encoded in the data type of
// the node on the server.
#pragma once
#include <cstdint>
#include <string>

#include "core/tag-engine/tag_store.hpp"
#include "open62541.h"

namespace mat::opcua {

// false: the variant cannot be the Tag's raw type (array, structure, other type, out of range);
// the reason is then OPCUA_TYPE_MISMATCH.
bool decodeVariant(const UA_Variant& v, TagType rawType, TagScalar& out);

// `raw` (the coordinator's value for `rawType`) as a scalar of `type` (a builtin data type of
// the node). false: the value does not fit or the type is not one of contracts §2.
bool encodeVariant(const TagScalar& raw, TagType rawType, const UA_DataType* type, UA_Variant& out);

// The natural data type of a raw type (writes to a node whose type is still unknown).
const UA_DataType* naturalType(TagType rawType);

// Readback: the value read equals what was written (FLOAT32 compared as float).
bool sameRaw(const TagScalar& a, const TagScalar& b, TagType rawType);

// UA_DateTime <-> Unix ms and ISO 8601 UTC (YYYY-MM-DDTHH:MM:SS.mmmZ).
int64_t unixMs(UA_DateTime t);
UA_DateTime fromUnixMs(int64_t ms);
std::string isoUtc(UA_DateTime t);
bool parseIsoUtc(const std::string& s, UA_DateTime& out);

// Suggested Tag type of a node's data type (browse, contracts §4); nullptr when none.
const char* suggestedTagType(const UA_NodeId& dataType);
// The name of a builtin data type ("Double"); "" when the node id is not one.
std::string dataTypeName(const UA_NodeId& dataType);

}  // namespace mat::opcua
