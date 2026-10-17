# ADR-035: Tin cậy phát hành: Authenticode cho bộ cài, ECDSA P-256 cho gói runtime, OTA do `mat-updater` (root) thực hiện, mặc định tắt

- **Trạng thái:** Proposed (feature 011, GĐ 6; quyết định "người dùng giao toàn quyền 2026-10-11"). Số đo và bằng chứng điền ở T008, T120, T122; chuyển Accepted ở Go/No-Go (T198).
- **Cập nhật 2026-10-17 (T199):** phần OTA đã có mã và đã gộp vào `gd6` (US4: T090, T096, T100, T106–T121, T124; rà soát bảo mật T062); `mat-updater` và unit đã cài trên BL335 với OTA **tắt**; số đo dưới. Phần Authenticode (T009, T010, T091–T094, T098, T102–T105) chưa làm: chờ chứng chỉ ký mã thật (T103) và máy Windows. Vẫn Proposed.
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
7. **Số phiên bản bản rc (T191, 2026-10-18; quyết định theo ủy quyền của người dùng 2026-10-11):** Studio (`package.json`, `tauri.conf.json`, `Cargo.toml`) và runtime (`kRuntimeVersion`, `RUNTIME_VERSION`) mang **cùng một chuỗi** `1.0.0-rc.N`; định dạng project, `.matupdate`, API, giao thức live giữ số riêng. Không giữ runtime ở `1.0.0` số trần kèm nhãn kênh vì `release.ps1` đòi phiên bản đồng nhất và `mat-updater` kiểm sức khỏe bằng đúng chuỗi `runtimeVersion` = `version` của `build-info.json`. Hệ quả: (a) `minRuntimeVersion` của project so **chỉ phần số** (`compareSemver` C++ `project_validator.cpp`, TS `rules.ts`, Rust `device/mod.rs` vốn bỏ hậu tố): runtime `1.0.0-rc.1` nhận project `minRuntimeVersion` 1.0.0 và từ chối 1.0.1 (vector chung `v10-runtime-rc-*`); (b) gói cập nhật so SemVer đầy đủ (`core/update` `compareVersions`: `1.0.0-rc.1` < `1.0.0`), nên `minFromVersion` của gói 1.0.0 không được cao hơn bản rc mà pilot đang chạy; chống hạ cấp vẫn chỉ bằng `releaseSeq`; (c) bộ cài chỉ có NSIS: Tauri ghi `VIProductVersion` dạng số `1.0.0.0` (bỏ hậu tố); nếu sau này thêm MSI (WiX chỉ nhận hậu tố số) thì đặt `bundle.windows.wix.version` dạng số riêng.

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

### Số đo

**T008, spike `mat-update-verify` (2026-10-16).** Máy macOS Apple Silicon, Docker image `mat-armhf` (Ubuntu 20.04 arm64, `arm-linux-gnueabihf-g++` 9.4, `-Os -ffunction-sections -fdata-sections -Wl,--gc-sections -s`), Mbed TLS 3.6.7 vendored. **Thời gian armhf đo dưới qemu-user (`qemu-arm` 4.2.1) trên Apple Silicon, không phải Cortex-A7**; "host" là Linux arm64 chạy thẳng (không phải x64). Mã thử (không nằm trong repo): đọc tiêu đề tar 1 và 2 (tổng kiểm, `ustar`, `typeflag`, tên, trần kích thước, chặn `x`/`g`/`L`/`K`), kiểm `mbedtls_pk_verify` trên SHA-256 của `update.json`, phân tích manifest bằng nlohmann/json, băm dòng `payload.tar.gz` (khối 64 KiB), kiểm khối kết thúc (không có thành viên thứ tư). Chi tiết: [docs/reports/011-spikes.md](../reports/011-spikes.md) §1.

Kích thước tệp armhf (đã strip):

