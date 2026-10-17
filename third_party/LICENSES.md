# Thư viện bên thứ ba (vendored)

Rà soát license theo Constitution ("Ràng buộc công nghệ"): không thư viện vendored nào trong bảng đầu là GPL/LGPL; mọi license của chúng đều cho phép liên kết tĩnh trong sản phẩm thương mại khi giữ thông báo bản quyền. Các client DB LGPL ở mục cuối chỉ được nạp động lúc chạy, không link.

| Thư viện | Phiên bản | License | Thư mục | Dùng ở | Nguồn |
|---|---|---|---|---|---|
| CivetWeb | 1.16 | MIT | `civetweb/` (`LICENSE.md`) | `mat-runtime`, `mat-poc` (máy chủ HTTP/WebSocket) | https://github.com/civetweb/civetweb |
| nlohmann/json | 3.11.3 | MIT | `nlohmann/` (`LICENSE.MIT`) | `mat-runtime` (config, project, bản tin client) | https://github.com/nlohmann/json/releases/tag/v3.11.3 (chỉ `json.hpp`) |
| valijson | 1.0.3 | BSD-2-Clause | `valijson/` (`LICENSE`) | `mat-runtime` (validator JSON Schema draft-07) | https://github.com/tristanpenman/valijson/releases/tag/v1.0.3 (chỉ `include/`) |
| GoogleTest | 1.15.2 | BSD-3-Clause | `googletest/` (`LICENSE`) | **chỉ test** trên x64, không có trong binary thiết bị | https://github.com/google/googletest/releases/tag/v1.15.2 (bỏ docs/ci/bazel) |
| Meta-schema JSON Schema draft-07 | draft-07 | MIT (bản phân phối trong ajv 6.15.0) | `json-schema/draft-07.schema.json` | **chỉ test** (`packages/project-schema/src/meta-schema.test.ts`), không có trong gói thiết bị | http://json-schema.org/draft-07/schema, chép từ `ajv/lib/refs/json-schema-draft-07.json` (ajv 6.15.0), SHA-256 `7f5fd717194bd954bbb04c833f6116f727d899c7bc977c26abcb2607aa51d66a` |
| SQLite | 3.54.0 | Public domain | `sqlite/` (`sqlite3.c`, `sqlite3.h`, `VERSION.txt`) | `mat-runtime` (lưu trữ dữ liệu Tag, feature 003) | https://www.sqlite.org/2026/sqlite-amalgamation-3540000.zip, SHA3-256 `7b670a62fdfbd672b75fef004cb703c8a3e87d3a5cc7d675b4a08337004a2d93`, tải ngày 2026-10-10 |
| Mbed TLS | 3.6.7 (2026-07-07), nhánh LTS 3.6, hỗ trợ tới ít nhất 2027-03 | Apache-2.0 (bản phát hành: Apache-2.0 OR GPL-2.0-or-later; chọn Apache-2.0) | `mbedtls/` (`LICENSE`, `VERSION.txt`; chỉ `include/`, `library/`, không có file NOTICE); cấu hình của dự án: `mbedtls-config/mat_mbedtls_config.h` | `mat-runtime` (HTTPS của CivetWeb; chứng chỉ, SHA-256, số ngẫu nhiên; feature 005) | https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-3.6.7/mbedtls-3.6.7.tar.bz2, SHA-256 `a7e8bcbec0e6f761b4af24f25677626b35f762f68eef79c08677a363212d11f6` (khớp giá trị công bố trong ghi chú phát hành), tải ngày 2026-10-11 |
| phc-winner-argon2 | 20190702 (bản phát hành mới nhất) | Apache-2.0 (bản phát hành: CC0-1.0 OR Apache-2.0; chọn Apache-2.0 vì có cấp quyền sáng chế, CC0 thì không) | `argon2/` (`LICENSE`, `VERSION.txt`; mã tham chiếu `ref.c`, không `opt.c`, không luồng) | `mat-runtime` (băm mật khẩu Argon2id, feature 005; link qua `mat_device` từ T017) | https://github.com/P-H-C/phc-winner-argon2/archive/refs/tags/20190702.tar.gz (tag `20190702`, commit `62358ba2123abd17fccf2a108a301d4b52c01a7c`), SHA-256 `daf972a89577f8772602bf2eb38b6a3dd3d922bf5724d45e7f9589b5e830442c` (tự tính, không có giá trị công bố), tải ngày 2026-10-11 |
| miniz | 3.1.2 (2026-07-01) | MIT | `miniz/` (`LICENSE`, `VERSION.txt`; `miniz.c`, `miniz.h` bản amalgamation của bản phát hành) | `mat-runtime` (chỉ giải nén deflate `tinfl` và CRC-32 cho bộ đọc gói `.matscada`, feature 005; phần còn lại tắt lúc biên dịch, kể cả API zip; link qua `mat_device` từ T017) | https://github.com/richgel999/miniz/releases/download/3.1.2/miniz-3.1.2.zip, SHA-256 `f0446d863f9c19926ad9483c523fdc42e42b8d4a6a431d27e09d49c79a140d9a` (tự tính, không có giá trị công bố; trùng digest GitHub ghi cho file), tải ngày 2026-10-11 |

