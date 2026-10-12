#include "server/cli/csv.hpp"

#include <cstdio>
#include <string>

#include "core/common/utf8.hpp"

namespace mat {

// RFC 4180: quote fields containing a comma, quote or line break; double embedded quotes.
std::string csvField(const std::string& s) {
    if (s.find_first_of(",\"\r\n") == std::string::npos) return s;
    std::string q = "\"";
    for (char c : s) {
        if (c == '"') q += '"';
        q += c;
    }
    return q + "\"";
}

// Text cells: Excel and LibreOffice run a cell that starts with = + - @ (or a tab, a CR) as a
// formula, quoted or not; an apostrophe keeps it text (OWASP "CSV injection", security review M3).
// Excel may split on another separator than the comma (";" with the vi-VN list separator) and does
// not honour quotes then: every place where a cell could start (after ; , a tab or a line break)
// gets the same treatment. Number cells are never touched: -5.5 stays a number.
std::string csvText(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 2);
    for (size_t i = 0; i < s.size(); ++i) {
        const char c = s[i];
        const char before = i == 0 ? ',' : s[i - 1];
        const bool cellStart =
            before == ',' || before == ';' || before == '\t' || before == '\r' || before == '\n';
        const bool formula =
            c == '=' || c == '+' || c == '-' || c == '@' || (i == 0 && (c == '\t' || c == '\r'));
        if (cellStart && formula) out += '\'';
        out += c;
    }
    return csvField(out);
}

// On a terminal: control characters (escape sequences, carriage return, C1) as \xNN, and the
// characters that rearrange how a line reads (bidirectional controls, U+2028/2029) as \uXXXX;
// line breaks and tabs stay (security review of the fixes; review of the fixes, minor 8).
std::string forTerminal(const std::string& s) {
    std::string out;
    char hex[8];
    for (size_t i = 0; i < s.size(); ++i) {
        const auto c = static_cast<unsigned char>(s[i]);
        const bool c1 = c == 0xc2 && i + 1 < s.size() &&
                        static_cast<unsigned char>(s[i + 1]) >= 0x80 &&
                        static_cast<unsigned char>(s[i + 1]) < 0xa0;
        size_t controlLen = 0;
        const unsigned control = layoutControlAt(s, i, controlLen);
        if ((c < 0x20 && c != '\n' && c != '\t') || c == 0x7f) {
            std::snprintf(hex, sizeof hex, "\\x%02x", c);
            out += hex;
        } else if (c1) {
            std::snprintf(hex, sizeof hex, "\\u%04x", static_cast<unsigned char>(s[i + 1]));
            out += hex;
            ++i;
        } else if (control != 0) {
            std::snprintf(hex, sizeof hex, "\\u%04x", control);
            out += hex;
            i += controlLen - 1;
        } else {
            out += static_cast<char>(c);
        }
    }
    return out;
}

}  // namespace mat
