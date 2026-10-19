# Kế hoạch: bố cục màn hình theo hàng và cột (lưới 12 cột)

**Trạng thái:** đã duyệt 2026-10-19; người dùng chốt D1 đến D26 theo cột Đề xuất (mục 11) · **Ngày:** 2026-10-19 · **Chủ đề:** (1) thay cách đặt widget bằng tọa độ và kéo thả tự do bằng bố cục theo hàng, mỗi hàng chia cột, gắn widget vào từng ô; (2) làm giao diện, màu sắc, biểu đồ và báo cáo hiện đại, nhiều màu sắc hơn (mục 9); (3) trang đăng nhập bắt buộc và phân quyền theo người dùng cho từng trang và từng component (mục 10) · **Đi kèm:** [Định hướng UX/UI Studio](../architecture/studio-ux.md), [Định dạng project 1.0](../../specs/011-pilot-hardening/contracts/project-format-1.0.md), [Kế hoạch sau 1.0](post-1.0-backlog.md)

Đây là tài liệu kế hoạch, chưa có mã. Khi người dùng chốt mục 11, mở spec bằng `/speckit-specify` (thư mục `specs/012-screen-grid-layout/`) rồi làm theo quy trình Spec Kit và test viết trước.

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
| 8 | Đăng nhập bắt buộc và phân quyền theo người dùng cho trang và component (mục 10): spec riêng `013`; **chạy song song** sau khi chốt schema 1.1 | `server/`, `core/auth/`, `packages/project-schema/`, `apps/runtime-web/` | 11 đến 13 tuần |

Tổng khoảng **9 đến 11 tuần** cho phần bố cục lưới (GĐ 0 đến 6) và **4 đến 6 tuần** cho phần giao diện (GĐ 7), và **11 đến 13 tuần** cho phần đăng nhập và phân quyền (GĐ 8, gồm trang Quản trị trên web). Cộng lại khoảng 24 đến 30 tuần cho một người, hoặc 12 đến 16 tuần nếu ba người làm song song (bố cục lưới, giao diện, phân quyền). Có thể giao hàng sớm: sau GĐ 3 đã dùng được (màn hình lưới tạo mới, chưa có chuyển đổi và các luồng phụ). GĐ 1 và GĐ 2 có thể song song sau khi chốt schema.

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

## 10. Đăng nhập bắt buộc và phân quyền theo người dùng

### 10.1. Yêu cầu của người dùng

- **Phải có trang đăng nhập.** Chưa đăng nhập thì mọi đường vào (địa chỉ trang, địa chỉ trực tiếp, dữ liệu sống) đều dẫn về trang đăng nhập; đăng nhập xong quay lại đúng trang đang cần.
- **Phân quyền theo người dùng:** quản trị viên cấp cho **từng người dùng** (hoặc nhóm người dùng) quyền **xem từng trang** và quyền **xem hoặc thao tác từng component**. Người không có quyền thì không thấy hoặc không thao tác được.
- **Quản lý tài khoản và phân quyền ngay trên giao diện web, dành cho admin:** admin đăng nhập trang web, mở phần **Quản trị** để tạo, tắt, đặt lại mật khẩu người dùng, gán nhóm và phân quyền trang, component. Không phải dùng dòng lệnh SSH, không phải mở Studio và không phải nạp lại project; thay đổi có hiệu lực ngay trên thiết bị.

### 10.2. Hiện trạng (kiểm trên mã và tài liệu `gd6`)

