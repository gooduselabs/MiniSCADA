// Text cells of the device commands that print CSV (--export-history, --export-audit): RFC 4180
// quoting, protection against CSV injection, and safe display on a terminal.
#pragma once
#include <string>

namespace mat {

// RFC 4180: quote fields containing a comma, quote or line break; double embedded quotes.
std::string csvField(const std::string& s);

// Text cells: Excel and LibreOffice run a cell that starts with = + - @ (or a tab, a CR) as a
// formula, quoted or not; an apostrophe keeps it text (OWASP "CSV injection", security review M3).
// Excel may split on another separator than the comma (";" with the vi-VN list separator) and does
// not honour quotes then: every place where a cell could start (after ; , a tab or a line break)
// gets the same treatment. Number cells are never touched: -5.5 stays a number.
std::string csvText(const std::string& s);

// On a terminal: control characters (escape sequences, carriage return, C1) as \xNN, and the
// characters that rearrange how a line reads (bidirectional controls, U+2028/2029) as \uXXXX;
// line breaks and tabs stay.
std::string forTerminal(const std::string& s);

}  // namespace mat
