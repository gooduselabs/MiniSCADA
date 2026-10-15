// T026: alarm text (FR-005, FR-025): tags, rounding half away from zero, BOOL and value-table labels,
// the 200 character cut, defaults of the kind (D9) and the folding of Vietnamese text.
#include "core/alarm/alarm_text.hpp"

#include <gtest/gtest.h>

#include <cmath>
#include <fstream>
#include <limits>

#include "nlohmann/json.hpp"

using namespace mat::alarm;

namespace {
TextContext limitCtx(const std::string& lim, double value, double limit) {
    TextContext c;
    c.kind = AlarmKind::Limit;
    c.name = "Mức bồn B1";
    c.tag = "TANK01.LEVEL";
    c.unit = "%";
    c.limitName = lim;
    c.area = "Bồn";
    c.value = value;
    c.limit = limit;
    return c;
}
}  // namespace

TEST(AlarmText, ShortestDoubleRoundTripsWithoutExponent) {
    EXPECT_EQ(shortestDouble(81), "81");
    EXPECT_EQ(shortestDouble(0), "0");
    EXPECT_EQ(shortestDouble(-0.0), "0");
    EXPECT_EQ(shortestDouble(0.1), "0.1");
    EXPECT_EQ(shortestDouble(91.2), "91.2");
    EXPECT_EQ(shortestDouble(-2.5), "-2.5");
    EXPECT_EQ(shortestDouble(1.005), "1.005");
    EXPECT_EQ(shortestDouble(1e21), "1000000000000000000000");
    EXPECT_EQ(shortestDouble(1e-7), "0.0000001");
    EXPECT_EQ(shortestDouble(123456789012345680.0), "123456789012345680");
    EXPECT_EQ(shortestDouble(0.30000000000000004), "0.30000000000000004");
    EXPECT_EQ(shortestDouble(5e-324), std::string("0.") + std::string(323, '0') + "5");
    for (double v : {3.14159, -1234.5678, 1.7976931348623157e308, 2.2250738585072014e-308, 100.0}) {
        EXPECT_EQ(std::strtod(shortestDouble(v).c_str(), nullptr), v) << v;
    }
}

TEST(AlarmText, RoundingIsHalfAwayFromZeroOnTheDigits) {
    EXPECT_EQ(formatNumber(1.005, 2), "1,01");  // the digits "1.005", not the binary value
    EXPECT_EQ(formatNumber(-2.5, 0), "-3");
    EXPECT_EQ(formatNumber(2.5, 0), "3");
    EXPECT_EQ(formatNumber(0.5, 0), "1");
    EXPECT_EQ(formatNumber(-0.4, 0), "0");  // -0 is written 0
    EXPECT_EQ(formatNumber(0.049, 1), "0,0");
    EXPECT_EQ(formatNumber(0.05, 1), "0,1");
    EXPECT_EQ(formatNumber(99.95, 1), "100,0");
    EXPECT_EQ(formatNumber(9.999, 2), "10,00");
    EXPECT_EQ(formatNumber(81, 2), "81,00");
    EXPECT_EQ(formatNumber(1.4999, 0), "1");
    EXPECT_EQ(formatNumber(-1.5, 0), "-2");
    EXPECT_EQ(formatNumber(1234.5678, 6), "1234,567800");
    EXPECT_EQ(formatNumber(0.1234567, 6), "0,123457");
    EXPECT_EQ(formatNumberTrim(91.2), "91,2");
    EXPECT_EQ(formatNumberTrim(81), "81");
    EXPECT_EQ(formatNumberTrim(0.1234567), "0,123457");
    EXPECT_EQ(formatNumberTrim(1e-9), "0");
}

