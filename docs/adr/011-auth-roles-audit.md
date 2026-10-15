# ADR-011: Đăng nhập, phân quyền và audit trên thiết bị

- **Trạng thái:** Accepted (2026-10-12, người dùng giao toàn quyền quyết định). Ngoại lệ `synchronous=FULL` đã chấp thuận từ 2026-10-11. Tham số Argon2id (m = 19 MiB, t = 2, p = 1) đo trên x64 và qemu-arm (tham khảo); **đo trên BL335 chưa làm, chờ SSH** (T055, T159): vượt 1 s mỗi lần đăng nhập thì giảm `t`/`m` theo ADR này. Gốc: Proposed (feature 005). Ngoại lệ `synchronous=FULL` cho `audit.db` **đã chấp thuận** ngày 2026-10-11 (người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11), Constitution 2.0.1. Argon2id, token trong header và mật khẩu tối thiểu 15 ký tự đã chốt cùng ngày. Tham số băm mật khẩu chờ đo trên BL335 (T055).
- **Ngày:** 2026-10-11
- **Liên quan:** [specs/005-device-online](../../specs/005-device-online/plan.md), research R7–R11, R18; contracts [device-api.md](../../specs/005-device-online/contracts/device-api.md), [device-config.md](../../specs/005-device-online/contracts/device-config.md); Constitution V, "Ràng buộc công nghệ" (SQLite); [ADR-008](008-data-logging.md) (ngoại lệ `synchronous=FULL` đầu tiên); [ADR-010](010-device-discovery-https.md).

## Bối cảnh

Constitution V yêu cầu đăng nhập, phân quyền theo role và audit trước khi bật API nạp xuống, và sau này là ghi Tag. Spec 005 yêu cầu:

- tài khoản cục bộ, mật khẩu băm chậm có salt, tạo bằng lệnh trên thiết bị (không qua mạng ở GĐ 1);
- 4 role; khóa tạm sau 5 lần sai;
- phiên 30 phút rảnh và tối đa 12 giờ, không dùng lại được từ máy khác;
- audit bền khi mất điện, có thời hạn và trần dung lượng;
- một lần đăng nhập ≤ 1 s trên BL335.

Ràng buộc:

- **Thiết bị:** Cortex-A7, RAM của runtime ≤ 150 MB, ghi eMMC ≤ 2 GB/ngày, đồng hồ không tin được sau mất điện.
- **Runtime:** chạy bằng user `matscada` trong sandbox; `/etc/mat-runtime` chỉ đọc.
- **Client duy nhất cần đăng nhập ở GĐ 1** là Studio (Rust); trang web cần đăng nhập từ GĐ 2.

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Băm mật khẩu | PBKDF2-HMAC-SHA256 (có trong Mbed TLS; lộ trình §4.1 ghi PBKDF2); scrypt; bcrypt; **Argon2id** | Argon2id (phc-winner-argon2), m = 19 MiB, t = 2, p = 1 |
| Lưu tài khoản | SQLite của runtime; tài khoản Linux (PAM); **file JSON do root ghi, runtime chỉ đọc** | `/etc/mat-runtime/users.json` (`root:matscada`, `0640`) |
| Chuyển token | cookie + CSRF; **header bearer**; JWT có chữ ký | header `Authorization: Bearer`, token ngẫu nhiên 32 byte; cookie để GĐ 2 |
| Lưu phiên | SQLite; **bộ nhớ**, đi qua `execv` bằng file tmpfs | bộ nhớ, băm token; `/run/mat-runtime/auth-state.json` khi `execv` |
| Khóa tạm | theo tài khoản; theo IP; **cả hai** | cả hai, kể cả tên không tồn tại; trong bộ nhớ, `CLOCK_BOOTTIME` |
| Audit | chung `history.db`; journald; file nối đuôi + `fdatasync`; **SQLite riêng** | `audit.db` riêng, `synchronous=FULL` (ngoại lệ) |

