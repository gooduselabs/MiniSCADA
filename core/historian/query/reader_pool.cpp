#include "core/historian/query/reader_pool.hpp"

#include <chrono>

namespace mat {

namespace {
int64_t steadyMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}
}  // namespace

ReaderPool::ReaderPool(Options opt) : opt_(std::move(opt)) {
    if (!opt_.nowMono) opt_.nowMono = steadyMs;
    slots_.resize(static_cast<size_t>(opt_.maxConnections > 0 ? opt_.maxConnections : 1));
    for (auto& s : slots_) s.pool = this;
}

ReaderPool::~ReaderPool() {
    for (auto& s : slots_)
        if (s.db) sqlite3_close(s.db);
}

int64_t ReaderPool::now() const { return opt_.nowMono(); }

// Called by SQLite every 1,000 virtual machine steps: non-zero stops the statement.
int ReaderPool::progress(void* ctx) {
    auto* s = static_cast<Slot*>(ctx);
    if (s->cancel && s->cancel->load()) {
        s->cancelled = true;
        return 1;
    }
    if (s->deadline > 0 && s->pool->now() >= s->deadline) {
        s->timedOut = true;
        return 1;
    }
    return 0;
}

bool ReaderPool::openSlot(Slot& s, std::string& err) {
    sqlite3* db = nullptr;
    if (sqlite3_open_v2(opt_.dbPath.c_str(), &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX,
                        nullptr) != SQLITE_OK) {
        err = "open";
        if (db) sqlite3_close(db);
        return false;
    }
    sqlite3_busy_timeout(db, 2000);
    const std::string pragmas = "PRAGMA query_only=1;PRAGMA mmap_size=0;PRAGMA cache_size=-" +
                                std::to_string(opt_.cacheKiB) + ";PRAGMA temp_store=MEMORY;";
    char* msg = nullptr;
    if (sqlite3_exec(db, pragmas.c_str(), nullptr, nullptr, &msg) != SQLITE_OK) {
        sqlite3_free(msg);
        sqlite3_close(db);
        err = "pragma";
        return false;
    }
    sqlite3_progress_handler(db, 1000, &ReaderPool::progress, &s);
    s.db = db;
    return true;
}

std::unique_ptr<ReaderPool::Lease> ReaderPool::acquire(int64_t deadlineMono,
                                                       const std::atomic<bool>* cancel,
                                                       std::string& err) {
    closeIdle();
    std::lock_guard<std::mutex> g(mu_);
    for (size_t i = 0; i < slots_.size(); ++i) {
        Slot& s = slots_[i];
        if (s.busy) continue;
        if (!s.db && !openSlot(s, err)) return nullptr;
        s.busy = true;
        s.deadline = deadlineMono;
        s.cancel = cancel;
        s.timedOut = false;
        s.cancelled = false;
        return std::unique_ptr<Lease>(new Lease(this, i, s.db));
    }
    err = "busy";
    return nullptr;
}

void ReaderPool::giveBack(size_t slot) {
    std::lock_guard<std::mutex> g(mu_);
    Slot& s = slots_[slot];
    s.busy = false;
    s.cancel = nullptr;
    s.deadline = 0;
    s.lastUsed = opt_.nowMono();
}

void ReaderPool::closeIdle() {
    std::lock_guard<std::mutex> g(mu_);
    const int64_t t = opt_.nowMono();
    for (auto& s : slots_)
        if (s.db && !s.busy && t - s.lastUsed >= opt_.idleCloseMs) {
            sqlite3_close(s.db);
            s.db = nullptr;
        }
}

int ReaderPool::openConnections() const {
    std::lock_guard<std::mutex> g(mu_);
    int n = 0;
    for (const auto& s : slots_) n += s.db ? 1 : 0;
    return n;
}

ReaderPool::Lease::~Lease() { pool_->giveBack(slot_); }

bool ReaderPool::Lease::timedOut() const {
    std::lock_guard<std::mutex> g(pool_->mu_);
    return pool_->slots_[slot_].timedOut;
}

bool ReaderPool::Lease::cancelled() const {
    std::lock_guard<std::mutex> g(pool_->mu_);
    return pool_->slots_[slot_].cancelled;
}

}  // namespace mat
