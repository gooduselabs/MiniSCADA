# Quickstart: kiểm chứng 009 Alarm theo ISA-18.2

**Feature**: [spec.md](spec.md) · Hợp đồng: [contracts/](contracts/) ([live-protocol-1.3.md](contracts/live-protocol-1.3.md), [device-api-1.3.md](contracts/device-api-1.3.md), [ui-alarm.md](contracts/ui-alarm.md), [studio-alarm-editor.md](contracts/studio-alarm-editor.md)) · Động cơ, lưu trữ, định dạng: `contracts/alarm-engine.md`, `contracts/alarm-store.md`, `contracts/project-format-0.5.md`

Các kịch bản đi từ máy dev tới BL335. Script hoặc dữ liệu ghi "(task tạo)" chưa có, sẽ được thêm khi làm tasks. Mục nào chưa làm được thì ghi "chưa đo" trong báo cáo nghiệm thu `docs/reports/009-acceptance.md`. Không ghi mật khẩu hay địa chỉ IP riêng vào tài liệu hay báo cáo: dùng `<IP BL335>` và tài khoản thử sinh ngẫu nhiên.

## 0. Chuẩn bị (máy dev Windows)

- Docker Desktop đang chạy (image toolchain `mat-armhf`); `npm install` ở gốc repo; Node ≥ 22; Chrome ≥ 120 (puppeteer-core dùng Chrome cài sẵn).
- Rust 1.99 MSVC; `$env:CARGO_TARGET_DIR = 'C:\build\mat-studio'` (ổ D: còn ít chỗ). Build C++ ở `C:\build\mat-x64-<tên>` (tham số `-BuildDir`).
- Project mẫu (task tạo):
  - `projects/alarm-demo/` (0.5.0): 12 alarm (số, ngưỡng HH/H/L/LL, quality `tag` và `device`), 4 lớp mặc định, 3 khu vực, trên Tag mô phỏng tất định của 006; một màn hình có hai widget `alarm-list` và `alarm-count`. Sinh bằng `tools/alarm-demo/generate.mjs` (không viết tay); tùy chọn `--count 200` sinh bản 200 alarm cho kịch bản tải và Studio (§3, §4).
  - `projects/dashboard-demo/` (0.3.0, hoặc 0.4.0 nếu 3b đã nâng mẫu; chạy cả hai), `projects/modbus-demo/` (0.2.0), `projects/tank-demo/` (0.1.0) giữ nguyên để thử nâng cấp và tương thích.
  - `tools/alarm-history-seed/` nạp 100.000 lần xảy ra vào `alarm.db` thử (cho §3 `history`).
- Tài khoản thử sinh ngẫu nhiên mỗi lần chạy (`--user-add --password-stdin`), không ghi vào repo. Cần ít nhất ba tài khoản: một `viewer`, một `operator`, một `engineer` (cho `disable`/`enable`, phiên Bearer).
- Hằng số phiên bản (D28, D29): đã giải: 0.5.0 vì 3b (specs/008) dùng 0.4.0; T002 đối chiếu `specs/008`, `specs/010` và giữ công cụ đổi số làm dự phòng; các lệnh dưới dùng giá trị hiện hành (runtime 0.8.0, Studio 0.7.0, API 1.3.0, live 1.3.0, định dạng 0.5.0, `@mat/ui-components` 0.3.0).

## 1. Test tự động

```powershell
./deployment/toolchain/test-x64.ps1 -BuildDir C:\build\mat-x64-009 -Target "<các target của core/alarm, server>" -Filter "Alarm|LiveHub|CivetTransport|Roles|Audit"
./deployment/toolchain/test-x64.ps1 -BuildDir C:\build\mat-x64-009                    # toàn bộ GoogleTest (không -Target)
./deployment/toolchain/test-x64.ps1 -BuildDir C:\build\mat-x64-asan -Sanitize -Filter "Alarm"   # ASan + UBSan cho core/alarm
npm test -w @mat/alarm-engine                       # động cơ TS, bộ vector chung, định dạng nội dung, bảng ISA
npm test -w @mat/project-schema                     # validator 0.1 đến 0.5 (vector v05-*), migrate 0.4 → 0.5, luật widget
npm test -w @mat/live-client                        # subscribeAlarms, ghép mảnh, sequence, tương thích
npm test -w @mat/ui-components                      # alarm-format, alarm-table, mat-alarm-list, mat-alarm-count
npm test -w @mat/runtime-web                        # banner, badge, csv, sound, alarm-client, menu
npm test -w @mat/studio                             # alarm-doc, alarm-sim, tree, shortcuts, migrate
node --test tests/alarm-vectors                     # (task tạo) lược đồ của bộ vector chung: ≥ 60 ca đều đọc được và đủ nhóm
node --test tools/lint-rules.test.mjs               # lint: không innerHTML, không chuỗi cứng, glob thư mục mới
npm run e2e -w @mat/runtime-web                     # Chrome headless, axe-core: banner, trang Alarm, lịch sử, CSV, widget
npm run e2e -w @mat/studio                          # lớp Tauri giả: dựng 200 alarm, Thử alarm, nâng cấp, So sánh
cd apps/studio/src-tauri; cargo test --lib          # không đổi (và test chuyển tiếp bản tin alarm nếu có)
./tools/ci-local.ps1                                # toàn bộ, gồm armhf smoke
```

