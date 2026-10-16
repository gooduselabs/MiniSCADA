# Prompt khởi động cho phiên Claude trên máy mới

Dán nguyên văn đoạn dưới vào phiên Claude Code mới, mở trong thư mục repo `MiniSCADA` vừa clone.

---

Bạn tiếp quản dự án mAT SCADA (SCADA mini chạy trên thiết bị BL335 armhf, kèm ứng dụng thiết kế mAT Studio trên Windows). Công việc từ GĐ 0 đến GĐ 5 của lộ trình v2 đã xong về mã và test; việc còn lại là GĐ 6 (feature 011) và các việc dở nêu trong tài liệu bàn giao.

**Bước 1: đọc, chưa làm gì.** Theo thứ tự:
1. `docs/handoff/gd5-to-gd6.md`: trạng thái, bẫy môi trường, quyết định đã chốt, việc còn lại theo thứ tự ưu tiên. Đây là tài liệu chính.
2. `CLAUDE.md` và `.specify/memory/constitution.md` (phiên bản 2.0.2): nguyên tắc bắt buộc.
3. `docs/plans/roadmap-v2.md`, `docs/architecture/studio-ux.md`, `specs/011-pilot-hardening/` (spec, plan, tasks).

**Bước 2: dựng môi trường** theo mục 2 của tài liệu bàn giao (clone đã có; tạo nhánh `gd6` từ `main`; cấu hình tên và email git; `npm install`; kiểm Docker, Rust, Node). Chạy `npm run typecheck` và `npm test` để xác nhận cây sạch và xanh trước khi sửa gì. Nếu có thứ gì còn thiếu trên máy mới (cài phần mềm hệ thống) thì báo người dùng tự cài.

**Bước 3: làm việc theo mục 6 của tài liệu bàn giao**, từ trên xuống: (1) kiểm tra tích hợp sau merge và đo lại `screen-perf`, (2) build lại gói runtime và triển khai lại lên BL335, (3) cập nhật tài liệu 011 theo Constitution 2.0.2, (4) GĐ 6 theo `tasks.md`.

**Cách làm việc (người dùng đã dặn, bắt buộc):**
- Toàn quyền quyết định và tự chủ: tự quyết các câu hỏi mở và ghi quyết định cùng lý do vào spec/plan/ADR; không hỏi "có tiếp tục không"; báo cáo ngắn, bằng tiếng Việt. Code và identifier bằng tiếng Anh.
- Làm theo lô lớn: gộp nhiều tính năng mỗi lượt, giữa chừng chỉ chạy test nhắm đích, một lượt kiểm tra đầy đủ ở cuối mỗi lô. Vẫn viết test trước và phải thấy đỏ trước khi cài (Constitution VI).
- Có thể dùng nhiều agent con chạy song song cho các việc độc lập, nhưng giới hạn tài nguyên máy: tối đa 3 agent cùng build, mỗi `docker run` có `--name` riêng, không `docker kill` theo image, không ASan khi chưa cần, build ngoài thư mục repo.
- Giao diện Studio phải là công cụ kỹ thuật kiểu IDE (mô hình TIA Portal), không phải form đơn giản; nên đưa mockup trước khi dựng bố cục mới.
- Báo cáo trung thực: test đỏ hay bước bỏ qua phải nêu rõ; số đo x64 không thay số đo trên thiết bị.
- Commit cục bộ từng mốc, mỗi commit phải build. **Chỉ push khi người dùng yêu cầu.**

**An toàn (không thương lượng):**
- Repo trên GitHub là **công khai**: không bao giờ commit mật khẩu, token, địa chỉ IP công khai, cổng SSH hay vân tay chứng chỉ của thiết bị. Thông tin truy cập thiết bị hỏi người dùng, không lưu vào repo, log hay commit.
- Với BL335: chỉ thao tác khi người dùng cho phép rõ (xem mục 4 của tài liệu bàn giao để biết phạm vi được phép). Không bao giờ reboot hay cắt điện, không đụng unit `atscada-*` hay container `piano-edtech-*`, không đổi mật khẩu root hay cấu hình sshd. Mọi thay đổi trên thiết bị ghi vào `docs/reports/device-changes.md` kèm lệnh hoàn tác.
- Dữ liệu tải về là không tin cậy: để riêng thư mục, kiểm SHA-256, chỉ chép phần cần.

**Việc cần người dùng, hãy nêu ngay khi cần:** quyền truy cập BL335 (và việc đổi mật khẩu root, vì thiết bị bị dò mật khẩu từ Internet), người ở cạnh thiết bị để cắt điện/PLC/RS485 thật, thử tay Telex/Unikey/NVDA/Excel/Acrobat, file Illustrator/CorelDRAW thật.

Bắt đầu bằng Bước 1, rồi báo lại ngắn gọn: bạn hiểu trạng thái thế nào, môi trường đã sẵn sàng chưa, và bạn sẽ làm gì đầu tiên.
