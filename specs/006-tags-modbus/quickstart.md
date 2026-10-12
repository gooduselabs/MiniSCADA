# Quickstart: kiểm chứng 006 Tag v1, Modbus, Tag tính toán, ghi Tag

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · Định dạng và giá trị mong đợi: [contracts/](contracts/)

Các kịch bản đi từ máy dev tới BL335. Script ghi "(task tạo)" chưa có, sẽ được thêm khi làm tasks. Mục nào chưa làm được thì ghi "chưa đo" trong báo cáo nghiệm thu `docs/reports/006-acceptance.md`.

## 0. Chuẩn bị (máy dev Windows)

- Docker Desktop đang chạy (image toolchain `mat-armhf`); `npm install` ở gốc repo; Node ≥ 22.
- Rust 1.99 MSVC; `$env:CARGO_TARGET_DIR = 'C:\build\mat-studio'` (ổ D: còn ít chỗ).
- Project mẫu `projects/modbus-demo/` (0.2.0, task tạo): một kênh Modbus TCP tới giả lập, một kênh RTU (chỉ dùng trong test pty), đủ bốn loại Tag, bảng giá trị `TrangThaiBom`, bảng theo dõi "Vận hành". `projects/tank-demo` giữ 0.1 để thử nâng cấp.

## 1. Test tự động

```powershell
./deployment/toolchain/test-x64.ps1                 # GoogleTest: expression, tag-engine, codec, modbus (pty RTU), driver SDK,
                                                    # retain, tag-write, source filter, validator 0.2, fuzz 60 s
npm test -w @mat/expression                         # biểu thức, bảng giá trị (vector chung)
npm test -w @mat/tag-codec                          # địa chỉ, thô ↔ giá trị, scaling, chuỗi (vector chung)
npm test -w @mat/tag-sim                            # bộ sinh (vector chung)
npm test -w @mat/project-schema                     # bộ kiểm tra 0.1 + 0.2, migration (cặp file), đổi tên Tag, so sánh
npm test -w @mat/live-client                        # reason, 4401
npm test -w @mat/studio                             # lưới (dán, điền, CSV, bộ gõ), WriteFlow, SimEngine, đăng ký live
npm run e2e -w @mat/studio                          # Chrome headless, lớp Tauri giả, axe-core, đo SC-012
cd apps/studio/src-tauri; cargo test --lib          # live_open có token, device_post, project_backup, csv_*
./tools/ci-local.ps1                                # toàn bộ, gồm armhf smoke
```

**Mong đợi:**

- Mọi test xanh, có các bộ test mới (FR-058):
  - **vector chung, hai bản cho cùng kết quả 100 %:** ≥ 300 ca biểu thức (SC-008), địa chỉ, đổi giá trị, bảng giá trị, bộ sinh;
  - **bộ kiểm tra:** 82 ca 0.1 giữ nguyên kết luận; ca `v02-*` đủ mã lỗi và cảnh báo mới (SC-009);
  - **cặp file nâng cấp:** giống từng byte;
  - **driver:** gộp yêu cầu (gồm vét cạn), tách khi 02/03 (hội tụ ≤ ⌈log₂ n⌉ lượt), mã hóa khung, CRC (`01 03 00 00 00 0A` → `C5 CD`), exception, bộ test chuẩn cho driver chạy với `modbus-tcp`, `modbus-rtu`, `simulation` (SC-020);
  - **ghi Tag:** máy trạng thái đủ mọi kết quả và lý do, giới hạn tần suất, mã yêu cầu (kể cả qua khởi động lại), phục hồi `interrupted`;
  - **kho Tag giữ qua mất điện:** bản ghi cắt dở, phần đầu hỏng, cả hai file hỏng, đổi project.
- Không còn `E_TRANSFORM_UNSUPPORTED` cho transform `valueTable`.

## 2. Runtime x64 với giả lập Modbus

```powershell
node tools/modbus-sim/sim.mjs --tcp 1502 --control 1503 --map tools/modbus-sim/maps/modbus-demo.json --log build/sim-requests.jsonl   # (task tạo)
./deployment/toolchain/run-x64.ps1 -HttpsPort 8443 -Project projects/modbus-demo   # tham số -Project (task tạo)
curl.exe -s http://localhost:8080/api/v1/system/info
```