| Hạng mục | Hiện trạng | Nơi có |
|---|---|---|
| Đăng nhập trang web | Có trang đăng nhập riêng (`login-main.ts`, `login-form.ts`) và hộp thoại đăng nhập; phiên bằng cookie `__Host-mat_sid` HttpOnly và `csrfToken` giữ trong biến (không localStorage) | [session.ts](../../apps/runtime-web/src/session.ts), [ADR-021](../adr/021-web-login-certificates.md) |
| Xem có bắt đăng nhập? | Tùy chọn `viewerLogin`: **`off` mặc định** (xem không cần đăng nhập, lọc theo nguồn `viewerAccess`), `required` thì mọi trang và dữ liệu cần phiên; chưa đăng nhập thì 401 và trang hiện thông báo thay vì chuyển sang trang đăng nhập | ADR-021 mục 7, [project-store.ts](../../apps/runtime-web/src/project-store.ts) |
| HTTP và HTTPS | Đăng nhập chỉ có ở HTTPS 8443 (cookie `Secure`); HTTP 8080 chỉ xem | session.ts |
| Tài khoản | `/etc/mat-runtime/users.json`, tạo **chỉ bằng dòng lệnh trên thiết bị** (`mat-runtime --user-add`), không có giao diện, không đăng ký hay quên mật khẩu | [admin-guide.md](../user/admin-guide.md) mục 4 |
| Vai trò | 4 vai trò cố định: `viewer`, `operator`, `engineer`, `administrator` | cùng tệp |
| Quyền theo trang | **Chưa có.** Trang chỉ xem được hoặc không (theo `viewerLogin`), không phân biệt người dùng | |
| Quyền theo component | Chỉ **lệnh ghi** có `security.minRole` (vai trò tối thiểu); không có quyền xem; không theo từng người | `screen.schema.json` (`security`), `widgets.catalog.json` |
| Chống dò mật khẩu, audit | Sai 5 lần khóa 5 phút; đăng nhập và lệnh ghi vào `audit.db` | admin-guide.md |
| Trang quản trị trên web | **Chưa có** (trang vận hành chỉ có đăng nhập, đăng xuất, các màn hình, alarm, lịch sử, báo cáo) | `apps/runtime-web/src/menu.ts` |
| Trang quản lý trong Studio | Mục **Người dùng và quyền** trên cây có sẵn nhưng là trang giữ chỗ (`phasePage.users`) | `apps/studio/src/model/tree.ts` |

Nhận xét: nền đăng nhập (HTTPS, phiên, CSRF, khóa tạm, audit) đã có; thiếu là (a) **bắt buộc** đăng nhập kèm chuyển hướng, (b) **trang quản trị trên web** cho admin quản lý người dùng, (c) **mô hình quyền theo người dùng** cho trang và component, (d) **thực thi ở phía máy chủ** (Constitution V).

### 10.3. Thiết kế đề xuất

**A. Đăng nhập bắt buộc**

- `viewerLogin` mặc định **`required`** cho project mới (an toàn mặc định); project cũ giữ `off` cho tới khi người quản trị đổi. Studio hiện cảnh báo rõ khi đang `off`.
- Chưa có phiên thì trình duyệt được chuyển (`302`) tới `/login?next=<trang>`; sau khi đăng nhập quay lại `next` (chỉ nhận đường dẫn trong cùng máy chủ, chống chuyển hướng mở). Không còn thông báo cụt "cần đăng nhập".
- Vào bằng HTTP (8080) khi `required`: trang chỉ hiện thông báo kèm liên kết sang HTTPS 8443.
- Trang đăng nhập đẹp theo bộ giao diện mới (mục 9), có tên đơn vị và logo, thông báo lỗi rõ (sai mật khẩu, tài khoản bị khóa kèm thời gian), nút Đăng xuất, hết phiên do rảnh thì quay về trang đăng nhập.
- **Đổi mật khẩu của tôi** (trang cho mọi người dùng đã đăng nhập; vẫn theo quy tắc mật khẩu 15 đến 128 ký tự). Quản trị viên đặt lại mật khẩu cho người khác.

**B. Mô hình quyền theo người dùng**

