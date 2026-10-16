# Hướng dẫn người vận hành

Dành cho người vận hành dùng trang mAT SCADA trên Chrome hằng ngày. Tài liệu ngắn, đọc trong 20 phút. Từ ngữ lạ: xem [Thuật ngữ](glossary.md). Mã lỗi: xem [Mã lỗi và cảnh báo](error-codes.md).

Áp dụng cho runtime 0.9 trở lên. Chữ trên màn hình trong tài liệu này lấy đúng từ phần mềm.

## 1. Mở trang

1. Mở Chrome (bản 120 trở lên).
2. Gõ địa chỉ do quản trị viên cung cấp:
   - `https://<địa chỉ thiết bị>:8443/` để **xem và điều khiển**;
   - `http://<địa chỉ thiết bị>:8080/` chỉ để **xem**.
3. Lần đầu Chrome có thể báo chứng chỉ chưa tin cậy. Không tự bấm "tiếp tục". Gọi quản trị viên để cài chứng chỉ cho máy này.

Trang mở ở màn hình đầu. Menu bên trái (hoặc trên) chứa các màn hình. Cửa sổ hẹp thì bấm nút menu ("Mở menu"). Đầu trang hiện "project · màn hình".

## 2. Đăng nhập và đăng xuất

Cần đăng nhập để điều khiển, xem lịch sử, xem báo cáo. Xem giá trị thường không cần đăng nhập (trừ khi quản trị viên bật chế độ bắt buộc đăng nhập; khi đó trang hiện "Cần đăng nhập để xem").

1. Bấm **Đăng nhập** ở thanh trên (chỉ có khi trang mở bằng `https://`).
2. Nhập **Tài khoản** và **Mật khẩu**, bấm **Đăng nhập**.
3. Đúng: thanh trên hiện tên của bạn và vai trò, ví dụ "vanhanh1 (operator)".
4. Xong ca: bấm **Đăng xuất**.

Thông báo khi không đăng nhập được:

| Thông báo | Ý nghĩa | Việc cần làm |
|---|---|---|
| "Sai tài khoản hoặc mật khẩu" | gõ sai | gõ lại, kiểm tra Caps Lock và bộ gõ tiếng Việt |
| "Đăng nhập bị khóa tạm, thử lại sau N phút" | sai 5 lần liên tiếp từ máy này | chờ hết thời gian; khóa chỉ áp cho tài khoản này **trên máy này**, máy khác vẫn đăng nhập được; cần gấp thì gọi quản trị viên mở khóa |
| "Thiết bị đang bận kiểm tra đăng nhập khác, thử lại sau giây lát" | nhiều người đăng nhập cùng lúc | chờ 1 giây rồi bấm lại; không bị khóa |
| "Chỉ đăng nhập được qua HTTPS" | trang mở bằng `http://` | mở lại bằng `https://` |

Phiên tự hết sau một thời gian không thao tác (mặc định 30 phút) hoặc sau tối đa 12 giờ. Khi hết, trang hiện "Phiên đã hết hạn, đăng nhập lại." và nút **Đăng nhập lại**. Trong lúc đó trang vẫn hiện giá trị, chỉ khóa điều khiển.

## 3. Chế độ chỉ xem

Trang ở chế độ chỉ xem khi:

- mở bằng `http://`: dải trên hiện "Chế độ chỉ xem. Mở bằng HTTPS để điều khiển." kèm liên kết **Mở bằng HTTPS**;
- chưa đăng nhập, hoặc tài khoản có vai trò `viewer`;
- cổng HTTPS của thiết bị không chạy: "Chế độ chỉ xem. Cổng HTTPS của thiết bị không chạy, chưa điều khiển được."

Nút điều khiển bị khóa hiện biểu tượng ổ khóa và lý do, ví dụ "Đăng nhập để điều khiển", "Cần quyền operator", "Tag chỉ đọc", "Mất kết nối dữ liệu".

## 4. Đọc giá trị và trạng thái

Mỗi giá trị có một dấu ở góc khi dữ liệu không tốt. Không có dấu là giá trị tốt (GOOD).

| Dấu | Trạng thái | Ý nghĩa | Việc cần làm |
|---|---|---|---|
| "●", viền vàng | UNCERTAIN (không chắc) | có giá trị nhưng chưa chắc đúng, ví dụ bị cắt về giới hạn | dùng thận trọng; báo kỹ sư nếu kéo dài |
| "BAD", viền đỏ, chữ mờ | BAD (lỗi) | không đọc được từ PLC (mất kết nối, thiết bị báo lỗi) | **không** dựa vào giá trị này; kiểm tra tại chỗ |
| "STALE", viền xám đứt | STALE (mất dữ liệu) | giá trị cũ, không còn cập nhật | xem mục 7 (mất kết nối) |
| "?", viền xám chấm | không rõ | Tag lạ với thiết bị; điều khiển bị khóa | báo kỹ sư |

