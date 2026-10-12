# Research: Làm việc với thiết bị từ Studio

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Ngày**: 2026-10-11

Phase 0 của plan. Mỗi mục gồm **Quyết định**, **Lý do**, **Đã cân nhắc**.

- **Phiên bản thư viện:** theo quy tắc của [ADR-009](../../docs/adr/009-studio-ui-stack.md), chọn bản phát hành ít nhất 2 tuần trước ngày chọn, tức trước 2026-09-27. Tra ngày 2026-10-11 trên crates.io và GitHub Releases (bảng ở R19).
- **Số đo thiết bị** lấy từ `docs/reports/`. Chỗ chưa biết ghi "đo ở task ⚠️🔌": cần người dùng cho phép thao tác trên BL335.

**Mốc so sánh** (runtime 0.3.0 trên BL335, [003-acceptance.md](../../docs/reports/003-acceptance.md)):

| Chỉ số | Giá trị |
|---|---|
| RSS lúc mới chạy | 4,3 MB |
| Tải chuẩn (500 Tag/1 s, 10 client, lưu trữ), 30 phút | RSS tối đa 13,7 MB; CPU toàn hệ thống trung bình 11,7 %, p95 20,9 % |
| CPU rảnh của hệ thống (Sprint 0) | 7,25 %, gồm timer `atscada-*` của sản phẩm cũ |
| `kill -9` rồi systemd chạy lại | 3–4 s (`RestartSec=2`) |
| Phần cứng | Cortex-A7 2 nhân, không có lệnh AES/SHA; RAM 993 MB; `/` còn 6,1 GB; systemd 245; có `libssl.so.1.1` |

## R1. Tìm thiết bị: UDP broadcast trong subnet

- **Quyết định:**
  - Studio gửi UDP broadcast IPv4 có hướng (ví dụ `192.168.1.255`) ra card người dùng chọn, tới cổng **8446/udp**.
    - IANA chưa cấp cổng này (8446–8447 đang trống).
    - Đổi được bằng khóa `discoveryPort`.
  - Thiết bị trả lời unicast về đúng địa chỉ và cổng nguồn.
  - IPv6 làm sau.
- **Lý do:**
  - Router mặc định không chuyển tiếp broadcast có hướng (RFC 2644), nên gói chỉ đi trong subnet của card: đúng phạm vi "trong LAN" của lộ trình §5. Thiết bị cũng chỉ trả lời nguồn cùng subnet (R2), phòng router cấu hình khác.
  - Không cần IGMP. Switch công nghiệp cấu hình chặt hay chặn multicast.
  - Trả lời unicast về cổng nguồn khớp quy tắc mặc định của tường lửa Windows (R3).
  - Phía thiết bị chỉ cần một socket UDP, không thêm thư viện.
- **Đã cân nhắc:**
  - **mDNS/DNS-SD:** cần Avahi (LGPL-2.1, chưa có trên BL335) hoặc tự viết. Trả lời multicast cho cả mạng.
  - **Multicast tự định nghĩa (239.x):** như broadcast nhưng thêm IGMP; trong một subnet không lợi gì.
  - **Quét TCP cả subnet:** 254 địa chỉ, chậm; giống quét cổng nên dễ bị IDS chặn.
  - **Lớp 2 (kiểu Siemens DCP):** cần raw socket. Windows phải cài Npcap và có quyền admin; thiết bị cần `CAP_NET_RAW`, trong khi unit đang để `CapabilityBoundingSet=` rỗng.

## R2. Gói tìm thiết bị: định dạng, chống khuếch đại, giới hạn tần suất

- **Quyết định** (contract: [discovery.md](contracts/discovery.md)):
  - **Gói hỏi dài đúng 1024 byte:** `MATD`, version `1`, type `1`, 2 byte cờ, nonce 16 byte, rồi 1000 byte `0`.
  - **Gói trả lời:**
    - cùng phần đầu 24 byte (type `2`, nonce lặp lại), rồi JSON UTF-8 tối đa 1000 byte;
    - tổng ≤ 1024 byte, **không bao giờ dài hơn gói hỏi**;
    - thiếu chỗ thì bỏ `project.name`, rồi cắt `name`, và bật cờ `truncated`.
  - **Thiết bị chỉ trả lời khi đủ mọi điều kiện:**
    - gói dài đúng 1024 byte, đúng magic, version, type;
    - địa chỉ nguồn cùng subnet với card nhận được gói. Card lấy bằng `IP_PKTINFO`; địa chỉ và netmask của card lấy bằng `ioctl(SIOCGIFCONF, SIOCGIFNETMASK)`, cache 30 s;
    - cổng nguồn ≥ 1024;
    - nguồn không phải `0.0.0.0`, broadcast hay multicast.
  - **Giới hạn tần suất:**
    - mỗi địa chỉ nguồn 1 trả lời/s, cho dồn tới 3 (Studio gửi 3 lần mỗi lượt quét);
    - tổng 20 trả lời/s;
    - bảng nguồn 64 mục (LRU). Vượt giới hạn thì im lặng.
  - **Nội dung gói trả lời:** tên, model, MAC, IP, prefix, phiên bản runtime và API, trạng thái, project (mã, tên, phiên bản, digest), cổng HTTPS và HTTP, fingerprint chứng chỉ, `deviceId`. Không có mật khẩu, khóa, token hay tên tài khoản (Constitution V).
  - **Tắt được:** `discoveryEnabled: false` trong `runtime.json` (mặc định bật). Khi tắt, runtime không mở socket.
  - **Thiết bị không parse JSON từ mạng:** gói hỏi chỉ có phần đầu cố định.
- **Lý do:**
  - **Chống khuếch đại:** đệm gói hỏi bằng kích thước tối đa của gói trả lời là cách QUIC làm (RFC 9000 §8). Kẻ giả địa chỉ nguồn không nhận lại nhiều byte hơn số đã gửi.
  - **Không phản xạ ra ngoài:** chỉ trả lời nguồn cùng subnet, và router không chuyển broadcast. Cổng nguồn < 1024 thường là dịch vụ hệ thống, nên không trả lời để tránh phản xạ vào chúng.
  - **Kích thước:** 1024 byte vẫn dưới MTU 1500, không phân mảnh. Mỗi lượt quét tốn 3 KB mỗi card. Gói trả lời mẫu khoảng 450 byte; trường hợp xấu (tên project 64 ký tự tiếng Việt) khoảng 750 byte.
  - **Nonce:** Studio bỏ được trả lời cũ, hoặc trả lời không do mình hỏi.
  - **Nhiều card trên thiết bị:** BL335 có `eth1` (LAN), `usb0` (modem), `eth2` ([device-profile.md](../../docs/reports/device-profile.md)). Kiểm theo card nhận, nên gói đến từ `eth1` mà nguồn thuộc subnet của `usb0` thì không được trả lời.
  - **`ioctl` thay `getifaddrs()`:** `getifaddrs` của glibc dùng netlink, mà unit đang `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`. Dùng `ioctl` thì không phải nới sandbox.
- **Đã cân nhắc:**
  - JSON cho cả gói hỏi: thiết bị phải parse dữ liệu từ mạng, không cần thiết.
  - Gói trả lời nhị phân (TLV): khoảng 200 byte, nhưng khó gỡ lỗi; 1024 byte đã đủ cho JSON.
  - Ký gói trả lời bằng khóa của thiết bị: không thêm an toàn, vì mọi kết nối sau đó đều qua TLS có ghim (R6), và lần đầu vẫn phải xác nhận fingerprint.

## R3. Tìm thiết bị phía Studio: card mạng, tường lửa Windows, ≤ 3 s

- **Quyết định:**
  - **Liệt kê card:** Rust dùng crate `if-addrs` 0.15.0, lấy card IPv4 đang bật: tên, địa chỉ, prefix, địa chỉ broadcast.
    - Card `/31`, `/32` hoặc không có broadcast (card VPN thường như vậy) hiện mờ, kèm gợi ý "Thêm theo địa chỉ".
    - Mặc định chọn "Tất cả card có broadcast".
  - **Gửi:** mỗi card một socket UDP bind vào địa chỉ của card, cổng ngẫu nhiên, bật `SO_BROADCAST`. Gửi tới broadcast có hướng của card lúc 0, 600 và 1200 ms, cùng nonce.
  - **Nhận:** tới 2500 ms. Kết quả đẩy dần lên giao diện qua `Channel` của Tauri, gộp theo `deviceId` + IP.
  - **Kiểm gói trả lời:**
    - đủ 24 byte đầu, đúng nonce, ≤ 1024 byte;
    - JSON đúng schema, bỏ qua trường lạ (để version 1 thêm trường được);
    - IP lấy theo địa chỉ nguồn UDP, không theo trường `ip` trong JSON.
  - **Không thấy thiết bị nào:** Studio gợi ý kiểm tường lửa Windows, và dùng Thêm theo địa chỉ.