| Biến thể | Kích thước | ≤ 400 KB |
|---|---|---|
| tĩnh hoàn toàn (`-static`), cấu hình Mbed TLS tối thiểu (16 macro), có nlohmann/json | 476 316 B (465 KiB) | **không đạt** |
| tĩnh hoàn toàn, không nlohmann (trích trường thô, chỉ để đo) | 406 616 B (397 KiB) | đạt sát ngưỡng |
| tĩnh hoàn toàn, cấu hình Mbed TLS của runtime (`mat_mbedtls_config.h`) | 488 704 B (477 KiB) | không đạt |
| glibc động, `-static-libstdc++ -static-libgcc`, cấu hình tối thiểu, có nlohmann | 144 944 B (142 KiB) | đạt |
| glibc động, `-static-libstdc++ -static-libgcc`, cấu hình của runtime, có nlohmann | 157 248 B (154 KiB) | đạt |
| tham chiếu: chương trình `puts` tĩnh / có `std::string` và ngoại lệ, tĩnh | 328 628 B / 373 828 B | — |

Phần lớn kích thước bản tĩnh là glibc và libstdc++ tĩnh (≈ 370 KB); Mbed TLS (kiểm ECDSA, SHA-256, PEM) và mã đọc phong bì ≈ 30 KB, nlohmann ≈ 70 KB. Bản glibc động chỉ cần `libc.so.6`, `ld-linux-armhf.so.3`, phiên bản ký hiệu cao nhất `GLIBC_2.25`.

Thời gian (gói 1 863 680 B, payload 1 856 661 B, khóa P-256 ký bằng `openssl dgst -sha256 -sign` (OpenSSL 1.1.1f) và Node 24 `crypto.sign`, chữ ký DER 71 và 72 byte):

| Đo | armhf dưới qemu | host arm64 |
|---|---|---|
| một lần `mbedtls_pk_verify` (10 lần chạy) | 9,4–10,6 ms | 0,84–0,88 ms |
| trung bình 50 lần lặp trong một tiến trình | 7,7–8,9 ms | 0,84 ms |
| hai khóa tin cậy, khóa sai thử trước | 17,8 ms | 1,7 ms |
| băm dòng SHA-256 payload 1,86 MB | 17–21 ms | 6 ms |
| cả tiến trình (đọc khóa, kiểm, băm, in manifest), thời gian tường | 41–44 ms | ≈ 8 ms |

Kiểm chức năng (host và qemu cho cùng kết quả): 2 gói hợp lệ (ký bằng openssl, bằng Node) đạt, Node kiểm đúng chữ ký của openssl; 11 ca xấu bị từ chối đúng mã: đổi 1 byte chữ ký, khóa không tin cậy, sửa manifest sau khi ký (`UPDATE_SIGNATURE_INVALID`), sửa 1 byte payload (`PAYLOAD_DIGEST`), thành viên thứ tư (`ENVELOPE_EXTRA_MEMBER`), sai thứ tự (`ENVELOPE_ORDER`), tiêu đề pax (`ENVELOPE_HEADER`), sai tổng kiểm tiêu đề (`ENVELOPE_HEADER`), manifest > 256 KiB (`ENVELOPE_SIZE`), cắt ngang (`ENVELOPE_TRUNCATED`), không có khóa dùng được (`UPDATE_KEYS_MISSING`).

Đối chiếu điều kiện T008:

- **Thời gian ≤ 100 ms: đạt dưới qemu** (≈ 10 ms một chữ ký). Chưa có số Cortex-A7; qemu trên Apple Silicon không đại diện tốc độ BL335. Tham chiếu gián tiếp: bắt tay TLS trên BL335 trung vị 133 ms (005, `005-bl335-auth-tls.json`, gồm ECDHE, ký ECDSA và mạng). Phải đo lại trên thiết bị ở T122 (chạy `mat-update-verify --bench 50`).
- **Kích thước ≤ 400 KB: không đạt nếu bắt buộc tĩnh hoàn toàn** (465 KiB do glibc tĩnh), **đạt nếu glibc động** (142–154 KiB). Quyết định cho T111 (đề xuất, phiên chính chốt): liên kết **Mbed TLS và libstdc++ tĩnh, glibc động** (cùng glibc của hệ thống mà `mat-runtime` đã dùng), dùng thư viện `mat_mbedtls` với cấu hình hiện có (không cần cấu hình riêng: `--gc-sections` bỏ phần TLS), giữ nlohmann/json; điều kiện đổi thành "≤ 400 KB, chỉ phụ thuộc `libc.so.6`".

