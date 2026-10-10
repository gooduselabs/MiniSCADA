// Limits checked BEFORE handing untrusted JSON to recursive code (security review M1, M3):
// nlohmann's parser recurses per nesting level and libstdc++ std::regex (used by valijson for
// "pattern") recurses per character, so deep nesting or very long strings could overflow the
// stack. Same algorithm as packages/project-schema/src/validate.ts (jsonNestingDepth).
#pragma once
#include <cstddef>
#include <optional>
#include <string>

#include "nlohmann/json.hpp"

namespace mat {

constexpr int kMaxProjectJsonDepth = 64;
constexpr size_t kMaxProjectStringBytes = 1024;
constexpr int kMaxLiveMessageDepth = 32;

// Deepest [ / { nesting, ignoring characters inside strings.
inline int jsonNestingDepth(const char* data, size_t len) {
    int depth = 0, max = 0;
    bool inString = false, escaped = false;
    for (size_t i = 0; i < len; ++i) {
        const char c = data[i];
        if (inString) {
            if (escaped)
                escaped = false;
            else if (c == '\\')
                escaped = true;
            else if (c == '"')
                inString = false;
        } else if (c == '"') {
            inString = true;
        } else if (c == '[' || c == '{') {
            if (++depth > max) max = depth;
        } else if (c == ']' || c == '}') {
            --depth;
        }
    }
    return max;
}

// JSON Pointer of the first key or string value longer than maxBytes (UTF-8 bytes), if any.
inline std::optional<std::string> findLongString(const nlohmann::json& v, const std::string& path,
                                                 size_t maxBytes) {
    if (v.is_string()) {
        if (v.get_ref<const std::string&>().size() > maxBytes) return path;
        return std::nullopt;
    }
    if (v.is_array()) {
        for (size_t i = 0; i < v.size(); ++i)
            if (auto r = findLongString(v[i], path + "/" + std::to_string(i), maxBytes)) return r;
        return std::nullopt;
    }
    if (v.is_object()) {
        for (auto it = v.begin(); it != v.end(); ++it) {
            std::string key;
            for (char ch : it.key()) {
                if (ch == '~')
                    key += "~0";
                else if (ch == '/')
                    key += "~1";
                else
                    key += ch;
            }
            const std::string p = path + "/" + key;
            if (it.key().size() > maxBytes) return p;
            if (auto r = findLongString(it.value(), p, maxBytes)) return r;
        }
    }
    return std::nullopt;
}

}  // namespace mat