**Mong đợi:**

- `system/info`: `runtimeVersion` `0.5.0`, `protocolVersion` `1.2.0`, `schemaVersions` `["0.1","0.2"]`, `device.viewerAccess` `private`.
- Trang xem `http://localhost:8080` hiện giá trị từ giả lập (truy cập từ 127.0.0.1, mạng riêng).
- `GET /api/v1/drivers/diagnostics` (qua `tools/measure/device-api.mjs` của 005, đăng nhập viewer): kênh `connected`; chu kỳ thực của nhóm thường khoảng 1.000 ms.
- `build/sim-requests.jsonl`: các Tag liền nhau được gộp, mỗi yêu cầu ≤ 125 thanh ghi (US1-6).

## 3. Tích hợp x64 (`tools/driver-it.ps1`, task tạo)

Mạng Docker riêng: runtime x64 (image toolchain, build `-DMAT_TEST_HOOKS=ON`), giả lập Node (`node:24-slim`), client Node.

| Kịch bản | Lệnh | Mong đợi | Spec |
|---|---|---|---|
| Đọc đủ kiểu | `-Scenario read` | BOOL coil, bit trong thanh ghi, INT16…FLOAT64, STRING, 4 thứ tự byte: 100 % giá trị khớp giả lập | US1-9, US1-10, SC-001 (phần x64) |
| Gộp | `-Scenario merge` | nhật ký giả lập: số yêu cầu bằng số khối tính trước; không Tag nào bị tách | US1-6 |
| Tách 02 | `-Scenario split` | một địa chỉ không có ở giữa khối: chỉ Tag đó BAD `EXCEPTION_02`, Tag khác GOOD từ lượt sau | US1-8 |
| Mất kết nối | `-Scenario unplug -Rounds 20` | ngắt mạng của giả lập (10 lần) và dừng giả lập (10 lần): Tag BAD ≤ 2 chu kỳ; có lại: GOOD ≤ 12 s, không khởi động lại runtime | US1-7, SC-005 (phần x64) |
| Tiêm lỗi | `-Scenario faults` | hết thời gian chờ, exception 01–0B, sai mã giao dịch, sai unit, sai độ dài, rác, trả lời chậm: số đếm ở chẩn đoán khớp số đã tiêm trong ≤ 5 s | US5, SC-016 |
| Tải chuẩn | `-Scenario load` | 500 Tag nhóm 1 s, giả lập đổi mọi giá trị mỗi giây, 10 client: 0 mất sequence; chu kỳ thực 1 s ± 10 % | US1-5, SC-003 (phần x64) |
| Tag tính toán | `-Scenario calc` | 200 Tag tính toán, 100 Tag nội bộ: 100 % lần đổi đầu vào, Tag tính toán nằm trong cùng delta | US4-4, SC-004 (phần x64) |
| Ghi | `-Scenario write` | mỗi kết quả và mỗi lý do của FR-037, FR-038 đúng 100 %; nhật ký giả lập: 0 lệnh bị gửi hai lần; viewer, chưa đăng nhập, qua HTTP, qua live: 0 lệnh tới giả lập; audit đủ trường | US2, SC-006, SC-007 |
| Hai người ghi | `-Scenario write-race` | hai client ghi cùng Tag: chạy theo thứ tự nhận; giả lập giữ giá trị sau; hai bản ghi audit | US2-8 |
| Giết giữa lúc ghi | `-Scenario write-kill -Rounds 20` | `kill -9` ngẫu nhiên giữa lúc ghi: 0 lệnh tới giả lập mà không có bản ghi `started`; mọi lệnh dở có `interrupted` | SC-006 |
| Nạp xuống khi đang ghi | `-Scenario write-deploy` | lệnh đã gửi chạy tới cùng; lệnh chưa gửi `FAILED`; lệnh mới `REJECTED`; mọi kết quả có audit | US2-12, FR-042 |
| Tag giữ qua mất điện | `-Scenario retain -Rounds 20` | ghi 42, chờ hơn một cửa sổ, `kill -9`: sau khởi động lại là 42 (20/20); 0 lần bản lưu hỏng | US4-9, SC-010 (phần x64) |
| Lọc nguồn | `-Scenario source` | mạng Docker 203.0.113.0/24: trang, `system/info`, `projects/active`, live không phiên → 403; live có phiên → chạy; `viewerAccess: any` → xem được, `system/info.warnings` có `VIEWER_PUBLIC`; từ mạng 172.x: như cũ | SC-022 |
| Fuzz 1 giờ | `tools/fuzz-modbus.ps1 -Seconds 3600` (task tạo) | build ASan + UBSan; không dừng, không treo, không giá trị sai vào Tag | SC-020 |

