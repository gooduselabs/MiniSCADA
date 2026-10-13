# ADR-021: Đăng nhập trên Chrome (cookie + CSRF), phạm vi cookie, chứng chỉ HTTPS và mở rộng API ghi

- **Trạng thái:** Proposed (feature 007, GĐ 3a; quyết định "người dùng giao toàn quyền 2026-10-11"). Chromium 152 đã thử với chứng chỉ tự ký có SAN IP (T006: tin được); chưa có số đo trên BL335 và chưa thử Chrome Windows.
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/007-screens-widgets](../../specs/007-screens-widgets/plan.md), research R13–R18; contracts [device-api-1.2.md](../../specs/007-screens-widgets/contracts/device-api-1.2.md), [web-session.md](../../specs/007-screens-widgets/contracts/web-session.md), [device-config-007.md](../../specs/007-screens-widgets/contracts/device-config-007.md); [ADR-006](006-live-protocol-v1.md) điểm 7, [ADR-010](010-device-discovery-https.md), [ADR-011](011-auth-roles-audit.md), [ADR-017](017-tag-engine-v1.md), [ADR-018](018-viewer-source-filter.md); lộ trình v2 §4.1, §5; Master Plan §11.3; Constitution V.

## Bối cảnh

Từ GĐ 3a trang runtime trên Chrome ghi được Tag (widget điều khiển). Constitution V: API ghi Tag chỉ bật khi có HTTPS, đăng nhập, role, audit. 005 chọn token trong header `Authorization: Bearer` vì client duy nhất là Studio (Rust) và hẹn "cookie + CSRF cho GĐ 2 khi trang xem cần đăng nhập"; 006 (D2) dời sang GĐ 3a. ADR-006 điểm 7 hẹn xem lại việc chấp nhận kết nối WebSocket không có `Origin` khi có xác thực bằng cookie. ADR-018 hẹn xem lại lọc nguồn khi trang xem có đăng nhập.

Trên trình duyệt, token trong `localStorage` bị XSS đọc được; cookie `HttpOnly` thì không, nhưng cookie đi kèm mọi yêu cầu cùng site nên cần chống CSRF.

Chrome yêu cầu chứng chỉ có SAN khớp địa chỉ truy cập; chứng chỉ của 005 chỉ có SAN `dNSName` khi hostname hợp lệ, không có IP; BL335 thường được truy cập bằng IP trong LAN.

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Mang phiên | token trong `localStorage` + header Bearer; **cookie `HttpOnly; Secure; SameSite=Strict`** | cookie |
| Tên cookie | `sid`; **`__Host-mat_sid`** (tiền tố buộc `Secure`, `Path=/`, không `Domain`) | `__Host-` |
| Chống CSRF | chỉ `SameSite`; chỉ kiểm `Origin`; **token theo phiên (synchronizer) + `Origin` + `SameSite=Strict`**; double-submit cookie | ba lớp |
| Bộ xác thực | viết mới; **dùng chung `AuthService`/`SessionStore` của 005, loại phiên `web`** | dùng chung |
| Phạm vi cookie | mọi endpoint như Bearer; **chỉ endpoint của trang runtime** | hẹp |
| Token Bearer và cookie | cùng định dạng `mats_`; **tiền tố khác nhau** (`mats_` Bearer, `matw_` web) | tiền tố khác |
| Xem không đăng nhập | bắt buộc đăng nhập; **tùy chọn `viewerLogin`**: `off` (mặc định) \| `required` | tùy chọn |
| Lệnh xung | hai lệnh từ trình duyệt; **BL335 tự trả về sau `pulseMs`** | BL335 |
| Chứng chỉ | giữ như 005; **SAN IP + tải `device.crt` + CSR + nhập chứng chỉ CA**; ACME | SAN IP + CSR |

## Quyết định

### Phiên và cookie

