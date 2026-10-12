// InfluxDB 2.x / 3.x (API v2) through libcurl loaded at run time (specs/003-data-logging
// research R9–R10, contracts/external-schema.md "InfluxDB"): line protocol, precision ms, at least
// once with the cursor kept on the device (writing the same point again overwrites it).
#include <algorithm>
#include <cstdio>
#include <string>
#include <vector>

#include "core/historian/forward/curl_api.hpp"
#include "core/historian/forward/destination.hpp"
#include "core/historian/forward/dyn_lib.hpp"
#include "core/historian/forward/influx_line.hpp"

namespace mat {

namespace {

using capi::CurlApi;

constexpr size_t kMaxLines = 5000;
constexpr size_t kMaxBodyBytes = 1 << 20;
constexpr size_t kMaxReplyBytes = 4096;

size_t collect(char* p, size_t size, size_t n, void* user) {
    auto* reply = static_cast<std::string*>(user);
    const size_t len = size * n;
    if (reply->size() < kMaxReplyBytes)
        reply->append(p, std::min(len, kMaxReplyBytes - reply->size()));
    return len;
}

class InfluxDestination : public Destination {
   public:
    InfluxDestination(ConnectionModel c, std::string libDir)
        : c_(std::move(c)), libDir_(std::move(libDir)) {}
    ~InfluxDestination() override { close(); }

    bool transactional() const override { return false; }

    size_t batchRows(const DestTable& t) const override {  // 5000 rows unless the rows are wide
        const size_t byBytes = SqlGen::kMaxBatchBytes / SqlGen::estimatedRowBytes(t.columns);
        return std::max<size_t>(1, std::min(kMaxLines, byBytes));
    }

    bool connect(const std::string& secret, DestError& err) override {
        close();
        std::string e;
        api_ = capi::loadCurlApi(libDir_, e);
        if (!api_) {
            err.cls = ErrorClass::NoClient;
            err.detail = e;
            return false;
        }
        curl_ = api_->easyInit();
        if (!curl_) {
            err.cls = ErrorClass::Connect;
            err.detail = "curl_easy_init failed";
            return false;
        }
        token_ = secret;
        std::string base = c_.url;
        while (!base.empty() && base.back() == '/') base.pop_back();
        writeUrl_ = base + "/api/v2/write?org=" + escape(c_.org) + "&bucket=" + escape(c_.bucket) +
                    "&precision=ms";
        // Reachability, TLS and (on 3.x) the token: GET /ping answers 204 (2.x) or 200 (3.x).
        long status = 0;
        if (!request(base + "/ping", nullptr, status, err)) {
            close();
            return false;
        }
        if (status < 200 || status >= 300) {
            err.cls = classifyHttp(status);
            err.dbCode = std::to_string(status);
            err.detail = "ping: " + reply_;
            close();
            return false;
        }
        return true;
    }

    bool syncSchema(const std::string&, const std::vector<DestTable>&, DestError&) override {
        return true;  // no schema: a missing bucket shows on the first write (404)
    }

    bool readCursor(const std::string&, const std::string&, int64_t& lastSeq, DestError&) override {
        lastSeq = 0;  // not transactional: the forwarder keeps the cursor on the device
        return true;
    }

    bool writeBatch(const std::string& sourceId, const DestTable& t,
                    const std::vector<StoredRow>& rows, int64_t /*prevSeq*/, int64_t,
                    DestError& err) override {
        std::vector<InfluxColumn> cols;
        for (const auto& c : t.columns) cols.push_back({c.name, c.type});
        for (const auto& body :
             influxBodies(t.name, sourceId, cols, rows, kMaxLines, kMaxBodyBytes)) {
            if (body.lines == 0) continue;  // only empty rows: nothing to send
            long status = 0;
            if (!request(writeUrl_, &body.text, status, err)) return false;
            if (status == 204) continue;
            // Taken in part (review I3): sending the batch again would fail the same way forever.
            if (const auto partial = influxPartialWrite(status, reply_, body.lines)) {
                counters_.rejectedRows += partial->dropped;
                std::fprintf(stderr, "forwarder %s: %s: partial write, %llu points dropped: %s\n",
                             c_.id.c_str(), t.name.c_str(),
                             static_cast<unsigned long long>(partial->dropped),
                             journalSafe(reply_).c_str());
                // Points older than the bucket keeps are normal while catching up; a field of
                // another type is not: the batch counts as sent, the error shows (review of the
                // fixes I4).
                if (!partial->retentionOnly) {
                    err.cls = ErrorClass::SchemaMismatch;
                    err.dbCode = std::to_string(status);
                    err.detail = "partial write: " + reply_;
                }
                continue;
            }
            {
                err.cls = classifyHttp(status);
                err.dbCode = std::to_string(status);
                err.detail = "write: " + reply_;
                return false;
            }
        }
        return true;
    }

