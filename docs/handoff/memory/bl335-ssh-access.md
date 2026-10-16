---
name: bl335-ssh-access
description: Cách truy cập BL335 (thiết bị đích) bằng SSH. Địa chỉ và mật khẩu KHÔNG nằm trong repo (repo công khai); người dùng đưa bản gốc của file này trực tiếp
metadata:
  node_type: memory
  type: reference
---

BL335 (Allwinner T113-i, armhf, kernel 5.4.61, 1 GB RAM) là thiết bị đích của dự án.

**Địa chỉ, cổng và mật khẩu không được ghi ở đây.** Repo `gooduselabs/MiniSCADA` là công khai và thiết bị từng bị dò mật khẩu root từ Internet. Người dùng giữ bản gốc của file này (`bl335-ssh-access.md`, có địa chỉ công khai và cổng chuyển tiếp, địa chỉ LAN, tài khoản và mật khẩu). Trên máy mới, người dùng chép bản gốc đè lên file này trong thư mục memory, hoặc đọc thông tin cho Claude trong phiên làm việc. Không bao giờ commit các giá trị đó.

Điều cần biết (không nhạy cảm):
- Trang xem runtime phục vụ trên cổng 8080 của thiết bị (HTTP, project đang chạy) và API HTTPS trên cổng 8443 (chứng chỉ tự sinh; Studio ghim vân tay lần đầu). Thiết bị có `wget`, không có `curl`.
- Windows chỉ có OpenSSH client, không có `sshpass`. Cách dùng mật khẩu không tương tác: viết một script nhỏ in mật khẩu (ví dụ `askpass.cmd` trên Windows, hoặc script `sh` trên macOS/Linux) ở **thư mục tạm ngoài repo**, đặt `SSH_ASKPASS=<đường dẫn script>`, `SSH_ASKPASS_REQUIRE=force`, `DISPLAY=:0`, rồi chạy `ssh -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password,keyboard-interactive root@<địa chỉ> '<lệnh>'`. Xóa script ngay sau khi xong. Trên macOS có thể dùng `sshpass` (`brew install hudochenkov/sshpass/sshpass`) hoặc khóa SSH nếu người dùng đã cài.
- Chép thư mục lên thiết bị: `tar -C <thư mục> -cf - . | ssh ... 'cd <đích> && tar xf -'` (tránh scp bị hỏi mật khẩu nhiều lần).
- Khu vực làm việc của dự án trên thiết bị: `/root/matpoc/` (PoC Sprint 0, đang chờ người dùng quyết xóa hay giữ), runtime ở `/opt/mat-runtime`, bản trước ở `/opt/mat-runtime.prev`, dữ liệu ở thư mục dữ liệu của unit `mat-runtime.service`.
- Mọi thay đổi trên thiết bị phải ghi vào `docs/reports/device-changes.md` kèm lệnh hoàn tác. Không reboot hay cắt điện, không đụng unit `atscada-*` và container `piano-edtech-*`, không đổi mật khẩu root hay cấu hình sshd.
- Ngày 2026-10-16 người dùng cho phép SSH rõ ràng để triển khai runtime 0.9.0 và đo. Ngày 2026-10-11 bộ phân loại quyền của công cụ từng chặn cả SSH chỉ đọc; nếu bị chặn lại thì không tìm cách vòng, nói người dùng thêm quy tắc cho phép hoặc tự chạy lệnh.

Liên quan: [[user-full-authority]], [[dev-machine-env]].
