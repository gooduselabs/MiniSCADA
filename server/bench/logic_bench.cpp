// logic_bench (feature 011 T148; FR-095; docs/reports/011-load.md §3.2): where the scan of the
// maximum logic configuration spends its time, on the machine it runs on (x64, or the BL335 with
// the armhf build). Built only on request (`cmake --build <dir> --target logic_bench`), never
// deployed.
//
//   logic_bench <project-dir> <schemas-dir> [--scans N] [--sim-load] [--out file.json]
//
// <project-dir>: `node tools/gen-bench-projects.mjs --only logic-l1` (logic.json of logic-load,
// 550 blocks, on 500 simulation Tags + 200 internal Tags). The project is validated and activated
// as mat-runtime does it (validateProject, activateProject, RuntimeEngine), then:
//   A. the Tag Engine round without logic (the same project, logic.json not given);
//   B. the round with logic (scan every round: the monotonic clock moves logic.scanMs per round),
//      with the split of LogicSubsystem::lastProfile (engine, publish, actions, warnings);
//   C. logic::Engine::step alone, reading a snapshot by name (as logic_perf_test);
//   D. the same for each kind of block alone (rules, timers, ...);
//   E. the pieces of one condition (evaluate, one input read, a clock read), in us;
//   F. the tick loop of mat-runtime over `scans` x scanMs of simulated time (TickSchedule, delta
//      period --delta-ms, default 250): the time spent in the Tag Engine rounds per second, without
//      logic, with logic scanned only in the delta rounds (mat-runtime before T148), and with logic
//      on its own period (T148). The difference to "without" is what logic costs the CPU.
// Each phase: N rounds (default 3000), mean / p50 / p99 / max in ms. Read-only apart from a
// temporary retain directory under /tmp, removed at the end.
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <unordered_map>
#include <vector>

#include "core/logic/engine.hpp"
#include "server/runtime_engine.hpp"
#include "server/startup.hpp"
#include "server/tick_schedule.hpp"

using nlohmann::json;
using namespace mat;
namespace fs = std::filesystem;

namespace {

constexpr int64_t kT0 = 1791594000000;  // 2026-10-10 09:00 +07:00, a Saturday morning

struct Stats {
    double mean = 0, p50 = 0, p99 = 0, max = 0;
};

Stats stats(std::vector<double> v) {
    Stats s;
    if (v.empty()) return s;
    double sum = 0;
    for (double x : v) sum += x;
    s.mean = sum / static_cast<double>(v.size());
    std::sort(v.begin(), v.end());
    s.p50 = v[v.size() / 2];
    s.p99 = v[std::min(v.size() - 1, static_cast<size_t>(static_cast<double>(v.size()) * 0.99))];
    s.max = v.back();
    return s;
}

json statsJson(const Stats& s) {
    const auto r = [](double x) { return std::round(x * 1000) / 1000; };
    return {{"meanMs", r(s.mean)}, {"p50Ms", r(s.p50)}, {"p99Ms", r(s.p99)}, {"maxMs", r(s.max)}};
}

void print(const char* name, const Stats& s) {
    std::printf("%-28s mean %8.3f  p50 %8.3f  p99 %8.3f  max %8.3f ms\n", name, s.mean, s.p50,
                s.p99, s.max);
}

double since(std::chrono::steady_clock::time_point t0) {
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
}

struct Run {
    ProjectValidation validation;
    TagStore store;
    ActiveProject active;
    std::unique_ptr<RuntimeEngine> rt;
    int64_t mono = 1000;
    int64_t now = kT0;
    SystemWarnings warnings{[] { return kT0; }};  // as in mat-runtime: updated every scan
};

std::unique_ptr<Run> start(const std::string& dir, const std::string& schemas, bool simLoad,
                           bool withLogic, const std::string& retainDir, int scanMs) {
    auto r = std::make_unique<Run>();
    r->validation = validateProject(dir, schemas, kRuntimeVersion);
    if (!r->validation.valid) {
        std::fprintf(stderr, "project not valid: %s\n", resultJson(r->validation).c_str());
        std::exit(1);
    }
    r->active = activateProject(r->validation, 10, r->store, std::nullopt, simLoad);
    RuntimeEngineOptions o;
    o.retainDir = retainDir;
    o.logic = withLogic && r->validation.project ? &r->validation.project->logic : nullptr;
    o.logicOptions.scanMs = scanMs;
    o.logicOptions.writes = "off";
    Run* raw = r.get();
    o.logicOptions.monoMs = [raw] { return raw->mono; };
    o.logicOptions.wallMs = [raw] { return raw->now; };
    o.logicOptions.timeSynced = [] { return true; };
    o.logicOptions.log = [](const std::string&) {};
    o.logicOptions.warnings = &r->warnings;
    r->rt = std::make_unique<RuntimeEngine>(r->active.model, r->store, o);
    r->rt->firstRound(r->now);
    if (withLogic && !r->rt->logic()) {
        std::fprintf(stderr, "logic did not start\n");
        std::exit(1);
    }
    return r;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 3) {
        std::fprintf(stderr,
                     "usage: logic_bench <project-dir> <schemas-dir> [--scans N] [--sim-load] "
                     "[--scan-ms MS] [--delta-ms MS] [--out file.json]\n");
        return 2;
    }
    const std::string dir = argv[1], schemas = argv[2];
    int scans = 3000, scanMs = 100, deltaMs = 250;
    bool simLoad = false;
    std::string out;
    for (int i = 3; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--scans" && i + 1 < argc)
            scans = std::atoi(argv[++i]);
        else if (a == "--scan-ms" && i + 1 < argc)
            scanMs = std::atoi(argv[++i]);
        else if (a == "--delta-ms" && i + 1 < argc)
            deltaMs = std::atoi(argv[++i]);
        else if (a == "--sim-load")
            simLoad = true;
        else if (a == "--out" && i + 1 < argc)
            out = argv[++i];
        else {
            std::fprintf(stderr, "unknown argument %s\n", a.c_str());
            return 2;
        }
    }
    char tmpl[] = "/tmp/logic-bench-XXXXXX";
    if (!::mkdtemp(tmpl)) {
        std::perror("mkdtemp");
        return 1;
    }
    const std::string tmp = tmpl;

