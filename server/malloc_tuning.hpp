// glibc allocator settings of mat-runtime (feature 011 T147). On a 64-bit glibc each thread that
// allocates may get its own arena (up to 8 per core); an arena keeps the pages its largest burst
// touched. The runtime has ~100 threads (64 HTTPS workers): a JSON answer built on a worker
// (GET /api/v1/logic of 550 blocks: ~1 MB of nodes for 77 KB of text) left ~0.9 MB resident in
// each of 31 arenas, +30 MB RSS in the x64 L7 run. limitMallocArenas() at the start of main(),
// before any thread, caps them; trimMalloc() gives the free pages of every arena back to the
// kernel (the main loop calls it once a minute). No-ops elsewhere (macOS, musl).
#pragma once
#include <cstdlib>  // defines __GLIBC__ on glibc (it is not defined before a libc header)
#if defined(__GLIBC__)
#include <malloc.h>
#endif

namespace mat {

constexpr int kMallocArenaMax = 2;
constexpr long long kMallocTrimPeriodMs = 60000;

// false where there is nothing to set (not glibc) or glibc refused.
inline bool limitMallocArenas(int maxArenas = kMallocArenaMax) {
#if defined(__GLIBC__)
    return ::mallopt(M_ARENA_MAX, maxArenas) == 1;
#else
    (void)maxArenas;
    return false;
#endif
}

inline void trimMalloc() {
#if defined(__GLIBC__)
    ::malloc_trim(0);
#endif
}

}  // namespace mat