Ba thư viện của feature 005 (rà ngày 2026-10-11, task T001–T003; quy tắc phát hành trước 2026-09-27 của [ADR-009](../docs/adr/009-studio-ui-stack.md)):

- **Mbed TLS:** 3.6.7 là bản 3.6.x mới nhất. Trang security advisories mới nhất là đợt 2026-07, đều đã vá trong 3.6.7 (advisory Everest CVE-2026-54434 chỉ ảnh hưởng 4.1.0, và cấu hình không bật Everest). Thư viện và mọi nơi dùng phải biên dịch cùng một `MBEDTLS_CONFIG_FILE` (target `mat_mbedtls` truyền cho người dùng). Khi nâng: chạy lại `mbedtls_config_test` và test HTTPS.
- **phc-winner-argon2:** không tìm thấy CVE nào (Debian security tracker, GitHub security advisories, tìm kiếm web). Từ tag tới nhánh chính chỉ có 27 commit sửa build, README, URL. PR mở #299 (ghi tràn bộ đệm) chỉ ở công cụ dòng lệnh `run.c`, không chép vào đây. PR #301 chỉ đổi thứ tự kiểm `lanes`, lỗi trả về khác, không có lỗi bộ nhớ.
- **miniz:** 3.1.2 sửa vòng lặp vô hạn của `tinfl` (`code_len == 0`) và lỗi tràn offset của central directory trong API zip; repo không có security advisory. Mã của từng file nguồn của tag 3.1.2 nằm nguyên văn trong bản amalgamation.

## Bản vá cục bộ

- **CivetWeb 1.16** (`civetweb/civetweb.c`, đánh dấu "mAT patch"; feature 010 thêm `mg_peer_closed`: poll + recv MSG_PEEK để một truy vấn lịch sử dài dừng khi client ngắt kết nối), sau review Sprint 1:
  1. `MG_MAT_MAX_WS_FRAME` (mặc định 96 KiB): frame WebSocket lớn hơn bị đóng 1009 **trước** khi cấp phát. Upstream cấp phát theo độ dài client khai báo, tới khoảng 2 GB.
  2. `mg_mat_force_close(conn)`: cắt kết nối từ thread khác (hạn chót sau close frame, writer bị lỗi).
