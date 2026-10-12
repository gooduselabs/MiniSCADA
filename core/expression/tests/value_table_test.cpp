// Value tables on the shared vectors (tests/value-table-vectors): lookup and validation.
#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <set>

#include "core/expression/expression.hpp"
#include "core/expression/value_table_json.hpp"
#include "nlohmann/json.hpp"

using nlohmann::json;
using namespace mat::expr;

namespace {

const std::string kDir = std::string(MAT_SOURCE_DIR) + "/tests/value-table-vectors";

json readJson(const std::filesystem::path& p) {
    std::ifstream f(p, std::ios::binary);
    return json::parse(f);
}

double inputOf(const json& v) {
    if (v.is_boolean()) return v.get<bool>() ? 1.0 : 0.0;
    if (v.is_string()) return std::nan("");  // "NaN"
    return v.get<double>();
}

}  // namespace

TEST(ValueTableVectors, LookupFiles) {
    size_t files = 0, cases = 0;
    for (const auto& de : std::filesystem::directory_iterator(kDir)) {
        const std::string name = de.path().filename().string();
        if (name.rfind("lookup-", 0) != 0) continue;
        ++files;
        const json j = readJson(de.path());
        const ValueTable t = valueTableFromJson(j["table"]);
        for (const auto& c : j["cases"]) {
            ++cases;
            SCOPED_TRACE(name + " input " + c["input"].dump());
            const LookupResult r = lookupValueTable(t, inputOf(c["input"]));
            const json& ex = c["expect"];
            EXPECT_EQ(r.text, ex["text"].get<std::string>());
            if (ex["color"].is_null())
                EXPECT_FALSE(r.color.has_value());
            else
                EXPECT_EQ(r.color.value_or(""), ex["color"].get<std::string>());
            if (ex["entry"].is_null())
                EXPECT_EQ(r.entry, kEntryNone);
            else if (ex["entry"].is_string())
                EXPECT_EQ(r.entry, kEntryDefault);
            else
                EXPECT_EQ(r.entry, ex["entry"].get<int>());
        }
    }
    EXPECT_GE(files, 10u);
    EXPECT_GE(cases, 40u);
}

TEST(ValueTableVectors, ValidateCases) {
    const json j = readJson(kDir + "/validate.json");
    std::set<std::string> codes;
    for (const auto& c : j["cases"]) {
        SCOPED_TRACE(c["name"].get<std::string>());
        const ValueTable t = valueTableFromJson(c["table"]);
        std::vector<std::pair<int, std::string>> got;
        for (const auto& i : validateValueTable(t)) got.emplace_back(i.entry, i.code);
        std::sort(got.begin(), got.end());
        std::vector<std::pair<int, std::string>> want;
        for (const auto& e : c["expect"]) {
            want.emplace_back(e["entry"].get<int>(), e["code"].get<std::string>());
            codes.insert(e["code"].get<std::string>());
        }
        std::sort(want.begin(), want.end());
        EXPECT_EQ(got, want);
    }
    EXPECT_EQ(codes, (std::set<std::string>{"E_VT_OVERLAP", "E_VT_RANGE", "E_VT_TEXT"}));
}

TEST(ValueTable, LookupIsIndependentOfEntryOrder) {
    ValueTable a;
    VtEntry e1;
    e1.value = 1;
    e1.text = "a";
    VtEntry e2;
    e2.from = 5;
    e2.to = 9;
    e2.text = "b";
    a.entries = {e1, e2};
    ValueTable b;
    b.entries = {e2, e1};
    for (double x : {0.0, 1.0, 5.0, 8.9, 9.0})
        EXPECT_EQ(lookupValueTable(a, x).text, lookupValueTable(b, x).text);
}