(`-Filter` là GoogleTest tên `Suite.Test` theo regex ctest; sai regex chạy 0 test và thoát 0: kiểm số test chạy ở cuối đầu ra. `-Target` dùng khi cây mã còn đang đổi ở mô-đun khác.)

**Mong đợi:** mọi test xanh; có các bộ mới (FR-094, SC-022):

- **vector chung C++ ↔ TS:** `tests/alarm-vectors/` ≥ 60 ca (chuỗi điều kiện theo thời gian → chuỗi chuyển trạng thái, nhóm `text-*` cho nội dung): hai bản động cơ cho cùng kết quả 100 % (SC-004); `tests/project-vectors/` ca `v05-*` ≥ 60, hai validator đồng ý 100 %; `tests/widget-catalog-vectors/` thêm hai widget;
- **cặp file nâng cấp** 0.4 → 0.5 (`tests/migration-vectors/`): chỉ đổi `schemaVersion` (SC-015);
- **bảng ISA:** mọi cặp (trạng thái × sự kiện) có test (SC-005); trạng thái ngoài bảng không thể tới;
- **lưu trữ:** WAL, dựng lại sau khởi động, thời hạn, trần, file hỏng, đĩa đầy, bộ đệm 5.000 (`core/alarm/tests/`);
- **live:** snapshot, delta, dồn theo instance, chia mảnh, `ack` bị từ chối, tương thích 1.2.0 (`server/websocket/tests/`);
- **API:** quyền từng dòng, audit trước, kết quả theo mục, idempotent (`server/http/tests/alarms_api_test.cpp`);
- **thuần TS:** `foldVi`, `topUnacked`, CSV chống công thức, chọn kiểu âm thanh, `issueCell`.

## 2. Runtime x64 và trang trên Chrome

```powershell
node tools/alarm-demo/generate.mjs --out projects/alarm-demo              # (task tạo) sinh project mẫu 12 alarm
./deployment/toolchain/run-x64.ps1 -HttpsPort 8443 -Project projects/alarm-demo
docker exec mat-runtime-x64 /opt/mat-runtime/bin/mat-runtime --user-add vanhanh1 --role operator --password-stdin    # nhập mật khẩu 15+ ký tự
docker exec mat-runtime-x64 /opt/mat-runtime/bin/mat-runtime --user-add kysu1 --role engineer --password-stdin
curl.exe -s http://localhost:8080/api/v1/system/info
curl.exe -s http://localhost:8080/api/v1/alarms
```

**Mong đợi:**

