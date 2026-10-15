// T024: the shared vectors tests/alarm-vectors/*.json (contracts/alarm-engine.md §14, FR-016,
// SC-004): each case is a test of its own; the runner follows the README of the vectors.
#include <dirent.h>
#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <fstream>
#include <functional>
#include <map>
#include <memory>
#include <set>
#include <sstream>

#include "core/alarm/alarm_defs.hpp"
#include "core/alarm/alarm_engine.hpp"
#include "core/alarm/alarm_service.hpp"
#include "nlohmann/json.hpp"

using namespace mat::alarm;
using nlohmann::json;

namespace {
const char* kinds[] = {"state",   "shelve",  "unshelve", "disable", "enable",
                       "chatter", "command", "removed",  "resync"};

json rowJson(const OccurrenceRow& r) {
    json j = {{"id", r.id},
              {"alarmId", r.alarmId},
              {"fingerprint", r.fingerprint},
              {"tsActiveMs", r.tsActiveMs},
              {"clockOk", r.clockOk ? 1 : 0},
              {"priority", r.priority},
              {"class", r.classId},
              {"text", r.text},
              {"textFold", r.textFold},
              {"qualityActive", r.qualityActive},
              {"flags", r.flags},
              {"repeatCount", r.repeatCount},
              {"closed", r.closed ? 1 : 0}};
    if (r.tsAckMs) j["tsAckMs"] = *r.tsAckMs;
    if (r.ackUser) j["ackUser"] = *r.ackUser;
    if (r.tsReturnMs) j["tsReturnMs"] = *r.tsReturnMs;
    if (r.tsReturnAckMs) j["tsReturnAckMs"] = *r.tsReturnAckMs;
    if (r.returnAckUser) j["returnAckUser"] = *r.returnAckUser;
    if (r.area) j["area"] = *r.area;
    if (r.valueActive) j["valueActive"] = *r.valueActive;
    if (r.reason) j["reason"] = *r.reason;
    if (r.closed) j["closedBy"] = closedByName(r.closedBy);
    return j;
}

OccurrenceRow rowFromJson(const json& j) {
    OccurrenceRow r;
    r.id = j.at("id");
    r.alarmId = j.at("alarmId");
    r.fingerprint = j.value("fingerprint", "");
    r.tsActiveMs = j.at("tsActiveMs");
    r.clockOk = j.value("clockOk", 1) != 0;
    if (j.contains("tsAckMs")) r.tsAckMs = j["tsAckMs"].get<int64_t>();
    if (j.contains("ackUser")) r.ackUser = j["ackUser"].get<std::string>();
    if (j.contains("tsReturnMs")) r.tsReturnMs = j["tsReturnMs"].get<int64_t>();
    if (j.contains("tsReturnAckMs")) r.tsReturnAckMs = j["tsReturnAckMs"].get<int64_t>();
    if (j.contains("returnAckUser")) r.returnAckUser = j["returnAckUser"].get<std::string>();
    r.priority = j.value("priority", 3);
    r.classId = j.value("class", "");
    if (j.contains("area")) r.area = j["area"].get<std::string>();
    r.text = j.value("text", "");
    r.textFold = j.value("textFold", "");
    if (j.contains("valueActive")) r.valueActive = j["valueActive"].get<double>();
    r.qualityActive = j.value("qualityActive", "GOOD");
    if (j.contains("reason")) r.reason = j["reason"].get<std::string>();
    r.flags = j.value("flags", 0);
    r.repeatCount = j.value("repeatCount", 1);
    r.closed = j.value("closed", 0) != 0;
    if (j.contains("closedBy")) r.closedBy = parseClosedBy(j["closedBy"].get<std::string>());
    return r;
}

json eventJson(const AlarmEvent& e) {
    json j = {{"t", e.tMono},
              {"tEpoch", e.tEpoch},
              {"clockOk", e.clockOk},
              {"instance", e.instance},
              {"kind", kinds[static_cast<int>(e.kind)]},
              {"occurrence", e.occurrence},
              {"reason", e.reason},
              {"count", e.count},
              {"flags", {{"startup", e.startup}, {"inputBad", e.inputBad}}}};
    if (e.from) j["from"] = stateName(*e.from);
    if (e.to) j["to"] = stateName(*e.to);
    if (e.closedBy != ClosedBy::None) j["closedBy"] = closedByName(e.closedBy);
    if (!e.text.empty()) j["text"] = e.text;
    if (e.value) j["value"] = *e.value;
    if (!e.result.empty()) j["result"] = e.result;
    if (e.row) j["row"] = rowJson(*e.row);
    return j;
}

json itemJson(const AlarmItem& it) {
    json j = {{"id", it.id},
              {"defId", it.defId},
              {"name", it.name},
              {"class", it.classId},
              {"priority", priorityName(static_cast<Priority>(it.priority))},
              {"state", stateName(it.state)},
              {"disabled", it.disabled},
              {"inputBad", it.inputBad},
              {"occurrence", it.occurrence},
              {"rev", it.rev},
              {"clockOk", it.clockOk},
              {"repeat", it.repeat},
              {"startup", it.startup}};
    if (!it.limit.empty()) j["limit"] = it.limit;
    if (!it.areaId.empty()) j["area"] = it.areaId;
    if (it.shelve)
        j["shelve"] = {{"user", it.shelve->user},
                       {"reason", it.shelve->reason},
                       {"untilMs", it.shelve->untilEpochMs},
                       {"remainingS", it.shelve->remainingS},
                       {"system", it.shelve->system}};
    if (it.tsActiveMs) j["tsActiveMs"] = *it.tsActiveMs;
    if (it.tsAckMs) j["tsAckMs"] = *it.tsAckMs;
    if (!it.ackUser.empty()) j["ackUser"] = it.ackUser;
    if (it.tsReturnMs) j["tsReturnMs"] = *it.tsReturnMs;
    if (it.value) j["value"] = *it.value;
    if (!it.quality.empty()) j["quality"] = it.quality;
    if (!it.reason.empty()) j["reason"] = it.reason;
    if (!it.text.empty()) j["text"] = it.text;
    return j;
}

json countsJson(const Counts& c) {
    return {{"active", c.active},
            {"unacked", c.unacked},
            {"rtnUnack", c.rtnUnack},
            {"shelved", c.shelved},
            {"disabled", c.disabled},
            {"unackedByPriority",
             {{"critical", c.unackedByPriority[0]},
              {"major", c.unackedByPriority[1]},
              {"minor", c.unackedByPriority[2]},
              {"advisory", c.unackedByPriority[3]}}},
            {"activeByPriority",
             {{"critical", c.activeByPriority[0]},
              {"major", c.activeByPriority[1]},
              {"minor", c.activeByPriority[2]},
              {"advisory", c.activeByPriority[3]}}}};
}

// Every key of `exp` must be in `act` with an equal value (deep for objects).
bool subset(const json& exp, const json& act) {
    if (exp.is_object()) {
        if (!act.is_object()) return false;
        for (auto it = exp.begin(); it != exp.end(); ++it) {
            if (!act.contains(it.key()) || !subset(it.value(), act[it.key()])) return false;
        }
        return true;
    }
    if (exp.is_number() && act.is_number()) {
        const double a = exp.get<double>(), b = act.get<double>();
        return std::fabs(a - b) <= 1e-9 * std::max(1.0, std::fabs(a));
    }
    return exp == act;
}

double tagNumber(const json& v) {
    if (v.is_string()) {
        const std::string s = v.get<std::string>();
        if (s == "NaN") return std::nan("");
        if (s == "Infinity") return INFINITY;
        if (s == "-Infinity") return -INFINITY;
        return std::strtod(s.c_str(), nullptr);
    }
    return v.get<double>();
}

struct StoredSample {
    bool known = false;
    double value = 0;
    TagSample::Quality quality = TagSample::Quality::Bad;
    std::string reason = "NO_DATA";
};

class CaseRunner {
   public:
    explicit CaseRunner(const json& c) : c_(c) {}

