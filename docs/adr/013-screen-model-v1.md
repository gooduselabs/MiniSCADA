# ADR-013: Mô hình màn hình v1: item `svg` và item `widget` trên một hệ tọa độ thiết kế

- **Trạng thái:** Proposed (feature 007, GĐ 3a; quyết định "người dùng giao toàn quyền 2026-10-11"). Chưa có số đo; số đo SC-002, SC-003 trên BL335 chờ SSH.
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/007-screens-widgets](../../specs/007-screens-widgets/plan.md), research R1–R6, R10; contract [project-format-0.3.md](../../specs/007-screens-widgets/contracts/project-format-0.3.md); lộ trình v2 §3 ("Mô hình màn hình v1"), §4.3; [ADR-003](003-element-uid.md), [ADR-004](004-schema-versioning.md), [ADR-007](007-screen-isolation.md); Constitution II, V, VII.

## Bối cảnh

Màn hình định dạng 0.1 và 0.2 là **một file SVG** cộng một file binding; trang runtime dựng màn hình đầu của project. GĐ 3a cần màn hình gồm đồ họa SVG **và** widget HTML (card, nút, biểu đồ, ô nhập), nhiều màn hình, menu, popup.

Ràng buộc:

- sanitizer SVG cấm `foreignObject` và mọi nội dung HTML (Constitution V; [svg-dialects.md](../architecture/svg-dialects.md)), nên widget không nằm trong SVG;
- mỗi màn hình SVG nằm trong Shadow DOM riêng (ADR-007);
- Studio và trang runtime dựng cùng một màn hình theo cùng một cách (Constitution II);
- project 0.1 và 0.2 hiện có phải chạy như cũ (ADR-004, Constitution VII);
- tối đa 1.000 Tag mỗi đăng ký live (ADR-006), 10 client.

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Widget nằm đâu | (A) trong SVG bằng `foreignObject`; (B) vẽ widget thành phần tử SVG; **(C) phần tử HTML đặt chồng lên SVG trên cùng hệ tọa độ**; (D) `<iframe>` mỗi item | **C** |
| Bố cục | **(1) tọa độ tuyệt đối trên khung thiết kế, co một phép**; (2) lưới CSS đáp ứng; (3) tọa độ tuyệt đối theo đơn vị `vw` | **1** |
| Cách co | **CSS `transform: scale()` trên khung**; thuộc tính `zoom`; tính lại mọi vị trí bằng JS | `transform` |
| Xếp lớp | `z-index` từng item; **thứ tự mảng `items`** | thứ tự mảng |
| Định dạng | mở rộng 0.2 (thêm `items` tùy chọn cạnh `svgFile`); **0.3.0 với `items` bắt buộc** | 0.3.0 |
| Tải dữ liệu | `projects/active` trả mọi màn hình (như hiện nay); **bản tóm tắt + tải lười từng màn hình qua `/project/`** | tải lười |
| Điều hướng | route theo đường dẫn (`/screen/main`); **hash `#/main`**; truy vấn `?screen=main` | hash |
| Màn hình cũ | chỉ chạy bằng đường riêng; **bộ chuyển trong bộ nhớ về mô hình item** | bộ chuyển |

## Quyết định

1. **Màn hình v1** (`schemas/screen.schema.json`, 0.3.0):
   - `id`, `name`, `kind` (`screen` | `popup`), `size` `{ width, height }` (mặc định 1920 × 1080; 64–4.096 × 64–2.304), `fitMode` (`contain` | `cover` | `stretch` | `fit-width` | `none`), `background`, `items`;
   - **`items` là mảng có thứ tự: đầu mảng ở dưới cùng.** Không có `z-index`. "Đưa lên trên" là đổi vị trí trong mảng (D9 của spec).
2. **Item `svg`:** `id`, `name`, `x`, `y`, `width`, `height`, `svgFile`, `bindingFile`, `viewBox`, `fit`, `elements` (`elementUid`), `locked`, `hidden`. Binding giữ nguyên ngữ nghĩa 0.2. `elementUid` duy nhất **trong một item**. Mỗi item dựng trong Shadow DOM riêng (ADR-007 giữ nguyên, vì vậy hai item không ảnh hưởng class và id của nhau). ≤ 8 item `svg` mỗi màn hình.
3. **Item `widget`:** `id`, `name`, `widget`, `x`, `y`, `width`, `height`, `locked`, `hidden`, `props`, `tags`, `events`, `security`. Danh sách loại, khe, thuộc tính, hành động nằm trong **danh mục** `schemas/widgets.catalog.json` ([ADR-019](019-widget-library.md)); bộ kiểm tra TS và C++ đọc cùng danh mục.
4. **Dựng màn hình:** một khung `div` đúng cỡ `size`, `position: relative`, mỗi item `position: absolute` với `left/top/width/height` theo đơn vị thiết kế; cả khung được co bằng `transform: scale(k)` (`transform-origin: 0 0`) theo `fitMode`:
   - `contain`: `k = min(W/w, H/h)`, căn giữa; `cover`: `k = max(...)`; `fit-width`: `k = W/w`, cuộn dọc; `none`: `k = 1`, cuộn; `stretch`: `scale(W/w, H/h)` (méo, cảnh báo ở validator khi có widget).
   - Chuột và bàn phím vẫn trúng đúng phần tử (trình duyệt tính lại theo `transform`). Chữ và vector vẽ lại ở độ phân giải thật.
   - Vùng chứa (cả phần thừa hai bên khi `contain`) tô `background` của màn hình, như `mountScreen` của 0.2 tô nền cho cả phần tử chứa; nhờ vậy `contain` cho cùng hình với 0.2.
   - Tính `k` bằng `ResizeObserver` gom theo khung hình.
