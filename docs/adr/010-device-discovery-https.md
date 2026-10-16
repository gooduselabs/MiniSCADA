# ADR-010: Tìm thiết bị trong LAN, HTTPS trên runtime, ghim chứng chỉ ở Studio

- **Trạng thái:** Accepted (2026-10-12, người dùng giao toàn quyền quyết định). Số đo trên x64 (Docker) đã có; **số đo trên BL335 chưa đo, chờ người dùng cho phép SSH** (T158–T165: bắt tay TLS, CPU của `tls-idle`, tìm thiết bị từ Windows 10/11, tường lửa Windows, SC-007). Nếu số trên BL335 vượt ngân sách thì ADR này được xem lại. Gốc: Proposed (feature 005; plan và câu hỏi của plan đã chốt ngày 2026-10-11, người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11). Chưa có số đo trên BL335.
- **Ngày:** 2026-10-11
- **Liên quan:** [specs/005-device-online](../../specs/005-device-online/plan.md), research R1–R6, R17, R18; contracts [discovery.md](../../specs/005-device-online/contracts/discovery.md), [device-api.md](../../specs/005-device-online/contracts/device-api.md), [tauri-commands.md](../../specs/005-device-online/contracts/tauri-commands.md); Constitution III, IV, V; [ADR-001](001-web-server.md), [ADR-002](002-commercial-os.md), [ADR-009](009-studio-ui-stack.md).

## Bối cảnh

Hôm nay kỹ sư gõ địa chỉ BL335 bằng tay. Runtime phục vụ HTTP không mã hóa và đang mở ra Internet qua port-forward 9080. Constitution V (2.0.0) chỉ cho bật API nạp xuống khi đã có HTTPS, đăng nhập, phân quyền và audit, và gói trả lời tìm thiết bị không được chứa bí mật.

Ràng buộc:

- **BL335:** Cortex-A7, không có lệnh AES/SHA; Ubuntu 20.04 với OpenSSL 1.1.1f (đã hết hỗ trợ); unit systemd có sandbox chặt (`RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`, không capability); RTC không đọc được.
- **Studio:** WebView2 không cho ghim chứng chỉ tự ký với `fetch`/`WebSocket`.
- **Trang xem trên Chrome:** giữ HTTP, không đăng nhập tới GĐ 2 (FR-033).

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Tìm thiết bị | mDNS/DNS-SD; multicast riêng; quét TCP cả subnet; lớp 2 (kiểu DCP); **UDP broadcast có hướng** | UDP broadcast có hướng, cổng 8446, trả lời unicast |
| Chống khuếch đại | giới hạn tần suất; **đệm gói hỏi bằng kích thước tối đa của gói trả lời** (cách của QUIC); ký gói trả lời | đệm 1024 byte + chỉ cùng subnet + giới hạn tần suất |
| Thư viện TLS của runtime | OpenSSL 1.1.1 của OS (CivetWeb nạp động); OpenSSL 3 vendored; **Mbed TLS 3.6 LTS vendored**; Mbed TLS 4.x; wolfSSL (GPL); reverse proxy | Mbed TLS 3.6.7, link tĩnh, cộng bản vá handshake cho CivetWeb |
| Listener | một context hai cổng; **hai context**; chỉ HTTPS | hai context: HTTP 8080 (trang xem, như cũ), HTTPS 8443 (thêm API kỹ thuật) |
| Chứng chỉ | sinh trong `deploy.sh` bằng `openssl`; **runtime tự sinh ở lần chạy đầu**; CA của khách hàng | ECDSA P-256 tự ký, runtime tự sinh; CA của khách hàng để GĐ 2 |
| Studio nói chuyện với thiết bị | WebView + bỏ kiểm chứng chỉ; plugin HTTP của Tauri (không ghim được); proxy cục bộ; **kết nối trong Rust có verifier ghim** | rustls + ring, reqwest, tokio-tungstenite |

## Quyết định

1. **Tìm thiết bị:**
   - Gói hỏi dài đúng 1024 byte. Gói trả lời ≤ 1024 byte, JSON, không có bí mật.
   - Thiết bị chỉ trả lời nguồn cùng subnet với card nhận và cổng nguồn ≥ 1024.
   - Giới hạn: 1 trả lời/s mỗi nguồn (dồn 3), 20 trả lời/s tổng.
   - Lấy địa chỉ card bằng `ioctl`, không cần netlink.
   - Tắt bằng `discoveryEnabled`.
   - Studio gửi theo từng card (0, 600, 1200 ms), nhận tới 2,5 s.
