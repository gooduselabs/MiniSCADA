# Contract — Studio 0.8.0: editor Lưu trữ, editor Mẫu báo cáo, Toolbox lịch sử

**Feature**: [spec.md](../spec.md) FR-046…FR-054 · **Nền**: [studio-ux.md](../../../docs/architecture/studio-ux.md) §5, §9; [studio-screen-editor.md](../../007-screens-widgets/contracts/studio-screen-editor.md) · **ADR**: [009](../../../docs/adr/009-studio-ui-stack.md), [016](../../../docs/adr/016-studio-grid-ime.md), [034](../../../docs/adr/034-trigger-mode-write-estimate.md)

Mockup bản 1 (task trước khi viết mã giao diện): `docs/architecture/mockups/studio-history.html`, dữ liệu từ `projects/history-demo`; phiên làm việc tự duyệt (người dùng giao toàn quyền). Giao diện theo studio-ux: lưới ảo hóa (ADR-016), kéo Tag từ cây, hoàn tác/làm lại, lỗi theo ô, nhãn qua `i18n`, theme sáng/tối, dùng được bằng bàn phím.

## 1. Editor Lưu trữ (thay `apps/studio/src/ui/editors/logging-view.ts`)

Mở từ cây project: `Lưu trữ` (đã có mục, nay có sửa). Cấu trúc (kiểu Lưới + inspector + khung phụ):

