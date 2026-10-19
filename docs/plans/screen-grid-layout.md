# Kế hoạch: bố cục màn hình theo hàng và cột (lưới 12 cột)

**Trạng thái:** đề xuất, chờ người dùng chốt các quyết định ở mục 10 · **Ngày:** 2026-10-19 · **Chủ đề:** (1) thay cách đặt widget bằng tọa độ và kéo thả tự do bằng bố cục theo hàng, mỗi hàng chia cột, gắn widget vào từng ô; (2) làm giao diện, màu sắc, biểu đồ và báo cáo hiện đại, nhiều màu sắc hơn (mục 9) · **Đi kèm:** [Định hướng UX/UI Studio](../architecture/studio-ux.md), [Định dạng project 1.0](../../specs/011-pilot-hardening/contracts/project-format-1.0.md), [Kế hoạch sau 1.0](post-1.0-backlog.md)

Đây là tài liệu kế hoạch, chưa có mã. Khi người dùng chốt mục 10, mở spec bằng `/speckit-specify` (thư mục `specs/012-screen-grid-layout/`) rồi làm theo quy trình Spec Kit và test viết trước.

## 1. Yêu cầu của người dùng

- Một **trang (màn hình)** gồm **nhiều hàng**. Mỗi hàng chia thành **nhiều cột** trên lưới **12 cột**: ví dụ hàng 1 chia 3 cột (4 + 4 + 4), hàng 2 chia 2 cột (8 + 4), hàng 3 một cột (12).
- **Từng cột (ô)** gắn một **component** (card, đồng hồ, biểu đồ, bảng Tag sống, nút…). Component là các widget đã có (mục 2).
- Vị trí do người dùng **chọn ô để gắn**, **không phải kéo thả theo tọa độ**. Người dùng không gõ X, Y, rộng, cao.
- Trang vận hành web hiển thị đúng bố cục đó, trên màn hình lớn và nhỏ.

Ngoài phạm vi: trình vẽ SVG (đồ họa tự do bên trong một item SVG) giữ nguyên; bản vẽ SVG đặt vào một ô như một component.

## 2. Hiện trạng (kiểm trên mã `gd6`)

| Hạng mục | Hiện trạng | Nơi có |
|---|---|---|
| Màn hình | `ScreenModel`: `size` (rộng, cao, px), `fitMode`, `background`, `items[]` phẳng | [schemas/1.0/screen.schema.json](../../schemas/1.0/screen.schema.json) |
| Item | `svgItem`, `widgetItem`; bắt buộc `x`, `y`, `width`, `height` (px tuyệt đối), `additionalProperties: false` | cùng tệp |
| Widget | 21 loại: `card`, `label`, `lamp`, `gauge`, `level`, `panel`, `line`, `bar`, `pie`, `tag-table`, `button`, `switch`, `setpoint`, `slider`, `select`, `alarm-list`, `alarm-count`, `history-trend`, `history-table`, `history-bar`, `history-pie` | [schemas/widgets.catalog.json](../../schemas/widgets.catalog.json) |
| Hiển thị | Mỗi item `position: absolute` theo `left/top/width`; cả màn hình co bằng một `transform: scale()` theo `fitMode` (`contain`…) | `packages/ui-components/src/screen/mat-screen.ts` |
| Editor | Canvas kéo thả tự do, lưới, thước, căn lề; ~1.300 dòng | `apps/studio/src/ui/screen/mat-screen-canvas.ts` |
| Kiểm tra | Hai bộ kiểm cùng luật: TypeScript và C++, dùng chung vector `tests/project-vectors` | `packages/project-schema/src/rules-*.ts`, `core/project-manager/project_validator.cpp` |
| Định dạng | Chuỗi 0.1 → … → 0.6 → 1.0; validator hiện chỉ hiểu 1.0.x, 1.1 trở lên bị từ chối (`SUPPORTED_SCHEMA_10`) | `packages/project-schema/src/codes.ts`, `migrate.ts` |
| Liên kết theo `id` item | Binding, sự kiện, đổi tên Tag, so sánh, nhập lại SVG, template đều duyệt `screen.items` | `rename.ts`, `compare.ts`, `app/svg-bind.ts`, `model/*-flow.ts` |

