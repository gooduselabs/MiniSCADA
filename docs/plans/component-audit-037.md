# Kiểm kê component Toolbox (feature 037)

Ngày: 2026-10-28. Nhánh `037-components`. Danh mục widget `0.7.0` → `0.8.0` (`schemas/widgets.catalog.json`).

Yêu cầu người dùng: gọn gàng, không chia đôi component chỉ vì kiểu dáng (ví dụ "Thẻ giá trị" và "Thẻ chỉ số màu"); kiểu dáng là thuộc tính (màu, ẩn/hiện, trạng thái); có màu rõ, biểu tượng, chuyển động nhẹ khi phù hợp; thêm component bổ ích cho SCADA; cấu hình ít phiền.

Ràng buộc: project cũ phải mở và chạy đúng (validator TS/C++ và runtime vẫn nhận loại cũ); ngân sách BL335 (ARM yếu): chuyển động chỉ bằng CSS (`transform`, `opacity`, `steps`), không vòng lặp JS theo khung hình, chỉ chạy ở chế độ vận hành, tắt khi `prefers-reduced-motion`; gói khởi động ≤ 244,1 KB gzip.

## 1. Hiện trạng → quyết định

| Nhóm | Component (id) | Hiện trạng | Quyết định | Lý do |
|---|---|---|---|---|
| Hiển thị | Thẻ giá trị (`card`) | Thẻ trắng, nhãn xám, số đen; màu chỉ khi đặt tay | **Giữ, mở rộng** thành thẻ hợp nhất | Thêm `fill` (nền nhạt / đặc màu / viền / trơn), `accent` (10 màu) + `accentColor`, `icon` (21 hình), `showUnit`, `statusText`, ngưỡng `warnAbove/Below`, `alarmAbove/Below`, khe `alarm`, `flash` (nháy nhẹ khi đổi). Mặc định nền nhạt xanh dương, không còn xám nhạt |
| Hiển thị | Thẻ chỉ số màu (`stat-tile`) | Bản sao của card với nền đặc + biểu tượng | **Gộp vào `card`** (`fill: solid`) | Trùng chức năng; khác nhau chỉ ở kiểu dáng. Còn trong danh mục với `deprecated: true, replacedBy: card` để validator và runtime vẫn nhận; Toolbox ẩn; Studio tự đổi khi mở |
| Hiển thị | KPI (`kpi`) | Số so với mục tiêu, chênh lệch % | **Giữ**, đổi tên "KPI so với mục tiêu" | Chức năng riêng (mục tiêu, càng cao càng tốt), không trùng thẻ |
| Hiển thị | Thanh tiến độ (`progress`) | Thanh/vòng % | **Giữ** | Thanh ngang/dọc có vùng màu đã có ở `level`; `progress` gọn cho %, vòng tròn |
| Hiển thị | Mức chất lỏng (`level`) | Thanh dọc/ngang, vùng màu | **Giữ, mở rộng**: `style: tank` (bồn bo tròn, vạch chia), `color`, `wave` | Đáp ứng "Bồn/silo" và "bar gauge có ngưỡng" mà không thêm loại mới |
| Hiển thị | Nhãn (`label`) / Ghi chú (`text`) | Nhãn một dòng (có thể gắn Tag) / khối chữ nhiều dòng có tiêu đề | **Giữ cả hai**, ghi rõ công dụng trong mô tả Toolbox | Khác vai trò (dòng có giá trị Tag và khối ghi chú tĩnh); gộp làm bảng thuộc tính rối hơn |
| Hiển thị | Đèn báo (`lamp`) / Danh sách trạng thái (`status-list`) | Một đèn / tối đa 16 đèn có tiêu đề | **Giữ cả hai**; đèn thêm `glow` (quầng sáng tĩnh), màu sáng mặc định xanh lá rõ, nổi khối | Khác số lượng Tag và bố cục |
| Hiển thị | Đồng hồ kim (`gauge`), Đồng hồ ngày giờ (`clock`), Ảnh (`image`) | | **Giữ** | Không trùng |
| Hiển thị | Khung nhóm (`panel`) | Khung xám/card có tiêu đề | **Giữ, mở rộng** `accent` | Đáp ứng "Khung nhóm có tiêu đề màu" |
| Biểu đồ | Đường, cột, tròn | | **Giữ** | |
| Bảng | Bảng Tag sống | | **Giữ** | |
| Điều khiển | Nút bấm (`button`) / Công tắc (`switch`) | Nút: ghi, đảo, xung, chuyển màn hình, popup; công tắc: trạng thái thật + đảo | **Giữ cả hai** | Hành vi khác nhau (lệnh một lần và trạng thái hai chiều). "Liên kết điều hướng / nút mở màn hình" đã là `button` + Chuyển màn hình; "nút nhấn xung" đã là `pulse` |
| Điều khiển | Đặt giá trị (`setpoint`), Thanh trượt, Chọn, Hẹn giờ Từ–Đến | Đã có min/max theo Tag, xác nhận | **Giữ** | "Setpoint input có min/max, xác nhận" đã có |
| Alarm | Danh sách alarm, Đếm alarm | | **Giữ** | "Bảng alarm mini" = Danh sách alarm cỡ nhỏ |
| Lịch sử | 4 widget lịch sử | | **Giữ** | |
| **Mới** | Thiết bị (`equipment`) | — | **Thêm** (nhóm Điều khiển) | Motor/Bơm/Quạt/Van: màu theo Chạy/Dừng/Lỗi, quay khi chạy, nút Chạy/Dừng tùy chọn qua cùng luồng xác nhận/khóa quyền của ControlWidget |
| **Mới** | Đèn tháp (`stack-light`) | — | **Thêm** | Báo trạng thái máy kiểu nhà xưởng; đỏ nhấp nháy khi sáng |
| **Mới** | Nhãn đa trạng thái (`multi-state`) | — | **Thêm** | Bảng giá trị → chữ, màu, nhấp nháy ngay trong widget (không phải tạo Bảng giá trị riêng); bảng trống thì dùng Bảng giá trị của Tag |

