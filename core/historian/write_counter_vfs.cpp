#include "core/historian/write_counter_vfs.hpp"

#include <sqlite3.h>

#include <atomic>
#include <cstring>
#include <mutex>

namespace mat {

namespace {

constexpr int kMaxDbs = 16;  // history, alarm, audit and spares; slot 15 collects any further name
constexpr size_t kNameMax = 48;

struct Slot {
    char name[kNameMax] = {};
    std::atomic<int64_t> bytes{0};
    std::atomic<bool> used{false};
};

Slot g_slots[kMaxDbs];
std::mutex g_slotMu;  // only to add a name (xOpen), never on the write path

// Base name of the file without the directory and the -wal / -journal / -shm suffix.
std::string dbNameOf(const char* zName) {
    if (!zName) return "temp";
    std::string s = zName;
    const size_t slash = s.find_last_of('/');
    if (slash != std::string::npos) s = s.substr(slash + 1);
    for (const char* suf : {"-wal", "-journal", "-shm"}) {
        const size_t n = std::strlen(suf);
        if (s.size() > n && s.compare(s.size() - n, n, suf) == 0) {
            s.resize(s.size() - n);
            break;
        }
    }
    if (s.size() >= kNameMax) s.resize(kNameMax - 1);
    return s;
}

Slot* slotFor(const std::string& name) {
    std::lock_guard<std::mutex> g(g_slotMu);
    for (int i = 0; i < kMaxDbs - 1; ++i) {
        Slot& s = g_slots[i];
        if (!s.used.load()) {
            std::memcpy(s.name, name.c_str(), name.size() + 1);
            s.used.store(true);
            return &s;
        }
        if (name == s.name) return &s;
    }
    Slot& other = g_slots[kMaxDbs - 1];
    if (!other.used.load()) {
        std::strcpy(other.name, "other");
        other.used.store(true);
    }
    return &other;
}

// ---- file shim: our header, then the file of the real VFS
struct CountFile {
    sqlite3_file base;
    Slot* slot;
    // the real file follows (szOsFile of the real VFS)
};

sqlite3_file* realOf(sqlite3_file* f) {
    return reinterpret_cast<sqlite3_file*>(static_cast<CountFile*>(static_cast<void*>(f)) + 1);
}
int cClose(sqlite3_file* f) {
    sqlite3_file* r = realOf(f);
    const int rc = r->pMethods ? r->pMethods->xClose(r) : SQLITE_OK;
    static_cast<CountFile*>(static_cast<void*>(f))->base.pMethods = nullptr;
    return rc;
}
int cRead(sqlite3_file* f, void* p, int n, sqlite3_int64 o) {
    sqlite3_file* r = realOf(f);
    return r->pMethods->xRead(r, p, n, o);
}
int cWrite(sqlite3_file* f, const void* p, int n, sqlite3_int64 o) {
    sqlite3_file* r = realOf(f);
    const int rc = r->pMethods->xWrite(r, p, n, o);
    if (rc == SQLITE_OK)
        static_cast<CountFile*>(static_cast<void*>(f))->slot->bytes.fetch_add(
            n, std::memory_order_relaxed);
    return rc;
}
int cTruncate(sqlite3_file* f, sqlite3_int64 s) {
    sqlite3_file* r = realOf(f);
    return r->pMethods->xTruncate(r, s);
}
int cSync(sqlite3_file* f, int fl) {
    sqlite3_file* r = realOf(f);
    return r->pMethods->xSync(r, fl);
}
int cFileSize(sqlite3_file* f, sqlite3_int64* s) {
    sqlite3_file* r = realOf(f);
    return r->pMethods->xFileSize(r, s);
}
int cLock(sqlite3_file* f, int l) {
    sqlite3_file* r = realOf(f);
    return r->pMethods->xLock(r, l);
}
int cUnlock(sqlite3_file* f, int l) {
    sqlite3_file* r = realOf(f);
    return r->pMethods->xUnlock(r, l);
}
int cCheckReserved(sqlite3_file* f, int* o) {
    sqlite3_file* r = realOf(f);
    return r->pMethods->xCheckReservedLock(r, o);
}
int cFileControl(sqlite3_file* f, int op, void* a) {
    sqlite3_file* r = realOf(f);
    return r->pMethods->xFileControl(r, op, a);
}
int cSectorSize(sqlite3_file* f) {
    sqlite3_file* r = realOf(f);
    return r->pMethods->xSectorSize(r);
}
int cDeviceChar(sqlite3_file* f) {
    sqlite3_file* r = realOf(f);
    return r->pMethods->xDeviceCharacteristics(r);
}
int cShmMap(sqlite3_file* f, int pg, int sz, int ex, void volatile** pp) {
    sqlite3_file* r = realOf(f);
    return r->pMethods->xShmMap(r, pg, sz, ex, pp);
}
int cShmLock(sqlite3_file* f, int off, int n, int fl) {
    sqlite3_file* r = realOf(f);
    return r->pMethods->xShmLock(r, off, n, fl);
}
void cShmBarrier(sqlite3_file* f) {
    sqlite3_file* r = realOf(f);
    r->pMethods->xShmBarrier(r);
}
int cShmUnmap(sqlite3_file* f, int del) {
    sqlite3_file* r = realOf(f);
    return r->pMethods->xShmUnmap(r, del);
}

// Version 2 (WAL needs the shm methods); no xFetch/xUnfetch: no memory-mapped I/O through the shim.
const sqlite3_io_methods kMethods = {2,           cClose,      cRead,         cWrite,
                                     cTruncate,   cSync,       cFileSize,     cLock,
                                     cUnlock,     cCheckReserved, cFileControl, cSectorSize,
                                     cDeviceChar, cShmMap,     cShmLock,      cShmBarrier,
                                     cShmUnmap,   nullptr,     nullptr};

// ---- VFS shim: forwards everything to the default VFS found at registration
sqlite3_vfs* g_real = nullptr;
sqlite3_vfs g_vfs;

int vOpen(sqlite3_vfs*, const char* zName, sqlite3_file* f, int flags, int* outFlags) {
    CountFile* cf = static_cast<CountFile*>(static_cast<void*>(f));
    cf->base.pMethods = nullptr;
    cf->slot = slotFor(dbNameOf(zName));
    const int rc = g_real->xOpen(g_real, zName, realOf(f), flags, outFlags);
    if (rc == SQLITE_OK) cf->base.pMethods = &kMethods;
    return rc;
}
int vDelete(sqlite3_vfs*, const char* n, int sync) { return g_real->xDelete(g_real, n, sync); }
int vAccess(sqlite3_vfs*, const char* n, int fl, int* o) { return g_real->xAccess(g_real, n, fl, o); }
int vFull(sqlite3_vfs*, const char* n, int nOut, char* out) {
    return g_real->xFullPathname(g_real, n, nOut, out);
}
void* vDlOpen(sqlite3_vfs*, const char* n) { return g_real->xDlOpen(g_real, n); }
void vDlError(sqlite3_vfs*, int n, char* m) { g_real->xDlError(g_real, n, m); }
void (*vDlSym(sqlite3_vfs*, void* h, const char* s))(void) { return g_real->xDlSym(g_real, h, s); }
void vDlClose(sqlite3_vfs*, void* h) { g_real->xDlClose(g_real, h); }
int vRandom(sqlite3_vfs*, int n, char* o) { return g_real->xRandomness(g_real, n, o); }
int vSleep(sqlite3_vfs*, int us) { return g_real->xSleep(g_real, us); }
int vCurrentTime(sqlite3_vfs*, double* t) { return g_real->xCurrentTime(g_real, t); }
int vLastError(sqlite3_vfs*, int n, char* m) { return g_real->xGetLastError(g_real, n, m); }
int vCurrentTime64(sqlite3_vfs*, sqlite3_int64* t) {
    return g_real->iVersion >= 2 && g_real->xCurrentTimeInt64 ? g_real->xCurrentTimeInt64(g_real, t)
                                                              : SQLITE_ERROR;
}

std::once_flag g_once;
bool g_ok = false;

}  // namespace

bool registerCountingVfs() {
    std::call_once(g_once, [] {
        g_real = sqlite3_vfs_find(nullptr);
        if (!g_real) return;
        g_vfs = {};
        g_vfs.iVersion = 2;
        g_vfs.szOsFile = static_cast<int>(sizeof(CountFile)) + g_real->szOsFile;
        g_vfs.mxPathname = g_real->mxPathname;
        g_vfs.zName = kCountingVfsName;
        g_vfs.xOpen = vOpen;
        g_vfs.xDelete = vDelete;
        g_vfs.xAccess = vAccess;
        g_vfs.xFullPathname = vFull;
        g_vfs.xDlOpen = vDlOpen;
        g_vfs.xDlError = vDlError;
        g_vfs.xDlSym = vDlSym;
        g_vfs.xDlClose = vDlClose;
        g_vfs.xRandomness = vRandom;
        g_vfs.xSleep = vSleep;
        g_vfs.xCurrentTime = vCurrentTime;
        g_vfs.xGetLastError = vLastError;
        g_vfs.xCurrentTimeInt64 = vCurrentTime64;
        g_ok = sqlite3_vfs_register(&g_vfs, 0) == SQLITE_OK;
    });
    return g_ok;
}

const char* countingVfsName() { return registerCountingVfs() ? kCountingVfsName : nullptr; }

std::vector<DbWriteBytes> dbWriteBytes() {
    std::vector<DbWriteBytes> out;
    for (auto& s : g_slots)
        if (s.used.load()) out.push_back({s.name, s.bytes.load(std::memory_order_relaxed)});
    return out;
}

int64_t totalDbWriteBytes() {
    int64_t t = 0;
    for (auto& s : g_slots)
        if (s.used.load()) t += s.bytes.load(std::memory_order_relaxed);
    return t;
}

void resetDbWriteBytesForTest(const std::string& db) {
    for (auto& s : g_slots)
        if (s.used.load() && db == s.name) s.bytes.store(0);
}

}  // namespace mat
