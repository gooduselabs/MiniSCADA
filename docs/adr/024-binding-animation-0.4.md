# ADR-024: Binding 0.4.0 và animation: đích mới, `rangeMap`, hợp biến đổi, hoạt ảnh bằng Web Animations

- **Trạng thái:** **Accepted** phần đã đo trên x64 (feature 008, 2026-10-16): hợp biến đổi, `clipLevel`, hoạt ảnh (SC-008, SC-014), tương thích 0.1 đến 0.3 (SC-011). **Vẫn Proposed** phần chờ: Chrome 120 và máy yếu (ngưỡng `W_ANIM_MANY` 64, D34), BL335 (T123, T124). Tổng hợp: [008-acceptance.md](../reports/008-acceptance.md).
- **Ngày:** 2026-10-16 (đề xuất 2026-10-13)
- **Liên quan:** [specs/008-svg-import-binding](../../specs/008-svg-import-binding/plan.md), research R1, R8–R12; contracts [project-format-0.4.md](../../specs/008-svg-import-binding/contracts/project-format-0.4.md), [binding-animation.md](../../specs/008-svg-import-binding/contracts/binding-animation.md); [ADR-004](004-schema-versioning.md), [ADR-007](007-screen-isolation.md), [ADR-013](013-screen-model-v1.md), [ADR-015](015-expression-language.md) (khoảng của bảng giá trị); lộ trình v2 §4.4; Constitution II, V, VII.

## Bối cảnh

`DomApplier` (0.2) áp binding theo `elementUid` lên chữ, màu, độ mờ, ẩn/hiện, mức chất lỏng của `rect` và quay. Roadmap §4.4 thêm: màu theo khoảng, mức chất lỏng cho hình bất kỳ qua `clipPath`, quay (có tâm), quay liên tục, di chuyển, co giãn, nhấp nháy, dòng chảy trong ống.

Hiện trạng cần xử lý:

- schema binding 0.3 đã chừa tên đích (`transform.translateX/Y`, `transform.scale`) nhưng validator trả `E_TARGET_UNSUPPORTED`; `rangeMap` nằm ở `unsupportedTransform`;
- `transform.rotate` đặt `style.transform = rotate(<độ>deg)` với `transform-box: fill-box; transform-origin: center`: CSS `transform` **che** thuộc tính `transform` của phần tử, nên phần tử có `transform="translate(…)"` (hay gặp ở Illustrator và CorelDRAW) mất phép dời; tâm quay cố định ở giữa (kim đồng hồ cần quay quanh gốc kim);
- `geometry.levelPercent` chỉ đúng với `rect`;
- runtime 0.6 từ chối đích và phép biến đổi lạ: dùng chúng là thay đổi ngữ nghĩa.

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Phiên bản | mở rộng 0.3; **0.4.0 có migration** | 0.4.0 |
| Màu theo khoảng | chỉ bảng giá trị; **bảng giá trị và `rangeMap` nội tuyến cùng ngữ nghĩa khoảng** | cả hai |
| Hợp biến đổi | thuộc tính CSS `rotate/translate/scale`; phần tử bọc `<g>`; **ma trận tường minh `translate · M0 · quay · co giãn` ghi vào `style.transform`** | ma trận tường minh |
| Quay liên tục | `requestAnimationFrame`; SMIL; **Web Animations trên `transform` (khung hình cùng cấu trúc), `updatePlaybackRate`** | Web Animations |
| Mức cho hình bất kỳ | gradient hai stop; `mask`; `clip-path: inset()`; **`clipPath` sinh lúc chạy, `rect` cắt theo hộp bao** | `clipPath` |
| Nhấp nháy | SMIL; CSS keyframes; `setInterval`; **Web Animations, hai trạng thái bước, chung pha, tôn trọng giảm chuyển động** | Web Animations |
| Dòng chảy | hạt chạy dọc đường (SMIL `animateMotion`); `rAF`; **Web Animations trên `stroke-dashoffset`, `updatePlaybackRate`** | Web Animations |
| Tâm quay | cố định giữa; **`pivot` tương đối `[0, 1]²` trên hộp bao** | `pivot` |

