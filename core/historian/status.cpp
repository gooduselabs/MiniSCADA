#include "core/historian/status.hpp"

namespace mat {

namespace {
nlohmann::json orNull(int64_t v) { return v > 0 ? nlohmann::json(v) : nlohmann::json(nullptr); }
}  // namespace

const char* historianErrorMessage(const std::string& code) {
    if (code == "disk_full") return "Hết dung lượng khi ghi dữ liệu lưu trữ";
    if (code == "corrupt") return "File lưu trữ hỏng";
    if (code == "corrupt_recovered") return "File lưu trữ hỏng: đã đổi tên và tạo file mới";
    return "Lỗi ghi dữ liệu lưu trữ";
}

nlohmann::json historianInfoJson(const HistorianInfoInput& in, const HistorianStatus& s) {
    if (!in.enabled) return {{"enabled", false}};
    const bool failedStart = !in.startError.empty();
    nlohmann::json j = {
        {"enabled", true},
        {"state", failedStart ? "error" : historianStateName(s.state)},
        {"clock", s.clockValid ? "ok" : "invalid"},
        {"clockJumps", s.clockJumps},
        {"groups", in.groups},
        {"rowsWritten", s.rowsWritten},
        {"rowsDropped", s.rowsDropped},
        {"stringsTruncated", s.stringsTruncated},
        {"dbBytes", s.dbBytes},
        {"dbMaxBytes", s.dbMaxBytes},
        {"freeBytes", s.freeBytes >= 0 ? nlohmann::json(s.freeBytes) : nlohmann::json(nullptr)},
        {"commitMs", in.commitMs},
        {"lastCommitAt", orNull(s.lastCommitAt)},
        {"lastRetention",
         s.lastRetentionAt > 0
             ? nlohmann::json{{"at", s.lastRetentionAt}, {"rowsDeleted", s.lastRetentionRows}}
             : nlohmann::json(nullptr)},
        {"capPurges", s.capPurges},
        {"capRowsDeleted", s.capRowsDeleted},
        {"warnings", in.warnings},
        {"lastError", nullptr},
        {"destinations", nlohmann::json::array()}};
    // The raw text (in.startError, s.lastErrorMessage) stays in the journal.
    if (failedStart)
        j["lastError"] = {
            {"code", "io"}, {"message", historianErrorMessage("io")}, {"at", nullptr}};
    else if (!s.lastErrorCode.empty())
        j["lastError"] = {{"code", s.lastErrorCode},
                          {"message", historianErrorMessage(s.lastErrorCode)},
                          {"at", orNull(s.lastErrorAt)}};
    // specs/010-history-reports (device-010.md §1): the groups, the queries, the aggregates, the I/O
    j["groupsInfo"] = nlohmann::json::array();
    for (const auto& g : s.groups)
        j["groupsInfo"].push_back({{"id", g.id},
                                   {"mode", g.mode},
                                   {"rows24h", g.rows24h},
                                   {"triggerState", g.triggerState.empty() ? nlohmann::json(nullptr)
                                                                           : nlohmann::json(g.triggerState)},
                                   {"aggregates", g.aggregates}});
    if (in.query) {
        const auto& q = *in.query;
        j["query"] = {{"enabled", q.enabled},
                      {"inFlight", q.inFlight},
                      {"served", q.served},
                      {"rejectedBusy", q.rejectedBusy},
                      {"rejectedLimit", q.rejectedLimit},
                      {"timeouts", q.timeouts},
                      {"errors", q.errors},
                      {"p95Ms", q.p95Ms},
                      {"lastError", q.lastErrorCode.empty()
                                        ? nlohmann::json(nullptr)
                                        : nlohmann::json{{"code", q.lastErrorCode}, {"at", orNull(q.lastErrorAt)}}}};
    }
    j["aggregates"] = {
        {"enabled", s.aggEnabled},
        {"groups", s.aggGroups},
        {"rows", {{"minute", s.aggRowsMinute >= 0 ? nlohmann::json(s.aggRowsMinute) : nlohmann::json(nullptr)},
                  {"hour", s.aggRowsHour >= 0 ? nlohmann::json(s.aggRowsHour) : nlohmann::json(nullptr)}}},
        {"backfill", {{"active", s.backfillActive},
                      {"group", s.backfillGroup.empty() ? nlohmann::json(nullptr) : nlohmann::json(s.backfillGroup)},
                      {"progress", s.backfillProgress >= 0 ? nlohmann::json(s.backfillProgress) : nlohmann::json(nullptr)}}},
        {"capRowsDeleted", {{"raw", s.capRowsDeleted}, {"minute", s.capRowsDeletedMinute}, {"hour", s.capRowsDeletedHour}}},
        {"schema", s.schema}};
    j["io"] = {{"source", s.io.available ? "proc-self-io" : "unavailable"},
               {"writeBytes1h", s.io.available ? nlohmann::json(s.io.writeBytes1h) : nlohmann::json(nullptr)},
               {"writeBytes24h", s.io.available ? nlohmann::json(s.io.writeBytes24h) : nlohmann::json(nullptr)},
               {"coverageS", s.io.available ? nlohmann::json(s.io.coverageS) : nlohmann::json(nullptr)},
               {"bytesPerDay", s.io.bytesPerDay ? nlohmann::json(*s.io.bytesPerDay) : nlohmann::json(nullptr)},
               {"estimateBytesPerDay", in.estimateBytesPerDay >= 0 ? nlohmann::json(in.estimateBytesPerDay) : nlohmann::json(nullptr)},
               {"budgetBytesPerDay", in.budgetBytesPerDay}};
    for (const auto& d : s.destinations) {
        nlohmann::json e = {{"id", d.id},
                            {"type", d.type},
                            {"state", destStateName(d.state)},
                            {"pendingRows", d.pendingRows},
                            {"lagS", d.lagS},
                            {"sentRows", d.sentRows},
                            {"lostRows", d.lostRows},
                            {"outOfRangeValues", d.outOfRangeValues},
                            {"rejectedRows", d.rejectedRows},
                            {"lastOkAt", orNull(d.lastOkAt)},
                            {"lastError", nullptr}};
        if (d.lastError != ErrorClass::None)
            e["lastError"] = {
                {"code", errorClassCode(d.lastError)},
                {"dbCode", d.lastErrorDbCode.empty() ? nlohmann::json(nullptr)
                                                     : nlohmann::json(d.lastErrorDbCode)},
                {"message", errorClassMessage(d.lastError)},
                {"at", orNull(d.lastErrorAt)}};
        j["destinations"].push_back(std::move(e));
    }
    return j;
}

}  // namespace mat
