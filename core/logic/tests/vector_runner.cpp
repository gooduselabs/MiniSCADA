#include "core/logic/tests/vector_runner.hpp"

#include <dirent.h>

#include <algorithm>
#include <fstream>
#include <regex>
#include <set>
#include <sstream>
#include <stdexcept>

#include "core/logic/harness.hpp"
#include "core/project-manager/rules_logic.hpp"

namespace mat::logic::test {

using nlohmann::json;

namespace {

int64_t daysFromCivil(int64_t y, unsigned m, unsigned d) {
    y -= m <= 2;
    const int64_t era = (y >= 0 ? y : y - 399) / 400;
    const unsigned yoe = static_cast<unsigned>(y - era * 400);
    const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + static_cast<int64_t>(doe) - 719468;
}

json scalarJson(const TagScalar& v) {
    if (const bool* b = std::get_if<bool>(&v)) return *b;
    if (const int64_t* i = std::get_if<int64_t>(&v)) return *i;
    if (const uint64_t* u = std::get_if<uint64_t>(&v)) return *u;
    if (const double* d = std::get_if<double>(&v)) return *d;
    if (const std::string* s = std::get_if<std::string>(&v)) return *s;
    return nullptr;
}

json actionJson(const ActionOut& a) {
    json j = {{"t", a.t},         {"rule", a.rule}, {"edgeId", a.edgeId}, {"edge", a.edge},
              {"index", a.index}, {"do", a.doName}, {"tag", a.tag},       {"result", a.result}};
    if (!a.write.empty()) j["write"] = a.write;
    if (a.hasValue) j["value"] = scalarJson(a.value);
    if (a.ms >= 0) j["ms"] = a.ms;
    return j;
}

json stateJson(const BlockState& s) {
    json j = {{"kind", s.kind}, {"state", s.state}};
    if (!s.reason.empty()) j["reason"] = s.reason;
    if (s.isRule) {
        j["stable"] = s.stable ? json(*s.stable) : json(nullptr);
        j["edgeId"] = s.edgeId;
        j["lastError"] = s.lastError ? json(*s.lastError) : json(nullptr);
    }
    if (s.hasDegraded) j["degraded"] = s.degraded;
    if (s.hasOverflow) j["overflow"] = s.overflow;
    return j;
}

json outputJson(const Output& o) {
    json j = {{"value", scalarJson(o.value)}, {"quality", o.good ? "GOOD" : "BAD"}};
    if (!o.good) j["reason"] = o.reason;
    return j;
}

// TS same(): an INT64 may be written as a decimal string; numbers compared by value (bits).
bool same(const json* actual, const json& want) {
    if (!actual) return false;
    if (actual->is_number_integer() && want.is_string()) {
        try {
            size_t n = 0;
            const long long w = std::stoll(want.get<std::string>(), &n);
            return n == want.get<std::string>().size() && actual->get<long long>() == w;
        } catch (const std::exception&) {
            return false;
        }
    }
    // nlohmann compares mixed integer kinds exactly and an integer with a double as doubles
    return *actual == want;
}

void partial(const json& actual, const json& want, const std::string& where,
             std::vector<std::string>& errs) {
    for (auto it = want.begin(); it != want.end(); ++it) {
        const json* a =
            actual.is_object() && actual.contains(it.key()) ? &actual[it.key()] : nullptr;
        if (!same(a, it.value()))
            errs.push_back(where + "." + it.key() + ": có " + (a ? a->dump() : "undefined") +
                           ", cần " + it.value().dump());
    }
}

expr::InputValue inputOf(const json& v) {
    expr::InputValue iv;
    if (v.is_null()) {
        iv.quality = Quality::BAD;
        iv.reason = "NO_VALUE";
        return iv;
    }
    if (v.is_object() && v.contains("quality")) {
        iv.value = v.contains("value") ? scalarOfJson(v["value"]) : TagScalar{};
        const std::string q = v["quality"].get<std::string>();
        iv.quality =
            q == "GOOD" ? Quality::GOOD : q == "UNCERTAIN" ? Quality::UNCERTAIN : Quality::BAD;
        if (v.contains("reason") && v["reason"].is_string())
            iv.reason = v["reason"].get<std::string>();
        return iv;
    }
    iv.value = scalarOfJson(v);
    iv.quality = Quality::GOOD;
    return iv;
}

RetainMap retainOf(const json& o) {
    RetainMap m;
    for (auto it = o.begin(); it != o.end(); ++it) m[it.key()] = it.value();
    return m;
}

}  // namespace

int64_t parseWall(const std::string& s) {
    static const std::regex kRe(
        R"(^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$)");
    std::smatch m;
    if (!std::regex_match(s, m, kRe)) throw std::invalid_argument("wall sai dạng: " + s);
    std::string frac = m[7].matched ? m[7].str() : "0";
    while (frac.size() < 3) frac += "0";
    const int64_t days = daysFromCivil(std::stoll(m[1]), std::stoul(m[2]), std::stoul(m[3]));
    const int64_t utc = days * 86400000 + std::stoll(m[4]) * 3600000 + std::stoll(m[5]) * 60000 +
                        std::stoll(m[6]) * 1000 + std::stoll(frac);
    int64_t off = 0;
    if (m[8].str() != "Z")
        off = (m[9].str() == "-" ? -1 : 1) * (std::stoll(m[10]) * 60 + std::stoll(m[11]));
    return utc - off * 60000;
}

std::vector<std::pair<std::string, json>> loadVectors(const std::string& dir) {
    std::vector<std::string> files;
    if (DIR* d = opendir(dir.c_str())) {
        while (const dirent* e = readdir(d)) {
            const std::string n = e->d_name;
            if (n.size() > 5 && n.compare(n.size() - 5, 5, ".json") == 0) files.push_back(n);
        }
        closedir(d);
    }
    std::sort(files.begin(), files.end());
    std::vector<std::pair<std::string, json>> out;
    for (const std::string& f : files) {
        std::ifstream in(dir + "/" + f);
        std::stringstream ss;
        ss << in.rdbuf();
        const json j = json::parse(ss.str());
        for (const json& c : j["cases"]) out.emplace_back(j["group"].get<std::string>(), c);
    }
    return out;
}

std::vector<std::string> runCase(const json& c) {
    std::vector<std::string> errs;
    TagInfoMap tags;
    for (auto it = c["tags"].begin(); it != c["tags"].end(); ++it) {
        const json& t = it.value();
        TagInfo info;
        info.type = *tagTypeOf(t["type"].get<std::string>());
        info.kind = t.value("kind", std::string("external"));
        info.rw = t.value("writable", false);
        if (t.contains("expression")) info.expression = t["expression"].get<std::string>();
        tags[it.key()] = info;
    }
    const json& cfg = c["config"];
    LogicCheckOptions vo;
    vo.tags = &tags;
    vo.scanMs = cfg["scanMs"].get<int>();
    if (cfg.contains("flushS")) vo.flushS = cfg["flushS"].get<int>();
    if (cfg.contains("deviceWrites")) vo.deviceWrites = cfg["deviceWrites"].get<std::string>();
    const LogicCheck check = checkLogic(c["doc"], vo);
    std::set<std::string> codes, want;
    for (const auto& e : check.errors) codes.insert(e.code);
    for (const auto& e : c["expectErrors"]) want.insert(e.get<std::string>());
    if (codes != want) {
        std::string got;
        for (const auto& e : check.errors) got += e.code + " " + e.path + " " + e.message + "; ";
        std::string w;
        for (const auto& x : want) w += x + " ";
        errs.push_back("expectErrors: có [" + got + "], cần [" + w + "]");
    }
    if (c.contains("expectWarnings")) {
        std::set<std::string> gw, ww;
        for (const auto& e : check.warnings) gw.insert(e.code);
        for (const auto& e : c["expectWarnings"]) ww.insert(e.get<std::string>());
        if (gw != ww) {
            std::string g, w;
            for (const auto& x : gw) g += x + " ";
            for (const auto& x : ww) w += x + " ";
            errs.push_back("expectWarnings: có [" + g + "], cần [" + w + "]");
        }
    }
    if (!errs.empty() || !c["expectErrors"].empty() || c["steps"].empty()) return errs;

    EngineOptions eo;
    eo.tags = tags;
    eo.config.scanMs = cfg["scanMs"].get<int>();
    eo.config.tzOffsetMin = cfg["tzOffsetMin"].get<int>();
    eo.config.writesOn = cfg["writes"].get<std::string>() == "on";
    eo.config.maxWritesPerMin = cfg["maxWritesPerMin"].get<int>();
    RetainMap initial;
    if (c.contains("retain")) {
        if (c["retain"].is_string() && c["retain"] == "lost") {
            eo.retainLost = true;
        } else {
            initial = retainOf(c["retain"]);
            eo.retain = &initial;
        }
    }
    std::unique_ptr<Harness> h;
    try {
        h = std::make_unique<Harness>(c["doc"], eo);
    } catch (const std::exception& e) {
        errs.push_back(std::string("engine: ") + e.what());
        return errs;
    }
    std::vector<ActionOut> pending;
    bool synced = true;
    std::optional<int64_t> wall;
    int64_t wallAt = 0;
    for (const json& s : c["steps"]) {
        const int64_t t = s["t"].get<int64_t>();
        const std::string where = "t=" + std::to_string(t);
        try {
            if (s.contains("restart") &&
                !(s["restart"].is_boolean() && !s["restart"].get<bool>())) {
                const json r = s["restart"].is_object() ? s["restart"] : json::object();
                const json* doc = r.contains("doc") ? &r["doc"] : nullptr;
                Harness::RetainFrom from = Harness::RetainFrom::Flushed;
                RetainMap given;
                if (r.contains("retain")) {
                    if (r["retain"] == "lost")
                        from = Harness::RetainFrom::Lost;
                    else if (r["retain"].is_object()) {
                        from = Harness::RetainFrom::Given;
                        given = retainOf(r["retain"]);
                    }
                }
                h->restart(doc, from, &given, t);
            } else {
                auto got = h->runBefore(t);
                pending.insert(pending.end(), got.begin(), got.end());
            }
            if (s.contains("wall")) {
                wall = parseWall(s["wall"].get<std::string>());
                wallAt = t;
            }
            if (s.contains("timeSynced")) synced = s["timeSynced"].get<bool>();
            h->setWall(wall, synced, wallAt);
            if (s.contains("set"))
                for (auto it = s["set"].begin(); it != s["set"].end(); ++it)
                    h->set(it.key(), inputOf(it.value()));
            if (s.contains("writeResult"))
                h->writeResult(s["writeResult"]["rule"].get<std::string>(),
                               s["writeResult"]["result"].get<std::string>());
            auto got = h->runTo(t);
            pending.insert(pending.end(), got.begin(), got.end());
            if (s.value("flush", false)) h->flush();
        } catch (const std::exception& e) {
            errs.push_back(where + ": " + e.what());
            return errs;
        }
        if (!s.contains("expect")) continue;
        const json& e = s["expect"];
        if (e.contains("actions")) {
            const json& want = e["actions"];
            if (pending.size() != want.size()) {
                std::string got;
                for (const auto& a : pending) got += actionJson(a).dump() + " ";
                errs.push_back(where + " actions: có " + std::to_string(pending.size()) + " " +
                               got + ", cần " + std::to_string(want.size()));
            } else {
                for (size_t i = 0; i < want.size(); ++i)
                    partial(actionJson(pending[i]), want[i],
                            where + " actions[" + std::to_string(i) + "]", errs);
            }
            pending.clear();
        }
        if (e.contains("outputs"))
            for (auto it = e["outputs"].begin(); it != e["outputs"].end(); ++it) {
                const std::string& tag = it.key();
                const json& w = it.value();
                const Output* o = h->output(tag);
                const expr::InputValue* st = h->stored(tag);
                const json storedValue = st ? scalarJson(st->value) : json();
                if (w.is_object()) {
                    const json got =
                        o ? outputJson(*o)
                          : json{{"value", st ? storedValue : json()}, {"quality", "GOOD"}};
                    partial(got, w, where + " " + tag, errs);
                } else if (o) {
                    const json v = scalarJson(o->value);
                    if (!o->good || !same(&v, w))
                        errs.push_back(where + " " + tag + ": có " + v.dump() + " " +
                                       (o->good ? "GOOD" : "BAD") + ", cần " + w.dump());
                } else if (!st || !same(&storedValue, w)) {
                    errs.push_back(where + " " + tag + ": có " +
                                   (st ? storedValue.dump() : std::string("undefined")) + ", cần " +
                                   w.dump());
                }
            }
        if (e.contains("state"))
            for (auto it = e["state"].begin(); it != e["state"].end(); ++it) {
                const auto st = h->state(it.key());
                if (!st) {
                    errs.push_back(where + " state." + it.key() + ": không có khối");
                    continue;
                }
                const json w = it.value().is_string() ? json{{"state", it.value()}} : it.value();
                partial(stateJson(*st), w, where + " state." + it.key(), errs);
            }
        if (e.contains("retain")) {
            const RetainMap snap = h->retainSnapshot();
            std::string ks, kw;
            for (const auto& kv : snap) ks += kv.first + ",";
            std::vector<std::string> wk;
            for (auto it = e["retain"].begin(); it != e["retain"].end(); ++it)
                wk.push_back(it.key());
            std::sort(wk.begin(), wk.end());
            for (const auto& k : wk) kw += k + ",";
            if (ks != kw) {
                errs.push_back(where + " retain: khóa " + ks + " cần " + kw);
            } else {
                json sj = json::object();
                for (const auto& kv : snap) sj[kv.first] = kv.second;
                partial(sj, e["retain"], where + " retain", errs);
            }
        }
        if (e.contains("retainLost") && h->engine().retainLost() != e["retainLost"].get<bool>())
            errs.push_back(where + " retainLost: có " +
                           std::string(h->engine().retainLost() ? "true" : "false"));
    }
    return errs;
}

}  // namespace mat::logic::test
