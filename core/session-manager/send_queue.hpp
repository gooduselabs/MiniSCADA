// Bounded per-session send queue (Master Plan 6.1: <= 256 KB per client).
// Producers (delta broadcaster, protocol handler) only push; one writer thread per session pops
// and performs the (possibly blocking) socket write. On overflow the pending data is dropped and
// replaced by `resync_required` followed by a close request (4409), so a slow client can never
// block other clients or grow memory. Independent of the web server library.
#pragma once
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <deque>
#include <mutex>
#include <string>

namespace mat {

class SendQueue {
   public:
    static constexpr size_t kDefaultMaxBytes = 262144;
    static constexpr int kCloseResync = 4409;
    static constexpr const char* kResyncRequired =
        "{\"type\":\"resync_required\",\"reason\":\"SEND_QUEUE_OVERFLOW\"}";

    enum class PushResult { Ok, Overflow, Closed };
    enum class PopStatus { Item, Timeout, Closed };

    struct Item {
        std::string text;   // message to send (empty for a close request)
        int closeCode = 0;  // != 0: send a close frame with this code, then stop
        std::string closeReason;
    };

    explicit SendQueue(size_t maxBytes = kDefaultMaxBytes) : max_(maxBytes) {}

    PushResult push(std::string text) {
        std::lock_guard<std::mutex> g(mu_);
        if (closing_ || aborted_) return PushResult::Closed;
        if (bytes_ + text.size() > max_) {
            items_.clear();
            overflowed_ = true;
            items_.push_back(Item{kResyncRequired, 0, {}});
            bytes_ = items_.front().text.size();  // control message bypasses the limit
            items_.push_back(Item{{}, kCloseResync, "RESYNC_REQUIRED"});
            closing_ = true;
            cv_.notify_all();
            return PushResult::Overflow;
        }
        bytes_ += text.size();
        items_.push_back(Item{std::move(text), 0, {}});
        cv_.notify_all();
        return PushResult::Ok;
    }

    // Delivers what is already queued, then a close frame. Later pushes are dropped.
    void requestClose(int code, std::string reason) {
        std::lock_guard<std::mutex> g(mu_);
        if (closing_ || aborted_) return;
        closing_ = true;
        items_.push_back(Item{{}, code, std::move(reason)});
        cv_.notify_all();
    }

    // Connection is gone: drop everything and wake the writer.
    void abort() {
        std::lock_guard<std::mutex> g(mu_);
        aborted_ = true;
        items_.clear();
        bytes_ = 0;
        cv_.notify_all();
    }

    // timeoutMs < 0 waits forever.
    PopStatus pop(Item& out, int timeoutMs) {
        std::unique_lock<std::mutex> g(mu_);
        auto ready = [&] { return aborted_ || !items_.empty() || closeDelivered_; };
        if (timeoutMs < 0)
            cv_.wait(g, ready);
        else if (!cv_.wait_for(g, std::chrono::milliseconds(timeoutMs), ready))
            return PopStatus::Timeout;
        if (aborted_ || items_.empty()) return PopStatus::Closed;
        out = std::move(items_.front());
        items_.pop_front();
        bytes_ -= out.text.size();
        if (out.closeCode != 0) closeDelivered_ = true;
        return PopStatus::Item;
    }

    size_t bytes() const {
        std::lock_guard<std::mutex> g(mu_);
        return bytes_;
    }
    bool overflowed() const {
        std::lock_guard<std::mutex> g(mu_);
        return overflowed_;
    }
    size_t maxBytes() const { return max_; }

   private:
    mutable std::mutex mu_;
    std::condition_variable cv_;
    std::deque<Item> items_;
    size_t max_;
    size_t bytes_ = 0;
    bool closing_ = false;
    bool closeDelivered_ = false;
    bool aborted_ = false;
    bool overflowed_ = false;
};

}  // namespace mat