2. **TLS:**
   - Mbed TLS 3.6.7 (Apache-2.0), cấu hình tối thiểu: TLS 1.2 và 1.3 phía server, ECDHE (X25519, P-256), ECDSA P-256, AES-GCM, ChaCha20-Poly1305. Gọi `psa_crypto_init()` một lần khi khởi động (thư viện cũng tự gọi khi bắt tay TLS 1.3), để lỗi khởi tạo lộ ra trước khi mở cổng.
   - Bản vá cục bộ thứ ba cho CivetWeb: handshake `poll()` có hạn `request_timeout_ms`, thay vòng lặp quay CPU.
3. **Listener:**
   - HTTP giữ nguyên hành vi.
   - HTTPS (`httpsPort`, mặc định 8443, 8 worker; request 10 s, kết nối rảnh giữ 15 s) phục vụ thêm API kỹ thuật. API kỹ thuật gọi qua HTTP nhận 403 `HTTPS_REQUIRED`.
   - Hai context dùng chung giới hạn 10 phiên live.
   - HTTPS lỗi thì trang xem vẫn chạy.
4. **Chứng chỉ:**
   - `<dataDir>/tls/server.pem` (`0600`, `matscada`), ECDSA P-256, tự ký, hạn tới 9999.
   - Fingerprint = SHA-256 của DER.
   - Hỏng thì không tự sinh lại: tắt HTTPS, báo `cert-error`.
   - Lệnh `--cert-fingerprint`, `--regen-cert` (có audit).
   - Hồ sơ chứng chỉ và cách kiểm file có sẵn: mục "Số đo / bằng chứng", phần T038, T039.
5. **Studio:**
   - mọi kết nối tới thiết bị đi qua Rust;
   - `PinnedVerifier` so SHA-256 chứng chỉ với ghim, bỏ qua CA, tên và hạn, nhưng vẫn kiểm chữ ký bắt tay;
   - lần đầu hiện fingerprint đầy đủ để người dùng xác nhận; ghim chỉ nhận đúng fingerprint vừa dò;
   - fingerprint đổi thì chặn, hiện cũ và mới; gỡ ghim cần xác nhận rõ;
   - token phiên chỉ trong Rust;
   - CSP bỏ `http: ws:`.

## Hệ quả

- **Tốt:**
  - API kỹ thuật có kênh mã hóa và xác thực máy chủ, mà không cần CA.
  - Trang xem và vận hành không bị ảnh hưởng khi HTTPS lỗi hay bị tấn công.
  - Runtime không phụ thuộc OpenSSL của OS: hợp với Buildroot (ADR-002).
  - Studio không tự kết nối mạng từ WebView nữa.
- **Xấu:**
  - Thêm khoảng 6 MB mã nguồn vendored và một bản vá CivetWeb phải giữ khi nâng cấp.
  - Bắt tay ECC bằng C chậm hơn OpenSSL có asm (ước 10–40 ms CPU mỗi kết nối; keep-alive giảm số lần).
  - Lần kết nối đầu dựa vào người dùng so fingerprint (TOFU).
  - Một máy trong LAN chiếm được cả 8 worker HTTPS, mỗi lần tới 15 s (keep-alive) hoặc 10 s (bắt tay im lặng). Khi đó Studio hợp lệ phải chờ hoặc báo `timeout`. Trang xem không bị ảnh hưởng. Xem mục "Keep-alive của HTTPS" ở dưới.
  - Gói tìm thiết bị cho cả LAN biết phiên bản runtime và mã project.
  - Mã của 004 phải chuyển sang adapter Rust (`DeviceSession`, CSP).
  - Nhánh 3.6 LTS hết hỗ trợ khoảng 2027-03.

## Số đo / bằng chứng

