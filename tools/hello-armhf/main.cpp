#include <sys/utsname.h>

#include <cstdio>

int main() {
    utsname u{};
    uname(&u);
    std::printf("mAT hello-armhf: C++ standard %ld, machine=%s, kernel=%s\n", __cplusplus,
                u.machine, u.release);
    return 0;
}