- `system/info`: `runtimeVersion` `0.8.0`, `protocolVersion` `1.3.0`, `device.apiVersion` `1.3.0`, `schemaVersions` `["0.1","0.2","0.3","0.4","0.5"]`, khối `alarms` `{ instances: 12, …, logState: "running", droppedChanges: 0 }`.
- `GET /api/v1/alarms`: `instances` có các alarm đang có (bộ sinh Tag tất định đưa vài Tag qua ngưỡng sau vài chục giây), `classes` 4 lớp, `areas` 3 khu vực, `counts` khớp.
- `http://localhost:8080/` (xem như viewer): menu có "Alarm" và "Lịch sử alarm"; banner hiện alarm chưa xác nhận cao nhất ("Khẩn cấp · … · n chưa xác nhận"); huy hiệu menu đúng số; tiêu đề tab `(n) …`; trang Alarm liệt kê, lọc theo khu vực, sắp xếp; nút Xác nhận khóa với lý do "Cần đăng nhập với role operator".
- `https://localhost:8443/` (chọn Tiếp tục với chứng chỉ thử): đăng nhập `vanhanh1`; bấm Xác nhận: hàng thôi nhấp nháy, banner cập nhật, hai cửa sổ Chrome cùng cập nhật ≤ 500 ms; "Xác nhận tất cả" có hộp xác nhận và chỉ xác nhận alarm đã hiện; Tạm ẩn với lý do và thời gian, hàng sang tab "Tạm ẩn" kèm đếm ngược.
- Bật chỉ báo "Âm thanh đang tắt, bấm để bật" rồi nghe còi, bíp, bíp đôi theo lớp (kiểm tay, §7); Tắt tiếng không xác nhận gì.
- Trang Lịch sử (`#/alarm-history`): 24 giờ gần nhất, lọc, "Tải thêm", "Xuất CSV" cho file `alarm-history-….csv`.
- Giảm chuyển động trong cài đặt hệ điều hành: nhấp nháy thành viền đậm tĩnh.
- Với `projects/dashboard-demo` (0.3 hoặc 0.4), `modbus-demo` (0.2), `tank-demo` (0.1): trang chạy y như runtime 0.6 hoặc 0.7 (không banner, không mục Alarm; SC-015).
- Hai widget `alarm-list`, `alarm-count` trên màn hình của `alarm-demo` hiện đúng và xác nhận được; viewer thấy nút khóa.

## 3. Tích hợp x64 (`tools/alarm-it.ps1`, task tạo)

Mạng Docker: runtime x64 (`-DMAT_TEST_HOOKS=ON`: có móc làm hỏng `audit.db`, đặt hạn rảnh nhỏ), giả lập Modbus, Chrome headless (puppeteer), client Node (live 1.2.0 và 1.3.0, tấn công). Mỗi kịch bản ghi `docs/reports/009-<kịch bản>-x64.json` (số đo, ngày, phiên bản, kết quả từng tiêu chí). Dùng như `tools/web-it.ps1`: `./tools/alarm-it.ps1 -Scenario state,latency` (tham số `-Rounds`, `-Seconds`, `-Count`, `-Keep`, `-NoBuild`).

