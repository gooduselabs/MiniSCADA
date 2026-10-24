// BACnet address of an external Tag (feature 020, spec FR-005 to FR-007). Pure code, no I/O; the
// same vectors as packages/tag-codec (tests/bacnet-vectors/address.json).
//
//   address  = type ":" instance [ ":" property ] [ "@" priority ]
//   type     = "AI" / "AO" / "AV" / "BI" / "BO" / "BV" / "MSI" / "MSO" / "MSV" / "DEV"
//   property = a name (present-value, status-flags, units, out-of-service, object-name,
//              description, reliability, event-state, relinquish) or a number 0-4194303
//
// `relinquish` is a pseudo property: a BOOL Tag that writes NULL to present-value at its priority
// and reads true while priority-array[priority] is NULL.
#pragma once
#include <cstdint>
#include <string>

#include "core/tag-engine/tag_store.hpp"  // TagType (types only)

namespace mat::bacnet {

// BACnet object types (ASHRAE 135 clause 21, BACnetObjectType).
enum ObjectType : uint32_t {
    kAnalogInput = 0,
    kAnalogOutput = 1,
    kAnalogValue = 2,
    kBinaryInput = 3,
    kBinaryOutput = 4,
    kBinaryValue = 5,
    kDevice = 8,
    kMultiStateInput = 13,
    kMultiStateOutput = 14,
    kMultiStateValue = 19,
};

// BACnet property identifiers used by the driver (BACnetPropertyIdentifier).
enum PropertyId : uint32_t {
    kPropDescription = 28,
    kPropEventState = 36,
    kPropObjectList = 76,
    kPropObjectName = 77,
    kPropOutOfService = 81,
    kPropPresentValue = 85,
    kPropPriorityArray = 87,
    kPropReliability = 103,
    kPropStatusFlags = 111,
    kPropUnits = 117,
    kPropMaxApduAccepted = 62,
    kPropVendorName = 121,
    kPropModelName = 70,
};

constexpr uint32_t kMaxInstance = 4194302;  // 4194303 is the "any instance" wildcard
constexpr uint32_t kMaxProperty = 4194303;

// "AI" for kAnalogInput..., "" for a type the driver does not name.
const char* typeName(uint32_t objectType);
// The name of a known property ("present-value"), "" otherwise.
const char* propertyName(uint32_t property);
bool isAnalog(uint32_t objectType);
bool isBinary(uint32_t objectType);
bool isMultiState(uint32_t objectType);
// AO, AV, BO, BV, MSO, MSV: the types whose present-value the driver writes.
bool isCommandable(uint32_t objectType);

struct AddressOptions {
    TagType rawType = TagType::FLOAT32;
    bool rw = false;  // access RW
};

struct Address {
    bool ok = false;
    std::string error;  // E_ADDR_SYNTAX | E_ADDR_RANGE | E_ADDR_AREA
    std::string normalized;
    uint32_t objectType = 0;
    uint32_t instance = 0;
    uint32_t property = kPropPresentValue;
    int priority = 0;  // 1-16, 0 none
    bool relinquish = false;
};

// Letters of the type are upper-cased, of the property lower-cased; whitespace is not trimmed.
Address parseAddress(const std::string& address, const AddressOptions& opts);

}  // namespace mat::bacnet