- Giữ 4 vai trò làm **trần khả năng hệ thống**: `viewer` chỉ xem, `operator` thêm thao tác (ghi Tag, xác nhận alarm), `engineer` thêm nạp xuống và đọc lên, `administrator` thêm quản lý người dùng và đọc audit. Quyền theo trang và component **chỉ thu hẹp**, không bao giờ vượt vai trò.
- Thêm **nhóm** (ví dụ "Vận hành ca A", "Bảo trì", "Quản đốc"). Người dùng thuộc 0 đến n nhóm.
- **Quy tắc quyền nằm trên thiết bị, không nằm trong project.** Vì admin sửa trực tiếp trên web (không nạp lại project), kho quyền (`/etc/mat-runtime/access.json`, quyền `0640 root:matscada` như `users.json`) lưu cùng người dùng và nhóm. Project chỉ cung cấp **danh mục tài nguyên** và mặc định:
  - tài nguyên là màn hình, popup, **trang hệ thống** (Alarm, Lịch sử, Báo cáo, Bảng theo dõi) và **component** (nhận diện bằng `id` của item trong màn hình);
  - mỗi component có thể khai mặc định trong project: `security.view` và `security.operate` ở mức **vai trò tối thiểu** (mở rộng `minRole` hiện có); người thiết kế dự án đặt mặc định, admin thu hẹp hoặc mở rộng trong khuôn vai trò khi vận hành.
- **Quy tắc** (do admin sửa trên web): với mỗi tài nguyên, danh sách người nhận cho `view` và `operate`, ghi dạng `group:<id>`, `user:<tên>`, `role:<vai trò>` hoặc `*` (mọi người đã đăng nhập); không có quy tắc thì dùng mặc định của project.
- **Ý nghĩa:**
  - `view` ở trang: không có quyền thì trang **không có trong menu** và gõ địa chỉ trực tiếp ra 403;
  - `view` ở component: không có quyền thì **không hiển thị** (ô lưới thu lại hoặc để trống);
  - `operate` ở component (nút, công tắc, ô đặt giá trị, thanh trượt, chọn từ danh sách): không có quyền thì hiển thị **khóa**, kèm biểu tượng khóa và chú thích "cần quyền…".
- Quyền hiệu lực của một người dùng với một mục = người đó nằm trong danh sách người nhận (hoặc mặc định cho phép) **và** vai trò đủ mức (`minRole`).
- **Khi project đổi:** tài nguyên bị xóa hoặc đổi `id` làm quy tắc thành "mồ côi"; trang quản trị báo và cho dọn; nạp project mới không xóa quy tắc của tài nguyên còn nguyên `id`.

**C. Thực thi ở máy chủ (bắt buộc; ẩn trên giao diện không phải là bảo mật)**

- Tải màn hình: `GET` màn hình mà người dùng không có quyền `view` trả **403** và ghi audit; danh sách menu (`Điều hướng`) chỉ gồm trang được xem.
- **Dữ liệu sống:** Tag chỉ được component bị cấm dùng thì **không** gửi cho người đó. Runtime tính trước tập Tag được phép của từng người khi đăng nhập, khi nạp project và khi quy tắc đổi; bộ phát dữ liệu sống (live hub) lọc theo tập đó; đo CPU ở 10 client và 500 Tag.
- **Lịch sử, báo cáo, alarm:** truy vấn lịch sử và báo cáo chỉ trả Tag mà người đó được xem (qua các trang và component được cấp); alarm lọc theo nhóm nếu lớp alarm gắn nhóm (D21).
- **Lệnh ghi:** kiểm `operate`, `minRole`, giới hạn Tag, xác nhận như hiện nay; từ chối kèm audit khi thiếu quyền.
- Mọi từ chối quyền, đăng nhập thành công và thất bại, đổi người dùng, nhóm hoặc quy tắc đều vào `audit.db` (có người sửa, giá trị cũ và mới).

**D. Trang Quản trị trên giao diện web (chỉ `administrator`)**

Mục **Quản trị** hiện trong menu của trang vận hành khi người đăng nhập có vai trò `administrator`; chỉ có ở HTTPS, có CSRF, xác nhận lại mật khẩu khi làm việc nhạy cảm (đặt lại mật khẩu, hạ vai trò, xóa).