## Quyết định

1. **Định dạng 0.4.0** (MINOR theo ADR-004, có migration chỉ đổi số phiên bản): thêm đích `transform.translateX`, `transform.translateY`, `transform.scale`, `geometry.clipLevel`, `effect.blink`, `effect.flow`; phép biến đổi `rangeMap` (khoảng nửa mở `[from, to)`, cấm chồng như ADR-015, ≤ 64 khoảng); tham số theo đích (`pivot`, `axis`, `reverse`, `period`, `mode`, `minOpacity`, `color`, `dash`, `speed`, `byValueSign`, `prefix`, `unitFromTag`). Bảng đích × phép biến đổi cho phép, mã lỗi `E_BIND_TRANSFORM`, `E_BIND_PARAM`, `E_RANGE`. Một binding mỗi **nhóm đích** trên một phần tử (`E_DUP_BINDING`): chữ, màu nền, màu viền, độ mờ, hiện ẩn, quay (tĩnh và liên tục), di chuyển X, di chuyển Y, co giãn, mức (hai cách), nhấp nháy, dòng chảy. `component.state`, `format`, `expression` giữ chưa hỗ trợ.
2. **Hợp biến đổi:** mỗi phần tử có `M0` (ma trận của thuộc tính `transform` gốc, đọc một lần) và hộp bao cục bộ (đo một lần bằng `getBBox`); một lần ghi `style.transform = translate(tx,ty) matrix(M0) translate(cr) rotate(r) translate(-cr) translate(cs) scale(sx,sy) translate(-cs)` với `transform-origin: 0 0`, `transform-box: view-box`. Di chuyển ở đơn vị nhóm cha; quay, co giãn ở hệ cục bộ. Thuộc tính `transform` gốc **không bị sửa**.
3. **Quay liên tục** là hoạt ảnh Web Animations trên `transform` với hai khung hình cùng cấu trúc (`rotate(0deg)` → `rotate(±360deg)`), 1.000 ms/vòng, đổi tốc độ bằng `updatePlaybackRate`, đổi `tx, ty, sx, sy` bằng `setKeyframes`; kẹp tốc độ hiển thị ≤ 2 vòng/giây (như 0.2). Quay tĩnh và liên tục không cùng tồn tại trên một phần tử.
4. **Thay đổi hành vi so với 0.2 có chủ ý:** phần tử có `transform` gốc nay **giữ** nó khi gắn quay (sửa lỗi im lặng). Phần tử không có `transform` gốc và tâm giữa: hiển thị như 0.2. Có test tương thích riêng; ghi vào báo cáo nghiệm thu.
5. **Mức chất lỏng:** `rect` giữ `geometry.levelPercent`; mọi phần tử gắn được dùng `geometry.clipLevel`: runtime tạo `clipPath` (`userSpaceOnUse`) trong `<defs>` của item, `rect` cắt theo hộp bao, cập nhật `y/height` (hoặc `x/width`); không ghi vào file SVG; phần tử đã có `clip-path` gốc thì cảnh báo (`W_BIND_CLIP_EXISTS`).
6. **Nhấp nháy:** hoạt ảnh hai trạng thái (độ mờ, màu nền hoặc màu viền); `period` 400–5.000 ms (≤ 2,5 lần/giây, dưới giới hạn 3 lần/giây của hướng dẫn trợ năng); chung pha theo đồng hồ trang; `prefers-reduced-motion`: không chuyển động, trạng thái "bật" hiện tĩnh rõ; cảnh báo khi nhấp nháy là tín hiệu duy nhất (`W_BLINK_ONLY`).
7. **Dòng chảy:** `stroke-dashoffset` hoạt ảnh, mẫu nét `dash`, tốc độ 0–300 đơn vị/giây theo giá trị hoặc cố định, chiều thuận/ngược/theo dấu; đổi tốc độ không khởi động lại; `prefers-reduced-motion`: đứng yên.
8. **Hoạt ảnh vô hạn:** một cho mỗi phần tử và loại; tạm dừng khi tab ẩn; hủy khi `dispose`; ≤ 64 mỗi màn hình (cảnh báo `W_ANIM_MANY`), ≤ 256 (lỗi `E_LIMIT`).
9. **`DomApplier` vẫn là nơi duy nhất áp binding SVG** ở Studio (xem trước, Thử giá trị) và Chrome; không gọi `getBBox` mỗi lần cập nhật; gom theo `requestAnimationFrame`; chỉ ghi khi giá trị hiển thị đổi; một lần ghi `transform` mỗi phần tử mỗi lần flush.
10. **`onBadQuality`:** mặc định theo đích (quay liên tục dừng, nhấp nháy tắt, dòng chảy dừng, di chuyển/co giãn/mức giữ); `hold` và `override` giữ nghĩa 0.2.