- **Lý do:**
  - Windows chỉ gửi `255.255.255.255` ra một card, theo bảng định tuyến. Broadcast có hướng, bind theo từng card, đi đúng card người dùng chọn (Edge case nhiều card).
  - **Tường lửa Windows:**
    - Mặc định, tường lửa cho phép trả lời unicast tới gói broadcast hay multicast máy này gửi đi, trong 3 s (tài liệu Microsoft: [`UnicastResponsesToMulticastBroadcastDisabled`](https://learn.microsoft.com/en-us/windows/win32/api/netfw/nf-netfw-inetfwprofile-put_unicastresponsestomulticastbroadcastdisabled); chính sách nhóm "Prohibit unicast response to multicast or broadcast requests" mặc định chưa bật).
    - Thiết bị trả lời unicast về cổng nguồn, nên không cần thêm luật tường lửa. Cửa sổ 3 s cũng khớp thời hạn quét.
    - Cần kiểm trên Windows 10 và 11, kể cả xem Windows có hiện hộp thoại "cho phép ứng dụng" không. Kiểm trên máy dev, không cần thiết bị.
  - Gửi 3 lần để bù mất gói UDP; tổng 2,5 s, dưới 3 s (FR-001).
- **Đã cân nhắc:**
  - Gửi từ giao diện (WebView): không có API UDP.
  - Bộ cài tạo luật tường lửa: Studio cài theo người dùng (`installMode: currentUser`), không có quyền admin.
  - Crate `netdev` (biết loại card, gateway): nặng hơn, chưa cần.

## R4. Thư viện TLS của runtime: Mbed TLS 3.6 LTS, link tĩnh

- **Quyết định:**
  - Mbed TLS **3.6.7** (nhánh LTS 3.6, phát hành 2026-07-07, Apache-2.0), vendored vào `third_party/mbedtls/`: chỉ `include/`, `library/`, `LICENSE`, khoảng 6 MB. Build static.
  - File cấu hình riêng `third_party/mbedtls-config/mat_mbedtls_config.h`:
    - **Bật:**
      - TLS 1.2 và 1.3, chỉ phía server; ECDHE (X25519, P-256); chứng chỉ ECDSA P-256; AES-GCM, ChaCha20-Poly1305; SHA-256 và SHA-384;
      - X.509 đọc và ghi, PEM, CTR-DRBG, entropy từ `getrandom`;
      - PSA Crypto: TLS 1.3 của bản 3.6 cần. Từ các bản 3.6 sau 3.6.0, thư viện tự gọi `psa_crypto_init()` khi bắt tay TLS 1.3 (sửa lỗi Mbed-TLS #9072); `main` vẫn gọi một lần lúc khởi động, để lỗi khởi tạo (ví dụ thiếu entropy) lộ ra trước khi mở cổng;
      - `MBEDTLS_THREADING_C` và `MBEDTLS_THREADING_PTHREAD`, vì CivetWeb dùng chung một CTR-DRBG cho mọi kết nối.
    - **Tắt:** TLS 1.0/1.1, trao đổi khóa RSA, CBC, DTLS, phía client, renegotiation, debug.
  - CivetWeb build với `USE_MBEDTLS`. Cờ chính xác chốt ở task spike.
  - Thêm **bản vá cục bộ thứ ba** vào CivetWeb: handshake có hạn (xem Lý do). Ghi trong `third_party/LICENSES.md` như hai bản vá cũ.
- **Lý do:**
  - **Kiểm toolchain:**
    - Image `ubuntu:20.04` + `g++-arm-linux-gnueabihf` không có OpenSSL armhf (`libssl-dev:armhf`).
    - Mbed TLS là C99 thuần: build bằng chính toolchain hiện có, không cần multiarch.
    - OpenSSL cũng build được, vì CivetWeb tự `dlopen` (`openssl_dl.inl`) và không cần header.
  - **Bảo trì bảo mật:**
    - BL335 có `libssl.so.1.1` (OpenSSL 1.1.1f của Ubuntu 20.04). OpenSSL 1.1.1 hết hỗ trợ từ 2023-09.
    - Ubuntu 20.04 hết hỗ trợ chuẩn từ 2025-05. Bản vá sau đó chỉ có qua Ubuntu Pro (ESM); chưa xác nhận ESM có cho armhf.
    - Cổng HTTPS có thể ra Internet qua port-forward (quyết định 5), nên cần thư viện TLS còn được vá và do mình nâng cấp. Nhánh 3.6 LTS được hỗ trợ tới ít nhất 2027-03.
  - **Không phụ thuộc OS:** hợp với [ADR-002](../../docs/adr/002-commercial-os.md) (OS thương mại có thể là Buildroot): runtime mang theo TLS của mình.
  - **Đủ mật mã cho cả feature trong một thư viện:**
    - sinh khóa và chứng chỉ ở lần chạy đầu (`mbedtls_x509write_crt`);
    - SHA-256 cho checksum gói, digest, fingerprint;
    - CTR-DRBG.

    Với OpenSSL nạp động, phải tự khai báo thêm khoảng 25 hàm libcrypto, như 003 đã làm với client DB.
  - **License:** Apache-2.0 cho phép link tĩnh; giữ file NOTICE.
  - **Rủi ro thấy khi đọc mã CivetWeb 1.16:**
    - Worker nhận socket ở chế độ non-blocking (`civetweb.c` dòng 20070).
    - Nhánh Mbed TLS bắt tay bằng vòng lặp `while` trên `WANT_READ`/`WANT_WRITE`, không ngủ, không hạn (`mod_mbedtls.inl` dòng 207–216).
    - Hệ quả: một client mở TCP vào cổng HTTPS rồi im lặng làm một worker quay 100 % CPU, tới khi client đóng.
    - Nhánh OpenSSL thì chờ có hạn (`sslize`, theo `request_timeout_ms`).
    - **Bản vá:** khi gặp `WANT_READ`/`WANT_WRITE` thì `poll()` socket theo chiều cần, tổng thời gian ≤ `request_timeout_ms` (10 s); quá hạn thì đóng kết nối.
    - **Test:** 8 kết nối im lặng vào cổng HTTPS; CPU của runtime tăng không quá 2 điểm, và mọi kết nối bị đóng sau ≤ 11 s.
  - **Hiệu năng (ước tính, đo ở task ⚠️🔌):**
    - Cortex-A7 không có lệnh AES/SHA. Mbed TLS dùng C (có asm cho phép nhân số lớn), nên ECC chậm hơn OpenSSL (có asm ARMv4/NEON) vài lần.
    - Một lần bắt tay đầy đủ (ECDHE X25519 + ký ECDSA P-256) khoảng 10–40 ms CPU.
    - Studio giữ kết nối (keep-alive), nên mỗi phiên chỉ bắt tay vài lần.
- **Đã cân nhắc:**
  - **OpenSSL 1.1.1 của OS, CivetWeb nạp động:** nhánh CivetWeb được dùng nhiều, nhanh nhờ asm. Nhưng phụ thuộc thư viện đã hết hỗ trợ của OS, không có trên Buildroot nếu không mang theo, và sinh chứng chỉ phải khai báo tay hàm libcrypto hoặc gọi lệnh `openssl` (chưa biết BL335 có lệnh này không).
  - **OpenSSL 3.x vendored:** Apache-2.0, nhưng mã nguồn khoảng 50 MB, build chéo lâu; ổ D: máy dev còn 4,2 GB.
  - **Mbed TLS 4.x** (4.1 LTS, hỗ trợ tới 2029-03): API mới (TF-PSA-Crypto, bỏ CTR-DRBG công khai, đổi `mbedtls_pk_parse_keyfile`). CivetWeb 1.16 (bản mới nhất, 2023-04) chưa hỗ trợ. Chuyển sang trước 2027-03 (điều kiện xem lại của ADR-010).
  - **wolfSSL:** GPL-2.0 hoặc license thương mại.
  - **BearSSL** (MIT): CivetWeb không hỗ trợ, không có TLS 1.3.
  - **Reverse proxy (stunnel, nginx) trước runtime:** thêm tiến trình và cấu hình trên thiết bị. Runtime khó biết địa chỉ nguồn thật để khóa theo IP và ghi audit.

## R5. HTTPS trên runtime: hai listener, chứng chỉ tự sinh, fingerprint

- **Quyết định:**
  - **Hai context CivetWeb trong cùng tiến trình:**

    | Context | Cổng | Phục vụ |
    |---|---|---|
    | HTTP | `port` (8080, giữ nguyên) | trang xem, `/assets/`, `/project/`, `system/info`, `projects/active`, `/api/v1/live`. Không đổi hành vi (FR-033) |
    | HTTPS | `httpsPort` (mặc định 8443; `0` = tắt) | mọi endpoint của context HTTP (để Studio dùng `wss`) cộng API kỹ thuật: đăng nhập, chẩn đoán, nạp xuống, đọc lên, khôi phục, audit. 8 worker (`httpsThreads`), keep-alive 15 s (chốt 2026-10-12, trước đó 60 s; ADR-010) |

    - API kỹ thuật chỉ chạy trên context HTTPS. Context HTTP đăng ký cùng các đường dẫn đó bằng một handler trả 403 `HTTPS_REQUIRED` và ghi audit (FR-007). Handler thật vẫn kiểm `is_ssl`, phòng khi sau này gộp context.
    - Hai context dùng chung một `CivetLiveTransport`, nên giới hạn 10 phiên live tính chung (Constitution IV).
  - **Chứng chỉ tự ký:**
    - Khóa ECDSA P-256. Runtime sinh bằng Mbed TLS ở lần chạy đầu, khi `<dataDir>/tls/server.pem` chưa có.
    - Một file PEM gồm khóa và chứng chỉ, vì CivetWeb đọc cả hai từ `ssl_certificate`. Quyền `0600`, thư mục `0700`, chủ sở hữu `matscada`. Ghi file tạm, `fsync`, `rename`.
    - Subject CN `mAT <deviceName>`; SAN DNS là hostname; serial 16 byte ngẫu nhiên.
    - Hạn 2000-01-01 → 9999-12-31 ("không có hạn rõ", RFC 5280 §4.1.2.5). Studio không xét hạn khi ghim, nên đồng hồ thiết bị sai (RTC không đọc được) không ảnh hưởng.
    - **Fingerprint** = SHA-256 của DER chứng chỉ, in dạng `AB:CD:…`, giống `openssl x509 -fingerprint -sha256`.
    - Thư mục nằm trong `dataDir` (StateDirectory), nên giữ qua khởi động lại, qua `deploy.sh` và `rollback.sh` (FR-006).
  - **Khóa hỏng hoặc sai quyền: không tự sinh lại.** Sinh lại là đổi danh tính, trông giống bị giả mạo.
    - Context HTTPS không chạy; `system/info.device.https = "cert-error"`.
    - Trang xem vẫn chạy.
    - Sửa bằng lệnh `--regen-cert` (FR-009).
- **Lý do:**
  - **Context riêng cho HTTPS:** lỗi TLS (thiếu chứng chỉ, lỗi thư viện) hay tấn công làm kẹt worker HTTPS không đụng tới trang xem và dữ liệu sống của vận hành. Thread pool riêng, nhỏ (8), giới hạn được RAM.
  - **Giữ HTTP cho trang xem:** FR-033, và Chrome cảnh báo chứng chỉ tự ký. HTTPS cho Chrome thuộc GĐ 2, cần quy trình nạp chứng chỉ CA của khách hàng (Master Plan §11.3).
  - **ECDSA P-256 thay RSA-2048:**
    - sinh khóa ECDSA mất vài chục ms trên Cortex-A7;
    - RSA-2048 sinh khóa bằng Mbed TLS có thể mất hàng chục giây (ước tính, chưa đo), và mỗi lần bắt tay phải ký RSA khoảng 100 ms trở lên;
    - rustls và Chrome đều hỗ trợ ECDSA P-256.
  - **Fingerprint của cả chứng chỉ (không phải SPKI):** đó là con số người dùng thấy ở mọi công cụ (`openssl`, trình duyệt) và lệnh trên thiết bị in ra.
  - **Cổng 8443:** phổ biến cho HTTPS phụ; > 1024 nên user không đặc quyền mở được.
- **Đã cân nhắc:**
  - **Một context với `listening_ports = "8080,8443s"`:** ít mã hơn, nhưng HTTPS lỗi thì `mg_start` lỗi luôn cả trang xem; chung thread pool.
  - **Chuyển hẳn sang HTTPS, HTTP chuyển hướng:** vi phạm FR-033; Chrome cảnh báo.
  - **Sinh chứng chỉ trong `deploy.sh` bằng lệnh `openssl`:** chưa biết BL335 có lệnh này. File thuộc root thì runtime không tự sinh được ở lần chạy đầu như FR-006.
  - **Chứng chỉ hạn ngắn, tự gia hạn:** fingerprint đổi định kỳ, Studio phải ghim lại; vô ích khi xác thực bằng ghim.

## R6. Studio nói chuyện với thiết bị qua Rust, có ghim fingerprint

- **Quyết định:** mọi kết nối từ Studio tới thiết bị chuyển xuống Rust (contract: [tauri-commands.md](contracts/tauri-commands.md)).
  - **TLS:** rustls 0.23.45 với provider `ring` 0.17.14. Verifier riêng `PinnedVerifier` (API `dangerous()` của rustls):
    - tính SHA-256 của DER chứng chỉ máy chủ, so với fingerprint đã ghim. Khác thì lỗi `cert-mismatch`, kèm fingerprint mới;
    - không xét chuỗi CA, tên máy hay hạn chứng chỉ (chứng chỉ tự ký, IP thay đổi, đồng hồ thiết bị không tin được);
    - **vẫn kiểm chữ ký bắt tay** bằng thuật toán của provider (`verify_tls12_signature`, `verify_tls13_signature`). Thiếu bước này, kẻ giả mạo chỉ cần chép chứng chỉ công khai của thiết bị là qua.
  - **Dò chứng chỉ** (`device_probe`): bắt tay với verifier chỉ ghi lại fingerprint, không gửi byte HTTP nào, rồi đóng ngay. Rust chỉ đặt ghim bằng đúng fingerprint vừa dò, sau khi người dùng xác nhận.
  - **HTTP:** reqwest 0.13.5, đã có trong `Cargo.lock` qua Tauri (chưa bật TLS).
    - Feature `rustls-no-provider`, `json`, `stream`; cấu hình TLS truyền vào bằng `tls_backend_preconfigured(ClientConfig)`; `http1_only`.
    - Một client cho mỗi thiết bị. Timeout kết nối 3 s, request 10 s. Giữ kết nối rảnh 10 s (máy chủ giữ 15 s). **Sửa 2026-10-12:** trước đó 30 s và 60 s; hạ xuống vì mỗi kết nối HTTPS rảnh giữ một trong 8 worker của thiết bị (ADR-010).
  - **WebSocket:** tokio-tungstenite 0.30.0, chỉ feature `handshake`, chạy trên luồng TLS do tokio-rustls 0.26.5 tạo, cùng `PinnedVerifier`.
    - Bản tin text chuyển lên giao diện qua `tauri::ipc::Channel` (giữ thứ tự).
    - Giao diện gửi lại bằng lệnh `live_send`.
  - **Token phiên chỉ nằm trong bộ nhớ Rust**, gắn vào header `Authorization` khi gọi. Giao diện không bao giờ thấy token.
  - **Mật khẩu** đi qua IPC một lần khi đăng nhập; Rust xóa bộ đệm (`zeroize` 1.9.0) sau khi gửi.
  - **Thiết bị runtime cũ (chưa có HTTPS), hoặc chỉ tới được cổng HTTP** (ví dụ chỉ port-forward 9080): Rust gọi HTTP thường, chỉ hai đường dẫn `/api/v1/system/info` và `/api/v1/live`. Đây là chế độ theo dõi chỉ đọc của 004 (FR-035).
  - **CSP của Studio** bỏ `http: ws:` khỏi `connect-src`: WebView không còn tự kết nối ra mạng.
- **Lý do:**
  - WebView2 dùng kho chứng chỉ của Windows cho `fetch`/`WebSocket`, không có API ghim chứng chỉ tự ký theo từng nơi kết nối. Tắt kiểm chứng chỉ cho cả WebView (`--ignore-certificate-errors`) thì mất an toàn cho mọi kết nối.
  - Token không vào WebView: lỗi chèn mã ở giao diện không lấy được token để dùng ở máy khác (FR-012).
  - Mã của 004 đã sẵn chỗ cắm:
    - `@mat/live-client` nhận `createSocket` (`SocketLike`);
    - `DeviceSession` nhận `fetch` và `createSocket` ([device-session.ts](../../apps/studio/src/model/device-session.ts)).

    Chỉ cần bộ chuyển (adapter) dựa trên lệnh Rust; không sửa giao thức hay test của 004.
  - reqwest đã nằm trong cây phụ thuộc của Tauri: bật thêm feature không thêm phiên bản crate mới.
  - Không dùng aws-lc-rs (provider mặc định của rustls): cần CMake và NASM khi build trên Windows.
- **Ảnh hưởng tới mã của 004.** Làm sau khi 004 xong các task chạm cùng file (plan, mục "Thứ tự làm"):

  | File | Thay đổi |
  |---|---|
  | `apps/studio/src/platform/types.ts` | giữ `Platform`. Giao diện mới `DeviceLink` ở `platform/device-types.ts`; bản Tauri `platform/tauri-device.ts`; bản giả `platform/mock-device.ts` (alias Vite chế độ `e2e`, như `mock.ts`) |
  | `apps/studio/src/model/device-session.ts` | thêm chế độ `online` (theo `deviceId`, sau ghim và đăng nhập) bên cạnh chế độ `monitor` (theo địa chỉ, như 004). Mã lỗi mới: `cert-unpinned`, `cert-mismatch`, `tls`, `auth-required`, `session-expired`, `session-invalid`, `forbidden`, `runtime-old`, `https-unreachable` ([data-model.md](data-model.md) §6). Giữ các option `createSocket`, `fetch`, nên 24 test của T016 vẫn chạy |
  | `apps/studio/src/model/device.ts` | `checkDevice` giữ chữ ký (`FetchFn`); thêm `normalizeHttps` (mặc định cổng 8443) |
  | `packages/live-client` | không đổi giao diện; thêm xử lý mã đóng 1012 (R14) |
  | `apps/studio/src-tauri` | module `device/`, `discovery.rs`, `package/`; `Cargo.toml`; `tauri.conf.json` (CSP) |

- **Đã cân nhắc:**
  - `tauri-plugin-http`, `tauri-plugin-websocket`: chỉ có tùy chọn bỏ kiểm chứng chỉ (`danger`), không ghim theo fingerprint.
  - Proxy cục bộ trong Rust (WebView gọi `http://127.0.0.1:x`, Rust chuyển qua TLS): mở cổng trên máy kỹ sư, phải chống trang khác gọi vào.
  - Cài chứng chỉ thiết bị vào kho của Windows: cần quyền, ảnh hưởng mọi ứng dụng, sai mục đích.
  - hyper `client::conn` trực tiếp thay reqwest: kiểm soát hơn nhưng phải tự quản kết nối. Giữ làm dự phòng: `tls_backend_preconfigured` không cam kết SemVer, có test bảo đảm client dựng được với cấu hình của mình.

## R7. Băm mật khẩu: Argon2id

- **Quyết định:**
  - Argon2id, thư viện tham chiếu `phc-winner-argon2` **20190702** (CC0-1.0 hoặc Apache-2.0). Vendored vào `third_party/argon2/`: chỉ `argon2.c`, `core.c`, `ref.c`, `encoding.c`, `blake2/`; build với `ARGON2_NO_THREADS`.
  - **Tham số mặc định:** m = 19456 KiB (19 MiB), t = 2, p = 1; salt 16 byte; kết quả 32 byte.
  - **Lưu dạng chuỗi PHC:** `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`. Tham số đi kèm từng mật khẩu, nên đổi được về sau; mật khẩu cũ được băm lại ở lần đăng nhập đúng kế tiếp.
  - **Mục tiêu thời gian:** 0,3–0,8 s mỗi lần trên BL335; trần SC-007 là 1 s.
    - Đo ở task ⚠️🔌 bằng `mat-runtime --auth-bench` (chỉ tính, không ghi gì).
    - Nếu > 0,8 s: hạ t = 1, giữ 19 MiB. Ghi vào ADR-011 là lệch khuyến nghị OWASP, bù bằng khóa tạm và giới hạn tần suất.
  - **Tài nguyên:**
    - Bộ nhớ Argon2 cấp bằng `mmap` qua callback cấp phát của thư viện, trả lại ngay sau khi băm.
    - Mỗi lúc chỉ một lần băm; hàng đợi ≤ 4, đầy thì 429 `AUTH_BUSY`.
    - Luồng băm chạy `nice +10`, như luồng gửi của 003.
  - **Không lộ tài khoản có tồn tại hay không:** tài khoản không tồn tại vẫn băm với salt giả, nên thời gian trả lời như nhau.
  - **So sánh hằng thời gian:** XOR tích lũy trên cả 32 byte, không thoát sớm.
- **Lý do:**
  - OWASP Password Storage Cheat Sheet: Argon2id là lựa chọn đầu, cấu hình tối thiểu m = 19 MiB, t = 2, p = 1. PBKDF2-HMAC-SHA256 cần 600.000 vòng.
  - **Ước tính trên Cortex-A7 1,2 GHz (chưa đo):**
    - SHA-256 viết bằng C khoảng 30–40 MB/s. Mỗi vòng PBKDF2 xử lý 128 byte, nên 600.000 vòng mất khoảng 2 s: vượt SC-007.
    - Argon2id 19 MiB × 2 lượt xử lý 38 MiB. Bản `ref.c` dùng số học 64 bit; trên ARM 32 bit ước 20–30 chu kỳ/byte, tức khoảng 0,6–1,0 s.
    - Cả hai cần đo. Argon2id gần trần hơn, nhưng chống tấn công bằng GPU tốt hơn nhiều vì tốn bộ nhớ.
  - **RAM:** đỉnh thêm 19 MiB trong lúc băm. RSS hiện tối đa 13,7 MB, ngân sách 150 MB; có hàng đợi nên không cộng dồn.
  - Thư viện nhỏ (khoảng 100 KB mã nguồn), C89, không phụ thuộc gì.
- **Đã cân nhắc:**
  - **PBKDF2-HMAC-SHA256 có sẵn trong Mbed TLS** (lộ trình §4.1 ghi PBKDF2): không thêm thư viện, nhưng 600.000 vòng ước khoảng 2 s; hạ số vòng thì yếu trước GPU. Giữ làm dự phòng nếu người dùng muốn bám lộ trình (câu hỏi 3 của plan).
  - **scrypt:** OWASP yêu cầu N = 2^17, r = 8, tức 128 MiB RAM: quá nhiều; hạ N thì yếu.
  - **bcrypt:** OWASP chỉ khuyên cho hệ thống cũ; giới hạn 72 byte.
  - **Monocypher (có Argon2):** tương đương; `phc-winner-argon2` là bản tham chiếu của RFC 9106.

## R8. Tài khoản: lưu ở đâu, lệnh trên thiết bị

- **Quyết định:**
  - **File:** `/etc/mat-runtime/users.json`, `root:matscada`, `0640`, cùng cách với `secrets.json` của 003. Chỉ lệnh trên thiết bị (chạy bằng root) ghi; runtime chỉ đọc (`/etc/mat-runtime` là `ReadOnlyPaths` trong unit).
  - **Mỗi tài khoản:** `name`, `role`, `enabled`, `passwordHash` (PHC), `rev`, `unlockSeq`, `createdAt`, `updatedAt`.
    - `rev` tăng khi đổi mật khẩu, role, bật/tắt; `unlockSeq` tăng khi mở khóa.
    - Tối đa 64 tài khoản. Tên theo `^[a-z][a-z0-9._-]{2,31}$`.
  - **Runtime đọc lại file** khi `mtime`, kích thước hoặc inode đổi. Kiểm ở mỗi lần đăng nhập và mỗi request có phiên, tối đa 1 lần/2 s.
    - `rev` đổi: hủy mọi phiên của tài khoản đó, xóa khóa tạm.
    - `unlockSeq` đổi: chỉ xóa khóa tạm.
    - File cho người khác đọc hoặc ghi (`mode & 0007 ≠ 0`): không dùng; mọi đăng nhập bị từ chối, ghi log lỗi.
  - **Lệnh** (chạy bằng root; BL335 không có `sudo`): `--user-add <tên> --role <role>`, `--user-passwd <tên>`, `--user-role <tên> <role>`, `--user-disable`, `--user-enable`, `--user-unlock`, `--user-list`.
    - Mật khẩu đọc từ TTY tắt echo (nhập hai lần), hoặc một dòng stdin với `--password-stdin`. Không bao giờ là tham số dòng lệnh: sẽ lộ trong `ps` và lịch sử shell.
    - Mật khẩu dài 15–128 ký tự, khác tên tài khoản. 15 là mức tối thiểu của NIST SP 800-63B-4 (bản cuối 2025-08) khi mật khẩu là yếu tố xác thực duy nhất; NIST cũng yêu cầu nhận ít nhất 64 ký tự (câu hỏi 5 của plan).
    - Lệnh ghi audit (R11) bằng một tiến trình con đã hạ quyền xuống `matscada`, để file `-wal`, `-shm` của SQLite không thuộc root. Không ghi được audit thì không đổi gì.
  - **Cài lần đầu:** `deploy.sh` thấy chưa có tài khoản administrator thì:
    - có TTY: chạy `--user-add admin --role administrator`;
    - không có TTY: in "bước bắt buộc" rồi đi tiếp. Trang xem vẫn chạy; mọi đăng nhập bị từ chối tới khi có tài khoản (FR-011).
- **Lý do:**
  - FR-011: quản lý tài khoản cần quyền quản trị hệ điều hành, không qua mạng ở GĐ 1.
  - Runtime không ghi được file tài khoản: lỗi ở runtime, kể cả bị chiếm quyền qua mạng, không tạo được tài khoản mới.
  - File JSON nhỏ, đọc lại theo `mtime`: không cần kênh nói chuyện giữa lệnh và dịch vụ.
- **Đã cân nhắc:**
  - Bảng tài khoản trong SQLite của runtime: runtime ghi được nên mất tách quyền; root ghi vào DB của `matscada` dễ làm sai quyền file WAL.
  - Tài khoản Linux (PAM): phải đọc `/etc/shadow` hoặc dùng helper setuid, trái sandbox; trộn tài khoản hệ điều hành với tài khoản SCADA.

## R9. Phiên và khóa tạm

- **Quyết định:**
  - **Đăng nhập:** `POST /api/v1/auth/login`, chỉ HTTPS. Trả token 32 byte ngẫu nhiên (`getrandom`), dạng `mats_` + base64url (43 ký tự).
    - Studio gửi token trong header `Authorization: Bearer …`. Không dùng cookie ở GĐ 1.
  - **Phiên trong bộ nhớ của runtime**, khóa bằng SHA-256 của token. Mỗi phiên: tài khoản, địa chỉ nguồn lúc đăng nhập, thời điểm tạo, thời điểm thao tác cuối (đồng hồ `CLOCK_BOOTTIME`).
    - Hết hạn sau 30 phút không thao tác, hoặc sau 12 giờ (FR-012).
    - Chỉ request do người dùng thao tác mới làm mới hạn. Studio hỏi chẩn đoán, tiến trình mỗi vài giây, nhưng các request đó không làm mới; nếu làm mới thì phiên không bao giờ hết hạn khi Studio còn mở.
    - Tối đa 32 phiên; đầy thì bỏ phiên lâu không dùng nhất.
    - Chỉ dùng được từ đúng địa chỉ nguồn lúc đăng nhập (FR-012). Khác thì 401 `SESSION_INVALID`.
    - Đăng xuất hủy phiên. `rev` của tài khoản đổi (đổi mật khẩu, role, tắt) thì hủy mọi phiên của tài khoản đó.
  - **Đi qua lần khởi động lại khi kích hoạt project:** runtime tự chạy lại bằng `execv` (R13).
    - Trước đó, runtime ghi phiên và trạng thái khóa tạm vào `/run/mat-runtime/auth-state.json` (tmpfs, `0600`; unit thêm `RuntimeDirectory=mat-runtime`). Tiến trình mới đọc rồi xóa file.
    - Khởi động lại thiết bị, hoặc systemd chạy lại sau lỗi: mất phiên, Studio hỏi đăng nhập lại.
  - **Khóa tạm (FR-013):**
    - 5 lần sai liên tiếp thì khóa 5 phút.
    - Đếm riêng theo tên tài khoản (kể cả tên không tồn tại; bảng LRU 256 mục) và theo địa chỉ nguồn (LRU 256).
    - Đang khóa thì không kiểm mật khẩu, trả 429 `AUTH_LOCKED` kèm `retryAfterS`.
    - Đăng nhập đúng xóa bộ đếm của tài khoản và của địa chỉ đó.
    - Đếm trong bộ nhớ theo `CLOCK_BOOTTIME`; đi qua `execv` cùng phiên.
  - **Thông báo lỗi:** sai tên hay sai mật khẩu đều là 401 `AUTH_FAILED`, cùng thời gian xử lý (băm giả, R7).
  - **Chưa có tài khoản nào:** mọi đăng nhập 401 `AUTH_FAILED`. `GET /api/v1/device/identity` trả `setupRequired: true` để Studio hướng dẫn chạy lệnh trên thiết bị.
- **Lý do:**
  - Studio là ứng dụng Rust, không phải trình duyệt: header không tự gửi kèm, nên không có CSRF và không cần CSRF token.
  - Cookie `HttpOnly; Secure; SameSite=Strict` + CSRF (lộ trình §4.1) để GĐ 2, khi trang web cần đăng nhập để ghi Tag. Kho phiên viết độc lập với cách chuyển token, nên GĐ 2 chỉ thêm đường cookie.
  - Lưu băm của token: file trạng thái lộ ra cũng không dùng được để đăng nhập.
  - `CLOCK_BOOTTIME` không nhảy khi NTP chỉnh giờ hay RTC sai (Edge case đồng hồ). Đồng hồ này chung cho cả hệ thống, nên vẫn đúng sau `execv`.
  - Khóa theo tên cả khi tên không tồn tại: kẻ dò không phân biệt được tên có thật qua hành vi khóa.
- **Đã cân nhắc:**
  - JWT hoặc token có chữ ký: không thu hồi được ngay khi tắt tài khoản; phải giữ khóa ký.
  - Lưu phiên trong SQLite: thêm ghi eMMC ở mỗi request; vẫn phải xử lý khởi động lại thiết bị.
  - Ghi khóa tạm vào file tài khoản: runtime không có quyền ghi (R8), và giờ hệ thống không tin được sau mất điện.

## R10. Phân quyền theo role

- **Quyết định:**
  - Role theo thứ bậc: `viewer` < `operator` < `engineer` < `administrator`.
  - Mỗi endpoint khai báo role tối thiểu trong **một bảng duy nhất** (`core/auth/roles.*`), có test cho cả bảng.

  | Thao tác | Endpoint | Cần |
  |---|---|---|
  | Trang xem, `system/info`, `projects/active`, `/project/*`, `/api/v1/live` | HTTP và HTTPS | không cần đăng nhập (FR-033) |
  | Danh tính thiết bị | `GET /api/v1/device/identity` (chỉ HTTPS) | không cần đăng nhập |
  | Đăng nhập | `POST /api/v1/auth/login` | không cần đăng nhập |
  | Đăng xuất, xem phiên | `POST /api/v1/auth/logout`, `GET /api/v1/auth/session` | có phiên |
  | Chẩn đoán | `GET /api/v1/diagnostics` | viewer |
  | Danh sách bản, manifest, đọc lên | `GET /api/v1/project/versions`, `/manifest`, `/package` | engineer |
  | Nạp xuống, theo dõi tiến trình | `POST /api/v1/project/deployments`, `GET …/{opId}`, `GET /api/v1/project/operation` | engineer |
  | Khôi phục bản trước | `POST /api/v1/project/restore` | engineer |
  | Xem audit | `GET /api/v1/audit` | administrator |

  - operator ở GĐ 1 có quyền như viewer; ghi Tag là GĐ 2.
  - Role của phiên đọc lại từ `users.json` ở mỗi request: hạ role có hiệu lực ngay.
  - Chưa đăng nhập: 401 `AUTH_REQUIRED`. Phiên hết hạn: 401 `SESSION_EXPIRED`. Thiếu quyền: 403 `FORBIDDEN`. Cả ba ghi audit `access.denied` (gộp theo R11).
- **Lý do:** FR-014. Một bảng duy nhất dễ test, và dễ rà khi GĐ 2 thêm ghi Tag.

## R11. Audit

- **Quyết định:**
  - **SQLite riêng** `<dataDir>/audit.db` (WAL), không chung `history.db` của 003.
  - **`PRAGMA synchronous=FULL` cho DB này:** mỗi bản ghi `fsync` WAL trước khi trả lời. Đáp ứng FR-015: thao tác đã báo thành công thì bản ghi không mất khi mất điện.
    - Đây là ngoại lệ thứ hai cho quy tắc `synchronous=NORMAL` của Constitution (mục "Ràng buộc công nghệ").
    - Cần người dùng chấp thuận (câu hỏi 1 của plan), sửa Constitution, và ghi vào ADR-011.
  - **Bảng `audit`:** `id`, `ts_ms`, `clock_ok`, `user`, `role`, `source`, `channel`, `action`, `target`, `result`, `code`, `detail`, `count`. Chỉ mục theo `ts_ms`, `user`, `action` (chi tiết: [data-model.md](data-model.md) §7).
    - `clock_ok = 0` khi đồng hồ chưa đồng bộ: chưa có `/run/systemd/timesync/synchronized`, hoặc giờ hệ thống trước mốc build (như 003).
    - `detail`: JSON ≤ 1 KB, ví dụ digest cũ → mới, lý do lỗi. Không bao giờ chứa mật khẩu, token hay hash.
  - **Thứ tự ghi:**
    - Thao tác thay đổi (nạp xuống, khôi phục, tạo lại chứng chỉ, sửa tài khoản) ghi bản ghi `started` trước. Không ghi được thì từ chối với 503 `AUDIT_UNAVAILABLE`. Kết quả ghi sau.
    - Đăng nhập: ghi audit xong mới trả token (từ chối khi không ghi được).
  - **Chống ngập:**
    - Đăng nhập sai, từ chối khi đang khóa, và `access.denied` được gộp theo (hành động, nguồn, tài khoản) trong cửa sổ 60 s thành một dòng có `count`. Mọi lần vẫn được đếm.
    - Tổng các dòng loại này ≤ 10 dòng/phút. Vượt thì đếm, và ghi một dòng `audit.suppressed` mỗi phút.
    - Thao tác thay đổi và đăng nhập thành công không bị giới hạn.
  - **Thời hạn và trần:**
    - Thời hạn 365 ngày (`auditRetentionDays`, 30–3650); trần 64 MiB (`auditMaxMB`, 8–1024).
    - Dọn lúc khởi động và mỗi 24 giờ, chỉ khi đồng hồ đã đồng bộ.
    - Quá trần thì xóa 10 % bản ghi cũ nhất, và ghi một dòng `audit.purged`.
  - **Ai đọc được:**
    - administrator, qua `GET /api/v1/audit`: mới nhất trước, lọc theo thời gian, tài khoản, hành động; phân trang theo `id`;
    - root, qua `runuser -u matscada -- mat-runtime --export-audit` (CSV hoặc JSONL, cùng quy tắc chống CSV injection như `--export-history`).

    Cả hai đường đều ghi audit (`audit.read`, `audit.export`).
- **Lý do:**
  - **Tách khỏi `history.db`:** chính sách bền khác (FULL); không bị ảnh hưởng khi `history.db` hỏng bị đổi tên (003) hay khi historian ghi nặng.
  - **Ước tính ghi eMMC:** một bản ghi FULL khoảng 1 trang WAL 4 KB, cộng `fsync` và nhật ký ext4, tức khoảng 8–12 KB.
    - Vận hành thường dưới 200 bản ghi/ngày: dưới 3 MB/ngày.
    - Bị tấn công liên tục: trần 10 dòng/phút cho loại từ chối, tức khoảng 14.400 dòng/ngày, khoảng 150 MB/ngày. Vẫn trong ngân sách 2 GB/ngày cùng với lưu trữ của 003 (ước tính khoảng 0,8 GB/ngày với 500 Tag ghi mỗi 1 s, lộ trình §5).
  - Gộp làm chậm việc ghi tối đa 60 s, nên mất điện có thể mất bộ đếm của tối đa 60 s đăng nhập sai. Đó không phải "thao tác đã báo thành công", nên FR-015 vẫn đạt.
- **Đã cân nhắc:**
  - **Chung `history.db`:** một file hỏng mất cả hai; khác chế độ đồng bộ.
  - **`synchronous=NORMAL`:** đúng Constitution, nhưng mất các bản ghi cuối khi mất điện, trái FR-015.
  - **File JSON lines + `fdatasync`:** không phải SQLite nên không đụng quy tắc `synchronous`; bền như FULL. Nhưng lọc, phân trang, xóa cũ phải tự viết. Giữ làm phương án nếu người dùng không chấp thuận ngoại lệ.
  - **journald:** xoay vòng theo dung lượng của cả hệ thống (đang đặt 50 MB), không bảo đảm giữ 365 ngày; tiến trình khác ghi được vào.

## R12. Gói `.matscada`

- **Quyết định** (contract: [matscada-package.md](contracts/matscada-package.md)):
  - **ZIP, tập con chặt:**
    - chỉ phương thức `0` (stored) và `8` (deflate);
    - không mã hóa, không ZIP64, không data descriptor, không extra field, không comment;
    - tên file đánh dấu UTF-8 (cờ bit 11);
    - EOCD nằm đúng cuối file; central directory nằm liền trước EOCD; header cục bộ đi theo thứ tự, không chồng lấn;
    - header cục bộ phải khớp central directory: tên, phương thức, cờ, CRC, kích thước.
  - **Manifest `matscada.json`** là entry đầu tiên, stored. Gồm:
    - `format`, `formatVersion` (`1.0.0`);
    - project: mã, tên, phiên bản, phiên bản runtime tối thiểu;
    - `createdAt`, `generator`;
    - `files`: mỗi file `path`, `size`, `sha256`;
    - `digest`.
  - **Digest nội dung** = `sha256:` + hex của SHA-256 trên chuỗi các dòng `<sha256> <size> <path>\n`, sắp theo `path` (so byte UTF-8), không gồm manifest.
    - Không phụ thuộc cách nén, thời điểm tạo hay công cụ tạo (FR-017).
    - Cùng tập file thì cùng digest, nên thanh trạng thái so được "máy này" với thiết bị mà không cần đóng gói.
  - **Đóng gói tất định:**
    - entry sắp theo đường dẫn, manifest đứng đầu;
    - giờ DOS cố định 1980-01-01 00:00;
    - "version made by" `20` (MS-DOS), thuộc tính ngoài `0`;
    - Studio nén deflate mức 6; thiết bị (khi tự đóng gói project cài theo cách cũ) dùng stored.
    - Cùng nội dung và cùng phiên bản công cụ thì cùng byte.
  - **Giới hạn:**
    - gói ≤ 50 MiB (52.428.800 byte); ≤ 1024 entry;
    - mỗi file JSON ≤ 1 MiB, SVG ≤ 5 MiB (giới hạn hiện có của bộ kiểm tra); manifest ≤ 256 KiB;
    - tổng sau giải nén ≤ 200 MiB; tỉ lệ nén mỗi entry ≤ 100;
    - đếm byte thật khi giải nén: dừng ngay khi vượt kích thước khai báo, không tin số trong header.
  - **Đường dẫn:**
    - luật `isSafeRelPath` hiện có: ≤ 128 byte, không `..`, không tuyệt đối, không `\` hay `:`, không ký tự điều khiển;
    - cộng thêm: không có `< > " | ? *`; không đoạn nào kết thúc bằng dấu chấm hay khoảng trắng; không tên thiết bị của Windows (`CON`, `NUL`, `COM1`…); sâu ≤ 8 cấp;
    - chỉ đuôi `.json` và `.svg` (chữ thường);
    - không trùng tên khi không phân biệt hoa/thường (ASCII);
    - không entry thư mục, không symlink (thuộc tính Unix `S_IFLNK`);
    - `matscada.json` chỉ được dùng cho manifest.
  - **Nội dung:**
    - mọi file trong gói có trong manifest và ngược lại; SHA-256, kích thước, CRC32 khớp;
    - các trường project của manifest phải bằng giá trị trong `project.json`;
    - không chứa bí mật: khóa JSON giống bí mật (cùng danh sách từ của `E_LOG_SECRET`) trong mọi file JSON, URL có tài khoản, và chuỗi khóa riêng PEM (`-----BEGIN … PRIVATE KEY-----`) trong mọi file. Lỗi là `E_PKG_SECRET`.
  - **Cài đặt:**
    - C++: tự viết bộ đọc/ghi tập con này; giải nén bằng `tinfl` của **miniz 3.1.2** (MIT, phát hành 2026-07-01, có sửa vòng lặp vô hạn trong `tinfl`), cộng CRC32 của miniz.
    - Rust: tự viết bộ đọc/ghi cùng luật; nén và giải nén bằng `flate2` 1.1.10 (backend `miniz_oxide`). Cả hai đã có trong `Cargo.lock`.
    - Bộ vector chung `tests/package-vectors/`: gói hợp lệ và độc hại, kèm mã lỗi mong đợi; vector digest dùng cho cả TS.
  - **Giải nén:**
    - Thiết bị: vào `staging/<opId>/project/` do runtime tạo. File mở bằng `O_CREAT|O_EXCL|O_NOFOLLOW`; thư mục con tạo bằng `mkdirat` theo dirfd của vùng tạm; `fsync` file và thư mục.
    - Studio ("đọc lên thành project mới"): chỉ vào thư mục rỗng chọn bằng hộp thoại. Ghi bằng `create_new`, nên lỗi nếu file đã có; điều này cũng bắt trùng tên không phân biệt hoa/thường của NTFS. Đọc lại và so SHA-256 sau khi ghi.
  - **Không cần ô "Lưu kèm nguồn project"** của mockup: gói luôn là toàn bộ nguồn của project (JSON và SVG), nên đọc lên luôn đầy đủ.
- **Lý do:**
  - Tự viết tập con nhỏ (khoảng 300 dòng mỗi ngôn ngữ) thì kiểm soát được từng luật chống ZIP bomb và path traversal (Constitution V), và hai phía chạy đúng cùng luật trên cùng bộ vector.
  - Các thư viện ZIP đầy đủ hỗ trợ nhiều thứ không cần (ZIP64, mã hóa, extra field), tức bề mặt tấn công lớn hơn. API zip của miniz vừa sửa lỗi tràn offset của central directory ở bản 3.1.2.
  - Digest theo nội dung thì đọc lên ngay sau nạp xuống luôn cho digest giống hệt (SC-002), dù gói được nén lại hay đóng gói bằng công cụ khác.
- **Đã cân nhắc:**
  - libzip (BSD-3): cần zlib và CMake, nhiều tính năng.
  - minizip-ng (zlib license): lớn.
  - API zip đầy đủ của miniz: dùng được, nhưng khó bảo đảm mọi luật chặt.
  - Crate `zip` của Rust (MIT): API rộng, nhiều feature; không bảo đảm cùng luật với thiết bị.
  - tar.gz: không đọc từng file được, không có CRC từng file; ZIP quen hơn với người dùng Windows.
  - Digest theo byte của cả gói: đổi khi nén lại.

## R13. Kho project trên thiết bị, nạp xuống, kích hoạt, rollback

- **Quyết định:**
  - **Kho project** ở `<dataDir>/projects/` (`projectStoreDir`), tách khỏi `/opt/mat-runtime` (FR-019):
    - `v/<seq>/`: `package.matscada` (đúng byte đã nhận), `project/` (đã giải nén, đã kiểm), `meta.json` (ghi sau cùng, đánh dấu bản đã đầy đủ);
    - `state.json`: bản đang chạy, các bản dự phòng, thao tác dở dang. Đây là nguồn sự thật duy nhất, ghi file tạm + `fsync` + `rename` + `fsync` thư mục;
    - `staging/<opId>/`: vùng tạm, dọn khi khởi động;
    - `ops/<opId>.json`: 20 thao tác gần nhất, để Studio đọc tiến trình.
  - **Nhận project cài theo cách cũ** (FR-027): lần đầu chạy 0.4.0, kho trống mà `projectDir` (`/opt/mat-runtime/project`) có project hợp lệ:
    - runtime tự đóng gói (stored, tất định) thành bản `1`, nguồn `runtime-package`;
    - project lỗi thì không nhận: runtime chạy thư mục cũ như 0.3.0 tới lần nạp xuống đầu; đọc lên trả 404 `NO_PROJECT_PACKAGE` kèm lý do.
  - **Chuỗi nạp xuống**, chạy bất đồng bộ (FR-021):
    1. `upload`: nhận gói vào vùng tạm. Kiểm trước: `Content-Length` ≤ 50 MiB; dung lượng trống ≥ gói + `historianMinFreeMB`.
    2. `verify-package`: kiểm gói theo R12, đồng thời giải nén vào vùng tạm; kiểm digest bằng header `X-Mat-Digest`. Chỗ trống xuống dưới `historianMinFreeMB` trong lúc giải nén thì dừng với `NO_SPACE` (Edge case đĩa đầy).
    3. `validate`: bộ kiểm tra C++ hiện có (`validateProject`) chạy trên vùng tạm; có cả `E_RUNTIME_TOO_OLD`.
    4. `backup`: chuyển vùng tạm thành `v/<seq>/` (rename trong cùng phân vùng, `fsync`). Bản đang chạy trở thành bản dự phòng; không chép gì.
    5. `activate`: ghi `state.json` (`pending: { phase: "activating", from, to, bootAttempts: 0 }`); đóng mọi phiên live bằng mã 1012; commit đệm của historian (không chờ luồng gửi DB ngoài: giao dịch dở bị hủy phía DB, chính xác một lần vẫn giữ, ADR-008); dừng CivetWeb; ghi `auth-state.json` (R9); `execv` chính binary.
    6. `health`: tiến trình mới thấy `pending` thì tăng `bootAttempts` (`fsync`), nạp project mới, rồi kiểm trong ≤ 15 s:
       - project hợp lệ và đang hoạt động;
       - hai context HTTP và HTTPS đã mở;
       - tự gọi `GET http://127.0.0.1:<port>/api/v1/system/info` thấy `project.digest` mới;
       - vòng tick chạy 2 s không lỗi.

       Đạt thì ghi `active = to`, xóa `pending`, ghi audit, rồi dọn các bản cũ vượt `projectBackups`.
  - **Lỗi:**
    - Lỗi ở bước 1–4: dừng, dọn vùng tạm. Bản đang chạy không bị đụng.
    - Lỗi ở bước 6 (kể cả quá 15 s): rollback. Ghi `pending.phase = "rolling-back"`, đặt lại `active = from`, `execv` lần nữa.
    - Tiến trình chết trong lúc `health`: systemd chạy lại, bản mới được thử lần hai. Khởi động mà thấy `bootAttempts` ≥ 2 (đã chết 2 lần) thì rollback, không thử nữa.
    - Đếm giờ 15 s chạy ở luồng riêng, bắt đầu ngay sau khi đọc `state.json`: tiến trình treo lúc khởi động cũng bị quay về.
    - Rollback cũng lỗi: runtime chạy ở chế độ "không có project hợp lệ" như hiện nay. Trang xem vẫn báo lỗi; không bao giờ chạy bản dở dang.
  - **Mất điện ở bất kỳ bước nào** (FR-023):
    - trước bước 5: `state.json` vẫn trỏ bản cũ; `v/<seq>` thiếu `meta.json` bị xóa khi khởi động;
    - sau bước 5: `pending` buộc tiến trình khởi động kiểm sức khỏe bản mới, hoặc quay về.

    Vì `state.json` thay bằng `rename`, nó luôn là bản cũ hoặc bản mới hoàn chỉnh.
  - **Một thao tác tại một thời điểm** (FR-022):
    - khóa trong bộ nhớ, ghi kèm vào `state.json` khi đã sang bước 5;
    - yêu cầu thứ hai nhận 409 `DEVICE_BUSY` kèm ai, từ đâu, từ lúc nào;
    - header `X-Mat-Base-Digest` khác digest đang chạy thì 409 `BASE_CHANGED`: có người khác vừa nạp xuống sau lúc xem trước.
  - **Khôi phục bản trước** (FR-024): `POST /api/v1/project/restore` chạy từ bước 3 trên `v/<seq>` đã lưu, cùng chuỗi kiểm tra sức khỏe. Bản đang chạy thành bản dự phòng. Giữ 3 bản dự phòng (`projectBackups`, 1–10).
  - **Phiên hết hạn giữa lúc nạp xuống:** thao tác chạy tới cùng; kết quả ghi audit dưới tài khoản đã bắt đầu (Edge case).
  - **Studio theo dõi tiến trình:** hỏi `GET /api/v1/project/deployments/{opId}` mỗi 500 ms. Trong lúc thiết bị khởi động lại (khoảng 1–3 s), Studio thử lại tối đa 60 s. Phiên đăng nhập đi qua `execv` (R9).
  - **Quan hệ với script có sẵn:**
    - `deploy.sh` (cập nhật runtime):
      - bước validate kiểm **project đang chạy trong kho** bằng binary mới (`--check-project --project-store`). Runtime mới không chạy được project hiện tại thì dừng, giữ runtime cũ;
      - không đụng `/var/lib/mat-runtime` (giữ như 003);
      - cài lần đầu thì đặt mật khẩu quản trị (R8) và in fingerprint.
    - `rollback.sh`: không đổi. Rollback runtime về bản < 0.4.0 thì runtime cũ không biết kho, nên chạy project đi kèm gói runtime: tài liệu ghi rõ, kèm cách nạp lại.
- **Lý do:**
  - **`execv` thay vì đổi project ngay trong tiến trình:** `TagStore`, `LiveHub`, `HttpApi`, historian đều nạp project lúc khởi động (`server/main.cpp`). Làm lại tất cả lúc đang chạy là sửa lớn, dễ có race. `execv` dùng lại đúng đường khởi động đã kiểm (T063) và trùng đường phục hồi sau mất điện.
  - **`execv` thay vì để systemd chạy lại:** không mất `RestartSec=2`; không tính vào `StartLimitBurst` (5 lần/10 s); giữ PID.
  - Lần đổi project vốn đã làm mọi client tải lại, nên ngắt kết nối khoảng 1–3 s không thêm phiền gì.
  - **Ước tính thời gian** với project < 1 MB qua LAN (SC-006 ≤ 15 s, đo ở task ⚠️🔌):

    | Bước | Ước tính |
    |---|---|
    | Gửi gói | < 1 s |
    | Kiểm và giải nén | < 0,5 s |
    | Kiểm project | 0,2–0,5 s |
    | Kích hoạt (`execv`) | 1–2 s |
    | Kiểm tra sức khỏe | 2–3 s |
    | **Tổng** | **khoảng 5–8 s** |
- **Đã cân nhắc:**
  - Đổi project trong tiến trình (hot swap): không ngắt kết nối, nhưng sửa lớn `main.cpp` và các module; rủi ro race.
  - Symlink `current`: phải giữ symlink và `state.json` khớp nhau (hai bước nguyên tử). Một file `state.json` là đủ; lệnh `--project-status` in trạng thái cho người đọc.
  - Thoát và để systemd chạy lại: chậm thêm 2 s, chạm giới hạn khởi động khi rollback liên tiếp.
  - Gửi project cùng gói runtime như hiện nay: trái FR-019.

## R14. Báo client tải lại: giao thức live 1.1.0

- **Quyết định** (contract: [live-protocol-1.1.md](contracts/live-protocol-1.1.md)):
  - `hello.project` thêm `digest`. `/api/v1/projects/active` và `system/info.project` cũng thêm `digest`.
  - Trước khi `execv`, máy chủ đóng mọi phiên live bằng mã **1012** ("Service Restart", mã chuẩn của WebSocket).
  - Client 1.1.0 gặp 1012 thì thử lại mỗi 1 s (cộng ngẫu nhiên 0–250 ms), tối đa 30 lần, rồi mới về backoff thường.
  - Trang xem (`apps/runtime-web`): sau `hello`, nếu `project.digest` khác digest của project đã nạp thì tải lại trang, sau một khoảng ngẫu nhiên 0–1 s để 10 client không cùng gọi một lúc.
  - Thêm trường và thêm cách hiểu mã đóng là tăng MINOR ([ADR-006](../../docs/adr/006-live-protocol-v1.md)): 1.0.0 → 1.1.0. Alarm của GĐ 4 sẽ là 1.2.0.
- **Lý do:**
  - FR-025: client tải lại trong ≤ 10 s. Runtime trở lại sau khoảng 1–3 s; client thử lại mỗi 1 s, nên tải lại trong khoảng 2–5 s.
  - Client 1.0.0 (Studio 004, trang đã mở trước khi cập nhật runtime) bỏ qua trường lạ và coi 1012 là "khác", vẫn kết nối lại theo backoff (1 s, 2 s, 4 s…). Không hỏng, chỉ chậm hơn.
- **Đã cân nhắc:**
  - Bản tin mới `project_changed` trước khi đóng: thừa, vì client vẫn phải chờ máy chủ chạy lại; 1012 cộng digest trong `hello` là đủ.
  - Client hỏi `system/info` định kỳ để biết project đổi: thêm tải cho thiết bị.

## R15. Đọc lên và so sánh

- **Quyết định:**
  - **Đọc lên** (FR-027, FR-028): Studio tải `GET /api/v1/project/package` (đúng byte đã lưu). Rust kiểm gói theo đúng luật của thiết bị (R12), giữ trong thư mục tạm của ứng dụng (tối đa 4 gói).
    - **Thành project mới:** giải nén vào thư mục rỗng (R12), mở làm project, chạy bộ kiểm tra TS. Kết luận phải giống thiết bị (US3-3).
    - **Để so sánh:** giao diện đọc file trong gói qua lệnh `package_read`, nạp bằng bộ nạp dùng chung (`ProjectSource` của `@mat/project-schema`).
  - **Thuật toán so sánh** đặt ở `packages/project-schema/src/compare.ts`: hàm thuần, có test.
    1. **Theo file:** hợp tập đường dẫn của hai bên. Cùng SHA-256 là `=`, khác là `≠`, chỉ trên máy là `+`, chỉ trên thiết bị là `-`. Hai digest bằng nhau thì mọi thứ `=`, không cần bước 2.
    2. **Theo đối tượng**, chỉ cho file `≠`, `+`, `-`:

       | Đối tượng | Khóa | So |
       |---|---|---|
       | Thiết lập project | `project.json` | từng trường (trừ danh sách `screens`) |
       | Tag | `id` | từng trường |
       | Nhóm lưu trữ, kết nối DB | `id` | từng trường; Tag của nhóm theo `tagId` |
       | Màn hình | `id` | trường của `*.screen.json`; SVG theo SHA-256 (không so sâu SVG) |
       | Binding | `elementUid`, rồi `binding.id` | từng thuộc tính (target, Tag, transform…) |

       Kết quả: danh sách `ObjectDiff { kind, key, status, fields[] }` ([data-model.md](data-model.md) §11).
  - **Ký hiệu trên cây project khi Online** (FR-029): ánh xạ `ObjectDiff` sang nút của `model/tree.ts` (004).
    - Studio tự so khi vào Online với role ≥ engineer, sau mỗi lần lưu và sau mỗi lần nạp xuống.
    - Digest giống nhau thì chỉ cần `system/info`; khác thì tải manifest, rồi tải gói nếu cần.
    - viewer chỉ thấy "khớp/khác" trên thanh trạng thái (digest công khai).
  - **Đọc lên phần chọn** (FR-030):
    - Tag và thiết lập project: thay, thêm hoặc xóa đối tượng trong tài liệu sửa được (`project.json`, `tags.json`) qua store và lịch sử hoàn tác của 004.
    - Lưu trữ, màn hình, binding, SVG (004 chưa sửa được theo đối tượng): thay cả file. Tài liệu giữ nội dung chờ ghi, thành sửa đổi chưa lưu, hoàn tác được. Đây là phần mở rộng của mô hình tài liệu của 004.
  - **Digest phía TS:** `packages/project-schema/src/package-digest.ts` tính digest từ (đường dẫn, kích thước, SHA-256). SHA-256 từng file lấy từ `project_read` của 004; hàm băm truyền vào được (WebCrypto trong Studio, bản JS trong test). Vector chung với Rust và C++.
  - **Tập file của project:** hàm `projectFiles()` (TS) và `LoadedProject::files()` (C++) cho cùng danh sách. Danh sách này là thứ Studio đóng gói và thiết bị tự đóng gói. Vector chung trong `tests/project-vectors/`.
- **Lý do:**
  - Constitution II: logic dùng chung nằm trong `packages/*`. So sánh dựa trên kiểu và bộ nạp của `@mat/project-schema`, không phụ thuộc giao diện.
  - So theo file trước thì nhanh với trường hợp thường gặp (giống hệt). So theo đối tượng hiện khác biệt có nghĩa, thay vì khác biệt từng dòng JSON (studio-ux.md §6.3).
- **Đã cân nhắc:**
  - Diff văn bản JSON: khó đọc, nhạy với thứ tự khóa.
  - So trong Rust: lặp lại kiểu project đã có ở TS.
  - Tải từng file riêng thay vì cả gói: gói thường dưới 1 MB; một API ít hơn.

## R16. Chẩn đoán

- **Quyết định:** `GET /api/v1/diagnostics` (HTTPS, viewer):

  | Nhóm | Nguồn |
  |---|---|
  | CPU | toàn hệ thống và của runtime, trung bình 1 phút: runtime đọc `/proc/stat` và `/proc/self/stat` mỗi 5 s trong vòng tick, giữ 13 mẫu; cộng `loadavg` 1 phút (`/proc/loadavg`) |
  | RAM | RSS của runtime (`VmRSS` trong `/proc/self/status`); `MemTotal`, `MemAvailable` (`/proc/meminfo`) |
  | Dung lượng | `statvfs(dataDir)`: tổng và trống |
  | Thời gian chạy | hệ thống (`/proc/uptime`) và runtime (đồng hồ đơn điệu) |
  | Client | số phiên live, giới hạn, số phiên đăng nhập |
  | Giờ | giờ thiết bị và cờ đồng bộ, để Studio hiện độ lệch so với máy kỹ sư |

  Studio hỏi mỗi 5 s khi tab Chẩn đoán đang mở (FR-032).
- **Lý do:**
  - `/proc` đọc được trong sandbox hiện tại (`ProtectKernelTunables` chỉ khóa ghi `/proc/sys`). Mỗi lần đọc vài chục µs.
  - CPU "trung bình 1 phút" theo % thời gian bận khớp cách đo của `tools/measure/sample.sh`. `loadavg` đi kèm vì quen thuộc với người vận hành Linux.
- **Đã cân nhắc:** hỏi `/proc` mỗi lần có request: không tính được trung bình 1 phút.

## R17. Ngân sách BL335 (Constitution III)

- **Ước tính** (đo ở task ⚠️🔌):

  | Phần mới | RSS khi rảnh | CPU khi rảnh | Khi hoạt động |
  |---|---|---|---|
  | Mã Mbed TLS, Argon2, miniz và mã mới | khoảng 0,5–0,8 MB (trang mã được chạm tới) | 0 | |
  | Context HTTPS (8 worker × bộ đệm 16 KB + stack đã chạm) | khoảng 0,3 MB | 0 | bắt tay 10–40 ms CPU mỗi kết nối mới |
  | Kết nối TLS của Studio | khoảng 40 KB mỗi kết nối | | |
  | `audit.db` (cache 256 KB) | khoảng 0,3 MB | 0 | `fsync` mỗi bản ghi |
  | Luồng tìm thiết bị, bảng nguồn | < 0,1 MB | 0 (chờ `poll`) | |
  | Lấy mẫu chẩn đoán (mỗi 5 s) | không đáng kể | < 0,1 điểm | |
  | Đăng nhập (Argon2id) | 0 | | +19 MiB tạm thời, 0,3–1 s của 1 nhân, từng lần một |
  | Nạp xuống | 0 | | gói ghi đĩa theo luồng; vài MB tạm thời khi kiểm project; 1–3 s CPU |

  **Tổng:** RSS khi rảnh tăng khoảng 1,5–3 MB (SC-007 ≤ 10 MB); CPU khi rảnh tăng < 0,5 điểm (SC-007 ≤ 2 điểm). Tải chuẩn vẫn trong ngân sách: hiện 13,7/150 MB và 11,7/30 %.
- **Kế hoạch đo** (task ⚠️🔌, dùng lại `tools/measure/sample.sh` qua `ssh … sh -s`, không ghi file trên thiết bị):
  1. Rảnh 10 phút: 0.3.0 rồi 0.4.0, cùng project `tank-demo`.
  2. Tải chuẩn 30 phút: `bench-500`, 10 client (`load-tester`), cộng Studio Online (1 phiên `wss`, hỏi chẩn đoán mỗi 5 s).
  3. 20 lần đăng nhập: thời gian mỗi lần và CPU đỉnh. Trước đó chạy `--auth-bench` để chốt tham số.
  4. 10 lần nạp xuống project < 1 MB: thời gian từng bước, thời gian client tải lại (SC-006).
  5. Kết nối TLS im lặng: 8 kết nối, CPU không tăng (bản vá R4).

  Kết quả ghi vào `docs/reports/005-acceptance.md`. Vượt ngân sách thì cần ADR (Constitution III).

## R18. Mô hình mối đe dọa (STRIDE)

Phạm vi: tìm thiết bị, HTTPS và ghim, đăng nhập, nạp xuống, đọc lên, audit. Trang xem HTTP không đổi; rủi ro hiện có của nó (dữ liệu chỉ đọc lộ ra Internet qua port-forward 9080) vẫn chờ GĐ 2 và quyết định 5.

| Thành phần | Mối đe dọa | Giảm thiểu | Rủi ro còn lại |
|---|---|---|---|
| Tìm thiết bị | **S/T:** máy khác trong LAN trả lời giả, dụ kỹ sư kết nối tới máy của kẻ tấn công | Kết nối nào cũng qua TLS có ghim (R6). Lần đầu phải so fingerprint với số in trên thiết bị. Fingerprint của gói tìm khác fingerprint thật khi bắt tay thì Studio cảnh báo đỏ | Lần đầu (TOFU) nếu người dùng bỏ qua bước so |
| | **I:** lộ danh sách thiết bị, phiên bản, mã project cho cả LAN | Không có bí mật trong gói; tắt được tìm thiết bị | Phiên bản giúp kẻ tấn công chọn lỗ hổng |
| | **D:** khuếch đại hoặc phản xạ; ngập gói hỏi | Gói trả lời ≤ gói hỏi; chỉ nguồn cùng subnet; cổng nguồn ≥ 1024; giới hạn theo nguồn và tổng; xử lý gói hỏi có độ dài cố định | |
| | **E:** lỗi parser trên thiết bị | Gói hỏi chỉ có phần đầu cố định, không parse JSON; test với vector | |
| HTTPS, ghim | **S:** kẻ đứng giữa ở lần kết nối đầu | Hiện đủ 64 ký tự hex, hướng dẫn so với `--cert-fingerprint`; kiểm chữ ký bắt tay | Như TOFU ở trên |
| | **T, I:** sửa hoặc đọc trên đường truyền | TLS 1.2/1.3, chỉ AEAD và ECDHE | |
| | **I:** lấy khóa riêng của thiết bị | File `0600` của `matscada`, thư mục `0700`; có `--regen-cert` | Người có root hoặc chạm vào thiết bị: ngoài phạm vi |
| | **D:** ngập bắt tay, slowloris vào 8443 | Context và thread pool riêng; bắt tay có hạn (bản vá R4); trang xem và runtime không bị ảnh hưởng | Kỹ sư không vào được khi bị tấn công: khuyến nghị VPN |
| Đăng nhập, phiên | **S:** đoán mật khẩu, thử mật khẩu lộ | Argon2id; khóa 5 lần/5 phút theo tài khoản và theo IP; một lần băm tại một thời điểm | |
| | **S:** cướp phiên | Token 256 bit chỉ nằm trong bộ nhớ Rust; gắn IP; chỉ HTTPS; hết hạn 30 phút/12 giờ; đăng xuất thu hồi | Cùng IP qua NAT |
| | **R:** chối đã làm | Audit bền (FULL) gồm ai, lúc nào, từ đâu, digest cũ → mới | Người có root sửa được audit |
| | **I:** dò tên tài khoản; mật khẩu lọt vào log | Cùng thông báo, cùng thời gian; khóa cả tên không tồn tại; test tìm chuỗi mật khẩu thử trong mọi log và dữ liệu (SC-005) | |
| | **D:** khóa tài khoản admin; vắt CPU bằng đăng nhập | Khóa chỉ 5 phút; khóa theo IP hạn chế người tấn công; mở khóa bằng lệnh; hàng đợi băm ≤ 4, `nice +10` | Người trong LAN khóa được admin 5 phút mỗi lần |
| | **E:** leo quyền | Role kiểm phía máy chủ ở mỗi request, đọc từ `users.json`; không quản lý tài khoản qua mạng | |
| Nạp xuống | **S:** nạp không có quyền | HTTPS + phiên + engineer + audit trước khi làm (Constitution V) | |
| | **T:** gói độc (ZIP bomb, path traversal, symlink, entry chồng lấn, header local và central khác nhau, JSON khổng lồ) | Bộ đọc tập con chặt; giới hạn; checksum; bộ kiểm tra; vùng tạm; mở file `O_EXCL|O_NOFOLLOW` | |
| | **I:** gói chứa bí mật | `E_PKG_SECRET` | Bí mật dạng lạ không khớp mẫu |
| | **D:** đầy đĩa; nạp liên tục | Trần 50 MiB; kiểm chỗ trống; một thao tác một lúc; giữ 3 bản dự phòng | |
| | **E:** SVG độc tới trình duyệt người vận hành | CSP `sandbox` cho `/project/`, Shadow DOM, sanitizer (Constitution V) | Sanitizer còn là denylist, nợ tới GĐ 3b (lộ trình §1) |
| Đọc lên | **I:** lộ project | engineer, HTTPS | |
| | **T:** thiết bị bị chiếm trả gói độc cho Studio | Rust kiểm như thiết bị; chỉ giải nén vào thư mục rỗng, `create_new` | |
| Audit | **D:** ngập audit làm mòn eMMC | Gộp 60 s; trần 10 dòng/phút cho loại từ chối; trần 64 MiB | |
| | **I:** đọc audit | Chỉ administrator và root | |
| Lệnh trên thiết bị | **I:** mật khẩu trong lịch sử shell | Chỉ TTY hoặc stdin, không qua tham số | |
| Studio | **I:** lộ thông tin trên máy kỹ sư | `devices.json` không có bí mật; token chỉ trong RAM; xóa bộ đệm mật khẩu | Dump bộ nhớ của Studio |

## R19. Thư viện mới: phiên bản và license

Chỉ đề xuất. Plan không sửa `package.json`, `Cargo.toml`, `CMakeLists.txt` hay `third_party/`; task sẽ thêm và ghi `third_party/LICENSES.md`.

**Runtime (C, vendored, link tĩnh):**

| Thư viện | Phiên bản (ngày phát hành) | License | Dùng cho |
|---|---|---|---|
| Mbed TLS | 3.6.7 (2026-07-07), nhánh LTS 3.6 hỗ trợ tới ít nhất 2027-03 | Apache-2.0 (hoặc GPL-2.0-or-later; chọn Apache-2.0) | TLS server, sinh chứng chỉ, SHA-256, CTR-DRBG |
| phc-winner-argon2 | 20190702 (bản phát hành mới nhất) | CC0-1.0 hoặc Apache-2.0 | băm mật khẩu |
| miniz | 3.1.2 (2026-07-01) | MIT | giải nén deflate (`tinfl`), CRC32 |

**Studio (Rust):**

| Crate | Phiên bản (ngày phát hành) | License | Ghi chú |
|---|---|---|---|
| rustls | 0.23.45 (2026-09-14) | Apache-2.0 OR ISC OR MIT | `default-features = false`, feature `ring`, `std`, `tls12` |
| ring | 0.17.14 (2025-03-11) | Apache-2.0 AND ISC | provider của rustls |
| tokio-rustls | 0.26.5 (2026-09-04) | MIT OR Apache-2.0 | 0.26.6 (2026-09-28) chưa đủ 2 tuần |
| tokio-tungstenite | 0.30.0 (2026-07-11) | MIT | chỉ feature `handshake` |
| reqwest | 0.13.5 (2026-09-08) | MIT OR Apache-2.0 | đã có trong `Cargo.lock` qua Tauri; thêm feature `rustls-no-provider`, `json`, `stream` |
| if-addrs | 0.15.0 (2026-02-08) | MIT OR BSD-3-Clause | liệt kê card mạng |
| zeroize | 1.9.0 (2026-06-12) | Apache-2.0 OR MIT | 1.9.1 (2026-10-06) chưa đủ 2 tuần |
| flate2 | 1.1.10 | MIT OR Apache-2.0 | đã có trong `Cargo.lock` |
| tokio, futures-util, uuid, base64, getrandom, sha2, serde_json | bản đang có trong `Cargo.lock` | MIT/Apache-2.0 | bật thêm feature khi cần (`net`, `time`, `fs`, `v4`) |

Không thư viện nào là GPL hay LGPL. Phía TS không thêm phụ thuộc.
