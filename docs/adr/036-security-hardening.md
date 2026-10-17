# ADR-036: Gia cố bảo mật GĐ 6: allowlist `Host`, khóa đăng nhập theo cặp, nhật ký xung, cô lập timeout đa unit, `persist()` ngoài mutex, từ chối file thừa, giới hạn kết nối theo nguồn

- **Trạng thái:** Proposed (feature 011, GĐ 6; quyết định "người dùng giao toàn quyền 2026-10-11"). Chuyển Accepted ở Go/No-Go (T198) kèm số đo (T053, T054, T063).
- **Cập nhật 2026-10-17 (T199):** mọi mục 1–10 đã có mã và đã gộp vào `gd6`; số đo x64 (T053, T054) và một phần BL335 ở mục "Số đo / bằng chứng". T063 (giới hạn kết nối trên BL335) và T064 (gia cố `sshd`) chờ người. Vẫn Proposed.
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/011-pilot-hardening](../../specs/011-pilot-hardening/plan.md), research R3–R12, bảng "Phát hiện tồn" của plan; [005-acceptance §9](../reports/005-acceptance.md), [006-acceptance §12](../reports/006-acceptance.md), [007-security-review](../reports/007-security-review.md); [ADR-006](006-live-protocol-v1.md), [ADR-011](011-auth-roles-audit.md), [ADR-012](012-project-package-deploy.md), [ADR-014](014-driver-sdk-modbus.md), [ADR-017](017-tag-engine-v1.md), [ADR-018](018-viewer-source-filter.md), [ADR-021](021-web-login-certificates.md); Constitution V.

## Bối cảnh

Review của 005, 006, 007 để lại các phát hiện Medium chưa xử lý, đủ để chặn giao hàng: không kiểm `Host` (DNS rebinding đọc được dữ liệu xem), khóa đăng nhập theo tên cho phép bất kỳ ai khóa tài khoản kỹ sư, xung `pulseMs` bị `kill -9` để bit lệnh bật, một timeout trên gateway Modbus TCP làm BAD mọi Tag của kênh, `persist()` giữ mutex khi fsync, gói có file thừa làm lệch digest, cạn worker HTTPS bởi kết nối TLS im lặng. Mỗi điểm đổi hành vi của một ADR cũ; ADR này ghi chúng cùng một chỗ.

## Quyết định

