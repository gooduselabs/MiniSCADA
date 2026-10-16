# ADR-035: Tin cậy phát hành: Authenticode cho bộ cài, ECDSA P-256 cho gói runtime, OTA do `mat-updater` (root) thực hiện, mặc định tắt

- **Trạng thái:** Proposed (feature 011, GĐ 6; quyết định "người dùng giao toàn quyền 2026-10-11"). Số đo và bằng chứng điền ở T008, T120, T122; chuyển Accepted ở Go/No-Go (T198).
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/011-pilot-hardening](../../specs/011-pilot-hardening/plan.md), research R15–R19, R31; contracts [release-signing.md](../../specs/011-pilot-hardening/contracts/release-signing.md), [update-package.md](../../specs/011-pilot-hardening/contracts/update-package.md), [device-api-011.md](../../specs/011-pilot-hardening/contracts/device-api-011.md); [ADR-012](012-project-package-deploy.md) (bố cục `.prev`, health check, khóa nạp xuống); Master Plan §11.3, §11.5, §11.9; Constitution V, VII (PATCH 2.0.2 đã chấp thuận 2026-10-16, task T004).

## Bối cảnh

Bộ cài Studio chưa có chữ ký số (khách hàng công nghiệp thường chặn file không ký; Master Plan §11.9, §14.6). Cập nhật runtime hiện là chép tay bằng SSH root (`deploy.sh`), điều khiến SSH root bằng mật khẩu thành một phát hiện Medium tồn của 005 mà không tắt được. Master Plan §11.5 dự kiến OTA có chữ ký, quay về khi lỗi. Máy dev không có chứng chỉ ký thật.

Ràng buộc: runtime chạy bằng user `matscada` với sandbox chặt (`ProtectSystem=strict`, `ReadOnlyPaths=/opt/mat-runtime`, `CapabilityBoundingSet=` rỗng, `NoNewPrivileges`); Mbed TLS 3.6.7 là thư viện mật mã có sẵn; không thêm thư viện mới; BL335 không chắc có `openssl`.

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Cập nhật runtime | chỉ thủ công; runtime tự thay chính mình (cho `matscada` ghi `/opt`); **`mat-updater` root nhỏ do systemd kích hoạt, runtime chỉ kiểm sơ bộ**; A/B phân vùng (Buildroot) | `mat-updater` (A/B phân vùng ghi vào kế hoạch sau pilot) |
| Mặc định | bật; **tắt, bật bằng cấu hình root và có khóa tin cậy** | tắt |
| Thuật toán chữ ký gói | Ed25519 (Mbed TLS 3.6 chưa hỗ trợ); RSA-3072 (chậm, lớn); **ECDSA P-256 + SHA-256** | ECDSA P-256 |
| Khóa tin cậy | X.509 và chuỗi (hạn, thu hồi, đồng hồ thiết bị); **khóa công khai trực tiếp trong `/etc/mat-runtime/trusted-keys/`, ngoài cây được cập nhật** | khóa trực tiếp |
| Đọc phong bì và kiểm | `openssl` + sh; **tệp tĩnh nhỏ `mat-update-verify` (C++, Mbed TLS) đọc tar có giới hạn cố định** | `mat-update-verify` |
| Ký bộ cài Windows | PFX trong CI; **`signtool` với kho/token, lệnh ngoài cho dịch vụ ký đám mây, và chế độ thử** | ba chế độ |
| Chống phát hành nhầm | tin người; **cổng `-Release` từ chối chứng chỉ thử, tự ký, sắp hết hạn, thiếu EKU, thiếu dấu thời gian** | cổng |
| Studio tự cập nhật | có; **không** (người dùng cài bản mới từ bộ cài ký) | không |

## Quyết định

