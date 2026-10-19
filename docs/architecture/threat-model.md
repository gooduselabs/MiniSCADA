# Mô hình mối đe dọa của mAT SCADA (bản 1.0)

- **Ngày:** 2026-10-17 (feature 011, T060; FR-031). Thay thế các phân tích rời ở review của 005 đến 010.
- **Phạm vi:** toàn sản phẩm: runtime `mat-runtime` trên BL335 (C++, CivetWeb, Mbed TLS, SQLite), trang vận hành trong trình duyệt, Studio (Tauri, Windows), gói project `.matscada`, gói cập nhật `.matupdate` và `mat-updater`, logic v2, driver Modbus, chuyển tiếp lịch sử tới DB ngoài.
- **Phương pháp:** liệt kê tài sản, kẻ tấn công và giao diện (ranh giới tin cậy); với mỗi giao diện: mối đe dọa (theo STRIDE), biện pháp đã có (kèm test hoặc tài liệu), rủi ro còn lại. Mọi phát hiện Medium trở lên của các review trước ánh xạ tới một dòng ở mục 6.
- **Liên quan:** [Constitution](../../.specify/memory/constitution.md) nguyên tắc V; [ADR-011](../adr/011-auth-roles-audit.md), [ADR-018](../adr/018-viewer-source-filter.md), [ADR-021](../adr/021-web-login-certificates.md), [ADR-023](../adr/023-svg-import-allowlist-uid.md), [ADR-035](../adr/035-release-trust-ota.md), [ADR-036](../adr/036-security-hardening.md), [ADR-037](../adr/037-logic-v2.md); bảng "Phát hiện tồn" của [plan 011](../../specs/011-pilot-hardening/plan.md); [hướng dẫn gia cố](../deployment/hardening.md).

## 1. Tài sản

| ID | Tài sản | Vì sao quan trọng |
|---|---|---|
| A1 | **Lệnh ghi xuống PLC** (ghi Tag, xung, ghi từ logic) | tác động vật lý lên máy; sai lệnh có thể gây hư hỏng hoặc mất an toàn |
| A2 | Tính sẵn sàng của giám sát (trang vận hành, live, alarm) | người vận hành mất tầm nhìn khi runtime ngừng hoặc chậm |
| A3 | Tài khoản và phiên (`users.json`, Argon2id, cookie `__Host-`, token Bearer) | chìa khóa của mọi thao tác có quyền |
| A4 | Project đang chạy và kho project (bản trước, dự phòng) | định nghĩa Tag, màn hình, logic, ghi; project giả = lệnh giả |
| A5 | Mã runtime (`/opt/mat-runtime`) và khóa tin cậy cập nhật (`/etc/mat-runtime/trusted-keys`) | ai thay được mã là chiếm thiết bị (root qua `mat-updater`) |
| A6 | Khóa riêng TLS của thiết bị (`/var/lib/mat-runtime/tls/server.pem`) | giả danh thiết bị với Studio và trình duyệt |
| A7 | Dữ liệu: lịch sử, alarm, audit (`history.db`, `alarm.db`, `audit.db`) | bằng chứng vận hành, truy vết; audit là yêu cầu của Constitution V |
| A8 | Bí mật DB ngoài (`/etc/mat-runtime/secrets.json`) | truy cập hệ thống khác của khách hàng |
| A9 | Máy kỹ sư (Studio, thư mục project, khóa phát hành) | đường vào mọi thiết bị của dự án |

## 2. Kẻ tấn công