- **Tab Người dùng:** danh sách (tên, vai trò, nhóm, trạng thái, lần đăng nhập cuối, đang khóa tạm hay không); **thêm** người dùng, **tắt, mở**, **mở khóa tạm**, **đổi vai trò**, **gán nhóm**, **đặt lại mật khẩu** (mật khẩu theo quy tắc 15 đến 128 ký tự, có thể sinh ngẫu nhiên và hiện một lần).
- **Tab Nhóm:** tạo, đổi tên, xóa (chặn khi nhóm còn thành viên hoặc còn trong quy tắc).
- **Tab Quyền theo trang:** ma trận, hàng là trang (màn hình, popup, trang hệ thống), cột là nhóm hoặc người dùng; ô tích = được xem. Có "đặt cho nhiều trang" và "sao chép quyền từ trang khác".
- **Tab Quyền theo component:** chọn một màn hình, hiện **xem trước màn hình** với danh sách component; bấm một component thì sửa **Ai được xem** và **Ai được thao tác** (chọn nhóm, người dùng, vai trò), thấy ngay kết quả "những ai thấy và thao tác được".
- **Xem với tư cách người dùng X** (chế độ xem thử chỉ đọc, ghi audit) để admin kiểm kết quả trước khi báo người dùng.
- **Tab Nhật ký:** đăng nhập, từ chối quyền và thay đổi quản trị gần đây (đọc từ `audit.db`).
- Bảo vệ tự khóa: không cho xóa hoặc hạ vai trò `administrator` cuối cùng; `administrator` luôn xem được mọi trang hệ thống và trang Quản trị.
- **Dòng lệnh** `mat-runtime --user-*` vẫn dùng được (khi chưa có admin hoặc phục hồi). **Studio** có thể gọi cùng API quản lý này ở bản sau (mục **Người dùng và quyền** thay trang giữ chỗ), nhưng không bắt buộc cho bản đầu.

### 10.4. Dữ liệu, kiểm tra và tương thích

- Định dạng **1.1.0** (cùng lần nâng với bố cục lưới nếu hai việc giao cùng nhau, nếu không thì 1.2.0): **chỉ** mở rộng `security` ở item (`view`, `operate` mặc định theo vai trò tối thiểu) và quy ước `id` tài nguyên ổn định. **Không** thêm tệp quy tắc vào project (quy tắc nằm trên thiết bị). Project 1.0 mở nguyên trạng.
- Kho quyền trên thiết bị: `access.json` (nhóm, thành viên, quy tắc), có phiên bản định dạng riêng, ghi nguyên tử (tệp tạm rồi đổi tên), sao lưu bản trước; `users.json` thêm trường `groups` (tương thích ngược: thiếu thì rỗng).
- API quản trị mới dưới `/api/v1/admin/` (`users`, `groups`, `access`, `audit`): chỉ `administrator`, chỉ HTTPS, CSRF, giới hạn tần suất, audit từng thao tác; thân yêu cầu có giới hạn kích thước và kiểm cú pháp trước khi xử lý.
- Luật kiểm của project (TypeScript và C++, vector chung): `E_SECURITY_LEVEL` (mức vai trò sai), `E_SECURITY_ITEM` (mức không hợp với loại widget, ví dụ `operate` ở widget chỉ hiển thị). Luật kiểm của kho quyền ở thiết bị: nhóm và người nhận phải tồn tại, tài nguyên phải có trong project đang chạy (nếu không thì mồ côi, cảnh báo), không cho quy tắc làm mất quyền của `administrator`.
- Runtime cũ gặp project 1.1: từ chối bằng `minRuntimeVersion` như đã có.

### 10.5. Công việc (GĐ 8, spec `013`)

