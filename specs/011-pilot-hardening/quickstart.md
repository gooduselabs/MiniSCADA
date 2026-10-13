# Quickstart: kiểm chứng 011 Hoàn thiện và pilot, trình vẽ SVG, logic v2

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · Định dạng và giá trị mong đợi: [contracts/](contracts/)

Các kịch bản đi từ máy dev tới BL335. Script ghi "(task tạo)" chưa có, sẽ được thêm khi làm tasks. Mục nào chưa làm được thì ghi "chưa đo" trong báo cáo nghiệm thu. Mật khẩu thử sinh ngẫu nhiên mỗi lần chạy, không ghi vào repo.

## 0. Chuẩn bị (máy dev Windows)

- Docker Desktop đang chạy (image toolchain `mat-armhf`, thêm `cppcheck`, `clang-tidy`); `npm install` ở gốc repo; Node ≥ 22; Chrome ≥ 120 (puppeteer-core); Go (cho `tools/load-tester`).
- Rust 1.99 MSVC; `$env:CARGO_TARGET_DIR = 'C:\build\mat-studio'`; build C++ ở `C:\build\mat-x64-<tên>` (ổ D: còn ít chỗ).
- `signtool.exe` (Windows SDK 26100; thường ở `C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\`).
- Project mẫu (task tạo): `projects/logic-demo/`, `logic-load/`, `bench-1000/`, `soak-standard/`, `training-demo/`; `dashboard-demo/` thêm template và faceplate; `tank-demo` (0.1), `modbus-demo` (0.2) giữ nguyên để thử nâng cấp.

## 1. Test tự động

```powershell
./deployment/toolchain/test-x64.ps1                  # GoogleTest: HostPolicy, LoginGuard, pulse journal, đa unit, persist, conn limit, check-data, update, logic, validator 1.0.0
npm test -w @mat/project-schema                      # validator 0.1/0.2/0.3/1.0.0 (vector chung), migrate, params
npm test -w @mat/logic-engine                        # vector logic ≥ 200 ca, độ chính xác
npm test -w @mat/svg-edit                             # hình học ≥ 150 ca, lệnh, hoàn tác, round-trip, fuzz
npm test -w @mat/ui-components; npm test -w @mat/runtime-web; npm test -w @mat/studio
npm run e2e -w @mat/studio; npm run e2e -w @mat/runtime-web   # editor SVG, logic, OTA, faceplate, axe-core
node --test tools/release tools/soak tools/powercut tools/pilot tools/docs-check.test.mjs tools/gen-error-codes.test.mjs
cd apps/studio/src-tauri; cargo test --lib           # lệnh OTA, logic, signature
./tools/ci-local.ps1                                 # toàn bộ, gồm ASan ctest, audit, sast, docs-check, update-it, logic-it
```

**Mong đợi:** mọi test xanh; vector chung ≥ 60 ca `v10-*`, ≥ 200 ca logic, ≥ 10 ca file thừa, 30 gói xấu: TS và C++ cùng kết luận 100 %; vector cũ (0.1, 0.2, 0.3, 82 ca của Sprint 1) giữ kết luận.

## 2. US1: bảo mật (x64)

```powershell
./tools/web-it.ps1 -Scenario host-rebind             # 421 cho tên lạ, 200 cho IP và allowedHosts (011-host-x64.json)
./tools/web-it.ps1 -Scenario lockout-dos             # IP A bị chặn ≤ 20 lần; người dùng IP B vào ≤ 2 s (011-lockout-x64.json)
./tools/web-it.ps1 -Scenario attack                  # 30 ca của 007 vẫn 100 %
./tools/driver-it.ps1 -Scenario gateway-multiunit    # 1.000 chu kỳ, unit 2 câm (011-gateway-x64.json)
./tools/driver-it.ps1 -Scenario pulse-recovery       # 20 vòng kill -9 giữa xung + 20 vòng nhật ký không ghi được
./tools/device-it.ps1 -Scenario persist-slow         # fsync 500 ms: projects/active p99 ≤ 50 ms
./tools/device-it.ps1 -Scenario deploy-extra-file    # 30 lần nạp xuống không HEALTH_TIMEOUT
./tools/sast/run.ps1                                 # cppcheck + clang-tidy (011-sast.md)
./tools/fuzz/run.ps1 -Seconds 3600                   # 7 mục tiêu, ASan + UBSan
```

Kiểm tay nhanh với runtime x64 đang chạy: `curl.exe -k -H "Host: evil.test" https://127.0.0.1:8443/api/v1/system/info` ⇒ 421; cùng lệnh với `Host: 127.0.0.1:8443` ⇒ 200.

## 3. US2: đo (x64 trước)

```powershell
./tools/load-tester/... --tags 500 --clients 10 --extra 1     # L1, L3 (task chỉnh cờ)
node tests/web-it/f5-storm.mjs --pages 10 --rounds 50          # L4
./tools/powercut/x64-kill.ps1 -Rounds 100                      # tiền kiểm mất điện (011-powercut-x64.json)
node tools/soak/analyze.mjs docs/reports/011-soak-x64.json    # độ dốc RSS, ghi đĩa/ngày, FD
```

Soak gia tốc 24 giờ chạy nền (`run_in_background`); kết quả ghi `docs/reports/011-soak-x64.json`.

## 4. US3: ký bộ cài bằng chứng chỉ thử

```powershell
./tools/release/make-test-cert.ps1                              # tạo chứng chỉ thử (CN=mAT SCADA TEST - NOT FOR RELEASE)
$env:MAT_SIGN_MODE = 'test'; npm run studio:build              # Tauri gọi sign.ps1 cho exe, setup, uninstall
./tools/release/verify-release.ps1 -Dir release/1.0.0-rc.1     # 12 ca hỏng phải bị từ chối
./tools/release/release.ps1 -Release                           # PHẢI thất bại: chứng chỉ thử (cổng -Release)
./tools/release/make-test-cert.ps1 -Remove                     # gỡ chứng chỉ thử
```

**Mong đợi:** ba tệp có chữ ký SHA-256, `Get-AuthenticodeSignature` báo `NotTrusted` (đúng: chữ ký toán học đúng, gốc chưa tin), sửa 1 byte ⇒ `HashMismatch`. Không đụng kho tin cậy của Windows. Chứng chỉ thật, cài trên Windows sạch, SmartScreen: §8.

## 5. US4: OTA (x64, lab)

```powershell
node tools/release/make-update.mjs --out tests/update-vectors/out            # gói hợp lệ + 30 ca xấu (khóa thử)
./tools/update-it.ps1 -Scenario ok -Rounds 20                                # 20 cập nhật hợp lệ (≤ 30 s ngừng, ≤ 120 s)
./tools/update-it.ps1 -Scenario bad                                          # 30 gói xấu: đúng mã, bản chạy không đổi
./tools/update-it.ps1 -Scenario kill -Rounds 5                               # kill ở S1–S8 (40 lần)
./tools/update-it.ps1 -Scenario health                                       # sức khỏe giả lỗi: quay về ≤ 90 s
./tools/update-it.ps1 -Scenario auth                                         # ma trận quyền, OTA tắt ⇒ 404
```

`mat-updater` chạy trên cây giả (`MAT_OPT_ROOT`) với giả `systemctl`; không đụng hệ thống thật.

## 6. US5: logic (x64)

```powershell
node tools/dashboard-demo/... ; ./tools/logic-it.ps1 -Scenario rules          # luật bơm tự bật qua giả lập Modbus (lệnh ghi + audit)
./tools/logic-it.ps1 -Scenario writes-off                                     # logic.writes=off: 0 lệnh tới giả lập, audit suppressed
./tools/logic-it.ps1 -Scenario throttle; ./tools/logic-it.ps1 -Scenario stop  # giới hạn tần suất, dừng khẩn cấp
./tools/logic-it.ps1 -Scenario retain-kill -Rounds 100                        # counter/totalizer/giờ chạy không giảm, mất ≤ flushS
./tools/logic-it.ps1 -Scenario load                                           # 200 luật…: thêm CPU, RSS, vòng quét
```

Trong Studio: mở `projects/logic-demo`, nút Logic, bảng Thử logic (tua ×10), Nạp xuống (hộp liệt kê ghi tự động).

## 7. BL335: kiểm chỉ đọc (người dùng chạy, hoặc phiên làm việc khi được phép SSH)

BL335 không có `sudo`: lệnh root chạy trực tiếp; lệnh chỉ đọc chạy bằng `runuser -u matscada --`. **Không** ghi gì, **không** khởi động lại.

```sh
hostname; uname -m; getconf LONG_BIT
mount | grep -E "mmcblk|tmpfs"; df -h /var/lib/mat-runtime /run
cat /sys/block/mmcblk*/stat                         # sector đã ghi (trường 7)
mmc extcsd read /dev/mmcblk0 2>&1 | grep -E "LIFE_TIME|PRE_EOL"   # nếu có mmc-utils
ls /sys/class/mmc_host/mmc*/mmc*:*/ 2>/dev/null     # life_time, pre_eol_info
timedatectl show -p NTPSynchronized 2>/dev/null; chronyc tracking 2>/dev/null | head -3
sshd -T 2>/dev/null | grep -iE "permitrootlogin|passwordauthentication"; ls /etc/ssh/sshd_config.d 2>/dev/null
systemctl show mat-runtime -p NRestarts,ActiveState,MemoryCurrent
systemd --version | head -1; tar --version | head -1; sha256sum --version | head -1; openssl version 2>/dev/null
ls -l /etc/mat-runtime /opt/mat-runtime | head -20
```

Kết quả ghi `docs/reports/device-profile.md` (mục "011") và quyết định: cách đọc tuổi thọ eMMC, cách phát hiện đồng bộ giờ, `mmc-utils` có hay không.

**Việc cần cài, đo và thử trên thiết bị (⚠️🔌, theo thứ tự; mọi thay đổi ghi `device-changes.md`):**

1. Cài runtime `1.0.0-rc` và `mat-sample` bằng `deploy.sh` theo `docs/deployment/mat-runtime.md` (T079); kiểm `Host`, giới hạn kết nối, cảnh báo SSH (T063).
2. Tải L1, L2, L3, L4, L5, L8 (T079, T080).
3. Soak 7 ngày (T081), eMMC (T082).
4. Lắp bộ điều khiển nguồn (T083); mất điện 100 vòng và 5 điểm (T084, T085, T123, T149).
5. OTA thật: cài `mat-updater`, bật `update.enabled`, 10 cập nhật, 5 lần cắt điện giữa bước (T122, T123).
6. Gia cố SSH (T064): **chỉ khi người dùng đồng ý**, giữ một phiên SSH mở và thử khóa công khai trước khi tắt mật khẩu.

## 8. Kiểm tay (cần người)

- **Windows sạch (T105):** cài bộ cài ký bằng chứng chỉ thật trên Windows 10 và 11 sạch, offline; ghi UAC, nhà phát hành, SmartScreen nguyên văn, dấu vân tay, gỡ cài đặt.
- **Bộ gõ (T144, T167):** nhập tên khối logic và văn bản trong editor SVG bằng Telex có sẵn của Windows và Unikey ("Bơm nước số 1", "Đường ống chính"); không mất ký tự khi chuyển focus.
- **Trình đọc màn hình (T167):** NVDA: duyệt editor SVG và editor Logic bằng bàn phím; lỗi, kết quả lệnh được đọc.
- **Người chưa biết hệ thống (T150, T167, T186):** logic trong ≤ 25 phút, ký hiệu bơm trong ≤ 20 phút, bảng tác vụ của ba hướng dẫn ≥ 90 % không hỏi.
- **Huấn luyện (T186, T197):** ≥ 2 người vận hành, ≥ 1 kỹ sư đạt bài kiểm thực hành.

## 9. Pilot

```powershell
./tools/pilot/bench-setup.ps1 -Device <địa chỉ> -User <viewer>      # bàn thử nội bộ + collect.ps1
./tools/pilot/collect.ps1 -Site <tên> -Device <địa chỉ> -User <viewer>   # mỗi 15 phút (nền)
node tools/pilot/kpi.mjs --site <tên> --from 2026-11-01 --to 2026-12-01  # uptime, restarts, ghi đĩa, trễ, eMMC, sự cố
```

Tiêu chí vào/ra: [contracts/test-protocols.md](contracts/test-protocols.md) §5; hồ sơ: `docs/pilot/`. Go/No-Go: `docs/reports/011-go-no-go.md`.

## 10. Báo cáo nghiệm thu

Điền `docs/reports/011-acceptance.md` theo bảng SC; mục chưa chạy ghi "chưa đo" kèm lý do (SSH, người, thời gian, mạng). Không gắn `1.0.0` khi thiếu bằng chứng của tiêu chí bắt buộc.
