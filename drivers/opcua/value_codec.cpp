#include "drivers/opcua/value_codec.hpp"

#include <cfloat>
#include <cmath>
#include <cstdio>
#include <ctime>
#include <limits>

namespace mat::opcua {

namespace {

// One OPC UA scalar, in the widest C++ type of its family.
struct Num {
    enum Kind { None, Bool, Signed, Unsigned, Real, Text, Time } kind = None;
    bool b = false;
    int64_t i = 0;
    uint64_t u = 0;
    double d = 0;
    std::string s;
    UA_DateTime t = 0;
};

Num numOf(const UA_Variant& v) {
    Num n;
    if (!v.type || !v.data || !UA_Variant_isScalar(&v)) return n;
    switch (v.type->typeKind) {
        case UA_DATATYPEKIND_BOOLEAN:
            n.kind = Num::Bool;
            n.b = *static_cast<const UA_Boolean*>(v.data);
            break;
        case UA_DATATYPEKIND_SBYTE:
            n.kind = Num::Signed;
            n.i = *static_cast<const UA_SByte*>(v.data);
            break;
        case UA_DATATYPEKIND_INT16:
            n.kind = Num::Signed;
            n.i = *static_cast<const UA_Int16*>(v.data);
            break;
        case UA_DATATYPEKIND_INT32:
            n.kind = Num::Signed;
            n.i = *static_cast<const UA_Int32*>(v.data);
            break;
        case UA_DATATYPEKIND_INT64:
            n.kind = Num::Signed;
            n.i = *static_cast<const UA_Int64*>(v.data);
            break;
        case UA_DATATYPEKIND_BYTE:
            n.kind = Num::Unsigned;
            n.u = *static_cast<const UA_Byte*>(v.data);
            break;
        case UA_DATATYPEKIND_UINT16:
            n.kind = Num::Unsigned;
            n.u = *static_cast<const UA_UInt16*>(v.data);
            break;
        case UA_DATATYPEKIND_UINT32:
            n.kind = Num::Unsigned;
            n.u = *static_cast<const UA_UInt32*>(v.data);
            break;
        case UA_DATATYPEKIND_UINT64:
            n.kind = Num::Unsigned;
            n.u = *static_cast<const UA_UInt64*>(v.data);
            break;
        case UA_DATATYPEKIND_FLOAT:
            n.kind = Num::Real;
            n.d = *static_cast<const UA_Float*>(v.data);
            break;
        case UA_DATATYPEKIND_DOUBLE:
            n.kind = Num::Real;
            n.d = *static_cast<const UA_Double*>(v.data);
            break;
        case UA_DATATYPEKIND_STRING: {
            const auto* s = static_cast<const UA_String*>(v.data);
            n.kind = Num::Text;
            n.s.assign(reinterpret_cast<const char*>(s->data), s->length);
            break;
        }
        case UA_DATATYPEKIND_DATETIME:
            n.kind = Num::Time;
            n.t = *static_cast<const UA_DateTime*>(v.data);
            break;
        default:
            break;
    }
    return n;
}

// The raw value the coordinator gives, whatever alternative it uses.
Num numOfRaw(const TagScalar& raw) {
    Num n;
    if (const bool* b = std::get_if<bool>(&raw)) {
        n.kind = Num::Bool;
        n.b = *b;
    } else if (const int64_t* i = std::get_if<int64_t>(&raw)) {
        n.kind = Num::Signed;
        n.i = *i;
    } else if (const uint64_t* u = std::get_if<uint64_t>(&raw)) {
        n.kind = Num::Unsigned;
        n.u = *u;
    } else if (const double* d = std::get_if<double>(&raw)) {
        n.kind = Num::Real;
        n.d = *d;
    } else if (const std::string* s = std::get_if<std::string>(&raw)) {
        n.kind = Num::Text;
        n.s = *s;
    }
    return n;
}

// An integer value of `n` in [lo, hi] (signed view); false when it is not an integer or outside.
bool asSigned(const Num& n, int64_t lo, int64_t hi, int64_t& out) {
    switch (n.kind) {
        case Num::Bool:
            out = n.b ? 1 : 0;
            break;
        case Num::Signed:
            out = n.i;
            break;
        case Num::Unsigned:
            if (n.u > static_cast<uint64_t>(std::numeric_limits<int64_t>::max())) return false;
            out = static_cast<int64_t>(n.u);
            break;
        default:
            return false;
    }
    return out >= lo && out <= hi;
}

bool asUnsigned(const Num& n, uint64_t hi, uint64_t& out) {
    switch (n.kind) {
        case Num::Bool:
            out = n.b ? 1 : 0;
            break;
        case Num::Signed:
            if (n.i < 0) return false;
            out = static_cast<uint64_t>(n.i);
            break;
        case Num::Unsigned:
            out = n.u;
            break;
        default:
            return false;
    }
    return out <= hi;
}

bool asReal(const Num& n, double& out) {
    switch (n.kind) {
        case Num::Bool:
            out = n.b ? 1 : 0;
            return true;
        case Num::Signed:
            out = static_cast<double>(n.i);
            return true;
        case Num::Unsigned:
            out = static_cast<double>(n.u);
            return true;
        case Num::Real:
            out = n.d;
            return true;
        default:
            return false;
    }
}

// A real that is a whole number, as an integer of the given family (writes of FLOAT Tags to
// integer nodes).
Num integral(const Num& n) {
    if (n.kind != Num::Real || !std::isfinite(n.d) || std::floor(n.d) != n.d) return n;
    Num r;
    if (n.d < 0) {
        if (n.d < -9.2233720368547758e18) return n;
        r.kind = Num::Signed;
        r.i = static_cast<int64_t>(n.d);
    } else {
        if (n.d >= 1.8446744073709552e19) return n;
        r.kind = Num::Unsigned;
        r.u = static_cast<uint64_t>(n.d);
    }
    return r;
}

template <typename T>
void setScalar(UA_Variant& out, T v, const UA_DataType* type) {
    UA_Variant_setScalarCopy(&out, &v, type);
}

}  // namespace

int64_t unixMs(UA_DateTime t) {
    const int64_t d = static_cast<int64_t>(t) - static_cast<int64_t>(UA_DATETIME_UNIX_EPOCH);
    // floor division by 10000 (100 ns ticks per ms)
    return d >= 0 ? d / 10000 : -((-d + 9999) / 10000);
}

UA_DateTime fromUnixMs(int64_t ms) {
    return static_cast<UA_DateTime>(ms * 10000 + static_cast<int64_t>(UA_DATETIME_UNIX_EPOCH));
}

std::string isoUtc(UA_DateTime t) {
    const int64_t ms = unixMs(t);
    int64_t sec = ms >= 0 ? ms / 1000 : -((-ms + 999) / 1000);
    const int milli = static_cast<int>(ms - sec * 1000);
    const time_t tt = static_cast<time_t>(sec);
    struct tm tmv {};
    if (!gmtime_r(&tt, &tmv)) return "";
    char b[40];
    std::snprintf(b, sizeof b, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", tmv.tm_year + 1900,
                  tmv.tm_mon + 1, tmv.tm_mday, tmv.tm_hour, tmv.tm_min, tmv.tm_sec, milli);
    return b;
}

bool parseIsoUtc(const std::string& s, UA_DateTime& out) {
    int y, mo, d, h, mi, se, n = 0;
    if (std::sscanf(s.c_str(), "%4d-%2d-%2dT%2d:%2d:%2d%n", &y, &mo, &d, &h, &mi, &se, &n) != 6 ||
        n != 19)
        return false;
    size_t p = 19;
    int milli = 0;
    if (p < s.size() && s[p] == '.') {
        ++p;
        int digits = 0;
        while (p < s.size() && s[p] >= '0' && s[p] <= '9') {
            if (digits < 3) milli = milli * 10 + (s[p] - '0');
            ++digits;
            ++p;
        }
        if (digits == 0) return false;
        for (int k = digits; k < 3; ++k) milli *= 10;
    }
    if (p + 1 != s.size() || s[p] != 'Z') return false;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 60) return false;
    struct tm tmv {};
    tmv.tm_year = y - 1900;
    tmv.tm_mon = mo - 1;
    tmv.tm_mday = d;
    tmv.tm_hour = h;
    tmv.tm_min = mi;
    tmv.tm_sec = se;
    const time_t sec = timegm(&tmv);
    out = fromUnixMs(static_cast<int64_t>(sec) * 1000 + milli);
    return true;
}