Nhận xét: mô hình tọa độ tuyệt đối là gốc của cảm giác "kéo di chuyển". Bố cục lưới là thay đổi ở **mô hình dữ liệu**, **hai bộ kiểm**, **trình hiển thị** và **editor**; không chỉ là một chế độ trên canvas.

## 3. Thiết kế đề xuất

### 3.1. Mô hình dữ liệu (định dạng 1.1.0, cộng thêm)

Màn hình có thêm trường `layout`. Không có `layout` thì là màn hình tự do như hiện nay (không đổi gì).

```json
{
  "schemaVersion": "1.1.0",
  "id": "tong-quan",
  "name": "Tổng quan",
  "kind": "screen",
  "layout": {
    "mode": "grid",
    "columns": 12,
    "gap": 12,
    "padding": 16,
    "rows": [
      { "id": "r1", "height": "auto", "cells": [
          { "id": "c1", "span": 4, "item": "the-nhiet-do" },
          { "id": "c2", "span": 4, "item": "dong-ho-ap-suat" },
          { "id": "c3", "span": 4, "item": "den-bom" } ] },
      { "id": "r2", "height": 320, "cells": [
          { "id": "c4", "span": 8, "item": "xu-huong" },
          { "id": "c5", "span": 4, "item": "alarm-moi" } ] }
    ]
  },
  "items": [ { "id": "the-nhiet-do", "type": "widget", "widget": "card", "props": {}, "tags": {} } ]
}
```

- **Giữ `items[]` phẳng làm nguồn sự thật của component**; ô chỉ **tham chiếu** `item` theo `id`. Nhờ vậy binding, sự kiện, đổi tên, so sánh, nhập lại SVG và template (mục 2, dòng cuối) **không phải viết lại**. Đây là quyết định kiến trúc chính (D2).
- Ô: `span` 1 đến 12; tùy chọn `offset` (ô trống đứng trước), `align` (`start`/`center`/`end`/`stretch`), `minHeight`. Tổng `offset + span` của một hàng không quá `columns`.
- Hàng: `height` là `"auto"` (cao theo nội dung và `minHeight` của widget) hoặc số px; tùy chọn `gap` riêng.
- Item trong màn hình lưới **không** có `x`, `y`, `width`, `height` (kích thước do ô quyết định). Schema đổi các trường này từ bắt buộc thành tùy chọn; luật kiểm: màn hình tự do bắt buộc có đủ, màn hình lưới cấm có (`E_LAYOUT_ITEM_POS`).
- Một ô chứa **một** item (D3); muốn xếp chồng thì dùng widget `panel` (Khung nhóm). Ô trống hợp lệ (để chừa chỗ).
- Phiên bản đầu cố định 12 cột (D1). Chưa có breakpoint riêng cho từng cỡ màn hình (D4): trang vận hành tự xếp chồng ô thành một cột khi chiều rộng dưới 768 px.

### 3.2. Trang vận hành web

- Phần tử mới `mat-grid-screen` trong `packages/ui-components` hiển thị bằng CSS Grid (`grid-template-columns: repeat(12, 1fr)`), cuộn dọc, **không** dùng `transform: scale()`. Widget điền đầy ô.
- Cách đăng ký dữ liệu sống, binding, sự kiện, popup giữ nguyên vì chúng làm việc theo item `id`.
- Item `svg` đặt trong ô co theo `viewBox` (giữ tỷ lệ), cao tối thiểu theo tỷ lệ đó.
- Màn hình tự do vẫn dùng `mat-screen` cũ.

### 3.3. Studio: trình soạn bố cục

Màn hình có `layout` mở bằng editor lưới thay cho canvas tự do (cùng tab, cùng Toolbox, cùng Inspector).