- `mat-runtime` link bản `civetweb_runtime` build với `NO_FILES`, không chứa mã phục vụ file/redirect thư mục (CVE-2025-55763). `mat-poc` (Sprint 0, không triển khai) vẫn dùng bản đầy đủ.
- **CivetWeb với Mbed TLS (feature 005):** `civetweb_runtime` build với `USE_MBEDTLS` (bỏ `NO_SSL`) và link `mat_mbedtls`; `mat-poc` giữ `NO_SSL`. `mod_mbedtls.inl` của 1.16 biên dịch với Mbed TLS 3.6.7 mà không cần sửa (spike T007, x64 và armhf). Hai bản vá của task T037, đánh dấu "mAT patch 3", "mAT patch 4" trong `civetweb/mod_mbedtls.inl` và ở hai chỗ của `civetweb.c` (chỗ gọi `mbed_ssl_accept`, nhánh Mbed TLS của `pull_inner`):
  3. **Bắt tay có hạn.**
     - **Vì sao:** worker nhận socket ở chế độ non-blocking, còn vòng `mbed_ssl_handshake` gọi lại `mbedtls_ssl_handshake()` ngay khi gặp `WANT_READ`/`WANT_WRITE`, không chờ, không hạn. Một client mở TCP rồi im lặng giữ một worker ở 100 % CPU tới khi client tự đi (T007: 1498 ms CPU trong 1500 ms), và `mg_stop` chờ worker đó.
     - **Làm gì:**
       - gặp `WANT_READ`/`WANT_WRITE` thì `poll()` socket theo chiều Mbed TLS cần;
       - cả lần bắt tay tối đa `request_timeout_ms` của context, đo bằng đồng hồ monotonic; quá hạn hoặc `poll` lỗi thì trả lỗi để CivetWeb đóng kết nối;
       - mỗi lần chờ tối đa `SOCKET_TIMEOUT_QUANTUM` (2 s) để thấy cờ dừng của `mg_stop`;
       - `request_timeout_ms` ≤ 0 thì dùng `MG_MAT_TLS_HANDSHAKE_DEFAULT_MS` (30 s, mặc định `request_timeout_ms` của CivetWeb);
       - `CRYPTO_IN_PROGRESS` gọi lại ngay, `ASYNC_IN_PROGRESS` chờ 1 ms rồi gọi lại, cùng hạn chót; cấu hình Mbed TLS của dự án không sinh ra hai mã này;
       - chỗ gọi `mbed_ssl_accept` truyền thêm `request_timeout_ms` và cờ dừng. Context HTTP thường không đi qua đoạn mã này.
     - **Test:** `server/tests/https_handshake_test.cpp`, các test `HttpsHandshake.SilentClients…`, `TricklingClient…`, `StopDoesNotWait…`. Trước và sau vá:
       - 8 kết nối im lặng: 39 911 ms CPU trong 5 s (798 %) → 0,5 ms (0,01 %); không bị đóng → đóng sau 10,0 s;
       - client nhỏ giọt từng byte: không bị đóng → đóng đúng hạn;
       - `mg_stop` khi có client im lặng: chờ tới khi client đi (8,0 s trong test) → 1,75 s.
  4. **Đóng TLS sạch, kiểm `mbedtls_ssl_setup`.**
     - **Vì sao:** `pull_inner` in `SSL read failed, error -30848` (close_notify) hoặc `error 0` (đóng TCP) ra stderr mỗi khi client đóng kết nối đúng cách: một dòng lỗi giả cho mỗi kết nối. Kết quả `mbedtls_ssl_setup` (lỗi cấp phát) không được kiểm.
     - **Làm gì:**
       - `mbed_ssl_read` đổi `MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY` thành 0, cùng nghĩa "hết luồng" như khi đóng TCP;
       - `pull_inner` gặp 0 thì trả -2 như nhánh socket thường, không in;
       - `mbed_ssl_accept` kiểm `mbedtls_ssl_setup`: lỗi thì in `SSL setup failed, error <mã>`, giải phóng context và từ chối kết nối.
     - **Test:**
       - `HttpsHandshake.ClosingClientsAreNotLoggedAsErrors`: close_notify sau bắt tay TLS 1.2 và 1.3, sau một request keep-alive, và đóng TCP không close_notify. Trước vá: 4 dòng `SSL read failed`; sau vá: không dòng nào;
       - `HttpsHandshake.FailedSslSetupRefusesTheConnection`: lỗi cấp phát giả qua `-Wl,--wrap=calloc`.
- **Feature 011 (T048), đánh dấu "mAT patch 5" ở `civetweb.h` (cuối `struct mg_callbacks`) và hai chỗ của `civetweb.c` (`accept_new_connection`, cuối vòng của `worker_thread_run`):**
  5. **Giới hạn kết nối theo nguồn trước khi chờ worker.**
     - **Vì sao:** `init_connection` của CivetWeb chạy trong worker và **sau** bắt tay TLS, nên một nguồn mở 40 kết nối TLS im lặng vẫn giữ hết 40 worker HTTPS trong 10 s bắt tay trước khi kịp đếm; kết nối đã nhận mà chưa có worker nằm trong hàng đợi, cũng không đếm được.
     - **Làm gì:** hai callback mới `mat_accept(ctx, peer)` và `mat_release(ctx, peer)`. Luồng master gọi `mat_accept` ngay sau `accept()` và `check_acl`, trước hàng đợi và trước mọi bắt tay; trả 0 thì đóng socket ngay. Worker gọi `mat_release` đúng một lần cho mỗi socket đã nhận, ở cuối vòng xử lý, bất kể đường đi (request xong, bắt tay lỗi, WebSocket đóng, server dừng). Không gán callback thì như upstream. `server/http/web_contexts.cpp` nối hai callback vào `ConnLimiter` (`server/http/conn_limit.hpp`) dùng chung cho context HTTP và HTTPS.
     - **Test:** `server/tests/conn_limit_test.cpp`: HTTP, HTTPS, WebSocket cộng chung, kết nối vượt bị đóng ≤ 500 ms; 40 kết nối TLS im lặng từ một IP: request từ IP khác 13 ms (trước vá: chờ tới khi bắt tay hết hạn 10 s, test đỏ); bắt tay lỗi và kết nối đóng trả lại chỗ (bộ đếm về 0).
