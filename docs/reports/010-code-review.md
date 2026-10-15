# Rà soát mã feature 010 (T158) — năm trục

Ngày: 2026-10-15. Nhánh `worktree-agent-a42606f7b5d8cad7a`. Phạm vi: lưu trữ C++ (`core/historian`, `core/historian/query`), API (`server/http/history_api.cpp`, `server/cli`), `packages/history-math`, `packages/report-export`, `apps/runtime-web` (history-source, history-page, report-page), các widget lịch sử, `packages/project-schema/src/rules-010.ts`, Studio `logging-doc`. Không chạy test và không build: mọi phát hiện dưới đây rút ra từ việc đọc mã; chỗ chưa chắc có ghi rõ. Không lặp lại các mục đã xử lý trong `docs/reports/010-security-review.md`.

Kết luận: **YÊU CẦU SỬA** trước khi coi 010 là xong. 1 Critical, 5 Important, 8 Minor.

## Bảng phát hiện

| # | Mức | Vị trí | Tóm tắt |
|---|-----|--------|---------|
| C1 | Critical | `core/historian/historian.cpp:591-610, 1014-1025, 475-552` | Dừng sạch (hoặc ngắt tín hiệu) ghi bucket phút đang mở nhưng `agg_built_to` vẫn ở đầu phút đó; lần khởi động sau dựng lại phút ấy và upsert cộng dồn, nên `n`, `sumw`, `wms` của phút đó nhân đôi |
| I1 | Important | `core/historian/query/history_query.cpp:510-516` (+ `exportCsv` 1h, `chooseSource`) | Nguồn "giờ" được chọn khi có bất kỳ hàng giờ nào; giờ đang chạy chưa có hàng giờ nên cửa sổ cuối bị trống, tổng của "hôm nay", "tháng này", báo cáo kỳ ngày bị thiếu giờ hiện tại |
| I2 | Important | `packages/history-math/src/period.ts:129-146, 196-211`; `history-bar.ts:185`; `history-pie.ts:199` | Khoảng yêu cầu rỗng hoặc ngược (`from >= to`) sau nửa đêm và trước giờ bắt đầu ca; máy chủ trả 400 và widget vào trạng thái lỗi |
| I3 | Important | `core/historian/query/history_query.cpp:214-217, 528-548` | Truy vấn từng Tag theo `cid = ?` trên khóa `(res, bucket, cid)`: mỗi Tag quét mọi cột của nhóm trong khoảng, chi phí nhân với số Tag |
| I4 | Important | `server/http/history_api.cpp:230, 360, 432, 516, 599` | `pool_.acquire(..., nullptr, ...)`: cờ hủy không bao giờ được nối; client hủy hoặc ngắt kết nối thì truy vấn vẫn chạy đến hết hạn và giữ chỗ phiên, các truy vấn sau nhận 429 |
| I5 | Important | `server/http/history_api.cpp:230-277` | `catalog` khi hồ đọc bận trả 200 với `raw`/`aggregates` = null và client lưu đệm bản này |
| M1 | Minor | `core/historian/historian.cpp:484-485` | Khôi phục đọc lại dòng ở đúng ms `builtTo - 1` (đã tính vào phút trước) |
| M2 | Minor | `core/historian/query/history_query.cpp:555-562` | `queryRows` lọc theo `ts` nhưng sắp theo `seq`: kế hoạch truy vấn có thể quét theo khoảng rộng cho mỗi trang |
| M3 | Minor | `packages/report-export/src/csv/csv.ts:12`, `xlsx.ts:92` | `guardFormula` TS thiếu `\t` `\r` (bản C++ có); XLSX thêm nháy đơn hiển thị vào ô chuỗi nội tuyến vốn không bị coi là công thức |
| M4 | Minor | `packages/history-math/src/format.ts:98-105`; `xlsx.ts:41` | `formatNumber` sai khi `|v|·10^d` vượt 2^53 hoặc ≥ 1e21; `toNumber` của XLSX nhận chuỗi mũ |
| M5 | Minor | `core/historian/query/agg_verify.cpp:111` | SQL ghép chuỗi tên bảng (lấy từ chính DB) thay vì bind |
| M6 | Minor | `core/historian/query/reader_pool.cpp:29-40, 113-121` | Cờ `timedOut`/`cancelled` ghi trong handler không khóa, đọc ở `Lease::timedOut()` có khóa: đua dữ liệu (lành tính nhưng là hành vi không xác định) |
| M7 | Minor | `server/http/history_api.cpp:585-590` | `fields=min,min` được nhận, sinh cột trùng tên trong CSV |
| M8 | Minor | `server/cli/export_history.cpp:64` | `--tz` mặc định `+07:00` cứng, không theo `offsetMin` của project; dòng thô lẫn dòng tổng hợp dùng múi này |

