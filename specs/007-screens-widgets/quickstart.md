# Quickstart: kiểm chứng 007 Màn hình v1, widget và điều khiển từ Chrome

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · Định dạng và giá trị mong đợi: [contracts/](contracts/)

Các kịch bản đi từ máy dev tới BL335. Script ghi "(task tạo)" chưa có, sẽ được thêm khi làm tasks. Mục nào chưa làm được thì ghi "chưa đo" trong báo cáo nghiệm thu `docs/reports/007-acceptance.md`.

## 0. Chuẩn bị (máy dev Windows)

- Docker Desktop đang chạy (image toolchain `mat-armhf`); `npm install` ở gốc repo; Node ≥ 22; Chrome ≥ 120 (puppeteer-core dùng Chrome cài sẵn).
- Rust 1.99 MSVC; `$env:CARGO_TARGET_DIR = 'C:\build\mat-studio'` (ổ D: còn ít chỗ). Build C++ ở `C:\build\mat-x64-<tên>`.
- Project mẫu (task tạo):
  - `projects/dashboard-demo/` (0.3.0): 4 màn hình (Tổng quan, Bồn nước, Giám sát, popup Bơm 1), 1 item SVG, 15 loại widget, ≥ 24 widget, dùng Tag của `modbus-demo` cộng Tag mô phỏng; sinh bằng `tools/dashboard-demo/generate.mjs` (không viết tay).
  - `projects/modbus-demo/` và `projects/tank-demo/` giữ 0.2.0 và 0.1.0 để thử nâng cấp và tương thích.
- Tài khoản thử sinh ngẫu nhiên mỗi lần chạy (`--user-add --password-stdin`), không ghi vào repo.

## 1. Test tự động

```powershell
./deployment/toolchain/test-x64.ps1                 # GoogleTest: phiên web, CSRF/Origin, phạm vi cookie, expect/pulse, SAN, CSR, nhập chứng chỉ, validator 0.3
npm test -w @mat/ui-components                      # ControlController, ChartWindow, fit, formatValue, widget (jsdom)
npm test -w @mat/project-schema                     # validator 0.1/0.2/0.3 (vector chung), migrate02to03, toScreenModel
npm test -w @mat/runtime-web                        # route, LiveTagSource, WebActionHost, đăng nhập
npm test -w @mat/studio                             # hình học screen-edit, screen-doc, gesture, inspector, navigation-doc
npm run e2e -w @mat/studio                          # Chrome headless, lớp Tauri giả, axe-core, đo SC-013
npm run e2e -w @mat/runtime-web                     # trang runtime với runtime giả (task tạo)
cd apps/studio/src-tauri; cargo test --lib          # không đổi, phải xanh
./tools/ci-local.ps1                                # toàn bộ, gồm armhf smoke
```

**Mong đợi:** mọi test xanh; có các bộ mới (FR-073, FR-074):

- **vector chung:** ≥ 120 ca `v03-*` và `widget-catalog-vectors`, hai validator cho cùng kết luận 100 % (SC-012); 82 ca 0.1 và ca 0.2 giữ kết luận;
- **cặp file nâng cấp** 0.2 → 0.3: giống từng byte (`tank-demo` qua 0.1, `modbus-demo`);
- **thuần TS:** `ControlController` đủ ca khóa (SC-009), `ChartWindow` (vòng, đứt đoạn), hình học (SC-014);
- **C++:** 30 ca tấn công của [contracts/web-session.md](contracts/web-session.md) §5 ở mức đơn vị; `pulseMs` đúng nhịp; SAN và CSR.

## 2. Runtime x64 và trang trên Chrome

```powershell
node tools/modbus-sim/sim.mjs --tcp 1502 --control 1503 --map tools/modbus-sim/maps/modbus-demo.json
./deployment/toolchain/run-x64.ps1 -HttpsPort 8443 -Project projects/dashboard-demo
docker exec mat-runtime-x64 /opt/mat-runtime/bin/mat-runtime --user-add vanhanh1 --role operator --password-stdin   # nhập mật khẩu 15+ ký tự
curl.exe -s http://localhost:8080/api/v1/system/info
```

**Mong đợi:**

