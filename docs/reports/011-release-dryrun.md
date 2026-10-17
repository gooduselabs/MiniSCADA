# Chạy thử quy trình phát hành (T102; SC-017, SC-018)

- **Ngày:** 2026-10-17. **Máy:** macOS (Apple Silicon), PowerShell 7.6.7, Node 24.21.0, Rust 1.99.1, LibreSSL 3.3.6. Nhánh `gd6-release`, cây git sạch (`build-info.json`: `dirty = false`).
- **Phạm vi:** phần chạy được ngoài Windows. **Chưa chạy** (cần Windows, chứng chỉ, hoặc task khác): dựng và ký Studio, Authenticode và ca hỏng 1–5, `.matupdate` và ca hỏng 12, `ci-local.ps1`, dựng gói runtime từ mã nguồn. Đây **không** phải kết quả đạt của SC-017, SC-018: hai tiêu chí này cần lần chạy trên Windows (mục cuối).

## Lệnh

```powershell
pwsh -File tools/release/keygen.ps1 -OutDir ~/build/wt-release/keys -NoEncrypt     # hai khóa thử, ngoài repo
pwsh -File tools/release/release.ps1 -SkipCi -Skip studio `
  -RuntimeTarball <repo chính>/build/mat-runtime-armhf.tar.gz `
  -SigningKey ~/build/wt-release/keys/release-primary.key.pem -Keys ~/build/wt-release/pub `
  -OutDir ~/build/wt-release/out -Force