## Quyết định

1. **Mật khẩu:**
   - Argon2id m = 19456 KiB, **t = 1** (đổi từ t = 2 ngày 2026-10-13 theo số đo trên BL335: t = 2 mất 883 ms), p = 1, salt 16 byte, chuỗi PHC. **Lệch khuyến nghị OWASP** (m = 19 MiB, t = 2): chấp nhận vì mục tiêu 0,8 s và trần SC-007 1 s trên Cortex-A7; mật khẩu 15 ký tự trở lên và khóa tạm sau 5 lần sai bù lại. Hash cũ (t = 2) vẫn kiểm được; đổi mật khẩu bằng `--user-passwd` để lấy tham số mới.
   - Mỗi lúc một lần băm (hàng đợi 4, `nice +10`). Bộ nhớ cấp bằng `mmap`, trả ngay sau khi băm.
   - Tài khoản không tồn tại vẫn băm giả. So sánh hằng thời gian.
   - Mục tiêu 0,3–0,8 s trên BL335. Đo vượt 0,8 s thì hạ t = 1 và ghi vào ADR này.
   - **Mật khẩu có dấu** (chốt 2026-10-11, người dùng giao toàn quyền): hai bộ gõ có thể cho cùng chữ "ă" dưới hai dạng byte khác nhau, dựng sẵn (NFC) và tổ hợp. Để đầu đặt và đầu nhập luôn ra cùng byte mà không phải nhúng bảng Unicode vào runtime C++:
     - Studio chuẩn hóa NFC (`String.prototype.normalize('NFC')`) trước khi gửi đăng nhập;
     - lệnh đặt mật khẩu trên thiết bị (`--user-add`, `--user-passwd`) từ chối mật khẩu có dấu tổ hợp (U+0300–U+036F, U+1AB0–U+1AFF, U+1DC0–U+1DFF, U+20D0–U+20FF, U+FE20–U+FE2F) bằng mã thoát 2, kèm câu hướng dẫn đặt bộ gõ về "Unicode dựng sẵn". Mọi chữ tiếng Việt đều có dạng dựng sẵn;
     - runtime không chuẩn hóa khi kiểm. Client khác Studio phải tự gửi NFC.
     - **Giới hạn còn lại** (ghi khi cài T085c): NFC còn đổi vài ký tự không phải dấu tổ hợp, như Å U+212B, Ω U+2126, K U+212A, U+0387, U+037E, chữ CJK compatibility (U+F900–U+FAFF, U+2F800–U+2FA1F). Mật khẩu đặt trên thiết bị có các ký tự này sẽ không đăng nhập được từ Studio. Tiếng Việt không dùng các ký tự này; lệnh đặt mật khẩu sẽ chặn thêm các khối đó khi rà soát bảo mật ở Phase 7.
2. **Tài khoản:**
   - Lệnh root `--user-add|passwd|role|disable|enable|unlock|list`. Mật khẩu chỉ qua TTY hoặc stdin, 15–128 ký tự (mức tối thiểu của NIST SP 800-63B-4 khi chỉ dùng mật khẩu).
   - Runtime đọc lại `users.json` khi file đổi. `rev` đổi thì hủy phiên của tài khoản; `unlockSeq` đổi thì xóa khóa tạm.
   - Chưa có tài khoản nào thì mọi đăng nhập bị từ chối. `deploy.sh` yêu cầu đặt mật khẩu quản trị ở lần cài đầu.
3. **Phiên:**
   - Token `mats_` + 32 byte ngẫu nhiên, chỉ HTTPS.
   - Hết hạn sau 30 phút rảnh, tối đa 12 giờ; gắn IP nguồn; tối đa 32 phiên.
   - Lỗi: 401 `AUTH_REQUIRED`, `SESSION_EXPIRED`, `SESSION_INVALID`.