    void run() {
        const json& o = c_["options"];
        tickMs_ = o.value("tickMs", 250);
        epoch0_ = o.value("epoch0", int64_t(1791600000000LL));
        clockOkFrom_ = o.value("clockOkFrom", int64_t(1577836800000LL));
        opts_.chatterWindowS = o.value("chatterWindowS", 60);
        opts_.chatterShelveS = o.value("chatterShelveS", 1800);
        opts_.maxShelved = o.value("maxShelved", 50);
        opts_.clockOkFromMs = clockOkFrom_;
        alarms_ = c_["alarms"];
        classes_ = c_["classes"];
        areas_ = c_.value("areas", json::array());
        tags_ = c_.value("tags", json::object());
        devices_ = c_.value("devices", json::object());
        epochBase_ = epoch0_;
        build();
        engine_ = std::make_unique<AlarmEngine>(opts_);
        LoadContext ctx;
        ctx.nowMonoMs = 0;
        ctx.nowEpochMs = epochBase_;
        ctx.clockOk = clockOk(epochBase_);
        ctx.processStart = true;
        ctx.nextOccurrence = 1;
        engine_->load(defs_, ctx);
        {  // the resync of the first load is not compared (README of the vectors)
            std::vector<AlarmEvent> ignored;
            engine_->takeEvents(ignored);
        }

        std::multimap<int64_t, const json*> byT;
        for (const auto& e : c_["timeline"]) {
            const int64_t t = e["t"].get<int64_t>();
            ASSERT_EQ(t % tickMs_, 0) << "timeline t is not a multiple of tickMs";
            byT.emplace(t, &e);
        }
        const int64_t end = c_["end"].get<int64_t>();
        for (int64_t t = 0; t <= end; t += tickMs_) {
            auto range = byT.equal_range(t);
            for (auto it = range.first; it != range.second; ++it) {
                const json& e = *it->second;
                if (e.contains("tags")) applyTags(e["tags"]);
                if (e.contains("action")) {
                    action(t, e["action"]);
                    if (::testing::Test::HasFatalFailure()) return;
                }
            }
            std::vector<TagSample> samples = sampleVector();
            engine_->step(t, epochNow(t), samples.data(), samples.size());
            collect(t);
            checkView(t);
        }
        compare();
    }