## Chi tiết Critical và Important

### C1 — Phút đang mở bị đếm hai lần sau khi dừng sạch rồi khởi động lại

- Lý do (rút ra từ mã, chưa chạy): `collectAggregates` chỉ đặt `builtTo = floor(now, phút)` (historian.cpp:575-587), tức đầu phút đang mở. `stop()` gọi `breakAggregates(now)` (1016-1018); `breakAll` đóng cả cửa sổ đang mở và đẩy bucket phút một phần vào `aggBuffer_`; `tryCommit(force)` ghi bucket đó cùng mốc `builtTo` cũ. `breakAggregates` không dời mốc. Lần khởi động sau, `recoverGroup(gi, builtTo)` đọc lại mọi dòng thô có `ts >= builtTo - 1` (475-552) nên dựng lại đúng phút đó, rồi `aggMinute_` (upsert ghép, local_store.cpp:528-535) cộng `n`, `sumw`, `wms` vào hàng đã có. Hợp đồng history-db.md §4 viết "đặt `agg_built_to` = cuối cửa sổ chứa dòng cuối": `recoverGroup` tuân theo, nhưng đường dừng sạch thì không.
- Hậu quả: mỗi lần khởi động lại sạch (triển khai, `systemctl restart`) nhân đôi một bucket phút; `sum` (kWh), `count` và `wms > 60000` (độ phủ > 100 %) sai âm thầm. `avg` hầu như không lệch (cả tử và mẫu cùng nhân đôi) nên khó thấy. Cũng xảy ra khi tín hiệu bị ngắt giữa lúc chạy (nhảy đồng hồ, tạm dừng đĩa đầy) rồi tiến trình bị kill trước khi mốc được dời ở phút kế.
- Vì sao test không bắt được: `ARestartAfterACrashRebuilds…` sao chép file trước khi `stop()` (historian_agg_test.cpp:307-333); `RunsAreRecordedOnce…` khởi động lại sau `stop()` nhưng không kiểm `sum(n)`.
- Cách tái hiện: chạy fixture `Fx` 3,5 phút, `stop()`, dựng `Fx` thứ hai trên cùng thư mục, `run(2000)`, kiểm `SELECT n FROM mat_agg WHERE bucket = kT0 + 3*kMin` so với `count(*) FROM log_g WHERE ts >= kT0 + 3*kMin`: dự kiến lớn hơn.
- Đề xuất sửa: trong `breakAggregates(t)` thêm `AggMark{setBuiltTo, builtTo = floorTo(t, phút) + phút}` cho nhóm vừa đóng cửa sổ (bỏ qua nếu `t` nhỏ hơn mốc hiện có khi đồng hồ nhảy lùi), hoặc để `recoverGroup` bỏ qua phút đã có hàng khi `mat_runs.alive_ms` chứng tỏ lần chạy trước kết thúc sạch. Thêm test "dừng sạch rồi khởi động lại: Σ n = số dòng thô, không phút nào hơn 60 s".

### I1 — Cửa sổ cuối trống khi nguồn "giờ" được chọn

