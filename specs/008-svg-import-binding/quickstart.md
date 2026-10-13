# Quickstart: kiểm chứng 008 Nhập SVG, gắn Tag, animation và sự kiện

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · Định dạng và giá trị mong đợi: [contracts/](contracts/)

Các kịch bản đi từ máy dev tới BL335. Script ghi "(task tạo)" chưa có, sẽ được thêm khi làm tasks. Mục nào chưa làm được thì ghi "chưa đo" trong báo cáo nghiệm thu `docs/reports/008-acceptance.md`.

## 0. Chuẩn bị (máy dev Windows)

- Docker Desktop đang chạy (image toolchain `mat-armhf`); `npm install` ở gốc repo; Node ≥ 22; Chrome ≥ 120 (puppeteer-core dùng Chrome cài sẵn).
- **Inkscape CLI** (cho 4 fixture thật): `inkscape --version` in phiên bản; không có thì task T008 dừng và báo.
- Rust 1.99 MSVC; `$env:CARGO_TARGET_DIR = 'C:\build\mat-studio'` (ổ D: còn ít chỗ). Build C++ ở `C:\build\mat-x64-<tên>`.
- Dữ liệu mẫu (task tạo):
  - `tests/fixtures/svg-import/`: 10 fixture, `malicious/` (≥ 24 ca), `reimport/` (≥ 6 cặp), `limits.mjs` (sinh ca giới hạn khi chạy, không commit), `manifest.json`, `README.md` (nguồn gốc, giấy phép, **giới hạn mô phỏng**);
  - `projects/svg-demo/` (0.4.0): 2 màn hình (Bồn nước, Tổng quan) + popup, đồ họa nhập từ fixture, ký hiệu bơm/van/bồn/motor/ống, ≥ 30 binding đủ 13 loại động hóa, 5 sự kiện; sinh bằng `tools/svg-demo/generate.mjs` (không viết tay);
  - `projects/tank-demo` (0.1.0), `modbus-demo` (0.2.0), `dashboard-demo` (0.3.0) giữ nguyên để thử nâng cấp và tương thích.
- Tài khoản thử sinh ngẫu nhiên mỗi lần chạy (`--user-add --password-stdin`), không ghi vào repo.

## 1. Test tự động

```powershell
./deployment/toolchain/test-x64.ps1                 # GoogleTest: luật 0.4, vector chung hai bản
npm test -w @mat/svg-renderer                       # allowlist, giá trị, mount, inspect
npm test -w @mat/svg-import                         # prescan, css, normalize, optimize, uid, match, import (10 fixture, độc hại, giới hạn)
npm test -w @mat/binding-engine                     # chuyển đổi, hợp biến đổi, hoạt ảnh
npm test -w @mat/ui-components                      # svgActionController, bindSvgEvents
npm test -w @mat/symbols                            # ký hiệu, manifest, điểm gắn
npm test -w @mat/project-schema                     # rules-04, vector v04, migrate03to04, cặp migration
npm test -w @mat/studio                             # model/svg-*, animation-catalog, svg-suggest, import-flow, reimport-flow
npm run e2e -w @mat/studio                          # Chrome headless, lớp Tauri giả, axe-core
npm run e2e -w @mat/runtime-web                     # trang runtime: hoạt ảnh, sự kiện, khóa
cd apps/studio/src-tauri; cargo test --lib          # có test svg_open
./tools/ci-local.ps1                                # toàn bộ, gồm armhf smoke và bước svg-inspect --import
```

**Mong đợi:** mọi test xanh; có các bộ mới (FR-059):

- **vector chung** ≥ 100 ca `v04-*`, hai validator cho cùng kết luận 100 % (SC-012); vector 0.1, 0.2, 0.3 giữ kết luận;
- **importer:** 10 fixture nhập được; ≥ 24 ca độc hại đúng `expect.json`; ≥ 12 ca giới hạn đúng biên (SC-010); ≥ 6 cặp nhập lại: 0 gán sai tự động (SC-009);
- **thuần TS:** hợp biến đổi (SC-014), `svgActionController` đủ ca khóa (SC-013), `portSnap`, Gợi ý;
- **không hồi quy:** toàn bộ test 004–007; `svg-load` 19 file Sprint 0.

