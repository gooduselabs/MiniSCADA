#include "tools/opcua-sim/sim_server.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <fstream>
#include <future>
#include <iterator>
#include <mutex>
#include <thread>

#include "drivers/opcua/client_cert.hpp"
#include "drivers/opcua/status_map.hpp"
#include "drivers/opcua/value_codec.hpp"
#include "open62541.h"

namespace mat::opcuasim {

namespace {

constexpr const char* kUri = "urn:mat:opcua-sim";            // namespace 2
constexpr const char* kAppUri = "urn:mat:opcua-sim:server";  // the server (namespace 1)

struct TypeNode {
    const char* name;
    int type;  // UA_TYPES_*
    const char* initial;
};

const TypeNode kTypes[] = {
    {"Boolean", UA_TYPES_BOOLEAN, "true"},
    {"SByte", UA_TYPES_SBYTE, "-5"},
    {"Byte", UA_TYPES_BYTE, "200"},
    {"Int16", UA_TYPES_INT16, "-1234"},
    {"UInt16", UA_TYPES_UINT16, "54321"},
    {"Int32", UA_TYPES_INT32, "-123456"},
    {"UInt32", UA_TYPES_UINT32, "3000000000"},
    {"Int64", UA_TYPES_INT64, "-9000000000"},
    {"UInt64", UA_TYPES_UINT64, "18000000000000000000"},
    {"Float", UA_TYPES_FLOAT, "3.5"},
    {"Double", UA_TYPES_DOUBLE, "2.718281828"},
    {"String", UA_TYPES_STRING, "Xin chào"},
    {"DateTime", UA_TYPES_DATETIME, "2026-10-24T03:00:00.000Z"},
};

// `text` as a scalar of `type`.
bool fromText(const std::string& text, const UA_DataType* type, UA_Variant& out) {
    UA_Variant_init(&out);
    char* end = nullptr;
    switch (type->typeKind) {
        case UA_DATATYPEKIND_BOOLEAN: {
            UA_Boolean b = text == "true" || text == "1";
            if (!b && text != "false" && text != "0") return false;
            return UA_Variant_setScalarCopy(&out, &b, type) == UA_STATUSCODE_GOOD;
        }
        case UA_DATATYPEKIND_SBYTE:
        case UA_DATATYPEKIND_INT16:
        case UA_DATATYPEKIND_INT32:
        case UA_DATATYPEKIND_INT64: {
            const long long v = std::strtoll(text.c_str(), &end, 10);
            if (!end || *end) return false;
            UA_Int64 i64 = v;
            UA_Int32 i32 = static_cast<UA_Int32>(v);
            UA_Int16 i16 = static_cast<UA_Int16>(v);
            UA_SByte i8 = static_cast<UA_SByte>(v);
            const void* p = type->typeKind == UA_DATATYPEKIND_INT64
                                ? static_cast<void*>(&i64)
                                : type->typeKind == UA_DATATYPEKIND_INT32
                                      ? static_cast<void*>(&i32)
                                      : type->typeKind == UA_DATATYPEKIND_INT16
                                            ? static_cast<void*>(&i16)
                                            : static_cast<void*>(&i8);
            return UA_Variant_setScalarCopy(&out, p, type) == UA_STATUSCODE_GOOD;
        }
        case UA_DATATYPEKIND_BYTE:
        case UA_DATATYPEKIND_UINT16:
        case UA_DATATYPEKIND_UINT32:
        case UA_DATATYPEKIND_UINT64: {
            const unsigned long long v = std::strtoull(text.c_str(), &end, 10);
            if (!end || *end) return false;
            UA_UInt64 u64 = v;
            UA_UInt32 u32 = static_cast<UA_UInt32>(v);
            UA_UInt16 u16 = static_cast<UA_UInt16>(v);
            UA_Byte u8 = static_cast<UA_Byte>(v);
            const void* p = type->typeKind == UA_DATATYPEKIND_UINT64
                                ? static_cast<void*>(&u64)
                                : type->typeKind == UA_DATATYPEKIND_UINT32
                                      ? static_cast<void*>(&u32)
                                      : type->typeKind == UA_DATATYPEKIND_UINT16
                                            ? static_cast<void*>(&u16)
                                            : static_cast<void*>(&u8);
            return UA_Variant_setScalarCopy(&out, p, type) == UA_STATUSCODE_GOOD;
        }
        case UA_DATATYPEKIND_FLOAT:
        case UA_DATATYPEKIND_DOUBLE: {
            const double v = std::strtod(text.c_str(), &end);
            if (!end || *end) return false;
            UA_Float f = static_cast<UA_Float>(v);
            UA_Double d = v;
            return UA_Variant_setScalarCopy(&out,
                                            type->typeKind == UA_DATATYPEKIND_FLOAT
                                                ? static_cast<const void*>(&f)
                                                : static_cast<const void*>(&d),
                                            type) == UA_STATUSCODE_GOOD;
        }
        case UA_DATATYPEKIND_STRING: {
            UA_String s;
            s.length = text.size();
            s.data = reinterpret_cast<UA_Byte*>(const_cast<char*>(text.data()));
            return UA_Variant_setScalarCopy(&out, &s, type) == UA_STATUSCODE_GOOD;
        }
        case UA_DATATYPEKIND_DATETIME: {
            UA_DateTime t = 0;
            if (!opcua::parseIsoUtc(text, t)) return false;
            return UA_Variant_setScalarCopy(&out, &t, type) == UA_STATUSCODE_GOOD;
        }
        default:
            return false;
    }
}

std::string toText(const UA_Variant& v) {
    if (!v.type || !v.data || !UA_Variant_isScalar(&v)) return "";
    char b[64];
    switch (v.type->typeKind) {
        case UA_DATATYPEKIND_BOOLEAN:
            return *static_cast<const UA_Boolean*>(v.data) ? "true" : "false";
        case UA_DATATYPEKIND_SBYTE:
            return std::to_string(*static_cast<const UA_SByte*>(v.data));
        case UA_DATATYPEKIND_INT16:
            return std::to_string(*static_cast<const UA_Int16*>(v.data));
        case UA_DATATYPEKIND_INT32:
            return std::to_string(*static_cast<const UA_Int32*>(v.data));
        case UA_DATATYPEKIND_INT64:
            return std::to_string(*static_cast<const UA_Int64*>(v.data));
        case UA_DATATYPEKIND_BYTE:
            return std::to_string(*static_cast<const UA_Byte*>(v.data));
        case UA_DATATYPEKIND_UINT16:
            return std::to_string(*static_cast<const UA_UInt16*>(v.data));
        case UA_DATATYPEKIND_UINT32:
            return std::to_string(*static_cast<const UA_UInt32*>(v.data));
        case UA_DATATYPEKIND_UINT64:
            return std::to_string(*static_cast<const UA_UInt64*>(v.data));
        case UA_DATATYPEKIND_FLOAT:
            std::snprintf(b, sizeof b, "%.9g",
                          static_cast<double>(*static_cast<const UA_Float*>(v.data)));
            return b;
        case UA_DATATYPEKIND_DOUBLE:
            std::snprintf(b, sizeof b, "%.17g", *static_cast<const UA_Double*>(v.data));
            return b;
        case UA_DATATYPEKIND_STRING: {
            const auto* s = static_cast<const UA_String*>(v.data);
            return std::string(reinterpret_cast<const char*>(s->data), s->length);
        }
        case UA_DATATYPEKIND_DATETIME:
            return opcua::isoUtc(*static_cast<const UA_DateTime*>(v.data));
        default:
            return "";
    }
}

UA_NodeId parse(const std::string& s) {
    UA_NodeId id;
    UA_NodeId_init(&id);
    UA_String str;
    str.length = s.size();
    str.data = reinterpret_cast<UA_Byte*>(const_cast<char*>(s.data()));
    if (UA_NodeId_parse(&id, str) != UA_STATUSCODE_GOOD) UA_NodeId_init(&id);
    return id;
}

bool readFile(const std::string& path, std::vector<uint8_t>& out) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    out.assign(std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>());
    return !out.empty();
}

void writeFile(const std::string& path, const std::vector<uint8_t>& data) {
    std::ofstream f(path, std::ios::binary | std::ios::trunc);
    f.write(reinterpret_cast<const char*>(data.data()), static_cast<std::streamsize>(data.size()));
}

}  // namespace

