// The alarm routes (feature 009; contracts/device-api-1.3.md §2, §3). The rules live in
// server/alarm_glue (AlarmGlue); this part reads the request and writes the answer:
//   GET  /api/v1/alarms, GET /api/v1/alarms/history   viewer: the page's source filter (HttpApi)
//   POST /api/v1/alarms/{ack,shelve,unshelve}          operator, cookie or Bearer (EngineeringApi)
//   POST /api/v1/alarms/{disable,enable}               engineer, Bearer only (the table says so)
// Everything here is a function of its input, so the tests can call it without a socket.
#pragma once
#include <deque>
#include <functional>
#include <map>
#include <mutex>
#include <optional>
#include <string>

#include "core/alarm/alarm_history.hpp"
#include "nlohmann/json.hpp"
#include "server/alarm_glue.hpp"

struct mg_connection;

namespace mat::alarmsapi {

constexpr size_t kMaxQueryStringBytes = 2048;
constexpr int kPostsPerSecond = 10;  // per session (device-api-1.3 §1.2)

// The query string of GET alarms/history as a HistoryQuery (§2.2). `nowMs`: the device clock, for
// the defaults. nullopt and `out` filled on success; otherwise the 400 BAD_QUERY with `field`.
std::optional<AlarmApiResult> parseHistoryQuery(const std::string& rawQuery, int64_t nowMs,
                                                alarm::HistoryQuery& out);

// The id of an instance: ^[A-Za-z][A-Za-z0-9_]{1,47}(\.(HH|H|L|LL))?$
bool validInstanceId(const std::string& s);

// POST alarms/<verb> with the body already read and under 16 KiB. 400 BAD_REQUEST for a body that
// is not what the contract says (unknown key included); otherwise AlarmGlue's answer.
AlarmApiResult post(const std::string& verb, const std::string& body, AlarmGlue& glue,
                    const AlarmActor& who);

// At most kPostsPerSecond requests a second for a session; `key` names it.
class PostLimiter {
   public:
    explicit PostLimiter(std::function<int64_t()> monoMs) : mono_(std::move(monoMs)) {}
    // true: go on. false: refused; `retryAfterMs` says when to come back.
    bool allow(const std::string& key, int& retryAfterMs);

   private:
    std::function<int64_t()> mono_;
    std::mutex mu_;
    std::map<std::string, std::deque<int64_t>> times_;
};

// One history query at a time for a source address (a person pressing a key twice must not take
// two of the device's two slots).
class SourceLimiter {
   public:
    bool enter(const std::string& ip);
    void leave(const std::string& ip);

   private:
    std::mutex mu_;
    std::map<std::string, int> busy_;
};

// GET handlers for HttpApi (they have passed the page's source filter already).
// `full` false: a source without a sign-in sees no account names or free text (security review M1).
// Feature 013: `allow` (empty: every alarm) keeps the instances and the occurrences of the alarms
// the person may see (by instance id).
using AlarmFilter = std::function<bool(const std::string& id)>;
int getList(mg_connection* c, AlarmGlue& glue, bool full, const AlarmFilter& allow = {});
int getHistory(mg_connection* c, AlarmGlue& glue, SourceLimiter& limiter, bool full,
               const AlarmFilter& allow = {});

}  // namespace mat::alarmsapi