1. **Bộ cài Studio** (`mat-studio.exe`, setup, uninstall) ký Authenticode SHA-256 kèm dấu thời gian RFC 3161 qua `tools/release/sign.ps1` (Tauri `signCommand`); ba chế độ `store`, `command`, `test`; `release.ps1 -Release` từ chối 8 điều kiện (contract release-signing §2). Chứng chỉ thật (OV hay EV, khóa phần cứng theo quy định của CA/Browser Forum) là việc công ty; dev kiểm bằng chứng chỉ thử trong kho người dùng (không đụng kho tin cậy): kỳ vọng `NotTrusted` và `HashMismatch` khi sửa. SmartScreen không cam kết hết cảnh báo ngay.
2. **Gói phát hành runtime:** `SHA256SUMS` ký ECDSA P-256 bằng khóa phát hành ngoại tuyến (hai khóa: chính, dự phòng); `.matupdate` = tar ba thành viên (`update.json`, `update.sig`, `payload.tar.gz`), chữ ký trên SHA-256 của manifest, manifest liệt kê `files[]` với băm. Chống hạ cấp bằng `releaseSeq` đơn điệu.
3. **Khóa tin cậy** ở `/etc/mat-runtime/trusted-keys/*.pem` (root, 0644), ngoài `/opt/mat-runtime`: gói không tự đổi được khóa của chính nó. Xoay bằng gói `keyset` ký bởi khóa đang tin cậy; root có `--trust-key`.
4. **OTA:** runtime (không đặc quyền) nhận qua HTTPS, role `administrator`, xác thực lại mật khẩu ở bước áp dụng, audit bền (`system.update.*`), kiểm sơ bộ rồi đặt gói vào `update/ready/` và ghi `request.json`. `mat-updater` (root, oneshot, kích hoạt bởi `mat-updater.path`) **kiểm lại toàn bộ trên bản sao của root** (không tin kiểm của runtime), giải nén sau khi đối chiếu `tar -t` với `files[]`, chạy `--self-check` dưới `matscada`, đổi tên nguyên tử `/opt/mat-runtime` ↔ `.prev`, kiểm sức khỏe 60 s, tự quay về; 8 bước, trạng thái ghi trước mỗi bước, `mat-updater-recover` xử lý gián đoạn. Runtime mới ghi audit kết quả ở lần khởi động đầu.
5. **Mặc định `update.enabled: false`**; bật cần root sửa `runtime.json`, có khóa tin cậy, khởi động lại. Quy trình thủ công (`deploy.sh`) giữ và là đường khôi phục; `deploy.sh` kiểm `SHA256SUMS.sig` bằng `mat-update-verify` khi có (cảnh báo nếu thiếu).
6. **`mat-updater` không cập nhật qua OTA** (`UPDATER_MANUAL_ONLY`): gốc tin cậy chỉ đổi bằng cài thủ công.

## Hệ quả

- **Tốt:** cập nhật từ xa không cần SSH root; tắt được SSH mật khẩu; gói tin cậy được dù kênh bị chiếm; một đường kiểm chữ ký dùng cho `deploy.sh`, OTA, `release.ps1`; sandbox của runtime không đổi.
- **Xấu:** thêm thành phần chạy bằng root (nhỏ, nhưng là bề mặt mới); phải giữ khóa ngoại tuyến và quy trình xoay; một bộ công cụ ký (Windows và openssl) cho người phát hành.
- **Rủi ro:** lỗi trong `mat-update-verify` hay `mat-updater` là lỗi đặc quyền: giảm bằng mã nhỏ, ASan + fuzz ≥ 1 giờ, 30 gói xấu, 40 lần kill, 5 lần cắt điện thật, mặc định tắt. Lộ khóa phát hành: quy trình thu hồi bằng `keyset` của khóa dự phòng; cả hai lộ thì tắt OTA và cài lại khóa thủ công.

## Điều kiện xem xét lại

- Chuyển sang Buildroot với A/B phân vùng: thay phần đổi tên thư mục bằng đổi phân vùng, giữ phong bì và chữ ký.
- Mbed TLS có Ed25519 trong nhánh LTS đang dùng: cân nhắc đổi thuật toán (gói `format` 2.x).
- Khách hàng yêu cầu cập nhật từ máy chủ trung tâm: thiết kế kênh kéo (thiết bị chủ động) riêng.

## Số đo / bằng chứng

Điền ở T008 (kích thước, thời gian kiểm trên armhf), T009 và T010 (`signtool`, Tauri `signCommand`), T120 (lab x64), T122, T123 (BL335, cần người).
