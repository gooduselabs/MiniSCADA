// Recursive descent parser (contracts/expression-language.md §2). The syntax error is the first one
// by position: the lexer stops at its error and the parser reaches that token in turn.
#include "core/expression/internal.hpp"

namespace mat::expr::detail {

namespace {

constexpr int kNestLimit = 32;
constexpr int kNestAbort = 100;

struct Abort {
    SpanIssue issue;
};

class Parser {
   public:
    explicit Parser(std::vector<Tok> toks) : toks_(std::move(toks)) {}

    ParseOut run() {
        ParseOut out;
        try {
            NodePtr root = expr(0);
            if (peek().k != TK::End) fail(peek());
            out.root = std::move(root);
            out.limitIssue = limit_;
        } catch (const Abort& a) {
            out.error = a.issue;
        }
        return out;
    }

   private:
    const Tok& peek() const { return toks_[p_]; }
    const Tok& take() { return toks_[p_++]; }
    [[noreturn]] void fail(const Tok& t) { throw Abort{{"E_EXPR_SYNTAX", t.s, t.e}}; }
    static bool isOp(const Tok& t, std::initializer_list<const char*> ops) {
        if (t.k != TK::Op) return false;
        for (const char* o : ops)
            if (t.text == o) return true;
        return false;
    }
    const Tok& expectOp(const char* op) {
        const Tok& t = peek();
        if (!isOp(t, {op})) fail(t);
        ++p_;
        return t;
    }
    void enter(int depth, const Tok& tok) {
        if (depth > kNestLimit && !limit_) limit_ = SpanIssue{"E_EXPR_LIMIT", tok.s, tok.e};
        if (depth > kNestAbort) throw Abort{*limit_};
    }
    static NodePtr make(NT t, size_t s, size_t e) {
        auto n = std::make_unique<Node>();
        n->t = t;
        n->s = s;
        n->e = e;
        return n;
    }
    static NodePtr bin(const std::string& op, NodePtr l, NodePtr r) {
        auto n = make(NT::Bin, l->s, r->e);
        n->str = op;
        n->k.push_back(std::move(l));
        n->k.push_back(std::move(r));
        return n;
    }

    NodePtr expr(int d) {
        NodePtr c = orExpr(d);
        if (isOp(peek(), {"?"})) {
            const Tok q = take();
            enter(d + 1, q);
            NodePtr a = expr(d + 1);
            const Tok col = expectOp(":");
            enter(d + 1, col);
            NodePtr b = expr(d + 1);
            auto n = make(NT::Cond, c->s, b->e);
            n->k.push_back(std::move(c));
            n->k.push_back(std::move(a));
            n->k.push_back(std::move(b));
            return n;
        }
        return c;
    }
    NodePtr orExpr(int d) {
        NodePtr l = andExpr(d);
        while (isOp(peek(), {"||"})) {
            take();
            NodePtr r = andExpr(d);
            l = bin("||", std::move(l), std::move(r));
        }
        return l;
    }
    NodePtr andExpr(int d) {
        NodePtr l = eqExpr(d);
        while (isOp(peek(), {"&&"})) {
            take();
            NodePtr r = eqExpr(d);
            l = bin("&&", std::move(l), std::move(r));
        }
        return l;
    }
    NodePtr eqExpr(int d) {
        NodePtr l = relExpr(d);
        if (isOp(peek(), {"==", "!="})) {
            const std::string op = take().text;
            NodePtr r = relExpr(d);
            l = bin(op, std::move(l), std::move(r));
            if (isOp(peek(), {"==", "!="})) fail(peek());  // not associative
        }
        return l;
    }
    NodePtr relExpr(int d) {
        NodePtr l = addExpr(d);
        if (isOp(peek(), {"<", "<=", ">", ">="})) {
            const std::string op = take().text;
            NodePtr r = addExpr(d);
            l = bin(op, std::move(l), std::move(r));
            if (isOp(peek(), {"<", "<=", ">", ">="})) fail(peek());
        }
        return l;
    }
    NodePtr addExpr(int d) {
        NodePtr l = mulExpr(d);
        while (isOp(peek(), {"+", "-"})) {
            const std::string op = take().text;
            NodePtr r = mulExpr(d);
            l = bin(op, std::move(l), std::move(r));
        }
        return l;
    }
    NodePtr mulExpr(int d) {
        NodePtr l = unary(d);
        while (isOp(peek(), {"*", "/", "%"})) {
            const std::string op = take().text;
            NodePtr r = unary(d);
            l = bin(op, std::move(l), std::move(r));
        }
        return l;
    }
    NodePtr unary(int d) {
        if (isOp(peek(), {"-", "!"})) {
            const Tok o = take();
            enter(d + 1, o);
            NodePtr x = unary(d + 1);
            auto n = make(NT::Un, o.s, x->e);
            n->str = o.text;
            n->k.push_back(std::move(x));
            return n;
        }
        return primary(d);
    }
    NodePtr primary(int d) {
        const Tok t = peek();
        if (t.k == TK::Num) {
            take();
            auto n = make(NT::Num, t.s, t.e);
            n->v = t.v;
            return n;
        }
        if (t.k == TK::Str) {
            take();
            auto n = make(NT::Str, t.s, t.e);
            n->str = t.text;
            return n;
        }
        if (t.k == TK::Word) {
            take();
            const Tok nx = peek();
            if (t.text.find('.') == std::string::npos && isOp(nx, {"("})) {
                take();
                enter(d + 1, nx);
                auto call = make(NT::Call, t.s, t.e);
                call->str = t.text;
                call->nameS = t.s;
                call->nameE = t.e;
                if (!isOp(peek(), {")"})) {
                    for (;;) {
                        call->k.push_back(expr(d + 1));
                        if (isOp(peek(), {","})) {
                            take();
                            continue;
                        }
                        break;
                    }
                }
                const Tok rp = expectOp(")");
                call->e = rp.e;
                return call;
            }
            if (t.text == "true" || t.text == "false") {
                auto n = make(NT::Bool, t.s, t.e);
                n->b = t.text == "true";
                return n;
            }
            auto n = make(NT::Tag, t.s, t.e);
            n->str = t.text;
            return n;
        }
        if (isOp(t, {"("})) {
            take();
            enter(d + 1, t);
            NodePtr x = expr(d + 1);
            const Tok rp = expectOp(")");
            auto n = make(NT::Paren, t.s, rp.e);
            n->k.push_back(std::move(x));
            return n;
        }
        fail(t);
    }

    std::vector<Tok> toks_;
    size_t p_ = 0;
    std::optional<SpanIssue> limit_;
};

}  // namespace

ParseOut parse(const Cps& cps) { return Parser(lex(cps)).run(); }

}  // namespace mat::expr::detail
