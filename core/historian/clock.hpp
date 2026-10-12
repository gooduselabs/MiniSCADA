// Clock helpers of the historian (specs/003-data-logging research R5): fixed UTC offsets
// (±HH:MM, no DST), local time text, cyclic alignment and the build-time clock floor.
#pragma once
#include <cstdint>
#include <optional>
#include <string>

namespace mat {

// "+07:00" → 420 minutes. Accepts −12:00 … +14:00; anything else → nullopt.
std::optional<int> parseUtcOffset(const std::string& s);
std::string formatUtcOffset(int minutes);

// "YYYY-MM-DD HH:MM:SS.mmm" in local time (sep = ' ' or 'T').
std::string formatLocalTime(int64_t utcMs, int offsetMin, char sep = ' ');
// "YYYY-MM-DD", "YYYY-MM-DD HH:MM" or "YYYY-MM-DD HH:MM:SS" in local time → UTC ms.
std::optional<int64_t> parseLocalTime(const std::string& s, int offsetMin);

// First slot strictly after `nowUtc`. Periods dividing a day are aligned to local midnight;
// other periods count from `anchorUtc` (which is returned when `nowUtc` is before it).
int64_t alignedNext(int64_t nowUtc, int64_t periodMs, int offsetMin, int64_t anchorUtc);

// The device clock is unusable before the runtime was built (RTC lost → 1970).
int64_t clockFloorMs();
bool clockValid(int64_t nowUtc);

}  // namespace mat