```
┌ Màn hình: Tổng quan ───────────────────────────────────────── [+ Thêm hàng] ┐
│ ⠿ Hàng 1   cao: tự động   [4 | 4 | 4 ▾]                          ⋯          │
│ ┌────────────┐ ┌────────────┐ ┌────────────┐                                 │
│ │ Thẻ nhiệt  │ │ Đồng hồ    │ │  + Thả     │   ← ô trống hiện viền nét đứt   │
│ │ độ         │ │ áp suất    │ │  component │                                 │
│ └────────────┘ └────────────┘ └────────────┘                                 │
│ ⠿ Hàng 2   cao: 320 px    [8 | 4 ▾]                              ⋯          │
│ ┌──────────────────────────────┐ ┌────────────┐                              │
│ │ Biểu đồ xu hướng             │ │ Alarm mới  │                              │
│ └──────────────────────────────┘ └────────────┘                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Thêm hàng** kèm mẫu cột: `12`, `6+6`, `4+4+4`, `3+3+3+3`, `8+4`, `4+8`, `3+6+3`, hoặc nhập tay (tổng ≤ 12).
- **Gắn component vào ô:** kéo từ Toolbox thả **vào ô** (ô sáng lên khi rê vào), hoặc chọn ô rồi bấm widget trong Toolbox, hoặc menu chuột phải của ô **Gắn component…**. Thả vào ô đã có component thì hỏi thay thế. Không có thao tác kéo tự do trong trang.
- **Đổi độ rộng cột:** kéo đường chia giữa hai ô (bám theo 1/12), hoặc nhập `span` ở Inspector. Đổi thứ tự hàng và ô bằng tay nắm `⠿` hoặc nút lên/xuống (có phím tắt, dùng được không cần chuột).
- **Inspector:** chọn hàng thì sửa chiều cao, khoảng cách; chọn ô thì sửa `span`, `offset`, `align`, `minHeight`; chọn component trong ô thì hiện các tab sẵn có (Chung, Hiển thị, Gắn Tag, Sự kiện, Bảo mật), bỏ nhóm Vị trí và kích thước.
- **Hoàn tác** gom thành một bước cho mỗi thao tác; Lưu theo quy tắc hiện có (sao lưu `.mat-backup/`).
- **Xem trước:** nút `Tắt / Mô phỏng / Thiết bị` giữ nguyên, hiển thị bằng cùng `mat-grid-screen`; có công tắc cỡ xem trước 1366, 1920, 768 px để kiểm tra xếp chồng.
- **Tạo màn hình mới:** hộp chọn **Bố cục: Lưới (mặc định) hoặc Tự do** (D5).

### 3.4. Kiểm tra, mã lỗi, tương thích

- Luật mới (cả TypeScript và C++, cùng vector chung): `E_LAYOUT_COLUMNS` (columns khác 12), `E_LAYOUT_SPAN` (span ngoài 1 đến 12, hoặc offset + span quá cột), `E_LAYOUT_ITEM_REF` (ô trỏ item không có), `E_LAYOUT_ITEM_DUP` (một item đặt ở hai ô), `E_LAYOUT_ITEM_POS` (item của màn hình lưới có `x`, `y`, `width`, `height`), `E_LAYOUT_LIMIT` (quá 100 hàng hoặc 12 ô một hàng), `W_LAYOUT_ITEM_ORPHAN` (item không nằm trong ô nào: không hiển thị, cảnh báo).
- Mã lỗi đăng ký ở `schemas/error-codes.json` và tài liệu mã lỗi.
- **Phiên bản:** `1.1.0` (cộng thêm, tương thích ngược): mọi project 1.0 mở được nguyên trạng. Project dùng `layout` ghi `schemaVersion` `1.1.0` và `minRuntimeVersion` `1.1.0`, runtime cũ từ chối kèm lý do. Cần sửa `SUPPORTED_SCHEMA_10`/luật "1.1 trở lên bị từ chối" để nhận 1.1.x, cập nhật hợp đồng định dạng và thêm ADR.
- Nâng cấp 1.0 → 1.1: chỉ đổi `schemaVersion` và runtime tối thiểu (cùng cách `bumpFormat` của các bước trước); **không** tự đổi bố cục màn hình cũ.

## 4. Chuyển màn hình tự do sang lưới (giai đoạn sau)

Công cụ tùy chọn **Chuyển sang bố cục lưới** cho màn hình tự do: nhóm các item theo hàng gần nhau về `y`, chia cột theo `x` và `width`, làm tròn về 12 cột, đưa kết quả cho người dùng xem trước và chỉnh trước khi áp (một bước hoàn tác). Không tự động; màn hình tự do vẫn được hỗ trợ lâu dài (D5).

## 5. Công việc theo giai đoạn

Mỗi giai đoạn có test viết trước (đỏ rồi xanh) và commit riêng; tuần là "tuần kỹ sư", độ tin cậy thấp.

| GĐ | Nội dung | Tệp chính | Ước lượng |
|---|---|---|---|
| 0 | Spec `012`, ADR 040 (bố cục lưới), cập nhật hợp đồng định dạng, chốt D1 đến D9 | `specs/012-screen-grid-layout/`, `docs/adr/` | 0,5 tuần |
| 1 | Schema 1.1, kiểu TypeScript, luật `E_LAYOUT_*` ở TS và C++, vector chung, nâng cấp 1.0 → 1.1, runtime nhận 1.1 | `schemas/1.1/`, `packages/project-schema/`, `core/project-manager/`, `tests/project-vectors/` | 1,5 đến 2 tuần |
| 2 | `mat-grid-screen` (CSS Grid), nối binding và sự kiện, trang vận hành dùng nó cho màn hình lưới, xếp chồng dưới 768 px | `packages/ui-components/`, `apps/runtime-web/` | 1 đến 1,5 tuần |
| 3 | Editor lưới trong Studio: thêm hàng, mẫu cột, thả vào ô, kéo đường chia cột, Inspector hàng/ô, hoàn tác, xem trước đa cỡ, bàn phím | `apps/studio/src/ui/screen/`, `apps/studio/src/model/screen-ops.ts`, `project-doc.ts` | 3 đến 4 tuần |
| 4 | Các luồng cũ biết màn hình lưới: đổi tên Tag, so sánh, Đọc lên và Nạp xuống, nhân bản màn hình, template, Điều hướng | `rename.ts`, `compare.ts`, `model/*-flow.ts` | 1 tuần |
| 5 | Công cụ chuyển tự do → lưới | `apps/studio/src/model/` | 1 tuần |
| 6 | Tài liệu (hướng dẫn kỹ sư, mã lỗi), ảnh chụp, kiểm trên BL335, đo hiệu năng trang vận hành | `docs/user/`, `tools/docs-screenshots.mjs` | 1 tuần |
| 7 | Giao diện hiện đại: spike thư viện, bộ token và bảng màu mới, biểu đồ, báo cáo (mục 9); **chạy song song** với GĐ 1 đến 4 | `packages/ui-components/`, `packages/report-export/`, `apps/*/theme` | 4 đến 6 tuần |

Tổng khoảng **9 đến 11 tuần** cho phần bố cục lưới (GĐ 0 đến 6) và **4 đến 6 tuần** cho phần giao diện (GĐ 7), cộng lại khoảng 13 đến 17 tuần cho một người, hoặc 9 đến 12 tuần nếu hai người làm song song. Có thể giao hàng sớm: sau GĐ 3 đã dùng được (màn hình lưới tạo mới, chưa có chuyển đổi và các luồng phụ). GĐ 1 và GĐ 2 có thể song song sau khi chốt schema.

## 6. Kiểm thử và tiêu chí nghiệm thu

- **Vector chung:** thêm ít nhất 40 ca (hợp lệ, từng mã `E_LAYOUT_*`, 1.0 và 1.1 lẫn nhau); TypeScript và C++ phải cho cùng kết quả.
- **Đơn vị:** thuật toán chia cột, đổi `span`, di chuyển hàng/ô, thay thế component, hoàn tác, đồng bộ `items[]` với các ô (xóa component thì ô trống, xóa ô thì item thành mồ côi và được báo).
- **Giao diện:** kiểm với DOM thật cho thả vào ô, kéo đường chia, phím tắt; ảnh chụp ở 1366, 1920, 768 px.
- **Fuzz:** 10.000 đột biến `layout` không làm validator hay trình hiển thị sập (như các bộ kiểm hiện có).
- **Nghiệm thu:**
  1. Dựng trang 3 hàng (3 cột, 2 cột, 1 cột) với 6 component trong ≤ 3 phút, không nhập tọa độ nào.
  2. Cùng bố cục hiển thị đúng ở xem trước Studio và trang vận hành web, ở 1366 và 1920 px; dưới 768 px các ô xếp chồng.
  3. Mọi project 1.0 hiện có mở, kiểm, nạp xuống như cũ (vector hiện có xanh, không đổi).
  4. Runtime cũ nạp project `layout` thì từ chối kèm lý do rõ, không chạy sai.
  5. Trang vận hành lưới 12 widget trên BL335 đạt ngân sách hiện có (không tăng RSS runtime; web chạy ở trình duyệt).

## 7. Rủi ro

| Rủi ro | Cách giảm |
|---|---|
| Sửa schema `additionalProperties: false` và `required` ảnh hưởng nhiều bộ kiểm | Làm GĐ 1 trước, vector chung chạy trên cả hai bộ kiểm; cập nhật hợp đồng 1.0 → 1.1 cùng lúc |
| Luồng cũ duyệt `screen.items` bỏ sót ô (đổi tên, so sánh) | Giữ `items[]` là nguồn sự thật (3.1): chỉ phần đặt chỗ nằm trong `layout`; GĐ 4 liệt kê từng luồng và thêm test |
| Editor lưới phức tạp về kéo thả và truy cập bàn phím | Tách `mat-grid-editor` riêng, không sửa `mat-screen-canvas`; thao tác nào cũng có đường bàn phím và menu |
| Người dùng muốn vị trí đặc biệt (chồng lên nhau, phủ bản vẽ SVG) | Giữ chế độ tự do (D5); lưới dùng `panel` để nhóm; cân nhắc bản sau cho ô nhiều item |
| Widget chưa được thiết kế để co giãn theo ô (đồng hồ, biểu đồ) | Mỗi widget khai `minHeight` và tỷ lệ ưa thích trong danh mục; kiểm ở 3 cỡ ô trong GĐ 2 |
| Runtime cũ gặp project 1.1 | Có `minRuntimeVersion` 1.1.0 và cổng phiên bản của Nạp xuống chặn kèm lời nhắc (cơ chế đã có) |

## 8. Phụ thuộc

- Không cần thiết bị mới, không thêm thư viện lớn (CSS Grid có sẵn ở trình duyệt).
- Cần chốt trước khi bắt đầu GĐ 1: D1 đến D4 (mô hình), D5 (có giữ chế độ tự do).

## 9. Giao diện, màu sắc, biểu đồ và báo cáo hiện đại hơn

Người dùng nhận xét giao diện hiện tại (màu sắc, biểu đồ, báo cáo) chưa đẹp và chưa hiện đại. Mục này đề xuất làm một đợt thiết kế lại, dùng thêm thư viện tốt hơn và bảng màu sáng, nhiều màu hơn. Việc này **độc lập về mã** với bố cục lưới nhưng nên làm cùng, vì ô lưới là nơi hiển thị card và biểu đồ đẹp.

### 9.1. Hiện trạng (kiểm trên mã `gd6`)

| Hạng mục | Đang dùng | Nhận xét |
|---|---|---|
| Khung giao diện | **Lit 3.3.3** (web component), CSS tự viết | Nhẹ, nhưng chưa có bộ thành phần đẹp sẵn |
| Màu, kiểu chữ | Token `--mat-*` tự viết ([tokens.css](../../packages/ui-components/src/styles/tokens.css)): nền xám lạnh `#edf0f1`, màu nhấn xanh ngọc `#0b7285`; font `Segoe UI Variable` | Màu trầm, ít đa dạng; font chỉ có sẵn trên Windows, nơi khác rơi về phông hệ thống |
| Bảng màu biểu đồ | 8 màu `--mat-chart-1..8` (teal, cam đậm, tím, xanh lá đậm, đỏ rượu…), kèm kiểu nét khác nhau cho người mù màu | Chọn theo tương phản và mù màu nên tối và xỉn; thiếu bảng màu tuần tự (sequential) và phân kỳ (diverging) |
| Biểu đồ đường, xu hướng lịch sử | **uPlot 1.6.32** (`chart/line-chart.ts`, `chart/history-plot.ts`) | Rất nhanh, rất nhẹ (khoảng 50 KB), nhưng mặc định rất "kỹ thuật": ít hoạt ảnh, tooltip và chú giải thô |
| Biểu đồ cột, tròn, đồng hồ, mức chất lỏng | **SVG vẽ tay** (`widgets/bar.ts`, `pie.ts`, `gauge.ts`, `level.ts`) | Ít hiệu ứng (đổ bóng, gradient, hoạt ảnh vào), khó thêm kiểu mới |
| Icon | Fluent System Icons (Studio), bộ riêng của trang vận hành | Dùng được |
| Báo cáo | **pdfmake 0.3.11** (PDF), **fflate** (XLSX tự ghép), CSV | PDF dùng font mặc định, bảng đơn giản, chưa có biểu đồ trong báo cáo |