Rê chuột lên dấu để xem lý do, ví dụ "Lỗi: Mất kết nối thiết bị".

## 5. Điều khiển có xác nhận

Cần: trang `https://`, đã đăng nhập, vai trò `operator` trở lên.

1. Bấm nút, công tắc, hoặc nhập giá trị vào ô **Đặt giá trị** rồi Enter (hoặc **Ghi**). Số thập phân dùng **dấu chấm**, ví dụ `42.5`.
2. Hộp **Xác nhận ghi giá trị** hiện: Tag, mô tả, thiết bị, giá trị hiện tại → giá trị mới, đơn vị, giới hạn, tài khoản của bạn.
3. Đọc kỹ. Đúng thì bấm **Xác nhận**. Sai thì bấm **Hủy** hoặc Esc. Nút **Hủy** được chọn sẵn để tránh bấm nhầm.
4. Xem dải kết quả ngay trên nút.

Kết quả lệnh:

| Dải hiện | Trạng thái | Ý nghĩa | Việc cần làm |
|---|---|---|---|
| "⏳ Đang gửi…" | | lệnh đang đi | chờ |
| "⏳ Đã nhận, đang chờ đọc lại" | ACCEPTED | thiết bị đã nhận lệnh, đang chờ PLC xác nhận | chờ vài giây |
| "✔ Đã ghi và xác nhận" | CONFIRMED | PLC đã nhận và giá trị đọc lại khớp | xong (dải tự tắt sau 4 s) |
| "✖ Bị từ chối" | REJECTED | lệnh không được gửi (lý do ghi sau tiêu đề) | đọc lý do; không bấm lại liên tục |
| "⚠ Không chắc đã ghi, kiểm tra giá trị thực trước khi thử lại" | TIMEOUT | PLC không trả lời kịp | kiểm tra giá trị thực (tại chỗ hoặc trên màn hình) rồi mới thử lại |
| "✖ Ghi thất bại" | FAILED | PLC hoặc đường truyền báo lỗi | thử lại một lần; còn lỗi thì báo kỹ sư |
| "⚠ Không rõ kết quả, kiểm tra giá trị thực" | không rõ | runtime dừng giữa chừng | kiểm tra giá trị thực |

Lý do thường gặp sau tiêu đề: "Không đủ quyền", "Ngoài giới hạn cho phép", "Mất kết nối với thiết bị", "Ghi quá nhanh", "Giá trị đã đổi so với lúc nhấn", "Thiết bị không trả lời khi ghi", "Giá trị đọc lại khác giá trị đã ghi". Mã trong ngoặc (ví dụ `(OUT_OF_LIMITS)`) để báo cho kỹ sư.

Nút xung (bấm rồi tự nhả): hộp xác nhận ghi "Xung N ms rồi trả về giá trị ngược". Một xung đang chạy thì không bấm được xung khác cho cùng Tag.

## 6. Alarm

- **Banner** dưới thanh trên hiện alarm quan trọng nhất: mức ưu tiên, nội dung, số alarm chưa xác nhận. Bấm banner để mở trang **Alarm**.
- Bốn mức ưu tiên, mỗi mức một hình: **Khẩn cấp** (tam giác có "!"), **Quan trọng** (hình thoi), **Nhỏ** (hình tròn), **Lưu ý** (hình vuông có "i").
- Trạng thái: "Đang có, chưa xác nhận", "Đang có, đã xác nhận", "Đã hết, chưa xác nhận", "Tạm ẩn".

Xử lý một alarm:

1. Đọc nội dung, xem giá trị lúc bật.
2. Xử lý tại hiện trường theo quy trình của nhà máy.
3. Bấm **Xác nhận** trên dòng alarm (hoặc phím Shift+A). Tên bạn hiện ở cột "Người xác nhận".
4. **Xác nhận tất cả** (Ctrl+Shift+A) chỉ xác nhận các alarm đang hiện lúc bấm.

**Tạm ẩn** (phím S): dùng khi alarm báo sai đã biết (ví dụ cảm biến đang sửa). Bắt buộc ghi lý do (tối đa 120 ký tự), chọn thời gian 15 phút đến 8 giờ. Alarm tạm ẩn vẫn được ghi lịch sử, không hiện ở banner, không kêu, tự hết khi hết hạn. Xem ở tab **Tạm ẩn**; gỡ sớm bằng **Gỡ tạm ẩn**.

**Âm thanh** mặc định tắt. Bấm "Âm thanh: bật/tắt" ở thanh trên để bật trên máy này. **Tắt tiếng** làm im alarm hiện tại mà không xác nhận; alarm mới vẫn kêu.

