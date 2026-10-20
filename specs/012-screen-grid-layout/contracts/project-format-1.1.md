# Hợp đồng: định dạng project 1.1.0 (bố cục lưới, chủ đề)

Mở rộng [project-format-1.0.md](../../011-pilot-hardening/contracts/project-format-1.0.md). Mọi điều của 1.0 giữ nguyên trừ phần dưới.

## 1. Phiên bản

**Bộ schema:** theo quy ước của [schemas/README.md](../../../schemas/README.md) ("dòng 1.x chỉ thêm ở thư mục gốc, MINOR"), định dạng 1.1 dùng **cùng bộ schema ở thư mục gốc `schemas/`** với 1.0 (chỉ thêm trường tùy chọn: `layout` của màn hình, `theme` của project; `x`, `y`, `width`, `height` của item thành tùy chọn ở schema). `schemas/1.0/` (bản đóng băng 1.0.0) không đổi. Bộ kiểm C++ chọn cùng bộ (set 10) cho `1.0.x` và `1.1.x`. Khác biệt giữa 1.0 và 1.1 do **luật** kiểm (§3): `E_LAYOUT_VERSION`.


- Mọi tệp của project 1.1 có `schemaVersion` `1.1.x`; `minRuntimeVersion` ≥ `1.1.0`.
- Bộ kiểm hiểu 0.1 đến 1.1; `1.2` trở lên: từ chối (`UNSUPPORTED_VERSION` ở Studio, "định dạng mới hơn").
- Nâng cấp: `migrateTo11(files)` từ 0.1 … 1.0 trong một lần (một thư mục sao lưu), bước cuối 1.0 → 1.1 chỉ đổi `schemaVersion` và `minRuntimeVersion` (`bumpFormat`). Đã là 1.1: `ALREADY_11`.
- Studio: project có màn hình `layout` phải là 1.1; thêm màn hình lưới vào project < 1.1 yêu cầu nâng cấp trước (hộp thoại Nâng cấp).

## 2. `layout` của màn hình

Schema: [data-model.md](../data-model.md). Ví dụ:

```json
{
  "schemaVersion": "1.1.0",
  "id": "tong-quan",
  "name": "Tổng quan",
  "size": { "width": 1920, "height": 1080 },
  "layout": {
    "mode": "grid", "columns": 12, "gap": 12, "padding": 16,
    "rows": [
      { "id": "r1", "height": "auto", "cells": [
        { "id": "c1", "span": 4, "item": "nhiet_do" },
        { "id": "c2", "span": 4, "item": "ap_suat" },
        { "id": "c3", "span": 4 } ] }
    ]
  },
  "items": [
    { "id": "nhiet_do", "type": "widget", "widget": "card", "tags": { "value": "TANK01.TEMP" } },
    { "id": "ap_suat", "type": "widget", "widget": "gauge", "tags": { "value": "PUMP01.P" } }
  ]
}
```

Tệp được ghi theo thứ tự khóa ổn định (`format-03.ts`): `schemaVersion, id, name, kind, size, fitMode, background, layout, params, items`; trong `layout`: `mode, columns, gap, padding, rows`; trường bằng mặc định (`offset: 0`, `align: "stretch"`) không ghi.

## 3. Luật (TypeScript `rules-11.ts` và C++ `rules_11.cpp` phải giống hệt)

Đường dẫn lỗi tính từ gốc tệp màn hình.

| Mã | Mức | Điều kiện | Đường dẫn |
|---|---|---|---|
| `E_LAYOUT_COLUMNS` | lỗi | `columns` ≠ 12 hoặc `mode` ≠ `grid` | `/layout/columns`, `/layout/mode` |
| `E_LAYOUT_SPAN` | lỗi | `span` ngoài 1..12, `offset` ngoài 0..11, hoặc tổng `offset + span` của hàng > 12 | `/layout/rows/<r>/cells/<c>/span` (tổng: ô đầu tiên làm vượt) |
| `E_LAYOUT_ID` | lỗi | `id` hàng/ô sai mẫu hoặc trùng trong màn hình | `/layout/rows/<r>/id`, `/layout/rows/<r>/cells/<c>/id` |
| `E_LAYOUT_ITEM_REF` | lỗi | `item` không có trong `items[]` | `/layout/rows/<r>/cells/<c>/item` |
| `E_LAYOUT_ITEM_DUP` | lỗi | một item ở nhiều ô (báo ở ô thứ hai trở đi) | `/layout/rows/<r>/cells/<c>/item` |
| `E_LAYOUT_ITEM_POS` | lỗi | item của màn hình có `layout` mang `x`, `y`, `width` hoặc `height` | `/items/<i>/x` (trường đầu tiên có) |
| `E_LAYOUT_LIMIT` | lỗi | > 100 hàng, 0 hoặc > 12 ô một hàng | `/layout/rows`, `/layout/rows/<r>/cells` |
| `W_LAYOUT_ITEM_ORPHAN` | cảnh báo | item không ô nào trỏ tới | `/items/<i>` |
| `E_LAYOUT_VERSION` | lỗi | `layout` (màn hình) hoặc `theme` (project) trong project có `schemaVersion` < 1.1; hoặc project 1.1 có `minRuntimeVersion` < 1.1.0 | `/layout`, `/theme`, `/minRuntimeVersion` |

Màn hình không có `layout`: item thiếu một trong `x`, `y`, `width`, `height` là `E_LAYOUT_ITEM_POS` (đường dẫn `/items/<i>/<trường thiếu đầu tiên>`), vì schema 1.x đã nới các trường này thành tùy chọn.

## 4. `theme` của project

`project.json` `theme`: `vivid` | `industrial` | `dark`; thiếu = `industrial`. Giá trị lạ: lỗi schema. Runtime gửi giá trị này trong `projects/active` (trường đã có của `project`), trang vận hành đặt `data-mat-theme`.

## 5. Vector

`tests/project-vectors/v11-*` (≥ 40 ca): hợp lệ (lưới đủ loại, popup lưới, ô trống, offset, tự do và lưới lẫn nhau, theme), mỗi mã ở §3 ít nhất 2 ca, nâng cấp 1.0 → 1.1, 1.2 bị từ chối. Bộ chạy: `packages/project-schema/src/vectors-11.test.ts`, `core/project-manager/tests/vectors_11_test.cpp`.
