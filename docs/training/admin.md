# Khóa quản trị (nửa ngày)

## Mục tiêu

Sau khóa, người quản trị tự làm được:

1. cài và cập nhật runtime bằng `deploy.sh`, rollback;
2. quản lý tài khoản: tạo, đổi vai trò, tắt, mở khóa;
3. phát fingerprint, cài chứng chỉ cho Chrome;
4. cấu hình `allowedHosts`, `viewerAccess`, `viewerLogin`;
5. sao lưu và khôi phục;
6. gia cố SSH và truy cập từ xa;
7. đọc chẩn đoán, cảnh báo và audit.

## Chuẩn bị (người dạy)

- Mỗi nhóm 2 người: một BL335 bàn thử (hoặc máy Linux chạy runtime x64) có SSH root, gói runtime và `deploy.sh`.
- Máy Windows có Studio và Chrome.
- Không làm trên thiết bị đang chạy ở nhà máy.

## Lịch

| Thời gian | Nội dung | Bài |
|---|---|---|
| 0:00–0:20 | kiến trúc, vai trò, các thư mục trên thiết bị | giảng |
| 0:20–1:00 | cài runtime, kiểm tra sau cài, rollback | 1 |
| 1:00–1:40 | tài khoản, mật khẩu, khóa tạm | 2 |
| 1:40–2:10 | chứng chỉ, Chrome, `allowedHosts` | 3 |
| 2:10–2:20 | nghỉ | |
| 2:20–3:00 | sao lưu, khôi phục | 4 |
| 3:00–3:20 | gia cố, chẩn đoán, audit | 5 |
| 3:20–4:00 | bài kiểm thực hành, phiếu đánh giá | kiểm |

## Bài thực hành

Mỗi bài tương ứng các tác vụ trong [admin-guide.md](../user/admin-guide.md) mục 13.

| Bài | Tác vụ | Kết quả mong đợi |
|---|---|---|
| 1 | A1, A10 | cài thành công; rollback về bản trước và cài lại |
| 2 | A2, A3, A4 | tạo được tài khoản; mật khẩu 10 ký tự bị từ chối; mở khóa được |
| 3 | A5, A6 | Chrome không cảnh báo; tên mới được nhận, tên lạ báo 421 |
| 4 | A7, A8, A9 | có tệp sao lưu ngoài thiết bị; khôi phục đúng |
| 5 | A11, A12, A13 | cảnh báo `SSH_ROOT_PASSWORD` hết; đọc được audit và chẩn đoán |

## Bài kiểm thực hành (40 phút)

| # | Yêu cầu | Đạt khi |
|---|---|---|
| 1 | Tạo tài khoản operator cho một người mới; tắt một tài khoản cũ | `--user-list` đúng; tài khoản tắt không đăng nhập được |
| 2 | Một người vận hành báo "bị khóa đăng nhập" | giải thích khóa theo (tên, IP), mở khóa bằng lệnh đúng |
| 3 | Sao lưu thiết bị rồi chép ra máy quản trị | tệp có `etc/mat-runtime` và `var/lib/mat-runtime`; dịch vụ chạy lại |
| 4 | Người dạy sửa sai một khóa trong `runtime.json`; học viên tìm và sửa | tìm ra bằng `journalctl` trong ≤ 10 phút |
| 5 | Đọc `system/info` và nêu cảnh báo đang có | nêu đúng mã và cách xử lý theo hướng dẫn |

**Tiêu chí đạt:** đạt cả 5 mục, được tra tài liệu. Mục 3 làm sai quyền tệp khi khôi phục (nếu có làm) là không đạt.

Ghi kết quả vào [evaluation-form.md](evaluation-form.md).