5. **Thành phần dùng chung `<mat-screen>`** trong `packages/ui-components`: nhận mô hình màn hình, `TagSource`, `ActionHost` và hàm tải SVG; dựng các item; gắn `DomApplier` (`@mat/binding-engine`) cho item `svg`. Trang runtime và xem trước Studio đều dùng nó.
6. **Popup** là màn hình `kind: "popup"`: dựng bằng `<mat-screen>` trong lớp phủ riêng ngoài khung chính, co theo cỡ cửa sổ (tối đa 90 % mỗi chiều), nên không bị `transform` của khung mẹ làm lệch `position: fixed`. Một popup tại một thời điểm.
7. **Điều hướng:** `navigation` trong `project.json` (`position`, `items`); đường dẫn `#/<screenId>`; popup không nằm trong URL.
8. **Tải lười:** với project 0.3, `GET /api/v1/projects/active` trả `project`, `tags`, `valueTables` (mọi bảng mà Tag hoặc widget tham chiếu), `screens: [{id,name,kind,file}]`, `navigation`, `connections` (như 006); từng màn hình tải từ `/project/screens/<id>.screen.json`, SVG và binding từ đường dẫn trong item. Project 0.1 và 0.2 giữ nguyên thân trả về của 0.5.
9. **Định dạng 0.3.0:** project 0.3.x cần runtime ≥ 0.6.0; mọi file cùng `schemaVersion`; schema 0.2 đóng băng ở `schemas/0.2/`; runtime 0.6 nhận 0.1, 0.2, 0.3. **Bộ chuyển** `toScreenModel(loadedScreen)` (trong `@mat/project-schema`) biến màn hình 0.1/0.2 thành mô hình v1 trong bộ nhớ (một item `svg` phủ kín), nên trang runtime chỉ có một đường dựng.
10. **Nâng cấp 0.2 → 0.3** ở Studio: trong bộ nhớ, sao lưu trước lần lưu đầu, cùng đầu vào cùng kết quả, cặp file mẫu (contract §8).

## Hệ quả

- **Tốt:**
  - Một đường dựng cho mọi phiên bản màn hình; Studio và Chrome giống nhau (Constitution II).
  - Widget dùng được input, bàn phím, trợ năng của HTML, không đụng sanitizer SVG.
  - Bố cục tuyệt đối đúng với thói quen thiết kế SCADA (TIA, WinCC, Ignition); một phép co dễ kiểm bằng test hình học.
  - Diff rõ: mỗi item một khối, thứ tự mảng là thứ tự lớp.
  - Tải lười giữ thời gian mở trang gần như không phụ thuộc số màn hình (SC-002, SC-003).
- **Xấu:**
  - Phải có bộ chuyển 0.1/0.2 và migration 0.2 → 0.3 (thêm mã, thêm vector).
  - Widget và SVG nằm ở hai lớp DOM: widget không "ở trong" đồ họa (không gắn vào phần tử SVG); gắn widget theo phần tử SVG là việc của GĐ 3b nếu cần.
  - `stretch` làm méo widget; chỉ giữ cho tương thích 0.2.
  - Không có bố cục đáp ứng (điện thoại): GĐ 6 trở đi.
  - Chữ nhỏ khi co nhiều (màn hình 1920 trên cửa sổ 1280): người thiết kế chọn `size` hợp màn hình đích.

## Số đo / bằng chứng

- **Chưa đo.** Ước tính: màn hình chuẩn (20 widget, 1 item SVG, 100 Tag) dựng ≤ 300 ms trên PC; tải ≤ 150 KB JSON và SVG. Số đo thật ở T133 (x64), T150 (BL335; SC-002, SC-003) và `docs/reports/007-acceptance.md`.
- Thí nghiệm cần làm trước khi chốt (task Foundational): ba ảnh chụp Chrome cùng một màn hình ở `contain` với cửa sổ 1366 × 768, 1920 × 1080, 2560 × 1440, so điểm ảnh với bản 0.2 để xác nhận SC-011.

## Điều kiện xem xét lại

- Cần widget gắn vào phần tử SVG (ví dụ nút nằm trên van): GĐ 3b thêm "mỏ neo" `anchor: { item, elementUid }`.
- Cần bố cục đáp ứng cho điện thoại: thêm biến thể `layouts` theo breakpoint (GĐ 6+).
- Dựng 250 item vượt ngân sách SC-013 trên Chrome 120: cân nhắc ảo hóa item ngoài khung nhìn.
- Cần nhiều hơn một popup cùng lúc.
