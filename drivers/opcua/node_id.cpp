#include "drivers/opcua/node_id.hpp"

#include <cctype>

namespace mat::opcua {

namespace {

bool allDigits(const std::string& s) {
    if (s.empty()) return false;
    for (char c : s)
        if (c < '0' || c > '9') return false;
    return true;
}

// Decimal digits in [0, max]; false when larger.
bool decimal(const std::string& s, uint64_t max, uint64_t& out) {
    size_t i = 0;
    while (i + 1 < s.size() && s[i] == '0') ++i;
    if (s.size() - i > 10) return false;
    uint64_t v = 0;
    for (; i < s.size(); ++i) v = v * 10 + static_cast<uint64_t>(s[i] - '0');
    if (v > max) return false;
    out = v;
    return true;
}

bool hexChar(char c) { return std::isxdigit(static_cast<unsigned char>(c)) != 0; }

bool guid(const std::string& s) {
    if (s.size() != 36) return false;
    for (size_t i = 0; i < s.size(); ++i) {
        const bool dash = i == 8 || i == 13 || i == 18 || i == 23;
        if (dash ? s[i] != '-' : !hexChar(s[i])) return false;
    }
    return true;
}

bool base64(const std::string& s) {
    if (s.empty() || s.size() % 4 != 0) return false;
    size_t pad = 0;
    for (size_t i = 0; i < s.size(); ++i) {
        const char c = s[i];
        if (c == '=') {
            ++pad;
            continue;
        }
        if (pad) return false;  // a character after the padding
        if (!(std::isalnum(static_cast<unsigned char>(c)) || c == '+' || c == '/')) return false;
    }
    return pad <= 2;
}

}  // namespace

const char* idTypeName(IdType t) {
    switch (t) {
        case IdType::Numeric:
            return "i";
        case IdType::String:
            return "s";
        case IdType::Guid:
            return "g";
        case IdType::Opaque:
            return "b";
    }
    return "i";
}

NodeIdRef parseNodeId(const std::string& address) {
    NodeIdRef r;
    auto fail = [&r](const char* code) {
        r.ok = false;
        r.error = code;
        return r;
    };
    std::string rest = address;
    if (rest.rfind("ns=", 0) == 0) {
        const size_t semi = rest.find(';');
        if (semi == std::string::npos) return fail("E_ADDR_SYNTAX");
        const std::string n = rest.substr(3, semi - 3);
        if (!allDigits(n)) return fail("E_ADDR_SYNTAX");
        uint64_t v = 0;
        if (!decimal(n, 65535, v)) return fail("E_ADDR_RANGE");
        r.ns = static_cast<uint16_t>(v);
        rest = rest.substr(semi + 1);
    }
    if (rest.size() < 2 || rest[1] != '=') return fail("E_ADDR_SYNTAX");
    const char kind = rest[0];
    const std::string body = rest.substr(2);
    switch (kind) {
        case 'i': {
            if (!allDigits(body)) return fail("E_ADDR_SYNTAX");
            uint64_t v = 0;
            if (!decimal(body, 4294967295ULL, v)) return fail("E_ADDR_RANGE");
            r.type = IdType::Numeric;
            r.numeric = static_cast<uint32_t>(v);
            r.id = std::to_string(v);
            break;
        }
        case 's':
            if (body.empty()) return fail("E_ADDR_SYNTAX");
            for (char c : body) {
                const auto u = static_cast<unsigned char>(c);
                if (u < 0x20 || u == 0x7f) return fail("E_ADDR_SYNTAX");
            }
            r.type = IdType::String;
            r.id = body;
            break;
        case 'g':
            if (!guid(body)) return fail("E_ADDR_SYNTAX");
            r.type = IdType::Guid;
            r.id = body;
            for (char& c : r.id) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            break;
        case 'b':
            if (!base64(body)) return fail("E_ADDR_SYNTAX");
            r.type = IdType::Opaque;
            r.id = body;
            break;
        default:
            return fail("E_ADDR_SYNTAX");
    }
    r.ok = true;
    r.normalized = (r.ns == 0 ? std::string() : "ns=" + std::to_string(r.ns) + ";") +
                   idTypeName(r.type) + "=" + r.id;
    return r;
}

}  // namespace mat::opcua
