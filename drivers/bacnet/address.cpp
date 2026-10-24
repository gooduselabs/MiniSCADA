#include "drivers/bacnet/address.hpp"

#include <cctype>

namespace mat::bacnet {

namespace {

struct TypeEntry {
    const char* name;
    uint32_t type;
};
constexpr TypeEntry kTypes[] = {
    {"AI", kAnalogInput},      {"AO", kAnalogOutput},     {"AV", kAnalogValue},
    {"BI", kBinaryInput},      {"BO", kBinaryOutput},     {"BV", kBinaryValue},
    {"DEV", kDevice},          {"MSI", kMultiStateInput}, {"MSO", kMultiStateOutput},
    {"MSV", kMultiStateValue},
};

struct PropEntry {
    const char* name;
    uint32_t id;
};
constexpr PropEntry kProps[] = {
    {"present-value", kPropPresentValue},
    {"status-flags", kPropStatusFlags},
    {"units", kPropUnits},
    {"out-of-service", kPropOutOfService},
    {"object-name", kPropObjectName},
    {"description", kPropDescription},
    {"reliability", kPropReliability},
    {"event-state", kPropEventState},
};

// Digits only, at most `maxDigits`, no sign; false otherwise.
bool parseNumber(const std::string& s, uint64_t& out, size_t maxDigits = 9) {
    if (s.empty() || s.size() > maxDigits) return false;
    out = 0;
    for (char c : s) {
        if (c < '0' || c > '9') return false;
        out = out * 10 + static_cast<uint64_t>(c - '0');
    }
    return true;
}

Address fail(const char* code) {
    Address a;
    a.error = code;
    return a;
}

bool isNumeric(TagType t) { return t != TagType::BOOL && t != TagType::STRING; }

// FR-006: the raw types a property of an object type takes.
bool typeAllowed(uint32_t objectType, uint32_t property, bool relinquish, TagType t) {
    if (relinquish) return t == TagType::BOOL;
    switch (property) {
        case kPropPresentValue:
            if (isAnalog(objectType)) return isNumeric(t);
            if (isBinary(objectType)) return t == TagType::BOOL || t == TagType::UINT16;
            if (isMultiState(objectType))
                return t == TagType::UINT16 || t == TagType::UINT32 || t == TagType::INT16 ||
                       t == TagType::INT32;
            return false;  // Device has no present-value
        case kPropStatusFlags:
            return objectType != kDevice && t == TagType::UINT16;
        case kPropUnits:
            if (!isAnalog(objectType)) return false;
            return t == TagType::UINT16 || t == TagType::UINT32;
        case kPropReliability:
        case kPropEventState:
            return t == TagType::UINT16 || t == TagType::UINT32;
        case kPropOutOfService:
            return objectType != kDevice && t == TagType::BOOL;
        case kPropObjectName:
        case kPropDescription:
            return t == TagType::STRING;
        default:
            return true;  // a property by number: any type, read only
    }
}

}  // namespace

const char* typeName(uint32_t objectType) {
    for (const auto& e : kTypes)
        if (e.type == objectType) return e.name;
    return "";
}

const char* propertyName(uint32_t property) {
    for (const auto& e : kProps)
        if (e.id == property) return e.name;
    return "";
}

bool isAnalog(uint32_t t) { return t == kAnalogInput || t == kAnalogOutput || t == kAnalogValue; }
bool isBinary(uint32_t t) { return t == kBinaryInput || t == kBinaryOutput || t == kBinaryValue; }
bool isMultiState(uint32_t t) {
    return t == kMultiStateInput || t == kMultiStateOutput || t == kMultiStateValue;
}
bool isCommandable(uint32_t t) {
    return t == kAnalogOutput || t == kAnalogValue || t == kBinaryOutput || t == kBinaryValue ||
           t == kMultiStateOutput || t == kMultiStateValue;
}

Address parseAddress(const std::string& address, const AddressOptions& opts) {
    // split: type ":" instance [":" property] ["@" priority]
    std::string body = address;
    std::string prio;
    bool hasPrio = false;
    const size_t at = body.find('@');
    if (at != std::string::npos) {
        prio = body.substr(at + 1);
        body = body.substr(0, at);
        hasPrio = true;
    }
    const size_t c1 = body.find(':');
    if (c1 == std::string::npos) return fail("E_ADDR_SYNTAX");
    const size_t c2 = body.find(':', c1 + 1);
    std::string type = body.substr(0, c1);
    const std::string inst =
        body.substr(c1 + 1, c2 == std::string::npos ? std::string::npos : c2 - c1 - 1);
    std::string prop = c2 == std::string::npos ? "" : body.substr(c2 + 1);
    if (c2 != std::string::npos && prop.empty()) return fail("E_ADDR_SYNTAX");
    for (char& c : type) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    for (char& c : prop) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));

    Address a;
    bool typeFound = false;
    for (const auto& e : kTypes)
        if (type == e.name) {
            a.objectType = e.type;
            typeFound = true;
        }
    if (!typeFound) return fail("E_ADDR_SYNTAX");
    uint64_t n = 0;
    if (!parseNumber(inst, n, 8)) return fail("E_ADDR_SYNTAX");
    bool numericProp = false;
    if (prop.empty() || prop == "present-value") {
        a.property = kPropPresentValue;
    } else if (prop == "relinquish") {
        a.property = kPropPresentValue;
        a.relinquish = true;
    } else {
        bool found = false;
        for (const auto& e : kProps)
            if (prop == e.name) {
                a.property = e.id;
                found = true;
            }
        if (!found) {
            uint64_t p = 0;
            if (!parseNumber(prop, p, 8)) return fail("E_ADDR_SYNTAX");
            if (p > kMaxProperty) return fail("E_ADDR_RANGE");
            a.property = static_cast<uint32_t>(p);
            numericProp = *propertyName(a.property) == '\0' && a.property != kPropPresentValue;
        }
    }
    uint64_t pr = 0;
    if (hasPrio && !parseNumber(prio, pr, 3)) return fail("E_ADDR_SYNTAX");
    if (a.relinquish && !hasPrio) return fail("E_ADDR_SYNTAX");
    if (n > kMaxInstance) return fail("E_ADDR_RANGE");
    a.instance = static_cast<uint32_t>(n);
    if (hasPrio && (pr < 1 || pr > 16 || pr == 6)) return fail("E_ADDR_RANGE");
    a.priority = static_cast<int>(pr);

    if (hasPrio && (a.property != kPropPresentValue || !isCommandable(a.objectType)))
        return fail("E_ADDR_AREA");
    if (a.relinquish && !isCommandable(a.objectType)) return fail("E_ADDR_AREA");
    if (!typeAllowed(a.objectType, numericProp ? 0xFFFFFFFFu : a.property, a.relinquish,
                     opts.rawType))
        return fail("E_ADDR_AREA");
    if (opts.rw && (a.property != kPropPresentValue || !isCommandable(a.objectType)))
        return fail("E_ADDR_AREA");

    a.normalized = std::string(typeName(a.objectType)) + ":" + std::to_string(a.instance);
    if (a.relinquish)
        a.normalized += ":relinquish";
    else if (a.property != kPropPresentValue) {
        const char* pn = propertyName(a.property);
        a.normalized += ":" + (*pn ? std::string(pn) : std::to_string(a.property));
    }
    if (a.priority) a.normalized += "@" + std::to_string(a.priority);
    a.ok = true;
    return a;
}

}  // namespace mat::bacnet
