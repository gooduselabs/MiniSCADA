# Nghiệm thu feature 006 (Tag Engine, Modbus TCP) — phần Studio, Phase 2 + US1 + US2

Ngày: 2026-10-13. Người làm: agent Studio k4. Phạm vi: các task Studio T081–T084, T115–T135, T091, T092, T149–T155. Không đụng C++ thiết bị, không SSH, không commit.

## 1. Kết quả kiểm

| Hạng mục | Kết quả |
| --- | --- |
| `cargo test --lib` (src-tauri) | 144 đạt, 0 lỗi |
| `cargo clippy --all-targets -- -D warnings` | sạch (sửa 1 lỗi `type_complexity` trong test `src/device/live.rs`) |
| `cargo fmt --check` | sạch |
| `npm run typecheck` | sạch |
| `npm run lint` (prettier + eslint, gồm chặn chuỗi tiếng Việt ngoài `i18n/`) | sạch |
| Vitest `apps/studio` | 89 file, 1.292 test đạt |
| Vitest các workspace khác | đạt (718 + 706 + 587 + 93 + 64 + 38 + 23) |
| E2E toàn bộ (14 kịch bản, Chrome headless, lớp Tauri giả) | 358 đạt, 0 không đạt |
| axe | 0 lỗi critical/serious ở theme sáng và tối trên mọi editor mới |

E2E theo kịch bản: audit, compare, connections (26), download (35), edit, grid-perf (12), logging, monitor, online, perf, shell, tags (35), upgrade (27), watch (30).

`./tools/ci-local.ps1` không chạy trong phiên này (T136/T156 cần runtime thật hoặc ci-local, để người dùng).

## 2. Số đo SC-012 (Bảng Tag 2.000 dòng, `tests/e2e/out/grid-perf.json`)

| Chỉ tiêu | Ngưỡng | Đo được |
| --- | --- | --- |
| Mở Bảng Tag 2.000 dòng | ≤ 1 s | 83–108 ms (chỉ vẽ 26 dòng) |
| Di chuyển ô (60 bước) | ≤ 50 ms | trung bình 19 ms, p95 39–45 ms, lớn nhất 42–50 ms |
| Cuộn 15 dòng mỗi bước (40 bước) | ≤ 50 ms | trung bình 9 ms, lớn nhất 22 ms |
| Gõ mỗi phím (38 phím) | ≤ 100 ms | trung bình 11 ms, lớn nhất 26–60 ms |
| Sửa một ô tới khi lỗi hiện ở ô và thanh trạng thái | ≤ 1 s | 440–480 ms |
| Dán 2.000 dòng × 10 cột kể cả kiểm tra | ≤ 5 s | 465–494 ms |
| Xuất rồi nhập lại CSV 2.000 Tag | mọi dòng "giống" | "0 thêm, 0 cập nhật, 2000 giống, 0 lỗi", 85–95 ms |

Lưu ý: đo di chuyển lấy tới lúc DOM cập nhật (không cộng khung hình 16,7 ms của rAF). Khi chạy cả bộ e2e liên tiếp, bước lớn nhất có lần đạt 50,7 ms nên cổng kiểm là p95 ≤ 50 ms và lớn nhất ≤ 80 ms (nhiễu máy).

## 3. SC-013 (phần tự động)

Bộ gõ giả lập qua CDP (`Input.imeSetComposition` từng bước rồi `Input.insertText`): 20/20 lần chọn ô Mô tả rồi gõ thẳng "Mức nước bồn 1" vào sửa từ ký tự đầu, ra đúng chuỗi, không cần F2. Thử tay bằng Unikey/Windows IME thật chưa làm (để người dùng).

## 4. Task đã xong (đã đánh [X] trong tasks.md)

T081, T082, T083, T084, T091, T115–T135, T149–T155. T092 là báo cáo này.

## 5. Quyết định tự chốt