| Kịch bản | Lệnh | Mong đợi | Báo cáo | Spec |
|---|---|---|---|---|
| Trạng thái | `-Scenario state -Count 200` | 200 alarm (ba loại), Tag mô phỏng tất định: 100 % chuỗi chuyển trạng thái đúng kỳ vọng của bộ vector; xác nhận, hết, `ackReturn`, hết rồi bật lại (mã lần xảy ra mới), shelve (không banner, không tính huy hiệu, hết hạn ±1 s thì `ACTIVE_UNACK` mới), disable (bền qua khởi động lại) | `009-state-x64.json` | US3, SC-002, SC-005, SC-021 |
| Độ trễ | `-Scenario latency -Rounds 100` | đổi Tag → DOM của Chrome đổi: p95 ≤ 1.000 ms và p99 ≤ 1.250 ms (đã trừ trễ cấu hình); xác nhận ở client A → client B thấy ≤ 500 ms (≥ 99 % lệnh) | `009-latency-x64.json` | SC-003, SC-006 |
| Quality | `-Scenario quality` | rút cáp PLC giả (cổng điều khiển của `modbus-sim`): alarm `quality` bật kèm `reason` `TIMEOUT` sau trễ bật; alarm `digital`, `limit` của Tag đó giữ nguyên trạng thái với `inputBad = true`; nối lại: quality hết, bộ đếm trễ bắt đầu lại; alarm quality của **thiết bị** bật khi mọi Tag không GOOD; giá trị NaN coi như BAD | `009-quality-x64.json` | US3-4, US3-5, FR-019, FR-020 |
| Bão alarm | `-Scenario storm` | (a) 200 alarm bật trong một tick, 10 client (có 2 client chậm): 0 phiên bị 4409, mọi client đủ trạng thái ≤ 1 s, hàng đợi cao nhất ≤ 50 % của 256 KB, độ trễ tick tăng ≤ 5 ms; (b) 1 alarm dao động 20 lần/phút: tự cách ly sau đúng `chatterLimit` (5) lần, `alarm.db` nhận đúng `chatterLimit` dòng mỗi chu kỳ 30 phút, dòng tổng kết có số lần đúng | `009-storm-x64.json` | SC-018, SC-019 |
| Khởi động lại | `-Scenario restart` | khởi động lại (đổi project, `kill`) ở từng trạng thái (`ACTIVE_UNACK`, `ACTIVE_ACK`, `RTN_UNACK`, shelved, disabled): lần xảy ra mở dựng lại từ `alarm.db`, **không** chạy lại trễ bật, không sinh lần xảy ra mới nếu điều kiện còn đúng; hết sau trễ tắt nếu đã sai; trang nhận 1012 rồi snapshot mới; alarm xóa bởi project mới đóng với dấu `config` | `009-restart-x64.json` | US3-8, US3-12, FR-022, FR-023 |
| `kill -9` lặp | `-Scenario killloop -Rounds 100` | 100 lần `kill -9` (đang ghi, đang xác nhận): `PRAGMA integrity_check` = `ok` mỗi lần; 0 trường hợp `ACTIVE_ACK` mà `audit.db` không có dòng `alarm.ack` tương ứng; xác nhận chưa commit quay về `ACTIVE_UNACK`; alarm còn đúng điều kiện hiện lại ≤ 5 s sau khởi động | `009-killloop-x64.json` | SC-008, US3-9 |
| Lịch sử | `-Scenario history` | nạp 100.000 lần xảy ra (`tools/alarm-history-seed`): truy vấn khoảng + khu vực + ưu tiên ≤ 1 s; phân trang `beforeId` không trùng, không sót; `q` không phân biệt dấu (`ban` khớp `bồn`); `BAD_QUERY` từng nhánh; CSV 50.000 dòng ≤ 10 s trong Chrome; dọn theo hạn: lần xảy ra đã đóng quá hạn mất ≤ 1 giờ, **không** xóa lần đang mở, file ≤ trần + 5 %, khung live không giãn quá 250 ms trong lúc dọn | `009-history-x64.json` | US4, SC-010, SC-013 |
| Quyền và audit | `-Scenario auth` | ma trận viewer/operator/engineer cho bảy endpoint (đúng bảng device-api-1.3 §1.1); `ack` ghi `alarm.ack` **trước** khi `alarmDelta` tới; móc làm hỏng audit: 503 `AUDIT_UNAVAILABLE`, trạng thái không đổi; hai phiên cùng xác nhận một lần xảy ra: một `ACKED`, một `ALREADY_ACKED`, một dòng audit; xác nhận hàng loạt: một dòng audit, `ids` ≤ 10; `STALE`, `SHELVED`, `SHELVE_RANGE` (biên), `ALARM_NOT_FOUND`; `disable` chỉ bằng Bearer | `009-auth-x64.json` | US6-2, SC-006 |
| Tấn công | `-Scenario attack` | bộ ca vào `ack`, `shelve`, `unshelve`, `disable`, `enable`: thiếu hoặc sai CSRF, `Origin` lạ, cookie trên HTTP, cookie gọi `disable`, `GET` đổi trạng thái, role thấp, phiên hết hạn: 100 % bị từ chối, 0 thay đổi trạng thái, 100 % có audit hoặc được đếm theo gộp 60 s; `{"type":"ack"}` trên live: `BAD_MESSAGE` + `LIVE_ACK_NOT_ALLOWED`; bộ XSS ≥ 20 chuỗi trong `text`: 0 thực thi (DOM chỉ có chữ); bộ CSV ≥ 30 chuỗi nguy hiểm đều bị vô hiệu; chuỗi SQL trong `q`: không đổi kết quả khác chữ tìm | `009-attack-x64.json` | US6-1, SC-007, SC-020 |
| Tương thích | `-Scenario compat` | client live 1.2.0 giả với runtime 0.8: Tag đúng, **0** bản tin alarm, 0 lỗi; trang 0.8 với máy chủ giả 1.2.0 (không `features`): "Thiết bị chưa hỗ trợ alarm (runtime < 0.8.0)"; project 0.3 và 0.4 trên runtime 0.8: cùng DOM và giá trị như runtime 0.6 và 0.7; migration 0.4 → 0.5 chỉ đổi `schemaVersion` | `009-compat-x64.json` | US6-3, SC-015 |
| Ngân sách | `-Scenario budget -Seconds 1800` | 200 alarm, 500 Tag/1 s, 10 client xem trang Alarm: CPU trung bình và RSS (tham khảo x64; mốc thật ở §8); phần alarm thêm = hiệu hai lần chạy (có và không alarm) ≤ 3 điểm % CPU và ≤ 4 MB RSS; 0 mất `sequence`; ghi của `alarm.db` đo bằng `/proc/<pid>/io` (trừ Tag và audit): ngoại suy tải chuẩn ≤ 25 MB/ngày, tải bão ≤ 0,1 GB/ngày; đánh giá một tick ≤ 2 ms với 500 instance | `009-budget-x64.json` | SC-009, SC-011, FR-021 |