   private:
    bool clockOk(int64_t epoch) const { return epoch >= clockOkFrom_; }
    int64_t epochNow(int64_t t) const { return epochBase_ + t; }

    void build() {
        ProjectView p;
        p.alarms = {{"areas", areas_}, {"alarms", alarms_}};
        p.classes = {{"classes", classes_}};
        for (auto it = tags_.begin(); it != tags_.end(); ++it) {
            AlarmTagInfo info;
            info.unit = it.value().value("unit", "");
            info.isBool = it.value().value("isBool", false);
            if (it.value().contains("labels"))
                for (auto l = it.value()["labels"].begin(); l != it.value()["labels"].end(); ++l)
                    info.labels[l.key()] = l.value().get<std::string>();
            p.tags[it.key()] = info;
        }
        for (auto it = devices_.begin(); it != devices_.end(); ++it)
            p.devices[it.key()] = it.value().get<std::vector<std::string>>();
        CompileResult r = compileAlarms(p);
        ASSERT_TRUE(r.ok()) << (r.errors.empty() ? "" : r.errors.front());
        defs_ = r.defs;
    }

    std::vector<TagSample> sampleVector() {
        stable_.clear();
        for (const auto& id : engine_->watchedTags()) stable_.push_back(&samples_[id]);
        std::vector<TagSample> out(stable_.size());
        for (size_t i = 0; i < stable_.size(); ++i) {
            out[i].known = stable_[i]->known;
            out[i].value = stable_[i]->value;
            out[i].quality = stable_[i]->quality;
            out[i].reason = stable_[i]->reason;
        }
        return out;
    }