Lịch sử alarm: menu **Lịch sử alarm**.

## 7. Mất kết nối

Góc trên hiện trạng thái kết nối:

| Hiện | Ý nghĩa |
|---|---|
| "Trực tuyến" (xanh) | bình thường |
| "Đang kết nối…" | đang nối lại |
| "Mất kết nối — dữ liệu đang hiển thị là cũ" (đỏ) | trang không nhận được dữ liệu mới; mọi giá trị chuyển STALE; điều khiển bị khóa |

Trang **tự nối lại**, không cần F5. Kèm theo là "Cập nhật cuối HH:MM:SS".

- "Hệ thống đã đạt số kết nối tối đa. Vui lòng thử lại sau.": đã đủ 10 trang đang mở. Đóng trang thừa ở máy khác hoặc chờ trang tự thử lại.
- "Đang nạp project mới…": kỹ sư vừa nạp project, trang tự tải lại.
- "Không có project hợp lệ trên thiết bị": báo kỹ sư.
- Mất kết nối quá 5 phút: gọi kỹ sư (mục 9).

## 8. Lịch sử và báo cáo

Cần trang `https://` và đăng nhập.

- **Lịch sử**: chọn nhóm lưu trữ, chọn tối đa 16 Tag, chọn khoảng (1 giờ đến 30 ngày, Hôm nay, Hôm qua). Có biểu đồ và bảng; **Xuất CSV** để tải.
- **Báo cáo**: chọn kỳ (Ngày, Ngày làm việc, Tháng), bấm **Xem**, rồi tải **CSV**, **CSV Excel**, **XLSX** hoặc **PDF**.

## 9. Khi có sự cố: làm gì, gọi ai

Ghi lại: giờ, màn hình, thông báo (chụp màn hình nếu được), mã trong ngoặc.

| Tình huống | Làm ngay | Gọi |
|---|---|---|
| Giá trị BAD hoặc STALE ở nhiều chỗ | kiểm tra tại chỗ; không điều khiển dựa vào giá trị đó | kỹ sư hệ thống |
| Lệnh TIMEOUT hoặc không rõ kết quả | kiểm tra giá trị thực trước khi thử lại | kỹ sư nếu lặp lại |
| Mất kết nối > 5 phút | vận hành theo quy trình dự phòng tại chỗ | kỹ sư hệ thống |
| Bị khóa đăng nhập, quên mật khẩu | chờ khóa tự hết | quản trị viên |
| Chrome báo chứng chỉ | không bấm tiếp tục | quản trị viên |
| Alarm Khẩn cấp | quy trình an toàn của nhà máy | trưởng ca |

Điền số điện thoại của nhà máy (phần mềm không có mục này):

| Vai trò | Tên | Điện thoại |
|---|---|---|
| Trưởng ca | | |
| Kỹ sư hệ thống | | |
| Quản trị viên | | |

## 10. Bảng tác vụ kiểm tra

Dùng khi huấn luyện ([giáo trình vận hành](../training/operator.md)). Mỗi tác vụ làm được mà không hỏi là đạt.

| # | Mục tiêu | Các bước | Kết quả mong đợi |
|---|---|---|---|
| V1 | Đăng nhập | mở `https://…:8443/`, **Đăng nhập**, nhập tài khoản | thanh trên hiện tên và "(operator)" |
| V2 | Đọc trạng thái | trên "Tổng quan", chỉ ra một giá trị GOOD và giải thích dấu BAD, STALE | nói đúng ý nghĩa và việc cần làm (mục 4) |
| V3 | Ghi giá trị có xác nhận | nhập `50` vào "Mức đặt", Enter, đọc hộp xác nhận, **Xác nhận** | dải "✔ Đã ghi và xác nhận" |
| V4 | Hủy lệnh nhầm | bấm công tắc "Chạy bơm", bấm **Hủy** | không có lệnh nào; công tắc giữ trạng thái |
| V5 | Xử lý alarm | khi có alarm "Mức bồn", mở trang Alarm, **Xác nhận** | cột "Người xác nhận" có tên mình |
| V6 | Tạm ẩn alarm | chọn alarm, **Tạm ẩn…**, ghi lý do, 15 phút | alarm sang tab "Tạm ẩn", có đếm ngược |
| V7 | Nhận biết mất kết nối | người dạy rút mạng máy trạm; quan sát rồi cắm lại | nói được "dữ liệu là cũ, điều khiển khóa"; trang tự về "Trực tuyến" |
| V8 | Đăng xuất | **Đăng xuất** | thanh trên hiện "Chưa đăng nhập"; điều khiển khóa |
