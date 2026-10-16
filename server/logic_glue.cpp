#include "server/logic_glue.hpp"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <ctime>
#include <fstream>
#include <sstream>

#include "core/common/json_text.hpp"
#include "core/common/thread_name.hpp"
#include "core/logic/order.hpp"

namespace mat {

using nlohmann::json;

namespace {

const char* kindName(TagKind k) {
    switch (k) {
        case TagKind::External:
            return "external";
        case TagKind::Internal:
            return "internal";
        case TagKind::Calculated:
            return "calculated";
        case TagKind::Simulation:
            return "simulation";
    }
    return "external";
}

json scalarJson(const TagScalar& v) {
    if (const bool* b = std::get_if<bool>(&v)) return *b;
    if (const int64_t* i = std::get_if<int64_t>(&v)) return *i;
    if (const uint64_t* u = std::get_if<uint64_t>(&v)) return *u;
    if (const double* d = std::get_if<double>(&v)) return std::isfinite(*d) ? json(*d) : json();
    if (const std::string* s = std::get_if<std::string>(&v)) return *s;
    return nullptr;
}

bool numberOfScalar(const TagScalar& v, double& out) {
    if (const double* d = std::get_if<double>(&v)) return out = *d, true;
    if (const int64_t* i = std::get_if<int64_t>(&v)) return out = static_cast<double>(*i), true;
    if (const uint64_t* u = std::get_if<uint64_t>(&v)) return out = static_cast<double>(*u), true;
    return false;
}

// The value of an action as the coordinator takes it, by the type of the target Tag.
WriteValue writeValueOf(TagType type, const TagScalar& v) {
    if (const bool* b = std::get_if<bool>(&v)) return WriteValue::boolean(*b);
    if (const std::string* s = std::get_if<std::string>(&v)) return WriteValue::text(*s);
    double d = 0;
    if (!numberOfScalar(v, d)) return WriteValue{};
    switch (type) {
        case TagType::FLOAT32:
        case TagType::FLOAT64:
            return WriteValue::number(d);
        case TagType::UINT64:
            if (const uint64_t* u = std::get_if<uint64_t>(&v)) return WriteValue::unsignedInt(*u);
            if (d >= 0 && std::floor(d) == d && d < 18446744073709551616.0)
                return WriteValue::unsignedInt(static_cast<uint64_t>(d));
            return WriteValue::number(d);
        case TagType::BOOL:
        case TagType::STRING:
            return WriteValue::number(d);  // refused by the coordinator (BAD_TYPE)
        default:
            if (const int64_t* i = std::get_if<int64_t>(&v)) return WriteValue::integer(*i);
            if (std::floor(d) == d && d >= -9223372036854775808.0 && d < 9223372036854775808.0)
                return WriteValue::integer(static_cast<int64_t>(d));
            return WriteValue::number(d);  // a fraction for an integer Tag: BAD_TYPE
    }
}

// ISO 8601 with the device's offset: 2026-10-13T08:12:03+07:00.
std::string isoAt(int64_t wallMs, int tzMin) {
    const time_t t = static_cast<time_t>((wallMs + static_cast<int64_t>(tzMin) * 60000) / 1000);
    std::tm tm{};
    gmtime_r(&t, &tm);
    char buf[64];
    const int a = std::abs(tzMin) % 1440;
    std::snprintf(buf, sizeof buf, "%04d-%02d-%02dT%02d:%02d:%02d%c%02d:%02d", tm.tm_year + 1900,
                  tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec,
                  tzMin < 0 ? '-' : '+', a / 60, a % 60);
    return buf;
}

std::string fieldOf(const std::string& key) {
    const size_t s = key.rfind('/');
    return s == std::string::npos ? key : key.substr(s + 1);
}

bool writeDurably(const std::string& path, const std::string& text, std::string& error) {
    const std::string tmp = path + ".tmp";
    const int fd = ::open(tmp.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    if (fd < 0) return error = "open " + tmp, false;
    size_t off = 0;
    while (off < text.size()) {
        const ssize_t n = ::write(fd, text.data() + off, text.size() - off);
        if (n <= 0) {
            ::close(fd);
            ::unlink(tmp.c_str());
            return error = "write " + tmp, false;
        }
        off += static_cast<size_t>(n);
    }
    if (::fsync(fd) != 0) {
        ::close(fd);
        ::unlink(tmp.c_str());
        return error = "fsync " + tmp, false;
    }
    ::close(fd);
    if (::rename(tmp.c_str(), path.c_str()) != 0) {
        ::unlink(tmp.c_str());
        return error = "rename " + path, false;
    }
    const size_t slash = path.rfind('/');
    const std::string dir = slash == std::string::npos ? "." : path.substr(0, slash);
    const int dfd = ::open(dir.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dfd >= 0) {
        ::fsync(dfd);
        ::close(dfd);
    }
    return true;
}

}  // namespace

struct LogicSubsystem::Pending {
    std::string rule, write, tag;
    size_t tagIdx = 0;
    TagType type = TagType::BOOL;
    TagScalar value;
    int64_t pulseMs = -1;
    int64_t edgeId = 0;
    json inputs = json::array();
};

std::vector<std::pair<std::string, TagType>> logicRetainKeys(const json& doc) {
    std::vector<std::pair<std::string, TagType>> out;
    const auto retained = [](const json& b) {
        const auto it = b.find("retain");
        return !(it != b.end() && it->is_boolean() && !it->get<bool>());
    };
    for (const json* r : logic::blocksOf(doc, "rules"))
        out.emplace_back("logic/" + logic::blockId(*r) + "/edgeId", TagType::INT64);
    for (const json* c : logic::blocksOf(doc, "counters"))
        if (retained(*c)) {
            out.emplace_back("logic/" + logic::blockId(*c) + "/value", TagType::INT64);
            out.emplace_back("logic/" + logic::blockId(*c) + "/overflow", TagType::BOOL);
        }
    for (const json* z : logic::blocksOf(doc, "totalizers"))
        if (retained(*z)) {
            out.emplace_back("logic/" + logic::blockId(*z) + "/total", TagType::FLOAT64);
            out.emplace_back("logic/" + logic::blockId(*z) + "/gapSeconds", TagType::FLOAT64);
        }
    for (const json* h : logic::blocksOf(doc, "runhours"))
        if (retained(*h)) {
            out.emplace_back("logic/" + logic::blockId(*h) + "/hours", TagType::FLOAT64);
            out.emplace_back("logic/" + logic::blockId(*h) + "/starts", TagType::INT64);
            out.emplace_back("logic/" + logic::blockId(*h) + "/lastRun", TagType::BOOL);
        }
    return out;
}

logic::RetainMap logicRetainFromStore(const std::map<std::string, RetainValue>& values) {
    logic::RetainMap out;
    for (const auto& [key, v] : values) {
        if (key.rfind("logic/", 0) != 0) continue;
        const std::string f = fieldOf(key);
        if (const int64_t* i = std::get_if<int64_t>(&v.value)) {
            if (f == "value")
                out[key] = std::to_string(*i);
            else
                out[key] = *i;
        } else if (const bool* b = std::get_if<bool>(&v.value)) {
            out[key] = *b;
        } else if (const double* d = std::get_if<double>(&v.value)) {
            out[key] = *d;
        }
    }
    return out;
}

RetainValue logicRetainToStore(const std::string& key, const json& v) {
    RetainValue r;
    const std::string f = fieldOf(key);
    if (f == "value" || f == "edgeId" || f == "starts") {
        r.type = TagType::INT64;
        int64_t i = 0;
        if (v.is_string()) {
            try {
                i = std::stoll(v.get<std::string>());
            } catch (const std::exception&) {
            }
        } else if (v.is_number()) {
            i = static_cast<int64_t>(v.get<double>());
        }
        r.value = i;
    } else if (f == "overflow" || f == "lastRun") {
        r.type = TagType::BOOL;
        r.value = v.is_boolean() && v.get<bool>();
    } else {
        r.type = TagType::FLOAT64;
        r.value = v.is_number() ? v.get<double>() : 0.0;
    }
    return r;
}

LogicSubsystem::LogicSubsystem(const ProjectModel& model, const json& doc, LogicOptions options,
                               const logic::RetainMap& retain, bool retainLost)
    : model_(model), doc_(doc), opt_(std::move(options)), retainLost_(retainLost) {
    logic::TagInfoMap tags;
    for (size_t i = 0; i < model_.tags.size(); ++i) {
        const TagModel& t = model_.tags[i];
        index_[t.id] = i;
        if (t.logicOwned) continue;
        logic::TagInfo info;
        info.type = t.type;
        info.kind = kindName(t.kind);
        info.rw = t.writable;
        if (t.kind == TagKind::Calculated) info.expression = t.expression;
        tags[t.id] = info;
    }
    loadState();
    logic::RetainMap start = retainLost_ ? logic::RetainMap{} : retain;
    for (const auto& [rule, edge] : edges_) {  // an edge handed over after the last flush
        const std::string key = "logic/" + rule + "/edgeId";
        const auto it = start.find(key);
        const int64_t have = it != start.end() && it->second.is_number()
                                 ? static_cast<int64_t>(it->second.get<double>())
                                 : 0;
        if (edge > have) start[key] = edge;
    }
    logic::EngineOptions eo;
    eo.tags = std::move(tags);
    eo.config.scanMs = opt_.scanMs;
    eo.config.tzOffsetMin = opt_.tzOffsetMin;
    eo.config.maxWritesPerMin = opt_.maxWritesPerMin;
    eo.config.writesOn = opt_.writes == "on" && !stopped_;
    eo.retain = &start;
    eo.retainLost = retainLost_;
    eo.tables = &model_.tables;
    engine_ = std::make_unique<logic::Engine>(doc_, eo);
    for (const auto& [tag, def] : engine_->outputTags()) {
        const auto it = index_.find(tag);
        if (it != index_.end()) outputs_.emplace_back(tag, it->second);
    }
    for (const json* r : logic::blocksOf(doc_, "rules")) {
        const std::string id = logic::blockId(*r);
        ruleInputs_[id] = engine_->inputsOf(id);
    }
    flushed_ = engine_->retainSnapshot();
    lastFlushMono_ = mono();
    {
        std::lock_guard<std::mutex> g(mu_);
        if (retainLost_) {
            if (opt_.warnings)
                opt_.warnings->set("LOGIC_RETAIN_LOST", json{{"blocks", flushed_.size()}});
            auditLocked(AuditAction::LogicRetainLost, AuditResult::Failed, "system", "", "",
                        json{{"keys", flushed_.size()}});
        }
        updateWarningsLocked(mono());
    }
    dispatcher_ = std::thread([this] {
        setThreadName("mat-logic");
        dispatcherLoop();
    });
}

LogicSubsystem::~LogicSubsystem() { stop(); }

void LogicSubsystem::stop() {
    {
        std::lock_guard<std::mutex> g(qMu_);
        if (qStop_ && !dispatcher_.joinable()) return;
        qStop_ = true;
        if (!queue_.empty())
            logLine("logic: " + std::to_string(queue_.size()) +
                    " lệnh ghi chưa giao WriteCoordinator bị bỏ khi dừng");
        queue_.clear();
    }
    qCv_.notify_all();
    if (dispatcher_.joinable()) dispatcher_.join();
    idleCv_.notify_all();
}

void LogicSubsystem::setCoordinator(WriteCoordinator* coordinator) {
    std::lock_guard<std::mutex> g(qMu_);
    coordinator_ = coordinator;
}

int64_t LogicSubsystem::mono() const {
    if (opt_.monoMs) return opt_.monoMs();
    timespec ts{};
    ::clock_gettime(CLOCK_BOOTTIME, &ts);
    return static_cast<int64_t>(ts.tv_sec) * 1000 + ts.tv_nsec / 1000000;
}

int64_t LogicSubsystem::wall() const {
    if (opt_.wallMs) return opt_.wallMs();
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

void LogicSubsystem::logLine(const std::string& line) {
    if (opt_.log)
        opt_.log(line);
    else
        std::fprintf(stderr, "%s\n", line.c_str());
}

expr::InputValue LogicSubsystem::readTag(const EngineRound& io, const std::string& id) const {
    const auto it = index_.find(id);
    if (it == index_.end()) {
        expr::InputValue v;
        v.quality = Quality::BAD;
        v.reason = "NO_VALUE";
        return v;
    }
    return io.read(it->second);
}

void LogicSubsystem::auditLocked(AuditAction action, AuditResult result, const std::string& user,
                                 const std::string& target, const std::string& code, json detail) {
    if (!opt_.audit) return;
    AuditEvent e(action, result,
                 user.rfind("logic:", 0) == 0 ? AuditChannel::Logic : AuditChannel::System,
                 user.rfind("logic:", 0) == 0 ? "logic" : "system");
    e.user = user;
    if (user.rfind("logic:", 0) == 0) e.role = "logic";
    if (!target.empty()) e.target = target;
    if (!code.empty()) e.code = code;
    if (!detail.is_null()) e.detail = jsonText(detail);
    try {
        opt_.audit(e);
    } catch (const std::exception& ex) {
        logLine(std::string("logic: audit ") + auditActionName(action) + ": " + ex.what());
    }
}

void LogicSubsystem::updateWarningsLocked(int64_t now) {
    if (!opt_.warnings) return;
    const bool hasWrites =
        !logic::blocksOf(doc_, "writes").empty() ||
        (doc_.contains("writes") && doc_["writes"].is_array() && !doc_["writes"].empty());
    const std::string state = stopped_ ? "stopped" : opt_.writes;
    if (hasWrites && state != "on") {
        if (writesKey_ != state)
            opt_.warnings->set("LOGIC_WRITES_OFF",
                               json{{"writes", state},
                                    {"stoppedBy", stopped_ ? json(stoppedBy_) : json(nullptr)}});
    } else if (!writesKey_.empty() && writesKey_ != "on") {
        opt_.warnings->clear("LOGIC_WRITES_OFF");
    }
    writesKey_ = hasWrites ? state : "on";
    std::vector<std::string> throttled;
    for (const std::string& id : engine_->blockIds()) {
        const auto st = engine_->state(id);
        if (st && st->state == "THROTTLED") throttled.push_back(id);
    }
    (void)now;
    if (!throttled.empty()) {
        opt_.warnings->set("LOGIC_THROTTLED", json{{"rules", throttled}});
        throttledWarn_ = true;
    } else if (throttledWarn_) {
        opt_.warnings->clear("LOGIC_THROTTLED");
        throttledWarn_ = false;
    }
}

void LogicSubsystem::round(EngineRound& io) {
    const int64_t now = mono();
    std::vector<std::unique_ptr<Pending>> handOverList;
    {
        std::lock_guard<std::mutex> g(mu_);
        if (nextScan_ && now < *nextScan_) return;
        const auto t0 = std::chrono::steady_clock::now();
        logic::WallClock wc;
        wc.epochMs = wall();
        wc.synced = opt_.timeSynced ? opt_.timeSynced() : true;
        const logic::ReadTag read = [&](const std::string& id) { return readTag(io, id); };
        const std::vector<logic::ActionOut> actions = engine_->step(now, read, wc);
        for (const auto& [tag, idx] : outputs_) {
            const logic::Output* o = engine_->output(tag);
            if (!o) continue;
            io.publish(idx, o->value, o->good ? Quality::GOOD : Quality::BAD, o->reason);
        }
        for (const logic::ActionOut& a : actions) {
            const auto ti = index_.find(a.tag);
            if (ti == index_.end()) continue;
            const std::string user = "logic:" + a.rule;
            if ((a.doName == "setTag" || a.doName == "toggle") && a.result == "OK" && a.hasValue) {
                io.setInternal(ti->second, a.value);
                continue;
            }
            if (a.doName != "write" && a.doName != "pulse") continue;
            const json detail = {{"rule", a.rule},
                                 {"write", a.write},
                                 {"edgeId", a.edgeId},
                                 {"value", a.hasValue ? scalarJson(a.value) : json()}};
            if (a.result == "QUEUED") {
                auto p = std::make_unique<Pending>();
                p->rule = a.rule;
                p->write = a.write;
                p->tag = a.tag;
                p->tagIdx = ti->second;
                p->type = model_.tags[ti->second].type;
                p->value = a.value;
                p->pulseMs = a.doName == "pulse" ? a.ms : -1;
                p->edgeId = a.edgeId;
                const auto ins = ruleInputs_.find(a.rule);
                if (ins != ruleInputs_.end())
                    for (const std::string& in : ins->second) {
                        if (p->inputs.size() >= kLogicMaxInputs) break;
                        p->inputs.push_back(json::array({in, scalarJson(read(in).value)}));
                    }
                handOverList.push_back(std::move(p));
            } else if (a.result == "SUPPRESSED") {
                auditLocked(AuditAction::LogicWriteSuppressed, AuditResult::Denied, user, a.tag,
                            stopped_ ? "LOGIC_WRITES_STOPPED" : "LOGIC_WRITES_OFF", detail);
            } else if (a.result == "RATE_LIMITED") {
                auditLocked(AuditAction::LogicThrottled, AuditResult::Denied, user, a.tag,
                            "RATE_LIMITED", detail);
            } else {
                lastErrorCode_[a.rule] = a.result;
            }
        }
        updateWarningsLocked(now);
        const double ms =
            std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0)
                .count();
        lastScanMs_ = ms;
        scanMsWindow_.push_back(ms);
        if (scanMsWindow_.size() > 100) scanMsWindow_.erase(scanMsWindow_.begin());
        int64_t next = nextScan_ ? *nextScan_ + opt_.scanMs : now + opt_.scanMs;
        if (next <= now || ms > opt_.scanMs) {
            ++overruns_;
            next = now + opt_.scanMs;
        }
        nextScan_ = next;
    }
    if (!handOverList.empty()) {
        {
            std::lock_guard<std::mutex> g(qMu_);
            for (auto& p : handOverList) queue_.push_back(std::move(p));
        }
        qCv_.notify_all();
    }
}

void LogicSubsystem::dispatcherLoop() {
    std::unique_lock<std::mutex> l(qMu_);
    while (!qStop_) {
        qCv_.wait_for(l, std::chrono::milliseconds(opt_.resultPollMs),
                      [this] { return qStop_ || !queue_.empty(); });
        if (qStop_) break;
        while (!queue_.empty() && !qStop_) {
            std::unique_ptr<Pending> p = std::move(queue_.front());
            queue_.pop_front();
            ++inFlight_;
            l.unlock();
            handOver(*p);
            l.lock();
            --inFlight_;
        }
        std::vector<Outstanding> check;
        check.swap(outstanding_);
        WriteCoordinator* c = coordinator_;
        l.unlock();
        std::vector<Outstanding> keep;
        for (auto& o : check) {
            const WriteView v = c ? c->status(o.who, o.requestId) : WriteView{};
            if (v.status == "ACCEPTED") {
                keep.push_back(std::move(o));
            } else if (v.status == "FAILED" || v.status == "TIMEOUT" || v.status == "REJECTED") {
                std::lock_guard<std::mutex> g(mu_);
                engine_->writeResult(o.rule, v.status);
                lastErrorCode_[o.rule] = v.code;
            }
        }
        l.lock();
        for (auto& o : keep) outstanding_.push_back(std::move(o));
        idleCv_.notify_all();
    }
}

void LogicSubsystem::handOver(Pending& p) {
    WriteCoordinator* c = nullptr;
    {
        std::lock_guard<std::mutex> g(qMu_);
        c = coordinator_;
    }
    const auto fail = [&](const std::string& result, const std::string& code) {
        std::lock_guard<std::mutex> g(mu_);
        engine_->writeResult(p.rule, result);
        lastErrorCode_[p.rule] = code;
    };
    // the edge first, durably: after a crash its id is never handed over again
    {
        std::lock_guard<std::mutex> g(mu_);
        const int64_t before = edges_.count(p.rule) ? edges_[p.rule] : 0;
        edges_[p.rule] = std::max(before, p.edgeId);
        std::string error;
        if (!persistState(error)) {
            edges_[p.rule] = before;
            logLine("logic: " + p.rule + ": cannot keep the edge (" + error + "): not sent");
            engine_->writeResult(p.rule, "FAILED");
            lastErrorCode_[p.rule] = "PERSIST_FAILED";
            return;
        }
    }
    if (!c) return fail("FAILED", "LOGIC_WRITER_MISSING");
    WriteCaller who;
    who.user = "logic:" + p.rule;
    who.role = "logic";
    who.source = "logic";
    who.sessionKey = "logic";
    who.channel = "logic";
    WriteRequest req;
    req.requestId = c->makeRequestId();
    req.tag = p.tag;
    req.value = writeValueOf(p.type, p.value);
    if (p.pulseMs > 0) req.pulseMs = p.pulseMs;
    req.logicJson = jsonText(
        json{{"rule", p.rule}, {"write", p.write}, {"edgeId", p.edgeId}, {"inputs", p.inputs}});
    const std::vector<WriteView> views = c->submit(who, {req});
    const WriteView& v = views.at(0);
    if (v.status == "REJECTED") return fail("REJECTED", v.code);
    if (v.status == "ACCEPTED") {
        std::lock_guard<std::mutex> g(qMu_);
        outstanding_.push_back({p.rule, req.requestId, who});
        return;
    }
    if (v.status == "FAILED" || v.status == "TIMEOUT") fail(v.status, v.code);
}

void LogicSubsystem::waitIdle() {
    std::unique_lock<std::mutex> l(qMu_);
    idleCv_.wait_for(l, std::chrono::seconds(10),
                     [this] { return qStop_ || (queue_.empty() && inFlight_ == 0); });
    // one pass over the commands that wait for a final result
    std::vector<Outstanding> check;
    check.swap(outstanding_);
    WriteCoordinator* c = coordinator_;
    l.unlock();
    std::vector<Outstanding> keep;
    for (auto& o : check) {
        const WriteView v = c ? c->status(o.who, o.requestId) : WriteView{};
        if (v.status == "ACCEPTED") {
            keep.push_back(std::move(o));
        } else if (v.status == "FAILED" || v.status == "TIMEOUT" || v.status == "REJECTED") {
            std::lock_guard<std::mutex> g(mu_);
            engine_->writeResult(o.rule, v.status);
            lastErrorCode_[o.rule] = v.code;
        }
    }
    l.lock();
    for (auto& o : keep) outstanding_.push_back(std::move(o));
}

void LogicSubsystem::loadState() {
    if (opt_.statePath.empty()) return;
    std::ifstream f(opt_.statePath);
    if (!f) return;
    std::stringstream ss;
    ss << f.rdbuf();
    const json j = json::parse(ss.str(), nullptr, false);
    if (j.is_discarded() || !j.is_object()) {
        logLine("logic: " + opt_.statePath + " không đọc được: coi như chưa có");
        return;
    }
    stopped_ = j.value("writesStopped", false);
    stoppedBy_ = j.contains("stoppedBy") && j["stoppedBy"].is_string()
                     ? j["stoppedBy"].get<std::string>()
                     : "";
    stoppedAt_ = j.contains("stoppedAtMs") && j["stoppedAtMs"].is_number_integer()
                     ? j["stoppedAtMs"].get<int64_t>()
                     : 0;
    if (j.contains("edges") && j["edges"].is_object())
        for (auto it = j["edges"].begin(); it != j["edges"].end(); ++it)
            if (it.value().is_number_integer()) edges_[it.key()] = it.value().get<int64_t>();
}

bool LogicSubsystem::persistState(std::string& error) {
    if (opt_.statePath.empty()) return true;
    json j = {{"schemaVersion", "1.0.0"}, {"writesStopped", stopped_}, {"edges", json::object()}};
    if (stopped_) {
        j["stoppedBy"] = stoppedBy_;
        j["stoppedAtMs"] = stoppedAt_;
        j["stoppedAt"] = isoAt(stoppedAt_, opt_.tzOffsetMin);
    }
    for (const auto& [rule, edge] : edges_) j["edges"][rule] = edge;
    return writeDurably(opt_.statePath, j.dump(2) + "\n", error);
}

std::vector<std::pair<std::string, RetainValue>> LogicSubsystem::retainDue(bool force) {
    std::lock_guard<std::mutex> g(mu_);
    const int64_t now = mono();
    if (!force && now - lastFlushMono_ < static_cast<int64_t>(opt_.flushS) * 1000) return {};
    lastFlushMono_ = now;
    const logic::RetainMap snap = engine_->retainSnapshot();
    std::vector<std::pair<std::string, RetainValue>> out;
    for (const auto& [key, v] : snap) {
        const auto it = flushed_.find(key);
        if (it != flushed_.end() && it->second == v) continue;
        out.emplace_back(key, logicRetainToStore(key, v));
    }
    flushed_ = snap;
    return out;
}

std::string LogicSubsystem::writesState() {
    std::lock_guard<std::mutex> g(mu_);
    return stopped_ ? "stopped" : opt_.writes;
}

json LogicSubsystem::status() {
    std::lock_guard<std::mutex> g(mu_);
    const int64_t now = mono();
    const int64_t wnow = wall();
    std::vector<double> w = scanMsWindow_;
    double p99 = 0;
    if (!w.empty()) {
        std::sort(w.begin(), w.end());
        p99 = w[std::min(w.size() - 1, static_cast<size_t>(std::ceil(w.size() * 0.99)) - 1)];
    }
    const auto round1 = [](double x) { return std::round(x * 100) / 100; };
    json body = {{"enabled", true},
                 {"writes",
                  {{"configured", opt_.writes},
                   {"runtimeEnabled", opt_.writes == "on" && !stopped_},
                   {"stopped", stopped_},
                   {"stoppedBy", stopped_ ? json(stoppedBy_) : json(nullptr)},
                   {"perMinute", engine_->writesLastMinute(now)},
                   {"limitPerMinute", opt_.maxWritesPerMin}}},
                 {"scan",
                  {{"periodMs", opt_.scanMs},
                   {"lastMs", round1(lastScanMs_)},
                   {"p99Ms", round1(p99)},
                   {"overrun", overruns_}}},
                 {"retainLost", retainLost_},
                 {"blocks", json::array()}};
    std::map<std::string, std::vector<std::string>> outsByBlock;
    for (const auto& [tag, def] : engine_->outputTags()) outsByBlock[def.block].push_back(tag);
    for (const std::string& id : engine_->blockIds()) {
        const auto st = engine_->state(id);
        if (!st) continue;
        json b = {{"id", id},
                  {"kind", st->kind},
                  {"state", st->state},
                  {"reason", st->reason.empty() ? json(nullptr) : json(st->reason)}};
        if (st->isRule) {
            b["edgeId"] = st->edgeId;
            b["fired"] = st->fired;
            b["stable"] = st->stable ? json(*st->stable) : json(nullptr);
            b["lastFired"] = st->lastFiredMono
                                 ? json(isoAt(wnow - (now - *st->lastFiredMono), opt_.tzOffsetMin))
                                 : json(nullptr);
            b["lastError"] = st->lastError ? json(*st->lastError) : json(nullptr);
            const auto c = lastErrorCode_.find(id);
            b["lastErrorCode"] = c != lastErrorCode_.end() ? json(c->second) : json(nullptr);
        }
        if (st->hasDegraded) b["degraded"] = st->degraded;
        if (st->hasOverflow) b["overflow"] = st->overflow;
        const auto outs = outsByBlock.find(id);
        if (outs != outsByBlock.end()) {
            json o = json::object();
            for (const std::string& t : outs->second) {
                const logic::Output* v = engine_->output(t);
                o[t] = v ? scalarJson(v->value) : json(nullptr);
            }
            b["outputs"] = o;
        }
        body["blocks"].push_back(b);
    }
    return body;
}

bool LogicSubsystem::stopWrites(const WriteCaller& who, std::string& code) {
    std::lock_guard<std::mutex> g(mu_);
    if (stopped_) return true;  // already stopped: nothing changes
    stopped_ = true;
    stoppedBy_ = who.user;
    stoppedAt_ = wall();
    std::string error;
    if (!persistState(error)) {
        stopped_ = false;
        stoppedBy_.clear();
        code = "PERSIST_FAILED";
        logLine("logic: cannot keep the stop of the writes: " + error);
        return false;
    }
    engine_->setWritesOn(false);
    if (opt_.audit) {
        AuditEvent e(AuditAction::LogicWritesDisabled, AuditResult::Ok,
                     who.channel == "web" ? AuditChannel::Web : AuditChannel::Https,
                     who.source.empty() ? "system" : who.source);
        e.user = who.user;
        if (!who.role.empty()) e.role = who.role;
        e.detail = jsonText(json{{"configured", opt_.writes}});
        try {
            opt_.audit(e);
        } catch (const std::exception& ex) {
            logLine(std::string("logic: audit logic.writes.disabled: ") + ex.what());
        }
    }
    updateWarningsLocked(mono());
    return true;
}

bool LogicSubsystem::reset(const std::string& id, double value, const WriteCaller& who,
                           std::string& code) {
    std::lock_guard<std::mutex> g(mu_);
    const auto st = engine_->state(id);
    if (!st) return code = "NO_SUCH_BLOCK", false;
    if (st->kind != "counter" && st->kind != "totalizer" && st->kind != "runhours")
        return code = "NOT_RESETTABLE", false;
    if (opt_.audit) {  // durable before the change (the API refuses without an audit log)
        AuditEvent e(AuditAction::LogicReset, AuditResult::Ok,
                     who.channel == "web" ? AuditChannel::Web : AuditChannel::Https,
                     who.source.empty() ? "system" : who.source);
        e.user = who.user;
        if (!who.role.empty()) e.role = who.role;
        e.target = id;
        e.detail = jsonText(json{{"kind", st->kind}, {"value", value}});
        opt_.audit(e);  // throws AuditUnavailable: nothing changes
    }
    if (!engine_->reset(id, value)) return code = "NOT_RESETTABLE", false;
    return true;
}

}  // namespace mat
