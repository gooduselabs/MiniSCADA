---

description: "Task list — Làm việc với thiết bị từ Studio"
---

# Tasks: Làm việc với thiết bị từ Studio

**Input**: `specs/005-device-online/` (plan.md, spec.md, research.md R1–R19, data-model.md, contracts/, quickstart.md)

**Tests**: **Bắt buộc, viết trước** (Constitution VI; spec FR-036). Mỗi task "Test" phải chạy **đỏ** trước task cài đặt tương ứng; ghi kết quả đỏ/xanh vào "ghi chú khi làm".

- **C++:** GoogleTest + CTest, build x64 trong Docker (`deployment/toolchain/test-x64.ps1`); smoke armhf dưới qemu-user (`deployment/toolchain/smoke-armhf.sh`).
- **TS:** Vitest; e2e Chrome headless + axe-core với lớp Tauri giả (`npm run e2e -w @mat/studio`).
- **Rust:** `cargo test --lib` trong `apps/studio/src-tauri`, với `$env:CARGO_TARGET_DIR='C:\build\mat-studio'` (ổ D: gần đầy).
- **Vector chung C++, Rust, TS:** `tests/package-vectors/`, `tests/discovery-vectors/`, `tests/project-vectors/` (thêm tập file và digest).
- **Tích hợp x64:** `tools/device-it.ps1 -Scenario …` trên mạng Docker riêng.

**Quy ước**:

- **Constitution V, thứ tự bảo mật:** không viết route hay lệnh Tauri nạp xuống, đọc lên, khôi phục (`/api/v1/project/*`, `device_deploy`, `device_restore`, `device_fetch_package`) trước Checkpoint "Mốc bảo mật" của Phase 2. Mốc này gồm HTTPS có chứng chỉ, đăng nhập, role, khóa tạm và audit chạy trên x64 và qemu armhf. Tìm thiết bị không cần đăng nhập (gói trả lời không có bí mật), nên phần tìm thiết bị của US1 làm song song với Phase 2 được.
- **Thiết bị BL335 ⚠️🔌:** chỉ làm khi người dùng cho phép rõ (câu hỏi 4 của plan).
  - Ghi mọi thay đổi vào `docs/reports/device-changes.md`, kèm cách hoàn tác.
  - Không đụng dịch vụ của sản phẩm cũ (`atscada-*`). Không ghi mật khẩu vào repo.
  - BL335 không có `sudo`: lệnh root chạy trực tiếp; lệnh chỉ đọc chạy bằng `runuser -u matscada --`.
- **⏸ Qn:** task phụ thuộc câu hỏi n ở mục "Câu hỏi cho người dùng" của plan. Task ghi phương án mặc định đang dùng; người dùng chọn khác thì sửa task trước khi làm.
  - Q1: `synchronous=FULL` cho `audit.db` (mặc định: FULL, chờ chấp thuận; phương án B là file nối đuôi + `fdatasync`).
  - Q2: làm việc từ xa (mặc định: hỗ trợ VPN và port-forward, khuyến nghị VPN, không tự mở cổng; 9080 giữ tới GĐ 2).
  - Q3: băm Argon2id thay PBKDF2; token phiên trong header thay cookie + CSRF (mặc định: Argon2id, header).
  - Q4: ai, khi nào thử trên BL335 (mặc định: chưa được phép, mọi task ⚠️🔌 chờ).
  - Q5: độ dài mật khẩu tối thiểu (mặc định: 15 ký tự).