bool decodeVariant(const UA_Variant& v, TagType rawType, TagScalar& out) {
    const Num n = numOf(v);
    if (n.kind == Num::None) return false;
    switch (rawType) {
        case TagType::BOOL:
            if (n.kind == Num::Bool) {
                out = n.b;
                return true;
            }
            if (n.kind == Num::Signed) {
                out = n.i != 0;
                return true;
            }
            if (n.kind == Num::Unsigned) {
                out = n.u != 0;
                return true;
            }
            return false;
        case TagType::INT16:
        case TagType::INT32:
        case TagType::INT64: {
            if (n.kind == Num::Time) {
                if (rawType != TagType::INT64) return false;
                out = static_cast<int64_t>(unixMs(n.t));
                return true;
            }
            const int64_t lo = rawType == TagType::INT16
                                   ? INT16_MIN
                                   : rawType == TagType::INT32 ? INT32_MIN : INT64_MIN;
            const int64_t hi = rawType == TagType::INT16
                                   ? INT16_MAX
                                   : rawType == TagType::INT32 ? INT32_MAX : INT64_MAX;
            int64_t i = 0;
            if (!asSigned(n, lo, hi, i)) return false;
            out = i;
            return true;
        }
        case TagType::UINT16:
        case TagType::UINT32:
        case TagType::UINT64: {
            if (n.kind == Num::Time) {
                if (rawType != TagType::UINT64) return false;
                const int64_t ms = unixMs(n.t);
                if (ms < 0) return false;
                out = static_cast<uint64_t>(ms);
                return true;
            }
            const uint64_t hi = rawType == TagType::UINT16
                                    ? UINT16_MAX
                                    : rawType == TagType::UINT32 ? UINT32_MAX : UINT64_MAX;
            uint64_t u = 0;
            if (!asUnsigned(n, hi, u)) return false;
            out = u;
            return true;
        }
        case TagType::FLOAT32:
        case TagType::FLOAT64: {
            double d = 0;
            if (!asReal(n, d)) return false;
            if (rawType == TagType::FLOAT32 && std::isfinite(d) && std::fabs(d) > FLT_MAX)
                return false;
            out = d;
            return true;
        }
        case TagType::STRING:
            switch (n.kind) {
                case Num::Text:
                    out = n.s;
                    return true;
                case Num::Bool:
                    out = std::string(n.b ? "true" : "false");
                    return true;
                case Num::Signed:
                    out = std::to_string(n.i);
                    return true;
                case Num::Unsigned:
                    out = std::to_string(n.u);
                    return true;
                case Num::Time:
                    out = isoUtc(n.t);
                    return true;
                default:
                    return false;
            }
    }
    return false;
}

