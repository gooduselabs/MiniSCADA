# Contract: cấu hình thiết bị, lệnh và triển khai (runtime 0.6.0)

**Feature**: [spec.md](../spec.md) FR-038, FR-040, FR-044, FR-053…FR-057 · **Research**: R13, R15, R16, R18 · **ADR**: [021](../../../docs/adr/021-web-login-certificates.md)

Bổ sung cho [device-config.md của 006](../../006-tags-modbus/contracts/device-config.md) và 005. Mọi khóa và lệnh cũ giữ nguyên.

## 1. `runtime.json`: khóa mới

| Khóa | Kiểu | Mặc định | Ý nghĩa |
|---|---|---|---|
| `viewerLogin` | `off` \| `required` | `off` | xem có cần phiên không ([device-api-1.2.md](device-api-1.2.md) §7). Đổi cần khởi động lại; giá trị lạ: runtime không chạy, báo rõ khóa sai |
| `webSessionIdleMin` | int 5–480 | 30 | hạn rảnh của phiên web (phút) |
| `webMaxSessions` | int 1–16 | 8 | số phiên web đồng thời; tổng với phiên Bearer ≤ 32 |
| `webSessionMaxHours` | int 1–24 | 12 | hạn tối đa của phiên web |

Không có khóa nào chứa bí mật. `httpsPort` (005, mặc định 8443), `viewerAccess` (006) giữ nguyên. Ví dụ trạm vận hành cố định:

```json
{ "viewerAccess": "private", "viewerLogin": "off", "webSessionIdleMin": 480, "webSessionMaxHours": 12 }
```

## 2. Chứng chỉ: tệp và lệnh

**Tệp** (`<dataDir>/tls/`, chủ `matscada`, `0600` trừ khi ghi chú):

| Tệp | Nội dung |
|---|---|
| `server.pem` | chứng chỉ máy chủ (kèm chuỗi nếu đã nhập) và khóa riêng; như 005 |
| `server.pem.prev` | bản trước của `server.pem` (sau `--regen-cert`, `--import-cert`) để quay lại bằng tay; một bản |
| `pending-key.pem` | khóa riêng sinh bởi `--make-csr`, chờ chứng chỉ do CA ký; xóa sau khi nhập thành công |
| `csr-<thời điểm>.pem` | CSR (không bí mật), `0644` |

**Lệnh** (chạy bằng root, như `--regen-cert`; runtime không bao giờ ghi các tệp này khi chạy):

| Lệnh | Việc |
|---|---|
| `mat-runtime --cert-info` | (mới, mở rộng `--cert-fingerprint` của 005, lệnh này giữ nguyên) in chủ thể, người ký (tự ký hay CA), SAN, hạn, fingerprint SHA-256; không in khóa |
| `mat-runtime --regen-cert [--san a,b,c]` | (005) sinh lại chứng chỉ tự ký; **từ 0.6 có SAN IP** của mọi card cộng `--san` thêm; đổi fingerprint; audit `tls.regen` |
| `mat-runtime --make-csr [--san a,b,c] [--out file]` | sinh khóa ECDSA P-256 mới vào `pending-key.pem` và CSR PKCS#10 (CN `mAT <deviceName>`; SAN mặc định là hostname hợp lệ và IP card, hoặc theo `--san`); in CSR ra stdout hoặc `--out`; **không** thay chứng chỉ đang dùng; audit `tls.csr` |
| `mat-runtime --import-cert <file>` | nhập chứng chỉ (và chuỗi) do CA ký; luật dưới; audit `tls.import` |

`--san` nhận danh sách phân cách dấu phẩy gồm IPv4 và hostname hợp lệ (RFC 1123); IPv6 và ký tự đại diện: lỗi (thoát mã 2).

**Luật `--import-cert`:**

1. Tệp PEM gồm ≥ 1 khối `CERTIFICATE`; chứng chỉ đầu là chứng chỉ máy chủ, các khối sau là chuỗi trung gian theo thứ tự. Có khối `PRIVATE KEY` (bất kỳ loại): từ chối, thoát mã 2, kèm câu "không gửi khóa riêng; chứng chỉ chỉ gồm phần công khai".
2. Khóa công khai của chứng chỉ máy chủ phải khớp khóa riêng trong `pending-key.pem` (nếu có), nếu không thì khớp `server.pem` hiện hành; không khớp: từ chối, không đổi gì.
3. SAN phải chứa ít nhất một IP của card hiện tại hoặc hostname đã khai; không thì **cảnh báo** (không chặn): Chrome sẽ báo lỗi tên.
4. Hạn chưa tới: cảnh báo nếu đã hết hạn (BL335 không có RTC tin cậy nên không chặn).
5. Ghi `server.pem.new` = chứng chỉ + chuỗi + khóa, `fsync`; đổi tên `server.pem` → `server.pem.prev`; đổi tên `server.pem.new` → `server.pem`; xóa `pending-key.pem`; in fingerprint mới và nhắc `systemctl restart mat-runtime`. Mất điện giữa chừng: khởi động lại thấy `server.pem` hợp lệ (cũ hoặc mới).
6. Sau khi nhập, `system/info.warnings` không còn `TLS_NO_IP_SAN` (nếu SAN có IP). Studio báo fingerprint đổi (005).

