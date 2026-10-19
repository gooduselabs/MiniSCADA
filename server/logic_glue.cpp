#include "server/logic_glue.hpp"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
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
    : model_(model), opt_(std::move(options)), retainLost_(retainLost) {
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
    applyWritesReset();  // a request left while the runtime was down (root, --logic-writes-reset)
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
    engine_ = std::make_unique<logic::Engine>(doc, eo);
    for (const std::string& tag : engine_->tags()) {  // T148: the model index of each slot
        const auto it = index_.find(tag);
        slotModel_.push_back(it != index_.end() ? static_cast<int64_t>(it->second) : -1);
        slotPublish_.push_back(it != index_.end() && engine_->outputTags().count(tag) > 0);
    }
    hasWrites_ = !logic::blocksOf(doc, "writes").empty() ||
                 (doc.contains("writes") && doc["writes"].is_array() && !doc["writes"].empty());
    for (const json* r : logic::blocksOf(doc, "rules")) {
        const std::string id = logic::blockId(*r);
        ruleInputs_[id] = engine_->inputsOf(id);
    }
    flushed_ = engine_->retainSnapshot();
    lastFlushMono_ = mono();
    lastResetPoll_ = lastFlushMono_;
    {
        std::lock_guard<std::mutex> g(mu_);
        if (retainLost_) {
            if (opt_.warnings)
                opt_.warnings->set("LOGIC_RETAIN_LOST", json{{"blocks", flushed_.size()}});
            auditLocked(AuditAction::LogicRetainLost, AuditResult::Failed, "system", "", "",
                        json{{"keys", flushed_.size()}});
        }
        if (stopped_ && stopReason_ == "STATE_UNREADABLE")  // T062: the runtime stopped them
            auditLocked(AuditAction::LogicWritesDisabled, AuditResult::Ok, "system", "", "",
                        json{{"reason", stopReason_}, {"configured", opt_.writes}});
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
    static const std::string kStopped = "stopped", kOn = "on";
    const bool hasWrites = hasWrites_;
    const std::string& state = stopped_ ? kStopped : opt_.writes;
    if (hasWrites && state != "on") {
        if (writesKey_ != state)
            opt_.warnings->set("LOGIC_WRITES_OFF",
                               json{{"writes", state},
                                    {"stoppedBy", stopped_ ? json(stoppedBy_) : json(nullptr)},
                                    {"reason", stopped_ && !stopReason_.empty() ? json(stopReason_)
                                                                                : json(nullptr)}});
    } else if (!writesKey_.empty() && writesKey_ != "on") {
        opt_.warnings->clear("LOGIC_WRITES_OFF");
    }
    const std::string& key = hasWrites ? state : kOn;
    if (writesKey_ != key) writesKey_ = key;
    const std::vector<std::string> throttled = engine_->throttledRules(now);
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
        // T148: a round a little before the due time (the loop's clock is not this one) scans
        if (nextScan_ && now < *nextScan_ - kLogicScanEarlyMs) return;
        const auto t0 = std::chrono::steady_clock::now();
        logic::WallClock wc;
        wc.epochMs = wall();
        wc.synced = opt_.timeSynced ? opt_.timeSynced() : true;
        const logic::ReadTag read = [&](const std::string& id) { return readTag(io, id); };
        // T148: the snapshot by slot, no lookup by name
        const logic::ReadAt readAt = [&](size_t slot) {
            const int64_t idx = slotModel_[slot];
            if (idx >= 0) return io.read(static_cast<size_t>(idx));
            expr::InputValue v;
            v.quality = Quality::BAD;
            v.reason = "NO_VALUE";
            return v;
        };
        // T148: a Tag whose version did not move since the last scan is not read again
        const logic::VersionAt versionAt = [&](size_t slot) -> uint64_t {
            const int64_t idx = slotModel_[slot];
            return idx >= 0 ? io.version(static_cast<size_t>(idx)) : 0;
        };
        const std::vector<logic::ActionOut> actions = engine_->step(now, readAt, wc, versionAt);
        const auto t1 = std::chrono::steady_clock::now();
        // only the logic Tags that changed (the Tag Engine ignores an unchanged one anyway)
        engine_->takeChanged([&](size_t slot, const std::string&, const logic::Output& o) {
            if (!slotPublish_[slot]) return;
            io.publish(static_cast<size_t>(slotModel_[slot]), o.value,
                       o.good ? Quality::GOOD : Quality::BAD, o.reason);
        });
        const auto t2 = std::chrono::steady_clock::now();
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
        const auto t3 = std::chrono::steady_clock::now();
        updateWarningsLocked(now);
        const auto t4 = std::chrono::steady_clock::now();
        const auto span = [](auto a, auto b) {
            return std::chrono::duration<double, std::milli>(b - a).count();
        };
        const double ms = span(t0, t4);
        profile_.engineMs = span(t0, t1);
        profile_.publishMs = span(t1, t2);
        profile_.actionsMs = span(t2, t3);
        profile_.warningsMs = span(t3, t4);
        profile_.totalMs = ms;
        ++profile_.scans;
        ++scans_;
        if (lastScanAt_) {
            scanIntervals_.push_back(now - *lastScanAt_);
            if (scanIntervals_.size() > 100) scanIntervals_.pop_front();
        }
        lastScanAt_ = now;
        lastScanMs_ = ms;
        scanMsWindow_.push_back(ms);
        if (scanMsWindow_.size() > 100) scanMsWindow_.pop_front();
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
        if (!opt_.writesResetRequestPath.empty()) {  // mat-runtime --logic-writes-reset (root)
            const int64_t now = mono();
            if (now - lastResetPoll_ >= kLogicWritesResetPollMs) {
                lastResetPoll_ = now;
                l.unlock();
                applyWritesReset();
                l.lock();
                if (qStop_) break;
            }
        }
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
    // the edge first, durably: after a crash its id is never handed over again. The file is
    // written outside mu_: the round of the Tag Engine goes on meanwhile (T062).
    {
        std::lock_guard<std::mutex> s(stateMu_);
        int64_t before = 0;
        std::string text;
        {
            std::lock_guard<std::mutex> g(mu_);
            before = edges_.count(p.rule) ? edges_[p.rule] : 0;
            edges_[p.rule] = std::max(before, p.edgeId);
            text = stateTextLocked(stopped_);
        }
        std::string error;
        if (!writeState(text, error)) {
            std::lock_guard<std::mutex> g(mu_);
            if (edges_[p.rule] == std::max(before, p.edgeId)) edges_[p.rule] = before;
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
    {  // T062: an administrator stop since the scan holds this command too
        std::lock_guard<std::mutex> g(mu_);
        if (stopped_ || opt_.writes != "on") {
            const std::string code = stopped_ ? "LOGIC_WRITES_STOPPED" : "LOGIC_WRITES_OFF";
            engine_->writeResult(p.rule, "SUPPRESSED");
            lastErrorCode_[p.rule] = code;
            auditLocked(AuditAction::LogicWriteSuppressed, AuditResult::Denied, who.user, p.tag,
                        code,
                        json{{"rule", p.rule},
                             {"write", p.write},
                             {"edgeId", p.edgeId},
                             {"value", scalarJson(p.value)}});
            return;
        }
        handingOver_ = true;  // T202 (N-L1): stopWrites() waits until it is back
    }
    std::vector<WriteView> views;
    try {
        views = c->submit(who, {req});
    } catch (...) {
        std::lock_guard<std::mutex> g(mu_);
        handingOver_ = false;
        handCv_.notify_all();
        throw;
    }
    {
        std::lock_guard<std::mutex> g(mu_);
        handingOver_ = false;
    }
    handCv_.notify_all();
    const WriteView& v = views.at(0);
    if (v.status == "REJECTED") return fail("REJECTED", v.code);
    if (v.status == "ACCEPTED") {
        std::lock_guard<std::mutex> g(qMu_);
        outstanding_.push_back({p.rule, req.requestId, who});
        return;
    }
    if (v.status == "FAILED" || v.status == "TIMEOUT") fail(v.status, v.code);
}

void LogicSubsystem::dropQueued() {
    std::deque<std::unique_ptr<Pending>> dropped;
    {
        std::lock_guard<std::mutex> g(qMu_);
        dropped.swap(queue_);
    }
    if (dropped.empty()) return;
    {
        std::lock_guard<std::mutex> g(mu_);
        for (const auto& p : dropped) {
            engine_->writeResult(p->rule, "SUPPRESSED");
            lastErrorCode_[p->rule] = "LOGIC_WRITES_STOPPED";
            auditLocked(AuditAction::LogicWriteSuppressed, AuditResult::Denied, "logic:" + p->rule,
                        p->tag, "LOGIC_WRITES_STOPPED",
                        json{{"rule", p->rule},
                             {"write", p->write},
                             {"edgeId", p->edgeId},
                             {"value", scalarJson(p->value)},
                             {"queued", true}});
        }
    }
    idleCv_.notify_all();
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
    struct stat st {};
    if (::stat(opt_.statePath.c_str(), &st) != 0 && errno == ENOENT) return;  // a first start
    // T062: a file that is there but cannot be read must not cancel an administrator stop: the
    // writes start stopped, cleared only by root (--logic-writes-reset).
    const auto unreadable = [&](const std::string& why) {
        logLine("logic: " + opt_.statePath + " không đọc được (" + why +
                "): ghi PLC từ logic dừng đến khi root chạy mat-runtime --logic-writes-reset");
        stopped_ = true;
        stoppedBy_ = "system";
        stoppedAt_ = wall();
        stopReason_ = "STATE_UNREADABLE";
        edges_.clear();
    };
    std::ifstream f(opt_.statePath);
    if (!f) return unreadable("không mở được");
    std::stringstream ss;
    ss << f.rdbuf();
    if (f.bad()) return unreadable("lỗi đọc");
    const json j = json::parse(ss.str(), nullptr, false);
    if (j.is_discarded() || !j.is_object()) return unreadable("không phải JSON object");
    const auto ws = j.find("writesStopped");
    if (ws != j.end() && !ws->is_boolean()) return unreadable("writesStopped không phải boolean");
    stopped_ = ws != j.end() && ws->get<bool>();
    stoppedBy_ = j.contains("stoppedBy") && j["stoppedBy"].is_string()
                     ? j["stoppedBy"].get<std::string>()
                     : "";
    stoppedAt_ = j.contains("stoppedAtMs") && j["stoppedAtMs"].is_number_integer()
                     ? j["stoppedAtMs"].get<int64_t>()
                     : 0;
    if (stopped_ && j.contains("stopReason") && j["stopReason"].is_string())
        stopReason_ = j["stopReason"].get<std::string>();
    if (j.contains("edges") && j["edges"].is_object())
        for (auto it = j["edges"].begin(); it != j["edges"].end(); ++it)
            if (it.value().is_number_integer()) edges_[it.key()] = it.value().get<int64_t>();
}

std::string LogicSubsystem::stateTextLocked(bool stopped) const {
    json j = {{"schemaVersion", "1.0.0"}, {"writesStopped", stopped}, {"edges", json::object()}};
    if (stopped) {
        j["stoppedBy"] = stoppedBy_;
        j["stoppedAtMs"] = stoppedAt_;
        j["stoppedAt"] = isoAt(stoppedAt_, opt_.tzOffsetMin);
        if (!stopReason_.empty()) j["stopReason"] = stopReason_;
    }
    for (const auto& [rule, edge] : edges_) j["edges"][rule] = edge;
    return j.dump(2) + "\n";
}

bool LogicSubsystem::writeState(const std::string& text, std::string& error) {
    if (opt_.statePath.empty()) return true;
    if (opt_.writeState) return opt_.writeState(opt_.statePath, text, error);
    return writeDurably(opt_.statePath, text, error);
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

json LogicSubsystem::statusHeadLocked(int64_t now) const {
    std::vector<double> w(scanMsWindow_.begin(), scanMsWindow_.end());
    double interval = 0;
    for (int64_t x : scanIntervals_) interval += static_cast<double>(x);
    if (!scanIntervals_.empty()) interval /= static_cast<double>(scanIntervals_.size());
    double p99 = 0;
    if (!w.empty()) {
        std::sort(w.begin(), w.end());
        p99 = w[std::min(w.size() - 1, static_cast<size_t>(std::ceil(w.size() * 0.99)) - 1)];
    }
    const auto round1 = [](double x) { return std::round(x * 100) / 100; };
    return {{"enabled", true},
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
              {"overrun", overruns_},
              {"scans", scans_},
              {"intervalMs", round1(interval)}}},
            {"retainLost", retainLost_},
            {"blocks", json::array()}};
}

template <class F>
void LogicSubsystem::forEachBlockLocked(int64_t now, int64_t wnow, F&& fn) const {
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
        fn(std::move(b));
    }
}

json LogicSubsystem::status() {
    std::lock_guard<std::mutex> g(mu_);
    const int64_t now = mono();
    const int64_t wnow = wall();
    json body = statusHeadLocked(now);
    json& blocks = body["blocks"];
    forEachBlockLocked(now, wnow, [&blocks](json b) { blocks.push_back(std::move(b)); });
    return body;
}

std::string LogicSubsystem::statusText() {
    std::lock_guard<std::mutex> g(mu_);
    const int64_t now = mono();
    const int64_t wnow = wall();
    // the keys of an object are written in order: "blocks" comes first, the head follows it
    const std::string head = jsonText(statusHeadLocked(now));
    static const std::string kEmpty = "{\"blocks\":[]";
    if (head.compare(0, kEmpty.size(), kEmpty) != 0) {  // never: the keys above are fixed
        json body = statusHeadLocked(now);
        json& blocks = body["blocks"];
        forEachBlockLocked(now, wnow, [&blocks](json b) { blocks.push_back(std::move(b)); });
        return jsonText(body);
    }
    std::string text = "{\"blocks\":[";
    text.reserve(lastStatusBytes_ + 64);
    bool first = true;
    forEachBlockLocked(now, wnow, [&](json b) {
        if (!first) text += ',';
        first = false;
        text += jsonText(b);
    });
    text += ']';
    text.append(head, kEmpty.size(), std::string::npos);
    lastStatusBytes_ = text.size();
    return text;
}

bool LogicSubsystem::applyWritesReset() {
    const std::string& path = opt_.writesResetRequestPath;
    if (path.empty()) return false;
    struct stat st {};
    if (::lstat(path.c_str(), &st) != 0) return false;
    // a link or anything else, a file of another owner than root, a file others may read or
    // write: removed, never followed nor taken (T062)
    if (!S_ISREG(st.st_mode) || st.st_uid != opt_.writesResetUid || (st.st_mode & 077) != 0) {
        ::unlink(path.c_str());
        logLine("logic: " + path + " không phải tệp thường của root, quyền 0600: đã xóa, bỏ qua");
        return false;
    }
    std::lock_guard<std::mutex> s(stateMu_);
    // T202 (N-L4): the rows of one request are written once, however often it is tried again
    const ResetRequestKey key{static_cast<uint64_t>(st.st_ino), static_cast<uint64_t>(st.st_size),
                              static_cast<int64_t>(st.st_mtime)};
    if (!(key == resetAudited_)) {
        resetAudited_ = key;
        resetStartedAudited_ = false;
        resetFailedAudited_ = false;
    }
    bool wasStopped = false;
    std::string by, reason, text;
    {
        std::lock_guard<std::mutex> g(mu_);
        wasStopped = stopped_;
        by = stoppedBy_;
        reason = stopReason_;
        if (wasStopped) text = stateTextLocked(false);
    }
    json d = {{"source", "cli"},
              {"wasStopped", wasStopped},
              {"stoppedBy", wasStopped ? json(by) : json(nullptr)},
              {"configured", opt_.writes}};
    if (!reason.empty()) d["stopReason"] = reason;
    const auto record = [&](AuditResult result, const std::string& code, const json& detail) {
        AuditEvent e(AuditAction::LogicWritesEnabled, result, AuditChannel::System, "system");
        e.user = "system";
        if (!code.empty()) e.code = code;
        e.detail = jsonText(detail);
        opt_.audit(e);
    };
    // the audit record first, durably (T062): without it nothing changes, the request stays
    if (opt_.audit && !resetStartedAudited_) {
        try {
            record(AuditResult::Started, "", d);
        } catch (const std::exception& ex) {
            logLine(std::string("logic: audit logic.writes.enabled không ghi được (") + ex.what() +
                    "): chưa bỏ lệnh dừng, thử lại sau");
            return false;
        }
        resetStartedAudited_ = true;
    }
    if (wasStopped) {
        std::string error;
        if (!writeState(text, error)) {  // the request stays: tried again at the next poll
            logLine("logic: không bỏ được lệnh dừng ghi (" + error + "): thử lại sau");
            if (opt_.audit && !resetFailedAudited_) {
                json f = d;
                f["error"] = error;
                try {
                    record(AuditResult::Failed, "PERSIST_FAILED", f);
                    resetFailedAudited_ = true;
                } catch (const std::exception& ex) {
                    logLine(std::string("logic: audit logic.writes.enabled (failed): ") +
                            ex.what());
                }
            }
            return false;
        }
    }
    {
        std::lock_guard<std::mutex> g(mu_);
        if (wasStopped) {
            stopped_ = false;
            stoppedBy_.clear();
            stoppedAt_ = 0;
            stopReason_.clear();
            if (engine_) engine_->setWritesOn(opt_.writes == "on");
        }
        if (engine_) updateWarningsLocked(mono());
    }
    if (opt_.audit) {
        try {
            record(AuditResult::Ok, "", d);
        } catch (const std::exception& ex) {  // the change is made: the started row tells of it
            logLine(std::string("logic: audit logic.writes.enabled (ok): ") + ex.what());
        }
    }
    resetAudited_ = {};
    resetStartedAudited_ = false;
    resetFailedAudited_ = false;
    ::unlink(path.c_str());
    logLine(wasStopped ? "logic: root đã bỏ lệnh dừng ghi PLC (logic.writes = " + opt_.writes + ")"
                       : "logic: yêu cầu --logic-writes-reset: ghi chưa bị dừng, không đổi gì");
    return true;
}

bool LogicSubsystem::stopWrites(const WriteCaller& who, std::string& code) {
    {
        std::lock_guard<std::mutex> s(stateMu_);
        std::string text;
        {
            // at once in memory: the next scan, the command being handed over and the queue
            // send nothing from here on (T062)
            std::lock_guard<std::mutex> g(mu_);
            if (stopped_) return true;  // already stopped: nothing changes
            stopped_ = true;
            stoppedBy_ = who.user;
            stoppedAt_ = wall();
            stopReason_.clear();
            engine_->setWritesOn(false);
            text = stateTextLocked(true);
        }
        std::string error;
        if (!writeState(text, error)) {
            std::lock_guard<std::mutex> g(mu_);
            stopped_ = false;
            stoppedBy_.clear();
            stoppedAt_ = 0;
            engine_->setWritesOn(opt_.writes == "on");
            code = "PERSIST_FAILED";
            logLine("logic: cannot keep the stop of the writes: " + error);
            return false;
        }
    }
    // T202 (N-L1): a command that passed the last check before the stop is being handed to the
    // coordinator: the answer waits for it, so that nothing of logic is handed over after it
    bool handOverPending = false;
    {
        std::unique_lock<std::mutex> l(mu_);
        handOverPending = !handCv_.wait_for(l, std::chrono::milliseconds(opt_.stopWaitMs),
                                            [this] { return !handingOver_; });
    }
    if (handOverPending)
        logLine(
            "logic: writes stopped; a command handed to the coordinator before the stop has "
            "not come back after " +
            std::to_string(opt_.stopWaitMs) + " ms");
    if (opt_.audit) {
        AuditEvent e(AuditAction::LogicWritesDisabled, AuditResult::Ok,
                     who.channel == "web" ? AuditChannel::Web : AuditChannel::Https,
                     who.source.empty() ? "system" : who.source);
        e.user = who.user;
        if (!who.role.empty()) e.role = who.role;
        json d = {{"configured", opt_.writes}};
        if (handOverPending) d["handOverPending"] = true;
        e.detail = jsonText(d);
        try {
            opt_.audit(e);
        } catch (const std::exception& ex) {
            logLine(std::string("logic: audit logic.writes.disabled: ") + ex.what());
        }
    }
    dropQueued();
    std::lock_guard<std::mutex> g(mu_);
    updateWarningsLocked(mono());
    return true;
}

bool LogicSubsystem::reset(const std::string& id, double value, const WriteCaller& who,
                           std::string& code) {
    std::string kind;
    {
        std::lock_guard<std::mutex> g(mu_);
        const auto st = engine_->state(id);
        if (!st) return code = "NO_SUCH_BLOCK", false;
        if (st->kind != "counter" && st->kind != "totalizer" && st->kind != "runhours")
            return code = "NOT_RESETTABLE", false;
        kind = st->kind;
    }
    // durable before the change (the API refuses without an audit log); outside mu_, so its fsync
    // never holds up the Tag Engine round (T202 N-L5, as T062 for logic-state.json)
    if (opt_.audit) {
        AuditEvent e(AuditAction::LogicReset, AuditResult::Ok,
                     who.channel == "web" ? AuditChannel::Web : AuditChannel::Https,
                     who.source.empty() ? "system" : who.source);
        e.user = who.user;
        if (!who.role.empty()) e.role = who.role;
        e.target = id;
        e.detail = jsonText(json{{"kind", kind}, {"value", value}});
        opt_.audit(e);  // throws AuditUnavailable: nothing changes
    }
    std::lock_guard<std::mutex> g(mu_);
    if (!engine_->reset(id, value)) return code = "NOT_RESETTABLE", false;
    return true;
}

}  // namespace mat