struct SimServer::Impl {
    SimOptions opt;
    std::string error;
    UA_Server* server = nullptr;
    std::thread thread;
    std::atomic<bool> running{false};
    std::atomic<bool> stopFlag{false};
    std::vector<uint8_t> cert, key;
    std::string sha256;
    UA_UInt16 ns = 2;
    uint64_t tick = 0;
    std::mutex mu;
    std::deque<std::function<void()>> tasks;

    bool makeCert() {
        if (!opt.certDir.empty() && readFile(opt.certDir + "/server-cert.der", cert) &&
            readFile(opt.certDir + "/server-key.der", key))
            return true;
        const std::string subj[] = {"C=VN", "O=ATPro", "CN=mat-opcua-sim"};
        const std::string san[] = {std::string("URI:") + kAppUri, "DNS:localhost", "DNS:opcua-sim"};
        UA_String subject[3], alt[3];
        for (int i = 0; i < 3; ++i) {
            subject[i].length = subj[i].size();
            subject[i].data = reinterpret_cast<UA_Byte*>(const_cast<char*>(subj[i].data()));
            alt[i].length = san[i].size();
            alt[i].data = reinterpret_cast<UA_Byte*>(const_cast<char*>(san[i].data()));
        }
        UA_UInt16 bits = 2048, days = 3650;
        UA_KeyValuePair kv[2];
        kv[0].key = UA_QUALIFIEDNAME(0, const_cast<char*>("key-size-bits"));
        UA_Variant_setScalar(&kv[0].value, &bits, &UA_TYPES[UA_TYPES_UINT16]);
        kv[1].key = UA_QUALIFIEDNAME(0, const_cast<char*>("expires-in-days"));
        UA_Variant_setScalar(&kv[1].value, &days, &UA_TYPES[UA_TYPES_UINT16]);
        UA_KeyValueMap params = {2, kv};
        UA_ByteString k = UA_BYTESTRING_NULL, c = UA_BYTESTRING_NULL;
        UA_Logger* logger = UA_Log_Stdout_new(static_cast<UA_LogLevel>(opcua::logLevel()));
        const UA_StatusCode st = UA_CreateCertificate(logger, subject, 3, alt, 3,
                                                      UA_CERTIFICATEFORMAT_DER, &params, &k, &c);
        if (logger->clear) logger->clear(logger);
        if (st != UA_STATUSCODE_GOOD) {
            error = "cannot make the server certificate";
            return false;
        }
        cert.assign(c.data, c.data + c.length);
        key.assign(k.data, k.data + k.length);
        UA_ByteString_clear(&k);
        UA_ByteString_clear(&c);
        if (!opt.certDir.empty()) {
            writeFile(opt.certDir + "/server-cert.der", cert);
            writeFile(opt.certDir + "/server-key.der", key);
        }
        return true;
    }