1. **Kiểm `Host`** (đổi ADR-018, ADR-021): chấp nhận `Host` là IP literal (v4, v6), `localhost`, tên máy của thiết bị (và `.local`), hoặc tên trong `allowedHosts`; còn lại 421 `HOST_NOT_ALLOWED`. Lý do: rebinding cần **tên**, IP literal không rebinding được, nên port-forward và NAT không vỡ. Áp cho HTTP, HTTPS và nâng cấp WebSocket, trước mọi xử lý khác. `hostCheck: off` tồn tại có cảnh báo.
2. **Khóa đăng nhập theo cặp (tên, IP)** và theo IP (đổi ADR-011): cặp 5 lần/5 phút nhân đôi tới 60 phút (không vĩnh viễn); IP 20 lần/10 phút; thành công chỉ xóa bộ đếm cặp; giới hạn kiểm Argon2id đồng thời (`LOGIN_BUSY`); tấn công phân tán chỉ ghi audit; mật khẩu mới ≥ 10 ký tự; `--user-unlock` cho root. Bỏ khóa theo tên thuần túy.
3. **Nhật ký xung** (đổi ADR-017): `pulse.journal` (`fdatasync`) ghi **trước** khi ghi bit bật; không ghi được thì từ chối lệnh; khởi động nhả mọi xung dở khi kênh nối lại (audit `pulse-recovery`), hết hạn thì `PULSE_STUCK`. `releasePulse` hẹn lại, không ngủ. Giới hạn: mất điện lâu thì bit vẫn bật suốt thời gian đó; PLC phải tự nhả.
4. **Modbus TCP đa unit** (đổi ADR-014): giữ kết nối khi timeout đơn lẻ, BAD Tag của yêu cầu, backoff riêng thiết bị, bỏ phản hồi muộn theo `transactionId`; đóng kết nối khi lỗi socket/khung hoặc ≥ 3 timeout liên tiếp trên ≥ 2 thiết bị. RTU qua TCP và RTU nối tiếp giữ cách cũ.
5. **`persist()`** (đổi ADR-012): sao chụp trạng thái dưới mutex, ghi và fsync ngoài mutex (khóa ghi riêng, số thứ tự); lỗi ghi ⇒ thao tác thất bại `PERSIST_FAILED` trước kích hoạt; bỏ ghi dư khi trạng thái không đổi.
6. **File thừa** (đúng contract 005 §5): `E_PACKAGE_EXTRA_FILE` ở Studio, kiểm gói, kiểm project (TS và C++); digest gói và digest project cùng tập tệp; Studio loại `.mat-backup/`, `.mat-editor/`, tệp ẩn khi đóng gói.
7. **Giới hạn kết nối theo nguồn:** `maxConnPerSource` (mặc định 48, 4 đến 64) đếm HTTP, HTTPS, WebSocket chung lúc `accept()` (mAT patch 5; `init_connection` chạy sau bắt tay TLS nên không chặn được TLS im lặng); kèm hướng dẫn `nft ct count` ở tầng mạng. Một nguồn không chiếm quá 75 % worker (mặc định 64; chừa 16). **Cập nhật 2026-10-17:** ban đầu 24 và 60 % của 40, đổi sau khi 10 trang sau một địa chỉ (NAT, VPN) cùng F5 cần 41 kết nối (ADR-010).
8. **Quy trình:** SAST (`cppcheck`, `clang-tidy`), `cargo audit`, `npm audit`, rà license và CVE vendored, fuzz 7 mục tiêu ≥ 1 giờ, ASan + UBSan `ctest` toàn bộ trong `ci-local`, mô hình mối đe dọa, review bằng hai agent; mọi Medium có test hoặc bằng chứng.
9. **Gia cố thiết bị:** cảnh báo `SSH_ROOT_PASSWORD` và hướng dẫn; **không** tự đổi `sshd` (có thể mất truy cập): việc của người dùng (T064).
10. **Sau rà soát bảo mật 011 (T062, 2026-10-17):**
    - Giới hạn theo nguồn tính **riêng từng cổng**: mỗi CivetWeb context có nhóm worker riêng, nên một nguồn giữ tối đa min(`maxConnPerSource`, 75 % worker của cổng đó): 18 trong 24 worker HTTP, 48 trong 64 worker HTTPS, vẫn tối đa 48 cho hai cổng cộng lại (trước đó một máy giữ được cả 24 worker HTTP). Phiên dữ liệu sống của một nguồn tối đa `maxLiveClientsPerSource` (mặc định nửa `maxClients`, làm tròn lên: 5 của 10); vượt thì `MAX_CLIENTS_REACHED` có `scope: "source"`, đóng 4429 (trang 1.x xử lý như đầy). Đánh đổi: nhiều máy sau một NAT chỉ được 5 phiên, đặt 10 để giữ cách cũ.
    - Từ chối `Host` ghi audit một lần mỗi (địa chỉ, mã) mỗi phút, phần còn lại cộng trong một bản ghi tổng (`target "*"`, `detail.repeated`); `LOGIN_BUSY` có audit `auth.busy` tối đa một bản ghi mỗi phút kèm số lần.
    - Bảng khóa đăng nhập đầy thì bỏ trước cặp chưa từng khóa (giữ lịch sử nhân đôi), IP không có lần sai trong cửa sổ, tên theo dõi đã cũ hoặc ít lần sai nhất; IP `::ffff:a.b.c.d` đếm như `a.b.c.d`.
    - Tệp yêu cầu `auth-unlock.req` chỉ được dùng khi là tệp thường của root, `0600`; CLI ghi nó qua `openat` trên `dataDir` mở `O_NOFOLLOW`.
    - `system/info.warningDetails[].detail` và `device/identity.acceptedHosts` chỉ cho request có phiên (giảm thông tin dò thám công khai); Studio đọc lại `identity` bằng token sau khi đăng nhập.

## Hệ quả

- **Tốt:** đóng 18 mục Medium (hoặc ghi rõ đóng từ trước/chờ người); thêm kiểm chứng động cho từng mục; DoS đăng nhập bị bỏ.
- **Xấu:** khách dùng tên miền nội bộ phải khai `allowedHosts` sau khi nâng cấp (nhắc ở `deploy.sh`, `device/identity`, Studio); gói có file thừa từ Studio cũ phải nâng cấp sạch; driver Modbus đổi máy trạng thái.
- **Rủi ro:** botnet phân tán nhiều IP với mật khẩu yếu: ngoài phạm vi (LAN, VPN); phản hồi Modbus muộn trùng `transactionId`: bộ đếm tăng đơn điệu 16 bit, 10.000 ca ngẫu nhiên kiểm.

