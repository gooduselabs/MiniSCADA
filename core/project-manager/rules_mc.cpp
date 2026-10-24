#include "core/project-manager/rules_mc.hpp"

#include "core/tag-engine/tag_store.hpp"
#include "drivers/mc/mc_address.hpp"

namespace mat {

using nlohmann::json;

namespace {

bool isFormat11(const std::string& v) {
    if (v.compare(0, 4, "1.1.") != 0 || v.size() == 4) return false;
    for (size_t i = 4; i < v.size(); ++i)
        if (v[i] < '0' || v[i] > '9') return false;
    return true;
}

}  // namespace

void mcChannelChecks(const json& channel, const std::string& cp, const std::string& schemaVersion,
                     const std::string& connFile, const McIssueFn& add) {
    if (channel.value("kind", "") == "mc" && !isFormat11(schemaVersion))
        add("E_CHANNEL_VERSION", connFile, cp + "/kind",
            "channel kind 'mc' needs project format 1.1");
}

void mcTagChecks(const json& t, const std::string& p, const McTagCtx& ctx) {
    const json& src = t["source"];
    const json& dev = *ctx.device;
    const std::string devId = dev["id"];
    const std::string rawTypeName = src.contains("rawType") && !src["rawType"].is_null()
                                        ? src["rawType"].get<std::string>()
                                        : t["type"].get<std::string>();
    mc::McAddressOptions o;
    o.rawType = parseTagType(rawTypeName).value_or(TagType::UINT16);
    o.stringLength = src.contains("stringLength") ? src["stringLength"].get<int>() : 0;
    o.rw = t.value("access", "R") == "RW";
    o.xyOctal = dev.value("xyNotation", "hex") == "octal";
    const std::string address = src["address"];
    const mc::McAddress r = mc::parseMcAddress(address, o);
    if (!r.ok) {
        ctx.add(r.error.c_str(), ctx.tagFile, p + "/source/address",
                "address '" + address + "': " + r.error);
        return;
    }
    const std::string devPath =
        "/channels/" + std::to_string(ctx.ci) + "/devices/" + std::to_string(ctx.di);
    if (r.words > dev.value("maxBatchWords", 960))
        ctx.add("E_ADDR_READ_LIMIT", ctx.tagFile, p + "/source",
                "the tag needs " + std::to_string(r.words) + " words, more than one read allows");
    if (r.bit >= 0 && o.rw) {
        const std::string mode =
            dev.contains("write") ? dev["write"].value("registerBit", "none") : "none";
        if (mode == "none")
            ctx.add("E_BIT_WRITE", ctx.tagFile, p + "/source/address",
                    "device '" + devId + "' does not allow bit writes (write.registerBit is none)");
        else if (ctx.bitRmwSeen->insert(devId).second)
            ctx.warn("W_BIT_RMW", ctx.connFile, devPath,
                     "device '" + devId + "' writes bits by read-modify-write");
    }
    const std::string group = src.value("scanGroup", "normal");
    const auto it = ctx.scanGroups->find(group);
    const double period = it == ctx.scanGroups->end() ? 1000.0 : it->second;
    const double retries = dev.value("retries", 0.0);
    const double timeout = dev.value("timeoutMs", 1000.0);
    if (!ctx.slowSeen->count(devId) && timeout * (retries + 1) > period) {
        ctx.slowSeen->insert(devId);
        ctx.warn("W_DETECT_SLOW", ctx.connFile, devPath,
                 "timeoutMs x (retries + 1) exceeds the " + group + " scan period");
    }
}

}  // namespace mat