```

Gói runtime dùng bản armhf dựng sẵn ngày 2026-10-16 trong thư mục `build/` của repo chính (agent này không dùng Docker).

## Kết quả theo bước

| Bước | Kết quả | Thời gian |
|---|---|---|
| 1 cổng điều kiện | đạt; cảnh báo phiên bản lệch (Studio 0.8.0, runtime 1.0.0, CMake chưa khai `VERSION`: nâng ở T191); `releaseSeq` 1; kiểm chứng chỉ Authenticode BỎ QUA (chỉ Windows) | 0,6 s |
| 2 `ci-local.ps1` | BỎ QUA (`-SkipCi`) | – |
| 3 dựng, ký, kiểm Studio | BỎ QUA (bộ cài NSIS, Authenticode chỉ trên Windows) | – |
| 4 gói runtime armhf | gói dựng sẵn, `.sha256` tính lại | 0,1 s |
| 5 `.matupdate` | BỎ QUA: chưa có `tools/release/make-update.mjs` (T106, T117) | – |
| 7 SBOM, license | `sbom.cdx.json` 836 thành phần; `licenses.md` 0 từ chối, 18 MPL | 2,2 s |
| 8 ghi chú, build-info | `RELEASE-NOTES.md` giữ chỗ (chưa có `docs/release/notes/0.8.0.md`), `build-info.json` | 0,7 s |
| 6 `SHA256SUMS` và chữ ký | 6 tệp; ký bằng `openssl dgst -sha256 -sign` (khóa P-256 named curve), tự kiểm lại, keyId `sha256:1c96d4a5…531a` | 0,2 s |
| 9 `verify-release.ps1` | đạt phần Node; 6/6 ca hỏng chạy được bị từ chối | 0,2 s |
| **Tổng** | | **4,3 s** (không gồm CI, dựng Studio, dựng runtime) |

Tệp trong thư mục kết quả:

| Tệp | Byte |
|---|---|
| `mat-runtime-armhf.tar.gz` | 5 038 091 |
| `mat-runtime-armhf.tar.gz.sha256` | 91 |
| `sbom.cdx.json` | 734 477 |
| `licenses.md` | 67 005 |
| `build-info.json` | 806 |
| `RELEASE-NOTES.md` | 91 |
| `SHA256SUMS` | 512 |
| `SHA256SUMS.sig` | 70 |

Thiếu so với FR-052: bộ cài Studio, `.matupdate` (BỎ QUA, ghi trong `build-info.json` mục `skipped`), `signing-log.json` (chỉ có khi ký Authenticode).

Kiểm độc lập bằng công cụ khác: `openssl dgst -sha256 -verify release-primary.pub.pem -signature SHA256SUMS.sig SHA256SUMS` cho "Verified OK", khóa `release-backup` cho "Error Verifying Data"; `shasum -a 256 -c SHA256SUMS` khớp cả 6 tệp.

## 12 ca hỏng

| # | Ca | Kết quả lần này |
|---|---|---|
| 1 | sửa 1 byte bộ cài | BỎ QUA (Authenticode, chỉ Windows) |
| 2 | sửa 1 byte `mat-studio.exe` | BỎ QUA (như trên) |
| 3 | gỡ chữ ký bộ cài | BỎ QUA (như trên) |
| 4 | chữ ký của chứng chỉ khác | BỎ QUA (như trên) |
| 5 | bỏ dấu thời gian | BỎ QUA (như trên) |
| 6 | sửa 1 dòng `SHA256SUMS` | từ chối: SIG_INVALID, HASH_MISMATCH |
| 7 | sửa 1 byte `SHA256SUMS.sig` | từ chối: SIG_INVALID |
| 8 | khóa công khai khác | từ chối: KEY_UNKNOWN |
| 9 | sửa 1 byte tệp có trong `SHA256SUMS` | từ chối: HASH_MISMATCH |
| 10 | thêm tệp | từ chối: EXTRA_FILE |
| 11 | xóa tệp | từ chối: MISSING_FILE, ARTIFACT_MISSING |
| 12 | `.matupdate` đổi `releaseSeq` | BỎ QUA ở lần chạy này (không có `.matupdate`); test `verify-release.test.mjs` từ chối ca này trên gói mẫu (MATUPDATE_SIG_INVALID) |

Kiểm chữ ký `SHA256SUMS.sig` dùng bản Node (`tools/release/sums.mjs`, cùng mã thoát 0/3/4/5 với `mat-update-verify`); khi có `mat-update-verify` (T096), truyền `-Verifier` để dùng bản C++.

## Cổng `-Release`

- Ngoài Windows: `release.ps1 -Release` dừng ngay (NOT_WINDOWS), `-Release -SkipCi` dừng (SKIP_NOT_ALLOWED); không tạo thư mục kết quả.
- 8 điều kiện từ chối (chứng chỉ TEST, tự ký, hết hạn hoặc ≤ 30 ngày, thiếu EKU, khóa yếu, thiếu dấu thời gian, không kiểm lại được, cây git bẩn) và khóa thử: `tools/release/gate.test.mjs`, mỗi điều kiện một mã, cả bản đọc chứng chỉ X.509 thật bằng PowerShell (chứng chỉ sinh bằng openssl trong thư mục tạm: TEST tự ký, RSA 2048, không EKU, còn 10 ngày). `sign.ps1 -Release -Mode command` ngoài Windows bị từ chối (VERIFY_AFTER_SIGN, không kiểm lại được chữ ký).

## Tìm thấy khi chạy thử (đã sửa)

- `keygen.ps1` với LibreSSL: `openssl genpkey -algorithm EC` mặc định ghi tham số đường cong tường minh; Node vẫn báo `prime256v1` nhưng SPKI dài hơn 91 byte, keyId khác thiết bị. Sửa: thêm `-pkeyopt ec_param_enc:named_curve`; `sums.mjs keyid` và thư mục khóa tin cậy từ chối khóa dạng tường minh (có test).
- `release.ps1`: gọi script PowerShell con bằng mảng làm tham số chỉ truyền theo vị trí; đổi sang hashtable. Tóm tắt bước lỗi kiểu trên PowerShell 7; viết lại cách dựng.
- `.gitignore` mục `release/` che cả `tools/release/` và `docs/release/`; đổi thành `/release/`.

## Lượt T191: `1.0.0-rc.1` (2026-10-18, macOS)

Nhánh `gd6-rc1` sau khi nâng phiên bản và có `docs/release/notes/1.0.0-rc.1.md`; cây git sạch (`build-info.json`: `dirty = false`). Chạy **từng bước bằng các script Node mà `release.ps1` gọi**, theo đúng thứ tự và tham số của `release.ps1` không `-Release`: phiên agent bị sandbox chặn gọi `pwsh` nên không chạy được chính `release.ps1` (lần sau chạy `pwsh -File tools/release/release.ps1 -SkipCi -Skip studio -RuntimeTarball … -OutDir <ngoài repo> -Force`). Thư mục kết quả ngoài repo, khóa thử sinh tại chỗ (`sums.mjs genkey`), không commit.

| Bước | Kết quả |
|---|---|
| 1 cổng | `build-info.mjs versions --expect 1.0.0-rc.1`: **đồng nhất** (Studio `package.json`, `tauri.conf.json`, `Cargo.toml`, `kRuntimeVersion`; CMake chưa khai `VERSION`); `releaseSeq` 1 (không có `releaseSeq.txt`); Authenticode BỎ QUA (chỉ Windows) |
| 2 `ci-local.ps1` | BỎ QUA: chạy riêng sau khi gộp |
| 3 Studio | BỎ QUA: bộ cài NSIS, Authenticode chỉ dựng trên Windows |
| 4 gói runtime | gói dựng sẵn của repo chính (2026-10-18 01:45; `build-info.json` bên trong là **1.0.0**, chưa dựng lại với chuỗi rc.1), `.sha256` tính lại |
| 5 `.matupdate` | `make-update.mjs --test --version 1.0.0-rc.1 --release-seq 1`: 5.804.032 B, 106 tệp. Chỉ để thử chữ ký: payload là cây 1.0.0 nên `mat-updater` sẽ quay về (sức khỏe đòi `runtimeVersion` = 1.0.0-rc.1); bản thật dựng gói runtime từ mã nguồn (bước 4 không `-RuntimeTarball`) |
| 7 SBOM, license | 836 thành phần (npm 301, cargo 526, vendored 9); 0 từ chối, 18 MPL (cần `cargo` trong `PATH`, không thì 526 crate UNKNOWN và license-report từ chối) |
| 8 ghi chú, build-info | `RELEASE-NOTES.md` = `docs/release/notes/1.0.0-rc.1.md`; `build-info.json` `1.0.0-rc.1`, `release = false`, `skipped` = ci, studio, runtime-prebuilt |
| 6 `SHA256SUMS` | 7 tệp; ký `openssl dgst -sha256 -sign` (như `sign-sums.ps1`), kiểm lại bằng `sums.mjs verify`: hợp lệ |
| 9 kiểm | `verify-release.mjs --break-cases`: mọi mục OK (thiếu bộ cài, được phép ở chế độ thử); ca hỏng 6–12 **7/7 bị từ chối**, 1–5 BỎ QUA (Authenticode) |

Tổng ≈ 55 s (gồm SBOM/license với `cargo metadata`). Đây vẫn **không** phải kết quả đạt của SC-017, SC-018 (cần Windows, chứng chỉ, mục dưới).

## Còn lại trên Windows (T091, T093, T102 phần Windows)

1. `tools/release/make-test-cert.ps1` (T091) tạo chứng chỉ thử trong `Cert:\CurrentUser\My`.
2. `bundle.windows.signCommand` của Tauri gọi `sign.ps1` (T093, spike T010): ký `mat-studio.exe`, bộ cài, trình gỡ.
3. `release.ps1` (không `-Release`) trên Windows với chứng chỉ thử: đủ 9 mục, `verify-release.ps1 -BreakCases` chạy ca 1–5, đo thời gian (SC-018 ≤ 30 phút không tính CI).
4. `release.ps1 -Release` với chứng chỉ thử phải dừng ở CERT_TEST, CERT_SELF_SIGNED.
5. Thay bản Node bằng `mat-update-verify` (T096) qua `-Verifier`; `.matupdate` khi có `make-update.mjs` (T106, T117).

## Lượt 2026-10-18: `release.ps1` thật bằng pwsh trên macOS (T191)

Lệnh: `pwsh tools/release/release.ps1 -SkipCi -RuntimeBin ~/build/mac-armhf/armhf/bin/mat-runtime -Force` (chế độ thử, khóa thử sinh ngoài repo), cây `gd6` sạch, phiên bản đồng nhất `1.0.0-rc.1`. Tổng 5,9 s; tạo `release/1.0.0-rc.1/` (thư mục bị bỏ qua bởi git).

| Bước | Kết quả |
|---|---|
| 1 cổng | đạt (Authenticode bỏ qua: chỉ Windows) |
| 2 `ci-local` | bỏ qua (`-SkipCi`; đã chạy riêng, xanh trên cùng commit) |
| 3 Studio, ký | bỏ qua: chỉ dựng được trên Windows (T102, T104) |
| 4 gói runtime armhf | đạt (5,9 MB, đủ `schemas/0.1` … `1.0`) |
| 5 `.matupdate` | đạt (5,8 MB, 106 tệp, runtime `1.0.0-rc.1`) |
| 7 SBOM, license | đạt |
| 8 RELEASE-NOTES, build-info | đạt |
| 6 `SHA256SUMS`, chữ ký | đạt |
| 9 `verify-release` | đạt; ca 1–5 (Authenticode) bỏ qua: chỉ Windows |

Lần chạy đầu với `-Verifier <mat-update-verify armhf>` dừng ở bước 5 ("mã null"): binary armhf không chạy được trên macOS. Trên máy không phải armhf thì không truyền `-Verifier` (make-update kiểm bằng bộ kiểm Node).