## Điều kiện xem xét lại

- Cần `Host` ký tự đại diện (`*.factory.local`): thêm sau, có test.
- Khách có nhiều subnet và proxy ngược: xem lại `maxConnPerSource` theo `X-Forwarded-For` (hiện bỏ qua có chủ ý).
- Xung phải nhả chính xác khi mất điện: cần phần cứng (hẹn giờ ở PLC), không giải bằng phần mềm.

## Số đo / bằng chứng

Điền ở T053 (Host, khóa), T054 (đa unit, xung, `persist`, file thừa), T063 (giới hạn kết nối, RAM trên BL335).

**x64 (2026-10-17; runtime trong Docker `mat-armhf` trên Apple Silicon, không phải x64 thật; rig dựng tay vì sandbox chặn pwsh).**

| Mục | Kịch bản | Kết quả |
|---|---|---|
| 1 Host | `host-rebind` ([011-host-x64.json](../reports/011-host-x64.json)), Chrome thật với `--host-resolver-rules` | 16/16: fetch và WebSocket từ `evil.test` nhận 421 `HOST_NOT_ALLOWED` trên HTTP và HTTPS, không đọc được dữ liệu; IP, `localhost`, tên máy, `.local`, `allowedHosts` 200 |
| 2 Khóa đăng nhập | `lockout-dos` ([011-lockout-x64.json](../reports/011-lockout-x64.json)) | 1.000 lần đoán từ IP A: chỉ 20 lần kiểm mật khẩu, 980 lần 429 (trả lời ≤ 7 ms); người dùng thật từ IP B 10/10 lần vào, chậm nhất 19 ms; audit `auth.lockout` |
| 3 Nhật ký xung | `pulse-recovery` ([011-pulse-x64.json](../reports/011-pulse-x64.json)) | 20/20 vòng `kill -9` giữa xung: bit được nhả (trung vị 7,1 s, tối đa 7,2 s sau kill), 20/20 audit `pulse-recovery`; nhật ký không ghi được: 20/20 lệnh từ chối `PULSE_JOURNAL_FAILED`, 0 bit bật |
| 4 Modbus đa unit | `gateway-multiunit` ([011-gateway-x64.json](../reports/011-gateway-x64.json)) | 1.000 chu kỳ với unit 2 câm: unit 1 và 3 GOOD 1000/1000, 0 giá trị sai, 0 kết nối TCP mới; unit 2 BAD sau 737 ms |
| 5 `persist()` | `persist-slow` ([011-persist-x64.json](../reports/011-persist-x64.json)) | fsync chậm 500 ms: `GET projects/active` p99 6 ms trong lúc nạp xuống; fsync lỗi ENOSPC: 500 `PERSIST_FAILED`, bản đang chạy và digest không đổi |
| 6 File thừa | `deploy-extra-file` ([011-extra-file-x64.json](../reports/011-extra-file-x64.json)) | 30 lần nạp xuống: tệp thừa và tệp `.mat-editor/` 20/20 bị từ chối `E_PACKAGE_EXTRA_FILE`, gói sạch 10/10 committed, 0 `HEALTH_TIMEOUT` |

**BL335 (2026-10-17, runtime 1.0.0, tank-demo, rảnh; [device-changes.md](../reports/device-changes.md)).** Host lạ `evil.test` nhận 421 trên HTTP và HTTPS; IP, tên `.local`, `localhost` 200. RSS 9,5 MB (0.9.0: 8,1 MB); 99 luồng (0.9.0: 73; tăng do `httpsThreads` 64); CPU 0,7 % một lõi trong 60 s. Cảnh báo đúng cấu hình thiết bị: `VIEWER_PUBLIC`, `TLS_NO_IP_SAN`, `SSH_ROOT_PASSWORD`. Chưa đo trên thiết bị: giới hạn kết nối theo nguồn và theo cổng, 10 trang sau một NAT (T063).

**Rà soát bảo mật (T062, [011-security-review.md](../reports/011-security-review.md) §2).** Các mục của quyết định 10 là kết quả rà soát (M1, L1–L8), đã sửa kèm test. Ghi chú: mục 2 viết "mật khẩu mới ≥ 10 ký tự"; mã (`server/cli/users.cpp`) giữ mức 15 ký tự có từ feature 005, tài liệu người dùng ghi 15.