Chưa làm (đã cân nhắc, để sau): **Bộ đếm giờ chạy** (cần tích lũy bền trên thiết bị: thuộc logic/Tag tính toán, không phải widget hiển thị; hiển thị bằng Thẻ giá trị); **nút nhấn giữ (hold-to-run)** (ghi khi nhấn và nhả cần cơ chế an toàn mất kết nối riêng ở runtime; hiện dùng "Ghi xung").

## 2. Tương thích ngược

- Danh mục chỉ **thêm**: thuộc tính mới đều tùy chọn, có `default`; loại mới không ảnh hưởng project cũ. Validator C++ đọc danh mục khi chạy nên nhận loại mới khi danh mục mới được triển khai cùng runtime.
- `stat-tile` giữ nguyên trong danh mục và trong `WIDGET_ELEMENTS` của runtime: project cũ hợp lệ và vẽ như trước.
- Studio: `upgradeLegacyWidgets` (`packages/project-schema/src/widget-aliases.ts`) đổi `stat-tile` → `card` (`fill: solid`, `fontSize: l`, `statusText: true`, `accent` = `color` cũ, giữ `icon`, `sparkline`, `trend`, ngưỡng nhấp nháy và khe Tag). Gọi khi mở project định dạng 1.1 (và sau Nâng cấp) cho tài liệu màn hình sửa được; màn hình thành "chưa lưu", đĩa không đổi cho tới khi Lưu.
- `card` cũ không có `fill` nay vẽ nền nhạt xanh dương (đúng yêu cầu "có màu"); `fill: plain` trả lại giao diện cũ.
- Mẫu hàng "4 thẻ chỉ số" nay tạo `card` nền đặc.

## 3. Tiện dụng khi cấu hình

- Toolbox: ô **Tìm component…** (không dấu vẫn khớp, tìm cả trong mô tả), mô tả ngắn ở tooltip, ẩn loại đã gộp.
- Giá trị khởi đầu khi thả (`apps/studio/src/model/widget-presets.ts`): nhãn, bồn kiểu tank, bảng Dừng/Chạy/Lỗi, khung có màu nhấn…
- Inspector tab Hiển thị chia nhóm **Dữ liệu / Hiển thị / Màu & biểu tượng / Ngưỡng & cảnh báo / Hành động** (`model/prop-sections.ts`); trình sửa bảng trạng thái (Giá trị, Chữ, Màu, Nhấp nháy).
- Gắn Tag bằng kéo Tag thả lên component: đã có (canvas tự do và ô lưới, `firstFreeSlot`).

## 4. Hiệu năng

Chuyển động: nháy số 600 ms một lần khi giá trị đổi (`animation` nền, hai tên luân phiên); sóng mặt chất lỏng là một dải 6 px dịch `transform` 2,4 s; quay rotor `transform: rotate` 1,4 s; nhấp nháy dùng `mat-blink` có sẵn (`steps`). Tất cả chỉ ở chế độ chạy, tắt khi giảm chuyển động. Gói khởi động runtime-web: 187,4 KB → 193,4 KB gzip (ngân sách 244,1 KB).