4. **Khóa tạm:** 5 lần sai liên tiếp thì khóa 5 phút, theo tên và theo IP; 429 `AUTH_LOCKED` kèm `retryAfterS`. Sai tên hay sai mật khẩu cùng một thông báo `AUTH_FAILED`.
5. **Role:**
   - `viewer` < `operator` < `engineer` < `administrator`, một bảng quyền duy nhất cho mọi endpoint.
   - Chẩn đoán: viewer. Đọc lên, nạp xuống, khôi phục: engineer. Audit: administrator.
   - operator như viewer tới GĐ 2.
6. **Audit:**
   - `<dataDir>/audit.db`, WAL, `synchronous=FULL`.
   - Trường: thời điểm, cờ giờ chưa đồng bộ, tài khoản, role, nguồn, kênh, hành động, đối tượng, kết quả, mã, chi tiết (không bí mật), số lần.
   - Thao tác thay đổi ghi `started` trước; không ghi được thì từ chối (`AUDIT_UNAVAILABLE`). Đăng nhập cũng vậy.
   - Từ chối và đăng nhập sai được gộp trong 60 s, tối đa 10 dòng/phút.
   - Giữ 365 ngày, trần 64 MiB; dọn chỉ khi đồng hồ đã đồng bộ.
   - Đọc: administrator qua API; root qua `runuser -u matscada -- mat-runtime --export-audit`.

## Hệ quả

- **Tốt:**
  - Đủ điều kiện của Constitution V để bật API nạp xuống.
  - Lỗi ở runtime không tạo được tài khoản (runtime không ghi được `users.json`).
  - Token không lộ ra giao diện Studio.
  - Audit còn sau mất điện.
- **Xấu:**
  - Thêm một thư viện C (Argon2).
  - Mỗi lần đăng nhập tốn tới khoảng 1 s CPU của một nhân và 19 MiB RAM tạm thời.
  - Người trong LAN khóa được một tài khoản 5 phút mỗi lần (spec yêu cầu khóa theo tài khoản).
  - Khởi động lại thiết bị thì phải đăng nhập lại.
  - Mỗi bản ghi audit có một `fsync`: dưới 3 MB/ngày khi vận hành thường, tối đa khoảng 150 MB/ngày khi bị tấn công liên tục.
  - Hai chi tiết khác lộ trình §4.1 (Argon2id thay PBKDF2; header thay cookie + CSRF) cần người dùng đồng ý.

## Ngoại lệ Constitution cần chấp thuận

Constitution ("Ràng buộc công nghệ") chỉ có một ngoại lệ `synchronous=FULL` (giao dịch xóa mốc gửi của 003). ADR này đề xuất ngoại lệ thứ hai:

| | |
|---|---|
| **Phạm vi** | mọi giao dịch của `audit.db` |
| **Lý do** | FR-015: thao tác đã báo thành công thì bản ghi audit không mất khi mất điện. Với `NORMAL`, giao dịch WAL đã commit có thể quay lại sau mất điện |
| **Chi phí** | một `fsync` WAL mỗi bản ghi; lượng ghi như ở mục Hệ quả |
| **Phương án B, nếu không chấp thuận** | file audit nối đuôi + `fdatasync` (không phải SQLite). Bền như nhau, nhưng lọc, phân trang, xóa cũ phải tự viết |

**Đã chấp thuận 2026-10-11** (người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11); Constitution sửa thành 2.0.1 (PATCH), mục "Ràng buộc công nghệ", ngoại lệ thứ hai.

## Số đo / bằng chứng