- Khi nâng cấp CivetWeb: áp lại năm bản vá; chạy lại `server/websocket/tests`, `https_handshake_test`, `conn_limit_test` và `tools/measure/http-check.mjs`.

## Thư viện client DB nạp động (feature 003, không vendored, không link)

`mat-runtime` **không link** các thư viện dưới đây và **không phân phối** chúng: lần đầu cần một loại DB, runtime `dlopen` thư viện của hệ điều hành (gói Ubuntu, người dùng tự cài), hoặc bản đặt ở `clientLibDir` (mặc định `/opt/mat-runtime/lib`, chưa dùng). Hai thư viện LGPL vì vậy chỉ được nạp động, đúng Constitution VII. Hằng số và chữ ký hàm tự khai báo trong `core/historian/forward/*_api.hpp`, kiểm với header thật bằng `client_api_check_test`.

| Thư viện | Gói Ubuntu 20.04 (soname) | License | Dùng cho |
|---|---|---|---|
| MariaDB Connector/C 3.1 | `libmariadb3` (`libmariadb.so.3`) | LGPL-2.1-or-later | MySQL / MariaDB |
| FreeTDS 1.1.6 (db-lib) | `libsybdb5` (`libsybdb.so.5`) | LGPL-2.0-or-later | SQL Server |
| libpq 12 | `libpq5` (`libpq.so.5`) | PostgreSQL License | PostgreSQL |
| libcurl 7.68 | `libcurl4` (`libcurl.so.4`) | curl (MIT/X derivative) | InfluxDB (HTTP API v2) |

Nếu sau này đóng kèm các file `.so` trong gói runtime: kèm license, mã nguồn (hoặc lời đề nghị cung cấp mã nguồn) của hai thư viện LGPL, và giữ việc nạp động.

Thư viện npm (`@cfworker/json-schema` MIT, Tauri plugin MIT/Apache-2.0) quản lý qua `package-lock.json` / `Cargo.lock`.

## Phụ thuộc của Studio (feature 004, quản lý qua `package-lock.json` / `Cargo.lock`)

Phiên bản cố định, chọn bản phát hành ít nhất 2 tuần trước ngày chọn (2026-10-11, [ADR-009](../docs/adr/009-studio-ui-stack.md)).

| Thư viện | Phiên bản | License | Dùng ở |
|---|---|---|---|
| Lit (`lit`, kéo theo `lit-html` 3.3.3, `lit-element` 4.2.2, `@lit/reactive-element` 2.1.2, `@lit-labs/ssr-dom-shim` 1.6.0, `@types/trusted-types` 2.0.7) | 3.3.3 | BSD-3-Clause | giao diện Studio |
| Fluent UI System Icons (`@fluentui/svg-icons`) | 1.1.343 | MIT | icon Studio, chỉ đóng gói icon dùng tới |
| `sha2` (Rust) | 0.10.9 (đã có trong `Cargo.lock` qua Tauri) | MIT OR Apache-2.0 | Studio: SHA-256 nội dung file để phát hiện sửa ngoài Studio |
| `serde_json` (Rust) | 1.0.151 (đã có trong `Cargo.lock` qua Tauri; trước chỉ dùng trong test) | MIT OR Apache-2.0 | Studio: `recent.json`, đọc `projectName` khi ghi danh sách project gần đây |
| axe-core | 4.13.0 | MPL-2.0 | **chỉ khi phát triển** (kiểm trợ năng trong test e2e), không vào bộ cài |

Khi đóng gói sản phẩm: kèm nội dung các file LICENSE trên trong tài liệu phát hành.

## Phụ thuộc của Studio (feature 005, quản lý qua `Cargo.lock`)

Crate Rust cho kết nối Studio ↔ thiết bị (research R6, R19). Rà ngày 2026-10-11 (task T010):