- Lý do: hàng giờ chỉ được tạo khi sang giờ mới (`queueHourRebuild` tại historian.cpp:895-899) hoặc lúc ngắt/khôi phục. `queryAggregate` chọn `res = 1h` khi `bucketMs` và `offsetMs` là bội giờ và `coverageOf(hour) > 0` (history_query.cpp:510-516): chỉ cần một hàng giờ bất kỳ. Giờ hiện tại (và phần phút còn nằm ngoài chu kỳ xả 15 phút) chưa có hàng giờ, nhưng có hàng phút. Cửa sổ chứa giờ đó trả `n = 0`. Hợp đồng history-api.md §4 mô tả đúng cách chọn này nên đây là lỗ hổng trong hợp đồng chứ không phải lệch khỏi hợp đồng.
- Ảnh hưởng: biểu đồ cột (bucket giờ, ngày, ca với `today`, `thisShift`, `thisMonth`), biểu đồ tròn, báo cáo kỳ ngày (hàng giờ hiện tại) thiếu số liệu của giờ đang chạy, ít nhất tới hết giờ; `delta` và `sum` thấp hơn thực tế mà vẫn hiện như số hợp lệ. Độ phủ báo cáo có hiện nhưng widget thì không. `export.csv?res=1h` có cùng khoảng trống.
- Đề xuất sửa: khi chọn giờ, lấy `tail = max(bucket giờ) + 1h` rồi đọc phần `[tail, a + count*bucketMs)` từ hàng phút và ghép vào cửa sổ tương ứng (cùng `mergeBuckets`); hoặc ghi hàng giờ một phần (INSERT OR REPLACE) mỗi lần xả 15 phút. Thêm vector: hàng giờ đến 10:00, hàng phút đến 10:40, `bucketMs = 1 ngày`, kỳ vọng gồm cả 10:00-10:40.

### I2 — Khoảng yêu cầu rỗng hoặc ngược của widget cột và tròn

- Lý do: `periodRange('today')` trả `[nửa đêm, now]` nên rỗng đúng phút 00:00 (biểu đồ tròn `today`: `bucketMs` bị nâng lên 1 phút nhưng `from == to`). `barModel` làm tròn `from` LÊN tới biên cửa sổ (period.ts:146); với `bucket: 'shift'`, `period: 'today'` (hợp lệ theo `BAR_PERIODS`) và `shiftStart = 06:00`, từ 00:00 đến 06:00 ta có `from = 06:00 > to = now`. `history-bar.ts:185-199` và `history-pie.ts:199-213` gửi thẳng; API từ chối `from >= to` bằng 400 (history_api.cpp:295) và widget hiện lỗi thay vì trống.
- Cách tái hiện: `barModel({bucket:'shift', period:'today'}, <03:00 địa phương>, tz, undefined, …).request` có `from > to`.
- Đề xuất sửa: trong `#load` của hai widget, khi `req.to <= req.from` đặt trạng thái `empty` mà không gọi API (hoặc cho `barModel`/`pieModel` trả `request.count = 0` và widget bỏ qua khi `count == 0`). Thêm test ở `period.test`.

### I3 — Chi phí truy vấn tổng hợp nhân với số Tag

- Lý do: khóa chính `(res, bucket, cid)` nên điều kiện `res = ? AND cid = ? AND bucket BETWEEN` chỉ dùng được `res` và `bucket`; mỗi lần chạy `kAggSelect` cho một Tag duyệt hàng của mọi cột trong khoảng. Nhóm 200 cột, yêu cầu 16 Tag, khoảng 1 năm bucket giờ: khoảng 1,75 triệu hàng quét × 16 lượt. Giới hạn `kMaxAggregateRows` chỉ chặn số hàng trả về, không chặn số hàng quét; trên BL335 dễ chạm `timeoutMs` (503 QUERY_TIMEOUT). `exportCsv` đã dùng một lượt `cid IN (...) ORDER BY bucket, cid`, tức chỉ quét một lần.
- Đề xuất sửa: trong `queryAggregate` và `querySeries` (nhánh merge) dùng một câu `cid IN (<danh sách số nguyên>) ... ORDER BY bucket` rồi chia theo `cid` khi đọc; ngân sách quét đo bằng `rowsRead` của `stats`. Cân nhắc đo lại trên BL335 (ngân sách BL335 trong CLAUDE.md).

### I4 — Hủy truy vấn không được nối