- `system/info`: `runtimeVersion` `0.6.0`, `schemaVersions` `["0.1","0.2","0.3"]`, `web` `{ https: true, httpsPort: 8443, login: true, viewerLogin: "off" }`.
- `http://localhost:8080/` (xem từ mạng riêng): menu 3 mục, màn hình Tổng quan có đồ họa SVG và widget; dải "Chế độ chỉ xem. Mở bằng HTTPS để điều khiển" kèm liên kết; điều khiển khóa.
- `https://localhost:8443/` (Chrome báo chứng chỉ chưa tin cậy: chọn Tiếp tục cho thử nghiệm; hoặc dùng CA thử ở §5): bấm Đăng nhập, nhập tài khoản, điều khiển mở khóa.
- `#/bon-nuoc` và F5; nút "Chi tiết bơm 1" mở popup; Esc đóng; `?kiosk=1` ẩn thanh trên và menu.
- Với `projects/modbus-demo` (0.2) và `projects/tank-demo` (0.1): trang chạy y như runtime 0.5 (SC-011).

## 3. Tích hợp x64 (`tools/web-it.ps1`, task tạo)

Mạng Docker: runtime x64 (`-DMAT_TEST_HOOKS=ON`), giả lập Modbus, Chrome headless (puppeteer), client Node tấn công, CA thử. Kết quả: `docs/reports/007-<kịch bản>-x64.json`.

| Kịch bản | Lệnh | Mong đợi | Spec |
|---|---|---|---|
| Màn hình và điều hướng | `-Scenario screens` | 3 màn hình, popup, URL, F5, Back/Forward, id lạ, kiosk, màn hình lỗi riêng lẻ | US1 |
| Tương thích | `-Scenario compat` | `tank-demo`, `modbus-demo`: DOM và giá trị binding như 0.5; nâng cấp 0.3 giống ảnh chụp ≤ 1 % điểm ảnh | SC-011 |
| Widget và quality | `-Scenario widgets` | mỗi loại hiện đúng giá trị; BAD, STALE, UNCERTAIN, Tag lạ; bảng giá trị; XSS qua `props` | US1-8…10, SC-020 |
| Điều khiển | `-Scenario control` | đăng nhập, ghi từng loại widget; hộp xác nhận; mọi kết quả (ACCEPTED, CONFIRMED, REJECTED, TIMEOUT, FAILED); giả lập: 0 lệnh gửi hai lần; audit `channel: web` có `screen`, `widget` | US3, SC-006 |
| Khóa | `-Scenario locks` | viewer, chưa đăng nhập, HTTP, mất live, BAD, STALE, Tag R, đang gửi: khóa và lý do đúng 100 % | SC-009 |
| Tấn công | `-Scenario attack` | 30 ca của web-session §5: 100 % bị từ chối, 0 lệnh tới giả lập, audit đúng | SC-007 |
| Phiên | `-Scenario session` | hết hạn rảnh (đặt `webSessionIdleMin` nhỏ trong chế độ thử), hết hạn tối đa, đổi IP, đăng xuất, đổi role hoặc mật khẩu bằng CLI, đầy phiên | SC-008 |
| Xung | `-Scenario pulse -Rounds 20` | ghi bật, chờ `pulseMs`, ghi tắt; đóng trình duyệt ngay sau khi xác nhận; `kill -9` runtime giữa lúc chờ: 0 lệnh không có audit; lệnh dở có `interrupted` | SC-010 |
| So sánh giá trị | `-Scenario expect` | hai client cùng đảo `false → true`: một `CONFIRMED`, một `REJECTED` `STALE_EXPECTATION` | US3-17 |
| Đổi project | `-Scenario deploy-live` | nạp xuống khi 10 trang đang xem và 1 lệnh đang gửi: trang tự tải lại giữ màn hình, phiên còn; lệnh theo FR-042 của 006 | US6-2, US6-3 |
| Biểu đồ | `-Scenario charts` | Tag mô phỏng tất định: điểm khớp 100 %; đứt ở BAD; 30 phút không rò bộ nhớ (SC-017, phiên rút gọn trong CI) | US4, SC-017, SC-018 |
| F5 đồng loạt | `-Scenario f5x10` | 10 phiên cùng F5: tất cả có giá trị sống ≤ 5 s; 0 lỗi 4429 do dựng phiên chậm | SC-003 (x64) |
| Mở màn hình | `-Scenario open` | màn hình chuẩn (20 widget, 100 Tag) ≤ 2 s; chuyển màn hình đã mở ≤ 500 ms | SC-002 (x64) |
| Tải | `-Scenario load -Seconds 1800` | 10 client xem dashboard + 500 Tag mô phỏng: CPU, RSS, mất sequence | SC-004 (x64) |
| Chứng chỉ | `-Scenario cert` | chứng chỉ mới có SAN IP; `device.crt` chỉ chứa chứng chỉ; CA thử ký CSR → nhập → Chrome (kho tin cậy thử) không lỗi; nhập sai bị từ chối | US5, SC-019 (x64) |
| Gói trang | `-Scenario bundle` | JS+CSS khởi động ≤ 250 KB gzip; biểu đồ đường ≤ 100 KB; không `eval` trong bản build | SC-024, SC-020 |

