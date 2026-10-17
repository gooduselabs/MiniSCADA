// Fuzz of logic.json, C++ side (feature 011 T142; FR-029; the TS twin is
// tools/fuzz/targets/logic-json.mjs). Corpus tests/fuzz-corpus/logic-json.json (every case of
// tests/logic-vectors: document, Tags, config). Each case mutates a document (leaf values of the
// same type 45 %, JSON structure 40 %, text 15 %) and runs what the runtime runs on a logic.json:
//   1. JSON parse (nesting depth checked first, as the project loader does) and logic.schema.json
//      (valijson, integral numbers seen as integers like the loader's schemaView);
//   2. checkLogic (rules_logic) with the case's Tags and config;
//   3. a document without errors: the engine (Harness) for random steps: Tag inputs (finite, every
//      quality, no value), the real-time clock and its sync flag, restarts (flushed, lost, given
//      retain), write results;
// and every 32nd case the whole project loader (validateProject) on a 1.0 project carrying the
// mutated logic.json. Invariants: no crash, hang or sanitizer report (ASan + UBSan build of
// tools/fuzz/cpp/run.sh); checkLogic is deterministic (every 8th case twice); a document that
// passes checkLogic builds an engine (no exception); after every step no logic Tag, action value or
// retained value is NaN or infinite. MAT_FUZZ_SECONDS (default 5 under ctest), MAT_FUZZ_SEED.
#include <gtest/gtest.h>

#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>

#include "core/common/json_limits.hpp"
#include "core/common/tests/fuzz_util.hpp"
#include "core/logic/harness.hpp"
#include "core/project-manager/project_validator.hpp"
#include "core/project-manager/rules_logic.hpp"
#include "nlohmann/json.hpp"
#include "valijson/adapters/nlohmann_json_adapter.hpp"
#include "valijson/schema.hpp"
#include "valijson/schema_parser.hpp"
#include "valijson/validation_results.hpp"
#include "valijson/validator.hpp"

using nlohmann::json;
using namespace mat;
using namespace mat::logic;
namespace fs = std::filesystem;

