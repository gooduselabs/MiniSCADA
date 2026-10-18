// glibc arenas of mat-runtime (feature 011 T147, server/malloc_tuning.hpp): 16 threads that each
// build and free ~1 MB of small blocks (as an HTTPS worker building a large JSON answer) leave one
// arena each without the cap, at most kMallocArenaMax with it; trimMalloc() gives the free pages
// back. Each case runs in a forked child: the cap only holds for arenas made after it is set.
#include "server/malloc_tuning.hpp"

#include <gtest/gtest.h>
#include <sys/wait.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <thread>
#include <vector>

namespace {

#if defined(__GLIBC__)
// <heap nr="..."> elements of malloc_info: one per arena.
int arenaCount() {
    char* buf = nullptr;
    size_t len = 0;
    FILE* f = ::open_memstream(&buf, &len);
    if (!f) return -1;
    const int rc = ::malloc_info(0, f);
    std::fclose(f);
    if (rc != 0) {
        std::free(buf);
        return -1;
    }
    int n = 0;
    for (const char* p = buf; (p = std::strstr(p, "<heap nr=")) != nullptr; ++p) ++n;
    std::free(buf);
    return n;
}

long rssKb() {
    std::ifstream in("/proc/self/status");
    std::string line;
    while (std::getline(in, line))
        if (line.rfind("VmRSS:", 0) == 0) return std::strtol(line.c_str() + 6, nullptr, 10);
    return -1;
}

void burst() {
    std::vector<std::thread> ts;
    for (int t = 0; t < 16; ++t)
        ts.emplace_back([] {
            std::vector<std::string*> v;
            for (int i = 0; i < 8000; ++i) v.push_back(new std::string(100, 'x'));
            for (auto* s : v) delete s;
        });
    for (auto& t : ts) t.join();
}

// Exit status of a child that runs `fn` (0 = all fine).
template <class F>
int inChild(F fn) {
    const pid_t pid = ::fork();
    if (pid == 0) ::_exit(fn());
    int st = 0;
    ::waitpid(pid, &st, 0);
    return WIFEXITED(st) ? WEXITSTATUS(st) : 100;
}
#endif

}  // namespace

TEST(MallocTuning, WithoutTheCapEachThreadHasItsArenaWithItOnlyTwo) {
#if !defined(__GLIBC__)
    GTEST_SKIP() << "glibc only";
#else
    if (std::thread::hardware_concurrency() < 2) GTEST_SKIP() << "one core: few arenas anyway";
    // the control: without the cap the burst makes more arenas than the cap allows
    EXPECT_EQ(inChild([] {
                  burst();
                  return arenaCount() > mat::kMallocArenaMax ? 0 : 1;
              }),
              0)
        << "the control did not make more than " << mat::kMallocArenaMax << " arenas";
    EXPECT_EQ(inChild([] {
                  if (!mat::limitMallocArenas()) return 2;
                  burst();
                  const int n = arenaCount();
                  return n >= 1 && n <= mat::kMallocArenaMax ? 0 : 1;
              }),
              0);
#endif
}

TEST(MallocTuning, TrimGivesTheFreePagesOfTheArenasBack) {
#if !defined(__GLIBC__)
    GTEST_SKIP() << "glibc only";
#else
    EXPECT_EQ(inChild([] {
                  mat::limitMallocArenas();
                  // a burst of 32 MB in small blocks, freed except one block at the end of each
                  // arena's top (the case malloc's own trim of the top does not cover)
                  std::vector<std::thread> ts;
                  std::vector<std::string*> keep(4, nullptr);
                  for (int t = 0; t < 4; ++t)
                      ts.emplace_back([&keep, t] {
                          std::vector<std::string*> v;
                          for (int i = 0; i < 80000; ++i) v.push_back(new std::string(100, 'x'));
                          keep[static_cast<size_t>(t)] = new std::string(100, 'k');
                          for (auto* s : v) delete s;
                      });
                  for (auto& t : ts) t.join();
                  const long before = rssKb();
                  mat::trimMalloc();
                  const long after = rssKb();
                  for (auto* s : keep) delete s;
                  return before - after >= 8 * 1024 ? 0 : 1;  // at least 8 MB of the 32 back
              }),
              0);
#endif
}
