#include "drivers/s7/address.hpp"

#include <algorithm>
#include <cctype>

namespace mat::s7 {

namespace {

enum class Size { X, B, W, D, STRING, LREAL };

// Reads 1-5 digits at `pos`; false when there are none or more than five.
bool readNum(const std::string& s, size_t& pos, long& out) {
    size_t n = 0;
    out = 0;
    while (pos < s.size() && std::isdigit(static_cast<unsigned char>(s[pos]))) {
        if (++n > 5) return false;
        out = out * 10 + (s[pos] - '0');
        ++pos;
    }
    return n > 0;
}

bool startsWith(const std::string& s, size_t pos, const char* word) {
    const std::string w(word);
    return s.compare(pos, w.size(), w) == 0;
}

bool typeOf(Size size, TagType raw, S7Type& out) {
    switch (size) {
        case Size::X:
            if (raw != TagType::BOOL) return false;
            out = S7Type::BOOL;
            return true;
        case Size::B:
            if (raw == TagType::UINT16)
                out = S7Type::BYTE;
            else if (raw == TagType::STRING)
                out = S7Type::CHAR;
            else
                return false;
            return true;
        case Size::W:
            if (raw == TagType::INT16)
                out = S7Type::INT;
            else if (raw == TagType::UINT16)
                out = S7Type::WORD;
            else
                return false;
            return true;
        case Size::D:
            if (raw == TagType::INT32)
                out = S7Type::DINT;
            else if (raw == TagType::UINT32)
                out = S7Type::DWORD;
            else if (raw == TagType::FLOAT32)
                out = S7Type::REAL;
            else
                return false;
            return true;
        case Size::LREAL:
            if (raw != TagType::FLOAT64) return false;
            out = S7Type::LREAL;
            return true;
        case Size::STRING:
            if (raw != TagType::STRING) return false;
            out = S7Type::STRING;
            return true;
    }
    return false;
}

const char* sizeLetter(Size s) {
    switch (s) {
        case Size::B:
            return "B";
        case Size::W:
            return "W";
        case Size::D:
            return "D";
        case Size::STRING:
            return "STRING";
        case Size::LREAL:
            return "LREAL";
        default:
            return "X";
    }
}

}  // namespace

const char* areaName(Area a) {
    switch (a) {
        case Area::DB:
            return "DB";
        case Area::I:
            return "I";
        case Area::Q:
            return "Q";
        default:
            return "M";
    }
}

int areaCode(Area a) {
    switch (a) {
        case Area::DB:
            return 0x84;
        case Area::I:
            return 0x81;
        case Area::Q:
            return 0x82;
        default:
            return 0x83;
    }
}

const char* s7TypeName(S7Type t) {
    static const char* const kNames[] = {"BOOL", "BYTE",  "CHAR", "INT",   "WORD",
                                         "DINT", "DWORD", "REAL", "LREAL", "STRING"};
    return kNames[static_cast<int>(t)];
}

int typeSize(S7Type t, int n) {
    switch (t) {
        case S7Type::BOOL:
        case S7Type::BYTE:
            return 1;
        case S7Type::CHAR:
            return std::max(1, n);
        case S7Type::INT:
        case S7Type::WORD:
            return 2;
        case S7Type::DINT:
        case S7Type::DWORD:
        case S7Type::REAL:
            return 4;
        case S7Type::LREAL:
            return 8;
        case S7Type::STRING:
            return std::max(1, n) + 2;
    }
    return 1;
}

int writeSize(S7Type t, int size) { return t == S7Type::STRING ? size - 1 : size; }

Address parseAddress(const std::string& address, const AddressOptions& opts) {
    Address r;
    std::string s = address;
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
    auto syntax = [&r] {
        r.error = "E_ADDR_SYNTAX";
        return r;
    };
    size_t pos = 0;
    Size size = Size::X;
    long db = 0, byte = 0, bit = -1;
    if (startsWith(s, 0, "DB")) {
        pos = 2;
        if (!readNum(s, pos, db) || pos >= s.size() || s[pos] != '.') return syntax();
        ++pos;
        if (startsWith(s, pos, "DBX")) {
            pos += 3;
            size = Size::X;
        } else if (startsWith(s, pos, "DBB")) {
            pos += 3;
            size = Size::B;
        } else if (startsWith(s, pos, "DBW")) {
            pos += 3;
            size = Size::W;
        } else if (startsWith(s, pos, "DBD")) {
            pos += 3;
            size = Size::D;
        } else if (startsWith(s, pos, "STRING")) {
            pos += 6;
            size = Size::STRING;
        } else if (startsWith(s, pos, "LREAL")) {
            pos += 5;
            size = Size::LREAL;
        } else {
            return syntax();
        }
        r.area = Area::DB;
        if (!readNum(s, pos, byte)) return syntax();
    } else {
        if (s.empty()) return syntax();
        switch (s[0]) {
            case 'M':
                r.area = Area::M;
                break;
            case 'I':
            case 'E':
                r.area = Area::I;
                break;
            case 'Q':
            case 'A':
                r.area = Area::Q;
                break;
            default:
                return syntax();
        }
        pos = 1;
        if (pos < s.size() && (s[pos] == 'B' || s[pos] == 'W' || s[pos] == 'D')) {
            size = s[pos] == 'B' ? Size::B : (s[pos] == 'W' ? Size::W : Size::D);
            ++pos;
        }
        if (!readNum(s, pos, byte)) return syntax();
    }
    if (size == Size::X) {
        // "." and one digit
        if (pos + 2 != s.size() || s[pos] != '.' ||
            !std::isdigit(static_cast<unsigned char>(s[pos + 1])))
            return syntax();
        bit = s[pos + 1] - '0';
        pos += 2;
    }
    if (pos != s.size()) return syntax();

    if ((r.area == Area::DB && (db < 1 || db > 65535)) || byte > 65535 || bit > 7) {
        r.error = "E_ADDR_RANGE";
        return r;
    }
    S7Type type;
    if (!typeOf(size, opts.rawType, type) || (r.area == Area::I && opts.rw)) {
        r.error = "E_ADDR_AREA";
        return r;
    }
    const int bytes = typeSize(type, opts.stringLength);
    if (byte + bytes > 65536) {
        r.error = "E_ADDR_RANGE";
        return r;
    }
    r.ok = true;
    r.db = static_cast<int>(db);
    r.byte = static_cast<int>(byte);
    r.bit = static_cast<int>(bit);
    r.type = type;
    r.size = bytes;
    const std::string b = std::to_string(byte);
    if (r.area == Area::DB) {
        std::string item;
        if (size == Size::X)
            item = "DBX" + b + "." + std::to_string(bit);
        else if (size == Size::STRING || size == Size::LREAL)
            item = std::string(sizeLetter(size)) + b;
        else
            item = std::string("DB") + sizeLetter(size) + b;
        r.normalized = "DB" + std::to_string(db) + "." + item;
    } else {
        r.normalized = std::string(areaName(r.area)) +
                       (size == Size::X ? b + "." + std::to_string(bit) : sizeLetter(size) + b);
    }
    return r;
}

}  // namespace mat::s7
