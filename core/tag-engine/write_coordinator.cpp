#include "core/tag-engine/write_coordinator.hpp"

#include <time.h>

#include <algorithm>
#include <cerrno>
#include <cfloat>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <random>
#include <thread>

#include "core/common/thread_name.hpp"
#include "nlohmann/json.hpp"

namespace mat {

namespace {

constexpr size_t kNpos = static_cast<size_t>(-1);
constexpr int64_t kMaxExactDouble = 9007199254740992LL;  // 2^53
constexpr int64_t kQuiesceCapMs = 25000;
constexpr int64_t kAuditDrainMs = 10000;

int64_t systemMono() {
    timespec ts{};
    ::clock_gettime(CLOCK_BOOTTIME, &ts);
    return static_cast<int64_t>(ts.tv_sec) * 1000 + static_cast<int64_t>(ts.tv_nsec) / 1000000;
}

int64_t systemWall() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

std::string doubleText(double d) {
    if (!std::isfinite(d)) return "null";
    if (d == std::floor(d) && std::fabs(d) < 1e15) return std::to_string(static_cast<int64_t>(d));
    return nlohmann::json(d).dump();
}

std::string int64Json(int64_t v) {
    if (v > kMaxExactDouble || v < -kMaxExactDouble) return "\"" + std::to_string(v) + "\"";
    return std::to_string(v);
}

std::string uint64Json(uint64_t v) {
    if (v > static_cast<uint64_t>(kMaxExactDouble)) return "\"" + std::to_string(v) + "\"";
    return std::to_string(v);
}

// A TagScalar as JSON text, 64-bit integers beyond 2^53 as strings (as the live protocol does).
std::string scalarJson(const TagScalar& v) {
    if (const bool* b = std::get_if<bool>(&v)) return *b ? "true" : "false";
    if (const int64_t* i = std::get_if<int64_t>(&v)) return int64Json(*i);
    if (const uint64_t* u = std::get_if<uint64_t>(&v)) return uint64Json(*u);
    if (const double* d = std::get_if<double>(&v)) return doubleText(*d);
    if (const std::string* s = std::get_if<std::string>(&v)) return nlohmann::json(*s).dump();
    return "null";
}

// ^[a-z][a-z0-9_-]{0,63}$ (device-api-1.2 §6): a field of another shape is dropped, not refused.
bool isContextId(const std::string& s) {
    if (s.empty() || s.size() > 64 || s[0] < 'a' || s[0] > 'z') return false;
    for (const char c : s)
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-'))
            return false;
    return true;
}

std::string contextJsonOf(const WriteContext& c) {
    nlohmann::json j = nlohmann::json::object();
    if (isContextId(c.screen)) j["screen"] = c.screen;
    if (isContextId(c.widget)) j["widget"] = c.widget;
    return j.empty() ? "" : j.dump();
}

bool isIntegerType(TagType t) {
    return t == TagType::INT16 || t == TagType::UINT16 || t == TagType::INT32 ||
           t == TagType::UINT32 || t == TagType::INT64 || t == TagType::UINT64;
}
bool isSignedType(TagType t) {
    return t == TagType::INT16 || t == TagType::INT32 || t == TagType::INT64;
}

// An integer as sign and magnitude: it covers -(2^64 - 1) .. 2^64 - 1, so every INT64 and UINT64
// value is held exactly and compared without a double.
struct Big {
    bool neg = false;
    uint64_t mag = 0;
};

// -1, 0, 1: v against a limit that is a double.
int cmpBigDouble(const Big& v, double b) {
    constexpr double k2p64 = 18446744073709551616.0;
    if (b >= k2p64) return -1;
    if (b <= -k2p64) return 1;
    const bool vNeg = v.neg && v.mag != 0;
    const bool bNeg = b < 0;
    if (vNeg != bNeg) return vNeg ? -1 : 1;
    const double babs = std::fabs(b);
    const double fl = std::floor(babs);
    const uint64_t bi = static_cast<uint64_t>(fl);
    const bool frac = babs > fl;
    int c;  // magnitude of v against magnitude of b
    if (v.mag < bi)
        c = -1;
    else if (v.mag > bi)
        c = 1;
    else
        c = frac ? -1 : 0;
    return vNeg ? -c : c;
}

bool fitsType(TagType t, const Big& v) {
    const bool neg = v.neg && v.mag != 0;
    switch (t) {
        case TagType::INT16:
            return neg ? v.mag <= 32768 : v.mag <= 32767;
        case TagType::UINT16:
            return !neg && v.mag <= 65535;
        case TagType::INT32:
            return neg ? v.mag <= 2147483648ULL : v.mag <= 2147483647ULL;
        case TagType::UINT32:
            return !neg && v.mag <= 4294967295ULL;
        case TagType::INT64:
            return neg ? v.mag <= 9223372036854775808ULL : v.mag <= 9223372036854775807ULL;
        case TagType::UINT64:
            return !neg;
        default:
            return false;
    }
}

TagScalar bigScalar(TagType t, const Big& v) {
    if (isSignedType(t)) {
        if (v.neg && v.mag != 0)
            return v.mag == 9223372036854775808ULL ? INT64_MIN : -static_cast<int64_t>(v.mag);
        return static_cast<int64_t>(v.mag);
    }
    return v.mag;
}

double bigDouble(const Big& v) {
    const double m = static_cast<double>(v.mag);
    return v.neg ? -m : m;
}

enum class Parse { Ok, BadType, NotFinite, OutOfType };

// The number the client meant: sign and magnitude when it is an integer, a double otherwise.
struct Num {
    bool isInt = false;
    Big big;
    double d = 0;
};

Parse parseText(const std::string& s, Num& out) {
    if (s.empty() || s.size() > 64) return Parse::BadType;
    size_t i = 0;
    bool neg = false;
    if (s[0] == '+' || s[0] == '-') {
        neg = s[0] == '-';
        i = 1;
    }
    std::string rest = s.substr(i);
    std::string lower;
    for (char c : rest) lower += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    if (lower == "nan" || lower == "inf" || lower == "infinity") return Parse::NotFinite;
    size_t k = 0;
    while (k < rest.size() && rest[k] >= '0' && rest[k] <= '9') ++k;
    if (k == 0) return Parse::BadType;
    if (k == rest.size()) {  // digits only: an integer, exact
        uint64_t mag = 0;
        for (char c : rest) {
            const uint64_t digit = static_cast<uint64_t>(c - '0');
            if (mag > (UINT64_MAX - digit) / 10) {  // beyond 64 bits
                out.isInt = false;
                out.d = std::strtod(s.c_str(), nullptr);
                return std::isfinite(out.d) ? Parse::Ok
                                            : Parse::NotFinite;  // a float Tag can still take it
            }
            mag = mag * 10 + digit;
        }
        out.isInt = true;
        out.big = {neg, mag};
        return Parse::Ok;
    }
    // decimal: digits [. digits] [e [+-] digits]
    size_t p = k;
    if (p < rest.size() && rest[p] == '.') {
        size_t q = p + 1;
        while (q < rest.size() && rest[q] >= '0' && rest[q] <= '9') ++q;
        if (q == p + 1) return Parse::BadType;
        p = q;
    }
    if (p < rest.size() && (rest[p] == 'e' || rest[p] == 'E')) {
        size_t q = p + 1;
        if (q < rest.size() && (rest[q] == '+' || rest[q] == '-')) ++q;
        size_t digits = q;
        while (q < rest.size() && rest[q] >= '0' && rest[q] <= '9') ++q;
        if (q == digits) return Parse::BadType;
        p = q;
    }
    if (p != rest.size()) return Parse::BadType;
    errno = 0;
    out.d = std::strtod(s.c_str(), nullptr);
    out.isInt = false;
    if (!std::isfinite(out.d)) return Parse::NotFinite;
    return Parse::Ok;
}

}  // namespace

std::string WriteValue::json() const {
    switch (kind) {
        case Kind::Bool:
            return b ? "true" : "false";
        case Kind::Int:
            return int64Json(i);
        case Kind::Uint:
            return uint64Json(u);
        case Kind::Float:
            return doubleText(d);
        case Kind::Text:
            return nlohmann::json(s).dump();
        case Kind::None:
            break;
    }
    return "null";
}

// ---- entries ----

struct WriteCoordinator::Entry {
    enum class Phase { Rejected, Accepted, Done } phase = Phase::Rejected;
    WriteView view;
    WriteCaller who;
    WriteRecord record;
    uint64_t internalId = 0;
    size_t channelKey = kNpos;
    TagType tagType = TagType::FLOAT64;
    int64_t atMono = 0;  // receipt, then the end: what the time-to-live counts from
    // Feature 007: a pulse. stage 0 first write sent, 1 waiting for the end of the pulse, 2 the
    // opposite write sent.
    int64_t pulseMs = 0;
    int stage = 0;
    size_t tagIdx = 0;
    TagScalar releaseRaw;
    int64_t deadlineMs = 5000;
    bool readback = true;
    // Feature 011: the journal holds an `arm` for this pulse; tries of the release a full driver
    // queue refused (FR-020: rescheduled, never slept on).
    bool armed = false;
    int releaseTries = 0;
};

// Feature 011 (FR-019): a pulse whose release the runtime still owes: an entry the journal held
// armed at start, or a release that failed in this run. Pending: tried every pulseRetryMs until
// its deadline. Stuck: the window is over (or pulseRecovery is off, or the Tag is gone): kept in
// the journal, reported as PULSE_STUCK. Dormant: the first write timed out (the bit may be on):
// kept in the journal, nothing is tried in this run (as in 007), released at the next start. A
// confirmed release of a later pulse of the same Tag closes a Stuck or Dormant entry.
struct WriteCoordinator::Recovery {
    enum class State { Pending, Stuck, Dormant } state = State::Pending;
    PulseArm arm;
    bool known = false;  // a writable BOOL Tag of the model
    size_t tagIdx = 0;
    WriteCaller who;
    int64_t deadline = 0;
    int64_t nextTry = 0;
    bool inFlight = false;
    uint64_t internalId = 0;
    bool started = false;  // its record of receipt is in the audit
    WriteRecord record;
    int attempts = 0;
    std::string lastCode;
};

struct WriteCoordinator::Checked {
    TagScalar eng;
    TagScalar raw;
    bool hasRaw = false;
};

WriteCoordinator::WriteCoordinator(const ProjectModel& model, const TagStore& store,
                                   WriteBackend& backend, WriteAudit& audit,
                                   CoordinatorOptions options)
    : model_(model),
      store_(store),
      backend_(backend),
      audit_(audit),
      opt_(std::move(options)),
      limiter_(opt_.rate, [this] { return mono(); }) {
    auditThread_ = std::thread([this] {
        setThreadName("mat-wr-audit");
        auditThread();
    });
    pulseThread_ = std::thread([this] {
        setThreadName("mat-wr-pulse");
        pulseThread();
    });
}

WriteCoordinator::~WriteCoordinator() {
    {
        std::lock_guard<std::mutex> g(mu_);
        pulseStop_ = true;
    }
    pulseCv_.notify_all();
    if (pulseThread_.joinable()) pulseThread_.join();
    waitAuditIdle();
    {
        std::lock_guard<std::mutex> g(auditMu_);
        auditStop_ = true;
    }
    auditCv_.notify_all();
    if (auditThread_.joinable()) auditThread_.join();
}

int64_t WriteCoordinator::mono() const { return opt_.monoMs ? opt_.monoMs() : systemMono(); }
int64_t WriteCoordinator::wall() const { return opt_.wallMs ? opt_.wallMs() : systemWall(); }

// ---- the audit thread ----

void WriteCoordinator::postAudit(std::function<void()> job) {
    {
        std::lock_guard<std::mutex> g(auditMu_);
        auditQueue_.push_back(std::move(job));
    }
    auditCv_.notify_all();
}

void WriteCoordinator::auditThread() {
    std::unique_lock<std::mutex> l(auditMu_);
    for (;;) {
        auditCv_.wait(l, [this] { return auditStop_ || !auditQueue_.empty(); });
        if (auditQueue_.empty()) {
            if (auditStop_) return;
            continue;
        }
        auto job = std::move(auditQueue_.front());
        auditQueue_.pop_front();
        auditBusy_ = true;
        l.unlock();
        try {
            job();
        } catch (const std::exception& e) {
            const std::string line =
                std::string("audit of a write result not written: ") + e.what();
            if (opt_.log)
                opt_.log(line);
            else
                std::fprintf(stderr, "%s\n", line.c_str());
        }
        l.lock();
        auditBusy_ = false;
        auditCv_.notify_all();
    }
}

void WriteCoordinator::waitAuditIdle() {
    std::unique_lock<std::mutex> l(auditMu_);
    auditCv_.wait_for(l, std::chrono::milliseconds(kAuditDrainMs),
                      [this] { return auditQueue_.empty() && !auditBusy_; });
}

// ---- views ----

WriteView WriteCoordinator::viewOf(const Entry& e) const { return e.view; }

size_t WriteCoordinator::outstanding() const {
    std::lock_guard<std::mutex> g(mu_);
    size_t n = 0;
    for (const auto& kv : entries_)
        if (kv.second->phase == Entry::Phase::Accepted) ++n;
    return n;
}

bool WriteCoordinator::changing() const {
    std::lock_guard<std::mutex> g(mu_);
    return changing_;
}

void WriteCoordinator::prune(int64_t now) {
    // mu_ held. Finished results live resultTtlMs and at most maxResults; refusals rejectedTtlMs.
    std::vector<std::pair<int64_t, std::string>> done, refused;
    for (auto it = entries_.begin(); it != entries_.end();) {
        const Entry& e = *it->second;
        if (e.phase == Entry::Phase::Done) {
            if (now - e.atMono >= opt_.resultTtlMs) {
                it = entries_.erase(it);
                continue;
            }
            done.emplace_back(e.atMono, it->first);
        } else if (e.phase == Entry::Phase::Rejected) {
            if (now - e.atMono >= opt_.rejectedTtlMs) {
                it = entries_.erase(it);
                continue;
            }
            refused.emplace_back(e.atMono, it->first);
        }
        ++it;
    }
    auto trim = [&](std::vector<std::pair<int64_t, std::string>>& v, size_t cap) {
        if (v.size() <= cap) return;
        std::sort(v.begin(), v.end());
        for (size_t i = 0; i + cap < v.size(); ++i) entries_.erase(v[i].second);
    };
    trim(done, opt_.maxResults);
    trim(refused, opt_.maxRejected);
}

namespace {

const char* messageFor(const std::string& code) {
    struct M {
        const char* code;
        const char* text;
    };
    static const M kMessages[] = {
        {"NO_SUCH_TAG", "Không có Tag này trên thiết bị."},
        {"READ_ONLY", "Tag này không ghi được (chỉ đọc hoặc Tag tính toán)."},
        {"BAD_TYPE", "Giá trị không đúng kiểu của Tag."},
        {"NOT_FINITE", "Giá trị phải là số hữu hạn."},
        {"OUT_OF_LIMITS", "Giá trị ngoài giới hạn nhập của Tag."},
        {"OUT_OF_TYPE_RANGE", "Giá trị ngoài khoảng của kiểu dữ liệu."},
        {"OUT_OF_RAW_RANGE", "Giá trị ngoài khoảng thô của thiết bị trường sau khi đổi thang."},
        {"STRING_TOO_LONG", "Chuỗi dài hơn mức cho phép."},
        {"CONNECTION_BAD", "Kết nối tới PLC đang mất."},
        {"DEVICE_NOT_ACTIVE", "Thiết bị trường chưa hoạt động."},
        {"DISABLED", "Kênh hoặc thiết bị trường đã tắt trong project."},
        {"RATE_LIMITED", "Ghi quá nhanh: hãy thử lại sau giây lát."},
        {"QUEUE_FULL", "Hàng đợi ghi đã đầy."},
        {"PROJECT_CHANGING", "Thiết bị đang đổi project."},
        {"AUDIT_UNAVAILABLE", "Thiết bị không ghi được nhật ký audit nên từ chối lệnh ghi."},
        {"REQUEST_ID_CONFLICT", "Mã yêu cầu này đã dùng cho một lệnh khác."},
        {"UNKNOWN_OUTCOME", "Runtime dừng giữa chừng: không rõ lệnh đã ghi chưa."},
        {"WRITE_TIMEOUT", "Thiết bị trường không trả lời: không chắc đã ghi."},
        {"READBACK_TIMEOUT", "Đã ghi nhưng không đọc lại được: không chắc kết quả."},
        // feature 007
        {"EXPECT_NOT_BOOL", "Chỉ Tag BOOL mới có giá trị mong đợi (expect)."},
        {"PULSE_NOT_BOOL", "Chỉ Tag BOOL mới ghi dạng xung (pulseMs)."},
        {"PULSE_RANGE", "Độ dài xung phải từ 100 đến 10.000 ms."},
        {"STALE_EXPECTATION", "Giá trị của Tag đã đổi so với lúc bạn xem: không ghi gì."},
        {"PULSE_RELEASE_FAILED",
         "Đã ghi bật nhưng không ghi được giá trị trả về: bit lệnh có thể đang bật."},
        // feature 011
        {"PULSE_JOURNAL_FAILED",
         "Không ghi được nhật ký xung: lệnh xung bị hủy, chưa ghi gì xuống thiết bị."},
        {"PULSE_IN_PROGRESS", "Tag này đang có một xung chưa kết thúc."},
        {"PULSE_STUCK", "Một lệnh xung chưa nhả được sau khi khởi động: kiểm tra PLC."},
    };
    for (const M& m : kMessages)
        if (code == m.code) return m.text;
    return "";
}

}  // namespace

WriteView WriteCoordinator::reject(const WriteCaller& who, const WriteRequest& req,
                                   const std::string& code, const std::string& message,
                                   int64_t retryAfterMs, bool remember) {
    WriteView v;
    v.requestId = req.requestId;
    v.status = "REJECTED";
    v.code = code;
    v.message = message.empty() ? messageFor(code) : message;
    v.retryAfterMs = retryAfterMs;
    v.tag = req.tag;
    v.hasValue = req.value.kind != WriteValue::Kind::None;
    v.value = req.value;
    if (remember) {
        std::lock_guard<std::mutex> g(mu_);
        auto e = std::make_unique<Entry>();
        e->phase = Entry::Phase::Rejected;
        e->view = v;
        e->who = who;
        e->atMono = mono();
        entries_.emplace(req.requestId, std::move(e));  // never replace an accepted command
    }
    recordDenied(who, req.requestId, req.tag, req.value, v.hasValue, code);
    return v;
}

void WriteCoordinator::recordDenied(const WriteCaller& who, const std::string& requestId,
                                    const std::string& tag, const WriteValue& value, bool hasValue,
                                    const std::string& code) {
    try {
        audit_.denied(who, requestId, tag, hasValue ? value.json() : "", code);
    } catch (const std::exception&) {  // a refusal that cannot be recorded stays a refusal
    }
}

void WriteCoordinator::recordDeniedJson(const WriteCaller& who, const std::string& requestId,
                                        const std::string& tag, const std::string& valueJson,
                                        const std::string& code) {
    try {
        audit_.denied(who, requestId, tag, valueJson, code);
    } catch (const std::exception&) {
    }
}

// ---- the checks of steps 3 and 4 ----

bool WriteCoordinator::check(const TagModel& t, const WriteValue& v, Checked& out,
                             std::string& code, std::string& message) {
    message.clear();
    // 3. the type
    if (t.type == TagType::BOOL) {
        if (v.kind != WriteValue::Kind::Bool) {
            code = "BAD_TYPE";
            return false;
        }
        out.eng = v.b;
    } else if (t.type == TagType::STRING) {
        if (v.kind != WriteValue::Kind::Text) {
            code = "BAD_TYPE";
            return false;
        }
        out.eng = v.s;
    } else {
        Num n;
        switch (v.kind) {
            case WriteValue::Kind::Int:
                n.isInt = true;
                n.big = {v.i < 0, v.i < 0 ? static_cast<uint64_t>(-(v.i + 1)) + 1
                                          : static_cast<uint64_t>(v.i)};
                break;
            case WriteValue::Kind::Uint:
                n.isInt = true;
                n.big = {false, v.u};
                break;
            case WriteValue::Kind::Float:
                if (!std::isfinite(v.d)) {
                    code = "NOT_FINITE";
                    return false;
                }
                n.isInt = false;
                n.d = v.d;
                break;
            case WriteValue::Kind::Text: {
                const Parse p = parseText(v.s, n);
                if (p == Parse::BadType) {
                    code = "BAD_TYPE";
                    return false;
                }
                if (p == Parse::NotFinite) {
                    code = "NOT_FINITE";
                    return false;
                }
                break;
            }
            default:
                code = "BAD_TYPE";
                return false;
        }
        if (isIntegerType(t.type)) {
            Big big;
            if (n.isInt) {
                big = n.big;
            } else {
                if (n.d != std::floor(n.d)) {
                    code = "BAD_TYPE";
                    message = "Tag kiểu số nguyên: giá trị phải là số nguyên.";
                    return false;
                }
                if (std::fabs(n.d) >= 18446744073709551616.0) {
                    code = "OUT_OF_TYPE_RANGE";
                    return false;
                }
                big = {n.d < 0, static_cast<uint64_t>(std::fabs(n.d))};
            }
            // 4. limits, then the range of the type
            if (t.limits.min && cmpBigDouble(big, *t.limits.min) < 0) {
                code = "OUT_OF_LIMITS";
                return false;
            }
            if (t.limits.max && cmpBigDouble(big, *t.limits.max) > 0) {
                code = "OUT_OF_LIMITS";
                return false;
            }
            if (!fitsType(t.type, big)) {
                code = "OUT_OF_TYPE_RANGE";
                return false;
            }
            out.eng = bigScalar(t.type, big);
        } else {  // FLOAT32, FLOAT64
            const double d = n.isInt ? bigDouble(n.big) : n.d;
            if (t.limits.min && d < *t.limits.min) {
                code = "OUT_OF_LIMITS";
                return false;
            }
            if (t.limits.max && d > *t.limits.max) {
                code = "OUT_OF_LIMITS";
                return false;
            }
            if (t.type == TagType::FLOAT32 && std::fabs(d) > static_cast<double>(FLT_MAX)) {
                code = "OUT_OF_TYPE_RANGE";
                return false;
            }
            out.eng = d;
        }
    }

    // the raw value after inverse scaling (external Tags)
    if (t.kind == TagKind::External && t.type != TagType::BOOL && t.type != TagType::STRING) {
        if (t.scaling) {
            double eng = 0;
            if (const double* d = std::get_if<double>(&out.eng))
                eng = *d;
            else if (const int64_t* i = std::get_if<int64_t>(&out.eng))
                eng = static_cast<double>(*i);
            else if (const uint64_t* u = std::get_if<uint64_t>(&out.eng))
                eng = static_cast<double>(*u);
            const ScaleWriteResult r = scaleWrite(eng, *t.scaling, t.source.rawType);
            if (!r.ok) {
                code = r.error == "NOT_FINITE" ? "NOT_FINITE" : "OUT_OF_RAW_RANGE";
                return false;
            }
            out.raw = r.raw;
            out.hasRaw = true;
        } else {
            out.raw = out.eng;
            if (t.source.rawType != t.type) {  // a raw type of another size: it must fit
                if (isIntegerType(t.source.rawType)) {
                    Big big;
                    if (const double* d = std::get_if<double>(&out.eng)) {
                        const double r = std::round(*d);
                        if (std::fabs(r) >= 18446744073709551616.0) {
                            code = "OUT_OF_RAW_RANGE";
                            return false;
                        }
                        big = {r < 0, static_cast<uint64_t>(std::fabs(r))};
                    } else if (const int64_t* i = std::get_if<int64_t>(&out.eng)) {
                        big = {*i < 0, *i < 0 ? static_cast<uint64_t>(-(*i + 1)) + 1
                                              : static_cast<uint64_t>(*i)};
                    } else {
                        big = {false, std::get<uint64_t>(out.eng)};
                    }
                    if (!fitsType(t.source.rawType, big)) {
                        code = "OUT_OF_RAW_RANGE";
                        return false;
                    }
                    out.raw = bigScalar(t.source.rawType, big);
                }
            }
        }
    }

    // 4 (last). the length of a string, in bytes of UTF-8
    if (t.type == TagType::STRING) {
        size_t cap = t.kind == TagKind::External && t.source.stringLength > 0
                         ? static_cast<size_t>(t.source.stringLength)
                         : 256;
        if (t.limits.maxLength) cap = std::min(cap, static_cast<size_t>(*t.limits.maxLength));
        if (std::get<std::string>(out.eng).size() > cap) {
            code = "STRING_TOO_LONG";
            return false;
        }
        out.raw = out.eng;
    } else if (!out.hasRaw && t.kind != TagKind::External) {
        out.raw = out.eng;
    }
    if (t.type == TagType::BOOL || (t.kind == TagKind::External && t.type == TagType::STRING))
        out.raw = out.eng;
    return true;
}

// ---- submit ----

std::vector<WriteView> WriteCoordinator::submit(const WriteCaller& who,
                                                const std::vector<WriteRequest>& requests) {
    std::vector<WriteView> out;
    for (const WriteRequest& req : requests) {
        const int64_t now = mono();
        // The same request id again: the answer of the first time, or a conflict.
        WriteView again;
        int again_kind = 0;  // 1: the same command, 2: another one with this id
        {
            std::lock_guard<std::mutex> g(mu_);
            prune(now);
            const auto it = entries_.find(req.requestId);
            if (it != entries_.end()) {
                const Entry& e = *it->second;
                if (e.who.user == who.user && e.view.tag == req.tag && e.view.value == req.value &&
                    e.view.pulseMs == req.pulseMs.value_or(0)) {
                    again = e.view;
                    again_kind = 1;
                } else {
                    again_kind = 2;
                }
            }
        }
        if (again_kind == 1) {
            again.duplicate = true;
            out.push_back(std::move(again));
            continue;
        }
        if (again_kind == 2) {
            out.push_back(reject(who, req, "REQUEST_ID_CONFLICT", "", 0, false));
            continue;
        }
        // After a restart the table of accepted requests is the memory (FR-040).
        if (const auto stored = audit_.find(req.requestId)) {
            if (stored->user == who.user && stored->tag == req.tag &&
                stored->newJson == req.value.json()) {
                WriteView v;
                v.requestId = req.requestId;
                v.tag = req.tag;
                v.hasValue = true;
                v.value = req.value;
                v.duplicate = true;
                v.receivedAtMs = stored->receivedWallMs;
                v.finishedAtMs = stored->finishedWallMs;
                v.clockOk = stored->clockOk;
                if (!stored->finished) {
                    v.status = "ACCEPTED";
                    v.phase = "queued";
                } else if (stored->outcome.result == "interrupted") {
                    v.status = "TIMEOUT";
                    v.code = "UNKNOWN_OUTCOME";
                    v.message = messageFor("UNKNOWN_OUTCOME");
                } else if (stored->outcome.result == "ok") {
                    v.status = "CONFIRMED";
                    v.code = stored->outcome.code;
                } else {
                    v.status = stored->outcome.code == "WRITE_TIMEOUT" ||
                                       stored->outcome.code == "READBACK_TIMEOUT"
                                   ? "TIMEOUT"
                                   : "FAILED";
                    v.code = stored->outcome.code;
                    v.exception = stored->outcome.exception;
                }
                out.push_back(std::move(v));
                continue;
            }
            out.push_back(reject(who, req, "REQUEST_ID_CONFLICT", "", 0, false));
            continue;
        }

        // 2. the Tag
        const auto idx = model_.tagIndex(req.tag);
        if (!idx) {
            out.push_back(reject(who, req, "NO_SUCH_TAG", ""));
            continue;
        }
        const TagModel& t = model_.tags[*idx];
        if (t.kind == TagKind::Calculated || !t.writable) {
            out.push_back(reject(who, req, "READ_ONLY", ""));
            continue;
        }
        // Feature 007 (FR-046): what only a BOOL Tag can have, before the value is looked at.
        if (req.expect && t.type != TagType::BOOL) {
            out.push_back(reject(who, req, "EXPECT_NOT_BOOL", ""));
            continue;
        }
        if (req.pulseMs) {
            if (t.type != TagType::BOOL) {
                out.push_back(reject(who, req, "PULSE_NOT_BOOL", ""));
                continue;
            }
            if (*req.pulseMs < kPulseMinMs || *req.pulseMs > kPulseMaxMs) {
                out.push_back(reject(who, req, "PULSE_RANGE", ""));
                continue;
            }
        }
        // 3, 4. the value
        Checked chk;
        std::string code, message;
        if (!check(t, req.value, chk, code, message)) {
            out.push_back(reject(who, req, code, message));
            continue;
        }
        // 5. the link (external Tags)
        if (t.kind == TagKind::External) {
            if (t.disabled) {
                out.push_back(reject(who, req, "DISABLED", ""));
                continue;
            }
            const drv::LinkState ls = backend_.link(*idx);
            if (ls.channel == drv::ChannelState::Disabled ||
                ls.device == drv::DeviceState::Disabled) {
                out.push_back(reject(who, req, "DISABLED", ""));
                continue;
            }
            if (ls.channel != drv::ChannelState::Connected) {
                out.push_back(reject(who, req, "CONNECTION_BAD", ""));
                continue;
            }
            if (ls.device != drv::DeviceState::Active) {
                out.push_back(reject(who, req, "DEVICE_NOT_ACTIVE", ""));
                continue;
            }
        }
        // Feature 007 (FR-046): the value the person saw must still be the current one. After the
        // connection (a Tag without a usable link was refused above) and before the rate limit, so
        // that a stale request costs no token.
        if (req.expect) {
            const TagValue cur = store_.get(*idx);
            const bool* now = std::get_if<bool>(&cur.value);
            if (now == nullptr || cur.quality == Quality::BAD || *now != *req.expect) {
                out.push_back(reject(who, req, "STALE_EXPECTATION", ""));
                continue;
            }
        }
        // 6. the rate; the queue
        const WriteRateLimiter::Decision rate = limiter_.take(who.sessionKey);
        if (!rate.ok) {
            out.push_back(reject(who, req, "RATE_LIMITED", "", rate.retryAfterMs));
            continue;
        }
        const size_t channelKey = t.kind == TagKind::External ? t.channel : kNpos;
        uint64_t internalId = 0;
        std::unique_ptr<Entry> entry;
        std::string refused;
        WriteView racedView;
        int racedKind = 0;  // 1: the same command got in first, 2: another one with this id
        {
            std::lock_guard<std::mutex> g(mu_);
            const int inChannel = queuedPerChannel_[channelKey];
            // The first look at the id and this insert are two critical sections: a concurrent
            // request with the same id may have got in between (FR-040: never run twice).
            if (const auto raced = entries_.find(req.requestId); raced != entries_.end()) {
                const Entry& e = *raced->second;
                if (e.who.user == who.user && e.view.tag == req.tag && e.view.value == req.value &&
                    e.view.pulseMs == req.pulseMs.value_or(0)) {
                    racedView = e.view;
                    racedKind = 1;
                } else {
                    racedKind = 2;
                }
            } else if (req.pulseMs && pulseBusyLocked(*idx)) {
                // feature 011: one pulse at a time on a Tag, one journal entry per Tag
                refused = "PULSE_IN_PROGRESS";
            } else if (inChannel >= opt_.queuePerChannel || queuedTotal_ >= opt_.queueTotal) {
                refused = "QUEUE_FULL";
            } else if (changing_) {  // 7. no new command while the project changes
                refused = "PROJECT_CHANGING";
            } else {
                // take the place and the id now: a second request with this id sees the first
                ++queuedPerChannel_[channelKey];
                ++queuedTotal_;
                ++submitting_;
                internalId = nextId_++;
                entry = std::make_unique<Entry>();
                entry->phase = Entry::Phase::Accepted;
                entry->who = who;
                entry->internalId = internalId;
                entry->channelKey = channelKey;
                entry->tagType = t.type;
                entry->tagIdx = *idx;
                entry->deadlineMs =
                    t.kind == TagKind::External ? model_.devices[t.device].writeDeadlineMs : 5000;
                entry->readback = t.kind == TagKind::External ? t.source.readback : true;
                if (req.pulseMs) {
                    entry->pulseMs = *req.pulseMs;
                    entry->releaseRaw = TagScalar{!req.value.b};
                }
                entry->atMono = now;
                WriteView& v = entry->view;
                v.requestId = req.requestId;
                v.status = "ACCEPTED";
                v.phase = "queued";
                v.tag = req.tag;
                v.hasValue = true;
                v.value = req.value;
                const TagValue old = store_.get(*idx);
                v.hasOld = true;
                v.oldValue = old.value;
                v.oldQuality = old.quality;
                v.hasRaw = chk.hasRaw;
                v.raw = chk.raw;
                v.pulseMs = req.pulseMs.value_or(0);
                v.receivedAtMs = wall();
                v.clockOk = opt_.clockSynced ? opt_.clockSynced(v.receivedAtMs) : true;
                WriteRecord& rec = entry->record;
                rec.requestId = req.requestId;
                rec.who = who;
                rec.tag = req.tag;
                rec.kind = tagKindName(t.kind);
                if (t.kind == TagKind::External) {
                    rec.channel = model_.channels[t.channel].id;
                    rec.device = model_.devices[t.device].id;
                }
                rec.oldJson = std::string("{\"value\":") + scalarJson(old.value) +
                              ",\"quality\":\"" + qualityName(old.quality) + "\"}";
                rec.newJson = req.value.json();
                if (chk.hasRaw) rec.rawJson = scalarJson(chk.raw);
                rec.contextJson = contextJsonOf(req.context);
                rec.pulseMs = req.pulseMs.value_or(0);
                rec.expect = req.expect ? (*req.expect ? 1 : 0) : -1;
                rec.receivedWallMs = v.receivedAtMs;
                entries_[req.requestId] = std::make_unique<Entry>(*entry);
                byInternal_[internalId] = req.requestId;
            }
        }
        if (racedKind != 0) {
            limiter_.refund(who.sessionKey);
            if (racedKind == 1) {
                racedView.duplicate = true;
                out.push_back(std::move(racedView));
            } else {
                out.push_back(reject(who, req, "REQUEST_ID_CONFLICT", "", 0, false));
            }
            continue;
        }
        if (!refused.empty()) {
            limiter_.refund(who.sessionKey);
            out.push_back(reject(who, req, refused, ""));
            continue;
        }
        // 8. the record of receipt, durable, before anything is sent
        try {
            audit_.started(entry->record);
        } catch (const std::exception&) {
            limiter_.refund(who.sessionKey);
            {
                std::lock_guard<std::mutex> g(mu_);
                byInternal_.erase(internalId);
                entries_.erase(req.requestId);
                --queuedPerChannel_[channelKey];
                --queuedTotal_;
                --submitting_;
            }
            doneCv_.notify_all();
            out.push_back(reject(who, req, "AUDIT_UNAVAILABLE", ""));
            continue;
        }
        // Feature 011 (FR-018): the journal of the pulse, durable, before the bit is turned on.
        if (entry->pulseMs > 0 && opt_.pulseLog != nullptr) {
            PulseArm a;
            a.rid = req.requestId;
            a.tag = req.tag;
            a.rel = !req.value.b;
            a.dueMono = now + entry->pulseMs;
            a.dueWallMs = entry->view.receivedAtMs + entry->pulseMs;
            a.src = who.channel == "web" ? "web" : "api";
            a.by = who.user;
            std::string error;
            if (!opt_.pulseLog->arm(a, error)) {
                logLine("pulse journal: cannot arm " + req.requestId + ": " + error);
                {
                    std::lock_guard<std::mutex> g(mu_);
                    --submitting_;
                }
                doneCv_.notify_all();
                drv::WriteResult r;
                r.id = internalId;
                r.status = drv::WriteStatus::Failed;
                r.code = "PULSE_JOURNAL_FAILED";
                onDriverResult(r);
                WriteView v = entry->view;
                {
                    std::lock_guard<std::mutex> g(mu_);
                    const auto it = entries_.find(req.requestId);
                    if (it != entries_.end()) v = it->second->view;
                }
                out.push_back(std::move(v));
                continue;
            }
            std::lock_guard<std::mutex> g(mu_);
            const auto it = entries_.find(req.requestId);
            if (it != entries_.end()) it->second->armed = true;
        }
        drv::WriteCommand cmd;
        cmd.id = internalId;
        cmd.tag = *idx;
        cmd.raw = chk.raw;
        cmd.deadlineMs =
            t.kind == TagKind::External ? model_.devices[t.device].writeDeadlineMs : 5000;
        cmd.readback = t.kind == TagKind::External ? t.source.readback : true;
        const bool sent = backend_.submit(*idx, cmd);
        {
            std::lock_guard<std::mutex> g(mu_);
            --submitting_;
        }
        doneCv_.notify_all();
        if (!sent) {
            drv::WriteResult r;
            r.id = internalId;
            r.status = drv::WriteStatus::Failed;
            r.code = "NOT_SENT_QUEUE_FULL";
            onDriverResult(r);
        }
        out.push_back(entry->view);  // what was true at receipt: ACCEPTED, queued
    }
    return out;
}

// ---- results ----

void WriteCoordinator::finishLocked(Entry& e, const std::string& status, const std::string& code,
                                    int exception, bool hasReadback, const TagScalar& readback) {
    e.phase = Entry::Phase::Done;
    e.view.status = status;
    e.view.code = code;
    e.view.phase.clear();
    e.view.message = messageFor(code);
    e.view.exception = exception;
    e.view.hasReadback = hasReadback;
    e.view.readback = readback;
    e.atMono = mono();
    e.view.finishedAtMs = wall();
    e.view.clockOk = opt_.clockSynced ? opt_.clockSynced(e.view.finishedAtMs) : true;
    --queuedPerChannel_[e.channelKey];
    --queuedTotal_;
    byInternal_.erase(e.internalId);
}

void WriteCoordinator::onDriverResult(const drv::WriteResult& r) {
    WriteRecord rec;
    WriteOutcome outcome;
    std::vector<std::string> closed;  // journal entries whose release is now confirmed
    bool owedChanged = false;
    {
        // Feature 011: the release of a pulse the runtime owed.
        std::lock_guard<std::mutex> g(mu_);
        const auto ri = recoveryByInternal_.find(r.id);
        if (ri != recoveryByInternal_.end()) {
            const std::string rid = ri->second;
            recoveryByInternal_.erase(ri);
            const auto it = recoveries_.find(rid);
            if (it == recoveries_.end()) return;
            Recovery& rc = *it->second;
            rc.inFlight = false;
            rc.lastCode = r.code;
            if (r.status != drv::WriteStatus::Confirmed &&
                r.status != drv::WriteStatus::NoReadback) {
                rc.nextTry = mono() + opt_.pulseRetryMs;
                return;
            }
            rec = rc.record;
            outcome.result = "ok";
            outcome.code = r.code.empty() ? "CONFIRMED" : r.code;
            outcome.exception = r.exception;
            if (!std::holds_alternative<std::monostate>(r.readback))
                outcome.readbackJson = scalarJson(r.readback);
            outcome.pulseJson = nlohmann::json{
                {"recovery", true},
                {"attempts", rc.attempts},
                {"released", true}}.dump();
            const size_t tag = rc.tagIdx;
            closed.push_back(rid);
            recoveries_.erase(it);
            closeOwedLocked(tag, closed);
            owedChanged = true;
        }
    }
    if (owedChanged) {
        postAudit([this, rec, outcome] { audit_.finished(rec, outcome); });
        journalDone(std::move(closed));
        notifyStuck();
        return;
    }
    {
        std::lock_guard<std::mutex> g(mu_);
        const auto bi = byInternal_.find(r.id);
        if (bi == byInternal_.end()) return;
        const auto it = entries_.find(bi->second);
        if (it == entries_.end() || it->second->phase != Entry::Phase::Accepted) return;
        Entry& e = *it->second;
        std::string status = "FAILED";
        const bool confirmed =
            r.status == drv::WriteStatus::Confirmed || r.status == drv::WriteStatus::NoReadback;
        if (confirmed)
            status = "CONFIRMED";
        else if (r.status == drv::WriteStatus::Timeout)
            status = "TIMEOUT";
        std::string code =
            r.code.empty() ? (status == "CONFIRMED" ? "CONFIRMED" : "FAILED") : r.code;
        const bool hasRb = !std::holds_alternative<std::monostate>(r.readback);
        if (e.pulseMs > 0 && e.stage == 0 && confirmed) {
            // The first write is done: the command is not, until the opposite value is written.
            // The wait is on the clock of the runtime, whatever the browser does (FR-047).
            e.stage = 1;
            e.view.phase = "release";
            byInternal_.erase(bi);
            pulseDue_.emplace(releaseNow_ ? mono() : mono() + e.pulseMs, it->first);
            pulseCv_.notify_all();
            return;
        }
        std::string pulseJson;
        if (e.pulseMs > 0 && e.stage == 2) {  // the end of a pulse: the opposite write
            e.view.pulseEnded = true;
            e.view.pulseReleased = confirmed;
            nlohmann::json p = {{"valueMs", e.pulseMs}, {"released", confirmed}};
            if (!confirmed) {
                p["releaseCode"] = code;
                status = "FAILED";
                code = "PULSE_RELEASE_FAILED";
            }
            pulseJson = p.dump();
            if (e.armed) {
                if (confirmed) {  // FR-018: the entry goes once the device confirmed the release
                    closed.push_back(it->first);
                    closeOwedLocked(e.tagIdx, closed);
                } else {  // the bit may be on: the runtime keeps trying (feature 011)
                    PulseArm a;
                    a.rid = it->first;
                    a.tag = e.view.tag;
                    a.rel = std::get<bool>(e.releaseRaw);
                    a.by = e.who.user;
                    addRecoveryLocked(a, &e.who, mono() + opt_.pulseRetryMs);
                    pulseCv_.notify_all();
                }
                owedChanged = true;
            }
        } else if (e.pulseMs > 0 && e.stage == 0 && e.armed) {
            if (r.status == drv::WriteStatus::Timeout) {
                // the bit may be on: kept armed, released at the next start (007: no release now)
                PulseArm a;
                a.rid = it->first;
                a.tag = e.view.tag;
                a.rel = std::get<bool>(e.releaseRaw);
                a.by = e.who.user;
                addRecoveryLocked(a, &e.who, 0);
                const auto ri = recoveries_.find(it->first);
                if (ri != recoveries_.end()) ri->second->state = Recovery::State::Dormant;
            } else {  // the device refused it or it was never sent: nothing to release
                closed.push_back(it->first);
            }
        }
        finishLocked(e, status, code, r.exception, hasRb, r.readback);
        rec = e.record;
        outcome.result = status == "CONFIRMED" ? "ok" : "failed";
        outcome.code = code;
        outcome.exception = r.exception;
        outcome.pulseJson = pulseJson;
        if (hasRb) outcome.readbackJson = scalarJson(r.readback);
    }
    doneCv_.notify_all();
    postAudit([this, rec, outcome] { audit_.finished(rec, outcome); });
    if (!closed.empty()) journalDone(std::move(closed));
    if (owedChanged) notifyStuck();
}

// ---- pulses (feature 007, research R17) ----

// The opposite write of a pulse, when its time has come (or quiesce asks for it): at the front of
// the driver's queue. A driver that cannot take it is tried again pulseQueueRetryMs later on the
// runtime's clock, pulseQueueAttempts times in all; then the end is a release failure. Never sleeps
// (feature 011 FR-020): the other pulses due meanwhile go out at once.
void WriteCoordinator::releasePulse(const std::string& requestId) {
    drv::WriteCommand cmd;
    size_t tag = 0;
    {
        std::lock_guard<std::mutex> g(mu_);
        const auto it = entries_.find(requestId);
        if (it == entries_.end() || it->second->phase != Entry::Phase::Accepted ||
            it->second->stage != 1)
            return;
        Entry& e = *it->second;
        e.stage = 2;
        cmd.id = nextId_++;
        cmd.tag = e.tagIdx;
        cmd.raw = e.releaseRaw;
        cmd.deadlineMs = e.deadlineMs;
        cmd.readback = e.readback;
        cmd.priority = true;
        tag = e.tagIdx;
        e.internalId = cmd.id;
        byInternal_[cmd.id] = requestId;
        ++submitting_;
    }
    const bool sent = backend_.submit(tag, cmd);
    bool again = false;
    {
        std::lock_guard<std::mutex> g(mu_);
        --submitting_;
        if (!sent) {
            const auto it = entries_.find(requestId);
            if (it != entries_.end() && it->second->phase == Entry::Phase::Accepted &&
                ++it->second->releaseTries < opt_.pulseQueueAttempts) {
                it->second->stage = 1;  // waits again; the next try gets a new internal id
                byInternal_.erase(cmd.id);
                pulseDue_.emplace(mono() + opt_.pulseQueueRetryMs, requestId);
                again = true;
            }
        }
    }
    doneCv_.notify_all();
    if (!sent && !again) {
        drv::WriteResult r;
        r.id = cmd.id;
        r.status = drv::WriteStatus::Failed;
        r.code = "NOT_SENT_QUEUE_FULL";
        onDriverResult(r);
    }
}

void WriteCoordinator::pulseThread() {
    std::unique_lock<std::mutex> l(mu_);
    for (;;) {
        if (pulseStop_) return;
        const int64_t now = mono();
        std::vector<std::string> due;
        while (!pulseDue_.empty() && (releaseNow_ || pulseDue_.begin()->first <= now)) {
            due.push_back(pulseDue_.begin()->second);
            pulseDue_.erase(pulseDue_.begin());
        }
        // feature 011: the releases owed whose time to try has come
        std::vector<std::string> owed;
        bool anyPending = false;
        for (const auto& kv : recoveries_) {
            const Recovery& rc = *kv.second;
            if (rc.state != Recovery::State::Pending) continue;
            anyPending = true;
            if (!rc.inFlight && !changing_ && rc.nextTry <= now) owed.push_back(kv.first);
        }
        if (!due.empty() || !owed.empty()) {
            l.unlock();
            for (const std::string& id : due) releasePulse(id);
            for (const std::string& id : owed) attemptRecovery(id);
            l.lock();
            doneCv_.notify_all();
            if (!due.empty()) continue;
        }
        // The clock is the runtime's own (a test moves it): look again at short intervals.
        int64_t waitMs = anyPending ? 50 : 100;
        if (!pulseDue_.empty())
            waitMs = std::min<int64_t>(50, std::max<int64_t>(1, pulseDue_.begin()->first - now));
        pulseCv_.wait_for(l, std::chrono::milliseconds(waitMs));
    }
}

// ---- queries ----

WriteView WriteCoordinator::status(const WriteCaller& who, const std::string& requestId) {
    {
        std::lock_guard<std::mutex> g(mu_);
        prune(mono());
        const auto it = entries_.find(requestId);
        if (it != entries_.end()) {
            const Entry& e = *it->second;
            if (e.who.user == who.user || who.administrator) return e.view;
            WriteView v;
            v.requestId = requestId;
            v.status = "UNKNOWN";
            return v;
        }
    }
    WriteView v;
    v.requestId = requestId;
    v.status = "UNKNOWN";
    if (const auto stored = audit_.find(requestId)) {
        if (stored->user == who.user || who.administrator) {
            v.tag = stored->tag;
            v.receivedAtMs = stored->receivedWallMs;
            v.finishedAtMs = stored->finishedWallMs;
            v.clockOk = stored->clockOk;
            if (!stored->finished) {
                v.status = "ACCEPTED";
                v.phase = "queued";
            } else if (stored->outcome.result == "interrupted") {
                v.status = "TIMEOUT";
                v.code = "UNKNOWN_OUTCOME";
                v.message = messageFor("UNKNOWN_OUTCOME");
            } else if (stored->outcome.result == "ok") {
                v.status = "CONFIRMED";
                v.code = stored->outcome.code;
            } else {
                v.status = stored->outcome.code == "WRITE_TIMEOUT" ||
                                   stored->outcome.code == "READBACK_TIMEOUT"
                               ? "TIMEOUT"
                               : "FAILED";
                v.code = stored->outcome.code;
                v.exception = stored->outcome.exception;
            }
        }
    }
    return v;
}

// ---- quiesce ----

WriteCoordinator::QuiesceReport WriteCoordinator::quiesce() {
    QuiesceReport rep;
    {
        std::unique_lock<std::mutex> l(mu_);
        changing_ = true;
        releaseNow_ = true;  // every pulse ends now: a bit is never left on across the restart
        pulseCv_.notify_all();
        // a command that was between its audit record and its driver gets there first
        doneCv_.wait_for(l, std::chrono::seconds(5), [this] { return submitting_ == 0; });
        // The pulses (first write done) end before the unsent commands are cancelled: an opposite
        // write that waits in a driver must not be taken for a command that never started.
        auto pulsing = [this] {
            for (const auto& kv : entries_)
                if (kv.second->phase == Entry::Phase::Accepted && kv.second->pulseMs > 0 &&
                    kv.second->stage >= 1)
                    return true;
            return false;
        };
        const int64_t wait = std::min(kQuiesceCapMs, 2 * backend_.maxTimeoutMs() + 1000);
        doneCv_.wait_for(l, std::chrono::milliseconds(wait), [&] { return !pulsing(); });
    }
    std::vector<std::string> neverOn;  // pulses cancelled before their first write: nothing owed
    for (uint64_t id : backend_.cancelUnsent()) {
        WriteRecord rec;
        WriteOutcome outcome;
        {
            std::lock_guard<std::mutex> g(mu_);
            const auto bi = byInternal_.find(id);
            if (bi == byInternal_.end()) continue;
            const auto it = entries_.find(bi->second);
            if (it == entries_.end() || it->second->phase != Entry::Phase::Accepted) continue;
            if (it->second->armed && it->second->stage == 0) neverOn.push_back(it->first);
            finishLocked(*it->second, "FAILED", "NOT_SENT_PROJECT_CHANGE", -1, false, TagScalar{});
            rec = it->second->record;
            outcome.result = "failed";
            outcome.code = "NOT_SENT_PROJECT_CHANGE";
        }
        ++rep.cancelled;
        postAudit([this, rec, outcome] { audit_.finished(rec, outcome); });
    }
    journalDone(std::move(neverOn));  // on the audit thread, drained below
    doneCv_.notify_all();
    {
        std::unique_lock<std::mutex> l(mu_);
        auto count = [this] {
            int n = 0;
            for (const auto& kv : entries_)
                if (kv.second->phase == Entry::Phase::Accepted) ++n;
            return n;
        };
        rep.waited = count();
        const int64_t wait = std::min(kQuiesceCapMs, 2 * backend_.maxTimeoutMs() + 1000);
        doneCv_.wait_for(l, std::chrono::milliseconds(wait), [&] { return count() == 0; });
        rep.unfinished = count();
    }
    waitAuditIdle();
    return rep;
}

// ---- pulses owed after a restart (feature 011, FR-019, research R6) ----

void WriteCoordinator::logLine(const std::string& line) {
    if (opt_.log)
        opt_.log(line);
    else
        std::fprintf(stderr, "%s\n", line.c_str());
}

std::string WriteCoordinator::newRequestId() {
    if (opt_.newRequestId) return opt_.newRequestId();
    static std::mutex m;
    static std::mt19937_64 rng{std::random_device{}()};
    uint64_t hi = 0, lo = 0;
    {
        std::lock_guard<std::mutex> g(m);
        hi = rng();
        lo = rng();
    }
    hi = (hi & 0xFFFFFFFFFFFF0FFFULL) | 0x0000000000004000ULL;  // version 4
    lo = (lo & 0x3FFFFFFFFFFFFFFFULL) | 0x8000000000000000ULL;  // variant 10
    char b[40];
    std::snprintf(b, sizeof b, "%08x-%04x-%04x-%04x-%012llx", static_cast<unsigned>(hi >> 32),
                  static_cast<unsigned>((hi >> 16) & 0xFFFF), static_cast<unsigned>(hi & 0xFFFF),
                  static_cast<unsigned>(lo >> 48),
                  static_cast<unsigned long long>(lo & 0xFFFFFFFFFFFFULL));
    return b;
}

// mu_ held. A pulse whose release is being tried, or a pulse that runs (first write or its wait).
bool WriteCoordinator::pulseBusyLocked(size_t tag) const {
    for (const auto& kv : entries_) {
        const Entry& e = *kv.second;
        if (e.phase == Entry::Phase::Accepted && e.pulseMs > 0 && e.tagIdx == tag) return true;
    }
    for (const auto& kv : recoveries_) {
        const Recovery& rc = *kv.second;
        if (rc.state == Recovery::State::Pending && rc.known && rc.tagIdx == tag) return true;
    }
    return false;
}

// mu_ held. `who`: the caller of a pulse of this run (null: an entry of the journal, whose account
// is `by`). `firstTry`: when the first release is tried (mono).
void WriteCoordinator::addRecoveryLocked(const PulseArm& arm, const WriteCaller* who,
                                         int64_t firstTry) {
    if (recoveries_.count(arm.rid) > 0) return;
    auto rc = std::make_unique<Recovery>();
    rc->arm = arm;
    if (who != nullptr) {
        rc->who = *who;
    } else {
        rc->who.user = arm.by;
    }
    rc->who.source = "system";
    rc->who.channel = "system";
    rc->who.sessionKey.clear();
    const auto idx = model_.tagIndex(arm.tag);
    if (idx && model_.tags[*idx].type == TagType::BOOL && model_.tags[*idx].writable &&
        model_.tags[*idx].kind != TagKind::Calculated) {
        rc->known = true;
        rc->tagIdx = *idx;
    }
    const int64_t now = mono();
    rc->deadline = now + opt_.pulseRecoveryWindowMs;
    rc->nextTry = firstTry;
    rc->state = rc->known ? Recovery::State::Pending : Recovery::State::Stuck;
    recoveries_.emplace(arm.rid, std::move(rc));
}

// mu_ held. A release of `tag` was confirmed: whatever else the runtime owed on it is settled.
void WriteCoordinator::closeOwedLocked(size_t tag, std::vector<std::string>& rids) {
    for (auto it = recoveries_.begin(); it != recoveries_.end();) {
        const Recovery& rc = *it->second;
        if (rc.known && rc.tagIdx == tag && rc.state != Recovery::State::Pending) {
            rids.push_back(it->first);
            it = recoveries_.erase(it);
        } else {
            ++it;
        }
    }
}

// The `done` lines, on the audit thread (an fdatasync is never awaited by the engine's thread).
void WriteCoordinator::journalDone(std::vector<std::string> rids) {
    if (opt_.pulseLog == nullptr || rids.empty()) return;
    postAudit([this, rids] {
        for (const std::string& rid : rids) {
            std::string error;
            if (!opt_.pulseLog->done(rid, error))
                logLine("pulse journal: cannot close " + rid + ": " + error);
        }
    });
}

void WriteCoordinator::notifyStuck() {
    std::lock_guard<std::mutex> s(stuckMu_);
    std::vector<std::string> tags;
    {
        std::lock_guard<std::mutex> g(mu_);
        for (const auto& kv : recoveries_)
            if (kv.second->state == Recovery::State::Stuck) tags.push_back(kv.second->arm.tag);
    }
    std::sort(tags.begin(), tags.end());
    tags.erase(std::unique(tags.begin(), tags.end()), tags.end());
    if (tags == lastStuck_) return;
    lastStuck_ = tags;
    if (opt_.pulseStuck) opt_.pulseStuck(tags);
}

// mu_ held. The audit record of a release owed: its own request id, under the account of the
// pulse, detail.source "pulse-recovery" and the id of the pulse.
WriteRecord WriteCoordinator::recoveryRecordLocked(const Recovery& rc) {
    WriteRecord rec;
    rec.who = rc.who;
    rec.tag = rc.arm.tag;
    rec.newJson = rc.arm.rel ? "true" : "false";
    rec.origin = "pulse-recovery";
    rec.pulseOf = rc.arm.rid;
    rec.receivedWallMs = wall();
    if (rc.known) {
        const TagModel& t = model_.tags[rc.tagIdx];
        rec.kind = tagKindName(t.kind);
        if (t.kind == TagKind::External) {
            rec.channel = model_.channels[t.channel].id;
            rec.device = model_.devices[t.device].id;
        }
        const TagValue old = store_.get(rc.tagIdx);
        rec.oldJson = std::string("{\"value\":") + scalarJson(old.value) + ",\"quality\":\"" +
                      qualityName(old.quality) + "\"}";
    }
    return rec;
}

// One try of a release owed (the pulse thread). Nothing is sent before the record of receipt is
// durable (Constitution V); a channel or field device that is not connected waits for the next try.
void WriteCoordinator::attemptRecovery(const std::string& rid) {
    size_t tag = 0;
    bool external = false;
    bool expire = false;
    bool needStart = false;
    WriteRecord rec;
    WriteOutcome outcome;
    {
        std::lock_guard<std::mutex> g(mu_);
        const auto it = recoveries_.find(rid);
        if (it == recoveries_.end()) return;
        Recovery& rc = *it->second;
        if (rc.state != Recovery::State::Pending || rc.inFlight) return;
        const int64_t now = mono();
        if (now >= rc.deadline) {  // the window is over: kept in the journal, PULSE_STUCK
            rc.state = Recovery::State::Stuck;
            expire = true;
            needStart = !rc.started;
            if (!rc.started) {
                rc.record = recoveryRecordLocked(rc);
                rc.record.requestId = newRequestId();
                rc.started = true;
            }
            rec = rc.record;
            outcome.result = "failed";
            outcome.code = "PULSE_STUCK";
            nlohmann::json p = {{"recovery", true}, {"attempts", rc.attempts}, {"released", false}};
            if (!rc.lastCode.empty()) p["releaseCode"] = rc.lastCode;
            outcome.pulseJson = p.dump();
        } else {
            rc.nextTry = now + opt_.pulseRetryMs;  // unless it is sent below
            tag = rc.tagIdx;
            external = model_.tags[tag].kind == TagKind::External;
            needStart = !rc.started;
        }
    }
    if (expire) {
        logLine("pulse recovery: the release of " + rec.tag + " (pulse " + rid +
                ") could not be written: PULSE_STUCK");
        postAudit([this, rec, outcome, needStart] {
            if (needStart) audit_.started(rec);
            audit_.finished(rec, outcome);
        });
        notifyStuck();
        return;
    }
    if (external) {
        const drv::LinkState ls = backend_.link(tag);
        if (ls.channel != drv::ChannelState::Connected || ls.device != drv::DeviceState::Active)
            return;
    }
    if (needStart) {
        {
            std::lock_guard<std::mutex> g(mu_);
            const auto it = recoveries_.find(rid);
            if (it == recoveries_.end()) return;
            rec = recoveryRecordLocked(*it->second);  // the old value as it is now
        }
        rec.requestId = newRequestId();
        try {
            audit_.started(rec);
        } catch (const std::exception& e) {
            logLine(std::string("pulse recovery: audit unavailable, release not sent: ") +
                    e.what());
            return;
        }
    }
    drv::WriteCommand cmd;
    {
        std::lock_guard<std::mutex> g(mu_);
        const auto it = recoveries_.find(rid);
        if (it == recoveries_.end()) return;
        Recovery& rc = *it->second;
        if (needStart) {
            rc.started = true;
            rc.record = rec;
        }
        if (rc.state != Recovery::State::Pending) return;
        cmd.id = nextId_++;
        cmd.tag = tag;
        cmd.raw = TagScalar{rc.arm.rel};
        cmd.priority = true;
        if (external) {
            const TagModel& t = model_.tags[tag];
            cmd.deadlineMs = model_.devices[t.device].writeDeadlineMs;
            cmd.readback = t.source.readback;
        }
        rc.inFlight = true;
        rc.internalId = cmd.id;
        ++rc.attempts;
        recoveryByInternal_[cmd.id] = rid;
    }
    if (!backend_.submit(tag, cmd)) {  // a full queue: soon again, never by sleeping
        std::lock_guard<std::mutex> g(mu_);
        recoveryByInternal_.erase(cmd.id);
        const auto it = recoveries_.find(rid);
        if (it != recoveries_.end()) {
            it->second->inFlight = false;
            it->second->lastCode = "NOT_SENT_QUEUE_FULL";
            it->second->nextTry = mono() + opt_.pulseQueueRetryMs;
        }
    }
}

void WriteCoordinator::recoverPulses(const std::vector<PulseArm>& armed, bool enabled) {
    {
        std::lock_guard<std::mutex> g(mu_);
        const int64_t now = mono();
        for (const PulseArm& a : armed) {
            addRecoveryLocked(a, nullptr, now);
            Recovery& rc = *recoveries_[a.rid];
            if (!enabled) rc.state = Recovery::State::Stuck;
            if (!rc.known)
                logLine("pulse recovery: Tag " + a.tag + " of pulse " + a.rid +
                        " is not a writable BOOL Tag of the project: kept, PULSE_STUCK");
        }
    }
    pulseCv_.notify_all();
    notifyStuck();
}

WriteCoordinator::PulseRecoveryState WriteCoordinator::pulseRecovery() const {
    PulseRecoveryState s;
    std::lock_guard<std::mutex> g(mu_);
    for (const auto& kv : recoveries_) {
        if (kv.second->state == Recovery::State::Pending) s.pending.push_back(kv.second->arm.tag);
        if (kv.second->state == Recovery::State::Stuck) s.stuck.push_back(kv.second->arm.tag);
    }
    return s;
}

}  // namespace mat
