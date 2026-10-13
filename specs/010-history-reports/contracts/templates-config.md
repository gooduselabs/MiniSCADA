# Contract — `reports.json` 0.1.0 (mẫu báo cáo), trang báo cáo, phép tính và xuất file

**Feature**: [spec.md](../spec.md) FR-040…FR-044, FR-051, FR-052 · **Dữ liệu**: [history-api.md](history-api.md) §4, [history-db.md](history-db.md) §6 · **ADR**: [033](../../../docs/adr/033-browser-reports.md)

## 1. Khai báo trong project

`project.json` thêm trường tùy chọn `reportsFile` (như `loggingFile`), ví dụ `"reportsFile": "reports.json"`. Không có trường thì không có báo cáo; project hiện có vẫn hợp lệ. `project.json` thuộc định dạng project `0.6.0` (spec D23). `navigation` (007) thêm biến thể mục báo cáo:

```json
{ "label": "Báo cáo điện năng", "report": "dien-ca", "group": "Báo cáo", "icon": "document" }
```

Mục có đúng một trong `screen` hoặc `report` (cả hai hay không có: `E_SCHEMA`). Không có `navigation` thì trang runtime tự thêm mục cho mỗi mẫu báo cáo ở cuối menu.

## 2. `reports.json`

```json
{
  "schemaVersion": "0.1.0",
  "reports": [
    {
      "id": "dien-ca",
      "name": "Điện năng theo ca",
      "group": "dien",
      "period": "shift",
      "shifts": { "count": 3, "start": "06:00" },
      "title": "BÁO CÁO ĐIỆN NĂNG THEO CA",
      "footer": "Phòng Kỹ thuật",
      "paper": { "size": "A4", "orientation": "landscape" },
      "totals": true,
      "columns": [
        { "tagId": "METER1.KWH", "label": "Điện năng", "unit": "kWh", "decimals": 1,
          "functions": ["delta", "max"] },
        { "tagId": "METER1.KW", "label": "Công suất", "unit": "kW", "decimals": 1,
          "functions": ["avg", "max"] },
        { "tagId": "PUMP1.RUN", "label": "Bơm 1 chạy", "unit": "giờ", "decimals": 2,
          "functions": ["sum"] }
      ]
    }
  ]
}
```

| Trường | Kiểu | Bắt buộc | Mặc định | Ràng buộc |
|---|---|---|---|---|
| `schemaVersion` | SemVer | có | | `0.1.x` |
| `reports` | Report[] | có | | 1–16, `id` duy nhất |
| `id` | string | có | | `^[a-z0-9][a-z0-9-]{0,47}$` |
| `name` | string | có | | 1–80 |
| `group` | string | có | | id nhóm trong `logging.json`; nhóm phải có `aggregates` |
| `period` | `day` \| `shift` \| `month` | có | | |
| `rowMinutes` | 15 \| 30 \| 60 | không | 60 | chỉ `period = day` |
| `shifts` | `{ count, start }` | khi `shift` | | `count` ∈ {2, 3, 4, 6, 8, 12}; `start` `^([01]\d|2[0-3]):[0-5]\d$`; cấm với `day`, `month` |
| `title` | string | không | `name` | ≤ 120 |
| `footer` | string | không | rỗng | ≤ 200 |
| `paper` | `{ size, orientation }` | không | A4, `portrait` | `size` `A4` \| `A3`; `orientation` `portrait` \| `landscape` |
| `totals` | bool | không | `true` | dòng tổng cuối bảng |
| `columns` | Column[] | có | | 1–24 cột; tổng số (Tag, hàm) ≤ 24; ≤ 24 Tag khác nhau |
| `columns[].tagId` | string | có | | Tag thuộc nhóm, có tổng hợp (số hoặc BOOL, `aggregate ≠ false`) |
| `columns[].label` | string | không | mô tả hay id Tag | ≤ 60 |
| `columns[].unit` | string | không | `Tag.unit` | ≤ 16 |
| `columns[].decimals` | int | không | 2 | 0–6 |
| `columns[].functions` | string[] | có | | 1–7 phần tử, không lặp, thuộc `min`, `max`, `avg`, `sum`, `first`, `last`, `delta`, `count` |

Hàm (cùng nghĩa với history-db.md §6): `min`, `max`, `avg`, `sum` (tích phân, đơn vị × giờ), `first`, `last`, `delta` (= `last − first`), `count` (số dòng thô, `n`). `unit` do người dùng đặt cho cột: Studio gợi ý theo hàm (kW + `sum` → kWh) nhưng không tự suy từ Tag.