## 2. Nhập SVG bằng dòng lệnh

```powershell
npm run svg:inspect -- --import tests/fixtures/svg-import --report-dir out/import-reports --out out/imported
npm run svg:inspect -- --import tests/fixtures/svg/factory-isometric-stress.svg --optimize --report-dir out/import-reports
node tools/svg-import/malicious-harness.mjs tests/fixtures/svg-import/malicious     # cần Chrome
node tools/svg-import/compare-images.mjs --manifest tests/fixtures/svg-import/manifest.json --out docs/reports/008-fixtures.json
```

**Mong đợi:**

- 10/10 fixture nhập được; báo cáo `.json` và `.md` mỗi file; mã loại khớp `manifest.json` (SC-001);
- file stress: không `--optimize` thì từ chối `E_IMPORT_LIMIT` (27.029 > 20.000) và gợi ý; có `--optimize` thì ≤ 20.000 phần tử, ảnh khác ≤ 1 % (SC-002);
- harness độc hại: 0 ca có `window.__pwned`, 0 yêu cầu mạng ngoài; ≥ 1 ca bản gốc kích hoạt canary (SC-003);
- `compare-images`: mỗi fixture ≤ 0,5 % điểm ảnh khác so với bản gốc (trừ vùng đã khai); 4 fixture Inkscape ≤ 3 % giữa PNG của Inkscape và ảnh Chrome của bản đã nhập.

## 3. Runtime x64 và trang trên Chrome

```powershell
node tools/modbus-sim/sim.mjs --tcp 1502 --control 1503 --map tools/modbus-sim/maps/modbus-demo.json
./deployment/toolchain/run-x64.ps1 -HttpsPort 8443 -Project projects/svg-demo
docker exec mat-runtime-x64 /opt/mat-runtime/bin/mat-runtime --user-add vanhanh1 --role operator --password-stdin   # nhập mật khẩu 15+ ký tự
curl.exe -s http://localhost:8080/api/v1/system/info
```

**Mong đợi:**

- `system/info`: `runtimeVersion` `0.7.0`, `schemaVersions` `["0.1","0.2","0.3","0.4"]`.
- `https://localhost:8443/` (chứng chỉ thử, chọn Tiếp tục hoặc dùng CA thử như quickstart 007 §5): màn hình Bồn nước có đồ họa nhập và ký hiệu; mức nước đổi theo Tag; cánh bơm quay; ống có dòng chảy; đèn đổi màu; chữ hiện giá trị.
- Chưa đăng nhập: phần tử "bơm" nhấp được mờ nhẹ, tooltip "Đăng nhập để điều khiển"; Tab vào được; Enter hiện lý do ở vùng trạng thái.
- Đăng nhập operator: nhấp "Khởi động" → hộp xác nhận → `CONFIRMED`; audit (xem trong Studio, mục Audit của 005) có `channel` `web`, `context.widget` = `el_…`.
- Mở project 0.1, 0.2, 0.3 (`tank-demo`, `modbus-demo`, `dashboard-demo`): chạy y như runtime 0.6 (SC-011).
- Sửa tay `projects/svg-demo/graphics/…svg` trong thư mục dữ liệu của runtime, thêm `<script>`: trang không chạy mã (US1-12).

## 4. Tích hợp x64 (`tools/web-it.ps1 -Scenario svg`, task tạo)

Mạng Docker: runtime x64, giả lập Modbus, Chrome headless, client Node tấn công. Kết quả `docs/reports/008-<kịch bản>-x64.json`.

