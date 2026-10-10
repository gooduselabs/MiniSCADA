# Triển khai `mat-runtime` lên BL335 (thủ công, Sprint 1)

Dành cho kỹ sư triển khai. Quy trình theo đúng chuỗi của Constitution VII (stage → validate → backup → activate → health check → rollback), làm bằng script `deploy.sh`. Triển khai atomic qua API `/api/v1/deploy/*` là việc của Sprint 6.

Mọi thay đổi trên thiết bị phải ghi vào [docs/reports/device-changes.md](../reports/device-changes.md) kèm cách hoàn tác. Không đụng dịch vụ của sản phẩm cũ (`atscada-*`) trừ khi được yêu cầu rõ. Mật khẩu không ghi vào repo.

## 1. Chuẩn bị trên máy dev (Windows)

```powershell
./deployment/toolchain/build.ps1        # build chéo armhf trong Docker → build/armhf/bin/mat-runtime
npm run build:web                       # apps/runtime-web/dist-device (chỉ trang runtime)
./deployment/package-runtime.ps1        # → build/mat-runtime-armhf.tar.gz (khoảng 0,4 MB)
```

Script đóng gói **thất bại** nếu gói chứa fixture SVG, `unsafe-elements.svg`, trang lab hoặc file test.

## 2. Địa chỉ thiết bị

| Mục đích | Trong LAN | Từ xa (hiện tại) |
|---|---|---|
| SSH | `192.168.1.110:22` | `198.51.100.200:2222` |
| Trang runtime | `http://192.168.1.110:8080/` | `http://198.51.100.200:9080/` (router chuyển 9080 → 8080 của thiết bị) |

Cổng 8080 trên IP công cộng là một máy chủ khác của công ty, **không** phải BL335.

## 3. Chép gói và triển khai

Từ Git Bash trên máy dev (thay `-p 2222 root@198.51.100.200` bằng `root@192.168.1.XXX` khi ở LAN):

```sh
mkdir -p /tmp/up && cp build/mat-runtime-armhf.tar.gz /tmp/up/
tr -d '\r' < deployment/device/deploy.sh   > /tmp/up/deploy.sh
tr -d '\r' < deployment/device/rollback.sh > /tmp/up/rollback.sh
tar -C /tmp/up -cf - . | ssh -p 2222 root@198.51.100.200 'rm -rf /tmp/mat-deploy && mkdir -p /tmp/mat-deploy && cd /tmp/mat-deploy && tar xf -'
ssh -p 2222 root@198.51.100.200 'sh /tmp/mat-deploy/deploy.sh /tmp/mat-deploy/mat-runtime-armhf.tar.gz'
```

`deploy.sh` làm lần lượt:

1. **stage:** giải nén vào `/opt/mat-runtime.new`.
2. **validate:** chạy `mat-runtime --check-project` (bộ kiểm tra C++, cùng luật với Studio). Project lỗi thì dừng, bản đang chạy giữ nguyên.
3. **lần đầu:** tạo user hệ thống `matscada` (không đăng nhập), cài `/etc/mat-runtime/runtime.json` (không ghi đè nếu đã có) và `/etc/systemd/system/mat-runtime.service` (`MemoryMax=300M`, `NoNewPrivileges`, `ProtectSystem=strict`…), `systemctl enable`.
4. **backup:** `/opt/mat-runtime` → `/opt/mat-runtime.prev`.
5. **activate:** `.new` → `/opt/mat-runtime`, `systemctl restart mat-runtime`.
6. **health check:** trong 15 s, `/api/v1/system/info` phải trả `project.status = "active"`. Không đạt thì **tự rollback**.

## 4. Kiểm tra sau triển khai

```sh
systemctl status mat-runtime --no-pager
wget -qO- http://127.0.0.1:8080/api/v1/system/info      # trên thiết bị (không có curl)
journalctl -u mat-runtime -n 50 --no-pager               # log
```

Từ máy dev: mở trang runtime trên Chrome, hoặc `node tools/measure/runtime-smoke.mjs http://198.51.100.200:9080/`.

## 5. Cấu hình

File `/etc/mat-runtime/runtime.json` ([contract](../../specs/002-vertical-slice/contracts/runtime-config.md)). Sửa xong thì `systemctl restart mat-runtime`.

- `maxClients` 1–10; giá trị > 10 bị kẹp về 10.
- `allowedOrigins`: origin được mở WebSocket ngoài cùng origin. Mặc định là origin của Studio (`http://tauri.localhost`, `tauri://localhost`). Khi thử Studio bản dev (`npm run studio:dev`), thêm tạm `http://localhost:1420` trên **thiết bị thử**, không thêm trên thiết bị vận hành.
- `simLoad`: `true` thì có thêm 500 Tag `SIM.*` để đo tải.

## 6. Rollback

```sh
sh /opt/mat-runtime/deployment/rollback.sh   # /opt/mat-runtime.prev → hiện hành; bản hỏng giữ ở /opt/mat-runtime.failed
```

Lần cài đầu không có bản trước: rollback chỉ dừng dịch vụ.

## 7. Gỡ hoàn toàn (hoàn tác mọi thay đổi của Sprint 1)

```sh
systemctl disable --now mat-runtime
rm -f /etc/systemd/system/mat-runtime.service && systemctl daemon-reload
rm -rf /opt/mat-runtime /opt/mat-runtime.prev /opt/mat-runtime.failed /opt/mat-runtime.new /etc/mat-runtime /tmp/mat-deploy
userdel matscada
```