Giá trị chữ (`name`, `title`, `footer`, `label`, `unit`) là văn bản thuần, hiện qua binding an toàn (không HTML).

## 3. Mã lỗi (hai validator TS và C++, cùng vector)

| Mã | Khi nào | Vị trí |
|---|---|---|
| `E_RPT_DUP_ID` | trùng `id` | `/reports/i/id` |
| `E_RPT_REF_GROUP` | `group` không có trong `logging.json` (hoặc project không có `loggingFile`) | `/reports/i/group` |
| `E_RPT_REF_TAG` | `tagId` không thuộc nhóm | `/reports/i/columns/j/tagId` |
| `E_RPT_NO_AGG` | nhóm không có `aggregates`, hoặc Tag có `aggregate:false`, hoặc Tag kiểu chuỗi | `/reports/i/group`, `/reports/i/columns/j/tagId` |
| `E_RPT_PERIOD` | `shifts` với `day` hoặc `month`; thiếu `shifts` khi `shift`; `rowMinutes` với kỳ khác `day` | `/reports/i` |
| `E_RPT_SHIFT` | `count` không thuộc {2, 3, 4, 6, 8, 12}; `start` sai định dạng | `/reports/i/shifts` |
| `E_RPT_FN` | hàm lặp trong một cột | `/reports/i/columns/j/functions/k` |
| `E_RPT_LIMIT` | quá 24 cột (Tag × hàm) hoặc quá 24 Tag | `/reports/i/columns` |
| `E_NAV_REPORT` | `navigation[].report` không có trong `reports.json` (hoặc không có `reportsFile`) | `/navigation/i/report` |

Thứ tự kiểm: như `logging.json` ở 003 (`E_PATH`, `E_FILE_MISSING`, `E_JSON`, `E_SCHEMA`, `E_SCHEMA_VERSION`, rồi luật liên file). Luật cần `logging.json` hoặc `tags.json` bị bỏ qua khi file đó lỗi. Không có cảnh báo riêng. Schema máy đọc: `schemas/reports.schema.json` (draft-07, `additionalProperties:false`). Số hàng tối đa của một kỳ (kỳ `day` với `rowMinutes` 15 là 96; `month` 31; `shift` 12) luôn ≤ 500 nên không cần mã riêng.

## 4. Phép tính báo cáo (`packages/history-math`)

Đầu vào: mẫu, kỳ chọn, `timeZone` của nhóm (từ `catalog`), kết quả `aggregate`. Đầu ra: bảng (`ReportTable`).

**Chọn kỳ (giờ địa phương của nhóm, độ lệch cố định `tz` ms):**

- `day`: ngày lịch `D` → `from = localMidnight(D)`, `to = from + 86.400.000`, hàng = `rowMinutes`.
- `shift`: **ngày làm việc** `D` bắt đầu lúc `D + shifts.start` → `from = localTime(D, start)`, `to = from + 86.400.000`, hàng = `86.400.000 / count`. Ví dụ `start = 06:00`, `count = 3`: ca 1 06:00–14:00, ca 2 14:00–22:00, ca 3 22:00–06:00 (sáng hôm sau).
- `month`: tháng lịch `M` → `from = localMidnight(ngày 1)`, `to = localMidnight(ngày 1 của tháng sau)`; hàng = ngày lịch (28–31 hàng).

**Gọi API:** `bucketMs` = độ dài hàng, `offsetMs = from mod bucketMs` (chuẩn hóa dương), `from`, `to`; Tag chia lô ≤ 16 mỗi yêu cầu (≤ 2 yêu cầu); yêu cầu chạy qua hàng đợi chung của trang (tối đa 2 đồng thời). Kỳ `month` dùng `bucketMs = 86.400.000`: nguồn là bảng giờ khi `tz` là bội số của giờ (Việt Nam +07:00), ngược lại bảng phút (có thể chạm 422 `RANGE_TOO_LARGE`; trang báo "thu hẹp kỳ").

**Ô:** với hàng `r`, Tag `t`, hàm `f`: `eval(f, bucket(r, t))` theo history-db.md §6. Cửa sổ rỗng → ô trống (`null`).