## 4. armhf trên qemu

`./tools/ci-local.ps1`, hai bước:

- **`armhf tests (qemu)`** (mới): build armhf các test của `core/expression`, `core/tag-engine` (scaling, kho Tag giữ qua mất điện), `drivers/modbus` (mã hóa, đổi giá trị, transport giả, pty RTU), rồi chạy chúng dưới `qemu-arm` trong container (binfmt của Docker Desktop, như bước `execv` của 005);
- **`armhf smoke`** mở rộng `smoke-armhf.sh`: runtime armhf nạp bản `projects/modbus-demo` chỉ có Tag mô phỏng, nội bộ, tính toán (image không có Node để chạy giả lập Modbus); tính đúng Tag tính toán; ghi một Tag nội bộ giữ qua mất điện, chạy lại và đọc lại đúng giá trị.

**Mong đợi:** cả hai OK. Bước này bắt lỗi chỉ có ở bản 32 bit (như lỗi SQLite của 003): đóng gói byte, `time_t`, căn lề trong file lưu, số nguyên 64 bit.

## 5. Studio với runtime x64 và giả lập

```powershell
npm run studio:dev
```

| # | Làm | Mong đợi | Spec |
|---|---|---|---|
| 1 | Mở `projects/tank-demo` (0.1) | Hộp thoại Nâng cấp / Mở chỉ đọc / Hủy, liệt kê thay đổi và nơi sao lưu | US1-1, FR-003 |
| 2 | Nâng cấp, Ctrl+S | Có `.mat-backup/0.1.0-…/`; project hợp lệ; Tag mock thành Tag mô phỏng `legacy` | US1-2, FR-004 |
| 3 | Thêm kênh Modbus TCP tới `localhost:1502`, Online (engineer), Thử kết nối có đọc HR100, 2 thanh ghi | Kết nối được, thời gian trả lời; giá trị hex; INT32, UINT32, FLOAT32 ở 4 thứ tự | US1-3, US1-4, SC-014 |
| 4 | Thử kết nối với giả lập đặt `refuse`, `timeout`, exception 02, cổng sai | Đúng mã, đúng lý do, mỗi lần ≤ chờ + 2 s; kênh đang chạy không mất lượt nào | SC-014 |
| 5 | Bảng Tag: thêm hàng loạt 50 FLOAT32 `TT_01`, HR100; Ctrl+Z | `TT_01`…`TT_50` ở HR100…HR198; một lần Ctrl+Z bỏ cả 50 | US1-11 |
| 6 | Dán 50 dòng từ Excel, 2 ô kiểu sai | 50 dòng thêm; 2 ô viền đỏ kèm lý do; có trong tab Thông tin | US1-12 |
| 7 | Nạp xuống, mở Bảng theo dõi "Vận hành" | Giá trị sống và quality khớp giả lập; trang xem trên Chrome chạy bằng dữ liệu PLC | US1 |
| 8 | Đăng nhập operator, ghi `TANK01.SP` = 75 | `ACCEPTED` rồi `CONFIRMED` ≤ 2 s; giả lập có 75; audit đủ trường | US2-1 |
| 9 | Đăng nhập viewer | Lệnh Ghi khóa kèm lý do | US2-2 |
| 10 | Ghi 95 vào Tag giới hạn 0–90; gõ "12,5" | Ô bị đánh dấu, không cho ghi; báo dùng dấu chấm | US2-4, Edge case |
| 11 | Tắt mạng máy dev ngay sau khi xác nhận ghi, bật lại | Studio hỏi kết quả theo mã, không gửi lại | US2-10 |
| 12 | Tag tính toán: gõ "tank01.le", gõ biểu thức sai, tạo vòng A ↔ B | Gợi ý `TANK01.LEVEL` ≤ 200 ms; lỗi gạch đúng chỗ ≤ 500 ms; vòng báo kèm đường vòng | US4-1…3, SC-015 |
| 13 | Bảng giá trị `TrangThaiBom`, ô thử; hai khoảng chồng nhau | Ô thử hiện chữ, màu; ô chồng có lỗi | US4-7, US4-8 |
| 14 | Đổi tên `TANK02.LEVEL` | Liệt kê 3 chỗ; xác nhận thì đổi hết; một Ctrl+Z trả lại tên cũ | US4-12 |
| 15 | Chẩn đoán driver; giả lập tiêm 10 lần hết thời gian chờ | Số đếm +10 trong ≤ 5 s; có phần tăng từ lúc mở trang; nhấp đúp Tag xấu → Bảng Tag | US5 |
| 16 | Offline, bật Mô phỏng; theo dõi mạng (Resource Monitor) | Dấu "MÔ PHỎNG"; giá trị khớp vector; 0 gói tin gửi đi; ghi tay áp ngay, không audit | US6, SC-017 |
| 17 | Đang Online, bật Mô phỏng | Studio hỏi rồi chuyển Offline trước | US6-5 |
| 18 | Project 0.2, BL335 runtime 0.4 (container 0.4) | Dòng Tương thích runtime khóa nạp, nói cần cập nhật runtime | FR-008 |
| 19 | Nạp xuống bản đổi kiểu một Tag giữ qua mất điện | Xem trước liệt kê Tag sẽ về giá trị đầu | US4-10 |
| 20 | Một kỹ sư chưa dùng editor mới: thêm kênh, Thử kết nối, 20 Tag, nạp xuống, xem, ghi setpoint | ≤ 10 phút, không tài liệu (không có người thì ghi "tự đo") | SC-019 |