    void applyTags(const json& tags) {
        for (auto it = tags.begin(); it != tags.end(); ++it) {
            StoredSample& s = samples_[it.key()];
            const json& v = it.value();
            s.known = v.value("known", true);
            if (v.contains("value")) s.value = tagNumber(v["value"]);
            const std::string q = v.value("quality", "GOOD");
            s.quality = q == "BAD" ? TagSample::Quality::Bad
                                   : q == "UNCERTAIN" ? TagSample::Quality::Uncertain
                                                      : TagSample::Quality::Good;
            s.reason = v.value("reason", "");
        }
    }

    void collect(int64_t) {
        std::vector<AlarmEvent> ev;
        engine_->takeEvents(ev);
        for (auto& e : ev) {
            EventChanges ch = changesOf(e);
            for (auto& r : ch.rows) rows_[r.id] = r;
            for (auto& o : ch.overrides) {
                const auto key = std::make_pair(o.row.alarmId, o.row.kind);
                if (o.remove)
                    overrides_.erase(key);
                else
                    overrides_[key] = o.row;
            }
            actual_.push_back(eventJson(e));
        }
    }

    void submitAck(const std::string& id, int64_t occ, const std::string& user) {
        Command c;
        c.kind = CommandKind::Ack;
        c.id = id;
        c.occurrence = occ;
        c.user = user;
        engine_->submit(c);
    }

    void action(int64_t t, const json& a) {
        const std::string type = a["type"];
        const std::string inst = a.value("instance", "");
        const std::string user = a.value("user", "op1");
        if (type == "ack") {
            submitAck(inst, a.value("occurrence", int64_t(0)), user);
        } else if (type == "ackAll") {
            AckRequest req;
            req.all = true;
            req.upToRevision = a.contains("upToRevision") ? a["upToRevision"].get<int64_t>()
                                                          : engine_->view()->revision;
            if (a.contains("filter")) {
                const json& f = a["filter"];
                if (f.contains("area") && !f["area"].is_null())
                    req.filter.area = f["area"].get<std::string>();
                if (f.contains("class") && !f["class"].is_null())
                    req.filter.classId = f["class"].get<std::string>();
                if (f.contains("priority") && !f["priority"].is_null()) {
                    auto p = parsePriority(f["priority"].get<std::string>());
                    if (p) req.filter.priority = static_cast<int>(*p);
                }
                if (f.contains("state") && !f["state"].is_null())
                    req.filter.state = f["state"].get<std::string>();
                if (f.contains("q") && !f["q"].is_null()) req.filter.q = f["q"].get<std::string>();
            }
            for (const auto& tg : engine_->previewAck(req)) submitAck(tg.id, tg.occurrence, user);
        } else if (type == "shelve") {
            Command c;
            c.kind = CommandKind::Shelve;
            c.id = inst;
            c.reason = a.value("reason", "");
            c.durationS = a.value("durationS", 0);
            c.user = user;
            engine_->submit(c);
        } else if (type == "unshelve" || type == "enable" || type == "disable") {
            Command c;
            c.kind = type == "unshelve"
                         ? CommandKind::Unshelve
                         : type == "enable" ? CommandKind::Enable : CommandKind::Disable;
            c.id = inst;
            c.reason = a.value("reason", "");
            c.user = user;
            engine_->submit(c);
        } else if (type == "clock") {
            epochBase_ = a["epoch0"].get<int64_t>();
        } else if (type == "commit") {
            committedRows_ = rows_;
            committedOverrides_ = overrides_;
        } else if (type == "reload") {
            alarms_ = a["alarms"];
            if (a.contains("classes")) classes_ = a["classes"];
            if (a.contains("areas")) areas_ = a["areas"];
            if (a.contains("tags")) tags_ = a["tags"];
            build();
            LoadContext ctx;
            ctx.nowMonoMs = t;
            ctx.nowEpochMs = epochNow(t);
            ctx.clockOk = clockOk(ctx.nowEpochMs);
            ctx.processStart = false;
            ctx.nextOccurrence = nextOccurrence();
            engine_->load(defs_, ctx);
            collect(t);
        } else if (type == "restart") {
            if (a.contains("rows"))
                for (const auto& rj : a["rows"]) {
                    OccurrenceRow r = rowFromJson(rj);
                    rows_[r.id] = r;
                    committedRows_[r.id] = r;
                }
            if (a.contains("alarms")) alarms_ = a["alarms"];
            if (a.contains("classes")) classes_ = a["classes"];
            if (a.contains("areas")) areas_ = a["areas"];
            if (a.contains("tags")) tags_ = a["tags"];
            if (a.contains("devices")) devices_ = a["devices"];
            if (a.value("clock", "ok") == "bad") epochBase_ = 0;
            const bool all = a.value("persist", "committed") == "all";
            if (!all) {
                rows_ = committedRows_;
                overrides_ = committedOverrides_;
            }
            samples_.clear();  // a new TagStore: nothing has a value
            build();
            engine_ = std::make_unique<AlarmEngine>(opts_);
            LoadContext ctx;
            for (const auto& kv : rows_)
                if (!kv.second.closed) ctx.open.push_back(kv.second);
            for (const auto& kv : overrides_) ctx.overrides.push_back(kv.second);
            ctx.nowMonoMs = t;
            ctx.nowEpochMs = epochNow(t);
            ctx.clockOk = clockOk(ctx.nowEpochMs);
            ctx.processStart = true;
            ctx.nextOccurrence = nextOccurrence();
            engine_->load(defs_, ctx);
            collect(t);
        } else {
            ADD_FAILURE() << "unknown action " << type;
        }
    }