- **Phối hợp với feature 004** (phiên khác đang làm 004 Phase 4–6, tức T056–T077 của 004):
  - task ghi **"sau 004 Phase 4–6"** sửa file mà 004 đang hoặc sẽ sửa: `apps/studio/src/{app,model,ui,i18n}/*` của 004, `apps/studio/vite.config.ts`, phần `invoke_handler` của `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `specs/004-studio-shell/contracts/commands.md` (thêm lệnh mới). Chỉ bắt đầu khi 004 đã đánh dấu xong T056–T077 (plan: tối thiểu T071 của 004 và mọi task giao diện chạm cùng file);
  - task ghi **"file chung với 004"** chỉ thêm dòng vào file mà 004 Phase 4–6 không sửa (`src-tauri/Cargo.toml`, dòng `mod` của `lib.rs`, `packages/live-client/src/*`, `packages/project-schema/src/{index,codes}.ts`). Báo phiên 004 trước khi sửa; không phối hợp được thì làm sau 004 Phase 4–6;
  - file mới của 005 (phần lớn mã) làm ngay, không chờ 004.
- **Thư viện:** phiên bản cố định, phát hành ≥ 2 tuần trước ngày chọn (ADR-009; ngày chọn 2026-10-11, tức trước 2026-09-27). Mỗi thư viện mới có task rà license và ghi `third_party/LICENSES.md`. Không GPL/LGPL.
- **Ổ D:** còn khoảng 4,2 GB.
  - Vector lớn (gói 50 MiB + 1 byte, gói > 200 MiB sau giải nén) sinh lúc chạy test vào `tests/package-vectors/out/`, không commit.
  - Build Rust ở `C:\build\mat-studio`. Xóa `build/x64`, `build/armhf` cũ khi ổ D: còn < 500 MB.
- **Mật khẩu thử:** test và `device-it` sinh ngẫu nhiên mỗi lần chạy, không ghi vào repo; có test tìm chuỗi mật khẩu thử trong log và dữ liệu (SC-005).
- **File dùng chung khi làm song song:** mỗi file test C++ mới thêm một dòng `mat_test(...)` vào `CMakeLists.txt`. Test chạy CivetWeb trong tiến trình link thêm `civetweb_runtime` (như `startup_test`). Mỗi thư viện mới thêm một dòng vào `third_party/LICENSES.md`. Các dòng thêm này không tính là xung đột giữa các task [P].
- Không commit khi người dùng chưa yêu cầu.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác file, không phụ thuộc task chưa xong)
- **[Story]**: US1…US4 theo spec.md
- **⚠️🔌**: cần BL335 thật, cần người dùng cho phép
- **⏸ Qn**: chờ câu trả lời câu hỏi n của plan (đang làm theo phương án mặc định ở trên)

---

## Phase 1: Setup (thư viện, khung build)

- [X] T001 Vendor Mbed TLS 3.6.7 vào `third_party/mbedtls/` (research R4, R19):
  - tải bản phát hành từ GitHub Releases vào scratchpad; kiểm SHA-256 với giá trị công bố;
  - kiểm ngày phát hành 2026-07-07 (≥ 2 tuần) và trang security advisories của Mbed TLS. Có bản 3.6.x mới hơn, đủ 2 tuần và vá lỗi bảo mật thì chọn bản đó, ghi chú lại;
  - chỉ chép `include/`, `library/`, `LICENSE` (và `NOTICE` nếu có); thêm `VERSION.txt`. Không đặt tên `VERSION`: ổ NTFS mount vào Docker không phân biệt hoa thường, trùng `#include <version>` (ghi chú T001 của 003);
  - rà license: Apache-2.0 OR GPL-2.0-or-later, chọn Apache-2.0, giữ thông báo bản quyền;
  - thêm dòng vào bảng đầu của `third_party/LICENSES.md`: phiên bản, license đã chọn, thư mục, dùng ở, nguồn, SHA-256, ngày tải.

  **Ghi chú khi làm:**
  - bản phát hành 2026-07-07, SHA-256 `a7e8bcbe…2d11f6` khớp giá trị công bố trong ghi chú phát hành;
  - 3.6.7 là bản 3.6.x mới nhất; mọi advisory đợt 2026-07 đã vá trong 3.6.7, advisory Everest chỉ ảnh hưởng 4.1.0;
  - chép `.c`/`.h` của `include/{mbedtls,psa}` và `library/`, kèm `LICENSE` và `VERSION.txt`. Upstream không có `NOTICE`. Không chép CMakeLists, Makefile;
  - file chép giống hệt bản gốc; không có hai tên trùng nhau khi bỏ phân biệt hoa thường.
- [X] T002 [P] Vendor phc-winner-argon2 20190702 vào `third_party/argon2/` (R7, R19):
  - chỉ `include/argon2.h`, `src/{argon2.c,core.c,core.h,ref.c,encoding.c,encoding.h,blake2/}` và `LICENSE`; thêm `VERSION.txt`; kiểm SHA-256 bản tải;
  - rà license CC0-1.0 OR Apache-2.0, ghi license đã chọn;
  - đây là bản phát hành mới nhất (2019): tra issue bảo mật đã biết, ghi kết quả;
  - thêm dòng vào `third_party/LICENSES.md`.

  **Ghi chú khi làm:**
  - SHA-256 `daf972a8…30442c` (commit `62358ba2…`). Upstream không công bố giá trị băm;
  - license chọn Apache-2.0 vì có cấp quyền sáng chế, CC0 thì không;
  - không có CVE. Sau tag chỉ có 27 commit sửa build, README, URL. PR mở #299 (ghi tràn bộ đệm) chỉ ở công cụ dòng lệnh `run.c`, không vendor;
  - thêm `src/thread.h`: `core.c` include nó vô điều kiện; với `ARGON2_NO_THREADS` thì file rỗng;
  - từ `blake2/` chỉ chép 4 file; bỏ `blamka-round-opt.h` (chỉ `opt.c` bản SSE dùng).
- [X] T003 [P] Vendor miniz 3.1.2 vào `third_party/miniz/` (R12, R19):
  - chỉ phần `tinfl` và `mz_crc32` (`miniz.h`, `miniz_common.h`, `miniz_tinfl.{c,h}`, `miniz.c` nếu CRC32 cần, `LICENSE`); thêm `VERSION.txt`. Không dùng API zip của miniz;
  - kiểm ngày phát hành 2026-07-01 và SHA-256; rà license MIT;
  - thêm dòng vào `third_party/LICENSES.md`.

  **Ghi chú khi làm:**
  - **lệch:** dùng `miniz.c`/`miniz.h` gộp sẵn của bản phát hành. Các file `miniz_common.h`, `miniz_tinfl.{c,h}` không có trong bản phát hành, và bản nguồn tách file cần `miniz_export.h` do CMake sinh. Đã kiểm: mọi file nguồn của tag 3.1.2 nằm nguyên văn trong bản gộp;
  - SHA-256 `f0446d86…140d9a`, trùng digest GitHub ghi cho file. Upstream không công bố giá trị băm riêng;
  - "chỉ tinfl và CRC32" bảo đảm bằng cờ biên dịch (T006). `nm` của thư viện chỉ còn `tinfl_*`, `mz_crc32`, `mz_adler32` và vài hàm phụ, không tham chiếu malloc hay stdio. `tinfl_decompress_mem_to_heap` vẫn còn nhưng luôn trả NULL.
- [X] T004 Test `core/crypto/tests/mbedtls_config_test.cpp` (viết trước; đỏ vì chưa có file cấu hình), kiểm bằng `#if`/`static_assert` theo R4:
  - **bật:** `MBEDTLS_SSL_SRV_C`, `MBEDTLS_SSL_PROTO_TLS1_2`, `MBEDTLS_SSL_PROTO_TLS1_3`, ECDHE với X25519 và secp256r1, `MBEDTLS_ECDSA_C`, `MBEDTLS_GCM_C`, `MBEDTLS_CHACHAPOLY_C`, `MBEDTLS_SHA256_C`, `MBEDTLS_SHA384_C`, `MBEDTLS_X509_CRT_PARSE_C`, `MBEDTLS_X509_CRT_WRITE_C`, `MBEDTLS_PEM_PARSE_C`, `MBEDTLS_PEM_WRITE_C`, `MBEDTLS_CTR_DRBG_C`, `MBEDTLS_PSA_CRYPTO_C`, `MBEDTLS_THREADING_C`, `MBEDTLS_THREADING_PTHREAD`;
  - **tắt:** `MBEDTLS_SSL_CLI_C`, `MBEDTLS_SSL_PROTO_DTLS`, `MBEDTLS_SSL_RENEGOTIATION`, `MBEDTLS_KEY_EXCHANGE_RSA_ENABLED`, `MBEDTLS_CIPHER_MODE_CBC`, `MBEDTLS_DEBUG_C`.

  **Ghi chú khi làm:**
  - thêm kiểm lúc chạy: đúng phiên bản 3.6.7, đúng 6 bộ mã hóa, chỉ hai đường cong x25519 và secp256r1, `psa_crypto_init` chạy được;
  - **đỏ (a):** biên dịch với cấu hình mặc định của upstream ra 8 `#error`: thiếu file cấu hình, THREADING tắt; CLI_C, DTLS, RENEGOTIATION, RSA, CBC, DEBUG bật;
  - **đỏ (b):** chưa có file cấu hình thì CMake báo `fatal error: mat_mbedtls_config.h: No such file or directory`.
- [X] T005 `third_party/mbedtls-config/mat_mbedtls_config.h` (dùng qua `MBEDTLS_CONFIG_FILE`), đạt T004. Mỗi nhóm cờ có chú thích ngắn dẫn R4.

  **Ghi chú khi làm:**
  - xanh 4/4;
  - cờ thêm ngoài danh sách R4, lý do ghi trong file:
    - `NET_C`, `FS_IO`: CivetWeb cần;
    - `HKDF_C`, `SSL_KEEP_PEER_CERTIFICATE`: TLS 1.3 của 3.6 bắt buộc;
    - `PSA_KEY_STORE_DYNAMIC`; `ECDSA_DETERMINISTIC` + `HMAC_DRBG_C`; `AES_ROM_TABLES`;
    - `ERROR_C`, `VERSION_C`;
  - `MBEDTLS_SSL_CIPHERSUITES`: 6 bộ AEAD, ChaCha20-Poly1305 đứng đầu.
- [X] T006 Sửa `CMakeLists.txt`:
  - target `mat_mbedtls` (STATIC, C; `MBEDTLS_CONFIG_FILE="mat_mbedtls_config.h"`; `-w -O2`), `mat_argon2` (STATIC; `ARGON2_NO_THREADS`), `mat_miniz` (STATIC; chỉ giữ `tinfl` và CRC32, ví dụ `MINIZ_NO_STDIO MINIZ_NO_TIME MINIZ_NO_ARCHIVE_APIS MINIZ_NO_DEFLATE_APIS`, chốt khi làm);
  - `civetweb_runtime`: bỏ `NO_SSL`, thêm `USE_MBEDTLS` và cờ chốt ở T007, link `mat_mbedtls`. Target `civetweb` của `mat-poc` giữ `NO_SSL`;
  - target `mat_device` (STATIC) cho `core/{crypto,auth,audit,package,project-store,diagnostics,discovery}`, link `mat_core mat_sqlite mat_mbedtls mat_argon2 mat_miniz`; tạo cùng file nguồn đầu tiên (T017);
  - `mat_cli`, `mat-runtime` và hàm `mat_test` link thêm `mat_device`;
  - `build armhf` và `build x64 + ctest` vẫn xanh; ghi kích thước `mat-runtime` armhf trước và sau vào ghi chú khi làm.

  **Ghi chú khi làm:**
  - target đã thêm:
    - `mat_mbedtls`: mọi `library/*.c`, `-w -O2`, `MBEDTLS_CONFIG_FILE` truyền PUBLIC;
    - `mat_argon2`, `mat_miniz`;
  - `civetweb_runtime` dùng `USE_MBEDTLS NO_CGI USE_WEBSOCKET NO_FILES`; `civetweb` của `mat-poc` giữ `NO_SSL`;
  - `mat_device` để sang T017, tạo cùng file nguồn đầu tiên;
  - kiểm riêng ở scratchpad, x64 và armhf dưới qemu:
    - vector Argon2id của RFC 9106 đúng;
    - chuỗi PHC mã hóa rồi kiểm lại được;
    - tinfl giải nén đúng;
    - CRC32("123456789") = `cbf43926`;
  - `mat-runtime` armhf:
    - 1 957 896 → 2 202 212 byte (+244 316); bản strip 1 512 540 → 1 696 996;
    - `NEEDED` không đổi; không phụ thuộc libssl;
  - `build armhf` và `build x64 + ctest` (385/385) xanh.
- [X] T007 Spike CivetWeb 1.16 + Mbed TLS 3.6.7 (R4 ghi "cờ chính xác chốt ở task spike"):
  - build `civetweb_runtime` với `USE_MBEDTLS` cho x64 và armhf. Chỗ nào của `mod_mbedtls.inl` không biên dịch với API 3.6 thì sửa thành bản vá cục bộ, đánh dấu "mAT patch";
  - chạy một context HTTPS tối thiểu trong test tạm (chứng chỉ sinh lúc chạy, không commit khóa); bắt tay TLS 1.2 và 1.3 bằng `curl` của image x64 (T008);
  - đọc vòng bắt tay ở `mod_mbedtls.inl` (dòng 207–216) để chuẩn bị bản vá 3 (T037);
  - ghi cờ, lỗi gặp và cách sửa vào ghi chú khi làm và ADR-010 mục "Số đo / bằng chứng". Kết quả có thể làm sửa T005, T006.

  **Ghi chú khi làm:**
  - `mod_mbedtls.inl` biên dịch với 3.6.7 không cần sửa: không có "mAT patch" mới;
  - **đỏ:** test link với CivetWeb `NO_SSL` thì 0/4; **xanh:** với `USE_MBEDTLS` 4/4;
  - với `USE_MBEDTLS`, `ssl_protocol_version` và `ssl_cipher_list` không có tác dụng: chính sách TLS nằm trọn trong file cấu hình;
  - bắt tay bằng curl 7.68 / OpenSSL 1.1.1f:
    - TLS 1.2 chọn `ECDHE-ECDSA-CHACHA20-POLY1305`;
    - TLS 1.3 chọn theo thứ tự của client (`TLS_AES_256_GCM_SHA384`);
    - nhóm X25519, P-256;
    - từ chối: bộ CBC, trao đổi khóa RSA, client chỉ có P-384;
  - Studio xếp ChaCha20-Poly1305 lên đầu: quyết định ở ADR-010, áp ở US1 Rust;
  - 40 kết nối đồng thời mỗi loại 1.2 và 1.3, 4 worker: 40/40 trên x64 và qemu armhf;
  - **client im lặng lúc bắt tay: 1498 ms CPU trong 1500 ms** (x64). Bản vá 3 (T037) là bắt buộc;
  - mỗi kết nối đóng đúng cách in `SSL read failed, error -30848` (close_notify): sửa cùng T037. Kết quả `mbedtls_ssl_setup` chưa được kiểm: sửa cùng T037;
  - test tạm `server/tests/tls_spike_test.cpp` xóa ở T036/T041;
  - chi tiết ở ADR-010, mục "Số đo / bằng chứng".
- [X] T008 [P] `deployment/toolchain/Dockerfile`: thêm `curl openssl` (amd64) để test HTTPS, smoke armhf và `device-it` có client TLS và lệnh `openssl x509 -fingerprint -sha256`. Chú thích trong file: chỉ dùng cho test, binary thiết bị không link.

  **Ghi chú khi làm:** `curl` 7.68.0-1ubuntu2.25, `openssl` 1.1.1f-1ubuntu2.24. `openssl x509 -fingerprint -sha256` in đúng `SHA256 Fingerprint=AB:…`. Image `mat-armhf` đã build lại.
- [X] T009 [P] Khai báo crate Rust. **File chung với 004** (`apps/studio/src-tauri/Cargo.toml`, `apps/studio/src-tauri/src/lib.rs`):
  - thêm `rustls` 0.23.45 (`default-features = false`, features `ring`, `std`, `tls12`), `tokio-rustls` 0.26.5 (không bật provider mặc định), `tokio-tungstenite` 0.30.0 (`default-features = false`, `handshake`), `if-addrs` 0.15.0, `zeroize` 1.9.0;
  - bật feature cho crate đã có trong `Cargo.lock`: `reqwest` 0.13.5 (`rustls-no-provider`, `json`, `stream`), `flate2` 1.1.10, `tokio` (`net`, `time`, `fs`, `io-util`, `sync`; thêm `rt-multi-thread`, `macros` cho test nếu chưa có), `uuid` (`v4`), `base64`, `getrandom`;
  - dev-dependency `rcgen` để sinh chứng chỉ thử lúc chạy test, không commit khóa (phiên bản và license rà ở T010);
  - `lib.rs`: chỉ thêm `mod device; mod discovery; mod package;`, không đổi `invoke_handler`. Tạo `src/device/mod.rs`, `src/discovery.rs`, `src/package/mod.rs` rỗng;
  - `cargo build` và `cargo test --lib` xanh (23 test cũ), `CARGO_TARGET_DIR=C:\build\mat-studio`.

  **Ghi chú khi làm:**

  - crate mới ghi phiên bản cố định `=`: rustls 0.23.45 (`ring`, `std`, `tls12`), tokio-rustls 0.26.5, tokio-tungstenite 0.30.0 (`handshake`), if-addrs 0.15.0, zeroize 1.9.0; dev `rcgen` 0.14.10 (`pem`, `ring`); crate có sẵn: reqwest 0.13.5, flate2 1.1.10, tokio, uuid `v4`, base64 0.23.1, getrandom 0.4.3;
  - lệch: `reqwest` thêm `default-features = false` (mặc định kéo aws-lc-rs, http2…); feature `query` không bật nên T068 mã hóa query bằng `Url::query_pairs_mut`; `macros`, `rt-multi-thread` của tokio để ở `[dependencies]` (để ở dev thì tokio và cả chồng Tauri biên dịch hai lần); thêm `futures-util` 0.3.34 (`sink`, `std`) cho T071;
  - smoke tạm (đã gỡ) chứng minh bộ feature đủ: TLS 1.2/1.3 với verifier ghim SHA-256 có kiểm chữ ký, reqwest `tls_backend_preconfigured` + `http1_only`, WebSocket qua tokio-rustls, rcgen, if-addrs, zeroize, uuid v4, base64url, flate2;
  - phiên chính quyết định thêm: `[lib] crate-type = ["rlib"]` (bỏ `staticlib`, `cdylib` của template Tauri — Studio chỉ chạy desktop; build nhanh hơn, đỡ khoảng 1 GB đĩa).
- [X] T010 Rà license và tuổi phiên bản crate Rust (R19), sau T009:
  - `cargo tree -e normal,dev` liệt kê mọi crate mới kéo theo (ví dụ `rustls-webpki`, `rustls-pki-types`, `untrusted`, `tungstenite`, `rcgen`); mỗi crate ghi license; không GPL/LGPL;
  - mỗi crate mới phát hành ≥ 2 tuần trước ngày chọn: `tokio-rustls` 0.26.5 chứ không 0.26.6, `zeroize` 1.9.0 chứ không 1.9.1;
  - `cargo tree -d` không thêm phiên bản trùng của `reqwest`, `flate2`, `tokio`, `sha2`;
  - `ring` cần trình biên dịch C: Visual Studio C++ đã có trên máy dev;
  - ghi bảng vào `third_party/LICENSES.md`, mục "Phụ thuộc của Studio (feature 005)"; ghi rõ `rcgen` chỉ dùng khi test.

  **Ghi chú khi làm:**

  - hạ 7 crate chưa đủ 2 tuần (dựng lại lock, chỉ thay đúng mục, `--locked` chấp nhận): hyper 1.12.0 → 1.11.1, want 0.3.2 → 0.3.1, mio 1.2.4 → 1.2.3, tokio-util 0.7.20 → 0.7.19, lazy_static 1.5.1 → 1.5.0, và theo quyết định của phiên chính tokio 1.53.2 → 1.53.1, uuid 1.28.0 → 1.26.1 (đã rà changelog và RustSec: không mất bản vá bảo mật nào cần);
  - không GPL/LGPL; ngoài MIT/Apache-2.0 có ISC (ring, rustls-webpki, untrusted), BSD-3-Clause (subtle), CDLA-Permissive-2.0 (chỉ trong lock); `cargo tree -d` không thêm bản trùng của reqwest, flate2, tokio, sha2; bảng đầy đủ (~85 crate) ở `third_party/LICENSES.md` mục "Phụ thuộc của Studio (feature 005)";
  - `cargo build`, `cargo test --lib` 23/23, `cargo clippy --all-targets` (1 cảnh báo cũ của 004), `cargo fmt --check`, `npm run build -w @mat/studio`, `cargo build --release --features tauri/custom-protocol` đều xanh.
- [X] T011 [P] Cấu trúc thư mục và lint:
  - tạo `tests/package-vectors/`, `tests/discovery-vectors/`, `tests/device-it/`, `core/{crypto,auth,audit,package,project-store,diagnostics,discovery}/tests/`, `server/{tls,discovery}/`;
  - thêm `tests/package-vectors/*.mjs`, `tests/discovery-vectors/*.mjs`, `tests/device-it/*.mjs` vào glob `lint` và `format` của `package.json` gốc và vào `eslint.config.mjs`;
  - `.gitignore`: `tests/package-vectors/out/`, `tests/device-it/out/`.

  **Ghi chú khi làm:**
  - thư mục rỗng chưa vào git: không thêm README hay file giữ chỗ;
  - glob lint/format dùng một mẫu gộp `tests/{project-vectors,package-vectors,discovery-vectors,device-it}/*.mjs`, vì một mẫu không khớp file nào làm prettier và eslint thoát mã 2. Đã thử glob phủ `device-it` bằng một file thử, rồi xóa file đó;
  - `eslint.config.mjs` bỏ qua `tests/package-vectors/out/**`, `tests/device-it/out/**`;
  - bẫy ctest: `-Filter` lọc theo tên test GoogleTest (ví dụ `MbedtlsConfig`), không theo tên file chạy. Lọc sai thì ctest báo "No tests were found" mà vẫn thoát mã 0.

**Checkpoint**:

- `./tools/ci-local.ps1` xanh. Chưa có logic mới; `civetweb_runtime` build được với Mbed TLS cho x64 và armhf.
- `cargo test --lib` xanh.
- `third_party/LICENSES.md` có Mbed TLS, Argon2, miniz và các crate Rust mới.

---

## Phase 2: Foundational — nền bảo mật trên thiết bị và định dạng dùng chung (Constitution V)

**Mục đích**: HTTPS có chứng chỉ tự sinh, đăng nhập, phân quyền theo role, khóa tạm và audit chạy được trên x64 và qemu armhf **trước** mọi API nạp xuống, đọc lên. Kèm định dạng và vector dùng chung cho C++, Rust, TS: gói, gói tìm thiết bị, digest, tập file của project.

**⚠️ CRITICAL**: không có route `/api/v1/project/*` hay lệnh Tauri nạp xuống, đọc lên trước Checkpoint của phase này.

### Cổng quyết định

- [X] T012 ⏸ Q1–Q5 Ghi câu trả lời 5 câu hỏi của plan khi người dùng trả lời; sửa các task bị ảnh hưởng trước khi làm chúng.
  - **Q1:** người dùng chấp thuận thì sửa Constitution 2.0.0 → 2.0.1 (PATCH, mục "Ràng buộc công nghệ", ngoại lệ thứ hai cho `audit.db`) bằng `/speckit-constitution`, cập nhật ADR-011 mục "Ngoại lệ Constitution cần chấp thuận". Không chấp thuận: T024, T025 chuyển sang phương án B (`core/audit/audit_file.*`: file nối đuôi + `fdatasync`, tự viết lọc, phân trang, xóa cũ), giữ nguyên giao diện `AuditLog`.
  - **Q2:** ghi vào `docs/plans/roadmap-v2.md` (quyết định 5) và ADR-010; ảnh hưởng T154, T163.
  - **Q3:** giữ PBKDF2 thì T026, T032 dùng PBKDF2-HMAC-SHA256 600.000 vòng của Mbed TLS, và SC-007 (≤ 1 s) phải sửa ở spec. Chọn cookie thì thêm đường cookie `HttpOnly; Secure; SameSite=Strict` + CSRF vào T040, T042, T068.
  - **Q4:** ghi ai làm, khi nào, cho phép những gì cho từng task ⚠️🔌 (T055, T158–T165).
  - **Q5:** độ dài tối thiểu mới áp vào T026, T032, T045, T154.

  **Ghi chú khi làm (2026-10-11):** người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11. Câu trả lời ghi ở plan.md mục "Câu hỏi cho người dùng": Q1 chấp thuận → Constitution 2.0.1, ADR-011; Q2 VPN/đường hầm SSH/port-forward, không tự mở cổng, 9080 giữ tới GĐ 2; Q3 Argon2id + header; Q4 cho phép task BL335 qua SSH/web, trừ cắt điện thật và tìm thiết bị từ máy Windows cùng LAN (cần người tại chỗ); Q5 15 ký tự. Không task nào phải sửa: mọi task đã viết theo đúng các phương án này; T025 được bật `synchronous=FULL`.

  Task này chỉ chặn việc bật `synchronous=FULL` ở T025. Các task khác làm theo phương án mặc định.

### Vector chung (viết trước; C++, Rust, TS cùng chạy)

- [X] T013 [P] `tests/package-vectors/generate.mjs` (Node, không thêm phụ thuộc: `zlib.deflateRawSync`, `crypto`) và các vector của [contracts/matscada-package.md](contracts/matscada-package.md) §9. Mỗi vector một thư mục gồm `package.matscada` (hoặc được sinh) và `expected.json` (`{ "ok": true, "digest": … }` hoặc `{ "code": "E_PKG_…", "path"?: … }`):
  - **hợp lệ:** `tank-demo` nén deflate, `tank-demo` stored (cùng digest), project có tên file tiếng Việt;
  - **ZIP bomb:** một entry 1 MiB nén còn khoảng 1 KiB (`E_PKG_RATIO`); tổng sau giải nén > 200 MiB (`E_PKG_SIZE`); entry chồng lấn kiểu Fifield; kích thước khai báo nhỏ hơn dữ liệu thật;
  - **đường dẫn:** `../x.json`, `/etc/x.json`, `a\b.json`, `C:x.json`, `CON.json`, `a./b.json`, `A.json` cùng `a.json`, symlink (thuộc tính Unix `S_IFLNK`), entry thư mục, sâu 9 cấp (`E_PKG_PATH`); đuôi `.js` (`E_PKG_TYPE`);
  - **cấu trúc** (`E_PKG_FORMAT`): ZIP64, mã hóa, data descriptor, extra field, comment, dữ liệu thừa trước entry đầu, dữ liệu thừa sau EOCD, header cục bộ khác central;
  - **nội dung:** checksum sai và kích thước sai (`E_PKG_CHECKSUM`), file ngoài manifest (`E_PKG_UNLISTED`), manifest thiếu file (`E_PKG_MISSING`), digest sai (`E_PKG_DIGEST`), `projectId` của manifest khác `project.json` (`E_PKG_IDENTITY`), `formatVersion` 2.0.0 (`E_PKG_FORMAT_VERSION`), khóa `password` trong `tags.json` và khóa riêng PEM trong SVG (`E_PKG_SECRET`);
  - **kích thước:** gói 50 MiB + 1 byte (`E_PKG_TOO_LARGE`), 1025 entry (`E_PKG_ENTRIES`). Hai vector này sinh lúc chạy vào `tests/package-vectors/out/`, không commit;
  - **digest:** `digest-basic` (contract §4) phải ra `sha256:c337083b40dd7b12f8db0ace06bfb5fb8bb682931ef795cbf030dfcd0e14e119`; thêm một vector thứ tự đường dẫn có chữ hoa và ký tự UTF-8 (sắp theo byte UTF-8).

  **Ghi chú khi làm:** `tests/package-vectors/generate.mjs` (Node thuần, bộ ghi ZIP tối thiểu, tất định): 54 thư mục vector commit (~100 KB) và 6 gói lớn sinh vào `out/` (~62 MB, không commit; C++/Rust phải chạy `node tests/package-vectors/generate.mjs --out` trước khi test, thiếu file `generated` thì test báo lỗi, không bỏ qua); `digest-basic` ra đúng giá trị contract (script tự kiểm); thêm vector `struct-*`, `manifest-*`, `content-crc`/`content-sha256`, `secret-url-credentials`, `valid-manifest-extensions` ở chỗ contract đã cho mã; kiểm bằng một bộ đọc tham chiếu gom mọi vi phạm và bằng Python `zipfile`; 12 điểm mơ hồ của contract → phiên chính chốt ở contract §8a.

  Vector `valid-device-tank-demo` (bộ ghi C++) và `valid-studio-tank-demo` (bộ ghi Rust) thêm ở T094, T115.
- [X] T014 [P] `tests/discovery-vectors/generate.mjs` và vector của [contracts/discovery.md](contracts/discovery.md) §6, dạng hex kèm kết quả mong đợi:
  - gói hỏi hợp lệ; 1023 và 1025 byte; sai magic, version, type; cờ khác 0; đệm có byte khác 0;
  - nguồn khác subnet; nguồn là broadcast; cổng nguồn 53;
  - trả lời với tên project 64 ký tự tiếng Việt (vừa 1024 byte); trả lời buộc cắt (`truncated`);
  - chuỗi tần suất: 5 gói từ một nguồn trong 1 s → 3 trả lời;
  - phía Studio: trả lời < 24 byte, > 1024 byte, nonce khác, JSON thiếu khóa bắt buộc (`v`, `id`, `name`, `runtime`, `status`, `https`), có khóa lạ (phải bỏ qua).

  **Ghi chú khi làm:** `tests/discovery-vectors/generate.mjs` + 45 vector (`query` 18, `rate` 3, `build` 5, `reply` 19), một bản cài tham chiếu độc lập khớp cả 45; điểm mơ hồ → contract §5a (T059 đổi sang nguồn không phải loopback).
- [X] T015 [P] Tập file và digest của project: `tests/project-vectors/generate.mjs` thêm trường `files` (đường dẫn sắp theo byte UTF-8) và `digest` vào `expected.json` của mọi vector hợp lệ. Tập file theo data-model §8: "`project.json`, `tagFile`, `loggingFile` (nếu có), và mỗi màn hình gồm `screens/<id>.screen.json`, `bindingFile`, `svgFile`". Chạy lại generator; test hiện có (`@mat/project-schema`, `project_validator_test`, `apps/studio/src/model/vectors.test.ts` của 004) vẫn xanh vì bỏ qua trường mới.

  **Ghi chú khi làm:** thêm `files` và `digest` vào `expected.json` của 13 vector hợp lệ (mọi file khác giữ nguyên byte); chỉ chạy lại generator khi không còn container `mat-armhf` đang chạy; `@mat/project-schema` và `vectors.test.ts` của Studio vẫn xanh.

### Mật mã, digest, tập file

- [X] T016 [P] Test `core/crypto/tests/crypto_test.cpp`:
  - SHA-256 theo vector NIST (rỗng, `abc`, 1 MiB theo luồng);
  - `randomBytes` bằng `getrandom`: đúng độ dài, hai lần gọi khác nhau;
  - so sánh hằng thời gian: bằng, khác, khác độ dài đều cho kết quả đúng;
  - base64url không đệm (vector RFC 4648); hex chữ thường;
  - fingerprint in dạng `AB:CD:…` (95 ký tự) và dạng 64 hex chữ thường.

  **Ghi chú khi làm:**
  - 22 test (`Sha256`, `RandomBytes`, `ConstantTimeEqual`, `Base64url`, `Hex`, `Fingerprint`). **Đỏ** với bản cài tạm trả giá trị sai: 21 hỏng / 1 đạt (`ZeroLengthAsksNothing`: bản tạm không gọi gì nên tình cờ đúng);
  - SHA-256: vector NIST rỗng, `abc`, 448 bit, 896 bit, một triệu chữ `a` theo luồng với khúc dài không đều. NIST không có vector 1 MiB, nên 1 MiB chữ `a` (một lần và theo luồng) so với giá trị của OpenSSL (`node:crypto`);
  - `getrandom` thật, và vòng lặp chạy trên `getrandom` giả tiêm được (`detail::randomBytesWith`): `EINTR`, nhận thiếu byte, lỗi khác ném `std::system_error`, trả 0 byte là lỗi (không lặp mãi), cờ luôn 0;
  - hex: đủ 256 giá trị byte; fingerprint `AB:CD:…` và 64 hex chữ thường.
- [X] T017 Cài `core/crypto/{sha256,random,ct_compare,base64url,hex}.{hpp,cpp}` bọc Mbed TLS, đạt T016. Tạo target `mat_device` (T006).

  **Ghi chú khi làm:**
  - **xanh** 22/22;
  - **lệch T006/T017:** `mat_device` là target INTERFACE (đã có trong `CMakeLists.txt`), gom các thư viện con, mỗi module một thư viện STATIC. `mat_crypto` tự thêm vào bằng `target_link_libraries(mat_device INTERFACE mat_crypto)`. `mat_cli`, `mat-runtime` và hàm `mat_test` chưa link `mat_device`: nối ở T044/T047;
  - Mbed TLS nằm sau header của module (link PRIVATE; `Sha256` giữ context qua pimpl). Bên dùng không cần header hay cấu hình Mbed TLS. Lên Mbed TLS 4.x thì chỉ sửa `sha256.cpp`, `ct_compare.cpp`;
  - `mbedtls/constant_time.h` của 3.6.7 thiếu khối `extern "C"`: lần link đầu báo thiếu `mbedtls_ct_memcmp` (tên C++). Đã bọc `#include` trong `extern "C"`, không sửa mã vendored;
  - thêm ngoài danh sách task: `base64urlDecode` (chặt: không đệm, bit thừa phải 0) và `fromHex` (chỉ chữ thường), cho T028/T034 kiểm dạng token `mats_…` và đọc `tokenHash` từ `auth-state.json`. Hàm fingerprint `toHexColons` đặt trong `hex.hpp`, không thêm file;
  - kiểm thêm ở scratchpad (không commit): `mat_crypto` và `mat_package` bản armhf chạy dưới qemu, 14 phép kiểm đạt (vector SHA-256, base64url, `randomBytes`, `digest-basic`, size 64 bit trên máy 32 bit).
- [X] T018 [P] Test C++ `core/package/tests/digest_test.cpp`: mọi vector digest của T013 và `digest` của mọi vector hợp lệ của T015. Bổ sung `core/project-manager/tests/project_validator_test.cpp`: `LoadedProject::files()` khớp `files` của T015.

  **Ghi chú khi làm:**
  - `digest_test`: 29 test. Gồm 9 test đơn vị như bản TS, 6 vector gói có `digest` và `files` (`digest-basic`, `digest-order`, 4 gói hợp lệ), 13 vector project đọc byte trên đĩa, 1 test đếm vector;
  - `project_validator_test`: thêm 17 test (`files()` của 13 vector hợp lệ, cùng 4 test đơn vị);
  - **đỏ** với bản cài tạm: 42 hỏng / 4 đạt trên 46. Bốn test đạt chỉ kiểm vector có mặt, không gọi mã đang cài;
  - như bản TS, bỏ qua vector chỉ có `code`, và `valid-entries-1024` (có `digest` nhưng không có `files`, gói sinh lúc chạy): cần bộ đọc gói (US2).
- [X] T019 [P] Test TS `packages/project-schema/src/package-digest.test.ts` và `packages/project-schema/src/project-files.test.ts`:
  - digest: cùng vector với T018; mỗi dòng `<sha256> <size> <path>\n`; `size` thập phân không có số 0 đầu; sắp theo byte UTF-8, không theo `localeCompare`; hàm băm truyền vào (bản JS trong test, WebCrypto trong Studio);
  - `projectFiles()` khớp `files` của T015.

  **Ghi chú khi làm:** test viết trước: đỏ 43 hỏng / 4 qua (hàm chưa có), sau cài 47/47.
- [X] T020 Cài C++ `core/package/digest.{hpp,cpp}` và `LoadedProject::files()` trong `core/project-manager/project_validator.{hpp,cpp}`, đạt T018.

  **Ghi chú khi làm:**
  - **xanh** 46/46; `digest-basic` ra đúng `sha256:c337083b…0e14e119`;
  - API giống bản TS: `compareUtf8`, `digestText`, `packageDigest`, `packageFile`. Mục sai dạng ném `std::invalid_argument`, như bản TS ném lỗi: đường dẫn trùng, rỗng, có ký tự điều khiển C0/DEL, không phải UTF-8 (ứng với surrogate lẻ ở TS); size âm; sha256 không phải 64 hex chữ thường;
  - sắp theo `std::string`, vì `char_traits<char>` so như `unsigned char`, tức đúng thứ tự byte UTF-8;
  - **lệch:** `mat_package` link PRIVATE thêm `mat_core`, ngoài `mat_crypto`: cần `isValidUtf8`, và US2 sẽ cần `LoadedProject` và JSON;
  - `LoadedProject::files()` nằm trong `mat_core`, không cần mật mã. Dùng `std::set` nên đã sắp và không trùng. `.screen.json` lấy theo `project.screens`, như `projectFiles()` của TS.
- [X] T021 Cài TS `packages/project-schema/src/package-digest.ts`, `packages/project-schema/src/project-files.ts`, thêm export trong `src/index.ts` (file chung với 004: chỉ thêm dòng), đạt T019.

  **Ghi chú khi làm:** `package-digest.ts` (`compareUtf8`, `digestText`, `packageDigest`, `packageFile`, `sha256WebCrypto`; ném lỗi khi đường dẫn trùng, hex sai, size âm, ký tự điều khiển, surrogate lẻ), `project-files.ts` (`projectFiles`, dùng `hasOwnProperty`); `index.ts` thêm 2 dòng export; `@mat/project-schema` 162/162.

### Cấu hình và phiên bản

- [X] T022 [P] Test `server/tests/config_test.cpp` (bổ sung) theo [contracts/device-config.md](contracts/device-config.md) §1:
  - mặc định và khoảng: `httpsPort` 8443 (`0` hoặc 1024–65535, khác `port`); `httpsThreads` 8 (4–32); `discoveryEnabled` true; `discoveryPort` 8446 (1024–65535); `deviceName` = hostname (1–32 byte UTF-8 in được); `deviceModel` `"BL335"` (1–32 byte); `projectStoreDir` `<dataDir>/projects`; `projectBackups` 3 (1–10); `usersFile` `/etc/mat-runtime/users.json`; `auditRetentionDays` 365 (30–3650); `auditMaxMB` 64 (8–1024);
  - tham số dòng lệnh `--https-port`, `--project-store-dir`, `--users-file`, `--no-discovery`;
  - `deployment/config/runtime.json` đang dùng trên thiết bị (không có khóa mới) vẫn nạp được; khóa lạ vẫn thoát mã 2.

  **Ghi chú khi làm:**
  - thêm 10 test `DeviceConfig.*`. **Đỏ:** 7/10 hỏng. Ba test đọc khóa và tham số đạt, vì bản tạm có đọc khóa nhưng không kiểm, để test khoảng đỏ đúng chỗ. 11 test `Config.*` cũ vẫn đạt;
  - hostname tiêm được: thêm tham số `HostnameFn` vào `loadConfig`, mặc định `systemHostname()` (`gethostname`). Test thêm trường hợp hostname dài hơn 32 byte, cắt giữa ký tự nhiều byte, rỗng, có ký tự điều khiển;
  - test có `deployment/config/runtime.json` thật; khóa gõ sai (`httpsport`) vẫn bị từ chối, nên `main` vẫn thoát mã 2.
- [X] T023 Cài khóa mới trong `server/config.{hpp,cpp}`, đạt T022. Nâng phiên bản runtime lên 0.4.0: `kRuntimeVersion` (`core/project-manager/project_validator.hpp`) và `RUNTIME_VERSION` (`packages/project-schema/src/codes.ts`, file chung với 004). Vector `invalid-runtime-too-old` (cần 9.0.0) vẫn đúng.

  **Ghi chú khi làm:**
  - **xanh:** `config_test` 21/21;
  - `deviceName`:
    - mặc định là hostname, cắt còn 32 byte ở ranh giới ký tự; vẫn không hợp lệ (rỗng, ký tự điều khiển) thì dùng `deviceModel`;
    - "in được" nghĩa là: UTF-8 hợp lệ; không có ký tự điều khiển C0, DEL, C1; không có dấu đảo chiều dòng (`layoutControlAt`, ví dụ U+202E). Lý do: tên hiện ở danh sách thiết bị của Studio;
    - **lệch:** `deviceModel` cũng kiểm theo luật này (contract chỉ ghi 1–32 byte), vì model cũng vào JSON của gói tìm thiết bị và `device/identity`;
  - `projectStoreDir` tính sau khi đọc file và tham số (`--data-dir` kéo theo); `dataDir` có `/` cuối vẫn ra đúng đường dẫn;
  - **sửa thêm, ngoài khóa mới:**
    - mọi khóa số nguyên phải nằm trong `int`. Trước đây `{"port": 4294975616}` (2^32 + 8320) được nhận thành 8320, vì `get<int>()` cắt bit;
    - `--data-dir ""` báo lỗi, vì `projectStoreDir` suy từ `dataDir`; `--project-store-dir` và `--users-file` không nhận chuỗi rỗng;
  - phiên bản 0.4.0: `meta-schema.test.ts` kiểm hai hằng C++ và TS bằng nhau. Vector `invalid-runtime-too-old` vẫn lỗi;
  - grep "0.3.0" trong `server`, `core`, `apps/runtime-web`, `packages`, `tests`: không test nào so phiên bản runtime. Chỗ còn lại là `minRuntimeVersion` của project (tank-demo, vector, fixture) và trường `project` của manifest trong `tests/package-vectors/generate.mjs`: vẫn đúng với runtime 0.4.0, giữ nguyên;
  - còn "0.3.0" ngoài phạm vi, chưa sửa:
    - `deployment/package-runtime.ps1` dòng 25 ghi `mat-runtime 0.3.0 (Sprint 1 + 003 …)` vào gói runtime;
    - dữ liệu giả của Studio (`device-session.test.ts`, `device-adapters.test.ts`, `mock-device.test.ts`, `device-test-helpers.ts`, `tests/e2e/fake-runtime.mjs`): không so với `RUNTIME_VERSION`;
    - fixture `tools/load-tester/stats_test.go`;
  - `@mat/project-schema` 162/162, `@mat/runtime-web` 16/16, typecheck sạch. Chạy test Studio để kiểm (không sửa): 626/629, 3 test hỏng ở `csp.test.ts`, là việc dở của agent Studio, không liên quan phiên bản;
  - cả bộ: x64 506/506 (cộng 1 test tắt của audit); build armhf xanh; smoke qemu OK.

### Audit (⏸ Q1)

- [X] T024 [P] ⏸ Q1 Test `core/audit/tests/audit_log_test.cpp` (data-model §7, research R11), file tạm:
  - bảng `audit` đủ cột `id`, `ts_ms`, `clock_ok`, `user`, `role`, `source`, `channel`, `action`, `target`, `result`, `code`, `detail`, `count`; `channel` ∈ `https | http | cli | system`; `result` ∈ `ok | failed | denied | started | rolled-back | interrupted`; chỉ mục `ts_ms`, `(user, ts_ms)`, `(action, ts_ms)`;
  - PRAGMA `journal_mode=wal`, `synchronous=FULL` (mặc định của Q1), `cache_size` 256 KB; file `0600`;
  - `append()` chỉ trả về sau khi commit. Lỗi ghi (giả lập bằng `PRAGMA query_only` như 003) → `AuditUnavailable`;
  - gộp 60 s theo (hành động, nguồn, tài khoản) cho `auth.login failed`, `auth.locked`, `access.denied`, có `count`. Các dòng loại này ≤ 10 dòng/phút; vượt thì vẫn đếm, và ghi một dòng `audit.suppressed` mỗi phút. Thao tác thay đổi và `auth.login ok` không bị giới hạn;
  - thời hạn `auditRetentionDays` (365), dọn lúc khởi động và mỗi 24 giờ, chỉ khi đồng hồ đã đồng bộ. Quá trần `auditMaxMB` (64 MiB) thì xóa 10 % bản ghi cũ nhất và ghi `audit.purged`;
  - `clock_ok = 0` khi chưa có `/run/systemd/timesync/synchronized`, hoặc giờ trước mốc build (hàm kiểm tiêm được);
  - `detail` là JSON ≤ 1 KB; giao diện ghi không có tham số nào cho mật khẩu, token hay hash;
  - truy vấn: mới nhất trước; lọc `from`, `to` (ms UTC), `user` (đúng tên), `action` (tiền tố); phân trang theo `before` (`id`); `limit` 1–200, mặc định 100.

  **Ghi chú khi làm:**
  - 36 test (`AuditActions` 2, `AuditLog` 34), cộng 1 test đo bị tắt (`AuditLogBench.DISABLED_AppendLatencyAndFileSize`);
  - **đỏ** với bản cài tạm trả sai (header khai báo đủ; danh mục tạm trả tên rỗng): 34 hỏng / 0 đạt, mọi lỗi ở mức assertion. Hai test viết thêm lúc cài cũng đỏ trước khi cài: `ACountWhoseRowWasPurgedIsWrittenAgain` (số đếm rơi vào dòng khác nhận lại id), `NewFilesUse1KiBPages` (`page_size` 4096);
  - đồng hồ wall, mono và hàm kiểm "đã đồng bộ" đều giả. Lỗi ghi giả lập bằng `PRAGMA query_only` qua `execForTest`. Một kết nối SQLite thứ hai, như tiến trình khác, kiểm: đã commit, cột, chỉ mục, CHECK. Test quyền file đặt `umask 022`;
  - kiểm thêm ngoài danh sách:
    - bảng có CHECK cho `channel`, `result`, `clock_ok ∈ {0, 1}`, `count ≥ 1`. `action` không có CHECK, để giai đoạn sau thêm hành động mà không cần migration;
    - file đã có với quyền khác được đưa về `0600`;
    - `detail` trên 1 KiB vẫn là JSON object: chuỗi dài nhất bị cắt, các khóa giữ nguyên, thêm `"truncated": true`, bản ghi không mất. `detail` không phải JSON object, hoặc có khóa giống bí mật (`password`, `token`, `hash`, `secret`…, kể cả lồng nhau) → `std::invalid_argument`, không ghi gì;
    - trường chữ: UTF-8 hỏng thành U+FFFD, rồi cắt theo byte (`user` 64, `role` 32, `source` 64, `target` 256, `code` 64);
    - 8 luồng ghi cùng lúc; `close()` ghi số đếm còn trong bộ nhớ.
- [X] T025 ⏸ Q1 Cài `core/audit/audit_log.{hpp,cpp}` và danh mục hành động `core/audit/audit_actions.hpp` (bảng `action` của data-model §7), đạt T024. Chỉ bật `synchronous=FULL` sau T012 (người dùng chấp thuận Q1 và Constitution đã sửa); trước đó không đánh dấu xong task này.

  **Ghi chú khi làm:**
  - **xanh:** 36/36 trên x64. Biên dịch chéo chính file test trong scratchpad (không commit), chạy dưới qemu armhf: 36/36. Cả bộ x64 504/504, cộng 1 test tắt; build armhf xanh; clang-format sạch;
  - `mat_audit` (STATIC) link PRIVATE `mat_historian` (lấy `clockFloorMs`; qua `mat_core` có sửa UTF-8 và JSON) và `mat_sqlite`; tự thêm vào `mat_device`. Chưa nối vào `mat_test`, `mat_cli`, `mat-runtime`;
  - **luồng:** một kết nối SQLite và một mutex cho mọi phương thức, không có luồng nền. SQLite chỉ có một bên ghi mỗi file; chi phí chính là fsync của commit; trạng thái gộp cũng cần cùng khóa;
  - **PRAGMA:** WAL; `synchronous=FULL` cho mọi giao dịch (Q1, T012); `cache_size=-256`; `journal_size_limit` 4 MiB; `busy_timeout` 5 s, vì lệnh trên thiết bị ghi từ tiến trình khác;
  - **lệch, thêm `page_size=1024`** (chỉ có tác dụng với file mới): mỗi dòng chạm 4 trang B-tree (bảng và 3 chỉ mục). Với trang 4 KiB, mỗi commit ghi 17 724 byte WAL; với trang 1 KiB còn 5 823 byte. Độ trễ và byte mỗi dòng như nhau. R11 ước "1 trang WAL 4 KB mỗi bản ghi"; với trang 4 KiB, số thật gấp khoảng 4 lần;
  - **gộp:**
    - lần đầu của cửa sổ 60 s ghi dòng ngay, bền. Các lần sau chỉ đếm trong bộ nhớ, không ghi;
    - số đếm được ghi cùng lần ghi kế tiếp, hoặc bởi `flushExpired()` khi cửa sổ hết 60 s, bởi `query()`, `maintain()`, `close()`. Mất điện chỉ mất số đếm còn trong bộ nhớ (R11);
    - **lệch:** khóa gộp là (hành động, kết quả, mã, đối tượng, địa chỉ nguồn, tài khoản), tức thêm kết quả, mã, đối tượng để một dòng không trộn hai kiểu từ chối. Nguồn so theo địa chỉ, bỏ cổng, vì mỗi kết nối một cổng; dòng gộp lưu `source` là địa chỉ;
  - **giới hạn:** cửa sổ trượt 60 s theo đồng hồ đơn điệu, tối đa 10 dòng loại bị giới hạn. Vượt thì đếm vào một dòng `audit.suppressed` mỗi phút (`channel`, `source` là `system`; `count` là tổng; `detail` đếm theo hành động);
  - **thời hạn:** chỉ chạy khi đồng hồ đã đồng bộ. Xóa mọi dòng có id ≤ id lớn nhất trong các dòng `clock_ok = 1` đã quá hạn. Nhờ vậy dòng `clock_ok = 0` (giờ 1970 sau khi mất RTC) không bị xóa sớm vì giờ sai. Xóa theo lô 2000 dòng, nhả khóa giữa các lô;
  - **trần:** không phụ thuộc đồng hồ. Mỗi bước xóa 10 % dòng cũ nhất theo id và ghi một dòng `audit.purged`, trong cùng một giao dịch; lặp tới khi dưới trần, tối đa 50 bước. Chỉ kiểm lúc mở và trong `maintain()` (24 giờ), nên có thể vượt trần một chút trong ngày;
  - **id:** `INTEGER PRIMARY KEY` như data-model. Không dùng AUTOINCREMENT, đỡ một trang ghi mỗi commit. Hệ quả: id mới nhất bị xóa có thể được cấp lại. Vì vậy UPDATE số đếm khớp cả (id, `ts_ms`, `action`, `source`); dòng không còn thì ghi một dòng mới;
  - mặc định của hàm kiểm đồng bộ: có `/run/systemd/timesync/synchronized` và giờ ≥ `clockFloorMs()`;
  - **số đo x64** (Docker Desktop/WSL2, `/tmp` của container; số trên eMMC của BL335 đo ở T158–T165):
    - `append()` với FULL, nhiều lần chạy, mỗi lần 500–1000 lần ghi: trung vị 1,6–6,6 ms, p95 3,1–8,6 ms (dao động theo I/O của máy host). NORMAL, chỉ để so: trung vị 17–35 µs. Chi phí của FULL là một fsync mỗi lần ghi;
    - kích thước: 2000 dòng có `detail` khoảng 180 byte và `target` là digest chiếm 835 584 byte (418 byte/dòng). Không có `detail`: 160 byte/dòng. 64 MiB chứa khoảng 160 000–420 000 dòng;
    - ước tính khi bị tấn công liên tục: khoảng 16 000 commit/ngày × 5,8 KB, tức 90–100 MB/ngày WAL, cộng checkpoint và nhật ký ext4. Khớp ước tính khoảng 150 MB/ngày của Constitution. Với trang 4 KiB, riêng WAL đã khoảng 280 MB/ngày;
  - API cho các wave sau (auth, API HTTPS, lệnh trên thiết bị, nạp xuống) ghi ở đầu `core/audit/audit_log.hpp`. Gọi `close()` trước `execv`; runtime nên gọi `flushExpired()` vài giây một lần và `maintain(now)` mỗi 24 giờ.

### Tài khoản, phiên, khóa tạm, quyền

- [X] T026 [P] ⏸ Q3 ⏸ Q5 Test `core/auth/tests/password_hash_test.cpp` (R7):
  - vector Argon2id của RFC 9106 qua `argon2_ctx`; chuỗi PHC `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>` mã hóa rồi đọc lại; salt 16 byte; kết quả 32 byte;
  - kiểm theo tham số ghi trong chuỗi; báo "cần băm lại" khi tham số khác mặc định hiện hành;
  - so sánh hằng thời gian; băm giả (salt giả, cùng tham số) cho tài khoản không tồn tại;
  - bộ nhớ cấp qua callback (`mmap`), trả lại ngay sau khi băm;
  - luật mật khẩu: 15–128 ký tự (UTF-8, ≤ 512 byte), khác tên tài khoản.

  **Ghi chú khi làm:**
  - 20 test (`Argon2id` 3, `Phc` 4, `Password` 5, `Argon2Memory` 1, `PasswordRules` 2, `SecureZero` 1, `PasswordHasher` 4). **Đỏ** với bản cài tạm trả sai (header đủ): 19 hỏng / 1 đạt. Test đạt là `DefaultParametersAreTheOwaspMinimum`, chỉ kiểm hằng số trong header;
  - vector RFC 9106 §5.3 (secret, dữ liệu kèm, 4 lane) chạy qua `detail::argon2idHashFull`, tức `argon2_ctx` với bộ cấp phát `mmap` của module. Chuỗi PHC so từng byte với `argon2id_hash_encoded` của thư viện;
  - đọc PHC chặt: đúng thứ tự `m,t,p`; số không dấu, không có số 0 đầu; base64 chuẩn, không đệm, chính tắc. Khoảng chặn DoS theo quyết định của phiên chính: chỉ `argon2id` `v=19`, m 8192–65536 KiB, t 1–10, p = 1, salt 16–64 byte, hash 32 byte. Lý do lỗi không trích chuỗi;
  - bộ nhớ: đếm `mmap`/`munmap` và đo `VmRSS` quanh 3 lần băm 19 MiB. RSS sau mỗi lần băm ≤ mốc + 4 MiB;
  - luồng băm: hàm băm tiêm vào chờ một "cổng" do test mở, không chờ theo thời gian. 1 đang băm + 4 chờ, lần thứ 6 bị từ chối ngay. Nice của luồng băm = min(19, nice luồng gọi + 10); luồng gọi giữ nguyên;
  - băm giả: `dummyPasswordHash()` có tham số mặc định. Việc dùng nó cho mọi tên không đăng nhập được kiểm ở T031.
- [X] T027 [P] Test `core/auth/tests/account_store_test.cpp` (data-model §4, R8), file tạm:
  - đọc `users.json` (`schemaVersion` 1.x): `name` theo `^[a-z][a-z0-9._-]{2,31}$`, duy nhất; `role` ∈ `viewer | operator | engineer | administrator`; `enabled`; `passwordHash` dạng PHC; `rev`; `unlockSeq`; `createdAt`, `updatedAt`; tối đa 64 tài khoản; file ≤ 256 KB;
  - file có `mode & 0007 ≠ 0`, không đọc được, hỏng, hoặc `schemaVersion` khác MAJOR 1 → coi như không có tài khoản, log lỗi;
  - đọc lại khi `mtime`, kích thước hoặc inode đổi, tối đa 1 lần/2 s (đồng hồ giả). `rev` đổi → báo hủy mọi phiên và xóa khóa tạm của tài khoản đó; `unlockSeq` đổi → chỉ xóa khóa tạm;
  - ghi (cho lệnh trên thiết bị): file tạm cùng thư mục, `fsync`, `chown root:matscada` (bỏ qua khi không có group), `chmod 0640`, `rename`. Không cho xóa hoặc hạ role administrator cuối cùng còn bật.

  **Ghi chú khi làm:**
  - 16 test (`UsersFile` 6, `AccountStore` 4, `UsersWrite` 3, `AccountEdits` 3). **Đỏ** với bản cài tạm: 16 hỏng / 0 đạt. Lần chạy đỏ đầu có 1 test sập (SegFault: dereference trước khi kiểm); đã thêm `ASSERT`, chạy lại thì mọi lỗi ở mức assertion;
  - các kiểu đổi file đều làm đọc lại: `rename` (inode mới), chỉ `mtime` (`utimensat`), chỉ kích thước (ghi tại chỗ, giữ `mtime`), chỉ inode (cùng byte, cùng `mtime`). Trong 2 s không nhìn file; file không đổi không đọc lại (đếm bằng `loads()`);
  - file hỏng hoặc sai quyền chỉ log một lần, dù gọi `refresh` nhiều lần; log không chứa hash hay salt;
  - test chạy root trong container, nên kiểm được cả `chown` (nhóm `daemon` có sẵn trong image) và cảnh báo khi không có nhóm.
- [X] T028 [P] Test `core/auth/tests/session_store_test.cpp` (data-model §5, R9), đồng hồ `CLOCK_BOOTTIME` giả:
  - token `mats_` + 43 ký tự base64url từ 32 byte ngẫu nhiên; lưu theo SHA-256 của token, không giữ token gốc;
  - hết hạn khi `now − lastMono > 30 phút` hoặc `now − createdMono > 12 giờ`. Chỉ request do người dùng thao tác mới làm mới `lastMono`;
  - gắn IP nguồn lúc đăng nhập: IP khác → `SESSION_INVALID`; `rev` của tài khoản khác lúc đăng nhập → `SESSION_INVALID`;
  - tối đa 32 phiên, đầy thì bỏ phiên có `lastMono` nhỏ nhất; đăng xuất hủy phiên; hủy được mọi phiên của một tài khoản;
  - ghi và đọc `auth-state.json` (`0600`; chỉ `tokenHash` và hai bảng đếm sai). File hỏng hoặc thiếu → rỗng; đọc xong thì xóa file.

  **Ghi chú khi làm:**
  - 21 test (`SessionToken` 2, `SessionStore` 14, `AuthState` 5). **Đỏ** với bản cài tạm: 20 hỏng / 1 đạt. Test đạt là `MalformedOrUnknownTokensAreExpired`, vì bản tạm luôn trả `Expired`. Lần đỏ đầu có 1 test sập (đọc phần tử của vector rỗng); đã thêm `ASSERT`;
  - biên: đúng 30 phút rảnh, đúng 12 giờ vẫn còn hạn (dấu `>` như data-model §5). Phiên đã hết hạn nhường chỗ trước, rồi mới tới phiên lâu không dùng nhất;
  - `auth-state.json`: file 0600, chỉ có các khóa `schemaVersion`, `bootId`, `sessions` (`tokenHash`, `user`, `rev`, `source`, `createdMono`, `lastMono`) và `lockouts`; không chứa token. 13 kiểu file hỏng hoặc lạ đều cho trạng thái rỗng, và file vẫn bị xóa: khác boot, không biết boot id, quyền 0640 hay 0604, mốc trong tương lai, hash sai dạng, symlink…
- [X] T029 [P] Test `core/auth/tests/login_guard_test.cpp` (data-model §5, FR-013):
  - bảng theo tên (kể cả tên không tồn tại, LRU 256) và theo IP (LRU 256);
  - sai thì `failures += 1`; tới 5 thì `lockedUntilMono = now + 5 phút`, `failures = 0`;
  - đang khóa (theo tên hoặc theo IP): không kiểm mật khẩu, trả `AUTH_LOCKED`, `retryAfterS` là thời gian còn lại dài nhất;
  - đăng nhập đúng xóa bộ đếm của tên và của IP đó; `unlockSeq` đổi xóa khóa của tên.

  **Ghi chú khi làm:**
  - 11 test. **Đỏ** với bản cài tạm: 11 hỏng / 0 đạt;
  - kiểm thêm ngoài danh sách:
    - khóa còn lại tính ra giây, làm tròn lên;
    - tên rỗng chỉ đếm theo IP (lý do ở T035);
    - bảng đầy không bỏ mục đang khóa: 300 tên mới không mở được khóa của một tên;
    - `rev` đổi cũng xóa bộ đếm của tên, như `unlockSeq`.
- [X] T030 [P] Test `core/auth/tests/roles_test.cpp` (R10):
  - một bảng duy nhất; mọi endpoint ở [contracts/device-api.md](contracts/device-api.md) §3–7 có đúng một mục: role tối thiểu và có làm mới hạn phiên hay không (theo §1.3);
  - thứ bậc `viewer < operator < engineer < administrator`; operator có quyền như viewer ở GĐ 1;
  - test duyệt cả bảng, để endpoint thêm ở GĐ 2 không lọt khỏi bảng.

  **Ghi chú khi làm:**
  - 7 test. **Đỏ** với bản cài tạm: 6 hỏng / 1 đạt. Test đạt là `OperatorHasTheRightsOfViewerInStageOne`, vì bảng tạm rỗng nên vòng lặp không chạy;
  - test so cả bảng với danh sách 13 endpoint chép tay từ device-api §3–7 và §1.3. Sau đó duyệt từng dòng: không trùng; nằm dưới `/api/v1/`; mọi `POST` có phiên đều làm mới hạn; `changesDevice` chỉ có ở `POST`; `findEndpointRule` trả đúng dòng với đường dẫn cụ thể;
  - endpoint của GĐ 2 (ví dụ `POST /api/v1/tags/write`, operator): thêm một dòng vào bảng và một dòng vào danh sách của test.
- [X] T031 [P] Test `core/auth/tests/auth_service_test.cpp` (luồng đăng nhập; R7, R9, device-api §3):
  - sai tên và sai mật khẩu cùng `AUTH_FAILED`, và cùng gọi băm (băm giả); chưa có tài khoản nào, tài khoản bị tắt → `AUTH_FAILED`;
  - hàng đợi băm: mỗi lúc một lần băm, chờ tối đa 4; đầy → `AUTH_BUSY`;
  - audit `auth.login` (`ok`/`failed`), `auth.lockout`, `auth.locked` ghi trước khi trả lời; không ghi được → `AUDIT_UNAVAILABLE`, không cấp token;
  - chuỗi mật khẩu thử không xuất hiện trong audit hay log thu được.

  **Ghi chú khi làm:**
  - 27 test (`AuthLogin` 8, `AuthLockout` 5, `AuthAudit` 3, `AuthSecrets` 2, `AuthAccess` 5, `AuthAccounts` 2, `AuthExecv` 1, `AuthService` 1). **Đỏ** với bản cài tạm: 27 hỏng / 0 đạt. Sau khi xanh, thêm 2 assertion vào `WrongNameAndWrongPasswordLookTheSame` (tài khoản bị tắt cũng băm với salt giả): đỏ (1 hỏng) trên bản cài lúc ấy, xanh sau khi sửa T035;
  - hàm băm tiêm vào là SHA-256(salt, mật khẩu). Mỗi lần băm ghi lại salt và tham số, không ghi mật khẩu. Một test dùng Argon2id thật với `AuditLog` thật;
  - tìm mật khẩu thử và token trong: mọi bản ghi audit, mọi dòng log, stderr của tiến trình (chuyển fd 2 vào file), `auth-state.json`, mọi byte của `audit.db*` thật. Không thấy;
  - theo tin nhắn của phiên chính: gõ mật khẩu vào ô tên thì bản ghi không có `user`, có `detail` `{"userInvalid":true}`; chuỗi đó không có trong audit, log hay `auth-state.json`;
  - hàng đợi: 5 luồng đăng nhập chờ "cổng" do test mở; lần thứ 6 nhận `AUTH_BUSY` ngay, không băm, không audit.
- [X] T032 ⏸ Q3 ⏸ Q5 Cài `core/auth/password_hash.{hpp,cpp}`: Argon2id m = 19456 KiB, t = 2, p = 1; luồng băm `nice +10`; đạt T026.

  **Ghi chú khi làm:**
  - **xanh** 20/20;
  - tham số mặc định là hằng `kArgon2Default` {19456, 2, 1} trong `password_hash.hpp`: T055 hạ t = 1 chỉ sửa một chỗ. Hash cũ vẫn kiểm được; `needsRehash()` báo;
  - bộ nhớ cấp qua `allocate_cbk`/`free_cbk` bằng `mmap`/`munmap`, thêm `MADV_DONTDUMP`; thư viện tự xóa khối trước khi trả. Bẫy: `allocate_memory` của thư viện bỏ qua giá trị trả về của callback và chỉ xem con trỏ, nên khi lỗi phải đặt con trỏ NULL;
  - luồng băm: một `std::thread`. **Lệch nhỏ:** nice đặt `min(19, hiện tại + 10)` như luồng gửi của 003, thay cho `setpriority(…, 10)` tuyệt đối. Thường vẫn là 10, và không bao giờ nâng ưu tiên. Lỗi chỉ log;
  - hàng đợi giữ `unique_ptr<Job>`, nên bản sao mật khẩu không bị chép khi di chuyển. Bản sao xóa bằng `secureZero` ngay sau khi băm, kể cả khi hàm băm ném lỗi. `secureZero` ghi `volatile`, xóa cả phần dung lượng thừa của chuỗi;
  - `checkNewPassword` so với tên tài khoản không phân biệt hoa thường ASCII (chặt hơn task);
  - **số đo** (`argon2idHash`, chương trình tạm ở scratchpad, không commit):
    - x64: trung vị 24,0 ms (t = 2), 14,6 ms (t = 1). RSS đỉnh +19,1 MiB lúc băm, sau băm về lại mốc (+76 KiB);
    - qemu-arm, chỉ tham khảo (không phải Cortex-A7): 318 ms (t = 2), 153 ms (t = 1). RSS của tiến trình qemu đỉnh +20,3 MiB, rồi về lại;
    - đo trên BL335 vẫn chờ T055.
- [X] T033 [P] Cài `core/auth/account_store.{hpp,cpp}`, đạt T027.

  **Ghi chú khi làm:**
  - **xanh** 16/16;
  - `AccountStore::refresh()` so chữ ký file gồm inode, kích thước, quyền, `mtime`, `ctime`. Task ghi `mtime`, kích thước, inode; thêm quyền và `ctime` để thấy cả `chmod`. Lần đọc đầu không báo thay đổi: phiên và bộ đếm qua `execv` được kiểm bằng `rev`, `unlockSeq` lưu kèm (T034, T035);
  - file không dùng được (sai quyền, hỏng, MAJOR khác) thì mọi tài khoản coi như mất: `revoked` liệt kê hết, phiên của chúng bị hủy;
  - lỗi cấu trúc (tên, role, kiểu khóa, trùng tên, > 64 tài khoản) làm hỏng cả file. Riêng `passwordHash` không đọc được (kể cả ngoài khoảng chặn DoS) chỉ làm hỏng tài khoản đó: tài khoản vẫn tồn tại, không đăng nhập được; log tên và lý do, không kèm hash;
  - khóa lạ được bỏ qua, vì bản MINOR sau có thể thêm khóa. File ghi ra theo thứ tự khóa của data-model §4 (`nlohmann::ordered_json`);
  - ghi: file tạm `users.json.tmp-XXXXXX` (`mkostemp`, 0600), `fsync`, `fchown` (chỉ khi chạy root; không có nhóm thì cảnh báo), `fchmod 0640`, `rename`, `fsync` thư mục. Lỗi bằng tiếng Việt, cho lệnh trên thiết bị;
  - hàm sửa tài khoản cho T047: `addAccount`, `setAccountPassword`, `setAccountRole`, `setAccountEnabled`, `unlockAccount`, `removeAccount`:
    - đặt role hay trạng thái tài khoản đang có thì không đổi gì: `rev` giữ nguyên, phiên không bị hủy;
    - luật administrator cuối cùng: không thay đổi nào được làm file mất administrator còn bật, nếu trước đó có. Tắt tài khoản cũng tính, không chỉ xóa và hạ role.
- [X] T034 [P] Cài `core/auth/session_store.{hpp,cpp}` và `core/auth/login_guard.{hpp,cpp}`, đạt T028, T029.

  **Ghi chú khi làm:**
  - **xanh** 21/21 và 11/11;
  - phiên: tìm theo SHA-256 của token, so hằng thời gian trên ≤ 32 phiên. Kiểm dạng token không cần giải mã, nên không tạo bản sao bí mật. Khác IP thì `Invalid` nhưng giữ phiên cho chủ; `rev` đổi thì xóa phiên;
  - thêm file `core/auth/auth_state.{hpp,cpp}` cho `auth-state.json`: JSON, 0600, file tạm + `rename`, không `fsync` (tmpfs, chỉ cần qua `execv`). Đọc: `O_NOFOLLOW`, xóa file ngay sau khi mở, rồi kiểm từng trường; một trường sai thì bỏ cả file. Boot id đọc từ `/proc/sys/kernel/random/boot_id`, tiêm được;
  - khóa tạm: mỗi mục theo tên lưu `rev` và `unlockSeq` đã thấy (data-model ghi `unlockSeq`; thêm `rev` vì R8 ghi `rev` đổi cũng xóa khóa). Khác số hiện tại thì mục bắt đầu lại, kể cả sau `execv`, khi không còn thông báo thay đổi nào;
  - bảng đầy bỏ mục lâu không dùng nhất trong các mục chưa khóa; hết mục chưa khóa mới bỏ mục sắp hết khóa nhất.
- [X] T035 Cài `core/auth/roles.{hpp,cpp}` và `core/auth/auth_service.{hpp,cpp}`, đạt T030, T031.

  **Ghi chú khi làm:**
  - **xanh** 7/7 và 27/27. Tổng 6 file test của `core/auth`: đỏ 99 hỏng / 3 đạt trên 102, xanh 102/102;
  - `mat_auth` (STATIC, 7 file) link PUBLIC `mat_audit mat_crypto`, PRIVATE `mat_argon2 mat_core`; tự thêm vào `mat_device`. Chưa nối vào `mat_test`, `mat_cli`, `mat-runtime`;
  - audit qua callback `AuditFn` (runtime truyền `AuditLog::append`), vì `AuditLog` không có interface để test giả lập lỗi ghi;
  - **đếm lần sai trước khi băm:** mỗi lần thử tính là sai ngay khi vào hàng băm; mật khẩu đúng thì xóa. Lý do: nếu đếm sau khi băm, 5 request song song cho tới 9 lần thử mỗi 5 phút. Hệ quả: 5 lần thử song song của cùng một tài khoản tạm khóa tên đó tới khi một lần đúng xong. `auth.lockout` chỉ ghi khi lần thử thật sự sai;
  - **băm giả** cho mọi tên không đăng nhập được: không tồn tại, bị tắt, hash hỏng, chưa có tài khoản, file hỏng. Salt giả cố định, sinh khi tạo `AuthService`; tham số mặc định. Tài khoản bị tắt cũng dùng salt giả (theo quyết định của phiên chính), nên tham số cũ của nó không lộ qua thời gian;
  - **tên gõ không đúng dạng tài khoản** (theo tin nhắn của phiên chính): không vào audit (`user` rỗng, `detail` `{"userInvalid":true}`), không vào log, không vào bảng khóa theo tên nên không xuống `auth-state.json`. Vẫn đếm theo IP;
  - khi `users.json` đổi làm hủy phiên: ghi `auth.session-revoked` (kênh `system`). `auth.logout` ghi sau khi đã hủy phiên; không ghi được thì chỉ log, vì đăng xuất không chờ audit. Lỗi audit log tối đa 1 dòng/phút;
  - **lệch R7:** R7 ghi "băm lại ở lần đăng nhập đúng kế tiếp", nhưng runtime không ghi được `users.json` (R8). Runtime chỉ log một lần cho mỗi tài khoản, nhắc chạy `--user-passwd`;
  - `login()` nhận `std::string&` và xóa mật khẩu trước khi trả. Tên > 64 byte hay mật khẩu > 512 byte: `Failed` ngay, không băm, không audit; lớp HTTP trả 400 trước;
  - **số đo đăng nhập trọn** qua `AuthService` (Argon2id thật, tham số mặc định): x64 trung vị 24,6 ms; qemu-arm 315 ms (tham khảo);
  - cả bộ x64 (không `-Target`/`-Filter`): lần cuối 631/631 đạt, cộng 1 test tắt. Lần chạy trước 630/631: hỏng một test ngoài phạm vi, chập chờn, `HttpsHandshake.FailedSslSetupRefusesTheConnection` báo `c2i_ibuf:illegal padding`. Nguyên nhân: serial của chứng chỉ thử ở `server/tests/tls_test_support.cpp` thiếu xử lý byte đầu bằng 0, xảy ra khoảng 1/128 lần (mã thật `server_cert.cpp` đã xử lý). Chạy lại riêng test đó 3/3 đạt;
  - build armhf xanh, không cảnh báo; clang-format sạch.

### HTTPS, chứng chỉ, cổng kiểm, API đăng nhập

- [X] T036 [P] Test `server/tests/https_handshake_test.cpp` cho bản vá 3 của CivetWeb (R4). CivetWeb HTTPS chạy trong tiến trình trên 127.0.0.1, chứng chỉ sinh lúc chạy, client là libcurl của image x64:
  - 8 kết nối TCP im lặng: mỗi kết nối bị đóng sau ≤ 11 s;
  - CPU của tiến trình (`getrusage`) trong 5 s không tăng quá 2 điểm phần trăm;
  - bắt tay bình thường vẫn qua.

  **Ghi chú khi làm:**
  - 9 test, gồm cả bản vá 4 (đóng TLS sạch, kiểm `mbedtls_ssl_setup`) và chính sách TLS chuyển từ spike T007;
  - phần dùng lại cho T041 ở `server/tests/tls_test_support.{hpp,cpp}`, thư viện test `mat_tls_test_support`: chứng chỉ sinh lúc chạy, `TlsTestServer`, client libcurl `CurlClient`/`httpsGet`, `processCpuMs`, `StderrCapture`;
  - **đỏ** trên CivetWeb chưa vá: 5/9 hỏng, đúng ở assertion:
    - 8 kết nối im lặng: 39 911 ms CPU trong 5 s (798 %); sau 13 s không kết nối nào bị đóng;
    - client gửi từng byte của ClientHello: sau 6 s vẫn mở;
    - `mg_stop` chờ 8,0 s, tới khi watchdog đóng client;
    - 4 dòng `SSL read failed` (3 dòng `-30848`, 1 dòng `0`); không có dòng `SSL setup failed`;
  - **xanh** sau T037: 9/9.
    - CPU khi rảnh 0,7 ms trong 1 s; khi có 8 kết nối im lặng 0,5 ms trong 5 s (0,01 %);
    - cả 8 kết nối bị đóng sau 10,0 s; trong lúc đó client bình thường vẫn qua;
    - client gửi từng byte bị đóng sau 3,0 s (`request_timeout_ms` 3000): hạn tính cho cả lần bắt tay;
    - `mg_stop` 1,75 s;
  - ngưỡng CPU tính bằng thời gian CPU của chính tiến trình, không phụ thuộc tải của máy;
  - chuyển từ spike: chứng chỉ sinh lúc chạy; TLS 1.2 chọn ChaCha20-Poly1305; TLS 1.3 qua; từ chối CBC, trao đổi khóa RSA, client chỉ có P-384; 40 client đồng thời mỗi loại trên 4 worker. Đã xóa `server/tests/tls_spike_test.cpp` và dòng CMake của nó;
  - lệch: kiểm nhóm trao đổi khóa vẫn dùng `openssl s_client` của image (bỏ qua nếu thiếu), vì libcurl 7.68 chưa có `CURLOPT_SSL_EC_CURVES` (có từ 7.73);
  - lỗi `mbedtls_ssl_setup` tạo bằng `-Wl,--wrap=calloc`, chỉ cho target test này: lần cấp phát bộ đệm record kế tiếp trả NULL.
- [X] T037 Bản vá cục bộ 3 trong `third_party/civetweb/mod_mbedtls.inl`: gặp `WANT_READ`/`WANT_WRITE` thì `poll()` socket theo chiều cần; tổng thời gian ≤ `request_timeout_ms` (10 s); quá hạn thì đóng kết nối. Đánh dấu "mAT patch 3"; ghi vào mục "Bản vá cục bộ" của `third_party/LICENSES.md`. Đạt T036.

  **Ghi chú khi làm:**
  - "mAT patch 3":
    - `mbed_ssl_handshake` chờ `poll()` theo chiều cần; tổng thời gian ≤ `request_timeout_ms`, đo bằng đồng hồ monotonic;
    - mỗi lần chờ ≤ 2 s (`SOCKET_TIMEOUT_QUANTUM`) để thấy cờ dừng của `mg_stop`;
    - `request_timeout_ms` ≤ 0 thì dùng `MG_MAT_TLS_HANDSHAKE_DEFAULT_MS` = 30 s (mặc định của CivetWeb);
    - `CRYPTO_IN_PROGRESS` gọi lại ngay, `ASYNC_IN_PROGRESS` chờ 1 ms rồi gọi lại; cấu hình của dự án không sinh hai mã này;
    - build với `STOP_FLAG_NEEDS_LOCK` thì `#error`: bản vá đọc cờ dừng như `volatile int`, vì `mod_mbedtls.inl` được include trước khi `stop_flag_t` được khai báo;
  - "mAT patch 4", làm cùng task này theo ghi chú của T007:
    - `mbed_ssl_read` đổi `MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY` thành 0;
    - `mbed_ssl_accept` kiểm `mbedtls_ssl_setup`: lỗi thì in `SSL setup failed, error <mã>`, giải phóng context, từ chối kết nối;
  - `civetweb.c` sửa hai chỗ: chỗ gọi `mbed_ssl_accept` (truyền `request_timeout_ms` và cờ dừng) và nhánh Mbed TLS của `pull_inner` (0 là hết luồng, trả -2 mà không in);
  - **lệch:** chỗ sửa thứ hai nằm ngoài chỗ gọi `mbed_ssl_accept` nhưng bắt buộc: `pull_inner` in lỗi với mọi giá trị ≤ 0 không phải `WANT_*`, kể cả 0. Trả 0 từ `mbed_ssl_read` một mình chỉ đổi `-30848` thành `error 0`;
  - `gcc -Wall -Wextra` trên `civetweb.c`: không cảnh báo mới, chỉ còn 3 cảnh báo cũ của `mbed_debug`;
  - armhf: build và smoke qemu xanh. Kiểm thêm dưới qemu bằng chương trình tạm, không commit: client im lặng tốn 0,2 ms CPU trong 1,5 s, bị đóng sau 2,01 s (`request_timeout_ms` 2000), `mg_stop` 1,81 s;
  - ghi ở `third_party/LICENSES.md` mục "Bản vá cục bộ" và ADR-010 mục "Số đo / bằng chứng".
- [X] T038 [P] Test `server/tests/server_cert_test.cpp` (data-model §3, R5, FR-006):
  - chưa có file → sinh khóa ECDSA P-256 và chứng chỉ X.509 v3 tự ký vào `<dataDir>/tls/server.pem`: khóa rồi chứng chỉ, file `0600`, thư mục `0700`; ghi file tạm, `fsync`, `rename`;
  - CN `mAT <deviceName>`; SAN DNS = hostname; serial 16 byte ngẫu nhiên; hạn 2000-01-01 → 9999-12-31;
  - fingerprint = SHA-256 của DER chứng chỉ, khớp khi tính lại; lần chạy sau dùng lại (cùng fingerprint);
  - file hỏng hoặc sai quyền → **không** sinh lại, trạng thái `cert-error`; `regenerate()` cho fingerprint mới;
  - `device-id` (UUID v4, `<dataDir>/device-id`, `0600`) sinh một lần rồi giữ.

  **Ghi chú khi làm:**
  - 25 test: `ServerCert` 18, `DeviceId` 5, `ServerCertTls` 2. **Đỏ** với bản cài tạm (trả `ServerCert{}`, `DeviceId{}`, đường dẫn rỗng): 25/25 hỏng ở assertion, không test nào crash;
  - thêm ngoài danh sách task:
    - file hỏng gồm cả trường hợp vẫn parse được: một bit của chữ ký bị lật, một byte của phần được ký bị đổi, khóa của thiết bị khác ghép với chứng chỉ;
    - sai quyền: file `0640`, `0604`, `0644`, `0660`, `0666`, `0610`, `0601`; thư mục `0750`, `0705`, `0755`, `0777`, `0710`. Thư mục sai quyền mà chưa có file cũng không sinh khóa. `server.pem` hoặc `tls` là liên kết, `server.pem` là thư mục, `tls` là file: đều `cert-error`;
    - file tạm sót lại sau mất điện; 8 lần khởi động cùng lúc chỉ sinh một khóa và cùng một fingerprint; 6 lần `--regen-cert` cùng lúc để lại một file đủ;
    - SAN chỉ nhận tên DNS hợp lệ; CN giữ nguyên ký tự đặc biệt của RFC 4514 và tiếng Việt;
    - đổi `deviceName` hay hostname không sinh lại chứng chỉ (danh tính đã ghim giữ nguyên);
  - phần HTTPS (`ServerCertTls`, chỉ có khi tìm thấy libcurl, như T036): CivetWeb (`civetweb_runtime`) phục vụ file với TLS 1.2 và 1.3. libcurl (`CURLINFO_CERTINFO`) và `openssl s_client` thấy đúng fingerprint. `openssl x509 -text`, `-purpose`, `-fingerprint -sha256`, `openssl ec -check` đều nhận file. Thiếu `openssl` thì test bỏ qua;
  - **lệch:** `openssl verify` phải có `-partial_chain`. OpenSSL chỉ coi chứng chỉ tự ký là nhà phát hành của chính nó khi keyUsage có `keyCertSign`, mà RFC 5280 §4.2.1.9 không cho `keyCertSign` khi `CA:FALSE` (lần chạy đầu: "unable to get local issuer certificate"). Chứng chỉ giữ nguyên, chỉ sửa test.
- [X] T039 Cài `server/tls/server_cert.{hpp,cpp}` (Mbed TLS `mbedtls_x509write_crt`, CTR-DRBG), kèm `device-id`, đạt T038.

  **Ghi chú khi làm:**
  - **xanh** 25/25. Cả bộ x64: 532/631 đạt; 99 test hỏng đều thuộc các suite của `core/auth` (b1 đang ở pha đỏ của T026–T031), không suite nào khác hỏng. Build armhf xanh, không có cảnh báo; clang-format sạch;
  - API, dùng ở T044, T047:
    - `loadOrCreateServerCert({dataDir, deviceName, hostname})`: khởi động;
    - `readServerCert(dataDir)`: chỉ đọc, cho `--cert-fingerprint`;
    - `regenerateServerCert(...)`: cho `--regen-cert`;
    - ba hàm trả `ServerCert { ok, httpsState() ("ok" | "cert-error"), pemPath, fingerprint (64 hex), fingerprintColons (95 ký tự), generated (ghi audit `cert.generate`), error }`;
    - `loadOrCreateDeviceId(dataDir)` trả `{ id, created, warning }`;
    - module không tự ghi log: `error` và `warning` để `main` in ra;
  - thư viện `mat_server_tls` (STATIC; link PRIVATE `mat_crypto`, `mat_mbedtls`), tự thêm vào `mat_device`. Chưa nối vào `mat-runtime`, `mat_cli`: việc của T044, T047;
  - **chứng chỉ:**
    - CN là UTF8String, ghi bằng dạng hex DER `CN=#0c…` mà Mbed TLS nhận nguyên văn, nên tên thiết bị không cần thoát ký tự;
    - **lệch nhỏ:** serial 16 byte, byte đầu trong 0x01–0x7F (số dương và DER tối thiểu; nếu byte đầu là 0 thì Mbed TLS ghi INTEGER không tối thiểu);
    - extKeyUsage `serverAuth` ghi bằng `set_extension`, không critical (hàm có sẵn của Mbed TLS đánh critical); keyUsage critical; basicConstraints `CA:FALSE`;
    - không có SKI, AKI: Mbed TLS tính bằng SHA-1, mà SHA-1 đã tắt;
    - hostname không phải tên DNS hợp lệ (LDH, nhãn 1–63, tổng ≤ 253) thì bỏ SAN;
  - **kiểm file có sẵn:**
    - mở bằng `O_NOFOLLOW`; phải là file thường, `mode & 077 = 0`, ≤ 16 KiB;
    - parse được khóa và chứng chỉ; khóa ECDSA, khớp cặp với chứng chỉ;
    - chứng chỉ tự ký và chữ ký đúng. Đây là luật chặt hơn task: một byte hỏng ở bất kỳ đâu cho `cert-error` thay vì một fingerprint lạ. Kiểm chữ ký phải đọc trường riêng `sig` của Mbed TLS 3.6, có chú thích trong mã và ADR-010;
    - thư mục `tls` có `mode & 077 ≠ 0` cũng là `cert-error`; `--regen-cert` đưa thư mục về `0700`;
  - **ghi:**
    - thư mục mở bằng `O_NOFOLLOW` và khóa `flock` trong cả lúc kiểm lẫn lúc ghi, để lần khởi động và `--regen-cert` không xen nhau;
    - file tạm `server.pem.tmp` mở bằng `O_EXCL`, rồi `fchmod 0600`, `fsync`, `renameat`, `fsync` thư mục;
    - tạo `<dataDir>` và `tls` (`0700`) khi thiếu;
    - bộ đệm từng chứa khóa riêng được xóa (`mbedtls_platform_zeroize`);
  - **`device-id`:**
    - file chứa `<uuid>\n`, quyền `0600`;
    - nội dung khác UUID v4 chữ thường thì sinh lại và trả cảnh báo; file đọc được thì dùng, bất kể quyền;
    - không ghi được thì vẫn trả id (chỉ dùng tới khi runtime dừng), kèm cảnh báo;
    - lý do sinh lại mà không báo lỗi: id không phải bí mật, chỉ để Studio nhận lại thiết bị;
  - **số đo** (chương trình tạm ở scratchpad), trung vị:
    - x64: sinh khóa và chứng chỉ 0,37 ms (tmpfs), 19,8 ms khi có `fsync` trên overlay; đọc và kiểm 0,8 ms;
    - armhf dưới qemu, chỉ tham khảo: 3,5 ms, 15,8 ms, 7,7 ms;
    - PEM 797–801 byte (chứng chỉ DER 381 byte);
  - **kiểm cấu trúc:**
    - rustls 0.23.45 + ring 0.17.14 (cùng bản của Studio), verifier kiểu `PinnedVerifier`: TLS 1.2 và 1.3 bắt tay được, webpki parse được, ghim sai bị chặn;
    - Chrome 154: chỉ báo `ERR_CERT_AUTHORITY_INVALID` (tự ký), không có lỗi cấu trúc hay chữ ký yếu;
    - OpenSSL kiểm độc lập chữ ký tự ký (`dgst -verify`): OK;
    - chi tiết ở ADR-010, mục "Số đo / bằng chứng".
- [X] T040 [P] ⏸ Q3 Test `server/tests/auth_gate_test.cpp` (device-api §1.3), hàm thuần trên mô tả request, không cần CivetWeb:
  - thứ tự TLS → phiên (`Authorization: Bearer mats_…`, mặc định của Q3) → role → audit;
  - không TLS → 403 `HTTPS_REQUIRED`; không có header → 401 `AUTH_REQUIRED`; token lạ hoặc hết hạn → 401 `SESSION_EXPIRED`; khác IP, tài khoản tắt hoặc `rev` đổi → 401 `SESSION_INVALID`; thiếu role → 403 `FORBIDDEN`; thao tác thay đổi khi không ghi được audit → 503 `AUDIT_UNAVAILABLE`;
  - từ chối ở bước 1–3 đều ghi `access.denied` (gộp 60 s);
  - làm mới hạn phiên đúng danh sách §1.3.

  **Ghi chú khi làm:**
  - 15 test (`GateOrder` 4, `GateSession` 2, `GateRole` 2, `GateAudit` 1, `GateRefresh` 1, `GateAuditLog` 2, `GateWithAuthService` 1, `Bearer` 1, `GateMessage` 1). **Đỏ** với bản cài tạm (quyết định rỗng, không audit, không tách token): 15 hỏng / 0 đạt, mọi lỗi ở mức assertion;
  - thêm ngoài danh sách task, chốt khi làm:
    - đường dẫn không có trong bảng quyền → 404 `NOT_FOUND`, không kiểm gì, không audit;
    - phương thức sai → 405 kèm `Allow` lấy từ bảng (`allowedMethods`). Kiểm **sau** TLS, để qua HTTP mọi endpoint kỹ thuật chỉ trả 403, không lộ gì thêm; `HEAD`, `OPTIONS` cũng là 405;
  - header không phải `Bearer <token>` (rỗng, `Basic …`, `Bearer` trơn) → `AUTH_REQUIRED`. Tên scheme không phân biệt hoa thường (RFC 6750), bỏ khoảng trắng hai đầu;
  - bản ghi `access.denied`: kênh `http`/`https`; `target` là đường dẫn (CivetWeb `local_uri`, không có query); `user` khi biết (`SESSION_INVALID`, `FORBIDDEN`); `role` khi `FORBIDDEN`. Gộp 60 s kiểm bằng `AuditLog` thật: 3 lần cùng loại từ một IP (khác cổng) → 1 dòng `count` 3;
  - không ghi được bản ghi thì câu trả lời không đổi; log tối đa 1 dòng/phút, kèm số bản ghi mất trong lúc đó;
  - một test chạy cổng kiểm trên `AuthService` thật: phiên gắn IP, role đọc từ `users.json`, hạn rảnh chỉ làm mới theo §1.3.
- [X] T041 [P] Test `server/tests/https_api_test.cpp` (CivetWeb trong tiến trình, hai context, client libcurl):
  - **hai listener:** HTTP (`port`) phục vụ y như 0.3.0, không cần đăng nhập (FR-033); HTTPS (`httpsPort`) phục vụ mọi endpoint của HTTP cộng API kỹ thuật;
  - endpoint kỹ thuật gọi qua HTTP → 403 `HTTPS_REQUIRED` và audit `access.denied` (FR-007);
  - giới hạn 10 phiên live tính chung hai listener: 6 `ws` + 5 `wss` → phiên thứ 11 nhận 4429 (Constitution IV);
  - chứng chỉ lỗi → HTTP vẫn chạy, `system/info.device.https = "cert-error"`; cổng HTTPS đang bị chiếm → HTTP vẫn chạy, `tls-error` (analyze B4); `httpsPort = 0` → `off`;
  - `system/info` thêm khối `device` (`deviceId`, `name`, `model`, `apiVersion`, `httpsPort`, `https`, `discovery`), `project.digest` và `operation` (luôn `null` tới US2); không có tài khoản, địa chỉ hay fingerprint. `/api/v1/projects/active` thêm `digest`;
  - `GET /api/v1/device/identity` không cần đăng nhập; `setupRequired: true` khi chưa có tài khoản; `fingerprint` 64 hex chữ thường; `features`;
  - `POST /api/v1/auth/login`: 200 `{ token, user, role, idleTimeoutS: 1800, maxLifetimeS: 43200 }`; 401 `AUTH_FAILED` cùng câu cho mọi trường hợp; 429 `AUTH_LOCKED` kèm `retryAfterS` và header `Retry-After`; 429 `AUTH_BUSY` (`Retry-After: 2`); 503 `AUDIT_UNAVAILABLE` không cấp token; thân ≤ 4 KiB, `user` ≤ 64 byte, `password` ≤ 512 byte;
  - `POST /api/v1/auth/logout` → 204 và audit `auth.logout`; `GET /api/v1/auth/session` không làm mới hạn;
  - header `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, không có header CORS; thân JSON > 16 KiB → 413 `BODY_TOO_LARGE`; không phải object → 400 `BAD_REQUEST`; sai phương thức → 405 kèm `Allow`.

  **Ghi chú khi làm:**
  - 22 test `HttpsApi.*`. Hai context mở bằng chính `WebContexts` của `main`, với `AuditLog`, `AuthService` (băm giả; một test Argon2id thật), `server_cert`, transport và hub thật. Client: libcurl; `wss` viết trong test bằng `CURLOPT_CONNECT_ONLY` + `curl_easy_send/recv`, vì libcurl 7.68 chưa có WebSocket;
  - **đỏ** với bản cài tạm (`EngineeringApi` không đăng ký route, digest bị bỏ, `http_api` chưa có khối `device`, live 1.0.0): 21 hỏng / 1 đạt, ở mức assertion. Test đạt là `HttpListenerServesThePageAsBefore`: test chặn hồi quy FR-033, không phụ thuộc mã mới. Lần đỏ đầu lộ 2 lỗi của chính test (`bodyJson` ném ngoại lệ; test `AUTH_BUSY` để lại thread khi thoát sớm). Đã sửa test, rồi chạy đỏ lại;
  - **xanh** 22/22. Có sửa 1 lỗi mã: `logout` tạo `string_view` từ chuỗi tạm `value_or("")`;
  - hai kỳ vọng của test chỉnh theo thiết kế đã chốt (không phải lỗi mã):
    - 13 endpoint qua HTTP chỉ ra 10 dòng `access.denied`. Ba dòng còn lại đếm trong `audit.suppressed`, vì `AuditLog` giới hạn ≤ 10 dòng từ chối mỗi phút (R11);
    - 5 lần đăng nhập song song cùng tên, cùng IP tạm khóa cả tên lẫn IP, vì T035 đếm lần sai trước khi băm. Muốn thấy `AUTH_BUSY` thì lần thứ 6 phải từ địa chỉ khác (test dùng 127.0.0.2);
  - kiểm thêm:
    - HTTP đóng kết nối sau mỗi phản hồi, như 0.3.0;
    - HTTPS giữ kết nối, kể cả sau 413;
    - endpoint của bảng chưa cài: 401/403 rồi 501 `NOT_IMPLEMENTED`;
    - mật khẩu thử không có trong phản hồi, `audit.db*`, log, stderr.
- [X] T042 ⏸ Q3 Cài `server/http/auth_gate.{hpp,cpp}`, đạt T040.

  **Ghi chú khi làm:**
  - **xanh** 15/15;
  - `AuthGate` (lớp, an toàn đa luồng) nhận `GateDeps`: `authorize` (`AuthService::authorize`), `audit` (`AuditLog::append`), `auditAvailable` (`AuditLog::isOpen`). Không phụ thuộc CivetWeb;
  - kèm `bearerToken()` và `gateMessage()`: câu tiếng Việt cho mọi mã lỗi của cổng kiểm và của các endpoint đăng nhập;
  - bước 4 dùng `isOpen()` làm kiểm sớm; thao tác thay đổi của US2 vẫn phải tự từ chối khi ghi bản `started` thất bại.
- [X] T043 Cài `server/http/engineering_api.{hpp,cpp}` phần thiết bị và đăng nhập: `device/identity`, `auth/login`, `auth/logout`, `auth/session`; hằng `kDeviceApiVersion = "1.0.0"`. Chưa có route project.

  **Ghi chú khi làm:**
  - `kDeviceApiVersion` nằm ở `server/device_state.hpp`. `DeviceState` dùng chung cho khối `device` của `system/info`, cho `device/identity` và cho gói trả lời tìm thiết bị;
  - mỗi đường dẫn của bảng quyền có một handler (`{opId}` → `*`), cài trên cả hai context. Cổng kiểm quyết định 404/403/405/401/503;
  - **lệch:**
    - endpoint của bảng chưa cài trả 501 `NOT_IMPLEMENTED` sau cổng kiểm, để 401/403 không phụ thuộc phần đã cài. US2, US4 thay bằng route thật;
    - `features` chỉ liệt kê phần đã có: `["auth"]`. US2 thêm `deploy`, `upload`, `restore`; US4 thêm `diagnostics`, `audit`;
  - đăng nhập:
    - thân đọc theo `Content-Length`; JSON lồng > 8 cấp → 400;
    - `user` > 64 byte, `password` > 512 byte → 400;
    - audit chưa mở → 503 ngay, không tốn lần băm;
    - thân và mật khẩu xóa bằng `secureZero`;
  - thân vượt giới hạn:
    - ≤ 64 KiB: đọc bỏ, trả 413, giữ kết nối;
    - > 64 KiB hoặc chunked: đóng kết nối, không đọc (`mg_disable_connection_keep_alive`);
    - chunked trên `POST` → 411;
  - header: 401 kèm `WWW-Authenticate: Bearer`, 429 kèm `Retry-After`; 204 không có `Content-Type`.
- [X] T044 Nối hai context, đạt T041:
  - `server/http/http_api.{hpp,cpp}`: khối `device`, `digest`, `operation`; handler 403 `HTTPS_REQUIRED` cho đường dẫn kỹ thuật trên HTTP;
  - `server/websocket/civet_transport.{hpp,cpp}`: cài trên hai context, chung giới hạn phiên;
  - `server/main.cpp` theo thứ tự khởi động của [contracts/device-config.md](contracts/device-config.md) §7, bước 1, 2, 5, 6, 8:
    - `psa_crypto_init()` trước khi mở cổng;
    - mở `audit.db`; lỗi thì vẫn chạy trang xem nhưng từ chối đăng nhập và mọi thao tác thay đổi;
    - nạp rồi xóa `auth-state.json`;
    - chứng chỉ: chưa có thì sinh (audit `cert.generate`), hỏng thì tắt HTTPS;
    - context HTTP, rồi context HTTPS với `httpsThreads` worker, keep-alive 60 s, `request_timeout_ms` 10 s.

  **Ghi chú khi làm:**
  - `server/http/web_contexts.{hpp,cpp}`:
    - `startHttp` mở context HTTP với tùy chọn như 0.3.0;
    - `startHttps(options, cert)` trả `Off` / `CertError` / `TlsError` / `Ok`; dùng `mg_start2` để có lý do lỗi ghi log;
  - `http_api`: `system/info` thêm `device` và `operation: null`. `Connection: close` chỉ gửi trên HTTP;
  - `server/tls/tls_init.*`: `psa_crypto_init` nằm sau header của module. Lỗi → `tls-error`;
  - `main.cpp`, theo các bước của §7:
    - bước 1–2: PSA, rồi `audit.db`. Không mở được `audit.db` thì log; đăng nhập trả 503;
    - digest của project tính lúc nạp;
    - bước 5: `AuthService` tạo sau mọi lệnh dòng lệnh, rồi `loadState(kAuthStateFile)`;
    - bước 6: device-id, chứng chỉ. Chứng chỉ mới sinh: audit `cert.generate`, `target` = fingerprint. Lúc khởi động in `SHA256 Fingerprint=…`;
    - bước 8: HTTP, rồi HTTPS;
    - khối tìm thiết bị của c0 sửa theo ghi chú của c0: device-id và chứng chỉ lấy từ bước 6; `https`/`fp` chỉ có khi HTTPS chạy; có `project.digest`; `device.discovery` theo `running()`;
    - vòng tick gọi `flushExpired()` mỗi 5 s, `maintain()` mỗi 24 giờ, log lỗi ≤ 1 dòng/phút;
    - lúc dừng: `web.stop()`, rồi `audit.close()`;
  - CMake:
    - `mat-runtime` link `mat_device`, thay dòng link riêng của T060;
    - `mat_package` thêm `project_digest.cpp`; `mat_server_tls` thêm `tls_init.cpp`;
    - không thêm `mat_device` vào `mat_test` hay `mat_cli`: các test link đúng module chúng cần;
  - **kiểm:**
    - `test-x64.ps1` cả bộ: 985/1050 đạt. 65 test hỏng đều là `StoreState`, `ProjectStore`, `BootDecision`, `StartStore`, `DeployPipeline`: pha đỏ US2 của agent khác;
    - build armhf xanh, không cảnh báo; `smoke-armhf.sh` OK;
    - runtime armhf dưới qemu mở 8080 và 8443 (identity 200, `auth/session` 401);
    - clang-format sạch;
  - **số đo x64** (Docker Desktop, tank-demo, `simLoad`):
    - RSS khi rảnh 8,8 MB;
    - CPU khi rảnh 20 ms trong 30 s;
    - đăng nhập Argon2id thật, mỗi lần một `curl` mới (gồm bắt tay TLS): 80–115 ms;
    - fingerprint của `--cert-fingerprint` trùng `openssl s_client`;
  - **rủi ro còn mở (ADR-010):**
    - keep-alive 60 s: mỗi kết nối HTTPS rảnh giữ 1 worker tới 60 s. Vậy 8 kết nối từ bất kỳ máy nào trong LAN, mỗi kết nối gửi một request rồi im, giữ hết 8 worker tới 60 s, lâu hơn trường hợp bắt tay im lặng (10 s). Chưa đo; cần xét ở kịch bản `tls-idle` (T051): hạ keep-alive xuống khoảng 5–10 s, hoặc chấp nhận và ghi vào ADR. **Đã xử lý 2026-10-12** (e2): hạ xuống 15 s, Studio 10 s. Số đo ở T051, quyết định ở ADR-010;
    - mỗi phiên `wss` cũng giữ 1 worker HTTPS suốt phiên.
### Lệnh trên thiết bị: tài khoản, chứng chỉ, đo băm

- [X] T045 [P] ⏸ Q5 Test `server/tests/user_cli_test.cpp` ([contracts/device-config.md](contracts/device-config.md) §4, FR-011):
  - `--user-add <tên> --role <role> [--password-stdin]`, `--user-passwd`, `--user-role`, `--user-disable`, `--user-enable`, `--user-unlock`, `--user-list`;
  - mã thoát: không phải root, tên không hợp lệ, không ghi được file → 4; tham số sai → 2; file hỏng → 6;
  - mật khẩu chỉ từ TTY (tắt echo, nhập hai lần) hoặc một dòng stdin; không có tham số dòng lệnh nào nhận mật khẩu; 15–128 ký tự, khác tên tài khoản;
  - mật khẩu có dấu tổ hợp (U+0300–U+036F, U+1AB0–U+1AFF, U+1DC0–U+1DFF, U+20D0–U+20FF, U+FE20–U+FE2F) bị từ chối, mã 2, kèm hướng dẫn chọn "Unicode dựng sẵn" (ADR-011, chốt 2026-10-11);
  - ghi audit (`account.create`, `account.password`, `account.role`, `account.disable`, `account.enable`, `account.unlock`) qua tiến trình con hạ quyền xuống `matscada`, **trước** khi đổi; không ghi được → mã 5, `users.json` không đổi;
  - `rev` tăng khi đổi mật khẩu, role, bật/tắt; `unlockSeq` tăng khi mở khóa; `--user-list` không in hash;
  - không cho xóa hoặc hạ role administrator cuối cùng còn bật.

  **Ghi chú khi làm:**
  - 20 test (`UserCli` 19, `UserCliCommand` 1). **Đỏ** với bản cài tạm (header đủ, hàm trả 99 hoặc `false`): 18 hỏng / 0 đạt, mọi lỗi ở mức assertion, không test nào sập. Hai test viết thêm khi cài khóa `users.json` (xem T047) đỏ trên bản cài chưa khóa: `CommandsTakeTurnsOnUsersJson` (lệnh không chờ, thay đổi đã ghi khi lệnh khác còn giữ khóa), `AMissingDirectoryStopsTheCommandBeforeThePassword` (đã đọc mật khẩu, audit có dòng);
  - test chạy bằng root trong container. User `daemon` (uid 1) của image đóng vai `matscada` (`DeviceCliEnv.serviceUser`); thư mục dữ liệu `chown daemon`, như `StateDirectory`;
  - **TTY thật bằng pty** (`posix_openpt`): luồng "người gõ" chờ terminal tắt echo rồi mới gõ hai lần. Phía master không thấy ký tự nào của mật khẩu; echo bật lại sau lệnh. SIGINT gửi vào tiến trình đang chờ mật khẩu: tiến trình dừng vì SIGINT, terminal vẫn có lại echo;
  - **hạ quyền thật:** `audit.db` do tiến trình con tạo thuộc `daemon`, `0600`. Không ghi được audit (thư mục dữ liệu của root, `0700`) → mã 5 với cả 6 lệnh đổi, `users.json` giữ từng byte, audit không thêm dòng;
  - kiểm thêm ngoài danh sách:
    - mật khẩu đưa làm tham số (`--password x`, `--password=x`, `--password-stdin=x`, giá trị thừa) → mã 2, và chuỗi đó không có trong thông báo. Tên hoặc role sai cũng không được trích lại, vì có thể là mật khẩu gõ nhầm chỗ;
    - chỉ lấy dòng đầu của stdin, bỏ CR trước LF; dòng trống, stdin rỗng, không phải UTF-8, 14 và 129 ký tự, trùng tên (khác hoa thường) → mã 2; 15, 128 ký tự và 128 chữ "ệ" (384 byte) được nhận;
    - dấu tổ hợp: hai biên của từng khối, và "Mật khẩu" gõ kiểu tổ hợp, đều bị từ chối; các mã điểm ngay ngoài khối và chữ Việt dựng sẵn được nhận;
    - administrator bị tắt không tính là administrator cuối cùng;
    - đặt role hay trạng thái đang có: mã 0, không ghi audit, `users.json` giữ từng byte;
    - `users.json` không ghi được (`/sys` chỉ đọc của container) → mã 4, audit `started` rồi `failed` kèm `code`. Thư mục của `users.json` không có → mã 4 trước khi đọc mật khẩu (dòng mật khẩu còn nguyên trong pipe), audit không có dòng nào;
    - hai lệnh cùng lúc: test giữ `flock` thư mục `etc`; `--user-disable` chờ (500 ms chưa xong, tài khoản còn bật), nhả khóa thì lệnh xong;
    - container không có user dịch vụ → tiến trình con giữ user hiện tại, lệnh in cảnh báo nêu tên user.
- [X] T046 [P] Test `server/tests/cert_cli_test.cpp`:
  - `--cert-fingerprint` in `SHA256 Fingerprint=AB:CD:…`, trùng `openssl x509 -fingerprint -sha256` (image có `openssl` từ T008);
  - `--regen-cert` (root): sinh khóa mới qua tiến trình con `matscada`, in fingerprint mới, ghi audit `cert.regenerate`, gọi `systemctl try-restart mat-runtime` (lệnh tiêm được, giả trong test); không ghi được audit → mã 5, chứng chỉ không đổi.

  **Ghi chú khi làm:**
  - 10 test (`CertCli` 9, `CertCliCommand` 1). **Đỏ** với bản cài tạm: 10 hỏng / 0 đạt, ở mức assertion;
  - `--cert-fingerprint` chạy cả bằng root và bằng `daemon` thật (test `fork` rồi `setuid`). Dòng in ra giống từng byte dòng của `openssl x509 -noout -fingerprint -sha256` (OpenSSL 1.1.1f). Chưa có chứng chỉ, hoặc chứng chỉ hỏng → mã 6, không tạo file nào;
  - `--regen-cert`: `server.pem` mới thuộc `daemon`, `0600`, thư mục `0700`; audit `started` (`from` = fingerprint cũ) rồi `ok` (`from`, `to`); `systemctl try-restart mat-runtime` đúng một lần. `audit.db` của root (user dịch vụ không mở được) → mã 5, `server.pem` giữ từng byte, không restart;
  - kiểm thêm: chứng chỉ hỏng thì `--regen-cert` thay được (lối ra của `cert-error`, R5); user dịch vụ không ghi được thư mục `tls` → mã 4, `failed` kèm `code`, không restart; restart lỗi chỉ cảnh báo kèm lệnh `systemctl restart mat-runtime`, mã 0; không phải root → mã 4, không ghi gì.
- [X] T047 Cài `server/cli/users.{hpp,cpp}`, `server/cli/cert.{hpp,cpp}`, `server/cli/auth_bench.{hpp,cpp}` (`--auth-bench [--m <KiB>] [--t <n>]`: chỉ tính, không ghi gì) và nhánh xử lý trong `server/main.cpp`, chạy trước khi mở cổng như lệnh của 003. Đạt T045, T046.

  **Ghi chú khi làm:**
  - **xanh** 34/34: `UserCli` 20, `CertCli` 10, `AuthBenchCli` 4 (`server/tests/auth_bench_test.cpp`, đỏ 4/4 cùng lúc với T045, T046). Chạy thẳng từng binary: không test nào bị bỏ qua;
  - file mới: `server/cli/device_cli.{hpp,cpp}` (phần chung), `users`, `cert`, `auth_bench`. `mat_cli` link thêm PUBLIC `mat_auth mat_audit mat_server_tls`. `main.cpp` chỉ thêm ba nhánh ngay sau `--set-secret`, trước khi đọc cấu hình: không mở cổng, không tạo `AuthService`;
  - **`DeviceCliEnv`** tiêm được: root hay không, fd nhập mật khẩu, user dịch vụ, đồng hồ, hostname, lệnh chạy `systemctl`. Cấu hình đọc bằng `loadConfig` như dịch vụ, nhận thêm `--config`, `--data-dir`, `--users-file`;
  - **tiến trình con:** `fork`, rồi `setgroups(0)`, `setgid`, `setuid` sang user dịch vụ (kiểm không lấy lại được root), `umask 077`, `chdir /`; mở `AuditLog` riêng, `append`, `close`, `_exit`. Thông báo lỗi về qua pipe. User dịch vụ không tồn tại (container dev): giữ user hiện tại, kèm cảnh báo. Mỗi thao tác hai lần ghi: `started` trước khi đổi, `ok`/`failed` sau. Ghi kết quả lỗi sau khi đã đổi thì chỉ cảnh báo (mã 0, đã có `started`);
  - **khóa `users.json`** (thêm ngoài task): `flock` độc quyền trên thư mục của file, từ lần đọc tới lần ghi, như `server_cert`. Không khóa thì hai lệnh cùng lúc có thể làm mất một thay đổi, ví dụ tài khoản vừa tắt lại bật. Mật khẩu hỏi trước khi lấy khóa (không giữ khóa khi người gõ); dưới khóa đọc lại file và kiểm lại;
  - **mật khẩu:** đọc từng byte bằng `read(2)` (không qua bộ đệm stdio), chuỗi cấp sẵn 513 byte nên không để lại bản sao khi cấp phát lại; xóa bằng `secureZero` ở mọi đường ra, trước mọi `fork`. Terminal: tắt echo một lần cho cả hai lần nhập (`TCSAFLUSH`); handler SIGINT, SIGQUIT, SIGTERM, SIGHUP trả lại termios rồi để tín hiệu chạy tiếp (`SA_RESETHAND`). `--password-stdin` trên terminal cũng tắt echo, hỏi một lần. Thứ tự kiểm: UTF-8, dấu tổ hợp (ADR-011), rồi `checkNewPassword`;
  - **mã thoát, lệch contract §4** (contract không nói tới các trường hợp này): 4 cả cho tài khoản đã có, không có tài khoản, đủ 64, administrator cuối cùng; 2 cho mọi mật khẩu bị từ chối (task chỉ ghi dấu tổ hợp); `--auth-bench` băm lỗi (hết bộ nhớ) → 4. Đặt role hay trạng thái đang có: mã 0, không đổi gì;
  - **không có lệnh xóa tài khoản:** contract §4 không có, danh mục audit (data-model §7) không có `account.remove`. Luật "administrator cuối cùng" áp cho tắt và hạ role;
  - **`--user-list`:** dòng tiêu đề, rồi mỗi tài khoản một dòng: tên, role, `bật`/`tắt`, lần đổi cuối (UTC); hash hỏng thì thêm ghi chú. `deploy.sh` đọc cột 2, 3; test khóa định dạng này. File cho người khác đọc thì cảnh báo, vì runtime không dùng file đó;
  - nhóm của `users.json` là nhóm chính của user dịch vụ (`matscada` trên thiết bị);
  - **`--regen-cert`:** in fingerprint cũ vào audit (`from`), mới (`to`); không hỏi xác nhận (contract không có). `systemctl` không chạy được hay trả mã khác 0 → cảnh báo kèm `systemctl restart mat-runtime`, mã 0;
  - **`--auth-bench`:** 1 lần làm nóng + 10 lần; in trung vị, min, max (đồng hồ treo tường), CPU trung vị, `VmRSS` trước và `VmHWM`, số lần `mmap`/`munmap`, máy, kết luận theo R7 (≤ 0,8 s giữ; 0,8–1 s hạ t = 1; > 1 s xem lại ADR-011), và một dòng bảng Markdown cho ADR-011 (dấu phẩy thập phân). Không đọc cấu hình, không ghi file, user nào cũng chạy được; m 8192–65536 KiB, t 1–10 (khoảng chặn của `parsePhc`);
  - **số đo `--auth-bench`** (tham khảo; số của BL335 chờ T055):
    - x64, Docker trên máy dev: t = 2 trung vị 25,3–25,7 ms, t = 1 15,4–15,5 ms; RSS đỉnh +19,1 MiB. Khi máy đang build song song: 51,9 ms và 34,7 ms;
    - armhf dưới qemu-arm: t = 2 trung vị 310,5 ms (min 301,5, max 320,3), t = 1 156,6 ms; RSS của tiến trình qemu +19,8–20,1 MiB; thư mục tạm chỉ còn binary;
  - **chạy thử đầu-cuối** bằng binary x64 thật trong container dùng một lần, có user `matscada` như trên thiết bị: `users.json` `root:matscada 0640`; `audit.db` và `tls/server.pem` thuộc `matscada`; `--cert-fingerprint` (chạy bằng `matscada`) trùng `openssl`; không tìm thấy mật khẩu thử trong `/etc/mat-runtime`, `/var/lib/mat-runtime`;
  - build armhf xanh, không cảnh báo mới; clang-format sạch;
  - cả bộ x64 (không `-Target`/`-Filter`, sau khi thêm khóa): 983/983 đạt, cộng 1 test tắt (`AuditLogBench`). Lần chạy trước đó, khi agent khác còn dở (package, `HttpsApi`, live 1.1), có 223 test hỏng, đều ngoài phần này.

### Unit, script, khung kiểm tích hợp

- [X] T048 `deployment/systemd/mat-runtime.service`: thêm `RuntimeDirectory=mat-runtime`, `RuntimeDirectoryMode=0700` (contract device-config §3); giữ nguyên sandbox (`RestrictAddressFamilies`, `CapabilityBoundingSet=` rỗng, `ReadOnlyPaths`). Bổ sung `deployment/device/tests/deploy_rollback_test.sh`: unit có hai dòng mới, không có `AF_NETLINK`, không có capability.

  **Ghi chú khi làm:**
  - unit thêm hai dòng cùng chú thích (tmpfs, mất khi dịch vụ dừng); sandbox không đổi;
  - `deploy_rollback_test.sh` kiểm unit thật trong repo:
    - có `RuntimeDirectory=mat-runtime`, `RuntimeDirectoryMode=0700`, `CapabilityBoundingSet=` rỗng, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`, `ReadOnlyPaths=/opt/mat-runtime /etc/mat-runtime`, `NoNewPrivileges=true`;
    - không có `AF_NETLINK`; không có `AmbientCapabilities` hay `CapabilityBoundingSet` mang giá trị;
  - **đỏ** trên unit cũ (`unit thiếu dòng: RuntimeDirectory=mat-runtime`). Thử trên bản sao của unit: thêm `AF_NETLINK` hoặc một capability đều làm test hỏng;
  - **xanh** trên unit mới: `deploy/rollback: OK`.
- [X] T049 `deployment/device/deploy.sh` phần tài khoản và chứng chỉ (contract device-config §5, FR-011):
  - health check thêm kiểm cổng HTTPS mở được khi `httpsPort ≠ 0`;
  - sau khi đạt: in fingerprint (`--cert-fingerprint`) kèm lời nhắc ghi lại để so khi ghim trong Studio;
  - chưa có tài khoản administrator nào: có TTY thì chạy `--user-add admin --role administrator`; không có TTY thì in "BƯỚC BẮT BUỘC: tạo tài khoản quản trị bằng …" rồi đi tiếp;
  - bổ sung `deployment/device/tests/deploy_rollback_test.sh` cho hai nhánh có và không có TTY.

  **Ghi chú khi làm:**
  - **health check:** `httpsPort` đọc từ `runtime.json` như `port` (thiếu thì 8443, `0` thì bỏ qua). Mỗi lần thử: project active qua HTTP, rồi một request thật qua TLS, `wget -T 2 -t 1 --no-check-certificate https://127.0.0.1:<httpsPort>/api/v1/system/info` (chứng chỉ tự ký; wget của Ubuntu 20.04 trên BL335 có TLS, deploy đã dùng wget cho HTTP). Không đạt sau 15 lần thử thì rollback, log nêu lý do ("cổng HTTPS … không trả lời");
  - **bước 6, sau khi đạt; không làm deploy thất bại:**
    - fingerprint: `runuser -u matscada -- … --cert-fingerprint`, kèm lời nhắc "GHI LẠI fingerprint …". `httpsPort = 0`: báo HTTPS tắt, không in fingerprint;
    - tài khoản quản trị: `--user-list` (root), tìm dòng có cột 2 `administrator`, cột 3 `bật`; administrator bị tắt không tính. Có terminal (`[ -t 0 ]`) thì chạy `--user-add admin --role administrator`: mã 2 (mật khẩu bị từ chối, hai lần nhập khác nhau) cho nhập lại, tối đa 3 lần; mã khác thì dừng. Không có terminal, hỏi 3 lần không được, hay `--user-list` lỗi: in "BƯỚC BẮT BUỘC: tạo tài khoản quản trị bằng lệnh sau …" kèm lệnh đầy đủ, rồi đi tiếp. Lỗi của `--user-list` (stderr) hiện thẳng trong log;
  - chuỗi cũ giữ nguyên: checksum, stage, validate, backup, unit đi cặp, activate, rollback;
  - **test** (`deploy_rollback_test.sh`): `sleep` giả cho nhanh; `wget` giả trả lời HTTPS trừ khi có file cờ; binary giả dùng chung cho mọi gói, trả `--cert-fingerprint`, `--user-list` đúng cột của lệnh thật, ghi lại lời gọi `--user-add` và có terminal hay không. Terminal thật cho deploy bằng `script(1)` (util-linux có sẵn trong image). Các nhánh: không terminal; có terminal; đã có administrator; administrator bị tắt; mật khẩu bị từ chối 3 lần; `--user-add` lỗi khác; `--user-list` lỗi; HTTPS không trả lời → rollback; `httpsPort = 0`;
  - **đỏ:** chạy test mới với `deploy.sh` cũ (dựng lại nguyên văn trong scratchpad): `FAIL: deploy phải in fingerprint của chứng chỉ HTTPS`. Bỏ các khối trước, riêng khối HTTPS: `FAIL: cổng HTTPS không trả lời mà deploy vẫn đạt`. **Xanh:** `deploy/rollback: OK`; `dash -n` sạch cho cả hai script; file giữ LF.
- [X] T050 [P] `deployment/toolchain/run-x64.ps1`: tham số `-HttpsPort` (mặc định 8443, publish cổng), `-UsersFile` (mặc định `/tmp/mat-etc/users.json`), `-NoDiscovery`; truyền `--https-port`, `--users-file`, `--project-store-dir`; in lệnh tạo tài khoản thử như quickstart §2. Thông báo in ra không dấu (PowerShell 5.1).

  **Ghi chú khi làm:**
  - cổng HTTPS trong và ngoài container cùng số, để `device/identity` báo đúng cổng Studio dùng. `-HttpsPort 0` tắt HTTPS;
  - thư mục của `-UsersFile` được tạo bằng `docker exec` sau khi chạy. Lý do: truyền `sh -c "… \"$@\""` qua PowerShell 5.1 làm hỏng dấu ngoặc kép;
  - thêm `-BuildDir`, như `test-x64.ps1` (binary ở `/build/x64`), để không build trên ổ D:;
  - in lệnh `--user-add` (admin, kysu1) và `--cert-fingerprint` kèm `--users-file`, `--data-dir`, theo lệnh của c2;
  - kiểm: script parse được bằng Parser của PowerShell, không có ký tự ngoài ASCII trong chuỗi in ra. Đã chạy thật với `-Port 18081 -HttpsPort 18444 -NoDiscovery -NoBuild -BuildDir C:\build\mat-x64-c1`: identity 200, HTTP `diagnostics` 403. Chạy xong đã xóa container.
- [X] T051 `tools/device-it.ps1` và `tests/device-it/`, khung kiểm tích hợp x64 (cách làm như `tools/historian-it.ps1`):
  - `tests/device-it/compose.yaml`: mạng Docker riêng, subnet cố định (ví dụ `172.30.5.0/24`), và mạng thứ hai cho nguồn khác subnet. Container runtime chạy bản x64 trong image `mat-armhf`, dưới vòng giám sát `tests/device-it/supervise.sh` (chạy lại sau 2 s, như `Restart=always`, `RestartSec=2`); container client Node;
  - mật khẩu thử sinh ngẫu nhiên mỗi lần, tạo tài khoản bằng `--password-stdin`; không ghi ra file trong repo;
  - tham số `-Scenario <tên>[,<tên>]`, `-Keep`; kết quả ghi `docs/reports/005-<scenario>-x64.json`;
  - kịch bản đầu tiên: `auth` (sai 5 lần thì khóa 5 phút, kể cả khi mật khẩu đúng; chưa đăng nhập → 401 và có audit; endpoint kỹ thuật qua HTTP → 403 `HTTPS_REQUIRED`), `tls-idle` (8 kết nối TCP im lặng vào 8443: CPU runtime tăng ≤ 2 điểm, bị đóng sau ≤ 11 s), `secrets` (tìm chuỗi mật khẩu thử trong log, `audit.db`, `/run/mat-runtime`: không thấy);
  - story sau thêm kịch bản `discovery`, `deploy`, `packages`, `kill`, `health`, `busy`, `reload`.

  **Ghi chú khi làm:**
  - file: `tools/device-it.ps1`, `tests/device-it/{compose.yaml,supervise.sh,client.mjs,add-user.sh,search-secrets.sh}`:
    - compose `mat-dev-it`: mạng `lan` 172.30.5.0/24 (rt1 .10, rt2 .11, rt3 .12 `--no-discovery`, client .50) và `other` 172.30.6.0/24 (client .50);
    - runtime: bản x64 trong image `mat-armhf`, thư mục build gắn vào `/build` (`-BuildDir`), dưới `supervise.sh` (chạy lại sau 2 s, `/run/mat-runtime` 0700, log ở `/logs/runtime.log`);
    - client: `node:22.23.3-alpine`, dùng chung PID namespace với rt1 (đo CPU, RSS qua `/proc`), có `NET_ADMIN` (địa chỉ phụ), đọc bản sao `audit.db` của rt1 bằng `node:sqlite`;
  - tham số: `-Scenario` (nhiều tên, phân cách dấu phẩy), `-Keep`, `-BuildDir`, `-NoBuild`. Kết quả `docs/reports/005-<scenario>-x64.json`;
  - **mật khẩu thử:** 5 chuỗi ngẫu nhiên 24 ký tự mỗi lần chạy: 3 tài khoản, 1 mật khẩu sai, 1 chuỗi "gõ nhầm vào ô tên". Chỉ nằm trong biến môi trường của tiến trình PowerShell, truyền bằng `docker exec -e NAME` (không ghi giá trị). `add-user.sh` đưa vào `--password-stdin` qua pipe;
  - **lỗi thật gặp khi viết (nêu cho phiên chính):** pipe của PowerShell 5.1 vào `docker exec -i` thêm BOM UTF-8 vào đầu chuỗi:
    - `--user-add --password-stdin` nhận BOM như ký tự đầu của mật khẩu và báo thành công. Mật khẩu lưu khác mật khẩu người dùng nghĩ;
    - script đã tránh bằng cách không dùng pipe của PowerShell;
    - đề xuất cho `server/cli/users.cpp`: từ chối hoặc bỏ U+FEFF ở đầu dòng mật khẩu;
  - **`auth` đạt 37/37** (`005-auth-x64.json`):
    - identity 200 có ghim, `setupRequired` false, fingerprint = ghim. Ghim sai: `cert-mismatch` sau bắt tay, thiết bị không có dòng audit mới;
    - chưa đăng nhập: `diagnostics` 401 `AUTH_REQUIRED` kèm `WWW-Authenticate: Bearer`, audit `access.denied` (https);
    - qua HTTP: 403 `HTTPS_REQUIRED`, audit `access.denied` (http). `system/info` qua HTTP vẫn 200, `device.https = ok`;
    - đăng nhập administrator, engineer, viewer: 200, đúng role, `idleTimeoutS` 1800, `maxLifetimeS` 43200; audit `auth.login ok` kèm `IP:port`;
    - quyền:
      - viewer → `project/versions`: 403 `FORBIDDEN`, audit kèm tài khoản;
      - engineer → `audit`: 403;
      - engineer → `project/versions` và administrator → `audit`: qua cổng kiểm (501, chưa cài);
    - `session` 200, `logout` 204, sau đó `session` 401; audit `auth.logout`;
    - khóa tạm:
      - 5 lần sai từ địa chỉ phụ 172.30.5.51 → 401 `AUTH_FAILED`;
      - lần 6, mật khẩu đúng → 429 `AUTH_LOCKED`, `retryAfterS` 300, header `Retry-After` 300;
      - từ .50, cùng tên, mật khẩu đúng → 429 (khóa theo tên);
      - tài khoản khác từ .50 vẫn vào được;
      - audit có `auth.login failed`, `auth.lockout`, `auth.locked`;
    - số đo: đăng nhập Argon2id thật trung vị 66 ms (58–81), chỉ phần request; bắt tay TLS 1.3 16 ms;
    - không chờ hết 5 phút để thấy mở khóa: unit test của T035 kiểm bằng đồng hồ giả;
  - **`tls-idle` đạt 7/7** (`005-tls-idle-x64.json`). Khi rảnh: 0 % CPU, RSS 8,1 MiB.

    | 8 kết nối | CPU | Bị đóng sau | Client thứ 9 (gửi lúc 2 s) |
    |---|---|---|---|
    | TCP im lặng | +0,1 điểm | 10,0 s (cả 8) | chờ 8,0 s, rồi 200 |
    | TLS, 1 request keep-alive rồi im | +0,2 điểm | 14,6–15,0 s | chờ 12,6 s, rồi 200 |

    Rủi ro mở của T044 (keep-alive 60 s) đã xử lý: hạ xuống 15 s, quyết định ghi ở ADR-010;
  - **`secrets` đạt** (`005-secrets-x64.json`):
    - lưu lượng: đăng nhập đúng (admin, xem1), `session`, `logout`, đăng nhập sai, mật khẩu gõ vào ô tên;
    - tìm 5 chuỗi trong `/logs`, `/data` (`audit.db*`, `history.db`, `projects/`, `tls/`, `device-id`), `/run/mat-runtime`, `/etc/mat-runtime` (10 file) và `docker logs` của rt1, client: 0 lần thấy;
    - đối chứng: chuỗi mồi đặt trong `/tmp` được tìm thấy;
  - các lần chạy đầu đỏ vì lỗi của chính khung: BOM ở trên, `agent: false` của T052, chưa chờ runtime nạp `users.json`. Đã sửa từng lỗi. Không có lỗi nào của runtime;
  - lint: Prettier, ESLint sạch cho `.mjs` (glob `tests/device-it/*.mjs` đã có sẵn trong `npm run lint`). `.ps1` parse sạch bằng Parser của PowerShell; chuỗi in ra không dấu.
- [X] T052 [P] `tools/measure/device-api.mjs` (Node, không thêm phụ thuộc):
  - kết nối HTTPS có ghim fingerprint: so `cert.fingerprint256` trong `checkServerIdentity`, vẫn bắt tay đầy đủ; sai thì dừng;
  - lệnh `login` (đo thời gian), `session`, `logout`; kết quả JSON;
  - US2 thêm `deploy`, `fetch`, `restore`; US4 thêm `diag`, `audit`.

  **Ghi chú khi làm:**
  - module ES dùng lại được: `normalizeFingerprint`, `pinnedConnect`, `pinnedRequest`, `login`, `session`, `logout`, `PinError`. `tests/device-it/client.mjs` gọi HTTPS qua module này;
  - **lệch (`checkServerIdentity`):** Node không gọi `checkServerIdentity` khi chuỗi chứng chỉ không kiểm được:
    - chứng chỉ tự ký báo `DEPTH_ZERO_SELF_SIGNED_CERT` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, kể cả khi đưa chính chứng chỉ vào `ca`. Đã thử trên Node 24 và 22;
    - vì vậy phép so nằm ở sự kiện `secureConnect` của socket `tls.connect` tự mở: bắt tay đầy đủ, so `fingerprint256`, rồi mới trao socket cho `https.request` (`createConnection`);
    - `checkServerIdentity` vẫn so cùng giá trị, phòng khi chuỗi kiểm được;
  - **lỗi bắt được khi chạy `device-it`:** với `agent: false`, Node tự tạo agent, bỏ qua `createConnection` và mở một kết nối TLS khác, không ghim. Lần đó request hỏng chỉ nhờ `rejectUnauthorized` mặc định (`DEPTH_ZERO_SELF_SIGNED_CERT`). Đã sửa: bỏ `agent`, và kiểm `res.socket` là socket đã ghim; khác thì từ chối phản hồi;
  - dòng lệnh:
    - lệnh `login`, `session`, `logout` (mặc định chạy cả ba);
    - mật khẩu lấy từ `--password-stdin`, `MAT_DEVICE_PASSWORD`, hoặc hỏi trên terminal (không hiện ký tự). `--password…` trên dòng lệnh → mã 2;
    - JSON không có token, chỉ `tokenLength`;
    - mã thoát: 0 đạt, 1 mã HTTP khác mong đợi, 2 tham số sai, 3 sai ghim hoặc không kết nối được;
  - chạy từ Windows vào runtime x64 (quickstart §2, cổng 18443): đăng nhập 200 (65 ms; bắt tay TLS 1.3 41 ms), `session` 200, `logout` 204. Ghim sai một ký tự → mã 3, `cert-mismatch` kèm cả hai fingerprint.
- [X] T053 Mở rộng `deployment/toolchain/smoke-armhf.sh` (qemu-user):
  - runtime armhf sinh `tls/server.pem` (`0600`) ở lần chạy đầu và mở 8443;
  - fingerprint của `--cert-fingerprint` trùng kết quả `openssl s_client`;
  - tạo tài khoản thử (`--password-stdin`, mật khẩu ngẫu nhiên); `curl -k` đăng nhập được token; `audit.db` có `auth.login ok`.

  **Ghi chú khi làm:**
  - smoke tạo tài khoản `smoke` (engineer) trước lần chạy đầu:
    - mật khẩu 48 hex từ `/dev/urandom`, qua `--password-stdin`; không nằm trên dòng lệnh hay file nào;
    - `rt.json` thêm `httpsPort` 18443, `usersFile`, `projectStoreDir`;
    - chờ dòng `https ok on :18443` (≤ 30 s) thay cho `sleep 10` cố định;
  - kiểm:
    - `tls/server.pem` có, mode `600`;
    - dòng `--cert-fingerprint` trùng từng byte kết quả `openssl s_client | openssl x509 -fingerprint -sha256`;
    - `curl -k` POST `auth/login` (thân qua stdin) trả `token` ≥ 20 ký tự và `role` engineer;
    - sau SIGTERM, `audit.db` có dòng `auth.login ok` (WAL đã checkpoint lúc đóng);
    - mật khẩu thử không có trong `data/`, `etc/`, log;
  - image không có `sqlite3`, nên dòng audit được tìm bằng chuỗi `httpsauth.loginok`. Trong bản ghi SQLite, các cột `channel`, `action`, `target` (NULL: 0 byte), `result` nằm liền nhau. Cách này kiểm phần ghi của bản 32 bit, không kiểm truy vấn;
  - **xanh** dưới qemu với `C:\build\mat-armhf-e2`: `armhf https: cert 0600, SHA256 Fingerprint=…, sign-in token, audit auth.login ok`, rồi `armhf smoke: OK`;
  - **đỏ**, ba biến thể sửa ở scratchpad:
    - sai mật khẩu → "sign-in gave no token: AUTH_FAILED";
    - tìm `auth.logoutok` → "audit.db has no auth.login ok row";
    - đòi mode 640 → "tls/server.pem has mode …".
- [X] T054 Chạy kiểm Phase 2: `test-x64.ps1`, `smoke-armhf.sh`, `tools/device-it.ps1 -Scenario auth,tls-idle,secrets`, quickstart §2 (trừ phần nạp xuống). Tạo `docs/reports/005-acceptance.md` và ghi kết quả.

  **Ghi chú khi làm (2026-10-12, e2), chưa xong:**
  - đã chạy:
    - `tools/device-it.ps1 -Scenario auth,tls-idle,secrets,discovery`: 4/4 đạt (T051, T061);
    - `smoke-armhf.sh` (bản T053: chứng chỉ, fingerprint, đăng nhập, audit): OK;
    - quickstart §2 trừ nạp xuống: đạt, kể cả `device-api.mjs` từ Windows;
    - `HttpsApi.*` 23/23, `cargo test --lib` 88/88;
  - báo cáo: `docs/reports/005-acceptance.md`;
  - **chặn:** trong lúc chạy `test-x64.ps1` cả bộ, ổ C: hết chỗ (26 MB), và Docker Desktop ngừng (API trả 500). Đã xóa `C:\build\mat-studio\debug\incremental` (cache, tự sinh lại), C: còn khoảng 750 MB. `docker desktop restart`/`start` vẫn không lên. File ảo của Docker (`%LOCALAPPDATA%\Docker\wsl`) chiếm 75 GB; không dọn image hay cache build vì có image của dự án khác;
  - **còn phải chạy khi Docker lên lại:**
    - `test-x64.ps1 -BuildDir C:\build\mat-x64-e2` cả bộ;
    - `smoke-armhf.sh` bản mở rộng (thêm 401/403, khóa tạm, dòng `auth.lockout` trên armhf; **chưa chạy lần nào**), rồi đánh dấu task này.
- [ ] T055 ⚠️🔌 ⏸ Q4 ⏸ Q3 **(cần người dùng cho phép)** Đo `--auth-bench` trên BL335 sớm để chốt tham số Argon2id (R7):
  - chép binary armhf vào thư mục tạm (`mktemp -d`); chạy `--auth-bench` với m = 19456, t = 2, rồi t = 1; xóa thư mục. Không cài, không đổi dịch vụ;
  - ghi `docs/reports/device-changes.md` (kèm lệnh hoàn tác) và số đo vào ADR-011;
  - > 0,8 s thì hạ t = 1 (giữ 19 MiB), ghi vào ADR-011 là lệch khuyến nghị OWASP, sửa T032.

**Checkpoint — Mốc bảo mật (Constitution V)**:

- Trên x64 và qemu armhf: HTTPS có chứng chỉ tự sinh, đăng nhập theo role, khóa tạm, audit chạy; test xanh.
- Trang xem HTTP 8080 không đổi hành vi (FR-033).
- Chỉ sau mốc này mới viết route và lệnh nạp xuống, đọc lên, khôi phục (US2, US3).

---

## Phase 3: User Story 1 — Tìm thiết bị và kết nối có đăng nhập (Priority: P1) 🎯 MVP (cùng US2)

**Goal**: kỹ sư tìm BL335 trong LAN trong ≤ 3 s, hoặc thêm theo địa chỉ; ghim fingerprint ở lần đầu; đăng nhập theo role. Studio vào Online qua HTTPS: viền cam, thanh trạng thái có thiết bị, tài khoản và role.

**Independent Test**: spec US1. Cài runtime mới lên thiết bị thử (x64), đặt mật khẩu quản trị, tạo tài khoản kỹ sư; từ Studio tìm thấy thiết bị, ghim, đăng nhập; thử sai mật khẩu 5 lần, thiếu quyền, chứng chỉ bị đổi (quickstart §3 `discovery`, `auth`; §5 bước 1–6, 16). Phần "xem chẩn đoán" của US1 dùng tab Chẩn đoán của 004 (`system/info`); chẩn đoán đầy đủ ở US4.

**Phụ thuộc trong story**:

- thiết bị T056–T058 chỉ cần Phase 1 và T014: làm song song với Phase 2 được. T059–T061 cần T039, T044;
- Rust T062–T071 cần T009, T010, T014; test dùng máy chủ giả nên không chờ Phase 2;
- TS: file mới làm sau T072; phần nối vào file của 004 **sau 004 Phase 4–6**.

### Thiết bị: tìm thiết bị

- [X] T056 [P] [US1] Test `core/discovery/tests/discovery_proto_test.cpp`: hàm thuần, chạy mọi vector của `tests/discovery-vectors/` (contract discovery §2–4):
  - gói hỏi: đúng 1024 byte, magic `MATD`, version 1, type 1, cờ 0, đệm toàn 0;
  - nguồn: cùng subnet với card nhận, `(src & mask) == (ifaddr & mask)` với một trong các địa chỉ IPv4 của card; không phải `0.0.0.0`, `255.255.255.255`, broadcast của subnet, multicast hay loopback; cổng nguồn ≥ 1024;
  - tần suất (đồng hồ giả): mỗi nguồn token bucket 1 trả lời/s, dồn tối đa 3; tổng 20 trả lời/s; bảng nguồn 64 mục LRU; vượt thì im lặng;
  - gói trả lời: 24 byte đầu (type 2, nonce lặp lại); JSON đủ khóa của contract §3 (`name`, `model` ≤ 32 byte; `project.name` ≤ 64 ký tự; `fp` 64 hex chữ thường hoặc `null`; `https` = 0 khi HTTPS tắt hoặc chứng chỉ lỗi; `status` ∈ `running | no-project | project-error | activating`);
  - tổng ≤ 1024 byte và **không dài hơn gói hỏi**; thiếu chỗ thì bỏ `project.name`, rồi cắt `name` đúng ranh giới UTF-8, bật cờ `truncated`;
  - không có khóa hay giá trị bí mật: mật khẩu, khóa, token, tên tài khoản, nội dung project, đường dẫn trên thiết bị (Constitution V);
  - bộ đếm số gói đã trả lời và số gói bỏ theo lý do (`subnet`, `format`, `rate`, `port`).
- [X] T057 [P] [US1] Test `core/discovery/tests/iface_table_test.cpp`: dựng bảng card từ kết quả `ioctl` giả (`SIOCGIFCONF`, `SIOCGIFNETMASK`, `SIOCGIFHWADDR`): địa chỉ, netmask, broadcast, MAC, prefix theo card; nhiều địa chỉ trên một card; cache 30 s (đồng hồ giả).
- [X] T058 [US1] Cài `core/discovery/discovery_proto.{hpp,cpp}` và `core/discovery/iface_table.{hpp,cpp}`, đạt T056, T057. Lấy card bằng `ioctl`, không dùng netlink, để unit giữ `RestrictAddressFamilies` (R2).

  **Ghi chú khi làm (T056–T058):**
  - **đỏ:** header đủ, bản cài tạm trả sai (bỏ mọi gói, bảng card rỗng, `buildReply` trả 0). Cả 61 test tìm thiết bị (T056, T057, T059): 58 hỏng / 3 đạt, mọi lỗi ở mức assertion. Ba test đạt chỉ kiểm nhánh từ chối: đếm file vector, gói khác 1024 byte, `SIOCGIFCONF` lỗi;
  - **xanh:** `discovery_proto_test` 39/39, `iface_table_test` 11/11;
  - **vector:** chạy đủ 45 vector:
    - `query` 18, `rate` 3;
    - `build` 5: so JSON, và so từng byte với `packet` của vector (khóa ghi theo thứ tự contract §3);
    - `reply` 19: gửi tới thiết bị như datagram, phải bị bỏ `format`, để hai thiết bị không trả lời nhau;
    - một test đếm số vector theo loại;
  - **API:**
    - `parseQuery`;
    - `replyAddress`: địa chỉ của card nhận mà subnet chứa nguồn; nhiều địa chỉ khớp thì lấy prefix dài nhất;
    - `RateLimiter`;
    - `Responder`: kiểm format → subnet → port → rate, đếm theo lý do; chỉ gói qua các kiểm khác mới lấy token;
    - `buildReply`: ghi vào bộ đệm của bên gọi;
    - `DeviceInfo`: không có trường nào cho bí mật;
  - **JSON tự viết** vào bộ đệm cố định, không qua nlohmann, để không cấp phát theo gói. Cách thoát chuỗi giống hệt `nlohmann::json::dump()`: test so từng byte với `ordered_json`, gồm cả fuzz 3000 bộ dữ liệu ngẫu nhiên;
  - **lệch nhỏ, UTF-8 hỏng:** thành U+FFFD theo "maximal subpart" như `error_handler_t::replace` của nlohmann (`\xe1\x80` thành một U+FFFD), khác `sanitizeUtf8` của `core/common` (mỗi byte một U+FFFD), để so được với nlohmann. Dữ liệu thật không có UTF-8 hỏng: config đã kiểm, `project.json` đi qua parser nlohmann;
  - **bước (3) của §5a:** bỏ hẳn khóa `project` (không ghi `null`, để không lẫn với "không có project"), rồi cắt lại `name` theo chỗ trống mới, thường đủ cả tên. Vẫn không vừa thì không trả lời (`buildReply` trả 0);
  - **thêm ngoài task:**
    - `name`, `model` dài hơn 32 byte bị cắt theo ký tự và bật `truncated`. Config đã chặn; đây là phòng thủ;
    - `https` mang cổng và `fp` mang fingerprint chỉ khi cả hai hợp lệ (cổng 1–65535, 64 hex chữ thường). Ngược lại `https: 0`, `fp: null`. Luật này gộp "0 khi HTTPS tắt hoặc chứng chỉ lỗi" và "`fp` null khi HTTPS tắt" của contract;
    - nguồn trùng broadcast của **bất kỳ** subnet nào trên card nhận thì bị bỏ (thận trọng khi hai subnet chồng nhau). `/31`, `/32` không có broadcast (RFC 3021);
    - `mac` chữ hoa `AA:BB:…` như ví dụ của contract; chỉ card Ethernet (`ARPHRD_ETHER`) có MAC khác toàn 0, còn lại `null`;
  - **tần suất:** token tính bằng phần nghìn, số nguyên. Nguồn mới bắt đầu với bucket đầy; đồng hồ lùi không sinh token; LRU theo lần thấy gần nhất, kể cả lần bị từ chối;
  - **bảng card:**
    - `SIOCGIFCONF` với bộ đệm 32 mục, nhân đôi tới 1024 khi đầy;
    - với mỗi địa chỉ: `SIOCGIFINDEX` (tên bỏ hậu tố alias), và `SIOCGIFNETMASK` gửi cả nhãn lẫn địa chỉ: kernel chọn đúng địa chỉ (kiểu 4.4BSD), nên mỗi địa chỉ phụ có netmask riêng;
    - `SIOCGIFHWADDR` mỗi card một lần; gộp theo ifindex;
    - `IfaceTable` đọc lại khi bảng đã ≥ 30 s; lần đọc lỗi cũng giữ 30 s;
    - ioctl giả trong test trả lời như kernel (`devinet.c`, `dev_ioctl.c`). Thêm một test đọc card thật của máy chạy test bằng chính các ioctl đó;
  - **không cấp phát theo gói:** test đếm `operator new` khi 8000 datagram (cả trả lời lẫn bỏ) đi qua `Responder` và `buildReply`: 0 lần;
  - `mat_discovery` (STATIC, không phụ thuộc thư viện nào) tự thêm vào `mat_device`.
- [X] T059 [US1] Test `server/tests/discovery_server_test.cpp`: gửi gói hỏi unicast từ một địa chỉ không phải loopback cùng subnet (contract discovery §5a: nguồn loopback bị bỏ) → trả lời đúng nonce, ≤ gói hỏi; gói sai → im lặng; `discoveryEnabled = false` → không mở socket (FR-004).
- [X] T060 [US1] Cài `server/discovery/discovery_server.{hpp,cpp}`, đạt T059:
  - socket UDP ở `discoveryPort`; `IP_PKTINFO` để biết card nhận và đặt địa chỉ nguồn của gói trả lời;
  - luồng riêng chờ bằng `poll`;
  - nối vào `server/main.cpp` sau hai context (bước 8 của device-config §7); bộ đếm đưa vào chẩn đoán (US4).

  **Ghi chú khi làm (T059–T060):**
  - **cách gửi gói hỏi trong test:**
    - unicast từ một địa chỉ không phải loopback của chính máy tới chính địa chỉ đó; trong container x64 là địa chỉ `eth0` (ví dụ `172.17.0.2/16`);
    - Linux báo qua `IP_PKTINFO` là gói nhận trên `eth0` (card sở hữu địa chỉ), không phải `lo`. Broadcast có hướng (`172.17.255.255`) cũng quay về trên `eth0`;
    - đã thử trước bằng chương trình tạm trên kernel WSL2 6.6 của Docker Desktop, cả khi chạy bằng `nobody` không có capability nào. Không cần thêm địa chỉ phụ (việc đó cần `NET_ADMIN`);
    - máy không có địa chỉ IPv4 nào ngoài loopback thì các ca đầu-cuối tự bỏ qua, kèm lời giải thích;
  - **11 test:**
    - gói unicast được trả lời: đúng nonce, ≤ 1024 byte, từ địa chỉ của card nhận và cổng discovery; `ip`, `prefix`, `mac` khớp `getifaddrs` của test;
    - broadcast có hướng được trả lời unicast;
    - 8 gói sai (1023, 1025, 1500 byte; sai magic, version, type, cờ, đệm): im lặng, `format` = 8;
    - nguồn loopback: im lặng, đếm `subnet`. Cổng nguồn 1023: im lặng, đếm `port`;
    - 5 gói từ một nguồn: 3 trả lời (đồng hồ giả);
    - `discoveryEnabled = false`: không mở socket (test bind được chính cổng đó);
    - cổng bị chiếm: lỗi có số cổng, không crash;
    - `stop()` dưới 500 ms và trả cổng;
    - hàm `DeviceInfo` được gọi tối đa 1 lần/s;
    - không cấp phát theo gói: đếm `operator new` của cả tiến trình trong 30 datagram, được 0;
  - **đỏ:** bản tạm bind cổng bất kể `enabled`, không trả lời, không đóng: 11/11 hỏng (nằm trong 58/61 ở T058). **Xanh:** 11/11;
  - **cài:**
    - một socket UDP `INADDR_ANY:discoveryPort`, `SOCK_NONBLOCK`, `IP_PKTINFO`. Không `SO_BROADCAST` (socket không gửi được tới địa chỉ broadcast), không `SO_REUSEADDR`;
    - một luồng `mat-discovery` chờ `poll` trên socket và một `eventfd`. `stop()` ghi `eventfd` rồi join. Mỗi lần thức đọc tối đa 64 datagram;
    - một bộ đệm 1024 byte cho cả gói hỏi lẫn gói trả lời. Gói dài hơn nhận ra qua `MSG_TRUNC`, đếm `format`;
    - trả lời bằng `sendmsg` kèm `IP_PKTINFO`: `ipi_ifindex` là card nhận, `ipi_spec_dst` là địa chỉ của card cùng subnet với nguồn. `replies` chỉ tăng khi gửi được;
    - `DeviceInfo` lấy qua hàm tiêm được, gọi trên luồng discovery, giữ 1 s. Bảng card đọc lại sau 30 s, bằng ioctl trên chính socket;
    - đọc bộ đếm cho US4: `counters()` (atomic, luồng nào đọc cũng được), `enabled()`, `running()`, `port()`;
  - **CMake:** `mat_discovery_server` (STATIC) riêng, để `mat-runtime` và test link cùng một mã, test không cần `main.cpp` hay CivetWeb; tự thêm vào `mat_device`. `mat-runtime` link thêm `mat_discovery_server mat_server_tls mat_crypto`;
  - **nối `main.cpp`:**
    - khối có chú thích `---- Device discovery …` / `---- end of device discovery`, ngay sau context HTTP; `discoveryServer.stop()` trước historian khi tắt;
    - **lệch tạm, thuộc T044:** khối tự gọi `loadOrCreateServerCert` và `loadOrCreateDeviceId`, vì chưa có chỗ nào gọi. Lần chạy đầu của bản này sinh `tls/server.pem` mà chưa có dòng audit `cert.generate`;
    - `https` = `httpsPort` khi đọc được chứng chỉ, dù context HTTPS chưa có (T044); `project.digest` = `null`; `api` viết tay `"1.0.0"` (T043 có `kDeviceApiVersion`);
    - `status`: project đang chạy → `running`; `active.info.status` = `missing` → `no-project`; còn lại `project-error`, khối `project` = `null` vì không đọc được project lỗi;
  - **kiểm tay:**
    - runtime x64 trong container: unicast được 423 byte từ `172.17.0.3:8446`, đủ khóa; 5 gói broadcast được 3 trả lời; loopback im lặng;
    - `--no-discovery`: im lặng, in `discovery: off`. SIGTERM: thoát mã 0 sau khoảng 0,7 s;
    - bản armhf dưới qemu-user cũng trả lời đúng. qemu in `Unsupported ancillary data: 0/8` cho mỗi cmsg `IP_PKTINFO`: hiện tượng của qemu (nó vẫn chép dữ liệu), thiết bị thật không có;
  - **số đo x64** (một lần): luồng `mat-discovery` rảnh 20 s tốn 0 tick CPU, 0 lần chuyển ngữ cảnh. RSS 7,4 MB khi bật, 6,9 MB khi tắt;
  - build armhf xanh, không cảnh báo; smoke qemu OK; clang-format sạch;
  - 3 test biên dịch chéo ở scratchpad (không commit), chạy dưới qemu armhf: 61/61. Test vector phải build với `-D_FILE_OFFSET_BITS=64`: trên qemu-user, `readdir` 32 bit không LFS gặp `d_off` 64 bit và không trả tên file nào. Đây chỉ là hàm phụ của test, runtime không dùng `readdir`;
  - **cả bộ x64:** `test-x64.ps1` không `-Target` dừng ở bước build vì `core/package/tests/package_check_test.cpp` (d1 đang viết). Chạy `ninja -k 0` rồi `ctest` toàn bộ: 951 test, 211 hỏng, đều ở phần agent khác đang ở pha đỏ (gói `.matscada`, `HttpsApi` T041, `StartupDigest`, `Fixture.Hello*`, `CivetTransport.CloseAllForRestart*`). 61/61 test tìm thiết bị đạt; không suite `core/auth` nào hỏng. Lần kiểm cuối `-Target "discovery_proto_test iface_table_test discovery_server_test mat-runtime"`: 61/61;
  - **sau đó c1 (T044) đã sắp lại khối trong `main.cpp`:** chứng chỉ và device-id lấy từ bước 6; `https`, `fp` chỉ khi listener HTTPS chạy; `kDeviceApiVersion`; `digest` từ `active.digest`; `device.setDiscovery(...)` cho `system/info`.
- [X] T061 [US1] `tools/device-it.ps1 -Scenario discovery` ([quickstart.md](quickstart.md) §3), ghi `docs/reports/005-discovery-x64.json`:
  - mạng Docker riêng, 2 runtime + 1 client Node gửi gói hỏi tới broadcast của subnet lúc 0, 600, 1200 ms: thấy cả hai trong ≤ 3 s;
  - client ở mạng thứ hai, hoặc có thêm địa chỉ phụ ngoài subnet (container client có `NET_ADMIN`): không được trả lời;
  - cổng nguồn 53: không được trả lời; gói trả lời ≤ gói hỏi;
  - `discoveryEnabled: false`: im lặng.

  **Ghi chú khi làm:**
  - kịch bản `discovery` của `tests/device-it/client.mjs`: rt1, rt2 (bật), rt3 (`--no-discovery`) trên `lan` 172.30.5.0/24; client .50. **Đạt 15/15** (`docs/reports/005-discovery-x64.json`):
    - quét broadcast lúc 0, 600, 1200 ms, nhận 2,5 s: rt1, rt2 trả lời sau 3–50 ms (qua các lần chạy), mỗi máy 3 gói. rt3 im lặng; `system/info` của rt3 có `device.discovery = false`, tức runtime vẫn chạy;
    - gói trả lời 484 byte ≤ 1024; magic, type, nonce đúng; `ip` = địa chỉ nguồn, `prefix` 24, `https` 8443, `fp` 64 hex; hai `id` khác nhau; không có tài khoản, mật khẩu, token, đường dẫn;
    - đối chứng: unicast từ .50 được rt1, rt2 trả lời;
    - nguồn ngoài subnet `10.99.0.50` (địa chỉ phụ trên card lan của client, `NET_ADMIN`): không được trả lời. Có đối chứng đường về:
      - script thêm route `10.99.0.0/24 dev eth0` cho rt1, rt2 bằng container phụ dùng chung netns (`--network container:…`), nên runtime không cần capability;
      - một echo UDP trong netns của rt1 trả lời được 10.99.0.50;
      - thiếu đối chứng này thì im lặng không chứng minh gì: trả lời sẽ đi theo default route và mất;
    - cổng nguồn 53: không được trả lời; 5 gói hỏi trong 1 s từ một nguồn → 3 trả lời;
  - **lệch:** mạng thứ hai (`other` 172.30.6.0/24) **không** dùng làm nguồn khác subnet được:
    - gói từ 172.30.6.50 sang `lan` bị Docker masquerade thành 172.30.5.1 (gateway, cùng subnet), nên thiết bị trả lời. Đã kiểm bằng một echo UDP riêng: nó thấy nguồn 172.30.5.1;
    - ghi thành số đo `secondNetworkViaNat` (6 trả lời), không tính đạt/hỏng;
    - ý nghĩa thực tế: router NAT vào LAN làm client ở xa trông như cùng subnet. Kiểm subnet không chặn trường hợp này, và đúng contract: thiết bị xét địa chỉ nguồn nó thấy;
  - lần chạy đầu, kiểm 172.30.6.50 báo 6 trả lời (đỏ). Điều tra thì ra do NAT như trên, không phải lỗi runtime.

### Studio Rust (file mới; đăng ký lệnh ở T072)

- [X] T062 [P] [US1] Test Rust trong `apps/studio/src-tauri/src/discovery.rs` (contract discovery §3, §5; tauri-commands §2):
  - dựng gói hỏi đúng 1024 byte có nonce;
  - đọc mọi vector trả lời của `tests/discovery-vectors/`: bỏ gói < 24 byte, > 1024 byte, sai magic/version/type, nonce khác, JSON hỏng hoặc thiếu `v`, `id`, `name`, `runtime`, `status`, `https`; bỏ qua khóa lạ;
  - IP lấy theo địa chỉ nguồn UDP, không theo trường `ip`; gộp theo (`id`, IP); `DiscoveredDevice` có `receivedAt`;
  - phân loại card (`NetInterface`): `canBroadcast = false` khi prefix ≥ 31 hoặc không có broadcast; `hint = "vpn"` theo tên (WireGuard, TAP, OpenVPN, Tailscale, ZeroTier…);
  - lịch gửi 0, 600, 1200 ms, kết thúc ở 2500 ms (đồng hồ và socket giả); lượt quét thứ hai khi đang chạy → `busy`; `DiscoverSummary` liệt kê card lỗi (`bind`, `send`).
- [X] T063 [US1] Cài `apps/studio/src-tauri/src/discovery.rs`, đạt T062: `if-addrs`; mỗi card một socket bind vào địa chỉ của card, cổng ngẫu nhiên, `SO_BROADCAST`; sự kiện `found` đẩy qua `tauri::ipc::Channel`; giữ fingerprint của gói tìm gần nhất trong bộ nhớ (cho `device_probe.discovered`), không ghi đĩa.

  **Ghi chú khi làm (T062–T072, chung cho phần Rust của US1):**
  - **đỏ:** viết hết test trước, thân hàm `todo!()`: 27 qua / 51 hỏng. 4 test qua ngay vì chỉ kiểm hằng số hoặc hình dạng JSON;
  - **xanh:** `cargo test --lib` 81/81 (23 test cũ của 004 + 58 mới). Chạy lặp 5 lần và 1 lần `--test-threads=1` đều 81/81;
  - kiểm khác: `cargo clippy --all-targets -- -D warnings` sạch (kể cả cảnh báo cũ ở `project_fs.rs`); `cargo fmt --check` sạch; build release xanh. Không đổi `Cargo.toml`/`Cargo.lock`;
  - **T062/T063:**
    - mạng của lượt quét tách thành trait `ScanNet` (bản thật `UdpNet`, bản giả có đồng hồ giả);
    - chạy đủ 19 vector `reply-*`, thêm một test socket thật trên 127.0.0.1;
    - **lệch:** không có card dùng được thì trả kết quả ngay;
    - nonce lấy từ `getrandom`;
    - giữ tối đa 256 fingerprint gần nhất.

- [X] T064 [P] [US1] Test Rust `apps/studio/src-tauri/src/device/registry.rs` (data-model §2, tauri-commands §3), thư mục tạm:
  - `KnownDevice`: `id` (UUID), `name` ≤ 64, `host` (IPv4 hoặc tên máy theo luật `normalizeDevice` của 004), `httpsPort` 1–65535 mặc định 8443, `httpPort` 1–65535 mặc định 8080, `deviceId` và `mac` (có thể trống), `pin` = `{ fingerprint (64 hex chữ thường), pinnedAt }` hoặc `null`, `lastUser`, `lastSeenAt`, `lastRuntime`;
  - JSON không có khóa nào cho mật khẩu hay token;
  - tối đa 64 → `too-many`; trùng `host:httpsPort` → trả mục cũ; địa chỉ sai → `bad-address`; đổi `host` giữ ghim; `device_forget`; `no-such-device`;
  - file hỏng → `[]`, ghi đè ở lần lưu sau; ghi atomic (file tạm, `rename`).
- [X] T065 [US1] Cài `apps/studio/src-tauri/src/device/registry.rs` (`devices.json` trong `app_config_dir`, như `recent.json` của 004), đạt T064.

  **Ghi chú khi làm:**
  - ghi atomic bằng `write_atomic` của 004, tối đa 64 mục; khóa lạ trong file (kể cả `token`) bị bỏ ở lần ghi sau;
  - mục sai bị bỏ; ghim sai dạng thành `null`;
  - địa chỉ theo luật `normalizeDevice` cộng kiểm khứ hồi qua bộ phân tích URL: từ chối `192.168.001.010`, `1.2.3`, `0x7f.1`;
  - đổi `host`/`httpsPort` thì bỏ phiên và kết quả dò cũ; ghim giữ nguyên;
  - chi tiết ở contract tauri-commands §12.
- [X] T066 [P] [US1] Test Rust `apps/studio/src-tauri/src/device/tls.rs` (R6), máy chủ rustls thử với chứng chỉ sinh bằng `rcgen` lúc chạy test:
  - ghim khớp → bắt tay đạt; chứng chỉ khác → lỗi `cert-mismatch` kèm fingerprint thấy được;
  - cùng chứng chỉ nhưng khóa ký khác (chữ ký bắt tay sai) → thất bại: verifier vẫn gọi `verify_tls12_signature`, `verify_tls13_signature`;
  - không xét tên máy, hạn, chuỗi CA: chứng chỉ sai SAN hoặc hết hạn vẫn đạt khi khớp ghim;
  - chế độ dò: ghi lại fingerprint, không gửi byte ứng dụng nào (máy chủ thử không nhận dữ liệu), đóng ngay; cổng HTTP thường → `not-tls`; timeout kết nối 3 s, bắt tay 5 s.
- [X] T067 [US1] Cài `apps/studio/src-tauri/src/device/tls.rs` (`PinnedVerifier` qua API `dangerous()` của rustls, provider `ring`), đạt T066.

  **Ghi chú khi làm:**
  - test "cùng chứng chỉ, khóa ký khác → thất bại" có cho cả TLS 1.2 lẫn 1.3, ở chế độ ghim và chế độ dò;
  - tắt nối lại phiên TLS: mọi kết nối đều kiểm ghim và chữ ký;
  - `not-tls` nhận ra qua lỗi `InvalidMessage` của rustls;
  - phân giải tên máy thì thử IPv4 trước: Windows mất khoảng 2 s cho mỗi địa chỉ bị từ chối;
  - provider `ring`, `cipher_suites` theo thứ tự:
    - TLS13_CHACHA20_POLY1305_SHA256;
    - TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256;
    - hai bộ AES-GCM của 1.3;
    - hai bộ AES-GCM của 1.2.
  - `kx_groups` mặc định; reqwest và tokio-rustls dùng chung provider. Test bắt tay xác nhận thương lượng ra ChaCha20 ở cả 1.3 và 1.2 (ADR-010).
- [X] T068 [P] [US1] ⏸ Q3 Test Rust `apps/studio/src-tauri/src/device/http.rs` và `apps/studio/src-tauri/src/device/session.rs` (tauri-commands §4–6). Máy chủ HTTPS thử viết tay trên `tokio-rustls`, không thêm crate máy chủ:
  - `device_pin` chỉ nhận đúng fingerprint của lần `device_probe` gần nhất (`not-observed`); `device_unpin` cần fingerprint bằng ghim hiện tại (`pin-mismatch`); `device_probe.discovered` lấy từ gói tìm gần nhất;
  - `device_login`: ánh xạ lỗi đúng bảng §5 (`auth-failed`, `{ locked: retryAfterS }`, `auth-busy`, `audit-unavailable`, `setup-required`, `cert-unpinned`, `{ cert-mismatch: { pinned, seen } }`, `unreachable`, `timeout`);
  - token chỉ nằm trong bộ nhớ Rust, gửi trong header `Authorization` (mặc định của Q3): `SessionInfo` không có trường token; kiểu giữ token không `Serialize`. Bộ đệm mật khẩu bị xóa (`zeroize`) sau khi gửi;
  - `device_get`: chỉ các đường dẫn của §6 (khác → `bad-path`); `query` được mã hóa; 401 `SESSION_*` → bỏ token của thiết bị; ánh xạ `auth-required`, `session-expired`, `session-invalid`, `forbidden`, `{ http: status }`;
  - `monitor_get`: HTTP thường, chỉ `GET /api/v1/system/info`, timeout 3 s, mã lỗi của `checkDevice` (`timeout`, `network`, `http`, `bad-response`);
  - một client mỗi thiết bị, `http1_only`, timeout kết nối 3 s, request 10 s; giữ kết nối rảnh tối đa 30 s (`pool_idle_timeout`, ngắn hơn keep-alive 60 s của thiết bị; R6, analyze C7). **Sửa 2026-10-12:** 10 s, vì thiết bị hạ keep-alive xuống 15 s (ADR-010). Test `timeouts_follow_the_research` đỏ với 30 s, xanh với 10 s; test bảo đảm `reqwest` dựng được với `tls_backend_preconfigured` (API này không cam kết SemVer);
  - provider TLS xếp ChaCha20-Poly1305 lên đầu cho cả TLS 1.3 và 1.2 (ADR-010, chốt 2026-10-11): BL335 chọn bộ mã TLS 1.3 theo thứ tự của client và không có lệnh AES.
- [X] T069 [US1] Cài `apps/studio/src-tauri/src/device/{http,session,mod}.rs`, đạt T068.

  **Ghi chú khi làm:**
  - lần chạy đầu 20/23. 3 lỗi thật: hyper-rustls bọc lỗi rustls thêm một lớp `io::Error`, nên ghim sai bị báo `unreachable`. Sửa: dò lỗi xuống cả `get_ref()`;
  - 2 test sai hạn (Windows mất khoảng 2 s mới báo cổng đóng): sửa test, không sửa mã;
  - client: `pool_idle_timeout` 30 s, không proxy, không chuyển hướng;
  - token:
    - nằm trong `SessionToken`: bộ đệm tự xóa, không `Serialize` (kiểm lúc biên dịch), không `Clone`;
    - `Debug` che giá trị; header được đánh dấu nhạy cảm;
  - mật khẩu và thân JSON đăng nhập nằm trong bộ đệm `Zeroizing`;
  - test quét file trên đĩa không thấy mật khẩu và token thử (SC-005);
  - giới hạn: `zeroize` không với tới bản sao trong hyper/rustls, `HeaderValue` và WebView (đã ghi trong doc của `session.rs`);
  - hạn kết nối TCP 3 s chỉ kiểm hằng số, vì trên loopback không giả lập được SYN treo;
  - mã lỗi thêm ngoài bảng §5/§6 (`{http}`, `bad-response`, `{tls}`, `not-tls`, `bad-address`): ghi ở contract tauri-commands §12.
- [X] T070 [P] [US1] Test Rust `apps/studio/src-tauri/src/device/live.rs` (tauri-commands §7):
  - `{ id }` mở `wss://…/api/v1/live` có ghim; không gửi token, không gửi `Origin`. `{ address }` mở `ws://…` (chế độ theo dõi);
  - sự kiện `open`, `message`, `close` đúng thứ tự; bắt tay lỗi → `close` mã 1006, `reason` là mã lỗi (`cert-mismatch`, `unreachable`…);
  - `live_send` > 96 KiB → `too-large`; `live_close` mặc định mã 1000.
- [X] T071 [US1] Cài `apps/studio/src-tauri/src/device/live.rs` (`tokio-tungstenite` trên luồng `tokio-rustls` dùng `PinnedVerifier`), đạt T070.

  **Ghi chú khi làm:**
  - mỗi kết nối một tác vụ; không gửi token, `Origin` hay cookie; bản tin nhận tối đa 4 MiB;
  - `liveId` là số u32, tăng dần từ 1;
  - đóng kết nối:
    - máy chủ không trả frame đóng trong 3 s thì vẫn báo `close` với mã đã gửi;
    - máy chủ đóng TCP mà không gửi frame đóng → 1006;
  - `live_close` khi đang bắt tay: giao diện thấy `open` rồi mới `close` (khác trình duyệt).
- [X] T072 [US1] Đăng ký lệnh của US1 trong `invoke_handler` của `apps/studio/src-tauri/src/lib.rs` (**sau 004 Phase 4–6**): `net_interfaces`, `discover_run`, `devices_list`, `device_add`, `device_update`, `device_forget`, `device_probe`, `device_pin`, `device_unpin`, `device_login`, `device_logout`, `device_session`, `device_get`, `monitor_get`, `live_open`, `live_send`, `live_close`; state quản lý thiết bị; `cargo test --lib` xanh.

### Studio TS

- [X] T073 [P] [US1] Test `apps/studio/src/platform/mock-device.test.ts` (tauri-commands §9–10): `DeviceLink` giả có hai thiết bị trong LAN, một thiết bị chỉ thêm theo địa chỉ, một thiết bị runtime cũ; chứng chỉ chưa ghim, khớp, đổi; tài khoản `kysu1` (engineer), `xem1` (viewer), `admin` (administrator); khóa sau 5 lần sai; điều khiển qua `window.__matMock.device`.
- [X] T074 [US1] `apps/studio/src/platform/device-types.ts` (giao diện `DeviceLink` và các kiểu đúng contract tauri-commands §9; `DeviceError = { error, detail? }`), `apps/studio/src/platform/tauri-device.ts` (`invoke`, `Channel`, `ipcError` của 004), `apps/studio/src/platform/mock-device.ts`, đạt T073. Alias chế độ `e2e` trong `apps/studio/vite.config.ts`: `tauri-device.ts` → `mock-device.ts` (**sau 004 Phase 4–6**).
- [X] T075 [P] [US1] Test `apps/studio/src/model/device-adapters.test.ts`: `fetch` dựa trên `DeviceLink.get`/`monitorGet` cho `checkDevice` (giữ chữ ký `FetchFn`); `SocketLike` bọc `openLive`, `live_send`, `live_close` cho `LiveConnection` (thứ tự `open`, `message`, `close`; mã đóng); `@mat/live-client` không đổi giao diện.
- [X] T076 [US1] Cài `apps/studio/src/model/device-adapters.ts`, đạt T075.
- [X] T077 [P] [US1] Test `apps/studio/src/model/discovery.test.ts`:
  - kết quả đến dần; gộp theo (`deviceId`, IP); hai thiết bị trùng tên tách được nhờ MAC và IP; sắp theo tên rồi IP;
  - card VPN hiện mờ kèm gợi ý "Thêm theo địa chỉ"; không thấy thiết bị nào → gợi ý kiểm tường lửa Windows và Thêm theo địa chỉ;
  - fingerprint của gói tìm chỉ để tham khảo; khác kết quả `probe` → cờ cảnh báo đỏ; Tìm lại.
- [X] T078 [US1] Cài `apps/studio/src/model/discovery.ts`, đạt T077.
- [X] T079 [US1] Test `apps/studio/src/model/device-session.test.ts` (sửa, **sau 004 Phase 4–6**; data-model §6):
  - 24 test của 004 T016 (chế độ `monitor`) vẫn xanh, không sửa;
  - chế độ `online`: `idle → probing → pin-confirm → login → connecting → monitoring`; ghim khớp → `login`; không khớp → `error` `cert-mismatch` kèm F và G;
  - cổng HTTPS không trả lời mà HTTP là runtime < 0.4.0 → `connecting` chế độ `monitor`, mã `runtime-old` (FR-035);
  - `AUTH_FAILED`, `AUTH_LOCKED` → ở lại `login` kèm lý do và `retryAfterS`; `setup-required`;
  - đang `monitoring` gặp `SESSION_EXPIRED` → `relogin`, không đụng tài liệu đang sửa (FR-031); `SESSION_INVALID` (tài khoản tắt, đổi IP) → `idle` kèm lý do; `cert-mismatch` khi kết nối lại → `error`;
  - trường mới `mode` (`monitor | online`), `deviceId`, `auth` (`{ user, role, idleTimeoutS, maxLifetimeS }` hoặc `null`), `features` (nguyên mảng `features` của `device/identity`; analyze F2 đổi tên từ `capabilities`); mã lỗi mới `cert-unpinned`, `cert-mismatch`, `tls`, `auth-required`, `session-expired`, `session-invalid`, `forbidden`, `runtime-old`, `https-unreachable`.
- [X] T080 [US1] Cài `apps/studio/src/model/device-session.ts` và `normalizeHttps` (mặc định cổng 8443) trong `apps/studio/src/model/device.ts` (**sau 004 Phase 4–6**; `checkDevice` giữ chữ ký), đạt T079.
- [X] T081 [P] [US1] Test component `apps/studio/src/ui/dialogs/devices-dialog.test.ts`, `apps/studio/src/ui/dialogs/pin-dialog.test.ts`, `apps/studio/src/ui/dialogs/login-dialog.test.ts`:
  - **Thiết bị trong mạng:** chọn card; kết quả hiện dần với tên, địa chỉ, runtime, project (tên, phiên bản), trạng thái; chọn dòng hiện thêm model, MAC, cổng HTTPS, fingerprint; Thêm theo địa chỉ (IP hoặc tên, cổng HTTPS); danh sách đã lưu; Tìm lại; bàn phím và ARIA;
  - **Ghim:** fingerprint SHA-256 đủ 64 ký tự (chữ đơn cách, nhóm theo cặp), hướng dẫn so với `mat-runtime --cert-fingerprint`; chưa xác nhận thì không đi tiếp. Không khớp: hiện fingerprint cũ và mới, nói rõ nguy cơ; gỡ ghim chỉ khi xác nhận rõ (FR-008);
  - **Đăng nhập:** thông báo không cho biết sai tên hay sai mật khẩu; đang khóa thì hiện thời gian còn lại; ô mật khẩu xóa sau khi gửi, không lưu; `setup-required` hướng dẫn lệnh trên thiết bị.
- [X] T082 [US1] Cài `apps/studio/src/ui/dialogs/{devices-dialog,pin-dialog,login-dialog}.ts`, chuỗi giao diện ở file mới `apps/studio/src/i18n/vi-online.ts`, đạt T081.
- [X] T083 [US1] Nối US1 vào giao diện của 004 (**sau 004 Phase 4–6**):
  - `apps/studio/src/i18n/vi.ts` gộp `vi-online.ts`;
  - `apps/studio/src/app/commands.ts`: `online.devices` hết khóa "Có ở feature 005"; thêm `online.login`, `online.logout`. Thêm hai lệnh mới vào `specs/004-studio-shell/contracts/commands.md` (`commands.test.ts` của 004 đọc thẳng file này);
  - `apps/studio/src/app/app.ts`: mở hộp thoại, nối `DeviceSession` chế độ online;
  - `apps/studio/src/ui/mat-statusbar.ts`: thiết bị và `tài khoản · role`; viền cam như 004.
- [X] T084 [US1] Siết CSP trong `apps/studio/src-tauri/tauri.conf.json` (**sau 004 Phase 4–6**, sau T076 và T080, khi chế độ theo dõi của 004 đã đi qua `monitorGet`, `openLive({ address })`): `connect-src 'self' ipc: http://ipc.localhost` (bỏ `http: ws:`). Test `apps/studio/src/platform/csp.test.ts` đọc `tauri.conf.json` và kiểm `connect-src`.
- [X] T085 [US1] E2E `apps/studio/tests/e2e/online.e2e.mjs` (lớp giả `mock-device`):
  - Online › Thiết bị trong mạng hiện hai thiết bị trong ≤ 3 s; thêm theo địa chỉ;
  - Online lần đầu → ghim; không xác nhận thì không đi tiếp;
  - đăng nhập `kysu1` → viền cam, thanh trạng thái `kysu1 · engineer`; sai 5 lần → "tài khoản tạm khóa";
  - chứng chỉ đổi → chặn, hiện fingerprint cũ và mới;
  - phiên hết hạn → hộp thoại đăng nhập lại; Tag đang sửa vẫn còn, chưa lưu;
  - thiết bị runtime cũ → theo dõi chỉ đọc kèm "runtime cần cập nhật để nạp xuống";
  - axe 0 vi phạm critical/serious; 0 lỗi console.

  **Ghi chú khi làm (T073–T085, phần TS của US1):**
  - **Kết quả:**
    - `tsc --noEmit` sạch; Vitest 640/640 trên 46 file (trước: 534 trên 36 file); ESLint, Prettier sạch;
    - e2e 142/142 (110 kiểm cũ của 004 + 32 mới), 0 lỗi console;
    - ảnh chụp `online-1…8` trong `tests/e2e/out/`, khớp mockup đã duyệt;
    - hai thiết bị hiện sau 748 ms.
  - **Đỏ → xanh:** mỗi cặp test/cài có pha đỏ (module chưa có, hoặc 13 test mới của `device-session` hỏng), rồi xanh.
    - 25 test cũ của 004 trong `device-session.test.ts` (không phải 24 như task ghi) giữ nguyên, vẫn xanh.
    - **Lỗi quy trình:** `app/device-errors.test.ts` viết trước nhưng không chạy đỏ trước khi cài.
  - **Lệch kế hoạch, mỗi chỗ có lý do trong chú thích đầu file:**
    - `DeviceLink` chỉ có phần US1; thêm `session(id)` (contract §5 có, §9 không liệt kê);
    - `deviceError()` giữ dữ liệu kèm không phải chuỗi (`{ locked }`, `{ cert-mismatch }`);
    - `liveSocket` giữ lại `send` gửi trước khi có `liveId`, chỉ báo `close` một lần;
    - `runtime-old` nằm ở getter `notice`, không ở `error`; thêm `errorInfo` giữ lỗi gốc của Rust;
    - ở `relogin`, dữ liệu sống vẫn chạy và viền cam vẫn giữ;
    - Online hỏi `/api/v1/auth/session` mỗi 5 s để phát hiện phiên hết hạn; hạn kết nối online 10 s;
    - Offline (Ctrl+M) giữ phiên phía Rust: Online lại không phải đăng nhập; Đăng xuất mới xóa phiên;
    - so với mockup: "Nhớ tên tài khoản" thành câu ghi chú cố định (Rust tự lưu `lastUser`); thêm nút "Bỏ khỏi danh sách đã lưu"; "Đọc lên thành project mới" hiện nhưng khóa (US3);
    - `app/device-errors.ts` có câu tiếng Việt cho từng mã lỗi của Rust (contract tauri-commands §12); mã lạ hiện câu chung kèm mã;
    - CSP chỉ còn `connect-src 'self' ipc: http://ipc.localhost`.
  - **Còn mở, đã giao sang T085a:**
    - Ctrl+K và nút Online của 004 vẫn theo dõi theo địa chỉ;
    - địa chỉ `https://…` ở trang Thiết bị;
    - tên thiết bị thêm theo địa chỉ;
    - README của Studio còn ghi CSP cũ.
- [X] T085a [US1] Hoàn thiện Online theo FR-031 (thêm 2026-10-11 khi duyệt T073–T085):
  - Ctrl+K và nút Online:
    - project đã gắn một thiết bị đã lưu: chạy luồng Online có đăng nhập (dò → kiểm ghim → đăng nhập nếu chưa có phiên → live qua `wss`);
    - chưa gắn thiết bị nào: mở hộp thoại Thiết bị trong mạng;
    - HTTPS không trả lời mà HTTP là runtime < 0.4.0: rơi về theo dõi chỉ đọc, kèm thông báo `runtime-old` (FR-035).
  - Gắn thiết bị với project: lưu `deviceId` hoặc `id` của thiết bị đã lưu vào thiết lập cục bộ theo project. Không ghi vào file project.
  - Trang Thiết bị của 004: nhập `https://…` thì báo ngay tại ô, kèm gợi ý dùng Online. Không tự bỏ scheme rồi gọi HTTP.
  - Rust: thiết bị thêm theo địa chỉ có tên mặc định là `host`. Lần dò hoặc đăng nhập thành công đầu tiên đổi tên này thành `name` của `device/identity`. Tên người dùng đã sửa thì giữ nguyên.
  - Sửa `apps/studio/README.md` theo CSP mới.
  - Cập nhật e2e của 004 cho luồng mới: runtime giả 0.3.0 rơi về theo dõi chỉ đọc. Toàn bộ e2e và Vitest phải xanh.

  **Ghi chú khi làm:**
  - **Kết quả:** `cargo test --lib` 85/85 (+4), clippy `-D warnings`, `fmt --check` sạch; `tsc` sạch; Vitest 668/668 trên 48 file (+28); ESLint, Prettier sạch; e2e 152/152 (142 cũ + 10 mới), 0 lỗi console.
  - **Đỏ → xanh:** Rust thân hàm `todo!()`: 81 qua / 4 hỏng. TS: 13 hỏng + 2 file không nạp được (`app/device-binding.ts` chưa có). Một test của trang Thiết bị xanh từ đầu vì giữ hành vi cũ ("Kết nối theo dõi" theo địa chỉ).
  - **Cách làm:**
    - gắn thiết bị: `app/device-binding.ts`, localStorage `mat-studio.projectDevices` = `[thư mục project chuẩn hóa, id]`, mới nhất trước, tối đa 64, `id` phải là UUID;
    - gắn khi Online một dòng hoặc Thêm theo địa chỉ trong Thiết bị trong mạng; chỉ chọn dòng thì chưa gắn. Bỏ khỏi danh sách đã lưu thì gỡ gắn; thiết bị đã gắn không còn trong `devices.json` thì Ctrl+K gỡ gắn rồi mở hộp thoại;
    - Ctrl+K, nút Online, Đăng nhập… dùng thiết bị gắn. Không có DeviceLink (test của 004) thì Ctrl+K theo dõi theo địa chỉ như 004;
    - trang Thiết bị: phần "Thiết bị của project" (Online/Offline, "Đổi thiết bị…"); nút "Kết nối theo dõi" của trang gọi `monitorAddress()` (theo địa chỉ, HTTP);
    - `https://`: `normalizeMonitor` báo ngay tại ô, kèm nút mở Thiết bị trong mạng; `addressOf` giữ scheme `https`/`wss` để Rust trả `bad-address`; `DeviceSession.connect` từ chối (`invalid-address`);
    - Rust: `KnownDevice::adopt_reported_name`, `apply_identity` ở `device_login` và `device_get` `/api/v1/device/identity`; đổi `host` khi tên còn mặc định thì tên theo `host` mới. `mock-device` làm y như vậy.
  - **Quyết định:**
    - dò (`device_probe`) không đặt tên: contract §4 không cho dò gửi request, và chứng chỉ chưa ghim chưa đáng tin. Tên đổi ở lần đọc `device/identity` đầu tiên qua kết nối đã ghim; luồng Online luôn đăng nhập ngay sau dò;
    - khi Offline, thanh trạng thái và cây hiện thiết bị gắn; Đăng nhập… ưu tiên thiết bị gắn rồi mới tới thiết bị Online gần nhất.
  - **e2e cũ sửa:**
    - monitor bước 2: kiểm "thiết bị không trả lời ≤ 3 s" chuyển sang nút "Kết nối theo dõi" của trang, vì Ctrl+K nay là Online (đo 2,81 s);
    - monitor bước 4: thiết bị trỏ tới runtime giả thêm bằng `__matMock.device.addSaved` (runtime giả nghe HTTP ở cổng ngẫu nhiên, Thêm theo địa chỉ chỉ đặt cổng HTTPS);
    - online bước 1 mở hộp thoại bằng Ctrl+K (menu vẫn dùng ở bước 6, 7, 10);
    - `typeAddress` chọn chữ bằng `input.select()`: `clickCount: 3` không chọn chữ.
  - **Contract cần ghi** (chưa sửa): 004 `commands.md` (`online.connect`, `online.login`, `online.openWeb`); 005 tauri-commands §12.4 (tên mặc định), §10 (`addSaved`); data-model (thiết bị gắn với project).
- [X] T085b [P] [US1] Thiết bị runtime cũ có cổng HTTP khác 8080 (ví dụ port-forward :9080): hiện chưa gắn được để Ctrl+K rơi về theo dõi chỉ đọc, vì Thêm theo địa chỉ chỉ đặt cổng HTTPS (hạn chế ghi ở T085a). Sửa:
  - `device_probe` gặp `not-tls` thì thử `GET /api/v1/system/info` bằng HTTP trên cùng cổng. Là runtime < 0.4.0 thì lưu cổng đó làm `httpPort` của thiết bị, và luồng Online rơi về theo dõi chỉ đọc kèm `runtime-old`;
  - hộp thoại Thêm theo địa chỉ cho sửa cổng HTTP trong phần "Nâng cao";
  - test Rust và TS đỏ trước; e2e: thêm `host:<cổng HTTP của runtime giả>` rồi Ctrl+K → theo dõi chỉ đọc.

  **Ghi chú khi làm:**
  - **Đỏ → xanh:**
    - Rust (thân `todo!()`): 85 qua / 3 hỏng → 88/88; clippy `-D warnings`, `fmt --check` sạch;
    - TS: 5 hỏng / 86 qua (bản giả, phiên, app, hộp thoại) → xanh;
    - e2e (chỉ `monitor`): 44 đạt / 3 không đạt (chưa có Nâng cao; Ctrl+K báo "không tới được cổng HTTPS"; lỗi console `ERR_CONNECTION_REFUSED`) → toàn bộ e2e 157/157.
  - **Rust** (`device/mod.rs`):
    - `probe` gặp `not-tls` thì gọi `adopt_old_http_port`: `GET /api/v1/system/info` bằng HTTP trên cùng cổng, qua `monitor_get` (hạn 3 s, không token);
    - `runtimeVersion` < 0.4.0 thì lưu `httpPort = httpsPort`. Không lưu nếu địa chỉ đổi trong lúc hỏi; `httpPort` đã bằng cổng đó thì không hỏi lại;
    - `device_probe` vẫn trả `not-tls`;
    - so phiên bản (`runtime_before_online`): phần ba số như `compareSemver`, bỏ hậu tố `-…`, `+…`. Chuỗi không đúng dạng ba số thì không coi là cũ;
    - test: máy chủ thử `plain_http_server` (ClientHello → 400 như CivetWeb, GET → JSON).
  - **TS:**
    - `DeviceSession` gặp `not-tls` thì đọc lại thiết bị (`devices()`) rồi hỏi system/info ở `httpPort` mới;
    - `StudioApp` cập nhật bản sao danh sách đã lưu theo thiết bị của phiên, nên Mở web thiết bị đúng cổng cả khi Offline;
    - Thêm theo địa chỉ › **Nâng cao** (nút `aria-expanded`, chỉ render khi mở): ô Cổng HTTP, để trống là 8080, sai thì báo tại ô (`http-port`, `parsePort` ở `model/device.ts`). Thiết bị đã lưu ở địa chỉ đó thì sửa `httpPort` bằng `device_update`;
    - chi tiết thiết bị đã lưu hiện thêm dòng HTTP.
  - **Bản giả `mock-device`:**
    - dò như Rust (`not-tls`, lưu cổng); thêm điều khiển `setHttpPort` và `realRuntime(address)`;
    - **quyết định:** chỉ gọi ra mạng thật cho địa chỉ đã khai bằng `realRuntime`; địa chỉ lạ coi như không có gì nghe. Lý do: `fetch` tới cổng đóng ghi `Failed to load resource` vào console, bản Tauri gọi trong Rust nên không có lỗi này;
    - `monitor.e2e` khai runtime giả ở đầu kịch bản.
  - **e2e:** `monitor` bước 10 (+5 kiểm): Nâng cao, axe sáng/tối, thêm `127.0.0.1:<cổng runtime giả>`, Ctrl+K → theo dõi chỉ đọc kèm runtime-old. Kiểm "chỉ một WebSocket" dời xuống cuối kịch bản.
  - **Contract cần ghi** (chưa sửa): tauri-commands §4 (`device_probe` có request HTTP khi `not-tls`, đổi `httpPort`), §10 (`setHttpPort`, `realRuntime`), data-model §6 (nhánh `not-tls`).
- [X] T085c [P] [US1] Studio chuẩn hóa mật khẩu về NFC (`normalize('NFC')`) trước khi gửi `device_login` (ADR-011, chốt 2026-10-11). Test viết trước: mật khẩu gõ dạng tổ hợp ("a" + U+0306) tới Rust ở dạng dựng sẵn ("ă"). Bản giả `mock-device` so mật khẩu sau chuẩn hóa.

  **Ghi chú khi làm:**
  - **Đỏ → xanh:** 2 hỏng / 25 qua → 27/27 (`tauri-device.test.ts`, `mock-device.test.ts`);
  - `loginPassword()` trong `platform/device-types.ts`; dùng ở `tauri-device.ts` (ngay trước `invoke('device_login')`) và `mock-device.ts` (chuẩn hóa rồi so đúng byte như thiết bị);
  - **Ghi cho ADR-011:** NFC còn đổi ký tự singleton (Å U+212B, Ω U+2126, K U+212A, U+0387, U+037E, chữ CJK compatibility U+F900–U+FAFF, U+2F800–U+2FA1D) và jamo Hangul ghép. Lệnh đặt mật khẩu chỉ chặn dấu tổ hợp, nên mật khẩu chứa các ký tự này đặt trên thiết bị sẽ không đăng nhập được từ Studio. Đề nghị lệnh đặt mật khẩu chặn thêm các khối này, hoặc ghi là giới hạn.
- [ ] T086 [US1] Kiểm US1 với runtime x64 theo quickstart §2 và §5 bước 1–6, 16. Bước 1 trên Windows chỉ kiểm giao diện và thời gian quét: broadcast không đi qua NAT của Docker Desktop; tìm thiết bị thật ở T162 ⚠️🔌. Ghi `docs/reports/005-acceptance.md`.

**Checkpoint**: US1 chạy độc lập trên x64: tìm thiết bị (`device-it`), ghim, đăng nhập, khóa tạm, theo dõi qua HTTPS. Chế độ theo dõi của 004 vẫn đạt (24 test cũ của T079).

---

## Phase 4: User Story 2 — Nạp xuống an toàn (Priority: P1)

**Goal**: nạp xuống qua bước xem trước, tiến trình 6 bước rồi kết quả; tự quay về bản trước khi lỗi; khôi phục bản trước bằng một lệnh; mất điện ở bất kỳ bước nào vẫn chạy bản hợp lệ; client Chrome tự tải lại trong ≤ 10 s.

**Independent Test**: spec US2. Nạp xuống project mẫu đã sửa, client Chrome tự tải lại; gói hỏng bị từ chối, bản cũ chạy tiếp; lỗi kiểm tra sức khỏe thì tự quay về; khôi phục bản trước; giết tiến trình ở từng bước (quickstart §3 `deploy`, `packages`, `kill`, `health`, `busy`, `reload`; §4; §5 bước 7–10).

**Phụ thuộc**: Checkpoint "Mốc bảo mật" (Constitution V). Studio TS cần US1; phần nối vào file của 004 **sau 004 Phase 4–6**. Phần đọc gói của thiết bị (`GET /api/v1/project/package`, `device_fetch_package`, `package_read`) và `compare.ts` nằm ở story này vì bước xem trước cần tóm tắt khác biệt và ảnh hưởng tới lưu trữ (FR-020); US3 dùng lại.

**Quyết định 2026-10-11** (người dùng giao toàn quyền): phần thư viện không mở API nào được làm trước Mốc bảo mật, song song với Phase 2:
- T087–T094: đọc/ghi gói C++;
- T096–T100: kho project, quyết định lúc khởi động, máy trạng thái nạp xuống, dưới dạng hàm và lớp chưa nối vào runtime;
- T101–T106: live 1.1.0, trang xem tự tải lại;
- T114, T115: gói phía Rust, chưa đăng ký lệnh Tauri;
- T118–T121: `compare.ts`, mô hình luồng Nạp xuống.

Mọi route `/api/v1/project/*` (T109, T110), phần nối vào runtime (T108) và lệnh Tauri nạp xuống/đọc lên (T116, T117) chỉ làm sau Checkpoint "Mốc bảo mật". Constitution V chỉ chặn việc bật API nạp xuống khi chưa có HTTPS, đăng nhập, role, audit, không chặn việc viết thư viện.

### Gói `.matscada` phía thiết bị (C++)

- [X] T087 [P] [US2] `schemas/package-manifest.schema.json` (draft-07, `$id` `https://schemas.atpro.com.vn/mat/package-manifest/1.0.json`) theo contract matscada-package §3:
  - `format` = `"matscada-package"`; `formatVersion` SemVer; `project.{projectId, projectName, projectVersion, minRuntimeVersion}`; `createdAt`; `generator {name, version}`; `digest` theo `^sha256:[0-9a-f]{64}$`;
  - `files` 1–1023 mục; mỗi mục đúng ba khóa `path`, `size` (integer ≥ 0), `sha256` (`^[0-9a-f]{64}$`), `additionalProperties: false`;
  - khóa lạ ở cấp đầu, trong `project` và trong `generator` được phép;
  - thêm dòng vào `schemas/README.md` (`package-runtime.ps1` đã chép `schemas/*.json`).
- [X] T088 [P] [US2] Test `core/package/tests/zip_reader_test.cpp`:
  - mọi vector của `tests/package-vectors/` (kể cả vector sinh lúc chạy và vector golden của T094, T115) cho đúng mã và `path` của `expected.json`;
  - tập con ZIP của contract §2: EOCD đúng 22 byte cuối, comment dài 0; central directory liền trước EOCD; entry liền nhau từ offset 0; phương thức 0 hoặc 8; cờ; version needed ≤ 20; không extra field, không comment; header cục bộ khớp central; thuộc tính ngoài;
  - giải nén đếm byte thật, dừng ngay khi vượt kích thước khai báo, phải hết đúng dữ liệu nén; CRC32 khớp;
  - giới hạn §6: `.json` ≤ 1 MiB, `.svg` ≤ 5 MiB, tổng ≤ 200 MiB, tỉ lệ ≤ 100 với entry > 64 KiB, 1–1024 entry, gói ≤ 52.428.800 byte;
  - gặp lỗi đầu tiên thì dừng, không giải nén tiếp.
- [X] T089 [P] [US2] Test `core/package/tests/package_check_test.cpp`:
  - manifest: entry đầu, stored, ≤ 262.144 byte, UTF-8 không BOM; schema kiểm bằng valijson; MAJOR khác 1 → `E_PKG_FORMAT_VERSION`, MINOR lớn hơn vẫn đọc; khóa lạ bỏ qua; `files` trùng hoặc chưa sắp → `E_PKG_MANIFEST`;
  - trường project bằng `project.json` (`E_PKG_IDENTITY`); `E_PKG_UNLISTED`, `E_PKG_MISSING`, `E_PKG_CHECKSUM`;
  - digest tính lại, so với `digest` của manifest và với header `X-Mat-Digest` (`E_PKG_DIGEST`);
  - bí mật (`E_PKG_SECRET`): khóa JSON cùng danh sách từ của `E_LOG_SECRET` (`password`, `passwd`, `pwd`, `secret`, `token`, `apikey`, `api_key`), URL kết nối có tài khoản, chuỗi `-----BEGIN … PRIVATE KEY-----` trong file bất kỳ;
  - đường dẫn: luật 1–8 của §5 (`E_PKG_PATH`), đuôi `.json`/`.svg` chữ thường (`E_PKG_TYPE`).
- [X] T090 [P] [US2] Test `core/package/tests/extract_test.cpp` (contract §8):
  - giải nén vào `staging/<opId>/project/` (`0700`); thư mục con bằng `mkdirat` theo file descriptor của thư mục cha; file mở bằng `O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW`, quyền `0600`; `fsync` từng file rồi từng thư mục;
  - symlink cài sẵn trong vùng tạm không bị đi theo;
  - chỗ trống xuống dưới `historianMinFreeMB` trong lúc giải nén (`statvfs` tiêm được) → `NO_SPACE`;
  - lỗi thì dọn vùng tạm.
- [X] T091 [P] [US2] Test `core/package/tests/zip_writer_test.cpp` (contract §7): ghi stored tất định (giờ DOS `0x0000`, ngày DOS `0x0021`, cờ bit 11, "version made by" 20, thuộc tính trong và ngoài 0, không extra field, comment, data descriptor); manifest đứng đầu, file sắp theo `path`; hai lần ghi cho cùng byte; bộ đọc đọc lại được; `generator` = `mat-runtime 0.4.0`.
- [X] T092 [P] [US2] Test đột biến `core/package/tests/package_fuzz_test.cpp`: 10.000 biến thể từ các vector hợp lệ, hạt giống cố định (lật bit, cắt cụt, đổi trường độ dài và offset): không crash, không ghi ra ngoài vùng tạm, luôn trả `E_PKG_*` hoặc hợp lệ.
- [X] T093 [US2] Cài `core/package/{zip_reader,manifest,package_check,extract}.{hpp,cpp}` (`tinfl` và `mz_crc32` của miniz; manifest kiểm bằng valijson với schema của T087), đạt T088, T089, T090, T092.
- [X] T094 [US2] Cài `core/package/zip_writer.{hpp,cpp}`, đạt T091. Thêm vector golden `tests/package-vectors/valid-device-tank-demo/` (gói do bộ ghi C++ đóng từ `projects/tank-demo`) và test so lại byte khi sinh lại.
- [X] T095 [US2] Lệnh `mat-runtime --check-package <file>` trong `server/cli/package.{hpp,cpp}`. Test `server/tests/package_cli_test.cpp` viết trước, chạy đỏ: gói hợp lệ in digest, mã thoát 0; gói lỗi in `E_PKG_*` kèm `path`, mã thoát 1.

  **Ghi chú khi làm (T087–T095, agent d1, 2026-10-11/12):**
  - **T087:**
    - schema draft-07; khóa lạ cho phép ở cấp đầu, trong `project` và `generator`; `files[]` 1–1023 mục, mỗi mục `additionalProperties: false`;
    - `formatVersion` dùng cùng định nghĩa SemVer với `project.schema.json`;
    - không đặt pattern cho `files[].path` (§8a);
    - thêm `maxLength` cho chuỗi có pattern (64, 71). C++ còn chặn chuỗi dài trước valijson, vì `std::regex` đệ quy theo ký tự;
    - thêm dòng vào `schemas/README.md`; Prettier xanh;
    - test meta-schema của TS chờ 5 schema: agent TS sửa (xem ghi chú ở T013/T019).
  - **Đỏ → xanh:**
    - test viết trước, chạy trên bản cài tạm (header đủ, hàm trả sai): 210 test, 209 hỏng ở mức assertion, 1 đạt (`PackageVectors.GeneratedPackagesArePresent` chỉ kiểm file có mặt), không crash;
    - sau khi cài: 242/242 xanh (gồm `digest_test`).
    - Số test: `zip_reader_test` 153, `package_check_test` 28, `extract_test` 14, `zip_writer_test` 10, `package_fuzz_test` 1, `package_cli_test` 6.
  - **T088:**
    - mọi vector có `ok` hoặc `code`: 59, gồm 6 gói sinh vào `out/` và vector golden T094. Mỗi vector chạy qua `FileSource` và `MemorySource`; đúng mã và `path` 100 %;
    - thiếu file trong `out/` thì test hỏng kèm lệnh `node tests/package-vectors/generate.mjs --out`;
    - test thêm từng luật của §2, giới hạn §6 ở biên, "lỗi đầu tiên thì dừng" (sink ghi nhận entry đã giải nén);
    - bộ mã deflate tối thiểu trong test (stored block, Huffman cố định), vì bản build không có bộ nén. Có bomb khai 1000 byte nhưng giải ra 1 GiB: dừng < 2 s.
  - **T093, thứ tự kiểm** (chốt theo §8a; bộ đọc Rust T114 phải theo đúng). Lỗi đầu tiên thắng; trong một giai đoạn, entry theo thứ tự central directory:
    1. kích thước gói;
    2. EOCD: đúng 22 byte cuối, không comment, một đĩa (`E_PKG_FORMAT`); 1–1024 entry (`E_PKG_ENTRIES`); CD liền trước EOCD;
    3. từng entry:
       - bản ghi CD và biên (`E_PKG_FORMAT`, không `path`);
       - tên 1–128 byte UTF-8 (`E_PKG_PATH`);
       - version needed, phương thức, cờ, extra, comment, đĩa (`E_PKG_FORMAT`);
       - host 0/3, loại file: symlink, thư mục hay bit DOS `0x10` ở cả hai host → `E_PKG_PATH`;
       - luật đường dẫn 1–5, 8, 7, rồi 6;
       - bố cục: offset bằng chỗ kết thúc entry trước (`E_PKG_FORMAT`, không `path`);
       - header cục bộ bằng CD (`E_PKG_FORMAT` kèm `path`);
       - stored có kích thước nén khác kích thước gốc → `E_PKG_FORMAT` kèm `path` (kiểm ở đây, không đợi giải nén);
       - cuối cùng: CD không còn byte thừa, entry cuối kết thúc đúng ở CD offset;
    4. manifest: entry đầu, stored, ≤ 256 KiB, không BOM, UTF-8, lồng ≤ 64, JSON object, schema (`E_PKG_MANIFEST`); `files[]` tăng dần theo byte; không có `matscada.json`; rồi `files[].path` theo luật 1–5, 7, 6 (`E_PKG_PATH`/`E_PKG_TYPE`);
    5. hai lượt:
       - (a) kích thước khai báo của **mọi** entry trước khi giải nén byte nào: file theo loại, tổng cộng dồn (gồm manifest; `path` là entry làm vượt), tỉ lệ;
       - (b) giải nén từng entry vào bộ đệm đúng bằng kích thước khai báo, đếm byte thật. CRC, SHA-256, bí mật và identity tính dọc đường, báo ở giai đoạn sau;
    6. CRC mọi entry (kể cả manifest), rồi size, sha256 so với `files[]`;
    7. `E_PKG_UNLISTED` (thứ tự CD), rồi `E_PKG_MISSING` (thứ tự `files[]`);
    8. digest tính lại, digest mong đợi, identity (không `path`), MAJOR của `formatVersion`;
    9. bí mật: manifest trước, rồi từng entry.
  - **T093, quyết định cài đặt:**
    - bí mật quét JSON theo luồng (SAX của nlohmann); chỉ tính khi cả file là JSON hợp lệ, như DOM;
    - `connections[].url` chỉ xét ở object cấp đầu, như `E_LOG_SECRET`;
    - PEM so theo byte trên mọi file;
    - không `std::regex` trên nội dung;
    - `files[].size` vượt INT64 bị kẹp lại, nên ra `E_PKG_CHECKSUM` chứ không phải `E_PKG_MANIFEST`; số thực như `449.0` không phải integer (như serde);
    - lỗi I/O → `STORE_IO`.
  - **T090:**
    - đích chưa có thì tạo (0700); đã có thì phải là thư mục, mở bằng `O_NOFOLLOW`;
    - thư mục con bằng `mkdirat` + `openat(O_DIRECTORY|O_NOFOLLOW)`; file bằng `O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW` 0600;
    - `fsync` từng file, rồi thư mục (sâu trước), đích, và thư mục cha khi hàm tự tạo đích;
    - `NO_SPACE` khi chỗ trống trừ đi file sắp ghi xuống dưới `minFreeBytes`; `statvfs` và `fsync` tiêm được;
    - lỗi bất kỳ giai đoạn nào: xóa đích bằng `unlinkat`, không đi theo symlink. Test có symlink cài sẵn cho thư mục, file và chính đích.
  - **T091, T094:**
    - manifest ghi bằng `ordered_json`, thụt 2 dấu cách, có `\n` cuối; hai lượt đọc file, mỗi lần chỉ một file trong bộ nhớ;
    - từ chối mọi đầu vào mà bộ đọc sẽ từ chối, kể cả bí mật; `fileInput` đọc tối đa 5 MiB + 1;
    - golden `valid-device-tank-demo/`: 14.281 byte, digest `sha256:9ba112c6…61edb7`, bằng `valid-tank-demo-*` và `tests/project-vectors/valid-tank-demo`;
    - Python `zipfile` (testzip), .NET `ZipFile` và bộ đọc tham chiếu Node đều đọc được vector golden;
    - sinh lại: `MAT_WRITE_GOLDEN=1 zip_writer_test --gtest_filter=GoldenDeviceTankDemo.*`.
  - **T092:**
    - 10.000 biến thể, splitmix64 hạt cố định; 7 kiểu đột biến; 1.000 biến thể giải nén thêm vào thư mục lồng 3 cấp, kiểm không còn gì sót;
    - phân bố mã: FORMAT 5320, MANIFEST 2850, CHECKSUM 1516, PATH 102, TYPE 57, IDENTITY 17, UNLISTED 16, DIGEST 9, hợp lệ 113;
    - **ASan + UBSan** (gcc 9, `-fsanitize=address,undefined`): 212 test, 0 lỗi sanitizer;
    - ASan của gcc 9 rơi vào vòng `DEADLYSIGNAL` trên kernel WSL mới (ASLR cao), phải chạy `setarch x86_64 -R` với `--security-opt seccomp=unconfined`.
  - **T095:**
    - `--check-package <file> [--schemas-dir <dir>]`, mã thoát 0/1/2/6 theo device-config §4;
    - lỗi in `CODE 'path': message`; ký tự điều khiển và bidi của `path` in dạng `\xNN`/`\uXXXX`;
    - nhánh trong `server/main.cpp` đặt cạnh `--set-secret`, trước mọi cổng mạng;
    - `mat_cli` link `mat_package`;
    - armhf dưới qemu: in đúng digest và mã lỗi; `smoke-armhf.sh` OK.
  - **Số đo:** ADR-012 mục "Số đo". x64: kiểm gói stored 50 MiB 0,26–0,30 s, RSS đỉnh ≈ 9 MiB.
  - **Lượt đầy đủ** (`test-x64.ps1` không `-Target`/`-Filter`, 2026-10-12): 1065/1065 xanh (1 bench audit tắt sẵn).

### Kho project, chuỗi nạp xuống, kích hoạt

- [X] T096 [P] [US2] Test `core/project-store/tests/store_test.cpp` (data-model §9, R13):
  - bố cục `<dataDir>/projects/` (`0700`): `state.json`, `v/<seq>/{package.matscada, project/, meta.json}`, `staging/<opId>/`, `ops/<opId>.json` (giữ 20 thao tác gần nhất);
  - `state.json`: `schemaVersion`, `active` (`seq` hoặc `null`), `nextSeq`, `versions[]` (`seq`, `digest`, `projectId`, `projectName`, `projectVersion`, `minRuntimeVersion`, `size`, `activatedAt`, `clockOk`, `deployedBy`, `deployedFrom`, `source` ∈ `studio | runtime-package | restore`), `pending` = `null` hoặc `{ opId, kind, from, to, phase ∈ activating | health | rolling-back, bootAttempts, user, source, startedAt }`;
  - đổi `state.json`: ghi file tạm, `fsync`, `rename`, `fsync` thư mục;
  - khởi động: `v/<seq>` thiếu `meta.json` bị xóa; `staging/` được dọn;
  - dọn bản vượt `projectBackups` (mặc định 3; 1–10) chỉ sau khi commit;
  - nhận project cài theo cách cũ (FR-027): kho trống và `projectDir` hợp lệ → `v/1` (gói stored do thiết bị đóng), `source = runtime-package`, audit `project.adopt`; `projectDir` lỗi hoặc trống → không nhận, đọc lên trả `NO_PROJECT_PACKAGE` kèm lý do.

  **Ghi chú khi làm:**
  - 27 test (`StoreState` 6, `ProjectStore` 21), file trong thư mục tạm. Đồng hồ, kiểm "đã đồng bộ" và `fsync` đều tiêm được; bộ ghi `fsync` đọc đường dẫn qua `/proc/self/fd`. Hàm đóng gói và audit là bản giả (`tests/store_test_support.hpp`);
  - **đỏ** chung với T097, T098 (header đủ, bản cài tạm trả sai): 65 hỏng / 67. Đạt 2 test bất biến của T097 ("không chạy gì" đúng với mặc định). Ba test hỏng do ngoại lệ JSON rỗng của bản tạm, được GoogleTest bắt, không crash. Lần chạy đỏ đầu có segfault vì test đọc `optional` rỗng; đã sửa test cho hỏng ở assertion, rồi mới chạy lại;
  - thứ tự ghi `state.json` kiểm bằng nội dung file lúc mỗi `fsync`: file tạm được `fsync` khi `state.json` còn bản cũ; thư mục được `fsync` khi đã là bản mới. Ghi lỗi thì không còn file tạm, bản cũ giữ nguyên;
  - kiểm thêm ngoài danh sách:
    - bộ đọc `state.json` từ chối MAJOR khác 1, `seq` trùng hoặc không nhỏ hơn `nextSeq`, `active` không có trong `versions[]`, `opId` không phải UUID (tên này dùng làm tên file), digest sai dạng; khóa lạ bỏ qua;
    - `v/<seq>` hoàn chỉnh mà không được tham chiếu (bị giết sau `backup`, trước `activate`) bị xóa khi khởi động. Bản của thao tác dở (`pending.from`, `to`) được giữ. Không có `state.json` thì mọi `v/*` là rác. `state.json` hỏng thì không đụng `v/`;
    - symlink trong `staging/` bị xóa, không đi theo; kho là symlink thì `open` từ chối;
    - nhận project cũ: chép đúng tập file của project (file khác trong `projectDir` bị bỏ) vào vùng tạm bằng `mkdirat`, `O_EXCL|O_NOFOLLOW`, `0600`, rồi đóng gói **từ bản chép**. Đường dẫn không an toàn, file thiếu, đóng gói lỗi, audit lỗi, ghi `state.json` lỗi: kho vẫn trống, vùng tạm sạch. Runtime chạy `projectDir` như 0.3.0 và có lý do cho `NO_PROJECT_PACKAGE`.
- [X] T097 [P] [US2] Test `core/project-store/tests/boot_decision_test.cpp`: từng dòng của bảng "Quyết định lúc khởi động" ở data-model §9:
  - không có `state.json`, project cũ hợp lệ / lỗi hoặc trống; `pending = null`;
  - `phase` `activating` hoặc `health` với `bootAttempts < 2` và `≥ 2`; `phase = rolling-back`;
  - `bootAttempts` tăng được ghi (`fsync`) trước khi chạy bản mới;
  - rollback cũng lỗi → chế độ "không có project hợp lệ"; không bao giờ chạy bản dở dang.

  **Ghi chú khi làm:**
  - 21 test:
    - `BootDecision` 16: mỗi dòng của bảng trên hàm thuần `decideBoot()`, cộng một test duyệt mọi tổ hợp (pha × `bootAttempts` 0–3 × bản nào hoàn chỉnh): bản được chạy luôn hoàn chỉnh, và lần chạy đó luôn được đếm trong `state.json` sẽ ghi;
    - `StartStore` 5: `startStore()` trên kho thật. `bootAttempts + 1` đã nằm trên đĩa (`fsync` file tạm rồi thư mục) khi hàm trả về. Ghi lỗi → `NoValidProject`, không chạy gì. Ba lần khởi động không qua kiểm tra sức khỏe → rollback (`HEALTH_CRASH`); bản cũ cũng chết hai lần → không có project hợp lệ;
  - **lệch/bổ sung so với bảng** (quyết định khi làm):
    - pha `rolling-back` cũng đếm `bootAttempts`: vào rollback lúc khởi động ghi `1`; `≥ 2` → rollback lỗi. Nếu không đếm, bản cũ chết liên tục sẽ thành vòng khởi động lại (systemd `StartLimitBurst`);
    - rollback lỗi (bản cũ chết 2 lần, thiếu file, không đạt kiểm tra sức khỏe) → `pending = null`, `active = null`, `versions[]` giữ nguyên để khôi phục tay. Khởi động sau là `NoProject`;
    - bản mới thiếu `meta.json` → rollback ngay (`HEALTH_PROJECT`), không chờ chết 2 lần. Không có bản trước (`from = null`) → về "chưa có project" (`rolled-back`);
    - `state.json` hỏng → `NoValidProject`, không nhận project cũ, không ghi gì. Kho cần người xem (vấn đề mở);
    - pha `activating` được đổi thành `health` khi tăng `bootAttempts`; hai pha xử lý như nhau.
- [X] T098 [P] [US2] Test `core/project-store/tests/deploy_pipeline_test.cpp`: máy trạng thái thuần, các bước tiêm được (data-model §10, device-api §5):
  - thứ tự `receive → verify-package → validate → backup → activate → health → committed`; `restore` đánh dấu `receive`, `verify-package` là `skipped` (tên bước `receive` thay `upload`: data-model "Thuật ngữ");
  - lỗi ở 4 bước đầu → `failed`, kho và bản đang chạy không đổi, vùng tạm được dọn; `activate` lỗi → `STORE_IO` hoặc `EXEC_FAILED`; mất điện trước `activate` → `interrupted` (`INTERRUPTED`);
  - `health` lỗi, quá 15 s, chết 2 lần → `rollback` → `rolled-back` (`HEALTH_TIMEOUT`, `HEALTH_CRASH`, `HEALTH_PROJECT`, `HEALTH_HTTPS`);
  - khóa: chỉ một thao tác `running`; thao tác thứ hai → `DEVICE_BUSY` `{ opId, kind, user, source, since }`; `X-Mat-Base-Digest` khác digest đang chạy → `BASE_CHANGED`;
  - `receive` không xong trong 10 phút → `RECEIVE_TIMEOUT`, dọn vùng tạm, nhả khóa; mạng rớt → `RECEIVE_ABORTED`;
  - audit `project.deploy`/`project.restore` bản `started` ghi trước, không ghi được → `AUDIT_UNAVAILABLE`; kết quả ghi dưới tài khoản đã bắt đầu, kể cả khi phiên đã hết hạn; `detail` có digest cũ → mới và `opId`;
  - `steps[]` có `id`, `state` ∈ `pending | running | ok | failed | skipped`, thời điểm, `code`, `issues`; `result` ∈ `running | committed | failed | rolled-back | interrupted`; `clientsNotified`.

  **Ghi chú khi làm:**
  - 20 test (`DeployPipeline`). Kho thật trong thư mục tạm; các bước, đồng hồ, chỗ trống, audit đều giả. Một "tiến trình" gồm `ProjectStore` + `startStore()` + `DeployPipeline`. `restart()` trả `Replaced` thay cho `execv`, rồi test dựng tiến trình mới trên cùng thư mục. Hook `beforeStep` trả `false` thay cho `kill -9` trước một bước;
  - lỗi 4 bước đầu chạy 8 trường hợp: mạng rớt, thân ngắn, thân dài hơn `Content-Length`, đầy đĩa khi nhận, `E_PKG_CHECKSUM` (có `issues[].file`), `NO_SPACE` khi giải nén, `E_VALIDATION` (có `issues`), `STORE_IO` khi `backup`. Mỗi trường hợp kiểm: byte của `state.json` không đổi, chỉ còn `v/1`, `staging/` rỗng, audit `failed` đúng mã, khóa được nhả;
  - test `SyncsOfACommittedDeploy` viết sau khi cài, để giữ số `fsync` (xem T100).
- [X] T099 [US2] Cài `core/project-store/store.{hpp,cpp}` và `core/project-store/boot_decision.{hpp,cpp}`, đạt T096, T097.

  **Ghi chú khi làm:**
  - **xanh:** 48/48 (T096, T097) trên x64. Hai lỗi phát hiện khi chạy:
    - `versionMetaJson` lặp `items()` của một object tạm đã bị hủy (`bad_alloc`);
    - hằng thời gian trong test là 2026-10-10, không phải 2026-10-20;
  - `mat_project_store` (STATIC): PUBLIC `mat_audit mat_core`, PRIVATE `mat_crypto` (`getrandom` cho UUID); tự thêm vào `mat_device`. Không phụ thuộc `mat_package` của d1: gói đi qua `PackFn` tiêm vào. `mat-runtime` và `server/main.cpp` không đổi;
  - các hàm đổi trạng thái thuần (`stateCommitted`, `stateRollingBack`, `stateEnded`) nằm trong `store.hpp`, dùng chung cho `decideBoot` và các lần ghi của kho;
  - đọc thư mục bằng `readdir64`/`fstatat64`/`statvfs64`, xóa cây không đi theo symlink. Ngày ISO tính theo số ngày, không qua `time_t`, nên bản 32 bit chạy được sau 2038. `opId` là UUID v4 chữ thường; tên khác bị từ chối trước khi chạm đĩa;
  - **armhf:** build xanh. Biên dịch chéo ba file test trong scratchpad (không commit), chạy dưới qemu: 27 + 21 + 20 = 68/68. Lần đầu hỏng 9 test vì helper của test dùng `readdir` 32 bit (EOVERFLOW); đã đổi helper sang `readdir64`. Thư viện không bị ảnh hưởng.
- [X] T100 [US2] Cài `core/project-store/deploy_pipeline.{hpp,cpp}`, đạt T098.
  **Ghi chú khi làm:**
  - **xanh:** 68/68 cho cả ba file trên x64 và armhf (qemu); clang-format sạch. Cả bộ x64 lúc chạy (2026-10-12): 1052/1052, cộng 1 test tắt (`AuditLogBench`);
  - giao diện: `begin()` (kiểm theo thứ tự bận → `BASE_CHANGED` → bản lưu (restore) → chỗ trống (deploy) → audit `started`) → `receive()`/`receiveEnd()` → `run()` trên luồng worker → `resume()`, `healthPassed()`, `healthFailed()`, `poll()` (hạn 10 phút và 15 s theo đồng hồ đơn điệu). Các bước tiêm qua `DeployHooks`: `verifyPackage`, `validate`, `notifyClients`, `restart`, `freeBytes`, `beforeStep`. Không có luồng, không có socket;
  - **quyết định:**
    - từ chối trước khi bắt đầu (bận, `BASE_CHANGED`, `NO_SPACE`, `NO_SUCH_VERSION`, `ALREADY_ACTIVE`) ghi audit `failed` với mã đó, cố gắng hết mức, dưới người hỏi. `AUDIT_UNAVAILABLE` thì không ghi được gì;
    - bản ghi `ops/<opId>.json` ghi kết quả **trước** lần ghi `state.json` quyết định nó. Vì vậy bản ghi còn `running` mà `state.json` không có `pending` của nó nghĩa là bị giết trước `activate` → `interrupted`. Dòng audit kết quả ghi sau `state.json`; mất điện giữa hai lần ghi chỉ mất dòng audit, không sai;
    - restore kích hoạt lại đúng `v/<seq>` (không chép). Lúc commit, mục của nó lên đầu `versions[]` với `source = restore`, `deployedBy`/`deployedFrom` của người khôi phục. Bản mới của deploy chỉ vào `versions[]` khi commit, nên rollback không phải xóa mục nào;
    - `restart()` trả về nghĩa là `execv` lỗi → `EXEC_FAILED`, `pending` bị xóa, bản cũ giữ nguyên. T108 nên cho runtime thoát để systemd chạy lại, vì CivetWeb đã dừng;
    - `DEVICE_BUSY.since` là ms UTC, như `system/info.operation.since`;
  - **số `fsync` của một lần nạp xuống commit** (test `SyncsOfACommittedDeploy`, chỉ phần của kho):
    - bản ghi lúc bắt đầu 2; `backup` 3 (`v/`, `meta.json`, `v/<seq>`); kích hoạt: `state.json` 2 + bản ghi 2; khởi động lại: `state.json` 2; commit: bản ghi 2 + `state.json` 2. Tổng **15**;
    - cộng 1 `fsync` gói nhận được, các file và thư mục khi giải nén (`extract.cpp`), và 2 commit FULL của `audit.db`;
    - mỗi lần ghi là file vài KB. Một lần nạp xuống cỡ vài chục lần ghi khối nhỏ cộng kích thước project, không đáng kể so với 2 GB/ngày. (T100a thêm 2 `fsync` mỗi lần commit: tổng 17.)
- [X] T100a [US2] Hai quyết định bổ sung cho kho project (phiên chính, 2026-10-12, khi duyệt T096–T100):
  - **`state.json` hỏng khi khởi động:** đổi tên thành `state.json.corrupt-<mốc giờ đơn điệu>`, dựng lại `state.json` từ các thư mục `v/<seq>` có `meta.json` hợp lệ (bản có `activatedAt` mới nhất làm `active`, mọi bản còn lại vào `versions[]`), audit `project.adopt` kèm `detail.reason = "state-corrupt"`. Không còn bản hợp lệ thì "chưa có project" và vẫn nạp xuống được. Test viết trước: file hỏng ở từng dạng (rỗng, JSON sai, `schemaVersion` lạ, `active` trỏ tới bản không có).
  - **Project cũ chưa vào kho:** `startStore` nhận project cũ vào kho ở lần khởi động đầu, trước khi cho phép nạp xuống. Không nhận được thì `begin` từ chối thao tác nạp xuống (mã `NO_BASE_PROJECT`, kèm lý do) cho tới khi nhận được hoặc kho trống hợp lệ. Test viết trước.

  **Ghi chú khi làm:**
  - **đỏ → xanh:** viết test trước với hàm/enum tạm biên dịch được (`recoverState` trả rỗng, `baseBlockReason` trả `""`): 13/81 hỏng ở assertion, không crash (hai test bất biến "chỉ kho hỏng mới được dựng lại", "project cũ rỗng/lỗi không chặn" đạt ngay). Sau khi cài: 81/81 (`StoreState` 6, `ProjectStore` 30, `BootDecision` 16, `StartStore` 7, `DeployPipeline` 22). Cả bộ x64: 1065/1065 cộng 1 test tắt. armhf: build xanh (chưa chạy lại qemu cho 13 test mới). clang-format sạch;
  - giao diện mới: `ProjectStore::recoverState(monoMs, audit)` → `RecoverResult`; `baseBlockReason()`/`setBaseBlockReason()`; `StoreStartup::recovered`, `corruptFile`; `BeginStatus::NoBaseProject` (`NO_BASE_PROJECT`, 409, `message` là lý do). `startStore` gọi `recoverState` ngay sau `load()`, trước `cleanup()` (nên `v/` hoàn chỉnh đã nằm trong `versions[]` và không bị xóa); `st.status` vẫn là trạng thái lúc đọc (`Corrupt`);
  - **cần sửa phía lưu `activatedAt`:** `meta.json` trước đây không bao giờ có `activatedAt` (chỉ `state.json` có), nên không có gì để chọn bản đang chạy. Nay `commitPending` ghi lại `meta.json` của bản được commit (cả `deployedBy`, `source`…) **trước** khi ghi `state.json`, và `adopt` ghi `meta.json` kèm `activatedAt` trước `state.json`. Hệ quả: +2 `fsync` mỗi commit (15 → 17, test `SyncsOfACommittedDeploy` đã đổi). Mất điện giữa hai lần ghi chỉ làm `meta.json` của bản chưa commit có `activatedAt` sớm; `state.json` vẫn là nguồn đúng, và chỉ khi `state.json` hỏng thì mới dùng đến;
  - **quyết định khi làm:**
    - thứ tự: audit `project.adopt` (`target` = digest bản chạy, `detail` = `{reason, versions, seq?}`) ghi trước mọi thay đổi; audit lỗi → kho vẫn hỏng, `NoValidProject`. Sau đó đổi tên, ghi `state.json` mới; ghi lỗi → trả tên cũ, kho vẫn hỏng;
    - cùng `activatedAt` thì lấy `seq` cao hơn; không bản nào có `activatedAt` thì `active = null` (mọi bản vào `versions[]` để khôi phục tay); `versions[]`: bản chạy trước, rồi `seq` giảm dần; `nextSeq` = thư mục `v/` cao nhất + 1 (kể cả thư mục không có `meta.json`);
    - không còn bản hợp lệ: ghi `state.json` rỗng hợp lệ (không để `Missing`, vì khi đó project cũ trong `projectDir` có thể bị nhận lại);
    - chặn nạp xuống (`NO_BASE_PROJECT`) chỉ khi project cũ **hợp lệ mà không nhận được** (đóng gói, chép hoặc audit lỗi): nạp xuống sẽ làm mất nó. Project cũ lỗi hoặc rỗng không chặn (giữ test `AnEmptyStoreTakesBaseNone`): bản nạp xuống là cách sửa. Chặn áp cho cả restore; hết chặn ở lần khởi động nhận được, hoặc ngay khi `state.json` tồn tại.

### Giao thức live 1.1.0, trang xem tự tải lại

- [X] T101 [P] [US2] Test bổ sung `packages/live-client/src/connection.test.ts` và `packages/live-client/src/state.test.ts` (**file chung với 004**; contract live-protocol-1.1 §5):
  - mã đóng 1012 → thử lại mỗi khoảng 1 s, cộng ngẫu nhiên 0–250 ms, tối đa 30 lần, rồi về backoff thường; mã khác giữ backoff;
  - giá trị chuyển `STALE` như mọi lần mất kết nối;
  - `hello.project.digest` đọc được; thiếu thì bỏ qua.

  **Ghi chú khi làm:**
  - 11 test mới (connection 9, state 2); **đỏ** 6/11 trước khi cài (thử nhanh sau 1012: 4; digest: 2). 5 test còn lại chặn hồi quy (STALE, mã khác giữ backoff, `stop()`, không `console.error`, thiếu digest) nên xanh ngay;
  - thêm trường hợp: 1012 mới giữa lúc đang thử nhanh (quay về bản cũ sau kiểm tra sức khỏe lỗi) thì đếm lại 30 lần.
- [X] T102 [US2] Cài `packages/live-client/src/{connection,state}.ts` (giao diện công khai không đổi), đạt T101.

  **Ghi chú khi làm:**
  - xanh 54/54 (43 cũ + 11);
  - `LiveConnection` giữ nguyên option, phương thức, trạng thái. Chỉ thêm hằng `CLOSE_SERVICE_RESTART` (`state.ts`), `RESTART_RETRY_MS`, `RESTART_JITTER_MS`, `RESTART_MAX_RETRIES` (`connection.ts`) và khóa tùy chọn `HelloInfo.project.digest?: string | null`;
  - lượt thử nhanh hết khi: vào `live` (có snapshot), `full` (4429), `stop()`, hoặc đủ 30 lần. Kết nối bị từ chối (1006) trong lúc thiết bị chạy lại vẫn thử nhanh;
  - `digest` chỉ nhận chuỗi hoặc null; thiếu hay sai kiểu thì không có khóa, nên test `hello` 1.0.0 cũ giữ nguyên.
- [X] T103 [P] [US2] Test `apps/runtime-web/src/reload.test.ts` (đồng hồ giả): digest của `hello` khác digest đã nhớ từ `/api/v1/projects/active` (kể cả `null` ↔ có giá trị) → hiện "Đang nạp project mới…" rồi tải lại đúng một lần sau 0–1000 ms; digest giống → không; máy chủ 1.0.0 không có `digest` → so `projectId` + `projectVersion`.

  **Ghi chú khi làm:**
  - 13 test: `ReloadWatcher` 8, `activeStamp`/`helloStamp` 3, nối vào `LiveConnection` thật với socket giả 2 (đóng 1012, chạy lại với project mới; trang không có project);
  - **đỏ** 13/13 với khung rỗng ném lỗi; trước khung là lỗi import.
- [X] T104 [US2] Cài `apps/runtime-web/src/reload.ts`, nối vào `apps/runtime-web/src/main.ts`, đạt T103; `npm test -w @mat/runtime-web` xanh.

  **Ghi chú khi làm:**
  - xanh 29/29 (16 cũ + 13). Build `--mode device` thử vào thư mục tạm chạy được; không đụng `dist/`, `dist-device/`;
  - `reload.ts` có `activeStamp`, `helloStamp`, `projectChanged`, `ReloadWatcher`, `watchProject`. Quy tắc so:
    - một bên không có project, bên kia có → tải lại;
    - hai bên đều có khóa digest và ít nhất một bên là chuỗi → so digest;
    - còn lại (máy chủ 1.0.0, hoặc hai digest null) → so `projectId` + `projectVersion`;
  - nối qua `onSubscribed` có sẵn của `LiveConnection`: máy chủ gửi `hello` ngay khi nhận phiên, trước kết quả đăng ký. Không phải thêm callback vào live-client;
  - **quyết định:** trang mở lúc thiết bị chưa có project hợp lệ (503) nay vẫn giữ một phiên live không đăng ký Tag nào, để tải lại khi có project ("null → có giá trị"). Phiên này chiếm 1 trong 10 slot như trang thường. Live-ws 1.0.0 không bắt buộc `subscribe`, heartbeat giữ phiên;
  - câu báo hiện ở phần tử mới `#app-reload` (`role="status"`) trong `index.html`, kiểu `.reload-note` trong `style.css`. Chuỗi tiếng Việt đặt trong `reload.ts` theo quy ước của runtime-web (như `status.ts`).
- [X] T104a [US2] Trang xem khi thiết bị chưa có project hợp lệ (503) phải không chiếm slot live (Constitution IV, thêm 2026-10-11 khi duyệt T104). Bản T104 giữ một phiên live không đăng ký Tag nào để chờ project, chiếm 1 trong 10 slot. Sửa:
  - hỏi `GET /api/v1/projects/active` mỗi 5 s, cộng ngẫu nhiên 0–1 s; có project thì tải lại trang, đúng một lần;
  - không mở WebSocket khi chưa có project;
  - test với đồng hồ giả viết trước.

  **Ghi chú khi làm:**
  - **Đỏ → xanh:** khung ném lỗi: 6 hỏng / 30 qua → 36/36 (29 cũ + 7 mới);
    - `reload.test.ts` +6 test `ProjectPoller`;
    - `main.test.ts` mới: chạy `main.ts` thật trên DOM của `index.html`, `fetch`/`WebSocket`/`location`/đồng hồ giả. Đã xác nhận riêng: bản T104 mở `ws://…/api/v1/live` khi 503.
  - `ProjectPoller` (`reload.ts`):
    - lượt đầu sau 5 s + 0–1 s; mỗi lần một lượt; lượt treo quá 5 s thì abort (hạn chót không phụ thuộc lớp mạng);
    - có project (200 và `activeStamp` khác null) thì hiện "Đang nạp project mới…" và tải lại đúng một lần; lỗi mạng, mã khác, thân lạ thì hỏi tiếp; `stop()`.
  - `main.ts` khi 503: không tạo `LiveConnection`; nhãn "Chờ project", câu "Trang tự tải lại khi thiết bị có project hợp lệ." ở `#app-reload`.
  - test T104 "trang không có project" của `watchProject` đổi tên, chỉ còn kiểm hàm.
- [X] T105 [P] [US2] Test bổ sung `server/websocket/tests/live_hub_test.cpp` (`hello.protocolVersion = "1.1.0"`, `hello.project.digest`) và `server/websocket/tests/civet_transport_test.cpp` (đóng mọi phiên bằng 1012, chờ tối đa 1 s cho close frame, trả số phiên đã báo).

  **Ghi chú khi làm** (làm cùng T041–T044, vì cùng sửa `civet_transport` cho hai context):
  - `live_hub_test`: `HelloOnOpen` đổi sang 1.1.0, kiểm `project.digest` và đủ 7 khóa; thêm `HelloProjectNullAndUpdated` (`project` vẫn `null` khi không có project; `digest: null` đi qua nguyên vẹn);
  - `civet_transport_test`: `CloseAllForRestartSends1012AndCounts` (3 phiên, một phiên đang đăng ký Tag: cả 3 nhận 1012, trả 3, xong < 1 s; phiên mở sau đó nhận 1012 ngay; gọi lại trả 0) và `CloseAllForRestartWaitsAtMostOneSecond` (luồng ghi của client ngừng đọc bị kẹt trong lần ghi 8 MiB: trả về sau 0,95–1,5 s, không tính phiên đó; phiên kia vẫn nhận 1012);
  - digest của project: `StartupDigest` 4 test trong `server/tests/startup_test.cpp` (digest của thư mục khớp `digest` của mọi vector hợp lệ; file không đọc được; digest vào hello, `projects/active`, `system/info`; không có project thì `null`);
  - **đỏ:** live hub 2/2 hỏng (1.0.0), transport 2/2 hỏng (bản tạm trả 0), `StartupDigest` 4/4 hỏng; mọi lỗi ở mức assertion.
- [X] T106 [US2] Cài `kLiveProtocolVersion` 1.1.0 và digest trong `server/websocket/live_hub.{hpp,cpp}`, đóng 1012 trong `server/websocket/civet_transport.{hpp,cpp}`, đạt T105.

  **Ghi chú khi làm:**
  - **xanh:** live hub 17/17, transport 8/8, `startup_test` 10/10;
  - `CivetLiveTransport::closeAllForRestart(waitMs = 1000)`: yêu cầu đóng 1012 `SERVICE_RESTART` sau phần hàng đợi đã có; từ lúc gọi, phiên mới bị từ chối bằng 1012; chờ các luồng ghi kết thúc, tối đa `waitMs`; trả số close frame 1012 đã ghi được (`clientsNotified`). Phiên đã đóng trước đó, hoặc đang đóng bằng mã khác (4408, 4409), không được tính. US2 gọi hàm này trước `execv`;
  - digest: `core/package/project_digest.{hpp,cpp}` (`projectDirDigest`: băm từng file của `LoadedProject::files()` theo khối 64 KiB, rồi `packageDigest`), tính trong `main` lúc nạp project, truyền vào `activateProject(…, digest)`. `helloJson` và `activeJson` thêm khóa `digest` (chèn vào cuối object, không parse lại); `info.digest` là `null` khi không có project chạy. Project hợp lệ mà không đọc được digest vẫn chạy, với `"digest": null` ở cả ba chỗ, để client không tưởng máy chủ là 1.0.0;
  - client 1.0.0 vẫn chạy: `isCompatibleProtocol` chỉ so MAJOR. Trang xem (bản build hiện tại) trên Chrome qua `tools/measure/runtime-smoke.mjs` với runtime x64: đạt ("Trực tuyến", giá trị đổi). `npm test -w @mat/live-client` 54/54;
  - `schemas/protocol-version.json`: `live` sửa thành `1.1.0` (phiên chính nhắc). `meta-schema.test.ts` so file này với hằng C++. `@mat/project-schema` 186/186.

### Nối vào runtime và API

- [X] T107 [P] [US2] Test `server/tests/health_check_test.cpp` và `server/tests/project_cli_test.cpp`:
  - kiểm sức khỏe là hàm thuần với các phép dò tiêm được (R13 bước 6): project hợp lệ và đang hoạt động; hai context đã mở; tự gọi `GET http://127.0.0.1:<port>/api/v1/system/info` thấy digest mới; vòng tick chạy 2 s không lỗi;
  - hạn 15 s tính từ lúc đọc `state.json` → `HEALTH_TIMEOUT`; context HTTPS không mở → `HEALTH_HTTPS`; project không kích hoạt → `HEALTH_PROJECT`;
  - `--project-status` in bản đang chạy, các bản dự phòng, thao tác dở dang (đọc `state.json`, không ghi gì); `--check-project --project-store <dir>` kiểm project đang chạy trong kho, mã thoát 0 hoặc 1 (contract device-config §4).

  **Ghi chú khi làm (agent f1, 2026-10-12):**
  - **đỏ → xanh:** khung biên dịch được trả sai (`runHealthCheck` trả kết quả rỗng, `fetchSystemInfoDigest` trả `nullopt`, `runProjectCli` trả 99): 32 hỏng / 40, đều ở mức assertion, không crash (8 test bất biến như "không dò thì không có gì" đạt ngay). Sau khi cài: 40/40 (`HealthCheck`, `FetchSystemInfoDigest` trong `health_check_test`; `ProjectCommand`, `ProjectStatus`, `CheckProjectInStore` trong `project_cli_test`);
  - `core/project-store/health_check.{hpp,cpp}`: `runHealthCheck(probes, expectedDigest, deadlineMonoMs, clock)` với đồng hồ giả. Thứ tự: project (`HEALTH_PROJECT`), vòng tick báo lỗi (`HEALTH_PROJECT`), HTTPS (`HEALTH_HTTPS`), rồi chờ digest của `system/info` khớp và vòng tick chạy đủ 2 s (`kHealthTickWindowMs`, ít nhất 2 vòng); quá hạn tuyệt đối → `HEALTH_TIMEOUT`. Hai lỗi đầu báo ngay, không chờ. `fetchSystemInfoDigest(port, timeoutMs)` là máy khách HTTP tối thiểu (socket không chặn, `Connection: close`, hiểu Content-Length, chunked, đóng kết nối), thử trên socket thật;
  - **lệch:** lỗi trong vòng tick (`tickFailed`) có trong API và test, nhưng `main` truyền `false`: một ngoại lệ trong vòng tick vẫn làm tiến trình chết như 0.3.0 (rồi `bootAttempts` đếm), không nuốt lỗi;
  - `server/cli/project.{hpp,cpp}` (đưa vào `mat_cli`): `--project-status` nhận `--config`, `--data-dir`, `--project-store-dir`, in tiếng Việt (bản chạy, dự phòng kèm "[thiếu file]" khi không có `meta.json`, thao tác dở dang), lọc ký tự điều khiển; `--check-project --project-store <dir> [--schemas-dir <dir>]` in JSON của bộ kiểm tra. Cả hai chỉ đọc (test so ảnh chụp thư mục trước/sau, kể cả không tạo thư mục kho). Mã thoát: kho không có `state.json`, `state.json` hỏng hoặc thiếu schema → 6 (`--project-status` với kho chưa có `state.json` thì in báo và thoát 0); kho không có project đang chạy → hợp lệ (0). Đã ghi vào contract device-config §4.
- [X] T108 [US2] Nối kho và chuỗi nạp xuống vào runtime, đạt T107 (`core/project-store/health_check.{hpp,cpp}`, `server/main.cpp`; contract device-config §7 bước 3, 4, 9; R13):
  - **khởi động:** đọc `state.json`, quyết định bản chạy, lần đầu nhận project cũ vào kho; luồng đếm 15 s bắt đầu ngay sau khi đọc `state.json`, nên tiến trình treo cũng bị quay về; đạt thì `active = to`, xóa `pending`, ghi audit, dọn bản cũ;
  - **kích hoạt:** ghi `pending`; đóng phiên live bằng 1012; commit đệm của historian (không chờ luồng gửi DB ngoài); dừng CivetWeb; ghi `auth-state.json`; `execv` chính binary theo đường dẫn tuyệt đối lưu lúc khởi động (không dùng `/proc/self/exe`, để chạy được dưới qemu-user);
  - `system/info.operation`; lệnh `--project-status` (chạy bằng `runuser -u matscada --`) và `--check-project --project-store <dir> [--schemas-dir <dir>]`;
  - đổi project giữ `history.db` (FR-026);
  - cờ test (giết ở bước chọn; `health` chết hoặc treo) chỉ có khi build với `-DMAT_TEST_HOOKS=ON` (bản x64 cho `device-it`), không có trong bản armhf.

  **Ghi chú khi làm (agent f1, 2026-10-12):**
  - **xác minh:** không có test đơn vị cho `main.cpp`; kiểm bằng chạy thật trong container (kịch bản tạm ngoài repo), runtime x64 và armhf:
    - x64: nhận `tank-demo` thành `v/1` (`runtime-package`); đọc lên gói qua HTTPS (digest khớp `--check-package`); nạp xuống lại đúng gói đó → `execv` → kiểm sức khỏe → `committed`: **5,1 s** từ POST tới `committed` (SC-006 ≤ 15 s); PID giữ nguyên; phiên đăng nhập sống qua `execv`; `--project-status` không còn `pending`; `restore` bản 1 → `committed`; `history.db` tiếp tục tăng dòng qua lần đổi project (FR-026: 8 → 15 dòng);
    - **armhf dưới qemu-user:** cùng kịch bản xanh (5,2 s). Cần binfmt: máy này **chưa có** binfmt `qemu-arm` (`Exec format error`, khác điều T112 giả định); tôi đăng ký tạm trong VM Docker (`docker run --privileged` ghi `/proc/sys/fs/binfmt_misc/register`, interpreter `/usr/bin/qemu-arm`, không cờ `F`) và chạy với `QEMU_LD_PREFIX=/usr/arm-linux-gnueabihf`; đã gỡ khi xong;
    - hỏng có chủ ý (build `-DMAT_TEST_HOOKS=ON`, runtime dưới một vòng giám sát như systemd `Restart=always`): `--test-kill-at verify-package|backup|activate` → bản ghi `interrupted` (`INTERRUPTED`), `active` vẫn 1, `staging/` rỗng, không còn `v/2`; `--test-health die` → chết 2 lần → `rolled-back` (`HEALTH_CRASH`) sau 6,8 s, chạy lại bản 1; `--test-health hang` → `rolled-back` (`HEALTH_TIMEOUT`) sau 21,7 s (15 s hạn + chạy lại);
    - tải 50 MiB (gói rác, thất bại ở `verify-package`): nhận xong trong 1,7 s, RSS đỉnh 27,6 MB (nền 8,8 MB), CPU 0,56 s; sau lần nạp xuống thành công RSS 9,1 MB;
  - `server/main.cpp`:
    - thứ tự theo device-config §7: cấu hình, `psa`, audit, **kho** (`startStore`), kiểm project của bản được chọn, `auth-state`, chứng chỉ, historian, HTTP rồi HTTPS, tìm thiết bị, **kiểm sức khỏe**. `--check-project` không kèm `--project-store` giữ nguyên (kiểm `projectDir`);
    - `startStore` nhận project cũ; `StoreStartup.opened` (thêm, có test) báo kho không mở được (đĩa chỉ đọc…): khi đó runtime chạy `projectDir` như 0.3.0, các route project trả 501 và `features` không có deploy/upload/restore;
    - luồng canh (watchdog) tạo ngay sau `startStore`: mỗi 0,5 s gọi `pipeline.poll()` (hạn 15 s tính từ lúc đọc `state.json`, hạn nhận 10 phút), nên tiến trình treo lúc khởi động cũng bị quay về;
    - luồng kiểm sức khỏe chạy sau khi HTTP/HTTPS/tìm thiết bị đã dựng, chỉ khi `healthDeadlineMs()` có giá trị; digest kỳ vọng là digest trong `meta.json` của bản chạy, so với `project.digest` mà `system/info` của chính nó báo (cũng là kiểm toàn vẹn thư mục giải nén). `httpsPort = 0` thì không đòi HTTPS;
    - `restart` (chạy trên luồng của chuỗi nạp xuống hoặc luồng canh): `alarm(20)` làm chốt chặn (dừng treo thì tiến trình chết, systemd chạy lại, `bootAttempts` đếm), `historian->stop()` (commit đệm; vẫn dừng các luồng gửi DB ngoài, bị chặn bởi timeout của client như hiện nay, **chưa** bỏ qua chúng như R13 mô tả), dừng tìm thiết bị (cổng UDP), dừng CivetWeb, `saveState` (`mkdir /run/mat-runtime` nếu thiếu), đóng audit, `alarm(0)`, `execv` theo đường dẫn tuyệt đối lấy từ `argv[0]` lúc khởi động (`realpath`, tìm trong PATH khi không có `/`), cùng `argv`. `execv` lỗi: mở lại audit (để ghi `EXEC_FAILED`), thoát mã 4 cho systemd chạy lại;
    - `system/info.operation` = `{kind, step, since}` của thao tác đang chạy (`operationInfoJson`), `null` khi không có;
    - `server/project_glue.{hpp,cpp}` (dùng chung với test route): bước `verify-package` (`extractPackage`), `validate`, `storedPackFn` (`writeStoredPackage`), `legacyProjectOf`;
  - **cờ test:** `option(MAT_TEST_HOOKS)` (OFF), chỉ `config.cpp`, `main.cpp`, `config_test.cpp` thấy định nghĩa. `--test-kill-at <bước>` (SIGKILL trước bước đó) và `--test-health die|hang` (chỉ áp cho bản đang thử, không áp cho rollback; cờ đi theo `argv` qua `execv`). Bản thường và armhf từ chối như tham số lạ (test `ConfigTestHooks`). Đã ghi vào contract device-config §1;
  - **vấn đề mở:** bản ghi `ops/<opId>.json` chỉ ghi lúc bắt đầu và trước `execv`, nên thao tác bị giết ở giữa `verify-package`…`activate` hiện `interrupted` ở bước `receive` (mã `INTERRUPTED` đúng, bước hiển thị chưa đúng); sửa cần ghi bản ghi mỗi bước (thêm 2 `fsync` mỗi bước, đổi test `SyncsOfACommittedDeploy`).
- [X] T109 [P] [US2] Test `server/tests/project_api_test.cpp` (CivetWeb trong tiến trình, HTTPS; device-api §4, §5, §8):
  - viewer → 403 `FORBIDDEN`; chưa đăng nhập → 401; gọi qua HTTP → 403 `HTTPS_REQUIRED`; mỗi lần từ chối đều có audit;
  - `GET /project/versions`: `active`, `backupsMax`, `versions[]` có `state` và `restorable`;
  - `GET /project/manifest?seq=`: đúng `matscada.json` đã lưu; 404 `NO_PROJECT_PACKAGE` kèm lý do;
  - `GET /project/package?seq=`: đúng byte của `v/<seq>/package.matscada`; header `Content-Type: application/zip`, `Content-Length`, `Content-Disposition: attachment; filename="<projectId>-<projectVersion>.matscada"`, `X-Mat-Digest`, `ETag`; audit `project.read` (`target` = digest);
  - `POST /project/deployments`: 415 `UNSUPPORTED_MEDIA_TYPE`; 411 `LENGTH_REQUIRED`; > 52.428.800 → 413 `PACKAGE_TOO_LARGE`; chunked bị từ chối; kiểm trước khi đọc thân: 409 `DEVICE_BUSY`, 507 `NO_SPACE`, 503 `AUDIT_UNAVAILABLE`, 409 `BASE_CHANGED`; nhận đủ thân → 202 `{ opId, status }`; đóng kết nối giữa chừng → `RECEIVE_ABORTED`, vùng tạm dọn, khóa nhả;
  - `GET /project/deployments/{opId}` (404 `NO_SUCH_OPERATION`), `GET /project/operation`; `POST /project/restore` `{ seq, baseDigest }` (404 `NO_SUCH_VERSION`, 409 `ALREADY_ACTIVE`);
  - làm mới hạn phiên đúng §1.3: hỏi tiến trình không làm mới.

  **Ghi chú khi làm (agent f1, 2026-10-12):**
  - **đỏ → xanh:** thêm `setProject` vào `EngineeringApi` rồi để route trả 501: 28 hỏng / 33 (5 test bất biến đạt: tin nhắn của cổng, 501 khi không có kho, `features`, thân bị cắt ngắn, hạn phiên của cổng), đều ở mức assertion, không crash. Sau khi cài: 32/32 (`ProjectApi`; `GateMessage` thêm 1 trong `auth_gate_test`). Mỗi test dựng lại hai listener nên ~4 s: cả file ~2 phút;
  - kho và chuỗi nạp xuống thật; bước `verify-package`/`validate` thật (gói `valid-device-tank-demo`); chỉ `restart` là hàm giả (ghi lại, trả `Replaced` hoặc `Failed`). Ba kiểu kho: rỗng, đã nhận project cũ (`valid-minimal`), có sẵn v/7 chạy + v/6 dự phòng + v/5 chỉ có trong `state.json` (`restorable: false`);
  - 413, 411 không Content-Length, 411 chunked, thân cắt giữa chừng, đóng kết nối: gửi byte thô qua TLS (`curl` `CONNECT_ONLY`), vì libcurl không tạo được; chỉ gửi phần đầu của yêu cầu 50 MiB mà vẫn nhận 413 ngay;
  - audit: các lần từ chối vượt 10 hàng/phút (R11) nằm trong `audit.suppressed`; test cộng cả hai;
  - **quyết định:** `restorable` chỉ có ở bản dự phòng (như ví dụ contract); `seq` sai dạng → 400 `BAD_REQUEST`; `seq` thiếu `meta.json` → 404 `NO_SUCH_VERSION`; kho rỗng → `NO_PROJECT_PACKAGE` kèm lý do; thiếu hoặc sai `X-Mat-Digest`/`X-Mat-Base-Digest` → 400. Đã ghi vào contract device-api §4.
- [X] T110 [US2] Cài các route project trong `server/http/engineering_api.{hpp,cpp}` (qua `auth_gate`, role engineer), đạt T109.


  **Ghi chú khi làm (agent f1, 2026-10-12):**
  - `EngineeringApi::setProject({store, pipeline})` bật các route (không gọi thì vẫn 501 như US1) và thêm `deploy`, `upload`, `restore` vào `features`. Code ở `server/http/engineering_api_project.cpp`; hàm gửi dùng chung chuyển sang `engineering_api_internal.hpp`; `gateMessage` thêm 13 mã;
  - `POST /project/deployments` đi nhánh riêng **trước** nhánh thân JSON 16 KiB: Content-Type `application/zip` (415), chunked hoặc thiếu Content-Length (411), > `kPackageMaxBytes` (413), hai header digest (400), rồi `pipeline.begin` (409/507/503…); mọi từ chối trước khi đọc thân đóng kết nối. Thân đọc từng khối 64 KiB thẳng vào `staging/<opId>/package.matscada`; mạng rớt → `receiveEnd(false)` (`RECEIVE_ABORTED`); trả 202 rồi `run(opId)` trên một luồng nền (một luồng một lúc, `EngineeringApi` nối khi hủy);
  - `GET /project/package`: ghi audit `project.read` **trước** khi gửi byte đầu; không ghi được thì 503 và không gửi byte nào (lệch nhỏ so với contract chỉ nói "audit": Constitution V); tên file lấy từ `projectId`/`projectVersion`, thay ký tự ngoài `[A-Za-z0-9._-]` bằng `_`;
  - `GET /project/manifest`: đúng byte của entry đầu (`matscada.json`) trong gói đã lưu;
  - `GET /project/operation` trả `null` (thân `null`) khi chưa có thao tác nào.
### Script triển khai, gói runtime, kiểm armhf

- [ ] T111 [US2] `deployment/device/deploy.sh` phần kho project (contract device-config §5, FR-019):
  - kho đã có (`/var/lib/mat-runtime/projects/state.json`): validate **project đang chạy trong kho** bằng binary mới (`runuser -u matscada -- "$NEW/bin/mat-runtime" --check-project --project-store /var/lib/mat-runtime/projects --schemas-dir "$NEW/schemas"`). Lỗi thì dừng, giữ runtime cũ, in "runtime mới không chạy được project đang chạy: nạp project tương thích trước";
  - chưa có kho: kiểm project đi kèm gói như hiện nay; không đụng `/var/lib/mat-runtime`;
  - bổ sung `deployment/device/tests/deploy_rollback_test.sh`: có kho, gói runtime mang project khác → project đang chạy vẫn là bản trong kho; binary mới từ chối project trong kho → giữ runtime cũ.
- [ ] T112 [US2] Mở rộng `deployment/toolchain/smoke-armhf.sh`: runtime armhf nhận `tank-demo` vào kho (`v/1`); đọc lên gói qua HTTPS; nạp xuống lại chính gói đó (`X-Mat-Base-Digest` = digest hiện tại) → `execv` → kiểm tra sức khỏe → `committed`; `--project-status` không còn `pending`. `execv` dưới qemu-user cần binfmt của máy chủ Docker. Docker Desktop đã đăng ký sẵn. Trên GitHub CI, cài `qemu-user-static` bằng apt của Ubuntu trên runner: gói này đăng ký binfmt cờ `F`, container dùng được. Không dùng action ngoài; chốt 2026-10-11, analyze C5.
- [ ] T113 [P] [US2] `deployment/package-runtime.ps1`: phiên bản 0.4.0; README triển khai nói về fingerprint, tài khoản quản trị, kho project; gói vẫn kèm project, để thiết bị mới hoặc lần đầu chạy 0.4.0 nhận vào kho.

### Studio: gói, gửi, theo dõi (Rust)

- [ ] T114 [P] [US2] Test Rust `apps/studio/src-tauri/src/package/{zip,manifest}.rs` (cùng bộ vector với C++; contract §2–7):
  - mọi vector của `tests/package-vectors/` cho cùng mã lỗi như C++;
  - ghi deflate mức 6, stored khi bản nén không nhỏ hơn; tất định: hai lần ghi cùng byte; `generator` = `mAT Studio <phiên bản>`;
  - `package_build({ files: [{ rel, hash }] })` đọc lại file, so hash với lần đọc của giao diện → `{ changed: rel }`; bí mật → `{ package: "E_PKG_SECRET" }`; file quá giới hạn → `{ too-large: rel }`; `no-project`, `bad-path`, `{ io }`;
  - test đột biến 10.000 biến thể như T092.
- [ ] T115 [US2] Cài `apps/studio/src-tauri/src/package/{mod,zip,manifest}.rs` (`flate2`; gói tạm trong thư mục cache của ứng dụng; giao diện chỉ thấy `packageId`; tối đa 4 gói; xóa khi đóng Studio), đạt T114. Thêm vector golden `tests/package-vectors/valid-studio-tank-demo/` (gói do bộ ghi Rust đóng) và test so lại byte; test C++ T088 đọc được vector này.
- [ ] T116 [P] [US2] Test Rust `apps/studio/src-tauri/src/device/deploy.rs` (máy chủ HTTPS thử; tauri-commands §8):
  - `device_deploy` gửi `POST /api/v1/project/deployments` với `Content-Type`, `Content-Length`, `X-Mat-Digest`, `X-Mat-Base-Digest`; sự kiện `send { sent, total }`, `operation { op }` mỗi khi trạng thái đổi, `restarting`; hỏi tiến trình mỗi 500 ms; lúc thiết bị chạy lại thì thử lại tối đa 60 s, quá thì `lost`;
  - ánh xạ lỗi `{ busy: { opId, kind, user, source, since } }`, `base-changed`, `no-space`, `too-large`, `audit-unavailable`, `session-expired`, `forbidden`, `{ cert-mismatch }`, `unreachable`;
  - `device_restore`: thêm lỗi `no-such-version`, `already-active`;
  - `device_fetch_package`: kiểm gói đúng luật như thiết bị; digest phải bằng `X-Mat-Digest` (khác → `{ package: "E_PKG_DIGEST" }`); lỗi `no-project-package`, `forbidden`, `session-expired`, `unreachable`;
  - `package_read`: cùng định dạng và mã lỗi với `project_read` của 004 (`missing`, `bad-path`, `too-large`, `bad-utf8`); `package_discard`.
- [ ] T117 [US2] Cài `apps/studio/src-tauri/src/device/deploy.rs` và các lệnh `package_build`, `device_deploy`, `device_restore`, `device_fetch_package`, `package_read`, `package_discard`, đạt T116. Đăng ký trong `invoke_handler` của `lib.rs` (**sau 004 Phase 4–6**).

### Studio: so sánh dùng chung và luồng Nạp xuống (TS)

- [X] T118 [P] [US2] Test `packages/project-schema/src/compare.test.ts` (R15, data-model §11):
  - theo file trước: cùng SHA-256 `=`, khác `≠`, chỉ trên máy `+`, chỉ trên thiết bị `-`; hai digest bằng nhau thì mọi thứ `=`, không so tiếp;
  - theo đối tượng, chỉ cho file `≠`, `+`, `-`: `project` (từng trường, trừ danh sách `screens`), `tag` (khóa `id`), `logging-group` và `logging-connection` (khóa `id`; Tag của nhóm theo `tagId`), `screen` (trường của `*.screen.json`), `svg` (theo SHA-256, không so sâu), `binding` (khóa `elementUid` rồi `binding.id`, từng thuộc tính);
  - `fields[]` chỉ có khi `≠` (JSON pointer, `local`, `device`); đối tượng `=` vẫn có trong danh sách;
  - trường hợp của quickstart §5 bước 12: thêm một Tag, đổi một deadband, đổi một binding.

  **Ghi chú khi làm:**
  - 22 test: `compareFiles` 3; `compareProjects` 17, gồm kịch bản quickstart §5 bước 12 trên `projects/tank-demo`; tóm tắt 2. Nguồn đọc có ghi lại đường dẫn: kiểm digest bằng nhau thì không lấy manifest hay gói, chỉ khác SVG thì không tải gói, chỉ đọc của thiết bị file JSON `≠`/`-`;
  - **đỏ** 20/21 với khung ném lỗi (test "đường dẫn trùng" xanh giả vì khung cũng ném). Test thứ 22 (thiết bị chưa có project) thêm khi làm T121 phát hiện lỗi; chạy đỏ trước khi sửa.
- [X] T119 [US2] Cài `packages/project-schema/src/compare.ts` (hàm thuần; dùng `ProjectSource` và bộ nạp chung), thêm export trong `src/index.ts` (file chung với 004), đạt T118.

  **Ghi chú khi làm:**
  - xanh 22/22; `npm test -w @mat/project-schema` 185/185. `src/index.ts` chỉ thêm một dòng export;
  - API: `compareFiles(local, device)`, `deviceReads(files)`, `compareProjects(local: LocalSide, device: DeviceSide)`, `summarizeCompare(result)`, `loggingImpact(result)`. `DeviceSide` lười: `files()` (manifest) chỉ gọi khi hai digest khác; `source()` (gói đọc lên) chỉ khi `deviceReads` khác rỗng. File `=` của thiết bị đọc bản trên máy. "Bộ nạp chung" là `ProjectSource` + `stripBom` + `isSafeRelPath`; `validateProject` không dùng được vì chỉ trả project khi không còn lỗi;
  - **chốt ngoài data-model §11:**
    - thêm kind `logging-settings` (khóa `logging`): phần chung của file lưu trữ (`timeZone`…), để đổi múi giờ không bị ẩn;
    - khóa: `project` cho thiết lập project; SVG theo đường dẫn file; binding `<màn hình>/<elementUid>/<binding.id>`;
    - `fields[].path` là JSON pointer tính từ đối tượng. Trong tập có khóa (Tag của nhóm theo `tagId`, phần tử màn hình theo `elementUid`), phần tử chỉ bằng khóa thay vì chỉ số, ví dụ `/tags/TANK01.LEVEL/deadband`. Mảng giá trị đơn (`viewBox`) là một trường. SVG `≠` có `/sha256`, và `/size` nếu khác;
    - so theo khóa nên chỉ đổi thứ tự thì đối tượng `=` dù file `≠`;
    - `FileDiff.unreadable: 'local' | 'device'`: file có mà không đọc được hoặc không đúng dạng. Cả họ đối tượng của nó (Tag; lưu trữ; một màn hình; binding của một màn hình; cả project nếu là `project.json`) bị bỏ ở hai bên, để không báo `+`/`-` sai;
    - bên không có `project.json` (thiết bị chưa có project): mọi đối tượng của bên kia là `+`/`-`;
    - `ObjectDiff.file` là file trên máy; đối tượng chỉ có trên thiết bị thì là file của thiết bị. Thứ tự `objects` theo `OBJECT_KINDS`, trong một kind theo thứ tự trên máy rồi tới đối tượng chỉ có trên thiết bị;
  - **ngoài phạm vi, phải sửa:** `src/meta-schema.test.ts` chờ đúng 5 schema, đỏ khi T087 thêm `schemas/package-manifest.schema.json`. Đổi thành 6; schema mới qua kiểm draft-07. Chỉ agent TS sửa `packages/**`.
- [X] T120 [P] [US2] Test `apps/studio/src/model/download-flow.test.ts` (data-model §13, FR-020):
  - `closed → preparing → preview → running → result`; còn thay đổi chưa lưu → hỏi "Lưu rồi nạp xuống" hoặc Hủy;
  - gói luôn đóng từ file trên đĩa, sau khi so SHA-256 với lần đọc của 004; lệch thì kiểm lại;
  - các dòng xem trước và điều kiện khóa: Kiểm tra project (có lỗi → khóa); Tương thích runtime (`minRuntimeVersion` > `system/info.runtimeVersion` → khóa); Thay project đang chạy (phiên bản cũ → mới, tóm tắt `CompareResult`; mở So sánh khi có US3); Client sẽ tải lại (`system/info.clients` trừ phiên của Studio); Dung lượng (gói > 50 MiB hoặc thiết bị thiếu chỗ → khóa); Lưu trữ dữ liệu (`ObjectDiff` kind `logging-*`: nhóm thêm, bớt, đổi; cột mới); Thiết bị (phiên còn hạn, role ≥ engineer, thiết bị không bận);
  - có cảnh báo thì phải đánh dấu "đã đọc cảnh báo";
  - `running` theo `DeployEvent`; `result` (`committed | failed | rolled-back`) có thời gian, phiên bản đang chạy, số client đã báo; từ `result` chạy Khôi phục bản trước (`kind = restore`); `BASE_CHANGED` → về bước xem trước.

  **Ghi chú khi làm:**
  - 30 test trên project giả và `DownloadDevice` giả: Rust giả đọc lại "đĩa" và so hash như `package_build`; thiết bị giả trả `system/info`, manifest, gói đọc lên, kịch bản nạp xuống. Không gọi lệnh Tauri nào;
  - thêm ngoài danh sách: `DEVICE_BUSY`, phiên hết hạn, thiếu quyền khi gửi; lỗi trước khi thiết bị nhận gói; `lost`; Esc khi đang chạy; đóng giữa lúc chuẩn bị; khôi phục bản chọn từ danh sách;
  - **đỏ** 30/30 với khung ném lỗi.
- [X] T121 [US2] Cài `apps/studio/src/model/download-flow.ts`, đạt T120.

  **Ghi chú khi làm:**
  - xanh 30/30; `npm test -w @mat/studio` 698/698 (668 cũ + 30);
  - API: `new DownloadFlow({ project: DownloadProject, device: DownloadDevice, now? })`; `state`, `step`, `preview`, `running`, `result`, `canClose`; `open()`, `saveAndContinue()`, `acknowledge(on)`, `refresh()`, `deploy()`, `restore(seq?, baseDigest?)`, `close()`, `subscribe(fn)`;
  - kiểu dây (`PackageManifest`, `PackageInfo`, `DeployOperation`, `DeployStep`, `DeployEvent`) tạm đặt trong `download-flow.ts`, vì `DeviceLink` chưa có phương thức US2 (sau Mốc bảo mật). T117/T123 nên chuyển chúng sang `platform/device-types.ts` rồi import lại;
  - **chốt:**
    - `preview.rows.{check, runtime, replace, clients, size, logging, device}`, trạng thái `ok | notice | warn | error | unknown`. Chỉ cảnh báo của bộ kiểm tra phải đánh dấu "đã đọc" (FR-020). `blockers` là mã lý do khóa;
    - lưu không được (hủy khi xung đột, lỗi ghi; 004 đã báo) → đóng hộp thoại;
    - `package_build` báo `changed` → `reload()` (F7), kiểm và đóng gói lại, tối đa 3 lần, rồi khóa với lỗi gói;
    - so sánh bằng `compareProjects`: manifest, gói đọc lên chỉ lấy khi cần; digest của manifest và gói phải bằng digest của `system/info` (khác → `changed`); gói đọc lên bỏ ngay sau khi so. Thiết bị chưa có project → mọi thứ `+`, base `none`. Không so được → `compareError`, không khóa;
    - Dung lượng: cần ít nhất gói + tổng file giải nén. Thiết bị còn giữ `historianMinFreeMB` mà Studio không biết, nên kiểm cuối là 507 của thiết bị. Chỗ trống lấy từ diagnostics; không biết thì không khóa;
    - Thiết bị: `system/info` lỗi → `unreachable`; không có phiên → `session`; role dưới engineer → `role`; `system/info.operation` khác null → `busy`;
    - sau khi bấm Nạp xuống: `base-changed`, `busy`, `session-expired`, `forbidden` → đóng gói và so lại, về bước xem trước, bỏ đánh dấu cảnh báo, kèm `notice` (với `busy`: ai, từ đâu, từ lúc nào, bước). Lỗi khác trước khi thao tác bắt đầu → `outcome = 'error'`. `lost` → hỏi `operation()`, cùng `opId` và đã xong thì lấy kết quả đó, không thì `outcome = 'lost'`;
    - `result.running`: bản mới khi committed, bản cũ khi failed, rolled-back, interrupted. `previousSeq = from.seq` khi committed (Khôi phục bản trước). Thời gian đo bằng đồng hồ của Studio;
    - `restore(seq, base)` chạy được từ `closed` (danh sách bản lưu của T123) và từ `result`; lỗi khi khôi phục không quay về bước xem trước;
  - **phát hiện khi cài:** `compare.ts` coi bên không có `project.json` là hỏng nên bỏ mọi đối tượng. Đã thêm test vào T118 (đỏ) rồi sửa T119.
- [ ] T122 [P] [US2] Test component `apps/studio/src/ui/dialogs/download-dialog.test.ts` và `apps/studio/src/ui/dialogs/restore-dialog.test.ts`:
  - xem trước đủ các dòng; nút Nạp xuống khóa kèm lý do và lối mở danh sách lỗi; ô "đã đọc cảnh báo";
  - tiến trình 6 bước (thêm `rollback` khi cần) với trạng thái từng bước; kết quả và lý do lỗi ("đã quay về bản X");
  - `DEVICE_BUSY` hiện ai, từ đâu, từ lúc nào;
  - danh sách bản lưu có phiên bản, digest, thời điểm, người nạp;
  - Esc không đóng hộp thoại khi đang chạy.
- [ ] T123 [US2] Cài `apps/studio/src/ui/dialogs/{download-dialog,restore-dialog}.ts`, đạt T122. `apps/studio/src/platform/mock-device.ts` thêm nạp xuống theo từng bước, cờ gây lỗi ở bước bất kỳ, gây rollback, gây `DEVICE_BUSY` (tauri-commands §10).
- [ ] T124 [US2] Nối US2 vào giao diện của 004 (**sau 004 Phase 4–6**):
  - `apps/studio/src/app/commands.ts`: `online.download` bỏ lý do "Có ở feature 005", giữ lý do "Project còn lỗi" (FR-023 của 004); thêm `online.restore` (cả vào `specs/004-studio-shell/contracts/commands.md`);
  - `apps/studio/src/ui/mat-taskcards.ts`: nút ghi xuống thiết bị trong task card Công cụ online hết khóa;
  - bỏ ô "Lưu kèm nguồn project" khỏi mockup `docs/architecture/mockups/studio-shell.html` (R12).
- [ ] T125 [US2] E2E `apps/studio/tests/e2e/download.e2e.mjs` (lớp giả): project còn lỗi → nút khóa; có cảnh báo → phải đánh dấu; nạp xuống → 6 bước và kết quả; cờ gây lỗi ở từng bước → đúng lý do; rollback; `DEVICE_BUSY`; khôi phục bản trước; axe 0 vi phạm critical/serious.

### Kiểm US2

- [ ] T126 [US2] `tools/device-it.ps1` thêm kịch bản (quickstart §3; build x64 với `MAT_TEST_HOOKS` ở `build/x64-it`) và `tools/measure/device-api.mjs` thêm `deploy`, `fetch`, `restore`:
  - `deploy`: 3 project khác nhau trong `tests/device-it/projects/` (ví dụ `tank-demo`, `bench-500` của 003, một project có tên file tiếng Việt); mỗi project nạp xuống rồi đọc lên 10 lần: digest giống hệt 30/30 (SC-002); một project đổi nhóm, cột lưu trữ: `history.db` giữ, cột mới được thêm (FR-026);
  - `packages`: 100 % vector độc bị từ chối đúng mã; `state.json` và bản đang chạy không đổi; mỗi lần có audit `project.deploy failed` (SC-003);
  - `kill -Rounds 24`: `kill -9` ngẫu nhiên trong 6 bước × 4 lần; lần khởi động sau luôn chạy bản cũ hoặc bản mới hoàn chỉnh; `--project-status` hết `pending` sau ≤ 20 s (SC-004 phần x64, FR-023);
  - `health`: cờ test làm runtime chết khi khởi động → sau 2 lần tự quay về, kết quả `rolled-back` (US2-5);
  - `busy`: hai lần nạp xuống cùng lúc → lần hai 409 `DEVICE_BUSY` kèm người, nguồn, thời điểm (US2-7);
  - `reload`: 10 tab Chrome headless (`puppeteer-core` như e2e của 004) mở trang xem; nạp xuống → mọi tab tải lại project mới trong ≤ 10 s (FR-025, SC-006 phần x64); đo thời gian nạp xuống project < 1 MB;
  - `secrets` (mở rộng): thêm `projects/` và `/run/mat-runtime` sau khi nạp xuống.

  Ghi `docs/reports/005-<scenario>-x64.json`.
- [ ] T127 [US2] Kiểm US2 theo quickstart §4 và §5 bước 7–10 với runtime x64; ghi `docs/reports/005-acceptance.md`.

**Checkpoint**: US1 + US2 là MVP: tìm, ghim, đăng nhập, nạp xuống an toàn, khôi phục, client tự tải lại. Mọi kịch bản `device-it` của US2 đạt.

---

## Phase 5: User Story 3 — Đọc lên và so sánh (Priority: P2)

**Goal**: đọc lên thành project mới hoặc để so sánh; So sánh theo đối tượng với ký hiệu `= ≠ + -` trong hộp thoại và trên cây project; đọc lên phần chọn thành sửa đổi chưa lưu, hoàn tác được.

**Independent Test**: spec US3. Nạp xuống rồi đọc lên ngay: digest giống hệt; sửa project trên máy, mở So sánh: đúng các mục khác; lấy về một mục từ thiết bị: thành sửa đổi chưa lưu, hoàn tác được (quickstart §5 bước 11–13; SC-002 từ kịch bản `deploy`).

**Phụ thuộc**: US2 phần đọc gói (T110, T117) và `compare.ts` (T119). Phần nối vào file của 004 **sau 004 Phase 4–6**.

- [ ] T128 [P] [US3] Test Rust `apps/studio/src-tauri/src/package/extract.rs` (contract §8; tauri-commands §8 `package_extract`):
  - chỉ giải nén vào thư mục rỗng (`not-empty`);
  - ghi bằng `create_new`: lỗi nếu file đã có, bắt được trùng tên không phân biệt hoa thường của NTFS; đọc lại và so SHA-256;
  - gói lỗi → `{ package: "E_PKG_…" }`; `{ io }`;
  - xong thì đặt làm thư mục project và thêm vào danh sách gần đây (như `project_pick`).
- [ ] T129 [US3] Cài `apps/studio/src-tauri/src/package/extract.rs` và lệnh `package_extract` (hộp thoại chọn thư mục; hủy → `null`), đạt T128. Đăng ký trong `invoke_handler` của `lib.rs` (**sau 004 Phase 4–6**).
- [ ] T130 [P] [US3] Test `apps/studio/src/model/compare-view.test.ts` (data-model §11, R15):
  - bảng dòng `= ≠ + -` theo kind; khác biệt từng trường; ánh xạ `ObjectDiff` sang nút cây của `model/tree.ts`;
  - viewer chỉ thấy "khớp/khác" (digest công khai);
  - tự so khi vào Online với role ≥ engineer, sau mỗi lần lưu, sau mỗi lần nạp xuống; digest giống → chỉ cần `system/info`; khác → tải manifest, rồi tải gói nếu cần;
  - `applyFromDevice(docs, selection)`: kind `project`, `tag` sửa đối tượng trong `project.json`, `tags.json` qua store và lịch sử hoàn tác của 004 (một bước sửa); kind khác thay cả file thành "nội dung chờ ghi", chưa lưu, hoàn tác được.
- [ ] T131 [US3] Cài `apps/studio/src/model/compare-view.ts`, đạt T130.
- [ ] T132 [US3] Test bổ sung (**sau 004 Phase 4–6**) `apps/studio/src/model/project-doc.test.ts` và `apps/studio/src/app/store.test.ts`: tài liệu không sửa được theo đối tượng (lưu trữ, màn hình, binding, SVG) nhận "nội dung chờ ghi": thành chưa lưu, Ctrl+Z bỏ được, Lưu ghi đúng nội dung; `apps/studio/src/model/device-session.test.ts`: trường `compare` cập nhật sau khi so. Test của 004 vẫn xanh.
- [ ] T133 [US3] Cài "nội dung chờ ghi" trong `apps/studio/src/model/project-doc.ts`, `apps/studio/src/app/store.ts` và trường `compare` trong `apps/studio/src/model/device-session.ts` (**sau 004 Phase 4–6**), đạt T132.
- [ ] T134 [P] [US3] Test bổ sung `apps/studio/src/model/tree.test.ts` (**sau 004 Phase 4–6**): khi Online và có `CompareResult`, nút Tag, nhóm lưu trữ, màn hình, binding mang ký hiệu `= ≠ + -`; không Online thì không có ký hiệu; 17 test của 004 vẫn xanh.
- [ ] T135 [US3] Cài ký hiệu so sánh trong `apps/studio/src/model/tree.ts` và `apps/studio/src/ui/mat-tree.ts` (**sau 004 Phase 4–6**), đạt T134.
- [ ] T136 [P] [US3] Test component `apps/studio/src/ui/editors/compare-editor.test.ts`: bảng đối tượng lọc theo trạng thái và kind; chọn dòng hiện khác biệt từng trường; "Đọc lên phần chọn" (chỉ engineer); "Nạp xuống phần khác" mở hộp thoại Nạp xuống; digest giống → câu "giống hệt"; bàn phím và ARIA (`role=grid` hoặc `treegrid`).
- [ ] T137 [US3] Cài `apps/studio/src/ui/editors/compare-editor.ts` và đăng ký editor, đạt T136. `apps/studio/src/platform/mock-device.ts` thêm gói đọc lên lấy từ `projects/tank-demo`, có cờ sửa một Tag để thử So sánh.
- [ ] T138 [US3] Nối US3 vào giao diện của 004 (**sau 004 Phase 4–6**):
  - `apps/studio/src/app/commands.ts`: `online.compare`, `online.upload` hết khóa;
  - hộp thoại Thiết bị trong mạng (T082) thêm "Đọc lên thành project mới" và "Đọc lên để so sánh". Đọc lên thành project mới chạy bộ kiểm tra TS và hiện kết luận, phải giống thiết bị (US3-3);
  - `apps/studio/src/ui/mat-statusbar.ts`: "khớp/khác" với thiết bị.
- [ ] T139 [US3] E2E `apps/studio/tests/e2e/compare.e2e.mjs` (lớp giả; gói đọc lên từ `projects/tank-demo` có sửa một Tag): đọc lên thành project mới vào thư mục rỗng giả; So sánh hiện đúng `+`, `≠`; cây có cùng ký hiệu; chọn dòng hiện khác biệt từng trường; Đọc lên phần chọn → chưa lưu, Ctrl+Z hoàn tác; axe 0 vi phạm critical/serious.
- [ ] T140 [US3] Kiểm US3 theo quickstart §5 bước 11–13 với runtime x64, gồm thiết bị cài theo cách cũ: chạy 0.4.0 lần đầu trên thư mục project của 0.3.0 → đọc lên đủ project (US3-2). SC-002 lấy từ kịch bản `deploy` (T126). Ghi `docs/reports/005-acceptance.md`.

**Checkpoint**: US1–US3 chạy độc lập trên x64; đọc lên ngay sau nạp xuống cho digest giống hệt.

---

## Phase 6: User Story 4 — Chẩn đoán và audit (Priority: P3)

**Goal**: tab Chẩn đoán có CPU, RAM, dung lượng, thời gian chạy, số client, cập nhật ít nhất 5 s một lần; administrator xem và lọc audit trong Studio, xuất audit bằng lệnh trên thiết bị.

**Independent Test**: spec US4. Online với tài khoản engineer, đối chiếu số chẩn đoán với lệnh hệ thống trên thiết bị; đăng nhập administrator, xem audit gồm thao tác của các story trên (quickstart §5 bước 14–15).

**Phụ thuộc**: Phase 2 (audit, role). Phần Studio cần US1; phần nối vào file của 004 **sau 004 Phase 4–6**. Làm song song với US3 được.

- [ ] T141 [P] [US4] Test `core/diagnostics/tests/proc_stats_test.cpp` (R16), dùng văn bản `/proc` mẫu:
  - `/proc/stat`, `/proc/self/stat` → CPU hệ thống và CPU của runtime (% thời gian bận); `/proc/self/status` → `VmRSS`; `/proc/meminfo` → `MemTotal`, `MemAvailable`; `/proc/loadavg`; `/proc/uptime`;
  - cửa sổ 13 mẫu cách 5 s cho trung bình 1 phút; chưa đủ 60 s thì tính trên khoảng đã có;
  - `statvfs(dataDir)` tiêm được.
- [ ] T142 [US4] Cài `core/diagnostics/proc_stats.{hpp,cpp}`; lấy mẫu mỗi 5 s trong vòng tick (`server/main.cpp`); đạt T141.
- [ ] T143 [P] [US4] Test `server/tests/diagnostics_audit_api_test.cpp` (device-api §6, §7):
  - `GET /api/v1/diagnostics` (viewer): đủ khối `at`, `timeSynced`, `cpu`, `memory`, `disk`, `uptime`, `clients` (`live`, `max`, `sessions`), `discovery` (bộ đếm), `versions`; không làm mới hạn phiên; không ghi audit;
  - `GET /api/v1/audit` (administrator): engineer → 403 có audit; tham số `from`, `to`, `user`, `action` (tiền tố), `before`, `limit` (1–200, mặc định 100), sai → 400; trả `{ records, next }` mới nhất trước; mỗi lần gọi ghi `audit.read`.
- [ ] T144 [US4] Cài route `diagnostics` và `audit` trong `server/http/engineering_api.{hpp,cpp}`, đạt T143.
- [ ] T145 [P] [US4] Test `server/tests/export_audit_test.cpp`: `--export-audit [--from …] [--to …] [--format csv|jsonl]` chạy bằng `matscada`; mới nhất sau cùng; CSV theo quy tắc chống CSV injection của `--export-history`; gồm cả đăng nhập thất bại và truy cập bị từ chối (US4-3); ghi `audit.export`; không có mật khẩu, token hay hash.
- [ ] T146 [US4] Cài `server/cli/export_audit.{hpp,cpp}` và nhánh xử lý trong `server/main.cpp`, đạt T145.
- [ ] T147 [P] [US4] Test component `apps/studio/src/ui/editors/audit-view.test.ts`, và bổ sung `apps/studio/src/ui/diagnostics.test.ts` của 004 (**sau 004 Phase 4–6**):
  - Chẩn đoán: CPU (trung bình 1 phút), RAM của runtime và của hệ thống, dung lượng trống, thời gian chạy, số client, độ lệch giờ so với máy kỹ sư; chỉ hỏi mỗi 5 s khi tab đang mở (FR-032);
  - Audit (administrator): mới nhất trước; lọc theo thời gian, tài khoản, hành động; trang tiếp; tài khoản khác → "không đủ quyền".
- [ ] T148 [US4] Cài `apps/studio/src/ui/editors/audit-view.ts`, đạt phần audit của T147; `apps/studio/src/platform/mock-device.ts` thêm chẩn đoán và audit giả.
- [ ] T149 [US4] Nối US4 vào giao diện của 004 (**sau 004 Phase 4–6**), đạt phần chẩn đoán của T147: phần `/api/v1/diagnostics` trong `apps/studio/src/ui/diagnostics.ts` (tab Chẩn đoán của 004 T072); lệnh `online.audit` trong `apps/studio/src/app/commands.ts` và `specs/004-studio-shell/contracts/commands.md`.
- [ ] T150 [US4] `tools/device-it.ps1 -Scenario auth` mở rộng: engineer gọi `/audit` → 403 có audit; administrator đọc và lọc được; `--export-audit` có đủ đăng nhập thất bại và truy cập bị từ chối. `tools/measure/device-api.mjs` thêm `diag`, `audit`. Kiểm quickstart §5 bước 14–15; ghi `docs/reports/005-acceptance.md`.

**Checkpoint**: mọi user story chạy độc lập trên x64.

---

## Phase 7: Polish, CI, tài liệu, đóng gói, nghiệm thu trên BL335

- [ ] T151 [P] CI:
  - `tools/ci-local.ps1`: thêm bước `cargo test --lib` (Windows, `CARGO_TARGET_DIR=C:\build\mat-studio`; vector gói và gói tìm phía Rust) và bước `device-it` (`-Scenario auth,discovery,packages,deploy,busy,health`; `kill`, `reload` chạy tay vì lâu). Sửa chú thích đầu file;
  - `.github/workflows/ci.yml`: vector C++ và TS đã chạy trong job `test-x64` và `web`. Thêm job `device-it` trên `ubuntu-latest` (có `pwsh`) nếu mạng Docker và broadcast chạy được trên runner; không được thì ghi lý do trong file, như ghi chú về Rust. Cân nhắc job `windows-latest` chạy `cargo test --lib`: ghi thời gian build; quá lâu thì giữ ghi chú "chạy tay". Bước smoke armhf dùng binfmt nếu T112 cần;
  - `README.md` gốc ghi các lệnh mới.
- [ ] T152 Hồi quy SC-008:
  - `npm run e2e -w @mat/studio` (shell, edit, monitor của 004 và các e2e mới), `npm test`;
  - `tools/measure/http-check.mjs` và `tools/measure/runtime-smoke.mjs` với runtime x64 0.4.0 trên cổng 8080: trang xem, CSP, allowlist, không đăng nhập; không đổi hành vi (FR-033);
  - client live 1.0.0 với máy chủ 1.1.0 vẫn chạy (contract live-protocol-1.1 §4).
- [ ] T153 Review bảo mật (agent `agent-protocols:security-auditor`) và review code (agent `agent-protocols:code-reviewer`), cách làm như T073 của 003:
  - phạm vi: cấu hình TLS và bản vá CivetWeb; `PinnedVerifier`; băm mật khẩu và so sánh hằng thời gian; phiên và khóa tạm; bảng quyền; audit (bền, gộp, không lộ bí mật); bộ đọc ZIP hai phía và giải nén; tìm thiết bị (khuếch đại, parser); lệnh tài khoản (mật khẩu không qua tham số); quyền file và unit; token không vào WebView; CSP;
  - vá mức Critical/High, test trước; mục còn lại ghi vào `docs/reports/005-acceptance.md`.
- [ ] T154 [P] ⏸ Q2 ⏸ Q5 Tài liệu:
  - `docs/deployment/mat-runtime.md`: cổng HTTPS 8443; in và so fingerprint; `--regen-cert`; lệnh tài khoản và độ dài mật khẩu (Q5); đặt mật khẩu admin lúc cài; kho project và bản dự phòng; khôi phục; rollback qua mốc 0.4.0 (về < 0.4.0 thì chạy project đi kèm gói cũ; cách nạp lại); xuất audit; bật/tắt tìm thiết bị và UDP 8446; làm việc từ xa (Q2: mặc định khuyến nghị VPN, không tự mở cổng; port-forward 9443 → 8443 chỉ khi người dùng chọn; quyết định về 9080); gỡ hẳn (xóa `tls/`, `audit.db`, `projects/`, `users.json`);
  - `schemas/README.md`; `README.md` (lệnh `device-it`, lệnh thiết bị mới); `apps/studio/README.md` (Online, Nạp xuống, Đọc lên, So sánh);
  - `docs/architecture/studio-ux.md` §6 (trạng thái phần đã làm); `docs/plans/roadmap-v2.md` (trạng thái feature 005; quyết định 5 theo Q2);
  - `third_party/LICENSES.md` rà lần cuối: 3 thư viện C, crate Rust, bản vá 3.
- [ ] T155 ⏸ Q1 ⏸ Q3 ⏸ Q5 ADR 010, 011, 012 → **Accepted**, kèm số đo từ `device-it` và các task ⚠️🔌:
  - ADR-010: cờ Mbed TLS của spike (T007), bản vá 3, thời gian bắt tay, CPU của `tls-idle`, tìm thiết bị trong LAN, tường lửa Windows;
  - ADR-011: tham số Argon2id đã đo; ngoại lệ FULL (Q1); Q3, Q5;
  - ADR-012: thời gian nạp xuống từng bước; kết quả `kill` và cắt điện;
  - cập nhật `docs/adr/README.md`. Số nào chưa đo thì ghi "chưa đo" kèm lý do và giữ Proposed.
- [ ] T156 Build gói runtime 0.4.0: `deployment/package-runtime.ps1` → `build/mat-runtime-armhf.tar.gz` và `.sha256`. Kiểm nội dung: `bin/`, `web/`, `project/`, `schemas/` (có `package-manifest.schema.json`), `deployment/` (unit và `deploy.sh` mới); binary không có cờ `MAT_TEST_HOOKS`. Ghi kích thước, SHA-256, thời điểm.
- [ ] T157 Chạy `./tools/ci-local.ps1` đầy đủ, rồi build bộ cài Studio: `$env:CARGO_TARGET_DIR='C:\build\mat-studio'; npm run studio:build`. Phiên bản Studio thống nhất với phiên 004 (contract dùng ví dụ `0.2.0`; **sau 004 Phase 4–6**). Ghi đường dẫn, kích thước, thời điểm của bộ cài.
- [ ] T158 ⚠️🔌 ⏸ Q4 **(cần người dùng cho phép)** Cài runtime 0.4.0 lên BL335 (quickstart §6 bước 1–2):
  - kiểm chỉ đọc trước: phiên bản, dung lượng, RAM trống;
  - `deploy.sh` với gói của T156; project đang chạy được nhận vào kho (`project.adopt`); in fingerprint;
  - người dùng đặt mật khẩu `admin` qua TTY (mật khẩu không ghi vào repo hay log của phiên); tạo tài khoản kỹ sư;
  - `docs/reports/device-changes.md`: thay đổi và cách hoàn tác (`rollback.sh` về 0.3.0; gỡ hẳn thì xóa `/var/lib/mat-runtime/{tls,audit.db,projects}` và `/etc/mat-runtime/users.json`).
- [ ] T159 ⚠️🔌 ⏸ Q4 ⏸ Q3 **(cần người dùng cho phép)** Đo trên BL335 (quickstart §6 bước 3–5; R17), dùng `tools/measure/sample.sh` qua `ssh … sh -s`, không ghi file trên thiết bị:
  - `--auth-bench` chốt tham số, nếu T055 chưa làm;
  - RSS và CPU khi rảnh 10 phút, với 0.3.0 rồi 0.4.0, cùng `tank-demo`;
  - tải chuẩn 30 phút: `bench-500`, 10 client `load-tester`, cộng Studio Online hỏi chẩn đoán mỗi 5 s;
  - 20 lần đăng nhập, mỗi lần ≤ 1 s; 8 kết nối TLS im lặng;
  - SC-007, FR-034. Vượt ngân sách thì cần ADR (Constitution III).
- [ ] T160 ⚠️🔌 ⏸ Q4 **(cần người dùng cho phép)** Nạp xuống và đọc lên trên BL335 (quickstart §6 bước 8): 10 lần nạp xuống project < 1 MB, đọc lên ngay sau đó, với 3 project: ≤ 15 s mỗi lần kể cả kiểm tra sức khỏe; digest giống hệt; client Chrome tải lại ≤ 10 s (SC-002, SC-006). Đo xong trả thiết bị về `tank-demo`.
- [ ] T161 ⚠️🔌 ⏸ Q4 **(cần người dùng cho phép, cần người ở cạnh thiết bị)** ≥ 3 lần cắt điện thật ở các bước `activate` và `health` (quickstart §6 bước 9): sau mỗi lần, thiết bị chạy bản hợp lệ, `--project-status` không còn `pending`, `audit.db` và `history.db` toàn vẹn (SC-004).
- [ ] T162 ⚠️🔌 ⏸ Q4 **(cần người dùng cho phép, cần một máy Windows cùng LAN với BL335)** Tìm thiết bị 10/10 lần ≤ 3 s từ Studio (quickstart §6 bước 6; SC-001). Ghi bản Windows (10 hay 11), Windows có hiện hộp thoại cho phép ứng dụng không, gói trả lời có tới với tường lửa mặc định không (R3); có cả Windows 10 và 11 thì thử cả hai.
- [ ] T163 ⚠️🔌 ⏸ Q4 ⏸ Q2 **(cần người dùng cho phép)** Làm việc từ xa (quickstart §6 bước 7): thêm theo địa chỉ qua VPN (mặc định khuyến nghị), hoặc qua port-forward HTTPS chỉ khi người dùng chọn ở Q2 (người dùng tự cấu hình router); ghim; đăng nhập (SC-001 phần WAN). Không tự mở hay đóng cổng nào.
- [ ] T164 ⚠️🔌 ⏸ Q4 **(cần người dùng cho phép)** Tìm chuỗi mật khẩu thử trên thiết bị (quickstart §6 bước 10): `grep -r` trong `/var/lib/mat-runtime`, `/etc/mat-runtime` và journal của `mat-runtime`: không thấy (SC-005). Mật khẩu thử chỉ dùng một lần rồi đổi.
- [ ] T165 ⚠️🔌 ⏸ Q4 **(cần người dùng: một kỹ sư làm, không xem tài liệu)** Vòng đầy đủ tìm thiết bị → Online → sửa → nạp xuống → So sánh cho kết quả "giống" trong ≤ 5 phút (quickstart §6 bước 11; SC-009), với bộ cài của T157.
- [ ] T166 Hoàn thiện `docs/reports/005-acceptance.md`:
  - SC-001…SC-009 có số đo và đường dẫn bằng chứng; mục chưa đo ghi "chưa đo" kèm lý do (thường là chưa được phép thao tác trên thiết bị);
  - bảng đối chiếu chức năng của 004 và Sprint 1 (SC-008);
  - hạn chế còn lại: sanitizer SVG còn là denylist tới GĐ 3b; trang xem HTTP không đăng nhập tới GĐ 2; TOFU ở lần ghim đầu.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → các user story.
- **T012** (câu trả lời Q1–Q5) chỉ chặn việc bật `synchronous=FULL` ở T025. Task khác làm theo phương án mặc định, rồi sửa nếu người dùng chọn khác.
- **Mốc bảo mật** (Checkpoint Phase 2) chặn mọi route và lệnh nạp xuống, đọc lên, khôi phục: T109–T110, T116–T117, T128–T129 (Constitution V).
- **US1:**
  - thiết bị T056–T058 chỉ cần Phase 1 và T014 (tìm thiết bị không cần đăng nhập); T059–T061 cần T039, T044;
  - Rust T062–T071 cần T009, T010, T014; T072 **sau 004 Phase 4–6**;
  - TS: file mới cần T072; phần nối (T079–T080, T083–T084) **sau 004 Phase 4–6**.
- **US2** cần Mốc bảo mật. Studio của US2 cần US1 (`DeviceLink`, phiên đăng nhập).
- **US3** cần US2: T110 (đọc gói), T117 (`device_fetch_package`, `package_read`), T119 (`compare.ts`).
- **US4** cần Phase 2 (audit, role) và phần Studio của US1; làm song song với US3 được.
- **Polish** cần các story muốn nghiệm thu. T158–T165 cần người dùng cho phép (Q4); T158 cần T156.

### Phối hợp với feature 004

| Task 005 | File của 004 | Điều kiện |
|---|---|---|
| T009 | `src-tauri/Cargo.toml`; dòng `mod` của `src-tauri/src/lib.rs` | file chung: báo phiên 004; không phối hợp được thì sau 004 Phase 4–6 |
| T021, T023, T119 | `packages/project-schema/src/{index,codes}.ts` | file chung: chỉ thêm export, nâng `RUNTIME_VERSION` |
| T101–T102 | `packages/live-client/src/*` | file chung (T030 của 004 đã xong) |
| T072, T117, T129 | `invoke_handler` của `src-tauri/src/lib.rs` | sau 004 Phase 4–6 |
| T074 | `apps/studio/vite.config.ts` (alias e2e) | sau 004 Phase 4–6 |
| T079–T080 | `model/device-session.ts`, `model/device.ts` | sau 004 Phase 4–6 |
| T083 | `app/commands.ts`, `app/app.ts`, `ui/mat-statusbar.ts`, `i18n/vi.ts`, `specs/004-studio-shell/contracts/commands.md` | sau 004 Phase 4–6 |
| T084 | `src-tauri/tauri.conf.json` (CSP) | sau 004 Phase 4–6, sau T076, T080 |
| T124 | `app/commands.ts`, `ui/mat-taskcards.ts`, mockup, `contracts/commands.md` của 004 | sau 004 Phase 4–6 |
| T132–T135 | `model/project-doc.ts`, `app/store.ts`, `model/device-session.ts`, `model/tree.ts`, `ui/mat-tree.ts` | sau 004 Phase 4–6 |
| T138 | `app/commands.ts`, `ui/mat-statusbar.ts` | sau 004 Phase 4–6 |
| T147, T149 | `ui/diagnostics.ts` (+ test), `app/commands.ts`, `contracts/commands.md` của 004 | sau 004 Phase 4–6 |
| T157 | phiên bản Studio, bộ cài | sau 004 Phase 4–6 |

File mới của 005 phía Studio (`platform/device-*`, `platform/mock-device.ts`, `model/{device-adapters,discovery,download-flow,compare-view}.ts`, `ui/dialogs/*`, `ui/editors/{compare-editor,audit-view}.ts`, `i18n/vi-online.ts`, module Rust mới) làm được trước khi 004 xong Phase 4–6; chỉ phần nối vào giao diện phải chờ.

### Within Each User Story

- Test (đỏ) → cài đặt (xanh) → nối vào `server/main.cpp` hoặc giao diện → kiểm theo quickstart.
- C++: hàm thuần (`discovery_proto`, `zip_reader`, `boot_decision`, `deploy_pipeline`, `health_check`) trước phần có luồng hay I/O.
- Rust: module trước lệnh Tauri; lệnh trước giao diện TS.
- TS: logic thuần (`model/`) trước component (`ui/`); component trước khi nối vào file của 004.

### Parallel Opportunities

- **Phase 1:** T002, T003, T008, T009, T011 song song với T001.
- **Phase 2:** T013–T015 song song; các test T016, T018, T019, T022, T024, T026–T031, T036, T038, T040, T041, T045, T046 song song (khác file); T033, T034 song song.
- **Ba luồng làm việc** sau Phase 1:
  - (A) C++ thiết bị: Phase 2 → US1 thiết bị → US2 thiết bị → US4 thiết bị;
  - (B) Rust Studio (máy chủ giả, không chờ thiết bị): T062–T071 và T114–T115 ngay sau Phase 1; T116–T117, T128–T129 sau Mốc bảo mật;
  - (C) TS: `packages/*` và `apps/runtime-web` (T019–T021, T101–T104, T118–T119) bất cứ lúc nào; `apps/studio` theo bảng phối hợp với 004.
- **US1:** T056, T057 ‖ T062, T064, T066, T068, T070 ‖ T073, T075, T077, T081.
- **US2:** T087–T092 ‖ T096–T098 ‖ T101, T103, T105, T107 ‖ T114, T116 ‖ T118, T120, T122.
- **US3 ‖ US4** sau US2 (US4 chỉ cần Phase 2 và US1).

---

## Parallel Example: Phase 2

```text
# Test (viết trước, cùng lúc):
Task: "Test core/crypto/tests/crypto_test.cpp"
Task: "Test core/audit/tests/audit_log_test.cpp"
Task: "Test core/auth/tests/password_hash_test.cpp"
Task: "Test core/auth/tests/account_store_test.cpp"
Task: "Test core/auth/tests/session_store_test.cpp"
Task: "Test core/auth/tests/login_guard_test.cpp"
Task: "Test core/auth/tests/roles_test.cpp"
Task: "Test server/tests/server_cert_test.cpp"
Task: "Test server/tests/https_handshake_test.cpp"

# Vector chung (cùng lúc):
Task: "tests/package-vectors/generate.mjs"
Task: "tests/discovery-vectors/generate.mjs"
Task: "tests/project-vectors/generate.mjs: files + digest"
```

## Parallel Example: User Story 2

```text
# Gói và kho phía thiết bị (test viết trước, cùng lúc):
Task: "Test core/package/tests/zip_reader_test.cpp"
Task: "Test core/package/tests/package_check_test.cpp"
Task: "Test core/package/tests/extract_test.cpp"
Task: "Test core/project-store/tests/boot_decision_test.cpp"
Task: "Test core/project-store/tests/deploy_pipeline_test.cpp"

# Studio, song song với thiết bị:
Task: "Test Rust apps/studio/src-tauri/src/package/{zip,manifest}.rs"
Task: "Test packages/project-schema/src/compare.test.ts"
Task: "Test apps/studio/src/model/download-flow.test.ts"
Task: "Test packages/live-client/src/connection.test.ts (1012)"
```

---

## Implementation Strategy

### Trước khi người dùng trả lời 5 câu hỏi

Làm Phase 1, Phase 2 và phần tìm thiết bị của US1 theo phương án mặc định. Riêng T025 không bật `synchronous=FULL` khi chưa có Q1. Task ⚠️🔌 chờ Q4.

### Mốc 1: nền bảo mật (Phase 1–2)

HTTPS, chứng chỉ, đăng nhập, role, khóa tạm, audit chạy trên x64 và qemu. Đây là mốc nội bộ, chưa giao cho người dùng. Nếu được phép thì đo `--auth-bench` trên BL335 ngay (T055), vì tham số Argon2id quyết định SC-007.

### Mốc 2, giao sớm: nền bảo mật + US1

Câu hỏi "MVP = US1 + nền bảo mật?": đây là bản demo sớm. Studio tìm thấy thiết bị, ghim, đăng nhập và theo dõi qua HTTPS. Bản này đủ để người dùng xem giao diện Online và để đo RSS/CPU sớm, nhưng chưa thay được quy trình chép tay bằng SSH. Chỉ cài 0.4.0 lên BL335 ở mốc này nếu người dùng muốn đo sớm; mặc định cài một lần ở MVP.

### MVP: nền bảo mật + US1 + US2 (hai story P1)

Thay quy trình chép project bằng SSH: nạp xuống an toàn, khôi phục, client tự tải lại. Giao gói runtime 0.4.0 và bộ cài Studio thử lần 1; nghiệm thu phần thiết bị của MVP (T158–T161) khi được phép.

### Incremental Delivery

1. US3 (đọc lên, so sánh): yêu cầu gốc ngày 2026-10-10, giao ngay sau MVP; phần lớn hạ tầng đã có từ US2.
2. US4 (chẩn đoán, xem audit).
3. Polish: CI, review bảo mật, tài liệu, ADR Accepted, nghiệm thu BL335 (T158–T166).

Mỗi bước giữ `test-x64.ps1`, `npm test`, `cargo test --lib` và e2e xanh.

### Làm song song

- Một luồng C++ (thiết bị) và một luồng Rust (Studio) chạy từ Phase 1. Hai luồng gặp nhau ở bộ vector chung và ở T086/T127 (kiểm với runtime x64).
- Luồng TS làm `packages/*` và file mới của `apps/studio` bất cứ lúc nào; phần nối vào giao diện chờ 004 xong Phase 4–6.

---

## Notes

- `[P]` = khác file, không phụ thuộc task chưa xong.
- Đánh dấu `[X]` khi xong; lệch kế hoạch thì ghi "**ghi chú khi làm:**" ngay trong task (như 003, 004).
- Task ⚠️🔌 ghi ngày người dùng cho phép và ai làm.
- Không commit khi người dùng chưa yêu cầu.
