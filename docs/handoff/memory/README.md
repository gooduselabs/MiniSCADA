# Memory của Claude Code cho mAT SCADA (bản chuyển sang máy mới)

Thư mục này là bản sao memory của Claude Code trên máy cũ, đã bỏ giá trị nhạy cảm, để nhập vào máy mới (macOS, Linux hoặc Windows).

## Nhập vào máy mới

```
git clone https://github.com/gooduselabs/MiniSCADA.git
cd MiniSCADA
bash docs/handoff/memory/import-memory.sh
```

Script chép các file `.md` vào `~/.claude/projects/<đường dẫn repo đã mã hóa>/memory/`. Tên thư mục lấy từ đường dẫn tuyệt đối của repo trên máy mới, mọi ký tự không phải chữ hoặc số đổi thành `-` (ví dụ `/Users/ten/MiniSCADA` thành `-Users-ten-MiniSCADA`). Nếu bạn dời repo sang chỗ khác, chạy lại script từ chỗ mới. Mặc định không ghi đè file đã có; thêm `--force` nếu muốn ghi đè. Memory là dữ liệu tham khảo cho Claude, không phải mã: mở Claude Code trong thư mục repo rồi dán `docs/handoff/PROMPT.md`.

## File nhạy cảm không nằm trong repo

Repo công khai nên **`bl335-ssh-access.md` ở đây chỉ là bản đã bỏ địa chỉ và mật khẩu**. Bản gốc (địa chỉ công khai và cổng chuyển tiếp, địa chỉ LAN, tài khoản, mật khẩu thiết bị) nằm ở máy cũ, ngoài repo, trong thư mục `mat-scada-private-transfer` của thư mục người dùng. Chuyển nó sang máy mới bằng AirDrop, USB hoặc trình quản lý mật khẩu, rồi chép đè lên `…/memory/bl335-ssh-access.md`. Thiết bị bị dò mật khẩu root từ Internet nên nên đổi mật khẩu root trước hoặc sớm nhất có thể.

## Nội dung

- `MEMORY.md`: mục lục (một dòng cho mỗi memory).
- `handoff-state.md`: trỏ tới `docs/handoff/gd5-to-gd6.md` (trạng thái hiện hành).
- `user-full-authority.md`, `studio-ui-quality-bar.md`: cách người dùng muốn làm việc.
- `dev-machine-env.md`: ghi chú về **máy Windows cũ** (ổ đĩa, Visual Studio, bẫy shell). Một phần không áp dụng cho macOS; xem mục "Máy mới là macOS" của `docs/handoff/gd5-to-gd6.md`.
- `bl335-ssh-access.md`: cách SSH vào thiết bị (không có giá trị nhạy cảm).
- `sprint1-handoff.md`, `roadmap-v2-proposal.md`, `v2-gd1-status.md`, `feature003-status.md`: lịch sử quyết định; trạng thái hiện hành ở tài liệu bàn giao.