    int64_t nextOccurrence() const {
        int64_t m = 0;
        for (const auto& kv : rows_) m = std::max(m, kv.first);
        return m + 1;
    }

    void checkView(int64_t t) {
        if (!c_.contains("expectView")) return;
        for (const auto& v : c_["expectView"]) {
            if (v["t"].get<int64_t>() != t) continue;
            auto view = engine_->view();
            if (v.contains("counts")) {
                EXPECT_TRUE(subset(v["counts"], countsJson(view->counts)))
                    << "t=" << t << " counts expected " << v["counts"] << " got "
                    << countsJson(view->counts);
            }
            if (v.contains("items")) {
                for (auto it = v["items"].begin(); it != v["items"].end(); ++it) {
                    const AlarmItem* item = view->find(it.key());
                    if (it.value().is_null()) {
                        EXPECT_EQ(item, nullptr)
                            << "t=" << t << " item " << it.key() << " should be absent";
                        continue;
                    }
                    if (!item) {
                        ADD_FAILURE() << "t=" << t << " no item " << it.key();
                        continue;
                    }
                    EXPECT_TRUE(subset(it.value(), itemJson(*item)))
                        << "t=" << t << " item " << it.key() << " expected " << it.value()
                        << " got " << itemJson(*item);
                }
            }
        }
    }

    void compare() {
        const bool strict = c_.value("strict", true);
        std::set<std::string> listed;
        for (const auto& e : c_["expect"]) listed.insert(e.value("kind", "state"));
        std::vector<json> act;
        for (const auto& a : actual_)
            if (strict || listed.count(a["kind"].get<std::string>())) act.push_back(a);
        const auto& exp = c_["expect"];
        bool ok = act.size() == exp.size();
        size_t bad = 0;
        for (size_t i = 0; ok && i < exp.size(); ++i) {
            json e = exp[i];
            if (!e.contains("kind")) e["kind"] = "state";
            if (!subset(e, act[i])) {
                ok = false;
                bad = i;
            }
        }
        if (!ok) {
            std::ostringstream o;
            o << "events differ (expected " << exp.size() << ", got " << act.size() << ")";
            if (bad < exp.size())
                o << "; first difference at #" << bad << "\n  expected " << exp[bad];
            if (bad < act.size()) o << "\n  actual   " << act[bad];
            o << "\nall actual events:";
            for (const auto& a : act) {
                json s = a;
                s.erase("tEpoch");
                s.erase("clockOk");
                s.erase("row");
                o << "\n  " << s;
            }
            ADD_FAILURE() << o.str();
        }
    }

