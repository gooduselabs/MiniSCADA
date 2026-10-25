# Feature Specification: Recipe (công thức) và logo trên báo cáo

**Branch**: `024-recipes` | **Ngày**: 2026-10-25 | **Trạng thái**: duyệt (người dùng giao toàn quyền quyết định)

## Bối cảnh

Nhà máy chạy nhiều mẻ/sản phẩm với bộ thông số khác nhau (nhiệt độ, thời gian, tốc độ...). Hiện người vận hành phải ghi từng Tag bằng tay. Feature này thêm **recipe**: một **loại recipe** là danh sách Tag tham số có giới hạn; mỗi **bản recipe** là một bộ giá trị cho các tham số đó. Người vận hành tải cả bản xuống PLC bằng một thao tác có xác nhận, đọc bộ giá trị hiện tại thành bản mới, sửa/sao chép/xóa bản do mình tạo. Kèm việc mở T090 của 015: logo đơn vị trên báo cáo.

## User stories

### US1 — Kỹ sư định nghĩa recipe trong Studio (P1)

Kỹ sư mở editor Recipe (cây project → Recipe), tạo loại, kéo Tag từ cây Tag vào làm tham số (nhãn, đơn vị, min, max, số lẻ, mô tả), nhập nhiều bản như bảng tính (mỗi bản một cột), nhập/xuất CSV. Lỗi (Tag không có, Tag chỉ đọc, giá trị ngoài giới hạn, sai kiểu) hiện ngay ở ô và ở bảng Lỗi.

**Chấp nhận:** (1) kéo Tag RW vào bảng thêm một tham số và mọi bản có giá trị mặc định trong giới hạn; (2) Tag chỉ đọc bị từ chối với thông báo; (3) ô ngoài giới hạn tô đỏ và có `E_RECIPE_LIMIT`; (4) xuất CSV rồi nhập lại cho cùng dữ liệu; (5) axe không có vi phạm nghiêm trọng.

### US2 — Người vận hành tải recipe xuống PLC (P1)

Trên trang Recipe của runtime, người vận hành chọn loại, chọn bản, thấy bảng so sánh giá trị recipe với giá trị hiện tại trên PLC (khác biệt được tô), bấm **Tải xuống**, hộp xác nhận liệt kê các thay đổi, xác nhận → runtime ghi lần lượt từng Tag qua write coordinator, dừng ở ghi lỗi đầu tiên, trả kết quả từng tham số.

**Chấp nhận:** (1) giá trị ngoài giới hạn bị từ chối trước khi ghi bất kỳ Tag nào; (2) lỗi ở tham số k: tham số 1..k-1 đã ghi, k lỗi, phần sau "bỏ qua"; (3) audit có `recipe.download` (started rồi ok/failed với tóm tắt) và một dòng `tag.write` cho từng ghi; (4) người có vai trò thấp hơn `security.operate` của loại bị 403.

### US3 — Đọc từ PLC, sửa, sao chép, xóa bản trên thiết bị (P2)

**Đọc từ PLC** lưu giá trị hiện tại (chất lượng GOOD) thành bản mới; **Sửa** (bản thiết bị), **Sao chép** (mọi bản), **Xóa** (bản thiết bị). Bản tạo trên thiết bị lưu ở dữ liệu thiết bị (`<dataDir>/recipes/<projectId>.json`), không sửa project; mỗi thay đổi kiểm `rev`, có audit.

**Chấp nhận:** (1) hai người sửa cùng lúc: người sau nhận 409 `CONFLICT`; (2) Tag không GOOD khi đọc: 409 `RECIPE_BAD_QUALITY` liệt kê Tag; (3) bản của project không sửa/xóa được (chỉ sao chép).

### US4 — Logo đơn vị trên báo cáo (P2, T090 của 015)

`reports.json` 1.1 thêm `logo` (tệp `graphics/*.svg` hoặc `graphics/*.png` của project, ≤ 256 KiB). Logo hiện trên dải tiêu đề trang báo cáo web, PDF và XLSX. SVG qua cùng luật an toàn với widget `image` (014).

**Chấp nhận:** (1) tệp không có / quá lớn / ở project 1.0: `E_RPT_LOGO` ở TS và C++ cùng vector; (2) SVG có script: `E_SVG_UNSAFE`; (3) PDF và XLSX xuất có ảnh logo.

## Yêu cầu chức năng

- **FR-001** `project.json` 1.1 thêm `recipesFile`; `recipes.json` theo `schemas/recipes.schema.json`. Ở project 1.0: `E_RECIPE_VERSION`.
- **FR-002** Luật hai bản (TS `rules-recipes.ts`, C++ `rules_recipes.cpp`) cùng vector `tests/project-vectors/v11-recipe-*`: id trùng (`E_RECIPE_DUP_ID`), Tag không có (`E_RECIPE_TAG`), Tag không ghi được (`E_RECIPE_TAG_RW`), min > max hoặc giá trị ngoài giới hạn (`E_RECIPE_LIMIT`), giá trị sai kiểu/thiếu/thừa (`E_RECIPE_VALUE`).
- **FR-003** API thiết bị (HTTPS, cookie trang được phép, CSRF, vai trò, audit, `rev`): xem plan.md mục Hợp đồng.
- **FR-004** Tải xuống: một lượt một lúc trên thiết bị (`RECIPE_BUSY`), kiểm giới hạn và kiểu cả bản trước khi ghi, ghi tuần tự qua write coordinator (`writeMinRole` của Tag vẫn áp), chờ kết quả từng ghi tối đa 15 s, dừng ở lỗi đầu tiên.
- **FR-005** Quyền: `security.view` (mặc định viewer), `security.operate` (tải xuống; mặc định operator), `security.edit` (đọc từ PLC, sửa, sao chép, xóa bản thiết bị; mặc định operator), so với vai trò của phiên (013).
- **FR-006** Trang vận hành `#/recipes` (mục menu tự có khi project có recipe mà người đó xem được).
- **FR-007** Logo: `reports.json` `logo`, luật `E_RPT_LOGO`, ảnh trên web/PDF/XLSX.

## Ngoài phạm vi

Quy tắc tài nguyên `recipe:<id>` trong `access.json` (013) — dùng vai trò ở `security`; tải recipe từ logic; lịch sử phiên bản của bản recipe; widget recipe nhúng trong màn hình (trang riêng thay thế).
