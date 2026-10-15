// Alarm text and the folding of text for searching (contracts/alarm-engine.md §11,
// alarm-store.md §7). Pure functions; no locale: C++ and TS must give the same characters.
#pragma once
#include <string>
#include <string_view>

#include "core/alarm/alarm_types.hpp"

namespace mat::alarm {

// The decimal separator of numbers in the text: a comma, as in contracts/alarm-engine.md §11 and the
// shared vectors (tests/alarm-vectors). NOTE: spec.md D41 says a dot; the two disagree and the
// vectors follow the contract. One constant to flip, with the vectors and the TS twin.
inline constexpr char kDecimalSeparator = ',';

// Shortest decimal text of a double that reads back to the same value, never in exponent form
// (tries %.1e … %.17e until strtod gives the value back); "0" for zero and for -0.
std::string shortestDouble(double v);

// {value:N}: the digits of shortestDouble rounded half away from zero to N (0..6) decimals, padded
// with zeros; "-0" becomes "0". {value} without N is formatNumber(v, 6) with the trailing zeros
// and a lonely separator removed (formatNumberTrim).
std::string formatNumber(double v, int decimals);
std::string formatNumberTrim(double v);

// Template used when the definition has none (D9).
std::string defaultTemplate(AlarmKind kind, std::string_view limitName);

// Tags: {name} {tag} {value} {value:N} {unit} {limit} {limitName} {area} {reason}. Empty `tpl`:
// the default of ctx.kind/ctx.limitName. Post-processing: empty () removed, runs of spaces
// collapsed, trimmed, cut to 200 code points (199 and "…" when longer, never inside a character
// with combining marks).
std::string formatAlarmText(const TextTemplate& tpl, const TextContext& ctx);

// Lower case, no Vietnamese diacritics ("Bồn B1 QUÁ ÁP" -> "bon b1 qua ap"). Invalid UTF-8 becomes
// U+FFFD; combining marks U+0300…U+036F are dropped; other characters unchanged.
std::string foldText(std::string_view utf8);

// Number of Unicode code points of valid UTF-8 text.
size_t utf8Length(std::string_view s);

}  // namespace mat::alarm