### 9.2. Ràng buộc bắt buộc với mọi thư viện mới

- **Chạy offline:** BL335 và máy vận hành ở mạng LAN, không dùng CDN. Mọi thư viện, font nằm trong gói (`script-src 'self'` của CSP Studio và trang web).
- **Giấy phép:** phải qua cổng giấy phép hiện có (`tools/release/license-report.mjs`; MIT, Apache-2.0, BSD, ISC, OFL chấp nhận; GPL, AGPL từ chối). Ghi vào `THIRD_PARTY`/`licenses.md`, SBOM tự cập nhật.
- **Kích thước:** trang vận hành tải từ BL335 qua LAN: tổng JS nạp lần đầu tăng không quá khoảng 400 KB nén gzip so với hiện tại (đo bằng `build-info`/Vite), biểu đồ nạp lười khi trang có widget đó.
- **Hiệu năng trình duyệt:** 10 client, 500 Tag, biểu đồ cập nhật 1 Hz không làm CPU trình duyệt quá 30 % trên máy văn phòng; biểu đồ lịch sử dưới 50.000 điểm vẫn cuộn mượt.
- **Truy cập được:** chữ trên nền màu ≥ 4,5:1, màu không phải là kênh duy nhất truyền tin (giữ kiểu nét, nhãn, hình dạng); tôn trọng `prefers-reduced-motion`; kiểm axe-core như hiện nay.
- **Hai giao diện sáng và tối** giữ nguyên.