**T096, T124 (2026-10-17): `mat-update-verify` của sản phẩm.** Trạng thái ADR vẫn Proposed (chuyển ở T198).

| Đo | Giá trị | Ghi chú |
|---|---|---|
| kích thước armhf (Release, strip, `-Os`, `--gc-sections`, libstdc++/libgcc/Mbed TLS tĩnh, glibc động) | **214 592 B (210 KiB)**, đạt ≤ 400 KB | phụ thuộc `libc.so.6`, `libpthread.so.0` (một phần của glibc), `ld-linux-armhf.so.3`. Bản đầu dùng `std::ifstream`/`ostringstream` nặng 489 160 B (không đạt): iostream kéo theo locale của libstdc++; đọc tệp bằng `open`/`read` (`readFileLimited`) bỏ được ≈ 270 KB |
| một lần kiểm chữ ký, `--bench 50` | **7,3 ms dưới qemu-arm** (Apple Silicon) | không phải Cortex-A7: đo lại trên BL335 ở T122 |
| cả lần kiểm (đọc khóa, phong bì, chữ ký, băm, liệt kê payload) gói vector 5 KB | 17,8 ms dưới qemu | gói thật vài MB thêm thời gian băm và gunzip |

**T120 (2026-10-17): lab "x64".** `tools/update-it.ps1` (kịch bản Python trong container `mat-armhf`); **máy là Linux arm64 trong Docker trên Apple Silicon, không phải x64 thật**, runtime thật của kiến trúc đó, `mat-updater.sh` thật, `systemctl` giả khởi động và dừng runtime thật, kiểm sức khỏe 60 s và ổn định 5 s như trên thiết bị, giới hạn 1 lần/5 phút tắt trong lab. Kết quả `docs/reports/011-update-x64.json`: 9/9 kịch bản đạt.

| Kịch bản | Kết quả |
|---|---|
| ok (SC-020) | 20/20 committed; ngừng phục vụ (client hỏi `system/info` mỗi 100 ms) tối đa **9,6 s**, trung bình 9,4 s (≤ 30 s); toàn bộ (tải lên gói ≈ 3 MB, kiểm, áp dụng, kiểm sức khỏe, commit) tối đa **17,6 s**, trung bình 17,2 s (≤ 120 s) |
| bad | 31/31 gói xấu bị từ chối đúng mã và HTTP; cây cài không đổi, không còn tệp trong `update/` |
| kill (SC-021) | 40/40 (5 điểm × S1–S8, kill -9 rồi mất điện giả): luôn bản cũ (30) hoặc bản mới hoàn chỉnh (10), runtime trả lời, không tệp thừa, không thao tác treo |
| health | bản không chạy được: tự quay về sau **89,3 s** (≤ 90 s: 60 s kiểm sức khỏe + dừng, đổi tên, khởi động, kiểm bản cũ); `.failed` giữ bản hỏng |
| busy, downgrade, keyset, manual-rollback, auth | đạt (DEVICE_BUSY hai chiều, `UPDATE_DOWNGRADE`, khóa mới vào `trusted-keys/` không khởi động lại, quay về `.prev` cần mật khẩu, ma trận quyền và audit) |

Quyết định chi tiết khi làm (contract update-package §8, device-api-011 §3 "Cài đặt"): mã thoát 6; `UPDATE_KEY_UNKNOWN` không phát ra cho gói (ECDSA không cho biết khóa ký); root không đọc, không ghi dưới `<dataDir>` (đi qua `runuser -u matscada`), trạng thái gốc S4–S8 ở `/var/lib/mat-updater/ops/`; `mat-updater.service` cần AF_INET tới loopback (kiểm sức khỏe) và ghi `/etc/mat-runtime` (gói keyset); phiên đăng nhập không qua lần khởi động lại của OTA (Studio đăng nhập lại). Số BL335 thật (T122, T123) chờ người.

**BL335 (2026-10-17, [device-changes.md](../reports/device-changes.md) mục 2026-10-17).** Runtime 1.0.0 cài bằng `deploy.sh` (13 s); `mat-updater`, `mat-updater.path`, `mat-updater-recover.service` cài cùng lúc, `update.enabled` vẫn `false`, chưa có khóa tin cậy.

