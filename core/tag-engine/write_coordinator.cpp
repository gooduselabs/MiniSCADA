#include "core/tag-engine/write_coordinator.hpp"

#include <time.h>

#include <algorithm>
#include <cerrno>
#include <cfloat>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>

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
    auditThread_ = std::thread([this] { auditThread(); });
}

WriteCoordinator::~WriteCoordinator() {
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
                if (e.who.user == who.user && e.view.tag == req.tag && e.view.value == req.value) {
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
                if (e.who.user == who.user && e.view.tag == req.tag && e.view.value == req.value) {
                    racedView = e.view;
                    racedKind = 1;
                } else {
                    racedKind = 2;
                }
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
    {
        std::lock_guard<std::mutex> g(mu_);
        const auto bi = byInternal_.find(r.id);
        if (bi == byInternal_.end()) return;
        const auto it = entries_.find(bi->second);
        if (it == entries_.end() || it->second->phase != Entry::Phase::Accepted) return;
        Entry& e = *it->second;
        std::string status = "FAILED";
        if (r.status == drv::WriteStatus::Confirmed || r.status == drv::WriteStatus::NoReadback)
            status = "CONFIRMED";
        else if (r.status == drv::WriteStatus::Timeout)
            status = "TIMEOUT";
        const std::string code =
            r.code.empty() ? (status == "CONFIRMED" ? "CONFIRMED" : "FAILED") : r.code;
        const bool hasRb = !std::holds_alternative<std::monostate>(r.readback);
        finishLocked(e, status, code, r.exception, hasRb, r.readback);
        rec = e.record;
        outcome.result = status == "CONFIRMED" ? "ok" : "failed";
        outcome.code = code;
        outcome.exception = r.exception;
        if (hasRb) outcome.readbackJson = scalarJson(r.readback);
    }
    doneCv_.notify_all();
    postAudit([this, rec, outcome] { audit_.finished(rec, outcome); });
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
        // a command that was between its audit record and its driver gets there first
        doneCv_.wait_for(l, std::chrono::seconds(5), [this] { return submitting_ == 0; });
    }
    for (uint64_t id : backend_.cancelUnsent()) {
        WriteRecord rec;
        WriteOutcome outcome;
        {
            std::lock_guard<std::mutex> g(mu_);
            const auto bi = byInternal_.find(id);
            if (bi == byInternal_.end()) continue;
            const auto it = entries_.find(bi->second);
            if (it == entries_.end() || it->second->phase != Entry::Phase::Accepted) continue;
            finishLocked(*it->second, "FAILED", "NOT_SENT_PROJECT_CHANGE", -1, false, TagScalar{});
            rec = it->second->record;
            outcome.result = "failed";
            outcome.code = "NOT_SENT_PROJECT_CHANGE";
        }
        ++rep.cancelled;
        postAudit([this, rec, outcome] { audit_.finished(rec, outcome); });
    }
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

}  // namespace mat