### 9.3. Ứng viên và đề xuất

Số phiên bản và kích thước dưới đây là **ước tính từ hiểu biết chung**, phải đo và ghim phiên bản ở bước spike (mục 9.4) trước khi chốt.

| Nhu cầu | Ứng viên | Ưu | Nhược | Đề xuất |
|---|---|---|---|---|
| Biểu đồ cột, tròn/vành khuyên, đồng hồ, bản đồ nhiệt, hoạt ảnh | **Apache ECharts** (Apache-2.0) | Rất nhiều kiểu, theme dễ chỉnh, hoạt ảnh, tooltip đẹp, nhập theo mô-đun (tree-shake) còn khoảng 300 đến 400 KB nén | Nặng hơn uPlot, cần cấu hình | **Dùng** cho cột, tròn, đồng hồ, bản đồ nhiệt |
| Như trên, đơn giản hơn | **Chart.js** (MIT) | Nhẹ hơn (khoảng 70 đến 100 KB), dễ dùng | Ít kiểu hơn, thiếu đồng hồ | Phương án dự phòng |
| Biểu đồ đường thời gian thực, lịch sử nhiều điểm | **uPlot** (MIT, đang dùng) | Nhanh nhất, rất nhẹ, hợp 10.000 đến 100.000 điểm | Mặc định thô | **Giữ**, thiết kế lại giao diện (bảng màu, chú giải, tooltip, lưới) bằng plugin và CSS; spike so với ECharts `line` (có `sampling: lttb`) rồi chốt |
| Khung giao diện, thành phần | **Giữ Lit + token tự viết**, thiết kế lại token | Ít rủi ro, không đổi mã hiện có, không thêm phụ thuộc lớn | Phải tự làm đẹp | **Chọn** |
| | Web Awesome (tiền thân Shoelace, MIT) hoặc Fluent UI Web Components (MIT) | Có sẵn nhiều thành phần đẹp | Phải thay hàng loạt thành phần Lit hiện có, rủi ro hồi quy lớn | Không chọn ở bản đầu |
| Bảng màu | **Radix Colors** (MIT) hoặc thang màu Tailwind (MIT) làm nguồn; sinh bậc màu bằng OKLCH | Thang 12 bậc sáng và tối nhất quán, có sẵn bậc nền nhạt cho trạng thái | Cần ánh xạ sang token `--mat-*` | **Dùng** làm nguồn, ghi giá trị vào tokens.css (không thêm phụ thuộc chạy) |
| Phông chữ | **Inter** (OFL), tự chứa `woff2` biến thiên, tập con Latin mở rộng (đủ dấu tiếng Việt) | Hiện đại, đọc rõ số trên màn hình; giống nhau trên mọi hệ điều hành | Thêm khoảng 100 đến 150 KB | **Dùng**, giữ `Segoe UI` làm dự phòng |
| Icon | **Fluent System Icons** (đang dùng) hoặc **Lucide** (ISC) | Đã có | | Giữ; thống nhất bộ của trang vận hành với Studio |
| Báo cáo PDF | **pdfmake** (đang dùng) | Đủ dùng | Font mặc định Roboto, bảng thô | **Giữ**, nhúng Inter, thiết kế mẫu mới (dải tiêu đề màu, bảng kẻ xen kẽ, thẻ số liệu, biểu đồ) |
| Biểu đồ trong báo cáo | Vẽ biểu đồ ECharts ra **SVG** (chế độ SVG renderer, không cần canvas) rồi nhúng vào pdfmake (`svg`) | Một nguồn vẽ cho màn hình và báo cáo, vector sắc nét | Cần kiểm kích thước và phông | **Đề xuất**, chốt sau spike |
| Báo cáo XLSX | **fflate** (đang dùng) | Nhẹ | Chưa có biểu đồ, định dạng ô còn đơn giản | Giữ; thêm tiêu đề màu, độ rộng cột, định dạng số; biểu đồ trong XLSX ngoài phạm vi |