    void addFolder(const UA_NodeId& id, const UA_NodeId& parent, const char* name) {
        UA_ObjectAttributes oa = UA_ObjectAttributes_default;
        oa.displayName = UA_LOCALIZEDTEXT(const_cast<char*>("en-US"), const_cast<char*>(name));
        const UA_StatusCode st = UA_Server_addObjectNode(
            server, id, parent, UA_NODEID_NUMERIC(0, UA_NS0ID_ORGANIZES),
            UA_QUALIFIEDNAME(ns, const_cast<char*>(name)),
            UA_NODEID_NUMERIC(0, UA_NS0ID_FOLDERTYPE), oa, nullptr, nullptr);
        if (st != UA_STATUSCODE_GOOD)
            std::fprintf(stderr, "mat-opcua-sim: folder %s: %s\n", name, UA_StatusCode_name(st));
    }

    void addVar(const UA_NodeId& id, const UA_NodeId& parent, const std::string& name,
                const UA_Variant& value, const UA_DataType* type, bool writable) {
        UA_VariableAttributes a = UA_VariableAttributes_default;
        a.value = value;
        a.dataType = type->typeId;
        a.valueRank = UA_Variant_isScalar(&value) ? UA_VALUERANK_SCALAR : UA_VALUERANK_ANY;
        a.accessLevel = UA_ACCESSLEVELMASK_READ | (writable ? UA_ACCESSLEVELMASK_WRITE : 0);
        a.userAccessLevel = a.accessLevel;
        a.displayName =
            UA_LOCALIZEDTEXT(const_cast<char*>("en-US"), const_cast<char*>(name.c_str()));
        const UA_StatusCode st = UA_Server_addVariableNode(
            server, id, parent, UA_NODEID_NUMERIC(0, UA_NS0ID_ORGANIZES),
            UA_QUALIFIEDNAME(ns, const_cast<char*>(name.c_str())),
            UA_NODEID_NUMERIC(0, UA_NS0ID_BASEDATAVARIABLETYPE), a, nullptr, nullptr);
        if (st != UA_STATUSCODE_GOOD)
            std::fprintf(stderr, "mat-opcua-sim: variable %s: %s\n", name.c_str(),
                         UA_StatusCode_name(st));
    }

