# Contract: ký số bộ cài, chữ ký phát hành và quy trình phát hành

**Feature**: [spec.md](../spec.md) FR-047 đến FR-056, SC-017 đến SC-019 · **ADR**: [035](../../../docs/adr/035-release-trust-ota.md) · Gói cập nhật: [update-package.md](update-package.md)

Hai loại chữ ký tách biệt, hai chuỗi tin cậy khác nhau:

| Đối tượng | Chữ ký | Người kiểm | Khóa |
|---|---|---|---|
| Bộ cài Studio (`.exe`), `mat-studio.exe`, trình gỡ | Authenticode SHA-256 + dấu thời gian RFC 3161 | Windows (SmartScreen, Explorer, `signtool`) | chứng chỉ ký mã do CA công cộng cấp (OV hoặc EV) |
| `SHA256SUMS`, gói `.matupdate`, `mat-runtime-armhf.tar.gz` | ECDSA P-256 + SHA-256 | `mat-update-verify` trên thiết bị và trên máy dev | khóa phát hành riêng của dự án (ngoại tuyến) |

## 1. `tools/release/sign.ps1`

```text
sign.ps1 -Path <file...> [-Mode store|command|test] [-Thumbprint <sha1>] [-Command <chuỗi>] [-Timestamp <url>] [-Release]
```

| Chế độ | Cách ký | Dùng khi |
|---|---|---|
| `store` | `signtool sign /fd SHA256 /sha1 <thumbprint> /tr <tsa> /td SHA256 /d "mAT SCADA Studio" /du <url> <file>` | chứng chỉ trong kho Windows hoặc token phần cứng (nhà cung cấp ký qua CSP/KSP) trên máy ký |
| `command` | chạy lệnh ngoài `-Command` với `{file}` thay bằng đường dẫn | dịch vụ ký đám mây (ví dụ trình khách của nhà cung cấp) |
| `test` | như `store` với chứng chỉ thử (CN chứa `TEST`), **không** dấu thời gian bắt buộc | máy dev |

- Mật khẩu, mã PIN token, khóa riêng **không** nằm trong tham số dòng lệnh, repo, log. Mã PIN do trình điều khiển token hỏi; chế độ `command` nhận bí mật qua biến môi trường của người dùng chạy script.
- Mọi lần ký: in dấu vân tay chứng chỉ, chủ thể, hạn, và URL dấu thời gian đã dùng; ghi vào `release/<ver>/signing-log.json` (không có bí mật).
- URL dấu thời gian mặc định để người phát hành điền theo CA (đa số CA cung cấp máy chủ RFC 3161 công khai); script thử ba lần với các URL cấu hình trong `tools/release/timestamp-urls.json` (mặc định rỗng: phát hành bắt buộc điền).

## 2. Cổng `-Release`

`release.ps1 -Release` và `sign.ps1 -Release` **từ chối và dừng** (mã thoát khác 0, không tạo `release/<ver>/`) khi chứng chỉ ký:

| # | Điều kiện từ chối | Mã |
|---|---|---|
| 1 | chủ thể hoặc tên thân thiện chứa `TEST` (không phân biệt hoa thường) | `CERT_TEST` |
| 2 | tự ký (chủ thể bằng người phát hành) hoặc không dựng được chuỗi tới gốc đáng tin của Windows | `CERT_SELF_SIGNED` |
| 3 | hết hạn hoặc còn ≤ 30 ngày | `CERT_EXPIRING` |
| 4 | thiếu EKU Code Signing `1.3.6.1.5.5.7.3.3` | `CERT_EKU` |
| 5 | thuật toán khóa dưới RSA 3072 hoặc ECDSA P-256; băm dưới SHA-256 | `CERT_WEAK` |
| 6 | ký xong mà thiếu dấu thời gian (`signtool verify /pa /v` không có "The signature is timestamped") | `NO_TIMESTAMP` |
| 7 | chữ ký không kiểm lại được sau khi ký | `VERIFY_AFTER_SIGN` |
| 8 | cây git có thay đổi chưa commit hoặc mã commit không có trong `build-info.json` | `DIRTY_TREE` |