    // A. the round without logic
    std::vector<double> roundA;
    {
        auto r = start(dir, schemas, simLoad, false, tmp + "/a", scanMs);
        for (int s = 0; s < scans; ++s) {
            r->mono += scanMs;
            r->now += scanMs;
            const auto t0 = std::chrono::steady_clock::now();
            r->rt->tick(r->now);
            roundA.push_back(since(t0));
        }
        r->rt->stop();
    }

    // B. the round with logic, scanned every round
    std::vector<double> roundB, scanB, engB, pubB, actB, warnB;
    size_t tags = 0, outputs = 0, blocks = 0;
    std::vector<std::pair<std::string, expr::InputValue>> snapshot;
    {
        auto r = start(dir, schemas, simLoad, true, tmp + "/b", scanMs);
        LogicSubsystem& logic = *r->rt->logic();
        uint64_t seen = logic.lastProfile().scans;
        for (int s = 0; s < scans; ++s) {
            r->mono += scanMs;
            r->now += scanMs;
            const auto t0 = std::chrono::steady_clock::now();
            r->rt->tick(r->now);
            roundB.push_back(since(t0));
            const LogicSubsystem::ScanProfile p = logic.lastProfile();
            if (p.scans == seen) continue;  // no scan in this round
            seen = p.scans;
            scanB.push_back(p.totalMs);
            engB.push_back(p.engineMs);
            pubB.push_back(p.publishMs);
            actB.push_back(p.actionsMs);
            warnB.push_back(p.warningsMs);
        }
        const json st = logic.status();
        blocks = st["blocks"].size();
        tags = r->active.model->tags.size();
        for (const TagModel& t : r->active.model->tags) {
            if (t.logicOwned) {
                ++outputs;
                continue;
            }
            const TagValue v = r->store.get(*r->store.indexOf(t.id));
            expr::InputValue iv;
            iv.value = v.value;
            iv.quality = v.quality;
            iv.reason = v.reason;
            snapshot.emplace_back(t.id, iv);
        }
        std::printf("logic status: scan %s\n", st["scan"].dump().c_str());
        r->rt->stop();
    }