## Hệ quả

- **Tốt:**
  - Đủ hiệu ứng của roadmap trên một cơ chế thống nhất; thêm hiệu ứng bằng dữ liệu (danh sách động hóa ở Studio, bảng đích ở validator).
  - Phần tử từ Illustrator, CorelDRAW (hay có `transform` gốc) gắn quay, di chuyển đúng.
  - Hoạt ảnh chạy trên compositor khi có thể, tạm dừng khi tab ẩn: tiêu hao CPU máy khách thấp.
  - Ngữ nghĩa khoảng một nơi (bảng giá trị và `rangeMap`), validator hai bản chung vector.
- **Xấu:**
  - Project dùng đích mới không chạy trên runtime 0.6 (cần 0.7): chủ ý, kèm `minRuntimeVersion`.
  - `getBBox` cần layout: không chạy trong jsdom (test dùng `measure` giả; e2e kiểm trên Chrome).
  - Đổi hành vi quay của 0.2 cho phần tử có `transform` gốc (trước đó sai).
  - Hợp biến đổi tường minh phức tạp hơn một `rotate()`; bù bằng bảng ca ma trận.
- **Rủi ro:** (1) nội suy `matrix()` giữa hai khung hình có thể giật ở một số bản Chrome (spike T006; dự phòng: phần tử bọc `<g>` cho phần tử có `spin` và `M0` khác đơn vị); (2) `url(#id)` của `clipPath` trong Shadow DOM phải phân giải trong cây của item (spike T006; dự phòng `clip-path: inset()`); (3) 256 hoạt ảnh vô hạn trên máy yếu (đo SC-008, điều chỉnh giới hạn).

## Số đo / bằng chứng

**Đã đo (spike T006 và các mục dưới); đoạn này giữ cơ sở ban đầu.**

**SC-008 (T109, 2026-10-16, Chrome 155, máy dev 100 Hz, 30 phút thật, `008-anim-x64.json`):** 100 phần tử (34 quay liên tục, 33 nhấp nháy, 33 dòng chảy): 180.016 khung, thời gian luồng chính mỗi khung p50 1,1 ms, **p95 2,2 ms** (giới hạn 8 ms), p99 3,2 ms; JS heap sau GC 1,9 → 1,8 MB (**-0,05 MB**, giới hạn +50 MB); tab ẩn: 0 callback rAF trong 10 s, 100/100 hoạt ảnh `paused`. Không hạ `W_ANIM_MANY`/`E_LIMIT` (64/256). Giới hạn: heap JS thay RSS, khung là proxy luồng chính (không gồm compositor/GPU), chưa đo Chrome 120 trên máy yếu (D34). **SC-014:** quay trên phần tử có `transform` gốc `translate(200 150)`: giữ thuộc tính, tâm hộp bao trôi 0 px, khi dừng `transform` nguyên vẹn (`008-svg-x64.json`); `008-svg-x64.json` 12/12: DOM và kiểu hiển thị giống Studio ở 78/78 phần tử.