Chế độ không `-Release` (thử) bỏ điều kiện 2, 3, 6, 8 và cho phép chứng chỉ `TEST`, nhưng **luôn** in dòng "BẢN THỬ, KHÔNG PHÁT HÀNH" và đặt `build-info.json.release = false`.

## 3. Chứng chỉ thử

`tools/release/make-test-cert.ps1`:

```powershell
New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=mAT SCADA TEST - NOT FOR RELEASE" `
  -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -CertStoreLocation Cert:\CurrentUser\My `
  -NotAfter (Get-Date).AddDays(90)
```

- Chỉ vào `Cert:\CurrentUser\My`; **không** thêm vào `Cert:\CurrentUser\Root`/`TrustedPublisher`, không cần quyền admin.
- Lệnh gỡ: `make-test-cert.ps1 -Remove` (cũng gỡ bản sao `New-SelfSignedCertificate` để lại ở `Cert:\CurrentUser\CA`).
- Kiểm kỳ vọng: `Get-AuthenticodeSignature` trả `Status = NotTrusted` hoặc `UnknownError` có thông điệp "root ... not trusted" (Windows 11 build 26200 trả `UnknownError`; chữ ký toán học đúng, gốc chưa tin) và `SignerCertificate.Thumbprint` đúng; `signtool verify /pa /v` trả lỗi chuỗi tin cậy (mã 1) nhưng báo tính toàn vẹn đúng; sửa một byte: `Status = HashMismatch`.
- Kiểm trong cô lập (Windows Sandbox hoặc máy ảo) với gốc thử đã nhập tay là bước tùy chọn ⚠️🔌; không thực hiện trên máy dev.

## 4. Ký Tauri/NSIS