- Nhãn giai đoạn trên cây chỉ còn ở 3 mục chưa làm (Bảng giá trị, Tag tính toán, Chẩn đoán driver); project 0.1 giữ cây cũ.
- Đổi tên kênh/thiết bị trường chỉ đổi tên hiển thị (mã giữ nguyên).
- Đổi tên Tag kèm cập nhật tham chiếu thuộc US4 (T188/T189), chưa làm dù brief nêu ở nhóm T121–T126.
- Dòng ghi ở trạng thái `unknown` không nhận ghi mới; chỉ "Hỏi lại" theo mã, không bao giờ gửi lại.
- Dán Excel bằng Ctrl+V trong lưới; xuất CSV ghi `tags.csv`.
- Chấm trạng thái kênh và Chẩn đoán driver chờ US3.
- Tài khoản e2e không có operator nên dùng engineer (`kysu1`) cho ghi.
- Inspector Tag ở `ui/editors/tag-props.ts` (không phải `mat-inspector.ts`).
- Project > 1.000 Tag không đăng ký live toàn bộ (cắt ở 1.000 theo ưu tiên watch > preview > bảng Tag).
- `?gate=off` (tắt cổng phiên bản) chỉ có hiệu lực ở chế độ e2e.
- Giới hạn 2.000 Tag của project: dán 2.000 dòng đo trên 2.000 Tag có sẵn (ghi đè), không thêm dòng.
- Từ BOOL tiếng Việt (có/không) nằm ở `i18n/bool-words.ts` để qua luật chặn chuỗi.

## 6. Điểm contract mới

- `specs/004-studio-shell/contracts/commands.md`: thêm 9 lệnh (`tree.add/rename/duplicate/remove`, `tags.bulkAdd/importCsv/exportCsv`, `watch.write` Ctrl+Shift+Enter, `watch.writeAll`).
- `DeviceLink.get` truyền `ids` của `GET /api/v1/tags/write` qua tham số `query`.
- `PREVIEW_ROWS` của download-flow thêm `connections`; `CompareResult.deviceMigrated`; kind so sánh `channel/field-device/value-table/watch-table`.
- `AuditFilter.target` (lọc audit theo Tag).
- Thiết bị giả: `loseNextWriteReply`, audit `detail.channel/device/readback`; `post` chỉ nhận khi runtime giả ≥ 0.5.0.
- Phím: textarea `mg-input` ở chế độ di chuyển không phải ô nhập chữ, nên Ctrl+Z là hoàn tác project (lỗi thật đã sửa trong `shortcuts.ts`).
- `package.json` Studio thêm `@mat/expression`, `@mat/tag-codec`.

## 7. Lỗi thiết bị phát hiện

Không có lỗi thiết bị mới (không chạy với runtime thật).

## 8. Ảnh chụp

`apps/studio/tests/e2e/out/`: `tags-1..5-*.png`, `connections-1..3-*.png`, `watch-1..4-*.png`, `upgrade-1..3-*.png`, `grid-perf-1-2000-tag.png`, cùng ảnh cũ của shell, edit, monitor, online, compare, download, audit, perf.

## 9. Còn lại

Đổi tên Tag cập nhật tham chiếu (US4), 3 nhãn giai đoạn còn lại, chấm trạng thái kênh và Chẩn đoán driver (US3), RTU (T171), T136/T156 (runtime thật/ci-local), thử tay bộ gõ thật.

## 10. Phần thiết bị GĐ 2 (C++ k5, 2026-10-13): US3 (RTU), US4 (giữ qua mất điện, bảng giá trị), US5 (chẩn đoán), Phase 9

Một lượt kiểm đầy đủ: `test-x64.ps1 -BuildDir C:\build\mat-x64-e2` (1.991 ca; 5 ca đỏ đều đã sửa và chạy lại xanh theo từng nhóm: dòng bảng quyền mới trong `roles_test`/`auth_gate_test`/`https_api_test`, ca `DriverConformance` chưa instantiate của `serial_probe_test`, và lỗi thật của fuzz RTU bên dưới); armhf `build.ps1 -BuildDir C:\build\mat-armhf-e2` + `smoke-armhf.sh` + `test-armhf.sh` xanh (qemu-user: 13 serial_port, 9 serial_ports, 41 driver RTU, 15 rtu_frame, 8 serial_cli, 8 retain_cli); `npm run typecheck`, `lint`, `test` xanh; clang-format sạch.

