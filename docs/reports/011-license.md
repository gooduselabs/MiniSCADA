# Rà license feature 011 (T057; FR-027, D16)

- **Ngày chạy:** 2026-10-17, máy macOS (Apple Silicon), nhánh `gd6-release`.
- **Lệnh:** `node tools/release/license-report.mjs --out <licenses.md> --json <licenses.json>` với `cargo metadata --format-version 1 --locked` của `apps/studio/src-tauri` (Rust 1.99.1, mạng để tải metadata crate). Cùng lệnh chạy trong bước 7 của `tools/release/release.ps1`; `licenses.md` đầy đủ (836 dòng) nằm trong thư mục phát hành, không commit.
- **Chính sách** (`tools/release/lib/license-policy.mjs`): biểu thức SPDX, `OR` lấy nhánh tốt nhất, `AND` lấy nhánh xấu nhất; cấm GPL, AGPL, LGPL (link tĩnh), SSPL và họ tương tự; MPL là "có điều kiện"; không khai báo hay license lạ là "không rõ". Bị cấm hay không rõ trong bản phân phối thì dừng (mã thoát 1); gói chỉ khi phát triển chỉ cảnh báo.

## Kết quả

| Nguồn | Thành phần | Ghi chú |
|---|---|---|
| `package-lock.json` | 301 gói npm (gộp cùng tên và phiên bản) | 248 chỉ khi phát triển, 17 gói workspace của dự án, 36 gói vào bản phân phối (trang web thiết bị, Studio) |
| `Cargo.lock` | 526 crate | license từ `cargo metadata`; có cả crate chỉ cho nền tảng khác (Android, Linux, macOS) mà Cargo ghi vào lock |
| `third_party/LICENSES.md` | 9 thư viện vendored | 2 chỉ khi test (GoogleTest, meta-schema draft-07) |

- **Từ chối: 0. Không rõ: 0. Cảnh báo: 0** (sau một ghi đè, xem dưới).
- **Lần chạy đầu** dừng ở một thành phần không rõ license: `png-js` 1.1.0 (kéo theo bởi `pdfmake` → `pdfkit`, báo cáo PDF trên trình duyệt của feature 010): `package.json` của gói không có trường `license`, tệp `LICENSE` là MIT. Đã rà tay và thêm vào bảng "Ghi đè license" của `third_party/LICENSES.md` (khóa `npm:png-js@1.1.0`); chạy lại sạch.
- **MPL-2.0 (có điều kiện), 18 thành phần:**
  - `option-ext` 0.2.0 (`dirs-sys` → `dirs` → `tauri`): được link vào `mat-studio.exe`. Không sửa mã thư viện; bản phân phối nêu nơi lấy mã nguồn (crates.io).
  - `cssparser`, `cssparser-macros`, `selectors`, `dtoa-short`: chỉ chạy lúc biên dịch (`dom_query` → `tauri-utils` → `tauri-codegen`/`tauri-macros`, proc-macro), không có trong tệp thực thi (`cargo tree -i … --target x86_64-pc-windows-msvc -e normal`).
  - `axe-core`, `lightningcss` (và 11 gói nhị phân theo nền tảng): chỉ khi phát triển.
- **Có lựa chọn LGPL:** `r-efi` 5.3.0 và 6.0.0 (`MIT OR Apache-2.0 OR LGPL-2.1-or-later`, chỉ cho UEFI): chọn MIT.
- **Thư viện vendored:** CivetWeb 1.16 (MIT), nlohmann/json 3.11.3 (MIT), valijson 1.0.3 (BSD-2-Clause), SQLite 3.54.0 (public domain), Mbed TLS 3.6.7 (Apache-2.0, chọn trong Apache-2.0 OR GPL-2.0-or-later), phc-winner-argon2 20190702 (Apache-2.0, chọn trong CC0-1.0 OR Apache-2.0), miniz 3.1.2 (MIT); GoogleTest 1.15.2 và meta-schema draft-07 chỉ khi test.
- **Thư viện client DB nạp động** (MariaDB Connector/C, FreeTDS: LGPL; libpq, libcurl) không link, không phân phối: không nằm trong danh sách thành phần (xem `third_party/LICENSES.md`).

## SBOM

`node tools/release/sbom.mjs --out <sbom.cdx.json>`: CycloneDX 1.5, 836 thành phần (npm 301, cargo 526, vendored 9), 734 KB; `bom-ref` là purl; gói chỉ khi phát triển có `scope: excluded`; băm SHA-512 (npm), SHA-256 (crate, Mbed TLS, argon2, miniz), SHA3-256 (SQLite). Test `tools/release/sbom.test.mjs` kiểm 100 % gói của `package-lock.json` và `Cargo.lock` có mặt.

## Test

`node --test tools/release/license-report.test.mjs tools/release/sbom.test.mjs`: 12 test (viết trước, đỏ vì chưa có mô-đun, rồi xanh).
