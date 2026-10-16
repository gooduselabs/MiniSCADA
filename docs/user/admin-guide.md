# Hướng dẫn quản trị viên

Dành cho người cài đặt và giữ hệ thống chạy: thiết bị BL335, tài khoản, chứng chỉ, sao lưu, cập nhật, gia cố, chẩn đoán. Chi tiết kỹ thuật đầy đủ của từng khóa cấu hình: [mat-runtime.md](../deployment/mat-runtime.md). Alarm: [alarm-operations.md](../deployment/alarm-operations.md).

Áp dụng cho runtime 0.9 và Studio 0.8. Mục ghi **(có từ bản 1.0)** mô tả tính năng của bản 1.0 theo đặc tả đã duyệt; bản hiện tại chưa có.

Quy ước trong tài liệu:

- Lệnh `mat-runtime …` chạy trên thiết bị, trong phiên SSH `root` (BL335 không có `sudo`). Đường dẫn đầy đủ: `/opt/mat-runtime/bin/mat-runtime`. Lệnh chỉ đọc dữ liệu chạy bằng user của dịch vụ: `runuser -u matscada -- mat-runtime …`.
- `<địa chỉ>` là IP hoặc tên của thiết bị trong LAN. **Không** ghi mật khẩu, IP công cộng hay cổng SSH của thiết bị vào tài liệu, ticket hay chat chung.
- Mọi thay đổi trên thiết bị ghi vào sổ thay đổi của site kèm cách hoàn tác.

## 1. Vai trò

| Vai trò | Được làm |
|---|---|
| `viewer` | xem trang vận hành, chẩn đoán; không điều khiển |
| `operator` | thêm: điều khiển trên trang vận hành, xác nhận và tạm ẩn alarm |
| `engineer` | thêm: nạp xuống, đọc lên, khôi phục project bằng Studio, thử kết nối |
| `administrator` | thêm: đọc audit, cập nhật runtime qua mạng (có từ bản 1.0) |

Quyền root trên thiết bị (SSH) đứng ngoài các vai trò trên: tạo tài khoản, sửa cấu hình, bật ghi PLC từ logic, bật cập nhật qua mạng.

## 2. Cài đặt

### 2.1. Runtime trên BL335 (lần đầu hoặc cập nhật thủ công)

Cần: gói `mat-runtime-armhf.tar.gz` và tệp `.sha256` đi kèm, script `deploy.sh` và `rollback.sh` (trong `deployment/device/`), phiên SSH root.

1. Kiểm cổng 8080 còn trống (không in gì là trống; in `mat-runtime` là bản cũ, `deploy.sh` tự thay):

   ```sh
   ssh root@<địa chỉ> "ss -ltnp | grep ':8080 '"
   ```

2. Chép gói, `.sha256`, `deploy.sh`, `rollback.sh` vào một thư mục tạm trên máy, rồi chạy `deploy.sh` trong một phiên SSH (thư mục tạm tên ngẫu nhiên):

   ```sh
   tar -C /tmp/up -cf - . | ssh root@<địa chỉ> 'D=$(mktemp -d) && tar -C "$D" -xf - && sh "$D/deploy.sh" "$D/mat-runtime-armhf.tar.gz"; rc=$?; rm -rf "$D"; exit $rc'
   ```

3. `deploy.sh` làm: kiểm SHA-256, giải nén vào `/opt/mat-runtime.new`, kiểm project, cài cấu hình lần đầu, sao lưu bản đang chạy vào `/opt/mat-runtime.prev`, kích hoạt, kiểm tra sức khỏe trong 15 s. Không đạt thì **tự rollback**.
4. Lần đầu: `deploy.sh` hỏi mật khẩu cho tài khoản `admin` (vai trò administrator) nếu có terminal; nếu không, nó in "BƯỚC BẮT BUỘC" kèm lệnh tạo tài khoản (mục 4).
5. Ghi lại **fingerprint** mà `deploy.sh` in ra (dùng ở mục 3).

Kiểm tra sau cài:

```sh
systemctl status mat-runtime --no-pager
wget -qO- http://127.0.0.1:8080/api/v1/system/info
journalctl -u mat-runtime -n 50 --no-pager
```

