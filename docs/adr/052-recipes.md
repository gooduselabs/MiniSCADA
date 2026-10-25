# ADR-052: Recipe (công thức) tải xuống PLC qua write coordinator; logo đơn vị trên báo cáo

- **Trạng thái:** Proposed (2026-10-25). Có mã và test (vector TS/C++, gtest service + API, Vitest, e2e); chưa thử trên BL335 và PLC thật.
- **Ngày:** 2026-10-25
- **Liên quan:** spec [024](../../specs/024-recipes/spec.md), write coordinator (feature 006/007, ADR-017), phân quyền 013, báo cáo 015 (T090).

## Bối cảnh

Người vận hành cần nạp một bộ thông số (mẻ, sản phẩm) xuống PLC bằng một thao tác, đọc bộ đang chạy thành bản mới, và giữ các bản tạo trên thiết bị mà không phải sửa project. Báo cáo cần logo của đơn vị.

## Quyết định

1. **Định dạng:** tệp `recipes.json` khai bởi `recipesFile` của `project.json`, chỉ ở định dạng 1.1 (`E_RECIPE_VERSION`). Loại = Tag tham số + giới hạn (min/max, đơn vị, số lẻ); bản = giá trị từng tham số. Luật `E_RECIPE_*` hai bản TS/C++ trên vector chung `v11-recipe-*`.
2. **Ghi qua write coordinator, tuần tự, dừng ở lỗi đầu tiên.** Mọi bảo vệ của ghi tay giữ nguyên (audit trước khi gửi, `writeMinRole`, giới hạn Tag, trạng thái liên kết, giới hạn tốc độ). Giới hạn tốc độ (20 ghi/phút) không nới: ghi bị `RATE_LIMITED` được gửi lại sau `retryAfterMs` với request id mới; recipe lớn chạy lâu hơn nhưng không vượt trần của Hiến pháp. Không ghi đồng thời nhiều Tag vì PLC không có giao dịch; thứ tự ghi là thứ tự tham số do kỹ sư đặt.
3. **Kiểm toàn bộ trước khi ghi** (kiểu, giới hạn tham số và Tag): sai một giá trị thì không ghi Tag nào.
4. **Job nền:** `POST /api/v1/recipes/download` trả 202 `{jobId}`, trang hỏi `GET jobs/{id}`; một lượt một lúc (`RECIPE_BUSY`).
5. **Audit:** `recipe.download` `started` (trước ghi đầu; không ghi được → 503, không ghi Tag nào) và `ok`/`failed`; mỗi ghi là một `tag.write` với `context.screen = recipe-<loại>`; `recipe.save/delete/capture` trước khi đổi tệp.
6. **Bản thiết bị** ở `<dataDir>/recipes/<projectId>.json` (`rev` cả tệp, ghi nguyên tử, 0600); bản của project chỉ đọc trên thiết bị (Sao chép để sửa). Tệp hỏng được đổi tên `.bad`, kho bắt đầu rỗng.
7. **Quyền theo vai trò** ở `security.view/operate/edit` của loại; cổng API đòi phiên (operator cho thay đổi). Quy tắc tài nguyên `recipe:<id>` trong `access.json` hoãn.
8. **Logo:** `reports.json` `logo` (`graphics/*.svg|png`, ≤ 256 KiB, `E_RPT_LOGO`); web hiện bằng `<img>` (SVG không chạy script), PDF nhúng SVG đã lọc hoặc PNG, XLSX nhúng PNG (trang vẽ SVG sang PNG bằng canvas).

## Hệ quả

- Thêm `core/recipe` (thuần, test không cần HTTP), `server/http/recipes_api.cpp`, 7 dòng trong bảng quyền, 4 hành động audit. device-api thêm tính năng `recipes` (bump phiên bản API gộp khi hợp nhất với các nhánh song song).
- Lượt tải không có rollback: lỗi giữa chừng để PLC ở trạng thái một phần, trang và audit chỉ rõ tham số nào đã ghi.
