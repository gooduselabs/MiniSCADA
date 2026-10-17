// The listing of payload.tar.gz (FR-061, contract §6 cases 5–7, 10–12): gzip inflated in a fixed
// 32 KiB window (miniz tinfl, no allocation that grows with the input), ustar headers read one by
// one, each regular file hashed and compared with files[]. Directories must be clean and allowed;
// links (hard and symbolic) are LINK_FORBIDDEN, devices and FIFOs SPECIAL_FORBIDDEN, extension
// headers PATH_INVALID; a file not in files[] FILE_EXTRA, a file of files[] never seen
// FILE_MISSING, a size or digest that differs FILE_DIGEST, more than 128 MiB unpacked
// UNPACKED_TOO_LARGE, a broken gzip or tar PAYLOAD_FORMAT. Nothing is written anywhere.
#pragma once
#include <cstdint>
#include <optional>

#include "core/update/envelope.hpp"
#include "core/update/manifest.hpp"

namespace mat::update {

// `in` is positioned at the first byte of the payload; exactly `size` bytes are read.
std::optional<Error> scanPayload(Source& in, uint64_t size, const Manifest& m);

}  // namespace mat::update