| ID | Kẻ tấn công | Khả năng giả định | Ngoài phạm vi |
|---|---|---|---|
| K1 | **Máy trong LAN** (máy trạm bị nhiễm, khách cắm vào mạng OT) | gửi gói tùy ý tới 8080, 8443, 8446, 22; nhiều kết nối; giả IP nguồn trong LAN không được vì TCP | đứng giữa có ARP spoofing: HTTPS ghim chống được với Studio, HTTP 8080 thì không (mục 4) |
| K2 | **Internet qua port-forward** (cấu hình sai, hoặc trước khi gia cố) | như K1, cộng botnet nhiều IP, quét mật khẩu SSH liên tục | sản phẩm không được thiết kế để đứng trước Internet: [hardening.md](../deployment/hardening.md) mục 2, 3 |
| K3 | **Trang web độc hại** trong trình duyệt của người vận hành (DNS rebinding, CSRF, clickjacking) | chạy JS ở origin khác; đổi DNS của tên mình | lỗ của chính trình duyệt |
| K4 | **Máy kỹ sư bị chiếm** | có Studio, project, có thể có mật khẩu engineer; tạo gói tùy ý | khóa phát hành ở máy ngoại tuyến (ADR-035) |
| K5 | **Thiết bị trường độc hại hoặc hỏng** (PLC, gateway Modbus, cổng serial) | trả khung sai, chậm, quá dài, đúng CRC nhưng giá trị xấu | |
| K6 | **Người nội bộ có tài khoản thấp** (operator, viewer) | dùng API trực tiếp, bỏ qua giao diện | người có root |
| K7 | **Chuỗi cung ứng** (gói cập nhật giả, bộ cài giả, phụ thuộc độc) | đưa tệp tới thiết bị hoặc máy kỹ sư | thỏa hiệp CA Authenticode |

## 3. Ranh giới tin cậy

```text
 Internet ──(router, VPN; không port-forward)──┐
                                               │
 LAN OT: máy trạm (trình duyệt) ── HTTP 8080 / HTTPS 8443 / WS ──┐
         máy kỹ sư (Studio, Tauri IPC) ── HTTPS 8443 (ghim) ─────┤
         mọi máy ── UDP 8446 (tìm thiết bị) ─────────────────────┤
                                                                 ▼
 BL335: [mat-runtime, user matscada, sandbox systemd] ── Modbus TCP/RTU ──► PLC, gateway (K5)
          │  ghi: /var/lib/mat-runtime (dữ liệu), update/ready (gói chờ)   └─► DB ngoài (historian)
          ▼
        [mat-updater, root, oneshot] ── kiểm lại chữ ký ──► /opt/mat-runtime{,.prev}
        [root qua SSH 22 / console] ── CLI: --user-*, --trust-key, --regen-cert, sửa runtime.json
```

Runtime không có đặc quyền (`CapabilityBoundingSet=` rỗng, `ProtectSystem=strict`, `NoNewPrivileges`, `DevicePolicy=closed`, `MemoryDenyWriteExecute`, bộ lọc syscall); `/opt/mat-runtime` và `/etc/mat-runtime` chỉ đọc với nó. Thứ duy nhất chạy root là `mat-updater` (không tin kết quả kiểm của runtime) và người quản trị.

## 4. Giao diện, mối đe dọa, biện pháp

Cột "Rủi ro còn lại" là thứ chấp nhận ở bản 1.0; mục 5 gom lại.

### I-01. HTTP 8080 (trang vận hành, `/project/*`, API xem)

- **Đe dọa:** đọc dữ liệu xem không đăng nhập (K1, K2); DNS rebinding đọc dữ liệu qua trình duyệt người vận hành (K3); nghe lén và sửa trên đường truyền (không mã hóa); cạn worker (K1); XSS qua project.
- **Biện pháp:** `viewerAccess: private` (bộ lọc theo địa chỉ kết nối, bỏ `X-Forwarded-For`, ADR-018); `viewerLogin: required` khi ra ngoài LAN; **kiểm `Host`** trước mọi xử lý (IP literal luôn nhận, tên phải khai `allowedHosts`, 421 `HOST_NOT_ALLOWED`; `server/host_policy.cpp`, test `host_policy_test` 22 ca, ADR-036); kiểm `Origin` cho WebSocket; **giới hạn kết nối theo nguồn** `maxConnPerSource` lúc `accept()` (mAT patch 5, test `conn_limit_test`); CSP trang và CSP `sandbox` cho `/project/*`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, CSP riêng cho `/assets/*.svg`; ghi Tag không có trên 8080 khi không có phiên.
- **Rủi ro còn lại:** HTTP không mã hóa: người đứng giữa trong LAN đọc và sửa được trang và dữ liệu xem (không sửa được lệnh ghi: lệnh cần phiên HTTPS). Khuyến nghị: dùng `https://<IP>:8443` cho trang khi có thể; đóng port-forward 9080 ([hardening.md](../deployment/hardening.md) mục 2).

