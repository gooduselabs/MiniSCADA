#include "drivers/mqtt/address.hpp"

#include <cctype>

namespace mat::mqtt {

namespace {

constexpr size_t kMaxSteps = 16;

bool startsWith(const std::string& s, const char* p) { return s.rfind(p, 0) == 0; }

// Levels of a filter: `+` alone in a level, `#` alone and last.
bool validFilter(const std::string& t, bool* wildcard) {
    if (t.empty()) return false;
    size_t start = 0;
    *wildcard = false;
    while (true) {
        const size_t slash = t.find('/', start);
        const std::string level =
            t.substr(start, slash == std::string::npos ? std::string::npos : slash - start);
        const bool last = slash == std::string::npos;
        if (level.find('+') != std::string::npos) {
            if (level != "+") return false;
            *wildcard = true;
        }
        if (level.find('#') != std::string::npos) {
            if (level != "#" || !last) return false;
            *wildcard = true;
        }
        if (last) break;
        start = slash + 1;
    }
    return t.find('\0') == std::string::npos;
}

bool parsePath(const std::string& p, std::vector<PathStep>& steps) {
    if (p.empty() || p[0] != '$') return false;
    size_t i = 1;
    while (i < p.size()) {
        if (steps.size() >= kMaxSteps) return false;
        PathStep s;
        if (p[i] == '.') {
            ++i;
            const size_t b = i;
            while (i < p.size() &&
                   (std::isalnum(static_cast<unsigned char>(p[i])) || p[i] == '_' || p[i] == '-'))
                ++i;
            if (i == b) return false;
            s.name = p.substr(b, i - b);
        } else if (p[i] == '[') {
            ++i;
            const size_t b = i;
            while (i < p.size() && p[i] >= '0' && p[i] <= '9') ++i;
            if (i == b || i - b > 4 || i >= p.size() || p[i] != ']') return false;
            s.index = true;
            s.n = std::stoi(p.substr(b, i - b));
            ++i;
        } else {
            return false;
        }
        steps.push_back(std::move(s));
    }
    return true;
}

Address fail(const char* code) {
    Address a;
    a.error = code;
    return a;
}

}  // namespace

const char* directionName(Direction d) {
    return d == Direction::Publish ? "pub" : d == Direction::Both ? "both" : "sub";
}

Address parseAddress(const std::string& address) {
    Address a;
    std::string rest = address;
    if (startsWith(rest, "sub:")) {
        rest = rest.substr(4);
    } else if (startsWith(rest, "pub:")) {
        a.dir = Direction::Publish;
        rest = rest.substr(4);
    } else if (startsWith(rest, "both:")) {
        a.dir = Direction::Both;
        rest = rest.substr(5);
    }
    // options after the first ';'
    const size_t semi = rest.find(';');
    std::string main = rest.substr(0, semi);
    bool seenQos = false;
    if (semi != std::string::npos) {
        std::string opts = rest.substr(semi + 1);
        size_t start = 0;
        while (true) {
            const size_t next = opts.find(';', start);
            const std::string o =
                opts.substr(start, next == std::string::npos ? std::string::npos : next - start);
            if (o == "retain") {
                if (a.retain || a.dir == Direction::Subscribe) return fail("E_ADDR_SYNTAX");
                a.retain = true;
            } else if (startsWith(o, "qos=")) {
                const std::string v = o.substr(4);
                if (seenQos || v.empty() || v.size() > 3 ||
                    v.find_first_not_of("0123456789") != std::string::npos)
                    return fail("E_ADDR_SYNTAX");
                seenQos = true;
                a.qos = std::stoi(v);
                if (a.qos > 1) return fail("E_ADDR_RANGE");
            } else {
                return fail("E_ADDR_SYNTAX");
            }
            if (next == std::string::npos) break;
            start = next + 1;
        }
    }
    const size_t bar = main.find('|');
    a.topic = main.substr(0, bar);
    if (bar != std::string::npos) {
        a.hasPath = true;
        a.path = main.substr(bar + 1);
        if (!parsePath(a.path, a.steps)) return fail("E_ADDR_SYNTAX");
    }
    if (!validFilter(a.topic, &a.wildcard)) return fail("E_ADDR_SYNTAX");
    if (a.dir != Direction::Subscribe && (a.wildcard || a.topic[0] == '$'))
        return fail("E_ADDR_SYNTAX");
    a.ok = true;
    return a;
}

bool topicMatches(const std::string& filter, const std::string& topic) {
    if (!topic.empty() && topic[0] == '$' && !filter.empty() &&
        (filter[0] == '+' || filter[0] == '#'))
        return false;
    size_t f = 0, t = 0;
    while (true) {
        const size_t fe = filter.find('/', f);
        const size_t te = topic.find('/', t);
        const std::string fl =
            filter.substr(f, fe == std::string::npos ? std::string::npos : fe - f);
        if (fl == "#") return true;
        const std::string tl =
            topic.substr(t, te == std::string::npos ? std::string::npos : te - t);
        if (fl != "+" && fl != tl) return false;
        if (fe == std::string::npos && te == std::string::npos) return true;
        if (fe == std::string::npos) return false;
        if (te == std::string::npos) {
            // "a/#" matches "a": the filter's next level must be the last and be '#'
            return filter.substr(fe + 1) == "#";
        }
        f = fe + 1;
        t = te + 1;
    }
}

bool validPublishTopic(const std::string& topic) {
    return !topic.empty() && topic.find_first_of("+#") == std::string::npos &&
           topic.find('\0') == std::string::npos;
}

}  // namespace mat::mqtt