## 4. Studio dựng dashboard (với runtime x64)

```powershell
npm run studio:dev
```

| # | Làm | Mong đợi | Spec |
|---|---|---|---|
| 1 | Mở `projects/modbus-demo` (0.2) | Hộp thoại Nâng cấp 0.3.0; nơi sao lưu | FR-007 |
| 2 | Nâng cấp, lưu | `.mat-backup/…`; màn hình thành 1 item `svg`; menu theo số màn hình | US1-2, FR-008 |
| 3 | Thêm màn hình "Tổng quan" (1920 × 1080), mở bằng đúp trên cây | Canvas có thước, lưới, zoom; Toolbox 15 widget | US2-1 |
| 4 | Kéo "Card giá trị" vào canvas; kéo `TANK01.LEVEL` từ Details lên nó | Widget dính lưới, được chọn, gắn Tag; đơn vị lấy từ Tag | US2-3, US2-7 |
| 5 | Kéo tay nắm; mũi tên; Shift+mũi tên; Alt khi kéo | Đổi cỡ, dịch 1, 10; tắt bắt dính | US2-4, US2-2 |
| 6 | Chọn 3 card, Căn trên, Phân bố đều ngang; Ctrl+Z | Đúng hình học; một Ctrl+Z trả lại | US2-5, US2-14 |
| 7 | Thêm đồng hồ kim, thanh mức, biểu đồ đường 3 Tag, nút, ô setpoint, công tắc, thanh trượt, danh sách chọn, bảng Tag, đèn báo, nhãn, khung | ≥ 20 widget, đủ 15 loại; lỗi hiện ở Thông tin | SC-001 |
| 8 | Gắn nút "Bật bơm" cho `PUMP01.STATE` (chỉ đọc) | Lỗi ở item; Nạp xuống khóa; sửa sang `PUMP01.RUN_CMD` thì hết | US2-8 |
| 9 | Thả Tag chuỗi lên đồng hồ kim | Từ chối kèm lý do | US2-9 |
| 10 | Xem trước Mô phỏng; bấm nút, ô setpoint | Số chạy; hộp xác nhận như Chrome; ghi vào mô phỏng | US2-12, FR-067 |
| 11 | Editor Điều hướng: kéo sắp xếp, tạo nhóm | `navigation` đổi; xem trước theo | US2-11 |
| 12 | Xóa màn hình đang được nút trỏ tới | Liệt kê chỗ dùng; hỏi trước; chỗ trỏ thành lỗi | US2-10 |
| 13 | Đổi tên Tag `TANK01.SP` | Mọi khe cập nhật; một Ctrl+Z | US2-17 |
| 14 | Online, Nạp xuống, mở Chrome | Giống xem trước; Đọc lên, So sánh "giống" | US2-13, SC-001 |
| 15 | Xem trước Thiết bị, bấm nút ghi | Qua API Studio, audit `channel: studio` | US6-6 |
| 16 | Nhập tên, nhãn bằng Telex và Unikey (người gõ) | 20/20 lần đúng "Bơm nước số 1" | US2-18 |
| 17 | Chỉ bàn phím: Tab, mũi tên, Enter, Delete | Làm được mọi việc trên | US2-16, SC-015 |
| 18 | Một kỹ sư chưa dùng editor: thêm màn hình, card, nút, biểu đồ, gắn Tag, xem trước, nạp xuống | ≤ 15 phút (không có người thì ghi "tự đo") | SC-023 |

## 5. Chứng chỉ và Chrome (CA thử)

```powershell
docker exec mat-runtime-x64 /opt/mat-runtime/bin/mat-runtime --make-csr --san 127.0.0.1,mat.test --out /tmp/mat.csr
# ký bằng CA thử (tools/web-it, container openssl) rồi:
docker exec mat-runtime-x64 /opt/mat-runtime/bin/mat-runtime --import-cert /tmp/chain.pem
docker restart mat-runtime-x64
```

**Mong đợi:** `--cert-info` hiện người ký là CA thử và SAN đúng; Chrome (kho tin cậy có CA thử) mở `https://127.0.0.1:8443` không cảnh báo; nhập chứng chỉ không khớp khóa, có khóa riêng, hỏng: bị từ chối, chứng chỉ cũ còn nguyên (US5-5…8).