### I-02. HTTPS 8443 (đăng nhập, API kỹ sư, nạp xuống, OTA, cookie web)

- **Đe dọa:** dò mật khẩu (K1, K2); khóa tài khoản người khác (DoS); chiếm worker bằng kết nối TLS im lặng; giả danh thiết bị; CSRF từ trang độc; leo quyền bằng API (K6).
- **Biện pháp:** chỉ TLS 1.2 và 1.3 (Mbed TLS, cấu hình `third_party/mbedtls-config`, ECDSA P-256), Studio ghim fingerprint (TOFU, ADR-010), chứng chỉ có SAN IP cho Chrome (ADR-021); Argon2id; **khóa theo cặp (tên, IP)** 5 lần/5 phút nhân đôi tới 60 phút, khóa IP 20 lần/10 phút, đăng nhập đúng chỉ xóa bộ đếm cặp, `maxConcurrentLogins` (`LOGIN_BUSY`), audit `auth.distributed_attack` (`core/auth/login_guard.cpp`, test `login_guard_test` 19 ca, `auth_gate_test`); mật khẩu mới ≥ 15 ký tự; cookie `__Host-`, `Secure`, `SameSite=Strict`, kiểm `Origin` và `Sec-Fetch-Site`; vai trò viewer/operator/engineer/administrator kiểm ở máy chủ; giới hạn tốc độ ghi Tag; `httpsThreads` 64, `maxConnPerSource` 48 (≤ 75 %, ADR-010), keep-alive 3 s, hạn bắt tay 10 s; audit bền trước khi thay đổi.
- **Rủi ro còn lại:** botnet nhiều IP thử mật khẩu yếu chậm (Argon2id + 2 đồng thời giới hạn còn vài lần/giây toàn thiết bị): ngoài phạm vi khi không port-forward. Nhiều nguồn cùng lúc (≥ 2 nguồn × 48) vẫn có thể giữ hết 64 worker tới hạn: cần `nft` ([hardening.md](../deployment/hardening.md) mục 5). Đo RAM và thời gian trên BL335: chờ T063.

### I-03. WebSocket live (trên 8080 và 8443)

- **Đe dọa:** rebinding (K3); chiếm worker; tràn hàng đợi; bản tin quá lớn hoặc lồng sâu; đọc tên tài khoản trong alarm khi `viewerAccess: any`.
- **Biện pháp:** kiểm `Host` lúc nâng cấp; kiểm `Origin`; tính vào `maxConnPerSource`; `maxClients`; bản tin ≤ 96 KiB, độ sâu kiểm trước khi parse, giới hạn tần suất đăng ký; hàng đợi gửi có trần và ngắt client chậm; khách không phiên không thấy tên người ack/shelve (009 M1).
- **Rủi ro còn lại:** như I-01 khi chạy trên 8080 (không mã hóa).

### I-04. UDP discovery 8446

- **Đe dọa:** dùng làm bộ khuếch đại; lộ thông tin thiết bị; gói giả trả lời Studio (K1).
- **Biện pháp:** trả lời ngắn, không bí mật, chỉ cho nguồn cùng mạng con; tên trong gói có giới hạn độ dài (L-03); Studio không tin gói discovery: luôn ghim fingerprint qua HTTPS trước khi dùng; tắt được (`discoveryEnabled: false`); `nft` chỉ cho LAN.
- **Rủi ro còn lại:** máy trong LAN liệt kê được thiết bị (chấp nhận, như mọi thiết bị mạng).

### I-05. CLI root của `mat-runtime` và SSH