- **Tuổi phiên bản:** mọi crate mới phát hành ít nhất 2 tuần trước ngày chọn, tức không sau 2026-09-27 ([ADR-009](../docs/adr/009-studio-ui-stack.md)). Ngày phát hành tra bằng API crates.io (`/api/v1/crates/<tên>/versions`). Crate mới khai báo trực tiếp ghi phiên bản cố định (`=`) trong `Cargo.toml`.
- **License** lấy theo đúng phiên bản trong `Cargo.lock`. Không crate nào là GPL/LGPL.
- **Không thêm phiên bản thứ hai** của `reqwest`, `flate2`, `tokio`, `sha2` (`cargo tree -d`). Phiên bản trùng mới: `digest` 0.10 và 0.11 (cùng `block-buffer`, `crypto-common`, `cpufeatures`) vì `tungstenite` dùng `sha1` 0.11; `getrandom` 0.2 vì `ring`.
- **Không dùng aws-lc-rs** (cần CMake, NASM): `reqwest` tắt feature mặc định, provider là `ring`. `ring` cần trình biên dịch C khi build (Visual Studio C++ trên máy dev).

**Khai báo trực tiếp trong `Cargo.toml`:**

| Crate | Phiên bản (phát hành) | License | Dùng ở |
|---|---|---|---|
| rustls | 0.23.45 (2026-09-14) | Apache-2.0 OR ISC OR MIT | TLS tới thiết bị, verifier ghim fingerprint; feature `ring`, `std`, `tls12` |
| tokio-rustls | 0.26.5 (2026-09-04) | MIT OR Apache-2.0 | luồng TLS cho WebSocket; 0.26.6 (2026-09-28) chưa đủ 2 tuần |
| tokio-tungstenite | 0.30.0 (2026-07-11) | MIT | WebSocket `/api/v1/live`, chỉ feature `handshake` |
| if-addrs | 0.15.0 (2026-02-08) | MIT OR BSD-3-Clause | liệt kê card mạng để tìm thiết bị |
| zeroize | 1.9.0 (2026-06-12) | Apache-2.0 OR MIT | xóa bộ đệm mật khẩu; 1.9.1 (2026-10-06) chưa đủ 2 tuần |
| reqwest | 0.13.5 (2026-09-08), đã có trong `Cargo.lock` | MIT OR Apache-2.0 | HTTP tới thiết bị; feature `rustls-no-provider`, `json`, `stream` |
| flate2 | 1.1.10 (2026-08-28), đã có | MIT OR Apache-2.0 | nén, giải nén gói `.matscada` (backend `miniz_oxide` 0.8.9) |
| tokio | 1.53.1 (2026-07-20), đã có, hạ từ 1.53.2 (2026-10-03) | MIT | bật thêm `net`, `time`, `fs`, `io-util`, `sync`, `macros`, `rt-multi-thread` |
| futures-util | 0.3.34 (2026-08-11), đã có | MIT OR Apache-2.0 | `StreamExt`, `SinkExt` cho WebSocket |
| uuid | 1.26.1 (2026-09-10), đã có, hạ từ 1.28.0 (2026-10-10) | Apache-2.0 OR MIT | bật `v4`: id thiết bị đã lưu, `packageId` |
| base64 | 0.23.1 (2026-08-04), đã có | MIT OR Apache-2.0 | base64url |
| getrandom | 0.4.3 (2026-06-17), đã có | MIT OR Apache-2.0 | số ngẫu nhiên của hệ điều hành |
| rcgen | 0.14.10 (2026-08-28) | MIT OR Apache-2.0 | **chỉ khi test** (dev-dependency): sinh chứng chỉ thử lúc chạy test, không vào bộ cài. Kéo theo `pem` 4.0.0 (2026-07-28, MIT), `yasna` 0.6.0 (2026-03-14, MIT OR Apache-2.0), cũng chỉ khi test |

`tokio` và `uuid` đã có trong `Cargo.lock` và trong bản build từ feature 004 (qua Tauri), nhưng bản cũ (1.53.2, 1.28.0) phát hành chưa đủ 2 tuần. Phiên chính quyết định hạ cho cả bản build 004 (2026-10-11), cùng cách sửa `Cargo.lock` như các crate ghi "hạ từ" ở bảng dưới. Bản bị bỏ qua không có vá bảo mật: `tokio` 1.53.2 chỉ sửa lỗi thường (mpsc, timer, fs), RustSec không có advisory nào năm 2026; `uuid` 1.27.0 và 1.28.0 chỉ thêm tính năng.

**Kéo theo, mới vào bản build Windows của Studio** (`cargo tree -e normal`, x86_64-pc-windows-msvc):