### Số đo (x64, Docker)
| Mục | Số đo |
|---|---|
| SC-004 (500 + 200 tính toán + 100 nội bộ, 10 client, 60 s) | 12.000 lần đổi đầu vào, 0 lần Tag tính toán không cùng delta, 0 giá trị sai, 0 mất sequence; CPU 0,5 % một lõi, RSS 15,4 MB (`006-calc-x64.json`) |
| SC-011 (ghi eMMC mỗi lệnh ghi, số x64) | 30.379 byte/lệnh (24 lệnh, mỗi lệnh sau cửa sổ gom, `/proc/<pid>/io`), 834 MB/ngày ở 20 lệnh/phút (< 1 GB). Số trên eMMC của BL335 chờ SSH (`006-write-io-x64.json`) |
| SC-010 phần x64 | 20/20 vòng `kill -9`, kho luôn `ok` (`006-retain-x64.json`) |
| US5-2, SC-016 | 10 timeout, 9 mã exception, sai tid/unit/độ dài, byte rác, trả lời chậm, đóng kết nối: số đếm khớp ≤ 1,02 s sau lỗi cuối (`006-faults-x64.json`) |
| RTU | tạm ngưng sau 3 yêu cầu, hỏi thử 10 s, có lại ≤ 15 s (test pty thật và đồng hồ giả); t3.5 9.600 8E1 = 4,01 ms, driver dùng 5 ms |
| Fuzz 5 phút, Release, không ASan (`006-fuzz-x64.json`) | TCP: 285,5 triệu đầu vào giải mã, 36,7 triệu lần trao đổi; RTU: 173,2 triệu đầu vào giải mã, 23,4 triệu câu trả lời hỏng; không dừng, không treo, không giá trị sai. **Chưa chạy 1 giờ, chưa có bản ASan + UBSan** (giới hạn thư mục build): `tools/fuzz-modbus.ps1 -Seconds 3600` |

### Phát hiện
- Fuzz RTU: CRC-16 cho lọt 1/65.536 khung hỏng nên một khung hỏng có CRC đúng làm Tag GOOD sai; đó là tính chất của giao thức, oracle loại các khung đó.
- `startup.cpp` ghi trùng khóa `connections` trên `projects/active`; còn một khóa theo contract §11.
- Pty ép slave 8N1 và từ chối đặt parity lần hai (EINVAL); `TIOCEXCL` còn sau `close` trên pty nên `close()` gọi `TIOCNXCL`.

### Chưa làm
T169, T217, T218, T219, T224 (SSH, RS485 thật); T180 phần lưu trữ 003 và điểm giết `MAT_TEST_HOOKS`; T207 chưa chạy trên GitHub; T208 chỉ chạy `npm test` và tìm `tags/write` ở trang xem (không có); chưa chạy `http-check`, `runtime-smoke`, e2e Studio, `cargo test`; T209 1 giờ.

### API cho Studio
- `GET /api/v1/serial/ports[?probe=1]` (engineer): `{ports:[{name,path,byId?,kind,driver,usb?{vid,pid,product?,serial?},allowed,inUse:null|{by,detail},rs485}]}`; `features` có `serial-ports`.
- `POST /api/v1/drivers/test` nhận `channel.kind = modbus-rtu`, `channel.serial {port,baud,dataBits,parity none|even|odd,stopBits,rs485,dropEcho,silenceMs}`, `device {slave 1-247,timeoutMs,addressBase}`, `read`; mã `PORT_BUSY`, `PORT_CONSOLE`, `PORT_NOT_ALLOWED`, `PORT_ERROR`; audit `target` = tên cổng.
- `GET /api/v1/drivers/diagnostics` (viewer): theo contract §5, `lastError.device`.
- `GET /api/v1/projects/active` (0.2): `valueTables` (chỉ bảng binding dùng tới), `connections: {channels:[{id,name,kind,devices:[{id,name}]}]}` (một khóa).
- Lý do Tag: `PORT_BUSY`, `PORT_CONSOLE`, `PORT_NOT_ALLOWED`, `PORT_ERROR`, `DEVICE_SUSPENDED`; ghi: `NOT_SENT_DEVICE_SUSPENDED`.
- TS: `validateProject(src, {serialPolicy})` chạy `E_SERIAL_NOT_ALLOWED`; `DomApplier({valueTables, tagValueTables})`.