bool encodeVariant(const TagScalar& raw, TagType rawType, const UA_DataType* type,
                   UA_Variant& out) {
    UA_Variant_init(&out);
    if (!type) return false;
    Num n = numOfRaw(raw);
    if (n.kind == Num::None) return false;
    const Num whole = integral(n);
    int64_t i = 0;
    uint64_t u = 0;
    double d = 0;
    switch (type->typeKind) {
        case UA_DATATYPEKIND_BOOLEAN:
            if (n.kind == Num::Bool) {
                setScalar<UA_Boolean>(out, n.b, type);
                return true;
            }
            if (!asSigned(whole, 0, 1, i)) return false;
            setScalar<UA_Boolean>(out, i != 0, type);
            return true;
        case UA_DATATYPEKIND_SBYTE:
            if (!asSigned(whole, INT8_MIN, INT8_MAX, i)) return false;
            setScalar<UA_SByte>(out, static_cast<UA_SByte>(i), type);
            return true;
        case UA_DATATYPEKIND_INT16:
            if (!asSigned(whole, INT16_MIN, INT16_MAX, i)) return false;
            setScalar<UA_Int16>(out, static_cast<UA_Int16>(i), type);
            return true;
        case UA_DATATYPEKIND_INT32:
            if (!asSigned(whole, INT32_MIN, INT32_MAX, i)) return false;
            setScalar<UA_Int32>(out, static_cast<UA_Int32>(i), type);
            return true;
        case UA_DATATYPEKIND_INT64:
            if (!asSigned(whole, INT64_MIN, INT64_MAX, i)) return false;
            setScalar<UA_Int64>(out, static_cast<UA_Int64>(i), type);
            return true;
        case UA_DATATYPEKIND_BYTE:
            if (!asUnsigned(whole, UINT8_MAX, u)) return false;
            setScalar<UA_Byte>(out, static_cast<UA_Byte>(u), type);
            return true;
        case UA_DATATYPEKIND_UINT16:
            if (!asUnsigned(whole, UINT16_MAX, u)) return false;
            setScalar<UA_UInt16>(out, static_cast<UA_UInt16>(u), type);
            return true;
        case UA_DATATYPEKIND_UINT32:
            if (!asUnsigned(whole, UINT32_MAX, u)) return false;
            setScalar<UA_UInt32>(out, static_cast<UA_UInt32>(u), type);
            return true;
        case UA_DATATYPEKIND_UINT64:
            if (!asUnsigned(whole, UINT64_MAX, u)) return false;
            setScalar<UA_UInt64>(out, static_cast<UA_UInt64>(u), type);
            return true;
        case UA_DATATYPEKIND_FLOAT:
            if (!asReal(n, d)) return false;
            if (std::isfinite(d) && std::fabs(d) > FLT_MAX) return false;
            setScalar<UA_Float>(out, static_cast<UA_Float>(d), type);
            return true;
        case UA_DATATYPEKIND_DOUBLE:
            if (!asReal(n, d)) return false;
            setScalar<UA_Double>(out, d, type);
            return true;
        case UA_DATATYPEKIND_STRING: {
            if (n.kind != Num::Text) return false;
            UA_String s;
            s.length = n.s.size();
            s.data = reinterpret_cast<UA_Byte*>(const_cast<char*>(n.s.data()));
            UA_Variant_setScalarCopy(&out, &s, type);
            return true;
        }
        case UA_DATATYPEKIND_DATETIME: {
            UA_DateTime t = 0;
            if (n.kind == Num::Text) {
                if (!parseIsoUtc(n.s, t)) return false;
            } else if (asSigned(n, INT64_MIN / 10000 + 1, INT64_MAX / 10000 - 1, i)) {
                t = fromUnixMs(i);
            } else {
                return false;
            }
            (void)rawType;
            setScalar<UA_DateTime>(out, t, type);
            return true;
        }
        default:
            return false;
    }
}