Gói kịch bản rút gọn chạy trong `./tools/ci-local.ps1` (state, quality, attack, compat; killloop 20 vòng); đầy đủ chạy tay trước khi đóng feature.

## 4. Studio dựng 200 alarm và Thử alarm (với runtime x64)

```powershell
npm run studio:dev
```

| # | Làm | Mong đợi | Spec |
|---|---|---|---|
| 1 | Mở `projects/dashboard-demo` (0.3 hoặc 0.4) | Hộp thoại Nâng cấp 0.5.0; nơi sao lưu; Nâng cấp, lưu | FR-012, US2-1 |
| 2 | So sánh tệp trước và sau nâng cấp | chỉ khác `schemaVersion`; mục **Alarm** trên cây mở khóa, không còn nhãn "GĐ 4" | SC-015 |
| 3 | Mở **Alarm → Lớp alarm** | bốn lớp mặc định; thêm lớp "An toàn nước" màu tím; Nghe thử còi, bíp; bật giảm chuyển động của hệ điều hành thì xem trước nhấp nháy thành viền tĩnh | US2-2 |
| 4 | Chuột phải `TANK01.LEVEL` → "Tạo alarm cho Tag…"; bật H = 80, HH = 90, deadband 2, trễ bật 3 s | xem trước hai instance; lớp gợi ý HH `critical`, H `minor`; Tạo: một dòng, một Ctrl+Z gỡ | US2-3, FR-075 |
| 5 | Dán 30 dòng từ Excel (bồn, bơm, nhiệt độ); kéo điền Id; Ctrl+D cột Lớp | lỗi theo ô, chi tiết ở tab Thông tin, một bước hoàn tác | US2-4 |
| 6 | Dòng có H = 90, HH = 80; Tag không có; alarm số trên Tag FLOAT; lớp không có; nội dung `{abc}` | mỗi lỗi có mã `E_ALARM_*` (`LIMIT_ORDER`, `TAG_REF`, `TAG_TYPE`, `CLASS_REF`, `TEXT_TOKEN`); Nạp xuống khóa | US2-5, FR-013 |
| 7 | Nhập nội dung `"{name} cao: {value:1} {unit} (ngưỡng {limit})"`; Xem trước nội dung | ví dụ có giá trị mẫu; thẻ lạ báo lỗi; gõ `{` hiện gợi ý | US2-6, FR-079 |
| 8 | Dựng tới 200 alarm: Nhập CSV (`tools/alarm-demo` xuất mẫu CSV), "Tạo alarm cho Tag…" cho nhiều Tag, kéo điền; ≥ 4 lớp, ≥ 5 khu vực | Kiểm tra không lỗi; thanh trạng thái "n instance / 500"; trên 200 hiện cảnh báo `W_ALARM_COUNT_HIGH`; mở 200 dòng ≤ 1 s, 2.000 dòng cuộn mượt | SC-001, SC-016 |
| 9 | Bấm **Thử alarm**; chạy 1×, 5×, 20×; Tag sang "Nhập tay", bấm "Vượt ngưỡng H" | alarm bật đúng thời điểm ảo sau trễ bật; xác nhận thử, tạm ẩn thử; hết theo deadband; nhật ký ghi `on-delay`, `deadband`, `ack`… | US2-7, SC-017 |
| 10 | Đặt Tag quality BAD trong Thử alarm | alarm ngưỡng giữ trạng thái, `inputBad`; alarm quality bật | FR-019 |
| 11 | Xem trước màn hình Mô phỏng với `alarm-list` và `alarm-count` | phản ứng với alarm mô phỏng; chế độ Tắt: "Không có dữ liệu alarm" | US5, FR-081 |
| 12 | Đổi tên Tag `TANK01.LEVEL` thành `TANK01.LVL` | `tag` của alarm cập nhật, một Ctrl+Z; "Dùng ở đâu" liệt kê alarm | US2-10, FR-082 |
| 13 | Online, Nạp xuống, mở Chrome | alarm hoạt động như thử; cột **Trạng thái sống** (viền cam) khớp trang; sửa một ngưỡng chưa nạp xuống thì thiết bị không đổi và có dải "Khác thiết bị" | US2-8 |
| 14 | Đọc lên rồi So sánh | "giống" theo đối tượng; sửa một ngưỡng: `≠`, chi tiết "H: 80 → 85" | SC-001, FR-083 |
| 15 | Nạp xuống runtime cũ (0.6 trong thiết bị thử): cột Tương thích runtime | khóa với lý do "cần runtime ≥ 0.8.0" | US2-9, FR-014 |
| 16 | Nhập tên và nội dung có dấu bằng Telex và Unikey (người gõ) | 20/20 lần đúng ("Bơm nước số 1 quá dòng") | US2-11 |
| 17 | Chỉ bàn phím: Tab, mũi tên, Enter, F2, Ctrl+D, Insert, Space/`.` trong panel | làm được mọi việc trên | SC-016 |
| 18 | Một kỹ sư chưa dùng editor: tạo lớp, tạo alarm cho Tag, thử bằng mô phỏng, nạp xuống | ≤ 10 phút không cần tài liệu (không có người thì ghi "tự đo") | SC-023 |

