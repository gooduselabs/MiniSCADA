// The data API for other systems (feature 025, specs/025-data-api, ADR-053): ERP, MES, BI and
// scripts read Tags, history and alarms and, with a key that may, write Tags:
//   GET  /api/v1/data/key                       the key of the request (name, rights, expiry)
//   GET  /api/v1/data/tags                      the Tags the key may read (type, unit, writable)
//   GET  /api/v1/data/values[?tags=A,B]         current values (value, quality, timestamps)
//   GET  /api/v1/data/history/{series,aggregate,rows,export.csv}   the history queries of 010
//   GET  /api/v1/data/alarms, …/alarms/history  the alarms of 009
//   POST /api/v1/data/write                     tag writes through the write coordinator
//   GET  /api/v1/data/write?ids=, …/write/{requestId}   their results
// The gate (roles table: no session) has checked HTTPS and the method. Here: the API key of
// "Authorization: Bearer matk_…" (ApiKeyService: unknown, expired, source, rate, a source that
// guesses keys), then the access model of feature 013 for the key's role and groups: the Tags it
// reads are liveTags, its history historyTags, its alarms alarmAllowed, the Tags it writes those of
// the items it may operate (plus writeMinRole). Every refusal is audited as apikey.denied (limited
// like access.denied); the writes are tag.write of user apikey:<id>.
#pragma once
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <unordered_set>
#include <vector>

#include "core/audit/audit_log.hpp"
#include "core/auth/access_service.hpp"
#include "core/auth/api_keys.hpp"
#include "core/tag-engine/tag_model.hpp"
#include "core/tag-engine/tag_store.hpp"
#include "nlohmann/json.hpp"

struct mg_connection;

namespace mat {

struct GateRequest;
struct GateDecision;
class HistoryApi;
class AlarmGlue;
class WriteCoordinator;
namespace alarmsapi {
class SourceLimiter;
}

constexpr size_t kDataMaxValueTags = 200;  // values?tags= at most

struct DataBackend {
    ApiKeyService* keys = nullptr;                 // required
    AccessService* access = nullptr;               // required
    const ProjectModel* model = nullptr;           // the Tags of the running project; null: none
    const TagStore* store = nullptr;               // their values; null: none
    WriteCoordinator* coordinator = nullptr;       // null: write routes answer 501
    HistoryApi* history = nullptr;                 // null: history routes answer 404 NO_HISTORY
    AlarmGlue* alarms = nullptr;                   // null: alarm routes answer 404 NO_ALARMS
    std::function<void(const AuditEvent&)> audit;  // commits or throws; empty: nothing recorded
    std::function<bool()> auditAvailable;          // empty: true
};

// The key of a request after authentication, and what it may do.
struct DataCaller {
    ApiKey key;
    ClientAddress from;
    SessionAccessPtr access;
    std::unordered_set<std::string> writable;  // Tags it may write (empty for a read-only key)
};

// The Tags a person or key may write: the bindings of the operable items it may operate.
std::unordered_set<std::string> operableTags(const ResourceCatalog& catalog,
                                             const SessionAccess& access);

class DataApi {
   public:
    explicit DataApi(DataBackend backend);
    ~DataApi();
    DataApi(const DataApi&) = delete;
    DataApi& operator=(const DataApi&) = delete;

    // A request of /api/v1/data/* that came through the gate.
    int handle(mg_connection* c, const GateRequest& request, const GateDecision& decision,
               bool close);

    // The principal of the access model for a key (user apikey:<id>).
    static Principal principalOf(const ApiKey& k);

   private:
    int keyInfo(mg_connection* c, const DataCaller& who, bool close);
    int tags(mg_connection* c, const DataCaller& who, bool close);
    int values(mg_connection* c, const DataCaller& who, bool close);
    int history(mg_connection* c, const GateRequest& r, const DataCaller& who, bool close);
    int alarms(mg_connection* c, const GateRequest& r, const DataCaller& who, bool close);
    int write(mg_connection* c, const GateRequest& r, const DataCaller& who, bool close);
    int writeAsk(mg_connection* c, const GateRequest& r, const DataCaller& who, bool close);
    int refuse(mg_connection* c, const GateRequest& r, const std::optional<ApiKey>& key, int status,
               const std::string& code, bool close, const std::string& extra = "",
               nlohmann::json more = nlohmann::json::object());

    DataBackend b_;
    std::unique_ptr<alarmsapi::SourceLimiter> alarmLimiter_;
};

}  // namespace mat