`apps/studio/src-tauri/tauri.conf.json` (đã xác nhận bằng mã `tauri-cli` 2.12.1/`tauri-bundler` 2.10.1, spike T010, [research R15](../research.md#r15-authenticode)):

```json
"signCommand": {
  "cmd": "powershell",
  "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "../../../tools/release/sign.ps1", "-Path", "%1"]
}
```

- Dạng đối tượng, không dạng chuỗi: dạng chuỗi bị tách theo từng dấu cách, không hiểu nháy.
- `%1` phải là **một đối số trơn**, không nháy, không ghép: bundler chỉ thay đối số bằng đúng `%1`.
- Không đặt `%VAR%` trong lệnh: bundler gọi trực tiếp (không mở rộng), còn trình gỡ NSIS chạy qua `cmd.exe` (có mở rộng). Chế độ, dấu vân tay, lệnh ngoài, log, cờ phát hành đi qua biến môi trường `MAT_SIGN_MODE` (mặc định `test` ở máy dev, `store` hoặc `command` trên máy ký), `MAT_SIGN_THUMBPRINT`, `MAT_SIGN_COMMAND`, `MAT_SIGNING_LOG`, `MAT_SIGN_RELEASE`; tiến trình ký thừa hưởng môi trường của `tauri build`.
- Đường dẫn tương đối tính từ `apps/studio/src-tauri` (thư mục hiện tại của `tauri build`), bundler đổi thành tuyệt đối.
- Không đặt `certificateThumbprint`, `digestAlgorithm`, `timestampUrl` trong repo: có `signCommand` thì bundler bỏ qua chúng.

Tệp Tauri gọi lệnh này, theo thứ tự: `mat-studio.exe` (sau khi vá binary), 5 DLL plugin NSIS trong bản sao `target/release/nsis/x64/Plugins/`, `uninstall.exe` (qua `!uninstfinalize` trong lúc `makensis`), bộ cài `mAT Studio_<ver>_x64-setup.exe`. Ký lỗi làm dừng bản dựng, **trừ trình gỡ**: NSIS bỏ qua mã thoát của `!uninstfinalize` và đóng gói trình gỡ chưa ký.

Sau khi dựng, `release.ps1` tự kiểm cả ba tệp: `mAT Studio_<ver>_x64-setup.exe`, `mat-studio.exe` và `uninstall.exe`. Hai tệp sau **trích từ bản cài thử im lặng** vào thư mục tạm bằng `/S /D=...` rồi gỡ: `target/release/mat-studio.exe` trong cây dựng là bản **chưa ký** vì bundler chép lại binary gốc sau khi đóng gói. `uninstall.exe` `NotSigned` là lỗi dừng.

## 5. Khóa phát hành ECDSA

- Hai khóa: **chính** (`release-primary`) và **dự phòng** (`release-backup`), ECDSA P-256, sinh bằng `openssl ecparam -name prime256v1 -genkey` trên máy không nối mạng hoặc trong token phần cứng nếu hỗ trợ; khóa riêng PEM mã hóa bằng mật khẩu mạnh (AES-256) nếu không ở token.
- Lưu: khóa chính trên token/USB mã hóa do người phát hành giữ; khóa dự phòng ở két của công ty ở nơi khác. **Không** ở trong repo, CI hay máy dev chung.
- Khóa công khai (SPKI PEM) nằm trong repo `deployment/keys/release-primary.pub.pem`, `release-backup.pub.pem` và được `deploy.sh` cài vào `/etc/mat-runtime/trusted-keys/` ở lần cài đầu.
- Ký: `openssl dgst -sha256 -sign <key> -out SHA256SUMS.sig SHA256SUMS`; `make-update.mjs` ký manifest bằng `crypto.sign('sha256', ..., {key, dsaEncoding: 'der'})`.
- Kiểm: `mat-update-verify SHA256SUMS --sig SHA256SUMS.sig --keys deployment/keys/` (mã thoát 0).
- **Khóa thử** (`tests/update-vectors/keys/`) chỉ cho test; `release.ps1 -Release` từ chối ký bằng khóa có `keyId` nằm trong danh sách khóa thử (`CERT_TEST_KEY`).

## 6. Xoay khóa, thu hồi, lộ khóa

| Tình huống | Làm gì |
|---|---|
| Xoay định kỳ (mỗi 24 tháng) | tạo khóa mới; phát gói `keyset` (kind `keyset`) **ký bằng khóa đang tin cậy**, `add` khóa mới; đợi mọi thiết bị nhận; gói `keyset` kế tiếp `remove` khóa cũ |
| Khóa chính bị lộ hoặc nghi ngờ | dùng khóa **dự phòng** ký gói `keyset` `add` khóa mới và `remove` khóa chính (không `remove` chính khóa đã ký); thiết bị không nhận OTA được thì root chạy `--trust-key remove <keyId>` tại chỗ hoặc qua `deploy.sh`; thông báo khách hàng ghi ở `docs/release/incident-keys.md`; kiểm lại mọi gói đã phát hành bằng khóa cũ |
| Cả hai khóa bị lộ | OTA không còn tin được: tắt `update.enabled` trên mọi thiết bị (cấu hình), cài lại khóa mới bằng `deploy.sh` thủ công |
| Chứng chỉ Authenticode bị lộ | yêu cầu CA thu hồi; phát bản mới ký bằng chứng chỉ mới; dấu thời gian của chữ ký cũ không còn đủ để tin: thông báo người dùng gỡ bản cũ |
| Chứng chỉ Authenticode hết hạn | chữ ký có dấu thời gian trước ngày hết hạn vẫn hợp lệ; bản mới cần chứng chỉ mới (gia hạn trước 60 ngày) |

## 7. `tools/release/release.ps1`

```text
release.ps1 [-Release] [-SkipCi] [-Version 1.0.0-rc.3]
```

Các bước (dừng ở lỗi đầu tiên):

1. kiểm cổng điều kiện: cây git sạch, phiên bản đồng nhất ở `package.json`, `tauri.conf.json`, `Cargo.toml`, `CMakeLists.txt`, `build-info`;
2. `ci-local.ps1` (bỏ bằng `-SkipCi` chỉ ở chế độ thử);
3. dựng Studio (`npm run studio:build`, `CARGO_TARGET_DIR=C:\build\mat-studio`), ký (§4), kiểm;
4. dựng gói runtime armhf (`deployment/package-runtime.ps1`) và `.sha256`;
5. dựng `.matupdate` (`make-update.mjs`), ký bằng khóa phát hành (§5);
6. `SHA256SUMS` của mọi tệp trong `release/<ver>/`, `SHA256SUMS.sig`;
7. `sbom.mjs` → `sbom.cdx.json`; `license-report.mjs` → `licenses.md` (từ `package-lock.json`, `Cargo.lock`, `third_party/LICENSES.md`; thành phần không rõ license làm dừng);
8. `RELEASE-NOTES.md` (từ `docs/release/notes/<ver>.md`), `build-info.json`;
9. `verify-release.ps1` kiểm lại tất cả và chạy 12 ca hỏng (§8).

Đầu ra: `release/<ver>/` (không commit; `.gitignore`).

**Số phiên bản bản rc (T191):** `<ver>` = `1.0.0-rc.N`, cùng chuỗi ở Studio và `kRuntimeVersion`/`RUNTIME_VERSION` (bước 1 so đúng chuỗi; CMake nếu khai `VERSION` chỉ so phần số). `minRuntimeVersion` của project so phần số (rc.N nhận 1.0.0); `minFromVersion` của `.matupdate` so SemVer đầy đủ (rc.N < 1.0.0). Bộ cài NSIS dùng `VIProductVersion` số (`1.0.0.0`). Lý do: ADR 035 quyết định 7.

## 8. 12 ca hỏng bắt buộc của `verify-release.ps1`

| # | Ca | Kết quả |
|---|---|---|
| 1 | sửa 1 byte của bộ cài | `HashMismatch` |
| 2 | sửa 1 byte của `mat-studio.exe` (sao chép ra thư mục tạm) | `HashMismatch` |
| 3 | gỡ chữ ký của bộ cài (`signtool remove /s`) | `NotSigned` |
| 4 | thay chữ ký bằng chữ ký của chứng chỉ khác | dấu vân tay sai, từ chối |
| 5 | bỏ dấu thời gian | `NO_TIMESTAMP` (chế độ phát hành) |
| 6 | sửa 1 dòng của `SHA256SUMS` | `mat-update-verify` mã 3 |
| 7 | sửa 1 byte của `SHA256SUMS.sig` | mã 3 |
| 8 | dùng khóa công khai khác | mã 4 |
| 9 | sửa 1 byte của tệp có trong `SHA256SUMS` | băm không khớp |
| 10 | thêm tệp không có trong `SHA256SUMS` | từ chối (tệp thừa) |
| 11 | xóa tệp có trong `SHA256SUMS` | từ chối (tệp thiếu) |
| 12 | `.matupdate` đổi `releaseSeq` | `mat-update-verify` mã 3 |

## 9. Cài thử và SmartScreen (⚠️🔌)

Danh mục kiểm trên Windows 10 (1809 trở lên) và 11 sạch (máy ảo hoặc máy thật), cài offline: ghi `winver`, có hỏi quyền admin không, hộp "Nhà phát hành đã biết" (UAC) hiện đúng tên người phát hành, SmartScreen có chặn không (ảnh chụp/mô tả nguyên văn), dấu vân tay chứng chỉ khớp tài liệu, gỡ cài đặt sạch (`studio-install.md`). Không cam kết hết cảnh báo SmartScreen: danh tiếng do Microsoft tính theo lượt tải và loại chứng chỉ, có thể cần thời gian tích lũy; ghi kết quả thật.