    void close() override {
        if (curl_ && api_) api_->easyCleanup(curl_);
        curl_ = nullptr;
    }

    DestCounters counters() const override { return counters_; }

   private:
    std::string escape(const std::string& s) const {
        char* e = api_->easyEscape(curl_, s.c_str(), static_cast<int>(s.size()));
        if (!e) return std::string();
        std::string out(e);
        api_->free(e);
        return out;
    }

    // One request on the kept handle (connection reuse). false = transport error (classified).
    bool request(const std::string& url, const std::string* body, long& status, DestError& err) {
        using namespace capi;
        const bool https = url.rfind("https://", 0) == 0;
        reply_.clear();
        char errbuf[kCurlErrorSize] = {0};
        api_->easySetopt(curl_, kCurloptUrl, url.c_str());
        api_->easySetopt(curl_, kCurloptProtocols, kCurlprotoHttp | kCurlprotoHttps);
        api_->easySetopt(curl_, kCurloptNosignal, 1L);
        api_->easySetopt(curl_, kCurloptConnecttimeoutMs, 5000L);
        api_->easySetopt(curl_, kCurloptTimeoutMs, 30000L);
        if (https) {  // require: encrypted, certificate not checked; otherwise checked (default)
            const bool verify = c_.tls != TlsMode::Require;
            api_->easySetopt(curl_, kCurloptSslVerifypeer, verify ? 1L : 0L);
            api_->easySetopt(curl_, kCurloptSslVerifyhost, verify ? 2L : 0L);
        }
        CurlSlist* headers = nullptr;
        const std::string auth = "Authorization: Token " + token_;
        headers = api_->slistAppend(headers, auth.c_str());
        headers = api_->slistAppend(headers, "Content-Type: text/plain; charset=utf-8");
        headers = api_->slistAppend(headers, "Accept: application/json");
        api_->easySetopt(curl_, kCurloptHttpheader, headers);
        if (body) {
            api_->easySetopt(curl_, kCurloptPost, 1L);
            api_->easySetopt(curl_, kCurloptPostfields, body->data());
            api_->easySetopt(curl_, kCurloptPostfieldsize, static_cast<long>(body->size()));
        } else {
            api_->easySetopt(curl_, kCurloptHttpget, 1L);
        }
        api_->easySetopt(curl_, kCurloptWritefunction, &collect);
        api_->easySetopt(curl_, kCurloptWritedata, &reply_);
        api_->easySetopt(curl_, kCurloptErrorbuffer, errbuf);
        const int rc = api_->easyPerform(curl_);
        // nothing on the handle may point to these locals once they are gone
        api_->easySetopt(curl_, kCurloptErrorbuffer, static_cast<char*>(nullptr));
        api_->easySetopt(curl_, kCurloptHttpheader, static_cast<CurlSlist*>(nullptr));
        if (body) api_->easySetopt(curl_, kCurloptPostfields, static_cast<const char*>(nullptr));
        api_->slistFreeAll(headers);
        if (rc != kCurleOk) {
            err.cls = classifyCurl(rc);
            err.dbCode = std::to_string(rc);
            err.detail = errbuf[0] ? errbuf : api_->easyStrerror(rc);
            return false;
        }
        api_->easyGetinfo(curl_, kCurlinfoResponseCode, &status);
        return true;
    }

    ConnectionModel c_;
    std::string libDir_;
    const CurlApi* api_ = nullptr;
    void* curl_ = nullptr;
    std::string token_;
    std::string writeUrl_;
    std::string reply_;
    DestCounters counters_;
};

}  // namespace

std::unique_ptr<Destination> makeInfluxDestination(const ConnectionModel& c,
                                                   const std::string& libDir) {
    return std::make_unique<InfluxDestination>(c, libDir);
}

}  // namespace mat