| Crate, phiên bản (phát hành) | License | Kéo theo bởi |
|---|---|---|
| ring 0.17.14 (2025-03-11) | Apache-2.0 AND ISC | rustls, rustls-webpki (provider mật mã); rcgen |
| getrandom 0.2.17 (2026-01-11) | MIT OR Apache-2.0 | ring |
| untrusted 0.9.0 (2021-07-13) | ISC | ring, rustls-webpki |
| rustls-webpki 0.103.15 (2026-08-21) | ISC | rustls |
| rustls-pki-types 1.15.1 (2026-07-23) | MIT OR Apache-2.0 | rustls, reqwest |
| subtle 2.6.1 (2024-06-24) | BSD-3-Clause | rustls |
| rustls-platform-verifier 0.7.1 (2026-09-24) | MIT OR Apache-2.0 | reqwest: feature `rustls-no-provider` luôn kéo theo; Studio truyền cấu hình TLS riêng nên không dùng tới |
| hyper-rustls 0.27.10 (2026-09-20) | Apache-2.0 OR ISC OR MIT | reqwest |
| hyper 1.11.1 (2026-08-28) | MIT | reqwest, hyper-util, hyper-rustls; hạ từ 1.12.0 (2026-10-06) |
| want 0.3.1 (2023-06-14), try-lock 0.2.5 (2023-12-07) | MIT | hyper; `want` hạ từ 0.3.2 (2026-10-05) |
| hyper-util 0.1.21 (2026-09-24), ipnet 2.12.2 (2026-09-06) | hyper-util: MIT; ipnet: MIT OR Apache-2.0 | reqwest |
| http-body 1.1.0 (2026-07-13), http-body-util 0.1.5 (2026-08-12) | MIT | reqwest, hyper |
| httparse 1.10.1 (2025-03-03) | MIT OR Apache-2.0 | hyper, tungstenite |
| atomic-waker 1.1.2 (2023-09-25) | Apache-2.0 OR MIT | hyper |
| tower 0.5.3 (2026-01-12), tower-layer 0.3.3 (2024-08-13), tower-service 0.3.3 (2024-08-13), tower-http 0.6.11 (2026-05-18) | MIT | reqwest |
| sync_wrapper 1.0.2 (2024-11-20) | Apache-2.0 | reqwest, tower |
| tokio-util 0.7.19 (2026-07-21) | MIT | reqwest (`stream`); hạ từ 0.7.20 (2026-10-09) |
| mio 1.2.3 (2026-09-02) | MIT | tokio (`net`); hạ từ 1.2.4 (2026-10-03) |
| socket2 0.6.5 (2026-07-13) | MIT OR Apache-2.0 | tokio (`net`), hyper-util |
| tokio-macros 2.7.2 (2026-07-29) | MIT | tokio (`macros`); proc-macro, chỉ chạy lúc biên dịch |
| futures-channel, futures-core, futures-sink, futures-task 0.3.34 (2026-08-11); slab 0.4.12 (2026-01-31) | futures-*: MIT OR Apache-2.0; slab: MIT | futures-util, hyper, reqwest |
| tungstenite 0.30.0 (2026-07-11), data-encoding 2.11.1 (2026-08-03) | tungstenite: MIT OR Apache-2.0; data-encoding: MIT | tokio-tungstenite |
| sha1 0.11.0 (2026-03-27); digest 0.11.3 (2026-05-03), block-buffer 0.12.1 (2026-06-11), crypto-common 0.2.2 (2026-05-19), hybrid-array 0.4.15 (2026-09-08), const-oid 0.10.2 (2026-01-07), cpufeatures 0.3.1 (2026-08-26) | MIT OR Apache-2.0 | tungstenite (khóa `Sec-WebSocket-Accept`) |
| rand 0.10.3 (2026-09-20), rand_core 0.10.1 (2026-04-13), chacha20 0.10.2 (2026-08-27) | MIT OR Apache-2.0 | tungstenite (mặt nạ frame phía client) |

`hyper`, `want`, `tokio-util` đã có trong `Cargo.lock` (Tauri dùng `reqwest` trên mobile) nhưng trước đây không build cho Windows. Các crate ghi "hạ từ" (bốn crate trên và `lazy_static` ở dưới) được đưa về bản mới nhất đủ 2 tuần bằng cách sửa đúng mục của chúng trong `Cargo.lock`, rồi kiểm bằng `cargo tree --locked`. Không dùng `cargo update -p … --precise`: lệnh này chọn lại cả phụ thuộc có khoảng nhiều major (`syn`, `windows-sys`) của crate không liên quan.

**Chỉ có trong `Cargo.lock`, không biên dịch cho Studio Windows x64.** License đều cho phép dùng thương mại; phát hành không sau 2026-09-24:

- nền tảng khác, kéo theo bởi `rustls-platform-verifier`:
  - Android: `jni` 0.22.4, `jni-macros` 0.22.4, `simd_cesu8` 1.2.0, `simdutf8` 0.1.5, `rustls-platform-verifier-android` 0.2.0 (MIT OR Apache-2.0);
  - macOS, iOS: `security-framework` 3.7.0, `security-framework-sys` 2.17.0 (MIT OR Apache-2.0);
  - Linux và nền tảng khác: `rustls-native-certs` 0.8.4 (Apache-2.0 OR ISC OR MIT), `openssl-probe` 0.2.1 (MIT OR Apache-2.0), `schannel` 0.1.29 (MIT), `webpki-root-certs` 1.0.9 (CDLA-Permissive-2.0, dữ liệu chứng chỉ gốc);
- Windows ARM64, kéo theo bởi `ring`: `windows-sys` 0.52.0, `windows-targets` và `windows_*` 0.52.6 (MIT OR Apache-2.0);
- phụ thuộc tùy chọn chưa bật của `rcgen` và `yasna`, Cargo vẫn ghi vào lock vì feature yếu (`x509-parser?/verify` của `rcgen`, `bit-vec?/std` của `yasna`): `x509-parser` 0.18.1, `asn1-rs` 0.7.2, `asn1-rs-derive` 0.6.0, `asn1-rs-impl` 0.2.0, `der-parser` 10.0.0, `oid-registry` 0.8.1, `rusticata-macros` 4.1.0, `minimal-lexical` 0.2.1, `num-bigint` 0.4.8, `num-integer` 0.1.47, `bit-vec` 0.9.1, `lazy_static` 1.5.0 (hạ từ 1.5.1 ngày 2026-10-01) (MIT OR Apache-2.0); `nom` 7.1.3, `synstructure` 0.13.2 (MIT).

Khi đóng gói sản phẩm: kèm license của các crate trong hai bảng trên (trừ `rcgen`, `pem`, `yasna`), gồm thông báo ISC của `ring`, `rustls-webpki`, `untrusted` và BSD-3-Clause của `subtle`.

## Feature 006 (Tag, Modbus, ghi Tag): rà lần cuối

- **Không thêm thư viện bên thứ ba** vào `mat-runtime`, Studio hay gói thiết bị: Modbus TCP/RTU, bộ giải mã khung, Tag Engine, bộ biểu thức (C++ và `@mat/expression`), mô phỏng (`@mat/tag-sim`), kho Tag giữ qua mất điện đều viết trong repo. Studio 0.4.0 chỉ đổi số phiên bản và thêm package workspace trong repo (`Cargo.toml`, `Cargo.lock`, `package-lock.json`); không có crate hay package npm bên ngoài mới.
- **Công cụ test (chỉ chạy trên máy dev/CI, không vào gói thiết bị hay bộ cài):** ảnh Docker `node:22.23.3-alpine` trong `tests/driver-it/compose.yaml` (chạy giả lập `tools/modbus-sim` và client `tests/driver-it/driver-it.mjs`; Node.js: MIT; Alpine: các license của từng gói, không phân phối lại), và ảnh `mat-armhf` dựng từ `deployment/toolchain/Dockerfile` (Ubuntu 20.04, như BL335). Giả lập `tools/modbus-sim` không có package ngoài, chỉ dùng module có sẵn của Node >= 22. Tài liệu tasks của feature từng ghi `node:24-slim`; thực tế compose dùng `node:22.23.3-alpine` (Node >= 24 chỉ là yêu cầu của máy dev, xem README).

## Feature 007 (màn hình v1, widget, điều khiển từ Chrome): thư viện web