| Đo | Giá trị | Ghi chú |
|---|---|---|
| `mat-update-verify --bench 50`, gói vector 5 KiB, Cortex-A7 | **0,81 s cho 50 lần ≈ 16 ms một lần kiểm** (phần lớn là ECDSA P-256) | đạt ≤ 100 ms của T008 (qemu trên Apple Silicon: 7,3 ms; số thiết bị mới là số dùng) |
| unit `mat-updater` làm cứng (rà soát T062: `CapabilityBoundingSet`, `PrivateDevices`, đọc có giới hạn, `mv -T`) | `systemd-analyze verify` sạch; yêu cầu thử `op:"noop"` được đọc qua `runuser` rồi bỏ, unit `Succeeded` | hai cảnh báo `pam_limits` vô hại |

**Rà soát bảo mật (T062, [011-security-review.md](../reports/011-security-review.md) §1).** High K1 (phát lại gói keyset cũ để thêm lại khóa đã thu hồi) đã sửa: `trusted-keys/keyset-seq` giữ `releaseSeq` của keyset cuối, gói keyset không mới hơn bị từ chối `UPDATE_DOWNGRADE`. Hai Medium thiết kế, quyết định 2026-10-17 (người dùng giao quyền): O1 (op `rollback` không cần chữ ký: `matscada` bị chiếm có thể quay về `.prev` mỗi 300 s) **chấp nhận là rủi ro còn lại** vì `.prev` là bản đã ký và từng được cài, có audit; O2 (một khóa tin cậy bất kỳ ký được keyset gỡ mọi khóa khác) **hoãn sau pilot** (M-of-N cần đổi định dạng envelope), giảm thiểu bằng hai khóa phát hành giữ tách biệt và thu hồi ngay khi lộ. Rà soát lần hai (T202, §7): N-OTA1–3 và các Low đã sửa. Fuzz bộ đọc phong bì 1 giờ ASan + UBSan, 0 sự cố ([011-fuzz-x64.json](../reports/011-fuzz-x64.json)).

**T122 (2026-10-18): 10 cập nhật OTA thật trên BL335** ([011-ota-bl335.json](../reports/011-ota-bl335.json), [device-changes.md](../reports/device-changes.md) mục 2026-10-18). Gói armhf 5,8 MB (106 tệp, runtime 1.0.0 của `gd6`, releaseSeq 2 đến 11, ký bằng khóa **thử**, chỉ tin cậy trong lúc thử), gửi qua đúng các endpoint Studio dùng (tải lên, `apply` có xác thực lại mật khẩu, `GET /system/update`), qua LAN; giới hạn 1 lần/5 phút giữ nguyên. **10/10 `committed`** và quay về bằng tay 6 → 5 `committed` (mật khẩu sai trước đó: 403 `REAUTH_FAILED`). Thời gian ngừng (từ `apply` tới khi `system/info` trả releaseSeq mới, project active cùng digest, HTTPS trả lời) **13,2–15,9 s** (trung bình 14,5 s; ≤ 30 s); dịch vụ thật sự không trả lời **1,0–1,3 s** (systemd dừng tới chạy 0,7–1,0 s); phần lớn thời gian ngừng là `mat-updater` kiểm lại, giải nén và tự kiểm bản mới (11–13,7 s) trong khi bản cũ vẫn phục vụ; toàn bộ (tải lên tới commit) **21,1–24,0 s** (≤ 120 s); tải lên và kiểm của runtime 2,2–2,6 s; `mat-update-verify` trên gói 5,8 MB ở Cortex-A7 1,33 s; quay về bằng tay 8,7 s. Audit đủ cho mỗi lần (`system.update.accepted`, `.applying`, `.committed`; `.manual-rollback` started/ok; `auth.reauth` 11 ok, 1 failed; `system.keys.updated`). Cả lượt (11 thao tác) 52,5 phút do giới hạn 300 s.

**Chưa đo (chờ người, thiết bị):** cắt điện giữa S4 đến S7 trên BL335 (T123); toàn bộ phần ký bộ cài Windows.
