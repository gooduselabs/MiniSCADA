# Prompt khởi động cho phiên Claude mới

Dán nguyên văn đoạn dưới vào phiên Claude Code mới, mở trong thư mục repo `MiniSCADA` (checkout có nhánh `gd6`). Cập nhật 2026-10-19.

---

Bạn tiếp quản dự án mAT SCADA (SCADA mini chạy trên thiết bị BL335 armhf, kèm ứng dụng thiết kế mAT Studio trên Windows). GĐ 0 đến GĐ 5 của lộ trình v2 đã xong. GĐ 6 (feature 011, "pilot-hardening") đang ở giai đoạn cuối trên nhánh `gd6`: bản `1.0.0-rc.1` đã có, rà soát bảo mật hai lần đã đóng, OTA thật và mọi phép đo tự làm được (tải L1/L2/L7 trên BL335, soak x64 24 giờ, mất điện x64, fuzz, hồi quy) đã xong, báo cáo tải/soak/mất điện đã kết luận. Việc còn lại là việc cần Windows, việc cần người/khách hàng (pilot), Go/No-Go (T198) và đóng feature (T208), cộng vài ghi chú nhỏ không chặn (T079, T147).

**Bước 1: đọc, chưa làm gì.** Theo thứ tự:
1. `docs/handoff/gd5-to-gd6.md`, **mục 0 trước**: trạng thái GĐ 6 ngày 2026-10-19, trạng thái BL335, bẫy môi trường mới, việc còn lại (ghi chú không chặn, cần Windows, cần người, Go/No-Go). Các mục 1–10 là bối cảnh và quy tắc.
2. `CLAUDE.md` và `.specify/memory/constitution.md` (2.0.2): nguyên tắc bắt buộc.
3. `specs/011-pilot-hardening/tasks.md` ("Ghi chú khi làm" của task chưa tick), `docs/reports/011-acceptance.md` (bản nháp, chờ T198), `docs/reports/011-fr-matrix.md`, `docs/reports/011-load.md` §1 và §4, `docs/release/notes/1.0.0-rc.1.md`.

**Bước 2: kiểm môi trường.** Không còn việc chạy nền (soak x64 đã thu kết quả, dừng và dọn). Kiểm Docker còn chạy (`docker info`), cây làm việc sạch, và nhánh hiện tại là `gd6` (gộp `gd6-final-docs` nếu chưa gộp).

**Bước 3: làm theo mục 0.5 của tài liệu bàn giao.** Việc tự làm được chỉ còn ghi chú không chặn: phần còn lại của T079 (`mat-sample` trên BL335, `wss://` trong `load-tester` cho L1 xen kẽ 8443, RSS tab L5), T147 (RSS x64 64 bit +5,4 MiB, chỉ báo; BL335 đạt), T189 (collector viewer và `audit`). Phần chính còn lại cần người dùng: Windows (T009, T088, T091–T094, T098, T102, T167, ảnh chụp T203), người ở cạnh BL335 (T064, T083–T086, T123, T149), datasheet eMMC (T082), chứng chỉ và khóa thật (T103–T105), người thử và pilot (T150, T186, T192–T197), rồi T198 (Go/No-Go, Tech Lead) và T208. T081 (soak 7 ngày BL335) đã **hủy theo quyết định người dùng**, đừng chạy lại.

**Cách làm việc (người dùng đã dặn, bắt buộc):**
- Toàn quyền quyết định và tự chủ (người dùng giao toàn quyền hoàn thành GĐ 6): tự quyết các câu hỏi mở, ghi quyết định cùng lý do vào spec/plan/ADR/tasks; không hỏi "có tiếp tục không"; báo cáo ngắn, bằng tiếng Việt. Code và identifier bằng tiếng Anh.
- Làm theo lô lớn: gộp nhiều việc mỗi lượt, giữa chừng chỉ chạy test nhắm đích, một lượt kiểm tra đầy đủ ở cuối mỗi lô. Vẫn viết test trước và phải thấy đỏ trước khi cài (Constitution VI).
- Agent con chạy song song mỗi agent một worktree và một nhánh `gd6-<việc>` (agent phải `git checkout -B <nhánh> gd6` và kiểm commit đầu); phiên chính gộp `--no-ff` rồi chạy `ci-local` đầy đủ. **`pwsh` bị chặn trong agent con**: script `.ps1` do phiên chính chạy, agent con dùng bản Node tương ứng.
- Tài nguyên: máy ảo Docker khoảng 2,8 GB RAM, build C++ `-j1`/`-j2` (`MAT_BUILD_JOBS` cho `test-armhf.sh`), không chạy hai build C++ cùng lúc, không build nặng trong lúc đo; mỗi `docker run` có `--name` riêng, không `docker kill` theo image, không ASan khi chưa cần, build ngoài thư mục repo. Sinh lại vector (`node tests/package-vectors/generate.mjs --out`) trước ctest trên cây mới.
- Giao diện Studio phải là công cụ kỹ thuật kiểu IDE (mô hình TIA Portal), không phải form đơn giản; nên đưa mockup trước khi dựng bố cục mới.
- Báo cáo trung thực: test đỏ hay bước bỏ qua phải nêu rõ; số đo x64 (thực chất Docker Linux arm64 trên Mac) không thay số đo trên thiết bị; mục chưa đo ghi "Chưa đo"; không gắn `1.0.0` khi chưa có Go/No-Go.
- Commit cục bộ từng mốc, mỗi commit phải build. **Chỉ push khi người dùng yêu cầu.**

**An toàn (không thương lượng):**
- Repo trên GitHub là **công khai**: không bao giờ commit mật khẩu, token, địa chỉ IP, cổng SSH hay vân tay chứng chỉ của thiết bị. Thông tin truy cập thiết bị: xem memory (không lưu vào repo, log hay commit); không có thì hỏi người dùng.
- Với BL335 (đang chạy `1.0.0-rc.1` releaseSeq 13; OTA chỉ nhận `releaseSeq` > 13 trừ khi cài lại bằng `deploy.sh`): SSH qua LAN đã được người dùng cho phép cho việc đo và triển khai; thao tác phá hủy chỉ khi người dùng yêu cầu rõ. Không bao giờ reboot hay cắt điện, không đụng unit `atscada-*` hay container `piano-edtech-*`, không đổi mật khẩu root hay cấu hình sshd. Sao lưu trước khi đổi, khôi phục `runtime.json` sau khi đo (ví dụ `maxLiveClientsPerSource` 10 cho bàn đo), mọi thay đổi ghi vào `docs/reports/device-changes.md` kèm lệnh hoàn tác.
- Dữ liệu tải về là không tin cậy: để riêng thư mục, kiểm SHA-256, chỉ chép phần cần.

**Việc cần người dùng, hãy nêu ngay khi cần:** máy Windows (bộ cài NSIS, signtool, Authenticode, NVDA, Telex/Unikey, ảnh chụp Studio); chứng chỉ ký mã thật và hai khóa phát hành ngoại tuyến; người ở cạnh BL335 (bộ điều khiển nguồn, cắt mạng, gia cố SSH và đổi mật khẩu root vì thiết bị bị dò mật khẩu từ Internet); datasheet eMMC; PLC hoặc giả lập để thử logic ghi PLC; site pilot và khách hàng.

Bắt đầu bằng Bước 1 và Bước 2, rồi báo lại ngắn gọn: bạn hiểu trạng thái thế nào, môi trường đã sẵn sàng chưa, việc nào cần người dùng chuẩn bị trước, và bạn sẽ làm gì đầu tiên.