TEST(AlarmText, ThousandPairsOfRoundingMatchTheDecimalReference) {
    // Reference by integer arithmetic on the digits of the shortest text (no floating point).
    unsigned seed = 7;
    auto next = [&] {
        seed = seed * 1664525u + 1013904223u;
        return seed >> 8;
    };
    for (int i = 0; i < 1000; ++i) {
        const int n = static_cast<int>(next() % 7);
        const long long scaled = static_cast<long long>(next() % 2000001) - 1000000;  // value * 100
        const double v = static_cast<double>(scaled) / 100.0;
        const std::string s = shortestDouble(v);
        // reference: round |scaled|/100 to n decimals half away from zero
        long long a = scaled < 0 ? -scaled : scaled;
        std::string ref;
        if (n >= 2) {
            ref = std::to_string(a / 100) + "." + (a % 100 < 10 ? "0" : "") + std::to_string(a % 100) +
                  std::string(n - 2, '0');
        } else {
            long long div = n == 1 ? 10 : 100;
            long long q = (a + div / 2) / div;
            ref = n == 0 ? std::to_string(q) : std::to_string(q / 10) + "." + std::to_string(q % 10);
        }
        if (scaled < 0 && ref.find_first_not_of("0.") != std::string::npos) ref = "-" + ref;
        for (char& ch : ref) if (ch == '.') ch = kDecimalSeparator;
        EXPECT_EQ(formatNumber(v, n), ref) << s << " N=" << n;
    }
}

TEST(AlarmText, DefaultTemplatesOfTheKinds) {
    EXPECT_EQ(formatAlarmText("", limitCtx("HH", 91.2, 90)), "Mức bồn B1 rất cao: 91,2 % (ngưỡng 90)");
    EXPECT_EQ(formatAlarmText("", limitCtx("H", 81, 80)), "Mức bồn B1 cao: 81 % (ngưỡng 80)");
    EXPECT_EQ(formatAlarmText("", limitCtx("L", 9, 10)), "Mức bồn B1 thấp: 9 % (ngưỡng 10)");
    EXPECT_EQ(formatAlarmText("", limitCtx("LL", 3.5, 5)), "Mức bồn B1 rất thấp: 3,5 % (ngưỡng 5)");
    TextContext d;
    d.kind = AlarmKind::Digital;
    d.name = "Bơm 1 lỗi";
    d.value = 1;
    EXPECT_EQ(formatAlarmText("", d), "Bơm 1 lỗi");
    TextContext q;
    q.kind = AlarmKind::Quality;
    q.name = "Mất kết nối PLC1";
    q.reason = "TIMEOUT";
    EXPECT_EQ(formatAlarmText("", q), "Mất kết nối PLC1: mất tín hiệu (TIMEOUT)");
    q.reason = "";
    EXPECT_EQ(formatAlarmText("", q), "Mất kết nối PLC1: mất tín hiệu");  // empty () removed
    EXPECT_EQ(defaultTemplate(AlarmKind::Digital, ""), "{name}");
}

TEST(AlarmText, EveryTag) {
    TextContext c = limitCtx("HH", 91.256, 90);
    EXPECT_EQ(formatAlarmText("{name}|{tag}|{unit}|{limitName}|{area}|{reason}", c),
              "Mức bồn B1|TANK01.LEVEL|%|HH|Bồn|");
    EXPECT_EQ(formatAlarmText("{value}", c), "91,256");
    EXPECT_EQ(formatAlarmText("{value:0}", c), "91");
    EXPECT_EQ(formatAlarmText("{value:1}", c), "91,3");
    EXPECT_EQ(formatAlarmText("{value:2}", c), "91,26");
    EXPECT_EQ(formatAlarmText("{value:6}", c), "91,256000");
    EXPECT_EQ(formatAlarmText("{limit}", c), "90");
    EXPECT_EQ(formatAlarmText("{name} rất cao: {value:1} {unit} (> {limit})", limitCtx("HH", 91.2, 90)),
              "Mức bồn B1 rất cao: 91,2 % (> 90)");
    TextContext none;  // no area: "Chung"
    none.name = "x";
    EXPECT_EQ(formatAlarmText("{area}", none), "Chung");
    EXPECT_EQ(formatAlarmText("{limit}{limitName}", none), "");
    // unknown tag: left as is
    EXPECT_EQ(formatAlarmText("a {abc} b", none), "a {abc} b");
}

