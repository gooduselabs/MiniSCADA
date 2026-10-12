// UTF-8 text from devices may be anything (specs/003-data-logging security review M1): the tag
// store repairs it once, the historian cuts it by characters, SQL Server by UTF-16 units.
#pragma once
#include <cstddef>
#include <string>

namespace mat {

// Every sequence that is not valid UTF-8 (stray continuation bytes, overlong forms, surrogates,
// code points above U+10FFFF, cut sequences) becomes U+FFFD, one per offending byte. Valid text
// comes back unchanged; `repaired` (optional) says whether something was replaced.
std::string sanitizeUtf8(const std::string& s, bool* repaired = nullptr);
bool isValidUtf8(const std::string& s);

// For valid UTF-8: the first `maxChars` code points.
std::string utf8Prefix(const std::string& s, size_t maxChars, bool& truncated);
// For valid UTF-8: the longest prefix of at most `maxUnits` UTF-16 code units (SQL Server
// NVARCHAR(n) counts these; a code point above U+FFFF takes two).
std::string utf16Prefix(const std::string& s, size_t maxUnits);

// For valid UTF-8: the code point at s[i] when it rearranges how a line reads without being seen
// (U+061C, U+200E, U+200F marks; U+2028, U+2029 separators; U+202A … U+202E embeddings and
// overrides; U+2066 … U+2069 isolates), with its length in bytes in `len`; else 0 (len 0). The
// journal and a terminal show these as \uXXXX (review of the fixes, minor 8).
unsigned layoutControlAt(const std::string& s, size_t i, size_t& len);

}  // namespace mat