| Bước | Nội dung | Ước lượng |
|---|---|---|
| 8.0 | Spec `013`, ADR 042, cập nhật mô hình mối đe dọa [threat-model.md](../architecture/threat-model.md), hợp đồng kho quyền và API quản trị; chốt D16 đến D26; kiểm cách `minRole` hiện được thực thi ở máy chủ | 1 tuần |
| 8.1 | Project: mở rộng `security` mặc định, luật `E_SECURITY_*`, vector chung, nâng cấp định dạng | 1 tuần |
| 8.2 | Runtime: kho quyền `access.json`, nhóm trong `users.json`, API `/api/v1/admin/*`, kiểm `view`/`operate` ở tải màn hình, ghi, live hub, lịch sử, báo cáo, alarm; audit; test tấn công | 3 đến 4 tuần |
| 8.3 | Trang web vận hành: chuyển hướng tới trang đăng nhập, `next` an toàn, thông báo HTTP, lọc menu, trang 403, component ẩn hoặc khóa, đổi mật khẩu của tôi | 2 tuần |
| 8.4 | **Trang Quản trị trên web:** tab Người dùng, Nhóm, Quyền theo trang, Quyền theo component (xem trước và chọn component), xem với tư cách, Nhật ký; xác nhận lại mật khẩu | 3 đến 4 tuần |
| 8.5 | Bộ kiểm thử an ninh (mở rộng 30 ca của `web-it`, thêm ca leo thang đặc quyền và CSRF cho API quản trị), đo hiệu năng, tài liệu quản trị | 1 tuần |
| 8.6 (sau) | Studio: thay trang giữ chỗ Người dùng và quyền bằng giao diện gọi cùng API; tab Bảo mật ở Inspector đặt mặc định | 1,5 tuần |

### 10.6. Nghiệm thu

1. Chưa đăng nhập, vào bất kỳ địa chỉ nào (trang, `/project/*`, dữ liệu sống, lịch sử) đều bị chuyển hoặc từ chối (302 hoặc 401), không lộ dữ liệu; đăng nhập xong quay đúng trang.
2. Người dùng A (nhóm "Ca A") thấy trang Tổng quan, không thấy trang Bảo trì: menu không có mục đó, gõ địa chỉ trực tiếp ra 403, **và** dữ liệu sống của Tag chỉ trang Bảo trì dùng không tới trình duyệt của A (kiểm bằng bắt gói).
3. Component có `operate` cho nhóm "Quản đốc": người khác thấy khóa, gửi lệnh ghi bằng tay (`curl`) vẫn bị từ chối và ghi audit.
4. Admin đăng nhập trang web, vào **Quản trị**, tạo người dùng, gán nhóm, đặt lại mật khẩu, phân quyền một trang và một component mà **không dùng SSH, không mở Studio, không nạp lại project**; thay đổi có hiệu lực ngay (người bị đổi quyền phải đăng nhập lại, D23) và có dòng audit (ai sửa, giá trị cũ và mới). Người không phải admin gọi thẳng API quản trị bị 403 và ghi audit.
5. Quyền không bao giờ vượt vai trò (viewer trong nhóm Quản đốc vẫn không ghi được).
6. 10 client, 500 Tag: CPU runtime không tăng quá ngân sách; mọi test hiện có xanh.

### 10.7. Rủi ro riêng