Rollback tay về bản trước: `sh /opt/mat-runtime/deployment/rollback.sh` (bản hỏng giữ ở `/opt/mat-runtime.failed`).

### 2.2. mAT Studio trên Windows

1. Chạy bộ cài `mAT Studio_<phiên bản>_x64-setup.exe`. Từ bản 1.0 bộ cài có chữ ký số; kiểm tên nhà phát hành trong hộp cảnh báo của Windows (có từ bản 1.0). SmartScreen vẫn có thể cảnh báo với bản mới phát hành.
2. Lần đầu tìm thiết bị, Windows có thể hỏi cho phép qua tường lửa: chọn **mạng riêng**.
3. Studio cần WebView2 (có sẵn trên Windows 10/11 cập nhật).

## 3. Chứng chỉ HTTPS

Thiết bị tự sinh chứng chỉ ở lần chạy đầu. Studio và Chrome kiểm thiết bị bằng **fingerprint SHA-256** của chứng chỉ.

- Đọc fingerprint trên thiết bị:

  ```sh
  runuser -u matscada -- /opt/mat-runtime/bin/mat-runtime --cert-fingerprint
  mat-runtime --cert-info     # chủ thể, SAN, hạn, fingerprint
  ```

- Đưa fingerprint cho kỹ sư qua kênh tin cậy (đọc trực tiếp, giấy) để họ so khi ghim trong Studio.
- **Chrome trên máy vận hành:** mở `https://<địa chỉ>:8443/device.crt` để tải chứng chỉ, so fingerprint, rồi cài vào "Trusted Root Certification Authorities" của Windows (`certmgr.msc`, hoặc `certutil -addstore -f Root mat-device.crt` với quyền quản trị; nhiều máy: Group Policy). Khởi động lại Chrome.
- Đặt **IP tĩnh** cho BL335: chứng chỉ ghi IP của thiết bị. Đổi IP thì chạy `mat-runtime --regen-cert` (fingerprint đổi: Studio phải ghim lại, máy vận hành phải cài lại chứng chỉ).
- Dùng CA của công ty: `mat-runtime --make-csr --san <IP>,<tên miền>` → gửi CSR cho CA → `mat-runtime --import-cert chain.pem` → `systemctl restart mat-runtime`. CA phải ký bằng **ECDSA**; chứng chỉ ký RSA bị từ chối.

## 4. Tài khoản

Tài khoản nằm trong `/etc/mat-runtime/users.json` (`0640 root:matscada`; runtime từ chối tệp có quyền khác). Chỉ tạo trên thiết bị bằng root; không có đăng ký hay quên mật khẩu trên web.

```sh
mat-runtime --user-add admin --role administrator     # hỏi mật khẩu hai lần, không hiện ký tự
mat-runtime --user-add kysu1 --role engineer
mat-runtime --user-add vanhanh1 --role operator
mat-runtime --user-add xem1 --role viewer
mat-runtime --user-list
mat-runtime --user-passwd kysu1                       # đổi mật khẩu
mat-runtime --user-role kysu1 operator                # đổi vai trò
mat-runtime --user-disable kysu1                      # tắt (người nghỉ việc)
mat-runtime --user-enable kysu1
```

Mật khẩu không bao giờ là tham số dòng lệnh. Dùng trong script: `printf '%s\n' "$MAT_PW" | mat-runtime --user-add kysu2 --role engineer --password-stdin`.

**Mật khẩu:** mật khẩu mới dài **15 đến 128 ký tự**, khác tên tài khoản, dạng Unicode dựng sẵn (bộ gõ Unikey/EVKey đặt "Unicode dựng sẵn"). Tài khoản có sẵn với mật khẩu cũ ngắn hơn không bị buộc đổi, nhưng nên đổi. Mỗi người một tài khoản; không dùng chung `admin`.

**Khóa đăng nhập tạm:**

