// Minimal libcurl API (libcurl.so.4) for InfluxDB, declared in-house (specs/003-data-logging
// research R7). client_api_check_test compares it with the real <curl/curl.h> on x64.
#pragma once
#include <cstddef>
#include <string>

namespace mat::capi {

struct CurlSlist {  // struct curl_slist (public layout)
    char* data;
    CurlSlist* next;
};

template <class CURL_, class CODE_, class OPTION_, class INFO_, class SLIST_>
struct CurlSig {
    using GlobalInit = CODE_ (*)(long);
    using EasyInit = CURL_* (*)();
    using EasySetopt = CODE_ (*)(CURL_*, OPTION_, ...);
    using EasyPerform = CODE_ (*)(CURL_*);
    using EasyGetinfo = CODE_ (*)(CURL_*, INFO_, ...);
    using EasyCleanup = void (*)(CURL_*);
    using EasyStrerror = const char* (*)(CODE_);
    using SlistAppend = SLIST_* (*)(SLIST_*, const char*);
    using SlistFreeAll = void (*)(SLIST_*);
    using EasyEscape = char* (*)(CURL_*, const char*, int);
    using Free = void (*)(void*);
    using WriteCallback = size_t (*)(char*, size_t, size_t, void*);
};
// CURL is void; CURLcode, CURLoption and CURLINFO are int-sized enums.
using CurlFns = CurlSig<void, int, int, int, CurlSlist>;

// CURLoption (long options take a `long`, pointer options a pointer)
constexpr int kCurloptWritedata = 10001;
constexpr int kCurloptUrl = 10002;
constexpr int kCurloptErrorbuffer = 10010;
constexpr int kCurloptPostfields = 10015;
constexpr int kCurloptHttpheader = 10023;
constexpr int kCurloptWritefunction = 20011;
constexpr int kCurloptPost = 47;
constexpr int kCurloptPostfieldsize = 60;
constexpr int kCurloptSslVerifypeer = 64;
constexpr int kCurloptHttpget = 80;
constexpr int kCurloptSslVerifyhost = 81;
constexpr int kCurloptNosignal = 99;
constexpr int kCurloptTimeoutMs = 155;
constexpr int kCurloptConnecttimeoutMs = 156;
constexpr int kCurloptProtocols = 181;
constexpr long kCurlprotoHttp = 1;
constexpr long kCurlprotoHttps = 2;
constexpr int kCurlinfoResponseCode = 0x200002;
constexpr long kCurlGlobalDefault = 3;
constexpr int kCurleOk = 0;
constexpr size_t kCurlErrorSize = 256;

struct CurlApi {
    CurlFns::EasyInit easyInit = nullptr;
    CurlFns::EasySetopt easySetopt = nullptr;
    CurlFns::EasyPerform easyPerform = nullptr;
    CurlFns::EasyGetinfo easyGetinfo = nullptr;
    CurlFns::EasyCleanup easyCleanup = nullptr;
    CurlFns::EasyStrerror easyStrerror = nullptr;
    CurlFns::SlistAppend slistAppend = nullptr;
    CurlFns::SlistFreeAll slistFreeAll = nullptr;
    CurlFns::EasyEscape easyEscape = nullptr;
    CurlFns::Free free = nullptr;
};

// Loads libcurl.so.4 once and runs curl_global_init(CURL_GLOBAL_DEFAULT).
const CurlApi* loadCurlApi(const std::string& libDir, std::string& err);

}  // namespace mat::capi