## 6. Mockup

Mở `docs/architecture/mockups/studio-screens.html` bằng Chrome: cảnh 1 (trình bố trí), cảnh 2 (trang vận hành: khách, đăng nhập, operator, mất kết nối, popup, HTTP chỉ xem, chứng chỉ chưa tin cậy), cảnh 3 (chú giải). Studio và trang runtime làm theo bố cục này (SC-016); khác biệt phải ghi trong báo cáo.

## 7. Lệnh chỉ đọc trên BL335 (người dùng chạy, hoặc phiên làm việc khi có quyền SSH)

Không đổi gì trên thiết bị. Kết quả ghi vào `docs/reports/device-profile.md` (mục mới "Chứng chỉ và mạng").

```sh
ip -4 -o addr show                                   # IP các card: so với SAN
runuser -u matscada -- /opt/mat-runtime/bin/mat-runtime --cert-fingerprint
openssl x509 -in /var/lib/mat-runtime/tls/server.pem -noout -text | sed -n '/Subject Alternative Name/,+1p;/Extended Key Usage/,+1p;/Basic Constraints/,+1p'
ls -l /var/lib/mat-runtime/tls/
cat /opt/mat-runtime/config/runtime.json
systemctl show mat-runtime -p ActiveState -p MemoryCurrent -p MemoryMax
ss -tlnp | grep -E ':(8080|8443)'
```

**Dùng để quyết định:** chứng chỉ hiện có có SAN IP không (cần `--regen-cert` hay không); có EKU `serverAuth` không; BL335 dùng IP tĩnh hay DHCP.

## 8. Thử tay (cần người)

- Bộ gõ ở inspector và hộp đăng nhập (Windows 11, Telex có sẵn, Unikey): [mục 4 bước 16](#4-studio-dựng-dashboard-với-runtime-x64).
- Trợ năng bằng trình đọc màn hình (NVDA) trên trang vận hành: widget điều khiển được đọc đúng, kết quả ghi được thông báo; ghi nhận trong báo cáo.
- Chrome ≥ 120 thật trên Windows 11: cài chứng chỉ vào Trusted Root (US5-5), xem cảnh báo trước và sau.

## 9. Bàn thử với thiết bị thật ⚠️🔌

Cần người dùng cho phép SSH, hoặc tự chạy các lệnh dưới đây. Ghi mọi thay đổi vào `docs/reports/device-changes.md` kèm cách hoàn tác; không đụng `atscada-*`, `piano-edtech-*`; không ghi mật khẩu vào repo; không khởi động lại thiết bị.

1. **Cài runtime 0.6.0** bằng `deploy.sh` (gói `package-runtime.ps1`); đọc lời nhắc; tạo tài khoản operator: `mat-runtime --user-add vanhanh1 --role operator`.
2. **Chứng chỉ:** theo kết quả mục 7: `--regen-cert` nếu thiếu SAN IP; tải `/device.crt` từ máy Windows, so fingerprint, cài vào Trusted Root; Chrome mở `https://192.168.1.110:8443` không cảnh báo (SC-019). Với CA thử: `--make-csr`, ký, `--import-cert`.
3. **Nạp xuống** `dashboard-demo` từ Studio; mở trên Chrome từ ≥ 2 máy.
4. **Đo:** SC-002 (mở màn hình chuẩn), SC-003 (10 client F5; dùng `tools/load-tester` và Chrome thật từ ≥ 2 máy), SC-004 (30 phút, 10 client, 500 Tag mô phỏng: CPU, RSS), eMMC ghi do audit.
5. **Điều khiển thật:** operator ghi setpoint, bật tắt công tắc; `viewer` bị khóa; rút cáp PLC (nếu có bàn thử): nút liên quan khóa.
6. **Xung:** `pulseMs` 500 ms trên Tag nội bộ hoặc PLC bàn thử; đóng trình duyệt ngay sau khi xác nhận (20 lần): bit trả về (SC-010); `kill -9 mat-runtime` giữa lúc chờ (cần người ở cạnh).
7. **Quay lại:** `rollback.sh`; kiểm project 0.3 bị runtime 0.5 từ chối đúng cách, khôi phục project 0.2 bằng Studio.
8. Viết `docs/reports/007-acceptance.md` (số đo, danh sách phiên bản Chrome đã thử, kết quả từng SC, mục chưa đo).