| Kịch bản | Lệnh | Mong đợi | Spec |
|---|---|---|---|
| Hiển thị và hoạt ảnh | `-Scenario svg` | mọi đích của `svg-demo` đổi đúng theo Tag mô phỏng tất định; DOM và kiểu giống Studio xem trước | SC-006 |
| Sự kiện | `-Scenario svg-events` | nhấp phần tử → xác nhận → ghi → `CONFIRMED`; chuyển màn hình; popup; khóa đúng 100 % ca của 007; 30 ca tấn công với nguồn phần tử SVG: 0 lệnh tới giả lập, audit đủ | SC-013 |
| Tương thích | `-Scenario compat` | 0.1–0.3: cùng phần tử đích, cùng giá trị binding, ảnh chụp ≤ 0,5 %; quay trên phần tử có `transform` gốc giữ `transform` | SC-011 |
| Mở màn hình | `-Scenario open-svg` | màn hình chuẩn 3b ≤ 2 s; 40 item `svg` ≤ 2 s | SC-005 (x64) |
| F5 đồng loạt | `-Scenario f5x10-svg` | 10 phiên cùng F5 ≤ 5 s | SC-005 (x64) |
| Tải | `-Scenario load-svg -Seconds 1800` | 10 client xem màn hình chuẩn 3b + 500 Tag mô phỏng: CPU, RSS, mất sequence | SC-007 (x64) |
| Hoạt ảnh | `node tools/measure/anim-bench.mjs --animations 100 --minutes 30` | p95 khung ≤ 8 ms; bộ nhớ +≤ 50 MB; tab ẩn: 0 callback | SC-008 |
| Gói trang | `-Scenario bundle` | khởi động ≤ 250 KB gzip; không `eval`/`innerHTML`; `@mat/svg-import` không có trong gói | SC-022, SC-021 |

## 5. Studio: nhập, gắn Tag, sự kiện, nhập lại, ký hiệu (với runtime x64)

```powershell
npm run studio:dev
```