    json c_;
    int64_t tickMs_ = 250, epoch0_ = 0, clockOkFrom_ = 0, epochBase_ = 0;
    AlarmOptions opts_;
    json alarms_, classes_, areas_, tags_, devices_;
    AlarmDefs defs_;
    std::unique_ptr<AlarmEngine> engine_;
    std::map<std::string, StoredSample> samples_;
    std::vector<StoredSample*> stable_;
    std::vector<json> actual_;
    std::map<int64_t, OccurrenceRow> rows_, committedRows_;
    std::map<std::pair<std::string, std::string>, OverrideRow> overrides_, committedOverrides_;
};

class VectorTest : public ::testing::Test {
   public:
    explicit VectorTest(json c) : c_(std::move(c)) {}
    void TestBody() override {
        CaseRunner r(c_);
        r.run();
    }

   private:
    json c_;
};

class NoVectors : public ::testing::Test {
   public:
    void TestBody() override { GTEST_SKIP() << "tests/alarm-vectors has no case files"; }
};

bool registerAll() {
    const std::string dir = std::string(MAT_SOURCE_DIR) + "/tests/alarm-vectors";
    std::vector<std::string> files;
    if (DIR* d = opendir(dir.c_str())) {
        while (dirent* e = readdir(d)) {
            const std::string n = e->d_name;
            if (n.size() > 5 && n.substr(n.size() - 5) == ".json") files.push_back(n);
        }
        closedir(d);
    }
    std::sort(files.begin(), files.end());
    static const std::set<std::string> notCases = {"MANIFEST.json", "fold.json", "fold-table.json",
                                                   "fingerprint.json", "round-table.json"};
    int n = 0;
    for (const auto& f : files) {
        if (notCases.count(f)) continue;
        std::ifstream in(dir + "/" + f);
        json j = json::parse(in, nullptr, false);
        if (j.is_discarded() || !j.contains("cases")) continue;
        for (const auto& c : j["cases"]) {
            const std::string name = c["name"].get<std::string>();
            std::string gname = name;
            for (char& ch : gname)
                if (!isalnum(static_cast<unsigned char>(ch))) ch = '_';
            json copy = c;
            ::testing::RegisterTest("AlarmVectors", gname.c_str(), nullptr, nullptr, __FILE__,
                                    __LINE__,
                                    [copy]() -> ::testing::Test* { return new VectorTest(copy); });
            ++n;
        }
    }
    if (n == 0)
        ::testing::RegisterTest("AlarmVectors", "NoVectors", nullptr, nullptr, __FILE__, __LINE__,
                                []() -> ::testing::Test* { return new NoVectors(); });
    return true;
}
const bool kRegistered = registerAll();
}  // namespace

TEST(AlarmVectorFiles, AtLeastSixtyCasesAndEveryNameIsUnique) {
    const std::string dir = std::string(MAT_SOURCE_DIR) + "/tests/alarm-vectors";
    std::set<std::string> names;
    int n = 0;
    DIR* d = opendir(dir.c_str());
    if (!d) GTEST_SKIP() << "no vector directory";
    std::vector<std::string> files;
    while (dirent* e = readdir(d)) files.push_back(e->d_name);
    closedir(d);
    for (const auto& f : files) {
        if (f.size() < 6 || f.substr(f.size() - 5) != ".json" || f == "MANIFEST.json" ||
            f == "fold.json" || f == "fold-table.json" || f == "fingerprint.json" ||
            f == "round-table.json")
            continue;
        std::ifstream in(dir + "/" + f);
        json j = json::parse(in, nullptr, false);
        ASSERT_FALSE(j.is_discarded()) << f;
        ASSERT_TRUE(j.contains("cases")) << f;
        ASSERT_GE(j["cases"].size(), 1u) << f;
        for (const auto& c : j["cases"]) {
            EXPECT_TRUE(names.insert(c["name"].get<std::string>()).second)
                << "duplicate " << c["name"];
            ++n;
        }
    }
    if (n == 0) GTEST_SKIP() << "no vectors yet";
    EXPECT_GE(n, 60);
}