### 9.4. Việc làm (GĐ 7)

1. **Spike (0,5 đến 1 tuần):** dựng cùng một trang mẫu (card, đồng hồ, cột, tròn, xu hướng 10.000 điểm, bảng Tag) bằng (a) uPlot cải tiến, (b) ECharts, đo kích thước gzip, thời gian vẽ, CPU ở 1 Hz với 10 client, xem trên ảnh chụp. Ghi kết quả vào `research.md` của spec 012 và ADR 041; chốt thư viện.
2. **Token và bảng màu mới (1 tuần):** thiết kế lại `tokens.css` (Studio và web chung):
   - **Màu nhấn sáng hơn**, nền trắng và xám rất nhạt, bo góc lớn hơn (6 đến 8 px), bóng mềm; card có thể có dải màu theo ngữ nghĩa.
   - **Bảng màu biểu đồ 10 đến 12 màu** sáng, đa dạng sắc (xanh dương, xanh ngọc, xanh lá, vàng, cam, đỏ, hồng, tím, chàm…), bậc nhạt cho nền vùng; thêm bảng tuần tự và phân kỳ cho bản đồ nhiệt.
   - **Bộ chủ đề chọn được** (ví dụ "Sáng đa sắc" mặc định, "Công nghiệp trầm" như hiện nay, "Tối"), người dùng chọn ở Thiết lập project hoặc theo người dùng; widget đọc màu từ token nên đổi theo.
   - Giữ kiểm tra tương phản tự động (`alarm-tokens.test.ts` mở rộng cho bộ mới); màu alarm giữ nghĩa nhưng sáng hơn.