## 6. Lưới và bộ gõ trên Windows (cần người gõ)

- **SC-012** (e2e đo trên Chrome headless, kiểm lại tay trên WebView2): Bảng Tag 2.000 dòng mở ≤ 1 s; di chuyển và cuộn ≤ 50 ms mỗi bước; gõ ≤ 100 ms mỗi phím; lỗi hiện ≤ 1 s; dán 2.000 × 10 ≤ 5 s; xuất rồi nhập lại CSV cho So sánh "giống".
- **SC-013:** Windows 11, Telex có sẵn (TSF) và Unikey (Telex). Ở Bảng Tag, Bảng giá trị, Bảng theo dõi, ô biểu thức: 20/20 lần chọn ô rồi gõ thẳng "Mức nước bồn 1" ra đúng chuỗi, không cần F2. Thêm: Esc giữa lúc ghép (hủy, giữ nội dung cũ); Enter giữa lúc ghép (thuộc về bộ gõ); gõ ở ô danh sách chọn.
- **SC-018:** axe-core 0 lỗi critical/serious ở theme sáng và tối; bảng đối chiếu quy tắc studio-ux §5; mọi lệnh mới dùng được chỉ bằng bàn phím.

## 7. Bàn thử với thiết bị thật

| Việc | Cần | Spec |
|---|---|---|
| ≥ 1 PLC Modbus TCP: mọi kiểu dùng được khớp 100 % với phần mềm lập trình PLC; ghi mỗi kiểu RW `CONFIRMED` | PLC của người dùng; máy dev trong cùng LAN với PLC, hoặc BL335 | SC-001 |
| ≥ 1 thiết bị RS485 qua BL335: đọc khớp màn hình thiết bị; ghi một tham số `CONFIRMED`; 30 phút ≥ 99 % lượt thành công | thiết bị, dây, **người ở cạnh BL335**; xong §8 | SC-002, US3-7 |

## 8. BL335: lệnh chỉ đọc cho người dùng tự chạy (D7)