    // C. logic::Engine::step alone over that snapshot (by name, as logic_perf_test)
    std::vector<double> engC, engWarm;
    std::vector<std::pair<std::string, Stats>> byKind;
    {
        auto r = start(dir, schemas, simLoad, false, tmp + "/c", scanMs);
        logic::EngineOptions eo;
        for (const TagModel& t : r->active.model->tags) {
            if (t.logicOwned) continue;
            logic::TagInfo info;
            info.type = t.type;
            info.kind = t.kind == TagKind::Internal
                            ? "internal"
                            : t.kind == TagKind::Calculated
                                  ? "calculated"
                                  : t.kind == TagKind::Simulation ? "simulation" : "external";
            info.rw = t.writable;
            eo.tags[t.id] = info;
        }
        eo.config.scanMs = scanMs;
        eo.config.writesOn = false;
        eo.tables = &r->active.model->tables;
        std::unordered_map<std::string, expr::InputValue> snap(snapshot.begin(), snapshot.end());
        const logic::ReadTag read = [&snap](const std::string& id) {
            const auto it = snap.find(id);
            if (it != snap.end()) return it->second;
            expr::InputValue v;
            v.reason = "NO_VALUE";
            return v;
        };
        // warm: the scan is timed right after another one (its data in the caches)
        const auto run = [&](const json& doc, bool warm) {
            logic::Engine engine(doc, eo);
            std::vector<double> ms;
            logic::WallClock wc;
            int64_t mono = 1000;
            for (int s = 0; s < scans; ++s) {
                mono += scanMs;
                wc.epochMs = kT0 + mono;
                if (warm) (void)engine.step(mono - 1, read, wc);
                const auto t0 = std::chrono::steady_clock::now();
                const auto actions = engine.step(mono, read, wc);
                ms.push_back(since(t0));
                (void)actions;
            }
            return ms;
        };
        const json& doc = r->validation.project->logic;
        engC = run(doc, false);
        engWarm = run(doc, true);
        // D. each kind of block alone (they read Tags of tags.json only, so each part is valid)
        for (const char* kind : logic::kBlockKinds) {
            if (!doc.contains(kind) || !doc[kind].is_array() || doc[kind].empty()) continue;
            json part = {{"schemaVersion", doc.value("schemaVersion", "1.0.0")}, {kind, doc[kind]}};
            byKind.emplace_back(std::string(kind) + " (" + std::to_string(doc[kind].size()) + ")",
                                stats(run(part, false)));
        }
        r->rt->stop();
    }
    // F. the loop: busy ms per second of simulated time
    const int64_t spanMs = static_cast<int64_t>(scans) * scanMs;
    const auto loop = [&](bool withLogic, int logicMs, const std::string& sub) {
        auto r = start(dir, schemas, simLoad, withLogic, tmp + "/" + sub, scanMs);
        TickSchedule schedule(deltaMs, logicMs);
        const int64_t mono0 = r->mono, now0 = r->now;
        double busy = 0;
        for (;;) {
            const TickSchedule::Wake w = schedule.next();
            if (w.atMs > spanMs) break;
            r->mono = mono0 + w.atMs;
            r->now = now0 + w.atMs;
            const auto t0 = std::chrono::steady_clock::now();
            r->rt->tick(r->now, w.delta);
            busy += since(t0);
        }
        json scan = withLogic ? r->rt->logic()->status()["scan"] : json(nullptr);
        r->rt->stop();
        return std::make_pair(busy * 1000 / static_cast<double>(spanMs), scan);
    };
    const auto f0 = loop(false, 0, "f0");
    const auto f1 = loop(true, 0, "f1");
    const auto f2 = loop(true, scanMs, "f2");

    std::error_code ec;
    fs::remove_all(tmp, ec);