**Dòng tổng:** `merge` mọi cửa sổ của Tag trên các hàng rồi `eval` (nên `delta` tổng = cuối kỳ − đầu kỳ, `sum` tổng = Σ tích phân, `min`/`max` của cả kỳ, `avg` theo thời gian, `count` = Σ n). Hàng thuộc tương lai (kỳ đang chạy) không đóng góp và hiện "chưa tới".

**Thiếu dữ liệu:** `coverage(r, t) = wms / bucketMs`; hàng có `coverage < 0,95` được đánh dấu; cả báo cáo hiện "Dữ liệu đủ X %" = `Σ wms / (số Tag × số hàng đã tới × bucketMs)`. Không bao giờ bịa số cho cửa sổ rỗng.

**Định dạng:** số theo `decimals` của cột; hiển thị trên màn hình và PDF dùng `vi-VN` (nghìn `.`, thập phân `,`); thời gian theo `tz` (không theo múi giờ trình duyệt): nhãn hàng `dd/MM HH:mm–HH:mm` (day), `Ca n HH:mm–HH:mm` (shift), `dd/MM` (month). Hàm định dạng nằm trong `history-math` (không dùng `Date` cục bộ).

Bộ vector `tests/report-vectors/*.json`: mẫu + `aggregate` giả + kỳ → bảng mong đợi (ngày, ca qua nửa đêm, tháng 28/29/30/31 ngày, kỳ đang chạy, thiếu dữ liệu, cửa sổ rỗng, `delta` qua các hàng, tổng ghép, `tz` +07:00 và +05:30).

## 5. Xuất file (chạy trên trình duyệt)

| Định dạng | Nội dung | Ghi chú |
|---|---|---|
| CSV chuẩn | UTF-8 có BOM, `,` phân tách, `.` thập phân, `\r\n`; dòng tiêu đề mẫu, kỳ, hàng nhãn cột, rồi các hàng, dòng tổng | cho công cụ |
| CSV Excel vi-VN | UTF-8 có BOM, `;` phân tách, `,` thập phân | mở thẳng trong Excel Việt Nam |
| XLSX | một sheet; tiêu đề mẫu, kỳ, người xuất, giờ xuất; hàng tiêu đề cố định (freeze panes); ô số là số kiểu `numFmt` theo `decimals`; chuỗi nội tuyến; độ rộng cột tự tính theo nội dung (≤ 40 ký tự); nhãn hàng là chuỗi | tự viết trên `fflate` (ADR-033) |
| PDF | khổ và hướng theo `paper`; tiêu đề, kỳ, người xuất, giờ xuất; bảng lặp hàng tiêu đề khi sang trang; số trang; chân trang | `pdfmake` tải lười (ADR-033); phông có chữ Việt |

- Tên file: `<id>_<kỳ>.<đuôi>` đã làm sạch (bỏ ký tự cấm `\ / : * ? " < > |`, tối đa 80 ký tự), ví dụ `dien-ca_2026-10-12.pdf`.
- Mọi định dạng dựng từ **cùng** `ReportTable`, không tính lại; khớp 100 % ô (SC-016).
- Giới hạn: ≤ 24 cột, ≤ 500 hàng (đã bảo đảm bởi mẫu hợp lệ).
- Thư viện tải lười khi bấm nút; thất bại thì báo lỗi cụ thể, CSV vẫn dùng được.
- Người xuất = tài khoản đăng nhập; giờ xuất theo `tz` của nhóm.
- Chống chèn công thức: ô chuỗi bắt đầu bằng `=`, `+`, `-` hoặc `@` (nhãn, tên) thêm `'` đứng đầu ở CSV và XLSX; ô số không đổi; XML của XLSX thoát `& < > "`.

## 6. Trang `#/report/<id>`

Bố cục: tiêu đề mẫu; chọn kỳ (ô ngày, ô tháng, hay ngày làm việc cho ca); nút **Xem**; bảng kết quả (đầu bảng cố định, cuộn); dòng tổng; chú thích thiếu dữ liệu; nút **CSV**, **CSV Excel**, **XLSX**, **PDF**. Trạng thái: đang tải, "Đăng nhập để xem báo cáo", "Thiết bị đang bận" (tự thử lại), "Chưa bật lưu trữ", "Kỳ chưa có dữ liệu", lỗi mạng. Kỳ mặc định: hôm nay (day, shift), tháng này (month). Đường dẫn `#/report/dien-ca?d=2026-10-12` (ca, ngày) hoặc `?m=2026-10` (tháng) giữ lựa chọn khi F5.