| # | Làm | Mong đợi | Spec |
|---|---|---|---|
| 1 | Mở `projects/dashboard-demo` (0.3) | Hộp thoại nâng cấp 0.4.0; nơi sao lưu | FR-005 |
| 2 | Nâng cấp, lưu | `.mat-backup/…`; `schemaVersion` 0.4.0, `minRuntimeVersion` 0.7.0; nội dung không đổi | FR-006 |
| 3 | Màn hình mới "Bồn nước"; Ctrl+Shift+I, chọn `inkscape-01-tank-process.svg` | Hộp thoại Nhập SVG: trước/sau, báo cáo, phần mềm "Inkscape 1.4.4" | US1-1 |
| 4 | Xem báo cáo, bấm Lưu báo cáo | `.json` và `.md`; mỗi mục loại có lý do | US1-7 |
| 5 | Nhập; Ctrl+Z | Item `svg` xuất hiện rồi biến mất trong một bước | US1-10 |
| 6 | Nhập lại, thử file `factory-isometric-stress.svg` | `E_IMPORT_LIMIT`, gợi ý Tối ưu; bật Tối ưu thì nhập được | US1-6 |
| 7 | Nhấp đúp item để vào; nhấp hình "Nước"; Alt+nhấp | Chọn phần tử, khung bám phần tử ở mọi zoom; Alt chọn cha | US2-1 |
| 8 | Kéo `TANK01.LEVEL` vào dòng Mức chất lỏng; kéo thanh Thử giá trị | Mức đổi ≤ 100 ms; hình cong cắt đúng | US2-5, US2-13 |
| 9 | Chọn chữ "72.5" → Chữ hiển thị giá trị (1 số lẻ, đơn vị Tag) | Chữ theo giá trị | US2-3 |
| 10 | Chọn đèn → Màu nền → Bảng giá trị; thử Khoảng (`<20` đỏ, `20–80` xanh, `≥80` đỏ), thử Khoảng chồng | Màu đổi; khoảng chồng báo lỗi tại ô | US2-4 |
| 11 | Chọn cánh quạt → Quay liên tục (BOOL); chọn kim → Quay (tâm quay ở gốc kim); chọn nút trượt → Di chuyển X và Co giãn | Chuyển động đúng tâm; phần tử có `transform` gốc không mất | US2-6, US2-7, US2-11 |
| 12 | Chọn đèn cảnh báo → Nhấp nháy (400 ms), thử 300 ms | 400 ms chạy; 300 ms bị từ chối | US2-8 |
| 13 | Chọn ống → Dòng chảy (BOOL; tốc độ theo Tag); đổi chiều | Dòng chạy, đổi tốc độ không giật | US2-9 |
| 14 | Chọn nhóm → Ẩn/hiện, Độ mờ | Đúng | US2-10 |
| 15 | Kéo Tag chuỗi vào Quay; Tag RO vào Xung | Từ chối kèm lý do | US2-12 |
| 16 | Nhấp Gợi ý với chữ và Tag số | Đề nghị đúng bảng gợi ý; chấp nhận | US2-14 |
| 17 | Chọn bơm → Sự kiện: Mở popup "Bơm 1"; chọn nút "Khởi động" → Xung `PUMP01.RUN_CMD` 500 ms | Lưu được; lỗi `E_EVENT_*` nếu sai | US3-8 |
| 18 | Xem trước Mô phỏng: nhấp bơm, nhấp "Khởi động" | Popup; hộp xác nhận như Chrome; ghi vào mô phỏng | US3-10 |
| 19 | Đổi tên Tag `TANK01.LEVEL`; Ctrl+Z | Binding và sự kiện cập nhật rồi trả lại trong một bước; "Dùng ở đâu" có phần tử SVG | US2-18 |
| 20 | Toolbox → Ký hiệu SVG: kéo bồn đứng, bơm ly tâm, van cổng, motor AC, hai ống ngang | Item mới; ống dính điểm gắn (chấm xanh); Alt tắt dính | US4-2, US4-3 |
| 21 | Chọn motor → Gắn nhanh "Cánh motor: quay liên tục" | Mở đúng dòng, chọn phần tử rotor | US4-4 |
| 22 | **Dựng lại màn hình bồn nước + motor** theo [kịch bản e2e](contracts/studio-svg-editor.md) §14 | `validate` không lỗi; Nạp xuống; Chrome đúng; ghi số thao tác | US4-5, US4-6, SC-004 |
| 23 | Chọn item đồ họa → Nhập lại SVG, file `reimport/p1/v2.svg` | Hộp thoại Đối chiếu lại: giữ/mới/cần chọn/mồ côi đúng đáp án | US5 |
| 24 | Để mồ côi có binding rồi Kiểm tra | `E_REF_UID`; Nạp xuống khóa; nhấp đúp lỗi mở hộp thoại | US5-6 |
| 25 | Online, Nạp xuống, mở Chrome; Đọc lên, So sánh | Giống xem trước; UID giữ nguyên; "giống" | US1-11, FR-029 |
| 26 | Chỉ bàn phím: Ctrl+Shift+I, Tab, Enter; vào item, chọn, gắn, Sự kiện | Làm được mọi việc | SC-015 |
| 27 | Một kỹ sư chưa dùng tính năng: nhập SVG, gắn mức nước, màu đèn, quay motor, thêm sự kiện, xem trước, nạp xuống | ≤ 20 phút không cần tài liệu (không có người thì ghi "tự đo") | SC-020 |

## 6. Mockup

Mở `docs/architecture/mockups/studio-svg.html` bằng Chrome: cảnh 1 (hộp thoại Nhập SVG với báo cáo), cảnh 2 (vào đồ họa, chọn phần tử, cây phần tử, inspector Gắn Tag 13 dòng, Thử giá trị, Sự kiện), cảnh 3 (Đối chiếu lại), cảnh 4 (Toolbox Ký hiệu SVG, điểm gắn, Gắn nhanh), cảnh 5 (trang Chrome: phần tử nhấp được, khóa, hộp xác nhận). Studio làm theo bố cục này (SC-019); khác biệt phải ghi trong báo cáo.

