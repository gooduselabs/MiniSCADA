// Rules of the Mitsubishi MC channel (feature 017; specs/017-driver-mc/plan.md "Luật"), called by
// rules_02.cpp. The same rules as packages/project-schema/src/rules-mc.ts, on the shared vectors
// tests/project-vectors/v11-mc-* (README-017.md).
#pragma once
#include <functional>
#include <map>
#include <set>
#include <string>

#include "nlohmann/json.hpp"

namespace mat {

using McIssueFn = std::function<void(const char* code, const std::string& file,
                                     const std::string& path, const std::string& message)>;

// A channel of kind "mc" outside format 1.1: E_CHANNEL_VERSION at <cp>/kind.
void mcChannelChecks(const nlohmann::json& channel, const std::string& cp,
                     const std::string& schemaVersion, const std::string& connFile,
                     const McIssueFn& add);

struct McTagCtx {
    std::string tagFile, connFile;
    const nlohmann::json* device = nullptr;  // the field device of the Tag
    size_t ci = 0, di = 0;                   // its channel and its place in the channel
    const std::map<std::string, double>* scanGroups = nullptr;
    std::set<std::string>* bitRmwSeen = nullptr;  // shared with the Modbus rules
    std::set<std::string>* slowSeen = nullptr;
    McIssueFn add, warn;
};

// An external Tag of a field device of an "mc" channel, after the stringLength rules.
void mcTagChecks(const nlohmann::json& tag, const std::string& p, const McTagCtx& ctx);

}  // namespace mat
