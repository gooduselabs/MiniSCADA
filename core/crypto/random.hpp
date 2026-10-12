// Random bytes from the kernel (getrandom(2), glibc 2.31; feature 005 research R9): session tokens,
// salts, certificate serials, device id.
#pragma once
#include <sys/types.h>

#include <cstddef>
#include <functional>
#include <string>

namespace mat {

// Fills `buf` with `len` bytes from the kernel CSPRNG. Flags 0: blocks only until the pool is
// first initialised after boot, never afterwards. Retries on EINTR and on short reads; any other
// failure throws std::system_error, so it never returns with a buffer that is not fully random.
void randomBytes(void* buf, size_t len);
// The same, as a new string of `len` bytes.
std::string randomBytes(size_t len);

namespace detail {
// The loop of randomBytes() over an injectable getrandom(buf, len, flags), for unit tests.
using GetrandomFn = std::function<ssize_t(void* buf, size_t len, unsigned int flags)>;
void randomBytesWith(const GetrandomFn& getrandomFn, void* buf, size_t len);
}  // namespace detail

}  // namespace mat
