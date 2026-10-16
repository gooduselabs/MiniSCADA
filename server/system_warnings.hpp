#pragma once
// The warnings of system/info (specs/011-pilot-hardening/contracts/device-api-011.md §5; FR-010).
// `warnings` stays a list of codes (what the 0.x Studio and the page read); `warningDetails` gives
// each code its Vietnamese message, the time it started (`since`, epoch ms) and a `detail` object.
// The sources of feature 011 (host check, pulse recovery, logic, update, clock) set and clear their
// warning here; the older ones (VIEWER_PUBLIC, HTTPS_DOWN, the certificate's, the alarms') keep
// their own path and get a `since` from HttpApi. Header-only: http_api.cpp is compiled into many
// test targets.
#include <cstdint>
#include <functional>
#include <map>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

#include "nlohmann/json.hpp"

namespace mat {

// Vietnamese text of a warning code; a code without one gets a generic text that names it.
inline std::string warningMessage(const std::string& code) {
    static const std::map<std::string, std::string> kText = {
        {"VIEWER_PUBLIC", "Trang vận hành mở cho mọi địa chỉ (viewerAccess = any)."},
        {"HTTPS_DOWN", "HTTPS không chạy: trang mở qua HTTP không điều khiển được."},
        {"TLS_NO_IP_SAN", "Chứng chỉ không có địa chỉ IP của thiết bị."},
        {"TLS_SAN_MISMATCH", "Chứng chỉ không khớp địa chỉ hiện tại của thiết bị."},
        {"HOST_CHECK_OFF", "Kiểm tra tên máy (Host) đang tắt: chỉ dùng để gỡ rối."},
        {"SSH_ROOT_PASSWORD", "SSH cho phép root đăng nhập bằng mật khẩu: nên đổi sang khóa SSH."},
        {"PULSE_STUCK", "Một lệnh xung chưa nhả được sau khi khởi động: kiểm tra PLC."},
        {"LOGIC_WRITES_OFF", "Logic có lệnh ghi PLC nhưng ghi từ logic đang tắt."},
        {"LOGIC_THROTTLED", "Lệnh ghi của logic bị chặn do vượt giới hạn tần suất."},
        {"LOGIC_RETAIN_LOST", "Trạng thái lưu của logic bị mất: bộ đếm và cộng dồn bắt đầu lại."},
        {"UPDATE_ROLLED_BACK", "Bản cập nhật vừa cài không chạy được: đã trở về bản trước."},
        {"TIME_NOT_SYNCED", "Đồng hồ thiết bị chưa đồng bộ: lịch và thời gian có thể sai."},
        {"UPDATE_KEYS_MISSING", "Cập nhật qua mạng đang bật nhưng chưa có khóa tin cậy."},
    };
    auto it = kText.find(code);
    return it != kText.end() ? it->second : "Cảnh báo " + code + ".";
}

struct SystemWarning {
    std::string code;
    int64_t sinceMs = 0;
    nlohmann::json detail;  // null when there is none
};

// Thread-safe: set from the runtime threads, read by the HTTP workers.
class SystemWarnings {
   public:
    using Clock = std::function<int64_t()>;  // epoch ms
    explicit SystemWarnings(Clock clock) : clock_(std::move(clock)) {}

    // Raise or refresh: `since` stays from the first set until clear().
    void set(const std::string& code, nlohmann::json detail) {
        std::lock_guard<std::mutex> l(mu_);
        auto it = items_.find(code);
        if (it == items_.end())
            items_.emplace(code, SystemWarning{code, clock_(), std::move(detail)});
        else
            it->second.detail = std::move(detail);
    }
    void clear(const std::string& code) {
        std::lock_guard<std::mutex> l(mu_);
        items_.erase(code);
    }
    std::vector<SystemWarning> list() const {
        std::lock_guard<std::mutex> l(mu_);
        std::vector<SystemWarning> out;
        for (const auto& kv : items_) out.push_back(kv.second);
        return out;
    }

   private:
    Clock clock_;
    mutable std::mutex mu_;
    std::map<std::string, SystemWarning> items_;
};

}  // namespace mat