const UA_DataType* naturalType(TagType rawType) {
    switch (rawType) {
        case TagType::BOOL:
            return &UA_TYPES[UA_TYPES_BOOLEAN];
        case TagType::INT16:
            return &UA_TYPES[UA_TYPES_INT16];
        case TagType::UINT16:
            return &UA_TYPES[UA_TYPES_UINT16];
        case TagType::INT32:
            return &UA_TYPES[UA_TYPES_INT32];
        case TagType::UINT32:
            return &UA_TYPES[UA_TYPES_UINT32];
        case TagType::INT64:
            return &UA_TYPES[UA_TYPES_INT64];
        case TagType::UINT64:
            return &UA_TYPES[UA_TYPES_UINT64];
        case TagType::FLOAT32:
            return &UA_TYPES[UA_TYPES_FLOAT];
        case TagType::FLOAT64:
            return &UA_TYPES[UA_TYPES_DOUBLE];
        case TagType::STRING:
            return &UA_TYPES[UA_TYPES_STRING];
    }
    return nullptr;
}

bool sameRaw(const TagScalar& a, const TagScalar& b, TagType rawType) {
    const Num x = numOfRaw(a), y = numOfRaw(b);
    if (rawType == TagType::STRING) return x.kind == Num::Text && y.kind == Num::Text && x.s == y.s;
    if (rawType == TagType::FLOAT32 || rawType == TagType::FLOAT64) {
        double p = 0, q = 0;
        if (!asReal(x, p) || !asReal(y, q)) return false;
        if (std::isnan(p) && std::isnan(q)) return true;
        return rawType == TagType::FLOAT32 ? static_cast<float>(p) == static_cast<float>(q)
                                           : p == q;
    }
    if (rawType == TagType::BOOL) {
        int64_t p = 0, q = 0;
        const Num wx = integral(x), wy = integral(y);
        return asSigned(wx, 0, 1, p) && asSigned(wy, 0, 1, q) && p == q;
    }
    const Num wx = integral(x), wy = integral(y);
    int64_t p = 0, q = 0;
    if (asSigned(wx, INT64_MIN, INT64_MAX, p) && asSigned(wy, INT64_MIN, INT64_MAX, q))
        return p == q;
    uint64_t r = 0, s = 0;
    return asUnsigned(wx, UINT64_MAX, r) && asUnsigned(wy, UINT64_MAX, s) && r == s;
}

const char* suggestedTagType(const UA_NodeId& dataType) {
    if (dataType.namespaceIndex != 0 || dataType.identifierType != UA_NODEIDTYPE_NUMERIC)
        return nullptr;
    switch (dataType.identifier.numeric) {
        case UA_NS0ID_BOOLEAN:
            return "BOOL";
        case UA_NS0ID_SBYTE:
        case UA_NS0ID_INT16:
            return "INT16";
        case UA_NS0ID_BYTE:
        case UA_NS0ID_UINT16:
            return "UINT16";
        case UA_NS0ID_INT32:
            return "INT32";
        case UA_NS0ID_UINT32:
            return "UINT32";
        case UA_NS0ID_INT64:
            return "INT64";
        case UA_NS0ID_UINT64:
            return "UINT64";
        case UA_NS0ID_FLOAT:
            return "FLOAT32";
        case UA_NS0ID_DOUBLE:
            return "FLOAT64";
        case UA_NS0ID_STRING:
            return "STRING";
        case UA_NS0ID_DATETIME:
            return "INT64";
        default:
            return nullptr;
    }
}

std::string dataTypeName(const UA_NodeId& dataType) {
    const UA_DataType* t = UA_findDataType(&dataType);
    return t && t->typeName ? std::string(t->typeName) : std::string();
}

}  // namespace mat::opcua
