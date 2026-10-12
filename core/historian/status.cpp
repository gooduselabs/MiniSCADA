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