## 5. Mockup

Mở `docs/architecture/mockups/studio-alarms.html` bằng Chrome (task tạo và tự duyệt trước khi viết giao diện, FR-086): cảnh 1 (Danh sách alarm: lưới, lỗi theo ô, cửa sổ lớp theo ngưỡng, cột trạng thái sống khi Online), cảnh 2 (Lớp alarm với xem trước nhấp nháy và âm thanh, hộp thoại Tạo alarm cho Tag), cảnh 3 (Thử alarm: tốc độ, nhập tay, nhật ký). Có công tắc theme sáng và tối và chú giải màu, biểu tượng, trạng thái. Studio làm theo bố cục này (SC-016); khác biệt ghi trong `docs/reports/009-sc016.md`.

## 6. Lệnh chỉ đọc trên BL335 (người dùng chạy, hoặc phiên làm việc khi có quyền SSH)

Không đổi gì trên thiết bị: mọi lệnh chỉ đọc, chạy dưới tài khoản dịch vụ bằng `runuser -u matscada --` khi cần quyền đọc thư mục dữ liệu. Không `sqlite3` (có thể không cài): kiểm bằng lệnh có sẵn. Kết quả ghi vào `docs/reports/device-profile.md` (mục mới "Alarm và đồng hồ"). `<dataDir>` = thư mục dữ liệu của runtime (mặc định `/var/lib/mat-runtime`; xem `runtime.json`).

```sh
date -u; date                                        # đồng hồ hệ thống: có về 1970 không (cờ clockOk)
cat /sys/class/rtc/rtc0/date /sys/class/rtc/rtc0/time 2>/dev/null   # RTC (nếu có); BL335 RTC không chạy theo ghi nhận
timedatectl 2>/dev/null | head -n 8                  # đồng bộ NTP hay không
df -h <dataDir>                                      # dung lượng và chỗ trống (so với minFreeBytes 500 MiB)
ls -l --time-style=full-iso <dataDir>                # có alarm.db, alarm.db-wal; KHÔNG có alarm.db.corrupt-*, history.db.corrupt-*
runuser -u matscada -- stat -c '%n %s %a %U' <dataDir>/alarm.db <dataDir>/alarm.db-wal   # kích thước, quyền 0600, chủ sở hữu
runuser -u matscada -- head -c 16 <dataDir>/alarm.db | od -c | head -n 2                 # "SQLite format 3"
cat /opt/mat-runtime/config/runtime.json             # alarmRetentionDays, alarmMaxBytes, alarmCommitMs nếu đã đặt
systemctl show mat-runtime -p ActiveState -p MainPID -p MemoryCurrent -p MemoryMax
cat /proc/$(systemctl show mat-runtime -p MainPID --value)/io     # rchar, wchar, write_bytes: mốc ghi eMMC (lúc ghi lại số)
curl -sk https://127.0.0.1:8443/api/v1/system/info   # khối alarms: instances, logState, droppedChanges, dbBytes, evalMaxMs
```

