// base64url without padding (RFC 4648 §5): session tokens are "mats_" + the 43 characters of 32
// random bytes (feature 005 research R9).
#pragma once
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

namespace mat {

std::string base64urlEncode(const void* data, size_t len);
std::string base64urlEncode(std::string_view bytes);
// Strict: only the alphabet A-Z a-z 0-9 - _, no padding, no white space, and the unused low bits
// of the last character zero, so every value has exactly one text. Anything else: nullopt.
std::optional<std::string> base64urlDecode(std::string_view text);

}  // namespace mat
