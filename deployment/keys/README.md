# Khóa công khai phát hành (ECDSA P-256)

Thư mục này chứa **khóa công khai** dùng để kiểm chữ ký của bản phát hành runtime (`SHA256SUMS.sig`, gói `.matupdate`). Contract: [release-signing.md](../../specs/011-pilot-hardening/contracts/release-signing.md) §5, §6; ADR: [035](../../docs/adr/035-release-trust-ota.md).

| Tệp | Khóa | Ai giữ khóa riêng |
|---|---|---|
| `release-primary.pub.pem` | khóa chính, ký mọi bản phát hành | người phát hành (token phần cứng hoặc USB mã hóa, máy ký không nối mạng) |
| `release-backup.pub.pem` | khóa dự phòng, chỉ dùng khi khóa chính bị lộ hoặc mất (ký gói `keyset` xoay khóa) | két của công ty, ở nơi khác |

**Hiện trạng (2026-10-17): chưa có khóa thật.** Hai khóa do người phát hành sinh ngoại tuyến và đưa khóa công khai vào đây ở task T103 (cần người). Trước đó `release.ps1` chạy thử bằng khóa thử sinh tại chỗ ngoài repo và không phát hành được (`release.ps1 -Release` cần `-SigningKey` và `-Keys`).

## Quy tắc

- Chỉ có `*.pub.pem` (SPKI PEM, đường cong `prime256v1` dạng named curve). **Không bao giờ** đặt khóa riêng (`*.key.pem`, `BEGIN PRIVATE KEY`) vào repo, CI hay máy dev chung. `.gitignore` bỏ mọi `*.pem` trừ `deployment/keys/*.pub.pem`; test `tools/release/sign.test.mjs` từ chối khóa riêng trong thư mục này.
- Sinh khóa: `tools/release/keygen.ps1 -OutDir <thư mục ngoài repo>` (openssl hỏi mật khẩu AES-256 cho khóa riêng). Script từ chối thư mục nằm trong repo.
- keyId của một khóa (thiết bị in cùng giá trị trong `signer.keyId`): `node tools/release/sums.mjs keyid release-primary.pub.pem`.
- Cài lên thiết bị: `deploy.sh` chép các tệp ở đây vào `/etc/mat-runtime/trusted-keys/` (root, 0644) ở lần cài đầu nếu thư mục đó chưa có khóa (T100).
- Kiểm một bản phát hành: `tools/release/verify-release.ps1 -Dir release/<ver> -Keys deployment/keys`.
- Khóa thử của test (`tests/update-vectors/keys/`) **không** đặt ở đây; `release.ps1 -Release` và `sign-sums.ps1 -Release` từ chối ký bằng khóa thử (`CERT_TEST_KEY`).
- Xoay khóa, thu hồi, lộ khóa: [docs/release/incident-keys.md](../../docs/release/incident-keys.md).
