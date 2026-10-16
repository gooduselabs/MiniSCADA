#include "server/ssh_audit.hpp"

#include <glob.h>

#include <fstream>
#include <optional>
#include <sstream>
#include <string_view>

namespace mat {

namespace {

constexpr int kMaxIncludeDepth = 16;  // as sshd (READCONF_MAX_DEPTH)
constexpr size_t kMaxFileBytes = 256 * 1024;

std::string lower(std::string s) {
    for (char& c : s)
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    return s;
}

bool isSpace(char c) { return c == ' ' || c == '\t' || c == '\r'; }

// The words of a line as sshd splits them: whitespace, an optional `=` after the keyword, double
// quotes around an argument. A `#` at the start of a word ends the line.
std::vector<std::string> words(std::string_view line) {
    std::vector<std::string> out;
    size_t i = 0;
    const auto skipSpace = [&] {
        while (i < line.size() && isSpace(line[i])) ++i;
    };
    skipSpace();
    if (i >= line.size() || line[i] == '#') return out;
    std::string key;
    while (i < line.size() && !isSpace(line[i]) && line[i] != '=') key += line[i++];
    out.push_back(std::move(key));
    skipSpace();
    if (i < line.size() && line[i] == '=') ++i;  // "Keyword=value", "Keyword = value"
    for (;;) {
        skipSpace();
        if (i >= line.size() || line[i] == '#') break;
        std::string w;
        if (line[i] == '"') {
            const size_t end = line.find('"', i + 1);
            const size_t stop = end == std::string_view::npos ? line.size() : end;
            w = std::string(line.substr(i + 1, stop - i - 1));
            i = stop == line.size() ? stop : stop + 1;
        } else {
            while (i < line.size() && !isSpace(line[i])) w += line[i++];
        }
        out.push_back(std::move(w));
    }
    return out;
}

std::optional<std::string> readFile(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::nullopt;
    std::string text;
    char buf[4096];
    while (in.read(buf, sizeof buf) || in.gcount() > 0) {
        text.append(buf, static_cast<size_t>(in.gcount()));
        if (text.size() > kMaxFileBytes) break;  // not a configuration any more: what was read
    }
    if (in.bad()) return std::nullopt;
    return text;
}

struct Reader {
    std::string baseDir;  // relative Include paths start here (the folder of sshd_config)
    SshAuditResult& out;
    std::optional<std::string> permit, password;
    bool inMatch = false;

    // Expands one Include argument: a glob, sorted (glob(3) sorts by default).
    std::vector<std::string> expand(const std::string& pattern) const {
        const std::string full =
            !pattern.empty() && pattern[0] == '/' ? pattern : baseDir + "/" + pattern;
        std::vector<std::string> files;
        glob_t g{};
        if (::glob(full.c_str(), 0, nullptr, &g) == 0)
            for (size_t i = 0; i < g.gl_pathc; ++i) files.emplace_back(g.gl_pathv[i]);
        ::globfree(&g);
        return files;
    }

    // false: the file could not be read.
    bool read(const std::string& path, int depth) {
        const std::optional<std::string> text = readFile(path);
        if (!text) return false;
        out.files.push_back(path);
        std::istringstream lines(*text);
        std::string line;
        while (std::getline(lines, line)) {
            const std::vector<std::string> w = words(line);
            if (w.empty()) continue;
            const std::string key = lower(w[0]);
            if (key == "match") {
                inMatch = true;  // until the end of this file or the next Match (sshd)
                continue;
            }
            if (key == "include") {
                if (depth + 1 >= kMaxIncludeDepth) continue;
                for (size_t i = 1; i < w.size(); ++i)
                    for (const auto& f : expand(w[i])) {
                        const bool saved = inMatch;
                        read(f, depth + 1);  // an unreadable included file is left out
                        inMatch = saved;
                    }
                continue;
            }
            if (inMatch || w.size() < 2) continue;  // a Match block applies to some connections
            if (key == "permitrootlogin" && !permit) permit = lower(w[1]);
            if (key == "passwordauthentication" && !password) password = lower(w[1]);
        }
        return true;
    }
};

}  // namespace

SshAuditResult auditSshConfig(const std::string& mainPath) {
    SshAuditResult r;
    const size_t slash = mainPath.rfind('/');
    Reader reader{slash == std::string::npos ? std::string(".") : mainPath.substr(0, slash), r,
                  std::nullopt, std::nullopt};
    r.readable = reader.read(mainPath, 0);
    if (!r.readable) return r;
    if (reader.permit) r.permitRootLogin = *reader.permit;
    if (reader.password) r.passwordAuthentication = *reader.password;
    r.rootPassword = r.permitRootLogin == "yes" && r.passwordAuthentication != "no";
    return r;
}

void publishSshWarning(const SshAuditResult& r, SystemWarnings& warnings) {
    if (r.readable && r.rootPassword)
        warnings.set("SSH_ROOT_PASSWORD",
                     nlohmann::json{{"permitRootLogin", r.permitRootLogin},
                                    {"passwordAuthentication", r.passwordAuthentication}});
    else
        warnings.clear("SSH_ROOT_PASSWORD");
}

}  // namespace mat