SSH tới BL335 bị chặn trong phiên làm plan. Người dùng chạy bằng `root` (BL335 không có `sudo`) và gửi lại toàn bộ kết quả. Các lệnh 1–9 không mở cổng serial nào, không đổi gì. Lệnh 10 mở cổng trong chốc lát (bước mở có thể đổi mức DTR/RTS): chỉ chạy với cổng chưa nối thiết bị đang hoạt động.

```sh
# 1. Kernel, dòng lệnh khởi động (console nằm ở đâu)
uname -a; cat /proc/cmdline

# 2. Nút thiết bị: nhóm, quyền, major/minor; tên nhóm của major (cho DeviceAllow)
ls -l /dev/ttyAS* /dev/ttyS* /dev/ttyUSB* /dev/ttyACM* 2>/dev/null
ls -l /dev/serial/by-id/ /dev/serial/by-path/ 2>/dev/null
grep -E 'tty' /proc/devices

# 3. Driver, loại phần cứng của từng cổng
for t in /sys/class/tty/ttyAS* /sys/class/tty/ttyS* /sys/class/tty/ttyUSB* /sys/class/tty/ttyACM*; do
  [ -e "$t/device" ] || continue
  echo "$(basename "$t") driver=$(basename "$(readlink -f "$t/device/driver")") type=$(cat "$t/type" 2>/dev/null) port=$(cat "$t/port" 2>/dev/null) irq=$(cat "$t/irq" 2>/dev/null) dev=$(readlink -f "$t/device")"
done
for t in /sys/class/tty/ttyUSB* /sys/class/tty/ttyACM*; do
  [ -e "$t/device" ] || continue
  p=$(readlink -f "$t/device"); while [ "$p" != / ] && [ ! -f "$p/idVendor" ]; do p=$(dirname "$p"); done
  [ -f "$p/idVendor" ] && echo "$(basename "$t") $(cat "$p/idVendor"):$(cat "$p/idProduct") $(cat "$p/manufacturer" 2>/dev/null) $(cat "$p/product" 2>/dev/null)"
done
lsusb 2>/dev/null

# 4. Console và getty
cat /proc/consoles; cat /sys/class/tty/console/active
systemctl list-units --all --no-pager 'serial-getty@*' 'getty@*'
ls -l /etc/systemd/system/getty.target.wants/

# 5. Chương trình nào đang giữ cổng (modem 4G, atscada…)
fuser -v /dev/ttyAS* /dev/ttyUSB* /dev/ttyACM* 2>&1
for p in /proc/[0-9]*; do for f in "$p"/fd/*; do l=$(readlink "$f" 2>/dev/null)
  case "$l" in /dev/ttyAS*|/dev/ttyUSB*|/dev/ttyACM*|/dev/ttyS*) echo "$(basename "$p") $(cat "$p/comm") $l";; esac
done; done 2>/dev/null
ls -l /run/lock/ /var/lock/ 2>/dev/null
systemctl list-units --no-pager | grep -iE 'modem|ppp|atscada|piano|qmi|mbim'

# 6. Log kernel của UART, RS485
dmesg | grep -iE 'uart|ttyAS|serial|rs485|485' | head -100

# 7. Device tree của UART (thuộc tính rs485, rts-gpios…)
for n in $(find /proc/device-tree -maxdepth 3 -type d -name 'uart@*' 2>/dev/null); do
  echo "== $n status=$(tr -d '\0' < "$n/status" 2>/dev/null)"; ls "$n"
done
for a in /proc/device-tree/aliases/serial*; do echo "$(basename "$a") -> $(tr -d '\0' < "$a")"; done 2>/dev/null

# 8. cgroup, systemd (điều kiện của DevicePolicy/DeviceAllow)
cat /proc/cgroups; stat -fc %T /sys/fs/cgroup/; systemctl --version | head -1
systemctl show mat-runtime -p PrivateDevices -p DevicePolicy -p DeviceAllow 2>/dev/null

# 9. Nhóm, tài khoản dịch vụ; mốc ghi eMMC (chạy hai lần cách nhau 1 giờ)
getent group dialout; id matscada 2>/dev/null
cat /sys/block/mmcblk0/stat; date -u

# 10. (MỞ CỔNG TRONG CHỐC LÁT; bỏ qua cổng đang nối thiết bị) cờ RS485 hiện tại của ttyAS1–5
python3 - <<'EOF'
import fcntl, os, struct, glob, errno
for p in sorted(glob.glob('/dev/ttyAS*')):
    if p == '/dev/ttyAS0':
        continue                      # console: không mở
    try:
        fd = os.open(p, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    except OSError as e:
        print(p, 'open:', e); continue
    try:
        buf = bytearray(32)
        fcntl.ioctl(fd, 0x542E, buf)  # TIOCGRS485
        flags, before, after = struct.unpack_from('III', buf)
        print(p, 'flags=0x%x enabled=%s rts_on_send=%s delay=%d/%d' % (flags, bool(flags & 1), bool(flags & 2), before, after))
    except OSError as e:
        print(p, 'TIOCGRS485:', errno.errorcode.get(e.errno, e.errno))
    finally:
        os.close(fd)
EOF
```