- Đọc mã CivetWeb 1.16: worker nhận socket non-blocking (`civetweb.c` dòng 20070); `mbed_ssl_handshake` lặp không ngủ (`mod_mbedtls.inl` dòng 207–216); nhánh OpenSSL chờ có hạn (`sslize`).
- Phiên bản tra ngày 2026-10-11:

  | Thư viện | Bản chọn | Ghi chú |
  |---|---|---|
  | Mbed TLS | 3.6.7 (2026-07-07) | 4.1 LTS tới 2029-03 |
  | CivetWeb | 1.16 (2023-04) | bản mới nhất |
  | rustls | 0.23.45 (2026-09-14) | |
  | ring | 0.17.14 | |
  | tokio-rustls | 0.26.5 (2026-09-04) | |
  | tokio-tungstenite | 0.30.0 (2026-07-11) | |
  | reqwest | 0.13.5 | đã có trong `Cargo.lock` |
  | if-addrs | 0.15.0 | |
- BL335 có `libssl.so.1.1` ([device-profile.md](../reports/device-profile.md)).
- **Spike T007 (2026-10-11): CivetWeb 1.16 + Mbed TLS 3.6.7, x64 và armhf dưới qemu-user.**
  - **Cờ chốt:**
    - `civetweb_runtime`: `USE_MBEDTLS NO_CGI USE_WEBSOCKET NO_FILES` (bỏ `NO_SSL`), link `mat_mbedtls`. Với `USE_MBEDTLS`, CivetWeb chỉ đọc `ssl_certificate`; `ssl_protocol_version`, `ssl_cipher_list` không có tác dụng. Chính sách TLS vì vậy nằm trọn trong file cấu hình Mbed TLS.
    - `mat_mbedtls`: mọi file `library/*.c`, `-w -O2` (mức tối ưu Mbed TLS khuyên dùng để giữ mã hằng thời gian), `MBEDTLS_CONFIG_FILE="mat_mbedtls_config.h"` truyền PUBLIC cho mọi target dùng.
    - Cấu hình `third_party/mbedtls-config/mat_mbedtls_config.h`, ngoài danh sách của R4:
      - `MBEDTLS_NET_C`, `MBEDTLS_FS_IO`: CivetWeb dùng `mbedtls_net_send/recv` và đọc file chứng chỉ;
      - `MBEDTLS_HKDF_C`: TLS 1.3 cần HKDF của PSA;
      - `MBEDTLS_SSL_KEEP_PEER_CERTIFICATE`: TLS 1.3 của bản 3.6 bắt buộc;
      - `MBEDTLS_PSA_KEY_STORE_DYNAMIC`: nhiều lần bắt tay song song không hết khe khóa;
      - `MBEDTLS_ECDSA_DETERMINISTIC` (cần `HMAC_DRBG`): chữ ký không phụ thuộc RNG;
      - `MBEDTLS_AES_ROM_TABLES`: bảng AES hằng, không khởi tạo lười giữa các luồng;
      - `MBEDTLS_SSL_CIPHERSUITES`: 6 bộ AEAD. TLS 1.2 theo thứ tự của máy chủ, ChaCha20-Poly1305 trước: Cortex-A7 không có lệnh AES, và AES bằng bảng vừa chậm vừa lộ thời gian (SECURITY.md của Mbed TLS, mục "Block ciphers"). TLS 1.3 theo thứ tự của client (`ssl_tls13_select_ciphersuite`): muốn BL335 dùng ChaCha20-Poly1305 với Studio qua TLS 1.3 thì phía Rust phải đặt nó lên đầu danh sách của rustls. **Đã chốt 2026-10-11** (người dùng giao toàn quyền quyết định): `CryptoProvider` của Studio xếp `TLS13_CHACHA20_POLY1305_SHA256` trước hai bộ AES-GCM của TLS 1.3, và `TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256` trước hai bộ AES-GCM của TLS 1.2; giữ đủ các bộ AES-GCM để vẫn nối được máy chủ khác. Chỉ đổi thứ tự ưu tiên, không bớt độ an toàn: cả hai đều là AEAD 256 bit (ChaCha20) hoặc 128/256 bit (AES-GCM). Chrome tự chọn theo phần cứng của máy khách; trang xem HTTP 8080 không bị ảnh hưởng.
  - **Lỗi gặp và cách sửa:**
    - `mod_mbedtls.inl` biên dịch với 3.6.7 không cần sửa, cả x64 lẫn armhf. Với `-Wall -Wextra` chỉ có 3 cảnh báo tham số không dùng trong `mbed_debug` (vì `DEBUG_TRACE` bị tắt); không có cảnh báo khai báo ngầm hay sai kiểu con trỏ. Không có bản vá mới.
    - Lỗi chỉ nằm ở test: `mbedtls_version_get_string()` nhận bộ đệm; tên `Run` trùng `testing::Test::Run`.
    - `pull_inner` in `SSL read failed, error -30848` ra stderr mỗi khi client đóng TLS đúng cách (`MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY`), tức một dòng log cho mỗi kết nối. Chưa sửa: ghi cho Phase 2 (bản vá cùng T037 hoặc riêng).
  - **Kết quả** (`server/tests/tls_spike_test.cpp`, tạm thời, đã xóa ở T036: phần đáng giữ chuyển sang `server/tests/https_handshake_test.cpp`; cộng chương trình tương tự build cho armhf, chạy dưới qemu):
    - curl 7.68 và OpenSSL 1.1.1f của image: TLS 1.2 chọn `ECDHE-ECDSA-CHACHA20-POLY1305`; TLS 1.3 chọn `TLS_AES_256_GCM_SHA384` (thứ tự của OpenSSL). Nhóm trao đổi khóa X25519 mặc định, P-256 khi client chỉ đưa P-256.
    - Bị từ chối bằng alert 40 (`handshake_failure`): bộ CBC (`ECDHE-ECDSA-AES128-SHA256`), trao đổi khóa RSA (`AES128-GCM-SHA256`), client TLS 1.2 chỉ có P-384. Client TLS 1.3 chỉ có P-384: máy chủ đóng kết nối, không gửi alert. HTTP thường vào cổng TLS: bị đóng.
    - Test không gọi `psa_crypto_init()`, TLS 1.3 vẫn chạy: thư viện tự khởi tạo PSA (Mbed-TLS #9072).
    - 40 kết nối TLS 1.3 và 40 kết nối TLS 1.2 đồng thời vào context 4 worker: 40/40 mỗi loại, trên x64 và qemu armhf.
    - Bắt tay trên x64: TLS 1.3 khoảng 4,6 ms; kết nối TLS 1.2 đầu tiên 46,7 ms. Sinh khóa P-256 và chứng chỉ: 1 ms. Số đo dưới qemu (21–68 ms) không đại diện cho BL335.
    - **Client mở TCP rồi im lặng trong lúc bắt tay: tiến trình tốn 1498 ms CPU trong 1500 ms** (một nhân 100 %, x64). Xác nhận rủi ro ở R4, cần bản vá 3 (T037).
    - `mat-runtime` armhf: 1 957 896 → 2 202 212 byte (+244 316; bản strip 1 512 540 → 1 696 996). Thư viện động cần nạp (`NEEDED`) không đổi: Mbed TLS link tĩnh, không phụ thuộc `libssl`.
  - **Chuẩn bị bản vá 3 (T037):**
    - `mbed_ssl_accept` chỉ nhận socket và `phys_ctx`. Bản vá cần thêm hạn `request_timeout_ms` và `stop_flag`, để `mg_stop` không phải chờ một lần bắt tay đang treo.
    - `mg_poll` được định nghĩa sau chỗ include `mod_mbedtls.inl` (`civetweb.c` dòng 5938, so với dòng 1742): cần khai báo trước, hoặc dùng `poll()` trực tiếp.
    - Kết quả của `mbedtls_ssl_setup` chưa được kiểm (lỗi cấp phát).
- **Bản vá 3 và 4 của CivetWeb (T036, T037, 2026-10-11), x64.** Mô tả bản vá ở `third_party/LICENSES.md`, mục "Bản vá cục bộ". Test `server/tests/https_handshake_test.cpp`: CivetWeb chạy trong tiến trình với `request_timeout_ms` 10000 như runtime, client là libcurl 7.68 và OpenSSL 1.1.1f của image. CPU là thời gian CPU của chính tiến trình (`getrusage`), nên tải khác trên máy không tính vào.

  | Số đo | Trước vá | Sau vá |
  |---|---|---|
  | CPU khi rảnh, 1 s | 0,6 ms (0,06 %) | 0,7 ms (0,07 %) |
  | CPU khi có 8 kết nối TCP im lặng, 5 s | 39 911 ms (798 %: 8 nhân quay) | 0,5 ms (0,01 %) |
  | Kết nối im lặng bị đóng sau | không bị đóng (còn mở sau 13 s) | 10,0 s, cả 8 kết nối |
  | Client gửi từng byte của ClientHello, 200 ms một byte (`request_timeout_ms` 3000) | không bị đóng (còn mở sau 6 s) | 3,0 s |
  | `mg_stop` khi có một client im lặng | chờ tới khi client đi (8,0 s trong test) | 1,75 s |
  | Dòng `SSL read failed` khi 4 client đóng đúng cách | 4 | 0 |

  - Trong lúc 8 kết nối im lặng chờ, một client bình thường vẫn bắt tay được (context của test có 12 worker).
  - Worker ngủ trong `poll()` và chỉ thức dậy mỗi 2 s (`SOCKET_TIMEOUT_QUANTUM`) để xem cờ dừng, nên CPU khi có kết nối im lặng gần bằng 0.
  - **Còn mở:** context HTTPS của runtime có 8 worker (`httpsThreads`). 8 kết nối im lặng giữ cả 8 worker tới 10 s, và client thứ 9 xếp hàng tới khi một kết nối hết hạn. Bản vá chặn được CPU và thời gian giữ worker, không chặn được việc chiếm hết worker. Cần xét ở T044 và kịch bản `tls-idle` (T051).
- **Keep-alive của HTTPS: 15 s → 3 s (đổi 2026-10-16, feature 011; người dùng giao toàn quyền).**
  - **Số đo:** `web-it f5x10` trên macOS: 10 trang vừa mở bấm F5 cùng lúc để lại 41 kết nối HTTPS cho 40 worker (đếm `/proc/net/tcp` trong container); kết nối keep-alive rảnh từ lần tải đầu giữ worker tới 10 s, nên 4 WebSocket live chờ worker khoảng 8,2 s (bản ghi CDP: 6 trang bắt tay `101` sau 15 ms, 4 trang sau 8,2 s). Đỏ 3/5 lần ở cả bản trước 011 (`7e7643f`) lẫn `gd6`: lỗi có sẵn, không phải hồi quy.
  - **Sửa:** `kHttpsKeepAliveMs` 3000, Studio `POOL_IDLE_TIMEOUT` 2 s (vẫn đóng trước thiết bị). Sau sửa: 6/6 lần đạt, xấu nhất 3,2 s (bằng keep-alive), đa số dưới 0,31 s. Test `HttpsApi.IdleKeepAliveConnectionClosesAfter3s` (đỏ ở 15,0 s, xanh ở 3,0 s), Rust `timeouts_follow_the_research`.
  - **Đánh đổi:** Studio hỏi tối đa mỗi 5 s nên thường bắt tay lại mỗi lần hỏi: ≤ 1 bắt tay/2–5 s, 10–40 ms CPU mỗi lần trên BL335 (ước, chưa đo), dưới 1 % CPU. Hồ worker vẫn sát giới hạn; giới hạn kết nối theo nguồn (011 T048, R10) xử lý phần còn lại.
- **Keep-alive của HTTPS: 60 s → 15 s (chốt 2026-10-12, phiên làm việc được người dùng giao toàn quyền).**
  - **Vấn đề:** T044 đặt `keep_alive_timeout_ms` 60 s. CivetWeb giữ một worker cho mỗi kết nối đang mở, kể cả lúc rảnh giữa hai request. Vậy 8 máy bất kỳ trong LAN, mỗi máy gửi một request rồi im, giữ hết 8 worker tới 60 s, lâu gấp 6 lần trường hợp bắt tay im lặng (10 s).
  - **Quyết định:**
    - thiết bị: `kHttpsKeepAliveMs` = 15 000 (`server/http/web_contexts.hpp`);
    - Studio: `pool_idle_timeout` 30 s → 10 s (`apps/studio/src-tauri/src/device/http.rs`), vẫn đóng trước thiết bị (analyze C7).
  - Không hạ thấp hơn: Studio hỏi tiến trình nạp xuống mỗi 500 ms và theo dõi chẩn đoán mỗi vài giây, nên 10–15 s vẫn đủ để Studio dùng lại kết nối, khỏi bắt tay lại. Trên BL335 mỗi lần bắt tay tốn 10–40 ms CPU (ước).
  - **Test:**
    - C++: `HttpsApi.IdleKeepAliveConnectionClosesAfter15s`, đỏ với 60 s (kết nối còn mở sau 30 s), xanh với 15 s (đóng sau 15,0 s);
    - Rust: `timeouts_follow_the_research`, đỏ với 30 s, xanh với 10 s.
  - **Số đo x64** (`tools/device-it.ps1 -Scenario tls-idle`, `docs/reports/005-tls-idle-x64.json`; runtime trong container, client Node trên cùng mạng Docker):

    | Trường hợp, 8 kết nối vào 8443 | CPU runtime | RSS | Bị đóng sau | Client thứ 9 chờ |
    |---|---|---|---|---|
    | Rảnh (đối chứng, 10 s) | 0 % | 8,1 MiB | | |
    | TCP im lặng, không bắt tay | +0,1 điểm | 8,1 MiB | 10,0 s (cả 8) | 8,0 s (gửi lúc 2 s), rồi 200 |
    | Bắt tay xong, 1 request keep-alive, rồi im | +0,2 điểm | 8,1 MiB | 14,6–15,0 s | 12,6 s (gửi lúc 2 s), rồi 200 |

  - **Rủi ro còn lại (chấp nhận):** một máy trong LAN vẫn chiếm được cả 8 worker, mỗi lần tới 15 s, và mở lại được ngay. Trong lúc đó, Studio hợp lệ phải chờ. Hạn 3 s kết nối và 10 s request của Studio có thể hết trước, và Studio báo `timeout`. Trang xem HTTP 8080 và dữ liệu sống của vận hành không bị ảnh hưởng (context riêng). Giới hạn số kết nối theo IP cần sửa CivetWeb thêm, để GĐ 2 nếu thực tế cần. Mỗi phiên `wss` của Studio cũng giữ một worker suốt phiên.
- **Chứng chỉ thiết bị (T038, T039, 2026-10-11).** Mã ở `server/tls/server_cert.{hpp,cpp}`, test ở `server/tests/server_cert_test.cpp` (25 test).
  - **Hồ sơ chứng chỉ:**
    - X.509 v3, ký bằng ecdsa-with-SHA256; CN `mAT <deviceName>` (UTF8String); SAN `DNS:<hostname>`;
    - serial 16 byte ngẫu nhiên, byte đầu trong 0x01–0x7F (số dương, DER tối thiểu); hạn 2000-01-01 00:00:00Z → 9999-12-31 23:59:59Z;
    - basicConstraints `CA:FALSE` (không critical, mặc định của Mbed TLS), keyUsage `digitalSignature` (critical), extKeyUsage `serverAuth` (không critical, như đa số CA);
    - không có SKI, AKI: Mbed TLS tính SKI bằng SHA-1, mà SHA-1 đã tắt trong cấu hình; RFC 5280 cho phép bỏ AKI ở chứng chỉ tự ký.
  - **Kiểm cấu trúc:**

    | Bên kiểm | Kết quả |
    |---|---|
    | OpenSSL 1.1.1f của image (trong test) | `x509 -text` đọc đủ trường; `-purpose`: "SSL server : Yes", "SSL server CA : No"; `verify -partial_chain -x509_strict -purpose sslserver`: OK; `-fingerprint -sha256` trùng fingerprint của module, trên file và qua `s_client` |
    | OpenSSL, kiểm riêng một lần | chữ ký tự ký kiểm độc lập bằng `dgst -sha256 -verify` trên phần TBS: OK |
    | rustls 0.23.45 + ring 0.17.14, cùng bản của Studio (chương trình tạm, không vào repo) | verifier kiểu `PinnedVerifier`: webpki parse được (`EndEntityCert::try_from`); TLS 1.2 (ECDHE-ECDSA-CHACHA20-POLY1305) và TLS 1.3 bắt tay, chữ ký bắt tay qua kiểm; ghim sai bị chặn |
    | Chrome 154 headless, đọc qua DevTools Protocol | lỗi duy nhất là `ERR_CERT_AUTHORITY_INVALID` (tự ký, chưa được tin); không có lỗi cấu trúc hay chữ ký yếu; đọc đúng `sanList`, hạn, chữ ký máy chủ `ecdsa_secp256r1_sha256`. Bỏ qua lỗi chứng chỉ thì tải được trang |

    `openssl verify` không có `-partial_chain` báo "unable to get local issuer certificate". OpenSSL chỉ coi chứng chỉ tự ký là nhà phát hành của chính nó khi keyUsage có `keyCertSign`, mà RFC 5280 §4.2.1.9 không cho `keyCertSign` khi `CA:FALSE`. Vì vậy không đổi chứng chỉ.
  - **Số đo** (chương trình tạm ở scratchpad, không vào repo):

    | Số đo (trung vị) | x64, Docker | armhf dưới qemu, chỉ tham khảo |
    |---|---|---|
    | Sinh khóa và chứng chỉ, ghi lên tmpfs (gần bằng thời gian CPU) | 0,37 ms | 3,5 ms |
    | Như trên, ghi lên overlay/ext4, có `fsync` file và thư mục | 19,8 ms | 15,8 ms |
    | Đọc và kiểm file có sẵn: parse, khớp cặp khóa, chữ ký tự ký | 0,8 ms | 7,7 ms |
    | Kích thước `server.pem` | 797–801 byte (chứng chỉ DER 381 byte) | như x64 |

    File do bản armhf sinh được OpenSSL và bản x64 đọc, cùng fingerprint. Trên BL335 chưa đo (task ⚠️🔌): ước vài chục ms cho lần sinh đầu, cộng thời gian `fsync` của eMMC.
  - **Quyết định khi làm:**
    - File có sẵn phải tự ký bằng đúng khóa trong file (kiểm cả chữ ký), nên một byte hỏng ở bất kỳ đâu cho `cert-error` thay vì một fingerprint lạ. CA của khách hàng (GĐ 2) sẽ phải nới luật này.
    - Hostname không phải tên DNS hợp lệ thì bỏ SAN, không ghi dNSName sai dạng.
    - Đổi `deviceName` hay hostname không sinh lại chứng chỉ: danh tính đã ghim giữ nguyên, CN cũ chỉ còn là thông tin.
    - Kiểm chữ ký tự ký phải đọc trường riêng `sig` của `mbedtls_x509_crt`, vì không có hàm công khai nào kiểm chữ ký của chứng chỉ đầu cuối tự ký. Khi lên Mbed TLS 4.x phải xem lại chỗ này.
- **Chưa đo, làm ở task ⚠️🔌:** RSS và CPU khi rảnh và khi tải (ước +1,5–3 MB, < 0,5 điểm); thời gian bắt tay; tìm thiết bị 10/10 lần ≤ 3 s trong LAN thật; hộp thoại tường lửa trên Windows 10/11.

## Số đo x64 khi nghiệm thu (2026-10-12, `tools/device-it.ps1`)

- Bắt tay TLS 1.3 16 ms, đăng nhập trung vị 66 ms (x64): [005-auth-x64.json](../reports/005-auth-x64.json). Tám kết nối TCP im lặng bị đóng sau 10 s, tám kết nối TLS giữ keep-alive bị đóng sau 15 s, CPU tăng không quá 0,2 điểm: [005-tls-idle-x64.json](../reports/005-tls-idle-x64.json).
- Tìm thiết bị: hai runtime trả lời trong 3 đến 50 ms, runtime tắt tìm thiết bị im lặng, nguồn ngoài subnet không được trả lời: [005-discovery-x64.json](../reports/005-discovery-x64.json).
- Mười tab Chrome đang xem: nạp xuống làm cả mười tab tải lại; tab cuối tải lại 3,1 s sau khi gửi gói (trước khi thao tác báo xong): [005-reload-x64.json](../reports/005-reload-x64.json).
- **Chưa đo, chờ SSH tới BL335:** thời gian bắt tay và CPU `tls-idle` trên Cortex-A7, tìm thiết bị trên Windows 10 và 11 và hộp thoại tường lửa (R3), RSS rảnh (SC-007).

## Điều kiện xem xét lại

- Trước 2027-03 (hết hỗ trợ nhánh 3.6): chuyển sang Mbed TLS 4.1 LTS. Cần sửa module Mbed TLS của CivetWeb, hoặc bỏ CivetWeb.
- Đo thấy bắt tay hay RAM của Mbed TLS vượt ngân sách: xét OpenSSL (của OS hoặc trong image Buildroot).
- GĐ 2 (trang web cần đăng nhập để ghi Tag): HTTPS cho trang xem, quy trình nạp chứng chỉ CA của khách hàng, cookie `Secure`.
- Có yêu cầu tìm thiết bị qua router hoặc IPv6: xét mDNS hoặc máy chủ đăng ký.