- **Đe dọa:** SSH root bằng mật khẩu ra Internet (K2); mật khẩu lộ qua dòng lệnh hoặc lịch sử shell; tệp yêu cầu mở khóa bị giả (K6 trên thiết bị).
- **Biện pháp:** mật khẩu không bao giờ là tham số (stdin, bỏ BOM); `--user-unlock-all` ghi `<dataDir>/auth-unlock.req` 0600, không theo symlink; cảnh báo `SSH_ROOT_PASSWORD` (`server/ssh_audit.cpp`, test `ssh_warning_test` 13 ca); hướng dẫn SSH chỉ khóa công khai, `PermitRootLogin prohibit-password`, đóng port-forward 22 ([hardening.md](../deployment/hardening.md) mục 4).
- **Rủi ro còn lại:** áp dụng lên thiết bị là việc người (T064 ⚠️🔌); tới khi đó SSH root mật khẩu vẫn mở trên BL335 của dự án.

### I-06. Gói project `.matscada` (nạp xuống)

- **Đe dọa:** gói độc (K4): ZIP bomb, path traversal, symlink, trùng tên khác hoa thường, file thừa không kiểm, SVG có script, project làm runtime treo.
- **Biện pháp:** chỉ engineer, qua HTTPS; trình đọc ZIP riêng kiểm thứ tự, khoảng trống, chồng lấn, tỷ lệ nén, kích thước khai trước giải nén, tối đa 1.024 entry (`core/package/`, fuzz); `isSafeRelPath`; validator C++ toàn bộ (schema, giới hạn); digest; quy trình nạp xuống có rollback tự động khi không khỏe (`HEALTH_TIMEOUT`); `persist()` ngoài mutex, lỗi ghi ⇒ `PERSIST_FAILED` trước kích hoạt (test `deploy_pipeline_test`); SVG: allowlist ở trang và Studio, CSP `sandbox` (ADR-023, 008).
- **Rủi ro còn lại:** **file thừa** chưa bị từ chối (`E_PACKAGE_EXTRA_FILE`, T022–T024 chưa xong ở mốc này): gói vẫn được kiểm từng tệp đã tham chiếu và digest lệch dẫn tới rollback, nên an toàn nhưng không gọn. Runtime C++ không parse SVG (D30): SVG độc chỉ bị chặn ở trang (allowlist + CSP).

### I-07. File project trên máy kỹ sư (Studio mở, nhập SVG)

- **Đe dọa:** project hoặc SVG độc gửi qua email (K4, K7): XSS trong WebView Studio, ReDoS, bom `use`, ảnh khổng lồ, Trojan Source trong tên.
- **Biện pháp:** bộ nhập SVG allowlist, chạy trong Worker, giới hạn công việc (`E_IMPORT_LIMIT`, `MAX_USE_*`), từ chối `DOCTYPE`; tên bỏ ký tự hai chiều; CSP Studio chặt (`connect-src` chỉ IPC, `freezePrototype`); validator TS cùng luật với C++.
- **Rủi ro còn lại:** XSS (nếu có) trong Studio dùng được mọi lệnh IPC của cửa sổ chính (008 F17, mục I-10).

### I-08. Cổng serial và Modbus (RTU, TCP, gateway)

- **Đe dọa:** thiết bị trường gửi khung xấu (K5): tràn bộ đệm, treo driver; gateway một unit câm làm mất dữ liệu cả kênh; phản hồi muộn bị gán nhầm; mở cổng serial ngoài danh sách (modem 4G).
- **Biện pháp:** parser kiểm độ dài và CRC (fuzz 006, `fuzz-modbus.ps1`); **cô lập timeout theo `transactionId`**, backoff riêng thiết bị, đóng kết nối chỉ khi lỗi khung/socket hoặc ≥ 3 timeout trên ≥ 2 thiết bị (test `modbus_tcp_multiunit_test`, ADR-036); allowlist cổng `serialPorts` (`ttyAS*`), unit `DevicePolicy=closed`, `DeviceAllow=char-ttyAS rw`; `drivers/test` chỉ engineer, 10 lần/phút, có audit.
- **Rủi ro còn lại:** giá trị đúng khung nhưng sai nghĩa từ PLC bị chiếm: ngoài phạm vi (Modbus không xác thực). `drivers/test` quét được cổng trong LAN (chấp nhận, L-08).