- Sai 5 lần liên tiếp thì khóa **cặp (tên tài khoản, IP máy)** đó 5 phút (kể cả khi gõ đúng). Lặp lại trong 24 giờ thì gấp đôi, tối đa 60 phút; không bao giờ khóa vĩnh viễn. Trang báo `AUTH_LOCKED`.
- Cùng tài khoản từ máy khác vẫn đăng nhập được: người ngoài không khóa được tài khoản của người khác từ xa.
- Một IP sai 20 lần (mọi tên) trong 10 phút: mọi đăng nhập từ IP đó bị khóa 5 phút. Nhiều người sau cùng một NAT có thể bị khóa chung.
- Quá 2 lần kiểm mật khẩu cùng lúc (`maxConcurrentLogins`): 429 `LOGIN_BUSY`, thử lại sau 1 s, không khóa ai.
- Một tên bị sai ≥ 50 lần trong 10 phút từ ≥ 5 IP: audit `auth.distributed_attack` (không khóa). Gặp mục này: kiểm tra mạng, đổi mật khẩu tài khoản đó.
- Mở khóa sớm: `mat-runtime --user-unlock <tên>` (mọi cặp của tên đó, có hiệu lực trong 2 s) hoặc `mat-runtime --user-unlock-all` (mọi cặp và mọi IP, trong 5 s). Khởi động lại dịch vụ cũng xóa mọi khóa.

**Phiên:** hết sau 30 phút rảnh (`webSessionIdleMin`, 5–480; trạm 24/7 có thể đặt 480), tối đa 12 giờ (`webSessionMaxHours`). Tối đa 12 phiên web cùng lúc (`webMaxSessions`).

## 5. Cấu hình mạng và gia cố

Cấu hình ở `/etc/mat-runtime/runtime.json`. Sửa xong: `systemctl restart mat-runtime`, rồi xem cảnh báo bằng `journalctl -u mat-runtime -n 50 --no-pager`. Sai kiểu hoặc ngoài khoảng: runtime không chạy và in tên khóa sai. Khóa lạ: bỏ qua kèm `warning: bỏ qua khóa không hỗ trợ` (gõ sai tên khóa thì runtime dùng mặc định: luôn đọc cảnh báo).

### 5.1. Tên truy cập (`allowedHosts`)

Thiết bị kiểm tiêu đề `Host` của mọi yêu cầu (chống DNS rebinding). Luôn nhận: mọi địa chỉ IP, `localhost`, tên máy của thiết bị và `<tên máy>.local`. Truy cập bằng tên khác (DNS nội bộ, DDNS) bị trả 421 `HOST_NOT_ALLOWED`. Thêm tên:

```json
"allowedHosts": ["scada.nhamay.vn"]
```

So khớp chính xác, không phân biệt hoa thường, không có ký tự đại diện. `"hostCheck": "off"` tắt kiểm, chỉ dùng khi gỡ rối (cảnh báo `HOST_CHECK_OFF`).

### 5.2. Ai được xem

| Khóa | Giá trị nên dùng | Ghi chú |
|---|---|---|
| `viewerAccess` | `private` (mặc định) | trang xem không đăng nhập chỉ cho địa chỉ mạng riêng; `any` chỉ khi demo (cảnh báo `VIEWER_PUBLIC`); `off` tắt trang xem |
| `viewerLogin` | `off` cho kiosk trong phòng điều khiển; `required` khi trang có thể bị mở từ ngoài LAN | `required`: không có dữ liệu nếu chưa đăng nhập |
| `maxConnPerSource` | 24 (mặc định) | số kết nối tối đa mỗi IP; chống một máy chiếm hết worker |

Kết nối HTTPS rảnh được giữ 3 s rồi đóng; 40 worker HTTPS (`httpsThreads`) đủ cho 10 trang mở cùng lúc.

### 5.3. Gia cố thiết bị