    void addNodes() {
        ns = UA_Server_addNamespace(server, kUri);
        const UA_NodeId objects = UA_NODEID_NUMERIC(0, UA_NS0ID_OBJECTSFOLDER);
        const UA_NodeId sim = UA_NODEID_STRING(ns, const_cast<char*>("Sim"));
        const UA_NodeId numeric = UA_NODEID_STRING(ns, const_cast<char*>("Sim.Numeric"));
        const UA_NodeId bench = UA_NODEID_STRING(ns, const_cast<char*>("Bench"));
        addFolder(sim, objects, "Sim");
        addFolder(numeric, sim, "Numeric");
        UA_UInt32 n = 1001;
        for (const TypeNode& t : kTypes) {
            const UA_DataType* type = &UA_TYPES[t.type];
            UA_Variant v;
            fromText(t.initial, type, v);
            addVar(UA_NODEID_STRING(ns, const_cast<char*>(t.name)), sim, t.name, v, type, true);
            addVar(UA_NODEID_NUMERIC(ns, n++), numeric, std::string("N") + t.name, v, type, true);
            UA_Variant_clear(&v);
        }
        UA_Variant v;
        fromText("42.5", &UA_TYPES[UA_TYPES_DOUBLE], v);
        addVar(UA_NODEID_STRING(ns, const_cast<char*>("ReadOnly")), sim, "ReadOnly", v,
               &UA_TYPES[UA_TYPES_DOUBLE], false);
        UA_Variant_clear(&v);
        fromText("0", &UA_TYPES[UA_TYPES_UINT32], v);
        addVar(UA_NODEID_STRING(ns, const_cast<char*>("Counter")), sim, "Counter", v,
               &UA_TYPES[UA_TYPES_UINT32], false);
        UA_Variant_clear(&v);
        UA_Int32 arr[3] = {1, 2, 3};
        UA_Variant_setArrayCopy(&v, arr, 3, &UA_TYPES[UA_TYPES_INT32]);
        addVar(UA_NODEID_STRING(ns, const_cast<char*>("Array")), sim, "Array", v,
               &UA_TYPES[UA_TYPES_INT32], true);
        UA_Variant_clear(&v);
        if (opt.benchNodes > 0) {
            addFolder(bench, objects, "Bench");
            for (int k = 0; k < opt.benchNodes; ++k) {
                const std::string name = "Bench." + std::to_string(k);
                UA_Double d = k;
                UA_Variant_setScalarCopy(&v, &d, &UA_TYPES[UA_TYPES_DOUBLE]);
                addVar(UA_NODEID_STRING(ns, const_cast<char*>(name.c_str())), bench, name, v,
                       &UA_TYPES[UA_TYPES_DOUBLE], true);
                UA_Variant_clear(&v);
            }
        }
    }