### I-09. DB ngoài (chuyển tiếp lịch sử: MySQL/MariaDB, SQL Server, PostgreSQL, InfluxDB)

- **Đe dọa:** lộ bí mật; SQL injection qua tên Tag; DB ngoài bị chiếm trả dữ liệu xấu cho client; thư viện client (LGPL) có lỗ.
- **Biện pháp:** bí mật ở `secrets.json` `root:matscada` 0640, không trong project, không trong audit, không core dump (`LimitCORE=0`); mọi giá trị là tham số; tên bảng/cột từ catalog được trích dẫn; thư viện client nạp động (`dlopen`) chỉ khi bật; TLS tới DB theo cấu hình của khách.
- **Rủi ro còn lại:** lỗ của thư viện client của hệ điều hành: cập nhật theo Ubuntu.

### I-10. Tauri IPC (Studio)

- **Đe dọa:** XSS trong WebView gọi lệnh ứng dụng (đọc/ghi tệp, nạp xuống, mở URL) (K4, K7).
- **Biện pháp:** `capabilities/default.json` tối thiểu; lệnh đọc tệp chỉ qua hộp thoại hệ thống, kiểm đuôi và kích thước; `csv_save` có trần và chống công thức (008 F15); `open_device_web` chỉ mở `https://<thiết bị đã lưu>` (L-04); TLS ghim theo thiết bị; CSP chặt.
- **Rủi ro còn lại:** mọi lệnh mở cho cửa sổ chính, nên XSS trong Studio có bán kính lớn hơn trang vận hành (008 F17, ghi nhận).

### I-11. Cập nhật runtime (OTA `.matupdate`, `mat-updater`)

- **Đe dọa:** gói giả hoặc hạ cấp (K7); administrator bị chiếm cài mã tùy ý; gói đổi khóa tin cậy của chính nó; gián đoạn giữa chừng làm hỏng thiết bị; path traversal trong tar.
- **Biện pháp:** (ADR-035, contract update-package) chữ ký ECDSA P-256 bằng khóa phát hành ngoại tuyến; `releaseSeq` đơn điệu chống hạ cấp; khóa tin cậy ngoài `/opt/mat-runtime`, chỉ root đổi (`--trust-key`); mặc định `update.enabled: false`; role administrator + xác thực lại mật khẩu + audit bền; `mat-updater` (root) **kiểm lại toàn bộ** trên bản sao của mình, đối chiếu `tar -t` với `files[]`, `--self-check`, đổi tên nguyên tử, kiểm sức khỏe 60 s, tự quay về; `mat-updater` không tự cập nhật qua OTA.
- **Rủi ro còn lại:** lộ khóa phát hành = cài được mã trên mọi thiết bị đã bật OTA (khóa ngoại tuyến, hai khóa, xoay bằng `keyset`); khóa thật là việc người (T097, T103). Phần mã OTA đang được làm ở US4; dòng này được kiểm lại ở review T062.

### I-12. Logic v2 (luật, timer, lịch, ghi PLC từ logic)

- **Đe dọa:** project độc (K4) dùng logic ghi PLC liên tục; vòng lặp hoặc biểu thức sâu làm treo tick; giờ sai kích hoạt lịch sai; trạng thái hỏng sau mất điện.
- **Biện pháp:** (ADR-037) không vòng lặp, không hàm người dùng, sắp xếp tô-pô (`E_LOGIC_CYCLE`); mọi ghi qua mục `writes` khai trước (Tag RW, giá trị cho phép, `minIntervalMs` ≥ 1.000, `maxPerHour`), đi qua `WriteCoordinator` với đủ chuỗi kiểm và audit bền trước khi gửi; trần `logic.maxWritesPerMin`; `logic.writes` mặc định `off`, chỉ root bật, administrator dừng được; điều kiện `unknown` ⇒ `SUSPENDED`; giờ chưa đồng bộ ⇒ lịch BAD (`TIME_NOT_SYNCED`); biểu thức có giới hạn độ dài và độ sâu (`E_EXPR_LIMIT`).
- **Rủi ro còn lại:** interlock an toàn **phải** ở PLC (ADR-037 điểm 7).