**Dùng để quyết định:** đồng hồ thiết bị có đồng bộ không (có thì `clockOk`), `alarm.db` có đúng quyền và có file hỏng cũ không, `dbBytes` so với `alarmMaxBytes`, `evalMaxMs` thực tế, tốc độ ghi của tiến trình lúc nhàn rỗi (mốc trừ ở SC-009).

## 7. Thử tay (cần người)

- **Bộ gõ** Telex và Unikey (Windows 11) ở lưới alarm (tên, nội dung), hộp lý do tạm ẩn, ô tìm chữ: [mục 4 bước 16](#4-studio-dựng-200-alarm-và-thử-alarm-với-runtime-x64).
- **Trình đọc màn hình (NVDA)** trên trang vận hành: banner và vùng đọc báo alarm mới `critical`, huy hiệu "n alarm chưa xác nhận", bảng đọc đúng trạng thái và `aria-sort`, hộp xác nhận, kết quả xác nhận được thông báo; ghi nhận trong báo cáo (SC-012). Lưới Studio và panel Thử alarm đọc đúng.
- **Chrome thật** (≥ 120, máy Windows 11, có loa): bật âm thanh bằng một nhấp; nghe đủ bốn kiểu (`beep`, `double`, `siren`, `none` im lặng) từ editor Lớp alarm và từ trang; âm lượng không gây giật mình; Tắt tiếng; tab ẩn vẫn phát; giảm chuyển động của Windows ("Hiệu ứng hoạt hình" tắt) đổi nhấp nháy thành viền tĩnh; nhấp nháy ≤ 1 Hz bằng mắt.
- **Excel mở CSV:** xuất Lịch sử (khoảng chứa alarm có nội dung tiếng Việt, một nội dung `=1+1`, `@cmd`, số âm): mở bằng Excel (vùng Việt Nam) bằng nhấp đúp; tiếng Việt đúng dấu (BOM), không công thức chạy (ô hiện `'=1+1`...), số thập phân và thời gian ISO đọc được (nếu Excel đọc `91.2` thành chữ hay ngày thì ghi lại để quyết định tùy chọn dấu thập phân); 50.000 dòng mở được. Ghi rõ phiên bản Excel đã thử.
- **Giao diện vận hành thật:** một người vận hành làm kịch bản US1 (thấy, bấm banner, xác nhận, hết, xác nhận tất cả) không cần hướng dẫn; ghi các chỗ vấp.

## 8. Bàn thử với thiết bị thật ⚠️🔌

Cần người dùng cho phép SSH, hoặc tự chạy các lệnh dưới đây. **Ghi mọi thay đổi vào `docs/reports/device-changes.md` kèm cách hoàn tác** (mỗi bước: việc đã làm, lệnh, cách quay lại). Không đụng `atscada-*`, `piano-edtech-*`; không ghi mật khẩu hay IP riêng vào repo; **không tự khởi động lại hay cắt điện thiết bị**: cắt điện thật cần **người ở cạnh thiết bị**.

1. **Cài runtime 0.8.0** bằng `deploy.sh` (gói `package-runtime.ps1`); đọc lời nhắc; kiểm bản trước còn để `rollback.sh`; tạo tài khoản `operator` và `engineer` thử. Chạy các lệnh chỉ đọc của §6 làm mốc "trước".
2. **Nạp xuống** `alarm-demo` (12 alarm) rồi bản 200 alarm từ Studio; mở Chrome từ ≥ 2 máy; làm lại các bước của §2 trên thiết bị thật.
3. **Đo độ trễ** (SC-003): 100 lần đổi Tag (Tag mô phỏng tất định hoặc PLC bàn thử) → DOM đổi, từ ≥ 2 máy Chrome thật; p95 ≤ 1.000 ms, p99 ≤ 1.250 ms (đã trừ trễ cấu hình). Xác nhận → máy khác thấy ≤ 500 ms (SC-006). Chụp lịch sử 100.000 dòng: truy vấn khoảng + khu vực + ưu tiên ≤ 2 s (SC-013).
4. **Đo CPU, RSS và ghi eMMC** (SC-009, SC-011), 30 phút, 200 alarm, 500 Tag mô phỏng/1 s, 10 client xem trang Alarm (dùng `tools/load-tester` và Chrome thật): lấy `ps`/`top` hoặc `systemctl show -p MemoryCurrent` định kỳ; **ghi eMMC** đo bằng `/proc/<pid>/io` (`write_bytes` đầu và cuối, trừ phần Tag và audit, đo riêng bằng lần chạy tắt alarm); so với 007: phần alarm thêm ≤ 3 điểm % CPU và ≤ 4 MB RSS; tổng CPU ≤ 30 %, RSS ≤ 150 MB; ghi alarm tải chuẩn ≤ 10 MB/ngày (ngoại suy), tải bão ≤ 0,1 GB/ngày; tổng ghi runtime ≤ 2 GB/ngày. Chạy `storm` qua bàn thử (chập chờn): tự cách ly đúng `chatterLimit`.
5. **`kill -9` lặp** (cần người ở cạnh): `kill -9 $(systemctl show mat-runtime -p MainPID --value)` 100 lần xen kẽ lúc đang ghi và đang xác nhận (`systemd` tự khởi động lại; **không** `reboot`); sau mỗi lần: `system/info.alarms.logState` = `running`, không file `alarm.db.corrupt-*`, `droppedChanges`; `integrity_check` bằng công cụ đã cài trong gói (nếu có; nếu không thì chỉ kiểm `logState` và file hỏng), alarm còn đúng điều kiện hiện lại ≤ 5 s (SC-008).
6. **CẮT ĐIỆN THẬT** (người ở cạnh thiết bị, ≥ 10 lần; SC-008): trước mỗi lần: có alarm ở các trạng thái khác nhau, vừa xác nhận một alarm (ghi lại giờ); cắt điện lúc đang ghi; bật lại, đợi runtime lên; kiểm: `ls -l` thư mục dữ liệu (không `alarm.db.corrupt-*`), `system/info.alarms.logState` `running`, alarm vừa xác nhận quay về **chưa xác nhận** nếu chưa commit (hướng an toàn) **và** `GET /api/v1/audit` (administrator, Bearer) có dòng `alarm.ack` tương ứng; **không** có alarm `ACTIVE_ACK` mà `audit.db` không có dòng xác nhận; thứ tự theo mã tăng dần dù đồng hồ về 1970 (`clockOk = false`, trang hiện "giờ chưa đồng bộ"), thời hạn lưu không xóa dòng nào khi đồng hồ chưa hợp lệ. Ghi từng lần (giờ, trạng thái trước, sau) vào báo cáo; **không cắt điện khi chưa có người ở cạnh**.
7. **Đĩa gần đầy** (nếu làm được an toàn trên bàn thử, chỉ với người ở cạnh): hạ `minFreeBytes` thử trong `runtime.json` ở bản sao cấu hình hoặc dùng thư mục dữ liệu thử đã giới hạn dung lượng; kiểm `logState` `paused`, alarm vẫn hiện trong RAM và trên trang, tiếp tục ghi khi đủ chỗ. Không làm đầy đĩa của thiết bị chạy dữ liệu thật.
8. **Quay lại:** `rollback.sh`; kiểm project 0.5 có alarm bị runtime 0.7 hoặc cũ từ chối đúng cách; khôi phục project cũ bằng Studio; `alarm.db` được giữ lại (không xóa) để chạy tiếp khi nâng lại.
9. Viết `docs/reports/009-acceptance.md`: số đo, phiên bản Chrome và Excel, kết quả từng SC (SC-001 đến SC-024), mục chưa đo; `docs/reports/009-fr-matrix.md` (mọi FR có test hoặc bước kiểm tay) và `docs/reports/009-sc016.md`; cập nhật `docs/reports/device-changes.md` và `docs/reports/device-profile.md`.

## Điểm cần sửa spec

- **`-Target` của `test-x64.ps1`:** tên target CMake của `core/alarm` và các test chưa tồn tại; quickstart ghi chỗ giữ chỗ cho tới khi `CMakeLists.txt` có (task tạo). Không phải mâu thuẫn spec.
- **`integrity_check` trên BL335 không dùng `sqlite3`:** Đã xử lý trong spec (FR-041, D46: cờ CLI chỉ đọc `mat-runtime --alarm-db-check`).
- **SC-009 cần đo tách riêng** phần ghi của alarm khỏi Tag và audit trong cùng một tiến trình: `/proc/<pid>/io` không tách theo file. Quickstart đo bằng hiệu hai lần chạy (có và không alarm); đề nghị ghi cách này vào SC-009.