- **uPlot 1.6.32** (MIT, tác giả Leon Sorokin; phát hành 2025-03-14, hơn 2 tuần trước ngày thêm; không phụ thuộc con): biểu đồ đường thời gian thực của `@mat/ui-components` (widget `line`), tải lười bằng `import()`. Đo T005: JS 22.009 B + CSS 772 B nén gzip (ADR-020). Bản min không chứa `eval`/`new Function`.
- **Báo cáo trên trình duyệt (feature 010, rà ngày 2026-10-14, task T005, T154):** `fflate` 0.8.3 (MIT, phát hành 2026-05-16; ZIP của XLSX), `pdfmake` 0.3.11 (MIT, phát hành 2026-06-12; PDF, kèm `vfs_fonts.js` phông Roboto, Apache-2.0 theo công bố của Google Fonts/Roboto), cả hai tải lười, 0 lỗ hổng `npm audit`; gzip: `fflate` 22 KB (cả thư viện), `pdfmake.min.js` 354 KB, phông Roboto 4 kiểu 465 KB (dùng 2 kiểu). Phụ thuộc con của `pdfmake` đều MIT (một gói `pdfkit`, `fontkit`, `linebreak`, `xmldoc`...), riêng `pako` 1.0.11 (MIT AND Zlib), `@swc/helpers` (Apache-2.0), `sax` (BlueOak-1.0.0), `tslib` (0BSD), `png-js` (không khai license trong package.json, repo MIT). `unpdf` 1.8.1 (MIT) chỉ để test. Chi tiết và số đo: [ADR-033](../docs/adr/033-browser-reports.md). Phiên bản ghim trong `packages/report-export/package.json`.
- **Mbed TLS (feature 007):** `third_party/mbedtls-config/mat_mbedtls_config.h` bật thêm `MBEDTLS_X509_CSR_WRITE_C` (sinh yêu cầu chứng chỉ PKCS#10 của `mat-runtime --make-csr`) và `MBEDTLS_X509_CSR_PARSE_C` (chỉ để test đọc lại yêu cầu). Cùng thư viện Apache-2.0 đã vendored, không thêm mã bên ngoài.

## Feature 008 (nhập SVG, binding, thư viện ký hiệu): rà lần cuối

- **Không thư viện mới.** Bộ nhập SVG (`@mat/svg-import`), bộ lọc allowlist và thư viện ký hiệu `@mat/symbols` viết trong repo, không thêm package npm hay crate bên ngoài.
- **Ký hiệu SVG do dự án tự vẽ** (15 tệp trong `packages/symbol-library/svg/`, giấy phép CC0-1.0, xem `packages/symbol-library/LICENSES.md`): không logo, hình ảnh hay phông chữ của hãng nào.

## Feature 011 (GĐ 6): rà license tự động, SBOM, ghi đè license

- Từ 011 (task T057, T095), license của mọi thành phần được rà bằng máy: `tools/release/license-report.mjs` (sinh `licenses.md` của bản phát hành, dừng khi có GPL, AGPL, LGPL link tĩnh hay license không rõ trong bản phân phối) và `tools/release/sbom.mjs` (SBOM CycloneDX 1.5 `sbom.cdx.json`). Nguồn: `package-lock.json` (và `node_modules/*/package.json`), `apps/studio/src-tauri/Cargo.lock` kèm `cargo metadata`, bảng thư viện vendored ở đầu tệp này (công cụ đọc các cột "Thư viện", "Phiên bản", "License", "Thư mục", "Dùng ở", "Nguồn"; thư viện ghi "chỉ test" coi là chỉ khi phát triển) và bảng ghi đè dưới đây. Kết quả lần chạy đầu: [docs/reports/011-license.md](../docs/reports/011-license.md).
- **MPL-2.0** (copyleft mức tệp) được dùng khi không sửa mã của thư viện; bản phân phối kèm nơi lấy mã nguồn. Trong Studio (`cargo tree -i … --target x86_64-pc-windows-msvc -e normal`, 2026-10-17): `option-ext` 0.2.0 (`dirs-sys` → `dirs` → `tauri`) được link vào `mat-studio.exe`; `cssparser`, `cssparser-macros`, `selectors`, `dtoa-short` chỉ chạy lúc biên dịch (`dom_query` → `tauri-utils` → `tauri-codegen`/`tauri-macros`, proc-macro), không có trong tệp thực thi. `axe-core` và `lightningcss` (MPL-2.0) chỉ dùng khi phát triển.
- Crate có lựa chọn LGPL (`MIT OR Apache-2.0 OR LGPL-2.1-or-later`): chọn MIT.

### Ghi đè license

Thành phần không khai báo license trong `package-lock.json`, `package.json` của gói hay `cargo metadata` nhưng đã rà tay. Công cụ đọc bảng này theo khóa `<npm|cargo|vendored>:<tên>@<phiên bản>`; đổi phiên bản thì phải rà lại.

| Thành phần | License | Lý do |
|---|---|---|
| `npm:png-js@1.1.0` | MIT | `package.json` của gói không có trường `license`; tệp `node_modules/png-js/LICENSE` là MIT License (Devon Govett, 2017). Kéo theo bởi `pdfmake` → `pdfkit` (báo cáo PDF trên trình duyệt, feature 010). Rà ngày 2026-10-17. |