1. **Đăng nhập:** `POST /api/v1/web/login` (JSON `{ username, password }`; chỉ nhận `Content-Type: application/json`). Dùng đúng `AuthService::login` của 005 (Argon2id, khóa tạm 5 lần/5 phút theo tên và IP, thông báo chung `AUTH_FAILED`, audit `auth.login`). Phiên sinh ra có loại `web`: token `matw_` + 32 byte ngẫu nhiên (chỉ băm được giữ), token CSRF 32 byte ngẫu nhiên, IP đăng nhập.
2. **Cookie:** `Set-Cookie: __Host-mat_sid=<token>; Secure; HttpOnly; SameSite=Strict; Path=/`. Không `Domain`, không `Max-Age` (cookie phiên; hạn thật ở BL335). Luôn cấp token **mới** khi đăng nhập; bỏ qua cookie có sẵn (chống cố định phiên).
3. **CSRF:** token theo phiên trả trong thân `login` và `GET /api/v1/web/session`; trang giữ trong **bộ nhớ** (không `localStorage`, không URL). Mọi `POST` dùng cookie phải có `X-MAT-CSRF` khớp (so hằng thời gian) **và** `Origin` bằng `https://<Host>`; thiếu `Origin`: từ chối. `login` cũng kiểm `Origin` (chống login CSRF). `GET /web/session` từ chối khi `Sec-Fetch-Site` có mặt và khác `same-origin`.
4. **Phạm vi:** cookie chỉ vào `web/*`, `tags/write`, `tags/write/{id}`, `projects/active`, `/project/*`, `system/info`, `device/identity` và nâng cấp WebSocket `/api/v1/live`. Các endpoint khác trả 403 `SESSION_SCOPE`. Token `matw_` trong header `Authorization` bị từ chối (`SESSION_SCOPE`); token `mats_` trong cookie bị bỏ qua.
5. **Thời hạn:** rảnh 30 phút (`webSessionIdleMin` 5–480), tối đa 12 giờ, gắn IP, tối đa 8 phiên web (trong 32 của 005). Chỉ `POST` do người thao tác và `POST /api/v1/web/touch` (trang gọi tối đa 1 lần/phút khi có chuột hoặc phím) làm mới hạn rảnh; `GET` và kết nối live thì không (kiểu "nhìn", như ADR-018). Hủy khi tài khoản tắt, đổi role, đổi mật khẩu (`rev`). Phiên đi qua `execv` như phiên 005 (cùng file tmpfs, cột loại phiên và token CSRF thêm vào).
6. **WebSocket:** nâng cấp mang cookie chỉ nhận khi `Origin` có mặt và bằng `https://<Host>` (đổi ADR-006 điểm 7 cho trường hợp có cookie; yêu cầu không `Origin` và không cookie vẫn như cũ). Phiên hợp lệ không bị lọc nguồn (mở rộng ADR-018 điểm 3 cho cookie) và được kiểm lại mỗi 60 s, hết hạn thì đóng 4401.
7. **`viewerLogin`:** `off` (mặc định): trang xem và dữ liệu theo `viewerAccess` (ADR-018); `required`: trang, `/project/*`, `projects/active`, live và `system/info` ngoài mức tối thiểu cần phiên (cookie hoặc Bearer); trên HTTP chỉ có trang hướng dẫn mở HTTPS. `GET /login` và tài nguyên của nó luôn phục vụ trên HTTPS cho mọi nguồn (chỉ tĩnh, không dữ liệu).
8. **Ghi Tag từ web:** `POST /api/v1/tags/write` của 006, chuỗi kiểm không đổi; audit thêm `channel` = `web`. Không có đường ghi khác, kênh live vẫn từ chối bản tin `write`.

### Mở rộng API ghi (API 1.2.0, trường tùy chọn)

9. `context` `{ screen, widget }` (id ≤ 64 byte, chỉ để audit), `expect` (BOOL: giá trị hiện tại người dùng thấy; khác thì `REJECTED` `STALE_EXPECTATION`), `pulseMs` (100–10.000, chỉ BOOL RW: BL335 ghi `value`, chờ, ghi giá trị ngược; `CONFIRMED` sau cả hai lần ghi; lỗi lần hai: `FAILED` `PULSE_RELEASE_FAILED`). Gửi lại cùng `requestId` vẫn trả kết quả cũ.

### Chứng chỉ

10. **SAN:** chứng chỉ tự sinh từ 0.6 có SAN IPv4 của mọi card tại lúc sinh và hostname hợp lệ; thêm `extendedKeyUsage serverAuth`, `keyUsage digitalSignature` nếu thiếu (kiểm ở task). Chứng chỉ cũ không tự đổi (đổi là đổi fingerprint ghim ở Studio); `system/info.warnings` báo `TLS_NO_IP_SAN`, `TLS_SAN_MISMATCH`.
11. **Tải `GET /device.crt`** (HTTPS, mọi nguồn): PEM chỉ chứa chứng chỉ; trang `/login` hiện fingerprint SHA-256.
12. **CA khách hàng:** `mat-runtime --make-csr [--san …]` sinh khóa mới (không rời thiết bị) và CSR; `--import-cert <file>` kiểm khóa khớp, chuỗi đọc được, SAN (cảnh báo), từ chối file có khóa riêng; thay chứng chỉ bằng ghi tạm + đổi tên; khởi động lại HTTPS; audit. Lệnh chạy bằng root.
13. **Không làm:** ACME, nạp chứng chỉ qua web, CRL/OCSP.