- **SSH:** dùng khóa SSH cho root (`PermitRootLogin prohibit-password`) hoặc `PasswordAuthentication no`, rồi `systemctl reload ssh`. Khi root còn đăng nhập bằng mật khẩu, thiết bị báo cảnh báo `SSH_ROOT_PASSWORD` (đọc `/etc/ssh/sshd_config` lúc khởi động và 10 phút một lần). Đổi mật khẩu root mặc định ngay khi nhận thiết bị.
- **Truy cập từ xa:** dùng **VPN** vào LAN của thiết bị. Không chuyển cổng (port-forward) 22, 8080, 8443 ra Internet. Nếu bắt buộc chuyển cổng HTTPS: giới hạn nguồn ở router, `viewerLogin: required`, mật khẩu dài. Router làm SNAT thì bộ lọc mạng riêng của thiết bị không còn tác dụng.
- **Mạng:** IP tĩnh; NTP cho đồng hồ (lịch và báo cáo cần giờ đúng); chỉ mở UDP 8446 (tìm thiết bị) trong LAN, hoặc tắt bằng `"discoveryEnabled": false`.
- **Tệp:** không đổi quyền `users.json`, `secrets.json` (`0640 root:matscada`), thư mục `/var/lib/mat-runtime` (`0700 matscada`).
- Hướng dẫn gia cố chi tiết kèm bộ luật tường lửa mẫu: `docs/deployment/hardening.md` (có từ bản 1.0).

## 6. Sao lưu và khôi phục

### 6.1. Có gì cần sao lưu

| Nội dung | Nơi trên thiết bị | Ghi chú |
|---|---|---|
| Cấu hình | `/etc/mat-runtime/runtime.json` | |
| Tài khoản | `/etc/mat-runtime/users.json` | chỉ có băm mật khẩu, vẫn giữ kín |
| Mật khẩu DB ngoài | `/etc/mat-runtime/secrets.json` | **bí mật**: lưu bản sao mã hóa |
| Chứng chỉ và khóa | `/var/lib/mat-runtime/tls/` | **bí mật**; giữ thì không phải ghim lại |
| Project đang chạy và 3 bản dự phòng | `/var/lib/mat-runtime/projects/` | bản chính nên nằm ở máy kỹ sư (Đọc lên) |
| Lịch sử, alarm, audit | `/var/lib/mat-runtime/{history,alarm,audit}.db*` | lớn dần; chép kèm tệp `-wal`, `-shm` |
| Giá trị giữ qua mất điện | `/var/lib/mat-runtime/retain/` | |

Bản project tốt nhất là thư mục project trên máy kỹ sư. Nếu mất: Studio, **Đọc lên…** > **Thành project mới**.

### 6.2. Sao lưu

Dừng dịch vụ vài giây để có bản nhất quán (trong lúc dừng không có dữ liệu):

```sh
systemctl stop mat-runtime
tar -C / -czf /root/mat-backup-$(date +%Y%m%d).tar.gz etc/mat-runtime var/lib/mat-runtime
systemctl start mat-runtime
```

Chép tệp sao lưu ra khỏi thiết bị (máy quản trị, ổ mã hóa). Kiểm chỗ trống trước: `df -h /root /var/lib`.

### 6.3. Khôi phục

1. Cài runtime cùng phiên bản (mục 2.1) nếu thiết bị mới.
2. Khôi phục:

   ```sh
   systemctl stop mat-runtime
   tar -C / -xzf /root/mat-backup-<ngày>.tar.gz
   chown -R matscada:matscada /var/lib/mat-runtime && chmod 0700 /var/lib/mat-runtime
   chown root:matscada /etc/mat-runtime/users.json /etc/mat-runtime/secrets.json
   chmod 0640 /etc/mat-runtime/users.json /etc/mat-runtime/secrets.json
   systemctl start mat-runtime
   ```

3. Kiểm: `runuser -u matscada -- mat-runtime --project-status`, `runuser -u matscada -- mat-runtime --check-history` ("integrity: ok"), `runuser -u matscada -- mat-runtime --alarm-db-check`.

Từ bản 1.0, `mat-runtime --check-data --json` kiểm một lần mọi kho dữ liệu (lịch sử, audit, project, retain, nhật ký xung, trạng thái logic) (có từ bản 1.0).

### 6.4. Khôi phục project

Studio, **Online** > **Khôi phục bản trước…**: chọn một trong 3 bản dự phòng. Xem trạng thái trên thiết bị: `runuser -u matscada -- mat-runtime --project-status`.

## 7. Cập nhật runtime

### 7.1. Thủ công bằng `deploy.sh`