- Lý do: `ReaderPool` và `Lease::cancelled()` đã hỗ trợ cờ hủy qua `progress`, nhưng mọi chỗ gọi truyền `nullptr`. Client hủy `fetch` (zoom, đổi kỳ, rời trang) hoặc ngắt kết nối thì phía máy chủ truy vấn vẫn chạy đến `timeoutMs` và giữ ticket phiên của `QueryLimiter` (tối đa một truy vấn mỗi phiên). Yêu cầu kế tiếp từ cùng phiên nhận 429 BUSY, client lùi 1-30 s (`history-source.ts:319-333`). Với `report-page.ts:281` còn `AbortController` không bao giờ được gọi `abort()` khi chạy lại hoặc đóng trang.
- Đề xuất sửa: tạo `std::atomic<bool> cancel` mỗi yêu cầu; một nhịp `mg_poll`/kiểm tra kết nối trong `progress` không khả thi, nên tối thiểu: dùng cờ đó cho xuất CSV khi `mg_write` thất bại (đã dừng ở chỗ ghi) và rút ngắn `timeoutMs` mặc định cho truy vấn; phía client gọi `ac.abort()` ở `#run()` kế tiếp và `dispose()` trong `report-page.ts`. Ghi vào tài liệu giới hạn đã biết nếu chưa làm.

### I5 — `catalog` thiếu khi hồ đọc bận được lưu đệm

- Lý do: `pool_.acquire` thất bại (`busy`) thì `lease` null, vòng nhóm bỏ qua phần `raw` và `aggregates` mà vẫn trả 200 `enabled: true` (history_api.cpp:230-280). `history-source.ts:117-122` lưu đệm bản này đến khi trạng thái đổi. Trang lịch sử và `chooseSource` xem trước coi như nhóm chưa có dữ liệu. Catalog cũng không qua `QueryLimiter`.
- Đề xuất sửa: khi `!lease` trả 429 BUSY (hoặc 503) thay vì 200 thiếu; phía client không lưu đệm catalog có `raw == null` cho mọi nhóm hoặc đặt TTL ngắn.

## Minor — gợi ý sửa ngắn

- M1: đặt `curSeq = INT64_MAX` (giữ `curTs = builtTo - 1`) để điều kiện `ts > ?1 OR (ts = ?1 AND seq > ?2)` loại dòng ở ms `builtTo - 1`. Chỉ lệch khi có dòng đúng ms cuối phút; thêm một test với dòng ở `builtTo - 1`.
- M2: chạy `EXPLAIN QUERY PLAN` cho `... WHERE ts >= ? AND ts < ? AND seq > ? ORDER BY seq LIMIT ?` trên bảng 10 triệu dòng; nếu không dùng chỉ mục `seq`/rowid, đổi sang con trỏ `(ts, seq)` hoặc ép `INDEXED BY`. Chưa đo nên mức Minor.
- M3: thêm `\t` và `\r` vào `/^[=+\-@]/`; bỏ `guardFormula` khỏi `str()` của XLSX (ô `inlineStr` không bao giờ là công thức) hoặc ghi chú đã chọn giữ.
- M4: giới hạn giá trị hiển thị (ví dụ `|v| < 1e15`) hoặc dùng `BigInt` cho phần nguyên; `toNumber` nên kiểm `Number.isFinite` và ghi ô trống khi sai.
- M5: dùng `sqlite3_bind_text` như các câu kế bên.
- M6: dùng `std::atomic<bool>` cho `timedOut`/`cancelled`.
- M7: loại trùng `fields` hoặc trả 400.
- M8: lấy `offsetMin` mặc định từ `project`/`logging.json` khi có, hoặc ghi rõ trong `--help`.

## Không thấy vấn đề ở

Đã đọc kỹ từng dòng:

