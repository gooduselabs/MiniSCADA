// CSV text of the history export (specs/010-history-reports contracts/history-api.md §6, FR-024,
// FR-061): one formatter for the export.csv endpoint and the --export-history command, so that both
// give the same bytes. Comma, CRLF, numbers as %.15g in the C locale, local time of the group,
// text cells that start like a formula are made harmless.
#pragma once
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "core/historian/cell.hpp"

namespace mat {

constexpr size_t kCsvChunkBytes = 64 * 1024;

// UTF-8 byte order mark.
const char* csvBom();

// %.15g, '.' as the decimal point whatever the locale; "" for NaN / infinity.
std::string csvNumber(double v);
// Quoted when the text holds , " CR or LF (quotes doubled); a text that starts with = + - @ TAB or
// CR gets a leading apostrophe so that a spreadsheet does not run it as a formula.
std::string csvText(const std::string& s);
// One cell of a row read from SQLite: NULL empty, integers as is, reals as csvNumber, text as csvText.
std::string csvCell(const Cell& c);

// "yyyy-MM-dd HH:mm:ss.SSS" (resMs 0), "yyyy-MM-dd HH:mm" (60000) or "yyyy-MM-dd HH:00" (3600000)
// in the local time of `offsetMin`.
std::string csvTime(int64_t utcMs, int offsetMin, int64_t resMs);

// Header line: "time" then the names (already `<column>` or `<column>.<field>`), CRLF at the end.
std::string csvHeader(const std::vector<std::string>& names);

// `cells` already formatted (csvCell / csvNumber): "<time>,<c1>,<c2>\r\n".
std::string csvLine(const std::string& time, const std::vector<std::string>& cells);

// Collects text and hands it over in chunks of at most kCsvChunkBytes. `sink` returns false when
// the reader is gone; the chunker then refuses more.
class CsvChunker {
   public:
    explicit CsvChunker(std::function<bool(const std::string&)> sink,
                        size_t limit = kCsvChunkBytes)
        : sink_(std::move(sink)), limit_(limit) {}
    bool append(const std::string& s);
    bool flush();
    bool ok() const { return ok_; }

   private:
    std::function<bool(const std::string&)> sink_;
    size_t limit_;
    std::string buf_;
    bool ok_ = true;
};

}  // namespace mat