## 7. Thử tay (cần người)

- Bộ gõ khi đặt tên phần tử (F2) và nhãn sự kiện (Windows 11, Telex có sẵn, Unikey): 20/20 lần đúng "Bơm nước số 1".
- Trình đọc màn hình (NVDA) trên trang vận hành: phần tử nhấp được đọc là nút có nhãn; khóa và kết quả được thông báo.
- Chrome ≥ 120 thật và WebView2 thật: hộp thoại Nhập SVG và canvas; hoạt ảnh mượt; `svg_open`.
- **File SVG thật từ Illustrator và CorelDRAW** (nếu người dùng cung cấp): đặt vào `tests/fixtures/svg-import/real/`, chạy lệnh §2 và so ảnh; thay mục mô phỏng trong `manifest.json`; ghi kết quả vào báo cáo.

## 8. Lệnh chỉ đọc trên BL335 (người dùng chạy, hoặc phiên làm việc khi có quyền SSH)

Không đổi gì trên thiết bị. Kết quả ghi vào `docs/reports/device-profile.md` (mục "Phục vụ file SVG").

```sh
cat /sys/class/net/eth1/speed 2>/dev/null; ip -br link                      # tốc độ cổng (so với 100 Mbps giả định)
free -m; uptime                                                             # nền trước khi đo
df -h /var/lib/mat-runtime                                                  # chỗ cho project có SVG lớn
ls -l /var/lib/mat-runtime/projects 2>/dev/null | head                      # các phiên bản project đang giữ
systemctl show mat-runtime -p ActiveState -p MemoryCurrent -p MemoryMax     # RSS nền
```

**Dùng để quyết định:** tốc độ mạng thật của BL335 (ước tính 65 Mbps ở R20); chỗ chứa project; RSS nền để so với SC-007.

## 9. Bàn thử với thiết bị thật ⚠️🔌

Cần người dùng cho phép SSH, hoặc tự chạy các lệnh dưới đây. Ghi mọi thay đổi vào `docs/reports/device-changes.md` kèm cách hoàn tác; không đụng `atscada-*`, `piano-edtech-*`; không ghi mật khẩu vào repo; không khởi động lại thiết bị.

1. **Cài runtime 0.7.0** bằng `deploy.sh` (gói `package-runtime.ps1`, có `schemas/0.3/`); đọc lời nhắc; tài khoản operator có sẵn từ 007 hoặc `mat-runtime --user-add vanhanh1 --role operator`.
2. **Nạp xuống** `svg-demo` và `dashboard-demo` từ Studio; mở trên Chrome từ ≥ 2 máy; kiểm project 0.4 bị runtime 0.6 (nếu còn trên máy khác) từ chối đúng cách.
3. **Đo SC-005:** mở màn hình chuẩn 3b (bộ nhớ đệm trống, từ ≥ 2 máy); 10 client F5 cùng lúc (`tools/load-tester` và Chrome thật); màn hình 40 item `svg`; SVG ≥ 1 MiB (đo riêng, ghi giới hạn nếu không đạt).
4. **Đo SC-007:** 30 phút, 10 client, 500 Tag mô phỏng: CPU, RSS (`systemctl show`), mất sequence; eMMC ghi do audit.
5. **Điều khiển thật:** operator nhấp phần tử SVG (xung bit lệnh, đảo công tắc) có xác nhận và audit; viewer bị khóa; rút cáp PLC (nếu có bàn thử): phần tử liên quan khóa.
6. **Quay lại:** `rollback.sh`; project 0.4 bị runtime cũ từ chối đúng cách; khôi phục project cũ bằng Studio.
7. Viết `docs/reports/008-acceptance.md` (số đo, danh sách phiên bản Chrome đã thử, kết quả từng SC, mục chưa đo, ghi rõ fixture mô phỏng).