Như mục 2.1. Luôn dùng được, kể cả khi cập nhật qua mạng hỏng. Trước khi cập nhật: sao lưu (mục 6.2), báo người vận hành, chọn giờ thấp điểm. `deploy.sh` giữ bản cũ ở `/opt/mat-runtime.prev`; rollback bằng `rollback.sh`.

Lên bản mới mà rồi phải rollback về bản cũ: bản cũ có thể không đọc được project hay cấu hình mới (xem mục 11). Bản 0.9 trở về trước từ chối khởi động khi gặp khóa cấu hình lạ: bỏ các khóa mới khỏi `runtime.json` trước khi rollback.

### 7.2. Qua mạng từ Studio (có từ bản 1.0)

Mặc định **tắt**. Bật cần root trên thiết bị:

1. Đặt khóa công khai của nhà phát hành vào `/etc/mat-runtime/trusted-keys/` (`deploy.sh` cài sẵn khóa đi kèm gói). Xem khóa: `mat-runtime --trust-key list` (có từ bản 1.0).
2. Sửa `runtime.json`: `"update": {"enabled": true}`; `systemctl restart mat-runtime`. Thiếu khóa thì có cảnh báo `UPDATE_KEYS_MISSING`.
3. Trong Studio (tài khoản administrator), trang **Thiết bị**, thẻ "Cập nhật runtime": chọn tệp `.matupdate`, tải lên, đọc kế hoạch (phiên bản, tương thích, thời gian ngừng ước tính, người ký), **nhập lại mật khẩu**, theo dõi.
4. Thiết bị kiểm chữ ký, tự kiểm bản mới, đổi bản, kiểm tra sức khỏe tối đa 60 s. Không đạt thì tự quay về bản cũ (tổng ≤ 90 s), có cảnh báo `UPDATE_ROLLED_BACK`. Mục tiêu ngừng phục vụ ≤ 30 s.
5. Kết quả lần gần nhất trên thiết bị: `mat-runtime --update-status` (có từ bản 1.0).

Gói không có chữ ký hợp lệ, sai kiến trúc, hoặc cũ hơn bản đang chạy đều bị từ chối. Cập nhật chính bộ cập nhật (`mat-updater`) chỉ làm thủ công (mục 7.1).

### 7.3. Kiểm bản phát hành trước khi cài (có từ bản 1.0)

Mỗi bản phát hành có `SHA256SUMS` và chữ ký `SHA256SUMS.sig`. Kiểm bằng `mat-update-verify SHA256SUMS --sig SHA256SUMS.sig --keys deployment/keys/` (mã thoát 0 là hợp lệ) (có từ bản 1.0).

## 8. Chẩn đoán và KPI

- `GET /api/v1/system/info` (HTTP, mạng riêng): phiên bản, project, cảnh báo (`warnings`), trạng thái lưu trữ, alarm. Trên thiết bị: `wget -qO- http://127.0.0.1:8080/api/v1/system/info`.
- Studio: Inspector của thiết bị, tab **Chẩn đoán** (CPU, RAM, dung lượng trống, giờ, số phiên); **Audit của thiết bị** (administrator).
- Xuất audit: `runuser -u matscada -- mat-runtime --export-audit --from "2026-10-01 00:00" --format csv > audit.csv`.
- Lưu trữ: `runuser -u matscada -- mat-runtime --history-stats` (số dòng, dung lượng, số lần chạy).
- Log: `journalctl -u mat-runtime --since "1 hour ago" --no-pager`.
- Số luồng: `ls /proc/$(pidof mat-runtime)/task | wc -l` (khoảng 73 là bình thường: phần lớn là worker HTTP/HTTPS).
- Ghi eMMC: `system/info`, mục `historian.io` (`bytesPerDay`). Ngân sách: ≤ 2 GB/ngày.

**KPI của bản 1.0 (có từ bản 1.0):** `GET /api/v1/system/diagnostics` (role viewer) trả `uptimeS`, số lần khởi động lại và nguyên nhân, `rssMb`, `cpuPct`, ghi đĩa trong ngày theo thành phần, `emmcLife`, `liveLagP95Ms`, `timeSynced`. Trong pilot, `tools/pilot/collect.ps1` thu dữ liệu này mỗi 15 phút và `tools/pilot/kpi.mjs` tính KPI (xem [docs/pilot/criteria.md](../pilot/criteria.md)).