```text
┌ Lưu trữ ───────────────────────────────────────────────────────────────┬─────────────┐
│ Nhóm  [+ Thêm] [Nhân bản] [Xóa]                                          │ Ước tính ghi│
│ ┌────┬──────────┬───────────┬────────┬────────┬─────┬──────┬──────────┐ │ (khung phải)│
│ │ id │ Tên      │ Chế độ    │ Chu kỳ │ Lưu(ng)│ Tag │ Tổng │ Ghi MB/ng│ │ 0,53 / 2 GB │
│ ├────┼──────────┼───────────┼────────┼────────┼─────┼──────┼──────────┤ │ ▓▓░░░░░░░░ │
│ │... │          │           │        │        │     │      │          │ │ Thô 503 MB  │
│ └────┴──────────┴───────────┴────────┴────────┴─────┴──────┴──────────┘ │ Tổng hợp 36 │
│ Tag của nhóm "ap-suat"  (kéo Tag từ cây thả vào, Ctrl+D điền xuống)      │ Dung lượng  │
│ ┌──────────────┬──────────┬──────────┬──────────┬─────────┬──────────┐ │ Giữ được N  │
│ │ Tag          │ Cột      │ Deadband │ Độ dài   │ Tổng hợp│ Ghi chú  │ │  ngày/trần  │
│ └──────────────┴──────────┴──────────┴──────────┴─────────┴──────────┘ │ Cảnh báo... │
│ Kết nối DB ngoài (form)  [+ Thêm]                                        │ [Dùng số đo]│
├─────────────────────────────────────────────────────────────────────────┴─────────────┤
│ Inspector (Chung | Chế độ | Lưu trữ | Đích | Tổng hợp)   | Thông tin (lỗi, cảnh báo)  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Lưới nhóm và lưới Tag

- Cột nhóm: `id`, `Tên`, `Chế độ` (danh sách: **Chu kỳ**, **Thay đổi**, **Kết hợp**, **Kích hoạt**), `Chu kỳ / Khoảng ghi` (hiển thị theo chế độ: chu kỳ, `min–max`, hoặc `edge`), `Lưu (ngày)`, `Tag` (số), `Tổng hợp` (đèn bật/tắt), `Ghi MB/ngày` (từ ước tính, chỉ đọc).
- **Kết hợp** là `onChange` có `maxIntervalMs` (D2): chọn "Kết hợp" đặt `mode: onChange` và buộc `maxIntervalMs`; ô nhập bỏ trống thì mặc định 60 s. Bỏ `maxIntervalMs` đưa nhóm về "Thay đổi". Studio không thêm giá trị `mode`.
- Cột Tag: `Tag` (kéo từ cây, gợi ý theo tên), `Cột` (mặc định chuẩn hóa, lỗi trùng theo ô), `Deadband` (chỉ Tag số, mờ cho BOOL/chuỗi), `Độ dài` (chỉ chuỗi), `Tổng hợp` (đèn; mờ cho chuỗi; chỉ có tác dụng khi nhóm bật tổng hợp), `Ghi chú` (lỗi/cảnh báo ngắn).
- Điền xuống (Ctrl+D), dán từ Excel, sửa nhiều dòng, thêm hàng loạt Tag từ cây (kéo một thư mục), hoàn tác/làm lại (như Bảng Tag của 006).
- Inspector, nhóm **Chế độ**: ô theo chế độ (chu kỳ; `minIntervalMs`/`maxIntervalMs`; `trigger`: Tag kích hoạt kéo từ cây, `edge`, `threshold`, `periodMs` khi `active`); nhóm **Lưu trữ**: thời hạn lưu, `expectedRowsPerDay` (chỉ Thay đổi/Kết hợp/Kích hoạt, kèm chú thích "dùng cho ước tính"); nhóm **Đích**: chọn từ danh sách kết nối; nhóm **Tổng hợp**: công tắc bật, `minuteRetentionDays`, `hourRetentionDays`, và dòng "Tag được tổng hợp: n / m".
- Form **Kết nối DB ngoài**: như `connections-editor.ts` của 006: loại, máy chủ, cổng, DB hay bucket, người dùng, TLS, độ lệch giờ; **không có mật khẩu**; chú thích "Nhập mật khẩu trên thiết bị (`--set-secret`)". Thử kết nối không thuộc feature này.
- Mọi sửa đi qua mô hình tài liệu (`project-doc`), kiểm tra bằng validator TS ≤ 500 ms (như 007), lưu được cả khi còn lỗi.

### 1.2 Khung Ước tính ghi

Cập nhật ≤ 100 ms sau mỗi sửa (SC-019), tính bằng đúng `estimateLogging` của `@mat/project-schema` (không công thức riêng trong Studio, Constitution II):

| Phần | Nội dung |
|---|---|
| Đầu khung | `X,XX GB/ngày` so với `2 GB`: thanh ngang, màu theo mức (xanh < 50 %, vàng 50–100 %, cam > 100 %, đỏ > 400 % kèm nhãn "cực lớn"); văn bản tương đương cho trình đọc màn hình |
| Chia theo nhóm | bảng nhỏ: nhóm, `Thô`, `Tổng hợp`, tổng, nhãn cơ sở (`chính xác`, `theo dự kiến`, `cận trên`) |
| Dung lượng | `storageBytes` so với trần 2 GB; "Đầy sau khoảng N ngày" từ `daysToFillCap` |
| Cảnh báo | `W_LOG_WRITE_BUDGET`, `W_LOG_SIZE_CAP`, `W_LOG_WRITE_EXTREME` kèm con số và nhóm đóng góp lớn nhất; **gợi ý**: tăng chu kỳ/khoảng tối thiểu, chuyển sang Kết hợp, bớt Tag, đặt `expectedRowsPerDay` nếu biết |
| Chưa tính | "chưa tính n Tag" khi Tag tham chiếu lỗi hoặc thiếu kiểu |
| Online | khi có thiết bị: thêm cột "Đo thực" (`io.bytesPerDay`, `groupsInfo[].rows24h`) cạnh ước tính và nút **Dùng số đo** (điền `expectedRowsPerDay` của từng nhóm Thay đổi/Kết hợp/Kích hoạt bằng `rows24h`; một lệnh hoàn tác được) |

### 1.3 Nạp xuống và chặn mềm

Khi cấu hình đang nạp có `W_LOG_WRITE_BUDGET` hoặc `W_LOG_SIZE_CAP` (và chưa có xác nhận cho đúng bản ước tính đó), hộp thoại **trước** bước nạp:

- tiêu đề "Cấu hình lưu trữ vượt ngân sách ghi"; nội dung: số ước tính, ngân sách, nhóm đóng góp nhiều nhất, hậu quả ("mòn bộ nhớ thiết bị nhanh hơn dự kiến"), gợi ý;
- nút mặc định **Hủy** (focus ban đầu); nút **Tôi hiểu, vẫn nạp** phải được chọn chủ động;
- với `W_LOG_WRITE_EXTREME`: thêm ô gõ lại tên project để mở nút tiếp tục;
- sau khi xác nhận, xác nhận được nhớ cho **đúng bản ước tính đó** (băm của `estimate`) tới lần sửa kế tiếp làm đổi số; ghi vào nhật ký thao tác của Studio (không lưu trong project).

Hủy không đổi gì. Lưu project và xem trước **không** bị chặn. Runtime không chặn kể cả khi người dùng nạp bằng công cụ khác.

### 1.4 Chỉ đọc 0.1 và nâng cấp

Project có `logging.json` 0.1.x: editor mở chỉ đọc kèm băng "Nâng cấp lên 0.2.0 để sửa" (nút gọi migration của contracts/logging-config-0.2.md §7, một lệnh hoàn tác). Khung ước tính vẫn hiện.

## 2. Editor Mẫu báo cáo (`apps/studio/src/ui/editors/templates-editor.ts`)

Mở từ cây: `Báo cáo` → danh sách mẫu (mỗi mẫu một editor). Bố cục:

```text
┌ Mẫu "Điện năng theo ca" ────────────────────────────────┬──────────────────────┐
│ Chung (form): Tên, id, Nhóm lưu trữ [chỉ nhóm có tổng hợp] │ Xem trước            │
│ Kỳ: (Ngày ▾ Ca ▾ Tháng)  Ca: [3 ▾] bắt đầu [06:00]          │ [Dữ liệu mô phỏng ▾] │
│ Khổ giấy [A4 ▾] Hướng [Ngang ▾]  Tiêu đề, Chân trang        │ Kỳ: [2026-10-12]     │
├──────────────────────────────────────────────────────────┤ ┌──────────────────┐ │
│ Cột (lưới): Tag | Nhãn | Đơn vị | Số lẻ | Hàm (chọn nhiều)  │ │ bảng báo cáo     │ │
│ kéo Tag từ cây vào lưới; sắp xếp bằng kéo                   │ └──────────────────┘ │
├──────────────────────────────────────────────────────────┤ [CSV] [CSV vi-VN]    │
│ Inspector | Thông tin (lỗi theo ô)                         │ [XLSX] [PDF]         │
└──────────────────────────────────────────────────────────┴──────────────────────┘
```

- Chọn nhóm: chỉ liệt kê nhóm có `aggregates`; chưa có nhóm nào thì hiện hướng dẫn "Bật tổng hợp ở Lưu trữ" kèm liên kết. Cột chỉ nhận Tag số/BOOL có `aggregate ≠ false` của nhóm.
- Ca: chọn số ca trong {2, 3, 4, 6, 8, 12}; ô `start`; nhãn ca hiện ngay ("Ca 1 06:00–14:00"); số ca không chia đều 24 giờ không chọn được (không có trong danh sách; nhập tay sai thì lỗi `E_RPT_SHIFT` theo ô).
- Cột hàm: chọn nhiều trong `min`, `max`, `avg`, `sum`, `first`, `last`, `delta`, `count`; gợi ý nhãn hàm tiếng Việt ("Nhỏ nhất", "Lớn nhất", "Trung bình", "Tổng (tích phân)", "Đầu kỳ", "Cuối kỳ", "Chênh lệch", "Số mẫu"); `unit` gợi ý theo hàm (kW + Tổng → kWh) khi người dùng bấm "Gợi ý đơn vị".
- **Xem trước:** dựng bằng `packages/history-math` với một nguồn dữ liệu chọn được: **Dữ liệu mô phỏng** (`SimHistorySource`: Tag mô phỏng tất định, có thiếu dữ liệu giả để thử cảnh báo) hoặc **Dữ liệu thiết bị** (online; `DeviceHistorySource`, token Bearer, qua hàng đợi chung, hiện lỗi `BUSY`/401 như trang). Chọn kỳ bằng ô ngày hoặc tháng. Đổi hàm/cột cập nhật ≤ 300 ms với dữ liệu mô phỏng.
- Nút xuất thử CSV, CSV vi-VN, XLSX, PDF: dùng đúng mã của trang runtime (cùng thư viện, tải lười), lưu qua hộp thoại của Tauri (đường dẫn do người dùng chọn qua lệnh Rust đã có, không ghi tự động).
- Mọi chuỗi người dùng (tên, nhãn, tiêu đề) là văn bản thuần; không HTML.

## 3. Editor Màn hình và Toolbox

- Toolbox thêm nhóm **Lịch sử** (4 widget, biểu tượng riêng), kéo thả như 007; inspector sinh từ danh mục `0.5.0` (thuộc tính `group` là danh sách nhóm; khe Tag kéo từ cây, chỉ nhận Tag thuộc nhóm, gợi ý lỗi ngay khi thả Tag ngoài nhóm).
- Xem trước màn hình trong Studio: widget lịch sử dùng `SimHistorySource` (mô phỏng) hoặc `DeviceHistorySource` (thiết bị), theo chế độ xem trước hiện có.
- `navigation-editor.ts` thêm mục loại **Báo cáo** (chọn mẫu), kiểm `E_NAV_REPORT`.

## 4. Online: tab Thiết bị

Tóm tắt lưu trữ của tab Thiết bị (004, 003) thêm: ghi eMMC đo thực 24 giờ so với ước tính, số truy vấn, bị từ chối, p95, tiến độ dựng bù, `aggregates.rows`. Mọi số từ `system/info` (khối `historian`), cập nhật theo nhịp làm mới của tab.

## 5. Kiểm tra

- Unit (Vitest): mô hình tài liệu cho editor, hàm ước tính (vector chung), bộ biến đổi "Kết hợp" ↔ `onChange` + `maxIntervalMs`, chặn mềm (hộp thoại, băm xác nhận), migration 0.1 → 0.2, mẫu báo cáo (kiểm cột, ca).
- e2e (Chrome headless + lớp Tauri giả): dựng nhóm bốn chế độ + tổng hợp + ba mẫu báo cáo hoàn toàn bằng thao tác; xem ước tính đổi khi sửa chu kỳ (≤ 100 ms đo bằng đồng hồ trong test); hộp thoại chặn mềm; xem trước mô phỏng; xuất thử bốn định dạng.
- Trợ năng tự động (SC-015 của 007 áp dụng): 0 lỗi critical/serious, tương phản ≥ 4,5:1 theme sáng/tối, dùng được bằng bàn phím; thử tay bộ gõ tiếng Việt khi nhập tên/nhãn (người, như 006/007).
- Quy tắc studio-ux §5: bảng đối chiếu từng quy tắc (như SC-016 của 007) cho hai editor mới; khớp mockup `studio-history.html`.