3. **Biểu đồ (2 đến 3 tuần):** thay thế bar, pie, gauge bằng bản vẽ mới (ECharts hoặc SVG cải tiến theo kết quả spike), hoạt ảnh vào/ra tôn trọng `prefers-reduced-motion`; làm lại tooltip, chú giải, trục; xu hướng thời gian thực giữ uPlot nếu spike cho thấy nhanh hơn rõ; widget `card` thêm sparkline và chỉ báo thay đổi.
4. **Báo cáo (1 đến 1,5 tuần):** mẫu PDF mới (tiêu đề, logo, thẻ số liệu, biểu đồ, bảng zebra, chân trang có số trang), nhúng font Inter, biểu đồ vector; XLSX định dạng tốt hơn.
5. **Tài liệu và ảnh chụp** cập nhật cùng GĐ 6.

### 9.5. Nghiệm thu giao diện

- Bảng so sánh ảnh chụp trước và sau cho 6 màn hình chuẩn (Tổng quan, Xu hướng, Alarm, Báo cáo, Bảng Tag, Điều khiển) được người dùng duyệt.
- Đủ 10 đến 12 màu phân biệt trong biểu đồ nhiều chuỗi; chữ trên nền màu ≥ 4,5:1 (kiểm tự động).
- Dung lượng JS nạp lần đầu của trang vận hành tăng ≤ khoảng 400 KB gzip; biểu đồ nạp lười.
- 10 client, 500 Tag, 1 Hz: CPU trình duyệt ≤ 30 %; biểu đồ 50.000 điểm vẫn mượt.
- PDF báo cáo mẫu có biểu đồ, hiển thị đủ dấu tiếng Việt, mở được ở trình xem phổ biến.
- Mọi test hiện có (Vitest, axe) vẫn xanh.