| Rủi ro | Cách giảm |
|---|---|
| Lộ dữ liệu qua đường phụ (live, lịch sử, báo cáo, alarm, tải project) dù đã ẩn trên giao diện | Thực thi ở máy chủ cho **mọi** đường dữ liệu; danh sách đường kiểm kê ở 8.0 và mỗi đường có ca kiểm thử tấn công |
| Quản trị tự khóa mình hoặc xóa hết người có quyền | Vai trò `administrator` luôn xem được mọi trang hệ thống và trang Quản trị; không cho xóa, tắt hoặc hạ vai trò quản trị viên cuối cùng; dòng lệnh vẫn phục hồi được |
| Hiệu năng lọc theo người dùng ở live hub | Tính trước tập Tag được phép lúc đăng nhập và lúc nạp project, lọc bằng tra bảng băm; đo trong 8.2 |
| Quy tắc quyền trỏ tới component bị xóa hoặc đổi `id` khi project cập nhật | Tài nguyên nhận diện bằng `id` ổn định; quy tắc mồ côi được báo và cho dọn trong trang Quản trị; mặc định an toàn khi không có quy tắc |
| Trang Quản trị là mục tiêu tấn công (leo thang đặc quyền, CSRF, đoán mật khẩu admin) | Chỉ HTTPS, CSRF, xác nhận lại mật khẩu cho thao tác nhạy cảm, giới hạn tần suất, khóa tạm, audit từng thao tác, bộ kiểm thử tấn công riêng ở 8.5 |
| Đổi quyền không có hiệu lực ngay với phiên đang mở | Quy định rõ (D23): hiệu lực ở lần đăng nhập sau, hoặc buộc đăng nhập lại khi quyền của người đó thay đổi |
| Người dùng quen xem không đăng nhập bị chặn bất ngờ khi nâng cấp | Project cũ giữ `viewerLogin: off`; chỉ project mới mặc định `required`; hộp thoại nâng cấp nêu rõ |

## 11. Các quyết định (đã chốt 2026-10-19 theo cột Đề xuất)

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
| D16 | Đăng nhập bắt buộc mặc định cho project mới (`viewerLogin: required`), project cũ giữ `off` | **Có** |
| D17 | Mô hình quyền: người dùng → nhóm, quy tắc ở trang và component trỏ tới nhóm, người dùng hoặc vai trò; hay chỉ gán trực tiếp từng người dùng? | **Nhóm + người dùng + vai trò** (đỡ phải gán lại khi có người mới) |
| D18 | Nơi lưu người dùng, nhóm và **quy tắc quyền**: trên thiết bị (đề xuất), hay trong project? | **Trên thiết bị** (admin sửa trực tiếp trên web, không nạp lại project; không để tài khoản trong project) |
| D19 | Quyền ở component: hai mức `view` và `operate` (đề xuất), hay thêm mức khác (xác nhận, hiển thị giá trị nhưng ẩn đơn vị…)? | **Hai mức** |
| D20 | Component không có quyền xem: ẩn hẳn (đề xuất), hay hiện mờ? Không có quyền thao tác: hiện khóa | **Ẩn khi thiếu `view`; khóa khi thiếu `operate`** |
| D21 | Alarm có phân theo nhóm (người ca A chỉ thấy alarm khu A) không? | **Chưa ở bản đầu**; alarm hiển thị theo trang được xem; làm sau nếu cần |
| D22 | Nơi admin quản lý người dùng và quyền: **trang Quản trị trên web** (yêu cầu của người dùng), thêm Studio và dòng lệnh làm đường phụ? | **Trang Quản trị trên web làm chính** (GĐ 8.4); dòng lệnh giữ; Studio làm sau (8.6) |
| D23 | Khi đổi quyền của người đang đăng nhập: hiệu lực ở lần đăng nhập sau, hay buộc đăng nhập lại ngay? | **Buộc đăng nhập lại ngay** với người bị đổi quyền |
| D24 | Tách spec: bố cục lưới là `012`, giao diện nằm trong `012`, phân quyền là `013` riêng | **Tách `013`** (phạm vi an ninh lớn, cần kiểm thử riêng) |
| D25 | Có trang "Đổi mật khẩu của tôi" cho mọi người dùng (hiện chỉ quản trị đặt lại)? | **Có** |
| D26 | Phân quyền component: admin chọn trên **xem trước màn hình** ngay trong trang Quản trị (đề xuất), hay chỉ chọn trong danh sách tài nguyên? | **Xem trước màn hình + danh sách** |

Người dùng chấp nhận toàn bộ cột Đề xuất ngày 2026-10-19 và yêu cầu triển khai. Thứ tự: spec `012` (bố cục lưới, kèm giao diện GĐ 7), rồi spec `013` (đăng nhập và phân quyền).