namespace {

std::string readText(const std::string& p) {
    std::ifstream f(p, std::ios::binary);
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

// The loader's view for the schema (project_validator.cpp schemaView).
json schemaView(const json& v) {
    constexpr double kTwo63 = 9223372036854775808.0;
    switch (v.type()) {
        case json::value_t::number_float: {
            const double d = v.get<double>();
            if (!std::isfinite(d) || std::trunc(d) != d) return v;
            if (d >= kTwo63) return INT64_MAX;
            if (d < -kTwo63) return INT64_MIN;
            return static_cast<int64_t>(d);
        }
        case json::value_t::number_unsigned:
            return v.get<uint64_t>() > static_cast<uint64_t>(INT64_MAX) ? json(INT64_MAX) : v;
        case json::value_t::array: {
            json out = json::array();
            for (const auto& x : v) out.push_back(schemaView(x));
            return out;
        }
        case json::value_t::object: {
            json out = json::object();
            for (auto it = v.begin(); it != v.end(); ++it) out[it.key()] = schemaView(it.value());
            return out;
        }
        default:
            return v;
    }
}

struct Case {
    json doc;
    TagInfoMap tags;
    json config;
};

std::vector<Case> loadCorpus() {
    std::vector<Case> out;
    for (const json& c : json::parse(
             readText(std::string(MAT_SOURCE_DIR) + "/tests/fuzz-corpus/logic-json.json"))) {
        Case k;
        k.doc = c["doc"];
        k.config = c["config"];
        for (auto it = c["tags"].begin(); it != c["tags"].end(); ++it) {
            const json& t = it.value();
            TagInfo info;
            if (auto ty = tagTypeOf(t["type"].get<std::string>())) info.type = *ty;
            info.kind = t.value("kind", std::string("external"));
            info.rw = t.value("writable", false);
            if (t.contains("expression")) info.expression = t["expression"].get<std::string>();
            k.tags[it.key()] = info;
        }
        out.push_back(std::move(k));
    }
    return out;
}

bool finiteJson(const json& j) {
    if (j.is_number_float()) return std::isfinite(j.get<double>());
    if (j.is_structured()) {
        for (const auto& x : j)
            if (!finiteJson(x)) return false;
    }
    return true;
}

bool finiteScalar(const TagScalar& v) {
    if (const double* d = std::get_if<double>(&v)) return std::isfinite(*d);
    return true;
}

expr::InputValue randomInput(fuzz::Rng& r, TagType t) {
    expr::InputValue v;
    const size_t q = r.below(10);
    v.quality = q < 7 ? Quality::GOOD : q < 9 ? Quality::UNCERTAIN : Quality::BAD;
    if (v.quality != Quality::GOOD) v.reason = "COMM_FAILURE";
    if (r.chance(5)) return v;  // no value
    static const double kNums[] = {
        0, -0.0, 1, -1, 0.5, 1e308, -1e308, 1e300, 5e-324, 65535, 9007199254740993.0, 1e18};
    switch (t) {
        case TagType::BOOL:
            v.value = r.chance(50);
            break;
        case TagType::STRING:
            v.value = std::string(r.below(40), 'x');
            break;
        case TagType::UINT64:
            v.value = static_cast<uint64_t>(r.next());
            break;
        case TagType::FLOAT32:
        case TagType::FLOAT64:
            v.value = r.chance(60) ? kNums[r.below(sizeof kNums / sizeof kNums[0])]
                                   : (r.unit() - 0.5) * 2000;
            break;
        default:
            v.value = r.chance(50) ? static_cast<int64_t>(r.next())
                                   : static_cast<int64_t>(r.below(200)) - 100;
            break;
    }
    return v;
}

class LogicSchema {
   public:
    LogicSchema() {
        const json doc =
            json::parse(readText(std::string(MAT_SOURCE_DIR) + "/schemas/logic.schema.json"));
        valijson::SchemaParser parser(valijson::SchemaParser::kDraft7);
        valijson::adapters::NlohmannJsonAdapter a(doc);
        parser.populateSchema(a, schema_);
    }
    bool ok(const json& doc) const {
        const json view = schemaView(doc);
        valijson::Validator v;
        valijson::adapters::NlohmannJsonAdapter target(view);
        return v.validate(schema_, target, nullptr);
    }

   private:
    valijson::Schema schema_;
};

std::string codes(const LogicCheck& c) {
    std::string s;
    for (const auto& e : c.errors) s += e.code + e.path + ";";
    s += "|";
    for (const auto& w : c.warnings) s += w.code + w.path + ";";
    return s;
}

void writeFile(const fs::path& p, const std::string& text) {
    fs::create_directories(p.parent_path());
    std::ofstream f(p, std::ios::binary | std::ios::trunc);
    f << text;
}

// A leaf of `j` replaced by a value of the same JSON type: numbers by edge values, strings by
// strings of the corpus (Tag ids, expressions, ids), booleans flipped.
void mutateLeaf(json& j, fuzz::Rng& r, const fuzz::Dict& d, int depth = 0) {
    if (j.is_structured() && !j.empty() && depth < 30) {
        if (j.is_object()) {
            auto it = j.begin();
            std::advance(it, static_cast<long>(r.below(j.size())));
            mutateLeaf(it.value(), r, d, depth + 1);
        } else {
            mutateLeaf(j[r.below(j.size())], r, d, depth + 1);
        }
        return;
    }
    if (j.is_boolean()) {
        j = !j.get<bool>();
    } else if (j.is_number()) {
        static const double kNums[] = {
            0,           1,      -1,   2,        10,       50,    59,   60,
            100,         1000,   1001, 86400000, 86400001, 1e9,   1e15, 9007199254740993.0,
            1e308,       -1e308, 0.5,  1e-9,     24,       23.99, 3600, 65535,
            4294967296.0};
        if (r.chance(70))
            j = kNums[r.below(sizeof kNums / sizeof kNums[0])];
        else if (j.is_number_integer())
            j = j.get<int64_t>() + static_cast<int64_t>(r.below(5)) - 2;
        else
            j = j.get<double>() * (r.unit() * 4 - 2);
    } else if (j.is_string()) {
        if (!d.strings.empty() && r.chance(70))
            j = d.strings[r.below(d.strings.size())];
        else
            j = fuzz::mutateText(j.get<std::string>(), r, d.keys);
    }
}

}  // namespace

TEST(LogicFuzz, MutatedLogicJsonNeverCrashesAndStaysFinite) {
    const std::vector<Case> corpus = loadCorpus();
    ASSERT_GT(corpus.size(), 100u);
    fuzz::Dict dict;
    for (const Case& c : corpus) fuzz::collect(c.doc, dict);
    for (const char* s : {"A && B", "LEVEL > 1e308", "FLOW * 1e308", "-FLOW", "N / 0", "abs(LEVEL)",
                          "L.T", "CMD", "x.y", "1e308", "LOGIC.X.Q"})
        dict.strings.push_back(s);
    std::vector<std::string> textDict = dict.keys;
    textDict.insert(textDict.end(), dict.strings.begin(), dict.strings.end());
    const LogicSchema schema;

    // A 1.0 project for the whole loader: v10-valid-minimal plus logic.json.
    const fs::path base = fs::path(MAT_SOURCE_DIR) / "tests/project-vectors/v10-valid-minimal";
    const fs::path work =
        fs::temp_directory_path() / ("mat-logic-fuzz-" + std::to_string(::getpid()));
    fs::remove_all(work);
    fs::copy(base, work, fs::copy_options::recursive);
    fs::remove(work / "expected.json");
    {
        json p = json::parse(readText((work / "project.json").string()));
        p["logic"] = "logic.json";
        writeFile(work / "project.json", p.dump(2));
    }
    const std::string schemasDir = std::string(MAT_SOURCE_DIR) + "/schemas";

    const double budget = fuzz::budgetSeconds(5);
    const uint64_t seed = fuzz::baseSeed();
    fuzz::Rng r{seed ^ 0x6c6f676963ull};  // "logic"
    fuzz::Deadline deadline(budget);
    int64_t cases = 0, parsed = 0, schemaOk = 0, checked = 0, engines = 0, steps = 0, loads = 0;
    std::map<std::string, int64_t> byCode;
    while (!deadline.passed()) {
        ++cases;
        const Case& c = corpus[r.below(corpus.size())];
        std::string text;
        json doc;
        const size_t how = r.below(100);
        if (how <
            45) {  // values only, same JSON type: mostly still schema-valid, reaches the engine
            doc = c.doc;
            const int n = 1 + static_cast<int>(r.below(3));
            for (int k = 0; k < n; ++k) mutateLeaf(doc, r, dict);
            text = doc.dump(-1, ' ', false, json::error_handler_t::replace);
            doc = json::parse(text, nullptr, false);  // what the loader would read
        } else if (how < 85) {
            doc = fuzz::mutateJson(c.doc, r, dict);
            text = doc.dump(-1, ' ', false, json::error_handler_t::replace);
            doc = json::parse(text, nullptr, false);  // what the loader would read
        } else {
            text = fuzz::mutateText(c.doc.dump(r.chance(50) ? 2 : -1), r, textDict);
            if (jsonNestingDepth(text.data(), text.size()) > kMaxProjectJsonDepth) continue;
            doc = json::parse(text, nullptr, false);
        }
        const std::string where = "case " + std::to_string(cases) + " seed " + std::to_string(seed);

        if (cases % 32 == 0) {  // the whole loader
            writeFile(work / "logic.json", text);
            const ProjectValidation v = validateProject(work.string(), schemasDir);
            ++loads;
            ASSERT_EQ(v.valid, v.errors.empty()) << where;
            for (const auto& e : v.errors)
                ASSERT_EQ(e.code.rfind("E_", 0), 0u) << where << " " << e.code;
            for (const auto& w : v.warnings)
                ASSERT_EQ(w.code.rfind("W_", 0), 0u) << where << " " << w.code;
        }
        if (doc.is_discarded()) continue;
        ++parsed;
        // the loader refuses long strings before the schema (valijson's std::regex recurses)
        if (findLongString(doc, "", kMaxProjectStringBytes, nullptr)) continue;
        if (!schema.ok(doc)) continue;
        ++schemaOk;

        LogicCheckOptions vo;
        vo.tags = &c.tags;
        vo.bytes = text.size();
        vo.scanMs = c.config.value("scanMs", 100);
        if (c.config.contains("flushS")) vo.flushS = c.config["flushS"].get<int>();
        if (c.config.contains("deviceWrites"))
            vo.deviceWrites = c.config["deviceWrites"].get<std::string>();
        LogicCheck check;
        ASSERT_NO_THROW(check = checkLogic(doc, vo)) << where << ": " << text.substr(0, 400);
        ++checked;
        for (const auto& e : check.errors) {
            ASSERT_EQ(e.code.rfind("E_", 0), 0u) << where;
            ++byCode[e.code];
        }
        for (const auto& w : check.warnings) ASSERT_EQ(w.code.rfind("W_", 0), 0u) << where;
        if (cases % 8 == 0) {
            const LogicCheck again = checkLogic(doc, vo);
            ASSERT_EQ(codes(check), codes(again)) << where;
        }
        if (!check.errors.empty()) continue;
        ++byCode["ok"];

        EngineOptions eo;
        eo.tags = c.tags;
        eo.config.scanMs = vo.scanMs;
        eo.config.tzOffsetMin = c.config.value("tzOffsetMin", 420);
        eo.config.writesOn = c.config.value("writes", std::string("on")) == "on";
        eo.config.maxWritesPerMin = c.config.value("maxWritesPerMin", 20);
        std::unique_ptr<Harness> h;
        try {
            h = std::make_unique<Harness>(doc, eo);
        } catch (const std::exception& e) {
            FAIL() << where << ": checkLogic passed, the engine refused (" << e.what()
                   << "): " << text.substr(0, 600);
        }
        ++engines;
        std::vector<std::pair<std::string, TagType>> inputs;
        for (const auto& [id, info] : c.tags)
            if (info.kind != "calculated" || r.chance(30)) inputs.emplace_back(id, info.type);
        int64_t t = 0;
        std::optional<int64_t> wall;
        if (r.chance(70)) wall = 1792000000000LL + static_cast<int64_t>(r.below(86400000));
        bool synced = r.chance(85);
        h->setWall(wall, synced, 0);
        const int n = 5 + static_cast<int>(r.below(60));
        for (int k = 0; k < n; ++k) {
            ++steps;
            const size_t what = r.below(100);
            if (what < 4) {
                h->flush();
            } else if (what < 7) {
                const Harness::RetainFrom from =
                    r.chance(50) ? Harness::RetainFrom::Flushed : Harness::RetainFrom::Lost;
                try {
                    h->restart(nullptr, from, nullptr, t);
                } catch (const std::exception& e) {
                    FAIL() << where << ": restart threw " << e.what();
                }
            } else if (what < 10) {
                for (const auto& [id, s] : h->engine().outputTags()) {
                    (void)s;
                    (void)id;
                }
                for (const std::string& b : h->engine().blockIds())
                    if (r.chance(30)) h->writeResult(b, r.chance(50) ? "FAILED" : "REJECTED");
            } else if (what < 13) {
                for (const std::string& b : h->engine().blockIds())
                    if (r.chance(20))  // POST /logic/reset takes 0 to 2^53
                        h->engine().reset(b, r.chance(50) ? 0.0 : 9007199254740992.0 * r.unit());
            } else if (what < 16) {
                synced = !synced;
                h->setWall(wall, synced, t);
            } else {
                for (const auto& [id, type] : inputs)
                    if (r.chance(40)) h->set(id, randomInput(r, type));
            }
            // forward: a scan or a jump (hours, a clock step)
            // (the harness runs every scan of the interval: at most a few hundred scans per step)
            const int64_t dt =
                h->scanMs() * static_cast<int64_t>(1 + r.below(r.chance(80) ? 10 : 300));
            t += dt;
            std::vector<ActionOut> acts;
            try {
                acts = h->runTo(t);
            } catch (const std::exception& e) {
                FAIL() << where << ": scan threw " << e.what();
            }
            for (const ActionOut& a : acts)
                ASSERT_TRUE(finiteScalar(a.value)) << where << ": action value not finite";
            for (const auto& [id, def] : h->engine().outputTags()) {
                (void)def;
                const Output* o = h->output(id);
                ASSERT_TRUE(o == nullptr || finiteScalar(o->value))
                    << where << ": logic Tag " << id << " not finite: " << text.substr(0, 600);
            }
            for (const auto& [key, v] : h->retainSnapshot())
                ASSERT_TRUE(finiteJson(v)) << where << ": retain " << key << " not finite";
        }
    }
    fs::remove_all(work);
    std::cout << "fuzz logic-json: " << cases << " inputs, " << parsed << " parsed, " << schemaOk
              << " schema ok, " << checked << " checked, " << engines << " engines, " << steps
              << " steps, " << loads << " project loads, seed " << seed << ", " << budget
              << " s\n[ fuzz     ]";
    for (const auto& [k, n] : byCode) std::cout << " " << k << "=" << n;
    std::cout << "\n";
    EXPECT_GT(engines, 0);
}