- `core/historian/aggregator.cpp`, `agg_math.cpp`: mang tín hiệu qua cửa sổ, đóng cửa sổ ở đúng biên phút, `first` lấy từ tín hiệu mang sang, đóng giờ ở phút cuối, NULL và NaN (đã loại ở `cellValue`), đồng hồ lùi (`t < lastT_`). `mergeBuckets` là đơn vị đúng, `aggAvg` rơi về `last` khi `wms = 0`.
- `core/historian/local_store.cpp` (phần schema 2, `writeAggs`, `rebuildHours`, `initAggState`, `loadRange`, upsert): upsert ghép `max/first/last` với NULL tối ưu đúng (so cột cũ trước cập nhật); `INSERT OR REPLACE` cho giờ; giao dịch gộp dòng thô, bucket, mốc, con trỏ và `alive` trong một `BEGIN IMMEDIATE`; bỏ qua hàng NaN không làm kẹt commit. Mọi giá trị người dùng đều bind; danh sách `cid` ghép từ số nguyên.
- `core/historian/historian.cpp`: thứ tự đẩy bucket phút trước `rebuildHour`, dựng bù (lát ≤ 1 giờ, gieo tín hiệu qua `mat_runs`, mốc `agg_back_to` cập nhật cùng giao dịch ghi lát), chặn bộ đệm `kMaxAggBuffered`, đếm theo giờ `RowCounter`, nhịp xả 15 phút. Khôi phục sau mất điện (kill) đúng cho các phút đã đóng (test copy file xác nhận ý đồ); lỗi duy nhất ở C1 và M1.
- `core/historian/sampler.cpp`, `io_meter.cpp`: cạnh kích hoạt, `minInterval`, vùng chết tính theo giá trị đã ghi (trôi chậm vẫn vượt ngưỡng), cắt UTF-8, ép kiểu số tràn, bộ đếm byte quay lui.
- `core/historian/query/history_query.cpp` (series, aggregate, rows, export), `downsample.cpp`, `csv_writer.cpp`, `source_select.cpp`, `agg_verify.cpp`, `query_limiter.cpp`, `reader_pool.cpp`: chia số học dùng `__int128`, `floorDiv` cho thời điểm âm, chặn LTTB theo bộ nhớ, chặn số cửa sổ và số hàng, câu SQL tham số hóa, chặn khoảng `kMaxRangeMs`, CSV chống công thức và thoát nháy, tiêu đề tải xuống làm sạch tên file, không có terminator khi lỗi giữa chừng.
- `server/http/history_api.cpp`: kiểm tham số chặt (khóa lạ, lặp, độ dài số 15 chữ số), `onlyKeys`, giới hạn `maxPoints`/`limit`/`bucketMs`/`offsetMs`, thông báo lỗi chung không lộ chi tiết nội bộ, ghi audit xuất CSV cả khi hỏng, `limit` ≥ 1 nên `rows.back()` an toàn.
- `server/cli/export_history.cpp`: kiểm đầu ra hỏng, mã thoát, đường CSV chung với API.
- `packages/history-math` (`agg.ts`, `period.ts` ngoài I2, `report.ts`, `format.ts` ngoài M4): trùng ngữ nghĩa C++ ở ghép bucket và `evalFn`, tính kỳ bằng số học epoch (không phụ thuộc múi giờ trình duyệt), biên nửa đêm của kỳ ngày/ca/tháng, hàng "chưa tới".
- `packages/report-export`: thoát XML và loại ký tự điều khiển, làm sạch tên sheet và tên file (ký tự cấm Windows, đuôi `.` và khoảng trắng), CSV hai kiểu số.
- `apps/runtime-web` (`history-source.ts`, `report-page.ts`, `history-page.ts`): không có `innerHTML`; nội dung ngoài (tên mẫu, nhãn, thông điệp lỗi) vào DOM qua `textContent` (`el()`), dữ liệu vào URL qua `enc()`; hàng đợi 429 có lùi mũ và jitter, kiểm hình dạng phản hồi.
- `packages/project-schema/src/rules-010.ts`, `apps/studio/src/model/logging-doc.ts`: hàm thuần không sửa đầu vào, mã lỗi khớp bản C++; `lit` thoát nội dung trong editor.

Chưa đọc kỹ (không có kết luận): phần thân `packages/report-export/src/pdf/pdf.ts`, `server/cli/verify_aggregates.cpp`, `core/historian/clock.cpp`, `secrets.cpp`, `status.cpp`, `logging_config.cpp`, `apps/studio/src/ui/editors/{logging-editor,templates-editor,logging-props}.ts`, `reports-doc.ts`, `logging-grid.ts`; `history-page.ts` chỉ lướt tìm sink HTML và URL.
