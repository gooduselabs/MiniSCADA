// Stack machine that tracks quality (contract expression-language §4, §5). Only loaded inputs
// count.
#include <cmath>

#include "core/expression/internal.hpp"

namespace mat::expr {

namespace {

using detail::Op;
using Val = std::variant<double, bool, std::string>;

struct Stop {
    std::string reason;
};

constexpr double kPow10[] = {1,      10,      100,      1000,      10000,
                             100000, 1000000, 10000000, 100000000, 1000000000};

double finite(double v) {
    if (std::isinf(v)) throw Stop{"OVERFLOW"};
    if (std::isnan(v)) throw Stop{"NOT_A_NUMBER"};
    return v;
}

Val binary(int32_t op, double a, double b) {
    switch (op) {
        case detail::ADD:
            return finite(a + b);
        case detail::SUB:
            return finite(a - b);
        case detail::MUL:
            return finite(a * b);
        case detail::DIV:
            if (b == 0) throw Stop{"DIV_ZERO"};
            return finite(a / b);
        case detail::MOD:
            if (b == 0) throw Stop{"MOD_ZERO"};
            return finite(std::fmod(a, b));
        case detail::LT:
            return a < b;
        case detail::LE:
            return a <= b;
        case detail::GT:
            return a > b;
        case detail::GE:
            return a >= b;
        case detail::EQN:
            return a == b;
        default:
            return a != b;
    }
}

double num(const Val& v) { return std::get<double>(v); }

double scalarToNumber(const TagScalar& s) {
    if (const double* d = std::get_if<double>(&s)) return *d;
    if (const int64_t* i = std::get_if<int64_t>(&s)) return static_cast<double>(*i);
    if (const uint64_t* u = std::get_if<uint64_t>(&s)) return static_cast<double>(*u);
    if (const bool* b = std::get_if<bool>(&s)) return *b ? 1.0 : 0.0;
    return 0.0;
}

std::string scalarToString(const TagScalar& s) {
    if (const std::string* t = std::get_if<std::string>(&s)) return *t;
    return std::string();
}

// `input(i)`: the value of input i (a reference or a value).
template <class Input>
EvalResult run(const Program& p, const Input& input, const TableSet& tables) {
    const auto& ops = p.ops;
    // T148: one stack per thread, kept between calls (no allocation per evaluation: the 550 blocks
    // of a logic scan, the calculated Tags of a round). evaluate() never runs inside `input`.
    thread_local std::vector<Val> stack;
    std::vector<Val>& st = stack;
    st.clear();
    st.reserve(static_cast<size_t>(p.maxStack) + 2);
    std::optional<std::string> unc;
    EvalResult res;
    try {
        size_t pc = 0;
        while (pc < ops.size()) {
            const int32_t op = ops[pc++];
            switch (op) {
                case detail::PUSH_NUM:
                case detail::PUSH_STR: {
                    const ConstValue& c = p.consts[static_cast<size_t>(ops[pc++])];
                    if (const double* d = std::get_if<double>(&c))
                        st.emplace_back(*d);
                    else
                        st.emplace_back(std::get<std::string>(c));
                    break;
                }
                case detail::PUSH_BOOL:
                    st.emplace_back(ops[pc++] == 1);
                    break;
                case detail::LOAD: {
                    const InputValue& iv = input(static_cast<size_t>(ops[pc++]));
                    const int32_t kind = ops[pc++];
                    if (iv.quality == Quality::BAD ||
                        std::holds_alternative<std::monostate>(iv.value))
                        throw Stop{iv.quality == Quality::BAD && iv.reason != "NO_VALUE"
                                       ? "INPUT_BAD"
                                       : "NO_VALUE"};
                    if (iv.quality == Quality::UNCERTAIN && !unc)
                        unc = iv.reason.empty() ? std::string("UNCERTAIN") : iv.reason;
                    if (kind == 0)
                        st.emplace_back(scalarToNumber(iv.value));
                    else if (kind == 1) {
                        const bool* b = std::get_if<bool>(&iv.value);
                        st.emplace_back(b != nullptr && *b);
                    } else
                        st.emplace_back(scalarToString(iv.value));
                    break;
                }
                case detail::TONUM: {
                    Val v = std::move(st.back());
                    st.pop_back();
                    if (const bool* b = std::get_if<bool>(&v))
                        st.emplace_back(*b ? 1.0 : 0.0);
                    else
                        st.push_back(std::move(v));
                    break;
                }
                case detail::NEG: {
                    const double x = num(st.back());
                    st.back() = -x;
                    break;
                }
                case detail::NOT: {
                    const bool x = std::get<bool>(st.back());
                    st.back() = !x;
                    break;
                }
                case detail::ADD:
                case detail::SUB:
                case detail::MUL:
                case detail::DIV:
                case detail::MOD:
                case detail::LT:
                case detail::LE:
                case detail::GT:
                case detail::GE:
                case detail::EQN:
                case detail::NEN: {
                    const double b = num(st.back());
                    st.pop_back();
                    const double a = num(st.back());
                    st.pop_back();
                    st.push_back(binary(op, a, b));
                    break;
                }
                case detail::EQS:
                case detail::NES: {
                    const std::string b = std::get<std::string>(st.back());
                    st.pop_back();
                    const std::string a = std::get<std::string>(st.back());
                    st.pop_back();
                    st.emplace_back(op == detail::EQS ? a == b : a != b);
                    break;
                }
                case detail::JF_KEEP: {
                    const int32_t to = ops[pc++];
                    const bool* b = std::get_if<bool>(&st.back());
                    if (b && !*b) pc = static_cast<size_t>(to);
                    break;
                }
                case detail::JT_KEEP: {
                    const int32_t to = ops[pc++];
                    const bool* b = std::get_if<bool>(&st.back());
                    if (b && *b) pc = static_cast<size_t>(to);
                    break;
                }
                case detail::POP:
                    st.pop_back();
                    break;
                case detail::JF: {
                    const int32_t to = ops[pc++];
                    const bool c = std::get<bool>(st.back());
                    st.pop_back();
                    if (!c) pc = static_cast<size_t>(to);
                    break;
                }
                case detail::JMP:
                    pc = static_cast<size_t>(ops[pc]);
                    break;
                case detail::MIN:
                case detail::MAX: {
                    const size_t n = static_cast<size_t>(ops[pc++]);
                    const size_t base = st.size() - n;
                    double m = num(st[base]);
                    for (size_t i = 1; i < n; ++i) {
                        const double v = num(st[base + i]);
                        if (op == detail::MIN ? v < m : v > m) m = v;
                    }
                    st.resize(base);
                    st.emplace_back(m);
                    break;
                }
                case detail::ABS: {
                    const double x = num(st.back());
                    st.back() = x < 0 ? -x : x;
                    break;
                }
                case detail::CLAMP: {
                    const double hi = num(st.back());
                    st.pop_back();
                    const double lo = num(st.back());
                    st.pop_back();
                    const double x = num(st.back());
                    st.pop_back();
                    if (lo > hi) throw Stop{"CLAMP_RANGE"};
                    const double t = x < lo ? lo : x;
                    st.emplace_back(t > hi ? hi : t);
                    break;
                }
                case detail::ROUND: {
                    const double x = num(st.back());
                    st.back() = roundHalfAway(x);
                    break;
                }
                case detail::ROUNDN: {
                    const double pw = kPow10[ops[pc++]];
                    const double x = num(st.back());
                    st.back() = roundHalfAway(finite(x * pw)) / pw;
                    break;
                }
                case detail::TEXT: {
                    const std::string& name = p.tables[static_cast<size_t>(ops[pc++])];
                    const double x = num(st.back());
                    auto it = tables.find(name);
                    st.back() =
                        it != tables.end() ? lookupValueTable(it->second, x).text : std::string();
                    break;
                }
                default:
                    throw Stop{"BAD_OPCODE"};
            }
        }
        Val top = std::move(st.back());
        Assigned a;
        if (const double* d = std::get_if<double>(&top))
            a = assignNumber(p.target, *d);
        else if (const bool* b = std::get_if<bool>(&top))
            a = assignBool(p.target, *b);
        else
            a = assignString(p.target, std::get<std::string>(top));
        if (!a.ok) throw Stop{a.reason};
        res.quality = unc ? Quality::UNCERTAIN : Quality::GOOD;
        if (unc) res.reason = *unc;
        res.value = std::move(a.value);
        return res;
    } catch (const Stop& s) {
        res.quality = Quality::BAD;
        res.reason = s.reason;
        res.value = TagScalar{};
        return res;
    }
}

}  // namespace

EvalResult evaluate(const Program& p, const std::function<InputValue(size_t)>& input,
                    const TableSet& tables) {
    return run(p, input, tables);
}

EvalResult evaluate(const Program& p, const InputValue* inputs, const TableSet& tables) {
    return run(
        p, [inputs](size_t i) -> const InputValue& { return inputs[i]; }, tables);
}

}  // namespace mat::expr
