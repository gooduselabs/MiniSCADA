#include "core/crypto/random.hpp"

#include <sys/random.h>

#include <cerrno>
#include <system_error>

namespace mat {

void detail::randomBytesWith(const GetrandomFn& getrandomFn, void* buf, size_t len) {
    auto* out = static_cast<unsigned char*>(buf);
    size_t done = 0;
    while (done < len) {
        const ssize_t n = getrandomFn(out + done, len - done, 0);
        if (n > 0) {
            done += static_cast<size_t>(n);
        } else if (n < 0 && errno == EINTR) {
            continue;  // a signal before any byte: ask again
        } else {
            // ENOSYS (kernel < 3.17), EPERM (seccomp), EFAULT…: no fallback to a weaker source.
            // getrandom never returns 0 for a non-empty request; if it did, asking again could
            // loop forever.
            const int err = n < 0 ? errno : EIO;
            throw std::system_error(err, std::generic_category(), "getrandom");
        }
    }
}

void randomBytes(void* buf, size_t len) {
    detail::randomBytesWith(
        [](void* b, size_t n, unsigned int flags) { return ::getrandom(b, n, flags); }, buf, len);
}

std::string randomBytes(size_t len) {
    std::string out(len, '\0');
    randomBytes(&out[0], len);
    return out;
}

}  // namespace mat
