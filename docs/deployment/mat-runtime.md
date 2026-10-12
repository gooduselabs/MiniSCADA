# Triển khai `mat-runtime` lên BL335 (thủ công, Sprint 1)

Dành cho kỹ sư triển khai. Quy trình theo đúng chuỗi của Constitution VII (stage → validate → backup → activate → health check → rollback), làm bằng script `deploy.sh`. Triển khai atomic qua API `/api/v1/deploy/*` là việc của Sprint 6.

Mọi thay đổi trên thiết bị phải ghi vào [docs/reports/device-changes.md](../reports/device-changes.md) kèm cách hoàn tác. Không đụng dịch vụ của sản phẩm cũ (`atscada-*`) trừ khi được yêu cầu rõ. Mật khẩu không ghi vào repo.

## 1. Chuẩn bị trên máy dev (Windows)

```powershell
./deployment/toolchain/build.ps1        # build chéo armhf trong Docker → build/armhf/bin/mat-runtime
npm run build:web                       # apps/runtime-web/dist-device (chỉ trang runtime)
./deployment/package-runtime.ps1        # → build/mat-runtime-armhf.tar.gz (khoảng 0,4 MB)
```

Script đóng gói **thất bại** nếu gói có file tên chứa `unsafe-elements`, trang lab (`lab.*`, `lab-*`), source map (`*.map`), file test (`*.test.*`) hoặc thư mục `web/screens/` (fixture của lab). Script không kiểm nội dung project truyền qua `-Project` (mặc định `projects/tank-demo`): không đóng gói thư mục vector trong `tests/`. Kèm theo gói là `build/mat-runtime-armhf.tar.gz.sha256` cho bước kiểm SHA-256 của `deploy.sh`.

## 2. Địa chỉ thiết bị

| Mục đích | Trong LAN | Từ xa (hiện tại) |
|---|---|---|
| SSH | `192.168.1.110:22` | `198.51.100.200:2222` |
| Trang runtime | `http://192.168.1.110:8080/` | `http://198.51.100.200:9080/` (router chuyển 9080 → 8080 của thiết bị) |

Cổng 8080 trên IP công cộng là một máy chủ khác của công ty, **không** phải BL335.

## 3. Chép gói và triển khai

Từ Git Bash trên máy dev (thay `-p 2222 root@198.51.100.200` bằng `root@192.168.1.XXX` khi ở LAN).

**Yêu cầu trên thiết bị:** systemd, `wget` (BL335 không có `curl`), `sha256sum`, `tar`, `runuser`; phiên SSH `root` (BL335 không có `sudo`); chỗ trống cho 3 bản trong `/opt` (`.new`, hiện hành, `.prev`).

**Kiểm cổng trước khi deploy** (FR-028):

```sh
ssh -p 2222 root@198.51.100.200 "ss -ltnp | grep ':8080 '"   # không in gì: cổng trống
```

Dòng in ra là `mat-runtime`: bản đang chạy của dự án, `deploy.sh` tự khởi động lại. Là `mat-poc` (PoC Sprint 0): nếu là dịch vụ thì `systemctl disable --now mat-poc` (hoàn tác: `systemctl enable --now mat-poc`), nếu chạy tay thì dừng tiến trình đó; ghi vào [device-changes.md](../reports/device-changes.md). Tiến trình khác: không deploy, báo người dùng.

**Chép gói và chạy `deploy.sh`:**

```sh
mkdir -p /tmp/up && cp build/mat-runtime-armhf.tar.gz build/mat-runtime-armhf.tar.gz.sha256 /tmp/up/
tr -d '\r' < deployment/device/deploy.sh   > /tmp/up/deploy.sh
tr -d '\r' < deployment/device/rollback.sh > /tmp/up/rollback.sh
# một phiên SSH, thư mục tạm tên ngẫu nhiên (mktemp -d): không ai đặt sẵn được thư mục root sẽ giải nén vào
tar -C /tmp/up -cf - . | ssh -p 2222 root@198.51.100.200 'D=$(mktemp -d) && tar -C "$D" -xf - && sh "$D/deploy.sh" "$D/mat-runtime-armhf.tar.gz"; rc=$?; rm -rf "$D"; exit $rc'
```

`deploy.sh` làm lần lượt:

0. **checksum:** so SHA-256 của gói với file `.sha256` cạnh gói. Thiếu file hoặc lệch thì dừng (`MAT_SKIP_CHECKSUM=1` để bỏ qua khi biết rõ lý do). Lần đầu tạo user hệ thống `matscada` (không đăng nhập) ngay sau bước này.
1. **stage:** giải nén vào `/opt/mat-runtime.new`.
2. **validate:** chạy `mat-runtime --check-project` bằng user `matscada` (bộ kiểm tra C++, cùng luật với Studio); kết quả vào file tạm `mktemp`, xóa ngay sau khi dùng. Project lỗi thì dừng, bản đang chạy giữ nguyên.
3. **config:** lần đầu cài `/etc/mat-runtime/runtime.json` (không ghi đè nếu đã có).
4. **backup, unit:** `/opt/mat-runtime` → `/opt/mat-runtime.prev`. Sau đó mới xử lý unit, để `mat-runtime.service.prev` luôn đi cặp với `/opt/mat-runtime.prev`:
   - unit trong gói khác `/etc/systemd/system/mat-runtime.service` (`MemoryMax=300M`, `NoNewPrivileges`, `ProtectSystem=strict`…): cài bản mới, giữ unit đang dùng ở `.service.prev`, `systemctl enable`;
   - unit không đổi: xóa `.service.prev` cũ, nếu có.