- **Khuyến nghị:** OWASP Password Storage Cheat Sheet (Argon2id m = 19 MiB, t = 2, p = 1; PBKDF2-HMAC-SHA256 600.000 vòng).
- **Ước tính, chưa đo:** trên Cortex-A7 1,2 GHz, PBKDF2 600.000 vòng khoảng 2 s; Argon2id khoảng 0,6–1,0 s.
- **Mốc 0.3.0 trên BL335:** RSS tối đa 13,7 MB khi tải chuẩn ([003-acceptance.md](../reports/003-acceptance.md)), nên đỉnh +19 MiB khi băm còn xa ngân sách 150 MB.
- **Chưa đo, làm ở task ⚠️🔌:** `--auth-bench` trên BL335; 20 lần đăng nhập ≤ 1 s; tìm chuỗi mật khẩu thử trong log và dữ liệu (SC-005).
- **Audit, đo trên x64 (T025, 2026-10-11).** Docker Desktop/WSL2, `/tmp` của container; số trên eMMC của BL335 đo ở T158–T165.
  - `append()` với `synchronous=FULL`: trung vị 1,6–6,6 ms, p95 3,1–8,6 ms, qua 500–1000 lần ghi mỗi lần chạy. Với NORMAL, chỉ để so: trung vị 17–35 µs. Chi phí là một fsync mỗi bản ghi.
  - Mỗi dòng chạm 4 trang B-tree: bảng và 3 chỉ mục `ts_ms`, `(user, ts_ms)`, `(action, ts_ms)`. Với trang 4 KiB, mỗi commit ghi 17 724 byte WAL, gấp khoảng 4 lần ước tính "1 trang 4 KB" ở R11. `audit.db` vì vậy dùng trang 1 KiB (chỉ áp cho file mới): còn 5 823 byte mỗi commit, độ trễ và byte mỗi dòng không đổi.
  - Kích thước: 418 byte/dòng khi có `detail` khoảng 180 byte, 160 byte/dòng khi không có. 64 MiB chứa khoảng 160 000–420 000 dòng.
  - Ước tính khi bị tấn công liên tục: khoảng 16 000 commit/ngày (10 dòng loại bị giới hạn mỗi phút, một dòng `audit.suppressed` mỗi phút, cộng số đếm của cửa sổ gộp), tức khoảng 90–100 MB/ngày WAL, cộng checkpoint và nhật ký ext4. Vẫn khớp mức khoảng 150 MB/ngày ở mục Hệ quả. Với trang 4 KiB, riêng WAL đã khoảng 280 MB/ngày.
- **Băm mật khẩu, đo qua `mat_auth` (T032, T035, 2026-10-11).** Chương trình tạm ngoài repo, mỗi cấu hình 5 lần. Chưa có số của BL335: tham số giữ m = 19456 KiB, t = 2, p = 1 tới khi T055 đo.

  | Phép đo | x64 (Docker, máy dev) | armhf dưới qemu-arm (chỉ tham khảo) |
  |---|---|---|
  | Argon2id m = 19456, t = 2 (trung vị) | 24,0 ms | 318 ms |
  | Argon2id m = 19456, t = 1 (trung vị) | 14,6 ms | 153 ms |
  | Đăng nhập trọn qua `AuthService` (t = 2, trung vị) | 24,6 ms | 315 ms |
  | RSS đỉnh lúc băm so với trước | +19,1 MiB | +20,3 MiB (tiến trình qemu) |
  | RSS sau băm so với trước | +76 KiB | về lại mốc |

  - qemu chạy trên CPU x64 nhanh, nên không thay được số của Cortex-A7: R7 ước 0,6–1,0 s cho t = 2 trên BL335.
  - Bộ nhớ băm cấp bằng `mmap` và trả bằng `munmap` sau mỗi lần băm. Thiếu bước này, glibc giữ khối 19 MiB đã giải phóng trong heap từ lần băm thứ hai, vì ngưỡng mmap động đã được nâng lên.
