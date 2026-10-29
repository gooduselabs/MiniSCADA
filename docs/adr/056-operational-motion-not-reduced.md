# ADR-056: Hoạt ảnh trạng thái vận hành không theo prefers-reduced-motion; điều khiển bằng thiết lập project

- **Trạng thái:** Accepted (2026-10-29, quyết định của người dùng).
- **Ngày:** 2026-10-29
- **Liên quan:** sửa điểm 6, 7 của [ADR-024](024-binding-animation-0.4.md) (nhấp nháy, dòng chảy khi `prefers-reduced-motion`) cho trang vận hành; [contract binding-animation](../../specs/008-svg-import-binding/contracts/binding-animation.md) §reduced; [contract ui-alarm](../../specs/009-alarms/contracts/ui-alarm.md) §8; feature 037 (thiết lập "Chuyển động của widget", `setMotion`, thuộc tính `still`).

## Bối cảnh

Windows báo `prefers-reduced-motion: reduce` không chỉ khi người dùng chủ động bật trợ năng mà cả khi tắt "Hiệu ứng hoạt ảnh", chạy qua RDP hay chế độ hiệu năng — rất thường gặp trên máy vận hành nhà máy. Trước đây trang vận hành tôn trọng tùy chọn này: quạt/bơm đứng yên khi đang chạy, nhấp nháy báo động thành viền tĩnh, dòng chảy đứng yên. Người vận hành mất thông tin trạng thái mà không biết vì sao. Feature 037 đã có công tắc tường minh trong project: "Chuyển động của widget: Bật/Tắt".

## Quyết định

1. **Thông tin vận hành luôn chạy khi project bật chuyển động, bất kể `prefers-reduced-motion`:** binding `spin`/`blink`/`flow` của SVG (DomApplier), rotor widget `equipment`, sóng mức `level`, nhấp nháy báo động (`.blink` chung của widget: stack-light, multi-state, pill lỗi…), nhấp nháy hàng `alarm-list`/nút `alarm-count` (BlinkClock), nhịp badge khẩn cấp của chuông.
2. **Điều khiển duy nhất:** thiết lập project `motion` (`setMotion(document, on)`: `data-mat-motion` trên `<html>` + sự kiện `mat-motion`) cộng các điều kiện sẵn có của feature 037 (ngoài vùng nhìn, chế độ thiết kế → thuộc tính `still`; tab ẩn). Tắt thì hiện trạng thái tĩnh rõ (viền đỏ/đậm, nhấp nháy ở pha "bật").
3. **Cách nối:** `mat-screen.forceMotion = true` ở trang vận hành (Studio đã bật) → DomApplier nhận `reducedMotion = () => !motionOn(doc)` và `SvgItemView` gọi `applier.refreshMotion()` khi có sự kiện `mat-motion`. `BlinkClock` mặc định `reducedMotion = () => !motionOn(doc)`, có `still` để CSS vẽ viền tĩnh (`data-blink-still`).
4. **Hiệu ứng trang trí vẫn theo `prefers-reduced-motion`:** chuyển tiếp chiều cao mức (`level .fill`), nháy số card khi đổi giá trị (`flash`), hoạt ảnh biểu đồ echarts, rung chuông một lần, toast trượt vào, chuyển cảnh menu.

## Phương án đã cân nhắc

- **Giữ tôn trọng `prefers-reduced-motion`:** đúng hướng dẫn trợ năng chung nhưng làm mất thông tin vận hành trên phần lớn máy RDP; người dùng không muốn.
- **Thêm tùy chọn "theo hệ điều hành" vào thiết lập motion:** thêm một trạng thái khó giải thích; có thể bổ sung sau nếu cần.

## Hệ quả

- Người cần giảm chuyển động vì lý do sức khỏe dùng thiết lập project (Tắt). Nhấp nháy vẫn ≤ 1–2,5 Hz (WCAG 2.3.1).
- E2E `anim`, `alarm-live` giả lập `reduce` và kiểm hoạt ảnh vẫn chạy khi motion Bật, không chạy khi Tắt.
- Lộ ra một vấn đề sẵn có: `motion-perf.e2e` trước đây đạt vì máy dev báo `reduce` nên rotor không quay; khi rotor quay thật, Chromium tính lại style mỗi khung (≈ 700 lần/5 s, fps vẫn ≥ 130 với CPU chậm 4×). Cần điều tra riêng (bố cục `.sq` aspect-ratio của equipment).
