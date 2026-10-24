#include "drivers/opcua/opcua_driver.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <exception>
#include <thread>

#include "core/common/thread_name.hpp"
#include "drivers/opcua/status_map.hpp"
#include "drivers/opcua/value_codec.hpp"
#include "open62541.h"

namespace mat::drv {

namespace {

constexpr uint32_t kIterateMs = 50;  // the longest UA_Client_run_iterate waits
constexpr const char* kPolicyNone = "http://opcfoundation.org/UA/SecurityPolicy#None";
constexpr const char* kPolicyBasic256Sha256 =
    "http://opcfoundation.org/UA/SecurityPolicy#Basic256Sha256";
const char* const kGroupNames[3] = {"fast", "normal", "slow"};

std::vector<std::string> deviceIds(const OpcUaConfig& c) {
    return c.hasDevice ? std::vector<std::string>{c.deviceId} : std::vector<std::string>{};
}

UA_NodeId parseNode(const std::string& s) {
    UA_NodeId id;
    UA_NodeId_init(&id);
    UA_String str;
    str.length = s.size();
    str.data = reinterpret_cast<UA_Byte*>(const_cast<char*>(s.data()));
    if (UA_NodeId_parse(&id, str) != UA_STATUSCODE_GOOD) UA_NodeId_init(&id);
    return id;
}

// A status that means the session or the connection is gone (not a fault of one node).
bool connectionLost(UA_StatusCode s) {
    switch (s) {
        case UA_STATUSCODE_BADCONNECTIONCLOSED:
        case UA_STATUSCODE_BADSECURECHANNELCLOSED:
        case UA_STATUSCODE_BADSECURECHANNELIDINVALID:
        case UA_STATUSCODE_BADSESSIONCLOSED:
        case UA_STATUSCODE_BADSESSIONIDINVALID:
        case UA_STATUSCODE_BADSESSIONNOTACTIVATED:
        case UA_STATUSCODE_BADNOTCONNECTED:
        case UA_STATUSCODE_BADDISCONNECT:
        case UA_STATUSCODE_BADCOMMUNICATIONERROR:
        case UA_STATUSCODE_BADSERVERHALTED:
        case UA_STATUSCODE_BADSHUTDOWN:
        case UA_STATUSCODE_BADINTERNALERROR:
            return true;
        default:
            return false;
    }
}

// open62541 trampolines: the client context is the driver.
OpcUaDriver* driverOf(UA_Client* client) {
    return static_cast<OpcUaDriver*>(UA_Client_getConfig(client)->clientContext);
}

void dataChangeCb(UA_Client* client, UA_UInt32, void*, UA_UInt32, void* monContext,
                  UA_DataValue* value) {
    driverOf(client)->onDataChange(reinterpret_cast<uintptr_t>(monContext), value);
}

void subscriptionDeletedCb(UA_Client* client, UA_UInt32, void*) {
    driverOf(client)->onSubscriptionLost();
}

void subscriptionInactiveCb(UA_Client* client, UA_UInt32, void*) {
    driverOf(client)->onSubscriptionLost();
}

UA_StatusCode verifyCertCb(const UA_CertificateVerification* cv, const UA_ByteString* cert) {
    auto* d = static_cast<OpcUaDriver*>(cv->context);
    return d->verifyServerCert(cert->data, cert->length) ? UA_STATUSCODE_GOOD
                                                         : UA_STATUSCODE_BADCERTIFICATEUNTRUSTED;
}

UA_StatusCode verifyUriCb(const UA_CertificateVerification*, const UA_ByteString*,
                          const UA_String*) {
    return UA_STATUSCODE_GOOD;  // the pin decides (spec D10)
}

}  // namespace

OpcUaDriver::OpcUaDriver(OpcUaConfig config, OpcUaEnv env)
    : cfg_(std::move(config)),
      env_(std::move(env)),
      clock_(env_.clock ? env_.clock : &systemClock_),
      diag_(cfg_.channelId, deviceIds(cfg_)),
      backoff_(cfg_.reconnectMaxS, env_.uniform),
      lastBad_(cfg_.tags.size()),
      serverType_(cfg_.tags.size(), nullptr) {
    if (env_.batch < 1) env_.batch = 1;
    if (env_.applicationUri.empty()) env_.applicationUri = opcua::defaultApplicationUri();
    for (size_t i = 0; i < cfg_.tags.size(); ++i) localOf_[cfg_.tags[i].tag] = i;
    const bool on = cfg_.hasDevice && cfg_.deviceEnabled;
    deviceState_ = static_cast<int>(on ? DeviceState::Active : DeviceState::Disabled);
    if (cfg_.hasDevice) diag_.setDeviceState(0, on ? "active" : "disabled");
    readMode_ = cfg_.poll ? "poll" : "subscription";
    updateDetails();
}

OpcUaDriver::~OpcUaDriver() { stop(); }

// ---- State and publishing -----------------------------------------------------------------------

void OpcUaDriver::setChannelState(ChannelState s) {
    channelState_ = static_cast<int>(s);
    static const char* const kNames[] = {"disabled", "connecting", "opening", "connected", "error"};
    diag_.setChannelState(kNames[static_cast<int>(s)]);
}

void OpcUaDriver::setDeviceState(DeviceState s) {
    if (!cfg_.hasDevice) return;
    if (deviceState_.exchange(static_cast<int>(s)) == static_cast<int>(s)) return;
    diag_.setDeviceState(
        0, s == DeviceState::Active ? "active" : s == DeviceState::Error ? "error" : "disabled");
}

LinkState OpcUaDriver::linkState(uint32_t device) const {
    LinkState s;
    s.channel = static_cast<ChannelState>(channelState_.load());
    s.device = device == 0 ? static_cast<DeviceState>(deviceState_.load()) : DeviceState::Disabled;
    return s;
}

void OpcUaDriver::updateDetails() {
    std::string pubs;
    {
        std::lock_guard<std::mutex> g(detailsMu_);
        pubs = publishing_;
    }
    const char* mode =
        cfg_.securityMode == OpcUaSecurityMode::None
            ? "None"
            : cfg_.securityMode == OpcUaSecurityMode::Sign ? "Sign" : "SignAndEncrypt";
    std::vector<std::pair<std::string, std::string>> d = {
        {"endpointUrl", cfg_.endpointUrl},
        {"securityMode", mode},
        {"securityPolicy", cfg_.basic256Sha256 ? "Basic256Sha256" : "None"},
        {"readMode", readMode_},
        {"session", client_ && channelState_.load() == static_cast<int>(ChannelState::Connected)
                        ? "active"
                        : "none"},
    };
    if (!seenCertSha256_.empty()) d.emplace_back("serverCertSha256", seenCertSha256_);
    if (haveIdentity_) d.emplace_back("clientCertSha256", identity_.sha256);
    if (!pubs.empty()) d.emplace_back("publishingMs", pubs);
    if (!lastStatus_.empty()) d.emplace_back("lastStatus", lastStatus_);
    diag_.setDetails(std::move(d));
}

void OpcUaDriver::diagnostics(DriverDiag& out, int64_t /*nowMs*/) const {
    out = diag_.snapshot(clock_->monoMs());
    if (out.devices.empty()) return;
    out.devices[0].groups.clear();
    for (int g = 0; g < 3; ++g) {
        bool any = false;
        for (const auto& t : cfg_.tags)
            if (static_cast<int>(t.group) == g) any = true;
        if (!any) continue;
        GroupDiag gd;
        gd.name = kGroupNames[g];
        gd.periodMs = cfg_.scanMs[static_cast<size_t>(g)];
        out.devices[0].groups.push_back(gd);
    }
}

TestOutcome OpcUaDriver::test(const TestRequest& /*req*/) {
    TestOutcome out;
    out.code = "NOT_SUPPORTED";
    return out;
}

void OpcUaDriver::publishBad(const std::vector<size_t>& locals, const std::string& reason) {
    std::vector<TagUpdate> ups;
    const int64_t w = wall();
    for (size_t t : locals) {
        if (lastBad_[t] == reason) continue;
        lastBad_[t] = reason;
        TagUpdate u;
        u.tag = cfg_.tags[t].tag;
        u.quality = Quality::BAD;
        u.reason = reason;
        u.sourceTs = w;
        ups.push_back(std::move(u));
    }
    if (!ups.empty() && sink_) sink_->publish(std::move(ups));
}

void OpcUaDriver::publishBadAll(const std::string& reason) {
    if (!cfg_.deviceEnabled) return;  // DISABLED stays
    std::vector<size_t> all(cfg_.tags.size());
    for (size_t i = 0; i < all.size(); ++i) all[i] = i;
    publishBad(all, reason);
}

void OpcUaDriver::noteStatus(uint32_t status) { lastStatus_ = opcua::statusName(status); }

void OpcUaDriver::addValue(size_t local, const void* value, std::vector<TagUpdate>& out,
                           bool afterWrite) {
    const auto* dv = static_cast<const UA_DataValue*>(value);
    if (local >= cfg_.tags.size() || !dv) return;
    const OpcUaTagBinding& b = cfg_.tags[local];
    TagUpdate u;
    u.tag = b.tag;
    u.sourceTs = wall();
    u.afterWrite = afterWrite;
    const uint32_t status = dv->hasStatus ? dv->status : UA_STATUSCODE_GOOD;
    const opcua::StatusQuality q = opcua::qualityOf(status);
    if (q.quality == Quality::BAD) {
        noteStatus(status);
        if (lastBad_[local] == q.reason && !afterWrite) return;
        lastBad_[local] = q.reason;
        u.quality = Quality::BAD;
        u.reason = q.reason;
        out.push_back(std::move(u));
        return;
    }
    if (!dv->hasValue || !dv->value.type) {
        if (q.quality == Quality::UNCERTAIN) {
            lastBad_[local].clear();
            u.quality = Quality::UNCERTAIN;
            u.reason = q.reason;
            out.push_back(std::move(u));
        }
        return;  // Good without a value: nothing new
    }
    if (UA_Variant_isScalar(&dv->value)) serverType_[local] = dv->value.type;
    TagScalar v;
    if (!opcua::decodeVariant(dv->value, b.rawType, v)) {
        if (lastBad_[local] == "OPCUA_TYPE_MISMATCH" && !afterWrite) return;
        lastBad_[local] = "OPCUA_TYPE_MISMATCH";
        u.quality = Quality::BAD;
        u.reason = "OPCUA_TYPE_MISMATCH";
        out.push_back(std::move(u));
        return;
    }
    lastBad_[local].clear();
    u.value = std::move(v);
    u.quality = q.quality;
    if (q.quality == Quality::UNCERTAIN) u.reason = q.reason;
    out.push_back(std::move(u));
}

void OpcUaDriver::onDataChange(size_t local, const void* value) {
    addValue(local, value, pending_);
}

void OpcUaDriver::onSubscriptionLost() {
    if (client_) lost_ = true;
}

bool OpcUaDriver::verifyServerCert(const uint8_t* der, size_t size) {
    seenCertSha256_ = opcua::sha256Hex(der, size);
    const bool ok = !cfg_.serverCertSha256.empty() && seenCertSha256_ == cfg_.serverCertSha256;
    if (!ok) certRejected_ = true;
    if (ok) {
        const opcua::CertInfo info = opcua::certInfo(der, size);
        if (info.ok && info.notAfterMs > 0 && info.notAfterMs < wall())
            diag_.addWarning("OPCUA_SERVER_CERT_EXPIRED");
    }
    return ok;
}

void OpcUaDriver::flushUpdates() {
    if (pending_.empty()) return;
    if (sink_) sink_->publish(std::move(pending_));
    pending_.clear();
}

// ---- The connection -----------------------------------------------------------------------------

void OpcUaDriver::closeClient() {
    if (!client_) return;
    UA_Client* c = client_;
    client_ = nullptr;  // callbacks from the disconnect see no client: no `lost_`
    UA_Client_disconnect(c);
    UA_Client_delete(c);
    for (auto& g : groups_) g = Group();
    pending_.clear();
}

void OpcUaDriver::failConnect(const std::string& code, const std::string& reason) {
    closeClient();
    diag_.setLastError(code, wall());
    setChannelState(ChannelState::Error);
    setDeviceState(DeviceState::Error);
    publishBadAll(reason);
    failQueuedWrites("NOT_SENT_DISCONNECTED");
    nextConnectMs_ = mono() + backoff_.nextDelayMs();
    updateDetails();
}

void OpcUaDriver::dropConnection(const std::string& code) {
    closeClient();
    diag_.setLastError(code, wall());
    setChannelState(ChannelState::Error);
    setDeviceState(DeviceState::Error);
    publishBadAll("DISCONNECTED");
    failQueuedWrites("NOT_SENT_DISCONNECTED");
    nextConnectMs_ = mono() + backoff_.nextDelayMs();
    updateDetails();
}

bool OpcUaDriver::connectNow() {
    setChannelState(ChannelState::Connecting);
    lost_ = false;
    certRejected_ = false;
    const bool secure = cfg_.securityMode != OpcUaSecurityMode::None;
    // The client certificate: for a secure channel, and to encrypt a password for the server.
    if ((secure || cfg_.authUsername) && !haveIdentity_) {
        std::string err;
        if (!opcua::clientIdentity(env_.certDir, env_.applicationUri, identity_, err)) {
            std::fprintf(stderr, "opcua %s: %s\n", cfg_.channelId.c_str(), err.c_str());
            failConnect("OPCUA_SECURITY_REJECTED", "OPCUA_SECURITY_REJECTED");
            return false;
        }
        haveIdentity_ = true;
    }
    std::string password;
    if (cfg_.authUsername) {
        const std::optional<std::string> p =
            env_.password ? env_.password(cfg_.secretId) : std::nullopt;
        if (!p) {
            failConnect("OPCUA_SECRET_MISSING", "OPCUA_SECRET_MISSING");
            return false;
        }
        password = *p;
    }

    UA_ClientConfig cc;
    std::memset(&cc, 0, sizeof cc);
    cc.logging = UA_Log_Stdout_new(static_cast<UA_LogLevel>(opcua::logLevel()));
    UA_ClientConfig_setDefault(&cc);
    cc.timeout = static_cast<UA_UInt32>(cfg_.timeoutMs);
    cc.requestedSessionTimeout = static_cast<UA_UInt32>(cfg_.sessionTimeoutMs);
    // the client reopens its channel once while connecting (from the None channel of GetEndpoints
    // to the secure one); after that the driver reconnects itself (spec D8): noReconnect below
    cc.noReconnect = false;
    cc.noNewSession = true;
    cc.clientContext = this;
    cc.subscriptionInactivityCallback = &subscriptionInactiveCb;
    UA_String_clear(&cc.clientDescription.applicationUri);
    cc.clientDescription.applicationUri = UA_STRING_ALLOC(env_.applicationUri.c_str());
    UA_LocalizedText_clear(&cc.clientDescription.applicationName);
    cc.clientDescription.applicationName = UA_LOCALIZEDTEXT_ALLOC("en-US", "mAT SCADA");
    cc.securityMode = cfg_.securityMode == OpcUaSecurityMode::None
                          ? UA_MESSAGESECURITYMODE_NONE
                          : cfg_.securityMode == OpcUaSecurityMode::Sign
                                ? UA_MESSAGESECURITYMODE_SIGN
                                : UA_MESSAGESECURITYMODE_SIGNANDENCRYPT;
    cc.securityPolicyUri =
        UA_STRING_ALLOC(cfg_.basic256Sha256 ? kPolicyBasic256Sha256 : kPolicyNone);
    if (haveIdentity_) {
        UA_ByteString cert, key;
        cert.length = identity_.cert.size();
        cert.data = identity_.cert.data();
        key.length = identity_.key.size();
        key.data = identity_.key.data();
        const UA_StatusCode st =
            UA_ClientConfig_setDefaultEncryption(&cc, cert, key, nullptr, 0, nullptr, 0);
        if (st != UA_STATUSCODE_GOOD) {
            noteStatus(st);
            UA_ClientConfig_clear(&cc);
            failConnect("OPCUA_SECURITY_REJECTED", "OPCUA_SECURITY_REJECTED");
            return false;
        }
        // The pin replaces the trust list (spec D10).
        if (cc.certificateVerification.clear)
            cc.certificateVerification.clear(&cc.certificateVerification);
        std::memset(&cc.certificateVerification, 0, sizeof cc.certificateVerification);
        cc.certificateVerification.context = this;
        cc.certificateVerification.verifyCertificate = &verifyCertCb;
        cc.certificateVerification.verifyApplicationURI = &verifyUriCb;
        cc.certificateVerification.logging = cc.logging;
        updateDetails();
    }
    client_ = UA_Client_newWithConfig(&cc);
    if (!client_) {
        failConnect("REFUSED", "DISCONNECTED");
        return false;
    }
    if (cfg_.authUsername)
        UA_ClientConfig_setAuthenticationUsername(UA_Client_getConfig(client_),
                                                  cfg_.username.c_str(), password.c_str());

    UA_StatusCode st = UA_Client_connectAsync(client_, cfg_.endpointUrl.c_str());
    const int64_t deadline = mono() + cfg_.connectTimeoutMs;
    UA_SessionState ss = UA_SESSIONSTATE_CLOSED;
    UA_StatusCode cs = UA_STATUSCODE_GOOD;
    while (st == UA_STATUSCODE_GOOD && !stopping_) {
        UA_Client_run_iterate(client_, kIterateMs);
        UA_Client_getState(client_, nullptr, &ss, &cs);
        if (ss == UA_SESSIONSTATE_ACTIVATED) break;
        if (cs != UA_STATUSCODE_GOOD) {
            st = cs;
            break;
        }
        if (mono() >= deadline) {
            st = UA_STATUSCODE_BADTIMEOUT;
            break;
        }
    }
    if (stopping_) {
        closeClient();
        return false;
    }
    if (ss != UA_SESSIONSTATE_ACTIVATED) {
        noteStatus(st);
        if (certRejected_)
            failConnect("OPCUA_CERT_UNTRUSTED", "OPCUA_CERT_UNTRUSTED");
        else if (std::strcmp(opcua::connectFailureCode(st), "REFUSED") == 0 ||
                 std::strcmp(opcua::connectFailureCode(st), "TIMEOUT") == 0)
            failConnect(opcua::connectFailureCode(st), "DISCONNECTED");
        else
            failConnect(opcua::connectFailureCode(st), opcua::connectFailureCode(st));
        return false;
    }
    UA_Client_getConfig(client_)->noReconnect = true;
    backoff_.reset();
    setChannelState(ChannelState::Connected);
    if (cfg_.deviceEnabled) setDeviceState(DeviceState::Active);
    if (everConnected_) diag_.onReconnect();
    everConnected_ = true;
    setupReading();
    updateDetails();
    return true;
}

// ---- Reading ------------------------------------------------------------------------------------

void OpcUaDriver::setupReading() {
    std::array<std::vector<size_t>, 3> byGroup;
    for (size_t i = 0; i < cfg_.tags.size(); ++i)
        byGroup[static_cast<size_t>(cfg_.tags[i].group)].push_back(i);
    std::string pubs;
    bool anySub = false, anyPoll = false;
    for (int g = 0; g < 3 && client_ && !lost_; ++g) {
        const auto& tags = byGroup[static_cast<size_t>(g)];
        Group& grp = groups_[static_cast<size_t>(g)];
        grp = Group();
        if (!tags.empty()) {
            if (cfg_.poll)
                grp.polled = tags;
            else
                subscribeGroup(g, tags);
            grp.nextPollMs = mono();
            if (grp.subscribed) anySub = true;
            if (!grp.polled.empty()) anyPoll = true;
        }
        if (g) pubs += "/";
        pubs += std::to_string(grp.subscribed ? static_cast<int64_t>(std::llround(grp.revisedMs))
                                              : cfg_.scanMs[static_cast<size_t>(g)]);
    }
    {
        std::lock_guard<std::mutex> l(detailsMu_);
        publishing_ = pubs;
    }
    readMode_ = anySub && anyPoll ? "subscription+poll" : anySub ? "subscription" : "poll";
    if (cfg_.poll) readMode_ = "poll";
}

void OpcUaDriver::subscribeGroup(int g, const std::vector<size_t>& tags) {
    Group& grp = groups_[static_cast<size_t>(g)];
    const double period = static_cast<double>(cfg_.scanMs[static_cast<size_t>(g)]);
    UA_CreateSubscriptionRequest req = UA_CreateSubscriptionRequest_default();
    req.requestedPublishingInterval = period;
    // keep-alive about every 5 s (at least every period), lifetime three keep-alives
    const UA_UInt32 keepAlive =
        static_cast<UA_UInt32>(std::max(1.0, std::ceil(5000.0 / std::max(period, 1.0))));
    req.requestedMaxKeepAliveCount = keepAlive;
    req.requestedLifetimeCount = keepAlive * 3;
    req.maxNotificationsPerPublish = 0;
    const int64_t t0 = mono();
    UA_CreateSubscriptionResponse sr =
        UA_Client_Subscriptions_create(client_, req, nullptr, nullptr, &subscriptionDeletedCb);
    const UA_StatusCode st = sr.responseHeader.serviceResult;
    if (st != UA_STATUSCODE_GOOD) {
        noteStatus(st);
        if (connectionLost(st) || st == UA_STATUSCODE_BADTIMEOUT) {
            lost_ = true;
            return;
        }
        // the server refuses subscriptions: read this group by Read requests (spec D6)
        grp.polled = tags;
        if (!fallbackWarned_) {
            diag_.addWarning("OPCUA_SUBSCRIPTION_FALLBACK");
            fallbackWarned_ = true;
        }
        return;
    }
    diag_.onRequestOk(0, mono() - t0, mono());
    grp.subscribed = true;
    grp.subscriptionId = sr.subscriptionId;
    grp.revisedMs = sr.revisedPublishingInterval;

    std::vector<size_t> refused;
    for (size_t from = 0; from < tags.size() && !lost_; from += static_cast<size_t>(env_.batch)) {
        const size_t n = std::min(tags.size() - from, static_cast<size_t>(env_.batch));
        std::vector<UA_NodeId> ids(n);
        std::vector<UA_MonitoredItemCreateRequest> items(n);
        std::vector<void*> ctx(n);
        std::vector<UA_Client_DataChangeNotificationCallback> cbs(n, &dataChangeCb);
        std::vector<UA_Client_DeleteMonitoredItemCallback> dels(n, nullptr);
        for (size_t k = 0; k < n; ++k) {
            const size_t local = tags[from + k];
            ids[k] = parseNode(cfg_.tags[local].nodeId);
            items[k] = UA_MonitoredItemCreateRequest_default(ids[k]);
            items[k].requestedParameters.samplingInterval = period;
            items[k].requestedParameters.queueSize = 1;
            items[k].requestedParameters.discardOldest = true;
            ctx[k] = reinterpret_cast<void*>(static_cast<uintptr_t>(local));
        }
        UA_CreateMonitoredItemsRequest mr;
        UA_CreateMonitoredItemsRequest_init(&mr);
        mr.subscriptionId = grp.subscriptionId;
        mr.timestampsToReturn = UA_TIMESTAMPSTORETURN_NEITHER;
        mr.itemsToCreate = items.data();
        mr.itemsToCreateSize = n;
        const int64_t t1 = mono();
        UA_CreateMonitoredItemsResponse resp = UA_Client_MonitoredItems_createDataChanges(
            client_, mr, ctx.data(), cbs.data(), dels.data());
        const UA_StatusCode ms = resp.responseHeader.serviceResult;
        if (ms != UA_STATUSCODE_GOOD) {
            noteStatus(ms);
            if (connectionLost(ms) || ms == UA_STATUSCODE_BADTIMEOUT) {
                lost_ = true;
            } else {
                for (size_t k = 0; k < n; ++k) refused.push_back(tags[from + k]);
            }
        } else {
            diag_.onRequestOk(0, mono() - t1, mono());
            std::vector<size_t> bad;
            for (size_t k = 0; k < n && k < resp.resultsSize; ++k) {
                const UA_StatusCode is = resp.results[k].statusCode;
                if (is == UA_STATUSCODE_GOOD) continue;
                noteStatus(is);
                if (is == UA_STATUSCODE_BADTOOMANYMONITOREDITEMS ||
                    is == UA_STATUSCODE_BADSERVICEUNSUPPORTED) {
                    refused.push_back(tags[from + k]);
                    continue;
                }
                std::vector<TagUpdate> ups;
                UA_DataValue dv;
                UA_DataValue_init(&dv);
                dv.hasStatus = true;
                dv.status = is;
                addValue(tags[from + k], &dv, ups);
                if (!ups.empty() && sink_) sink_->publish(std::move(ups));
            }
        }
        UA_CreateMonitoredItemsResponse_clear(&resp);
        for (auto& id : ids) UA_NodeId_clear(&id);
    }
    if (!refused.empty()) {
        grp.polled.insert(grp.polled.end(), refused.begin(), refused.end());
        if (!fallbackWarned_) {
            diag_.addWarning("OPCUA_SUBSCRIPTION_FALLBACK");
            fallbackWarned_ = true;
        }
    }
}

void OpcUaDriver::readNodes(const std::vector<size_t>& locals, std::vector<TagUpdate>& out) {
    for (size_t from = 0; from < locals.size() && client_ && !lost_;
         from += static_cast<size_t>(env_.batch)) {
        const size_t n = std::min(locals.size() - from, static_cast<size_t>(env_.batch));
        std::vector<UA_ReadValueId> rv(n);
        for (size_t k = 0; k < n; ++k) {
            UA_ReadValueId_init(&rv[k]);
            rv[k].nodeId = parseNode(cfg_.tags[locals[from + k]].nodeId);
            rv[k].attributeId = UA_ATTRIBUTEID_VALUE;
        }
        UA_ReadRequest req;
        UA_ReadRequest_init(&req);
        req.nodesToRead = rv.data();
        req.nodesToReadSize = n;
        req.timestampsToReturn = UA_TIMESTAMPSTORETURN_NEITHER;
        const int64_t t0 = mono();
        UA_ReadResponse resp = UA_Client_Service_read(client_, req);
        const UA_StatusCode st = resp.responseHeader.serviceResult;
        if (st == UA_STATUSCODE_GOOD) {
            diag_.onRequestOk(0, mono() - t0, mono());
            for (size_t k = 0; k < n && k < resp.resultsSize; ++k)
                addValue(locals[from + k], &resp.results[k], out);
        } else {
            noteStatus(st);
            if (st == UA_STATUSCODE_BADTIMEOUT) {
                diag_.onTimeout(0);
                lost_ = true;
            } else if (connectionLost(st)) {
                lost_ = true;
            } else if (st == UA_STATUSCODE_BADTOOMANYOPERATIONS && env_.batch > 1) {
                env_.batch = std::max(1, env_.batch / 2);  // the server's MaxNodesPerRead
            } else {
                std::vector<size_t> part(locals.begin() + static_cast<long>(from),
                                         locals.begin() + static_cast<long>(from + n));
                for (size_t l : part) {
                    UA_DataValue dv;
                    UA_DataValue_init(&dv);
                    dv.hasStatus = true;
                    dv.status = st;
                    addValue(l, &dv, out);
                }
            }
        }
        UA_ReadResponse_clear(&resp);
        for (auto& r : rv) UA_NodeId_clear(&r.nodeId);
    }
}

void OpcUaDriver::pollDue() {
    for (int g = 0; g < 3; ++g) {
        Group& grp = groups_[static_cast<size_t>(g)];
        if (grp.polled.empty() || mono() < grp.nextPollMs) continue;
        const int64_t period = cfg_.scanMs[static_cast<size_t>(g)];
        grp.nextPollMs += period;
        if (grp.nextPollMs <= mono()) grp.nextPollMs = mono() + period;  // overrun: no burst
        std::vector<TagUpdate> ups;
        readNodes(grp.polled, ups);
        if (!ups.empty() && sink_) sink_->publish(std::move(ups));
        if (lost_ || !client_) return;
    }
}

// ---- Writes -------------------------------------------------------------------------------------

bool OpcUaDriver::enqueueWrite(WriteCommand cmd) {
    if (!started_ || stopping_ || !cfg_.enabled || !cfg_.deviceEnabled) return false;
    if (!localOf_.count(cmd.tag)) return false;
    std::lock_guard<std::mutex> g(wmu_);
    if (!cmd.priority && writes_.size() >= static_cast<size_t>(cfg_.writeQueueCapacity))
        return false;
    if (cmd.priority)
        writes_.push_front({std::move(cmd), mono()});
    else
        writes_.push_back({std::move(cmd), mono()});
    return true;
}

std::vector<uint64_t> OpcUaDriver::cancelQueuedWrites() {
    std::vector<uint64_t> ids;
    std::lock_guard<std::mutex> g(wmu_);
    for (const auto& w : writes_) ids.push_back(w.cmd.id);
    writes_.clear();
    return ids;
}

void OpcUaDriver::finishWrite(WriteResult&& r) {
    WriteOutcome o = WriteOutcome::Failed;
    if (r.status == WriteStatus::Confirmed || r.status == WriteStatus::NoReadback)
        o = WriteOutcome::Confirmed;
    else if (r.status == WriteStatus::Timeout)
        o = WriteOutcome::Timeout;
    if (cfg_.hasDevice) diag_.onWrite(0, o);
    if (!stopping_ && sink_) sink_->writeDone(std::move(r));
}

void OpcUaDriver::failQueuedWrites(const char* code) {
    std::deque<QueuedWrite> q;
    {
        std::lock_guard<std::mutex> g(wmu_);
        q.swap(writes_);
    }
    for (auto& w : q) {
        WriteResult r;
        r.id = w.cmd.id;
        r.status = WriteStatus::Failed;
        r.code = code;
        finishWrite(std::move(r));
    }
}

// The data type of the node, read once when no value has come yet.
bool OpcUaDriver::learnType(size_t local) {
    if (serverType_[local]) return true;
    std::vector<TagUpdate> ups;
    readNodes({local}, ups);
    if (!ups.empty() && sink_) sink_->publish(std::move(ups));
    return serverType_[local] != nullptr;
}

void OpcUaDriver::runWrite() {
    QueuedWrite w;
    {
        std::lock_guard<std::mutex> g(wmu_);
        if (writes_.empty()) return;
        w = std::move(writes_.front());
        writes_.pop_front();
    }
    WriteResult res;
    res.id = w.cmd.id;
    res.status = WriteStatus::Failed;
    const auto it = localOf_.find(w.cmd.tag);
    if (it == localOf_.end()) {
        res.code = "NOT_SENT_UNSUPPORTED";
        finishWrite(std::move(res));
        return;
    }
    const size_t local = it->second;
    const OpcUaTagBinding& b = cfg_.tags[local];
    if (mono() - w.enqueuedMs > w.cmd.deadlineMs) {
        res.code = "NOT_SENT_DEADLINE";
        finishWrite(std::move(res));
        return;
    }
    if (!learnType(local)) {
        // the node gives no value: write the Tag's natural type, the server says if it fits
        if (lost_ || !client_) {
            res.code = "NOT_SENT_DISCONNECTED";
            finishWrite(std::move(res));
            return;
        }
    }
    const UA_DataType* type =
        serverType_[local] ? serverType_[local] : opcua::naturalType(b.rawType);
    UA_Variant value;
    if (!opcua::encodeVariant(w.cmd.raw, b.rawType, type, value)) {
        res.code = "NOT_SENT_UNSUPPORTED";
        finishWrite(std::move(res));
        return;
    }
    UA_WriteValue wv;
    UA_WriteValue_init(&wv);
    wv.nodeId = parseNode(b.nodeId);
    wv.attributeId = UA_ATTRIBUTEID_VALUE;
    wv.value.hasValue = true;
    wv.value.value = value;  // owned below
    UA_WriteRequest req;
    UA_WriteRequest_init(&req);
    req.nodesToWrite = &wv;
    req.nodesToWriteSize = 1;
    const int64_t t0 = mono();
    UA_WriteResponse resp = UA_Client_Service_write(client_, req);
    UA_Variant_clear(&value);
    UA_NodeId_clear(&wv.nodeId);
    UA_StatusCode st = resp.responseHeader.serviceResult;
    if (st == UA_STATUSCODE_GOOD && resp.resultsSize == 1) st = resp.results[0];
    UA_WriteResponse_clear(&resp);
    if (st == UA_STATUSCODE_BADTIMEOUT) {
        diag_.onTimeout(0);
        res.status = WriteStatus::Timeout;
        res.code = "WRITE_TIMEOUT";
        finishWrite(std::move(res));
        lost_ = true;
        return;
    }
    if (connectionLost(st)) {
        noteStatus(st);
        res.status = WriteStatus::Timeout;  // sent, the answer was lost: unknown outcome
        res.code = "WRITE_TIMEOUT";
        finishWrite(std::move(res));
        lost_ = true;
        return;
    }
    if (st != UA_STATUSCODE_GOOD) {
        noteStatus(st);
        diag_.setLastError("DEVICE_EXCEPTION", wall(), cfg_.deviceId);
        res.code = "DEVICE_EXCEPTION";
        finishWrite(std::move(res));
        updateDetails();
        return;
    }
    diag_.onRequestOk(0, mono() - t0, mono());
    if (!b.readback || !w.cmd.readback) {
        res.status = WriteStatus::NoReadback;
        res.code = "NO_READBACK";
        finishWrite(std::move(res));
        return;
    }
    // readback: one Read of the node
    UA_ReadValueId rv;
    UA_ReadValueId_init(&rv);
    rv.nodeId = parseNode(b.nodeId);
    rv.attributeId = UA_ATTRIBUTEID_VALUE;
    UA_ReadRequest rr;
    UA_ReadRequest_init(&rr);
    rr.nodesToRead = &rv;
    rr.nodesToReadSize = 1;
    rr.timestampsToReturn = UA_TIMESTAMPSTORETURN_NEITHER;
    UA_ReadResponse rresp = UA_Client_Service_read(client_, rr);
    UA_NodeId_clear(&rv.nodeId);
    const UA_StatusCode rs = rresp.responseHeader.serviceResult;
    if (rs != UA_STATUSCODE_GOOD || rresp.resultsSize != 1) {
        res.status = WriteStatus::Failed;
        res.code = rs == UA_STATUSCODE_BADTIMEOUT ? "READBACK_TIMEOUT" : "READBACK_ERROR";
        if (rs == UA_STATUSCODE_BADTIMEOUT || connectionLost(rs)) lost_ = true;
        UA_ReadResponse_clear(&rresp);
        finishWrite(std::move(res));
        return;
    }
    const UA_DataValue& dv = rresp.results[0];
    std::vector<TagUpdate> ups;
    addValue(local, &dv, ups, true);
    TagScalar back;
    const bool good = (!dv.hasStatus || UA_StatusCode_isGood(dv.status)) && dv.hasValue &&
                      opcua::decodeVariant(dv.value, b.rawType, back);
    UA_ReadResponse_clear(&rresp);
    if (!ups.empty() && sink_) sink_->publish(std::move(ups));
    if (!good) {
        res.code = "READBACK_ERROR";
        finishWrite(std::move(res));
        return;
    }
    res.readback = back;
    const bool match = opcua::sameRaw(back, w.cmd.raw, b.rawType);
    res.status = match ? WriteStatus::Confirmed : WriteStatus::Failed;
    res.code = match ? "CONFIRMED" : "READBACK_MISMATCH";
    finishWrite(std::move(res));
}

// ---- The thread ---------------------------------------------------------------------------------

void OpcUaDriver::start(EngineSink& sink) {
    if (started_) return;
    sink_ = &sink;
    started_ = true;
    stopping_ = false;
    if (!cfg_.enabled) {
        setChannelState(ChannelState::Disabled);
        publishBadAll("DISABLED");
        return;
    }
    if (!cfg_.deviceEnabled) {
        std::vector<size_t> all(cfg_.tags.size());
        for (size_t i = 0; i < all.size(); ++i) all[i] = i;
        publishBad(all, "DISABLED");
    }
    setChannelState(ChannelState::Connecting);
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setstacksize(&attr, 512 * 1024);
    if (pthread_create(&thread_, &attr, &OpcUaDriver::threadMain, this) == 0) threadRunning_ = true;
    pthread_attr_destroy(&attr);
    if (!threadRunning_) {
        std::fprintf(stderr, "opcua %s: cannot start the channel thread\n", cfg_.channelId.c_str());
        setChannelState(ChannelState::Error);
    }
}

void* OpcUaDriver::threadMain(void* self) {
    mat::setThreadName("mat-opcua");
    auto* d = static_cast<OpcUaDriver*>(self);
    try {
        d->loop();
    } catch (const std::exception& e) {
        std::fprintf(stderr, "opcua %s: %s\n", d->cfg_.channelId.c_str(), e.what());
        d->setChannelState(ChannelState::Error);
    }
    d->closeClient();
    return nullptr;
}

void OpcUaDriver::stop() {
    if (!started_) return;
    stopping_ = true;
    if (threadRunning_) {
        pthread_join(thread_, nullptr);
        threadRunning_ = false;
    }
    closeClient();
    started_ = false;
}

void OpcUaDriver::idle(int64_t untilMs) {
    while (!stopping_ && mono() < untilMs) {
        const int64_t step = std::min<int64_t>(untilMs - mono(), kIterateMs);
        std::this_thread::sleep_for(std::chrono::milliseconds(std::max<int64_t>(step, 1)));
        if (!client_) {
            std::lock_guard<std::mutex> g(wmu_);
            if (!writes_.empty()) break;  // fail them at once (not connected)
        }
    }
}

void OpcUaDriver::loop() {
    while (!stopping_) {
        if (!cfg_.hasDevice || !cfg_.deviceEnabled) {
            idle(mono() + 1000);
            continue;
        }
        if (!client_) {
            failQueuedWrites("NOT_SENT_DISCONNECTED");
            if (mono() < nextConnectMs_) {
                idle(nextConnectMs_);
                continue;
            }
            connectNow();
            continue;
        }
        bool wrote = false;
        {
            std::lock_guard<std::mutex> g(wmu_);
            wrote = !writes_.empty();
        }
        if (wrote) runWrite();
        if (!lost_) pollDue();
        if (!lost_ && client_) {
            // until the next poll, at most kIterateMs; at once when a write waits
            uint32_t wait = kIterateMs;
            for (const Group& g : groups_)
                if (!g.polled.empty())
                    wait = static_cast<uint32_t>(
                        std::min<int64_t>(wait, std::max<int64_t>(0, g.nextPollMs - mono())));
            {
                std::lock_guard<std::mutex> g(wmu_);
                if (!writes_.empty()) wait = 0;
            }
            const UA_StatusCode st = UA_Client_run_iterate(client_, wait);
            flushUpdates();
            UA_SessionState ss = UA_SESSIONSTATE_CLOSED;
            UA_StatusCode cs = UA_STATUSCODE_GOOD;
            UA_Client_getState(client_, nullptr, &ss, &cs);
            if (st != UA_STATUSCODE_GOOD || ss != UA_SESSIONSTATE_ACTIVATED ||
                cs != UA_STATUSCODE_GOOD) {
                noteStatus(cs != UA_STATUSCODE_GOOD ? cs : st);
                lost_ = true;
            }
        }
        if (lost_) dropConnection("DISCONNECTED");
    }
}

}  // namespace mat::drv
