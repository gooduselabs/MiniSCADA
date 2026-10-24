#include "drivers/opcua/client_cert.hpp"

#include <fcntl.h>
#include <mbedtls/sha256.h>
#include <mbedtls/x509_crt.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <fstream>
#include <iterator>
#include <map>
#include <mutex>

#include "drivers/opcua/status_map.hpp"
#include "open62541.h"

namespace mat::opcua {

namespace {

bool readFile(const std::string& path, std::vector<uint8_t>& out) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    out.assign(std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>());
    return !out.empty();
}

std::string readText(const std::string& path) {
    std::vector<uint8_t> b;
    if (!readFile(path, b)) return "";
    return std::string(b.begin(), b.end());
}

// Temporary file, fsync, rename; mode 0600 (the key is secret, the certificate is not but has no
// reason to be readable by others).
bool writeFile(const std::string& path, const uint8_t* data, size_t size, std::string& err) {
    const std::string tmp = path + ".tmp";
    const int fd = ::open(tmp.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    if (fd < 0) {
        err = "cannot write " + tmp + ": " + std::strerror(errno);
        return false;
    }
    size_t done = 0;
    while (done < size) {
        const ssize_t n = ::write(fd, data + done, size - done);
        if (n < 0) {
            if (errno == EINTR) continue;
            err = "cannot write " + tmp + ": " + std::strerror(errno);
            ::close(fd);
            return false;
        }
        done += static_cast<size_t>(n);
    }
    ::fsync(fd);
    ::close(fd);
    if (::rename(tmp.c_str(), path.c_str()) != 0) {
        err = "cannot rename " + tmp + ": " + std::strerror(errno);
        return false;
    }
    return true;
}

bool makeDirs(const std::string& dir) {
    std::string cur;
    for (size_t i = 0; i <= dir.size(); ++i) {
        if (i == dir.size() || dir[i] == '/') {
            if (!cur.empty() && ::mkdir(cur.c_str(), 0700) != 0 && errno != EEXIST) return false;
        }
        if (i < dir.size()) cur += dir[i];
    }
    return true;
}

std::string hostName() {
    char h[256] = {0};
    if (::gethostname(h, sizeof h - 1) != 0 || !h[0]) return "localhost";
    return h;
}

UA_String uaStr(const std::string& s) {
    UA_String r;
    r.length = s.size();
    r.data = reinterpret_cast<UA_Byte*>(const_cast<char*>(s.data()));
    return r;
}

bool generate(const std::string& uri, ClientIdentity& out, std::string& err) {
    const std::string host = hostName();
    const std::string subj[] = {"C=VN", "O=ATPro", "CN=mAT SCADA OPC UA Client@" + host};
    const std::string san[] = {"URI:" + uri, "DNS:" + host};
    UA_String subject[3] = {uaStr(subj[0]), uaStr(subj[1]), uaStr(subj[2])};
    UA_String alt[2] = {uaStr(san[0]), uaStr(san[1])};
    UA_UInt16 bits = 2048, days = 3650;
    UA_KeyValuePair kv[2];
    kv[0].key = UA_QUALIFIEDNAME(0, const_cast<char*>("key-size-bits"));
    UA_Variant_setScalar(&kv[0].value, &bits, &UA_TYPES[UA_TYPES_UINT16]);
    kv[1].key = UA_QUALIFIEDNAME(0, const_cast<char*>("expires-in-days"));
    UA_Variant_setScalar(&kv[1].value, &days, &UA_TYPES[UA_TYPES_UINT16]);
    UA_KeyValueMap params = {2, kv};
    UA_ByteString key = UA_BYTESTRING_NULL, cert = UA_BYTESTRING_NULL;
    UA_Logger* logger = UA_Log_Stdout_new(static_cast<UA_LogLevel>(opcua::logLevel()));
    const UA_StatusCode st = UA_CreateCertificate(logger, subject, 3, alt, 2,
                                                  UA_CERTIFICATEFORMAT_DER, &params, &key, &cert);
    if (logger->clear) logger->clear(logger);
    if (st != UA_STATUSCODE_GOOD) {
        err = std::string("cannot make the client certificate: ") + UA_StatusCode_name(st);
        UA_ByteString_clear(&key);
        UA_ByteString_clear(&cert);
        return false;
    }
    out.cert.assign(cert.data, cert.data + cert.length);
    out.key.assign(key.data, key.data + key.length);
    UA_ByteString_clear(&key);
    UA_ByteString_clear(&cert);
    out.applicationUri = uri;
    out.sha256 = sha256Hex(out.cert.data(), out.cert.size());
    return true;
}

}  // namespace

std::string sha256Hex(const uint8_t* data, size_t size) {
    unsigned char h[32];
    mbedtls_sha256(data, size, h, 0);
    static const char* const kHex = "0123456789abcdef";
    std::string s;
    s.reserve(64);
    for (unsigned char c : h) {
        s += kHex[c >> 4];
        s += kHex[c & 15];
    }
    return s;
}

CertInfo certInfo(const uint8_t* der, size_t size) {
    CertInfo info;
    if (!der || size == 0) return info;
    info.sha256 = sha256Hex(der, size);
    mbedtls_x509_crt crt;
    mbedtls_x509_crt_init(&crt);
    if (mbedtls_x509_crt_parse_der(&crt, der, size) == 0) {
        info.ok = true;
        char dn[512];
        if (mbedtls_x509_dn_gets(dn, sizeof dn, &crt.subject) > 0) info.subject = dn;
        struct tm t {};
        t.tm_year = crt.valid_to.year - 1900;
        t.tm_mon = crt.valid_to.mon - 1;
        t.tm_mday = crt.valid_to.day;
        t.tm_hour = crt.valid_to.hour;
        t.tm_min = crt.valid_to.min;
        t.tm_sec = crt.valid_to.sec;
        info.notAfterMs = static_cast<int64_t>(timegm(&t)) * 1000;
    }
    mbedtls_x509_crt_free(&crt);
    return info;
}

std::string defaultApplicationUri() { return "urn:atpro:mat-scada:" + hostName(); }

bool clientIdentity(const std::string& dir, const std::string& applicationUri, ClientIdentity& out,
                    std::string& err) {
    static std::mutex mu;
    static std::map<std::string, ClientIdentity> made;
    std::lock_guard<std::mutex> g(mu);
    const std::string key = dir + "\n" + applicationUri;
    const auto it = made.find(key);
    if (it != made.end()) {
        out = it->second;
        return true;
    }
    ClientIdentity id;
    if (!dir.empty()) {
        const std::string certPath = dir + "/client-cert.der", keyPath = dir + "/client-key.der",
                          uriPath = dir + "/client-uri.txt";
        if (readFile(certPath, id.cert) && readFile(keyPath, id.key) &&
            readText(uriPath) == applicationUri && certInfo(id.cert.data(), id.cert.size()).ok) {
            id.applicationUri = applicationUri;
            id.sha256 = sha256Hex(id.cert.data(), id.cert.size());
            made[key] = id;
            out = id;
            return true;
        }
        if (!makeDirs(dir)) {
            err = "cannot create " + dir + ": " + std::strerror(errno);
            return false;
        }
        if (!generate(applicationUri, id, err)) return false;
        if (!writeFile(keyPath, id.key.data(), id.key.size(), err) ||
            !writeFile(certPath, id.cert.data(), id.cert.size(), err) ||
            !writeFile(uriPath, reinterpret_cast<const uint8_t*>(applicationUri.data()),
                       applicationUri.size(), err))
            return false;
    } else if (!generate(applicationUri, id, err)) {
        return false;
    }
    made[key] = id;
    out = id;
    return true;
}

}  // namespace mat::opcua