### 9.6. Rủi ro riêng

| Rủi ro | Cách giảm |
|---|---|
| ECharts nặng, vượt ngân sách nạp lần đầu | Chỉ nhập mô-đun cần dùng, nạp lười theo widget, đo trong spike; phương án dự phòng Chart.js hoặc SVG cải tiến |
| Màu sáng, đa màu làm giảm tương phản hoặc khó với người mù màu | Kiểm tương phản tự động, giữ kiểu nét và nhãn song song với màu, có chủ đề "Công nghiệp trầm" |
| Đổi widget biểu đồ làm hỏng project cũ | Giữ thuộc tính `props` của widget (`series`, `yMin`…) không đổi; chỉ đổi cách vẽ; vector và test hiện có là hàng rào |
| Font và thư viện làm tăng dung lượng gói runtime trên BL335 | Đo dung lượng `web/` trong gói; nén sẵn bằng gzip/brotli ở bước đóng gói nếu máy chủ hỗ trợ |
| Thêm phụ thuộc phải qua cổng giấy phép và SBOM | Kiểm ngay ở bước spike; ghi vào ADR |

## 10. Các quyết định cần người dùng chốt

| # | Câu hỏi | Đề xuất |
|---|---|---|
| D1 | Số cột cố định 12, hay cho 6, 12, 24? | **12 cố định** (đủ chia 2, 3, 4, 6; đơn giản kiểm thử) |
| D2 | Nơi giữ component: tham chiếu `item` từ ô (giữ `items[]` phẳng), hay lồng item trong ô? | **Tham chiếu** (không phải viết lại các luồng binding, đổi tên, so sánh) |
| D3 | Một ô chứa 1 component, hay nhiều (xếp chồng dọc)? | **1 component**; dùng `panel` để nhóm; xem lại sau |
| D4 | Có cần breakpoint riêng (số cột khác nhau ở màn hình nhỏ), hay chỉ xếp chồng tự động dưới 768 px? | **Xếp chồng tự động** ở bản đầu |
| D5 | Giữ chế độ tự do cho màn hình hiện có và màn hình mới tùy chọn? | **Giữ**; màn hình mới mặc định **Lưới** |
| D6 | Popup có dùng lưới không? | **Có** (cùng mô hình), kích thước popup vẫn cố định |
| D7 | Cho phép lưới lồng nhau (ô chứa lưới con)? | **Chưa** (bản đầu); dùng `panel` |
| D8 | Chiều cao hàng: tự động theo widget, hay luôn nhập px? | **Cả hai** (`auto` mặc định; số px khi cần) |
| D9 | Chuyển màn hình tự do hiện có sang lưới: làm công cụ bán tự động (GĐ 5), hay để người dùng dựng lại? | **Công cụ bán tự động**, làm sau cùng |

| D10 | Chọn thư viện biểu đồ: ECharts cho cột, tròn, đồng hồ và giữ uPlot cho xu hướng thời gian thực (đề xuất), hay dùng ECharts cho tất cả, hay chỉ cải tiến SVG tay? | **Hỗn hợp**, chốt sau spike đo kích thước và hiệu năng |
| D11 | Giữ khung Lit và thiết kế lại token (đề xuất), hay thay bằng bộ thành phần có sẵn (Web Awesome, Fluent Web Components)? | **Giữ Lit**, thiết kế lại token |
| D12 | Phong cách màu: "sáng đa sắc" mặc định, giữ "công nghiệp trầm" làm chủ đề phụ, hay bỏ hẳn kiểu cũ? | **Mặc định sáng đa sắc**, giữ kiểu cũ làm chủ đề chọn được |
| D13 | Biểu đồ trong báo cáo PDF: có (vẽ SVG nhúng vào pdfmake), hay chỉ bảng số liệu như hiện nay? | **Có** |
| D14 | Phông Inter (tự chứa, thêm khoảng 100 đến 150 KB) thay phông hệ thống? | **Có**, giữ Segoe UI làm dự phòng |
| D15 | Làm GĐ 7 (giao diện) song song với bố cục lưới, hay làm sau? | **Song song**, vì ô lưới hiển thị card và biểu đồ mới |

Sau khi có câu trả lời, cập nhật bảng này thành "đã chốt" và mở spec `012`.
