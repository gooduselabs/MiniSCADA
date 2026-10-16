# tests/report-vectors

Vector cho phép tính báo cáo và kỳ của widget lịch sử (`packages/history-math`: `report.ts`, `period.ts`), feature 010. Luật: [contracts/templates-config.md](../../specs/010-history-reports/contracts/templates-config.md) §4 và [contracts/widget-catalog-010.md](../../specs/010-history-reports/contracts/widget-catalog-010.md) §2.2. Chủ yếu cho TS (báo cáo dựng trên trình duyệt); bản C++ chỉ cần nếu sau này có tính kỳ phía thiết bị.

Sinh bằng `node tests/report-vectors/generate.mjs` (khoảng 30 giây; kết quả được commit). `expect` do `tools/history-ref` (độc lập với `@mat/history-math`) tính từ dòng thô giả lập; ca có số tính tay được kiểm ngay lúc sinh. Thời gian là UTC ms; `tz` là chuỗi `±HH:MM`. So sánh: số nguyên, `t` và chuỗi bằng nhau tuyệt đối; số thực dung sai 1e-9 tương đối.

## `report-*.json` (`kind: "report"`)

| Trường | Ý nghĩa |
|---|---|
| `template` | một mục của `reports.json` |
| `tz`, `select`, `now`, `shiftWord` | múi giờ của nhóm; kỳ chọn (`{d:"YYYY-MM-DD"}` cho `day`/`shift`, `{m:"YYYY-MM"}` cho `month`); thời điểm hiện tại; chữ "Ca" của nhãn hàng ca |
| `tagInfo` | `{ tagId: { description?, unit? } }`: nhãn và đơn vị mặc định của cột |
| `aggregates` | phản hồi `aggregate` giả, một phần tử mỗi lô Tag: `{ start, count, bucketMs, series: [{ tagId, n[], min[], max[], first[], last[], sumw[], wms[] }] }` (cửa sổ rỗng: `n` và `wms` là 0, còn lại `null`; không có `avg`, `sum`: người dựng phải tự tính) |
| `expect.request` | yêu cầu `aggregate` phải gửi: `from`, `to`, `bucketMs`, `offsetMs`, `count` (số hàng) và `batches` (Tag chia lô <= 16, theo thứ tự xuất hiện đầu tiên trong `columns`) |
| `expect.table` | `ReportTable`: `title` (mặc định `name`), `footer`, `periodLabel` (`dd/MM/yyyy`; tháng `MM/yyyy`), `columns` (`key` `<tagId>.<hàm>`, `tagId`, `fn`, `label`, `unit`, `decimals`; mặc định nhãn = mô tả Tag, rồi id; đơn vị = `Tag.unit`; `decimals` 2), `rows` (`label`, `cells`, `text` (vi-VN theo `decimals`), `coverage`, `pending`), `totals`, `totalsText`, `coverage`, `generatedAt` (= `now`), `tz` |

Quy ước tính (chốt ở đây): hàng có `start >= now` là `pending` (ô `null`, không đóng góp, không vào `coverage`); `rows[i].coverage = Σ wms theo Tag / (số Tag khác nhau × bucketMs)`; `coverage` toàn bảng = `Σ wms / (số Tag × số hàng đã tới × bucketMs)` (0 khi chưa có hàng nào tới); dòng tổng = `merge` các cửa sổ của từng Tag qua mọi hàng đã tới rồi tính hàm; `totals: null` khi `totals: false`. Nhãn hàng: `dd/MM HH:mm–HH:mm` (ngày), `Ca n HH:mm–HH:mm` (ca), `dd/MM` (tháng), theo `tz`.

## `period-*.json` (`kind: "period"`)

`period`, `now`, `tz`, `shiftCount`, `shiftStart` -> `expect.from`, `to` (cộng `fromIso`, `toIso` để đọc). `now` làm tròn xuống phút theo giờ địa phương trước khi tính. `last24h|7d|30d` = `[now - n, now)`; `today = [nửa đêm địa phương, now)`; `yesterday` = ngày trước đủ 24 giờ; `thisMonth`, `lastMonth` = cả tháng lịch; `thisShift` = ca chứa `now` (ca dài `24h/shiftCount`, gốc là nửa đêm + `shiftStart`; trước giờ bắt đầu thì thuộc ngày làm việc hôm trước), `lastShift` = ca ngay trước.

## `bar-*.json` (`kind: "bar"`)

`cfg` (`fn`, `bucket`, `period`, `shiftCount`, `shiftStart`), `now`, `tz`, `shiftWord`, `tagIds`, `labels`, `aggregate` (một phản hồi giả như trên) -> `expect.request` (`from` làm tròn LÊN tới biên cửa sổ đầu, `to`, `bucketMs`, `offsetMs` = (nửa đêm địa phương của `from` [+ `shiftStart` với ca]) mod `bucketMs`, `count`), `expect.categories` (`start`, `end`, `label`: giờ `HH:mm`, ngày `dd/MM`, ca `dd/MM Ca n` theo ngày làm việc), `expect.series` (`tagId`, `label` = `labels[i]` hoặc `tagId`, `values` = hàm `fn` của từng hạng mục, `null` khi trống).

## `pie-*.json` (`kind: "pie"`)

`cfg` (`fn`, `period`, `shiftCount`, `shiftStart`), `now`, `tz`, `tagIds`, `labels`, `aggregate` (một cửa sổ) -> `expect.request` (`from`, `to`, `bucketMs` = `to - from` làm tròn lên bội 60.000, `offsetMs` = `from` mod `bucketMs`), `expect.values` (`tagId`, `value`), `slices` (`tagId`, `label`, `value`, `percent`; giá trị `null` hoặc âm bị loại; tổng 0 thì không có phần nào), `excluded` (`tagId`, `reason`: `missing` | `negative`), `total`.