5. **activate:** `.new` → `/opt/mat-runtime`, `systemctl restart mat-runtime`.
6. **health check:** trong 15 s, `/api/v1/system/info` phải trả `project.status = "active"`. Không đạt thì **tự rollback** (`rollback.sh`).

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

## 5a. Lưu trữ dữ liệu Tag (feature 003)

Chỉ chạy khi project có `loggingFile` (`logging.json`, [contract](../../specs/003-data-logging/contracts/logging-config.md)). Khóa mới của `runtime.json`: `dataDir`, `secretsFile`, `clientLibDir`, `historianMaxDbMB` (64–65536, mặc định 2048), `historianMinFreeMB` (50–65536, mặc định 500), `historianCommitMs` (1000–60000, mặc định 5000) — [device.md](../../specs/003-data-logging/contracts/device.md).

**Dữ liệu trên thiết bị:** `/var/lib/mat-runtime/history.db` (+ `-wal`, `-shm`), thuộc `matscada`, quyền `0700` cho thư mục. systemd tạo thư mục (`StateDirectory=mat-runtime`); deploy và rollback không đụng tới thư mục này. File hỏng được đổi tên thành `history.db.corrupt-<epoch>` (giữ để điều tra, xóa tay).

**Sao lưu `history.db`** (đang chạy vẫn được, WAL không chặn người đọc):

```sh
systemctl stop mat-runtime && cp -a /var/lib/mat-runtime/history.db* /backup/ && systemctl start mat-runtime
```

Dừng dịch vụ trong lúc chép để có bản nhất quán (vài giây; dòng trong khoảng này không được lấy mẫu).

BL335 không cài `sudo`: các lệnh dưới đây chạy trong phiên SSH `root`. Lệnh chỉ đọc dữ liệu thì chạy bằng user của dịch vụ qua `runuser`.

**Xuất CSV** (giờ địa phương, mặc định 24 giờ gần nhất):

```sh
runuser -u matscada -- /opt/mat-runtime/bin/mat-runtime --export-history bao-cao-ca \
     --from "2026-10-10 06:00" --to "2026-10-10 14:00" --tz +07:00 > ca-sang.csv
```

**Kiểm file lưu trữ** (sau một lần mất điện, hoặc khi nghi hỏng; không cần dừng dịch vụ):

```sh
runuser -u matscada -- /opt/mat-runtime/bin/mat-runtime --check-history   # "integrity: ok" + số dòng từng bảng
```

**Mật khẩu/token của DB ngoài** (không bao giờ nằm trong project; file `/etc/mat-runtime/secrets.json`, `root:matscada`, `0640`):

```sh
/opt/mat-runtime/bin/mat-runtime --set-secret mysql-office      # gõ mật khẩu, không hiện ra màn hình
# token dài: dán vào biến không hiện ra màn hình, không lưu vào history của shell
read -rs TOKEN && printf '%s\n' "$TOKEN" | /opt/mat-runtime/bin/mat-runtime --set-secret influx; unset TOKEN
```

Thư viện client của DB ngoài (cài một lần, chỉ loại DB thật sự dùng): `apt-get install libmariadb3` (MySQL/MariaDB), `libsybdb5` (SQL Server), `libpq5` (PostgreSQL), `libcurl4` (InfluxDB). Thiếu thư viện thì đích báo `no_client`; runtime vẫn chạy.

Runtime đọc lại file ở mỗi lần kết nối: đổi mật khẩu không cần khởi động lại. Chạy lệnh trước lần cài đầu tiên (chưa có nhóm `matscada`) thì lệnh báo dịch vụ chưa đọc được file: chạy lại sau khi cài. Mật khẩu/token phải là UTF-8.

**TLS:** kết nối SQL (cả SQL Server) mặc định `verify-full`: kiểm chứng chỉ và tên máy theo kho CA của thiết bị. InfluxDB dùng `https://`. Chứng chỉ không được tin cậy hiện `tls` trong `system/info` và tab Thiết bị. Máy chủ dùng chứng chỉ tự ký hoặc do CA của nhà máy cấp có hai cách:

- Cách nên dùng: chép CA (hoặc chính chứng chỉ của máy chủ) vào `/usr/local/share/ca-certificates/<tên>.crt`, chạy `update-ca-certificates`, rồi `systemctl restart mat-runtime`. Cần người dùng cho phép, ghi vào [device-changes.md](../reports/device-changes.md). `host` của kết nối phải khớp tên hoặc IP trong chứng chỉ.
- Ghi rõ `"tls": "require"` cho kết nối đó: vẫn mã hóa nhưng không kiểm máy chủ, nên kẻ đứng giữa lấy được mật khẩu. Validator cảnh báo `W_LOG_TLS_UNVERIFIED`.

