// compile(): lexer -> parser -> checker -> compiler (contracts/expression-language.md §9).
#include "core/expression/expression.hpp"

#include "core/expression/internal.hpp"

namespace mat::expr {

namespace {

const char* messageOf(const std::string& code) {
    static const std::map<std::string, const char*> kMessages = {
        {"E_EXPR_SYNTAX", "syntax error"},
        {"E_EXPR_UNKNOWN_TAG", "unknown tag"},
        {"E_EXPR_UNKNOWN_TABLE", "unknown value table"},
        {"E_EXPR_UNKNOWN_FUNC", "unknown function"},
        {"E_EXPR_ARITY", "wrong number of arguments"},
        {"E_EXPR_TYPE", "type mismatch"},
        {"E_EXPR_LIMIT", "expression limit exceeded"},
        {"E_EXPR_CYCLE", "circular reference between calculated tags"},
        {"E_EXPR_DEPTH", "dependency chain deeper than 16 levels"},
        {"W_EXPR_INT64", "INT64/UINT64 inputs lose precision beyond 2^53"}};
    auto it = kMessages.find(code);
    return it != kMessages.end() ? it->second : code.c_str();
}

Issue issue(const std::string& code, size_t s, size_t e) {
    return Issue{code, s, e, messageOf(code)};
}

// Guard for the recursion depth of the tree walks: a left-deep chain of binary operators grows the
// tree by one level per operand. Anything this long is rejected as a limit error (the TS version
// accepts up to 100 000 characters; no real expression is anywhere near either).
constexpr size_t kMaxCharsParsed = 8192;

}  // namespace

CompileResult compile(const std::string& src, const CompileEnv& env) {
    CompileResult out;
    const detail::Cps cps = detail::decodeUtf8(src);
    if (cps.size() > kMaxCharsParsed) {
        out.errors.push_back(issue("E_EXPR_LIMIT", kMaxChars, kMaxChars + 1));
        return out;
    }
    detail::ParseOut parsed = detail::parse(cps);
    if (parsed.error) {
        out.errors.push_back(issue(parsed.error->code, parsed.error->s, parsed.error->e));
        return out;
    }
    detail::CheckOut checked =
        detail::check(*parsed.root, parsed.limitIssue, cps.size(), src.size(), env);
    if (!checked.ok) {
        out.errors.push_back(issue(checked.error.code, checked.error.s, checked.error.e));
        return out;
    }
    out.program =
        detail::compileNode(*parsed.root, checked.inputs, env.target, [&](const std::string& id) {
            const detail::ExprType k = detail::kindOfTag(*env.tagType(id));
            return k == detail::ExprType::Number ? 0 : k == detail::ExprType::Bool ? 1 : 2;
        });
    for (const auto& w : checked.warnings) out.warnings.push_back(issue(w, 0, cps.size()));
    out.ok = true;
    return out;
}

}  // namespace mat::expr