TEST(AlarmText, BoolAndLabels) {
    TextContext c;
    c.kind = AlarmKind::Digital;
    c.name = "Bơm";
    c.isBool = true;
    c.value = 1;
    EXPECT_EQ(formatAlarmText("{value}", c), "Bật");
    c.value = 0;
    EXPECT_EQ(formatAlarmText("{value}", c), "Tắt");
    std::map<std::string, std::string> labels{{"0", "Dừng"}, {"1", "Chạy"}, {"2", "Lỗi"}};
    c.labels = &labels;
    c.value = 1;
    EXPECT_EQ(formatAlarmText("{value}", c), "Chạy");
    c.isBool = false;  // INT with a value table
    c.value = 2;
    EXPECT_EQ(formatAlarmText("{value}", c), "Lỗi");
    c.value = 7;  // no label: the number
    EXPECT_EQ(formatAlarmText("{value}", c), "7");
}

TEST(AlarmText, NotFiniteIsNotAvailable) {
    TextContext c;
    c.kind = AlarmKind::Quality;
    c.name = "n";
    c.value = std::numeric_limits<double>::quiet_NaN();
    EXPECT_EQ(formatAlarmText("{value}", c), "n/a");
    c.value = std::numeric_limits<double>::infinity();
    EXPECT_EQ(formatAlarmText("{value:2}", c), "n/a");
    c.value.reset();
    EXPECT_EQ(formatAlarmText("{value}", c), "n/a");
}

TEST(AlarmText, PostProcessingEmptyParensSpacesAndCut) {
    TextContext c;
    c.name = "A";
    EXPECT_EQ(formatAlarmText("  a   ( )  b   ()  ", c), "a b");
    EXPECT_EQ(formatAlarmText("x (  ) y", c), "x y");
    // 200 code points kept; 201 -> 199 + ellipsis
    std::string t200(200, 'a'), t201(201, 'a');
    EXPECT_EQ(formatAlarmText(t200, c), t200);
    EXPECT_EQ(formatAlarmText(t201, c), std::string(199, 'a') + "\xE2\x80\xA6");
    EXPECT_EQ(utf8Length(formatAlarmText(t201, c)), 200u);
    // Vietnamese letters count as one code point each
    std::string v;
    for (int i = 0; i < 201; ++i) v += "ồ";
    EXPECT_EQ(utf8Length(formatAlarmText(v, c)), 200u);
    // never between a base and its combining mark: 198 letters, then "e" + U+0301 at 199, 200
    std::string m(198, 'a');
    m += "e\xCC\x81";  // code points 199 (e) and 200 (U+0301): 200 in all, kept
    m += "z";          // 201 -> cut
    std::string cut = formatAlarmText(m, c);
    // the cut falls at 199 code points: base "e" would stay with its mark dropped; the contract
    // moves back to the base boundary: "e" and the mark are both cut
    EXPECT_EQ(cut, std::string(198, 'a') + "\xE2\x80\xA6");
}