**Thư viện client đi kèm** (`clientLibDir`, mặc định `/opt/mat-runtime/lib`): chỉ được nạp khi thư mục và file thuộc root và không ghi được bởi nhóm/người khác; nếu không, runtime bỏ qua bản đi kèm (ghi vào journal) và dùng thư viện của hệ thống. Ubuntu 20.04 đã hết hỗ trợ chuẩn (2025-05): các gói `libpq5`, `libmariadb3`, `libsybdb5`, `libcurl4` chỉ còn bản vá qua Ubuntu Pro/ESM.

**Thư viện client** — chỉ cài loại DB thật sự dùng (cài/gỡ gói trên thiết bị cần người dùng cho phép, ghi vào [device-changes.md](../reports/device-changes.md)). Thiếu gói thì đích tương ứng báo `no_client`, runtime vẫn chạy:

| DB | Gói Ubuntu 20.04 | Gỡ |
|---|---|---|
| MySQL / MariaDB | `libmariadb3` | `apt remove libmariadb3` |
| SQL Server | `libsybdb5` | `apt remove libsybdb5` |
| PostgreSQL | `libpq5` | `apt remove libpq5` |
| InfluxDB | `libcurl4` | `apt remove libcurl4` |

SQL Server: runtime tự sinh một `freetds.conf` cho các kết nối của nó (trong `/tmp` riêng của dịch vụ, biến `FREETDSCONF`), không dùng `/etc/freetds/freetds.conf`.

**Theo dõi:** khối `historian` của `/api/v1/system/info` (trạng thái, số dòng, dung lượng, từng đích: `state`, `pendingRows`, `lagS`, lỗi gần nhất). Thông báo lỗi gốc của client (có tên user, địa chỉ máy chủ) chỉ có trong `journalctl -u mat-runtime`.

**Tài khoản DB ngoài:** quyền tối thiểu và bảng `mat_forward_state` mà runtime dùng: [external-schema.md](../../specs/003-data-logging/contracts/external-schema.md).

## 6. Rollback

```sh
sh /opt/mat-runtime/deployment/rollback.sh   # /opt/mat-runtime.prev → hiện hành; bản hỏng giữ ở /opt/mat-runtime.failed
```

Lần cài đầu không có bản trước: rollback chỉ dừng dịch vụ.

`rollback.sh` cũng khôi phục `mat-runtime.service.prev` nếu có. Từ ngày 2026-10-11, `deploy.sh` giữ `.service.prev` đi cặp với `/opt/mat-runtime.prev`; test `deployment/device/tests/deploy_rollback_test.sh` kiểm điều này.

Thiết bị deploy bằng `deploy.sh` cũ hơn có thể còn `.service.prev` là unit của một lần deploy cũ hơn `/opt/mat-runtime.prev` (BL335 đang ở trạng thái này). Khi đó:

- so hai unit bằng `diff` trước khi rollback tay;
- lần deploy kế tiếp bằng bản mới sẽ tự dọn.

## 7. Gỡ hoàn toàn (hoàn tác mọi thay đổi của Sprint 1)

```sh
systemctl disable --now mat-runtime
rm -f /etc/systemd/system/mat-runtime.service /etc/systemd/system/mat-runtime.service.prev && systemctl daemon-reload
rm -rf /opt/mat-runtime /opt/mat-runtime.prev /opt/mat-runtime.failed /opt/mat-runtime.new /etc/mat-runtime /tmp/mat-deploy
rm -f /tmp/mat-check-project.json  # do deploy.sh lần 4–5 của Sprint 1 để lại (bản hiện tại không còn tạo)
rm -rf /var/lib/mat-runtime        # dữ liệu lưu trữ (feature 003): chỉ khi chắc chắn không cần nữa
userdel matscada
```

Hoàn tác từng bước của `deploy.sh`:

| Bước | Thay đổi trên thiết bị | Hoàn tác |
|---|---|---|
| user | user hệ thống `matscada` | `userdel matscada` (sau khi gỡ dịch vụ) |
| stage | `/opt/mat-runtime.new` (chỉ còn lại khi `deploy.sh` dừng giữa chừng) | `rm -rf /opt/mat-runtime.new` |
| config | `/etc/mat-runtime/runtime.json` (chỉ lần đầu) | `rm -rf /etc/mat-runtime` |
| unit | `/etc/systemd/system/mat-runtime.service`, bản cũ ở `.service.prev`; `systemctl enable` | có `.prev`: đổi `.service.prev` thành `.service`, `systemctl daemon-reload`; lần đầu: `systemctl disable --now mat-runtime`, xóa unit |
| backup + activate | `/opt/mat-runtime`, bản trước ở `/opt/mat-runtime.prev` | `sh /opt/mat-runtime/deployment/rollback.sh` (bản bị thay giữ ở `/opt/mat-runtime.failed`) |