    static void change(UA_Server* s, void* data) {
        auto* self = static_cast<Impl*>(data);
        ++self->tick;
        UA_UInt32 c = static_cast<UA_UInt32>(self->tick);
        UA_Variant v;
        UA_Variant_setScalar(&v, &c, &UA_TYPES[UA_TYPES_UINT32]);
        UA_Server_writeValue(s, UA_NODEID_STRING(self->ns, const_cast<char*>("Counter")), v);
        for (int k = 0; k < self->opt.benchNodes; ++k) {
            const std::string name = "Bench." + std::to_string(k);
            UA_Double d = k + static_cast<double>(self->tick);
            UA_Variant_setScalar(&v, &d, &UA_TYPES[UA_TYPES_DOUBLE]);
            UA_Server_writeValue(s, UA_NODEID_STRING(self->ns, const_cast<char*>(name.c_str())), v);
        }
    }

    static void pump(UA_Server*, void* data) {
        auto* self = static_cast<Impl*>(data);
        std::deque<std::function<void()>> q;
        {
            std::lock_guard<std::mutex> g(self->mu);
            q.swap(self->tasks);
        }
        for (auto& f : q) f();
    }

    // Runs `f` in the server thread and waits for it (at most 5 s).
    bool inServer(std::function<void()> f) {
        if (!running) return false;
        auto done = std::make_shared<std::promise<void>>();
        auto fut = done->get_future();
        {
            std::lock_guard<std::mutex> g(mu);
            tasks.push_back([f = std::move(f), done] {
                f();
                done->set_value();
            });
        }
        return fut.wait_for(std::chrono::seconds(5)) == std::future_status::ready;
    }
};

SimServer::SimServer(SimOptions options) : impl_(new Impl) { impl_->opt = std::move(options); }

SimServer::~SimServer() { stop(); }

const std::string& SimServer::error() const { return impl_->error; }
bool SimServer::running() const { return impl_->running; }
std::string SimServer::certSha256() const { return impl_->sha256; }