TEST(AlarmText, FoldVietnamese) {
    EXPECT_EQ(foldText("Bồn B1 QUÁ ÁP"), "bon b1 qua ap");
    EXPECT_EQ(foldText("đường Đ"), "duong d");
    EXPECT_EQ(foldText("ơ"), "o");
    EXPECT_EQ(foldText(std::string("o\xCC\x9B")), "o");              // o + U+031B (horn)
    EXPECT_EQ(foldText(std::string("a\xCC\x81")), "a");              // a + U+0301
    EXPECT_EQ(foldText("Ư Ừ Ứ Ử Ữ Ự ư ừ ứ ử ữ ự"), "u u u u u u u u u u u u");
    EXPECT_EQ(foldText("ẠẢÃÀÁÂẬẦẤẨẪĂẶẰẮẲẴ"), std::string(17, 'a'));
    EXPECT_EQ(foldText("ỲÝỶỸỴ"), "yyyyy");
    EXPECT_EQ(foldText("ÈÉẺẼẸÊỀẾỂỄỆ"), std::string(11, 'e'));
    EXPECT_EQ(foldText("ÌÍỈĨỊ"), "iiiii");
    EXPECT_EQ(foldText("ÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ"), std::string(17, 'o'));
    EXPECT_EQ(foldText("ÙÚỦŨỤ"), "uuuuu");
    EXPECT_EQ(foldText("TANK01.Level_7 % (80)"), "tank01.level_7 % (80)");  // other characters stay
    EXPECT_EQ(foldText("Ä É"), "Ä e");  // only A-Z and the Vietnamese table fold; Ä stays
    EXPECT_EQ(foldText(""), "");
}

TEST(AlarmText, FoldInvalidUtf8BecomesReplacementCharacter) {
    EXPECT_EQ(foldText(std::string("a\xFF" "b")), std::string("a\xEF\xBF\xBD" "b"));
    EXPECT_EQ(foldText(std::string("\xC3")), std::string("\xEF\xBF\xBD"));  // cut sequence
}

TEST(AlarmText, FoldTableCoversEveryVietnameseLetterOnce) {
    // 134 pairs: each of the 67 lower-case letters and its capital.
    const char* lower[] = {"à", "á", "ả", "ã", "ạ", "ă", "ằ", "ắ", "ẳ", "ẵ", "ặ", "â", "ầ", "ấ", "ẩ", "ẫ", "ậ"};
    const char* upper[] = {"À", "Á", "Ả", "Ã", "Ạ", "Ă", "Ằ", "Ắ", "Ẳ", "Ẵ", "Ặ", "Â", "Ầ", "Ấ", "Ẩ", "Ẫ", "Ậ"};
    for (size_t i = 0; i < 17; ++i) {
        EXPECT_EQ(foldText(lower[i]), "a");
        EXPECT_EQ(foldText(upper[i]), "a");
    }
}

namespace {
nlohmann::json loadVector(const char* name) {
    std::ifstream in(std::string(MAT_SOURCE_DIR) + "/tests/alarm-vectors/" + name);
    return nlohmann::json::parse(in, nullptr, false);
}
}  // namespace

TEST(AlarmText, FoldVectors) {
    nlohmann::json j = loadVector("fold.json");
    ASSERT_FALSE(j.is_discarded());
    int n = 0;
    for (const auto& p : j["pairs"]) {
        EXPECT_EQ(foldText(p["in"].get<std::string>()), p["out"].get<std::string>()) << p["in"];
        ++n;
    }
    EXPECT_GE(n, 40);
}

TEST(AlarmText, FoldTableCoversAll134Pairs) {
    nlohmann::json j = loadVector("fold-table.json");
    ASSERT_FALSE(j.is_discarded());
    int n = 0;
    for (const auto& p : j["pairs"]) {
        EXPECT_EQ(foldText(p["char"].get<std::string>()), p["out"].get<std::string>()) << p["cp"];
        ++n;
    }
    EXPECT_EQ(n, 134);
}

TEST(AlarmText, RoundTableVectors) {
    nlohmann::json j = loadVector("round-table.json");
    ASSERT_FALSE(j.is_discarded());
    int n = 0;
    for (const auto& p : j["pairs"]) {
        const double v = p["v"].get<double>();
        const int digits = p["n"].get<int>();
        // the vectors write the decimal separator as a comma
        EXPECT_EQ(formatNumber(v, digits), p["out"].get<std::string>()) << v << " " << digits;
        ++n;
    }
    EXPECT_GE(n, 1000);
}