## Hệ quả

- **Tốt:**
  - Token phiên không đọc được bằng JavaScript (XSS không lấy được cookie); CSRF bị chặn bởi ba lớp độc lập; cookie không dùng được vào API kỹ thuật nên XSS/CSRF không nâng quyền lên nạp xuống hay đọc audit.
  - Một bộ xác thực, một chỗ audit, một bảng quyền (005).
  - Người vận hành xem như trước (kiosk không phải đăng nhập), đăng nhập chỉ để điều khiển.
- **Xấu:**
  - Thêm loại phiên, cột CSRF, kiểm `Origin` ở nhiều nơi (HTTP, WebSocket): nhiều bề mặt cần test.
  - Mất phiên khi đổi IP máy khách (Wi-Fi, DHCP); phiên rảnh 30 phút hết hạn với trạm không ai thao tác (đặt `webSessionIdleMin` tới 480).
  - Đăng nhập tốn CPU Argon2id (0,3–0,8 s) mỗi lần (ADR-011), một lúc một lần băm.
  - `SameSite=Strict` làm liên kết từ trang khác tới trang vận hành mất đăng nhập ở lần mở đầu (chấp nhận: người vận hành mở trực tiếp).
  - Khách hàng phải cài chứng chỉ trên từng máy hoặc qua Group Policy.
- **Rủi ro:**
  - Chrome có thể không tin chứng chỉ tự ký không có `basicConstraints CA:TRUE` khi cài vào kho gốc. **Spike T006 (2026-10-13, Chromium 152 trên Linux, kho NSS): tin được** chứng chỉ tự ký `CA:FALSE` có SAN IP khi nó được cài làm chứng chỉ tin cậy; **chọn phương án chứng chỉ tự ký không-CA** (giữ quyền tối thiểu: chứng chỉ máy chủ không ký được gì khác). Phương án hai tầng giữ làm dự phòng ở mức tài liệu (CA của khách hàng qua `--make-csr`, `--import-cert`). Còn lại: Chrome trên Windows (kho Trusted Root) cần người cài, task T149.
  - Router có SNAT làm mọi nguồn hiện ra là mạng riêng (ADR-018 đã ghi): đăng nhập vẫn bắt buộc cho điều khiển.

## Số đo / bằng chứng

- **Spike chứng chỉ (T006, 2026-10-13; `tools/chrome-cert-spike/`):** Chromium 152 (Alpine, kho NSS riêng cho mỗi ca) mở `https://127.0.0.1`: chứng chỉ tự ký `CA:FALSE` + SAN `IP:127.0.0.1` + `digitalSignature` + `serverAuth` tin bằng cờ `P,,` → **HTTP 200**; cờ `C,,` (tin như CA) → `ERR_CERT_INVALID` (NSS đòi `CA:TRUE` khi tin như CA; người dùng Windows nhập vào Trusted Root không dùng cờ này); SAN sai IP hoặc chỉ `DNS:localhost` → `ERR_CERT_COMMON_NAME_INVALID`; không tin → `ERR_CERT_AUTHORITY_INVALID`; chứng chỉ `CA:TRUE` tự ký, và hai tầng (CA tin cậy ký chứng chỉ máy chủ) → HTTP 200. Chưa đo: thời gian đăng nhập trên BL335 (ADR-011 đo 0,3–0,8 s mục tiêu), CPU và RSS khi 10 client F5 có cookie, bắt tay TLS với Chrome Windows (⚠️🔌). Xác nhận lại với chứng chỉ do chính `mat-runtime --regen-cert --san 127.0.0.1` sinh (`tools/chrome-cert-spike/run-real.mjs`): tin bằng cờ `P,,` → HTTP 200, không tin → `ERR_CERT_AUTHORITY_INVALID`.

## Điều kiện xem xét lại

- Studio cần dùng cookie: không; giữ Bearer.
- Khách hàng cần đăng nhập một lần cho nhiều thiết bị (SSO): ngoài phạm vi.
- Cần đổi mật khẩu trên web: thêm endpoint và xem lại phạm vi cookie.
- ADR-018: khi `viewerLogin: required` là chuẩn, lọc nguồn thành lớp thứ hai.