**Mã thoát:** 0 xong; 2 sai tham số hoặc tệp; 3 không khớp khóa; 4 lỗi ghi.

## 3. `deploy.sh`

- Lần đầu lên 0.6: in lời nhắc (ghi vào `device-changes.md` bởi người chạy):
  - "Điều khiển trên Chrome cần tài khoản operator: `mat-runtime --user-add <tên> --role operator`";
  - `TLS_NO_IP_SAN` nếu `server.pem` không có SAN IP: "Chrome sẽ báo lỗi chứng chỉ khi mở bằng IP. Chạy `--regen-cert` (đổi fingerprint, Studio phải ghim lại) hoặc `--make-csr`";
  - `viewerLogin`: "Mặc định `off`: xem không cần đăng nhập";
  - không tự đổi chứng chỉ, tài khoản hay `runtime.json`.
- Chép `schemas/` (gồm `widgets.catalog.json`, `0.2/`, `0.1/`) và `web/` (có `login.html`); kiểm `widgets.catalog.json` tồn tại, thiếu thì dừng (runtime không kiểm được project 0.3).
- Quay lại (`rollback.sh`): runtime 0.5 không nhận project 0.3. Nếu project đang chạy là 0.3 thì `rollback.sh` in cảnh báo: runtime 0.5 từ chối project 0.3 như mọi project không hiểu phiên bản và chạy không project (API vẫn phục vụ, 005); khôi phục project 0.2 trước đó bằng "Khôi phục bản trước" của Studio (kho project giữ N bản trước, 005) hoặc nạp xuống lại bản 0.2.

## 4. Gói runtime

`deployment/package-runtime.ps1`: thêm vào gói `schemas/widgets.catalog.json`, `schemas/0.2/*`, bản build trang (`apps/runtime-web/dist-device/` gồm `index.html`, `login.html`, `assets/*`, `.gz` đi kèm). Kiểm kích thước: JS+CSS khởi động của `index.html` ≤ 250 KB nén gzip (SC-024); thất bại thì gói không được tạo.

## 5. Tài liệu `docs/deployment/mat-runtime.md` (mục mới "HTTPS cho Chrome và đăng nhập trên trang vận hành")

Nội dung bắt buộc (FR-056):

1. **Tài khoản:** tạo operator, viewer bằng lệnh; không có đổi mật khẩu trên web.
2. **Chrome và chứng chỉ tự ký:**
   - tải `https://<IP>:8443/device.crt`;
   - so fingerprint với `mat-runtime --cert-info` (hoặc Studio, mục Thiết bị);
   - Windows: `certmgr.msc` → Trusted Root Certification Authorities → Import; hoặc `certutil -addstore -f Root mat-device.crt` (quyền quản trị);
   - Group Policy cho nhiều máy (Computer Configuration → Windows Settings → Security Settings → Public Key Policies → Trusted Root Certification Authorities);
   - Chrome dùng kho của Windows; khởi động lại Chrome;
   - đặt IP tĩnh cho BL335 (SAN theo IP), hoặc `--regen-cert` sau khi đổi IP.
3. **CA của khách hàng:** `--make-csr --san <IP>,<hostname>` → gửi CSR cho CA → `--import-cert chain.pem` → `systemctl restart mat-runtime` → ghim lại fingerprint ở Studio; máy trong công ty đã tin CA nên không phải cài gì.
4. **Từ xa:** khuyến nghị VPN; port-forward HTTPS (8443) chỉ khi chọn, `viewerAccess: private` vẫn chặn trang với nguồn không phiên nhưng `/login` luôn mở; tài khoản dùng mật khẩu dài; khóa tạm 5 lần.
5. **Phiên:** hạn rảnh, trạm vận hành 24/7 đặt `webSessionIdleMin`; kiosk nên dùng `viewerLogin: off`.
6. **Cookie chặn, NAT, nhiều người chung IP** (khóa tạm theo IP có thể khóa cả nhóm): ghi rõ.
7. **Khắc phục sự cố:** `NET::ERR_CERT_AUTHORITY_INVALID` (chưa tin), `NET::ERR_CERT_COMMON_NAME_INVALID` (SAN thiếu IP), `ERR_CERT_DATE_INVALID` (không xảy ra với chứng chỉ tự ký hạn xa; CA riêng có thể), điều khiển khóa vì HTTP, hết phiên.

## 6. Test

- `server/tests/server_cert_test.cpp`: SAN IP của mọi card, hostname, EKU/KeyUsage, `basicConstraints`; đọc lại bằng Mbed TLS.
- `server/tests/cert_cli_test.cpp`: `--cert-info`, `--make-csr` (CSR hợp lệ, khóa không lộ), `--import-cert` (khớp, không khớp, có khóa riêng, chuỗi, mất điện giữa chừng giả lập bằng dừng sau `server.pem.new`).
- `tests/web-it` kịch bản `cert`: CA thử (container) ký CSR do runtime sinh; Chrome headless với CA thử trong kho tin cậy (`--ignore-certificate-errors-spki-list` không dùng; dùng kho NSS thử) mở trang không lỗi chứng chỉ.