bool SimServer::start() {
    Impl& m = *impl_;
    if (m.running) return true;
    m.error.clear();
    UA_ServerConfig config;
    std::memset(&config, 0, sizeof config);
    config.logging = UA_Log_Stdout_new(static_cast<UA_LogLevel>(opcua::logLevel()));
    UA_StatusCode st;
    if (m.opt.secure) {
        if (m.cert.empty() && !m.makeCert()) return false;
        m.sha256 = opcua::sha256Hex(m.cert.data(), m.cert.size());
        UA_ByteString cert = {m.cert.size(), m.cert.data()};
        UA_ByteString key = {m.key.size(), m.key.data()};
        st = UA_ServerConfig_setDefaultWithSecurityPolicies(&config, m.opt.port, &cert, &key,
                                                            nullptr, 0, nullptr, 0, nullptr, 0);
        if (st == UA_STATUSCODE_GOOD) {
            if (config.secureChannelPKI.clear)
                config.secureChannelPKI.clear(&config.secureChannelPKI);
            UA_CertificateVerification_AcceptAll(&config.secureChannelPKI);
            if (config.sessionPKI.clear) config.sessionPKI.clear(&config.sessionPKI);
            UA_CertificateVerification_AcceptAll(&config.sessionPKI);
        }
    } else {
        st = UA_ServerConfig_setMinimal(&config, m.opt.port, nullptr);
    }
    if (st != UA_STATUSCODE_GOOD) {
        m.error = std::string("server configuration: ") + UA_StatusCode_name(st);
        UA_ServerConfig_clean(&config);
        return false;
    }
    UA_String_clear(&config.applicationDescription.applicationUri);
    config.applicationDescription.applicationUri = UA_STRING_ALLOC(kAppUri);
    config.allowNonePolicyPassword = true;
    config.maxSubscriptions = m.opt.maxSubscriptions;
    if (!m.opt.users.empty() || !m.opt.allowAnonymous) {
        std::vector<UA_UsernamePasswordLogin> logins(m.opt.users.size());
        for (size_t i = 0; i < m.opt.users.size(); ++i) {
            logins[i].username = UA_STRING(const_cast<char*>(m.opt.users[i].first.c_str()));
            logins[i].password = UA_STRING(const_cast<char*>(m.opt.users[i].second.c_str()));
        }
        // passwords encrypted with Basic256Sha256 when the server has it (None otherwise)
        const UA_ByteString* policy =
            &config.securityPolicies[config.securityPoliciesSize - 1].policyUri;
        const UA_String b256 = UA_STRING(
            const_cast<char*>("http://opcfoundation.org/UA/SecurityPolicy#Basic256Sha256"));
        for (size_t i = 0; i < config.securityPoliciesSize; ++i)
            if (UA_String_equal(&config.securityPolicies[i].policyUri, &b256))
                policy = &config.securityPolicies[i].policyUri;
        UA_AccessControl_default(&config, m.opt.allowAnonymous, policy, logins.size(),
                                 logins.data());
    }
    m.server = UA_Server_newWithConfig(&config);
    if (!m.server) {
        m.error = "cannot create the server";
        return false;
    }
    m.addNodes();
    UA_Server_addRepeatedCallback(m.server, &Impl::change, &m, m.opt.changeMs, nullptr);
    UA_Server_addRepeatedCallback(m.server, &Impl::pump, &m, 20, nullptr);
    st = UA_Server_run_startup(m.server);
    if (st != UA_STATUSCODE_GOOD) {
        m.error = std::string("cannot open the port: ") + UA_StatusCode_name(st);
        UA_Server_delete(m.server);
        m.server = nullptr;
        return false;
    }
    m.stopFlag = false;
    m.running = true;
    m.thread = std::thread([&m] {
        while (!m.stopFlag) UA_Server_run_iterate(m.server, true);
    });
    return true;
}

void SimServer::stop() {
    Impl& m = *impl_;
    if (!m.running) return;
    m.stopFlag = true;
    if (m.thread.joinable()) m.thread.join();
    m.running = false;
    UA_Server_run_shutdown(m.server);
    UA_Server_delete(m.server);
    m.server = nullptr;
    std::lock_guard<std::mutex> g(m.mu);
    m.tasks.clear();
}

bool SimServer::set(const std::string& nodeId, const std::string& text) {
    bool ok = false;
    Impl& m = *impl_;
    m.inServer([&] {
        UA_NodeId id = parse(nodeId);
        UA_Variant cur;
        UA_Variant_init(&cur);
        if (UA_Server_readValue(m.server, id, &cur) == UA_STATUSCODE_GOOD && cur.type) {
            UA_Variant v;
            if (fromText(text, cur.type, v)) {
                ok = UA_Server_writeValue(m.server, id, v) == UA_STATUSCODE_GOOD;
                UA_Variant_clear(&v);
            }
        }
        UA_Variant_clear(&cur);
        UA_NodeId_clear(&id);
    });
    return ok;
}

std::string SimServer::get(const std::string& nodeId) {
    std::string out;
    Impl& m = *impl_;
    m.inServer([&] {
        UA_NodeId id = parse(nodeId);
        UA_Variant cur;
        UA_Variant_init(&cur);
        if (UA_Server_readValue(m.server, id, &cur) == UA_STATUSCODE_GOOD) out = toText(cur);
        UA_Variant_clear(&cur);
        UA_NodeId_clear(&id);
    });
    return out;
}

uint16_t SimServer::freePort() {
    const int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    a.sin_port = 0;
    uint16_t port = 0;
    if (::bind(fd, reinterpret_cast<sockaddr*>(&a), sizeof a) == 0) {
        socklen_t len = sizeof a;
        if (::getsockname(fd, reinterpret_cast<sockaddr*>(&a), &len) == 0) port = ntohs(a.sin_port);
    }
    ::close(fd);
    return port;
}

}  // namespace mat::opcuasim