Ngưỡng tham khảo: RSS ≤ 150 MB, CPU trung bình ≤ 30 %, `liveLagP95Ms` ≤ 500 ms, ghi eMMC ≤ 2 GB/ngày.

## 9. Ghi xuống PLC từ logic (`logic.writes`, có từ bản 1.0)

Logic của project (bản 1.0) có thể ghi xuống PLC qua danh sách "Ghi PLC" mà kỹ sư khai. Thiết bị **mặc định chặn** mọi lệnh ghi của logic (`"logic": {"writes": "off"}`), ghi audit `logic.write.suppressed` và báo cảnh báo `LOGIC_WRITES_OFF`.

- **Bật** (sau khi kỹ sư và người phụ trách an toàn đã duyệt danh sách ghi): root sửa `runtime.json` thành `"logic": {"writes": "on"}`, rồi `systemctl restart mat-runtime`. Không bật được từ Studio hay web.
- **Dừng khẩn:** administrator trong Studio, chip "Ghi PLC" > "Dừng ghi của logic": có hiệu lực ngay, giữ qua khởi động lại. Bật lại chỉ bằng root như trên.
- Giới hạn: `logic.maxWritesPerMin` (mặc định 20 lệnh mỗi phút cho mọi luật). Vượt thì luật bị tạm hãm (`LOGIC_THROTTLED`).
- Mỗi lệnh ghi của logic có audit, người thực hiện `logic:<id luật>`.

## 10. Lệnh xung và mất điện (`pulseRecovery`)

Nút xung bật bit rồi tự nhả sau N ms. Runtime ghi nhật ký xung `/var/lib/mat-runtime/pulse.journal`. Nếu runtime bị dừng hay mất điện giữa xung, lần khởi động sau runtime **nhả lại** bit đó khi nối được PLC (thử mỗi 5 s, tối đa 10 phút), ghi audit nguồn `pulse-recovery`.

- Hết 10 phút chưa nhả được: cảnh báo `PULSE_STUCK` kèm danh sách Tag. Kiểm PLC bằng tay.
- `"pulseRecovery": "off"`: không tự nhả, chỉ báo `PULSE_STUCK`.
- **PLC phải tự nhả bit lệnh xung** sau một thời gian (ví dụ gấp đôi xung dài nhất). Nhật ký xung chỉ rút ngắn thời gian kẹt, không thay được bảo vệ trong PLC.

## 11. Ma trận phiên bản

| Studio | Runtime | Định dạng project | Kết quả |
|---|---|---|---|
| 0.8 | 0.9 | 0.1 đến 0.6 | đầy đủ (bản hiện tại) |
| 1.0 | 1.0 | 0.1 đến 0.6 và 1.0.0 | đầy đủ (có từ bản 1.0) |
| 1.0 | 0.9 hoặc cũ hơn | 1.0.0 | Studio ẩn cập nhật qua mạng và logic, **chặn** nạp xuống project 1.0.0 kèm hướng dẫn cập nhật runtime |
| 0.8 hoặc cũ hơn | 1.0 | 1.0.0 | Studio cũ từ chối mở project 1.0.0; project định dạng cũ vẫn nạp xuống được |

Mỗi runtime có `minRuntimeVersion` của project: runtime cũ hơn từ chối với `E_RUNTIME_TOO_OLD`. Xem phiên bản đang chạy: `system/info` hoặc tab Thiết bị của Studio.

## 12. Sự cố thường gặp

