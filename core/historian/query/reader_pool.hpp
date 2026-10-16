// Read-only connections to history.db for queries (specs/010-history-reports
// contracts/history-api.md §7): at most 3, opened on first use and closed when idle, `query_only`,
// a small cache, no mmap, and a progress handler that stops a statement at its deadline or when the
// caller cancels.
#pragma once
#include <sqlite3.h>

#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace mat {

class ReaderPool {
   public:
    struct Options {
        std::string dbPath;
        int cacheKiB = 4096;
        int maxConnections = 3;
        int64_t idleCloseMs = 60000;
        std::function<int64_t()> nowMono;  // empty = steady clock, ms
    };

    // One connection on loan. Returns itself to the pool when destroyed.
    class Lease {
       public:
        ~Lease();
        Lease(const Lease&) = delete;
        Lease& operator=(const Lease&) = delete;
        sqlite3* db() const { return db_; }
        // Why the last statement was stopped, if it was.
        bool timedOut() const;
        bool cancelled() const;

       private:
        friend class ReaderPool;
        Lease(ReaderPool* pool, size_t slot, sqlite3* db) : pool_(pool), slot_(slot), db_(db) {}
        ReaderPool* pool_;
        size_t slot_;
        sqlite3* db_;
    };

    explicit ReaderPool(Options opt);
    ~ReaderPool();
    ReaderPool(const ReaderPool&) = delete;
    ReaderPool& operator=(const ReaderPool&) = delete;

    // nullptr when all connections are busy or the file cannot be opened (`err` says which;
    // "busy" for the first). `deadlineMono` is absolute (0 = none); `cancel` may be null.
    std::unique_ptr<Lease> acquire(int64_t deadlineMono, const std::atomic<bool>* cancel,
                                   std::string& err);
    // Closes the connections idle for longer than `idleCloseMs`; acquire() calls it too.
    void closeIdle();
    int openConnections() const;
    int64_t now() const;

   private:
    struct Slot {
        sqlite3* db = nullptr;
        bool busy = false;
        int64_t lastUsed = 0;
        int64_t deadline = 0;
        const std::atomic<bool>* cancel = nullptr;
        bool timedOut = false;
        bool cancelled = false;
        ReaderPool* pool = nullptr;
    };
    static int progress(void* ctx);
    void giveBack(size_t slot);
    bool openSlot(Slot& s, std::string& err);

    Options opt_;
    mutable std::mutex mu_;
    std::vector<Slot> slots_;
};

}  // namespace mat