### I-13. Ghi Tag và xung (đường ghi chung của trang, Studio, logic)

- **Đe dọa:** operator ghi Tag chỉ khóa ở giao diện (K6); ghi hai lần do đua; bit xung kẹt bật sau `kill -9` hoặc mất điện; xung này chặn xung khác.
- **Biện pháp:** kiểm vai trò ở máy chủ; `requestId` khử trùng lặp trong một vùng khóa (006 #1); giới hạn tốc độ theo phiên và toàn thiết bị; **nhật ký xung** `pulse.journal` `fdatasync` trước khi bật, nhả khi khởi động (`pulse-recovery`), `PULSE_STUCK`, `PULSE_IN_PROGRESS`, nhả hẹn lại không ngủ (test `pulse_journal_test`, `write_coordinator_test`); xác nhận mặc định cho mọi ghi từ trang.
- **Rủi ro còn lại:** `minRole` của sự kiện SVG chỉ là khóa giao diện, máy chủ chỉ đòi `operator` (008 F5); mất điện lâu thì bit xung vẫn bật suốt thời gian đó: PLC phải tự nhả (D10).

### I-14. Bộ cài Studio và phụ thuộc

- **Đe dọa:** bộ cài giả (K7); phụ thuộc npm/cargo có lỗ; thư viện C/C++ vendored có CVE.
- **Biện pháp:** Authenticode SHA-256 + dấu thời gian (ADR-035, `sign.ps1`, `-Release` từ chối chứng chỉ thử); `SHA256SUMS` ký; SBOM CycloneDX; `npm audit`, `cargo audit`, bảng CVE vendored (T056), rà license (T057); SAST `cppcheck` + `clang-tidy` ([011-sast](../reports/011-sast.md)); fuzz 7 mục tiêu (T058).
- **Rủi ro còn lại:** chứng chỉ ký thật là việc công ty; SmartScreen có thể cảnh báo lúc đầu.

### I-15. Phân quyền theo người dùng và API quản trị (feature 013, ADR-042)

- **Đe dọa:** người dùng đọc dữ liệu của trang hoặc component không được cấp qua đường phụ (live, `/project/*`, `projects/active`, lịch sử, báo cáo, alarm) dù giao diện đã ẩn (K6); gửi lệnh ghi bằng tay từ component bị khóa; leo quyền qua API quản trị (vai trò thấp gọi thẳng, tự sửa vai trò của mình, CSRF từ trang độc); đoán mật khẩu admin rồi tạo tài khoản; admin tự khóa mình hoặc xóa người quản trị cuối; hai admin ghi đè nhau; kho quyền hỏng mở toang quyền; lỗ hổng trong runtime sửa được tài khoản (kho chuyển sang `/var/lib/mat-runtime/auth`, runtime ghi được).
- **Biện pháp:** quyền hiệu lực tính ở máy chủ theo phiên (`computeAccess` thuần, vector chung C++/TS); **mọi** đường dữ liệu lọc theo tập Tag được phép (bảng [admin-api §6](../../specs/013-access-control/contracts/admin-api.md)); màn hình bị cấm 403, item ẩn bị cắt khỏi tệp màn hình trả về; lệnh ghi từ cookie phải mang `context` và item phải `operate` và có Tag trong binding; quyền chỉ thu hẹp, không vượt vai trò; API quản trị chỉ administrator, chỉ HTTPS, CSRF và `Origin`, xác nhận lại mật khẩu cho thao tác nhạy cảm (tính vào khóa tạm), 30 yêu cầu/phút/phiên, thân ≤ 64 KiB, `rev` chống ghi đè (409), chặn `LAST_ADMIN`; đổi vai trò, nhóm, trạng thái, mật khẩu hủy mọi phiên của người đó; kho hỏng → chỉ administrator vào (an toàn mặc định), `.bak` để khôi phục; audit mọi thay đổi (trước/sau, không có mật khẩu) và mọi từ chối; CLI root phục hồi (`--access-reset`).
- **Rủi ro còn lại:** RR-11; quyền theo Tag dùng trực tiếp trong binding, không theo đầu vào gián tiếp của Tag tính toán hay logic (Tag tính toán là Tag riêng, phải được cấp riêng).

## 5. Rủi ro còn lại được chấp nhận ở bản 1.0

| # | Rủi ro | Vì sao chấp nhận | Giảm nhẹ |
|---|---|---|---|
| RR-1 | HTTP 8080 không mã hóa trong LAN | trang vận hành cần chạy trên máy trạm không cài chứng chỉ | dùng HTTPS khi có thể; `viewerLogin: required`; không port-forward |
| RR-2 | Botnet nhiều IP thử mật khẩu | sản phẩm cho LAN/VPN | Argon2id, ≥ 15 ký tự, audit phân tán, VPN |
| RR-3 | Nhiều nguồn cùng chiếm worker HTTPS | giới hạn theo nguồn chỉ chặn một nguồn | `nft` ở tầng mạng; worker 64 |
| RR-4 | SVG độc không bị runtime C++ từ chối (D30) | runtime không parse SVG (Constitution II) | allowlist ở trang, CSP `sandbox` |
| RR-5 | `minRole` của sự kiện SVG chỉ ở giao diện (008 F5) | thiết kế của 007 | audit, giới hạn tốc độ, xác nhận; đề xuất `writeMinRole` theo Tag sau 1.0 |
| RR-6 | Bit xung kẹt khi mất điện lâu (D10) | phần mềm không giữ được khi không có điện | PLC tự nhả; nhật ký nhả khi lên lại |
| RR-7 | Truy vấn lịch sử không hủy khi trình duyệt ngắt (010 #3) | CivetWeb không lộ socket | hạn 10 s/120 s, tối đa 2 truy vấn + 1 xuất |
| RR-8 | XSS trong Studio có bán kính IPC lớn (008 F17) | ứng dụng một cửa sổ | CSP chặt, bộ lọc chung |
| RR-9 | Gia cố thiết bị chưa áp dụng trên BL335 của dự án | đổi `sshd` có thể mất truy cập | T064 ⚠️🔌, cảnh báo `SSH_ROOT_PASSWORD` |
| RR-10 | Lộ khóa phát hành OTA | gốc tin cậy phải ở đâu đó | khóa ngoại tuyến, hai khóa, OTA mặc định tắt |
| RR-11 | Kho tài khoản do runtime ghi được (`/var/lib/mat-runtime/auth`, 013) | người dùng yêu cầu quản lý tài khoản trên web (D22); runtime vốn đã giữ quyền ghi PLC | API hẹp, xác nhận lại, audit, systemd `ProtectSystem=strict`, CLI root phục hồi |

## 6. Ánh xạ phát hiện Medium trở lên

ID `P-xx` là của bảng "Phát hiện tồn" trong [plan 011](../../specs/011-pilot-hardening/plan.md) (Medium của 005, 006, 007); ID `H-xx` là các mục Medium/High của 006 đến 010 đã đóng trong chính feature đó, ghi cùng bảng của plan để đủ truy vết. Trạng thái chi tiết và test ở plan.

| ID | Phát hiện (tóm tắt) | Mức | Dòng của mô hình | Trạng thái (2026-10-17) |
|---|---|---|---|---|
| P-01 | WebSocket/TLS chiếm hết worker HTTPS | Medium | I-02, I-03 | sửa kèm test x64; đo BL335 chờ người |
| P-02 | Đăng nhập đúng xóa bộ đếm theo nguồn | Medium | I-02 | sửa kèm test |
| P-03 | SSH root mật khẩu, port-forward 9080 | Medium | I-05, I-01 | cảnh báo + tài liệu xong; áp dụng chờ người |
| P-04 | `persist()` giữ mutex khi fsync | Medium | I-06 | sửa kèm test |
| P-05 | Gói có file thừa | Medium | I-06 | chờ làm (T022–T024) |
| P-06 | Unit chặn cổng serial | Medium | I-08 | đóng từ trước |
| P-07 | Timeout TCP làm BAD cả kênh | Medium | I-08 | sửa kèm test |
| P-08 | `::alarm(20)` và quiesce | Medium | I-06 | đóng từ trước |
| P-09 | `RetainStore::createFresh` lỗi im lặng | Medium | I-12, I-13 | đóng từ trước |
| P-10 | Khóa theo tên: DoS đăng nhập | Medium | I-02 | sửa kèm test |
| P-11 | Không kiểm `Host`: DNS rebinding | Medium | I-01, I-03 | sửa kèm test |
| P-12 | Cạn worker HTTPS bởi TLS im lặng | Medium | I-02 | sửa kèm test x64; đo BL335 chờ người |
| P-13 | Xung kẹt sau `kill -9` | Medium | I-13 | sửa kèm test; cắt điện thật chờ người |
| P-14 | `releasePulse` ngủ trên luồng xung | Medium | I-13 | sửa kèm test |
| P-15 | `ChartWindow` khi đồng hồ lùi | Medium | I-03 | sửa kèm test |
| P-16 | `ProjectStore.open()` lần hai | Medium | I-01 | đóng từ trước |
| P-17 | `mat-screen` dùng lại phần tử | Medium | I-01 | đóng từ trước |
| P-18 | `expect` chấp nhận 1–2 lệnh | Medium (test) | I-13 | đóng từ trước |
| H-01 | 006 #1: `requestId` trùng ghi hai lần | High | I-13 | đóng trong 006 |
| H-02 | 007 F-1: `httpsThreads` 8 | High | I-02 | đóng trong 007 (nay 64) |
| H-03 | 007 F-2: `*.bindings.json` không được phục vụ | High (chức năng) | I-01 | đóng trong 007 |
| H-04 | 007 R-1, R-2: kịch bản test đạt khi rỗng | High (test) | I-13 | đóng trong 007 |
| H-05 | 008 F1: ReDoS `hasDoctypeEntity` | High | I-07 | đóng trong 008 |
| H-06 | 008 F2: bom `use` treo tab | High | I-01, I-07 | đóng trong 008 |
| H-07 | 008 F3, F4: CSS và đối chiếu bậc hai | Medium | I-07 | đóng trong 008 |
| H-08 | 008 F5: `minRole` chỉ ở giao diện | Medium | I-13 | chấp nhận (RR-5) |
| H-09 | 008 F6: runtime không parse SVG | Medium | I-06 | chấp nhận (RR-4, D30) |
| H-10 | 009 M1: khách thấy tên tài khoản trong alarm | Medium | I-03 | đóng trong 009 |
| H-11 | 009 R1: luồng ghi alarm quay 100 % CPU khi đĩa đầy | High | I-03 (A2) | đóng trong 009 |
| H-12 | 009 R2, R3: override khi dừng lúc đĩa đầy; audit khi động cơ từ chối | Medium | I-13 | đóng trong 009 |
| H-13 | 010 #1, #2: bộ nhớ của `lttb` và `series` | Medium | I-02 | đóng trong 010 |
| H-14 | 010 #3: truy vấn không hủy khi ngắt | Medium | I-02 | chấp nhận (RR-7) |

Review bảo mật của 011 (T062, `docs/reports/011-security-review.md`) thêm dòng vào bảng này cho mọi phát hiện Medium trở lên mới.

## 7. Điều kiện xem lại

- Thêm giao diện mạng mới (cổng, giao thức, OPC UA, MQTT) hoặc API ghi mới.
- Sản phẩm phải đứng trực tiếp trước Internet (cần xác thực mạnh hơn, giới hạn phân tán).
- Bật OTA mặc định, hoặc đổi gốc tin cậy.
- Mỗi review bảo mật của feature sau: cập nhật mục 4 và 6.
