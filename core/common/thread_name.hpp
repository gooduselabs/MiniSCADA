// Names the calling thread (at most 15 characters), so that /proc/<pid>/task/*/comm and top -H
// show what the runtime's threads are. A no-op off Linux.
#pragma once
#ifdef __linux__
#include <pthread.h>
#endif

namespace mat {
inline void setThreadName(const char* name) {
#ifdef __linux__
    ::pthread_setname_np(::pthread_self(), name);
#else
    (void)name;
#endif
}
}  // namespace mat