**Kết quả dùng để:**

- chốt danh sách cổng cho phép mặc định (`serialPorts`);
- chọn unit chính hoặc drop-in dự phòng ([contracts/device-config.md](contracts/device-config.md) §3);
- biết có cần luật udev không;
- biết cổng nào nối đầu RS485 (kết hợp sơ đồ của BLIIoT), và kernel có chế độ RS485 không;
- xác nhận `ttyUSB0`–`3` là modem;
- có mốc ghi eMMC khi chưa có runtime 0.5.

Ghi kết quả vào `docs/reports/device-profile.md` (mục serial) và `docs/reports/006-acceptance.md`.

## 9. BL335 ⚠️🔌 (cần người dùng cho phép rõ; ghi `docs/reports/device-changes.md`)

| # | Việc | Ghi chú | Spec |
|---|---|---|---|
| 1 | Kiểm chỉ đọc (§8) | trước mọi thay đổi | D7 |
| 2 | `deploy.sh` gói runtime 0.5.0 | unit mới (hoặc drop-in); in lời nhắc `viewerAccess`; không đụng `atscada-*`, `piano-edtech-*` | FR-057 |
| 3 | Project 0.1 đang chạy vẫn chạy như 0.4 | kiểm tự động Sprint 1 và 003 | SC-009, SC-021 |
| 4 | Rảnh 10 phút (0.4.0 rồi 0.5.0); tải chuẩn 30 phút: 500 Tag Modbus TCP từ giả lập trên máy Windows trong LAN, 10 client | `tools/measure/sample.sh` qua `ssh … sh -s` | SC-003 |
| 5 | Thêm 200 Tag tính toán, 100 Tag nội bộ | | SC-004 |
| 6 | Rút cáp PLC (hoặc ngắt mạng máy giả lập) 10 lần, tắt 10 lần | BAD ≤ 2 chu kỳ; GOOD ≤ 12 s | SC-005 |
| 7 | Ghi liên tục ở mức trần 1 giờ, đếm `/sys/block/mmcblk0/stat` | quy ra ngày; chốt `tagWriteGlobalPerMin` theo công thức research R15 | SC-011 |
| 8 | Ghi đầu-cuối với PLC thật | ≥ 95 % `CONFIRMED` ≤ 2 s | SC-001, SC-007 |
| 9 | RTU với thiết bị RS485 thật 30 phút | **cần người ở cạnh thiết bị** | SC-002 |
| 10 | ≥ 3 lần cắt điện thật ngay sau khi ghi Tag giữ qua mất điện | **cần người ở cạnh thiết bị** | SC-010 |
| 11 | Từ địa chỉ công cộng (4G điện thoại) mở `http://<IP công cộng>:9080` | 403 kèm hướng dẫn VPN; Studio Online qua port-forward HTTPS vẫn xem được | SC-022, FR-055a |
| 12 | Báo cáo driver `docs/reports/006-driver-modbus.md` | model, firmware đã thử; license; mức đọc/ghi; phần cứng; RAM/CPU trên BL335; giả lập trong CI | FR-060 |

Không làm trên BL335 khi chưa được cho phép. Kết quả ghi `docs/reports/006-acceptance.md`.