    // E. the pieces of one condition, `SIM.T0001 > 100`, 10,000 times each (us per call)
    std::vector<std::pair<std::string, double>> micro;
    {
        expr::CompileEnv ce;
        ce.tagType = [](const std::string&) { return std::optional<TagType>(TagType::FLOAT64); };
        ce.hasTable = [](const std::string&) { return false; };
        ce.target = TagType::BOOL;
        const expr::CompileResult c = expr::compile("SIM.T0001 > 100", ce);
        expr::InputValue in;
        in.value = 123.5;
        in.quality = Quality::GOOD;
        const expr::TableSet tables;
        const std::function<expr::InputValue(size_t)> byFn = [&in](size_t) { return in; };
        constexpr int kN = 10000;
        size_t sink = 0;
        auto t0 = std::chrono::steady_clock::now();
        for (int i = 0; i < kN; ++i) sink += expr::evaluate(c.program, &in, tables).value.index();
        micro.emplace_back("evaluate (inputs read)", since(t0) * 1000 / kN);
        t0 = std::chrono::steady_clock::now();
        for (int i = 0; i < kN; ++i) sink += expr::evaluate(c.program, byFn, tables).value.index();
        micro.emplace_back("evaluate (std::function)", since(t0) * 1000 / kN);
        std::vector<expr::InputValue> vals(1);
        t0 = std::chrono::steady_clock::now();
        for (int i = 0; i < kN; ++i) {
            vals[0] = byFn(0);
            sink += vals[0].value.index();
        }
        micro.emplace_back("read one input (copy)", since(t0) * 1000 / kN);
        std::vector<double> d;
        d.reserve(kN);
        t0 = std::chrono::steady_clock::now();
        for (int i = 0; i < kN; ++i) d.push_back(since(t0));
        micro.emplace_back("steady_clock::now()", since(t0) * 1000 / kN);
        if (sink == 42) std::printf(" ");
    }

    std::printf("project %s: %zu Tags (%zu logic outputs), %zu blocks, %d rounds, scanMs %d%s\n",
                dir.c_str(), tags, outputs, blocks, scans, scanMs, simLoad ? ", sim-load" : "");
    const Stats a = stats(roundA), b = stats(roundB);
    print("A round without logic", a);
    print("B round with logic", b);
    print("B scan (scan.lastMs)", stats(scanB));
    print("B  engine step", stats(engB));
    print("B  publish outputs", stats(pubB));
    print("B  actions", stats(actB));
    print("B  warnings", stats(warnB));
    print("C engine alone (by name)", stats(engC));
    print("C  right after another scan", stats(engWarm));
    json kinds = json::object();
    for (const auto& [name, st] : byKind) {
        print(("D  " + name).c_str(), st);
        kinds[name] = statsJson(st);
    }
    json microJson = json::object();
    for (const auto& [name, us] : micro) {
        std::printf("E  %-25s %8.3f us\n", name.c_str(), us);
        microJson[name] = std::round(us * 1000) / 1000;
    }
    std::printf("F  loop without logic         %8.3f ms/s\n", f0.first);
    std::printf("F  logic in the delta rounds  %8.3f ms/s  (+%.3f)  scan %s\n", f1.first,
                f1.first - f0.first, f1.second.dump().c_str());
    std::printf("F  logic on its own period    %8.3f ms/s  (+%.3f)  scan %s\n", f2.first,
                f2.first - f0.first, f2.second.dump().c_str());
    std::printf("B - A (logic in the round)   mean %8.3f ms\n", b.mean - a.mean);
    if (!out.empty()) {
        std::ofstream f(out);
        f << json{{"tags", tags},
                  {"logicOutputs", outputs},
                  {"blocks", blocks},
                  {"rounds", scans},
                  {"scanMs", scanMs},
                  {"simLoad", simLoad},
                  {"roundWithoutLogic", statsJson(a)},
                  {"roundWithLogic", statsJson(b)},
                  {"scan", statsJson(stats(scanB))},
                  {"scanEngine", statsJson(stats(engB))},
                  {"scanPublish", statsJson(stats(pubB))},
                  {"scanActions", statsJson(stats(actB))},
                  {"scanWarnings", statsJson(stats(warnB))},
                  {"engineAlone", statsJson(stats(engC))},
                  {"engineAloneWarm", statsJson(stats(engWarm))},
                  {"engineByKind", kinds},
                  {"microUs", microJson},
                  {"loop",
                   {{"deltaMs", deltaMs},
                    {"simulatedS", spanMs / 1000},
                    {"withoutLogicMsPerS", std::round(f0.first * 1000) / 1000},
                    {"logicInDeltaRoundsMsPerS", std::round(f1.first * 1000) / 1000},
                    {"logicInDeltaRoundsScan", f1.second},
                    {"logicOwnPeriodMsPerS", std::round(f2.first * 1000) / 1000},
                    {"logicOwnPeriodScan", f2.second}}}}
                 .dump(2)
          << "\n";
    }
    return 0;
}
