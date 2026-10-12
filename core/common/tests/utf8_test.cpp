// UTF-8 repair and cutting (specs/003-data-logging security review M1).
#include "core/common/utf8.hpp"

#include <gtest/gtest.h>

#include "core/common/json_text.hpp"

using namespace mat;

namespace {
const std::string kRep = "\xEF\xBF\xBD";  // U+FFFD
}

TEST(Utf8, ValidTextIsUnchanged) {
    bool repaired = true;
    const std::string s = "Bồn số 1 · 😀 · ok";
    EXPECT_TRUE(isValidUtf8(s));
    EXPECT_EQ(sanitizeUtf8(s, &repaired), s);
    EXPECT_FALSE(repaired);
    EXPECT_EQ(sanitizeUtf8(""), "");
}

TEST(Utf8, EveryKindOfBrokenSequenceIsReplaced) {
    bool repaired = false;
    EXPECT_EQ(sanitizeUtf8("OK\xC3", &repaired), "OK" + kRep);  // cut at the end
    EXPECT_TRUE(repaired);
    EXPECT_EQ(sanitizeUtf8("a\x80"
                           "b"),
              "a" + kRep + "b");                                             // stray continuation
    EXPECT_EQ(sanitizeUtf8("\xC0\xAF"), kRep + kRep);                        // overlong '/'
    EXPECT_EQ(sanitizeUtf8("\xED\xA0\x80"), kRep + kRep + kRep);             // surrogate U+D800
    EXPECT_EQ(sanitizeUtf8("\xF4\x90\x80\x80"), kRep + kRep + kRep + kRep);  // above U+10FFFF
    EXPECT_EQ(sanitizeUtf8("\xFF"), kRep);
    EXPECT_FALSE(isValidUtf8("p\xE9ss"));  // Latin-1, not UTF-8
}

TEST(Utf8, StrayContinuationBytesCannotHideLength) {
    // "A" followed by many continuation bytes used to count as one character (M1 b).
    const std::string attack = "A" + std::string(1000, '\x80');
    bool cut = false;
    const std::string out = utf8Prefix(sanitizeUtf8(attack), 10, cut);
    EXPECT_TRUE(cut);
    EXPECT_EQ(
        out, "A" + [] {
            std::string r;
            for (int i = 0; i < 9; ++i) r += "\xEF\xBF\xBD";
            return r;
        }());
}

TEST(Utf8, PrefixByCodePointsAndByUtf16Units) {
    bool cut = false;
    EXPECT_EQ(utf8Prefix("abcdef", 3, cut), "abc");
    EXPECT_TRUE(cut);
    EXPECT_EQ(utf8Prefix("ồồ", 5, cut), "ồồ");
    EXPECT_FALSE(cut);
    EXPECT_EQ(utf8Prefix("ồồồ", 2, cut), "ồồ");
    // SQL Server NVARCHAR(4): the emoji takes two units
    EXPECT_EQ(utf16Prefix("ab😀c", 4), "ab😀");
    EXPECT_EQ(utf16Prefix("abc😀", 4), "abc");  // the pair does not fit in the last unit
    EXPECT_EQ(utf16Prefix("ồồ", 10), "ồồ");
    EXPECT_EQ(utf16Prefix("", 3), "");
}

// Security review M4: a text that is not UTF-8 (a code from a database server, a Tag string) in
// a JSON answer becomes U+FFFD instead of an exception that would end the runtime.
// Review of the fixes (minor 8): characters that rearrange how a line reads without being seen.
TEST(Utf8, LayoutControlsAreFound) {
    size_t len = 0;
    EXPECT_EQ(layoutControlAt("\xD8\x9C", 0, len), 0x061Cu);  // Arabic letter mark
    EXPECT_EQ(len, 2u);
    EXPECT_EQ(layoutControlAt("a\xE2\x80\xAE", 1, len), 0x202Eu);  // right-to-left override
    EXPECT_EQ(len, 3u);
    EXPECT_EQ(layoutControlAt("\xE2\x80\x8F", 0, len), 0x200Fu);  // right-to-left mark
    EXPECT_EQ(layoutControlAt("\xE2\x80\xA8", 0, len), 0x2028u);  // line separator
    EXPECT_EQ(layoutControlAt("\xE2\x81\xA9", 0, len), 0x2069u);  // pop directional isolate
    EXPECT_EQ(layoutControlAt("\xE2\x80\x99", 0, len), 0u);       // right single quote: text
    EXPECT_EQ(layoutControlAt("\xD8\xA7", 0, len), 0u);           // Arabic alef: text
    EXPECT_EQ(layoutControlAt("B\xE1\xBB\x93", 1, len), 0u);      // Vietnamese o with marks
    EXPECT_EQ(layoutControlAt("\xE2\x80", 0, len), 0u);           // cut short: not read past
}

TEST(JsonText, BytesThatAreNotUtf8BecomeReplacementCharacters) {
    const nlohmann::json j = {{"dbCode", std::string("\xFF") + "1"}};
    EXPECT_EQ(jsonText(j), "{\"dbCode\":\"" + kRep + "1\"}");
}