Cơ sở ban đầu: `spin` 0.2 chạy trên Chrome với BL335 ([sprint1-acceptance.md](../reports/sprint1-acceptance.md)); fixture `gauge.svg` (xoay lồng nhau), `nested-groups.svg` (`transform` cộng dồn 8 cấp), `clippath.svg`, `use-symbol.svg` của Sprint 0 làm ca hình học. Sẽ ghi: kết quả spike T006, SC-008 (p95 khung với 100 hoạt ảnh, 30 phút), SC-014 (ma trận, hộp cắt).

**Spike T006 (2026-10-13, Chrome 155 headless, trong Shadow DOM; [008-spike-chrome.md](../reports/008-spike-chrome.md)): rủi ro 1 và 2 không xảy ra, giả định R9, R10 đúng, không cần dùng dự phòng.**

- Chuỗi `translate matrix(M0) translate rotate translate scale translate`: 24 ca (6 `M0` gồm dời, quay 90, co giãn, lệch, hợp, đơn vị; 4 bộ tham số, pivot quay khác pivot co giãn): hộp bao sai lệch ≤ 0,000015 px so với `DOMMatrix`; ca tính tay đúng. CSS `transform` che thuộc tính `transform` gốc (xác nhận lỗi 0.2).
- Hoạt ảnh `rotate(0)` → `rotate(360deg)` hai khung cùng cấu trúc với `matrix()` M0 chứa quay, co giãn, lệch: không giật (tua 40 mốc ≤ 0,000007 px; chạy thật 137 khung sai lệch 0 so với `currentTime`); `updatePlaybackRate` giữ `currentTime`; `setKeyframes` giữ `currentTime`, hình đúng với tham số mới, 0,018 ms/lần.
- `clipPath` `userSpaceOnUse` tạo lúc chạy trong `<defs>` của Shadow DOM: `url(#id)` phân giải đúng trong cây của item (không lẫn `clipPath` cùng id ở cây thường), theo `transform` (thuộc tính và CSS kiểu R9), đổi `y`/`height` lúc chạy cập nhật ngay. `clip-path: inset()` cũng đúng.
- **Tương thích với trang trước 008 (T107, 2026-10-16, x64, `008-compat-x64.json`):** tank-demo, modbus-demo, dashboard-demo cùng tập phần tử đích và cùng giá trị binding; ảnh chụp lệch 0,0001 %, 0 %, 0,293 % (ngưỡng 0,5 %). Một khác biệt có chủ ý nhưng khác với mục 4: `el_motor_fan` (không có `transform` gốc, `spin`) ghi `style.transform` thành `translate(tâm) rotate() translate(-tâm)` thay vì `rotate()` với `transform-box: fill-box`; cùng tâm (lệch ≤ 0,5 px), cùng hoạt ảnh, ảnh lệch 0,0001 %. Đây là biểu diễn khác của cùng một phép quay (mục 4: "không có `transform` gốc và tâm giữa: hiển thị như 0.2"), không phải đổi hành vi; ngoại lệ đổi hành vi thật chỉ là phần tử có `transform` gốc (T067, test riêng).
- Còn chờ ghi: SC-008 (p95 khung, 100 hoạt ảnh, 30 phút), SC-014 (ma trận, hộp cắt).

## Điều kiện xem xét lại

- Spike cho thấy Chrome nội suy `matrix()` sai hoặc `clipPath` trong Shadow DOM không phân giải: dùng phương án dự phòng ghi ở trên và sửa ADR.
- Cần biểu thức trong binding (nhiều Tag cho một thuộc tính): GĐ 6 (thêm `expression` và đích `component.state` của faceplate).
- Cần hoạt ảnh theo đường cong hoặc morph: ngoài phạm vi.
- Hoạt ảnh vô hạn làm máy văn phòng quá tải: hạ giới hạn 64/256 theo số đo.