| Hiện tượng | Kiểm | Xử lý |
|---|---|---|
| Trang không mở | `systemctl status mat-runtime`; `ss -ltnp` | xem `journalctl`; lỗi cấu hình thì sửa khóa được nêu tên |
| Chrome `NET::ERR_CERT_AUTHORITY_INVALID` | | cài chứng chỉ (mục 3) |
| Chrome `NET::ERR_CERT_COMMON_NAME_INVALID` | cảnh báo `TLS_NO_IP_SAN` hoặc `TLS_SAN_MISMATCH` | `mat-runtime --regen-cert` sau khi đặt IP tĩnh |
| 421 `HOST_NOT_ALLOWED` | mở bằng tên miền chưa khai | thêm vào `allowedHosts` (mục 5.1) |
| Người dùng báo bị khóa | audit `auth.lockout` | `mat-runtime --user-unlock <tên>`; nếu thấy `auth.distributed_attack`: kiểm mạng |
| 403 `SOURCE_NOT_ALLOWED` trên trang xem | truy cập từ ngoài mạng riêng | VPN; hoặc `viewerAccess` (mục 5.2) |
| Đăng nhập, ghi bị từ chối `AUDIT_UNAVAILABLE` | `df -h /var/lib`; `journalctl` | giải phóng chỗ; audit phải ghi được thì mới cho thay đổi |
| Cảnh báo `SSH_ROOT_PASSWORD` | `/etc/ssh/sshd_config` | mục 5.3 |
| Cảnh báo `PULSE_STUCK` | Tag trong `detail` | kiểm PLC, nhả bit bằng tay (mục 10) |
| Lưu trữ dừng ghi | `system/info` mục `historian` | kiểm `historianMinFreeMB`, dung lượng |
| Sau mất điện nghi hỏng dữ liệu | `--check-history`, `--alarm-db-check` | tệp hỏng được đổi tên `*.corrupt-<thời điểm>`; khôi phục từ sao lưu nếu cần |
| Nạp xuống tự quay về bản cũ | thông báo ở Studio; `--project-status` | đọc lý do (kiểm tra sức khỏe không đạt); sửa project rồi nạp lại |

## 13. Bảng tác vụ kiểm tra

Giáo trình: [docs/training/admin.md](../training/admin.md). Làm trên bàn thử, không làm trên thiết bị đang điều khiển máy thật.

| # | Mục tiêu | Các bước | Kết quả mong đợi |
|---|---|---|---|
| A1 | Cài runtime | mục 2.1 trên bàn thử | `deploy.sh` báo thành công; `system/info` có `project.status` = `active` |
| A2 | Tạo tài khoản | tạo `kysu1` (engineer) và `vanhanh1` (operator) | `--user-list` có hai dòng; đăng nhập được bằng Studio và Chrome |
| A3 | Từ chối mật khẩu ngắn | `--user-passwd vanhanh1` với mật khẩu 10 ký tự | lệnh báo "mật khẩu quá ngắn: cần ít nhất 15 ký tự" |
| A4 | Mở khóa | đăng nhập sai 5 lần trên Chrome, rồi `--user-unlock vanhanh1` | lần thứ 6 báo bị khóa; sau mở khóa đăng nhập được |
| A5 | Chứng chỉ cho Chrome | tải `/device.crt`, so fingerprint, cài vào kho Windows | Chrome mở `https://…:8443/` không cảnh báo |
| A6 | Thêm tên truy cập | thêm tên vào `allowedHosts`, khởi động lại | mở bằng tên đó được; tên khác báo 421 |
| A7 | Sao lưu | mục 6.2 | có tệp `.tar.gz` ngoài thiết bị; dịch vụ chạy lại |
| A8 | Khôi phục | xóa một tài khoản, khôi phục từ sao lưu (mục 6.3) | tài khoản trở lại; `--check-history` "integrity: ok" |
| A9 | Khôi phục project | Studio **Khôi phục bản trước…** | `--project-status` hiện bản đã chọn đang chạy |
| A10 | Rollback runtime | `rollback.sh` trên bàn thử | bản trước chạy; `system/info` hiện phiên bản trước |
| A11 | Gia cố SSH | đổi sang khóa SSH, `PermitRootLogin prohibit-password` | sau tối đa 10 phút cảnh báo `SSH_ROOT_PASSWORD` hết |
| A12 | Đọc audit | Studio **Audit của thiết bị**, lọc theo tài khoản | thấy đăng nhập, nạp xuống của A2–A9 |
| A13 | Chẩn đoán | đọc `system/info`, tab Chẩn đoán, `journalctl` | nêu được phiên bản, RSS, cảnh báo đang có |
| A14 | Cập nhật qua mạng (có từ bản 1.0) | bật `update.enabled`, cập nhật từ Studio bằng gói thử | thiết bị chạy bản mới; `--update-status` báo thành công |
