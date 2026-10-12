// Lexer (contracts/expression-language.md §2). Strict mode: stops at the first error and returns a
// LexErr token carrying the exact error span.
#include <algorithm>
#include <cmath>
#include <cstdlib>

#include "core/expression/internal.hpp"

namespace mat::expr::detail {

Cps decodeUtf8(const std::string& s) {
    Cps out;
    out.reserve(s.size());
    const auto* p = reinterpret_cast<const unsigned char*>(s.data());
    const size_t n = s.size();
    size_t i = 0;
    while (i < n) {
        const unsigned c = p[i];
        size_t len = 0;
        char32_t cp = 0;
        char32_t minv = 0;
        if (c < 0x80) {
            out.push_back(c);
            ++i;
            continue;
        } else if (c >= 0xC2 && c <= 0xDF) {
            len = 2;
            cp = c & 0x1F;
            minv = 0x80;
        } else if (c >= 0xE0 && c <= 0xEF) {
            len = 3;
            cp = c & 0x0F;
            minv = 0x800;
        } else if (c >= 0xF0 && c <= 0xF4) {
            len = 4;
            cp = c & 0x07;
            minv = 0x10000;
        }
        bool ok = len > 0 && i + len <= n;
        for (size_t j = 1; ok && j < len; ++j) {
            if ((p[i + j] & 0xC0) != 0x80)
                ok = false;
            else
                cp = (cp << 6) | (p[i + j] & 0x3F);
        }
        if (ok && (cp < minv || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF))) ok = false;
        if (!ok) {
            out.push_back(0xFFFD);
            ++i;
        } else {
            out.push_back(cp);
            i += len;
        }
    }
    return out;
}

std::string encodeUtf8(char32_t c) {
    std::string o;
    if (c < 0x80) {
        o += static_cast<char>(c);
    } else if (c < 0x800) {
        o += static_cast<char>(0xC0 | (c >> 6));
        o += static_cast<char>(0x80 | (c & 0x3F));
    } else if (c < 0x10000) {
        o += static_cast<char>(0xE0 | (c >> 12));
        o += static_cast<char>(0x80 | ((c >> 6) & 0x3F));
        o += static_cast<char>(0x80 | (c & 0x3F));
    } else {
        o += static_cast<char>(0xF0 | (c >> 18));
        o += static_cast<char>(0x80 | ((c >> 12) & 0x3F));
        o += static_cast<char>(0x80 | ((c >> 6) & 0x3F));
        o += static_cast<char>(0x80 | (c & 0x3F));
    }
    return o;
}

namespace {
bool isDigit(const Cps& c, size_t i) { return i < c.size() && c[i] >= U'0' && c[i] <= U'9'; }
bool isAlpha(const Cps& c, size_t i) {
    return i < c.size() && ((c[i] >= U'A' && c[i] <= U'Z') || (c[i] >= U'a' && c[i] <= U'z'));
}
bool isWord(const Cps& c, size_t i) {
    return isDigit(c, i) || isAlpha(c, i) || (i < c.size() && c[i] == U'_');
}
bool isSpace(char32_t c) { return c == U' ' || c == U'\t' || c == U'\r' || c == U'\n'; }
std::string ascii(const Cps& c, size_t a, size_t b) {
    std::string s;
    for (size_t i = a; i < b; ++i) s += static_cast<char>(c[i]);
    return s;
}
}  // namespace

std::vector<Tok> lex(const Cps& cps) {
    std::vector<Tok> toks;
    const size_t n = cps.size();
    size_t i = 0;
    auto err = [&](size_t s, size_t e) {
        Tok t;
        t.k = TK::LexErr;
        t.s = s;
        t.e = e;
        toks.push_back(t);
    };
    auto push = [&](TK k, size_t s, size_t e, std::string text) {
        Tok t;
        t.k = k;
        t.s = s;
        t.e = e;
        t.text = std::move(text);
        toks.push_back(std::move(t));
    };
    for (;;) {
        while (i < n && isSpace(cps[i])) ++i;
        if (i >= n) {
            push(TK::End, n, n, "");
            return toks;
        }
        const char32_t c = cps[i];
        if (isDigit(cps, i)) {
            size_t j = i;
            while (isDigit(cps, j)) ++j;
            if (j < n && cps[j] == U'.' && isDigit(cps, j + 1)) {
                ++j;
                while (isDigit(cps, j)) ++j;
            }
            if (j < n && (cps[j] == U'e' || cps[j] == U'E')) {
                size_t k = j + 1;
                if (k < n && (cps[k] == U'+' || cps[k] == U'-')) ++k;
                if (isDigit(cps, k)) {
                    while (isDigit(cps, k)) ++k;
                    j = k;
                }
            }
            const double v = std::strtod(ascii(cps, i, j).c_str(), nullptr);
            if (!std::isfinite(v)) {
                err(i, j);
                return toks;
            }
            push(TK::Num, i, j, "");
            toks.back().v = v;
            i = j;
            continue;
        }
        if (isAlpha(cps, i)) {
            size_t j = i + 1;
            while (isWord(cps, j)) ++j;
            while (j < n && cps[j] == U'.' && isWord(cps, j + 1)) {
                j += 2;
                while (isWord(cps, j)) ++j;
            }
            push(TK::Word, i, j, ascii(cps, i, j));
            i = j;
            continue;
        }
        if (c == U'"') {
            size_t j = i + 1;
            std::string text;
            for (;;) {
                if (j >= n) {
                    err(i, n);  // unclosed string: [i, end)
                    return toks;
                }
                const char32_t d = cps[j];
                if (d == U'"') break;
                if (d == U'\\') {
                    if (j + 1 < n && (cps[j + 1] == U'"' || cps[j + 1] == U'\\')) {
                        text += static_cast<char>(cps[j + 1]);
                        j += 2;
                        continue;
                    }
                    err(j, std::min(j + 2, n));
                    return toks;
                }
                if (d < 0x20) {
                    err(j, j + 1);
                    return toks;
                }
                text += encodeUtf8(d);
                ++j;
            }
            push(TK::Str, i, j + 1, text);
            i = j + 1;
            continue;
        }
        const char32_t d = i + 1 < n ? cps[i + 1] : 0;
        static const char* const kTwo[] = {"||", "&&", "==", "!=", "<=", ">="};
        bool done = false;
        if (c < 0x80 && d < 0x80) {
            for (const char* two : kTwo) {
                if (c == static_cast<char32_t>(two[0]) && d == static_cast<char32_t>(two[1])) {
                    push(TK::Op, i, i + 2, two);
                    i += 2;
                    done = true;
                    break;
                }
            }
        }
        if (done) continue;
        static const std::string kOne = "+-*/%<>!?:(),";
        if (c < 0x80 && kOne.find(static_cast<char>(c)) != std::string::npos) {
            push(TK::Op, i, i + 1, std::string(1, static_cast<char>(c)));
            ++i;
            continue;
        }
        err(i, i + 1);
        return toks;
    }
}

}  // namespace mat::expr::detail