- **Ghi chú khi cài `core/auth` (T032–T035):**
  - **Đếm lần sai trước khi băm.** Mỗi lần thử tính là sai ngay khi vào hàng băm; mật khẩu đúng thì xóa. Nhờ vậy 5 request song song không vượt được 5 lần thử. Nếu đếm sau khi băm, 1 lần đang băm + 4 lần chờ cho tới 9 lần thử mỗi 5 phút.
  - **Tên gõ không đúng dạng tài khoản** (có thể là mật khẩu gõ nhầm ô) không vào audit, log hay bảng khóa theo tên. Bản ghi audit có `detail` `{"userInvalid":true}`; lần thử vẫn tính vào bộ đếm theo IP.
  - **Băm giả** cho tên không tồn tại, tài khoản bị tắt, hash hỏng, chưa có tài khoản: salt giả cố định với tham số mặc định. Thời gian trả lời không lộ tài khoản có tồn tại hay không, kể cả tài khoản bị tắt còn tham số cũ.
  - **Runtime không băm lại khi đăng nhập**, dù R7 ghi vậy, vì runtime không ghi được `users.json` (R8). Runtime chỉ log nhắc chạy `--user-passwd` cho tài khoản có tham số cũ.

## Số đo x64 khi nghiệm thu (2026-10-12)

- Đăng nhập Argon2id thật qua `AuthService`: trung vị 24,6 ms (x64), 315 ms (qemu-arm, chỉ tham khảo, không đại diện BL335).
- Khóa tạm: 5 lần sai thì lần 6 với mật khẩu đúng nhận 429 `AUTH_LOCKED` (`retryAfterS` 290 đến 300); từ địa chỉ khác vẫn khóa theo tên. Mật khẩu thử không có trong log, `audit.db`, kho project, `/run/mat-runtime`, `docker logs` (kịch bản `secrets`, [005-secrets-x64.json](../reports/005-secrets-x64.json), sau khi đã chạy `deploy`).
- Audit: administrator đọc, lọc theo user và tiền tố action, phân trang; engineer và viewer 403 có `access.denied`; `--export-audit` có đăng nhập thất bại, khóa tạm và truy cập bị từ chối ([005-auth-x64.json](../reports/005-auth-x64.json)).
- **Chưa đo, chờ SSH tới BL335:** 20 lần đăng nhập mỗi lần dưới 1 s, chi phí `synchronous=FULL` trên eMMC thật.

## Điều kiện xem xét lại

- Đo trên BL335: Argon2id t = 1 vẫn > 1 s. Khi đó xét bản Argon2 tối ưu cho ARM, hoặc PBKDF2 với số vòng đo được.
- GĐ 2: trang web đăng nhập bằng cookie `HttpOnly; Secure; SameSite=Strict` + CSRF; quản lý tài khoản trong Studio (cần API ghi tài khoản có audit).
- Có yêu cầu đăng nhập tập trung (LDAP, AD) hay xác thực hai lớp.

- **Đo trên BL335 (2026-10-13, `--auth-bench`, armv7l 2 CPU):** m = 19456, t = 2, p = 1: trung vị 882,7 ms (min 880,9; max 909,5), RSS đỉnh +20,5 MiB; đăng nhập HTTPS trọn qua đường hầm SSH 1,07–1,41 s (trung vị 1,15 s, bắt tay TLS 133 ms) nên vượt SC-007: đổi sang t = 1.

## Ghi chú (feature 009, 2026-10-15)

- Có **6 hành động audit mới** cho alarm (tổng 27 lên 33), lược đồ `audit.db` không đổi; xem [ADR-029](029-alarm-live-api.md). Quy tắc "audit trước rồi áp dụng" (FULL) được dùng cho xác nhận alarm: kịch bản `auth` (22 kiểm) cho thấy `ts` của audit không muộn hơn `tsAck` của `alarm.db`; `killloop` 100/100 vòng không có xác nhận nào thiếu audit (`ackWithoutAudit` rỗng). Vai trò: operator xác nhận và tạm ẩn, engineer và administrator vô hiệu hóa (chỉ Bearer; cookie bị 403 `SESSION_SCOPE`). `docs/reports/009-{auth,killloop}-x64.json`; BL335 chưa đo.
